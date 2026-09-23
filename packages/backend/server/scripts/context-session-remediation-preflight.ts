import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

type CountRow = { count: bigint };
type ExistsRow = { exists: boolean };

async function tableExists(table: string) {
  const [row] = await db.$queryRawUnsafe<ExistsRow[]>(
    `SELECT to_regclass('public.${table}') IS NOT NULL AS exists`
  );
  return row?.exists === true;
}

async function columnExists(table: string, column: string) {
  const [row] = await db.$queryRaw<ExistsRow[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `;
  return row?.exists === true;
}

async function count(sql: string) {
  const [row] = await db.$queryRawUnsafe<CountRow[]>(sql);
  return Number(row?.count ?? 0n);
}

try {
  const hasMigrations = await tableExists('_prisma_migrations');
  const hasMemories = await tableExists('ai_context_memories');
  const hasContexts = await tableExists('ai_contexts');
  const hasProjects = await tableExists('ai_context_projects');
  const hasProjectSettings = await tableExists('ai_project_memory_settings');
  const hasQuarantine = await tableExists('ai_context_upgrade_quarantines');
  const hasSessionDeletion = await tableExists('ai_session_deletions');
  const hasCheckpointPointers = await tableExists(
    'ai_context_checkpoint_pointers'
  );
  const hasCompactionTasks = await tableExists('ai_context_compaction_tasks');
  const hasSessionBlobReferences = await tableExists(
    'ai_session_project_blob_references'
  );
  const hasArchiveBatches = await tableExists('localmind_log_archive_batches');
  const hasRecoveryBarrierReceipts = await tableExists(
    'context_session_recovery_barrier_receipts'
  );
  const hasWriterVersion =
    hasMemories &&
    (await columnExists('ai_context_memories', 'writer_version'));

  const migrations = hasMigrations
    ? await db.$queryRaw<
        Array<{
          migrationName: string;
          finished: boolean;
          rolledBack: boolean;
        }>
      >`
        SELECT migration_name AS "migrationName",
          finished_at IS NOT NULL AS finished,
          rolled_back_at IS NOT NULL AS "rolledBack"
        FROM "_prisma_migrations"
        WHERE migration_name IN (
          '20260921010000_private_project_memory_and_session_context',
          '20260921020000_shared_project_memory_contract',
          '20260921030000_immutable_context_checkpoints',
          '20260921040000_shared_memory_supersession_provenance',
          '20260921050000_account_delete_project_session_order',
          '20260921060000_account_delete_project_authorship_guard',
          '20260921070000_session_purge_source_evidence_guard',
          '20260921080000_session_purge_shared_write_redaction_guard',
          '20260921090000_immutable_context_checkpoint_guard',
          '20260921100000_account_delete_private_session_evidence_guard',
          '20260921110000_account_delete_private_context_order',
          '20260921120000_context_compaction_tasks',
          '20260921130000_context_compaction_outputs_events',
          '20260921140000_session_project_blob_references',
          '20260921150000_audit_archive_and_recovery_barrier'
        )
        ORDER BY migration_name
      `
    : [];

  console.log(
    JSON.stringify(
      {
        mode: 'read-only-preflight',
        migrations,
        inventory: {
          projects: hasProjects
            ? await count('SELECT count(*) AS count FROM ai_context_projects')
            : null,
          projectSettings: hasProjectSettings
            ? await count(
                'SELECT count(*) AS count FROM ai_project_memory_settings'
              )
            : null,
          projectMemories: hasMemories
            ? await count(
                "SELECT count(*) AS count FROM ai_context_memories WHERE scope = 'project'"
              )
            : null,
          legacyPrivateProjectWriterMemories: hasWriterVersion
            ? await count(
                "SELECT count(*) AS count FROM ai_context_memories WHERE scope = 'project' AND writer_version = 'structured-memory-writer/v2-user-project'"
              )
            : null,
          duplicateSessionContexts: hasContexts
            ? await count(
                'SELECT count(*) AS count FROM (SELECT session_id FROM ai_contexts GROUP BY session_id HAVING count(*) > 1) duplicates'
              )
            : null,
          quarantinedRows: hasQuarantine
            ? await count(
                'SELECT count(*) AS count FROM ai_context_upgrade_quarantines'
              )
            : null,
          pendingSessionPurges: hasSessionDeletion
            ? await count(
                "SELECT count(*) AS count FROM ai_session_deletions WHERE status IN ('requested', 'purging', 'retry_wait')"
              )
            : null,
          checkpointPointers: hasCheckpointPointers
            ? await count(
                'SELECT count(*) AS count FROM ai_context_checkpoint_pointers'
              )
            : null,
          pendingContextCompactions: hasCompactionTasks
            ? await count(
                "SELECT count(*) AS count FROM ai_context_compaction_tasks WHERE status IN ('queued', 'running', 'retry_wait')"
              )
            : null,
          sessionProjectBlobReferences: hasSessionBlobReferences
            ? await count(
                'SELECT count(*) AS count FROM ai_session_project_blob_references'
              )
            : null,
          pendingArchiveBatches: hasArchiveBatches
            ? await count(
                "SELECT count(*) AS count FROM localmind_log_archive_batches WHERE status IN ('pending', 'running', 'retry_wait')"
              )
            : null,
          appliedRecoveryBarriers: hasRecoveryBarrierReceipts
            ? await count(
                'SELECT count(*) AS count FROM context_session_recovery_barrier_receipts'
              )
            : null,
        },
        decision: {
          privateWriterRowsRequireReview: hasWriterVersion
            ? (await count(
                "SELECT count(*) AS count FROM ai_context_memories WHERE scope = 'project' AND writer_version = 'structured-memory-writer/v2-user-project'"
              )) > 0
            : false,
          safeToAutoPublishQuarantinedPrivateRows: false,
        },
      },
      null,
      2
    )
  );
} finally {
  await db.$disconnect();
}
