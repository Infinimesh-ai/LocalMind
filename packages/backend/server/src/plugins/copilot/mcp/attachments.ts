import { createHash } from 'node:crypto';
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

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 8;
const MAX_ATTACHMENT_CONTEXT_LENGTH = 24_000;
const MAX_BASE64_LENGTH = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8;

export const McpInlineAttachmentInput = z
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
  })
  .strict()
  .describe('One file included directly in a LocalMind delegation task.');

export type McpInlineAttachment = z.infer<typeof McpInlineAttachmentInput>;

export type PreparedMcpInlineAttachment = {
  id: string;
  idempotencyKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  contentFingerprint: string;
  blobKey: string;
  buffer: Buffer;
};

type AttachmentCredential = Pick<
  McpCredential,
  'id' | 'familyId' | 'generation' | 'userId' | 'workspaceId'
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

export class McpInlineAttachmentError extends Error {
  constructor(
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

function inlineAttachmentIdentity(
  credential: AttachmentCredential,
  delegationIdempotencyKey: string,
  index: number
) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        version: 'localmind-mcp-inline-attachment/v1',
        workspaceId: credential.workspaceId,
        actorId: credential.userId,
        credentialFamilyId: credential.familyId,
        delegationIdempotencyKey,
        index,
      })
    )
    .digest('hex');
  return {
    id: `mcpatt_${digest}`,
    idempotencyKey: `delegate-attachment-v1:${digest}`,
  };
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

  prepareInlineAttachments(
    credential: AttachmentCredential,
    attachments: McpInlineAttachment[],
    delegationIdempotencyKey: string
  ): PreparedMcpInlineAttachment[] {
    if (attachments.length > MAX_ATTACHMENT_COUNT) {
      throw new McpInlineAttachmentError(
        { code: 'attachment_limit_exceeded' },
        'Too many inline attachments.'
      );
    }

    let totalBytes = 0;
    const prepared = attachments.map((attachment, index) => {
      let buffer: Buffer;
      try {
        buffer = decodeBase64(attachment.base64);
      } catch {
        throw new McpInlineAttachmentError(
          {
            code: 'attachment_invalid',
            attachmentIndex: index,
            reason: 'invalid_base64_or_size',
          },
          `Inline attachment ${index} is invalid.`
        );
      }
      totalBytes += buffer.length;
      const identity = inlineAttachmentIdentity(
        credential,
        delegationIdempotencyKey,
        index
      );
      const fileName = sanitizedFileName(attachment.fileName);
      const mimeType =
        sniffMime(buffer, attachment.mimeType)?.toLowerCase() ||
        attachment.mimeType.toLowerCase();
      return {
        ...identity,
        fileName,
        mimeType,
        byteSize: buffer.length,
        contentFingerprint: contentFingerprint(buffer),
        blobKey: blobKey(buffer),
        buffer,
      };
    });
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new McpInlineAttachmentError(
        { code: 'attachment_total_size_exceeded' },
        'Inline attachments exceed the combined size limit.'
      );
    }
    return prepared;
  }

  async persistInlineAttachments(
    credential: AttachmentCredential,
    prepared: PreparedMcpInlineAttachment[]
  ) {
    if (!prepared.length) return [];
    const copilotAllowed = await this.ac
      .user(credential.userId)
      .workspace(credential.workspaceId)
      .allowLocal()
      .can('Workspace.Copilot');
    if (!copilotAllowed) {
      throw new McpInlineAttachmentError(
        {
          code: 'permission_denied',
          missingPermission: 'Workspace.Copilot',
        },
        'The delegated user cannot persist LocalMind attachments.'
      );
    }

    const records: AiMcpAttachment[] = [];
    for (const attachment of prepared) {
      const { buffer } = attachment;
      const existingBlob = await this.models.blob.get(
        credential.workspaceId,
        attachment.blobKey
      );
      const existingMetadata =
        existingBlob?.status === 'completed' && !existingBlob.deletedAt
          ? await this.storage.head(credential.workspaceId, attachment.blobKey)
          : null;
      if (
        !existingMetadata ||
        existingMetadata.contentLength !== buffer.length
      ) {
        await this.resolver.setBlob(
          { id: credential.userId } as never,
          credential.workspaceId,
          {
            filename: attachment.blobKey,
            mimetype: attachment.mimeType,
            encoding: 'base64',
            createReadStream: () => Readable.from(buffer),
          }
        );
        if (existingBlob?.deletedAt) {
          await this.models.blob.restore(
            credential.workspaceId,
            attachment.blobKey
          );
        }
      } else {
        await this.ac
          .user(credential.userId)
          .workspace(credential.workspaceId)
          .assert('Workspace.Blobs.Write');
      }

      try {
        const created =
          await this.models.copilotMcpDelegation.createOrReuseAttachment({
            id: attachment.id,
            workspaceId: credential.workspaceId,
            actorId: credential.userId,
            credentialId: credential.id,
            credentialFamilyId: credential.familyId,
            credentialGeneration: credential.generation,
            idempotencyKey: attachment.idempotencyKey,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            blobKey: attachment.blobKey,
            byteSize: attachment.byteSize,
            contentFingerprint: attachment.contentFingerprint,
          });
        records.push(created.record);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('idempotency key was already used')
        ) {
          throw new McpInlineAttachmentError(
            { code: 'idempotency_conflict' },
            'Inline attachment idempotency evidence does not match.'
          );
        }
        this.logger.warn(
          `MCP inline attachment persistence failed for ${credential.workspaceId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        throw error;
      }
    }
    return records;
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
