import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { McpResourceOperation, Prisma } from '@prisma/client';

import { BaseModel } from './base';
import {
  permissionDocumentLockKey,
  permissionWorkspaceLockKey,
} from './permission-write';

export type ResourceOperationIdentity = Pick<
  McpResourceOperation,
  | 'workspaceId'
  | 'actorId'
  | 'credentialFamilyId'
  | 'toolName'
  | 'idempotencyKey'
>;

@Injectable()
export class McpResourceOperationModel extends BaseModel {
  @Transactional()
  async receive(
    input: ResourceOperationIdentity &
      Pick<
        McpResourceOperation,
        | 'contractVersion'
        | 'credentialId'
        | 'requestFingerprint'
        | 'documentId'
        | 'folderId'
        | 'parentId'
      >
  ) {
    // INSERT ON CONFLICT waits for a concurrent first receipt without the
    // find/create race of Prisma's emulated upsert with an empty update.
    await this.db.mcpResourceOperation.createMany({
      data: [input],
      skipDuplicates: true,
    });
    const operation = await this.db.mcpResourceOperation.findUniqueOrThrow({
      where: {
        workspaceId_actorId_credentialFamilyId_toolName_idempotencyKey: {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          credentialFamilyId: input.credentialFamilyId,
          toolName: input.toolName,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    await this.db.mcpResourceOperationEvent.createMany({
      data: [{ operationId: operation.id, sequence: 0, status: 'processing' }],
      skipDuplicates: true,
    });
    return operation;
  }

  get(id: string) {
    return this.db.mcpResourceOperation.findUnique({ where: { id } });
  }

  async tryLock(id: string) {
    const rows = await this.db.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${`mcp-resource:${id}`}, 0)) AS locked`;
    return rows[0]?.locked === true;
  }

  async lockAuthority(input: {
    workspaceId: string;
    actorId: string;
    credentialId: string;
    documentId?: string | null;
  }) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${permissionWorkspaceLockKey(input.workspaceId)}, 0))`;
    if (input.documentId)
      await this.db
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${permissionDocumentLockKey(input.workspaceId, input.documentId)}, 0))`;
    // Row locks serialize revocation/user disable with the final authorization check.
    await this.db
      .$queryRaw`SELECT id FROM users WHERE id = ${input.actorId} FOR SHARE`;
    await this.db
      .$queryRaw`SELECT id FROM mcp_credentials WHERE id = ${input.credentialId} FOR SHARE`;
  }

  @Transactional()
  async noteUncertain(id: string) {
    if (!(await this.tryLock(id))) return;
    const updated = await this.db.mcpResourceOperation.updateMany({
      where: { id, status: 'processing' },
      data: { status: 'needs_reconciliation' },
    });
    if (updated.count) await this.appendEvent(id, 'needs_reconciliation');
  }

  async finish(
    id: string,
    status: 'succeeded' | 'failed',
    result: Prisma.InputJsonValue,
    errorCode?: string
  ) {
    const updated = await this.db.mcpResourceOperation.updateMany({
      where: { id, status: { in: ['processing', 'needs_reconciliation'] } },
      data: { status, result, errorCode, completedAt: new Date() },
    });
    if (updated.count !== 1)
      throw new Error('Resource operation is already terminal');
    await this.appendEvent(id, status, errorCode);
    return await this.db.mcpResourceOperation.findUniqueOrThrow({
      where: { id },
    });
  }

  async appendEvent(operationId: string, status: string, errorCode?: string) {
    const last = await this.db.mcpResourceOperationEvent.findFirst({
      where: { operationId },
      orderBy: { sequence: 'desc' },
    });
    await this.db.mcpResourceOperationEvent.create({
      data: {
        operationId,
        sequence: (last?.sequence ?? -1) + 1,
        status,
        errorCode,
      },
    });
  }

  external(
    workspaceId: string,
    credentialFamilyId: string,
    externalId: string
  ) {
    return this.db.mcpResourceExternalDocument.findUnique({
      where: {
        workspaceId_credentialFamilyId_externalId: {
          workspaceId,
          credentialFamilyId,
          externalId,
        },
      },
    });
  }

  bindExternal(input: {
    workspaceId: string;
    credentialFamilyId: string;
    externalId: string;
    documentId: string;
    operationId: string;
  }) {
    return this.db.mcpResourceExternalDocument.create({ data: input });
  }
}
