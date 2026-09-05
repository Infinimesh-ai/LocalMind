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

const PHASE_MIGRATION = '20260904030000_intelligence_workbench_phase_3';
const EXPECTED_PRIOR_MIGRATIONS = 319;
const EXPECTED_FULL_MIGRATIONS = 320;
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(serverRoot, '../../..');
const sourceMigrationsRoot = join(serverRoot, 'migrations');

function databaseUrl(baseUrl: string, databaseName: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function createClient(url: string) {
  return new PrismaClient({ datasources: { db: { url } } });
}

function deployMigrations(schemaPath: string, url: string) {
  execFileSync(
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
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

function prepareMigrationTree() {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), 'localmind-intelligence-workbench-phase3-')
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
    'Phase 3 must be validated from the expected 319-migration Phase 2 state'
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
    expectedError
  );
}

async function assertMigrationState(
  client: PrismaClient,
  expectedApplied: number
) {
  const rows = await client.$queryRawUnsafe<
    Array<{ applied: number; phaseApplied: number }>
  >(`
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
  `);
  assert.deepEqual(rows, [{ applied: expectedApplied, phaseApplied: 1 }]);
}

async function seedPhase2State(client: PrismaClient) {
  await client.$transaction(async transaction => {
    await transaction.$executeRawUnsafe(`
      INSERT INTO "users" ("id", "name", "email") VALUES
        ('iw3-owner', 'Phase 3 owner', 'iw3-owner@example.invalid'),
        ('iw3-member', 'Phase 3 member', 'iw3-member@example.invalid')
    `);
    await transaction.$executeRawUnsafe(`
      INSERT INTO "ai_context_projects" (
        "id", "created_by_user_id", "name", "created_at", "updated_at"
      ) VALUES (
        'iw3-project', 'iw3-owner', 'Phase 2 project',
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      )
    `);
    await transaction.$executeRawUnsafe(`
      INSERT INTO "ai_context_project_members" (
        "project_id", "user_id", "role", "created_at", "updated_at"
      ) VALUES
        (
          'iw3-project', 'iw3-owner', 'owner',
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        ),
        (
          'iw3-project', 'iw3-member', 'member',
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
    `);
  });
}

function blockerInsert() {
  return `
    INSERT INTO "ai_context_project_blockers" (
      "id", "project_id", "creator_user_id", "creator_user_id_snapshot",
      "title", "type", "waiting_on", "status", "origin"
    ) VALUES (
      'iw3-blocker', 'iw3-project', 'iw3-owner', 'iw3-owner',
      'Waiting for reply', 'wait_reply', 'Customer', 'waiting', 'user_created'
    )
  `;
}

async function assertUpgrade(client: PrismaClient) {
  await assertMigrationState(client, EXPECTED_FULL_MIGRATIONS);
  const project = await client.$queryRawUnsafe<
    Array<{ name: string; blockerCount: number }>
  >(`
    SELECT project.name, count(blocker.id)::int AS "blockerCount"
    FROM ai_context_projects project
    LEFT JOIN ai_context_project_blockers blocker
      ON blocker.project_id = project.id
    WHERE project.id = 'iw3-project'
    GROUP BY project.name
  `);
  assert.deepEqual(project, [{ name: 'Phase 2 project', blockerCount: 0 }]);
  await client.$executeRawUnsafe(blockerInsert());
  await client.$executeRawUnsafe(`
    INSERT INTO "ai_context_project_blockers" (
      "id", "project_id", "creator_user_id", "creator_user_id_snapshot",
      "title", "type", "waiting_on", "due_at", "status", "origin",
      "ai_suggestion_id"
    ) VALUES (
      'iw3-ai-blocker', 'iw3-project', 'iw3-member', 'iw3-member',
      'Waiting for file', 'wait_file', 'Supplier', '2025-12-01T00:00:00Z',
      'waiting', 'ai_suggested', '7bd1a406-0e21-4a60-9c6e-ecc52218055f'
    )
  `);
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "ai_context_project_blockers" (
          "id", "project_id", "creator_user_id_snapshot", "title", "type",
          "waiting_on", "status", "origin", "ai_suggestion_id"
        ) VALUES (
          'iw3-ai-duplicate', 'iw3-project', 'iw3-member', 'Duplicate',
          'custom', 'Someone', 'waiting', 'ai_suggested',
          '7bd1a406-0e21-4a60-9c6e-ecc52218055f'
        )
      `),
    'duplicate AI suggestion confirmation',
    /project_id, ai_suggestion_id.*already exists/
  );
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "ai_context_project_blockers" (
          "id", "project_id", "creator_user_id_snapshot", "title", "type",
          "waiting_on", "status", "origin", "ai_suggestion_id"
        ) VALUES (
          'iw3-invalid-ai-id', 'iw3-project', 'iw3-owner', 'Invalid AI id',
          'custom', 'Someone', 'waiting', 'ai_suggested', 'not-a-uuid'
        )
      `),
    'invalid AI suggestion id',
    /ai_context_project_blockers_identity_check/
  );
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "ai_context_project_blockers" (
          "id", "project_id", "creator_user_id_snapshot", "title", "type",
          "waiting_on", "status", "origin", "ai_suggestion_id"
        ) VALUES (
          'iw3-noncanonical-ai-id', 'iw3-project', 'iw3-owner',
          'Noncanonical AI id', 'custom', 'Someone', 'waiting', 'ai_suggested',
          '099C4E1D-CC7D-4E9E-8FA9-A37402D09877'
        )
      `),
    'noncanonical AI suggestion id',
    /ai_context_project_blockers_identity_check/
  );
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        INSERT INTO "ai_context_project_blockers" (
          "id", "project_id", "creator_user_id_snapshot", "title", "type",
          "waiting_on", "status", "origin", "ai_suggestion_id"
        ) VALUES (
          'iw3-manual-with-ai-id', 'iw3-project', 'iw3-owner', 'Invalid origin',
          'custom', 'Someone', 'waiting', 'user_created',
          '099c4e1d-cc7d-4e9e-8fa9-a37402d09877'
        )
      `),
    'manual blocker carrying an AI suggestion id',
    /ai_context_project_blockers_origin_shape_check/
  );
  await expectDatabaseRejection(
    () =>
      client.$executeRawUnsafe(`
        UPDATE "ai_context_project_blockers"
        SET "status" = 'resolved'
        WHERE "id" = 'iw3-blocker'
      `),
    'terminal blocker without resolution evidence',
    /ai_context_project_blockers_lifecycle_check/
  );
  await client.$executeRawUnsafe(`
    UPDATE "ai_context_project_blockers"
    SET
      "status" = 'abandoned',
      "resolution_actor_user_id" = 'iw3-member',
      "resolution_actor_user_id_snapshot" = 'iw3-member',
      "resolved_at" = CURRENT_TIMESTAMP
    WHERE "id" = 'iw3-blocker'
  `);
  const indexes = await client.$queryRawUnsafe<Array<{ count: number }>>(`
    SELECT count(*)::int AS count
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname IN (
        'ai_context_project_blockers_project_id_status_due_at_updat_idx',
        'ai_context_project_blockers_project_id_status_resolved_at_idx',
        'ai_context_project_blockers_project_id_ai_suggestion_id_key'
      )
  `);
  assert.deepEqual(indexes, [{ count: 3 }]);
}

async function assertFresh(client: PrismaClient) {
  await assertMigrationState(client, EXPECTED_FULL_MIGRATIONS);
  const state = await client.$queryRawUnsafe<
    Array<{ blockers: boolean; idDefault: string | null }>
  >(`
    SELECT
      to_regclass('public.ai_context_project_blockers') IS NOT NULL AS blockers,
      column_default AS "idDefault"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ai_context_project_blockers'
      AND column_name = 'id'
  `);
  assert.deepEqual(state, [{ blockers: true, idDefault: null }]);
}

async function dropDatabase(admin: PrismaClient, databaseName: string) {
  assert.match(databaseName, /^iw_phase3_smoke_[a-z0-9_]+$/);
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
  const upgradeDatabase = `iw_phase3_smoke_upgrade_${suffix}`;
  const freshDatabase = `iw_phase3_smoke_fresh_${suffix}`;
  const admin = createClient(databaseUrl(baseUrl, 'postgres'));
  const upgradeClient = createClient(databaseUrl(baseUrl, upgradeDatabase));
  const freshClient = createClient(databaseUrl(baseUrl, freshDatabase));
  const migrations = prepareMigrationTree();

  try {
    await dropDatabase(admin, upgradeDatabase);
    await dropDatabase(admin, freshDatabase);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${upgradeDatabase}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${freshDatabase}"`);
    deployMigrations(
      migrations.schemaPath,
      databaseUrl(baseUrl, upgradeDatabase)
    );
    await seedPhase2State(upgradeClient);
    const before = await upgradeClient.$queryRawUnsafe<
      Array<{ blockers: string | null }>
    >(
      `SELECT to_regclass('public.ai_context_project_blockers')::text AS blockers`
    );
    assert.deepEqual(before, [{ blockers: null }]);
    migrations.addPhaseMigration();
    deployMigrations(
      migrations.schemaPath,
      databaseUrl(baseUrl, upgradeDatabase)
    );
    deployMigrations(
      migrations.schemaPath,
      databaseUrl(baseUrl, freshDatabase)
    );
    await assertUpgrade(upgradeClient);
    await assertFresh(freshClient);
    console.log(
      'Intelligence Workbench Phase 3 migration smoke passed: 319->320 upgrade, fresh install, blocker lifecycle/origin/UUID constraints, confirmation uniqueness, and projection indexes.'
    );
  } finally {
    await upgradeClient.$disconnect();
    await freshClient.$disconnect();
    if (process.env.KEEP_INTELLIGENCE_WORKBENCH_SMOKE_DATABASES !== '1') {
      await dropDatabase(admin, upgradeDatabase);
      await dropDatabase(admin, freshDatabase);
    }
    await admin.$disconnect();
    migrations.cleanup();
  }
}

await main();
