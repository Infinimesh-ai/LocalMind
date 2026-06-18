import test from 'ava';

import {
  OpenAICompatibleProvider,
  OpenAIProvider,
} from '../../plugins/copilot/providers';
import { CopilotProviderLifecycleService } from '../../plugins/copilot/providers/lifecycle-service';
import {
  buildProviderRegistry,
  describeProviderRoutePolicy,
  describeProviderRoutePolicyCandidates,
  resolveModel,
  stripProviderPrefix,
} from '../../plugins/copilot/providers/provider-registry';
import {
  CopilotProviderType,
  ModelOutputType,
} from '../../plugins/copilot/providers/types';

test('buildProviderRegistry should keep explicit profile over legacy compatibility profile', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-default',
        type: CopilotProviderType.OpenAI,
        priority: 100,
        config: { apiKey: 'new' },
      },
    ],
    openai: { apiKey: 'legacy' },
  });

  const profile = registry.profiles.get('openai-default');
  t.truthy(profile);
  t.deepEqual(profile?.config, { apiKey: 'new' });
  t.is(profile?.source, 'configured');
});

test('buildProviderRegistry should support OpenAI-compatible legacy provider config', t => {
  const registry = buildProviderRegistry({
    openaiCompatible: {
      baseURL: 'http://ollama:11434/v1',
      apiStyle: 'chat_completions',
    },
  });

  const profile = registry.profiles.get('openaiCompatible-default');
  t.truthy(profile);
  t.is(profile?.type, CopilotProviderType.OpenAICompatible);
  t.is(profile?.source, 'legacy');
  t.deepEqual(profile?.config, {
    baseURL: 'http://ollama:11434/v1',
    apiStyle: 'chat_completions',
  });
});

test('buildProviderRegistry should preserve OpenAI-compatible auto api style', t => {
  const registry = buildProviderRegistry({
    openaiCompatible: {
      baseURL: 'https://router.example/v1',
      apiStyle: 'auto',
    },
  });

  const profile = registry.profiles.get('openaiCompatible-default');
  t.truthy(profile);
  t.is(profile?.type, CopilotProviderType.OpenAICompatible);
  t.deepEqual(profile?.config, {
    baseURL: 'https://router.example/v1',
    apiStyle: 'auto',
  });
});

test('buildProviderRegistry should reject duplicated profile ids', t => {
  const error = t.throws(() =>
    buildProviderRegistry({
      profiles: [
        {
          id: 'openai-main',
          type: CopilotProviderType.OpenAI,
          config: { apiKey: '1' },
        },
        {
          id: 'openai-main',
          type: CopilotProviderType.OpenAI,
          config: { apiKey: '2' },
        },
      ],
    })
  ) as Error;

  t.truthy(error);
  t.regex(error.message, /Duplicated copilot provider profile id/);
});

test('buildProviderRegistry should reject defaults that reference unknown providers', t => {
  const error = t.throws(() =>
    buildProviderRegistry({
      profiles: [
        {
          id: 'openai-main',
          type: CopilotProviderType.OpenAI,
          config: { apiKey: '1' },
        },
      ],
      defaults: {
        fallback: 'unknown-provider',
      },
    })
  ) as Error;

  t.truthy(error);
  t.regex(error.message, /defaults references unknown providerId/);
});

test('buildProviderRegistry should normalize enabled model definitions', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-main',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: '1' },
        modelDefinitions: [
          {
            id: 'local-chat',
            capabilities: [
              {
                input: ['text'],
                output: ['text'],
              },
            ],
          },
          {
            id: 'disabled-local-chat',
            enabled: false,
            capabilities: [
              {
                input: ['text'],
                output: ['text'],
              },
            ],
          },
        ],
      },
    ],
  });

  t.deepEqual(
    registry.profiles
      .get('openai-main')
      ?.modelDefinitions.map(model => model.id),
    ['local-chat']
  );
});

test('buildProviderRegistry should normalize provider privacy metadata', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'cloud-main',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: '1' },
      },
      {
        id: 'local-main',
        type: CopilotProviderType.OpenAICompatible,
        privacy: 'local',
        config: { baseURL: 'http://ollama:11434/v1' },
      },
    ],
  });

  t.is(registry.profiles.get('cloud-main')?.privacy, 'cloud');
  t.is(registry.profiles.get('local-main')?.privacy, 'local');
});

test('resolveModel should support explicit provider prefix and keep slash models untouched', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-main',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: '1' },
      },
      {
        id: 'fal-main',
        type: CopilotProviderType.FAL,
        config: { apiKey: '2' },
      },
    ],
  });

  const prefixed = resolveModel({
    registry,
    modelId: 'openai-main/gpt-5-mini',
  });
  t.deepEqual(prefixed, {
    rawModelId: 'openai-main/gpt-5-mini',
    modelId: 'gpt-5-mini',
    explicitProviderId: 'openai-main',
    candidateProviderIds: ['openai-main'],
  });

  const slashModel = resolveModel({
    registry,
    modelId: 'lora/image-to-image',
  });
  t.is(slashModel.modelId, 'lora/image-to-image');
  t.false(slashModel.candidateProviderIds.includes('lora'));
});

test('resolveModel should follow defaults -> fallback -> order and apply filters', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-main',
        type: CopilotProviderType.OpenAI,
        priority: 10,
        config: { apiKey: '1' },
      },
      {
        id: 'anthropic-main',
        type: CopilotProviderType.Anthropic,
        priority: 5,
        config: { apiKey: '2' },
      },
      {
        id: 'fal-main',
        type: CopilotProviderType.FAL,
        priority: 1,
        config: { apiKey: '3' },
      },
    ],
    defaults: {
      [ModelOutputType.Text]: 'anthropic-main',
      fallback: 'openai-main',
    },
  });

  const routed = resolveModel({
    registry,
    outputType: ModelOutputType.Text,
    preferredProviderIds: ['openai-main', 'fal-main'],
  });

  t.deepEqual(routed.candidateProviderIds, ['openai-main', 'fal-main']);
});

test('resolveModel should resolve bare model ids by provider priority order', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-main',
        type: CopilotProviderType.OpenAI,
        priority: 10,
        config: { apiKey: '1' },
      },
      {
        id: 'anthropic-main',
        type: CopilotProviderType.Anthropic,
        priority: 5,
        config: { apiKey: '2' },
      },
      {
        id: 'fal-main',
        type: CopilotProviderType.FAL,
        priority: 1,
        config: { apiKey: '3' },
      },
    ],
    defaults: {
      [ModelOutputType.Text]: 'anthropic-main',
      fallback: 'fal-main',
    },
  });

  const routed = resolveModel({
    registry,
    modelId: 'shared-model',
  });

  t.deepEqual(routed.candidateProviderIds, [
    'openai-main',
    'anthropic-main',
    'fal-main',
  ]);
});

test('resolveModel should skip down provider profiles', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-main',
        type: CopilotProviderType.OpenAI,
        priority: 10,
        config: { apiKey: '1' },
        health: { status: 'down', lastError: 'connection refused' },
      },
      {
        id: 'openai-backup',
        type: CopilotProviderType.OpenAI,
        priority: 5,
        config: { apiKey: '2' },
        health: { status: 'degraded' },
      },
      {
        id: 'anthropic-main',
        type: CopilotProviderType.Anthropic,
        priority: 1,
        config: { apiKey: '3' },
        health: { status: 'unknown' },
      },
    ],
    defaults: {
      [ModelOutputType.Text]: 'openai-main',
      fallback: 'openai-backup',
    },
  });

  const defaultRoute = resolveModel({
    registry,
    outputType: ModelOutputType.Text,
  });
  t.deepEqual(defaultRoute.candidateProviderIds, [
    'openai-backup',
    'anthropic-main',
  ]);

  const explicitDown = resolveModel({
    registry,
    modelId: 'openai-main/gpt-5-mini',
  });
  t.deepEqual(explicitDown.candidateProviderIds, []);
});

test('resolveModel should filter and sort routes by provider route policy', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'cloud-main',
        type: CopilotProviderType.OpenAI,
        priority: 100,
        privacy: 'cloud',
        config: { apiKey: '1' },
      },
      {
        id: 'private-main',
        type: CopilotProviderType.OpenAICompatible,
        priority: 50,
        privacy: 'private_cloud',
        config: { baseURL: 'https://llm.internal/v1' },
        modelDefinitions: [
          {
            id: 'office-embedding',
            aliases: ['workspace-embedding'],
            capabilities: [
              {
                input: ['text'],
                output: ['embedding'],
              },
            ],
          },
        ],
      },
      {
        id: 'local-main',
        type: CopilotProviderType.OpenAICompatible,
        priority: 1,
        privacy: 'local',
        config: { baseURL: 'http://ollama:11434/v1' },
      },
    ],
    routePolicy: {
      preferredPrivacy: ['local', 'private_cloud', 'cloud'],
    },
  });

  const routed = resolveModel({
    registry,
    modelId: 'shared-model',
  });

  t.deepEqual(routed.candidateProviderIds, [
    'local-main',
    'private-main',
    'cloud-main',
  ]);
});

test('resolveModel should apply feature and workspace route policy overrides', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'cloud-main',
        type: CopilotProviderType.OpenAI,
        priority: 100,
        privacy: 'cloud',
        config: { apiKey: '1' },
      },
      {
        id: 'private-main',
        type: CopilotProviderType.OpenAICompatible,
        priority: 50,
        privacy: 'private_cloud',
        config: { baseURL: 'https://llm.internal/v1' },
        modelDefinitions: [
          {
            id: 'office-embedding',
            aliases: ['workspace-embedding'],
            capabilities: [
              {
                input: ['text'],
                output: ['embedding'],
              },
            ],
          },
        ],
      },
      {
        id: 'local-main',
        type: CopilotProviderType.OpenAICompatible,
        priority: 1,
        privacy: 'local',
        config: { baseURL: 'http://ollama:11434/v1' },
      },
    ],
    routePolicy: {
      allowedPrivacy: ['cloud', 'private_cloud', 'local'],
      byFeature: {
        workspace_indexing: {
          allowedPrivacy: ['local', 'private_cloud'],
          preferredPrivacy: ['local', 'private_cloud'],
        },
      },
      byWorkspace: {
        'workspace-local-only': {
          allowedPrivacy: ['local'],
        },
      },
    },
  });

  const indexingRoute = resolveModel({
    registry,
    outputType: ModelOutputType.Embedding,
    routePolicyContext: {
      featureKind: 'workspace_indexing',
    },
  });
  t.deepEqual(indexingRoute.candidateProviderIds, [
    'local-main',
    'private-main',
  ]);

  const workspaceRoute = resolveModel({
    registry,
    modelId: 'cloud-main/gpt-5-mini',
    routePolicyContext: {
      workspaceId: 'workspace-local-only',
    },
  });
  t.deepEqual(workspaceRoute.candidateProviderIds, []);
});

test('describeProviderRoutePolicy should expose effective route policy rule', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'cloud-main',
        type: CopilotProviderType.OpenAI,
        privacy: 'cloud',
        config: { apiKey: '1' },
      },
      {
        id: 'local-main',
        type: CopilotProviderType.OpenAICompatible,
        privacy: 'local',
        config: { baseURL: 'http://ollama:11434/v1' },
      },
    ],
    routePolicy: {
      allowedProviderIds: ['cloud-main', 'local-main'],
      blockedProviderIds: ['cloud-main'],
      preferredPrivacy: ['cloud'],
      byFeature: {
        chat: {
          allowedPrivacy: ['cloud', 'local'],
          preferredPrivacy: ['local', 'cloud'],
        },
      },
      byWorkspace: {
        'workspace-local': {
          allowedProviderIds: ['local-main'],
          allowedPrivacy: ['local'],
        },
      },
    },
  });

  t.deepEqual(
    describeProviderRoutePolicy(registry, {
      featureKind: 'chat',
      workspaceId: 'workspace-local',
    }),
    {
      enabled: true,
      featureKind: 'chat',
      workspaceId: 'workspace-local',
      allowedProviderIds: ['local-main'],
      blockedProviderIds: ['cloud-main'],
      allowedPrivacy: ['local'],
      preferredPrivacy: ['local', 'cloud'],
    }
  );
});

test('describeProviderRoutePolicyCandidates should expose policy candidate reasons without changing routes', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'cloud-main',
        type: CopilotProviderType.OpenAI,
        priority: 100,
        privacy: 'cloud',
        config: { apiKey: '1' },
      },
      {
        id: 'private-main',
        type: CopilotProviderType.OpenAICompatible,
        priority: 50,
        privacy: 'private_cloud',
        config: { baseURL: 'https://llm.internal/v1' },
        modelDefinitions: [
          {
            id: 'office-embedding',
            aliases: ['workspace-embedding'],
            capabilities: [
              {
                input: ['text'],
                output: ['embedding'],
              },
            ],
          },
        ],
      },
      {
        id: 'local-main',
        type: CopilotProviderType.OpenAICompatible,
        priority: 1,
        privacy: 'local',
        health: {
          status: 'down',
          lastCheckedAt: '2026-06-16T10:00:00.000Z',
          lastError: 'connection refused',
        },
        config: { baseURL: 'http://ollama:11434/v1' },
      },
    ],
    routePolicy: {
      allowedProviderIds: ['private-main', 'local-main'],
      blockedProviderIds: ['cloud-main'],
      preferredPrivacy: ['local', 'private_cloud'],
      byFeature: {
        workspace_indexing: {
          allowedPrivacy: ['local', 'private_cloud'],
        },
      },
    },
  });

  t.deepEqual(
    describeProviderRoutePolicyCandidates(
      registry,
      registry.order,
      { featureKind: 'workspace_indexing' },
      ['cloud-main', 'private-main']
    ),
    [
      {
        providerId: 'private-main',
        providerProfileId: 'private-main',
        providerProfileSource: 'configured',
        providerProfileConfigPath:
          'copilot.providers.profiles[id=private-main]',
        providerConfiguredModelIds: ['office-embedding', 'workspace-embedding'],
        providerConfiguredModelCount: 2,
        providerSource: 'configured',
        providerType: CopilotProviderType.OpenAICompatible,
        providerPriority: 50,
        privacy: 'private_cloud',
        health: 'unknown',
        available: true,
        allowed: true,
        reasons: ['candidate_allowed', 'privacy_preferred'],
      },
      {
        providerId: 'cloud-main',
        providerProfileId: 'cloud-main',
        providerProfileSource: 'configured',
        providerProfileConfigPath: 'copilot.providers.profiles[id=cloud-main]',
        providerSource: 'configured',
        providerType: CopilotProviderType.OpenAI,
        providerPriority: 100,
        privacy: 'cloud',
        health: 'unknown',
        available: true,
        allowed: false,
        reasons: [
          'provider_blocked',
          'provider_not_allowed',
          'privacy_not_allowed',
          'privacy_not_preferred',
        ],
      },
      {
        providerId: 'local-main',
        providerProfileId: 'local-main',
        providerProfileSource: 'configured',
        providerProfileConfigPath: 'copilot.providers.profiles[id=local-main]',
        providerSource: 'configured',
        providerType: CopilotProviderType.OpenAICompatible,
        providerPriority: 1,
        privacy: 'local',
        health: 'down',
        healthCheckedAt: '2026-06-16T10:00:00.000Z',
        available: false,
        allowed: false,
        reasons: ['provider_unavailable', 'privacy_preferred'],
      },
    ]
  );

  const routed = resolveModel({
    registry,
    modelId: 'shared-model',
    routePolicyContext: {
      featureKind: 'workspace_indexing',
    },
  });
  t.deepEqual(routed.candidateProviderIds, ['private-main']);
});

test('stripProviderPrefix should only strip matched provider prefix', t => {
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-main',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: '1' },
      },
    ],
  });

  t.is(
    stripProviderPrefix(registry, 'openai-main', 'openai-main/gpt-5-mini'),
    'gpt-5-mini'
  );
  t.is(
    stripProviderPrefix(registry, 'openai-main', 'another-main/gpt-5-mini'),
    'another-main/gpt-5-mini'
  );
  t.is(
    stripProviderPrefix(registry, 'openai-main', 'gpt-5-mini'),
    'gpt-5-mini'
  );
});

test('CopilotProviderLifecycleService should register current profiles and unregister stale ones', async t => {
  const calls: string[] = [];
  let registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-main',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: '1' },
      },
      {
        id: 'openai-backup',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: '2' },
      },
    ],
  });

  const provider = {
    type: CopilotProviderType.OpenAI,
    configured(execution: { providerId?: string } | undefined) {
      return execution?.providerId === 'openai-main';
    },
  };
  const service = new CopilotProviderLifecycleService(
    {
      get(token: unknown) {
        return token === OpenAIProvider ? provider : undefined;
      },
    } as any,
    {
      register(providerId: string) {
        calls.push(`register:${providerId}`);
      },
      unregister(providerId: string) {
        calls.push(`unregister:${providerId}`);
      },
    } as any,
    {
      getRegistry() {
        return registry;
      },
    } as any
  );

  await service.syncProviders();

  t.deepEqual(calls.slice().sort(), [
    'register:openai-main',
    'unregister:openai-backup',
  ]);

  calls.length = 0;
  registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-backup',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: '2' },
      },
    ],
  });
  provider.configured = (execution: { providerId?: string } | undefined) =>
    execution?.providerId === 'openai-backup';

  await service.syncProviders();

  t.deepEqual(calls.slice().sort(), [
    'register:openai-backup',
    'unregister:openai-main',
  ]);
});

test('CopilotProviderLifecycleService should unregister down profiles', async t => {
  const calls: string[] = [];
  let registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-main',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: '1' },
      },
    ],
  });

  const provider = {
    type: CopilotProviderType.OpenAI,
    configured() {
      return true;
    },
  };
  const service = new CopilotProviderLifecycleService(
    {
      get(token: unknown) {
        return token === OpenAIProvider ? provider : undefined;
      },
    } as any,
    {
      register(providerId: string) {
        calls.push(`register:${providerId}`);
      },
      unregister(providerId: string) {
        calls.push(`unregister:${providerId}`);
      },
    } as any,
    {
      getRegistry() {
        return registry;
      },
    } as any
  );

  await service.syncProviders();
  calls.length = 0;

  registry = buildProviderRegistry({
    profiles: [
      {
        id: 'openai-main',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: '1' },
        health: { status: 'down' },
      },
    ],
  });

  await service.syncProviders();

  t.deepEqual(calls, ['unregister:openai-main']);
});

test('CopilotProviderLifecycleService should register OpenAI-compatible profiles', async t => {
  const calls: string[] = [];
  const registry = buildProviderRegistry({
    profiles: [
      {
        id: 'ollama-main',
        type: CopilotProviderType.OpenAICompatible,
        config: {
          baseURL: 'http://ollama:11434/v1',
        },
      },
    ],
  });

  const provider = {
    type: CopilotProviderType.OpenAICompatible,
    configured() {
      return true;
    },
  };
  const service = new CopilotProviderLifecycleService(
    {
      get(token: unknown) {
        return token === OpenAICompatibleProvider ? provider : undefined;
      },
    } as any,
    {
      register(providerId: string) {
        calls.push(`register:${providerId}`);
      },
      unregister(providerId: string) {
        calls.push(`unregister:${providerId}`);
      },
    } as any,
    {
      getRegistry() {
        return registry;
      },
    } as any
  );

  await service.syncProviders();

  t.deepEqual(calls, ['register:ollama-main']);
});
