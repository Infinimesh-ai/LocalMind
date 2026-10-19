import test from 'ava';

import {
  deckAiCandidateScopes,
  deckAiProviderOptions,
  pickDeckAiDefault,
  ReportDeckAiService,
} from '../../plugins/copilot/report-deck-ai';

const ws = (scopeId: string) => ({ scopeKind: 'workspace' as const, scopeId });
const pj = (scopeId: string) => ({ scopeKind: 'project' as const, scopeId });

test('candidates list source scopes first in source order, then other scopes once', t => {
  const scopes = deckAiCandidateScopes(
    [pj('p1'), ws('w1'), pj('p1'), ws('w2')],
    [ws('w3'), ws('w1'), pj('p2')]
  );
  t.deepEqual(
    scopes.map(scope => [scope.scopeId, scope.fromSources]),
    [
      ['p1', true],
      ['w1', true],
      ['w2', true],
      ['w3', false],
      ['p2', false],
    ]
  );
});

const option = (
  scope: { scopeKind: 'workspace' | 'project'; scopeId: string },
  available: boolean,
  fromSources = true,
  defaultModelId: string | null = null
) => ({ ...scope, available, fromSources, defaultModelId });

test('default AI is the first source scope', t => {
  t.deepEqual(
    pickDeckAiDefault([
      option(ws('w1'), true, true, 'gpt'),
      option(pj('p1'), true),
    ]),
    {
      defaultChoice: { scopeKind: 'workspace', scopeId: 'w1', modelId: 'gpt' },
      defaultFallbackFrom: null,
    }
  );
  // Project AI never carries a model choice.
  t.deepEqual(pickDeckAiDefault([option(pj('p1'), true, true, 'm')]), {
    defaultChoice: { scopeKind: 'project', scopeId: 'p1' },
    defaultFallbackFrom: null,
  });
});

test('default AI falls back to the next source scope with AI, never to other scopes', t => {
  t.deepEqual(
    pickDeckAiDefault([
      option(pj('p1'), false),
      option(ws('w1'), false),
      option(ws('w2'), true),
      option(ws('w9'), true, false),
    ]),
    {
      defaultChoice: { scopeKind: 'workspace', scopeId: 'w2' },
      defaultFallbackFrom: { scopeKind: 'project', scopeId: 'p1' },
    }
  );
  t.deepEqual(
    pickDeckAiDefault([option(pj('p1'), false), option(ws('w9'), true, false)]),
    {
      defaultChoice: null,
      defaultFallbackFrom: { scopeKind: 'project', scopeId: 'p1' },
    }
  );
  t.deepEqual(pickDeckAiDefault([]), {
    defaultChoice: null,
    defaultFallbackFrom: null,
  });
});

test('provider options never allow quota routes; project AI ignores the model', t => {
  t.deepEqual(deckAiProviderOptions('u1', { ...ws('w1'), modelId: 'gpt' }), {
    modelId: 'gpt',
    providerOptions: {
      user: 'u1',
      workspace: 'w1',
      featureKind: 'action',
      quotaBackedRoutesAllowed: false,
    },
  });
  t.deepEqual(deckAiProviderOptions('u1', { ...pj('p1'), modelId: 'x' }), {
    providerOptions: {
      user: 'u1',
      projectId: 'p1',
      featureKind: 'action',
      quotaBackedRoutesAllowed: false,
    },
  });
});

type Fixture = {
  copilot?: boolean;
  member?: boolean;
  serverProfiles?: unknown[];
  projectProfiles?: unknown[];
  providerIds?: string[];
  entitlement?: { local: boolean; server: boolean; manager: boolean };
};

function service(fixture: Fixture) {
  const calls: unknown[] = [];
  const models = {
    projectResource: {
      assertMember: async () => {
        if (fixture.member === false) throw new Error('not a member');
      },
    },
    workspaceUser: {
      getUserActiveRoles: async () => [{ workspaceId: 'w-other' }],
    },
  };
  const db = {
    aiContextProjectMember: {
      findMany: async () => [{ projectId: 'p-other' }],
    },
  };
  const ac = {
    user: () => ({
      workspace: () => ({ can: async () => fixture.copilot !== false }),
    }),
  };
  const byok = {
    getProfiles: async (
      context: { projectId?: string },
      sources?: { local: boolean; server: boolean }
    ) => {
      calls.push({ context, sources });
      return context.projectId
        ? (fixture.projectProfiles ?? [])
        : (fixture.serverProfiles ?? []);
    },
  };
  const entitlement = {
    hasLocalEntitlement: async () => fixture.entitlement?.local ?? false,
    hasServerEntitlement: async () => fixture.entitlement?.server ?? true,
    hasManagementAccess: async () => fixture.entitlement?.manager ?? false,
  };
  const providers = {
    getEffectiveModelSelectionScope: async (context: unknown) => {
      calls.push({ selection: context });
      return {
        providerIds: fixture.providerIds ?? ['p'],
        configuredModelIds: ['m1', 'm2'],
        projectModelId: 'project-model',
      };
    },
  };
  return {
    calls,
    ai: new ReportDeckAiService(
      models as any,
      db as any,
      ac as any,
      byok as any,
      entitlement as any,
      providers as any
    ),
  };
}

const profile = {
  type: 'openai',
  modelDefinitions: [{ id: 'm1', displayName: 'Model One' }],
};

test('workspace AI lists server-key models only', async t => {
  const { ai, calls } = service({ serverProfiles: [profile] });
  const option = await ai.describe('u1', ws('w1'));
  t.like(option, {
    available: true,
    reason: null,
    providerName: 'openai',
    defaultModelId: 'm1',
    modelLocked: false,
  });
  t.deepEqual(option.models, [
    { id: 'm1', name: 'Model One' },
    { id: 'm2', name: 'm2' },
  ]);
  t.like(calls[0], { sources: { local: false, server: true } });
  t.like(calls[1], {
    selection: { featureKind: 'action', quotaBackedRoutesAllowed: false },
  });
});

test('workspace AI unavailability reasons', async t => {
  t.is(
    (await service({ copilot: false }).ai.describe('u1', ws('w1'))).reason,
    'no_permission'
  );
  t.is(
    (await service({}).ai.describe('u1', ws('w1'))).reason,
    'not_configured'
  );
  t.is(
    (
      await service({
        entitlement: { local: true, server: false, manager: true },
      }).ai.describe('u1', ws('w1'))
    ).reason,
    'local_keys_only'
  );
  t.is(
    (
      await service({ serverProfiles: [profile], providerIds: [] }).ai.describe(
        'u1',
        ws('w1')
      )
    ).reason,
    'blocked_by_policy'
  );
});

test('project AI is locked to the instance project model', async t => {
  const option = await service({ projectProfiles: [profile] }).ai.describe(
    'u1',
    pj('p1')
  );
  t.like(option, {
    available: true,
    modelLocked: true,
    defaultModelId: 'project-model',
  });
  t.deepEqual(option.models, [{ id: 'project-model', name: 'project-model' }]);
  t.is(
    (await service({ member: false }).ai.describe('u1', pj('p1'))).reason,
    'no_permission'
  );
  t.is(
    (await service({}).ai.describe('u1', pj('p1'))).reason,
    'not_configured'
  );
});

test('resolve uses an explicit choice, else the default, and rejects unusable AI', async t => {
  const { ai } = service({ serverProfiles: [profile] });
  t.deepEqual(await ai.resolve('u1', [pj('p1'), ws('w1')]), {
    scopeKind: 'workspace',
    scopeId: 'w1',
    modelId: 'm1',
  });
  t.deepEqual(await ai.resolve('u1', [], { ...ws('w2'), modelId: 'm2' }), {
    ...ws('w2'),
    modelId: 'm2',
  });
  await t.throwsAsync(() =>
    ai.resolve('u1', [], { ...ws('w2'), modelId: 'missing' })
  );
  await t.throwsAsync(() => service({}).ai.resolve('u1', [ws('w1')]));
});

test('options hide other scopes the user cannot use', async t => {
  const { ai } = service({ copilot: false, projectProfiles: [profile] });
  const result = await ai.options('u1', [ws('w1')], scope => scope.scopeId);
  t.deepEqual(
    result.options.map(option => [option.scopeId, option.fromSources]),
    [
      ['w1', true],
      ['p-other', false],
    ]
  );
  t.is(result.defaultChoice, null);
  t.deepEqual(result.defaultFallbackFrom, ws('w1'));
});
