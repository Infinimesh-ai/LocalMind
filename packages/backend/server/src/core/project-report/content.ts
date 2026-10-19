import {
  createReportDocument,
  normalizeReportResponsibility,
  type ReportDocument,
  ReportDocumentSchema,
  reportFinalizationIssues,
} from '@localmind/office/report';
import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { PrismaClient } from '@prisma/client';

import { AccessDenied, BadRequest } from '../../base';
import { Models } from '../../models';
import type {
  ReportActor,
  ReportLeaseProof,
} from '../../models/project-report';
import {
  type ProjectActor,
  projectResourceHash,
} from '../../models/project-resource';
import { ProjectBlobStorage } from '../project';
import type { ReportCommand } from './contracts';

@Injectable()
export class ProjectReportContentService {
  constructor(
    private readonly models: Models,
    private readonly db: PrismaClient,
    private readonly blobs: ProjectBlobStorage
  ) {}

  async read(input: ReportActor & { revisionId?: string }) {
    const report = await this.models.projectReport.get(input);
    const project = await this.db.aiContextProject.findUniqueOrThrow({
      where: { id: input.projectId },
      select: { status: true },
    });
    const revision = await this.models.projectReport.revision({
      ...input,
      revisionId:
        input.revisionId ??
        (project.status === 'archived'
          ? (report.latestFinalRevisionId ?? undefined)
          : undefined),
    });
    if (project.status === 'archived' && revision.kind !== 'final')
      throw new AccessDenied(
        'Only finalized reports are readable in archived projects'
      );
    const { bytes, blob } = await this.blobs.read({
      ...input,
      key: revision.contentBlobKey,
      allowArchivedRead: true,
    });
    if (blob.fingerprint !== revision.contentHash)
      throw new BadRequest('Report content fingerprint is invalid');
    const document = ReportDocumentSchema.parse(
      JSON.parse(bytes.toString('utf8'))
    );
    await this.models.projectReport.get(input);
    const display = await this.visibleIdentities(document);
    return {
      report: {
        ...report,
        creatorLabel: display.creator.label,
        responsibility: display.responsibility,
      },
      revision,
      document: display,
    };
  }

  /** Resolve deleted identities at read time without modifying immutable evidence. */
  async visibleIdentities(document: ReportDocument): Promise<ReportDocument> {
    const ids = new Set([document.creator.actorId]);
    for (const responsibility of [
      document.responsibility,
      ...document.chapters.flatMap(c => c.nodes.map(n => n.responsibility)),
    ]) {
      if (responsibility?.identity.kind === 'member')
        ids.add(responsibility.identity.actorId);
    }
    const users = await this.db.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    const available = new Set(users.map(user => user.id));
    const result = structuredClone(document);
    if (!available.has(result.creator.actorId))
      result.creator.label = '已删除用户';
    for (const responsibility of [
      result.responsibility,
      ...result.chapters.flatMap(c => c.nodes.map(n => n.responsibility)),
    ]) {
      if (
        responsibility?.identity.kind === 'member' &&
        !available.has(responsibility.identity.actorId)
      )
        responsibility.identity.label = '已删除用户';
    }
    return result;
  }

  async create(
    input: ProjectActor & {
      requestKey: string;
      command: Extract<ReportCommand, { operation: 'create' }>;
    }
  ) {
    const { command } = input;
    const fingerprint = projectResourceHash(command);
    const prior = await this.models.projectReport.findRequest({
      ...input,
      fingerprint,
      operation: 'create',
    });
    if (prior) return this.read({ ...input, reportId: prior.reportId });
    const template = await this.models.projectReport.templateRevision({
      ...input,
      revisionId: command.templateRevisionId,
    });
    const templateState = await this.db.projectReportTemplate.findUniqueOrThrow(
      { where: { id: template.templateId } }
    );
    if (templateState.status !== 'active')
      throw new BadRequest('Report template is archived');
    const actor = await this.models.user.get(input.actorId);
    if (!actor) throw new AccessDenied();
    const creator = {
      actorId: input.actorId,
      label: actor.name || actor.email,
    };
    let document = createReportDocument({
      title: command.title,
      creator,
      period: command.period,
      template: template.content,
      now: new Date().toISOString(),
    });
    let copiedFrom: ReportDocument | undefined;
    if (command.duplicateRevisionId || command.previousRevisionId) {
      if (!command.previousReportId)
        throw new BadRequest('A source report is required');
      const prior = await this.read({
        ...input,
        reportId: command.previousReportId,
        revisionId: command.duplicateRevisionId ?? command.previousRevisionId,
      });
      if (command.duplicateRevisionId) {
        copiedFrom = prior.document;
        document = normalizeReportResponsibility(
          {
            ...prior.document,
            creator,
            title: command.title,
            period: command.period,
          },
          creator
        );
      }
    }
    document = ReportDocumentSchema.parse({
      ...document,
      audience: command.audience ?? document.audience,
      language: command.language ?? document.language,
      durationMinutes: command.durationMinutes ?? document.durationMinutes,
      responsibility: command.responsibility ?? document.responsibility,
    });
    await this.validateAssets(input, document, copiedFrom);
    const blob = await this.write(input, document);
    const report = await this.models.projectReport.create({
      ...input,
      fingerprint,
      document,
      blob,
      templateRevisionId: command.templateRevisionId,
      selection: command.selection,
      previousReportId: command.previousReportId,
      previousRevisionId:
        command.previousRevisionId ?? command.duplicateRevisionId,
    });
    return this.read({ ...input, reportId: report.id });
  }

  async write(input: ProjectActor, document: ReportDocument) {
    const bytes = Buffer.from(
      JSON.stringify(ReportDocumentSchema.parse(document))
    );
    if (bytes.length > 32 * 1024 * 1024)
      throw new BadRequest('Report content exceeds its bound');
    return this.blobs.put({
      ...input,
      bytes,
      mimeType: 'application/vnd.localmind.report+json',
    });
  }

  async save(
    input: ReportActor & {
      requestKey: string;
      expectedVersion: number;
      editLease: ReportLeaseProof;
      document: ReportDocument;
      kind: 'draft' | 'preview' | 'final';
      reason: string;
      automatic?: boolean;
      restoreRevisionId?: string;
    }
  ) {
    const current = await this.read(input);
    const creator = {
      actorId: current.report.createdByActorId,
      label: current.report.creatorLabel,
    };
    const document = normalizeReportResponsibility(input.document, creator);
    const evidenceBase = input.restoreRevisionId
      ? (await this.read({ ...input, revisionId: input.restoreRevisionId }))
          .document
      : current.document;
    this.validateEvidence(document, evidenceBase, input.actorId);
    await this.validateAssets(input, document, evidenceBase);
    if (input.kind === 'final') {
      const issues = reportFinalizationIssues(
        document,
        input.automatic ?? false
      );
      if (issues.length)
        throw new BadRequest(
          `Report has ${issues.length} unresolved verification items`
        );
      for (const source of document.sources) {
        if (source.kind === 'memory') continue;
        if (source.kind === 'work_order') {
          // The finalizer must still be a participant of the cited work order.
          await this.models.projectReportGeneration.validateWorkOrderEvidence({
            ...input,
            id: source.resourceId,
            revision: source.revision,
            fingerprint: source.fingerprint,
          });
          continue;
        }
        await this.models.projectResource.get({
          ...input,
          resourceId: source.resourceId,
        });
      }
    }
    const blob = await this.write(input, document);
    await this.models.projectReport.retainBlobs({ ...input, keys: [blob.key] });
    const fingerprint = projectResourceHash({
      document,
      kind: input.kind,
      reason: input.reason,
      expectedVersion: input.expectedVersion,
      restoreRevisionId: input.restoreRevisionId ?? null,
    });
    await this.models.projectReport.save({
      ...input,
      document,
      blob,
      fingerprint,
      sourceManifestId: current.revision.sourceManifestId ?? undefined,
    });
    // Preview is a frozen revision but does not replace the current draft.
    const receipt = await this.models.projectReport.findRequest({
      ...input,
      fingerprint,
      operation: input.kind,
    });
    const result = receipt?.result as { revisionId?: string } | undefined;
    return this.read({ ...input, revisionId: result?.revisionId });
  }

  validateEvidence(
    document: ReportDocument,
    base: ReportDocument,
    actorId: string
  ) {
    if (
      projectResourceHash(document.sources) !==
        projectResourceHash(base.sources) ||
      projectResourceHash(document.coverage) !==
        projectResourceHash(base.coverage) ||
      document.cutoffAt !== base.cutoffAt
    )
      throw new BadRequest(
        'Source evidence must be refreshed through the report workflow'
      );
    const originals = new Map(base.issues.map(issue => [issue.id, issue]));
    for (const issue of document.issues) {
      const original = originals.get(issue.id);
      if (!original)
        throw new BadRequest(
          'Verification issues are created by the report workflow'
        );
      const { resolution: _old, ...before } = original;
      const { resolution, ...after } = issue;
      if (projectResourceHash(before) !== projectResourceHash(after))
        throw new BadRequest('Verification evidence is immutable');
      if (
        resolution &&
        projectResourceHash(resolution) !==
          projectResourceHash(original.resolution ?? null)
      ) {
        if (resolution.actorId !== actorId)
          throw new BadRequest(
            'Verification resolution must identify the authenticated actor'
          );
        if (
          Math.abs(new Date(resolution.resolvedAt).getTime() - Date.now()) >
          300000
        )
          throw new BadRequest(
            'Verification resolution has an invalid timestamp'
          );
      }
    }
    if (document.issues.length !== base.issues.length)
      throw new BadRequest(
        'Resolve verification items instead of removing their evidence'
      );
  }

  @Transactional()
  async validateAssets(
    input: ProjectActor,
    document: ReportDocument,
    base?: ReportDocument
  ) {
    await this.models.projectResource.assertMember(input);
    for (const asset of document.assets) {
      const blob = await this.models.projectResource.getBlob({
        ...input,
        key: asset.blobKey,
      });
      if (blob.mimeType !== asset.mimeType)
        throw new BadRequest('Report image MIME evidence differs');
      const retained = await this.db.projectReportBlobReference.findFirst({
        where: {
          projectId: input.projectId,
          blobKey: asset.blobKey,
          OR: [
            { report: { lifecycle: { not: 'trashed' }, deletion: null } },
            { template: { status: 'active' } },
          ],
        },
      });
      if (!retained)
        await this.models.projectResource.assertBlobDownload({
          ...input,
          key: asset.blobKey,
        });
    }
    const previous = new Map([
      ['$report', base?.responsibility] as const,
      ...(base?.chapters.flatMap(c =>
        c.nodes.map(n => [n.id, n.responsibility] as const)
      ) ?? []),
    ]);
    for (const [key, responsibility] of [
      ['$report', document.responsibility] as const,
      ...document.chapters.flatMap(c =>
        c.nodes.map(n => [n.id, n.responsibility] as const)
      ),
    ]) {
      if (!responsibility) continue;
      if (
        responsibility.identity.kind === 'member' &&
        responsibility.origin !== 'creator_fallback'
      ) {
        const prior = previous.get(key);
        // Historical assignments remain readable and editable after a member leaves.
        if (
          prior &&
          projectResourceHash(prior) === projectResourceHash(responsibility)
        )
          continue;
        await this.models.projectResource.assertMember({
          ...input,
          actorId: responsibility.identity.actorId,
        });
      }
    }
  }
}
