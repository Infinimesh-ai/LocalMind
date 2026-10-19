import '../../plugins/copilot/report-config';
import './config';

import type {
  DeckScopeKind,
  DeckSourceReason,
  DeckSourceRef,
  DeckSourceView,
} from '@localmind/office/report-deck';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { BadRequest, Config, UserFriendlyError } from '../../base';
import { Models } from '../../models';
import { workOrderEvidenceText } from '../../models/project-report-generation-contract';
import type { ProjectActor } from '../../models/project-resource';
import { DocReader, WorkspaceOrganizationService } from '../doc';
import { ResourceError } from '../doc/resource-types';
import { OfficeArtifactService } from '../office';
import { WorkspaceNativeResourceService } from '../office/workspace-resource-service';
import { PermissionAccess } from '../permission';
import { ProjectResourceService } from '../project';
import { readProjectResourceText } from '../project-report/resource-text';
import {
  allocateDeckBudget,
  deckResourceKey,
  type DeckSourceStatus,
  planDeckSources,
  truncateDocuments,
} from './source-rules';

/** One readable unit inside a source (a folder or project yields many). */
export type DeckSourceDocument = {
  /** Stable identity used for cross-source dedupe and fact grounding. */
  key: string;
  title: string;
  text: string;
  /** Server-generated status text (work orders) or shared memory. */
  role: 'document' | 'background' | 'work_order';
};

export type ResolvedDeckSource = {
  index: number;
  ref: DeckSourceRef;
  title: string;
  scopeLabel: string;
  status: DeckSourceStatus;
  reason: DeckSourceReason | null;
  chars: number;
  documents: DeckSourceDocument[];
};

type Mode = 'estimate' | 'read';
const FOLDER_ITEM_LIMIT = 200;
const MEMORY_CHARS_LIMIT = 100000;

class SourceExcluded extends Error {
  constructor(readonly reason: DeckSourceReason) {
    super(reason);
  }
}

/** Map storage/permission failures to a user-visible exclusion reason. */
export function deckSourceFailureReason(
  error: unknown,
  missing: 'not_found' | 'unsupported' = 'unsupported'
): DeckSourceReason {
  if (error instanceof SourceExcluded) return error.reason;
  if (error instanceof ResourceError) {
    if (error.code === 'permission_denied') return 'no_permission';
    if (error.code === 'resource_not_found') return 'not_found';
    return 'unsupported';
  }
  if (error instanceof BadRequest) return missing;
  if (error instanceof UserFriendlyError) {
    if (error.type === 'no_permission' || error.type === 'action_forbidden')
      return 'no_permission';
    if (error.type === 'resource_not_found') return 'not_found';
  }
  return 'unsupported';
}

/**
 * Resolves a cross-scope source list as the deck owner. Every source is
 * checked individually against the owner's live permissions; the model only
 * ever sees text read here.
 */
@Injectable()
export class ReportDeckSourceService {
  private readonly logger = new Logger(ReportDeckSourceService.name);

  constructor(
    private readonly models: Models,
    private readonly db: PrismaClient,
    private readonly ac: PermissionAccess,
    private readonly docs: DocReader,
    private readonly organization: WorkspaceOrganizationService,
    private readonly native: WorkspaceNativeResourceService,
    private readonly resources: ProjectResourceService,
    private readonly office: OfficeArtifactService,
    private readonly config: Config
  ) {}

  async scopeLabels(scopes: { scopeKind: DeckScopeKind; scopeId: string }[]) {
    const workspaces = [
      ...new Set(
        scopes.filter(s => s.scopeKind === 'workspace').map(s => s.scopeId)
      ),
    ];
    const projects = [
      ...new Set(
        scopes.filter(s => s.scopeKind === 'project').map(s => s.scopeId)
      ),
    ];
    const [workspaceRows, projectRows] = await Promise.all([
      workspaces.length
        ? this.db.workspace.findMany({
            where: { id: { in: workspaces } },
            select: { id: true, name: true },
          })
        : [],
      projects.length
        ? this.db.aiContextProject.findMany({
            where: { id: { in: projects } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const labels = new Map<string, string>();
    for (const row of workspaceRows)
      labels.set(`workspace:${row.id}`, row.name?.trim() || 'Workspace');
    for (const row of projectRows)
      labels.set(`project:${row.id}`, row.name.trim() || 'Project');
    return (scopeKind: DeckScopeKind, scopeId: string) =>
      labels.get(`${scopeKind}:${scopeId}`) ??
      (scopeKind === 'workspace' ? 'Workspace' : 'Project');
  }

  /**
   * `estimate` checks permissions and estimates characters cheaply (preflight).
   * `read` extracts text for generation and applies the character budget.
   */
  async resolve(
    actorId: string,
    refs: readonly DeckSourceRef[],
    mode: Mode,
    options: { cancelled?: () => Promise<boolean> } = {}
  ): Promise<ResolvedDeckSource[]> {
    const deckConfig = this.config.reportDecks;
    const plan = planDeckSources(refs, deckConfig.maxSources);
    const label = await this.scopeLabels(refs.map(ref => ref));
    const seen = new Set<string>();
    const resolved: ResolvedDeckSource[] = [];
    for (const item of plan) {
      if (options.cancelled && (await options.cancelled())) break;
      const base = {
        index: item.index,
        ref: item.ref,
        title: item.ref.title?.trim() || '',
        scopeLabel: label(item.ref.scopeKind, item.ref.scopeId),
      };
      if (item.skip) {
        resolved.push({
          ...base,
          status: 'excluded',
          reason: item.skip,
          chars: 0,
          documents: [],
        });
        continue;
      }
      try {
        const { title, documents } = await this.readSource(
          actorId,
          item.ref,
          mode
        );
        // Drop documents already supplied by an earlier source.
        const fresh = documents.filter(document => !seen.has(document.key));
        if (documents.length && !fresh.length)
          throw new SourceExcluded('duplicate');
        fresh.forEach(document => seen.add(document.key));
        const chars = fresh.reduce((sum, doc) => sum + doc.text.length, 0);
        if (!fresh.some(document => document.text.trim()))
          throw new SourceExcluded('empty');
        resolved.push({
          ...base,
          title: title || base.title,
          status: 'included',
          reason: null,
          chars,
          documents: fresh,
        });
      } catch (error) {
        const reason = deckSourceFailureReason(
          error,
          item.ref.scopeKind === 'project' ? 'not_found' : 'unsupported'
        );
        if (!(error instanceof SourceExcluded) && reason === 'unsupported')
          this.logger.warn(
            `Report deck source could not be read: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        resolved.push({
          ...base,
          status: 'excluded',
          reason,
          chars: 0,
          documents: [],
        });
      }
    }
    const included = resolved.filter(source => source.status === 'included');
    const decisions = allocateDeckBudget(
      included.map(source => source.chars),
      deckConfig.maxSourceChars
    );
    included.forEach((source, index) => {
      const decision = decisions[index];
      source.status = decision.status;
      source.reason = decision.reason;
      if (decision.status === 'excluded') {
        source.documents = [];
        source.chars = 0;
      } else if (decision.status === 'truncated') {
        source.documents = truncateDocuments(source.documents, decision.keep);
        source.chars = decision.keep;
      }
    });
    return resolved.sort((a, b) => a.index - b.index);
  }

  view(source: ResolvedDeckSource): DeckSourceView {
    return {
      scopeKind: source.ref.scopeKind,
      scopeId: source.ref.scopeId,
      scopeLabel: source.scopeLabel,
      kind: source.ref.kind,
      resourceId: source.ref.resourceId ?? null,
      title: source.title || source.scopeLabel,
      status: source.status,
      reason: source.reason,
      chars: source.chars,
    };
  }

  private async readSource(
    actorId: string,
    ref: DeckSourceRef,
    mode: Mode
  ): Promise<{ title: string; documents: DeckSourceDocument[] }> {
    if (ref.scopeKind === 'workspace') {
      const workspaceId = ref.scopeId;
      const resourceId = ref.resourceId as string;
      if (ref.kind === 'doc')
        return this.workspaceDoc(actorId, workspaceId, resourceId);
      if (ref.kind === 'file')
        return this.workspaceNative(actorId, workspaceId, resourceId);
      if (ref.kind === 'folder')
        return this.workspaceFolder(actorId, workspaceId, resourceId, mode);
      throw new SourceExcluded('unsupported');
    }
    const actor = { projectId: ref.scopeId, actorId };
    if (ref.kind === 'project_all') return this.projectAll(actor, mode);
    if (ref.kind === 'folder')
      return this.projectFolder(actor, ref.resourceId as string, mode);
    return this.projectResource(actor, ref.resourceId as string, mode);
  }

  // ---------------------------------------------------------------- workspace

  private async workspaceDoc(
    actorId: string,
    workspaceId: string,
    docId: string
  ) {
    if (
      docId === workspaceId ||
      docId.startsWith('db$') ||
      docId.startsWith('userdata$')
    )
      throw new SourceExcluded('not_found');
    const allowed = await this.ac
      .user(actorId)
      .workspace(workspaceId)
      .doc(docId)
      .projectScope(null)
      .can('Doc.Read');
    if (!allowed) throw new SourceExcluded('no_permission');
    const content = await this.docs.getVersionedDocMarkdown(workspaceId, docId);
    if (!content) throw new SourceExcluded('not_found');
    const title = content.title?.trim() || '';
    return {
      title,
      documents: [
        {
          key: deckResourceKey('workspace', workspaceId, docId),
          title: title || 'Untitled',
          text: content.markdown,
          role: 'document' as const,
        },
      ],
    };
  }

  private async workspaceNative(
    actorId: string,
    workspaceId: string,
    resourceId: string
  ) {
    const identity = { workspaceId, actorId, resourceId };
    try {
      const file = await this.native.readText({ ...identity, kind: 'file' });
      return this.nativeResult(workspaceId, resourceId, file.title, file.text);
    } catch (error) {
      if (!(error instanceof BadRequest)) {
        // Not a text file or not a file at all: try indexed Office/file text.
        const reason = deckSourceFailureReason(error, 'not_found');
        if (reason === 'no_permission') throw error;
      }
    }
    for (const kind of ['office', 'file'] as const) {
      try {
        const resource = await this.native.get({ ...identity, kind });
        // `get` asserted live Blob and directory ACL; read the indexed text.
        const indexed =
          kind === 'office'
            ? await this.db.workspaceOfficeState.findFirst({
                where: { artifactId: resourceId, workspaceId },
                select: { searchText: true },
              })
            : await this.db.workspaceFileState.findFirst({
                where: { fileId: resourceId, workspaceId },
                select: { searchText: true },
              });
        return this.nativeResult(
          workspaceId,
          resourceId,
          resource.title,
          indexed?.searchText ?? ''
        );
      } catch (error) {
        const reason = deckSourceFailureReason(error, 'not_found');
        if (reason === 'no_permission') throw error;
      }
    }
    throw new SourceExcluded('not_found');
  }

  private nativeResult(
    workspaceId: string,
    resourceId: string,
    title: string,
    text: string
  ) {
    return {
      title,
      documents: [
        {
          key: deckResourceKey('workspace', workspaceId, resourceId),
          title: title || 'Untitled',
          text,
          role: 'document' as const,
        },
      ],
    };
  }

  private async workspaceFolder(
    actorId: string,
    workspaceId: string,
    folderId: string,
    mode: Mode
  ) {
    const directory = await this.organization.assertResourceFolder(
      workspaceId,
      actorId,
      folderId
    );
    const folder = directory.entries.find(
      entry => entry.row.id === folderId && entry.row.type === 'folder'
    );
    const children = new Map<string, typeof directory.entries>();
    for (const entry of directory.entries) {
      const parent =
        typeof entry.row.parentId === 'string' ? entry.row.parentId : null;
      if (!parent) continue;
      const list = children.get(parent) ?? [];
      list.push(entry);
      children.set(parent, list);
    }
    const queue = [folderId];
    const visited = new Set<string>();
    const targets: { kind: 'doc' | 'file'; id: string }[] = [];
    while (queue.length && targets.length < FOLDER_ITEM_LIMIT) {
      const current = queue.shift() as string;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const entry of children.get(current) ?? []) {
        const type = entry.row.type;
        if (type === 'folder') queue.push(String(entry.row.id));
        else if (type === 'doc') {
          targets.push({ kind: 'doc', id: String(entry.row.data) });
          // Page-tree documents may contain child pages.
          queue.push(String(entry.row.id));
        } else if (type === 'file' || type === 'office')
          targets.push({ kind: 'file', id: String(entry.row.data) });
        if (targets.length >= FOLDER_ITEM_LIMIT) break;
      }
    }
    const documents: DeckSourceDocument[] = [];
    for (const target of targets) {
      try {
        const read =
          target.kind === 'doc'
            ? await this.workspaceDoc(actorId, workspaceId, target.id)
            : await this.workspaceNative(actorId, workspaceId, target.id);
        documents.push(...read.documents);
      } catch {
        // Unreadable children are skipped; the folder itself stays included.
      }
      if (mode === 'estimate' && documents.length >= FOLDER_ITEM_LIMIT) break;
    }
    return {
      title: typeof folder?.row.data === 'string' ? folder.row.data : '',
      documents,
    };
  }

  // ------------------------------------------------------------------ project

  private async projectResource(
    actor: ProjectActor,
    resourceId: string,
    mode: Mode
  ) {
    const resource = await this.models.projectResource.get({
      ...actor,
      resourceId,
    });
    if (resource.kind === 'folder')
      return this.projectFolder(actor, resourceId, mode);
    const document = await this.projectDocument(actor, resource, mode);
    return { title: resource.title, documents: [document] };
  }

  private async projectDocument(
    actor: ProjectActor,
    resource: { id: string; title: string; kind: string; searchText: string },
    mode: Mode
  ): Promise<DeckSourceDocument> {
    const key = deckResourceKey('project', actor.projectId, resource.id);
    if (mode === 'estimate')
      return {
        key,
        title: resource.title,
        // Indexed text is an estimate only; generation reads the revision.
        text: resource.searchText,
        role: 'document',
      };
    const now = new Date();
    const captured = await this.models.projectReportGeneration.captureResource({
      ...actor,
      resourceId: resource.id,
      cutoffAt: now,
      periodStart: new Date(0),
      periodEnd: now,
    });
    const { text } = await readProjectResourceText(
      { models: this.models, resources: this.resources, office: this.office },
      actor,
      {
        resourceId: resource.id,
        kind: captured.resource.kind,
        revision: captured.revisionId,
        sequence: captured.sequence,
        artifactId: captured.resource.officeArtifactId ?? undefined,
      },
      this.config.reportDecks.maxSourceChars
    );
    // Authorization is re-checked after reading so revocation wins.
    await this.models.projectResource.get({
      ...actor,
      resourceId: resource.id,
    });
    return {
      key,
      title: resource.title,
      text: text.slice(0, this.config.reportDecks.maxSourceChars),
      role: 'document',
    };
  }

  private async projectTree(actor: ProjectActor, rootId: string | null) {
    const excluded =
      await this.models.projectReportGeneration.reportExportResourceIds(actor);
    const queue: (string | null)[] = [rootId];
    const seen = new Set<string | null>();
    const items: Awaited<
      ReturnType<Models['projectResource']['list']>
    >['items'] = [];
    while (queue.length && items.length < FOLDER_ITEM_LIMIT) {
      const parentId = queue.shift() ?? null;
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      let cursor: string | null = null;
      do {
        const page = await this.models.projectResource.list({
          ...actor,
          parentId,
          cursor,
          limit: 100,
        });
        for (const row of page.items) {
          if (row.kind === 'folder') queue.push(row.id);
          else if (!excluded.has(row.id)) items.push(row);
          if (items.length >= FOLDER_ITEM_LIMIT) break;
        }
        cursor = items.length >= FOLDER_ITEM_LIMIT ? null : page.nextCursor;
      } while (cursor);
    }
    return items;
  }

  private async projectDocuments(
    actor: ProjectActor,
    rootId: string | null,
    mode: Mode
  ) {
    const documents: DeckSourceDocument[] = [];
    for (const row of await this.projectTree(actor, rootId)) {
      try {
        documents.push(await this.projectDocument(actor, row, mode));
      } catch (error) {
        // Membership loss stops the whole source; damaged files are skipped.
        await this.models.projectResource.assertMember(actor);
        if (deckSourceFailureReason(error) === 'no_permission') throw error;
      }
    }
    return documents;
  }

  private async projectFolder(
    actor: ProjectActor,
    folderId: string,
    mode: Mode
  ) {
    const folder = await this.models.projectResource.get({
      ...actor,
      resourceId: folderId,
    });
    if (folder.kind !== 'folder')
      return {
        title: folder.title,
        documents: [await this.projectDocument(actor, folder, mode)],
      };
    return {
      title: folder.title,
      documents: await this.projectDocuments(actor, folderId, mode),
    };
  }

  private async projectAll(actor: ProjectActor, mode: Mode) {
    await this.models.projectResource.assertMember(actor);
    const project = await this.db.aiContextProject.findUnique({
      where: { id: actor.projectId },
      select: { name: true },
    });
    const documents = await this.projectDocuments(actor, null, mode);
    documents.push(...(await this.projectBackground(actor)));
    documents.push(...(await this.projectWorkOrders(actor)));
    return { title: project?.name ?? '', documents };
  }

  /** Shared project memory; background only, never member progress. */
  private async projectBackground(actor: ProjectActor) {
    const documents: DeckSourceDocument[] = [];
    const cutoffAt = new Date().toISOString();
    let cursor: string | undefined;
    let remaining = MEMORY_CHARS_LIMIT;
    do {
      const page = await this.models.projectReportGeneration.sharedBackground({
        ...actor,
        cursor,
        cutoffAt,
        limit: 100,
      });
      for (const memory of page.items) {
        const text = memory.content.slice(
          0,
          Math.max(0, Math.min(remaining, 12000))
        );
        if (!text.trim()) continue;
        remaining -= text.length;
        documents.push({
          key: `project:${actor.projectId}:memory:${memory.id}`,
          title: 'Shared project background',
          text,
          role: 'background',
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor && remaining > 0 && documents.length < 1000);
    return documents;
  }

  /** The owner's own work orders, as server-built status text only. */
  private async projectWorkOrders(actor: ProjectActor) {
    const documents: DeckSourceDocument[] = [];
    const cutoffAt = new Date().toISOString();
    let cursor: string | undefined;
    let remaining = MEMORY_CHARS_LIMIT;
    do {
      const page = await this.models.projectReportGeneration.workOrderEvidence({
        ...actor,
        cursor,
        cutoffAt,
        limit: 100,
      });
      for (const order of page.items) {
        const text = workOrderEvidenceText(order);
        if (text.length > remaining) {
          remaining = 0;
          break;
        }
        remaining -= text.length;
        documents.push({
          key: `project:${actor.projectId}:work-order:${order.id}`,
          title: `工单: ${order.title}`,
          text,
          role: 'work_order',
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor && remaining > 0 && documents.length < 500);
    return documents;
  }
}
