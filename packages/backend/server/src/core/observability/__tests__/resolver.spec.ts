import test from 'ava';

import { ScopedAuditObservabilityResolver } from '../resolver';

const user = {
  id: 'user-1',
  email: 'user@example.test',
  avatarUrl: null,
  name: 'User',
  disabled: false,
  hasPassword: true,
  emailVerified: true,
};

function resolverFor(
  allowed: boolean,
  rows: Array<Record<string, unknown>> = []
) {
  const calls: string[] = [];
  const permissions = {
    user: (userId: string) => ({
      workspace: (workspaceId: string) => ({
        assert: async (action: string) => {
          calls.push(`${userId}:${workspaceId}:${action}`);
          if (!allowed) throw new Error('forbidden');
        },
      }),
    }),
  };
  const logs = {
    queryAudits: async (args: unknown) => {
      calls.push(JSON.stringify(args));
      return rows;
    },
  };
  return {
    resolver: new ScopedAuditObservabilityResolver(
      logs as any,
      permissions as any
    ),
    calls,
  };
}

test('scoped audit query rejects users without workspace manage permission', async t => {
  const { resolver, calls } = resolverFor(false);
  await t.throwsAsync(
    resolver.localmindAuditEnvelopes(user as any, 'workspace-1'),
    { message: 'forbidden' }
  );
  t.deepEqual(calls, ['user-1:workspace-1:Workspace.Users.Manage']);
});

test('scoped audit query checks actor scope and preserves project filter', async t => {
  const { resolver, calls } = resolverFor(true, [
    {
      auditEventId: 'audit-1',
      eventId: 'event-1',
      action: 'doc.publish',
      outcome: 'success',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      resourceType: 'doc',
      resourceId: 'doc-1',
      occurredAt: new Date('2026-09-14T00:00:00.000Z'),
      metadata: { prompt: '[redacted]' },
    },
  ]);
  const result = await resolver.localmindAuditEnvelopes(
    user as any,
    'workspace-1',
    'project-1',
    10
  );
  t.is(result.length, 1);
  t.is(result[0].projectId, 'project-1');
  t.deepEqual(JSON.parse(calls[1]), {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    limit: 10,
  });
});
