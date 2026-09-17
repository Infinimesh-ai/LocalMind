import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import * as Y from 'yjs';
import { z } from 'zod';

import { CryptoHelper, URLHelper } from '../../base';
import { Models } from '../../models';
import { PermissionAccess, PermissionService } from '../permission';
import { PgWorkspaceDocStorageAdapter } from './adapters/workspace';
import {
  readResourceMarkdown,
  validateResourceMarkdown,
} from './resource-markdown';
import {
  RESOURCE_CONTRACT_VERSION,
  ResourceError,
  type ResourceWriteCommand,
  type WorkspaceResourceActor,
} from './resource-types';
import { WorkspaceOrganizationService } from './workspace-organization';
import { DocWriter } from './writer';

const cursorSchema = z
  .object({
    scope: z.string(),
    after: z.string(),
    time: z.number().optional(),
    revision: z.string().optional(),
  })
  .strict();
type RootPage = { id: string; title?: string; trash?: boolean; mode?: string };

@Injectable()
export class WorkspaceResourceService {
  constructor(
    private readonly storage: PgWorkspaceDocStorageAdapter,
    private readonly writer: DocWriter,
    private readonly organization: WorkspaceOrganizationService,
    private readonly models: Models,
    private readonly ac: PermissionAccess,
    private readonly permission: PermissionService,
    private readonly crypto: CryptoHelper,
    private readonly urls: URLHelper
  ) {}

  @Transactional<TransactionalAdapterPrisma>({ timeout: 60000 })
  async snapshot<T>(
    input: WorkspaceResourceActor,
    operation: () => Promise<T>
  ) {
    return await this.models.workspaceDirectoryGrant.withMutationLock(
      input.workspaceId,
      () => this.storage.withTransactionalWrites(operation)
    );
  }

  @Transactional<TransactionalAdapterPrisma>({
    isolationLevel: 'RepeatableRead',
    timeout: 15000,
  })
  async observe<T>(operation: () => Promise<T>) {
    // A receipt query must neither wait on an active writer nor compact its data.
    return await this.storage.withTransactionalReads(operation);
  }

  async assertWorkspace(
    input: WorkspaceResourceActor,
    action:
      | 'Workspace.Read'
      | 'Workspace.Sync'
      | 'Workspace.CreateDoc'
      | 'Workspace.Organize.Read' = 'Workspace.Read'
  ) {
    if (
      !(await this.ac
        .user(input.actorId)
        .workspace(input.workspaceId)
        .can(action))
    )
      throw new ResourceError('permission_denied');
  }

  async assertDocument(
    input: WorkspaceResourceActor,
    documentId: string,
    write = false
  ) {
    if (
      documentId === input.workspaceId ||
      documentId.startsWith('db$') ||
      documentId.startsWith('userdata$')
    )
      throw new ResourceError('resource_not_found');
    const access = this.ac
      .user(input.actorId)
      .workspace(input.workspaceId)
      .doc(documentId)
      .projectScope(null);
    if (!(await access.can('Doc.Read')))
      throw new ResourceError('resource_not_found');
    if (write && !(await access.can('Doc.Update')))
      throw new ResourceError('permission_denied');
    const page = (await this.rootPages(input)).find(
      page => page.id === documentId && !page.trash
    );
    if (!page) throw new ResourceError('resource_not_found');
    return page;
  }

  private async rootPages(input: WorkspaceResourceActor): Promise<RootPage[]> {
    const record = await this.storage.getDoc(
      input.workspaceId,
      input.workspaceId
    );
    if (!record) throw new ResourceError('resource_not_found');
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, record.bin);
      const pages = doc.getMap('meta').get('pages');
      if (!(pages instanceof Y.Array) || pages.length > 10000)
        throw new ResourceError('unsupported_document_structure');
      return pages.toJSON() as RootPage[];
    } finally {
      doc.destroy();
    }
  }

  private token(value: unknown) {
    return createHmac('sha256', this.crypto.keyPair.sha256.privateKey)
      .update(JSON.stringify([RESOURCE_CONTRACT_VERSION, value]))
      .digest('base64url');
  }

  private url(workspaceId: string, documentId: string) {
    return new URL(
      `/workspace/${encodeURIComponent(workspaceId)}/${encodeURIComponent(documentId)}`,
      this.urls.requestBaseUrl
    ).toString();
  }

  private async locations(input: WorkspaceResourceActor, documentId: string) {
    if (
      !(await this.ac
        .user(input.actorId)
        .workspace(input.workspaceId)
        .can('Workspace.Organize.Read'))
    )
      return [];
    return (
      await this.organization.documentLocations(
        input.workspaceId,
        input.actorId,
        [documentId]
      )
    ).map(({ folderId }) => ({ folderId }));
  }

  private async load(input: WorkspaceResourceActor, documentId: string) {
    const page = await this.assertDocument(input, documentId);
    const record = await this.storage.getDoc(input.workspaceId, documentId);
    if (!record) throw new ResourceError('resource_not_found');
    const doc = new Y.Doc();
    let title = page.title ?? '';
    let documentType: 'page' | 'edgeless' | 'unknown' = 'unknown';
    try {
      Y.applyUpdate(doc, record.bin);
      const pages = [...doc.getMap<Y.Map<unknown>>('blocks').values()].filter(
        block => block.get('sys:flavour') === 'affine:page'
      );
      if (pages.length === 1) {
        const text = pages[0].get('prop:title');
        if (text instanceof Y.Text) title = text.toString();
        documentType = page.mode === 'edgeless' ? 'edgeless' : 'page';
      }
    } catch {
      /* Metadata can still identify a non-Markdown resource. */
    } finally {
      doc.destroy();
    }
    return {
      bin: record.bin,
      metadata: {
        title,
        documentId,
        documentType,
        version: this.token([
          input.workspaceId,
          documentId,
          record.timestamp,
          page.title ?? '',
        ]),
        updatedAt: new Date(record.timestamp).toISOString(),
        locations: await this.locations(input, documentId),
        url: this.url(input.workspaceId, documentId),
      },
    };
  }

  async describe(input: WorkspaceResourceActor, documentId: string) {
    return (await this.load(input, documentId)).metadata;
  }

  async read(input: WorkspaceResourceActor, documentId: string) {
    const { bin, metadata } = await this.load(input, documentId);
    if (metadata.documentType === 'unknown')
      throw new ResourceError('unsupported_document_kind');
    const markdown = readResourceMarkdown(input.workspaceId, documentId, bin);
    return {
      ...metadata,
      ...markdown,
      ...(metadata.documentType === 'edgeless'
        ? {
            contentWritable: false,
            contentWriteReason: 'unsupported_document_structure' as const,
          }
        : {}),
    };
  }

  async directoryVersion(input: WorkspaceResourceActor) {
    const directory = await this.organization.readDirectory(
      input.workspaceId,
      input.actorId
    );
    const pages = (await this.rootPages(input))
      .map(page => [page.id, Boolean(page.trash)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    // Timestamp survives compaction; raw directory revision is only used within
    // a transaction and never exposed to clients (including hidden paths).
    const record = await this.storage.getDoc(
      input.workspaceId,
      `db$${input.workspaceId}$folders`
    );
    return {
      directory,
      version: this.token([input.workspaceId, record?.timestamp ?? 0, pages]),
    };
  }

  private cursor(value: z.infer<typeof cursorSchema>) {
    return this.crypto.encrypt(JSON.stringify(value));
  }
  private decodeCursor(value: string | undefined, scope: string) {
    if (!value) return null;
    try {
      const cursor = cursorSchema.parse(JSON.parse(this.crypto.decrypt(value)));
      if (cursor.scope !== scope) throw new Error();
      return cursor;
    } catch {
      throw new ResourceError('invalid_input');
    }
  }

  async listFolders(
    input: WorkspaceResourceActor,
    args: { parentId: string | null; cursor?: string; limit: number }
  ) {
    await this.assertWorkspace(input, 'Workspace.Organize.Read');
    await this.organization.assertResourceFolder(
      input.workspaceId,
      input.actorId,
      args.parentId
    );
    const { directory, version } = await this.directoryVersion(input);
    const scope = this.token([input, 'folders', args.parentId, args.limit]);
    const cursor = this.decodeCursor(args.cursor, scope);
    if (cursor && cursor.revision !== version)
      throw new ResourceError('cursor_stale');
    const entries = directory.entries
      .filter(
        ({ row }) =>
          row.type === 'folder' &&
          (row.parentId ?? null) === args.parentId &&
          (!cursor || String(row.id) > cursor.after)
      )
      .sort((a, b) => String(a.row.id).localeCompare(String(b.row.id)))
      .slice(0, args.limit + 1);
    const items = entries.slice(0, args.limit).map(({ row, rights }) => ({
      folderId: String(row.id),
      title: String(row.data),
      parentId: typeof row.parentId === 'string' ? row.parentId : null,
      canWrite: rights.canWrite,
      canOrganize: rights.canOrganize,
      canCreateFolder: rights.canCreateFolder,
    }));
    return {
      directoryVersion: version,
      items,
      nextCursor:
        entries.length > args.limit
          ? this.cursor({
              scope,
              after: items[items.length - 1].folderId,
              revision: version,
            })
          : null,
    };
  }

  async list(
    input: WorkspaceResourceActor,
    familyId: string,
    args: {
      folderId?: string | null;
      externalId?: string;
      cursor?: string;
      limit: number;
    }
  ) {
    if (args.folderId !== undefined) {
      await this.assertWorkspace(input, 'Workspace.Organize.Read');
      await this.organization.assertResourceFolder(
        input.workspaceId,
        input.actorId,
        args.folderId
      );
    }
    const external = args.externalId
      ? await this.models.mcpResourceOperation.external(
          input.workspaceId,
          familyId,
          args.externalId
        )
      : null;
    const scope = this.token([
      input,
      familyId,
      'documents',
      args.folderId === undefined ? 'all' : args.folderId,
      args.externalId ?? null,
      args.limit,
    ]);
    const cursor = this.decodeCursor(args.cursor, scope);
    const pages = (await this.rootPages(input)).filter(
      page =>
        !page.trash &&
        (!args.externalId ||
          (!external?.deletedAt && page.id === external?.documentId))
    );
    const readable = new Set(
      await this.permission.listReadableDocIds({
        userId: input.actorId,
        workspaceId: input.workspaceId,
        projectId: null,
      })
    );
    const times = await this.models.doc.findTimestampsByDocIds(
      input.workspaceId,
      pages.map(page => page.id)
    );
    const candidates = pages
      .filter(page => readable.has(page.id))
      .map(page => ({ ...page, time: times[page.id] ?? 0 }))
      .filter(
        page =>
          !cursor ||
          page.time < (cursor.time ?? 0) ||
          (page.time === cursor.time && page.id > cursor.after)
      )
      .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
    const items: Awaited<ReturnType<WorkspaceResourceService['describe']>>[] =
      [];
    let scanned = 0;
    let last: (typeof candidates)[number] | undefined;
    for (const page of candidates) {
      if (scanned >= 200 || items.length >= args.limit) break;
      scanned++;
      last = page;
      if (
        args.folderId !== undefined &&
        !(await this.locations(input, page.id)).some(
          location => location.folderId === args.folderId
        )
      )
        continue;
      try {
        items.push(await this.describe(input, page.id));
      } catch (error) {
        if (
          !(error instanceof ResourceError) ||
          ![
            'resource_not_found',
            'unsupported_document_kind',
            'content_too_large',
          ].includes(error.code)
        )
          throw error;
      }
    }
    return {
      items,
      nextCursor:
        last && scanned < candidates.length
          ? this.cursor({ scope, after: last.id, time: last.time })
          : null,
    };
  }

  async write(
    input: WorkspaceResourceActor,
    command: ResourceWriteCommand,
    ids: { documentId: string | null; folderId: string | null },
    authorize: () => Promise<void>
  ) {
    await authorize();
    switch (command.toolName) {
      case 'workspace_doc_create': {
        await this.assertWorkspace(input, 'Workspace.CreateDoc');
        await this.assertWorkspace(input, 'Workspace.Sync');
        await this.organization.assertResourceFolder(
          input.workspaceId,
          input.actorId,
          command.folderId,
          true
        );
        const documentId = ids.documentId;
        if (!documentId)
          throw new Error('Missing preallocated document identity');
        validateResourceMarkdown(
          command.title,
          command.content.text,
          documentId
        );
        await this.writer.createDoc(
          input.workspaceId,
          command.title,
          command.content.text,
          input.actorId,
          documentId,
          authorize
        );
        await this.models.doc.upsertMeta(input.workspaceId, documentId, {
          title: command.title,
        });
        await this.models.docUser.setOwner(
          input.workspaceId,
          documentId,
          input.actorId
        );
        await this.organization.moveResourceDocument({
          ...input,
          documentId,
          folderId: command.folderId,
          authorize,
        });
        const current = await this.read(input, documentId);
        return {
          documentId,
          folderId: command.folderId,
          version: current.version,
          directoryVersion: (await this.directoryVersion(input)).version,
          changed: true,
          url: current.url,
        };
      }
      case 'workspace_doc_update':
      case 'workspace_doc_update_meta': {
        await this.assertDocument(input, command.documentId, true);
        const current = await this.describe(input, command.documentId);
        if (current.version !== command.expectedVersion)
          throw new ResourceError('version_conflict', current.version);
        let changed = false;
        if (command.toolName === 'workspace_doc_update') {
          const body = await this.read(input, command.documentId);
          if (!body.contentWritable)
            throw new ResourceError(
              current.documentType === 'edgeless'
                ? 'unsupported_document_kind'
                : 'unsupported_document_structure'
            );
          const replacement = validateResourceMarkdown(
            current.title,
            command.content.text,
            command.documentId
          );
          if (body.content.text !== replacement.content.text) {
            changed =
              (
                await this.writer.updateDoc(
                  input.workspaceId,
                  command.documentId,
                  command.content.text,
                  input.actorId,
                  authorize
                )
              ).changed !== false;
            const saved = await this.read(input, command.documentId);
            if (
              !saved.contentWritable ||
              saved.content.text !== replacement.content.text
            )
              throw new ResourceError('unsupported_document_structure');
          }
        } else if (current.title !== command.title) {
          if (current.documentType === 'unknown')
            throw new ResourceError('unsupported_document_kind');
          await this.writer.updateDocMeta(
            input.workspaceId,
            command.documentId,
            { title: command.title },
            input.actorId,
            authorize
          );
          await this.models.doc.upsertMeta(
            input.workspaceId,
            command.documentId,
            { title: command.title }
          );
          changed = true;
        }
        const after = await this.describe(input, command.documentId);
        return {
          documentId: command.documentId,
          locations: after.locations,
          version: after.version,
          changed,
          url: after.url,
        };
      }
      case 'workspace_folder_create': {
        const folderId = ids.folderId;
        if (!folderId) throw new Error('Missing preallocated folder identity');
        await this.assertWorkspace(input, 'Workspace.Sync');
        const before = await this.directoryVersion(input);
        if (before.version !== command.expectedDirectoryVersion)
          throw new ResourceError('directory_version_conflict', before.version);
        await this.organization.createResourceFolder({
          ...input,
          folderId,
          parentId: command.parentId,
          title: command.title,
          authorize,
        });
        return {
          folderId,
          parentId: command.parentId,
          directoryVersion: (await this.directoryVersion(input)).version,
          changed: true,
        };
      }
      case 'workspace_folder_move_document': {
        await this.assertWorkspace(input, 'Workspace.Sync');
        await this.assertDocument(input, command.documentId);
        const before = await this.directoryVersion(input);
        if (before.version !== command.expectedDirectoryVersion)
          throw new ResourceError('directory_version_conflict', before.version);
        const result = await this.organization.moveResourceDocument({
          ...input,
          documentId: command.documentId,
          folderId: command.folderId,
          authorize,
        });
        const current = await this.describe(input, command.documentId);
        return {
          documentId: command.documentId,
          folderId: command.folderId,
          version: current.version,
          directoryVersion: (await this.directoryVersion(input)).version,
          changed: result.changed,
          url: current.url,
        };
      }
    }
  }
}
