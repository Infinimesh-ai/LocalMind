import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { pageTreeNodeId, WORKSPACE_PAGE_TREE_CONTRACT } from '@affine/graphql';
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import type { McpCredential, McpResourceOperation } from '@prisma/client';
import { z } from 'zod';

import {
  ActionForbidden,
  BadRequest,
  Config,
  CryptoHelper,
  NotFound,
  readBufferWithLimit,
  ResourceConflict,
  sniffMime,
} from '../../../base';
import {
  DocumentPropertiesService,
  DocWriter,
  WorkspaceLifecycleService,
  WorkspaceOrganizationService,
  WorkspacePageTreeService,
  WorkspaceResourceService,
} from '../../../core/doc';
import {
  archiveBinary,
  archiveBytes,
  archiveFingerprint,
  decodeDocumentArchive,
  DOCUMENT_ARCHIVE_FORMAT,
  DOCUMENT_ARCHIVE_LIMIT,
  DOCUMENT_ARCHIVE_MIME,
  type DocumentArchive,
  documentArchive,
  documentArchiveComments,
  encodeDocumentArchive,
  nativeDocumentAssets,
} from '../../../core/doc/document-archive';
import {
  documentAdapterManifest,
  documentFileAdapterManifest,
} from '../../../core/doc/document-capabilities';
import { copyNativeDocument } from '../../../core/doc/document-copy';
import { createNativeDocument } from '../../../core/doc/document-create';
import {
  type DocumentDependencies,
  nativeDependencies,
} from '../../../core/doc/document-dependencies';
import {
  DocumentEditError,
  inspectNativeDocument,
} from '../../../core/doc/document-editor';
import { editDocumentFile } from '../../../core/doc/document-file';
import {
  DOCUMENT_CONTRACT_VERSION,
  documentNativeBatch,
} from '../../../core/doc/document-schema';
import { WorkspaceNativeResourceAccess } from '../../../core/doc/native-resource-access';
import { ResourceError } from '../../../core/doc/resource-types';
import {
  OfficeArtifactService,
  OfficeCommandService,
} from '../../../core/office';
import { OfficeResourceStorage } from '../../../core/office/resource-storage';
import {
  nativeTitleSchema,
  WorkspaceNativeResourceService,
} from '../../../core/office/workspace-resource-service';
import { PermissionAccess } from '../../../core/permission';
import { DocumentAccessService } from '../../../core/workspaces/document-access';
import { Models } from '../../../models';
import { MCP_UPLOAD_PART_BYTES } from '../../../models/mcp-document-upload';
import { toToolJsonSchema } from '../tools/json-schema';
import {
  MCP_DOCUMENT_WRITE_CAPABILITIES,
  normalizeMcpCapabilities,
} from './capabilities';
import { documentUploadResult } from './document-assets-schema';
import { McpDocumentCommentsService } from './document-comments';
import {
  DOCUMENT_FAILURE_SCHEMA,
  DOCUMENT_INPUT_SCHEMAS,
  DOCUMENT_OPERATION_SCHEMA,
  DOCUMENT_RECEIPT_SCHEMA,
  DOCUMENT_TOOL_NAMES,
  type DocumentApply,
  documentOperationResource,
  documentOutputSchema,
  documentResource,
  type DocumentToolName,
} from './document-schema';
import type { WorkspaceMcpToolDefinition } from './types';

type Credential = Pick<
  McpCredential,
  'id' | 'familyId' | 'userId' | 'workspaceId'
>;
type Resource = z.infer<typeof documentResource>;
type DocumentCreation = (
  | z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_create_native>
  | z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_import>
) & { resource: Resource };
type DocumentDuplication = z.infer<
  typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_duplicate
> & { resource: Resource };
type DocumentWrite =
  | DocumentDuplication
  | z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_access_update>
  | z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_comments_apply>
  | z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_lifecycle>
  | DocumentCreation
  | z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_asset_upload>
  | DocumentApply
  | z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_history_restore>
  | z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_properties_update>;
const descriptions: Record<DocumentToolName, string> = {
  workspace_doc_duplicate:
    'Copy one authorized native resource at an explicit destination, including its metadata and optional comments. Requires source Copy permission and exact source content, metadata and comments versions. Local object IDs are retained in the new document namespace so opaque relationships survive; global comment IDs are remapped. Does not copy access grants or recursively copy referenced documents.',
  workspace_doc_access_read:
    'Read version-bound document sharing and members under Doc.Users.Read. Native Office and files inherit their directory access; they do not expose an independent document ACL.',
  workspace_doc_access_update:
    'Update explicit sharing, member roles, default role or ownership through the same domain service as UI. Requires its separate MCP capability and the live permission for the requested action. Self-revocation can succeed; its minimal immutable receipt remains available to the initiating credential family.',
  workspace_doc_comments_read:
    'Read threads or replies at content and comments versions. Continue each paginated collection with both returned versions. Anchors live in native content or Office comment content; body deletion leaves the thread intact.',
  workspace_doc_comments_apply:
    'Atomically create, edit, resolve, reopen, delete comments and replies, or reattach native anchors. Uses the same live permissions and author rules as the editor. Each batch binds content and comments versions; $clientRef refers to prior created threads or replies.',
  workspace_doc_lifecycle:
    'Trash, restore or permanently delete the explicit resource. Read workspace_doc_inspect with view lifecycle and the intended lifecycleAction first for its version. Descendants are affected only when includeDescendants is explicit; each resource retains its live lifecycle permissions.',
  workspace_doc_create_native:
    'Create one explicitly typed document at an authorized destination. BlockSuite commands may address initial $page, $note and $surface identities. Office and file content uses the native generator. Resource IDs are stable across retries; an existing ID is never overwritten.',
  workspace_doc_import:
    'Import an immutable Office/file upload or a native-bundle with its server export proof. A bundle restores native content, independent Office state, assets, metadata and comments into a stable new identity. Signed backups are bound to their Workspace. A different actor must retain current source Copy permission; unsigned raw Yjs updates are not accepted.',
  workspace_doc_asset_read:
    'Read a version-bound asset in bounded base64 chunks under live Blob and document permissions. Returns a complete SHA-256 fingerprint and byte count.',
  workspace_doc_asset_upload:
    'Stage an immutable asset using begin, numbered 512 KiB parts, then commit with SHA-256 verification; status resumes from exact received parts and abort discards staged bytes. Workspace staging accepts the endpoint Workspace ID with expectedVersion workspace-staging/v1, so a first import needs no placeholder document. Uploads expire after 24 hours and remain bound to the same resource, actor and credential family. Each step uses its own idempotency key. This does not insert the asset into content; use a typed asset command afterwards.',
  workspace_doc_properties_update:
    'Update explicitly named document metadata at both content and metadata versions. Native Office/files expose title and tags; BlockSuite exposes registered user properties. Does not modify creation evidence.',
  workspace_doc_history_list:
    'List immutable native content revisions under live resource permissions. Revisions belong to the explicit resource kind.',
  workspace_doc_history_read:
    'Read one immutable historical content revision as bounded base64 byte chunks. The returned fingerprint covers the complete content.',
  workspace_doc_history_restore:
    'Restore stored native content into the same resource at expectedVersion. Creates a new revision and retains audit history.',
  workspace_doc_export:
    'Export native-content or a native-bundle containing content, independent Office state, assets, metadata and comment evidence. Bundle chunks require the returned expectedBundleVersion after the first chunk; save the separate proof for restore. References remain references, ACL is not copied. additionalBlobIds explicitly includes opaque extension assets under live source copy permission.',
  workspace_doc_inspect:
    'Read version-bound native document structure. Continue with nextOffset and the returned expectedVersion. Unknown properties are read-only preservation data, never arbitrary write paths. Office state and files use ordered chunks; join every chunk before interpreting a complete resource.',
  workspace_doc_edit_preview:
    'Validate a native edit batch using the same planner as apply, without writing. This is optional, not an approval. Native commands preserve unrelated data; Markdown projections are not lossless replacements.',
  workspace_doc_apply:
    'Apply explicit native document edits atomically at expectedVersion. Uses live identity permissions and independently granted capability. Reuse the identical request and idempotencyKey after an uncertain response. Native text offsets are UTF-16 grapheme boundaries; $clientRef can reference earlier creates in the same batch.',
};
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function isBlockApply(
  request: DocumentApply
): request is Extract<DocumentApply, { resource: { kind: 'blocksuite' } }> {
  return request.resource.kind === 'blocksuite';
}
function isFileApply(
  request: DocumentApply
): request is Extract<DocumentApply, { resource: { kind: 'file' } }> {
  return request.resource.kind === 'file';
}

@Injectable()
export class McpDocumentsService {
  constructor(
    private readonly models: Models,
    private readonly resources: WorkspaceResourceService,
    private readonly native: WorkspaceNativeResourceService,
    private readonly access: WorkspaceNativeResourceAccess,
    private readonly office: OfficeArtifactService,
    private readonly commands: OfficeCommandService,
    private readonly config: Config,
    private readonly crypto: CryptoHelper,
    private readonly ac: PermissionAccess,
    private readonly organization: WorkspaceOrganizationService,
    private readonly properties: DocumentPropertiesService,
    private readonly assetStorage: OfficeResourceStorage,
    private readonly docWriter: DocWriter,
    private readonly pageTree: WorkspacePageTreeService,
    private readonly comments: McpDocumentCommentsService,
    private readonly documentAccess: DocumentAccessService,
    private readonly lifecycle: WorkspaceLifecycleService
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expireUploads() {
    await this.models.mcpDocumentUpload.expire();
  }

  private actor(credential: Credential) {
    return { workspaceId: credential.workspaceId, actorId: credential.userId };
  }
  private base(credential: Credential) {
    return {
      contractVersion: DOCUMENT_CONTRACT_VERSION,
      workspaceId: credential.workspaceId,
    };
  }
  private identity(
    credential: Credential,
    resource: Exclude<Resource, { kind: 'blocksuite' }>
  ) {
    if (resource.kind === 'blocksuite')
      throw new ResourceError('invalid_input');
    return {
      ...this.actor(credential),
      kind: resource.kind,
      resourceId: resource.id,
    };
  }
  private async authorize(
    credential: Credential,
    name: string,
    preview = false
  ) {
    const active = await this.models.mcpCredential.authenticate(
      credential.id,
      credential.workspaceId
    );
    if (
      !active ||
      active.userId !== credential.userId ||
      active.familyId !== credential.familyId ||
      !normalizeMcpCapabilities(active.capabilities, active.accessMode).some(
        capability => capability === name
      ) ||
      (!this.config.doc.mcpResourcesEnabled &&
        name !== 'workspace_operation_get') ||
      (!preview &&
        !this.config.doc.mcpDocumentEditingEnabled &&
        (MCP_DOCUMENT_WRITE_CAPABILITIES as readonly string[]).includes(name))
    )
      throw new ResourceError('capability_denied');
    await this.resources.assertWorkspace(this.actor(credential));
  }
  private failure(
    credential: Credential,
    name: string,
    error: ResourceError,
    operationId?: string
  ) {
    return DOCUMENT_FAILURE_SCHEMA.parse({
      ...this.base(credential),
      status: 'failed',
      toolName: name,
      operationId,
      writeOutcome: 'none',
      error: {
        code: error.code,
        stage: ['permission_denied', 'capability_denied'].includes(error.code)
          ? 'authorization'
          : [
                'version_conflict',
                'cursor_stale',
                'plan_stale',
                'idempotency_conflict',
              ].includes(error.code)
            ? 'concurrency'
            : error.code === 'preservation_failed'
              ? 'preservation'
              : error.code === 'temporarily_unavailable'
                ? 'availability'
                : 'validation',
        nextAction: ['permission_denied', 'capability_denied'].includes(
          error.code
        )
          ? 'request_access'
          : ['version_conflict', 'cursor_stale', 'plan_stale'].includes(
                error.code
              )
            ? 'refresh_resource'
            : error.code === 'temporarily_unavailable'
              ? 'retry_same_request'
              : ['content_too_large', 'quota_exceeded'].includes(error.code)
                ? 'reduce_request'
                : error.code === 'preservation_failed'
                  ? 'contact_support'
                  : 'correct_input',
        currentVersion: error.currentVersion,
        ...(error instanceof DocumentEditError ? { detail: error.detail } : {}),
      },
    });
  }
  private pending(credential: Credential, operation: McpResourceOperation) {
    return {
      ...this.base(credential),
      status:
        operation.status === 'needs_reconciliation'
          ? ('needs_reconciliation' as const)
          : ('processing' as const),
      operationId: operation.id,
      toolName: operation.toolName,
      writeOutcome: 'unknown' as const,
      pollAfterMs: 1000,
      replayed: true as const,
    };
  }
  tools(
    credential: Credential,
    capabilities: readonly string[]
  ): WorkspaceMcpToolDefinition[] {
    if (!this.config.doc.mcpResourcesEnabled) return [];
    return DOCUMENT_TOOL_NAMES.filter(
      name =>
        capabilities.includes(name) &&
        (this.config.doc.mcpDocumentEditingEnabled ||
          !(MCP_DOCUMENT_WRITE_CAPABILITIES as readonly string[]).includes(
            name
          ))
    ).map(name => ({
      name,
      title: name,
      description: descriptions[name],
      inputSchema: toToolJsonSchema(DOCUMENT_INPUT_SCHEMAS[name]),
      outputSchema: toToolJsonSchema(documentOutputSchema(name)),
      annotations: {
        readOnlyHint: ![
          'workspace_doc_access_update',
          'workspace_doc_comments_apply',
          'workspace_doc_apply',
          'workspace_doc_history_restore',
          'workspace_doc_properties_update',
          'workspace_doc_asset_upload',
          'workspace_doc_create_native',
          'workspace_doc_import',
          'workspace_doc_lifecycle',
          'workspace_doc_duplicate',
        ].includes(name),
        destructiveHint: [
          'workspace_doc_access_update',
          'workspace_doc_comments_apply',
          'workspace_doc_apply',
          'workspace_doc_history_restore',
          'workspace_doc_properties_update',
          'workspace_doc_asset_upload',
          'workspace_doc_create_native',
          'workspace_doc_import',
          'workspace_doc_lifecycle',
          'workspace_doc_duplicate',
        ].includes(name),
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async args => {
        const result = await this.execute(credential, name, args);
        return {
          isError: 'error' in result,
          content: [
            {
              type: 'text' as const,
              text:
                'error' in result
                  ? `LocalMind: ${result.error.code}`
                  : 'LocalMind native document operation completed.',
            },
          ],
          structuredContent: documentOutputSchema(name).parse({ result }),
        };
      },
    }));
  }
  unavailableToolResult(credential: Credential, name: string) {
    if (!DOCUMENT_TOOL_NAMES.some(tool => tool === name)) return undefined;
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: 'LocalMind: capability_denied' },
      ],
      structuredContent: {
        result: this.failure(
          credential,
          name,
          new ResourceError('capability_denied')
        ),
      },
    };
  }

  private async dependencies(
    credential: Credential,
    commands: unknown
  ): Promise<DocumentDependencies> {
    const requested = nativeDependencies(documentNativeBatch.parse(commands));
    const grants: DocumentDependencies & {
      versions: Record<string, string>;
      members: Set<string>;
    } = {
      assets: {},
      resources: new Set(),
      queryRows: new Set(),
      versions: {},
      members: new Set(),
    };
    const actor = this.actor(credential);
    for (const id of requested.members) {
      const member = await this.models.workspaceUser.get(
        credential.workspaceId,
        id
      );
      if (!member || member.status !== 'Accepted')
        throw new ResourceError('resource_not_found');
      grants.members.add(id);
      grants.versions[`member:${id}`] = fingerprint([
        member.id,
        member.status,
        member.type,
      ]);
    }
    for (const row of requested.queryRows) {
      const source = await this.resources.nativeSnapshot(actor, row.documentId);
      const block = inspectNativeDocument(source.bin).find(
        block => block.id === row.rowId
      );
      if (
        !block ||
        block.flavour !== 'affine:list' ||
        block.properties['type'] !== 'todo'
      )
        throw new ResourceError('resource_not_found');
      grants.queryRows?.add(`${row.documentId}:${row.rowId}`);
      grants.versions[`blocksuite:${row.documentId}`] = source.metadata.version;
    }
    for (const [key, target] of requested.resources) {
      if (target.kind === 'blocksuite')
        grants.versions[key] = (
          await this.resources.describe(actor, target.id)
        ).version;
      else if (target.kind === 'folder')
        grants.versions[key] = fingerprint(
          await this.organization.assertResourceFolder(
            credential.workspaceId,
            credential.userId,
            target.id,
            false
          )
        );
      else
        grants.versions[key] = fingerprint(
          await this.access.assert({
            ...actor,
            kind: target.kind,
            resourceId: target.id,
          })
        );
      grants.resources.add(key);
    }
    for (const key of requested.assets) {
      await this.ac
        .user(credential.userId)
        .workspace(credential.workspaceId)
        .assert('Workspace.Blobs.Read');
      await this.access.assertBlobRead({ ...actor, key });
      const stored = await this.models.blob.get(credential.workspaceId, key);
      if (!stored || stored.deletedAt || stored.status !== 'completed')
        throw new ResourceError('resource_not_found');
      grants.assets[key] = {
        size: stored.size,
        mimeType: stored.mime ?? 'application/octet-stream',
        url: `/api/workspaces/${encodeURIComponent(credential.workspaceId)}/blobs/${encodeURIComponent(key)}`,
      };
    }
    return grants;
  }

  private async current(credential: Credential, resource: Resource) {
    if (resource.kind === 'blocksuite')
      return this.resources.describe(this.actor(credential), resource.id);
    const record = await this.native.get(this.identity(credential, resource));
    return {
      title: record.title,
      version: `native:${record.metadataVersion}:${record.contentVersion}:${record.revisionId}`,
      record,
    };
  }
  private async inspect(
    credential: Credential,
    args: z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_inspect>
  ) {
    if (args.view === 'lifecycle') {
      const current = await this.lifecycleState(
        credential,
        args.resource,
        args.lifecycleAction
      );
      if (
        args.offset !== 0 ||
        (args.expectedVersion && current.version !== args.expectedVersion)
      )
        throw new ResourceError('version_conflict', current.version);
      return {
        ...this.base(credential),
        resource: args.resource,
        version: current.version,
        title: current.title,
        format: 'lifecycle/native' as const,
        items: [current],
        offset: 0,
        total: 1,
        nextOffset: null,
        coverage: 'native' as const,
        scopeCoverage: 'complete' as const,
        representationFidelity: 'native' as const,
        adapterVersion: 'native-adapters/1' as const,
        textCoordinates: 'utf16-grapheme-boundaries' as const,
        externalReferences: 'references-only' as const,
      };
    }
    const current = await this.current(credential, args.resource);
    if (
      (args.offset > 0 && !args.expectedVersion) ||
      (args.expectedVersion && args.expectedVersion !== current.version)
    )
      throw new ResourceError('version_conflict', current.version);
    let items: unknown[];
    let blocks: ReturnType<typeof inspectNativeDocument> | undefined;
    let format: 'blocksuite/native' | 'office/native' | 'file/base64';
    if (args.resource.kind === 'blocksuite') {
      blocks = (
        await this.resources.inspectNative(
          this.actor(credential),
          args.resource.id
        )
      ).blocks;
      items = blocks;
      format = 'blocksuite/native';
    } else {
      const bytes =
        args.resource.kind === 'file'
          ? (await this.native.read(this.identity(credential, args.resource)))
              .bytes
          : (
              await this.office.readRevisionLayoutState(
                credential.workspaceId,
                credential.userId,
                args.resource.id,
                (
                  await this.office.get(
                    credential.workspaceId,
                    credential.userId,
                    args.resource.id
                  )
                ).revision.id
              )
            ).bytes;
      format = args.resource.kind === 'file' ? 'file/base64' : 'office/native';
      // Chunks use base64 for both formats so multibyte characters cannot be
      // damaged at transport boundaries. Office state decodes to UTF-8 JSON.
      items = [];
      for (let offset = 0; offset < bytes.byteLength; offset += 32768)
        items.push({
          offset,
          encoding: 'base64',
          data: Buffer.from(bytes.subarray(offset, offset + 32768)).toString(
            'base64'
          ),
        });
    }
    const selected = items.slice(args.offset, args.offset + args.limit);
    const diagnostics = (blocks ?? [])
      .slice(args.offset, args.offset + args.limit)
      .flatMap(block =>
        !block.supported
          ? [
              {
                objectId: block.id,
                reason: 'unsupported_schema_version',
                field: undefined as string | undefined,
              },
            ]
          : Object.entries(block.capabilities.properties)
              .filter(([, capability]) => capability.kind === 'opaque')
              .map(([field]) => ({
                objectId: block.id,
                field,
                reason: 'opaque_field_preserved',
              }))
      );
    if (Buffer.byteLength(JSON.stringify(selected)) > 8 * 1024 * 1024)
      throw new ResourceError('content_too_large');
    return {
      ...this.base(credential),
      resource: args.resource,
      version: current.version,
      title: current.title,
      format,
      items: selected,
      offset: args.offset,
      total: items.length,
      nextOffset:
        args.offset + selected.length < items.length
          ? args.offset + selected.length
          : null,
      metadata:
        args.resource.kind === 'blocksuite'
          ? (await this.ac
              .user(credential.userId)
              .workspace(credential.workspaceId)
              .doc(args.resource.id)
              .projectScope(null)
              .can('Doc.Properties.Read'))
            ? await this.properties.read(
                this.actor(credential),
                args.resource.id
              )
            : undefined
          : 'record' in current
            ? {
                version: String(current.record.metadataVersion),
                title: current.record.title,
                tags: current.record.tags,
              }
            : undefined,
      coverage: 'native' as const,
      scopeCoverage:
        args.offset === 0 && selected.length === items.length
          ? ('complete' as const)
          : ('paginated' as const),
      representationFidelity:
        args.resource.kind === 'blocksuite'
          ? ('native-with-opaque-data' as const)
          : ('native' as const),
      adapterVersion: 'native-adapters/1' as const,
      adapterManifest:
        args.resource.kind === 'blocksuite'
          ? documentAdapterManifest()
          : documentFileAdapterManifest(args.resource.kind),
      diagnostics: {
        items: diagnostics.slice(0, 100),
        total: diagnostics.length,
        truncated: diagnostics.length > 100,
        scope: 'returned-page' as const,
      },
      textCoordinates: 'utf16-grapheme-boundaries' as const,
      externalReferences: 'references-only' as const,
    };
  }

  private async edit(
    credential: Credential,
    request: DocumentApply,
    operationId: string,
    preview: boolean
  ) {
    const actor = this.actor(credential);
    const stableOperationId = fingerprint([
      credential.workspaceId,
      credential.userId,
      credential.familyId,
      request.idempotencyKey,
    ]);
    // Validate every participating domain before preparing external Office/file bytes.
    // Actual writes and the durable receipt share the caller's database transaction.
    const metadataPlan = request.metadata
      ? await this.updateProperties(
          credential,
          {
            resource: request.resource,
            expectedVersion: request.expectedVersion,
            idempotencyKey: request.idempotencyKey,
            ...request.metadata,
          },
          true
        )
      : undefined;
    const candidate =
      request.comments && isBlockApply(request)
        ? await this.resources.previewNativeContent(actor, {
            documentId: request.resource.id,
            expectedVersion: request.expectedVersion,
            commands: request.commands,
            operationId: stableOperationId,
            dependencies: await this.dependencies(credential, request.commands),
          })
        : undefined;
    const commentsPlan = request.comments
      ? await this.comments.apply(
          actor,
          {
            resource: request.resource,
            expectedVersion: request.expectedVersion,
            ...request.comments,
          },
          stableOperationId,
          () =>
            this.authorize(credential, 'workspace_doc_comments_apply', true),
          {
            preview: true,
            nativeContent: candidate?.bin,
            initialReferences: candidate?.identities,
          }
        )
      : undefined;
    const result = await this.editContent(
      credential,
      request,
      operationId,
      preview
    );
    let metadata = metadataPlan,
      comments = commentsPlan;
    if (!preview) {
      if (request.metadata)
        metadata = await this.updateProperties(credential, {
          resource: request.resource,
          expectedVersion: (await this.current(credential, request.resource))
            .version,
          idempotencyKey: request.idempotencyKey,
          ...request.metadata,
        });
      if (request.comments)
        comments = await this.comments.apply(
          actor,
          {
            resource: request.resource,
            expectedVersion: (await this.current(credential, request.resource))
              .version,
            ...request.comments,
          },
          stableOperationId,
          () => this.authorize(credential, 'workspace_doc_comments_apply'),
          {
            initialReferences: result.identities,
          }
        );
    }
    return {
      ...result,
      changed: result.changed || !!metadata?.changed || !!comments?.changed,
      changedIds: [
        ...new Set([
          ...result.changedIds,
          ...(metadata?.changedIds ?? []),
          ...(comments?.changedIds ?? []),
        ]),
      ],
      afterVersion: preview
        ? result.beforeVersion
        : (await this.current(credential, request.resource)).version,
      ...(metadata ? { metadataVersion: metadata.metadataVersion } : {}),
      ...(comments
        ? {
            commentsVersion: comments.commentsVersion,
            identities: {
              ...result.identities,
              ...Object.fromEntries(
                Object.entries(comments.identities).map(([key, value]) => [
                  `comment:${key}`,
                  value,
                ])
              ),
            },
          }
        : {}),
    };
  }

  private async editContent(
    credential: Credential,
    request: DocumentApply,
    operationId: string,
    preview: boolean
  ) {
    const authorize = () =>
      this.authorize(
        credential,
        preview ? 'workspace_doc_edit_preview' : 'workspace_doc_apply'
      );
    await authorize();
    const dependencies = isBlockApply(request)
      ? await this.dependencies(credential, request.commands)
      : undefined;
    const digest = fingerprint([
      DOCUMENT_CONTRACT_VERSION,
      'native-adapters/1',
      dependencies
        ? {
            assets: dependencies.assets,
            resources: [...dependencies.resources].sort(),
            queryRows: [...(dependencies.queryRows ?? [])].sort(),
            versions: dependencies.versions,
            members: [...(dependencies.members ?? [])].sort(),
          }
        : null,
      request.resource,
      request.expectedVersion,
      'batch' in request ? request.batch : request.commands,
      request.metadata ?? null,
      request.comments ?? null,
      request.idempotencyKey,
    ]);
    if (request.planDigest && request.planDigest !== digest)
      throw new ResourceError('plan_stale');
    if (isBlockApply(request)) {
      const result = await this.resources.editNative(
        this.actor(credential),
        {
          documentId: request.resource.id,
          expectedVersion: request.expectedVersion,
          commands: request.commands,
          operationId: fingerprint([
            credential.workspaceId,
            credential.userId,
            credential.familyId,
            request.idempotencyKey,
          ]),
          preview,
          dependencies,
        },
        authorize
      );
      return {
        ...result,
        resource: request.resource,
        digest,
        identities: result.identities,
      };
    }
    const identity = this.identity(credential, request.resource);
    return this.access.write(identity, async () => {
      const current = await this.current(credential, request.resource);
      if (current.version !== request.expectedVersion)
        throw new ResourceError('version_conflict', current.version);
      if (!('record' in current)) throw new ResourceError('invalid_input');
      let changed = true;
      if (request.resource.kind === 'office' && 'batch' in request) {
        if (
          request.batch.artifactId !== request.resource.id ||
          request.batch.source !== 'user' ||
          request.batch.expectedRevisionId !== current.record.revisionId
        )
          throw new ResourceError('invalid_input');
        const batch = {
          ...request.batch,
          idempotencyKey: `mcp:${operationId}`,
        };
        const input = { ...this.actor(credential), batch };
        const prepared = await this.commands.previewBatch(input);
        changed =
          prepared.packageFingerprint !==
            prepared.revision.packageFingerprint ||
          prepared.stateFingerprint !== prepared.revision.stateFingerprint;
        if (changed && !preview) {
          const commit = await this.commands.prepareBatchExecution(input);
          await authorize();
          await commit();
        }
      } else if (isFileApply(request)) {
        const commands = request.commands;
        const ids = new Set(commands.map(command => command.opId));
        if (ids.size !== commands.length)
          throw new ResourceError('invalid_input');
        if (commands.length === 1 && commands[0].type === 'file.replace') {
          const replacement = {
            ...identity,
            blobKey: commands[0].blobId,
            expectedContentVersion: current.record.contentVersion,
            requestKey: `mcp:${operationId}`,
          };
          changed = (await this.native.previewSave(replacement)).changed;
          if (changed && !preview) {
            await authorize();
            await this.native.save(replacement);
          }
        } else {
          const previous = await this.native.readText(identity);
          const text = editDocumentFile(
            previous.text,
            previous.mimeType,
            commands
          );
          changed = text !== previous.text;
          if (changed && !preview) {
            await authorize();
            await this.native.save({
              ...identity,
              text,
              expectedContentVersion: current.record.contentVersion,
              requestKey: `mcp:${operationId}`,
            });
          }
        }
      } else throw new ResourceError('invalid_input');
      return {
        resource: request.resource,
        beforeVersion: current.version,
        afterVersion:
          preview || !changed
            ? current.version
            : (await this.current(credential, request.resource)).version,
        changed,
        changedIds: changed ? [request.resource.id] : [],
        identities: {},
        preservationVerified: true as const,
        preservation: {
          checks:
            request.resource.kind === 'office'
              ? [
                  'native_engine_constraints',
                  'independent_state_merge',
                  'immutable_revision',
                ]
              : [
                  'typed_file_edit_or_explicit_replacement',
                  'immutable_revision',
                ],
        },
        digest,
      };
    });
  }

  private async lifecycleState(
    credential: Credential,
    resource: Resource,
    action: 'trash' | 'restore' | 'delete'
  ) {
    const actor = this.actor(credential);
    const tree = await this.models.workspacePageTree.state(
      credential.workspaceId
    );
    if (tree?.phase === 'switched') {
      const nodeId = pageTreeNodeId({
        kind: resource.kind === 'blocksuite' ? 'doc' : resource.kind,
        resourceId: resource.id,
      });
      const preview = await this.pageTree.lifecyclePreview(
        actor,
        nodeId,
        action
      );
      return {
        protocol: 'page-tree' as const,
        title: preview.items.find(item => item.nodeId === nodeId)?.title ?? '',
        version: `lifecycle:${fingerprint([resource, action, preview])}`,
        nodeId,
        preview,
      };
    }
    if (resource.kind === 'blocksuite') {
      const value = await this.lifecycle.get({
        ...actor,
        resourceId: resource.id,
        kind: 'doc',
      });
      return {
        protocol: 'legacy-doc' as const,
        title: value.title,
        version: `lifecycle:${value.version}`,
        value,
      };
    }
    const value = await this.native.get(
      this.identity(credential, resource),
      true
    );
    return {
      protocol: 'legacy-native' as const,
      title: value.title,
      version: `lifecycle:${value.metadataVersion}`,
      value,
    };
  }

  private async changeLifecycle(
    credential: Credential,
    request: z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_lifecycle>
  ) {
    const current = await this.lifecycleState(
      credential,
      request.resource,
      request.action
    );
    if (current.version !== request.expectedVersion)
      throw new ResourceError('version_conflict', current.version);
    const actor = this.actor(credential),
      requestKey = `mcp:lifecycle:${fingerprint([credential.familyId, request.idempotencyKey])}`;
    await this.authorize(credential, 'workspace_doc_lifecycle');
    let after: unknown;
    if (current.protocol === 'page-tree') {
      if (current.preview.total > 1 && !request.includeDescendants)
        throw new DocumentEditError('invalid_input', {
          reason: 'descendant_lifecycle_not_requested',
        });
      after = await this.pageTree.execute(actor, {
        action: request.action,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: current.preview.revision,
        expectedAuthorizationRevision: current.preview.authorizationRevision,
        requestKey,
        nodeId: current.nodeId,
      });
    } else if (current.protocol === 'legacy-doc') {
      after = await this.lifecycle.change({
        ...actor,
        resourceId: request.resource.id,
        kind: 'doc',
        action: request.action,
        expectedVersion: current.value.version,
        requestKey,
      });
    } else {
      after = await this.native.change({
        ...this.identity(credential, request.resource),
        action: request.action,
        expectedVersion: current.value.metadataVersion,
        requestKey,
      });
    }
    const lifecycle =
      request.action === 'delete'
        ? ('deleted' as const)
        : request.action === 'trash'
          ? ('trashed' as const)
          : ('active' as const);
    return {
      resource: request.resource,
      beforeVersion: current.version,
      afterVersion: `lifecycle:${fingerprint(after)}`,
      changed: true,
      changedIds: [request.resource.id],
      identities: {},
      digest: fingerprint(request),
      lifecycle,
    };
  }

  private duplicationRequest(
    credential: Credential,
    args: unknown
  ): DocumentDuplication {
    const request = DOCUMENT_INPUT_SCHEMAS.workspace_doc_duplicate.parse(args);
    const id =
      request.targetId ??
      `mcp-${fingerprint([credential.workspaceId, credential.userId, credential.familyId, 'workspace_doc_duplicate', request.idempotencyKey]).slice(0, 40)}`;
    if (id === request.source.id) throw new ResourceError('invalid_input');
    return { ...request, resource: { kind: request.source.kind, id } };
  }

  private async duplicateResource(
    credential: Credential,
    request: DocumentDuplication,
    operationId: string
  ) {
    const actor = this.actor(credential),
      model = this.models.documentComments;
    const authorize = () =>
      this.authorize(credential, 'workspace_doc_duplicate');
    if (request.source.kind === 'blocksuite')
      await this.models.mcpResourceOperation.lockAuthority({
        ...actor,
        credentialId: credential.id,
        documentId: request.source.id,
      });
    const current = await this.current(credential, request.source);
    if (current.version !== request.expectedVersion)
      throw new ResourceError('version_conflict', current.version);
    const snapshot =
      request.comments === 'copy' && request.source.kind !== 'file'
        ? await this.comments.copySnapshot(
            actor,
            request.source,
            request.expectedCommentsVersion
          )
        : undefined;
    if (request.comments === 'copy' && request.source.kind === 'file')
      throw new DocumentEditError('invalid_input', {
        reason: 'file_has_no_comment_model',
      });
    const commentIds = snapshot
      ? model.copyIdentities(snapshot, operationId)
      : new Map<string, string>();
    let identities: Record<string, string> = {};
    let metadataVersion: string;
    if (request.source.kind === 'blocksuite') {
      await this.ac
        .user(credential.userId)
        .workspace(credential.workspaceId)
        .doc(request.source.id)
        .projectScope(null)
        .assert('Doc.Copy');
      const metadata = await this.properties.read(actor, request.source.id);
      if (metadata.version !== request.expectedMetadataVersion)
        throw new ResourceError('version_conflict', metadata.version);
      metadataVersion = metadata.version;
      const original = await this.resources.nativeSnapshot(
        actor,
        request.source.id
      );
      let assets: string[];
      try {
        assets = nativeDocumentAssets(original.bin, actor.workspaceId);
      } catch {
        throw new ResourceError('unsupported_document_structure');
      }
      for (const key of assets) await this.assertAssetCopy(credential, key);
      const prepared = copyNativeDocument({
        bin: original.bin,
        sourceId: request.source.id,
        targetId: request.resource.id,
        title: request.title,
        comments: commentIds,
      });
      if (Object.keys(prepared.identities).length + commentIds.size > 10000)
        throw new ResourceError('content_too_large');
      const created = await this.createResource(
        credential,
        {
          resource: { kind: 'blocksuite', id: request.resource.id },
          title: request.title,
          destination: request.destination,
          idempotencyKey: request.idempotencyKey,
          primaryMode:
            metadata.properties.primaryMode === 'edgeless'
              ? 'edgeless'
              : 'page',
        },
        'workspace_doc_duplicate',
        prepared
      );
      identities = created.identities;
      const fields = Object.fromEntries(
        Object.entries(metadata.properties).filter(
          ([key]) =>
            ![
              'id',
              '$$DELETED',
              'createdBy',
              'updatedBy',
              'createdAt',
              'updatedAt',
            ].includes(key)
        )
      );
      if (Object.keys(fields).length)
        await this.organization.applyDataOperations(
          actor.workspaceId,
          actor.actorId,
          actor.actorId,
          'document_properties',
          [{ op: 'upsert', key: request.resource.id, values: fields }]
        );
      if (metadata.icon !== null)
        await this.organization.applyDataOperations(
          actor.workspaceId,
          actor.actorId,
          actor.actorId,
          'explorer_icons',
          [
            {
              op: 'upsert',
              key: `doc:${request.resource.id}`,
              values: { icon: metadata.icon },
            },
          ]
        );
      if (metadata.tags.length)
        await this.organization.applyRootOperations(
          actor.workspaceId,
          actor.actorId,
          [
            {
              op: 'set_document_tags',
              docId: request.resource.id,
              tagIds: metadata.tags,
            },
          ]
        );
    } else {
      if (!('record' in current) || !current.record.canCopy)
        throw new ResourceError('permission_denied');
      metadataVersion = String(current.record.metadataVersion);
      if (
        request.expectedMetadataVersion !== undefined &&
        request.expectedMetadataVersion !== metadataVersion
      )
        throw new ResourceError('version_conflict', metadataVersion);
      const destination = request.destination;
      const created = await this.native.copy({
        ...this.identity(credential, request.source),
        targetResourceId: request.resource.id,
        title: request.title,
        expectedContentVersion: current.record.contentVersion,
        requestKey: `mcp:duplicate:${operationId}`,
        ...(destination.kind === 'legacy-folder'
          ? { folderId: destination.folderId }
          : {
              treeContractVersion: destination.contractVersion,
              parentNodeId: destination.parentNodeId,
              expectedTreeRevision: destination.expectedRevision,
              expectedAuthorizationRevision:
                destination.expectedAuthorizationRevision,
            }),
      });
      if (current.record.tagIds.length)
        await this.native.setTags({
          ...this.identity(credential, request.resource),
          expectedVersion: created.metadataVersion,
          requestKey: `mcp:duplicate:tags:${operationId}`,
          tagIds: current.record.tagIds,
        });
    }
    if (snapshot && request.resource.kind !== 'file') {
      const revision =
        request.resource.kind === 'office'
          ? await this.office.getRevision(
              actor.workspaceId,
              actor.actorId,
              request.resource.id
            )
          : undefined;
      await model.copyInto(
        {
          workspaceId: actor.workspaceId,
          resourceId: request.resource.id,
          kind: request.resource.kind,
        },
        snapshot,
        commentIds,
        revision?.id,
        await this.comments.copyAttachments(
          actor,
          request.source.id,
          request.resource.id,
          snapshot.attachments
        )
      );
      if (revision && 'record' in current)
        identities[`revision:${current.record.revisionId}`] = revision.id;
    }
    await authorize();
    return {
      resource: request.resource,
      source: {
        resource: request.source,
        version: current.version,
        metadataVersion,
        commentsVersion: snapshot?.version,
        identityScope: 'document' as const,
      },
      beforeVersion: 'absent',
      afterVersion: (await this.current(credential, request.resource)).version,
      changed: true,
      changedIds: [request.resource.id],
      identities: {
        ...identities,
        ...Object.fromEntries(
          [...commentIds].map(([source, target]) => [
            `comment:${source}`,
            target,
          ])
        ),
      },
      digest: fingerprint(request),
    };
  }

  private creationRequest(
    credential: Credential,
    name: 'workspace_doc_create_native' | 'workspace_doc_import',
    args: unknown
  ): DocumentCreation {
    const request =
      name === 'workspace_doc_create_native'
        ? DOCUMENT_INPUT_SCHEMAS.workspace_doc_create_native.parse(args)
        : DOCUMENT_INPUT_SCHEMAS.workspace_doc_import.parse(args);
    const id =
      request.resource.id ??
      `mcp-${fingerprint([credential.workspaceId, credential.userId, credential.familyId, name, request.idempotencyKey]).slice(0, 40)}`;
    if ('primaryMode' in request)
      return { ...request, resource: { kind: 'blocksuite', id } };
    if ('format' in request)
      return { ...request, resource: { ...request.resource, id } };
    return { ...request, resource: { kind: request.resource.kind, id } };
  }

  private async createResource(
    credential: Credential,
    request: DocumentCreation,
    toolName:
      | 'workspace_doc_create_native'
      | 'workspace_doc_import'
      | 'workspace_doc_duplicate',
    prepared?: { bin: Uint8Array; identities: Record<string, string> },
    trustedState?: { bytes: Buffer; modelVersion: string }
  ): Promise<{
    resource: Resource;
    beforeVersion: string;
    afterVersion: string;
    changed: boolean;
    changedIds: string[];
    identities: Record<string, string>;
    digest: string;
    archive?: {
      fingerprint: string;
      blobId: string;
      identityScope: 'document';
    };
  }> {
    if ('format' in request && request.format === 'native-bundle' && !prepared)
      return this.restoreBundle(credential, request);
    const actor = this.actor(credential),
      id = request.resource.id;
    const authorize = async () => {
      await this.authorize(credential, toolName);
      await this.resources.assertWorkspace(actor, 'Workspace.CreateDoc');
    };
    await authorize();
    const destination = request.destination;
    const key = `mcp:create:${fingerprint([credential.familyId, toolName, request.idempotencyKey])}`;
    let identities: Record<string, string> = {};
    if (request.resource.kind === 'blocksuite' && 'primaryMode' in request) {
      const created =
        prepared ??
        createNativeDocument({
          title: request.title,
          documentId: id,
          actorId: credential.userId,
          operationId: key,
          commands: request.commands,
          dependencies: request.commands
            ? await this.dependencies(credential, request.commands)
            : undefined,
        });
      identities = created.identities;
      const create = async () => {
        await this.docWriter.createDocFromSnapshot(
          credential.workspaceId,
          request.title,
          created.bin,
          credential.userId,
          id,
          authorize
        );
      };
      if (destination.kind === 'page-tree') {
        await this.pageTree.execute(
          actor,
          {
            action: 'create',
            contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
            expectedRevision: destination.expectedRevision,
            expectedAuthorizationRevision:
              destination.expectedAuthorizationRevision,
            requestKey: key,
            parentNodeId: destination.parentNodeId,
            title: request.title,
            primaryMode: request.primaryMode,
            resourceId: id,
            contentFingerprint: fingerprint(request),
          },
          undefined,
          create
        );
      } else {
        const state = await this.models.workspacePageTree.state(
          credential.workspaceId
        );
        if (state && !['preflight', 'needs_resolution'].includes(state.phase))
          throw new ResourceError('invalid_input');
        await this.resources.assertWorkspace(actor, 'Workspace.Sync');
        await this.organization.assertResourceFolder(
          credential.workspaceId,
          credential.userId,
          destination.folderId,
          true
        );
        await create();
        await this.models.doc.upsertMeta(credential.workspaceId, id, {
          title: request.title,
        });
        await this.models.docUser.setOwner(
          credential.workspaceId,
          id,
          credential.userId
        );
        if (request.primaryMode === 'edgeless')
          await this.organization.applyDataOperations(
            credential.workspaceId,
            credential.userId,
            credential.userId,
            'document_properties',
            [{ op: 'upsert', key: id, values: { primaryMode: 'edgeless' } }]
          );
        await this.organization.moveResourceDocument({
          ...actor,
          documentId: id,
          folderId: destination.folderId,
          authorize,
        });
      }
    } else if ('content' in request || 'blobId' in request) {
      if (
        request.resource.kind === 'office' &&
        ('content' in request
          ? !['docx', 'xlsx', 'pptx', 'pdf'].includes(request.content.format)
          : !/\.(docx|xlsx|pptx|pdf)$/i.test(request.title))
      )
        throw new ResourceError('invalid_input');
      if ('blobId' in request) {
        await this.ac
          .user(credential.userId)
          .workspace(credential.workspaceId)
          .assert('Workspace.Blobs.Read');
        await this.access.assertBlobRead({ ...actor, key: request.blobId });
      }
      const created = await this.native.create({
        ...actor,
        resourceId: id,
        fileOnly: request.resource.kind === 'file',
        title: request.title,
        requestKey: key,
        origin: toolName === 'workspace_doc_import' ? 'import' : 'user',
        trustedState,
        ...('content' in request
          ? { content: request.content }
          : { blobKey: request.blobId }),
        ...(destination.kind === 'legacy-folder'
          ? { folderId: destination.folderId }
          : {
              treeContractVersion: destination.contractVersion,
              parentNodeId: destination.parentNodeId,
              expectedTreeRevision: destination.expectedRevision,
              expectedAuthorizationRevision:
                destination.expectedAuthorizationRevision,
            }),
      });
      if (created.id !== id || created.kind !== request.resource.kind)
        throw new ResourceError('invalid_input');
    } else throw new ResourceError('invalid_input');
    await authorize();
    return {
      resource: request.resource,
      beforeVersion: 'absent',
      afterVersion: (await this.current(credential, request.resource)).version,
      changed: true,
      changedIds: [id, ...Object.values(identities)],
      identities,
      digest: fingerprint(request),
    };
  }

  private async assertAssetCopy(credential: Credential, key: string) {
    await this.access.assertBlobRead({ ...this.actor(credential), key });
    const references = await this.models.workspaceNativeResource.blobResources(
      credential.workspaceId,
      key
    );
    if (!references.length) return;
    for (const reference of references) {
      try {
        const record = await this.native.get({
          ...this.actor(credential),
          resourceId: reference.id,
          kind: reference.kind,
        });
        if (record.canCopy) return;
      } catch (error) {
        if (!(error instanceof NotFound) && !(error instanceof ResourceError))
          throw error;
      }
    }
    throw new ResourceError('permission_denied');
  }

  private async readAsset(
    credential: Credential,
    request: z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_asset_read>
  ) {
    const current = await this.current(credential, request.resource);
    if (current.version !== request.expectedVersion)
      throw new ResourceError('version_conflict', current.version);
    await this.ac
      .user(credential.userId)
      .workspace(credential.workspaceId)
      .assert('Workspace.Blobs.Read');
    if (request.resource.kind === 'blocksuite')
      await this.ac
        .user(credential.userId)
        .workspace(credential.workspaceId)
        .doc(request.resource.id)
        .projectScope(null)
        .assert('Doc.Copy');
    else if ('record' in current && !current.record.canCopy)
      throw new ResourceError('permission_denied');
    await this.assertAssetCopy(credential, request.blobId);
    const record = await this.models.blob.get(
      credential.workspaceId,
      request.blobId
    );
    if (!record || record.deletedAt || record.status !== 'completed')
      throw new ResourceError('resource_not_found');
    const stored = await this.assetStorage.get(
      credential.workspaceId,
      credential.userId,
      request.blobId
    );
    if (!stored.body) throw new ResourceError('resource_not_found');
    const bytes = await readBufferWithLimit(stored.body, 32 * 1024 * 1024);
    if (request.offset > bytes.length) throw new ResourceError('invalid_input');
    const end = Math.min(bytes.length, request.offset + request.limit);
    return {
      ...this.base(credential),
      resource: request.resource,
      version: current.version,
      data: {
        blobId: request.blobId,
        mimeType: record.mime,
        totalBytes: bytes.length,
        fingerprint: createHash('sha256').update(bytes).digest('hex'),
        offset: request.offset,
        nextOffset: end < bytes.length ? end : null,
        base64: bytes.subarray(request.offset, end).toString('base64'),
      },
    };
  }

  private async uploadAsset(
    credential: Credential,
    request: z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_asset_upload>,
    operation: McpResourceOperation
  ) {
    const authorize = async () => {
      await this.authorize(credential, 'workspace_doc_asset_upload');
      await this.ac
        .user(credential.userId)
        .workspace(credential.workspaceId)
        .assert('Workspace.Blobs.Write');
      if (request.resource.kind === 'workspace') {
        if (request.resource.id !== credential.workspaceId)
          throw new ResourceError('invalid_input');
        await this.resources.assertWorkspace(
          this.actor(credential),
          'Workspace.CreateDoc'
        );
      } else if (request.resource.kind === 'blocksuite')
        await this.resources.assertDocument(
          this.actor(credential),
          request.resource.id,
          true
        );
      else
        await this.access.assert(this.identity(credential, request.resource), {
          write: true,
        });
    };
    await authorize();
    const current =
      request.resource.kind === 'workspace'
        ? { version: 'workspace-staging/v1' }
        : await this.current(credential, request.resource);
    if (current.version !== request.expectedVersion)
      throw new ResourceError('version_conflict', current.version);
    const command = request.upload,
      model = this.models.mcpDocumentUpload;
    let changed = true;
    let result: z.infer<typeof documentUploadResult>;
    if (command.action === 'begin') {
      const { action: _, ...manifest } = command;
      const upload = await model.begin(operation, manifest);
      result = {
        uploadId: upload.id,
        status: 'pending',
        receivedBytes: 0,
        ...manifest,
        partBytes: MCP_UPLOAD_PART_BYTES,
        receivedParts: [],
      };
    } else {
      const upload = await model.lock(command.uploadId, operation);
      if (!['pending', 'completed', 'aborted'].includes(upload.status))
        throw new ResourceError('invalid_input');
      let status = upload.status as 'pending' | 'completed' | 'aborted',
        blobId = upload.blobId ?? undefined;
      let parts = upload.parts;
      if (command.action === 'part') {
        const bytes = Buffer.from(command.base64, 'base64');
        if (bytes.toString('base64') !== command.base64)
          throw new ResourceError('invalid_input');
        changed = await model.part(upload, command.number, bytes);
        if (changed)
          parts = [
            ...parts,
            { uploadId: upload.id, number: command.number, bytes },
          ];
      } else if (command.action === 'abort') {
        if (status === 'completed') throw new ResourceError('invalid_input');
        changed = status !== 'aborted';
        if (changed) await model.finish(upload.id, 'aborted');
        status = 'aborted';
        parts = [];
      } else if (command.action === 'status') {
        changed = false;
      } else {
        if (status === 'aborted') throw new ResourceError('invalid_input');
        changed = status !== 'completed';
        if (changed) {
          if (
            parts.length !==
              Math.ceil(upload.totalBytes / MCP_UPLOAD_PART_BYTES) ||
            parts.some((part, index) => part.number !== index)
          )
            throw new ResourceError('invalid_input');
          const bytes = Buffer.concat(
            parts.map(part => Buffer.from(part.bytes))
          );
          if (
            bytes.length !== upload.totalBytes ||
            createHash('sha256').update(bytes).digest('hex') !==
              upload.fingerprint
          )
            throw new ResourceError('invalid_input');
          const detected = sniffMime(bytes);
          if (
            detected &&
            upload.mimeType !== 'application/octet-stream' &&
            detected !== upload.mimeType &&
            !(
              detected === 'application/zip' &&
              upload.mimeType.startsWith(
                'application/vnd.openxmlformats-officedocument.'
              )
            )
          )
            throw new ResourceError('invalid_input');
          if (
            upload.mimeType.startsWith('text/') ||
            upload.mimeType === 'application/json'
          ) {
            try {
              new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            } catch {
              throw new ResourceError('invalid_input');
            }
          }
          blobId = await this.assetStorage.putGenerated(
            credential.workspaceId,
            credential.userId,
            bytes,
            upload.mimeType,
            authorize
          );
          await model.finish(upload.id, 'completed', blobId);
        }
        status = 'completed';
      }
      result = {
        uploadId: upload.id,
        status,
        receivedBytes:
          status === 'completed'
            ? upload.totalBytes
            : parts.reduce((size, part) => size + part.bytes.length, 0),
        totalBytes: upload.totalBytes,
        mimeType: upload.mimeType,
        fingerprint: upload.fingerprint,
        partBytes: MCP_UPLOAD_PART_BYTES,
        receivedParts: parts.map(part => part.number).sort((a, b) => a - b),
        blobId,
      };
    }
    await authorize();
    return {
      resource: request.resource,
      beforeVersion: current.version,
      afterVersion: current.version,
      changed,
      changedIds: [],
      identities: {},
      digest: fingerprint(request),
      upload: documentUploadResult.parse(result),
    };
  }

  private async readContent(
    credential: Credential,
    resource: Resource,
    revision?: number
  ) {
    if (resource.kind === 'blocksuite') {
      await this.resources.assertDocument(this.actor(credential), resource.id);
      if (revision === undefined)
        return Buffer.from(
          (
            await this.resources.nativeSnapshot(
              this.actor(credential),
              resource.id
            )
          ).bin
        );
      const history = await this.models.history.get(
        credential.workspaceId,
        resource.id,
        revision
      );
      if (!history) throw new ResourceError('resource_not_found');
      return Buffer.from(history.blob);
    }
    const identity = this.identity(credential, resource);
    await this.access.assert(identity);
    if (resource.kind === 'file')
      return (await this.native.read({ ...identity, sequence: revision }))
        .bytes;
    const record =
      revision === undefined
        ? await this.office.getRevision(
            credential.workspaceId,
            credential.userId,
            resource.id
          )
        : await this.models.officeArtifact.getRevisionBySequence(
            credential.workspaceId,
            resource.id,
            revision
          );
    if (!record) throw new ResourceError('resource_not_found');
    return (
      await this.office.readRevisionAsset(
        credential.workspaceId,
        credential.userId,
        resource.id,
        record.id,
        'package'
      )
    ).bytes;
  }

  private async exportBundle(
    credential: Credential,
    request: z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_export>,
    current: Awaited<ReturnType<McpDocumentsService['current']>>
  ) {
    const actor = this.actor(credential),
      resource = request.resource;
    const content = await this.readContent(credential, resource);
    const metadata =
      resource.kind === 'blocksuite'
        ? await this.properties.read(actor, resource.id)
        : {
            version: String(
              'record' in current ? current.record.metadataVersion : ''
            ),
            properties: {},
            icon: null,
            tags: 'record' in current ? current.record.tagIds : [],
            definitions: [],
          };
    const snapshot =
      resource.kind !== 'file'
        ? await this.models.documentComments.copySnapshot({
            workspaceId: actor.workspaceId,
            kind: resource.kind,
            resourceId: resource.id,
          })
        : undefined;
    if (snapshot) await this.comments.assertRead(actor, resource);
    const assets: DocumentArchive['assets'] = [];
    const keys = new Set([
      ...(resource.kind === 'blocksuite'
        ? nativeDocumentAssets(content, actor.workspaceId)
        : []),
      ...request.additionalBlobIds,
    ]);
    let total = content.length;
    for (const key of [...keys].sort()) {
      await this.ac
        .user(actor.actorId)
        .workspace(actor.workspaceId)
        .assert('Workspace.Blobs.Read');
      await this.assertAssetCopy(credential, key);
      const record = await this.models.blob.get(actor.workspaceId, key);
      if (!record || record.deletedAt || record.status !== 'completed')
        throw new ResourceError('resource_not_found');
      const stored = await this.assetStorage.get(
        actor.workspaceId,
        actor.actorId,
        key
      );
      if (!stored.body) throw new ResourceError('resource_not_found');
      const bytes = await readBufferWithLimit(
        stored.body,
        DOCUMENT_ARCHIVE_LIMIT
      );
      total += bytes.length;
      if (total > DOCUMENT_ARCHIVE_LIMIT)
        throw new ResourceError('content_too_large');
      assets.push({ key, mimeType: record.mime, ...archiveBinary(bytes) });
    }
    let officeState: DocumentArchive['officeState'];
    if (resource.kind === 'office') {
      const revision = await this.office.getRevision(
        actor.workspaceId,
        actor.actorId,
        resource.id
      );
      const state = await this.office.readRevisionAsset(
        actor.workspaceId,
        actor.actorId,
        resource.id,
        revision.id,
        'state'
      );
      officeState = {
        ...archiveBinary(state.bytes),
        modelVersion: revision.modelVersion,
      };
    }
    const bytes = encodeDocumentArchive(
      documentArchive.parse({
        format: DOCUMENT_ARCHIVE_FORMAT,
        source: {
          workspaceId: actor.workspaceId,
          actorId: actor.actorId,
          resource,
          version: current.version,
          title: current.title,
          metadataVersion: metadata.version,
        },
        content: {
          ...archiveBinary(content),
          mimeType:
            resource.kind === 'blocksuite'
              ? 'application/vnd.localmind.blocksuite+yjs'
              : 'record' in current
                ? current.record.mimeType
                : 'application/octet-stream',
        },
        officeState,
        metadata: {
          properties: metadata.properties,
          icon: metadata.icon,
          tags: metadata.tags,
          definitions: metadata.definitions,
          tagDefinitions: (
            await this.organization.resourceTagDefinitions(actor.workspaceId)
          ).filter(tag => metadata.tags.includes(tag.id)),
        },
        comments: snapshot
          ? documentArchiveComments.parse(snapshot)
          : undefined,
        assets,
        commentAssets: snapshot
          ? await this.comments.exportAttachments(actor, resource.id, snapshot)
          : [],
        externalReferences: 'references-only',
      })
    );
    const version = archiveFingerprint(bytes);
    if (
      (request.offset > 0 && !request.expectedBundleVersion) ||
      (request.expectedBundleVersion &&
        request.expectedBundleVersion !== version)
    )
      throw new ResourceError('cursor_stale', version);
    if (request.offset > bytes.length) throw new ResourceError('invalid_input');
    const end = Math.min(bytes.length, request.offset + request.limit);
    return {
      ...this.base(credential),
      resource,
      version: current.version,
      data: {
        format: DOCUMENT_ARCHIVE_MIME,
        scope: 'native-bundle',
        bundleVersion: version,
        proof: this.crypto.sign(`document-archive:${version}`),
        totalBytes: bytes.length,
        fingerprint: version,
        offset: request.offset,
        nextOffset: end < bytes.length ? end : null,
        base64: bytes.subarray(request.offset, end).toString('base64'),
        externalReferences: 'references-only',
        identityScope: 'document',
      },
    };
  }

  private async restoreBundle(
    credential: Credential,
    request: DocumentCreation & {
      format: 'native-bundle';
      blobId: string;
      proof: string;
    }
  ) {
    const actor = this.actor(credential),
      authorize = () => this.authorize(credential, 'workspace_doc_import');
    await this.ac
      .user(actor.actorId)
      .workspace(actor.workspaceId)
      .assert('Workspace.CreateDoc');
    await this.ac
      .user(actor.actorId)
      .workspace(actor.workspaceId)
      .assert('Workspace.Blobs.Read');
    await this.ac
      .user(actor.actorId)
      .workspace(actor.workspaceId)
      .assert('Workspace.Blobs.Write');
    await this.access.assertBlobRead({ ...actor, key: request.blobId });
    const stored = await this.assetStorage.get(
      actor.workspaceId,
      actor.actorId,
      request.blobId
    );
    if (!stored.body) throw new ResourceError('resource_not_found');
    const bytes = await readBufferWithLimit(
      stored.body,
      DOCUMENT_ARCHIVE_LIMIT
    );
    const digest = archiveFingerprint(bytes);
    if (
      request.proof.split(',')[0] !== `document-archive:${digest}` ||
      !this.crypto.verify(request.proof)
    )
      throw new DocumentEditError('invalid_input', {
        reason: 'archive_proof_invalid',
      });
    const archive = decodeDocumentArchive(bytes);
    if (
      archive.source.workspaceId !== actor.workspaceId ||
      archive.source.resource.kind !== request.resource.kind
    )
      throw new DocumentEditError('invalid_input', {
        reason: 'archive_scope_mismatch',
      });
    // Another authorized member may restore a shared archive; possession of a
    // signature alone is not a live copy grant for its original resource.
    if (archive.source.actorId !== actor.actorId) {
      const source = await this.current(credential, archive.source.resource);
      if (archive.source.resource.kind === 'blocksuite') {
        const access = this.ac
          .user(actor.actorId)
          .workspace(actor.workspaceId)
          .doc(archive.source.resource.id)
          .projectScope(null);
        await access.assert('Doc.Copy');
        await access.assert('Doc.Properties.Read');
        if (archive.comments) await access.assert('Doc.Comments.Read');
      } else if (!('record' in source) || !source.record.canCopy) {
        throw new ResourceError('permission_denied');
      }
    }
    const key = fingerprint([
      credential.workspaceId,
      credential.familyId,
      request.idempotencyKey,
      'archive',
    ]);
    const snapshot = archive.comments,
      commentIds = snapshot
        ? this.models.documentComments.copyIdentities(snapshot, key)
        : new Map<string, string>();
    // Imported evidence must not impersonate missing users or silently lose its
    // property definitions. An archive retains the original bytes even on refusal.
    if (snapshot) {
      const users = [
        ...new Set(
          [...snapshot.comments, ...snapshot.replies].map(row => row.userId)
        ),
      ];
      const existing = await this.models.user.getPublicUsersMap(
        users.map(userId => ({ userId }))
      );
      if (users.some(id => !existing.has(id)))
        throw new DocumentEditError('unsupported_document_structure', {
          reason: 'archive_author_unavailable',
        });
    }
    const tags = await this.organization.resourceTagDefinitions(
      actor.workspaceId
    );
    if (
      archive.metadata.tagDefinitions.some(
        tag => !tags.some(current => isDeepStrictEqual(current, tag))
      )
    )
      throw new DocumentEditError('unsupported_document_structure', {
        reason: 'archive_tag_definition_changed',
      });
    if (request.resource.kind === 'blocksuite') {
      const definitions = (
        await this.organization.readOrganization(
          actor.workspaceId,
          actor.actorId
        )
      ).workspaceProperties;
      for (const key of Object.keys(archive.metadata.properties).filter(key =>
        key.startsWith('custom:')
      )) {
        const id = key.slice(7),
          previous = archive.metadata.definitions.find(
            definition => definition.id === id
          ),
          current = definitions.find(definition => definition.id === id);
        if (!previous || !isDeepStrictEqual(previous, current))
          throw new DocumentEditError('unsupported_document_structure', {
            reason: 'archive_property_definition_changed',
          });
      }
    }
    const assets = new Map<string, string>();
    for (const asset of archive.assets) {
      assets.set(
        asset.key,
        await this.assetStorage.putGenerated(
          actor.workspaceId,
          actor.actorId,
          archiveBytes(asset),
          asset.mimeType,
          authorize
        )
      );
    }
    let result: Awaited<ReturnType<McpDocumentsService['createResource']>>;
    if (request.resource.kind === 'blocksuite') {
      const prepared = copyNativeDocument({
        bin: archiveBytes(archive.content),
        sourceId: archive.source.resource.id,
        targetId: request.resource.id,
        title: request.title,
        comments: commentIds,
        assets,
        workspaceId: actor.workspaceId,
      });
      const requiredAssets = nativeDocumentAssets(
        archiveBytes(archive.content),
        actor.workspaceId
      );
      if (requiredAssets.some(id => !assets.has(id)))
        throw new DocumentEditError('invalid_input', {
          reason: 'archive_asset_manifest_incomplete',
        });
      result = await this.createResource(
        credential,
        {
          ...request,
          resource: { kind: 'blocksuite', id: request.resource.id },
          primaryMode:
            archive.metadata.properties.primaryMode === 'edgeless'
              ? 'edgeless'
              : 'page',
        },
        'workspace_doc_import',
        prepared
      );
      const fields = Object.fromEntries(
        Object.entries(archive.metadata.properties).filter(
          ([key]) =>
            ![
              'id',
              '$$DELETED',
              'createdBy',
              'createdAt',
              'updatedBy',
              'updatedAt',
            ].includes(key)
        )
      );
      if (Object.keys(fields).length)
        await this.organization.applyDataOperations(
          actor.workspaceId,
          actor.actorId,
          actor.actorId,
          'document_properties',
          [{ op: 'upsert', key: request.resource.id, values: fields }]
        );
      if (archive.metadata.icon !== null)
        await this.organization.applyDataOperations(
          actor.workspaceId,
          actor.actorId,
          actor.actorId,
          'explorer_icons',
          [
            {
              op: 'upsert',
              key: `doc:${request.resource.id}`,
              values: { icon: archive.metadata.icon },
            },
          ]
        );
      if (archive.metadata.tags.length)
        await this.organization.applyRootOperations(
          actor.workspaceId,
          actor.actorId,
          [
            {
              op: 'set_document_tags',
              docId: request.resource.id,
              tagIds: archive.metadata.tags,
            },
          ]
        );
    } else {
      const blobId = await this.assetStorage.putGenerated(
        actor.workspaceId,
        actor.actorId,
        archiveBytes(archive.content),
        archive.content.mimeType,
        authorize
      );
      result = await this.createResource(
        credential,
        {
          idempotencyKey: request.idempotencyKey,
          resource: { kind: request.resource.kind, id: request.resource.id },
          title: request.title,
          destination: request.destination,
          blobId,
        },
        'workspace_doc_import',
        undefined,
        archive.officeState
          ? {
              bytes: archiveBytes(archive.officeState),
              modelVersion: archive.officeState.modelVersion,
            }
          : undefined
      );
      if (archive.metadata.tags.length) {
        const record = await this.native.get(
          this.identity(credential, request.resource)
        );
        await this.native.setTags({
          ...this.identity(credential, request.resource),
          tagIds: archive.metadata.tags,
          expectedVersion: record.metadataVersion,
          requestKey: `mcp:archive:tags:${key}`,
        });
      }
    }
    if (snapshot && request.resource.kind !== 'file') {
      const revision =
        request.resource.kind === 'office'
          ? await this.office.getRevision(
              actor.workspaceId,
              actor.actorId,
              request.resource.id
            )
          : undefined;
      await this.models.documentComments.copyInto(
        {
          workspaceId: actor.workspaceId,
          kind: request.resource.kind,
          resourceId: request.resource.id,
        },
        snapshot,
        commentIds,
        revision?.id,
        await this.comments.restoreAttachments(
          actor,
          request.resource.id,
          archive.commentAssets
        )
      );
    }
    await authorize();
    return {
      ...result,
      archive: {
        fingerprint: digest,
        blobId: request.blobId,
        identityScope: 'document' as const,
      },
      identities: {
        ...result.identities,
        ...Object.fromEntries(
          [...commentIds].map(([id, value]) => [`comment:${id}`, value])
        ),
        ...Object.fromEntries(
          [...assets].map(([id, value]) => [`asset:${id}`, value])
        ),
      },
    };
  }

  private async readManagement(
    credential: Credential,
    name: DocumentToolName,
    args: unknown
  ) {
    if (name === 'workspace_doc_history_list') {
      const request =
          DOCUMENT_INPUT_SCHEMAS.workspace_doc_history_list.parse(args),
        current = await this.current(credential, request.resource);
      const data =
        request.resource.kind === 'blocksuite'
          ? (
              await this.models.history.findMany(
                credential.workspaceId,
                request.resource.id,
                { before: request.before, take: request.limit }
              )
            ).map(row => ({
              revision: row.timestamp,
              actorId: row.editor?.id ?? null,
            }))
          : (
              await this.native.history({
                ...this.identity(credential, request.resource),
                before: request.before,
                limit: request.limit,
              })
            ).map(row => ({
              revision: row.sequence,
              actorId: row.actorId,
              createdAt: row.createdAt.toISOString(),
              byteSize: row.byteSize,
            }));
      return {
        ...this.base(credential),
        resource: request.resource,
        version: current.version,
        data: {
          revisions: data,
          nextBefore:
            data.length === request.limit ? data.at(-1)?.revision : null,
        },
      };
    }
    const request =
      name === 'workspace_doc_export'
        ? DOCUMENT_INPUT_SCHEMAS.workspace_doc_export.parse(args)
        : DOCUMENT_INPUT_SCHEMAS.workspace_doc_history_read.parse(args);
    const current = await this.current(credential, request.resource);
    if (
      'expectedVersion' in request &&
      request.expectedVersion !== current.version
    )
      throw new ResourceError('version_conflict', current.version);
    // Export/download is distinct from reading content in place.
    if (name === 'workspace_doc_export') {
      if (request.resource.kind === 'blocksuite')
        await this.ac
          .user(credential.userId)
          .workspace(credential.workspaceId)
          .doc(request.resource.id)
          .projectScope(null)
          .assert('Doc.Copy');
      else if ('record' in current && !current.record.canCopy)
        throw new ResourceError('permission_denied');
    }
    if ('format' in request && request.format === 'native-bundle')
      return this.exportBundle(credential, request, current);
    const revision = 'revision' in request ? request.revision : undefined;
    const bytes = await this.readContent(
      credential,
      request.resource,
      revision
    );
    if (request.offset > bytes.length) throw new ResourceError('invalid_input');
    const end = Math.min(bytes.length, request.offset + request.limit);
    return {
      ...this.base(credential),
      resource: request.resource,
      version: current.version,
      data: {
        format:
          request.resource.kind === 'blocksuite'
            ? 'application/vnd.localmind.blocksuite+yjs'
            : 'record' in current
              ? current.record.mimeType
              : 'application/octet-stream',
        revision: revision ?? null,
        scope: 'native-content',
        totalBytes: bytes.length,
        fingerprint: createHash('sha256').update(bytes).digest('hex'),
        offset: request.offset,
        nextOffset: end < bytes.length ? end : null,
        base64: bytes.subarray(request.offset, end).toString('base64'),
      },
    };
  }

  private async updateProperties(
    credential: Credential,
    request: z.infer<
      typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_properties_update
    >,
    preview = false
  ) {
    const authorize = () =>
      this.authorize(credential, 'workspace_doc_properties_update', preview);
    await authorize();
    if (request.resource.kind === 'blocksuite')
      return {
        ...(await this.properties.update(
          this.actor(credential),
          {
            documentId: request.resource.id,
            expectedVersion: request.expectedVersion,
            expectedMetadataVersion: request.expectedMetadataVersion,
            properties: request.properties,
          },
          authorize,
          preview
        )),
        resource: request.resource,
        identities: {},
        digest: fingerprint(request),
      };
    const identity = this.identity(credential, request.resource);
    return this.access.write(identity, async () => {
      const current = await this.current(credential, request.resource);
      if (!('record' in current)) throw new ResourceError('invalid_input');
      if (
        current.version !== request.expectedVersion ||
        String(current.record.metadataVersion) !==
          request.expectedMetadataVersion
      )
        throw new ResourceError('version_conflict', current.version);
      if (
        Object.keys(request.properties).some(
          key => key !== 'title' && key !== 'tagIds'
        )
      )
        throw new ResourceError('invalid_input');
      let record: { metadataVersion: number; title: string } = current.record;
      const { title, tagIds } = request.properties;
      if (title !== undefined) nativeTitleSchema.parse(title);
      if (tagIds) {
        const tags = await this.organization.resourceTagDefinitions(
          credential.workspaceId
        );
        if (tagIds.some(id => !tags.some(tag => tag.id === id)))
          throw new ResourceError('invalid_input');
      }
      if (preview) {
        const changed =
          (title !== undefined && title !== record.title) ||
          (tagIds !== undefined &&
            !isDeepStrictEqual(
              [...new Set(tagIds)].sort(),
              current.record.tags.map(tag => tag.id).sort()
            ));
        return {
          resource: request.resource,
          beforeVersion: current.version,
          afterVersion: current.version,
          metadataVersion: String(record.metadataVersion),
          changed,
          changedIds: changed ? [request.resource.id] : [],
          identities: {},
          digest: fingerprint(request),
        };
      }
      const prefix = `mcp:metadata:${fingerprint([credential.familyId, request.idempotencyKey])}`;
      if (title !== undefined && title !== record.title)
        record = await this.native.change({
          ...identity,
          expectedVersion: record.metadataVersion,
          requestKey: `${prefix}:title`,
          action: 'rename',
          title,
        });
      if (tagIds !== undefined)
        record = await this.native.setTags({
          ...identity,
          expectedVersion: record.metadataVersion,
          requestKey: `${prefix}:tags`,
          tagIds,
        });
      const changed = record.metadataVersion !== current.record.metadataVersion;
      return {
        resource: request.resource,
        beforeVersion: current.version,
        afterVersion: (await this.current(credential, request.resource))
          .version,
        metadataVersion: String(record.metadataVersion),
        changed,
        changedIds: changed ? [request.resource.id] : [],
        identities: {},
        digest: fingerprint(request),
      };
    });
  }

  private async updateAccess(
    credential: Credential,
    request: z.infer<typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_access_update>
  ) {
    const current = await this.current(credential, request.resource);
    if (current.version !== request.expectedVersion)
      throw new ResourceError('version_conflict', current.version);
    if (request.resource.kind !== 'blocksuite')
      throw new DocumentEditError('invalid_input', {
        reason: 'resource_acl_inherited_from_directory',
      });
    const result = await this.documentAccess.change(
      credential.userId,
      credential.workspaceId,
      request.resource.id,
      request.command,
      request.expectedAccessVersion
    );
    await this.authorize(credential, 'workspace_doc_access_update');
    return {
      resource: request.resource,
      beforeVersion: current.version,
      afterVersion: current.version,
      changed: result.changed,
      accessVersion: result.accessVersion,
      changedIds: result.changed ? [request.resource.id] : [],
      identities: {},
      digest: fingerprint(request),
    };
  }

  private async applyComments(
    credential: Credential,
    request: z.infer<
      typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_comments_apply
    >,
    operationId: string
  ) {
    const current = await this.current(credential, request.resource);
    if (current.version !== request.expectedVersion)
      throw new ResourceError('version_conflict', current.version);
    const result = await this.comments.apply(
      this.actor(credential),
      request,
      operationId,
      () => this.authorize(credential, 'workspace_doc_comments_apply')
    );
    return {
      resource: request.resource,
      beforeVersion: current.version,
      afterVersion: (await this.current(credential, request.resource)).version,
      ...result,
      digest: fingerprint(request),
    };
  }

  private async restore(
    credential: Credential,
    request: z.infer<
      typeof DOCUMENT_INPUT_SCHEMAS.workspace_doc_history_restore
    >
  ) {
    const authorize = () =>
      this.authorize(credential, 'workspace_doc_history_restore');
    await authorize();
    if (request.resource.kind === 'blocksuite') {
      const result = await this.resources.restoreNative(
        this.actor(credential),
        {
          documentId: request.resource.id,
          expectedVersion: request.expectedVersion,
          timestamp: request.revision,
        },
        authorize
      );
      return {
        ...result,
        resource: request.resource,
        identities: {},
        digest: fingerprint(request),
      };
    }
    const identity = this.identity(credential, request.resource);
    return this.access.write(identity, async () => {
      const current = await this.current(credential, request.resource);
      if (current.version !== request.expectedVersion)
        throw new ResourceError('version_conflict', current.version);
      if (!('record' in current)) throw new ResourceError('invalid_input');
      const previous = await this.readContent(credential, request.resource),
        target = await this.readContent(
          credential,
          request.resource,
          request.revision
        );
      let changed = !previous.equals(target);
      if (request.resource.kind === 'office') {
        const latest = await this.office.getRevision(
          credential.workspaceId,
          credential.userId,
          request.resource.id
        );
        const revision = await this.models.officeArtifact.getRevisionBySequence(
          credential.workspaceId,
          request.resource.id,
          request.revision
        );
        if (!revision) throw new ResourceError('resource_not_found');
        changed ||=
          latest.stateFingerprint !== revision.stateFingerprint ||
          latest.modelVersion !== revision.modelVersion ||
          latest.packageMimeType !== revision.packageMimeType;
      } else {
        const revision = await this.models.workspaceNativeResource.fileRevision(
          { ...identity, sequence: request.revision }
        );
        changed ||= current.record.mimeType !== revision.mimeType;
      }
      if (changed)
        await this.native.restoreVersion({
          ...identity,
          sequence: request.revision,
          expectedContentVersion: current.record.contentVersion,
          requestKey: `mcp:restore:${fingerprint([credential.familyId, request.idempotencyKey])}`,
        });
      return {
        resource: request.resource,
        beforeVersion: current.version,
        afterVersion: (await this.current(credential, request.resource))
          .version,
        changed,
        changedIds: changed ? [request.resource.id] : [],
        identities: {},
        digest: fingerprint(request),
      };
    });
  }

  async readableReceipt(
    credential: Credential,
    operation: McpResourceOperation
  ) {
    try {
      if (
        operation.contractVersion !== DOCUMENT_CONTRACT_VERSION ||
        operation.workspaceId !== credential.workspaceId ||
        operation.actorId !== credential.userId ||
        operation.credentialFamilyId !== credential.familyId
      )
        throw new Error('Receipt scope mismatch');
      await this.resources.assertWorkspace(this.actor(credential));
      const target = documentOperationResource.parse({
        kind: operation.resourceKind,
        id: operation.resourceId,
      });
      if (target.kind === 'workspace') {
        if (
          target.id !== credential.workspaceId ||
          operation.toolName !== 'workspace_doc_asset_upload'
        )
          throw new Error('Invalid Workspace staging receipt');
        await this.ac
          .user(credential.userId)
          .workspace(credential.workspaceId)
          .assert('Workspace.Blobs.Read');
      } else if (
        [
          'workspace_doc_create_native',
          'workspace_doc_import',
          'workspace_doc_duplicate',
        ].includes(operation.toolName) &&
        operation.status !== 'succeeded'
      ) {
        if (operation.parentId)
          await this.pageTree.destination(
            this.actor(credential),
            operation.parentId
          );
        else
          await this.organization.assertResourceFolder(
            credential.workspaceId,
            credential.userId,
            operation.folderId
          );
      } else if (
        operation.toolName === 'workspace_doc_access_update' &&
        operation.status === 'succeeded'
      ) {
        // The initiating actor may have deliberately revoked their own access.
        // This receipt contains only operation and version identities.
      } else if (operation.toolName === 'workspace_doc_lifecycle') {
        const receipt = DOCUMENT_RECEIPT_SCHEMA.safeParse(operation.result);
        if (receipt.success && receipt.data.lifecycle === 'deleted') {
          // This actor's immutable receipt contains no body, names or ACL list.
          // Deletion intentionally removes the target; Workspace membership and
          // credential-family identity continue to gate this tombstone receipt.
        } else if (target.kind === 'blocksuite')
          await this.lifecycle.get({
            ...this.actor(credential),
            resourceId: target.id,
            kind: 'doc',
          });
        else await this.native.get(this.identity(credential, target), true);
      } else await this.current(credential, target);
    } catch {
      throw new ResourceError('operation_not_found');
    }
    if (['succeeded', 'failed'].includes(operation.status))
      return {
        ...DOCUMENT_OPERATION_SCHEMA.parse(operation.result),
        replayed: true,
      };
    return this.pending(credential, operation);
  }

  async execute(credential: Credential, name: DocumentToolName, args: unknown) {
    let operation: McpResourceOperation | undefined;
    try {
      await this.authorize(credential, name);
      const parsed = DOCUMENT_INPUT_SCHEMAS[name].safeParse(args);
      if (!parsed.success) throw new ResourceError('invalid_input');
      if (name === 'workspace_doc_inspect')
        return await this.resources.snapshot(this.actor(credential), () =>
          this.inspect(
            credential,
            DOCUMENT_INPUT_SCHEMAS.workspace_doc_inspect.parse(args)
          )
        );
      if (name === 'workspace_doc_access_read')
        return await this.resources.snapshot(
          this.actor(credential),
          async () => {
            const request =
                DOCUMENT_INPUT_SCHEMAS.workspace_doc_access_read.parse(args),
              current = await this.current(credential, request.resource);
            if (current.version !== request.expectedVersion)
              throw new ResourceError('version_conflict', current.version);
            if (request.resource.kind !== 'blocksuite')
              return {
                ...this.base(credential),
                resource: request.resource,
                version: current.version,
                data: { scope: 'inherited-directory', independentAcl: false },
              };
            const state = await this.documentAccess.read(
              credential.userId,
              credential.workspaceId,
              request.resource.id,
              request.offset,
              request.limit
            );
            if (
              (request.offset > 0 && !request.expectedAccessVersion) ||
              (request.expectedAccessVersion !== undefined &&
                request.expectedAccessVersion !== state.version)
            )
              throw new ResourceError('cursor_stale', state.version);
            return {
              ...this.base(credential),
              resource: request.resource,
              version: current.version,
              data: {
                ...state,
                accessVersion: state.version,
                offset: request.offset,
                nextOffset:
                  request.offset + request.limit < state.total
                    ? request.offset + request.limit
                    : null,
              },
            };
          }
        );
      if (name === 'workspace_doc_comments_read')
        return await this.resources.snapshot(
          this.actor(credential),
          async () => {
            const request =
                DOCUMENT_INPUT_SCHEMAS.workspace_doc_comments_read.parse(args),
              current = await this.current(credential, request.resource);
            if (current.version !== request.expectedVersion)
              throw new ResourceError('version_conflict', current.version);
            return {
              ...this.base(credential),
              resource: request.resource,
              version: current.version,
              data: await this.comments.read(this.actor(credential), request),
            };
          }
        );
      if (name === 'workspace_doc_asset_read')
        return await this.resources.snapshot(this.actor(credential), () =>
          this.readAsset(
            credential,
            DOCUMENT_INPUT_SCHEMAS.workspace_doc_asset_read.parse(args)
          )
        );
      if (
        [
          'workspace_doc_history_list',
          'workspace_doc_history_read',
          'workspace_doc_export',
        ].includes(name)
      )
        return await this.resources.snapshot(this.actor(credential), () =>
          this.readManagement(credential, name, args)
        );
      const request =
        name === 'workspace_doc_duplicate'
          ? this.duplicationRequest(credential, args)
          : name === 'workspace_doc_access_update'
            ? DOCUMENT_INPUT_SCHEMAS.workspace_doc_access_update.parse(args)
            : name === 'workspace_doc_comments_apply'
              ? DOCUMENT_INPUT_SCHEMAS.workspace_doc_comments_apply.parse(args)
              : name === 'workspace_doc_lifecycle'
                ? DOCUMENT_INPUT_SCHEMAS.workspace_doc_lifecycle.parse(args)
                : name === 'workspace_doc_create_native' ||
                    name === 'workspace_doc_import'
                  ? this.creationRequest(credential, name, args)
                  : name === 'workspace_doc_asset_upload'
                    ? DOCUMENT_INPUT_SCHEMAS.workspace_doc_asset_upload.parse(
                        args
                      )
                    : name === 'workspace_doc_properties_update'
                      ? DOCUMENT_INPUT_SCHEMAS.workspace_doc_properties_update.parse(
                          args
                        )
                      : name === 'workspace_doc_history_restore'
                        ? DOCUMENT_INPUT_SCHEMAS.workspace_doc_history_restore.parse(
                            args
                          )
                        : DOCUMENT_INPUT_SCHEMAS.workspace_doc_apply.parse(
                            args
                          );
      if (name === 'workspace_doc_edit_preview')
        return await this.resources.snapshot(
          this.actor(credential),
          async () => ({
            ...this.base(credential),
            ...(await this.edit(
              credential,
              DOCUMENT_INPUT_SCHEMAS.workspace_doc_apply.parse(args),
              'preview',
              true
            )),
            status: 'preview' as const,
            writeOutcome: 'none' as const,
          })
        );
      if (
        request.resource.kind === 'workspace' &&
        request.resource.id !== credential.workspaceId
      )
        throw new ResourceError('invalid_input');
      const requestFingerprint = fingerprint([
        DOCUMENT_CONTRACT_VERSION,
        name,
        request,
      ]);
      operation = await this.models.mcpResourceOperation.receive({
        ...this.actor(credential),
        credentialId: credential.id,
        credentialFamilyId: credential.familyId,
        contractVersion: DOCUMENT_CONTRACT_VERSION,
        toolName: name,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint,
        resourceKind: request.resource.kind,
        resourceId: request.resource.id,
        documentId:
          request.resource.kind === 'blocksuite' ? request.resource.id : null,
        folderId:
          'destination' in request &&
          request.destination.kind === 'legacy-folder'
            ? request.destination.folderId
            : null,
        parentId:
          'destination' in request && request.destination.kind === 'page-tree'
            ? request.destination.parentNodeId
            : null,
      });
      if (operation.requestFingerprint !== requestFingerprint)
        throw new ResourceError('idempotency_conflict');
      return await this.write(credential, request, operation);
    } catch (caught) {
      const error =
        caught instanceof ResourceConflict
          ? new ResourceError('version_conflict')
          : caught instanceof ActionForbidden
            ? new ResourceError('permission_denied')
            : caught instanceof NotFound
              ? new ResourceError('resource_not_found')
              : caught instanceof BadRequest || caught instanceof z.ZodError
                ? new ResourceError('invalid_input')
                : caught;
      if (error instanceof ResourceError) {
        if (
          operation &&
          error.code !== 'idempotency_conflict' &&
          error.code !== 'operation_not_found'
        ) {
          try {
            return await this.recordFailure(credential, operation, error);
          } catch {
            return this.pending(credential, {
              ...operation,
              status: 'needs_reconciliation',
            });
          }
        }
        return this.failure(credential, name, error, operation?.id);
      }
      if (operation) {
        try {
          await this.models.mcpResourceOperation.noteUncertain(operation.id);
        } catch {
          /* Preserve reconciliation identity. */
        }
        return this.pending(credential, {
          ...operation,
          status: 'needs_reconciliation',
        });
      }
      return this.failure(
        credential,
        name,
        new ResourceError('temporarily_unavailable')
      );
    }
  }

  @Transactional<TransactionalAdapterPrisma>({ timeout: 60000 })
  private async write(
    credential: Credential,
    request: DocumentWrite,
    initial: McpResourceOperation
  ) {
    const model = this.models.mcpResourceOperation;
    if (!(await model.tryLock(initial.id)))
      return this.pending(credential, initial);
    const operation = await model.get(initial.id);
    if (!operation) throw new ResourceError('operation_not_found');
    if (['succeeded', 'failed'].includes(operation.status))
      return this.readableReceipt(credential, operation);
    await model.lockAuthority({
      ...this.actor(credential),
      credentialId: credential.id,
      documentId: operation.documentId,
    });
    return this.resources.snapshot(this.actor(credential), async () => {
      await this.authorize(credential, operation.toolName);
      await model.appendEvent(operation.id, 'executing');
      const result =
        operation.toolName === 'workspace_doc_duplicate'
          ? await this.duplicateResource(
              credential,
              request as DocumentDuplication,
              operation.id
            )
          : operation.toolName === 'workspace_doc_access_update'
            ? await this.updateAccess(
                credential,
                DOCUMENT_INPUT_SCHEMAS.workspace_doc_access_update.parse(
                  request
                )
              )
            : operation.toolName === 'workspace_doc_comments_apply'
              ? await this.applyComments(
                  credential,
                  DOCUMENT_INPUT_SCHEMAS.workspace_doc_comments_apply.parse(
                    request
                  ),
                  operation.id
                )
              : operation.toolName === 'workspace_doc_lifecycle'
                ? await this.changeLifecycle(
                    credential,
                    DOCUMENT_INPUT_SCHEMAS.workspace_doc_lifecycle.parse(
                      request
                    )
                  )
                : operation.toolName === 'workspace_doc_create_native' ||
                    operation.toolName === 'workspace_doc_import'
                  ? await this.createResource(
                      credential,
                      this.creationRequest(
                        credential,
                        operation.toolName,
                        request
                      ),
                      operation.toolName
                    )
                  : operation.toolName === 'workspace_doc_asset_upload'
                    ? await this.uploadAsset(
                        credential,
                        DOCUMENT_INPUT_SCHEMAS.workspace_doc_asset_upload.parse(
                          request
                        ),
                        operation
                      )
                    : operation.toolName === 'workspace_doc_properties_update'
                      ? await this.updateProperties(
                          credential,
                          DOCUMENT_INPUT_SCHEMAS.workspace_doc_properties_update.parse(
                            request
                          )
                        )
                      : operation.toolName === 'workspace_doc_history_restore'
                        ? await this.restore(
                            credential,
                            DOCUMENT_INPUT_SCHEMAS.workspace_doc_history_restore.parse(
                              request
                            )
                          )
                        : await this.edit(
                            credential,
                            DOCUMENT_INPUT_SCHEMAS.workspace_doc_apply.parse(
                              request
                            ),
                            operation.id,
                            false
                          );
      const receipt = DOCUMENT_RECEIPT_SCHEMA.parse({
        ...this.base(credential),
        ...result,
        status: 'succeeded',
        toolName: operation.toolName,
        operationId: operation.id,
        replayed: false,
        writeOutcome: 'committed',
      });
      await model.finish(operation.id, 'succeeded', receipt);
      return receipt;
    });
  }
  @Transactional<TransactionalAdapterPrisma>({ timeout: 60000 })
  private async recordFailure(
    credential: Credential,
    initial: McpResourceOperation,
    error: ResourceError
  ) {
    const model = this.models.mcpResourceOperation;
    if (!(await model.tryLock(initial.id)))
      return this.pending(credential, initial);
    const operation = await model.get(initial.id);
    if (!operation) throw new ResourceError('operation_not_found');
    if (['succeeded', 'failed'].includes(operation.status))
      return this.readableReceipt(credential, operation);
    const result = this.failure(
      credential,
      operation.toolName,
      error,
      operation.id
    );
    await model.finish(operation.id, 'failed', result, error.code);
    return result;
  }
}
