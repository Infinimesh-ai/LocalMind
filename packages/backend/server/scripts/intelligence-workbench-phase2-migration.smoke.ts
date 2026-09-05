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

const PHASE_MIGRATION = '20260904020000_intelligence_workbench_phase_2';
const EXPECTED_PRIOR_MIGRATIONS = 318;
const EXPECTED_FULL_MIGRATIONS = 319;
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
  return new PrismaClient({ datasources: { db: { url } } });
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
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

function prepareMigrationTree() {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), 'localmind-intelligence-workbench-phase2-')
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
    'Phase 2 must be validated from the expected 318-migration Phase 1 state'
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
    schemaPath: join(temporaryServerRoot, 'schema.prisma'),
  };
}

async function query<T>(client: SqlClient, statement: string) {
  return client.$queryRawUnsafe<T[]>(statement);
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

async function expectDatabaseRejection(
  operation: () => Promise<unknown>,
  description: string,
  expectedError: RegExp
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

async function seedPhase1State(client: PrismaClient) {
  await executeStatements(client, [
    `
      INSERT INTO "users" ("id", "name", "email") VALUES
        ('iw2-owner', 'Phase 2 owner', 'iw2-owner@example.invalid'),
        ('iw2-requester', 'Phase 2 requester', 'iw2-requester@example.invalid')
    `,
    `INSERT INTO "workspaces" ("id") VALUES ('iw2-workspace')`,
    `
      INSERT INTO "workspace_members" (
        "id", "workspace_id", "user_id", "role", "state", "source"
      ) VALUES (
        'iw2-workspace-owner', 'iw2-workspace', 'iw2-owner',
        'owner', 'active', 'system'
      )
    `,
    `
      INSERT INTO "ai_context_projects" (
        "id", "created_by_user_id", "name", "created_at", "updated_at"
      ) VALUES
        (
          'iw2-project', 'iw2-owner', 'Phase 1 project',
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        ),
        (
          'iw2-orphan-project', NULL, 'Phase 1 orphan project',
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
    `,
    `
      INSERT INTO "ai_context_project_members" (
        "project_id", "user_id", "role", "created_at", "updated_at"
      ) VALUES
        (
          'iw2-project', 'iw2-owner', 'owner',
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        ),
        (
          'iw2-orphan-project', 'iw2-owner', 'owner',
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
    `,
    `
      INSERT INTO "ai_context_project_docs" (
        "project_id", "workspace_id", "doc_id", "sort_order", "created_at"
      ) VALUES
        ('iw2-project', 'iw2-workspace', 'iw2-doc-a', 0, '2026-01-02T00:00:00Z'),
        ('iw2-project', 'iw2-workspace', 'iw2-doc-b', 1, '2026-01-03T00:00:00Z'),
        ('iw2-orphan-project', 'iw2-workspace', 'iw2-orphan-doc', 0, '2026-01-03T00:00:00Z')
    `,
    `
      INSERT INTO "ai_context_memories" (
        "id", "owner_user_id", "workspace_id", "project_id", "scope",
        "kind", "content", "fingerprint", "fact_key", "capture_mode",
        "writer_version", "status", "valid_from", "valid_until",
        "created_at", "updated_at"
      ) VALUES
        (
          'iw2-project-memory-active', 'iw2-owner', NULL, 'iw2-project',
          'project', 'auto_memory', 'Legacy active project memory',
          'iw2-project-memory-active-fingerprint', 'project:active',
          'explicit', 'iw2-smoke/v1', 'active', '2026-01-01T00:00:00Z', NULL,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        ),
        (
          'iw2-project-memory-superseded', 'iw2-owner', NULL, 'iw2-project',
          'project', 'auto_memory', 'Legacy superseded project memory',
          'iw2-project-memory-superseded-fingerprint', 'project:superseded',
          'explicit', 'iw2-smoke/v1', 'superseded', '2025-12-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
          '2025-12-01T00:00:00Z', '2026-01-01T00:00:00Z'
        ),
        (
          'iw2-user-memory', 'iw2-owner', NULL, NULL,
          'user', 'auto_memory', 'Unaffected user memory',
          'iw2-user-memory-fingerprint', 'user:preference',
          'explicit', 'iw2-smoke/v1', 'active', '2026-01-01T00:00:00Z', NULL,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
    `,
  ]);
}

async function assertMigrationState(
  client: PrismaClient,
  expectedApplied: number
) {
  const state = await query<{ applied: number; phaseApplied: number }>(
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
  assert.deepEqual(state, [{ applied: expectedApplied, phaseApplied: 1 }]);
}

async function assertUpgradeBackfill(client: PrismaClient) {
  await assertMigrationState(client, EXPECTED_FULL_MIGRATIONS);

  const grants = await query<{
    docId: string;
    grantor: string | null;
    level: string;
    source: string;
    status: string;
  }>(
    client,
    `
      SELECT
        "doc_id" AS "docId",
        "grantor_user_id_snapshot" AS "grantor",
        "level",
        "source",
        "status"
      FROM "ai_context_project_grants"
      WHERE "project_id" = 'iw2-project'
      ORDER BY "doc_id"
    `
  );
  assert.deepEqual(grants, [
    {
      docId: 'iw2-doc-a',
      grantor: 'iw2-owner',
      level: 'read',
      source: 'phase1_migration',
      status: 'active',
    },
    {
      docId: 'iw2-doc-b',
      grantor: 'iw2-owner',
      level: 'read',
      source: 'phase1_migration',
      status: 'active',
    },
  ]);
  const grantAudit = await query<{ count: number }>(
    client,
    `
      SELECT count(*)::int AS "count"
      FROM "ai_context_project_grant_audit_events" audit
      JOIN "ai_context_project_grants" grant_row ON grant_row."id" = audit."grant_id"
      WHERE grant_row."project_id" = 'iw2-project'
        AND audit."event_type" = 'granted'
        AND audit."source" = 'phase1_migration'
    `
  );
  assert.equal(grantAudit[0].count, 2);

  const orphanGrant = await query<{
    grantor: string | null;
    level: string;
    source: string;
  }>(
    client,
    `
      SELECT
        "grantor_user_id_snapshot" AS "grantor",
        "level",
        "source"
      FROM "ai_context_project_grants"
      WHERE "project_id" = 'iw2-orphan-project'
        AND "workspace_id" = 'iw2-workspace'
        AND "doc_id" = 'iw2-orphan-doc'
    `
  );
  assert.deepEqual(orphanGrant, [
    { grantor: null, level: 'read', source: 'phase1_migration' },
  ]);

  const memories = await query<{
    id: string;
    quarantineReason: string | null;
    quarantined: boolean;
    status: string;
  }>(
    client,
    `
      SELECT
        "id",
        "status",
        "quarantine_reason" AS "quarantineReason",
        "quarantined_at" IS NOT NULL AS "quarantined"
      FROM "ai_context_memories"
      WHERE "id" LIKE 'iw2-%-memory%'
      ORDER BY "id"
    `
  );
  assert.deepEqual(memories, [
    {
      id: 'iw2-project-memory-active',
      quarantineReason: 'missing_source_provenance',
      quarantined: true,
      status: 'disabled',
    },
    {
      id: 'iw2-project-memory-superseded',
      quarantineReason: 'missing_source_provenance',
      quarantined: true,
      status: 'superseded',
    },
    {
      id: 'iw2-user-memory',
      quarantineReason: null,
      quarantined: false,
      status: 'active',
    },
  ]);

  const indexes = await query<{ indexName: string }>(
    client,
    `
      SELECT "indexname" AS "indexName"
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND "indexname" IN (
          'access_requests_workspace_id_doc_id_status_updated_at_idx',
          'access_requests_beneficiary_user_id_status_updated_at_idx',
          'access_requests_beneficiary_project_id_status_updated_at_idx',
          'access_requests_requester_user_id_status_updated_at_idx',
          'ai_context_memory_sources_workspace_id_memory_id_idx',
          'ai_context_project_invitations_invitee_user_id_status_updat_idx',
          'ai_context_project_invitations_project_id_status_updated_at_idx',
          'ai_context_project_invitations_inviter_user_id_status_updat_idx'
        )
      ORDER BY "indexname"
    `
  );
  assert.equal(indexes.length, 8);

  const idDefaults = await query<{
    columnDefault: string | null;
    tableName: string;
  }>(
    client,
    `
      SELECT
        "table_name" AS "tableName",
        "column_default" AS "columnDefault"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND column_name = 'id'
        AND table_name IN (
          'access_requests',
          'access_request_audit_events',
          'ai_context_project_grants',
          'ai_context_project_invitations',
          'ai_context_project_invitation_audit_events',
          'ai_context_project_grant_audit_events',
          'ai_context_project_policy_audit_events',
          'ai_context_project_membership_audit_events'
        )
      ORDER BY "table_name"
    `
  );
  assert.equal(idDefaults.length, 8);
  assert.ok(
    idDefaults.every(column => column.columnDefault === null),
    'Prisma-managed String UUID ids must not gain database defaults'
  );
}

async function assertPartialUniqueness(client: PrismaClient) {
  await client.$executeRawUnsafe(`
    INSERT INTO "access_requests" (
      "id", "workspace_id", "doc_id", "beneficiary_type",
      "beneficiary_user_id", "requester_user_id",
      "requester_user_id_snapshot", "requested_level", "request_fingerprint"
    ) VALUES (
      'iw2-user-request-a', 'iw2-workspace', 'iw2-user-doc', 'user',
      'iw2-requester', 'iw2-requester', 'iw2-requester', 'read',
      'iw2-user-request-fingerprint-a'
    )
  `);
  const requesterIdentityDefault = await query<{
    requesterSuppliedIdentity: boolean;
  }>(
    client,
    `
      SELECT
        "requester_supplied_identity" AS "requesterSuppliedIdentity"
      FROM "access_requests"
      WHERE "id" = 'iw2-user-request-a'
    `
  );
  assert.deepEqual(requesterIdentityDefault, [
    { requesterSuppliedIdentity: true },
  ]);
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "access_requests" (
          "id", "workspace_id", "doc_id", "beneficiary_type",
          "beneficiary_project_id", "requester_user_id",
          "requester_user_id_snapshot", "requester_supplied_identity",
          "requested_level", "requested_title", "request_fingerprint"
        ) VALUES (
          'iw2-blind-titled-request', 'iw2-workspace', 'iw2-blind-doc',
          'project', 'iw2-project', 'iw2-owner', 'iw2-owner', false,
          'read', 'Must remain hidden', 'iw2-blind-titled-request-fingerprint'
        )
      `),
    'request without requester-supplied identity carrying a title',
    /access_requests_identity_check/
  );
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "access_requests" (
          "id", "workspace_id", "doc_id", "beneficiary_type",
          "beneficiary_user_id", "requester_user_id",
          "requester_user_id_snapshot", "requester_supplied_identity",
          "requested_level", "request_fingerprint"
        ) VALUES (
          'iw2-blind-personal-request', 'iw2-workspace', 'iw2-blind-personal-doc',
          'user', 'iw2-requester', 'iw2-requester', 'iw2-requester', false,
          'read', 'iw2-blind-personal-request-fingerprint'
        )
      `),
    'personal request without requester-supplied identity',
    /access_requests_beneficiary_shape_check/
  );
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "access_requests" (
          "id", "workspace_id", "doc_id", "beneficiary_type",
          "beneficiary_user_id", "requester_user_id",
          "requester_user_id_snapshot", "requested_level", "request_fingerprint"
        ) VALUES (
          'iw2-user-request-b', 'iw2-workspace', 'iw2-user-doc', 'user',
          'iw2-requester', 'iw2-requester', 'iw2-requester', 'read',
          'iw2-user-request-fingerprint-b'
        )
      `),
    'duplicate pending personal request',
    /workspace_id, doc_id, beneficiary_user_id.*already exists/
  );
  await client.$executeRawUnsafe(`
    UPDATE "access_requests"
    SET
      "status" = 'withdrawn',
      "resolved_by_user_id" = 'iw2-requester',
      "resolver_user_id_snapshot" = 'iw2-requester',
      "resolved_at" = CURRENT_TIMESTAMP
    WHERE "id" = 'iw2-user-request-a'
  `);
  await client.$executeRawUnsafe(`
    INSERT INTO "access_requests" (
      "id", "workspace_id", "doc_id", "beneficiary_type",
      "beneficiary_user_id", "requester_user_id",
      "requester_user_id_snapshot", "requested_level", "request_fingerprint"
    ) VALUES (
      'iw2-user-request-b', 'iw2-workspace', 'iw2-user-doc', 'user',
      'iw2-requester', 'iw2-requester', 'iw2-requester', 'read',
      'iw2-user-request-fingerprint-b'
    )
  `);

  await client.$executeRawUnsafe(`
    INSERT INTO "access_requests" (
      "id", "workspace_id", "doc_id", "beneficiary_type",
      "beneficiary_project_id", "requester_user_id",
      "requester_user_id_snapshot", "requested_level", "request_fingerprint"
    ) VALUES (
      'iw2-project-request-a', 'iw2-workspace', 'iw2-project-doc', 'project',
      'iw2-project', 'iw2-owner', 'iw2-owner', 'read',
      'iw2-project-request-fingerprint-a'
    )
  `);
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "access_requests" (
          "id", "workspace_id", "doc_id", "beneficiary_type",
          "beneficiary_project_id", "requester_user_id",
          "requester_user_id_snapshot", "requested_level", "request_fingerprint"
        ) VALUES (
          'iw2-project-request-b', 'iw2-workspace', 'iw2-project-doc', 'project',
          'iw2-project', 'iw2-owner', 'iw2-owner', 'read',
          'iw2-project-request-fingerprint-b'
        )
      `),
    'duplicate pending project request',
    /workspace_id, doc_id, beneficiary_project_id.*already exists/
  );

  await client.$executeRawUnsafe(`
    INSERT INTO "ai_context_project_invitations" (
      "id", "project_id", "invitee_user_id", "inviter_user_id",
      "inviter_user_id_snapshot"
    ) VALUES (
      'iw2-invitation-a', 'iw2-project', 'iw2-requester', 'iw2-owner', 'iw2-owner'
    )
  `);
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "ai_context_project_invitations" (
          "id", "project_id", "invitee_user_id", "inviter_user_id",
          "inviter_user_id_snapshot"
        ) VALUES (
          'iw2-invitation-b', 'iw2-project', 'iw2-requester', 'iw2-owner', 'iw2-owner'
        )
      `),
    'duplicate pending project invitation',
    /project_id, invitee_user_id.*already exists/
  );

  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "ai_context_project_grants" (
          "id", "project_id", "workspace_id", "doc_id", "level", "status",
          "source", "approving_side", "granted_by_user_id",
          "grantor_user_id_snapshot"
        ) VALUES (
          'iw2-duplicate-grant', 'iw2-project', 'iw2-workspace', 'iw2-doc-a',
          'read', 'active', 'direct', 'source', 'iw2-owner', 'iw2-owner'
        )
      `),
    'duplicate active project grant',
    /project_id, workspace_id, doc_id.*already exists/
  );
}

async function assertDeferredGuards(client: PrismaClient) {
  await expectDatabaseRejection(
    () =>
      client.$transaction(transaction =>
        transaction.$executeRawUnsafe(`
          INSERT INTO "ai_context_project_docs" (
            "project_id", "workspace_id", "doc_id", "status",
            "requested_level", "added_by_user_id"
          ) VALUES (
            'iw2-project', 'iw2-workspace', 'iw2-ungranted-doc',
            'granted', 'read', 'iw2-owner'
          )
        `)
      ),
    'granted project document without an active grant',
    /Project document and active grant state must remain consistent/
  );

  await executeStatements(client, [
    `
      INSERT INTO "ai_context_project_docs" (
        "project_id", "workspace_id", "doc_id", "status",
        "requested_level", "added_by_user_id"
      ) VALUES (
        'iw2-project', 'iw2-workspace', 'iw2-consistent-doc',
        'granted', 'read', 'iw2-owner'
      )
    `,
    `
      INSERT INTO "ai_context_project_grants" (
        "id", "project_id", "workspace_id", "doc_id", "level", "status",
        "source", "approving_side", "granted_by_user_id",
        "grantor_user_id_snapshot"
      ) VALUES (
        'iw2-consistent-grant', 'iw2-project', 'iw2-workspace',
        'iw2-consistent-doc', 'read', 'active', 'direct', 'source',
        'iw2-owner', 'iw2-owner'
      )
    `,
  ]);

  await expectDatabaseRejection(
    () =>
      client.$transaction(transaction =>
        transaction.$executeRawUnsafe(`
          DELETE FROM "ai_context_project_grants"
          WHERE "id" = 'iw2-consistent-grant'
        `)
      ),
    'deleting the sole active grant behind a granted project document',
    /Project document and active grant state must remain consistent/
  );

  await expectDatabaseRejection(
    () =>
      client.$transaction(transaction =>
        transaction.$executeRawUnsafe(`
          INSERT INTO "ai_context_memories" (
            "id", "owner_user_id", "workspace_id", "project_id", "scope",
            "kind", "content", "fingerprint", "capture_mode", "writer_version",
            "status", "valid_from"
          ) VALUES (
            'iw2-memory-without-source', 'iw2-owner', NULL, 'iw2-project',
            'project', 'project_summary', 'Must fail closed',
            'iw2-memory-without-source-fingerprint', 'manual', 'iw2-smoke/v1',
            'active', CURRENT_TIMESTAMP
          )
        `)
      ),
    'active project memory without source provenance',
    /Active project memory requires active project-grant source provenance/
  );

  const sourceGrant = await query<{ id: string }>(
    client,
    `
      SELECT "id"
      FROM "ai_context_project_grants"
      WHERE "project_id" = 'iw2-project'
        AND "workspace_id" = 'iw2-workspace'
        AND "doc_id" = 'iw2-doc-a'
        AND "status" = 'active'
    `
  );
  assert.equal(sourceGrant.length, 1);
  await executeStatements(client, [
    `
      INSERT INTO "ai_context_memories" (
        "id", "owner_user_id", "workspace_id", "project_id", "scope",
        "kind", "content", "fingerprint", "capture_mode", "writer_version",
        "status", "valid_from"
      ) VALUES (
        'iw2-memory-with-source', 'iw2-owner', NULL, 'iw2-project',
        'project', 'project_summary', 'Valid project memory',
        'iw2-memory-with-source-fingerprint', 'manual', 'iw2-smoke/v1',
        'active', CURRENT_TIMESTAMP
      )
    `,
    `
      INSERT INTO "ai_context_memory_sources" (
        "memory_id", "project_id", "workspace_id", "doc_id", "project_grant_id"
      ) VALUES (
        'iw2-memory-with-source', 'iw2-project', 'iw2-workspace',
        'iw2-doc-a', '${sourceGrant[0].id}'
      )
    `,
  ]);

  await expectDatabaseRejection(
    () =>
      executeStatements(client, [
        `
          UPDATE "ai_context_project_docs"
          SET "status" = 'revoked', "revoked_at" = CURRENT_TIMESTAMP
          WHERE "project_id" = 'iw2-project'
            AND "workspace_id" = 'iw2-workspace'
            AND "doc_id" = 'iw2-doc-a'
        `,
        `
          UPDATE "ai_context_project_grants"
          SET
            "status" = 'revoked',
            "revoker_user_id_snapshot" = 'iw2-owner',
            "revoked_at" = CURRENT_TIMESTAMP
          WHERE "id" = '${sourceGrant[0].id}'
        `,
      ]),
    'revoking a source grant while its derived project memory remains active',
    /Active project memory requires active project-grant source provenance/
  );
}

async function assertWorkspaceDeletionCleanup(client: PrismaClient) {
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        DELETE FROM "ai_context_project_grants"
        WHERE "project_id" = 'iw2-project'
          AND "workspace_id" = 'iw2-workspace'
          AND "doc_id" = 'iw2-doc-a'
      `),
    'ordinary grant deletion with retained memory provenance',
    /ai_context_memory_sources_project_grant_id_project_id_work_fkey/
  );

  await executeStatements(client, [
    `INSERT INTO "workspaces" ("id") VALUES ('iw2-surviving-workspace')`,
    `
      INSERT INTO "ai_context_project_docs" (
        "project_id", "workspace_id", "doc_id", "status",
        "requested_level", "added_by_user_id"
      ) VALUES (
        'iw2-project', 'iw2-surviving-workspace', 'iw2-surviving-doc',
        'granted', 'read', 'iw2-owner'
      )
    `,
    `
      INSERT INTO "ai_context_project_grants" (
        "id", "project_id", "workspace_id", "doc_id", "level", "status",
        "source", "approving_side", "granted_by_user_id",
        "grantor_user_id_snapshot", "granted_at"
      ) VALUES (
        'iw2-surviving-grant', 'iw2-project', 'iw2-surviving-workspace',
        'iw2-surviving-doc', 'read', 'active', 'direct', 'source',
        'iw2-owner', 'iw2-owner', '2026-01-04T00:00:00Z'
      )
    `,
    `
      INSERT INTO "ai_context_memory_sources" (
        "memory_id", "project_id", "workspace_id", "doc_id", "project_grant_id"
      ) VALUES (
        'iw2-memory-with-source', 'iw2-project', 'iw2-surviving-workspace',
        'iw2-surviving-doc', 'iw2-surviving-grant'
      )
    `,
    `
      INSERT INTO "ai_context_project_docs" (
        "project_id", "workspace_id", "doc_id", "status",
        "requested_level", "added_by_user_id"
      ) VALUES (
        'iw2-project', 'iw2-workspace', 'iw2-revoked-doc',
        'granted', 'read', 'iw2-owner'
      )
    `,
    `
      INSERT INTO "ai_context_project_grants" (
        "id", "project_id", "workspace_id", "doc_id", "level", "status",
        "source", "approving_side", "granted_by_user_id",
        "grantor_user_id_snapshot", "granted_at"
      ) VALUES (
        'iw2-revoked-grant', 'iw2-project', 'iw2-workspace',
        'iw2-revoked-doc', 'read', 'active', 'direct', 'source',
        'iw2-owner', 'iw2-owner', '2026-01-04T00:00:00Z'
      )
    `,
    `
      INSERT INTO "ai_context_memories" (
        "id", "owner_user_id", "workspace_id", "project_id", "scope",
        "kind", "content", "fingerprint", "capture_mode", "writer_version",
        "status", "valid_from"
      ) VALUES (
        'iw2-memory-revoked-source', 'iw2-owner', NULL, 'iw2-project',
        'project', 'project_summary', 'Revoked source memory',
        'iw2-memory-revoked-source-fingerprint', 'manual', 'iw2-smoke/v1',
        'active', '2026-01-04T00:00:00Z'
      )
    `,
    `
      INSERT INTO "ai_context_memory_sources" (
        "memory_id", "project_id", "workspace_id", "doc_id", "project_grant_id"
      ) VALUES (
        'iw2-memory-revoked-source', 'iw2-project', 'iw2-workspace',
        'iw2-revoked-doc', 'iw2-revoked-grant'
      )
    `,
  ]);

  await executeStatements(client, [
    `
      UPDATE "ai_context_memories"
      SET
        "status" = 'disabled',
        "quarantined_at" = '2026-01-05T00:00:00Z',
        "quarantine_reason" = 'project_grant_revoked',
        "quarantined_by_project_grant_id" = 'iw2-revoked-grant'
      WHERE "id" = 'iw2-memory-revoked-source'
    `,
    `
      UPDATE "ai_context_project_docs"
      SET
        "status" = 'revoked',
        "revoked_at" = '2026-01-05T00:00:00Z'
      WHERE "project_id" = 'iw2-project'
        AND "workspace_id" = 'iw2-workspace'
        AND "doc_id" = 'iw2-revoked-doc'
    `,
    `
      UPDATE "ai_context_project_grants"
      SET
        "status" = 'revoked',
        "revoked_by_user_id" = 'iw2-owner',
        "revoker_user_id_snapshot" = 'iw2-owner',
        "revoked_at" = '2026-01-05T00:00:00Z'
      WHERE "id" = 'iw2-revoked-grant'
    `,
  ]);

  const retainedProvenance = await query<{
    grantStatus: string;
    memoryStatus: string;
    projectGrantId: string | null;
    sourceCount: number;
  }>(
    client,
    `
      SELECT
        grant_row."status" AS "grantStatus",
        memory."status" AS "memoryStatus",
        memory."quarantined_by_project_grant_id" AS "projectGrantId",
        count(source."memory_id")::int AS "sourceCount"
      FROM "ai_context_memories" memory
      JOIN "ai_context_project_grants" grant_row
        ON grant_row."id" = 'iw2-revoked-grant'
      LEFT JOIN "ai_context_memory_sources" source
        ON source."memory_id" = memory."id"
       AND source."project_grant_id" = grant_row."id"
      WHERE memory."id" = 'iw2-memory-revoked-source'
      GROUP BY grant_row."status", memory."status",
        memory."quarantined_by_project_grant_id"
    `
  );
  assert.deepEqual(retainedProvenance, [
    {
      grantStatus: 'revoked',
      memoryStatus: 'disabled',
      projectGrantId: 'iw2-revoked-grant',
      sourceCount: 1,
    },
  ]);

  await client.$executeRawUnsafe(`
    DELETE FROM "workspaces"
    WHERE "id" = 'iw2-workspace'
  `);

  const cleanup = await query<{
    activeProjectMemories: number;
    grants: number;
    memorySources: number;
    projectDocuments: number;
    projects: number;
    workspace: number;
  }>(
    client,
    `
      SELECT
        (SELECT count(*)::int FROM "workspaces"
          WHERE "id" = 'iw2-workspace') AS "workspace",
        (SELECT count(*)::int FROM "ai_context_projects"
          WHERE "id" IN ('iw2-project', 'iw2-orphan-project')) AS "projects",
        (SELECT count(*)::int FROM "ai_context_project_docs"
          WHERE "workspace_id" = 'iw2-workspace') AS "projectDocuments",
        (SELECT count(*)::int FROM "ai_context_project_grants"
          WHERE "workspace_id" = 'iw2-workspace') AS "grants",
        (SELECT count(*)::int FROM "ai_context_memory_sources"
          WHERE "workspace_id" = 'iw2-workspace') AS "memorySources",
        (SELECT count(*)::int FROM "ai_context_memories"
          WHERE "project_id" = 'iw2-project'
            AND "status" = 'active') AS "activeProjectMemories"
    `
  );
  assert.deepEqual(cleanup, [
    {
      activeProjectMemories: 0,
      grants: 0,
      memorySources: 0,
      projectDocuments: 0,
      projects: 2,
      workspace: 0,
    },
  ]);

  const quarantined = await query<{
    id: string;
    projectGrantId: string | null;
    quarantineReason: string;
    status: string;
  }>(
    client,
    `
      SELECT
        "id",
        "status",
        "quarantine_reason" AS "quarantineReason",
        "quarantined_by_project_grant_id" AS "projectGrantId"
      FROM "ai_context_memories"
      WHERE "id" IN (
        'iw2-memory-revoked-source',
        'iw2-memory-with-source'
      )
      ORDER BY "id"
    `
  );
  assert.deepEqual(quarantined, [
    {
      id: 'iw2-memory-revoked-source',
      projectGrantId: null,
      quarantineReason: 'project_grant_revoked',
      status: 'disabled',
    },
    {
      id: 'iw2-memory-with-source',
      projectGrantId: null,
      quarantineReason: 'source_workspace_deleted',
      status: 'disabled',
    },
  ]);

  const survivingSource = await query<{
    grantStatus: string;
    sourceCount: number;
  }>(
    client,
    `
      SELECT
        grant_row."status" AS "grantStatus",
        count(source."memory_id")::int AS "sourceCount"
      FROM "ai_context_project_grants" grant_row
      LEFT JOIN "ai_context_memory_sources" source
        ON source."project_grant_id" = grant_row."id"
       AND source."memory_id" = 'iw2-memory-with-source'
      WHERE grant_row."id" = 'iw2-surviving-grant'
      GROUP BY grant_row."status"
    `
  );
  assert.deepEqual(survivingSource, [
    { grantStatus: 'active', sourceCount: 1 },
  ]);

  await expectDatabaseRejection(
    () =>
      client.$transaction(transaction =>
        transaction.$executeRawUnsafe(`
          UPDATE "ai_context_memories"
          SET
            "status" = 'active',
            "quarantined_at" = NULL,
            "quarantine_reason" = NULL,
            "quarantined_by_project_grant_id" = NULL
          WHERE "id" = 'iw2-memory-with-source'
        `)
      ),
    'reactivating project memory after its source workspace was deleted',
    /Quarantined project memory cannot be reactivated/
  );

  const retrievable = await query<{ count: number }>(
    client,
    `
      SELECT count(*)::int AS "count"
      FROM "ai_context_memories"
      WHERE "id" = 'iw2-memory-with-source'
        AND "scope" = 'project'
        AND "status" = 'active'
        AND "quarantined_at" IS NULL
    `
  );
  assert.deepEqual(retrievable, [{ count: 0 }]);
}

async function assertAuditImmutability(client: PrismaClient) {
  await client.$executeRawUnsafe(`
    INSERT INTO "ai_context_project_membership_audit_events" (
      "id", "project_id", "event_type", "actor_user_id",
      "actor_user_id_snapshot", "subject_user_id", "subject_user_id_snapshot",
      "event_fingerprint"
    ) VALUES (
      'iw2-membership-audit', 'iw2-project', 'ownership_transferred',
      'iw2-owner', 'iw2-owner', 'iw2-requester', 'iw2-requester',
      'iw2-membership-audit-fingerprint'
    )
  `);
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        UPDATE "ai_context_project_membership_audit_events"
        SET "metadata" = '{"tampered":true}'::jsonb
        WHERE "id" = 'iw2-membership-audit'
      `),
    'mutating a project membership audit event',
    /Intelligence Workbench audit events are immutable/
  );
}

async function assertFreshInstall(client: PrismaClient) {
  await assertMigrationState(client, EXPECTED_FULL_MIGRATIONS);
  const state = await query<{
    accessRequests: boolean;
    grants: boolean;
    membershipAudit: boolean;
    memorySources: boolean;
  }>(
    client,
    `
      SELECT
        to_regclass('public.access_requests') IS NOT NULL AS "accessRequests",
        to_regclass('public.ai_context_project_grants') IS NOT NULL AS "grants",
        to_regclass('public.ai_context_project_membership_audit_events') IS NOT NULL AS "membershipAudit",
        to_regclass('public.ai_context_memory_sources') IS NOT NULL AS "memorySources"
    `
  );
  assert.deepEqual(state, [
    {
      accessRequests: true,
      grants: true,
      membershipAudit: true,
      memorySources: true,
    },
  ]);
}

async function dropDatabase(admin: PrismaClient, databaseName: string) {
  assert.match(databaseName, /^iw_phase2_smoke_[a-z0-9_]+$/);
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
  const upgradeDatabase = `iw_phase2_smoke_upgrade_${suffix}`;
  const freshDatabase = `iw_phase2_smoke_fresh_${suffix}`;
  const adminUrl = databaseUrl(baseUrl, 'postgres');
  const upgradeUrl = databaseUrl(baseUrl, upgradeDatabase);
  const freshUrl = databaseUrl(baseUrl, freshDatabase);
  const admin = createClient(adminUrl);
  const upgradeClient = createClient(upgradeUrl);
  const freshClient = createClient(freshUrl);
  const migrations = prepareMigrationTree();

  try {
    await dropDatabase(admin, upgradeDatabase);
    await dropDatabase(admin, freshDatabase);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${upgradeDatabase}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${freshDatabase}"`);

    deployMigrations(migrations.schemaPath, upgradeUrl);
    await seedPhase1State(upgradeClient);
    migrations.addPhaseMigration();
    deployMigrations(migrations.schemaPath, upgradeUrl);
    deployMigrations(migrations.schemaPath, freshUrl);

    await assertUpgradeBackfill(upgradeClient);
    await assertPartialUniqueness(upgradeClient);
    await assertDeferredGuards(upgradeClient);
    await assertAuditImmutability(upgradeClient);
    await assertWorkspaceDeletionCleanup(upgradeClient);
    await assertFreshInstall(freshClient);

    console.log(
      'Intelligence Workbench Phase 2 migration smoke passed: Phase 1 upgrade and fresh install, least-privilege grant/audit backfill, orphan-project upgrade, irreversible project-memory quarantine, indexed projections, partial uniqueness, immutable audit, deferred grant/source consistency guards, and fail-closed multi-source workspace deletion cleanup.'
    );
  } finally {
    await upgradeClient.$disconnect();
    await freshClient.$disconnect();
    if (process.env.KEEP_INTELLIGENCE_WORKBENCH_SMOKE_DATABASES !== '1') {
      await dropDatabase(admin, upgradeDatabase);
      await dropDatabase(admin, freshDatabase);
    } else {
      console.log(
        `Kept disposable databases ${upgradeDatabase} and ${freshDatabase}.`
      );
    }
    await admin.$disconnect();
    migrations.cleanup();
  }
}

await main();
