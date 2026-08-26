import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { Injectable, Logger } from '@nestjs/common';
import type { AiMcpAttachment, McpCredential } from '@prisma/client';
import { z } from 'zod';

import { sniffMime } from '../../../base';
import { PermissionAccess } from '../../../core/permission';
import { WorkspaceBlobStorage } from '../../../core/storage';
import { WorkspaceBlobResolver } from '../../../core/workspaces/resolvers/blob';
import { Models } from '../../../models';
import { parseDoc } from '../../../native';
import type { PromptAttachment } from '../providers/types';
import { readStream } from '../utils';
import {
  MCP_ATTACHMENT_UPLOAD_CAPABILITY,
  type McpCapability,
} from './capabilities';
import {
  defineTool,
  RESULT_OUTPUT_SCHEMA,
  toolResult,
  type WorkspaceMcpToolDefinition,
  WRITE_TOOL,
} from './types';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 8;
const MAX_ATTACHMENT_CONTEXT_LENGTH = 24_000;
const MAX_BASE64_LENGTH = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8;

const IDEMPOTENT_WRITE_TOOL = { ...WRITE_TOOL, idempotentHint: true };

const UploadAttachmentInput = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .describe('The original attachment filename, including its extension.'),
    mimeType: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .default('application/octet-stream')
      .describe('The declared MIME type of the attachment.'),
    base64: z
      .string()
      .min(1)
      .max(MAX_BASE64_LENGTH)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .describe(
        'The base64-encoded attachment bytes. The decoded file must not exceed 10 MiB.'
      ),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .describe(
        'A caller-generated stable key for this exact upload. Reuse it only to retry the same file.'
      ),
  })
  .strict()
  .describe('Upload one attachment for a later LocalMind delegation task.');

type AttachmentCredential = Pick<
  McpCredential,
  'id' | 'familyId' | 'generation' | 'userId' | 'workspaceId' | 'capabilities'
>;

export type MaterializedMcpAttachments = {
  context: Array<{
    attachmentId: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    contentFingerprint: string;
    extractedText?: string;
    extractedTextTruncated?: boolean;
    suppliedToModel?: boolean;
  }>;
  promptAttachments: PromptAttachment[];
  records: AiMcpAttachment[];
};

export class McpAttachmentReferenceError extends Error {
  constructor(
    readonly status: 'permission_denied' | 'resource_not_accessible' | 'failed',
    readonly result: Record<string, unknown>,
    message: string
  ) {
    super(message);
  }
}

function sanitizedFileName(value: string) {
  return (
    value
      .replace(/[\r\n]+/g, ' ')
      .split(/[\\/]/)
      .pop()
      ?.trim() || 'attachment'
  );
}

function decodeBase64(value: string) {
  const buffer = Buffer.from(value, 'base64');
  const canonical = value.replace(/=+$/, '');
  if (
    !buffer.length ||
    buffer.length > MAX_ATTACHMENT_BYTES ||
    buffer.toString('base64').replace(/=+$/, '') !== canonical
  ) {
    throw new Error('attachment_invalid_base64');
  }
  return buffer;
}

function contentFingerprint(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function blobKey(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('base64url');
}

@Injectable()
export class McpAttachmentService {
  private readonly logger = new Logger(McpAttachmentService.name);

  constructor(
    private readonly ac: PermissionAccess,
    private readonly resolver: WorkspaceBlobResolver,
    private readonly storage: WorkspaceBlobStorage,
    private readonly models: Models
  ) {}

  createTool(
    credential: AttachmentCredential,
    capabilities: readonly McpCapability[]
  ): WorkspaceMcpToolDefinition {
    return defineTool({
      name: 'upload_localmind_attachment',
      title: 'Upload a LocalMind Attachment',
      description:
        'Upload one attachment for LocalMind AI. Call this before delegate_to_localmind, then pass the returned attachmentId in attachmentIds. Uploads are limited to 10 MiB each and are bound to this workspace, delegated user, and credential family.',
      parser: UploadAttachmentInput,
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: IDEMPOTENT_WRITE_TOOL,
      execute: async args =>
        toolResult(await this.upload(credential, capabilities, args)),
    });
  }

  async upload(
    credential: AttachmentCredential,
    capabilities: readonly McpCapability[],
    input: z.infer<typeof UploadAttachmentInput>
  ) {
    if (!capabilities.includes(MCP_ATTACHMENT_UPLOAD_CAPABILITY)) {
      return {
        code: 'credential_scope_denied',
        requiredCapabilities: [MCP_ATTACHMENT_UPLOAD_CAPABILITY],
      };
    }
    const copilotAllowed = await this.ac
      .user(credential.userId)
      .workspace(credential.workspaceId)
      .allowLocal()
      .can('Workspace.Copilot');
    if (!copilotAllowed) {
      return {
        code: 'permission_denied',
        missingPermission: 'Workspace.Copilot',
      };
    }

    let buffer: Buffer;
    try {
      buffer = decodeBase64(input.base64);
    } catch {
      return { code: 'attachment_invalid', reason: 'invalid_base64_or_size' };
    }
    const fileName = sanitizedFileName(input.fileName);
    const fingerprint = contentFingerprint(buffer);
    const key = blobKey(buffer);
    const mimeType =
      sniffMime(buffer, input.mimeType)?.toLowerCase() ||
      input.mimeType.toLowerCase();

    try {
      const existingBlob = await this.models.blob.get(
        credential.workspaceId,
        key
      );
      const existingMetadata =
        existingBlob?.status === 'completed' && !existingBlob.deletedAt
          ? await this.storage.head(credential.workspaceId, key)
          : null;
      if (
        !existingMetadata ||
        existingMetadata.contentLength !== buffer.length
      ) {
        await this.resolver.setBlob(
          { id: credential.userId } as never,
          credential.workspaceId,
          {
            filename: key,
            mimetype: mimeType,
            encoding: 'base64',
            createReadStream: () => Readable.from(buffer),
          }
        );
        if (existingBlob?.deletedAt) {
          await this.models.blob.restore(credential.workspaceId, key);
        }
      } else {
        await this.ac
          .user(credential.userId)
          .workspace(credential.workspaceId)
          .assert('Workspace.Blobs.Write');
      }

      const created =
        await this.models.copilotMcpDelegation.createOrReuseAttachment({
          id: randomUUID(),
          workspaceId: credential.workspaceId,
          actorId: credential.userId,
          credentialId: credential.id,
          credentialFamilyId: credential.familyId,
          credentialGeneration: credential.generation,
          idempotencyKey: input.idempotencyKey,
          fileName,
          mimeType,
          blobKey: key,
          byteSize: buffer.length,
          contentFingerprint: fingerprint,
        });
      return {
        attachmentId: created.record.id,
        fileName: created.record.fileName,
        mimeType: created.record.mimeType,
        size: created.record.byteSize,
        contentFingerprint: created.record.contentFingerprint,
        idempotentReplay: created.reused,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('idempotency key was already used')
      ) {
        return { code: 'idempotency_conflict' };
      }
      this.logger.warn(
        `MCP attachment upload failed for ${credential.workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  async authorizeReferences(input: {
    workspaceId: string;
    actorId: string;
    credentialFamilyId: string;
    attachmentIds: string[];
  }) {
    if (!input.attachmentIds.length) return [];
    const readable = await this.ac
      .user(input.actorId)
      .workspace(input.workspaceId)
      .allowLocal()
      .can('Workspace.Blobs.Read');
    if (!readable) {
      throw new McpAttachmentReferenceError(
        'permission_denied',
        {
          code: 'permission_denied',
          missingPermission: 'Workspace.Blobs.Read',
        },
        'The delegated user cannot read workspace attachments.'
      );
    }

    const records =
      await this.models.copilotMcpDelegation.getAttachmentsForCredentialFamily({
        ids: input.attachmentIds,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        credentialFamilyId: input.credentialFamilyId,
      });
    const byId = new Map(records.map(record => [record.id, record]));
    const missing = input.attachmentIds.find(id => !byId.has(id));
    if (missing) {
      throw new McpAttachmentReferenceError(
        'resource_not_accessible',
        { code: 'resource_not_accessible', attachmentId: missing },
        `MCP attachment is not accessible: ${missing}`
      );
    }
    return input.attachmentIds.map(id => byId.get(id) as AiMcpAttachment);
  }

  async materialize(input: {
    workspaceId: string;
    actorId: string;
    credentialFamilyId: string;
    attachmentIds: string[];
  }): Promise<MaterializedMcpAttachments> {
    if (input.attachmentIds.length > MAX_ATTACHMENT_COUNT) {
      throw new McpAttachmentReferenceError(
        'failed',
        { code: 'attachment_limit_exceeded' },
        'Too many delegated attachments.'
      );
    }
    const records = await this.authorizeReferences(input);
    if (!records.length) {
      return { context: [], promptAttachments: [], records: [] };
    }
    const totalBytes = records.reduce(
      (sum, record) => sum + record.byteSize,
      0
    );
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new McpAttachmentReferenceError(
        'failed',
        { code: 'attachment_total_size_exceeded' },
        'Delegated attachments exceed the combined size limit.'
      );
    }

    let remainingContextLength = MAX_ATTACHMENT_CONTEXT_LENGTH;
    const context: MaterializedMcpAttachments['context'] = [];
    const promptAttachments: PromptAttachment[] = [];
    for (const record of records) {
      const buffer = await this.readVerified(record);
      try {
        const parsed = await parseDoc(record.fileName, buffer);
        let extractedText = '';
        let hasText = false;
        let extractedTextTruncated = false;
        for (const chunk of parsed.chunks.toSorted(
          (a, b) => a.index - b.index
        )) {
          const text = chunk.content.trim();
          if (!text) continue;
          hasText = true;
          if (!remainingContextLength) {
            extractedTextTruncated = true;
            break;
          }
          const candidate = `${extractedText ? '\n' : ''}${text}`;
          const included = candidate.slice(0, remainingContextLength);
          extractedText += included;
          remainingContextLength -= included.length;
          if (included.length < candidate.length) {
            extractedTextTruncated = true;
            break;
          }
        }
        if (hasText) {
          context.push({
            attachmentId: record.id,
            fileName: record.fileName,
            mimeType: record.mimeType,
            byteSize: record.byteSize,
            contentFingerprint: record.contentFingerprint,
            ...(extractedText ? { extractedText } : {}),
            ...(extractedTextTruncated ? { extractedTextTruncated: true } : {}),
          });
          continue;
        }
      } catch {
        // Images and provider-native file types are supplied as bounded bytes.
      }

      promptAttachments.push({
        kind: 'bytes',
        data: buffer.toString('base64'),
        encoding: 'base64',
        mimeType: record.mimeType,
        fileName: record.fileName,
      });
      context.push({
        attachmentId: record.id,
        fileName: record.fileName,
        mimeType: record.mimeType,
        byteSize: record.byteSize,
        contentFingerprint: record.contentFingerprint,
        suppliedToModel: true,
      });
    }

    return { context, promptAttachments, records };
  }

  private async readVerified(record: AiMcpAttachment) {
    const stored = await this.storage.get(record.workspaceId, record.blobKey);
    if (!stored.body) {
      throw new McpAttachmentReferenceError(
        'resource_not_accessible',
        { code: 'resource_not_accessible', attachmentId: record.id },
        `MCP attachment blob is unavailable: ${record.id}`
      );
    }
    const buffer = await readStream(stored.body, MAX_ATTACHMENT_BYTES + 1);
    if (
      buffer.length !== record.byteSize ||
      contentFingerprint(buffer) !== record.contentFingerprint
    ) {
      throw new McpAttachmentReferenceError(
        'failed',
        { code: 'attachment_evidence_mismatch', attachmentId: record.id },
        `MCP attachment evidence changed after upload: ${record.id}`
      );
    }
    return buffer;
  }
}
