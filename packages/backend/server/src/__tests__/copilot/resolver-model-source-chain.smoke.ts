import 'reflect-metadata';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createGlobalEnv } from '../../env';

function sortRouteCalls<
  T extends {
    featureKind?: string;
    method: string;
    modelId?: string;
    outputType?: string;
    workspaceId?: string;
  },
>(calls: T[]) {
  return [...calls].sort((a, b) =>
    [a.method, a.modelId, a.outputType, a.featureKind, a.workspaceId]
      .join(':')
      .localeCompare(
        [b.method, b.modelId, b.outputType, b.featureKind, b.workspaceId].join(
          ':'
        )
      )
  );
}

function taskRouteTargetFingerprintFixture(input: {
  featureKind: string;
  targets: string[];
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        featureKind: input.featureKind,
        targets: input.targets,
      })
    )
    .digest('hex')
    .slice(0, 16);
}

function taskRoutePolicyCandidateEvidenceFixture<
  T extends {
    allowed: boolean;
    available: boolean;
    health: string;
    healthCheckedAt?: string;
    privacy: string;
    providerConfiguredModelCount?: number;
    providerConfiguredModelIds?: string[];
    providerId: string;
    providerName?: string;
    providerPriority?: number;
    providerProfileConfigPath?: string;
    providerProfileId?: string;
    providerProfileSource?: string;
    providerSource?: string;
    providerType?: string;
    reasons: string[];
  },
>(candidates: T[] | undefined) {
  return candidates?.map(candidate => ({
    allowed: candidate.allowed,
    available: candidate.available,
    health: candidate.health,
    ...(candidate.healthCheckedAt
      ? { healthCheckedAt: candidate.healthCheckedAt }
      : {}),
    privacy: candidate.privacy,
    providerId: candidate.providerId,
    ...(candidate.providerConfiguredModelCount !== undefined
      ? { providerConfiguredModelCount: candidate.providerConfiguredModelCount }
      : {}),
    ...(candidate.providerConfiguredModelIds?.length
      ? { providerConfiguredModelIds: candidate.providerConfiguredModelIds }
      : {}),
    ...(candidate.providerName ? { providerName: candidate.providerName } : {}),
    ...(candidate.providerPriority !== undefined
      ? { providerPriority: candidate.providerPriority }
      : {}),
    ...(candidate.providerProfileConfigPath
      ? { providerProfileConfigPath: candidate.providerProfileConfigPath }
      : {}),
    ...(candidate.providerProfileId
      ? { providerProfileId: candidate.providerProfileId }
      : {}),
    ...(candidate.providerProfileSource
      ? { providerProfileSource: candidate.providerProfileSource }
      : {}),
    ...(candidate.providerSource
      ? { providerSource: candidate.providerSource }
      : {}),
    ...(candidate.providerType ? { providerType: candidate.providerType } : {}),
    reasons: candidate.reasons,
  }));
}

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.DEPLOYMENT_TYPE = 'affine';
  createGlobalEnv();

  const { CopilotResolver } = await import('../../plugins/copilot/resolver');

  const routeCalls: Array<{
    method: 'describeRouteCandidates' | 'resolveProvider';
    modelId?: string;
    outputType?: string;
    featureKind?: string;
    workspaceId?: string;
  }> = [];
  const promptName = 'Smoke prompt';
  const prompt = {
    name: promptName,
    model: 'local/default-chat',
    modelConfigPath: 'copilot.prompts.defaults.text.model',
    modelSource: 'default_policy',
    optionalModels: ['local/default-chat', 'local/optional-chat'],
    optionalModelsConfigPath: 'copilot.prompts.overrides[].optionalModels',
    optionalModelsSource: 'override',
    action: 'chat',
    config: { proModels: ['cloud/pro-chat'] },
    proModelsConfigPath: 'copilot.prompts.overrides[].config.proModels',
    proModelsSource: 'override',
    paramKeys: [],
    params: {},
    source: 'built_in',
    category: 'text',
    defaultPolicy: 'text',
    overrideApplied: true,
  };

  const providerFactory = {
    describeRoutePolicy(context: {
      featureKind: string;
      workspaceId?: string;
    }) {
      return {
        enabled: true,
        featureKind: context.featureKind,
        workspaceId: context.workspaceId,
      };
    },
    describeRoutePolicyCandidates() {
      return [
        {
          providerId: 'local',
          providerName: 'Local profile',
          providerSource: 'configured',
          providerProfileId: 'local',
          providerProfileSource: 'configured',
          providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
          providerConfiguredModelIds: ['workspace-embedding', 'embed-alias'],
          providerConfiguredModelCount: 2,
          providerType: 'openaiCompatible',
          providerPriority: 10,
          privacy: 'local',
          health: 'healthy',
          available: true,
          allowed: true,
          reasons: ['candidate_allowed'],
        },
        {
          providerId: 'cloud',
          providerName: 'Cloud fallback',
          providerSource: 'configured',
          providerProfileId: 'cloud',
          providerProfileSource: 'configured',
          providerProfileConfigPath: 'copilot.providers.profiles[id=cloud]',
          providerType: 'openai',
          providerPriority: 1,
          privacy: 'cloud',
          health: 'healthy',
          available: true,
          allowed: false,
          reasons: ['provider_not_allowed'],
        },
      ];
    },
    getConfiguredModelIds() {
      return ['registry/only-chat'];
    },
    async resolveModelId(condition: { modelId?: string }) {
      return condition.modelId || prompt.model;
    },
    async resolveProvider(
      condition: { modelId?: string; outputType?: string },
      _options?: unknown,
      context?: { featureKind?: string; workspaceId?: string }
    ) {
      routeCalls.push({
        method: 'resolveProvider',
        modelId: condition.modelId,
        outputType: condition.outputType,
        featureKind: context?.featureKind,
        workspaceId: context?.workspaceId,
      });
      if (!condition.modelId) {
        return null;
      }
      if (condition.modelId === 'local/optional-chat') {
        return null;
      }

      const id = condition.modelId;
      const outputType = condition.outputType ?? 'text';
      const providerId = id.split('/')[0];
      const modelId = id.split('/').slice(1).join('/') || id;

      return {
        providerId,
        modelId,
        fallbackProviderIds: ['local', 'cloud'],
        profile: {
          id: providerId,
          displayName: providerId,
          source: 'configured',
          type: providerId === 'local' ? 'openaiCompatible' : 'openai',
          models: ['runtime-listed-chat'],
          modelDefinitions: [
            {
              id: 'default-chat',
              rawModelId: 'qwen3:32b',
              aliases: ['default-alias'],
            },
            {
              id: 'optional-chat',
              aliases: ['optional-alias'],
            },
          ],
          privacy: providerId === 'local' ? 'local' : 'cloud',
          health: { status: 'healthy' },
          priority: 1,
        },
        provider: {
          resolveModel(modelId: string) {
            return {
              id: modelId,
              name: `Resolved ${modelId}`,
              backendKind:
                outputType === 'image' ? 'openai_image' : 'openai_chat',
              canonicalKey: modelId,
              protocol: outputType === 'image' ? 'openai_image' : 'openai_chat',
              requestLayer:
                outputType === 'image' ? 'images' : 'chat_completions',
              capabilities: [{ input: ['text'], output: [outputType] }],
            };
          },
        },
      };
    },
    async describeRouteCandidates(
      condition?: { modelId?: string; outputType?: string },
      _options?: unknown,
      context?: { featureKind?: string; workspaceId?: string }
    ) {
      routeCalls.push({
        method: 'describeRouteCandidates',
        modelId: condition?.modelId,
        outputType: condition?.outputType,
        featureKind: context?.featureKind,
        workspaceId: context?.workspaceId,
      });
      if (condition?.outputType === 'rerank' && !condition.modelId) {
        return [];
      }
      if (condition?.modelId === 'local/optional-chat') {
        return [
          {
            registryKind: 'byok',
            registryAvailable: true,
            registrySelected: false,
            providerId: 'local',
            providerName: 'Local profile',
            providerSource: 'configured',
            providerProfileId: 'local',
            providerProfileSource: 'configured',
            providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
            providerConfiguredModelIds: [
              'runtime-listed-chat',
              'default-chat',
              'default-alias',
              'optional-chat',
              'optional-alias',
            ],
            providerConfiguredModelCount: 5,
            providerType: 'openaiCompatible',
            providerPriority: 10,
            privacy: 'local',
            health: 'degraded',
            healthCheckedAt: '2026-06-17T03:30:00.000Z',
            requestedModelId: condition.modelId,
            modelId: 'optional-chat',
            routeRawModelId: 'qwen3:32b',
            routeModelDefinitionSource: 'provider_profile',
            routeModelDefinitionId: 'optional-chat',
            routeModelDefinitionAliases: ['optional-alias'],
            routeModelAliasMatched: false,
            matched: false,
            reasons: ['capability_mismatch'],
          },
        ];
      }
      return [
        {
          registryKind: 'byok',
          registryAvailable: true,
          registrySelected: true,
          providerId: 'local',
          providerName: 'Local profile',
          providerSource: 'configured',
          providerProfileId: 'local',
          providerProfileSource: 'configured',
          providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
          providerConfiguredModelIds: ['workspace-embedding', 'embed-alias'],
          providerConfiguredModelCount: 2,
          providerType: 'openaiCompatible',
          providerPriority: 10,
          privacy: 'local',
          health: 'healthy',
          requestedModelId: 'embed-alias',
          modelId: 'embed-alias',
          routeRawModelId: 'nomic-embed-text',
          routeModelDefinitionSource: 'provider_profile',
          routeModelDefinitionId: 'workspace-embedding',
          routeModelDefinitionAliases: ['embed-alias'],
          routeModelAliasMatched: true,
          candidateModelIds: ['workspace-embedding', 'embed-alias'],
          matched: true,
          reasons: ['profile_model_matched', 'capability_matched'],
        },
      ];
    },
    async describeEmbeddingPrepareCandidates() {
      return [
        {
          providerId: 'local',
          providerName: 'Local profile',
          providerSource: 'configured',
          providerProfileId: 'local',
          providerProfileSource: 'configured',
          providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
          providerConfiguredModelIds: ['workspace-embedding', 'embed-alias'],
          providerConfiguredModelCount: 2,
          providerType: 'openaiCompatible',
          providerPriority: 10,
          privacy: 'local',
          health: 'healthy',
          modelId: 'embed-alias',
          routeRawModelId: 'nomic-embed-text',
          routeModelDefinitionSource: 'provider_profile',
          routeModelDefinitionId: 'workspace-embedding',
          routeModelDefinitionAliases: ['embed-alias'],
          routeModelAliasMatched: true,
          prepared: true,
          preparedModelId: 'nomic-embed-text',
          reasons: ['provider_prepare_succeeded'],
        },
      ];
    },
    async describeRerankPrepareCandidates() {
      return [];
    },
  };

  const emptyTaskRoute = (featureKind: string) => ({
    configured: false,
    errorCode: 'not_configured',
    requestedModelId: undefined,
    fallbackOrder: [],
    preparedRoutes: [],
    preparedProviderCount: 0,
    featureKind,
  });

  const capabilityRuntime = {
    describeEmbeddingRoute: async () => ({
      configured: true,
      requestedModelId: 'embed-alias',
      fallbackOrder: ['local'],
      preparedRoutes: [
        {
          providerId: 'local',
          providerName: 'Local profile',
          providerSource: 'configured',
          providerProfileId: 'local',
          providerProfileSource: 'configured',
          providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
          providerConfiguredModelIds: ['workspace-embedding', 'embed-alias'],
          providerConfiguredModelCount: 2,
          providerType: 'openaiCompatible',
          providerPriority: 10,
          modelId: 'nomic-embed-text',
          canonicalModelKey: 'workspace-embedding',
          protocol: 'openai_chat',
          requestLayer: 'chat_completions',
          modelBackendKind: 'openai_chat',
          behaviorFlags: [],
          requestedDimensions: 1024,
          modelEmbeddingDimensions: 768,
          dimensionMismatch: true,
        },
      ],
      preparedProviderCount: 1,
      providerId: 'local',
      providerName: 'Local profile',
      providerSource: 'configured',
      providerProfileId: 'local',
      providerProfileSource: 'configured',
      providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
      providerConfiguredModelIds: ['workspace-embedding', 'embed-alias'],
      providerConfiguredModelCount: 2,
      providerType: 'openaiCompatible',
      providerPriority: 10,
      modelId: 'nomic-embed-text',
      featureKind: 'workspace_indexing',
    }),
    describeRerankRoute: async () => ({
      ...emptyTaskRoute('rerank'),
      candidateCount: 0,
    }),
  };
  const taskPolicy = {
    resolveWorkspaceIndexingModel: () => ({
      modelId: 'embed-alias',
      source: 'workspace_indexing',
      configKey: 'workspaceIndexing',
      configPath: 'copilot.tasks.models.workspaceIndexing',
    }),
    resolveRerankModel: () => ({ modelId: undefined }),
  };
  const planBuilder = {
    async buildStructuredPlan(
      condition: { modelId?: string },
      _messages: unknown[],
      options?: { featureKind?: string; workspace?: string }
    ) {
      assert.equal(options?.featureKind, 'action');
      assert.equal(options?.workspace, 'workspace-smoke');
      return {
        routePolicy: { fallbackOrder: ['local'] },
        routeDiagnostics: [
          {
            providerId: 'local',
            protocol: 'openai_chat',
            model: 'office-structured',
            backendConfig: { request_layer: 'chat_completions' },
            providerName: 'Local profile',
            providerSource: 'configured',
            providerProfileId: 'local',
            providerProfileSource: 'configured',
            providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
            providerConfiguredModelIds: [
              'office-structured',
              'structured-alias',
            ],
            providerConfiguredModelCount: 2,
            providerType: 'openaiCompatible',
            providerPrivacy: 'local',
            providerHealth: 'healthy',
            providerPriority: 10,
            routeModelAliasMatched: true,
            routeModelDefinitionAliases: ['structured-alias'],
            routeModelDefinitionId: 'office-structured',
            routeModelDefinitionSource: 'provider_profile',
            routeRawModelId: 'qwen3:32b',
          },
        ],
        serializable: {
          routes: [
            {
              providerId: 'local',
              protocol: 'openai_chat',
              model: 'office-structured',
              backendConfig: { request_layer: 'chat_completions' },
            },
          ],
        },
        request: {
          kind: 'structured',
          cond: { modelId: condition.modelId },
          messages: [],
        },
      };
    },
  };

  const resolver = new CopilotResolver(
    {} as any,
    {} as any,
    { get: async () => prompt } as any,
    {} as any,
    {} as any,
    {} as any,
    providerFactory as any,
    capabilityRuntime as any,
    taskPolicy as any,
    {} as any
  );

  const result = await resolver.models(promptName, {
    workspaceId: 'workspace-smoke',
  } as any);
  const byId = new Map(result.optionalModels.map(model => [model.id, model]));

  assert.deepEqual(byId.get('local/default-chat')?.promptModelSources, [
    {
      candidateSource: 'default',
      modelConfigPath: 'copilot.prompts.defaults.text.model',
      modelSource: 'default_policy',
    },
    {
      candidateSource: 'prompt',
      modelConfigPath: 'copilot.prompts.overrides[].optionalModels',
      modelSource: 'override',
    },
  ]);
  assert.deepEqual(byId.get('registry/only-chat')?.promptModelSources, [
    { candidateSource: 'registry' },
  ]);
  assert.deepEqual(result.proModels[0]?.promptModelSources, [
    {
      candidateSource: 'pro',
      modelConfigPath: 'copilot.prompts.overrides[].config.proModels',
      modelSource: 'override',
    },
  ]);
  assert.equal(byId.get('local/default-chat')?.providerProfileId, 'local');
  assert.equal(
    byId.get('local/default-chat')?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.equal(
    byId.get('local/default-chat')?.providerProfileSource,
    'configured'
  );
  assert.deepEqual(byId.get('local/default-chat')?.providerConfiguredModelIds, [
    'runtime-listed-chat',
    'default-chat',
    'default-alias',
    'optional-chat',
    'optional-alias',
  ]);
  assert.equal(byId.get('local/default-chat')?.providerConfiguredModelCount, 5);
  assert.equal(
    byId.get('local/default-chat')?.routeModelDefinitionSource,
    'provider_profile'
  );
  assert.equal(
    byId.get('local/default-chat')?.routeModelDefinitionId,
    'default-chat'
  );
  assert.equal(byId.get('local/default-chat')?.routeRawModelId, 'qwen3:32b');
  assert.deepEqual(
    byId.get('local/default-chat')?.routeModelDefinitionAliases,
    ['default-alias']
  );
  assert.equal(byId.get('local/default-chat')?.routeModelAliasMatched, false);
  assert.equal(
    result.embeddingRoute?.routeCandidates[0]?.providerProfileId,
    'local'
  );
  assert.equal(
    result.embeddingRoute?.routeCandidates[0]?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.deepEqual(
    result.embeddingRoute?.routeCandidates[0]?.providerConfiguredModelIds,
    ['workspace-embedding', 'embed-alias']
  );
  assert.equal(
    result.embeddingRoute?.routeCandidates[0]?.routeModelDefinitionSource,
    'provider_profile'
  );
  assert.equal(
    result.embeddingRoute?.routeCandidates[0]?.routeModelDefinitionId,
    'workspace-embedding'
  );
  assert.equal(
    result.embeddingRoute?.routeCandidates[0]?.routeModelAliasMatched,
    true
  );
  assert.equal(
    result.embeddingRoute?.prepareCandidates[0]?.routeRawModelId,
    'nomic-embed-text'
  );
  assert.equal(
    result.embeddingRoute?.prepareCandidates[0]?.routeModelDefinitionId,
    'workspace-embedding'
  );
  assert.deepEqual(result.embeddingRoute?.diagnosticsErrors, []);
  assert.deepEqual(result.rerankRoute?.diagnosticsErrors, []);
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.requestedDimensions,
    1024
  );
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.modelEmbeddingDimensions,
    768
  );
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.dimensionMismatch,
    true
  );
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.providerName,
    'Local profile'
  );
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.providerSource,
    'configured'
  );
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.providerProfileId,
    'local'
  );
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.providerProfileSource,
    'configured'
  );
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.deepEqual(
    result.embeddingRoute?.preparedRoutes[0]?.providerConfiguredModelIds,
    ['workspace-embedding', 'embed-alias']
  );
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.providerConfiguredModelCount,
    2
  );
  assert.equal(
    result.embeddingRoute?.preparedRoutes[0]?.providerType,
    'openaiCompatible'
  );
  assert.equal(result.embeddingRoute?.preparedRoutes[0]?.providerPriority, 10);
  assert.equal(
    result.embeddingRoute?.policyCandidates[0]?.candidateKey?.includes(
      'workspace_indexing'
    ),
    true
  );
  assert.match(
    result.embeddingRoute?.policyCandidates[0]?.candidateFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    result.embeddingRoute?.policyCandidates[0]?.candidateKey?.includes('local'),
    true
  );
  assert.equal(
    result.embeddingRoute?.policyCandidates[0]?.providerProfileId,
    'local'
  );
  assert.equal(
    result.embeddingRoute?.policyCandidates[0]?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.deepEqual(
    result.embeddingRoute?.policyCandidates[0]?.providerConfiguredModelIds,
    ['workspace-embedding', 'embed-alias']
  );
  assert.equal(
    result.embeddingRoute?.policyCandidates[0]?.providerConfiguredModelCount,
    2
  );

  const gateVerdict = {
    allowed: true,
    blockingCount: 0,
    errorCount: 0,
    issueCount: 0,
    issues: [],
    name: 'Registry gate prompt',
    publishStatus: 'allowed',
    reason: 'ready',
    registryFingerprint: 'feedfacecafebeef',
    registryId: 7,
    registryUpdatedAt: new Date('2026-06-17T01:02:03.000Z'),
    remediations: [],
    stale: false,
    staleReasons: [],
    status: 'ready',
  };
  const gatePrompt = {
    ...prompt,
    name: gateVerdict.name,
    model: 'local/default-chat',
    source: 'registry',
  };
  const permissionAssertions: Array<{
    action: string;
    userId: string;
    workspaceId: string;
  }> = [];
  const permissionAccess = {
    user(userId: string) {
      return {
        workspace(workspaceId: string) {
          return {
            allowLocal() {
              return this;
            },
            async assert(action: string) {
              permissionAssertions.push({ action, userId, workspaceId });
            },
          };
        },
      };
    },
  };
  const currentUser = { id: 'user-smoke' };
  const routeAwareResolver = new CopilotResolver(
    permissionAccess as any,
    {} as any,
    { get: async () => gatePrompt } as any,
    {} as any,
    {} as any,
    {} as any,
    providerFactory as any,
    capabilityRuntime as any,
    taskPolicy as any,
    {
      copilotPrompt: {
        getRegistryPrompt: async () => gatePrompt,
        getRegistryPublishGateVerdict: async () => gateVerdict,
      },
    } as any
  );
  const routeReadyGate = await routeAwareResolver.promptRegistryPublishGate(
    { workspaceId: 'workspace-smoke' } as any,
    gateVerdict.name,
    {
      registryFingerprint: gateVerdict.registryFingerprint,
      registryId: gateVerdict.registryId,
      registryUpdatedAt: gateVerdict.registryUpdatedAt.toISOString(),
    }
  );
  assert.equal(routeReadyGate?.allowed, true);
  assert.equal(routeReadyGate?.publishStatus, 'allowed');
  assert.equal(routeReadyGate?.modelRoute?.available, true);
  assert.deepEqual(
    routeReadyGate?.taskRoutes.map(route => route.featureKind),
    ['workspace_indexing', 'rerank']
  );
  assert.equal(routeReadyGate?.taskRoutes[0]?.providerId, 'local');
  assert.equal(routeReadyGate?.taskRoutes[0]?.providerProfileId, 'local');
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.providerProfileSource,
    'configured'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.deepEqual(routeReadyGate?.taskRoutes[0]?.providerConfiguredModelIds, [
    'workspace-embedding',
    'embed-alias',
  ]);
  assert.equal(routeReadyGate?.taskRoutes[0]?.providerConfiguredModelCount, 2);
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.requestedModelConfigPath,
    'copilot.tasks.models.workspaceIndexing'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.routeCandidates[0]?.providerProfileId,
    'local'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.routeCandidates[0]?.routeModelDefinitionId,
    'workspace-embedding'
  );
  assert.deepEqual(routeReadyGate?.taskRoutes[0]?.diagnosticsErrors, []);
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.prepareCandidates[0]?.preparedModelId,
    'nomic-embed-text'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.preparedRoutes[0]?.providerName,
    'Local profile'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.preparedRoutes[0]?.providerSource,
    'configured'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.preparedRoutes[0]?.providerProfileId,
    'local'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.preparedRoutes[0]?.providerProfileSource,
    'configured'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.preparedRoutes[0]?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.deepEqual(
    routeReadyGate?.taskRoutes[0]?.preparedRoutes[0]
      ?.providerConfiguredModelIds,
    ['workspace-embedding', 'embed-alias']
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.preparedRoutes[0]
      ?.providerConfiguredModelCount,
    2
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.preparedRoutes[0]?.providerType,
    'openaiCompatible'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.preparedRoutes[0]?.providerPriority,
    10
  );
  assert.deepEqual(
    routeReadyGate?.taskRoutes[0]?.routeTrace.map(phase => phase.phase),
    ['policy', 'resolution', 'prepared']
  );
  assert.equal(routeReadyGate?.taskRoutes[1]?.featureKind, 'rerank');
  assert.equal(routeReadyGate?.taskRoutes[1]?.configured, false);
  assert.equal(routeReadyGate?.modelRoute?.providerId, 'local');
  assert.equal(routeReadyGate?.modelRoute?.providerName, 'local');
  assert.equal(routeReadyGate?.modelRoute?.providerSource, 'configured');
  assert.equal(routeReadyGate?.modelRoute?.providerProfileId, 'local');
  assert.equal(
    routeReadyGate?.modelRoute?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.deepEqual(routeReadyGate?.modelRoute?.providerConfiguredModelIds, [
    'runtime-listed-chat',
    'default-chat',
    'default-alias',
    'optional-chat',
    'optional-alias',
  ]);
  assert.equal(routeReadyGate?.modelRoute?.providerConfiguredModelCount, 5);
  assert.equal(routeReadyGate?.modelRoute?.providerType, 'openaiCompatible');
  assert.equal(routeReadyGate?.modelRoute?.providerPrivacy, 'local');
  assert.equal(routeReadyGate?.modelRoute?.providerHealth, 'healthy');
  assert.equal(routeReadyGate?.modelRoute?.providerPriority, 1);
  assert.equal(routeReadyGate?.modelRoute?.modelId, 'default-chat');
  assert.equal(routeReadyGate?.modelRoute?.requestedModelId, gatePrompt.model);
  assert.equal(routeReadyGate?.modelRoute?.outputType, 'object');
  assert.equal(routeReadyGate?.modelRoute?.featureKind, 'chat');
  assert.equal(routeReadyGate?.modelRoute?.candidateKind, 'default');
  assert.equal(routeReadyGate?.modelRoute?.candidateIndex, 0);
  assert.deepEqual(
    routeReadyGate?.modelRoute?.policyCandidates.map(candidate => [
      candidate.providerId,
      candidate.available,
      candidate.allowed,
      candidate.providerProfileId,
      candidate.providerProfileConfigPath,
      candidate.providerConfiguredModelIds,
      candidate.reasons,
    ]),
    [
      [
        'local',
        true,
        true,
        'local',
        'copilot.providers.profiles[id=local]',
        ['workspace-embedding', 'embed-alias'],
        ['candidate_allowed'],
      ],
      [
        'cloud',
        true,
        false,
        'cloud',
        'copilot.providers.profiles[id=cloud]',
        undefined,
        ['provider_not_allowed'],
      ],
    ]
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.policyCandidates[0]?.providerProfileId,
    'local'
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.policyCandidates[0]
      ?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.deepEqual(
    routeReadyGate?.taskRoutes[0]?.policyCandidates[0]
      ?.providerConfiguredModelIds,
    ['workspace-embedding', 'embed-alias']
  );
  assert.equal(
    routeReadyGate?.taskRoutes[0]?.policyCandidates[0]
      ?.providerConfiguredModelCount,
    2
  );
  assert.deepEqual(routeReadyGate?.modelRoute?.routeTrace, [
    {
      phase: 'policy',
      candidateCount: 2,
      availableCount: 2,
      selectedCount: 1,
      blockedCount: 1,
      reasons: ['candidate_allowed', 'provider_not_allowed'],
    },
    {
      phase: 'resolution',
      candidateCount: 1,
      availableCount: 1,
      selectedCount: 1,
      matchedCount: 1,
      reasons: ['profile_model_matched', 'capability_matched'],
    },
  ]);
  assert.equal(
    routeReadyGate?.modelRoute?.candidateConfigPath,
    'copilot.prompts.defaults.text.model'
  );
  assert.equal(routeReadyGate?.modelRoutes?.length, 5);
  assert.deepEqual(
    routeReadyGate?.modelRoutes?.map(route => [
      route.candidateKind,
      route.candidateIndex,
      route.requestedModelId,
      route.available,
    ]),
    [
      ['default', 0, gatePrompt.model, true],
      ['optional', 0, 'local/default-chat', true],
      ['optional', 1, 'local/optional-chat', false],
      ['pro', 0, 'cloud/pro-chat', true],
      ['registry', 0, 'registry/only-chat', true],
    ]
  );
  assert.deepEqual(routeReadyGate?.modelRoutes?.[1]?.reasons, [
    'model_route_available',
    'profile_model_matched',
    'capability_matched',
  ]);
  assert.deepEqual(routeReadyGate?.modelRoutes?.[2]?.reasons, [
    'model_route_unavailable',
    'no_matching_provider_route',
    'capability_mismatch',
  ]);
  assert.equal(
    routeReadyGate?.modelRoutes?.[2]?.candidateConfigPath,
    'copilot.prompts.overrides[].optionalModels'
  );
  assert.equal(
    routeReadyGate?.modelRoutes?.[3]?.candidateConfigPath,
    'copilot.prompts.overrides[].config.proModels'
  );
  assert.equal(
    routeReadyGate?.modelRoutes?.[4]?.candidateConfigPath,
    'copilot.providers.profiles[].models'
  );
  assert.equal(routeReadyGate?.modelRoutes?.[2]?.policyCandidates.length, 2);
  assert.equal(
    routeReadyGate?.modelRoutes?.[2]?.routeTrace[1]?.matchedCount,
    0
  );
  assert.deepEqual(routeReadyGate?.modelRoutes?.[2]?.routeTrace[1]?.reasons, [
    'capability_mismatch',
  ]);
  assert.deepEqual(
    routeReadyGate?.repairRecommendations.map(recommendation => [
      recommendation.category,
      recommendation.code,
      recommendation.target,
      recommendation.instanceKey,
      recommendation.suggestedActionCatalogVersion,
      recommendation.suggestedActionKind,
      recommendation.suggestedActionRequiredCapabilities,
      recommendation.suggestedActionSafety,
      recommendation.targetLocator?.kind,
      recommendation.targetLocator?.path,
    ]),
    [
      [
        'model_route',
        'optional_model_route_unavailable',
        'copilot.prompts.overrides[].optionalModels',
        'chat:object:optional:1:local/optional-chat',
        'repair-actions/v1',
        'review_non_default_model_route',
        ['model_registry.read', 'provider_route.preview'],
        'preview_required',
        'model_route',
        'copilot.prompts.overrides[].optionalModels',
      ],
      [
        'provider_health',
        'selected_provider_health_not_healthy',
        'copilot.providers.profiles[id=local]',
        'chat:object:optional:1:local/optional-chat',
        'repair-actions/v1',
        'check_provider_health',
        ['provider_profile.read', 'provider_health.probe'],
        'read_only_probe',
        'model_route',
        'copilot.providers.profiles[id=local]',
      ],
      [
        'task_route',
        'rerank_task_route_unavailable',
        'copilot.tasks.models.rerank',
        'rerank:task-config:default-route:unavailable',
        'repair-actions/v1',
        'repair_task_model_route',
        ['task_route.read', 'model_registry.read', 'provider_route.preview'],
        'preview_required',
        'task_route',
        'copilot.tasks.models.rerank',
      ],
    ]
  );
  assert.deepEqual(
    routeReadyGate?.repairRecommendations.map(recommendation =>
      /^[0-9a-f]{16}$/.test(recommendation.diagnosticsFingerprint)
    ),
    [true, true, true]
  );
  assert.equal(
    new Set(
      routeReadyGate?.repairRecommendations.map(
        recommendation => recommendation.diagnosticsFingerprint
      )
    ).size,
    routeReadyGate?.repairRecommendations.length
  );
  assert.deepEqual(
    routeReadyGate?.repairRecommendations.map(
      recommendation => recommendation.suggestedActionInputSchema.required
    ),
    [
      ['diagnosticsFingerprint', 'targetLocator'],
      ['diagnosticsFingerprint', 'targetLocator'],
      ['diagnosticsFingerprint', 'targetLocator'],
    ]
  );
  assert.deepEqual(
    routeReadyGate?.repairActionCatalog.map(entry => [
      entry.catalogVersion,
      entry.actionKind,
      entry.safety,
      entry.requiredCapabilities,
      entry.recommendationCount,
      entry.inputSchema.required,
    ]),
    [
      [
        'repair-actions/v1',
        'check_provider_health',
        'read_only_probe',
        ['provider_profile.read', 'provider_health.probe'],
        1,
        ['diagnosticsFingerprint', 'targetLocator'],
      ],
      [
        'repair-actions/v1',
        'repair_task_model_route',
        'preview_required',
        ['task_route.read', 'model_registry.read', 'provider_route.preview'],
        1,
        ['diagnosticsFingerprint', 'targetLocator'],
      ],
      [
        'repair-actions/v1',
        'review_non_default_model_route',
        'preview_required',
        ['model_registry.read', 'provider_route.preview'],
        1,
        ['diagnosticsFingerprint', 'targetLocator'],
      ],
    ]
  );
  assert.match(
    routeReadyGate?.repairActionCatalogFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    routeReadyGate?.repairActionMutationGuard.catalogFingerprint,
    routeReadyGate?.repairActionCatalogFingerprint
  );
  assert.match(
    routeReadyGate?.repairActionMutationGuard.auditSummary ?? '',
    /registry:7 .* catalog:repair-actions\/v1 .* recommendations:3/
  );
  assert.match(
    routeReadyGate?.repairActionMutationGuard.auditSummary ?? '',
    /targetKinds:model_route,task_route .* reviewModes:preview,probe/
  );
  assert.match(
    routeReadyGate?.repairActionMutationGuard.auditSummaryFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    routeReadyGate?.repairActionMutationGuard.catalogVersion,
    'repair-actions/v1'
  );
  assert.equal(
    routeReadyGate?.repairActionMutationGuard.expectedRegistryFingerprint,
    gateVerdict.registryFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionMutationGuard.expectedRegistryId,
    gateVerdict.registryId
  );
  assert.equal(
    routeReadyGate?.repairActionMutationGuard.expectedRegistryUpdatedAt,
    gateVerdict.registryUpdatedAt.toISOString()
  );
  assert.equal(routeReadyGate?.repairActionMutationGuard.required, true);
  assert.equal(
    routeReadyGate?.repairActionMutationGuard.recommendationCount,
    routeReadyGate?.repairRecommendations.length
  );
  assert.deepEqual(
    routeReadyGate?.repairActionMutationGuard.recommendationFingerprints,
    routeReadyGate?.repairRecommendations
      .map(recommendation => recommendation.diagnosticsFingerprint)
      .sort()
  );
  assert.deepEqual(
    routeReadyGate?.repairActionMutationGuard.recommendationCategories,
    ['model_route', 'provider_health', 'task_route']
  );
  assert.deepEqual(
    routeReadyGate?.repairActionMutationGuard.recommendationCodes,
    [
      'optional_model_route_unavailable',
      'rerank_task_route_unavailable',
      'selected_provider_health_not_healthy',
    ]
  );
  assert.deepEqual(
    routeReadyGate?.repairActionMutationGuard.suggestedActionKinds,
    [
      'check_provider_health',
      'repair_task_model_route',
      'review_non_default_model_route',
    ]
  );
  assert.match(
    routeReadyGate?.repairActionMutationGuard.intentFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    routeReadyGate?.repairActionMutationGuard.requiredCapabilities,
    [
      'model_registry.read',
      'provider_health.probe',
      'provider_profile.read',
      'provider_route.preview',
      'task_route.read',
    ]
  );
  assert.deepEqual(
    routeReadyGate?.repairActionMutationGuard.requiredReviewModes,
    ['preview', 'probe']
  );
  assert.match(
    routeReadyGate?.repairActionMutationGuard.inputSchemaFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    routeReadyGate?.repairActionMutationGuard.targetLocatorCount,
    routeReadyGate?.repairRecommendations.length
  );
  assert.match(
    routeReadyGate?.repairActionMutationGuard.targetLocatorFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    routeReadyGate?.repairActionMutationGuard.targetLocatorKinds,
    ['model_route', 'task_route']
  );
  assert.deepEqual(routeReadyGate?.repairActionMutationGuard.safetyLevels, [
    'preview_required',
    'read_only_probe',
  ]);
  assert.match(
    routeReadyGate?.repairActionMutationGuard.guardFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(routeReadyGate?.repairActionPreview.readOnly, true);
  assert.equal(routeReadyGate?.repairActionPreview.status, 'preview_required');
  assert.equal(
    routeReadyGate?.repairActionPreview.candidateCount,
    routeReadyGate?.repairRecommendations.length
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.catalogFingerprint,
    routeReadyGate?.repairActionCatalogFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.guardFingerprint,
    routeReadyGate?.repairActionMutationGuard.guardFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.auditSummaryFingerprint,
    routeReadyGate?.repairActionMutationGuard.auditSummaryFingerprint
  );
  assert.match(
    routeReadyGate?.repairActionPreview.previewFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.match(
    routeReadyGate?.repairActionPreview.operationSetFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.authorizationStatus,
    'approval_required'
  );
  assert.equal(routeReadyGate?.repairActionPreview.approvalRequired, true);
  assert.match(
    routeReadyGate?.repairActionPreview.authorizationFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.approvalPolicyVersion,
    'repair-preview-approval/v1'
  );
  assert.match(
    routeReadyGate?.repairActionPreview.approvalPolicyFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(routeReadyGate?.repairActionPreview.approvalModes, [
    'preview',
    'probe',
  ]);
  assert.deepEqual(routeReadyGate?.repairActionPreview.approvalCheckpoints, [
    'approval_required',
    'authorization_snapshot',
    'capability_scope',
    'operation_set',
    'read_only_contract',
    'review_mode:preview',
    'review_mode:probe',
  ]);
  assert.deepEqual(routeReadyGate?.repairActionPreview.requiredCapabilities, [
    'model_registry.read',
    'provider_health.probe',
    'provider_profile.read',
    'provider_route.preview',
    'task_route.read',
  ]);
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract.contractVersion,
    'repair-preview-submission/v1'
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract.readOnly,
    true
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract.mutationAvailable,
    false
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract.status,
    'read_only_contract'
  );
  assert.match(
    routeReadyGate?.repairActionPreview.submissionContract
      .submissionFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract.previewFingerprint,
    routeReadyGate?.repairActionPreview.previewFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract
      .operationSetFingerprint,
    routeReadyGate?.repairActionPreview.operationSetFingerprint
  );
  assert.match(
    routeReadyGate?.repairActionPreview.candidateEvidenceSetFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract
      .candidateEvidenceSetFingerprint,
    routeReadyGate?.repairActionPreview.candidateEvidenceSetFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract
      .targetLocatorFingerprint,
    routeReadyGate?.repairActionMutationGuard.targetLocatorFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract.guardFingerprint,
    routeReadyGate?.repairActionMutationGuard.guardFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract
      .authorizationFingerprint,
    routeReadyGate?.repairActionPreview.authorizationFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract
      .approvalPolicyFingerprint,
    routeReadyGate?.repairActionPreview.approvalPolicyFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract.catalogFingerprint,
    routeReadyGate?.repairActionCatalogFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract.expectedRegistryId,
    routeReadyGate?.repairActionMutationGuard.expectedRegistryId
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract
      .expectedRegistryFingerprint,
    routeReadyGate?.repairActionMutationGuard.expectedRegistryFingerprint
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract
      .expectedRegistryUpdatedAt,
    routeReadyGate?.repairActionMutationGuard.expectedRegistryUpdatedAt
  );
  assert.equal(
    routeReadyGate?.repairActionPreview.submissionContract.idempotencyKey,
    [
      routeReadyGate?.repairActionMutationGuard.expectedRegistryId,
      routeReadyGate?.repairActionMutationGuard.expectedRegistryFingerprint,
      routeReadyGate?.repairActionPreview.previewFingerprint,
      routeReadyGate?.repairActionPreview.operationSetFingerprint,
    ].join(':')
  );
  assert.deepEqual(
    routeReadyGate?.repairActionPreview.submissionContract.requiredInputs,
    [
      'approvalPolicyFingerprint',
      'authorizationFingerprint',
      'candidateEvidenceSetFingerprint',
      'expectedRegistryFingerprint',
      'expectedRegistryId',
      'expectedRegistryUpdatedAt',
      'guardFingerprint',
      'operationSetFingerprint',
      'previewFingerprint',
      'targetLocatorFingerprint',
    ]
  );
  const matchingPreflight =
    await routeAwareResolver.promptRegistryRepairPreflight(
      currentUser as any,
      { workspaceId: 'workspace-smoke' } as any,
      gateVerdict.name,
      {
        approvalPolicyFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .approvalPolicyFingerprint,
        authorizationFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .authorizationFingerprint,
        candidateEvidenceSetFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .candidateEvidenceSetFingerprint,
        catalogFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .catalogFingerprint,
        contractVersion:
          routeReadyGate.repairActionPreview.submissionContract.contractVersion,
        expectedRegistryFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .expectedRegistryFingerprint,
        expectedRegistryId:
          routeReadyGate.repairActionPreview.submissionContract
            .expectedRegistryId,
        expectedRegistryUpdatedAt:
          routeReadyGate.repairActionPreview.submissionContract
            .expectedRegistryUpdatedAt,
        guardFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .guardFingerprint,
        idempotencyKey:
          routeReadyGate.repairActionPreview.submissionContract.idempotencyKey,
        operationSetFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .operationSetFingerprint,
        previewFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .previewFingerprint,
        requiredInputs:
          routeReadyGate.repairActionPreview.submissionContract.requiredInputs,
        submissionFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .submissionFingerprint,
        targetLocatorFingerprint:
          routeReadyGate.repairActionPreview.submissionContract
            .targetLocatorFingerprint,
      },
      {
        registryFingerprint: gateVerdict.registryFingerprint,
        registryId: gateVerdict.registryId,
        registryUpdatedAt: gateVerdict.registryUpdatedAt.toISOString(),
      }
    );
  assert.equal(matchingPreflight?.readOnly, true);
  assert.equal(matchingPreflight?.mutationAvailable, false);
  assert.equal(matchingPreflight?.accepted, false);
  assert.equal(matchingPreflight?.status, 'ready_for_review');
  assert.equal(matchingPreflight?.permissionChecked, true);
  assert.equal(matchingPreflight?.permissionCheckMode, 'workspace_assert');
  assert.equal(matchingPreflight?.permissionScope, 'workspace');
  assert.equal(matchingPreflight?.permissionStatus, 'granted');
  assert.equal(matchingPreflight?.requiredPermission, 'Workspace.Copilot');
  assert.equal(matchingPreflight?.workspaceId, 'workspace-smoke');
  assert.match(
    matchingPreflight?.permissionFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    matchingPreflight?.capabilityCheckMode,
    'preview_capability_snapshot'
  );
  assert.equal(matchingPreflight?.capabilitySource, 'repair_action_preview');
  assert.equal(matchingPreflight?.capabilityStatus, 'declared');
  assert.equal(
    matchingPreflight?.candidateEvidenceSetFingerprint,
    routeReadyGate.repairActionPreview.candidateEvidenceSetFingerprint
  );
  assert.equal(
    matchingPreflight?.expectedCandidateEvidenceSetFingerprint,
    routeReadyGate.repairActionPreview.candidateEvidenceSetFingerprint
  );
  assert.equal(
    matchingPreflight?.targetLocatorFingerprint,
    routeReadyGate.repairActionMutationGuard.targetLocatorFingerprint
  );
  assert.equal(
    matchingPreflight?.expectedTargetLocatorFingerprint,
    routeReadyGate.repairActionMutationGuard.targetLocatorFingerprint
  );
  assert.match(
    matchingPreflight?.capabilityFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    matchingPreflight?.requiredCapabilities,
    routeReadyGate.repairActionPreview.requiredCapabilities
  );
  assert.equal(
    matchingPreflight?.requiredCapabilityCount,
    routeReadyGate.repairActionPreview.requiredCapabilities.length
  );
  assert.equal(
    matchingPreflight?.reviewBindingVersion,
    'repair-preflight-review-binding/v1'
  );
  assert.equal(matchingPreflight?.reviewBindingStatus, 'ready_for_review');
  assert.match(
    matchingPreflight?.reviewBindingFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(matchingPreflight?.reviewBindingInputs, [
    'candidateEvidenceSetFingerprint',
    'capabilityFingerprint',
    'permissionFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
  ]);
  assert.equal(
    matchingPreflight?.idempotencyVersion,
    'repair-preflight-idempotency/v1'
  );
  assert.equal(
    matchingPreflight?.idempotencyKey,
    routeReadyGate.repairActionPreview.submissionContract.idempotencyKey
  );
  assert.equal(matchingPreflight?.idempotencyScope, 'workspace');
  assert.equal(matchingPreflight?.idempotencyStatus, 'not_acquired_read_only');
  assert.equal(matchingPreflight?.idempotencyLockAcquired, false);
  assert.match(
    matchingPreflight?.idempotencyFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    matchingPreflight?.actorSnapshotVersion,
    'repair-preflight-actor-snapshot/v1'
  );
  assert.equal(matchingPreflight?.actorSnapshotStatus, 'bound_to_current_user');
  assert.equal(matchingPreflight?.actorType, 'user');
  assert.match(matchingPreflight?.actorFingerprint ?? '', /^[0-9a-f]{16}$/);
  assert.deepEqual(matchingPreflight?.actorSnapshotInputs, [
    'actorHash',
    'actorType',
    'source',
    'workspaceId',
  ]);
  assert.equal(
    matchingPreflight?.auditBindingVersion,
    'repair-preflight-audit-binding/v1'
  );
  assert.equal(matchingPreflight?.auditBindingStatus, 'ready_for_review');
  assert.match(
    matchingPreflight?.auditBindingFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(matchingPreflight?.auditBindingInputs, [
    'actorFingerprint',
    'capabilityFingerprint',
    'permissionFingerprint',
    'reviewBindingFingerprint',
  ]);
  assert.equal(
    matchingPreflight?.auditEventVersion,
    'repair-preflight-audit-event/v1'
  );
  assert.equal(matchingPreflight?.auditEventStatus, 'not_created_read_only');
  assert.equal(matchingPreflight?.auditEventCreated, false);
  assert.match(
    matchingPreflight?.auditEventFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(matchingPreflight?.auditEventInputs, [
    'actorFingerprint',
    'approvalRecordFingerprint',
    'auditBindingFingerprint',
    'candidateEvidenceSetFingerprint',
    'operationSetFingerprint',
    'policyBindingFingerprint',
    'repairJobFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
  ]);
  assert.equal(
    matchingPreflight?.executionStateVersion,
    'repair-preflight-execution-state/v1'
  );
  assert.equal(
    matchingPreflight?.executionStateStatus,
    'not_started_read_only'
  );
  assert.equal(matchingPreflight?.executionStateCreated, false);
  assert.match(
    matchingPreflight?.executionStateFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(matchingPreflight?.executionStateInputs, [
    'auditEventFingerprint',
    'candidateEvidenceSetFingerprint',
    'idempotencyFingerprint',
    'operationSetFingerprint',
    'repairJobFingerprint',
    'reviewBindingFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
  ]);
  assert.equal(
    matchingPreflight?.rollbackPlanVersion,
    'repair-preflight-rollback-plan/v1'
  );
  assert.equal(matchingPreflight?.rollbackPlanStatus, 'not_created_read_only');
  assert.equal(matchingPreflight?.rollbackPlanCreated, false);
  assert.match(
    matchingPreflight?.rollbackPlanFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(matchingPreflight?.rollbackPlanInputs, [
    'auditEventFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionStateFingerprint',
    'operationSetFingerprint',
    'repairJobFingerprint',
    'reviewBindingFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
  ]);
  assert.equal(
    matchingPreflight?.policyBindingVersion,
    'repair-preflight-policy-binding/v1'
  );
  assert.equal(matchingPreflight?.policyBindingStatus, 'ready_for_review');
  assert.equal(
    matchingPreflight?.policySource,
    'repair_action_preview_policy_snapshot'
  );
  assert.match(
    matchingPreflight?.policyBindingFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(matchingPreflight?.policyBindingInputs, [
    'actorFingerprint',
    'approvalPolicyFingerprint',
    'auditBindingFingerprint',
    'authorizationFingerprint',
    'capabilityFingerprint',
    'permissionFingerprint',
  ]);
  assert.equal(
    matchingPreflight?.approvalRequestVersion,
    'repair-preflight-approval-request/v1'
  );
  assert.equal(matchingPreflight?.approvalRequestStatus, 'approval_required');
  assert.equal(matchingPreflight?.approvalRequired, true);
  assert.equal(matchingPreflight?.authorizationStatus, 'approval_required');
  assert.match(
    matchingPreflight?.approvalRequestFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    matchingPreflight?.approvalModes,
    routeReadyGate.repairActionPreview.approvalModes
  );
  assert.deepEqual(
    matchingPreflight?.approvalCheckpoints,
    routeReadyGate.repairActionPreview.approvalCheckpoints
  );
  assert.deepEqual(matchingPreflight?.approvalRequestInputs, [
    'approvalCheckpoints',
    'approvalModes',
    'approvalPolicyFingerprint',
    'approvalRequired',
    'authorizationFingerprint',
    'authorizationStatus',
    'policyBindingFingerprint',
    'reviewBindingFingerprint',
  ]);
  assert.equal(
    matchingPreflight?.approvalRecordVersion,
    'repair-preflight-approval-record/v1'
  );
  assert.equal(
    matchingPreflight?.approvalRecordStatus,
    'not_created_read_only'
  );
  assert.equal(matchingPreflight?.approvalRecordCreated, false);
  assert.match(
    matchingPreflight?.approvalRecordFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(matchingPreflight?.approvalRecordInputs, [
    'actorFingerprint',
    'approvalRequestFingerprint',
    'auditBindingFingerprint',
    'policyBindingFingerprint',
    'reviewBindingFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    matchingPreflight?.repairJobVersion,
    'repair-preflight-job-contract/v1'
  );
  assert.equal(matchingPreflight?.repairJobStatus, 'not_created_read_only');
  assert.equal(matchingPreflight?.repairJobCreated, false);
  assert.match(matchingPreflight?.repairJobFingerprint ?? '', /^[0-9a-f]{16}$/);
  assert.deepEqual(matchingPreflight?.repairJobInputs, [
    'actorFingerprint',
    'auditBindingFingerprint',
    'candidateEvidenceSetFingerprint',
    'idempotencyFingerprint',
    'operationSetFingerprint',
    'policyBindingFingerprint',
    'reviewBindingFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
  ]);
  assert.equal(
    matchingPreflight?.executionGateVersion,
    'repair-preflight-execution-gate/v1'
  );
  assert.equal(matchingPreflight?.executionGateStatus, 'blocked_read_only');
  assert.match(
    matchingPreflight?.executionGateFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(matchingPreflight?.executionGateInputs, [
    'approvalRecordFingerprint',
    'approvalRequestFingerprint',
    'auditEventFingerprint',
    'executionStateFingerprint',
    'idempotencyFingerprint',
    'mutationAvailable',
    'policyBindingFingerprint',
    'readOnly',
    'repairJobFingerprint',
    'reviewBindingFingerprint',
    'rollbackPlanFingerprint',
    'targetLocatorFingerprint',
  ]);
  assert.deepEqual(permissionAssertions, [
    {
      action: 'Workspace.Copilot',
      userId: 'user-smoke',
      workspaceId: 'workspace-smoke',
    },
  ]);
  const executionRequest =
    await routeAwareResolver.requestCopilotPromptRegistryRepairExecution(
      currentUser as any,
      {
        workspaceId: 'workspace-smoke',
        name: gateVerdict.name,
        expectedVersion: {
          registryFingerprint: gateVerdict.registryFingerprint,
          registryId: gateVerdict.registryId,
          registryUpdatedAt: gateVerdict.registryUpdatedAt.toISOString(),
        },
        submission: {
          approvalPolicyFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .approvalPolicyFingerprint,
          authorizationFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .authorizationFingerprint,
          candidateEvidenceSetFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .candidateEvidenceSetFingerprint,
          catalogFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .catalogFingerprint,
          contractVersion:
            routeReadyGate.repairActionPreview.submissionContract
              .contractVersion,
          expectedRegistryFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .expectedRegistryFingerprint,
          expectedRegistryId:
            routeReadyGate.repairActionPreview.submissionContract
              .expectedRegistryId,
          expectedRegistryUpdatedAt:
            routeReadyGate.repairActionPreview.submissionContract
              .expectedRegistryUpdatedAt,
          guardFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .guardFingerprint,
          idempotencyKey:
            routeReadyGate.repairActionPreview.submissionContract
              .idempotencyKey,
          operationSetFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .operationSetFingerprint,
          previewFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .previewFingerprint,
          requiredInputs:
            routeReadyGate.repairActionPreview.submissionContract
              .requiredInputs,
          submissionFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .submissionFingerprint,
          targetLocatorFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .targetLocatorFingerprint,
        },
        expectedApprovalRecordFingerprint:
          matchingPreflight?.approvalRecordFingerprint ?? '',
        expectedApprovalRequestFingerprint:
          matchingPreflight?.approvalRequestFingerprint ?? '',
        expectedAuditEventFingerprint:
          matchingPreflight?.auditEventFingerprint ?? '',
        expectedCandidateEvidenceSetFingerprint:
          matchingPreflight?.candidateEvidenceSetFingerprint ?? '',
        expectedTargetLocatorFingerprint:
          matchingPreflight?.targetLocatorFingerprint ?? '',
        expectedExecutionGateFingerprint:
          matchingPreflight?.executionGateFingerprint ?? '',
        expectedExecutionGateStatus:
          matchingPreflight?.executionGateStatus ?? '',
        expectedExecutionStateFingerprint:
          matchingPreflight?.executionStateFingerprint ?? '',
        expectedIdempotencyFingerprint:
          matchingPreflight?.idempotencyFingerprint ?? '',
        expectedPolicyBindingFingerprint:
          matchingPreflight?.policyBindingFingerprint ?? '',
        expectedPreflightStatus: matchingPreflight?.status ?? '',
        expectedRepairJobFingerprint:
          matchingPreflight?.repairJobFingerprint ?? '',
        expectedReviewBindingFingerprint:
          matchingPreflight?.reviewBindingFingerprint ?? '',
        expectedRollbackPlanFingerprint:
          matchingPreflight?.rollbackPlanFingerprint ?? '',
      } as any
    );
  assert.equal(executionRequest.requestVersion, 'repair-execution-request/v1');
  assert.equal(executionRequest.requestStatus, 'blocked_read_only');
  assert.equal(executionRequest.readOnly, true);
  assert.equal(executionRequest.mutationAvailable, false);
  assert.equal(executionRequest.accepted, false);
  assert.equal(executionRequest.executionRequested, false);
  assert.equal(
    executionRequest.expectedCandidateEvidenceSetFingerprint,
    matchingPreflight?.candidateEvidenceSetFingerprint
  );
  assert.equal(
    executionRequest.expectedTargetLocatorFingerprint,
    matchingPreflight?.targetLocatorFingerprint
  );
  assert.equal(
    executionRequest.approvalRecordRequestVersion,
    'repair-execution-approval-record-request/v1'
  );
  assert.equal(
    executionRequest.approvalRecordRequestStatus,
    'not_created_read_only'
  );
  assert.equal(executionRequest.approvalRecordRequestCreated, false);
  assert.match(
    executionRequest.approvalRecordRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.approvalRecordRequestInputs, [
    'actorFingerprint',
    'approvalRecordFingerprint',
    'approvalRequestFingerprint',
    'auditBindingFingerprint',
    'candidateEvidenceSetFingerprint',
    'idempotencyLockFingerprint',
    'policyBindingFingerprint',
    'requestStatus',
    'reviewBindingFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.auditEventRequestVersion,
    'repair-execution-audit-event-request/v1'
  );
  assert.equal(
    executionRequest.auditEventRequestStatus,
    'not_created_read_only'
  );
  assert.equal(executionRequest.auditEventRequestCreated, false);
  assert.match(executionRequest.auditEventRequestFingerprint, /^[0-9a-f]{16}$/);
  assert.deepEqual(executionRequest.auditEventRequestInputs, [
    'actorFingerprint',
    'approvalRecordRequestFingerprint',
    'auditBindingFingerprint',
    'auditEventFingerprint',
    'candidateEvidenceSetFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'policyBindingFingerprint',
    'repairJobFingerprint',
    'requestStatus',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionCompletionEventRequestVersion,
    'repair-execution-completion-event-request/v1'
  );
  assert.equal(
    executionRequest.executionCompletionEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(executionRequest.executionCompletionEventRequestCreated, false);
  assert.match(
    executionRequest.executionCompletionEventRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionCompletionEventRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionCompletionRequestFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionRollbackOutcomeRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionCompletionRequestVersion,
    'repair-execution-completion-request/v1'
  );
  assert.equal(
    executionRequest.executionCompletionRequestStatus,
    'not_completed_read_only'
  );
  assert.equal(executionRequest.executionCompletionRequestCreated, false);
  assert.match(
    executionRequest.executionCompletionRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionCompletionRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionRollbackOutcomeRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionFinalizationEventRequestVersion,
    'repair-execution-finalization-event-request/v1'
  );
  assert.equal(
    executionRequest.executionFinalizationEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    executionRequest.executionFinalizationEventRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionFinalizationEventRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionFinalizationEventRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionCompletionEventRequestFingerprint',
    'executionCompletionRequestFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionFinalizationRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionRollbackOutcomeRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionFinalizationRequestVersion,
    'repair-execution-finalization-request/v1'
  );
  assert.equal(
    executionRequest.executionFinalizationRequestStatus,
    'not_finalized_read_only'
  );
  assert.equal(executionRequest.executionFinalizationRequestCreated, false);
  assert.match(
    executionRequest.executionFinalizationRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionFinalizationRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionCompletionEventRequestFingerprint',
    'executionCompletionRequestFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionRollbackOutcomeRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionStatusPollRequestVersion,
    'repair-execution-status-poll-request/v1'
  );
  assert.equal(
    executionRequest.executionStatusPollRequestStatus,
    'not_started_read_only'
  );
  assert.equal(executionRequest.executionStatusPollRequestCreated, false);
  assert.match(
    executionRequest.executionStatusPollRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionStatusPollRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionCompletionEventRequestFingerprint',
    'executionCompletionRequestFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionFinalizationEventRequestFingerprint',
    'executionFinalizationRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionRollbackOutcomeRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionOperationEntryRequestVersion,
    'repair-execution-operation-entry-request/v1'
  );
  assert.equal(
    executionRequest.executionOperationEntryRequestStatus,
    'not_opened_read_only'
  );
  assert.equal(executionRequest.executionOperationEntryRequestCreated, false);
  assert.match(
    executionRequest.executionOperationEntryRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionOperationEntryRequestInputs, [
    'approvalRecordRequestFingerprint',
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionCompletionEventRequestFingerprint',
    'executionCompletionRequestFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionFinalizationEventRequestFingerprint',
    'executionFinalizationRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionRollbackOutcomeRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionApprovalUiRequestVersion,
    'repair-execution-approval-ui-request/v1'
  );
  assert.equal(
    executionRequest.executionApprovalUiRequestStatus,
    'not_rendered_read_only'
  );
  assert.equal(executionRequest.executionApprovalUiRequestCreated, false);
  assert.match(
    executionRequest.executionApprovalUiRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionApprovalUiRequestInputs, [
    'approvalRecordRequestFingerprint',
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionOperationEntryRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionDiffPreviewRequestVersion,
    'repair-execution-diff-preview-request/v1'
  );
  assert.equal(
    executionRequest.executionDiffPreviewRequestStatus,
    'not_generated_read_only'
  );
  assert.equal(executionRequest.executionDiffPreviewRequestCreated, false);
  assert.match(
    executionRequest.executionDiffPreviewRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionDiffPreviewRequestInputs, [
    'approvalRecordRequestFingerprint',
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionApprovalUiRequestFingerprint',
    'executionOperationEntryRequestFingerprint',
    'guardFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'previewFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionApprovalDecisionRequestVersion,
    'repair-execution-approval-decision-request/v1'
  );
  assert.equal(
    executionRequest.executionApprovalDecisionRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(executionRequest.executionApprovalDecisionRequestCreated, false);
  assert.match(
    executionRequest.executionApprovalDecisionRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionApprovalDecisionRequestInputs, [
    'approvalRecordRequestFingerprint',
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionApprovalUiRequestFingerprint',
    'executionDiffPreviewRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionStartRequestVersion,
    'repair-execution-start-request/v1'
  );
  assert.equal(
    executionRequest.executionStartRequestStatus,
    'not_started_read_only'
  );
  assert.equal(executionRequest.executionStartRequestCreated, false);
  assert.match(
    executionRequest.executionStartRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionStartRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionApprovalDecisionRequestFingerprint',
    'executionOperationEntryRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionQueueRequestVersion,
    'repair-execution-queue-request/v1'
  );
  assert.equal(
    executionRequest.executionQueueRequestStatus,
    'not_enqueued_read_only'
  );
  assert.equal(executionRequest.executionQueueRequestCreated, false);
  assert.match(
    executionRequest.executionQueueRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionQueueRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionWorkerLeaseRequestVersion,
    'repair-execution-worker-lease-request/v1'
  );
  assert.equal(
    executionRequest.executionWorkerLeaseRequestStatus,
    'not_acquired_read_only'
  );
  assert.equal(executionRequest.executionWorkerLeaseRequestCreated, false);
  assert.match(
    executionRequest.executionWorkerLeaseRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionWorkerLeaseRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionQueueRequestFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionJobRunRequestVersion,
    'repair-execution-job-run-request/v1'
  );
  assert.equal(
    executionRequest.executionJobRunRequestStatus,
    'not_started_read_only'
  );
  assert.equal(executionRequest.executionJobRunRequestCreated, false);
  assert.match(
    executionRequest.executionJobRunRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionJobRunRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionQueueRequestFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'executionWorkerLeaseRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRunStepRequestVersion,
    'repair-execution-run-step-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRequestStatus,
    'not_created_read_only'
  );
  assert.equal(executionRequest.executionRunStepRequestCreated, false);
  assert.match(
    executionRequest.executionRunStepRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRunStepRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionJobRunRequestFingerprint',
    'executionQueueRequestFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'executionWorkerLeaseRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRunStepTraceRequestVersion,
    'repair-execution-run-step-trace-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepTraceRequestStatus,
    'not_created_read_only'
  );
  assert.equal(executionRequest.executionRunStepTraceRequestCreated, false);
  assert.match(
    executionRequest.executionRunStepTraceRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRunStepTraceRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionJobRunRequestFingerprint',
    'executionQueueRequestFingerprint',
    'executionRunStepRequestFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'executionTraceRequestFingerprint',
    'executionWorkerLeaseRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRunStepResultRequestVersion,
    'repair-execution-run-step-result-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepResultRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(executionRequest.executionRunStepResultRequestCreated, false);
  assert.match(
    executionRequest.executionRunStepResultRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRunStepResultRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionJobRunRequestFingerprint',
    'executionQueueRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRunStepRequestFingerprint',
    'executionRunStepTraceRequestFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'executionTraceRequestFingerprint',
    'executionWorkerLeaseRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRunStepCompletionRequestVersion,
    'repair-execution-run-step-completion-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepCompletionRequestStatus,
    'not_completed_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepCompletionRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepCompletionRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRunStepCompletionRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionJobRunRequestFingerprint',
    'executionQueueRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRunStepRequestFingerprint',
    'executionRunStepResultRequestFingerprint',
    'executionRunStepTraceRequestFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'executionTraceRequestFingerprint',
    'executionWorkerLeaseRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRunStepStatusEventRequestVersion,
    'repair-execution-run-step-status-event-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepStatusEventRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepStatusEventRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRunStepStatusEventRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionJobRunRequestFingerprint',
    'executionQueueRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRunStepCompletionRequestFingerprint',
    'executionRunStepRequestFingerprint',
    'executionRunStepResultRequestFingerprint',
    'executionRunStepTraceRequestFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'executionTraceRequestFingerprint',
    'executionWorkerLeaseRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRunStepRetryRequestVersion,
    'repair-execution-run-step-retry-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryRequestStatus,
    'not_scheduled_read_only'
  );
  assert.equal(executionRequest.executionRunStepRetryRequestCreated, false);
  assert.match(
    executionRequest.executionRunStepRetryRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRunStepRetryRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionJobRunRequestFingerprint',
    'executionQueueRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionRunStepCompletionRequestFingerprint',
    'executionRunStepRequestFingerprint',
    'executionRunStepResultRequestFingerprint',
    'executionRunStepStatusEventRequestFingerprint',
    'executionRunStepTraceRequestFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'executionTraceRequestFingerprint',
    'executionWorkerLeaseRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRequestVersion,
    'repair-execution-run-step-retry-attempt-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRunStepRetryAttemptRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionJobRunRequestFingerprint',
    'executionQueueRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionRunStepCompletionRequestFingerprint',
    'executionRunStepRequestFingerprint',
    'executionRunStepResultRequestFingerprint',
    'executionRunStepRetryRequestFingerprint',
    'executionRunStepStatusEventRequestFingerprint',
    'executionRunStepTraceRequestFingerprint',
    'executionStartRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionStatusPollRequestFingerprint',
    'executionTraceRequestFingerprint',
    'executionWorkerLeaseRequestFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRunStepRetryAttemptStatusEventRequestVersion,
    'repair-execution-run-step-retry-attempt-status-event-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptStatusEventRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptStatusEventRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptStatusEventRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptTraceRequestVersion,
    'repair-execution-run-step-retry-attempt-trace-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptTraceRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptTraceRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptTraceRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptTraceRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptResultRequestVersion,
    'repair-execution-run-step-retry-attempt-result-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptResultRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptResultRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptResultRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptResultRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCompletionRequestVersion,
    'repair-execution-run-step-retry-attempt-completion-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCompletionRequestStatus,
    'not_completed_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCompletionRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptCompletionRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptCompletionRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCompletionStatusEventRequestVersion,
    'repair-execution-run-step-retry-attempt-completion-status-event-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCompletionStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCompletionStatusEventRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptCompletionStatusEventRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptCompletionRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptFinalizationRequestVersion,
    'repair-execution-run-step-retry-attempt-finalization-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptFinalizationRequestStatus,
    'not_finalized_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptFinalizationRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptFinalizationRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptFinalizationRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptCompletionRequestFingerprint',
      'executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptFinalizationStatusEventRequestVersion,
    'repair-execution-run-step-retry-attempt-finalization-status-event-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptFinalizationStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptFinalizationStatusEventRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptFinalizationStatusEventRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptCompletionRequestFingerprint',
      'executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCloseRequestVersion,
    'repair-execution-run-step-retry-attempt-close-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCloseRequestStatus,
    'not_closed_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCloseRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptCloseRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptCloseRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptCompletionRequestFingerprint',
      'executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCloseStatusEventRequestVersion,
    'repair-execution-run-step-retry-attempt-close-status-event-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCloseStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptCloseStatusEventRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptCloseStatusEventRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptCloseStatusEventRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptCloseRequestFingerprint',
      'executionRunStepRetryAttemptCompletionRequestFingerprint',
      'executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRequestVersion,
    'repair-execution-run-step-retry-attempt-retention-policy-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptCloseRequestFingerprint',
      'executionRunStepRetryAttemptCloseStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptCompletionRequestFingerprint',
      'executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRuleRequestVersion,
    'repair-execution-run-step-retry-attempt-retention-policy-rule-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRuleRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRuleRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRuleRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptCloseRequestFingerprint',
      'executionRunStepRetryAttemptCloseStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptCompletionRequestFingerprint',
      'executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptRetentionPolicyRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRetentionLeaseRequestVersion,
    'repair-execution-run-step-retry-attempt-retention-lease-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRetentionLeaseRequestStatus,
    'not_acquired_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptRetentionLeaseRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptRetentionLeaseRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptRetentionLeaseRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptCloseRequestFingerprint',
      'executionRunStepRetryAttemptCloseStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptCompletionRequestFingerprint',
      'executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptRetentionPolicyRequestFingerprint',
      'executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptArchiveRequestVersion,
    'repair-execution-run-step-retry-attempt-archive-request/v1'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptArchiveRequestStatus,
    'not_archived_read_only'
  );
  assert.equal(
    executionRequest.executionRunStepRetryAttemptArchiveRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRunStepRetryAttemptArchiveRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    executionRequest.executionRunStepRetryAttemptArchiveRequestInputs,
    [
      'auditEventRequestFingerprint',
      'candidateEvidenceSetFingerprint',
      'executionJobRunRequestFingerprint',
      'executionQueueRequestFingerprint',
      'executionResultRequestFingerprint',
      'executionRetryPolicyRequestFingerprint',
      'executionRunStepCompletionRequestFingerprint',
      'executionRunStepRequestFingerprint',
      'executionRunStepResultRequestFingerprint',
      'executionRunStepRetryAttemptCloseRequestFingerprint',
      'executionRunStepRetryAttemptCloseStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptCompletionRequestFingerprint',
      'executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationRequestFingerprint',
      'executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptRequestFingerprint',
      'executionRunStepRetryAttemptResultRequestFingerprint',
      'executionRunStepRetryAttemptRetentionLeaseRequestFingerprint',
      'executionRunStepRetryAttemptRetentionPolicyRequestFingerprint',
      'executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint',
      'executionRunStepRetryAttemptStatusEventRequestFingerprint',
      'executionRunStepRetryAttemptTraceRequestFingerprint',
      'executionRunStepRetryRequestFingerprint',
      'executionRunStepStatusEventRequestFingerprint',
      'executionRunStepTraceRequestFingerprint',
      'executionStartRequestFingerprint',
      'executionStateRequestFingerprint',
      'executionStatusPollRequestFingerprint',
      'executionTraceRequestFingerprint',
      'executionWorkerLeaseRequestFingerprint',
      'idempotencyLockFingerprint',
      'operationSetFingerprint',
      'repairJobRequestFingerprint',
      'requestStatus',
      'rollbackPlanRequestFingerprint',
      'submissionFingerprint',
      'targetLocatorFingerprint',
      'workspaceId',
    ]
  );
  assert.equal(
    executionRequest.executionFailureEventRequestVersion,
    'repair-execution-failure-event-request/v1'
  );
  assert.equal(
    executionRequest.executionFailureEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(executionRequest.executionFailureEventRequestCreated, false);
  assert.match(
    executionRequest.executionFailureEventRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionFailureEventRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionProviderResponseRequestVersion,
    'repair-execution-provider-response-request/v1'
  );
  assert.equal(
    executionRequest.executionProviderResponseRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(executionRequest.executionProviderResponseRequestCreated, false);
  assert.match(
    executionRequest.executionProviderResponseRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionProviderResponseRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionResultRequestVersion,
    'repair-execution-result-request/v1'
  );
  assert.equal(
    executionRequest.executionResultRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(executionRequest.executionResultRequestCreated, false);
  assert.match(
    executionRequest.executionResultRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionResultRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRetryPolicyRequestVersion,
    'repair-execution-retry-policy-request/v1'
  );
  assert.equal(
    executionRequest.executionRetryPolicyRequestStatus,
    'not_created_read_only'
  );
  assert.equal(executionRequest.executionRetryPolicyRequestCreated, false);
  assert.match(
    executionRequest.executionRetryPolicyRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRetryPolicyRequestInputs, [
    'candidateEvidenceSetFingerprint',
    'executionResultRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRollbackExecutorRequestVersion,
    'repair-execution-rollback-executor-request/v1'
  );
  assert.equal(
    executionRequest.executionRollbackExecutorRequestStatus,
    'not_started_read_only'
  );
  assert.equal(executionRequest.executionRollbackExecutorRequestCreated, false);
  assert.match(
    executionRequest.executionRollbackExecutorRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRollbackExecutorRequestInputs, [
    'candidateEvidenceSetFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRollbackTriggerRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRollbackOperationRequestVersion,
    'repair-execution-rollback-operation-request/v1'
  );
  assert.equal(
    executionRequest.executionRollbackOperationRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    executionRequest.executionRollbackOperationRequestCreated,
    false
  );
  assert.match(
    executionRequest.executionRollbackOperationRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRollbackOperationRequestInputs, [
    'candidateEvidenceSetFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRollbackExecutorRequestFingerprint',
    'executionRollbackTriggerRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRollbackOutcomeRequestVersion,
    'repair-execution-rollback-outcome-request/v1'
  );
  assert.equal(
    executionRequest.executionRollbackOutcomeRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(executionRequest.executionRollbackOutcomeRequestCreated, false);
  assert.match(
    executionRequest.executionRollbackOutcomeRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRollbackOutcomeRequestInputs, [
    'candidateEvidenceSetFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRollbackExecutorRequestFingerprint',
    'executionRollbackOperationRequestFingerprint',
    'executionRollbackTriggerRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionRollbackTriggerRequestVersion,
    'repair-execution-rollback-trigger-request/v1'
  );
  assert.equal(
    executionRequest.executionRollbackTriggerRequestStatus,
    'not_created_read_only'
  );
  assert.equal(executionRequest.executionRollbackTriggerRequestCreated, false);
  assert.match(
    executionRequest.executionRollbackTriggerRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionRollbackTriggerRequestInputs, [
    'candidateEvidenceSetFingerprint',
    'executionFailureEventRequestFingerprint',
    'executionProviderResponseRequestFingerprint',
    'executionResultRequestFingerprint',
    'executionRetryPolicyRequestFingerprint',
    'executionStateRequestFingerprint',
    'executionTraceRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionTraceRequestVersion,
    'repair-execution-trace-request/v1'
  );
  assert.equal(
    executionRequest.executionTraceRequestStatus,
    'not_created_read_only'
  );
  assert.equal(executionRequest.executionTraceRequestCreated, false);
  assert.match(
    executionRequest.executionTraceRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionTraceRequestInputs, [
    'actorFingerprint',
    'approvalRecordRequestFingerprint',
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionStateRequestFingerprint',
    'idempotencyLockFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'rollbackPlanRequestFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.executionStateRequestVersion,
    'repair-execution-state-request/v1'
  );
  assert.equal(
    executionRequest.executionStateRequestStatus,
    'not_started_read_only'
  );
  assert.equal(executionRequest.executionStateRequestCreated, false);
  assert.match(
    executionRequest.executionStateRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.executionStateRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionStateFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'reviewBindingFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.rollbackPlanRequestVersion,
    'repair-execution-rollback-plan-request/v1'
  );
  assert.equal(
    executionRequest.rollbackPlanRequestStatus,
    'not_created_read_only'
  );
  assert.equal(executionRequest.rollbackPlanRequestCreated, false);
  assert.match(
    executionRequest.rollbackPlanRequestFingerprint,
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(executionRequest.rollbackPlanRequestInputs, [
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'executionStateRequestFingerprint',
    'operationSetFingerprint',
    'repairJobRequestFingerprint',
    'requestStatus',
    'reviewBindingFingerprint',
    'rollbackPlanFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.repairJobRequestVersion,
    'repair-execution-repair-job-request/v1'
  );
  assert.equal(
    executionRequest.repairJobRequestStatus,
    'not_created_read_only'
  );
  assert.equal(executionRequest.repairJobRequestCreated, false);
  assert.match(executionRequest.repairJobRequestFingerprint, /^[0-9a-f]{16}$/);
  assert.deepEqual(executionRequest.repairJobRequestInputs, [
    'actorFingerprint',
    'approvalRecordRequestFingerprint',
    'auditEventRequestFingerprint',
    'candidateEvidenceSetFingerprint',
    'idempotencyLockFingerprint',
    'operationSetFingerprint',
    'policyBindingFingerprint',
    'repairJobFingerprint',
    'requestStatus',
    'reviewBindingFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
    'workspaceId',
  ]);
  assert.equal(
    executionRequest.idempotencyLockVersion,
    'repair-execution-idempotency-lock/v1'
  );
  assert.equal(
    executionRequest.idempotencyLockStatus,
    'not_acquired_read_only'
  );
  assert.equal(executionRequest.idempotencyLockAcquired, false);
  assert.equal(executionRequest.idempotencyLockScope, 'workspace');
  assert.match(executionRequest.idempotencyLockFingerprint, /^[0-9a-f]{16}$/);
  assert.deepEqual(executionRequest.idempotencyLockInputs, [
    'candidateEvidenceSetFingerprint',
    'idempotencyFingerprint',
    'idempotencyKey',
    'policyBindingFingerprint',
    'requestStatus',
    'reviewBindingFingerprint',
    'submissionFingerprint',
    'targetLocatorFingerprint',
  ]);
  assert.match(executionRequest.requestFingerprint, /^[0-9a-f]{16}$/);
  assert.deepEqual(executionRequest.mismatchedFields, []);
  assert.deepEqual(executionRequest.matchedFields, [
    'expectedApprovalRecordFingerprint',
    'expectedApprovalRequestFingerprint',
    'expectedAuditEventFingerprint',
    'expectedCandidateEvidenceSetFingerprint',
    'expectedExecutionGateFingerprint',
    'expectedExecutionGateStatus',
    'expectedExecutionStateFingerprint',
    'expectedIdempotencyFingerprint',
    'expectedPolicyBindingFingerprint',
    'expectedPreflightStatus',
    'expectedRepairJobFingerprint',
    'expectedReviewBindingFingerprint',
    'expectedRollbackPlanFingerprint',
    'expectedTargetLocatorFingerprint',
  ]);
  assert.deepEqual(executionRequest.requestInputs, [
    'expectedApprovalRecordFingerprint',
    'expectedApprovalRequestFingerprint',
    'expectedAuditEventFingerprint',
    'expectedCandidateEvidenceSetFingerprint',
    'expectedExecutionGateFingerprint',
    'expectedExecutionGateStatus',
    'expectedExecutionStateFingerprint',
    'expectedIdempotencyFingerprint',
    'expectedPolicyBindingFingerprint',
    'expectedPreflightStatus',
    'expectedRepairJobFingerprint',
    'expectedReviewBindingFingerprint',
    'expectedRollbackPlanFingerprint',
    'expectedTargetLocatorFingerprint',
  ]);
  assert.equal(
    executionRequest.preflight.executionGateFingerprint,
    matchingPreflight?.executionGateFingerprint
  );
  assert.equal(
    executionRequest.preflight.candidateEvidenceSetFingerprint,
    matchingPreflight?.candidateEvidenceSetFingerprint
  );
  assert.equal(
    executionRequest.preflight.targetLocatorFingerprint,
    matchingPreflight?.targetLocatorFingerprint
  );
  assert.equal(
    executionRequest.preflight.expectedTargetLocatorFingerprint,
    matchingPreflight?.expectedTargetLocatorFingerprint
  );
  assert.equal(
    executionRequest.preflight.rollbackPlanFingerprint,
    matchingPreflight?.rollbackPlanFingerprint
  );
  const staleExecutionRequest =
    await routeAwareResolver.requestCopilotPromptRegistryRepairExecution(
      currentUser as any,
      {
        workspaceId: 'workspace-smoke',
        name: gateVerdict.name,
        expectedVersion: {
          registryFingerprint: gateVerdict.registryFingerprint,
          registryId: gateVerdict.registryId,
          registryUpdatedAt: gateVerdict.registryUpdatedAt.toISOString(),
        },
        submission: {
          approvalPolicyFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .approvalPolicyFingerprint,
          authorizationFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .authorizationFingerprint,
          candidateEvidenceSetFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .candidateEvidenceSetFingerprint,
          catalogFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .catalogFingerprint,
          contractVersion:
            routeReadyGate.repairActionPreview.submissionContract
              .contractVersion,
          expectedRegistryFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .expectedRegistryFingerprint,
          expectedRegistryId:
            routeReadyGate.repairActionPreview.submissionContract
              .expectedRegistryId,
          expectedRegistryUpdatedAt:
            routeReadyGate.repairActionPreview.submissionContract
              .expectedRegistryUpdatedAt,
          guardFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .guardFingerprint,
          idempotencyKey:
            routeReadyGate.repairActionPreview.submissionContract
              .idempotencyKey,
          operationSetFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .operationSetFingerprint,
          previewFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .previewFingerprint,
          requiredInputs:
            routeReadyGate.repairActionPreview.submissionContract
              .requiredInputs,
          submissionFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .submissionFingerprint,
          targetLocatorFingerprint:
            routeReadyGate.repairActionPreview.submissionContract
              .targetLocatorFingerprint,
        },
        expectedApprovalRecordFingerprint:
          matchingPreflight?.approvalRecordFingerprint ?? '',
        expectedApprovalRequestFingerprint:
          matchingPreflight?.approvalRequestFingerprint ?? '',
        expectedAuditEventFingerprint:
          matchingPreflight?.auditEventFingerprint ?? '',
        expectedCandidateEvidenceSetFingerprint:
          matchingPreflight?.candidateEvidenceSetFingerprint ?? '',
        expectedTargetLocatorFingerprint:
          matchingPreflight?.targetLocatorFingerprint ?? '',
        expectedExecutionGateFingerprint: '0000aaaabbbbcccc',
        expectedExecutionGateStatus:
          matchingPreflight?.executionGateStatus ?? '',
        expectedExecutionStateFingerprint:
          matchingPreflight?.executionStateFingerprint ?? '',
        expectedIdempotencyFingerprint:
          matchingPreflight?.idempotencyFingerprint ?? '',
        expectedPolicyBindingFingerprint:
          matchingPreflight?.policyBindingFingerprint ?? '',
        expectedPreflightStatus: matchingPreflight?.status ?? '',
        expectedRepairJobFingerprint:
          matchingPreflight?.repairJobFingerprint ?? '',
        expectedReviewBindingFingerprint:
          matchingPreflight?.reviewBindingFingerprint ?? '',
        expectedRollbackPlanFingerprint:
          matchingPreflight?.rollbackPlanFingerprint ?? '',
      } as any
    );
  assert.equal(staleExecutionRequest.requestStatus, 'blocked_stale_preflight');
  assert.equal(
    staleExecutionRequest.idempotencyLockStatus,
    'not_acquired_read_only'
  );
  assert.equal(
    staleExecutionRequest.approvalRecordRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.auditEventRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionCompletionEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionCompletionRequestStatus,
    'not_completed_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionFinalizationEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionFinalizationRequestStatus,
    'not_finalized_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionStatusPollRequestStatus,
    'not_started_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionOperationEntryRequestStatus,
    'not_opened_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionApprovalUiRequestStatus,
    'not_rendered_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionDiffPreviewRequestStatus,
    'not_generated_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionApprovalDecisionRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionStartRequestStatus,
    'not_started_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionQueueRequestStatus,
    'not_enqueued_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionWorkerLeaseRequestStatus,
    'not_acquired_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionJobRunRequestStatus,
    'not_started_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepTraceRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepResultRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepCompletionRequestStatus,
    'not_completed_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryRequestStatus,
    'not_scheduled_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptTraceRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptResultRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptCompletionRequestStatus,
    'not_completed_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptCompletionStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptFinalizationRequestStatus,
    'not_finalized_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptFinalizationStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptCloseRequestStatus,
    'not_closed_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptCloseStatusEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptRetentionPolicyRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptRetentionPolicyRuleRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptRetentionLeaseRequestStatus,
    'not_acquired_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRunStepRetryAttemptArchiveRequestStatus,
    'not_archived_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionFailureEventRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionProviderResponseRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionResultRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRetryPolicyRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRollbackExecutorRequestStatus,
    'not_started_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRollbackOperationRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRollbackOutcomeRequestStatus,
    'not_recorded_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionRollbackTriggerRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionTraceRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.executionStateRequestStatus,
    'not_started_read_only'
  );
  assert.equal(
    staleExecutionRequest.repairJobRequestStatus,
    'not_created_read_only'
  );
  assert.equal(
    staleExecutionRequest.rollbackPlanRequestStatus,
    'not_created_read_only'
  );
  assert.notEqual(
    staleExecutionRequest.idempotencyLockFingerprint,
    executionRequest.idempotencyLockFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.approvalRecordRequestFingerprint,
    executionRequest.approvalRecordRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.auditEventRequestFingerprint,
    executionRequest.auditEventRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionCompletionEventRequestFingerprint,
    executionRequest.executionCompletionEventRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionCompletionRequestFingerprint,
    executionRequest.executionCompletionRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionFinalizationEventRequestFingerprint,
    executionRequest.executionFinalizationEventRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionFinalizationRequestFingerprint,
    executionRequest.executionFinalizationRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionStatusPollRequestFingerprint,
    executionRequest.executionStatusPollRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionOperationEntryRequestFingerprint,
    executionRequest.executionOperationEntryRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionApprovalUiRequestFingerprint,
    executionRequest.executionApprovalUiRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionDiffPreviewRequestFingerprint,
    executionRequest.executionDiffPreviewRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionApprovalDecisionRequestFingerprint,
    executionRequest.executionApprovalDecisionRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionStartRequestFingerprint,
    executionRequest.executionStartRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionQueueRequestFingerprint,
    executionRequest.executionQueueRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionWorkerLeaseRequestFingerprint,
    executionRequest.executionWorkerLeaseRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionJobRunRequestFingerprint,
    executionRequest.executionJobRunRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRequestFingerprint,
    executionRequest.executionRunStepRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepTraceRequestFingerprint,
    executionRequest.executionRunStepTraceRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepResultRequestFingerprint,
    executionRequest.executionRunStepResultRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepCompletionRequestFingerprint,
    executionRequest.executionRunStepCompletionRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepStatusEventRequestFingerprint,
    executionRequest.executionRunStepStatusEventRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryRequestFingerprint,
    executionRequest.executionRunStepRetryRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptStatusEventRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptStatusEventRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptTraceRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptTraceRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptResultRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptResultRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptCompletionRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptCompletionRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptFinalizationRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptFinalizationRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptCloseRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptCloseRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptCloseStatusEventRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptCloseStatusEventRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptRetentionPolicyRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptRetentionLeaseRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptRetentionLeaseRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRunStepRetryAttemptArchiveRequestFingerprint,
    executionRequest.executionRunStepRetryAttemptArchiveRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionFailureEventRequestFingerprint,
    executionRequest.executionFailureEventRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionProviderResponseRequestFingerprint,
    executionRequest.executionProviderResponseRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionResultRequestFingerprint,
    executionRequest.executionResultRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRetryPolicyRequestFingerprint,
    executionRequest.executionRetryPolicyRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRollbackExecutorRequestFingerprint,
    executionRequest.executionRollbackExecutorRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRollbackOperationRequestFingerprint,
    executionRequest.executionRollbackOperationRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRollbackOutcomeRequestFingerprint,
    executionRequest.executionRollbackOutcomeRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionRollbackTriggerRequestFingerprint,
    executionRequest.executionRollbackTriggerRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionTraceRequestFingerprint,
    executionRequest.executionTraceRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.executionStateRequestFingerprint,
    executionRequest.executionStateRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.repairJobRequestFingerprint,
    executionRequest.repairJobRequestFingerprint
  );
  assert.notEqual(
    staleExecutionRequest.rollbackPlanRequestFingerprint,
    executionRequest.rollbackPlanRequestFingerprint
  );
  assert.deepEqual(staleExecutionRequest.mismatchedFields, [
    'expectedExecutionGateFingerprint',
  ]);
  assert.notEqual(
    staleExecutionRequest.requestFingerprint,
    executionRequest.requestFingerprint
  );
  assert.equal(
    matchingPreflight?.currentSubmissionFingerprint,
    routeReadyGate.repairActionPreview.submissionContract.submissionFingerprint
  );
  assert.equal(
    matchingPreflight?.expectedSubmissionFingerprint,
    routeReadyGate.repairActionPreview.submissionContract.submissionFingerprint
  );
  assert.deepEqual(matchingPreflight?.mismatchedFields, []);
  assert.deepEqual(matchingPreflight?.matchedFields, [
    'approvalPolicyFingerprint',
    'authorizationFingerprint',
    'candidateEvidenceSetFingerprint',
    'catalogFingerprint',
    'contractVersion',
    'expectedRegistryFingerprint',
    'expectedRegistryId',
    'expectedRegistryUpdatedAt',
    'guardFingerprint',
    'idempotencyKey',
    'operationSetFingerprint',
    'previewFingerprint',
    'requiredInputs',
    'submissionFingerprint',
    'targetLocatorFingerprint',
  ]);
  const stalePreflight = await routeAwareResolver.promptRegistryRepairPreflight(
    currentUser as any,
    { workspaceId: 'workspace-smoke' } as any,
    gateVerdict.name,
    {
      approvalPolicyFingerprint:
        routeReadyGate.repairActionPreview.submissionContract
          .approvalPolicyFingerprint,
      authorizationFingerprint:
        routeReadyGate.repairActionPreview.submissionContract
          .authorizationFingerprint,
      candidateEvidenceSetFingerprint:
        routeReadyGate.repairActionPreview.submissionContract
          .candidateEvidenceSetFingerprint,
      catalogFingerprint:
        routeReadyGate.repairActionPreview.submissionContract
          .catalogFingerprint,
      contractVersion:
        routeReadyGate.repairActionPreview.submissionContract.contractVersion,
      expectedRegistryFingerprint:
        routeReadyGate.repairActionPreview.submissionContract
          .expectedRegistryFingerprint,
      expectedRegistryId:
        routeReadyGate.repairActionPreview.submissionContract
          .expectedRegistryId,
      expectedRegistryUpdatedAt:
        routeReadyGate.repairActionPreview.submissionContract
          .expectedRegistryUpdatedAt,
      guardFingerprint:
        routeReadyGate.repairActionPreview.submissionContract.guardFingerprint,
      idempotencyKey:
        routeReadyGate.repairActionPreview.submissionContract.idempotencyKey,
      operationSetFingerprint:
        routeReadyGate.repairActionPreview.submissionContract
          .operationSetFingerprint,
      previewFingerprint: '0000aaaabbbbcccc',
      requiredInputs:
        routeReadyGate.repairActionPreview.submissionContract.requiredInputs,
      submissionFingerprint: '0000111122223333',
      targetLocatorFingerprint:
        routeReadyGate.repairActionPreview.submissionContract
          .targetLocatorFingerprint,
    },
    {
      registryFingerprint: gateVerdict.registryFingerprint,
      registryId: gateVerdict.registryId,
      registryUpdatedAt: gateVerdict.registryUpdatedAt.toISOString(),
    }
  );
  assert.equal(stalePreflight?.status, 'stale_submission');
  assert.equal(stalePreflight?.permissionStatus, 'granted');
  assert.equal(stalePreflight?.capabilityStatus, 'declared');
  assert.equal(stalePreflight?.reviewBindingStatus, 'stale_submission');
  assert.equal(stalePreflight?.auditBindingStatus, 'stale_submission');
  assert.equal(stalePreflight?.auditEventStatus, 'not_created_read_only');
  assert.notEqual(
    stalePreflight?.auditEventFingerprint,
    matchingPreflight?.auditEventFingerprint
  );
  assert.equal(stalePreflight?.executionStateStatus, 'not_started_read_only');
  assert.notEqual(
    stalePreflight?.executionStateFingerprint,
    matchingPreflight?.executionStateFingerprint
  );
  assert.equal(stalePreflight?.rollbackPlanStatus, 'not_created_read_only');
  assert.notEqual(
    stalePreflight?.rollbackPlanFingerprint,
    matchingPreflight?.rollbackPlanFingerprint
  );
  assert.equal(stalePreflight?.policyBindingStatus, 'stale_submission');
  assert.equal(stalePreflight?.approvalRequestStatus, 'approval_required');
  assert.notEqual(
    stalePreflight?.approvalRequestFingerprint,
    matchingPreflight?.approvalRequestFingerprint
  );
  assert.equal(stalePreflight?.approvalRecordStatus, 'not_created_read_only');
  assert.notEqual(
    stalePreflight?.approvalRecordFingerprint,
    matchingPreflight?.approvalRecordFingerprint
  );
  assert.notEqual(
    stalePreflight?.reviewBindingFingerprint,
    matchingPreflight?.reviewBindingFingerprint
  );
  assert.notEqual(
    stalePreflight?.auditBindingFingerprint,
    matchingPreflight?.auditBindingFingerprint
  );
  assert.notEqual(
    stalePreflight?.policyBindingFingerprint,
    matchingPreflight?.policyBindingFingerprint
  );
  assert.notEqual(
    stalePreflight?.idempotencyFingerprint,
    matchingPreflight?.idempotencyFingerprint
  );
  assert.equal(stalePreflight?.repairJobStatus, 'not_created_read_only');
  assert.notEqual(
    stalePreflight?.repairJobFingerprint,
    matchingPreflight?.repairJobFingerprint
  );
  assert.equal(stalePreflight?.executionGateStatus, 'blocked_stale_submission');
  assert.notEqual(
    stalePreflight?.executionGateFingerprint,
    matchingPreflight?.executionGateFingerprint
  );
  assert.deepEqual(stalePreflight?.mismatchedFields, [
    'previewFingerprint',
    'submissionFingerprint',
  ]);
  assert.deepEqual(permissionAssertions, [
    {
      action: 'Workspace.Copilot',
      userId: 'user-smoke',
      workspaceId: 'workspace-smoke',
    },
    {
      action: 'Workspace.Copilot',
      userId: 'user-smoke',
      workspaceId: 'workspace-smoke',
    },
    {
      action: 'Workspace.Copilot',
      userId: 'user-smoke',
      workspaceId: 'workspace-smoke',
    },
    {
      action: 'Workspace.Copilot',
      userId: 'user-smoke',
      workspaceId: 'workspace-smoke',
    },
  ]);
  assert.deepEqual(
    routeReadyGate?.repairActionPreview.operationFingerprints,
    routeReadyGate?.repairActionPreview.operations
      .map(operation => operation.operationFingerprint)
      .sort()
  );
  assert.deepEqual(
    routeReadyGate?.repairActionPreview.operations.map(operation => [
      operation.actionKind,
      operation.category,
      operation.code,
      operation.diagnosticsFingerprint,
      operation.operationFingerprint,
      operation.previewStatus,
      operation.reviewMode,
      operation.safety,
      operation.target,
      operation.targetLocator?.kind,
    ]),
    [
      [
        'review_non_default_model_route',
        'model_route',
        'optional_model_route_unavailable',
        routeReadyGate?.repairRecommendations[0]?.diagnosticsFingerprint,
        routeReadyGate?.repairActionPreview.operations[0]?.operationFingerprint,
        'preview_required',
        'preview',
        'preview_required',
        'copilot.prompts.overrides[].optionalModels',
        'model_route',
      ],
      [
        'check_provider_health',
        'provider_health',
        'selected_provider_health_not_healthy',
        routeReadyGate?.repairRecommendations[1]?.diagnosticsFingerprint,
        routeReadyGate?.repairActionPreview.operations[1]?.operationFingerprint,
        'read_only_probe',
        'probe',
        'read_only_probe',
        'copilot.providers.profiles[id=local]',
        'model_route',
      ],
      [
        'repair_task_model_route',
        'task_route',
        'rerank_task_route_unavailable',
        routeReadyGate?.repairRecommendations[2]?.diagnosticsFingerprint,
        routeReadyGate?.repairActionPreview.operations[2]?.operationFingerprint,
        'preview_required',
        'preview',
        'preview_required',
        'copilot.tasks.models.rerank',
        'task_route',
      ],
    ]
  );
  assert.deepEqual(
    routeReadyGate?.repairActionPreview.operations.map(operation =>
      /^[0-9a-f]{16}$/.test(operation.targetLocatorFingerprint)
    ),
    [true, true, true]
  );
  assert.deepEqual(
    routeReadyGate?.repairActionPreview.operations.map(operation =>
      /^[0-9a-f]{16}$/.test(operation.operationFingerprint)
    ),
    [true, true, true]
  );
  assert.equal(
    new Set(
      routeReadyGate?.repairActionPreview.operations.map(
        operation => operation.operationFingerprint
      )
    ).size,
    routeReadyGate?.repairActionPreview.operations.length
  );
  const repeatedRouteReadyGate =
    await routeAwareResolver.promptRegistryPublishGate(
      { workspaceId: 'workspace-smoke' } as any,
      gateVerdict.name,
      {
        registryFingerprint: gateVerdict.registryFingerprint,
        registryId: gateVerdict.registryId,
        registryUpdatedAt: gateVerdict.registryUpdatedAt.toISOString(),
      }
    );
  assert.equal(
    repeatedRouteReadyGate?.repairActionCatalogFingerprint,
    routeReadyGate?.repairActionCatalogFingerprint
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionMutationGuard.guardFingerprint,
    routeReadyGate?.repairActionMutationGuard.guardFingerprint
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionMutationGuard.targetLocatorFingerprint,
    routeReadyGate?.repairActionMutationGuard.targetLocatorFingerprint
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionMutationGuard.intentFingerprint,
    routeReadyGate?.repairActionMutationGuard.intentFingerprint
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionMutationGuard.auditSummaryFingerprint,
    routeReadyGate?.repairActionMutationGuard.auditSummaryFingerprint
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionPreview.previewFingerprint,
    routeReadyGate?.repairActionPreview.previewFingerprint
  );
  assert.deepEqual(
    repeatedRouteReadyGate?.repairActionPreview.operations.map(
      operation => operation.targetLocatorFingerprint
    ),
    routeReadyGate?.repairActionPreview.operations.map(
      operation => operation.targetLocatorFingerprint
    )
  );
  assert.deepEqual(
    repeatedRouteReadyGate?.repairActionPreview.operations.map(
      operation => operation.operationFingerprint
    ),
    routeReadyGate?.repairActionPreview.operations.map(
      operation => operation.operationFingerprint
    )
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionPreview.operationSetFingerprint,
    routeReadyGate?.repairActionPreview.operationSetFingerprint
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionPreview.authorizationFingerprint,
    routeReadyGate?.repairActionPreview.authorizationFingerprint
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionPreview.approvalPolicyFingerprint,
    routeReadyGate?.repairActionPreview.approvalPolicyFingerprint
  );
  assert.deepEqual(
    repeatedRouteReadyGate?.repairActionPreview.approvalCheckpoints,
    routeReadyGate?.repairActionPreview.approvalCheckpoints
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionPreview.submissionContract
      .submissionFingerprint,
    routeReadyGate?.repairActionPreview.submissionContract.submissionFingerprint
  );
  assert.equal(
    repeatedRouteReadyGate?.repairActionPreview.submissionContract
      .idempotencyKey,
    routeReadyGate?.repairActionPreview.submissionContract.idempotencyKey
  );
  assert.deepEqual(
    repeatedRouteReadyGate?.repairActionPreview.operationFingerprints,
    routeReadyGate?.repairActionPreview.operationFingerprints
  );
  assert.deepEqual(routeReadyGate?.repairRecommendations[0]?.targetLocator, {
    candidateIndex: 1,
    candidateKind: 'optional',
    featureKind: 'chat',
    kind: 'model_route',
    outputType: 'object',
    path: 'copilot.prompts.overrides[].optionalModels',
    providerId: 'local',
    providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
    providerProfileId: 'local',
    providerProfileSource: 'configured',
    registryFingerprint: 'feedfacecafebeef',
    registryId: 7,
    registryUpdatedAt: '2026-06-17T01:02:03.000Z',
    requestedModelId: 'local/optional-chat',
    requestedModelSource: 'override',
  });
  assert.deepEqual(routeReadyGate?.repairRecommendations[0]?.evidence, [
    'candidate:optional#1',
    'requestedModelId:local/optional-chat',
    'requestedModelSource:override',
    'featureKind:chat',
    'outputType:object',
    'matchedCandidateCount:0',
    'reason:model_route_unavailable',
    'reason:no_matching_provider_route',
    'reason:capability_mismatch',
  ]);
  assert.deepEqual(routeReadyGate?.modelRoute?.fallbackProviderIds, [
    'local',
    'cloud',
  ]);
  const routeReadyGateModelRouteCalls = routeCalls.filter(
    call =>
      call.workspaceId === 'workspace-smoke' &&
      call.featureKind === 'chat' &&
      call.outputType === 'object'
  );
  assert.deepEqual(
    sortRouteCalls(routeReadyGateModelRouteCalls.slice(-10)),
    sortRouteCalls([
      {
        method: 'describeRouteCandidates',
        modelId: gatePrompt.model,
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'resolveProvider',
        modelId: gatePrompt.model,
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'describeRouteCandidates',
        modelId: 'local/default-chat',
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'resolveProvider',
        modelId: 'local/default-chat',
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'describeRouteCandidates',
        modelId: 'local/optional-chat',
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'resolveProvider',
        modelId: 'local/optional-chat',
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'describeRouteCandidates',
        modelId: 'cloud/pro-chat',
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'resolveProvider',
        modelId: 'cloud/pro-chat',
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'describeRouteCandidates',
        modelId: 'registry/only-chat',
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'resolveProvider',
        modelId: 'registry/only-chat',
        outputType: 'object',
        featureKind: 'chat',
        workspaceId: 'workspace-smoke',
      },
    ])
  );
  assert.ok(
    routeCalls.some(
      call =>
        call.method === 'describeRouteCandidates' &&
        call.modelId === 'embed-alias' &&
        call.outputType === 'embedding' &&
        call.featureKind === 'workspace_indexing' &&
        call.workspaceId === 'workspace-smoke'
    )
  );
  assert.ok(
    routeCalls.some(
      call =>
        call.method === 'describeRouteCandidates' &&
        call.modelId === undefined &&
        call.outputType === 'rerank' &&
        call.featureKind === 'rerank' &&
        call.workspaceId === 'workspace-smoke'
    )
  );

  const structuredPrompt = {
    ...gatePrompt,
    name: 'Structured registry gate prompt',
    model: 'local/office-structured',
    category: 'text',
    config: {},
    defaultPolicy: 'structured',
    modelSource: 'default_policy',
    messages: [{ role: 'user', content: 'Generate an office artifact.' }],
    optionalModels: [],
  };
  const structuredVerdict = {
    ...gateVerdict,
    name: structuredPrompt.name,
    registryId: 8,
  };
  const structuredRouteResolver = new CopilotResolver(
    {} as any,
    {} as any,
    { get: async () => structuredPrompt } as any,
    {} as any,
    {} as any,
    {} as any,
    {
      ...providerFactory,
      getConfiguredModelIds() {
        return [];
      },
    } as any,
    capabilityRuntime as any,
    taskPolicy as any,
    {
      copilotPrompt: {
        getRegistryPrompt: async () => structuredPrompt,
        getRegistryPublishGateVerdict: async () => structuredVerdict,
      },
    } as any,
    planBuilder as any
  );
  const structuredRouteGate =
    await structuredRouteResolver.promptRegistryPublishGate(
      { workspaceId: 'workspace-smoke' } as any,
      structuredVerdict.name,
      undefined
    );
  assert.equal(structuredRouteGate?.allowed, true);
  assert.equal(structuredRouteGate?.actionRouteDryRun?.status, 'succeeded');
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.diagnosticsErrorStage,
    undefined
  );
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.actionId,
    structuredPrompt.action
  );
  assert.equal(structuredRouteGate?.actionRouteDryRun?.featureKind, 'action');
  assert.equal(structuredRouteGate?.actionRouteDryRun?.actualRouteCount, 1);
  assert.equal(structuredRouteGate?.actionRouteDryRun?.expectedRouteCount, 1);
  assert.equal(structuredRouteGate?.actionRouteDryRun?.missingRouteCount, 0);
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.routeCountMismatch,
    false
  );
  assert.deepEqual(
    structuredRouteGate?.actionRouteDryRun?.routeCountMismatchStepIds,
    []
  );
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.steps[0]?.stepId,
    'generate'
  );
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.steps[0]?.requestedModelId,
    structuredPrompt.model
  );
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.steps[0]?.requestedModelSource,
    'default_policy'
  );
  assert.deepEqual(
    structuredRouteGate?.actionRouteDryRun?.steps[0]?.fallbackProviderIds,
    ['local']
  );
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.steps[0]?.routes[0]?.providerId,
    'local'
  );
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.steps[0]?.routes[0]
      ?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.steps[0]?.routes[0]
      ?.routeModelDefinitionId,
    'office-structured'
  );
  assert.equal(
    structuredRouteGate?.actionRouteDryRun?.steps[0]?.routes[0]?.requestLayer,
    'chat_completions'
  );
  assert.equal(structuredRouteGate?.modelRoute?.outputType, 'structured');
  assert.equal(structuredRouteGate?.modelRoute?.featureKind, 'action');
  assert.equal(
    structuredRouteGate?.modelRoute?.requestedModelId,
    structuredPrompt.model
  );
  assert.equal(
    structuredRouteGate?.modelRoute?.requestedModelSource,
    'default_policy'
  );
  assert.equal(
    structuredRouteGate?.repairRecommendations.some(
      recommendation => recommendation.category === 'action_route'
    ),
    false
  );

  const mismatchPlanBuilder = {
    async buildStructuredPlan() {
      return {
        routePolicy: { fallbackOrder: ['local', 'cloud', 'edge'] },
        routeDiagnostics: [
          {
            providerId: 'local',
            protocol: 'openai_chat',
            model: 'office-structured',
            backendConfig: { request_layer: 'chat_completions' },
            providerHealth: 'degraded',
            providerHealthCheckedAt: '2026-06-17T09:00:00.000Z',
            providerHealthLastError: 'provider probe timed out',
            providerSource: 'configured',
            providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
            providerProfileId: 'local',
            providerProfileSource: 'configured',
          },
          {
            providerId: 'cloud',
            protocol: 'openai_chat',
            model: 'office-structured-fallback',
            backendConfig: { request_layer: 'chat_completions' },
            providerHealth: 'unhealthy',
            providerHealthCheckedAt: '2026-06-17T09:01:00.000Z',
            providerHealthLastError: 'fallback provider unauthorized',
            providerSource: 'configured',
            providerProfileConfigPath: 'copilot.providers.profiles[id=cloud]',
            providerProfileId: 'cloud',
            providerProfileSource: 'configured',
          },
        ],
        serializable: {
          routes: [
            {
              providerId: 'local',
              protocol: 'openai_chat',
              model: 'office-structured',
              backendConfig: { request_layer: 'chat_completions' },
            },
            {
              providerId: 'cloud',
              protocol: 'openai_chat',
              model: 'office-structured-fallback',
              backendConfig: { request_layer: 'chat_completions' },
            },
          ],
        },
      };
    },
  };
  const structuredRouteMismatchResolver = new CopilotResolver(
    {} as any,
    {} as any,
    { get: async () => structuredPrompt } as any,
    {} as any,
    {} as any,
    {} as any,
    {
      ...providerFactory,
      getConfiguredModelIds() {
        return [];
      },
    } as any,
    capabilityRuntime as any,
    taskPolicy as any,
    {
      copilotPrompt: {
        getRegistryPrompt: async () => structuredPrompt,
        getRegistryPublishGateVerdict: async () => structuredVerdict,
      },
    } as any,
    mismatchPlanBuilder as any
  );
  const structuredRouteMismatchGate =
    await structuredRouteMismatchResolver.promptRegistryPublishGate(
      { workspaceId: 'workspace-smoke' } as any,
      structuredVerdict.name,
      undefined
    );
  assert.equal(structuredRouteMismatchGate?.allowed, true);
  assert.equal(
    structuredRouteMismatchGate?.actionRouteDryRun?.status,
    'succeeded'
  );
  assert.equal(
    structuredRouteMismatchGate?.actionRouteDryRun?.actualRouteCount,
    2
  );
  assert.equal(
    structuredRouteMismatchGate?.actionRouteDryRun?.expectedRouteCount,
    3
  );
  assert.equal(
    structuredRouteMismatchGate?.actionRouteDryRun?.missingRouteCount,
    1
  );
  assert.equal(
    structuredRouteMismatchGate?.actionRouteDryRun?.routeCountMismatch,
    true
  );
  assert.deepEqual(
    structuredRouteMismatchGate?.actionRouteDryRun?.routeCountMismatchStepIds,
    ['generate']
  );
  const actionRouteMismatchRepair =
    structuredRouteMismatchGate?.repairRecommendations.find(
      recommendation =>
        recommendation.code === 'action_generate_route_count_mismatch'
    );
  assert.equal(actionRouteMismatchRepair?.category, 'action_route');
  assert.equal(
    actionRouteMismatchRepair?.instanceKey,
    'chat:generate:route-count-mismatch'
  );
  assert.equal(
    actionRouteMismatchRepair?.evidence.includes('stepId:generate'),
    true
  );
  assert.equal(
    actionRouteMismatchRepair?.evidence.includes('actualRouteCount:2'),
    true
  );
  assert.equal(
    actionRouteMismatchRepair?.evidence.includes('routeCount:3'),
    true
  );
  const actionProviderHealthRepairs =
    structuredRouteMismatchGate?.repairRecommendations.filter(
      recommendation =>
        recommendation.code === 'action_generate_provider_health_not_healthy'
    );
  assert.equal(actionProviderHealthRepairs?.length, 2);
  assert.equal(actionProviderHealthRepairs?.[0]?.category, 'action_route');
  assert.equal(
    actionProviderHealthRepairs?.some(recommendation =>
      recommendation.evidence.includes('providerId:local')
    ),
    true
  );
  assert.equal(
    actionProviderHealthRepairs?.some(recommendation =>
      recommendation.evidence.includes('health:degraded')
    ),
    true
  );
  assert.equal(
    actionProviderHealthRepairs?.some(recommendation =>
      recommendation.evidence.includes('providerId:cloud')
    ),
    true
  );
  assert.equal(
    actionProviderHealthRepairs?.some(recommendation =>
      recommendation.evidence.includes('health:unhealthy')
    ),
    true
  );
  assert.deepEqual(
    actionProviderHealthRepairs?.map(
      recommendation => recommendation.instanceKey
    ),
    ['chat:generate:local:0', 'chat:generate:cloud:1']
  );
  assert.deepEqual(
    actionProviderHealthRepairs?.map(
      recommendation => recommendation.suggestedActionKind
    ),
    ['check_action_provider_health', 'check_action_provider_health']
  );
  assert.deepEqual(
    actionProviderHealthRepairs?.map(
      recommendation => recommendation.suggestedActionCatalogVersion
    ),
    ['repair-actions/v1', 'repair-actions/v1']
  );
  assert.deepEqual(
    actionProviderHealthRepairs?.map(
      recommendation => recommendation.suggestedActionSafety
    ),
    ['read_only_probe', 'read_only_probe']
  );
  assert.deepEqual(
    actionProviderHealthRepairs?.map(
      recommendation => recommendation.suggestedActionRequiredCapabilities
    ),
    [
      ['provider_profile.read', 'provider_health.probe'],
      ['provider_profile.read', 'provider_health.probe'],
    ]
  );
  assert.deepEqual(
    actionProviderHealthRepairs?.map(recommendation =>
      /^[0-9a-f]{16}$/.test(recommendation.diagnosticsFingerprint)
    ),
    [true, true]
  );
  assert.deepEqual(
    actionProviderHealthRepairs?.map(
      recommendation => recommendation.suggestedActionInputSchema.required
    ),
    [
      ['diagnosticsFingerprint', 'targetLocator'],
      ['diagnosticsFingerprint', 'targetLocator'],
    ]
  );
  assert.deepEqual(
    actionProviderHealthRepairs?.map(recommendation => ({
      actionId: recommendation.targetLocator?.actionId,
      fallbackOrderIndex: recommendation.targetLocator?.fallbackOrderIndex,
      kind: recommendation.targetLocator?.kind,
      path: recommendation.targetLocator?.path,
      providerId: recommendation.targetLocator?.providerId,
      providerProfileConfigPath:
        recommendation.targetLocator?.providerProfileConfigPath,
      providerProfileId: recommendation.targetLocator?.providerProfileId,
      providerProfileSource:
        recommendation.targetLocator?.providerProfileSource,
      routeIndex: recommendation.targetLocator?.routeIndex,
      stepId: recommendation.targetLocator?.stepId,
    })),
    [
      {
        actionId: 'chat',
        fallbackOrderIndex: 0,
        kind: 'action_route',
        path: 'ai_prompts_metadata.action.chat',
        providerId: 'local',
        providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
        providerProfileId: 'local',
        providerProfileSource: 'configured',
        routeIndex: 0,
        stepId: 'generate',
      },
      {
        actionId: 'chat',
        fallbackOrderIndex: 1,
        kind: 'action_route',
        path: 'ai_prompts_metadata.action.chat',
        providerId: 'cloud',
        providerProfileConfigPath: 'copilot.providers.profiles[id=cloud]',
        providerProfileId: 'cloud',
        providerProfileSource: 'configured',
        routeIndex: 1,
        stepId: 'generate',
      },
    ]
  );
  assert.deepEqual(
    sortRouteCalls(
      routeCalls.filter(
        call =>
          call.modelId === structuredPrompt.model &&
          call.outputType === 'structured' &&
          call.featureKind === 'action'
      )
    ),
    sortRouteCalls([
      {
        method: 'describeRouteCandidates',
        modelId: structuredPrompt.model,
        outputType: 'structured',
        featureKind: 'action',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'describeRouteCandidates',
        modelId: structuredPrompt.model,
        outputType: 'structured',
        featureKind: 'action',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'resolveProvider',
        modelId: structuredPrompt.model,
        outputType: 'structured',
        featureKind: 'action',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'resolveProvider',
        modelId: structuredPrompt.model,
        outputType: 'structured',
        featureKind: 'action',
        workspaceId: 'workspace-smoke',
      },
    ])
  );

  class StructuredDryRunFailure extends Error {
    override name = 'StructuredDryRunFailure';
  }
  const failingPlanBuilder = {
    async buildStructuredPlan() {
      throw new StructuredDryRunFailure('structured dry-run unavailable');
    },
  };
  const structuredDryRunFailureResolver = new CopilotResolver(
    {} as any,
    {} as any,
    { get: async () => structuredPrompt } as any,
    {} as any,
    {} as any,
    {} as any,
    {
      ...providerFactory,
      getConfiguredModelIds() {
        return [];
      },
    } as any,
    capabilityRuntime as any,
    taskPolicy as any,
    {
      copilotPrompt: {
        getRegistryPrompt: async () => structuredPrompt,
        getRegistryPublishGateVerdict: async () => structuredVerdict,
      },
    } as any,
    failingPlanBuilder as any
  );
  const structuredDryRunFailureGate =
    await structuredDryRunFailureResolver.promptRegistryPublishGate(
      { workspaceId: 'workspace-smoke' } as any,
      structuredVerdict.name,
      undefined
    );
  assert.equal(structuredDryRunFailureGate?.allowed, true);
  assert.equal(
    structuredDryRunFailureGate?.actionRouteDryRun?.status,
    'failed'
  );
  assert.equal(
    structuredDryRunFailureGate?.actionRouteDryRun?.actualRouteCount,
    0
  );
  assert.equal(
    structuredDryRunFailureGate?.actionRouteDryRun?.expectedRouteCount,
    0
  );
  assert.equal(
    structuredDryRunFailureGate?.actionRouteDryRun?.missingRouteCount,
    0
  );
  assert.equal(
    structuredDryRunFailureGate?.actionRouteDryRun?.routeCountMismatch,
    false
  );
  assert.deepEqual(
    structuredDryRunFailureGate?.actionRouteDryRun?.routeCountMismatchStepIds,
    []
  );
  assert.equal(
    structuredDryRunFailureGate?.actionRouteDryRun?.diagnosticsErrorStage,
    'build_structured_plan'
  );
  assert.equal(
    structuredDryRunFailureGate?.actionRouteDryRun?.diagnosticsErrorCode,
    'StructuredDryRunFailure'
  );
  assert.equal(
    structuredDryRunFailureGate?.actionRouteDryRun?.diagnosticsErrorMessage,
    'structured dry-run unavailable'
  );
  const actionDryRunFailureRepair =
    structuredDryRunFailureGate?.repairRecommendations.find(
      recommendation => recommendation.code === 'action_route_dry_run_failed'
    );
  assert.equal(actionDryRunFailureRepair?.category, 'action_route');
  assert.equal(actionDryRunFailureRepair?.instanceKey, 'chat:dry-run:failed');
  assert.equal(
    actionDryRunFailureRepair?.evidence.includes(
      'diagnosticsStage:build_structured_plan'
    ),
    true
  );
  assert.equal(
    actionDryRunFailureRepair?.evidence.includes(
      'diagnosticsCode:StructuredDryRunFailure'
    ),
    true
  );

  const imagePrompt = {
    ...gatePrompt,
    name: 'Image registry gate prompt',
    model: 'local/image-model',
    action: 'image.generate',
    category: 'image',
    config: {},
    defaultPolicy: 'image',
    modelSource: 'registry',
    optionalModels: [],
  };
  const imageVerdict = {
    ...gateVerdict,
    name: imagePrompt.name,
    registryId: 9,
  };
  const imageRouteResolver = new CopilotResolver(
    {} as any,
    {} as any,
    { get: async () => imagePrompt } as any,
    {} as any,
    {} as any,
    {} as any,
    {
      ...providerFactory,
      getConfiguredModelIds() {
        return [];
      },
    } as any,
    capabilityRuntime as any,
    taskPolicy as any,
    {
      copilotPrompt: {
        getRegistryPrompt: async () => imagePrompt,
        getRegistryPublishGateVerdict: async () => imageVerdict,
      },
    } as any
  );
  const imageRouteGate = await imageRouteResolver.promptRegistryPublishGate(
    { workspaceId: 'workspace-smoke' } as any,
    imageVerdict.name,
    undefined
  );
  assert.equal(imageRouteGate?.allowed, true);
  assert.equal(imageRouteGate?.modelRoute?.outputType, 'image');
  assert.equal(imageRouteGate?.modelRoute?.featureKind, 'image');
  assert.equal(imageRouteGate?.modelRoute?.requestedModelId, imagePrompt.model);
  assert.deepEqual(
    sortRouteCalls(
      routeCalls.filter(
        call =>
          call.modelId === imagePrompt.model &&
          call.outputType === 'image' &&
          call.featureKind === 'image'
      )
    ),
    sortRouteCalls([
      {
        method: 'describeRouteCandidates',
        modelId: imagePrompt.model,
        outputType: 'image',
        featureKind: 'image',
        workspaceId: 'workspace-smoke',
      },
      {
        method: 'resolveProvider',
        modelId: imagePrompt.model,
        outputType: 'image',
        featureKind: 'image',
        workspaceId: 'workspace-smoke',
      },
    ])
  );

  const unavailableProviderFactory = {
    ...providerFactory,
    async resolveProvider() {
      return null;
    },
    async describeRouteCandidates() {
      return [
        {
          registryKind: 'byok',
          registryAvailable: true,
          registrySelected: false,
          providerId: 'local',
          providerName: 'Local profile',
          providerSource: 'configured',
          providerProfileId: 'local',
          providerProfileSource: 'configured',
          providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
          providerConfiguredModelIds: [
            'runtime-listed-chat',
            'default-chat',
            'default-alias',
            'optional-chat',
            'optional-alias',
          ],
          providerConfiguredModelCount: 5,
          providerType: 'openaiCompatible',
          providerPriority: 10,
          privacy: 'local',
          health: 'degraded',
          healthCheckedAt: '2026-06-17T03:30:00.000Z',
          requestedModelId: gatePrompt.model,
          modelId: 'default-chat',
          routeRawModelId: 'qwen3:32b',
          routeModelDefinitionSource: 'provider_profile',
          routeModelDefinitionId: 'default-chat',
          routeModelDefinitionAliases: ['default-alias'],
          routeModelAliasMatched: false,
          matched: false,
          reasons: ['capability_mismatch'],
        },
        {
          registryKind: 'quota_backed',
          registryAvailable: true,
          registrySelected: false,
          providerId: 'cloud',
          providerName: 'Cloud fallback',
          providerSource: 'configured',
          providerProfileId: 'cloud',
          providerProfileSource: 'configured',
          providerProfileConfigPath: 'copilot.providers.profiles[id=cloud]',
          providerConfiguredModelIds: ['pro-chat', 'fallback-chat'],
          providerConfiguredModelCount: 2,
          providerType: 'openai',
          providerPriority: 1,
          privacy: 'cloud',
          health: 'healthy',
          requestedModelId: gatePrompt.model,
          modelId: 'fallback-chat',
          routeModelDefinitionSource: 'provider_profile',
          routeModelDefinitionId: 'fallback-chat',
          routeModelDefinitionAliases: ['fallback-alias'],
          routeModelAliasMatched: false,
          candidateModelIds: ['pro-chat', 'fallback-chat'],
          matched: false,
          reasons: ['profile_model_not_allowed'],
        },
      ];
    },
  };
  const routeBlockedResolver = new CopilotResolver(
    {} as any,
    {} as any,
    { get: async () => gatePrompt } as any,
    {} as any,
    {} as any,
    {} as any,
    unavailableProviderFactory as any,
    capabilityRuntime as any,
    taskPolicy as any,
    {
      copilotPrompt: {
        getRegistryPrompt: async () => gatePrompt,
        getRegistryPublishGateVerdict: async () => gateVerdict,
      },
    } as any
  );
  const routeBlockedGate = await routeBlockedResolver.promptRegistryPublishGate(
    { workspaceId: 'workspace-smoke' } as any,
    gateVerdict.name,
    undefined
  );
  assert.equal(routeBlockedGate?.allowed, false);
  assert.equal(routeBlockedGate?.publishStatus, 'blocked');
  assert.equal(routeBlockedGate?.reason, 'model_route_unavailable');
  assert.equal(routeBlockedGate?.blockingCount, 1);
  assert.deepEqual(
    routeBlockedGate?.taskRoutes.map(route => route.featureKind),
    ['workspace_indexing', 'rerank']
  );
  assert.equal(routeBlockedGate?.issues[0]?.reason, 'model_route_unavailable');
  assert.equal(routeBlockedGate?.modelRoute?.available, false);
  assert.equal(routeBlockedGate?.modelRoute?.candidateKind, 'default');
  assert.equal(routeBlockedGate?.modelRoute?.providerId, 'local');
  assert.equal(routeBlockedGate?.modelRoute?.providerName, 'Local profile');
  assert.equal(routeBlockedGate?.modelRoute?.providerProfileId, 'local');
  assert.equal(
    routeBlockedGate?.modelRoute?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.deepEqual(routeBlockedGate?.modelRoute?.providerConfiguredModelIds, [
    'runtime-listed-chat',
    'default-chat',
    'default-alias',
    'optional-chat',
    'optional-alias',
  ]);
  assert.equal(routeBlockedGate?.modelRoute?.providerConfiguredModelCount, 5);
  assert.equal(routeBlockedGate?.modelRoute?.providerType, 'openaiCompatible');
  assert.equal(routeBlockedGate?.modelRoute?.providerPrivacy, 'local');
  assert.equal(routeBlockedGate?.modelRoute?.providerHealth, 'degraded');
  assert.equal(
    routeBlockedGate?.modelRoute?.providerHealthCheckedAt,
    '2026-06-17T03:30:00.000Z'
  );
  assert.equal(routeBlockedGate?.modelRoute?.providerPriority, 10);
  assert.equal(
    routeBlockedGate?.modelRoute?.routeModelDefinitionId,
    'default-chat'
  );
  assert.equal(routeBlockedGate?.modelRoute?.routeRawModelId, 'qwen3:32b');
  assert.equal(routeBlockedGate?.modelRoute?.routeCandidates.length, 2);
  assert.deepEqual(
    routeBlockedGate?.modelRoute?.routeCandidates.map(candidate => [
      candidate.providerId,
      candidate.modelId,
      candidate.matched,
      candidate.reasons,
    ]),
    [
      ['local', 'default-chat', false, ['capability_mismatch']],
      ['cloud', 'fallback-chat', false, ['profile_model_not_allowed']],
    ]
  );
  assert.deepEqual(
    routeBlockedGate?.modelRoute?.routeCandidates[1]?.candidateModelIds,
    ['pro-chat', 'fallback-chat']
  );
  assert.deepEqual(routeBlockedGate?.modelRoute?.routeTrace, [
    {
      phase: 'policy',
      candidateCount: 2,
      availableCount: 2,
      selectedCount: 1,
      blockedCount: 1,
      reasons: ['candidate_allowed', 'provider_not_allowed'],
    },
    {
      phase: 'resolution',
      candidateCount: 2,
      availableCount: 2,
      selectedCount: 0,
      matchedCount: 0,
      reasons: ['capability_mismatch', 'profile_model_not_allowed'],
    },
  ]);
  const defaultRouteRepair = routeBlockedGate?.repairRecommendations.find(
    recommendation => recommendation.code === 'default_model_route_unavailable'
  );
  assert.equal(defaultRouteRepair?.severity, 'error');
  assert.equal(
    defaultRouteRepair?.target,
    'copilot.prompts.defaults.text.model'
  );
  assert.equal(
    defaultRouteRepair?.instanceKey,
    'chat:object:default:0:local/default-chat'
  );
  assert.equal(
    defaultRouteRepair?.suggestedActionKind,
    'repair_default_model_route'
  );
  assert.equal(
    defaultRouteRepair?.suggestedActionCatalogVersion,
    'repair-actions/v1'
  );
  assert.deepEqual(defaultRouteRepair?.suggestedActionRequiredCapabilities, [
    'model_registry.read',
    'provider_route.preview',
  ]);
  assert.equal(defaultRouteRepair?.suggestedActionSafety, 'preview_required');
  assert.match(
    defaultRouteRepair?.diagnosticsFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(defaultRouteRepair?.suggestedActionInputSchema.required, [
    'diagnosticsFingerprint',
    'targetLocator',
  ]);
  assert.equal(defaultRouteRepair?.targetLocator?.registryId, 7);
  assert.equal(defaultRouteRepair?.targetLocator?.candidateKind, 'default');
  assert.equal(
    defaultRouteRepair?.targetLocator?.requestedModelId,
    gatePrompt.model
  );
  assert.equal(
    routeBlockedGate?.repairRecommendations.some(
      recommendation =>
        recommendation.code === 'selected_provider_health_not_healthy'
    ),
    true
  );
  assert.equal(routeBlockedGate?.modelRoutes?.length, 5);
  assert.deepEqual(
    routeBlockedGate?.modelRoutes?.map(route => [
      route.candidateKind,
      route.requestedModelId,
      route.available,
    ]),
    [
      ['default', gatePrompt.model, false],
      ['optional', 'local/default-chat', false],
      ['optional', 'local/optional-chat', false],
      ['pro', 'cloud/pro-chat', false],
      ['registry', 'registry/only-chat', false],
    ]
  );
  assert.deepEqual(routeBlockedGate?.modelRoute?.reasons, [
    'model_route_unavailable',
    'no_matching_provider_route',
    'capability_mismatch',
    'profile_model_not_allowed',
  ]);

  class RouteDiagnosticsFailure extends Error {
    override name = 'RouteDiagnosticsFailure';
  }
  const diagnosticsErrorProviderFactory = {
    ...providerFactory,
    getConfiguredModelIds() {
      return [];
    },
    async describeRouteCandidates() {
      throw new RouteDiagnosticsFailure(
        'provider registry diagnostics unavailable'
      );
    },
  };
  const diagnosticsErrorResolver = new CopilotResolver(
    {} as any,
    {} as any,
    { get: async () => gatePrompt } as any,
    {} as any,
    {} as any,
    {} as any,
    diagnosticsErrorProviderFactory as any,
    capabilityRuntime as any,
    taskPolicy as any,
    {
      copilotPrompt: {
        getRegistryPrompt: async () => gatePrompt,
        getRegistryPublishGateVerdict: async () => gateVerdict,
      },
    } as any
  );
  const diagnosticsErrorGate =
    await diagnosticsErrorResolver.promptRegistryPublishGate(
      { workspaceId: 'workspace-smoke' } as any,
      gateVerdict.name,
      undefined
    );
  assert.equal(
    diagnosticsErrorGate?.modelRoute?.diagnosticsErrorStage,
    'describe_route_candidates'
  );
  assert.equal(
    diagnosticsErrorGate?.modelRoute?.diagnosticsErrorCode,
    'RouteDiagnosticsFailure'
  );
  assert.equal(
    diagnosticsErrorGate?.modelRoute?.diagnosticsErrorMessage,
    'provider registry diagnostics unavailable'
  );
  assert.deepEqual(diagnosticsErrorGate?.modelRoute?.routeTrace, [
    {
      phase: 'policy',
      candidateCount: 2,
      availableCount: 2,
      selectedCount: 1,
      blockedCount: 1,
      reasons: ['candidate_allowed', 'provider_not_allowed'],
    },
    {
      phase: 'resolution',
      candidateCount: 0,
      availableCount: 0,
      selectedCount: 0,
      matchedCount: 0,
      reasons: [],
    },
  ]);
  const diagnosticsErrorRepair =
    diagnosticsErrorGate?.repairRecommendations.find(
      recommendation =>
        recommendation.code === 'default_model_route_unavailable'
    );
  assert.equal(
    diagnosticsErrorRepair?.evidence.includes(
      'diagnosticsStage:describe_route_candidates'
    ),
    true
  );
  assert.equal(
    diagnosticsErrorRepair?.evidence.includes(
      'diagnosticsCode:RouteDiagnosticsFailure'
    ),
    true
  );
  assert.equal(
    diagnosticsErrorRepair?.instanceKey,
    'chat:object:default:0:local/default-chat'
  );

  class EmbeddingPrepareDiagnosticsFailure extends Error {
    override name = 'EmbeddingPrepareDiagnosticsFailure';
  }
  const taskDiagnosticsErrorProviderFactory = {
    ...providerFactory,
    describeEmbeddingPrepareCandidates() {
      throw new EmbeddingPrepareDiagnosticsFailure(
        'embedding prepare diagnostics unavailable'
      );
    },
  };
  const taskDiagnosticsErrorResolver = new CopilotResolver(
    {} as any,
    {} as any,
    { get: async () => gatePrompt } as any,
    {} as any,
    {} as any,
    {} as any,
    taskDiagnosticsErrorProviderFactory as any,
    capabilityRuntime as any,
    taskPolicy as any,
    {
      copilotPrompt: {
        getRegistryPrompt: async () => gatePrompt,
        getRegistryPublishGateVerdict: async () => gateVerdict,
      },
    } as any
  );
  const taskDiagnosticsErrorGate =
    await taskDiagnosticsErrorResolver.promptRegistryPublishGate(
      { workspaceId: 'workspace-smoke' } as any,
      gateVerdict.name,
      undefined
    );
  assert.equal(taskDiagnosticsErrorGate?.allowed, true);
  assert.equal(taskDiagnosticsErrorGate?.publishStatus, 'allowed');
  const taskDiagnosticsErrorRoute = taskDiagnosticsErrorGate?.taskRoutes.find(
    route => route.featureKind === 'workspace_indexing'
  );
  assert.deepEqual(taskDiagnosticsErrorRoute?.diagnosticsErrors, [
    {
      code: 'EmbeddingPrepareDiagnosticsFailure',
      message: 'embedding prepare diagnostics unavailable',
      stage: 'describe_embedding_prepare_candidates',
    },
  ]);
  assert.equal(taskDiagnosticsErrorRoute?.providerId, 'local');
  assert.equal(taskDiagnosticsErrorRoute?.preparedProviderCount, 1);
  assert.deepEqual(taskDiagnosticsErrorRoute?.fallbackProviderIds, ['local']);
  assert.deepEqual(taskDiagnosticsErrorRoute?.preparedRouteTargets, [
    'local/nomic-embed-text',
  ]);
  assert.equal(
    taskDiagnosticsErrorRoute?.preparedRouteTargetFingerprint,
    taskRouteTargetFingerprintFixture({
      featureKind: 'workspace_indexing',
      targets: ['local/nomic-embed-text'],
    })
  );
  assert.deepEqual(
    taskDiagnosticsErrorRoute?.routeCandidates.map(
      candidate => candidate.providerId
    ),
    ['local']
  );
  assert.deepEqual(
    taskDiagnosticsErrorRoute?.routeTrace.map(phase => phase.phase),
    ['policy', 'resolution', 'prepared']
  );
  const taskDiagnosticsErrorRepair =
    taskDiagnosticsErrorGate?.repairRecommendations.find(
      recommendation =>
        recommendation.code ===
        'workspace_indexing_task_route_diagnostics_error'
    );
  assert.equal(taskDiagnosticsErrorRepair?.severity, 'warning');
  assert.equal(
    taskDiagnosticsErrorRepair?.instanceKey,
    'workspace_indexing:workspaceIndexing:embed-alias:diagnostics-error'
  );
  assert.equal(
    taskDiagnosticsErrorRepair?.suggestedActionKind,
    'inspect_task_route_diagnostics'
  );
  assert.equal(
    taskDiagnosticsErrorRepair?.suggestedActionCatalogVersion,
    'repair-actions/v1'
  );
  assert.deepEqual(
    taskDiagnosticsErrorRepair?.suggestedActionRequiredCapabilities,
    ['task_route.read', 'provider_diagnostics.read']
  );
  assert.equal(
    taskDiagnosticsErrorRepair?.suggestedActionSafety,
    'read_only_probe'
  );
  assert.match(
    taskDiagnosticsErrorRepair?.diagnosticsFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    taskDiagnosticsErrorRepair?.suggestedActionInputSchema.required,
    ['diagnosticsFingerprint', 'targetLocator']
  );
  assert.deepEqual(taskDiagnosticsErrorRepair?.targetLocator, {
    featureKind: 'workspace_indexing',
    kind: 'task_route',
    path: 'copilot.tasks.models.workspaceIndexing',
    providerId: 'local',
    providerProfileConfigPath: 'copilot.providers.profiles[id=local]',
    providerProfileId: 'local',
    providerProfileSource: 'configured',
    registryFingerprint: 'feedfacecafebeef',
    registryId: 7,
    registryUpdatedAt: '2026-06-17T01:02:03.000Z',
    requestedModelConfigKey: 'workspaceIndexing',
    requestedModelConfigPath: 'copilot.tasks.models.workspaceIndexing',
    requestedModelId: 'embed-alias',
    requestedModelSource: 'workspace_indexing',
  });
  assert.equal(
    taskDiagnosticsErrorRepair?.evidence.includes(
      'diagnosticsStage:describe_embedding_prepare_candidates'
    ),
    true
  );
  assert.equal(
    taskDiagnosticsErrorRepair?.evidence.includes(
      'diagnosticsCode:EmbeddingPrepareDiagnosticsFailure'
    ),
    true
  );
  assert.equal(
    taskDiagnosticsErrorRepair?.evidence.includes(
      'policyCandidate#0:providerProfileId:local'
    ),
    true
  );
  assert.equal(
    taskDiagnosticsErrorRepair?.evidence.includes(
      'policyCandidate#0:providerProfileConfigPath:copilot.providers.profiles[id=local]'
    ),
    true
  );
  assert.equal(
    taskDiagnosticsErrorRepair?.evidence.includes(
      'routeCandidate#0:providerConfiguredModel:workspace-embedding'
    ),
    true
  );
  assert.equal(
    taskDiagnosticsErrorRepair?.evidence.includes(
      'prepareCandidate#0:preparedModelId:nomic-embed-text'
    ),
    true
  );
  const taskDiagnosticsPolicyCandidateEvidence =
    taskDiagnosticsErrorRepair?.candidateEvidence?.find(
      evidence => evidence.scope === 'policyCandidate'
    );
  assert.match(
    taskDiagnosticsPolicyCandidateEvidence?.candidateFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(taskDiagnosticsPolicyCandidateEvidence?.candidateIndex, 0);
  assert.equal(
    taskDiagnosticsPolicyCandidateEvidence?.candidateKey,
    routeReadyGate?.taskRoutes[0]?.policyCandidates[0]?.candidateKey
  );
  assert.notEqual(
    taskDiagnosticsPolicyCandidateEvidence?.candidateFingerprint,
    routeReadyGate?.taskRoutes[0]?.policyCandidates[0]?.candidateFingerprint,
    'policy candidate repair evidence fingerprint should include the route target fingerprint'
  );
  assert.equal(
    taskDiagnosticsPolicyCandidateEvidence?.candidateKey?.includes('policy'),
    true
  );
  assert.equal(
    taskDiagnosticsPolicyCandidateEvidence?.candidateKey?.includes(
      'workspace_indexing'
    ),
    true
  );
  assert.equal(
    taskDiagnosticsPolicyCandidateEvidence?.candidateKey?.includes('local'),
    true
  );
  assert.equal(taskDiagnosticsPolicyCandidateEvidence?.providerId, 'local');
  assert.equal(
    taskDiagnosticsPolicyCandidateEvidence?.providerProfileId,
    'local'
  );
  assert.equal(
    taskDiagnosticsPolicyCandidateEvidence?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.equal(
    taskDiagnosticsPolicyCandidateEvidence?.providerConfiguredModelIds?.includes(
      'workspace-embedding'
    ),
    true
  );
  assert.equal(
    taskDiagnosticsPolicyCandidateEvidence?.preparedRouteTargetFingerprint,
    taskDiagnosticsErrorRoute?.preparedRouteTargetFingerprint,
    'policy candidate evidence should bind the task route target fingerprint'
  );
  assert.deepEqual(
    taskDiagnosticsPolicyCandidateEvidence?.preparedRouteTargets,
    taskDiagnosticsErrorRoute?.preparedRouteTargets,
    'policy candidate evidence should bind the task route targets'
  );
  assert.deepEqual(
    taskDiagnosticsPolicyCandidateEvidence?.fallbackProviderIds,
    taskDiagnosticsErrorRoute?.fallbackProviderIds,
    'policy candidate evidence should bind the task route fallback providers'
  );
  assert.deepEqual(
    taskDiagnosticsPolicyCandidateEvidence?.routeTracePhases,
    taskDiagnosticsErrorRoute?.routeTrace.map(phase => phase.phase),
    'policy candidate evidence should bind the task route trace phases'
  );
  assert.deepEqual(
    taskDiagnosticsPolicyCandidateEvidence?.routeTrace,
    taskDiagnosticsErrorRoute?.routeTrace,
    'policy candidate evidence should bind the task route trace'
  );
  assert.deepEqual(
    taskDiagnosticsPolicyCandidateEvidence?.policyCandidates,
    taskRoutePolicyCandidateEvidenceFixture(
      taskDiagnosticsErrorRoute?.policyCandidates
    ),
    'policy candidate evidence should bind the task route policy candidates'
  );
  const taskDiagnosticsRouteCandidateEvidence =
    taskDiagnosticsErrorRepair?.candidateEvidence?.find(
      evidence => evidence.scope === 'routeCandidate'
    );
  assert.match(
    taskDiagnosticsRouteCandidateEvidence?.candidateFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    taskDiagnosticsRouteCandidateEvidence?.candidateKey?.includes('local'),
    true
  );
  assert.equal(
    taskDiagnosticsRouteCandidateEvidence?.candidateKey?.includes(
      'embed-alias'
    ),
    true
  );
  assert.equal(
    taskDiagnosticsRouteCandidateEvidence?.providerConfiguredModelIds?.includes(
      'workspace-embedding'
    ),
    true
  );
  assert.equal(
    taskDiagnosticsRouteCandidateEvidence?.preparedRouteTargetFingerprint,
    taskDiagnosticsErrorRoute?.preparedRouteTargetFingerprint,
    'route candidate evidence should bind the task route target fingerprint'
  );
  assert.deepEqual(
    taskDiagnosticsRouteCandidateEvidence?.preparedRouteTargets,
    taskDiagnosticsErrorRoute?.preparedRouteTargets,
    'route candidate evidence should bind the task route targets'
  );
  assert.deepEqual(
    taskDiagnosticsRouteCandidateEvidence?.fallbackProviderIds,
    taskDiagnosticsErrorRoute?.fallbackProviderIds,
    'route candidate evidence should bind the task route fallback providers'
  );
  assert.deepEqual(
    taskDiagnosticsRouteCandidateEvidence?.routeTracePhases,
    taskDiagnosticsErrorRoute?.routeTrace.map(phase => phase.phase),
    'route candidate evidence should bind the task route trace phases'
  );
  assert.deepEqual(
    taskDiagnosticsRouteCandidateEvidence?.routeTrace,
    taskDiagnosticsErrorRoute?.routeTrace,
    'route candidate evidence should bind the task route trace'
  );
  assert.deepEqual(
    taskDiagnosticsRouteCandidateEvidence?.policyCandidates,
    taskRoutePolicyCandidateEvidenceFixture(
      taskDiagnosticsErrorRoute?.policyCandidates
    ),
    'route candidate evidence should bind the task route policy candidates'
  );
  const taskDiagnosticsPrepareCandidateEvidence =
    taskDiagnosticsErrorRepair?.candidateEvidence?.find(
      evidence => evidence.scope === 'prepareCandidate'
    );
  assert.match(
    taskDiagnosticsPrepareCandidateEvidence?.candidateFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.equal(
    taskDiagnosticsPrepareCandidateEvidence?.candidateKey,
    taskDiagnosticsRouteCandidateEvidence?.candidateKey
  );
  assert.equal(
    taskDiagnosticsPrepareCandidateEvidence?.preparedModelId,
    'nomic-embed-text'
  );
  assert.equal(
    taskDiagnosticsPrepareCandidateEvidence?.providerProfileConfigPath,
    'copilot.providers.profiles[id=local]'
  );
  assert.equal(
    taskDiagnosticsPrepareCandidateEvidence?.preparedRouteTargetFingerprint,
    taskDiagnosticsErrorRoute?.preparedRouteTargetFingerprint,
    'prepare candidate evidence should bind the task route target fingerprint'
  );
  assert.deepEqual(
    taskDiagnosticsPrepareCandidateEvidence?.preparedRouteTargets,
    taskDiagnosticsErrorRoute?.preparedRouteTargets,
    'prepare candidate evidence should bind the task route targets'
  );
  assert.deepEqual(
    taskDiagnosticsPrepareCandidateEvidence?.fallbackProviderIds,
    taskDiagnosticsErrorRoute?.fallbackProviderIds,
    'prepare candidate evidence should bind the task route fallback providers'
  );
  assert.deepEqual(
    taskDiagnosticsPrepareCandidateEvidence?.routeTracePhases,
    taskDiagnosticsErrorRoute?.routeTrace.map(phase => phase.phase),
    'prepare candidate evidence should bind the task route trace phases'
  );
  assert.deepEqual(
    taskDiagnosticsPrepareCandidateEvidence?.routeTrace,
    taskDiagnosticsErrorRoute?.routeTrace,
    'prepare candidate evidence should bind the task route trace'
  );
  assert.deepEqual(
    taskDiagnosticsPrepareCandidateEvidence?.policyCandidates,
    taskRoutePolicyCandidateEvidenceFixture(
      taskDiagnosticsErrorRoute?.policyCandidates
    ),
    'prepare candidate evidence should bind the task route policy candidates'
  );
  const taskDiagnosticsErrorPreviewOperation =
    taskDiagnosticsErrorGate?.repairActionPreview.operations.find(
      operation =>
        operation.diagnosticsFingerprint ===
        taskDiagnosticsErrorRepair?.diagnosticsFingerprint
    );
  const taskDiagnosticsCandidateEvidence =
    taskDiagnosticsErrorRepair?.candidateEvidence ?? [];
  assert.equal(
    taskDiagnosticsErrorPreviewOperation?.candidateEvidenceCount,
    taskDiagnosticsCandidateEvidence.length
  );
  assert.match(
    taskDiagnosticsErrorPreviewOperation?.candidateEvidenceFingerprint ?? '',
    /^[0-9a-f]{16}$/
  );
  assert.deepEqual(
    taskDiagnosticsErrorPreviewOperation?.candidateEvidenceFingerprints,
    taskDiagnosticsCandidateEvidence
      .map(evidence => evidence.candidateFingerprint)
      .sort()
  );
  assert.deepEqual(
    taskDiagnosticsErrorPreviewOperation?.candidateEvidenceKeys,
    Array.from(
      new Set(
        taskDiagnosticsCandidateEvidence.flatMap(evidence =>
          evidence.candidateKey ? [evidence.candidateKey] : []
        )
      )
    ).sort()
  );

  console.log('resolver source chain smoke passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
