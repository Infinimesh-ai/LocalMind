import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { BaseModel } from './base';
import { permissionDocumentLockKey } from './permission-write';

@Injectable()
export class DocumentAccessModel extends BaseModel {
  async lock(workspaceId: string, docId: string) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${permissionDocumentLockKey(workspaceId, docId)}, 0))`;
  }
  async state(workspaceId: string, docId: string, offset = 0, limit = 100) {
    const policy = await this.db.docAccessPolicy.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });
    const rows = await this.db.$queryRaw<
      { digest: string; count: bigint }[]
    >`SELECT
      md5(COALESCE(jsonb_agg(jsonb_build_array(principal_type, principal_id, role, granted_by, created_at, updated_at)
        ORDER BY principal_type, principal_id)::text, '[]')) AS digest, count(*) AS count
      FROM doc_grants WHERE workspace_id = ${workspaceId} AND doc_id = ${docId}`;
    const members = await this.db.docGrant.findMany({
      where: { workspaceId, docId },
      orderBy: [{ principalType: 'asc' }, { principalId: 'asc' }],
      skip: offset,
      take: limit,
    });
    const metadata = await this.models.doc.getMeta(workspaceId, docId);
    const version = createHash('sha256')
      .update(JSON.stringify([policy, metadata?.mode, rows[0].digest]))
      .digest('hex');
    return {
      version,
      policy,
      mode: metadata?.mode,
      members,
      total: Number(rows[0].count),
    };
  }
}
