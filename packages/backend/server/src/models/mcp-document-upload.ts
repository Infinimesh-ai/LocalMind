import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { McpResourceOperation } from '@prisma/client';

import { BadRequest, NotFound } from '../base';
import { ResourceError } from '../core/doc/resource-types';
import { BaseModel } from './base';

export const MCP_UPLOAD_PART_BYTES = 524288;

@Injectable()
export class McpDocumentUploadModel extends BaseModel {
  async begin(
    operation: McpResourceOperation,
    manifest: { mimeType: string; totalBytes: number; fingerprint: string }
  ) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp-upload:${operation.actorId}`}, 0))`;
    await this.expire(operation.workspaceId);
    // The caller holds the Workspace resource transaction lock. Bound staging
    // independently of permanent Blob quota so incomplete uploads cannot grow forever.
    const reserved = await this.db.mcpDocumentUpload.aggregate({
      where: {
        status: 'pending',
        operation: { workspaceId: operation.workspaceId },
      },
      _sum: { totalBytes: true },
      _count: true,
    });
    if (
      reserved._count >= 16 ||
      (reserved._sum.totalBytes ?? 0) + manifest.totalBytes > 64 * 1024 * 1024
    )
      throw new ResourceError('quota_exceeded');
    const actor = await this.db.mcpDocumentUpload.aggregate({
      where: {
        status: 'pending',
        expiresAt: { gt: new Date() },
        operation: { actorId: operation.actorId },
      },
      _sum: { totalBytes: true },
      _count: true,
    });
    if (
      actor._count >= 8 ||
      (actor._sum.totalBytes ?? 0) + manifest.totalBytes > 32 * 1024 * 1024
    )
      throw new ResourceError('quota_exceeded');
    return this.db.mcpDocumentUpload.create({
      data: {
        id: operation.id,
        operationId: operation.id,
        ...manifest,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  async lock(id: string, operation: McpResourceOperation) {
    await this.db
      .$queryRaw`SELECT id FROM mcp_document_uploads WHERE id = ${id} FOR UPDATE`;
    const upload = await this.db.mcpDocumentUpload.findUnique({
      where: { id },
      include: { operation: true, parts: { orderBy: { number: 'asc' } } },
    });
    if (
      !upload ||
      [
        'workspaceId',
        'actorId',
        'credentialFamilyId',
        'resourceKind',
        'resourceId',
      ].some(
        key =>
          upload.operation[key as keyof McpResourceOperation] !==
          operation[key as keyof McpResourceOperation]
      )
    )
      throw new NotFound('Upload unavailable');
    if (upload.expiresAt <= new Date() && upload.status === 'pending')
      throw new BadRequest('Upload expired; start a new upload');
    return upload;
  }

  async part(
    upload: Awaited<ReturnType<McpDocumentUploadModel['lock']>>,
    number: number,
    bytes: Buffer
  ) {
    if (upload.status !== 'pending') throw new BadRequest('Upload is terminal');
    const offset = number * MCP_UPLOAD_PART_BYTES;
    if (
      bytes.length !==
        Math.min(MCP_UPLOAD_PART_BYTES, upload.totalBytes - offset) ||
      !bytes.length
    )
      throw new BadRequest('Unexpected upload part size');
    const previous = upload.parts.find(part => part.number === number);
    if (previous) {
      if (!bytes.equals(previous.bytes))
        throw new BadRequest('Upload part already has different bytes');
      return false;
    }
    await this.db.mcpDocumentUploadPart.create({
      data: { uploadId: upload.id, number, bytes },
    });
    return true;
  }

  async finish(id: string, status: 'completed' | 'aborted', blobId?: string) {
    const changed = await this.db.mcpDocumentUpload.updateMany({
      where: { id, status: 'pending' },
      data: { status, blobId },
    });
    if (changed.count !== 1) throw new BadRequest('Upload is terminal');
    await this.db.mcpDocumentUploadPart.deleteMany({ where: { uploadId: id } });
  }

  @Transactional()
  async expire(workspaceId?: string) {
    // Metadata remains immutable evidence; only staged bytes are reclaimed.
    const expired = await this.db.$queryRaw<
      { id: string }[]
    >`SELECT u.id FROM mcp_document_uploads u
      JOIN mcp_resource_operations o ON o.id = u.operation_id
      WHERE u.status = 'pending' AND u.expires_at <= NOW()
      AND (${workspaceId ?? null}::text IS NULL OR o.workspace_id = ${workspaceId ?? null})
      ORDER BY u.expires_at, u.id LIMIT 100 FOR UPDATE OF u SKIP LOCKED`;
    const ids = expired.map(row => row.id);
    if (!ids.length) return 0;
    await this.db.mcpDocumentUpload.updateMany({
      where: {
        id: { in: ids },
        status: 'pending',
        expiresAt: { lte: new Date() },
        ...(workspaceId ? { operation: { workspaceId } } : {}),
      },
      data: { status: 'expired' },
    });
    await this.db.mcpDocumentUploadPart.deleteMany({
      where: {
        uploadId: { in: ids },
        upload: {
          status: 'expired',
          ...(workspaceId ? { operation: { workspaceId } } : {}),
        },
      },
    });
    return ids.length;
  }
}
