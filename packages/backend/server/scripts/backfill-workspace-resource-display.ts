import { pathToFileURL } from 'node:url';

import { PrismaClient } from '@prisma/client';

/** Bounded and resumable. Never reconstruct an actor from an unrelated later state timestamp. */
export async function backfillWorkspaceResourceDisplay(
  db: PrismaClient,
  after = '',
  limit = 200
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error('Batch size must be 1–500');
  const rows = await db.$queryRaw<
    { workspaceId: string; id: string; kind: string; cursor: string }[]
  >`
    SELECT workspace_id AS "workspaceId", id, kind, cursor FROM (
      SELECT workspace_id, file_id AS id, 'file' AS kind, workspace_id || ':file:' || file_id AS cursor
      FROM workspace_file_states
      UNION ALL
      SELECT workspace_id, artifact_id, 'office', workspace_id || ':office:' || artifact_id
      FROM workspace_office_states
    ) resources WHERE cursor COLLATE "C" > ${after} ORDER BY cursor COLLATE "C" LIMIT ${limit}`;
  const counts = {
    total: rows.length,
    backfilled: 0,
    alreadyRecorded: 0,
    unknownMetadata: 0,
    unknownOffice: 0,
    raced: 0,
    failed: 0,
  };
  for (const row of rows) {
    try {
      if (row.kind === 'office') {
        const state = await db.workspaceOfficeState.findUnique({
          where: { artifactId: row.id },
        });
        if (state?.lastUpdateEvent) counts.alreadyRecorded++;
        // Legacy artifact.title is mutable independently of revision evidence. Do not guess.
        else counts.unknownOffice++;
        continue;
      }
      const state = await db.workspaceFileState.findUnique({
        where: { fileId: row.id },
        include: { revision: true },
      });
      if (!state) {
        counts.raced++;
        continue;
      }
      if (state.lastUpdateEvent) {
        counts.alreadyRecorded++;
        continue;
      }
      if (state.metadataVersion !== 1) {
        counts.unknownMetadata++;
        continue;
      }
      const updated = await db.workspaceFileState.updateMany({
        where: {
          fileId: row.id,
          workspaceId: row.workspaceId,
          metadataVersion: 1,
          contentVersion: state.contentVersion,
          lastUpdateEvent: null,
        },
        data: {
          lastUpdatedAt: state.revision.createdAt,
          lastUpdatedBy: state.revision.actorId,
          lastUpdateActor: 'user',
          lastUpdateEvent: `revision:${state.revision.id}`,
        },
      });
      if (updated.count) counts.backfilled++;
      else counts.raced++;
    } catch {
      counts.failed++;
    }
  }
  return {
    ...counts,
    nextCursor: rows.length === limit ? (rows.at(-1)?.cursor ?? null) : null,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const db = new PrismaClient();
  try {
    // One batch per invocation; the operator can persist nextCursor and resume safely.
    console.log(
      JSON.stringify(
        await backfillWorkspaceResourceDisplay(
          db,
          process.argv[2] ?? '',
          Number(process.argv[3] ?? 200)
        )
      )
    );
  } finally {
    await db.$disconnect();
  }
}
