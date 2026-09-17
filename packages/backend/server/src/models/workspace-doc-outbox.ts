import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import type { Prisma, WorkspaceDocOutbox } from '@prisma/client';

import { BaseModel } from './base';

@Injectable()
export class WorkspaceDocOutboxModel extends BaseModel {
  add(data: Prisma.WorkspaceDocOutboxUncheckedCreateInput) {
    return this.db.workspaceDocOutbox.create({ data });
  }

  // At-least-once delivery. A crashed publisher leaves the row for a later tick.
  @Transactional<TransactionalAdapterPrisma>({ timeout: 60000 })
  async deliverBatch(deliver: (row: WorkspaceDocOutbox) => Promise<void>) {
    const rows = await this.db.$queryRaw<WorkspaceDocOutbox[]>`
      SELECT id, workspace_id AS "workspaceId", doc_id AS "docId", editor_id AS "editorId",
        "update", timestamp, created_at AS "createdAt"
      FROM workspace_doc_outbox ORDER BY created_at, id LIMIT 50 FOR UPDATE SKIP LOCKED`;
    for (const row of rows) {
      await deliver(row);
      await this.db.workspaceDocOutbox.delete({ where: { id: row.id } });
    }
    return rows.length;
  }
}
