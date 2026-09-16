import assert from 'node:assert/strict';

import { PrismaClient } from '@prisma/client';

assert.equal(
  new URL(process.env.DATABASE_URL ?? '').pathname,
  '/affine_write_audit_upgrade'
);
const mode = process.argv.at(-1);
assert.ok(mode === 'seed' || mode === 'verify');
const db = new PrismaClient();
const id = 'workspace-live-acl-upgrade-fixture';
try {
  if (mode === 'seed') {
    for (const reason of [
      'authorized',
      'unshared_source',
      'source_budget_exceeded',
      'waived_server_resolved_destination',
    ]) {
      await db.$executeRaw`
        INSERT INTO ai_shared_write_source_checks(id, session_id, actor_id, sink_type, sink_id, phase,
          allowed, reason_code, source_fingerprint, sources, audience_evidence, created_at)
        VALUES (${`${id}-${reason}`}, 'legacy-session', 'legacy-actor', 'document_update', 'legacy-document', 'execute',
          ${reason === 'authorized'}, ${reason}, ${'a'.repeat(64)}, '[{"kind":"private","sourceId":"original"}]'::jsonb,
          '{"known":true,"userIds":["legacy-actor"]}'::jsonb, '2026-09-14T00:00:00.000Z')
      `;
    }
    console.log(
      'Seeded all four original source judgments before the policy-version migration.'
    );
  } else {
    const rows = await db.aiSharedWriteSourceCheck.findMany({
      where: { id: { startsWith: id } },
    });
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.policyVersion, 'shared-write-source/v1');
      assert.equal(row.id, `${id}-${row.reasonCode}`);
      assert.equal(row.allowed, row.reasonCode === 'authorized');
      assert.equal(row.sourceFingerprint, 'a'.repeat(64));
      assert.deepEqual(row.sources, [
        { kind: 'private', sourceId: 'original' },
      ]);
      assert.deepEqual(row.audienceEvidence, {
        known: true,
        userIds: ['legacy-actor'],
      });
      assert.equal(row.createdAt.toISOString(), '2026-09-14T00:00:00.000Z');
      await assert.rejects(
        db.aiSharedWriteSourceCheck.update({
          where: { id: row.id },
          data: { reasonCode: 'authorized_by_live_acl' },
        })
      );
    }
    const current = {
      sessionId: 'current-session',
      actorId: 'current-actor',
      sinkType: 'document_update',
      sinkId: 'current-document',
      sinkWorkspaceId: 'current-workspace',
      phase: 'execute',
      allowed: true,
      policyVersion: 'workspace-live-acl/v1',
      reasonCode: 'authorized_by_live_acl',
      sourceFingerprint: 'b'.repeat(64),
      sources: [],
    };
    await db.aiSharedWriteSourceCheck.create({ data: current });
    await assert.rejects(
      db.aiSharedWriteSourceCheck.create({
        data: { ...current, allowed: false },
      })
    );
    await assert.rejects(
      db.aiSharedWriteSourceCheck.create({
        data: { ...current, projectId: 'project-resource' },
      })
    );
    await assert.rejects(
      db.aiSharedWriteSourceCheck.create({
        data: { ...current, policyVersion: 'shared-write-source/v1' },
      })
    );
    console.log(
      'Verified immutable original judgments, new ACL success and invalid policy/Project/denial rejection.'
    );
  }
} finally {
  await db.$disconnect();
}
