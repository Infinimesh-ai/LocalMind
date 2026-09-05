import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

const PHASE_MIGRATION = '20260904010000_intelligence_workbench_phase_1';
const EXPECTED_PRIOR_MIGRATIONS = 317;
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(serverRoot, '../../..');
const sourceMigrationsRoot = join(serverRoot, 'migrations');

type SqlClient = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe'>;

function databaseUrl(baseUrl: string, databaseName: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function createClient(url: string) {
  return new PrismaClient({
    datasources: {
      db: { url },
    },
  });
}

function migrationFailureOutput(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const processError = error as Error & {
    stderr?: Buffer | string;
    stdout?: Buffer | string;
  };
  return [processError.message, processError.stdout, processError.stderr]
    .filter(Boolean)
    .map(value => value?.toString())
    .join('\n');
}

function deployMigrations(schemaPath: string, url: string) {
  return execFileSync(
    'yarn',
    [
      'affine',
      '@affine/server',
      'prisma',
      'migrate',
      'deploy',
      '--schema',
      schemaPath,
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: url,
        NODE_ENV: 'test',
      },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

function prepareMigrationTree() {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), 'localmind-intelligence-workbench-phase1-')
  );
  const temporaryServerRoot = join(temporaryRoot, 'server');
  const temporaryMigrationsRoot = join(temporaryServerRoot, 'migrations');
  mkdirSync(temporaryMigrationsRoot, { recursive: true });
  copyFileSync(
    join(serverRoot, 'schema.prisma'),
    join(temporaryServerRoot, 'schema.prisma')
  );
  copyFileSync(
    join(sourceMigrationsRoot, 'migration_lock.toml'),
    join(temporaryMigrationsRoot, 'migration_lock.toml')
  );

  const priorMigrations = readdirSync(sourceMigrationsRoot, {
    withFileTypes: true,
  })
    .filter(entry => entry.isDirectory() && entry.name < PHASE_MIGRATION)
    .map(entry => entry.name)
    .sort();
  assert.equal(
    priorMigrations.length,
    EXPECTED_PRIOR_MIGRATIONS,
    'Phase 1 must be validated from the expected 317-migration prior state'
  );
  for (const migration of priorMigrations) {
    cpSync(
      join(sourceMigrationsRoot, migration),
      join(temporaryMigrationsRoot, migration),
      { recursive: true }
    );
  }

  return {
    addPhaseMigration() {
      cpSync(
        join(sourceMigrationsRoot, PHASE_MIGRATION),
        join(temporaryMigrationsRoot, PHASE_MIGRATION),
        { recursive: true }
      );
    },
    cleanup() {
      rmSync(temporaryRoot, { force: true, recursive: true });
    },
    priorMigrationCount: priorMigrations.length,
    schemaPath: join(temporaryServerRoot, 'schema.prisma'),
  };
}

async function executeStatements(client: PrismaClient, statements: string[]) {
  await client.$transaction(
    async transaction => {
      for (const statement of statements) {
        await transaction.$executeRawUnsafe(statement);
      }
    },
    { timeout: 30_000 }
  );
}

async function seedSuccessfulPriorState(client: PrismaClient) {
  await executeStatements(client, [
    // The historical schema admits one active workspace owner. D3 requires
    // set-based fallback to every active owner, so this fixture deliberately
    // widens only that legacy index and restores it after the assertion.
    'DROP INDEX "workspace_members_active_owner_key"',
    `
      INSERT INTO "users" ("id", "name", "email") VALUES
        ('iw-creator', 'Creator', 'iw-creator@example.invalid'),
        ('iw-collaborator', 'Collaborator', 'iw-collaborator@example.invalid'),
        ('iw-deleted-creator', 'Deleted creator', 'iw-deleted@example.invalid'),
        ('iw-fallback-owner-a', 'Fallback owner A', 'iw-fallback-a@example.invalid'),
        ('iw-fallback-owner-b', 'Fallback owner B', 'iw-fallback-b@example.invalid'),
        ('iw-suspended-owner', 'Suspended owner', 'iw-suspended@example.invalid')
    `,
    `
      INSERT INTO "workspaces" ("id") VALUES
        ('iw-workspace-created'),
        ('iw-workspace-orphaned')
    `,
    `
      INSERT INTO "workspace_members" (
        "id", "workspace_id", "user_id", "role", "state", "source"
      ) VALUES
        ('iw-member-creator', 'iw-workspace-created', 'iw-creator', 'owner', 'active', 'system'),
        ('iw-member-collaborator', 'iw-workspace-created', 'iw-collaborator', 'member', 'active', 'system'),
        ('iw-member-deleted', 'iw-workspace-orphaned', 'iw-deleted-creator', 'member', 'active', 'system'),
        ('iw-member-fallback-a', 'iw-workspace-orphaned', 'iw-fallback-owner-a', 'owner', 'active', 'system'),
        ('iw-member-fallback-b', 'iw-workspace-orphaned', 'iw-fallback-owner-b', 'owner', 'active', 'system'),
        ('iw-member-suspended', 'iw-workspace-orphaned', 'iw-suspended-owner', 'owner', 'suspended', 'system')
    `,
    `
      INSERT INTO "ai_context_projects" (
        "id", "workspace_id", "created_by_user_id", "name", "created_at", "updated_at"
      ) VALUES
        (
          'iw-project-created',
          'iw-workspace-created',
          'iw-creator',
          'Created project',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z'
        ),
        (
          'iw-project-orphaned',
          'iw-workspace-orphaned',
          'iw-deleted-creator',
          'Orphaned project',
          '2026-01-02T00:00:00Z',
          '2026-01-02T00:00:00Z'
        )
    `,
    `
      INSERT INTO "ai_context_project_docs" (
        "project_id", "doc_id", "created_at"
      ) VALUES
        ('iw-project-created', 'iw-doc-b', '2026-01-02T00:00:00Z'),
        ('iw-project-created', 'iw-doc-a', '2026-01-01T00:00:00Z'),
        ('iw-project-orphaned', 'iw-doc-orphaned', '2026-01-03T00:00:00Z')
    `,
    `
      INSERT INTO "ai_prompts_metadata" (
        "name", "action", "model", "config", "optional_models"
      ) VALUES ('iw-migration-smoke', 'chat', 'test', '{}', ARRAY['test'])
    `,
    `
      INSERT INTO "ai_sessions_metadata" (
        "id", "user_id", "workspace_id", "doc_id", "prompt_name",
        "selected_context_project_id", "prompt_action"
      ) VALUES
        (
          'iw-session-created-owner',
          'iw-creator',
          'iw-workspace-created',
          NULL,
          'iw-migration-smoke',
          'iw-project-created',
          'chat'
        ),
        (
          'iw-session-created-non-member',
          'iw-collaborator',
          'iw-workspace-created',
          NULL,
          'iw-migration-smoke',
          'iw-project-created',
          'chat'
        ),
        (
          'iw-session-fk-owner',
          'iw-creator',
          'iw-workspace-created',
          NULL,
          'iw-migration-smoke',
          'iw-project-created',
          'chat'
        ),
        (
          'iw-session-orphaned-owner',
          'iw-fallback-owner-a',
          'iw-workspace-orphaned',
          NULL,
          'iw-migration-smoke',
          'iw-project-orphaned',
          'chat'
        )
    `,
    `
      INSERT INTO "ai_context_memories" (
        "id", "owner_user_id", "workspace_id", "project_id", "scope", "kind",
        "content", "fingerprint", "fact_key", "capture_mode", "writer_version",
        "status", "valid_from", "valid_until", "created_at", "updated_at"
      ) VALUES
        (
          'iw-memory-chain-old', 'iw-creator', 'iw-workspace-created',
          'iw-project-created', 'project', 'auto_memory', 'Old chain evidence',
          'iw-chain-old-fingerprint', 'project:chain', 'explicit', 'iw-smoke/v1',
          'superseded', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
          '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'
        ),
        (
          'iw-memory-fact-old', 'iw-collaborator', 'iw-workspace-created',
          'iw-project-created', 'project', 'auto_memory', 'Older fact evidence',
          'iw-fact-old-fingerprint', 'project:duplicate-fact', 'explicit', 'iw-smoke/v1',
          'active', '2026-01-01T00:00:00Z', NULL,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        ),
        (
          'iw-memory-identity-old', 'iw-collaborator', 'iw-workspace-created',
          'iw-project-created', 'project', 'project_summary', 'Older identity evidence',
          'iw-duplicate-identity', NULL, 'manual', 'iw-smoke/v1',
          'active', '2026-01-01T00:00:00Z', NULL,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        ),
        (
          'iw-memory-orphaned', 'iw-fallback-owner-a', 'iw-workspace-orphaned',
          'iw-project-orphaned', 'project', 'auto_memory', 'Orphaned project evidence',
          'iw-orphaned-fingerprint', 'project:orphaned', 'explicit', 'iw-smoke/v1',
          'active', '2026-01-01T00:00:00Z', NULL,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        ),
        (
          'iw-memory-user', 'iw-creator', NULL,
          NULL, 'user', 'auto_memory', 'User-scoped evidence',
          'iw-user-fingerprint', 'preference:user-only', 'explicit', 'iw-smoke/v1',
          'active', '2026-01-01T00:00:00Z', NULL,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
    `,
    `
      INSERT INTO "ai_context_memories" (
        "id", "owner_user_id", "workspace_id", "project_id", "scope", "kind",
        "content", "fingerprint", "fact_key", "capture_mode", "writer_version",
        "status", "valid_from", "supersedes_id", "created_at", "updated_at"
      ) VALUES
        (
          'iw-memory-chain-new', 'iw-creator', 'iw-workspace-created',
          'iw-project-created', 'project', 'auto_memory', 'Current chain evidence',
          'iw-chain-new-fingerprint', 'project:chain', 'explicit', 'iw-smoke/v1',
          'active', '2026-02-01T00:00:00Z', 'iw-memory-chain-old',
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'
        ),
        (
          'iw-memory-fact-new', 'iw-creator', 'iw-workspace-created',
          'iw-project-created', 'project', 'auto_memory', 'Current fact evidence',
          'iw-fact-new-fingerprint', 'project:duplicate-fact', 'explicit', 'iw-smoke/v1',
          'active', '2026-03-01T00:00:00Z', NULL,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'
        ),
        (
          'iw-memory-identity-new', 'iw-creator', 'iw-workspace-created',
          'iw-project-created', 'project', 'project_summary', 'Current identity evidence',
          'iw-duplicate-identity', NULL, 'manual', 'iw-smoke/v1',
          'active', '2026-03-01T00:00:00Z', NULL,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'
        )
    `,
    `
      INSERT INTO "ai_context_memory_events" (
        "id", "owner_user_id", "workspace_id", "source_session_id", "operation",
        "memory_id", "previous_memory_id", "fact_key", "explicit", "reason_code",
        "writer_version", "decision_fingerprint", "created_at"
      ) VALUES
        (
          'iw-memory-update-event',
          'iw-creator',
          'iw-workspace-created',
          'iw-session-created-owner',
          'UPDATE',
          'iw-memory-chain-new',
          'iw-memory-chain-old',
          'project:chain',
          true,
          'migration-smoke',
          'iw-smoke/v1',
          'iw-memory-update-decision',
          '2026-02-01T00:00:00Z'
        ),
        (
          'iw-memory-fk-event',
          'iw-creator',
          'iw-workspace-created',
          'iw-session-fk-owner',
          'UPDATE',
          'iw-memory-chain-new',
          'iw-memory-chain-old',
          'project:chain',
          true,
          'migration-smoke-fk',
          'iw-smoke/v1',
          'iw-memory-fk-decision',
          '2026-02-02T00:00:00Z'
        )
    `,
    `
      INSERT INTO "ai_context_rules" (
        "id", "owner_user_id", "workspace_id", "project_id", "scope", "name",
        "application_mode", "conditions", "status", "active_revision", "created_at", "updated_at"
      ) VALUES
        (
          'iw-rule-created', 'iw-creator', 'iw-workspace-created',
          'iw-project-created', 'project', 'Created project rule', 'always',
          '{"docIds":["iw-shared-rule-doc","iw-created-rule-doc","iw-shared-rule-doc"]}'::jsonb,
          'active', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        ),
        (
          'iw-rule-orphaned', 'iw-fallback-owner-a', 'iw-workspace-orphaned',
          'iw-project-orphaned', 'project', 'Orphaned project rule', 'relevant',
          '{"docIds":["iw-orphaned-rule-doc","iw-shared-rule-doc","iw-orphaned-rule-doc"]}'::jsonb,
          'active', 1, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'
        ),
        (
          'iw-rule-user', 'iw-creator', NULL,
          NULL, 'user', 'User rule', 'always',
          '{"docIds":["iw-user-rule-doc"]}'::jsonb,
          'active', 1, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z'
        )
    `,
    `
      INSERT INTO "ai_context_rule_revisions" (
        "id", "rule_id", "revision", "content", "fingerprint",
        "created_by_user_id", "source", "created_at"
      ) VALUES
        (
          'iw-rule-created-r1', 'iw-rule-created', 1, 'Keep created project rule.',
          'iw-rule-created-fingerprint', 'iw-creator', 'manual', '2026-01-01T00:00:00Z'
        ),
        (
          'iw-rule-orphaned-r1', 'iw-rule-orphaned', 1, 'Keep orphaned project rule.',
          'iw-rule-orphaned-fingerprint', 'iw-fallback-owner-a', 'manual',
          '2026-01-02T00:00:00Z'
        ),
        (
          'iw-rule-user-r1', 'iw-rule-user', 1, 'Delete this user rule with its owner.',
          'iw-rule-user-fingerprint', 'iw-creator', 'manual', '2026-01-03T00:00:00Z'
        )
    `,
    `
      INSERT INTO "ai_context_rule_hits" (
        "id", "rule_id", "revision_id", "session_id", "match_reason", "score"
      ) VALUES
        (
          'iw-rule-created-hit', 'iw-rule-created', 'iw-rule-created-r1',
          'iw-session-created-owner', 'always', 1
        ),
        (
          'iw-rule-orphaned-hit', 'iw-rule-orphaned', 'iw-rule-orphaned-r1',
          'iw-session-orphaned-owner', 'semantic', 0.8
        )
    `,
    `DELETE FROM "users" WHERE "id" = 'iw-deleted-creator'`,
  ]);
}

async function seedNoOwnerPriorState(client: PrismaClient) {
  await executeStatements(client, [
    `
      INSERT INTO "users" ("id", "name", "email")
      VALUES ('iw-no-owner-user', 'No owner', 'iw-no-owner@example.invalid')
    `,
    `INSERT INTO "workspaces" ("id") VALUES ('iw-no-owner-workspace')`,
    `
      INSERT INTO "workspace_members" (
        "id", "workspace_id", "user_id", "role", "state", "source"
      ) VALUES (
        'iw-no-owner-member', 'iw-no-owner-workspace', 'iw-no-owner-user',
        'owner', 'active', 'system'
      )
    `,
    `
      INSERT INTO "ai_context_projects" (
        "id", "workspace_id", "created_by_user_id", "name"
      ) VALUES (
        'iw-no-owner-project', 'iw-no-owner-workspace', 'iw-no-owner-user',
        'Must fail before DDL'
      )
    `,
    `DELETE FROM "users" WHERE "id" = 'iw-no-owner-user'`,
  ]);
}

async function query<T>(client: SqlClient, statement: string) {
  return client.$queryRawUnsafe<T[]>(statement);
}

async function expectDatabaseRejection(
  operation: () => Promise<unknown>,
  description: string,
  expectedError = /project.*owner|owner.*project|ai_context_project/i
) {
  let rejected: unknown;
  try {
    await operation();
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected, `${description} must fail closed`);
  assert.match(
    rejected instanceof Error ? rejected.message : String(rejected),
    expectedError,
    `${description} must fail with the expected database invariant`
  );
}

async function assertSuccessfulUpgrade(client: PrismaClient) {
  const migrationState = await query<{
    applied: number;
    phaseApplied: number;
  }>(
    client,
    `
      SELECT
        count(*) FILTER (
          WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        )::int AS "applied",
        count(*) FILTER (
          WHERE "migration_name" = '${PHASE_MIGRATION}'
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        )::int AS "phaseApplied"
      FROM "_prisma_migrations"
    `
  );
  assert.deepEqual(migrationState, [
    { applied: EXPECTED_PRIOR_MIGRATIONS + 1, phaseApplied: 1 },
  ]);

  const projectOwners = await query<{
    owners: string[];
    projectId: string;
  }>(
    client,
    `
      SELECT
        "project_id" AS "projectId",
        array_agg("user_id" ORDER BY "user_id") AS "owners"
      FROM "ai_context_project_members"
      WHERE "role" = 'owner'
        AND "project_id" IN ('iw-project-created', 'iw-project-orphaned')
      GROUP BY "project_id"
      ORDER BY "project_id"
    `
  );
  assert.deepEqual(projectOwners, [
    { owners: ['iw-creator'], projectId: 'iw-project-created' },
    {
      owners: ['iw-fallback-owner-a', 'iw-fallback-owner-b'],
      projectId: 'iw-project-orphaned',
    },
  ]);

  const suspendedOwnerMembership = await query<{ count: number }>(
    client,
    `
      SELECT count(*)::int AS "count"
      FROM "ai_context_project_members"
      WHERE "project_id" = 'iw-project-orphaned'
        AND "user_id" = 'iw-suspended-owner'
    `
  );
  assert.equal(suspendedOwnerMembership[0].count, 0);

  // Restore the historical singleton workspace-owner index after the
  // set-based D3 assertion; Project ownership intentionally remains plural.
  await executeStatements(client, [
    `
      UPDATE "workspace_members"
      SET "state" = 'suspended'
      WHERE "id" = 'iw-member-fallback-b'
    `,
    `
      CREATE UNIQUE INDEX "workspace_members_active_owner_key"
      ON "workspace_members"("workspace_id")
      WHERE "role" = 'owner' AND "state" = 'active'
    `,
  ]);

  const projectColumns = await query<{ columnName: string }>(
    client,
    `
      SELECT "column_name" AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ai_context_projects'
      ORDER BY "column_name"
    `
  );
  assert.equal(
    projectColumns.some(column => column.columnName === 'workspace_id'),
    false
  );

  const documents = await query<{
    docId: string;
    projectId: string;
    sortOrder: number;
    workspaceId: string;
  }>(
    client,
    `
      SELECT
        "project_id" AS "projectId",
        "workspace_id" AS "workspaceId",
        "doc_id" AS "docId",
        "sort_order" AS "sortOrder"
      FROM "ai_context_project_docs"
      ORDER BY "project_id", "sort_order", "doc_id"
    `
  );
  assert.deepEqual(documents, [
    {
      docId: 'iw-doc-a',
      projectId: 'iw-project-created',
      sortOrder: 0,
      workspaceId: 'iw-workspace-created',
    },
    {
      docId: 'iw-doc-b',
      projectId: 'iw-project-created',
      sortOrder: 1,
      workspaceId: 'iw-workspace-created',
    },
    {
      docId: 'iw-doc-orphaned',
      projectId: 'iw-project-orphaned',
      sortOrder: 0,
      workspaceId: 'iw-workspace-orphaned',
    },
  ]);

  const memoryRows = await query<{
    content: string;
    id: string;
    status: string;
    supersedesId: string | null;
    validUntil: Date | null;
    workspaceId: string | null;
  }>(
    client,
    `
      SELECT
        "id",
        "content",
        "status",
        "workspace_id" AS "workspaceId",
        "supersedes_id" AS "supersedesId",
        "valid_until" AS "validUntil"
      FROM "ai_context_memories"
      WHERE "id" LIKE 'iw-memory-%'
      ORDER BY "id"
    `
  );
  assert.equal(memoryRows.length, 8);
  assert.ok(memoryRows.every(memory => memory.workspaceId === null));
  assert.equal(
    memoryRows.find(memory => memory.id === 'iw-memory-chain-new')
      ?.supersedesId,
    'iw-memory-chain-old'
  );
  for (const duplicateId of ['iw-memory-fact-old', 'iw-memory-identity-old']) {
    const duplicate = memoryRows.find(memory => memory.id === duplicateId);
    assert.equal(duplicate?.status, 'superseded');
    assert.ok(duplicate?.validUntil instanceof Date);
  }
  assert.equal(
    memoryRows.find(memory => memory.id === 'iw-memory-fact-new')?.status,
    'active'
  );
  assert.equal(
    memoryRows.find(memory => memory.id === 'iw-memory-identity-new')?.status,
    'active'
  );
  assert.deepEqual(memoryRows.map(memory => memory.content).sort(), [
    'Current chain evidence',
    'Current fact evidence',
    'Current identity evidence',
    'Old chain evidence',
    'Older fact evidence',
    'Older identity evidence',
    'Orphaned project evidence',
    'User-scoped evidence',
  ]);

  const projectIndexes = await query<{ indexName: string }>(
    client,
    `
      SELECT "indexname" AS "indexName"
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND "indexname" IN (
          'ai_context_memories_project_active_fact_key',
          'ai_context_memories_project_active_identity_key'
        )
      ORDER BY "indexname"
    `
  );
  assert.deepEqual(
    projectIndexes.map(index => index.indexName),
    [
      'ai_context_memories_project_active_fact_key',
      'ai_context_memories_project_active_identity_key',
    ]
  );

  const retainedEvidence = await query<{
    memoryEvents: number;
    ruleHits: number;
    ruleRevisions: number;
    rules: number;
    rulesWithWorkspace: number;
  }>(
    client,
    `
      SELECT
        (SELECT count(*)::int FROM "ai_context_rules" WHERE "id" LIKE 'iw-rule-%') AS "rules",
        (
          SELECT count(*)::int
          FROM "ai_context_rules"
          WHERE "id" LIKE 'iw-rule-%' AND "workspace_id" IS NOT NULL
        ) AS "rulesWithWorkspace",
        (
          SELECT count(*)::int
          FROM "ai_context_rule_revisions"
          WHERE "id" LIKE 'iw-rule-%'
        ) AS "ruleRevisions",
        (
          SELECT count(*)::int
          FROM "ai_context_rule_hits"
          WHERE "id" LIKE 'iw-rule-%'
        ) AS "ruleHits",
        (
          SELECT count(*)::int
          FROM "ai_context_memory_events"
          WHERE "id" = 'iw-memory-update-event'
            AND "workspace_id" = 'iw-workspace-created'
        ) AS "memoryEvents"
    `
  );
  assert.deepEqual(retainedEvidence, [
    {
      memoryEvents: 1,
      ruleHits: 2,
      ruleRevisions: 3,
      rules: 3,
      rulesWithWorkspace: 0,
    },
  ]);

  const migratedRuleDocuments = await query<{
    documentRefs: Array<{ docId: string; workspaceId: string }>;
    hasLegacyDocIds: boolean;
    id: string;
  }>(
    client,
    `
      SELECT
        "id",
        "conditions" ? 'docIds' AS "hasLegacyDocIds",
        "conditions"->'documentRefs' AS "documentRefs"
      FROM "ai_context_rules"
      WHERE "id" IN ('iw-rule-created', 'iw-rule-orphaned')
      ORDER BY "id"
    `
  );
  assert.deepEqual(migratedRuleDocuments, [
    {
      documentRefs: [
        {
          docId: 'iw-shared-rule-doc',
          workspaceId: 'iw-workspace-created',
        },
        {
          docId: 'iw-created-rule-doc',
          workspaceId: 'iw-workspace-created',
        },
      ],
      hasLegacyDocIds: false,
      id: 'iw-rule-created',
    },
    {
      documentRefs: [
        {
          docId: 'iw-orphaned-rule-doc',
          workspaceId: 'iw-workspace-orphaned',
        },
        {
          docId: 'iw-shared-rule-doc',
          workspaceId: 'iw-workspace-orphaned',
        },
      ],
      hasLegacyDocIds: false,
      id: 'iw-rule-orphaned',
    },
  ]);

  const selectedProjects = await query<{
    id: string;
    projectId: string | null;
  }>(
    client,
    `
      SELECT "id", "selected_context_project_id" AS "projectId"
      FROM "ai_sessions_metadata"
      WHERE "id" LIKE 'iw-session-%'
      ORDER BY "id"
    `
  );
  assert.deepEqual(selectedProjects, [
    { id: 'iw-session-created-non-member', projectId: null },
    {
      id: 'iw-session-created-owner',
      projectId: 'iw-project-created',
    },
    {
      id: 'iw-session-fk-owner',
      projectId: 'iw-project-created',
    },
    {
      id: 'iw-session-orphaned-owner',
      projectId: 'iw-project-orphaned',
    },
  ]);

  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(
        `
          UPDATE "ai_context_memory_events"
          SET "owner_user_id" = NULL
          WHERE "id" = 'iw-memory-update-event'
        `
      ),
    'clearing a retained memory event actor directly',
    /Context memory event actor is required/i
  );

  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(
        `
          UPDATE "ai_context_rule_revisions"
          SET "created_by_user_id" = NULL
          WHERE "id" = 'iw-rule-created-r1'
        `
      ),
    'clearing a retained rule revision actor directly',
    /Context rule revision actor is required/i
  );

  await executeStatements(client, [
    // Inject a historical tombstone shape without weakening either runtime
    // guard; the trigger is restored before exercising the real FK action.
    `
      ALTER TABLE "ai_context_memory_events"
      DISABLE TRIGGER "ai_context_memory_events_snapshot_guard"
    `,
    `
      UPDATE "ai_context_memory_events"
      SET "owner_user_id" = NULL
      WHERE "id" = 'iw-memory-fk-event'
    `,
    `
      ALTER TABLE "ai_context_memory_events"
      ENABLE TRIGGER "ai_context_memory_events_snapshot_guard"
    `,
  ]);
  await client.$executeRawUnsafe(
    `DELETE FROM "ai_sessions_metadata" WHERE "id" = 'iw-session-fk-owner'`
  );
  const fkClearedTombstone = await query<{
    ownerUserId: string | null;
    sourceSessionId: string | null;
  }>(
    client,
    `
      SELECT
        "owner_user_id" AS "ownerUserId",
        "source_session_id" AS "sourceSessionId"
      FROM "ai_context_memory_events"
      WHERE "id" = 'iw-memory-fk-event'
    `
  );
  assert.deepEqual(fkClearedTombstone, [
    { ownerUserId: null, sourceSessionId: null },
  ]);
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(
        `
          UPDATE "ai_context_memory_events"
          SET "reason_code" = 'tampered-after-tombstone'
          WHERE "id" = 'iw-memory-fk-event'
        `
      ),
    'changing a retained Project event snapshot after its actor was tombstoned',
    /Context memory event actor is required/i
  );

  await expectDatabaseRejection(
    () =>
      client.$transaction(transaction =>
        transaction.$executeRawUnsafe(
          `
            DELETE FROM "ai_context_project_members"
            WHERE "project_id" = 'iw-project-created'
              AND "user_id" = 'iw-creator'
          `
        )
      ),
    'deleting the last Project owner'
  );
  await expectDatabaseRejection(
    () =>
      client.$transaction(transaction =>
        transaction.$executeRawUnsafe(
          `
            UPDATE "ai_context_project_members"
            SET "role" = 'member'
            WHERE "project_id" = 'iw-project-created'
              AND "user_id" = 'iw-creator'
          `
        )
      ),
    'demoting the last Project owner'
  );
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(
        `
          INSERT INTO "ai_context_projects" (
            "id", "created_by_user_id", "name"
          ) VALUES ('iw-project-without-owner', 'iw-collaborator', 'No owner')
        `
      ),
    'creating a Project without an owner'
  );

  await executeStatements(client, [
    `
      INSERT INTO "ai_context_project_members" (
        "project_id", "user_id", "role"
      ) VALUES ('iw-project-created', 'iw-collaborator', 'owner')
    `,
    `
      UPDATE "ai_context_project_members"
      SET "role" = 'member'
      WHERE "project_id" = 'iw-project-created'
        AND "user_id" = 'iw-creator'
    `,
  ]);
  const transferredOwner = await query<{ userId: string }>(
    client,
    `
      SELECT "user_id" AS "userId"
      FROM "ai_context_project_members"
      WHERE "project_id" = 'iw-project-created' AND "role" = 'owner'
    `
  );
  assert.deepEqual(transferredOwner, [{ userId: 'iw-collaborator' }]);

  await client.$executeRawUnsafe(
    `DELETE FROM "users" WHERE "id" = 'iw-creator'`
  );
  const transferredProjectState = await query<{
    createdProjectMemories: number;
    createdProjectRules: number;
    memoryEventActorId: string | null;
    memoryEventSourceSessionId: string | null;
    projectMemoryOwners: string[];
    projectRuleOwners: string[];
    revisionCreatorId: string | null;
    userMemories: number;
    userRules: number;
  }>(
    client,
    `
      SELECT
        (
          SELECT count(*)::int
          FROM "ai_context_memories"
          WHERE "project_id" = 'iw-project-created'
        ) AS "createdProjectMemories",
        (
          SELECT array_agg(DISTINCT "owner_user_id" ORDER BY "owner_user_id")
          FROM "ai_context_memories"
          WHERE "project_id" = 'iw-project-created'
        ) AS "projectMemoryOwners",
        (
          SELECT count(*)::int
          FROM "ai_context_rules"
          WHERE "project_id" = 'iw-project-created'
        ) AS "createdProjectRules",
        (
          SELECT array_agg(DISTINCT "owner_user_id" ORDER BY "owner_user_id")
          FROM "ai_context_rules"
          WHERE "project_id" = 'iw-project-created'
        ) AS "projectRuleOwners",
        (
          SELECT count(*)::int
          FROM "ai_context_memories"
          WHERE "id" = 'iw-memory-user'
        ) AS "userMemories",
        (
          SELECT count(*)::int
          FROM "ai_context_rules"
          WHERE "id" = 'iw-rule-user'
        ) AS "userRules",
        (
          SELECT "owner_user_id"
          FROM "ai_context_memory_events"
          WHERE "id" = 'iw-memory-update-event'
        ) AS "memoryEventActorId",
        (
          SELECT "source_session_id"
          FROM "ai_context_memory_events"
          WHERE "id" = 'iw-memory-update-event'
        ) AS "memoryEventSourceSessionId",
        (
          SELECT "created_by_user_id"
          FROM "ai_context_rule_revisions"
          WHERE "id" = 'iw-rule-created-r1'
        ) AS "revisionCreatorId"
    `
  );
  assert.deepEqual(transferredProjectState, [
    {
      createdProjectMemories: 6,
      createdProjectRules: 1,
      memoryEventActorId: null,
      memoryEventSourceSessionId: null,
      projectMemoryOwners: ['iw-collaborator'],
      projectRuleOwners: ['iw-collaborator'],
      revisionCreatorId: null,
      userMemories: 0,
      userRules: 0,
    },
  ]);

  await executeStatements(client, [
    `
      INSERT INTO "users" ("id", "name", "email")
      VALUES ('iw-cascade-owner', 'Cascade owner', 'iw-cascade@example.invalid')
    `,
    `
      INSERT INTO "ai_context_projects" (
        "id", "created_by_user_id", "name"
      ) VALUES ('iw-project-cascade', 'iw-cascade-owner', 'Cascade project')
    `,
    `
      INSERT INTO "ai_context_project_members" (
        "project_id", "user_id", "role"
      ) VALUES ('iw-project-cascade', 'iw-cascade-owner', 'owner')
    `,
  ]);
  await expectDatabaseRejection(
    () =>
      client.$transaction(transaction =>
        transaction.$executeRawUnsafe(
          `DELETE FROM "users" WHERE "id" = 'iw-cascade-owner'`
        )
      ),
    'deleting a user who is the last Project owner'
  );
  await client.$executeRawUnsafe(
    `DELETE FROM "ai_context_projects" WHERE "id" = 'iw-project-cascade'`
  );
  const cascadedMembers = await query<{ count: number }>(
    client,
    `
      SELECT count(*)::int AS "count"
      FROM "ai_context_project_members"
      WHERE "project_id" = 'iw-project-cascade'
    `
  );
  assert.equal(cascadedMembers[0].count, 0);
}

async function assertNoOwnerFailsBeforeDdl(
  client: PrismaClient,
  schemaPath: string,
  url: string
) {
  let failure: unknown;
  try {
    deployMigrations(schemaPath, url);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'An orphaned Project without an active owner must fail');
  assert.match(
    migrationFailureOutput(failure),
    /Cannot globalize AI context project without an active owner/
  );

  const ddlState = await query<{
    documentWorkspaceColumn: boolean;
    memberTable: boolean;
    projectWorkspaceColumn: boolean;
  }>(
    client,
    `
      SELECT
        to_regclass('public.ai_context_project_members') IS NOT NULL AS "memberTable",
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'ai_context_project_docs'
            AND column_name = 'workspace_id'
        ) AS "documentWorkspaceColumn",
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'ai_context_projects'
            AND column_name = 'workspace_id'
        ) AS "projectWorkspaceColumn"
    `
  );
  assert.deepEqual(ddlState, [
    {
      documentWorkspaceColumn: false,
      memberTable: false,
      projectWorkspaceColumn: true,
    },
  ]);
  const orphan = await query<{
    creatorId: string | null;
    workspaceId: string;
  }>(
    client,
    `
      SELECT
        "workspace_id" AS "workspaceId",
        "created_by_user_id" AS "creatorId"
      FROM "ai_context_projects"
      WHERE "id" = 'iw-no-owner-project'
    `
  );
  assert.deepEqual(orphan, [
    { creatorId: null, workspaceId: 'iw-no-owner-workspace' },
  ]);
}

async function dropDatabase(admin: PrismaClient, databaseName: string) {
  assert.match(databaseName, /^iw_phase1_smoke_[a-z0-9_]+$/);
  await admin.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`
  );
}

async function main() {
  assert.equal(
    process.env.NODE_ENV,
    'test',
    'This destructive disposable-database smoke requires NODE_ENV=test'
  );
  const baseUrl = process.env.DATABASE_URL;
  assert.ok(baseUrl, 'DATABASE_URL is required');

  const suffix = `${process.pid}_${Date.now().toString(36)}`.toLowerCase();
  const successfulDatabase = `iw_phase1_smoke_success_${suffix}`;
  const noOwnerDatabase = `iw_phase1_smoke_no_owner_${suffix}`;
  const adminUrl = databaseUrl(baseUrl, 'postgres');
  const successfulUrl = databaseUrl(baseUrl, successfulDatabase);
  const noOwnerUrl = databaseUrl(baseUrl, noOwnerDatabase);
  const admin = createClient(adminUrl);
  const successfulClient = createClient(successfulUrl);
  const noOwnerClient = createClient(noOwnerUrl);
  const migrations = prepareMigrationTree();

  try {
    await dropDatabase(admin, successfulDatabase);
    await dropDatabase(admin, noOwnerDatabase);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${successfulDatabase}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${noOwnerDatabase}"`);

    deployMigrations(migrations.schemaPath, successfulUrl);
    deployMigrations(migrations.schemaPath, noOwnerUrl);
    await seedSuccessfulPriorState(successfulClient);
    await seedNoOwnerPriorState(noOwnerClient);

    migrations.addPhaseMigration();
    deployMigrations(migrations.schemaPath, successfulUrl);
    await assertSuccessfulUpgrade(successfulClient);
    await assertNoOwnerFailsBeforeDdl(
      noOwnerClient,
      migrations.schemaPath,
      noOwnerUrl
    );

    console.log(
      `Intelligence Workbench Phase 1 migration smoke passed: ${migrations.priorMigrationCount} prior migrations, creator/fallback ownership, compound document refs, retained and transferred Project evidence, guarded actor tombstones and FK cleanup, non-Project author cascade, Project-principal duplicate normalization, last-owner guards, and pre-DDL orphan rejection.`
    );
  } finally {
    await successfulClient.$disconnect();
    await noOwnerClient.$disconnect();
    if (process.env.KEEP_INTELLIGENCE_WORKBENCH_SMOKE_DATABASES !== '1') {
      await dropDatabase(admin, successfulDatabase);
      await dropDatabase(admin, noOwnerDatabase);
    } else {
      console.log(
        `Kept disposable databases ${successfulDatabase} and ${noOwnerDatabase}.`
      );
    }
    await admin.$disconnect();
    migrations.cleanup();
  }
}

await main();
