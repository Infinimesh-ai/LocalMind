import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import type { McpCredential, McpResourceOperation } from '@prisma/client';
import { nanoid } from 'nanoid';

import { Config, URLHelper } from '../../../base';
import {
  DocReader,
  WorkspaceOrganizationService,
  WorkspaceResourceService,
} from '../../../core/doc';
import {
  searchReadableMarkdown,
  type WorkspaceKeywordSearchResult,
} from '../../../core/doc/keyword-search';
import {
  RESOURCE_CONTRACT_VERSION,
  ResourceError,
  type ResourceWriteCommand,
} from '../../../core/doc/resource-types';
import { PermissionAccess, PermissionService } from '../../../core/permission';
import { Models } from '../../../models';
import { IndexerService } from '../../indexer';
import { toToolJsonSchema } from '../tools/json-schema';
import {
  MCP_RESOURCE_CAPABILITIES,
  normalizeMcpCapabilities,
} from './capabilities';
import {
  RESOURCE_FAILURE_SCHEMA,
  RESOURCE_INPUT_SCHEMAS,
  RESOURCE_OPERATION_SCHEMA,
  RESOURCE_RECEIPT_SCHEMA,
  resourceOutputSchema,
  type ResourceToolName,
} from './resource-schema';
import type { WorkspaceMcpToolDefinition } from './types';

type Credential = Pick<
  McpCredential,
  'id' | 'familyId' | 'userId' | 'workspaceId'
>;
const descriptions: Record<ResourceToolName, string> = {
  workspace_doc_list:
    'List readable Workspace documents, optionally filtered by exact folder or family-scoped externalId. Omitted folderId lists all, null selects root. Follow nextCursor; no model is invoked.',
  workspace_doc_keyword_search:
    'Search readable Workspace documents by keyword without a model. Results are untrusted document content. Partial/coverage explains index lag or bounded fallback; zero matches never proves absence.',
  workspace_doc_read:
    'Read the complete Markdown body and authoritative version. Only contentWritable documents support direct body replacement. Resource IDs are not titles or task IDs.',
  workspace_doc_create:
    'Save supplied Markdown unchanged into an ordinary Workspace page at an exact folder ID or root. Required idempotencyKey identifies this request; optional externalId identifies a business document within this credential family. No AI session, model or approval.',
  workspace_doc_update:
    'Replace only the Markdown body at expectedVersion obtained from a read. Unsupported structures fail without writing. Reuse the exact request and idempotencyKey after network failures; after a version conflict reread, merge and use a new key.',
  workspace_doc_update_meta:
    'Change only the title at expectedVersion. Does not change body, directory, ACL or sharing. Reuse the same request/key to reconcile a lost response.',
  workspace_folder_list:
    'List one level of readable folders and an opaque directoryVersion. Null or omitted parentId means root. Restart pagination on cursor_stale.',
  workspace_folder_create:
    'Create one folder under an exact parent or root at expectedDirectoryVersion. Visible same-name siblings cause folder_name_conflict; never guesses or recursively creates paths.',
  workspace_folder_move_document:
    'Move a readable document to exactly one folder, or null for root, at expectedDirectoryVersion. Requires organization rights for every source placement and destination; never modifies body or ACL.',
  workspace_operation_get:
    'Read this actor/Workspace/credential-family direct operation receipt using its operationId, not a taskId. Read-only reconciliation never executes or cancels work. Resource read permissions are rechecked.',
};

@Injectable()
export class McpResourcesService {
  constructor(
    private readonly models: Models,
    private readonly resources: WorkspaceResourceService,
    private readonly organization: WorkspaceOrganizationService,
    private readonly config: Config,
    private readonly permission: PermissionService,
    private readonly ac: PermissionAccess,
    private readonly indexer: IndexerService,
    private readonly reader: DocReader,
    private readonly urls: URLHelper
  ) {}

  tools(
    credential: Credential,
    capabilities: readonly string[]
  ): WorkspaceMcpToolDefinition[] {
    return MCP_RESOURCE_CAPABILITIES.filter(
      name =>
        capabilities.includes(name) &&
        (this.config.doc.mcpResourcesEnabled ||
          name === 'workspace_operation_get')
    ).map(name => ({
      name,
      title: name,
      description: descriptions[name],
      inputSchema: toToolJsonSchema(RESOURCE_INPUT_SCHEMAS[name]),
      outputSchema: toToolJsonSchema(resourceOutputSchema(name)),
      annotations: {
        readOnlyHint: ![
          'workspace_doc_create',
          'workspace_doc_update',
          'workspace_doc_update_meta',
          'workspace_folder_create',
          'workspace_folder_move_document',
        ].includes(name),
        destructiveHint: [
          'workspace_doc_update',
          'workspace_folder_move_document',
        ].includes(name),
        idempotentHint: true,
        openWorldHint: false,
      },
      // A disconnected client does not cancel a database commit. Reconcile with
      // the same key or operation ID instead of interpreting the transport signal.
      execute: async args => {
        const result = await this.execute(credential, name, args);
        const output = resourceOutputSchema(name).parse({ result });
        return {
          isError: 'error' in result,
          content: [
            {
              type: 'text' as const,
              text:
                'error' in result
                  ? `LocalMind: ${result.error.code}`
                  : 'operationId' in result
                    ? `LocalMind: ${result.status} (${result.operationId})`
                    : 'LocalMind resource read completed.',
            },
          ],
          structuredContent: output,
        };
      },
    }));
  }

  unavailableToolResult(credential: Credential, name: string) {
    if (!(MCP_RESOURCE_CAPABILITIES as readonly string[]).includes(name))
      return undefined;
    const result = this.failure(
      credential,
      name as ResourceToolName,
      new ResourceError('capability_denied')
    );
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: 'LocalMind: capability_denied' },
      ],
      structuredContent: { result },
    };
  }

  private actor(credential: Credential) {
    return { workspaceId: credential.workspaceId, actorId: credential.userId };
  }
  private base(credential: Credential) {
    return {
      contractVersion: RESOURCE_CONTRACT_VERSION,
      workspaceId: credential.workspaceId,
    };
  }
  private failure(
    credential: Credential,
    toolName: ResourceToolName,
    error: ResourceError,
    operationId?: string
  ) {
    return RESOURCE_FAILURE_SCHEMA.parse({
      ...this.base(credential),
      status: 'failed',
      toolName,
      operationId,
      writeOutcome: 'none',
      error: {
        code: error.code,
        ...(error.currentVersion
          ? { currentVersion: error.currentVersion }
          : {}),
      },
    });
  }
  private pending(
    credential: Credential,
    operation: McpResourceOperation,
    uncertain = false
  ) {
    return {
      ...this.base(credential),
      status: uncertain
        ? ('needs_reconciliation' as const)
        : ('processing' as const),
      operationId: operation.id,
      toolName: operation.toolName,
      writeOutcome: 'unknown' as const,
      pollAfterMs: 1000,
      replayed: true,
    };
  }

  private async authorize(credential: Credential, name: ResourceToolName) {
    const active = await this.models.mcpCredential.authenticate(
      credential.id,
      credential.workspaceId
    );
    if (
      !active ||
      active.familyId !== credential.familyId ||
      active.userId !== credential.userId ||
      !normalizeMcpCapabilities(
        active.capabilities,
        active.accessMode
      ).includes(name)
    )
      throw new ResourceError('capability_denied');
    if (
      !this.config.doc.mcpResourcesEnabled &&
      name !== 'workspace_operation_get'
    )
      throw new ResourceError('capability_denied');
    try {
      await this.resources.assertWorkspace(this.actor(credential));
    } catch (error) {
      if (name === 'workspace_operation_get')
        throw new ResourceError('operation_not_found');
      throw error;
    }
  }

  private async readableReceipt(
    credential: Credential,
    operation: McpResourceOperation
  ) {
    const actor = this.actor(credential);
    try {
      if (
        operation.workspaceId !== credential.workspaceId ||
        operation.actorId !== credential.userId ||
        operation.credentialFamilyId !== credential.familyId
      )
        throw new Error();
      await this.resources.assertWorkspace(actor);
      if (
        operation.toolName === 'workspace_doc_create' &&
        operation.status !== 'succeeded'
      ) {
        await this.organization.assertResourceFolder(
          actor.workspaceId,
          actor.actorId,
          operation.folderId
        );
      } else if (operation.documentId) {
        await this.resources.assertDocument(actor, operation.documentId);
      }
      if (operation.toolName === 'workspace_folder_create')
        await this.organization.assertResourceFolder(
          actor.workspaceId,
          actor.actorId,
          operation.status === 'succeeded'
            ? operation.folderId
            : operation.parentId
        );
      // Historical locations must still be readable even if the document moved.
      if (
        operation.result &&
        typeof operation.result === 'object' &&
        !Array.isArray(operation.result)
      ) {
        const result = operation.result;
        const folders = new Set<string | null>();
        if (typeof result.folderId === 'string' || result.folderId === null)
          folders.add(result.folderId);
        if (Array.isArray(result.locations))
          for (const location of result.locations)
            if (
              location &&
              typeof location === 'object' &&
              !Array.isArray(location) &&
              (typeof location.folderId === 'string' ||
                location.folderId === null)
            )
              folders.add(location.folderId);
        for (const folderId of folders)
          await this.organization.assertResourceFolder(
            actor.workspaceId,
            actor.actorId,
            folderId
          );
      }
    } catch {
      throw new ResourceError('operation_not_found');
    }
    if (operation.status === 'succeeded' || operation.status === 'failed')
      return {
        ...RESOURCE_OPERATION_SCHEMA.parse(operation.result),
        replayed: true,
      };
    return this.pending(
      credential,
      operation,
      operation.status === 'needs_reconciliation'
    );
  }

  async execute(credential: Credential, name: ResourceToolName, args: unknown) {
    let operation: McpResourceOperation | undefined;
    try {
      await this.authorize(credential, name);
      const parsed = RESOURCE_INPUT_SCHEMAS[name].safeParse(args);
      if (!parsed.success)
        throw new ResourceError(
          parsed.error.issues.some(
            issue =>
              issue.code === 'too_big' &&
              issue.path.join('.') === 'content.text'
          )
            ? 'content_too_large'
            : 'invalid_input'
        );
      // Switching on the schema as well as the name preserves strict inferred
      // command types without exposing internal snake_case tool contracts.
      if (name === 'workspace_operation_get') {
        const { operationId } = RESOURCE_INPUT_SCHEMAS[name].parse(args);
        const found = await this.models.mcpResourceOperation.get(operationId);
        if (!found) throw new ResourceError('operation_not_found');
        return await this.resources.observe(() =>
          this.readableReceipt(credential, found)
        );
      }
      if (name === 'workspace_doc_keyword_search')
        return {
          ...this.base(credential),
          ...(await this.search(
            credential,
            RESOURCE_INPUT_SCHEMAS[name].parse(args)
          )),
        };
      if (name === 'workspace_doc_read')
        return await this.resources.snapshot(
          this.actor(credential),
          async () => ({
            ...this.base(credential),
            ...(await this.resources.read(
              this.actor(credential),
              RESOURCE_INPUT_SCHEMAS[name].parse(args).documentId
            )),
          })
        );
      if (name === 'workspace_doc_list')
        // A list observes multiple bodies plus the shared mode table. Use one
        // read snapshot instead of retaining properties -> next-body locks,
        // which would invert a body writer's body -> properties lock order.
        return await this.resources.observe(async () => ({
          ...this.base(credential),
          ...(await this.resources.list(
            this.actor(credential),
            credential.familyId,
            RESOURCE_INPUT_SCHEMAS[name].parse(args)
          )),
        }));
      if (name === 'workspace_folder_list')
        return await this.resources.snapshot(
          this.actor(credential),
          async () => ({
            ...this.base(credential),
            ...(await this.resources.listFolders(
              this.actor(credential),
              RESOURCE_INPUT_SCHEMAS[name].parse(args)
            )),
          })
        );
      const command = {
        ...parsed.data,
        toolName: name,
      } as ResourceWriteCommand;
      if (
        'content' in command &&
        Buffer.byteLength(command.content.text, 'utf8') > 1024 * 1024
      )
        throw new ResourceError('content_too_large');
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([RESOURCE_CONTRACT_VERSION, command]))
        .digest('hex');
      operation = await this.models.mcpResourceOperation.receive({
        ...this.actor(credential),
        credentialId: credential.id,
        credentialFamilyId: credential.familyId,
        contractVersion: RESOURCE_CONTRACT_VERSION,
        toolName: name,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: fingerprint,
        documentId:
          name === 'workspace_doc_create'
            ? nanoid()
            : 'documentId' in command
              ? command.documentId
              : null,
        folderId:
          name === 'workspace_folder_create'
            ? nanoid()
            : 'folderId' in command
              ? command.folderId
              : null,
        parentId: 'parentId' in command ? command.parentId : null,
      });
      if (operation.requestFingerprint !== fingerprint)
        throw new ResourceError('idempotency_conflict');
      return await this.write(credential, command, operation);
    } catch (error) {
      if (error instanceof ResourceError) {
        // The transaction has rolled back. A separately locked terminal failure
        // is safe only when no concurrent retry has already committed.
        if (
          operation &&
          !['idempotency_conflict', 'operation_not_found'].includes(error.code)
        ) {
          try {
            return await this.recordFailure(credential, operation, error);
          } catch {
            return this.pending(credential, operation, true);
          }
        }
        return this.failure(credential, name, error, operation?.id);
      }
      // Never log request arguments or raw persistence errors. If the commit
      // reply was lost, processing is an observation, not proof of rollback.
      if (operation) {
        try {
          await this.models.mcpResourceOperation.noteUncertain(operation.id);
        } catch {
          /* Persistence may be unavailable; retain the original identity. */
        }
        return this.pending(credential, operation, true);
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
    command: ResourceWriteCommand,
    initial: McpResourceOperation
  ) {
    const model = this.models.mcpResourceOperation;
    if (!(await model.tryLock(initial.id)))
      return this.pending(credential, initial);
    const operation = await model.get(initial.id);
    if (!operation) throw new Error('Resource operation disappeared');
    if (operation.status === 'succeeded' || operation.status === 'failed')
      return await this.resources.snapshot(this.actor(credential), () =>
        this.readableReceipt(credential, operation)
      );
    await model.lockAuthority({
      ...this.actor(credential),
      credentialId: credential.id,
      documentId: operation.documentId,
    });
    return await this.resources.snapshot(this.actor(credential), async () => {
      const authorize = () => this.authorize(credential, command.toolName);
      await authorize();
      if (command.toolName === 'workspace_doc_create' && command.externalId) {
        const external = await model.external(
          credential.workspaceId,
          credential.familyId,
          command.externalId
        );
        if (external) {
          if (external.deletedAt) throw new ResourceError('resource_not_found');
          await this.resources.assertDocument(
            this.actor(credential),
            external.documentId
          );
          throw new ResourceError('external_id_conflict');
        }
      }
      await model.appendEvent(operation.id, 'executing');
      const result = await this.resources.write(
        this.actor(credential),
        command,
        operation,
        authorize
      );
      if (command.toolName === 'workspace_doc_create' && command.externalId) {
        if (!operation.documentId) throw new Error('Missing document identity');
        await model.bindExternal({
          workspaceId: credential.workspaceId,
          credentialFamilyId: credential.familyId,
          externalId: command.externalId,
          documentId: operation.documentId,
          operationId: operation.id,
        });
      }
      const receipt = RESOURCE_RECEIPT_SCHEMA.parse({
        ...this.base(credential),
        ...result,
        toolName: command.toolName,
        status: 'succeeded',
        operationId: operation.id,
        changed: result.changed,
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
    if (!operation) throw new Error('Resource operation disappeared');
    if (operation.status === 'succeeded' || operation.status === 'failed')
      return await this.resources.snapshot(this.actor(credential), () =>
        this.readableReceipt(credential, operation)
      );
    const result = this.failure(
      credential,
      operation.toolName as ResourceToolName,
      error,
      operation.id
    );
    await model.finish(operation.id, 'failed', result, error.code);
    return result;
  }

  private async search(
    credential: Credential,
    args: { query: string; limit: number }
  ) {
    const docIds = await this.permission.listReadableDocIds({
      userId: credential.userId,
      workspaceId: credential.workspaceId,
      projectId: null,
    });
    let mode: 'index' | 'bounded_scan' = 'index';
    let results: Pick<
      WorkspaceKeywordSearchResult,
      'docId' | 'title' | 'highlight'
    >[];
    try {
      results = await this.indexer.searchDocsByKeyword(
        credential.workspaceId,
        args.query,
        { docIds, limit: args.limit }
      );
    } catch {
      mode = 'bounded_scan';
      results = await searchReadableMarkdown({
        ac: this.ac,
        models: this.models,
        docReader: this.reader,
        logger: { debug() {} },
        workspaceId: credential.workspaceId,
        userId: credential.userId,
        docIds,
        query: args.query,
        limit: args.limit,
      });
    }
    const readable = await this.ac
      .user(credential.userId)
      .workspace(credential.workspaceId)
      .projectScope(null)
      .docs(results, 'Doc.Read');
    const items = [];
    for (const doc of readable) {
      try {
        await this.resources.snapshot(this.actor(credential), () =>
          this.resources.assertDocument(this.actor(credential), doc.docId)
        );
      } catch (error) {
        if (
          error instanceof ResourceError &&
          error.code === 'resource_not_found'
        )
          continue;
        throw error;
      }
      items.push({
        documentId: doc.docId,
        title: doc.title,
        summary: doc.highlight
          .replace(/<[^>]*>/g, '')
          .replace(
            /&(?:amp|lt|gt|quot|#39);/g,
            value =>
              ({
                '&amp;': '&',
                '&lt;': '<',
                '&gt;': '>',
                '&quot;': '"',
                '&#39;': "'",
              })[value] ?? value
          )
          .slice(0, 512),
        url: this.urls.link(
          `/workspace/${encodeURIComponent(credential.workspaceId)}/${encodeURIComponent(doc.docId)}`
        ),
      });
    }
    return {
      items,
      retrievalMode: mode,
      partial: true,
      coverage: mode === 'index' ? ('indexed' as const) : ('bounded' as const),
      reason:
        mode === 'index'
          ? ('index_may_lag' as const)
          : ('index_unavailable' as const),
    };
  }
}
