import { describe, expect, test, vi } from 'vitest';

import {
  AIModelService,
  buildAIModels,
  buildGetPromptModelsVariables,
  formatAIModelCapabilityLabel,
  formatAIModelCostLabel,
  formatAIModelDefinitionLabel,
  formatAIModelDiagnosticsLabel,
  formatAIModelFallbackLabel,
  formatAIModelHealthDetailLabel,
  formatAIModelLimitsLabel,
  formatAIModelMenuLabels,
  formatAIModelPromptLabel,
  formatAIModelPromptSourcesLabel,
  formatAIModelProviderLabel,
  formatAIModelProviderProfileLabel,
  formatAIModelRouteLabel,
  formatAIModelRoutePolicyLabel,
  formatAIModelSourcesLabel,
  formatAIModelTaskRoutesLabel,
  getAIModelIdKey,
  getAIModelPromptDefaultDiagnostics,
  getAIModelPromptFetchKey,
  getAIModelTaskRouteCandidateTrace,
  getAIModelTaskRouteDiagnostics,
  getAIModelTaskRoutePhaseTrace,
  getAIModelTaskRoutePolicyCandidateTrace,
  getAIModelTaskRoutePolicySummary,
  getAIModelTaskRouteReadiness,
  getAIModelTaskRouteReasonMetadata,
  getAIModelTaskRouteReasonMetadataList,
  getAIModelTaskRouteReasonSummary,
  getAIModelTaskRouteRemediationTarget,
  getAIModelTaskRouteRemediationTargets,
  getAIModelTaskRoutesDiagnostics,
  getAIModelTaskRoutesReadiness,
  resolveAIModelPromptName,
  resolveAvailableAIModelId,
  resolveDefaultPromptAIModelSeedId,
  shouldResetUnavailableAIModel,
  sortAIModelsForSelection,
} from './models';

describe('AIModelService model registry helpers', () => {
  test('maps task route reason codes to reusable metadata', () => {
    expect(getAIModelTaskRouteReasonMetadata('provider_prepare_error')).toEqual(
      {
        code: 'provider_prepare_error',
        label: 'Provider prepare error',
        description:
          'The provider runtime prepare boundary threw a sanitized error.',
        phase: 'prepared',
        severity: 'error',
        actionKind: 'check_provider_runtime',
        remediation:
          'Inspect the sanitized prepare error code and provider runtime logs; credentials and raw endpoint details are intentionally not exposed here.',
      }
    );
    expect(
      getAIModelTaskRouteReasonMetadata('provider_prepare_auth_error')
    ).toEqual({
      code: 'provider_prepare_auth_error',
      label: 'Prepare auth error',
      description:
        'The sanitized prepare error category points to credentials or authorization.',
      phase: 'prepared',
      severity: 'error',
      actionKind: 'configure_provider',
      remediation:
        'Check provider credentials, BYOK lease availability, and server-side authorization settings without exposing secrets in diagnostics.',
    });
    expect(
      getAIModelTaskRouteReasonMetadata('provider_prepare_runtime_error')
    ).toEqual({
      code: 'provider_prepare_runtime_error',
      label: 'Prepare runtime error',
      description:
        'The sanitized prepare error category points to an uncategorized provider runtime failure.',
      phase: 'prepared',
      severity: 'error',
      actionKind: 'check_provider_runtime',
      remediation:
        'Inspect provider runtime logs for the sanitized error code; raw endpoint, headers, and response bodies are intentionally not exposed here.',
    });
    expect(getAIModelTaskRouteReasonMetadata('capability_mismatch')).toEqual({
      code: 'capability_mismatch',
      label: 'Capability mismatch',
      description:
        'The provider model does not satisfy the requested capability.',
      phase: 'resolution',
      severity: 'warning',
      actionKind: 'check_model_capability',
      remediation:
        'Update model capability metadata or choose a model that supports the requested input, output, and attachment requirements.',
    });
    expect(
      getAIModelTaskRouteReasonMetadata('prompt_default_unavailable')
    ).toEqual({
      code: 'prompt_default_unavailable',
      label: 'Prompt default unavailable',
      description:
        'The prompt default model is not routable, so the active default uses a fallback route.',
      phase: 'prompt',
      severity: 'warning',
      actionKind: 'check_prompt_default',
      remediation:
        'Update the prompt default model or prompt default policy to a model alias that is routable in the current provider registry and workspace policy.',
    });
    expect(getAIModelTaskRouteReasonMetadata('candidate_allowed')).toEqual({
      code: 'candidate_allowed',
      label: 'Policy allowed',
      description: 'The provider candidate passed route policy checks.',
      phase: 'policy',
      severity: 'info',
      actionKind: 'none',
    });
    expect(getAIModelTaskRouteReasonMetadata('future_reason')).toEqual({
      code: 'future_reason',
      label: 'future_reason',
      description: 'Unrecognized route diagnostic reason.',
      phase: 'unknown',
      severity: 'info',
    });
    expect(getAIModelTaskRouteRemediationTarget('configure_provider')).toEqual({
      kind: 'provider_profiles',
      label: 'Provider profiles',
      description:
        'Provider enablement, credentials, endpoint, health, privacy, and profile configuration.',
    });
    expect(
      getAIModelTaskRouteRemediationTarget('check_prompt_default')
    ).toEqual({
      kind: 'prompt_registry',
      label: 'Prompt registry',
      description:
        'Prompt default model, default policy, category defaults, overrides, and prompt catalog metadata.',
    });
    expect(
      getAIModelTaskRouteRemediationTargets([
        'check_prompt_default',
        'configure_provider',
        'check_privacy_policy',
        'check_policy',
        'inspect_prepare_trace',
      ])
    ).toEqual([
      {
        kind: 'prepare_trace',
        label: 'Prepare trace',
        description:
          'Matched route candidates, prepare candidates, sanitized prepare errors, and prepared native routes.',
      },
      {
        kind: 'prompt_registry',
        label: 'Prompt registry',
        description:
          'Prompt default model, default policy, category defaults, overrides, and prompt catalog metadata.',
      },
      {
        kind: 'provider_profiles',
        label: 'Provider profiles',
        description:
          'Provider enablement, credentials, endpoint, health, privacy, and profile configuration.',
      },
      {
        kind: 'route_policy',
        label: 'Route policy',
        description:
          'Allowed providers, blocked providers, workspace policy, and feature policy.',
      },
    ]);
    expect(
      getAIModelTaskRouteReasonMetadataList([
        'provider_prepare_error',
        'provider_prepare_error',
        'provider_prepare_runtime_error',
        'prepared_route_filtered',
      ])
    ).toEqual([
      getAIModelTaskRouteReasonMetadata('provider_prepare_error'),
      getAIModelTaskRouteReasonMetadata('provider_prepare_runtime_error'),
      getAIModelTaskRouteReasonMetadata('prepared_route_filtered'),
    ]);
  });

  test('summarizes task route reasons for reusable diagnostics surfaces', () => {
    expect(
      getAIModelTaskRouteReasonSummary({
        configured: true,
        featureKind: 'workspace_indexing',
        preparedProviderCount: 1,
        routeTrace: [
          {
            phase: 'policy',
            candidateCount: 2,
            reasons: ['candidate_allowed', 'provider_unavailable'],
          },
          {
            phase: 'prepared',
            candidateCount: 2,
            preparedCount: 1,
            reasons: ['prepared_route_filtered', 'provider_prepare_error'],
          },
        ],
        policyCandidates: [
          {
            providerId: 'ollama-main',
            privacy: 'local',
            health: 'healthy',
            available: true,
            allowed: true,
            reasons: ['candidate_allowed'],
          },
          {
            providerId: 'offline-local',
            privacy: 'local',
            health: 'down',
            available: false,
            allowed: false,
            reasons: ['provider_unavailable'],
          },
        ],
        routeCandidates: [
          {
            providerId: 'ollama-main',
            modelId: 'workspace-embedding',
            matched: false,
            reasons: ['capability_mismatch', 'output_not_supported'],
          },
        ],
        prepareCandidates: [
          {
            providerId: 'ollama-main',
            modelId: 'workspace-embedding',
            prepared: false,
            errorCode: 'PrepareProbeFailure',
            reasons: ['prepared_route_filtered', 'provider_prepare_error'],
          },
        ],
      })
    ).toEqual({
      highestSeverity: 'error',
      bySeverity: [
        {
          severity: 'error',
          count: 4,
          reasons: [
            {
              ...getAIModelTaskRouteReasonMetadata('provider_unavailable'),
              count: 2,
              sources: ['route_trace', 'policy_candidate'],
            },
            {
              ...getAIModelTaskRouteReasonMetadata('provider_prepare_error'),
              count: 2,
              sources: ['route_trace', 'prepare_candidate'],
            },
          ],
        },
        {
          severity: 'warning',
          count: 4,
          reasons: [
            {
              ...getAIModelTaskRouteReasonMetadata('capability_mismatch'),
              count: 1,
              sources: ['route_candidate'],
            },
            {
              ...getAIModelTaskRouteReasonMetadata('output_not_supported'),
              count: 1,
              sources: ['route_candidate'],
            },
            {
              ...getAIModelTaskRouteReasonMetadata('prepared_route_filtered'),
              count: 2,
              sources: ['route_trace', 'prepare_candidate'],
            },
          ],
        },
        {
          severity: 'info',
          count: 2,
          reasons: [
            {
              ...getAIModelTaskRouteReasonMetadata('candidate_allowed'),
              count: 2,
              sources: ['route_trace', 'policy_candidate'],
            },
          ],
        },
      ],
      byActionKind: [
        {
          actionKind: 'check_provider_runtime',
          count: 2,
          reasons: [
            {
              ...getAIModelTaskRouteReasonMetadata('provider_prepare_error'),
              count: 2,
              sources: ['route_trace', 'prepare_candidate'],
            },
          ],
        },
        {
          actionKind: 'configure_provider',
          count: 2,
          reasons: [
            {
              ...getAIModelTaskRouteReasonMetadata('provider_unavailable'),
              count: 2,
              sources: ['route_trace', 'policy_candidate'],
            },
          ],
        },
        {
          actionKind: 'check_model_capability',
          count: 2,
          reasons: [
            {
              ...getAIModelTaskRouteReasonMetadata('capability_mismatch'),
              count: 1,
              sources: ['route_candidate'],
            },
            {
              ...getAIModelTaskRouteReasonMetadata('output_not_supported'),
              count: 1,
              sources: ['route_candidate'],
            },
          ],
        },
        {
          actionKind: 'inspect_prepare_trace',
          count: 2,
          reasons: [
            {
              ...getAIModelTaskRouteReasonMetadata('prepared_route_filtered'),
              count: 2,
              sources: ['route_trace', 'prepare_candidate'],
            },
          ],
        },
      ],
      reasons: [
        {
          ...getAIModelTaskRouteReasonMetadata('provider_unavailable'),
          count: 2,
          sources: ['route_trace', 'policy_candidate'],
        },
        {
          ...getAIModelTaskRouteReasonMetadata('provider_prepare_error'),
          count: 2,
          sources: ['route_trace', 'prepare_candidate'],
        },
        {
          ...getAIModelTaskRouteReasonMetadata('capability_mismatch'),
          count: 1,
          sources: ['route_candidate'],
        },
        {
          ...getAIModelTaskRouteReasonMetadata('output_not_supported'),
          count: 1,
          sources: ['route_candidate'],
        },
        {
          ...getAIModelTaskRouteReasonMetadata('prepared_route_filtered'),
          count: 2,
          sources: ['route_trace', 'prepare_candidate'],
        },
        {
          ...getAIModelTaskRouteReasonMetadata('candidate_allowed'),
          count: 2,
          sources: ['route_trace', 'policy_candidate'],
        },
      ],
    });

    expect(getAIModelTaskRouteReasonSummary(null)).toEqual({
      byActionKind: [],
      bySeverity: [],
      highestSeverity: 'info',
      reasons: [],
    });
  });

  test('summarizes prompt default fallback diagnostics for admin surfaces', () => {
    expect(
      getAIModelPromptDefaultDiagnostics({
        defaultModel: 'ollama-main/office-chat-fast',
        id: 'ollama-main/office-chat-fast',
        isDefault: true,
        promptDefaultModel: 'gemini-2.5-flash',
        defaultModelSource: 'fallback_route',
        defaultModelFallbackReason: 'prompt_default_unavailable',
      })
    ).toEqual({
      actionKinds: ['check_prompt_default'],
      activeDefaultModel: 'ollama-main/office-chat-fast',
      defaultModelSource: 'fallback_route',
      promptDefaultModel: 'gemini-2.5-flash',
      reasonSummary: {
        byActionKind: [
          {
            actionKind: 'check_prompt_default',
            count: 1,
            reasons: [
              {
                ...getAIModelTaskRouteReasonMetadata(
                  'prompt_default_unavailable'
                ),
                count: 1,
                sources: ['prompt_default'],
              },
            ],
          },
        ],
        bySeverity: [
          {
            severity: 'warning',
            count: 1,
            reasons: [
              {
                ...getAIModelTaskRouteReasonMetadata(
                  'prompt_default_unavailable'
                ),
                count: 1,
                sources: ['prompt_default'],
              },
            ],
          },
        ],
        highestSeverity: 'warning',
        reasons: [
          {
            ...getAIModelTaskRouteReasonMetadata('prompt_default_unavailable'),
            count: 1,
            sources: ['prompt_default'],
          },
        ],
      },
    });

    expect(
      getAIModelPromptDefaultDiagnostics({
        defaultModel: 'ollama-main/office-chat-fast',
        id: 'ollama-main/office-chat-fast',
        isDefault: true,
        promptDefaultModel: 'ollama-main/office-chat-fast',
        defaultModelSource: 'prompt',
        defaultModelFallbackReason: null,
      })
    ).toEqual({
      actionKinds: [],
      activeDefaultModel: 'ollama-main/office-chat-fast',
      defaultModelSource: 'prompt',
      promptDefaultModel: 'ollama-main/office-chat-fast',
      reasonSummary: {
        byActionKind: [],
        bySeverity: [],
        highestSeverity: 'info',
        reasons: [],
      },
    });

    expect(
      getAIModelPromptDefaultDiagnostics({
        defaultModel: 'openai-default/gpt-4o-mini',
        promptDefaultModel: 'gemini-2.5-flash',
        defaultModelSource: 'fallback_route',
        defaultModelFallbackReason: 'prompt_default_unavailable',
      }).activeDefaultModel
    ).toBe('openai-default/gpt-4o-mini');
  });

  test('summarizes task route readiness for configuration diagnostics', () => {
    const readyEmbeddingRoute = {
      configured: true,
      featureKind: 'workspace_indexing',
      providerId: 'ollama-main',
      modelId: 'nomic-embed-text',
      preparedProviderCount: 1,
      requestedModelId: 'ollama-main/workspace-embedding',
      routeTrace: [
        {
          phase: 'prepared',
          candidateCount: 1,
          preparedCount: 1,
          reasons: ['provider_prepare_succeeded'],
        },
      ],
      prepareCandidates: [
        {
          providerId: 'ollama-main',
          modelId: 'workspace-embedding',
          prepared: true,
          preparedModelId: 'nomic-embed-text',
          reasons: ['provider_prepare_succeeded'],
        },
      ],
    };
    const warningEmbeddingRoute = {
      ...readyEmbeddingRoute,
      dimensionMismatch: true,
      routeTrace: [
        {
          phase: 'prepared',
          candidateCount: 2,
          preparedCount: 1,
          reasons: ['prepared_route_filtered'],
        },
      ],
      prepareCandidates: [
        {
          providerId: 'ollama-main',
          modelId: 'workspace-embedding-large',
          prepared: false,
          reasons: ['provider_prepare_returned_empty'],
        },
      ],
    };
    const blockedRerankRoute = {
      configured: false,
      featureKind: 'rerank',
      preparedProviderCount: 0,
      errorCode: 'no_copilot_provider_available',
      errorMessage: 'No rerank provider available',
      routeTrace: [
        {
          phase: 'policy',
          candidateCount: 1,
          reasons: ['provider_unavailable'],
        },
      ],
    };

    expect(getAIModelTaskRouteReadiness(readyEmbeddingRoute)).toMatchObject({
      actionKinds: [],
      configured: true,
      featureKind: 'workspace_indexing',
      modelId: 'nomic-embed-text',
      preparedProviderCount: 1,
      providerId: 'ollama-main',
      requestedModelId: 'ollama-main/workspace-embedding',
      severity: 'info',
      status: 'ready',
    });
    expect(getAIModelTaskRouteReadiness(warningEmbeddingRoute)).toMatchObject({
      actionKinds: ['inspect_prepare_trace'],
      configured: true,
      dimensionMismatch: true,
      featureKind: 'workspace_indexing',
      severity: 'warning',
      status: 'warning',
    });
    expect(getAIModelTaskRouteReadiness(blockedRerankRoute)).toMatchObject({
      actionKinds: ['configure_provider'],
      configured: false,
      errorCode: 'no_copilot_provider_available',
      errorMessage: 'No rerank provider available',
      featureKind: 'rerank',
      preparedProviderCount: 0,
      severity: 'error',
      status: 'blocked',
    });
    expect(getAIModelTaskRouteReadiness(null, 'rerank')).toEqual({
      actionKinds: [],
      configured: false,
      featureKind: 'rerank',
      preparedProviderCount: 0,
      reasonSummary: {
        byActionKind: [],
        bySeverity: [],
        highestSeverity: 'info',
        reasons: [],
      },
      severity: 'warning',
      status: 'unconfigured',
    });

    expect(
      getAIModelTaskRoutesReadiness({
        embeddingRoute: warningEmbeddingRoute,
        rerankRoute: blockedRerankRoute,
      })
    ).toMatchObject({
      actionKinds: ['inspect_prepare_trace', 'configure_provider'],
      highestSeverity: 'error',
      status: 'blocked',
      routes: [
        {
          featureKind: 'workspace_indexing',
          status: 'warning',
        },
        {
          featureKind: 'rerank',
          status: 'blocked',
        },
      ],
    });
  });

  test('builds task route phase trace summaries for admin diagnostics', () => {
    expect(
      getAIModelTaskRoutePhaseTrace({
        configured: true,
        featureKind: 'workspace_indexing',
        preparedProviderCount: 1,
        routeTrace: [
          {
            phase: 'policy',
            candidateCount: 3,
            availableCount: 2,
            selectedCount: 1,
            blockedCount: 1,
            reasons: [
              'candidate_allowed',
              'provider_unavailable',
              'privacy_not_allowed',
            ],
          },
          {
            phase: 'resolution',
            candidateCount: 2,
            availableCount: 2,
            selectedCount: 1,
            matchedCount: 1,
            reasons: ['capability_matched', 'capability_mismatch'],
          },
          {
            phase: 'prepared',
            candidateCount: 1,
            selectedCount: 1,
            preparedCount: 0,
            reasons: ['prepared_route_filtered', 'provider_prepare_error'],
          },
        ],
      })
    ).toEqual({
      actionKinds: [
        'configure_provider',
        'check_privacy_policy',
        'check_model_capability',
        'check_provider_runtime',
        'inspect_prepare_trace',
      ],
      highestSeverity: 'error',
      phases: [
        {
          actionKinds: ['configure_provider', 'check_privacy_policy'],
          availableCount: 2,
          blockedCount: 1,
          candidateCount: 3,
          phase: 'policy',
          reasonSummary: {
            byActionKind: [
              {
                actionKind: 'configure_provider',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_unavailable'
                    ),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
              {
                actionKind: 'check_privacy_policy',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata('privacy_not_allowed'),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
            ],
            bySeverity: [
              {
                severity: 'error',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_unavailable'
                    ),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
              {
                severity: 'warning',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata('privacy_not_allowed'),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
              {
                severity: 'info',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata('candidate_allowed'),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
            ],
            highestSeverity: 'error',
            reasons: [
              {
                ...getAIModelTaskRouteReasonMetadata('provider_unavailable'),
                count: 1,
                sources: ['route_trace'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata('privacy_not_allowed'),
                count: 1,
                sources: ['route_trace'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata('candidate_allowed'),
                count: 1,
                sources: ['route_trace'],
              },
            ],
          },
          selectedCount: 1,
          severity: 'error',
        },
        {
          actionKinds: ['check_model_capability'],
          availableCount: 2,
          candidateCount: 2,
          matchedCount: 1,
          phase: 'resolution',
          reasonSummary: {
            byActionKind: [
              {
                actionKind: 'check_model_capability',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata('capability_mismatch'),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
            ],
            bySeverity: [
              {
                severity: 'warning',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata('capability_mismatch'),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
              {
                severity: 'info',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata('capability_matched'),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
            ],
            highestSeverity: 'warning',
            reasons: [
              {
                ...getAIModelTaskRouteReasonMetadata('capability_mismatch'),
                count: 1,
                sources: ['route_trace'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata('capability_matched'),
                count: 1,
                sources: ['route_trace'],
              },
            ],
          },
          selectedCount: 1,
          severity: 'warning',
        },
        {
          actionKinds: ['check_provider_runtime', 'inspect_prepare_trace'],
          candidateCount: 1,
          phase: 'prepared',
          preparedCount: 0,
          reasonSummary: {
            byActionKind: [
              {
                actionKind: 'check_provider_runtime',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_prepare_error'
                    ),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
              {
                actionKind: 'inspect_prepare_trace',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'prepared_route_filtered'
                    ),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
            ],
            bySeverity: [
              {
                severity: 'error',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_prepare_error'
                    ),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
              {
                severity: 'warning',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'prepared_route_filtered'
                    ),
                    count: 1,
                    sources: ['route_trace'],
                  },
                ],
              },
            ],
            highestSeverity: 'error',
            reasons: [
              {
                ...getAIModelTaskRouteReasonMetadata('provider_prepare_error'),
                count: 1,
                sources: ['route_trace'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata('prepared_route_filtered'),
                count: 1,
                sources: ['route_trace'],
              },
            ],
          },
          selectedCount: 1,
          severity: 'error',
        },
      ],
    });

    expect(getAIModelTaskRoutePhaseTrace(null)).toEqual({
      actionKinds: [],
      highestSeverity: 'info',
      phases: [],
    });
  });

  test('builds task route candidate trace rows for admin diagnostics', () => {
    const preparedKey = JSON.stringify([
      'byok',
      'ollama-main',
      'workspace-embedding',
      'workspace-embedding',
      ['local-embedding', 'workspace-embedding'],
    ]);
    const filteredKey = JSON.stringify([
      'byok',
      'ollama-main',
      'workspace-embedding-large',
      'workspace-embedding-large',
      ['workspace-embedding-large'],
    ]);
    const prepareOnlyKey = JSON.stringify([
      'quota_backed',
      'openai-prepare-probe',
      '',
      'text-embedding-3-large',
      ['text-embedding-3-large'],
    ]);
    const emptyRouteMetadata = {
      routeAttachmentAllowRemoteUrls: null,
      routeAttachmentKinds: null,
      routeAttachmentSourceKinds: null,
      routeContextWindow: null,
      routeEmbeddingDimensions: null,
      routeInputTypes: null,
      routeMaxOutputTokens: null,
      routeOutputTypes: null,
      routeStructuredAttachmentAllowRemoteUrls: null,
      routeStructuredAttachmentKinds: null,
      routeStructuredAttachmentSourceKinds: null,
    };

    expect(
      getAIModelTaskRouteCandidateTrace({
        configured: true,
        featureKind: 'workspace_indexing',
        preparedProviderCount: 1,
        routeCandidates: [
          {
            candidateKey: preparedKey,
            registryKind: 'byok',
            registryAvailable: true,
            registrySelected: true,
            providerId: 'ollama-main',
            providerName: 'Local Ollama',
            providerSource: 'byok_local',
            providerProfileId: 'ollama-main',
            providerProfileSource: 'byok_local',
            providerProfileConfigPath: 'workspace.byok.local',
            providerConfiguredModelIds: [
              'workspace-embedding',
              'local-embedding',
            ],
            providerConfiguredModelCount: 2,
            providerType: 'openaiCompatible',
            providerPriority: 10,
            privacy: 'local',
            health: 'healthy',
            healthCheckedAt: '2026-06-16T10:00:00.000Z',
            requestedModelId: 'workspace-embedding',
            modelId: 'workspace-embedding',
            routeRawModelId: 'nomic-embed-text',
            routeModelDefinitionSource: 'provider_profile',
            routeModelDefinitionId: 'workspace-embedding',
            routeModelDefinitionAliases: ['local-embedding'],
            routeModelAliasMatched: false,
            candidateModelIds: ['workspace-embedding', 'local-embedding'],
            matched: true,
            reasons: ['capability_matched'],
          },
          {
            candidateKey: filteredKey,
            registryKind: 'byok',
            registryAvailable: true,
            registrySelected: true,
            providerId: 'ollama-main',
            requestedModelId: 'workspace-embedding-large',
            modelId: 'workspace-embedding-large',
            candidateModelIds: ['workspace-embedding-large'],
            matched: true,
            reasons: ['capability_matched'],
          },
          {
            registryKind: 'quota_backed',
            registryAvailable: false,
            registrySelected: false,
            providerId: 'blocked-cloud',
            requestedModelId: 'workspace-embedding',
            candidateModelIds: ['cloud-embedding'],
            matched: false,
            reasons: ['provider_unavailable', 'profile_model_not_allowed'],
          },
        ],
        prepareCandidates: [
          {
            candidateKey: preparedKey,
            registryKind: 'byok',
            registryAvailable: true,
            registrySelected: true,
            providerId: 'ollama-main',
            requestedModelId: 'workspace-embedding',
            modelId: 'workspace-embedding',
            candidateModelIds: ['workspace-embedding', 'local-embedding'],
            prepared: true,
            preparedModelId: 'nomic-embed-text',
            reasons: [
              'prepared_route_available',
              'provider_prepare_succeeded',
              'prepared_model_resolved',
            ],
          },
          {
            candidateKey: filteredKey,
            registryKind: 'byok',
            registryAvailable: true,
            registrySelected: true,
            providerId: 'ollama-main',
            requestedModelId: 'workspace-embedding-large',
            modelId: 'workspace-embedding-large',
            candidateModelIds: ['workspace-embedding-large'],
            prepared: false,
            errorCode: 'PrepareProbeFailure',
            reasons: ['prepared_route_filtered', 'provider_prepare_error'],
          },
          {
            candidateKey: prepareOnlyKey,
            registryKind: 'quota_backed',
            registryAvailable: true,
            registrySelected: false,
            providerId: 'openai-prepare-probe',
            providerName: 'OpenAI Prepare Probe',
            providerSource: 'configured',
            providerProfileId: 'openai-prepare-probe',
            providerProfileSource: 'configured',
            providerProfileConfigPath:
              'copilot.providers.profiles[id=openai-prepare-probe]',
            providerConfiguredModelIds: ['text-embedding-3-large'],
            providerConfiguredModelCount: 1,
            providerType: 'openai',
            providerPriority: 1,
            privacy: 'private_cloud',
            health: 'degraded',
            healthCheckedAt: '2026-06-16T11:00:00.000Z',
            modelId: 'text-embedding-3-large',
            routeModelDefinitionSource: 'native_registry',
            routeModelDefinitionId: 'text-embedding-3-large',
            candidateModelIds: ['text-embedding-3-large'],
            prepared: false,
            reasons: ['provider_prepare_returned_empty'],
          },
        ],
      })
    ).toEqual({
      actionKinds: [
        'check_provider_runtime',
        'inspect_prepare_trace',
        'configure_provider',
        'check_model_profile',
      ],
      highestSeverity: 'error',
      rows: [
        {
          actionKinds: [],
          candidateKey: preparedKey,
          candidateModelIds: ['workspace-embedding', 'local-embedding'],
          matched: true,
          modelId: 'workspace-embedding',
          prepared: true,
          preparedModelId: 'nomic-embed-text',
          providerId: 'ollama-main',
          providerName: 'Local Ollama',
          providerSource: 'byok_local',
          providerProfileId: 'ollama-main',
          providerProfileSource: 'byok_local',
          providerProfileConfigPath: 'workspace.byok.local',
          providerConfiguredModelIds: [
            'workspace-embedding',
            'local-embedding',
          ],
          providerConfiguredModelCount: 2,
          providerType: 'openaiCompatible',
          providerPriority: 10,
          privacy: 'local',
          health: 'healthy',
          healthCheckedAt: '2026-06-16T10:00:00.000Z',
          routeRawModelId: 'nomic-embed-text',
          routeModelDefinitionSource: 'provider_profile',
          routeModelDefinitionId: 'workspace-embedding',
          routeModelDefinitionAliases: ['local-embedding'],
          routeModelAliasMatched: false,
          reasonSummary: {
            byActionKind: [],
            bySeverity: [
              {
                severity: 'info',
                count: 4,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata('capability_matched'),
                    count: 1,
                    sources: ['route_candidate'],
                  },
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'prepared_model_resolved'
                    ),
                    count: 1,
                    sources: ['prepare_candidate'],
                  },
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'prepared_route_available'
                    ),
                    count: 1,
                    sources: ['prepare_candidate'],
                  },
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_prepare_succeeded'
                    ),
                    count: 1,
                    sources: ['prepare_candidate'],
                  },
                ],
              },
            ],
            highestSeverity: 'info',
            reasons: [
              {
                ...getAIModelTaskRouteReasonMetadata('capability_matched'),
                count: 1,
                sources: ['route_candidate'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata('prepared_model_resolved'),
                count: 1,
                sources: ['prepare_candidate'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata(
                  'prepared_route_available'
                ),
                count: 1,
                sources: ['prepare_candidate'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata(
                  'provider_prepare_succeeded'
                ),
                count: 1,
                sources: ['prepare_candidate'],
              },
            ],
          },
          registryAvailable: true,
          registryKind: 'byok',
          registrySelected: true,
          requestedModelId: 'workspace-embedding',
          ...emptyRouteMetadata,
          severity: 'info',
          status: 'prepared',
        },
        {
          actionKinds: ['check_provider_runtime', 'inspect_prepare_trace'],
          candidateKey: filteredKey,
          candidateModelIds: ['workspace-embedding-large'],
          errorCode: 'PrepareProbeFailure',
          matched: true,
          modelId: 'workspace-embedding-large',
          prepared: false,
          preparedModelId: null,
          providerName: null,
          providerSource: null,
          providerProfileId: null,
          providerProfileSource: null,
          providerProfileConfigPath: null,
          providerConfiguredModelIds: null,
          providerConfiguredModelCount: null,
          providerType: null,
          providerPriority: null,
          privacy: null,
          health: null,
          healthCheckedAt: null,
          routeRawModelId: null,
          routeModelDefinitionSource: null,
          routeModelDefinitionId: null,
          routeModelDefinitionAliases: null,
          routeModelAliasMatched: null,
          providerId: 'ollama-main',
          reasonSummary: {
            byActionKind: [
              {
                actionKind: 'check_provider_runtime',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_prepare_error'
                    ),
                    count: 1,
                    sources: ['prepare_candidate'],
                  },
                ],
              },
              {
                actionKind: 'inspect_prepare_trace',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'prepared_route_filtered'
                    ),
                    count: 1,
                    sources: ['prepare_candidate'],
                  },
                ],
              },
            ],
            bySeverity: [
              {
                severity: 'error',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_prepare_error'
                    ),
                    count: 1,
                    sources: ['prepare_candidate'],
                  },
                ],
              },
              {
                severity: 'warning',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'prepared_route_filtered'
                    ),
                    count: 1,
                    sources: ['prepare_candidate'],
                  },
                ],
              },
              {
                severity: 'info',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata('capability_matched'),
                    count: 1,
                    sources: ['route_candidate'],
                  },
                ],
              },
            ],
            highestSeverity: 'error',
            reasons: [
              {
                ...getAIModelTaskRouteReasonMetadata('provider_prepare_error'),
                count: 1,
                sources: ['prepare_candidate'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata('prepared_route_filtered'),
                count: 1,
                sources: ['prepare_candidate'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata('capability_matched'),
                count: 1,
                sources: ['route_candidate'],
              },
            ],
          },
          registryAvailable: true,
          registryKind: 'byok',
          registrySelected: true,
          requestedModelId: 'workspace-embedding-large',
          ...emptyRouteMetadata,
          severity: 'error',
          status: 'filtered',
        },
        {
          actionKinds: ['configure_provider', 'check_model_profile'],
          candidateKey: null,
          candidateModelIds: ['cloud-embedding'],
          matched: false,
          modelId: null,
          prepared: null,
          preparedModelId: null,
          providerId: 'blocked-cloud',
          providerName: null,
          providerSource: null,
          providerProfileId: null,
          providerProfileSource: null,
          providerProfileConfigPath: null,
          providerConfiguredModelIds: null,
          providerConfiguredModelCount: null,
          providerType: null,
          providerPriority: null,
          privacy: null,
          health: null,
          healthCheckedAt: null,
          routeRawModelId: null,
          routeModelDefinitionSource: null,
          routeModelDefinitionId: null,
          routeModelDefinitionAliases: null,
          routeModelAliasMatched: null,
          reasonSummary: {
            byActionKind: [
              {
                actionKind: 'configure_provider',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_unavailable'
                    ),
                    count: 1,
                    sources: ['route_candidate'],
                  },
                ],
              },
              {
                actionKind: 'check_model_profile',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'profile_model_not_allowed'
                    ),
                    count: 1,
                    sources: ['route_candidate'],
                  },
                ],
              },
            ],
            bySeverity: [
              {
                severity: 'error',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_unavailable'
                    ),
                    count: 1,
                    sources: ['route_candidate'],
                  },
                ],
              },
              {
                severity: 'warning',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'profile_model_not_allowed'
                    ),
                    count: 1,
                    sources: ['route_candidate'],
                  },
                ],
              },
            ],
            highestSeverity: 'error',
            reasons: [
              {
                ...getAIModelTaskRouteReasonMetadata('provider_unavailable'),
                count: 1,
                sources: ['route_candidate'],
              },
              {
                ...getAIModelTaskRouteReasonMetadata(
                  'profile_model_not_allowed'
                ),
                count: 1,
                sources: ['route_candidate'],
              },
            ],
          },
          registryAvailable: false,
          registryKind: 'quota_backed',
          registrySelected: false,
          requestedModelId: 'workspace-embedding',
          ...emptyRouteMetadata,
          severity: 'error',
          status: 'unmatched',
        },
        {
          actionKinds: ['inspect_prepare_trace'],
          candidateKey: prepareOnlyKey,
          candidateModelIds: ['text-embedding-3-large'],
          matched: null,
          modelId: 'text-embedding-3-large',
          prepared: false,
          preparedModelId: null,
          providerId: 'openai-prepare-probe',
          providerName: 'OpenAI Prepare Probe',
          providerSource: 'configured',
          providerProfileId: 'openai-prepare-probe',
          providerProfileSource: 'configured',
          providerProfileConfigPath:
            'copilot.providers.profiles[id=openai-prepare-probe]',
          providerConfiguredModelIds: ['text-embedding-3-large'],
          providerConfiguredModelCount: 1,
          providerType: 'openai',
          providerPriority: 1,
          privacy: 'private_cloud',
          health: 'degraded',
          healthCheckedAt: '2026-06-16T11:00:00.000Z',
          routeRawModelId: null,
          routeModelDefinitionSource: 'native_registry',
          routeModelDefinitionId: 'text-embedding-3-large',
          routeModelDefinitionAliases: null,
          routeModelAliasMatched: null,
          reasonSummary: {
            byActionKind: [
              {
                actionKind: 'inspect_prepare_trace',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_prepare_returned_empty'
                    ),
                    count: 1,
                    sources: ['prepare_candidate'],
                  },
                ],
              },
            ],
            bySeverity: [
              {
                severity: 'warning',
                count: 1,
                reasons: [
                  {
                    ...getAIModelTaskRouteReasonMetadata(
                      'provider_prepare_returned_empty'
                    ),
                    count: 1,
                    sources: ['prepare_candidate'],
                  },
                ],
              },
            ],
            highestSeverity: 'warning',
            reasons: [
              {
                ...getAIModelTaskRouteReasonMetadata(
                  'provider_prepare_returned_empty'
                ),
                count: 1,
                sources: ['prepare_candidate'],
              },
            ],
          },
          registryAvailable: true,
          registryKind: 'quota_backed',
          registrySelected: false,
          requestedModelId: null,
          ...emptyRouteMetadata,
          severity: 'warning',
          status: 'prepare_only',
        },
      ],
    });

    expect(getAIModelTaskRouteCandidateTrace(null)).toEqual({
      actionKinds: [],
      highestSeverity: 'info',
      rows: [],
    });
  });

  test('builds task route policy candidate trace rows for admin diagnostics', () => {
    expect(
      getAIModelTaskRoutePolicyCandidateTrace({
        configured: false,
        featureKind: 'workspace_indexing',
        preparedProviderCount: 0,
        policyCandidates: [
          {
            allowed: true,
            available: true,
            candidateFingerprint: 'abcd1234efef5678',
            candidateKey: 'policy:workspace_indexing:global:ollama-main',
            health: 'healthy',
            healthCheckedAt: '2026-06-16T10:00:00.000Z',
            privacy: 'local',
            providerId: 'ollama-main',
            providerName: 'Local Ollama',
            providerProfileConfigPath: 'workspace.byok.local',
            providerProfileId: 'ollama-main',
            providerProfileSource: 'byok_local',
            providerConfiguredModelIds: [
              'workspace-embedding',
              'nomic-embed-text',
            ],
            providerConfiguredModelCount: 2,
            providerSource: 'byok_local',
            providerPriority: 10,
            providerType: 'openaiCompatible',
            reasons: ['candidate_allowed', 'privacy_preferred'],
          },
          {
            allowed: false,
            available: true,
            health: 'healthy',
            privacy: 'cloud',
            providerId: 'blocked-cloud',
            reasons: ['provider_blocked', 'privacy_not_allowed'],
          },
          {
            allowed: true,
            available: false,
            health: 'down',
            privacy: 'private_cloud',
            providerId: 'openai-fallback',
            reasons: ['provider_unavailable'],
          },
        ],
      })
    ).toMatchObject({
      actionKinds: [
        'check_policy',
        'check_privacy_policy',
        'configure_provider',
      ],
      highestSeverity: 'error',
      rows: [
        {
          actionKinds: [],
          allowed: true,
          available: true,
          candidateFingerprint: 'abcd1234efef5678',
          candidateKey: 'policy:workspace_indexing:global:ollama-main',
          health: 'healthy',
          healthCheckedAt: '2026-06-16T10:00:00.000Z',
          privacy: 'local',
          providerId: 'ollama-main',
          providerName: 'Local Ollama',
          providerProfileConfigPath: 'workspace.byok.local',
          providerProfileId: 'ollama-main',
          providerProfileSource: 'byok_local',
          providerConfiguredModelIds: [
            'workspace-embedding',
            'nomic-embed-text',
          ],
          providerConfiguredModelCount: 2,
          providerSource: 'byok_local',
          providerPriority: 10,
          providerType: 'openaiCompatible',
          reasonSummary: {
            highestSeverity: 'info',
          },
          severity: 'info',
          status: 'allowed',
        },
        {
          actionKinds: ['check_policy', 'check_privacy_policy'],
          allowed: false,
          available: true,
          health: 'healthy',
          privacy: 'cloud',
          providerId: 'blocked-cloud',
          reasonSummary: {
            highestSeverity: 'warning',
          },
          severity: 'warning',
          status: 'blocked',
        },
        {
          actionKinds: ['configure_provider'],
          allowed: true,
          available: false,
          health: 'down',
          privacy: 'private_cloud',
          providerId: 'openai-fallback',
          reasonSummary: {
            highestSeverity: 'error',
          },
          severity: 'error',
          status: 'unavailable',
        },
      ],
    });

    expect(getAIModelTaskRoutePolicyCandidateTrace(null)).toEqual({
      actionKinds: [],
      highestSeverity: 'info',
      rows: [],
    });
  });

  test('builds task route diagnostics bundles for admin surfaces', () => {
    const embeddingRoute = {
      configured: true,
      featureKind: 'workspace_indexing',
      providerId: 'ollama-main',
      modelId: 'nomic-embed-text',
      preparedProviderCount: 1,
      requestedModelId: 'ollama-main/workspace-embedding',
      routeTrace: [
        {
          phase: 'prepared',
          candidateCount: 2,
          selectedCount: 1,
          preparedCount: 0,
          reasons: ['prepared_route_filtered', 'provider_prepare_error'],
        },
      ],
      routeCandidates: [
        {
          providerId: 'ollama-main',
          modelId: 'workspace-embedding',
          matched: true,
          reasons: ['capability_matched'],
        },
      ],
      policyCandidates: [
        {
          allowed: false,
          available: true,
          health: 'healthy',
          privacy: 'cloud',
          providerId: 'blocked-cloud',
          reasons: ['provider_blocked'],
        },
      ],
      prepareCandidates: [
        {
          providerId: 'ollama-main',
          modelId: 'workspace-embedding',
          prepared: false,
          errorCode: 'PrepareProbeFailure',
          reasons: ['prepared_route_filtered', 'provider_prepare_error'],
        },
      ],
    };
    const rerankRoute = {
      configured: false,
      featureKind: 'rerank',
      preparedProviderCount: 0,
      errorCode: 'no_copilot_provider_available',
      routeTrace: [
        {
          phase: 'policy',
          candidateCount: 1,
          blockedCount: 1,
          reasons: ['provider_unavailable'],
        },
      ],
    };

    expect(getAIModelTaskRouteDiagnostics(embeddingRoute)).toMatchObject({
      actionKinds: [
        'check_provider_runtime',
        'check_policy',
        'inspect_prepare_trace',
      ],
      readiness: {
        featureKind: 'workspace_indexing',
        severity: 'warning',
        status: 'warning',
      },
      reasonSummary: {
        highestSeverity: 'error',
      },
      phaseTrace: {
        highestSeverity: 'error',
        phases: [
          {
            phase: 'prepared',
            preparedCount: 0,
            severity: 'error',
          },
        ],
      },
      candidateTrace: {
        highestSeverity: 'error',
        rows: [
          {
            errorCode: 'PrepareProbeFailure',
            providerId: 'ollama-main',
            severity: 'error',
            status: 'filtered',
          },
        ],
      },
      policyCandidateTrace: {
        highestSeverity: 'warning',
        rows: [
          {
            providerId: 'blocked-cloud',
            status: 'blocked',
          },
        ],
      },
    });

    expect(
      getAIModelTaskRoutesDiagnostics({
        embeddingRoute,
        rerankRoute,
      })
    ).toMatchObject({
      actionKinds: [
        'check_provider_runtime',
        'check_policy',
        'inspect_prepare_trace',
        'configure_provider',
      ],
      highestSeverity: 'error',
      status: 'blocked',
      routes: [
        {
          readiness: {
            featureKind: 'workspace_indexing',
            status: 'warning',
          },
        },
        {
          readiness: {
            featureKind: 'rerank',
            status: 'blocked',
          },
          phaseTrace: {
            highestSeverity: 'error',
            phases: [
              {
                blockedCount: 1,
                phase: 'policy',
              },
            ],
          },
        },
      ],
    });

    expect(getAIModelTaskRouteDiagnostics(null, 'rerank')).toMatchObject({
      actionKinds: [],
      readiness: {
        featureKind: 'rerank',
        status: 'unconfigured',
      },
      phaseTrace: {
        phases: [],
      },
      candidateTrace: {
        rows: [],
      },
      policyCandidateTrace: {
        rows: [],
      },
      reasonSummary: {
        highestSeverity: 'info',
      },
    });
  });

  test('builds AI model metadata from copilot model registry payloads', () => {
    const embeddingRouteTrace = [
      {
        phase: 'policy',
        candidateCount: 3,
        availableCount: 3,
        selectedCount: 2,
        blockedCount: 1,
        reasons: [
          'candidate_allowed',
          'privacy_preferred',
          'provider_blocked',
          'privacy_not_allowed',
        ],
      },
      {
        phase: 'resolution',
        candidateCount: 3,
        availableCount: 3,
        selectedCount: 1,
        matchedCount: 3,
        reasons: ['capability_matched', 'profile_model_matched'],
      },
      {
        phase: 'prepared',
        candidateCount: 3,
        selectedCount: 1,
        preparedCount: 2,
        reasons: [
          'prepared_route_filtered',
          'provider_prepare_succeeded',
          'provider_prepare_returned_empty',
        ],
      },
    ];
    const embeddingMainCandidateKey = JSON.stringify([
      'byok',
      'ollama-main',
      'workspace-embedding',
      'workspace-embedding',
      ['local-embedding', 'workspace-embedding'],
    ]);
    const embeddingOpenAICandidateKey = JSON.stringify([
      'quota_backed',
      'openai-default',
      '',
      'text-embedding-3-small',
      ['text-embedding-3-small'],
    ]);
    const embeddingFilteredCandidateKey = JSON.stringify([
      'quota_backed',
      'openai-prepare-filtered',
      '',
      'text-embedding-3-large',
      ['text-embedding-3-large'],
    ]);
    const rerankMainCandidateKey = JSON.stringify([
      'byok',
      'ollama-main',
      'office-rerank',
      'office-rerank',
      ['office-rerank'],
    ]);
    const embeddingRouteCandidates = [
      {
        candidateKey: embeddingMainCandidateKey,
        registryKind: 'byok',
        registryAvailable: true,
        registrySelected: true,
        providerId: 'ollama-main',
        requestedModelId: 'workspace-embedding',
        modelId: 'workspace-embedding',
        candidateModelIds: ['workspace-embedding', 'local-embedding'],
        matched: true,
        reasons: ['capability_matched'],
      },
      {
        candidateKey: embeddingOpenAICandidateKey,
        registryKind: 'quota_backed',
        registryAvailable: true,
        registrySelected: false,
        providerId: 'openai-default',
        modelId: 'text-embedding-3-small',
        candidateModelIds: ['text-embedding-3-small'],
        matched: true,
        reasons: ['profile_model_matched', 'capability_matched'],
      },
      {
        candidateKey: embeddingFilteredCandidateKey,
        registryKind: 'quota_backed',
        registryAvailable: true,
        registrySelected: false,
        providerId: 'openai-prepare-filtered',
        modelId: 'text-embedding-3-large',
        candidateModelIds: ['text-embedding-3-large'],
        matched: true,
        reasons: ['profile_model_matched', 'capability_matched'],
      },
    ];
    const embeddingPrepareCandidates = [
      {
        candidateKey: embeddingMainCandidateKey,
        registryKind: 'byok',
        registryAvailable: true,
        registrySelected: true,
        providerId: 'ollama-main',
        requestedModelId: 'workspace-embedding',
        modelId: 'workspace-embedding',
        candidateModelIds: ['workspace-embedding', 'local-embedding'],
        prepared: true,
        preparedModelId: 'nomic-embed-text',
        errorCode: null,
        reasons: [
          'prepared_route_available',
          'provider_prepare_succeeded',
          'prepared_model_resolved',
        ],
      },
      {
        candidateKey: embeddingOpenAICandidateKey,
        registryKind: 'quota_backed',
        registryAvailable: true,
        registrySelected: false,
        providerId: 'openai-default',
        modelId: 'text-embedding-3-small',
        candidateModelIds: ['text-embedding-3-small'],
        prepared: true,
        preparedModelId: 'text-embedding-3-small',
        errorCode: null,
        reasons: ['prepared_route_available', 'provider_prepare_succeeded'],
      },
      {
        candidateKey: embeddingFilteredCandidateKey,
        registryKind: 'quota_backed',
        registryAvailable: true,
        registrySelected: false,
        providerId: 'openai-prepare-filtered',
        modelId: 'text-embedding-3-large',
        candidateModelIds: ['text-embedding-3-large'],
        prepared: false,
        preparedModelId: null,
        errorCode: null,
        reasons: [
          'prepared_route_not_selected',
          'provider_prepare_returned_empty',
        ],
      },
    ];
    const rerankRouteTrace = [
      {
        phase: 'policy',
        candidateCount: 2,
        availableCount: 1,
        selectedCount: 1,
        blockedCount: 1,
        reasons: [
          'candidate_allowed',
          'privacy_preferred',
          'provider_unavailable',
          'provider_blocked',
          'privacy_not_allowed',
        ],
      },
      {
        phase: 'resolution',
        candidateCount: 2,
        availableCount: 1,
        selectedCount: 1,
        matchedCount: 1,
        reasons: ['capability_matched', 'profile_model_not_allowed'],
      },
      {
        phase: 'prepared',
        candidateCount: 1,
        selectedCount: 1,
        preparedCount: 1,
        reasons: ['provider_prepare_succeeded'],
      },
    ];
    const rerankPrepareCandidates = [
      {
        candidateKey: rerankMainCandidateKey,
        registryKind: 'byok',
        registryAvailable: true,
        registrySelected: true,
        providerId: 'ollama-main',
        requestedModelId: 'office-rerank',
        modelId: 'office-rerank',
        candidateModelIds: ['office-rerank'],
        prepared: true,
        preparedModelId: 'bge-reranker-v2',
        errorCode: null,
        reasons: [
          'prepared_route_available',
          'provider_prepare_succeeded',
          'prepared_model_resolved',
        ],
      },
    ];
    const models = buildAIModels({
      defaultModel: 'ollama-main/office-chat-fast',
      defaultModelFallbackReason: 'prompt_default_unavailable',
      defaultModelSource: 'fallback_route',
      promptDefaultModel: 'gemini-2.5-flash',
      embeddingRoute: {
        configured: true,
        diagnosticsErrors: [
          {
            code: 'EmbeddingPrepareDiagnosticsFailure',
            message: 'embedding prepare diagnostics unavailable',
            stage: 'describe_embedding_prepare_candidates',
          },
        ],
        featureKind: 'workspace_indexing',
        providerId: 'ollama-main',
        providerProfileId: 'ollama-main',
        providerProfileSource: 'byok_local',
        providerProfileConfigPath: 'workspace.byok.local',
        providerConfiguredModelIds: ['workspace-embedding', 'nomic-embed-text'],
        providerConfiguredModelCount: 2,
        modelId: 'nomic-embed-text',
        preparedProviderCount: 2,
        protocol: 'openai_chat',
        requestLayer: 'chat_completions',
        modelBackendKind: 'openai_chat',
        canonicalModelKey: 'workspace-embedding',
        behaviorFlags: ['disable_batch_embeddings'],
        policyEnabled: true,
        policyFeatureKind: 'workspace_indexing',
        policyWorkspaceId: 'workspace-local-only',
        policyAllowedProviderIds: ['ollama-main', 'openai-default'],
        policyBlockedProviderIds: ['blocked-cloud'],
        policyAllowedPrivacy: ['local', 'private_cloud'],
        policyPreferredPrivacy: ['local', 'private_cloud'],
        preparedRoutes: [
          {
            providerId: 'ollama-main',
            providerProfileId: 'ollama-main',
            providerProfileSource: 'byok_local',
            providerProfileConfigPath: 'workspace.byok.local',
            providerConfiguredModelIds: [
              'workspace-embedding',
              'nomic-embed-text',
            ],
            providerConfiguredModelCount: 2,
            providerSource: 'byok_local',
            providerType: 'openaiCompatible',
            providerPriority: 10,
            modelId: 'nomic-embed-text',
            protocol: 'openai_chat',
            requestLayer: 'chat_completions',
            modelBackendKind: 'openai_chat',
            canonicalModelKey: 'workspace-embedding',
            behaviorFlags: ['disable_batch_embeddings'],
            requestedDimensions: 1024,
            modelEmbeddingDimensions: 768,
            dimensionMismatch: true,
          },
          {
            providerId: 'openai-default',
            providerProfileId: 'openai-default',
            providerProfileSource: 'configured',
            providerProfileConfigPath:
              'copilot.providers.profiles[id=openai-default]',
            providerConfiguredModelIds: ['text-embedding-3-small'],
            providerConfiguredModelCount: 1,
            providerSource: 'configured',
            providerType: 'openai',
            providerPriority: 1,
            modelId: 'text-embedding-3-small',
            protocol: 'openai_responses',
            requestLayer: 'responses',
            modelBackendKind: 'openai_responses',
            canonicalModelKey: 'workspace-embedding-fallback',
            behaviorFlags: ['embedding_fallback'],
            requestedDimensions: 1024,
            modelEmbeddingDimensions: 1024,
            dimensionMismatch: false,
          },
        ],
        routeCandidates: embeddingRouteCandidates,
        routeTrace: embeddingRouteTrace,
        prepareCandidates: embeddingPrepareCandidates,
        requestedModelId: 'ollama-main/workspace-embedding',
        fallbackProviderIds: ['ollama-main', 'openai-default'],
        requestedDimensions: 1024,
        modelEmbeddingDimensions: 1024,
        dimensionMismatch: false,
        errorCode: null,
        errorMessage: null,
        candidateCount: null,
        topK: null,
      },
      optionalModels: [
        {
          id: 'ollama-main/office-chat-fast',
          name: 'Local Qwen 3 32B',
          promptName: 'Chat With AFFiNE AI',
          promptAction: null,
          promptSource: 'built_in',
          promptCategory: 'text',
          promptDefaultPolicy: 'text',
          promptModelConfigPath: 'copilot.prompts.overrides[].optionalModels',
          promptModelSource: 'override',
          promptModelSources: [
            {
              candidateSource: 'fallback_route',
            },
            {
              candidateSource: 'prompt',
              modelConfigPath: 'copilot.prompts.overrides[].optionalModels',
              modelSource: 'override',
            },
            {
              candidateSource: 'registry',
            },
          ],
          promptOverrideApplied: false,
          providerId: 'ollama-main',
          providerName: 'Local Ollama',
          routeModelId: 'qwen3:32b',
          routeFallbackProviderIds: ['ollama-main', 'openai-default'],
          providerSource: 'byok_local',
          providerProfileId: 'ollama-main',
          providerProfileSource: 'byok_local',
          providerProfileConfigPath: 'workspace.byok.local',
          providerConfiguredModelIds: [
            'office-chat-fast',
            'office-chat',
            'qwen-office',
          ],
          providerConfiguredModelCount: 3,
          providerType: 'openaiCompatible',
          providerPrivacy: 'local',
          providerHealth: 'healthy',
          providerHealthCheckedAt: '2026-06-15T10:00:00.000Z',
          providerHealthLastError: 'previous timeout',
          providerPriority: 10,
          routeBackendKind: 'openai_chat',
          routeCanonicalModelKey: 'office-chat-fast',
          routeRawModelId: 'qwen3:32b',
          routeModelDefinitionSource: 'provider_profile',
          routeModelDefinitionId: 'office-chat-fast',
          routeModelDefinitionAliases: ['office-chat', 'qwen-office'],
          routeModelAliasMatched: true,
          routeProtocol: 'openai_chat',
          routeRequestLayer: 'chat_completions',
          routeBehaviorFlags: ['disable_parallel_tool_calls'],
          routeInputTypes: ['text', 'image'],
          routeOutputTypes: ['text', 'structured'],
          routeAttachmentKinds: ['file'],
          routeAttachmentSourceKinds: ['url', 'data'],
          routeAttachmentAllowRemoteUrls: false,
          routeStructuredAttachmentKinds: ['image'],
          routeStructuredAttachmentSourceKinds: ['file_handle'],
          routeStructuredAttachmentAllowRemoteUrls: true,
          contextWindow: 32768,
          maxOutputTokens: 4096,
          embeddingDimensions: null,
          costInputPer1M: 0.2,
          costOutputPer1M: 0.8,
          sources: ['fallback_route', 'prompt', 'registry'],
          routePolicyEnabled: true,
          routePolicyFeatureKind: 'chat',
          routePolicyWorkspaceId: null,
          routePolicyAllowedProviderIds: null,
          routePolicyBlockedProviderIds: null,
          routePolicyAllowedPrivacy: ['local', 'private_cloud'],
          routePolicyPreferredPrivacy: ['local', 'private_cloud', 'cloud'],
        },
        {
          id: 'openai-default/gpt-5',
          name: 'OpenAI GPT-5',
          promptName: 'Chat With AFFiNE AI',
          promptAction: null,
          promptSource: 'built_in',
          promptCategory: 'text',
          promptDefaultPolicy: 'text',
          promptModelConfigPath: null,
          promptModelSource: null,
          promptModelSources: [
            {
              candidateSource: 'registry',
            },
          ],
          promptOverrideApplied: false,
          providerId: 'openai-default',
          providerName: null,
          routeModelId: 'gpt-5',
          routeFallbackProviderIds: null,
          providerSource: null,
          providerType: 'openai',
          providerPrivacy: 'cloud',
          providerHealth: 'unknown',
          providerHealthCheckedAt: null,
          providerHealthLastError: null,
          providerPriority: 1,
          routeBackendKind: null,
          routeCanonicalModelKey: null,
          routeProtocol: null,
          routeRequestLayer: null,
          routeBehaviorFlags: null,
          routeInputTypes: null,
          routeOutputTypes: null,
          contextWindow: 128000,
          maxOutputTokens: 8192,
          embeddingDimensions: null,
          costInputPer1M: null,
          costOutputPer1M: null,
          sources: ['registry'],
          routePolicyEnabled: true,
          routePolicyFeatureKind: 'chat',
          routePolicyWorkspaceId: null,
          routePolicyAllowedProviderIds: null,
          routePolicyBlockedProviderIds: null,
          routePolicyAllowedPrivacy: ['local', 'private_cloud'],
          routePolicyPreferredPrivacy: ['local', 'private_cloud', 'cloud'],
        },
      ],
      proModels: [
        {
          id: 'openai-default/gpt-5',
          name: 'OpenAI GPT-5',
          promptName: 'Chat With AFFiNE AI',
          promptAction: null,
          promptSource: 'built_in',
          promptCategory: 'text',
          promptDefaultPolicy: 'text',
          promptModelConfigPath: 'copilot.prompts.overrides[].config.proModels',
          promptModelSource: 'override',
          promptModelSources: [
            {
              candidateSource: 'pro',
              modelConfigPath: 'copilot.prompts.overrides[].config.proModels',
              modelSource: 'override',
            },
          ],
          promptOverrideApplied: false,
          providerId: 'openai-default',
          providerName: null,
          routeModelId: 'gpt-5',
          routeFallbackProviderIds: null,
          providerSource: null,
          providerType: 'openai',
          providerPrivacy: 'cloud',
          providerHealth: 'unknown',
          providerHealthCheckedAt: null,
          providerHealthLastError: null,
          providerPriority: 1,
          routeBackendKind: null,
          routeCanonicalModelKey: null,
          routeProtocol: null,
          routeRequestLayer: null,
          routeBehaviorFlags: null,
          routeInputTypes: null,
          routeOutputTypes: null,
          contextWindow: 128000,
          maxOutputTokens: 8192,
          embeddingDimensions: null,
          costInputPer1M: null,
          costOutputPer1M: null,
          sources: ['pro'],
          routePolicyEnabled: true,
          routePolicyFeatureKind: 'chat',
          routePolicyWorkspaceId: null,
          routePolicyAllowedProviderIds: null,
          routePolicyBlockedProviderIds: null,
          routePolicyAllowedPrivacy: ['local', 'private_cloud'],
          routePolicyPreferredPrivacy: ['local', 'private_cloud', 'cloud'],
        },
      ],
      rerankRoute: {
        configured: true,
        diagnosticsErrors: [],
        featureKind: 'rerank',
        providerId: 'ollama-main',
        providerProfileId: 'ollama-main',
        providerProfileSource: 'byok_local',
        providerProfileConfigPath: 'workspace.byok.local',
        providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
        providerConfiguredModelCount: 2,
        modelId: 'bge-reranker-v2',
        preparedProviderCount: 1,
        protocol: 'openai_chat',
        requestLayer: 'chat_completions',
        modelBackendKind: 'openai_chat',
        canonicalModelKey: 'office-rerank',
        behaviorFlags: ['rerank_cross_encoder'],
        policyEnabled: true,
        policyFeatureKind: 'rerank',
        policyWorkspaceId: 'workspace-local-only',
        policyAllowedProviderIds: ['ollama-main'],
        policyBlockedProviderIds: ['blocked-cloud'],
        policyAllowedPrivacy: ['local'],
        policyPreferredPrivacy: ['local'],
        preparedRoutes: [
          {
            providerId: 'ollama-main',
            providerProfileId: 'ollama-main',
            providerProfileSource: 'byok_local',
            providerProfileConfigPath: 'workspace.byok.local',
            providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
            providerConfiguredModelCount: 2,
            providerSource: 'byok_local',
            providerType: 'openaiCompatible',
            providerPriority: 10,
            modelId: 'bge-reranker-v2',
            protocol: 'openai_chat',
            requestLayer: 'chat_completions',
            modelBackendKind: 'openai_chat',
            canonicalModelKey: 'office-rerank',
            behaviorFlags: ['rerank_cross_encoder'],
          },
        ],
        routeTrace: rerankRouteTrace,
        prepareCandidates: rerankPrepareCandidates,
        requestedModelId: 'ollama-main/office-rerank',
        fallbackProviderIds: ['ollama-main'],
        requestedDimensions: null,
        modelEmbeddingDimensions: null,
        dimensionMismatch: null,
        errorCode: null,
        errorMessage: null,
        candidateCount: 1,
        topK: null,
      },
    });

    expect(models).toEqual([
      {
        id: 'ollama-main/office-chat-fast',
        name: 'Local Qwen 3 32B',
        category: 'Local',
        version: 'Qwen 3 32B',
        defaultModelFallbackReason: 'prompt_default_unavailable',
        defaultModelSource: 'fallback_route',
        promptName: 'Chat With AFFiNE AI',
        promptAction: null,
        promptSource: 'built_in',
        promptCategory: 'text',
        promptDefaultModel: 'gemini-2.5-flash',
        promptDefaultPolicy: 'text',
        promptModelConfigPath: 'copilot.prompts.overrides[].optionalModels',
        promptModelSource: 'override',
        promptModelSources: [
          {
            candidateSource: 'fallback_route',
          },
          {
            candidateSource: 'prompt',
            modelConfigPath: 'copilot.prompts.overrides[].optionalModels',
            modelSource: 'override',
          },
          {
            candidateSource: 'registry',
          },
        ],
        promptOverrideApplied: false,
        providerId: 'ollama-main',
        providerName: 'Local Ollama',
        routeModelId: 'qwen3:32b',
        routeFallbackProviderIds: ['ollama-main', 'openai-default'],
        providerSource: 'byok_local',
        providerProfileId: 'ollama-main',
        providerProfileSource: 'byok_local',
        providerProfileConfigPath: 'workspace.byok.local',
        providerConfiguredModelIds: [
          'office-chat-fast',
          'office-chat',
          'qwen-office',
        ],
        providerConfiguredModelCount: 3,
        providerType: 'openaiCompatible',
        providerPrivacy: 'local',
        providerHealth: 'healthy',
        providerHealthCheckedAt: '2026-06-15T10:00:00.000Z',
        providerHealthLastError: 'previous timeout',
        providerPriority: 10,
        routeBackendKind: 'openai_chat',
        routeCanonicalModelKey: 'office-chat-fast',
        routeRawModelId: 'qwen3:32b',
        routeModelDefinitionSource: 'provider_profile',
        routeModelDefinitionId: 'office-chat-fast',
        routeModelDefinitionAliases: ['office-chat', 'qwen-office'],
        routeModelAliasMatched: true,
        routeProtocol: 'openai_chat',
        routeRequestLayer: 'chat_completions',
        routeBehaviorFlags: ['disable_parallel_tool_calls'],
        routeInputTypes: ['text', 'image'],
        routeOutputTypes: ['text', 'structured'],
        routeAttachmentKinds: ['file'],
        routeAttachmentSourceKinds: ['url', 'data'],
        routeAttachmentAllowRemoteUrls: false,
        routeStructuredAttachmentKinds: ['image'],
        routeStructuredAttachmentSourceKinds: ['file_handle'],
        routeStructuredAttachmentAllowRemoteUrls: true,
        contextWindow: 32768,
        maxOutputTokens: 4096,
        embeddingDimensions: null,
        costInputPer1M: 0.2,
        costOutputPer1M: 0.8,
        sources: ['fallback_route', 'prompt', 'registry'],
        routePolicyEnabled: true,
        routePolicyFeatureKind: 'chat',
        routePolicyWorkspaceId: null,
        routePolicyAllowedProviderIds: null,
        routePolicyBlockedProviderIds: null,
        routePolicyAllowedPrivacy: ['local', 'private_cloud'],
        routePolicyPreferredPrivacy: ['local', 'private_cloud', 'cloud'],
        embeddingRoute: {
          configured: true,
          diagnosticsErrors: [
            {
              code: 'EmbeddingPrepareDiagnosticsFailure',
              message: 'embedding prepare diagnostics unavailable',
              stage: 'describe_embedding_prepare_candidates',
            },
          ],
          featureKind: 'workspace_indexing',
          providerId: 'ollama-main',
          providerProfileId: 'ollama-main',
          providerProfileSource: 'byok_local',
          providerProfileConfigPath: 'workspace.byok.local',
          providerConfiguredModelIds: [
            'workspace-embedding',
            'nomic-embed-text',
          ],
          providerConfiguredModelCount: 2,
          modelId: 'nomic-embed-text',
          preparedProviderCount: 2,
          protocol: 'openai_chat',
          requestLayer: 'chat_completions',
          modelBackendKind: 'openai_chat',
          canonicalModelKey: 'workspace-embedding',
          behaviorFlags: ['disable_batch_embeddings'],
          policyEnabled: true,
          policyFeatureKind: 'workspace_indexing',
          policyWorkspaceId: 'workspace-local-only',
          policyAllowedProviderIds: ['ollama-main', 'openai-default'],
          policyBlockedProviderIds: ['blocked-cloud'],
          policyAllowedPrivacy: ['local', 'private_cloud'],
          policyPreferredPrivacy: ['local', 'private_cloud'],
          preparedRoutes: [
            {
              providerId: 'ollama-main',
              providerProfileId: 'ollama-main',
              providerProfileSource: 'byok_local',
              providerProfileConfigPath: 'workspace.byok.local',
              providerConfiguredModelIds: [
                'workspace-embedding',
                'nomic-embed-text',
              ],
              providerConfiguredModelCount: 2,
              providerSource: 'byok_local',
              providerType: 'openaiCompatible',
              providerPriority: 10,
              modelId: 'nomic-embed-text',
              protocol: 'openai_chat',
              requestLayer: 'chat_completions',
              modelBackendKind: 'openai_chat',
              canonicalModelKey: 'workspace-embedding',
              behaviorFlags: ['disable_batch_embeddings'],
              requestedDimensions: 1024,
              modelEmbeddingDimensions: 768,
              dimensionMismatch: true,
            },
            {
              providerId: 'openai-default',
              providerProfileId: 'openai-default',
              providerProfileSource: 'configured',
              providerProfileConfigPath:
                'copilot.providers.profiles[id=openai-default]',
              providerConfiguredModelIds: ['text-embedding-3-small'],
              providerConfiguredModelCount: 1,
              providerSource: 'configured',
              providerType: 'openai',
              providerPriority: 1,
              modelId: 'text-embedding-3-small',
              protocol: 'openai_responses',
              requestLayer: 'responses',
              modelBackendKind: 'openai_responses',
              canonicalModelKey: 'workspace-embedding-fallback',
              behaviorFlags: ['embedding_fallback'],
              requestedDimensions: 1024,
              modelEmbeddingDimensions: 1024,
              dimensionMismatch: false,
            },
          ],
          routeCandidates: embeddingRouteCandidates,
          routeTrace: embeddingRouteTrace,
          prepareCandidates: embeddingPrepareCandidates,
          requestedModelId: 'ollama-main/workspace-embedding',
          fallbackProviderIds: ['ollama-main', 'openai-default'],
          requestedDimensions: 1024,
          modelEmbeddingDimensions: 1024,
          dimensionMismatch: false,
          errorCode: null,
          errorMessage: null,
          candidateCount: null,
          topK: null,
        },
        rerankRoute: {
          configured: true,
          diagnosticsErrors: [],
          featureKind: 'rerank',
          providerId: 'ollama-main',
          providerProfileId: 'ollama-main',
          providerProfileSource: 'byok_local',
          providerProfileConfigPath: 'workspace.byok.local',
          providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
          providerConfiguredModelCount: 2,
          modelId: 'bge-reranker-v2',
          preparedProviderCount: 1,
          protocol: 'openai_chat',
          requestLayer: 'chat_completions',
          modelBackendKind: 'openai_chat',
          canonicalModelKey: 'office-rerank',
          behaviorFlags: ['rerank_cross_encoder'],
          policyEnabled: true,
          policyFeatureKind: 'rerank',
          policyWorkspaceId: 'workspace-local-only',
          policyAllowedProviderIds: ['ollama-main'],
          policyBlockedProviderIds: ['blocked-cloud'],
          policyAllowedPrivacy: ['local'],
          policyPreferredPrivacy: ['local'],
          preparedRoutes: [
            {
              providerId: 'ollama-main',
              providerProfileId: 'ollama-main',
              providerProfileSource: 'byok_local',
              providerProfileConfigPath: 'workspace.byok.local',
              providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
              providerConfiguredModelCount: 2,
              providerSource: 'byok_local',
              providerType: 'openaiCompatible',
              providerPriority: 10,
              modelId: 'bge-reranker-v2',
              protocol: 'openai_chat',
              requestLayer: 'chat_completions',
              modelBackendKind: 'openai_chat',
              canonicalModelKey: 'office-rerank',
              behaviorFlags: ['rerank_cross_encoder'],
            },
          ],
          routeTrace: rerankRouteTrace,
          prepareCandidates: rerankPrepareCandidates,
          requestedModelId: 'ollama-main/office-rerank',
          fallbackProviderIds: ['ollama-main'],
          requestedDimensions: null,
          modelEmbeddingDimensions: null,
          dimensionMismatch: null,
          errorCode: null,
          errorMessage: null,
          candidateCount: 1,
          topK: null,
        },
        isDefault: true,
        isPro: false,
      },
      {
        id: 'openai-default/gpt-5',
        name: 'OpenAI GPT-5',
        category: 'OpenAI',
        version: 'GPT-5',
        defaultModelFallbackReason: 'prompt_default_unavailable',
        defaultModelSource: 'fallback_route',
        promptName: 'Chat With AFFiNE AI',
        promptAction: null,
        promptSource: 'built_in',
        promptCategory: 'text',
        promptDefaultModel: 'gemini-2.5-flash',
        promptDefaultPolicy: 'text',
        promptModelConfigPath: null,
        promptModelSource: null,
        promptModelSources: [
          {
            candidateSource: 'registry',
          },
        ],
        promptOverrideApplied: false,
        providerId: 'openai-default',
        providerName: null,
        routeModelId: 'gpt-5',
        routeFallbackProviderIds: null,
        providerSource: null,
        providerType: 'openai',
        providerPrivacy: 'cloud',
        providerHealth: 'unknown',
        providerHealthCheckedAt: null,
        providerHealthLastError: null,
        providerPriority: 1,
        routeBackendKind: null,
        routeCanonicalModelKey: null,
        routeProtocol: null,
        routeRequestLayer: null,
        routeBehaviorFlags: null,
        routeInputTypes: null,
        routeOutputTypes: null,
        contextWindow: 128000,
        maxOutputTokens: 8192,
        embeddingDimensions: null,
        costInputPer1M: null,
        costOutputPer1M: null,
        sources: ['registry'],
        routePolicyEnabled: true,
        routePolicyFeatureKind: 'chat',
        routePolicyWorkspaceId: null,
        routePolicyAllowedProviderIds: null,
        routePolicyBlockedProviderIds: null,
        routePolicyAllowedPrivacy: ['local', 'private_cloud'],
        routePolicyPreferredPrivacy: ['local', 'private_cloud', 'cloud'],
        embeddingRoute: {
          configured: true,
          diagnosticsErrors: [
            {
              code: 'EmbeddingPrepareDiagnosticsFailure',
              message: 'embedding prepare diagnostics unavailable',
              stage: 'describe_embedding_prepare_candidates',
            },
          ],
          featureKind: 'workspace_indexing',
          providerId: 'ollama-main',
          providerProfileId: 'ollama-main',
          providerProfileSource: 'byok_local',
          providerProfileConfigPath: 'workspace.byok.local',
          providerConfiguredModelIds: [
            'workspace-embedding',
            'nomic-embed-text',
          ],
          providerConfiguredModelCount: 2,
          modelId: 'nomic-embed-text',
          preparedProviderCount: 2,
          protocol: 'openai_chat',
          requestLayer: 'chat_completions',
          modelBackendKind: 'openai_chat',
          canonicalModelKey: 'workspace-embedding',
          behaviorFlags: ['disable_batch_embeddings'],
          policyEnabled: true,
          policyFeatureKind: 'workspace_indexing',
          policyWorkspaceId: 'workspace-local-only',
          policyAllowedProviderIds: ['ollama-main', 'openai-default'],
          policyBlockedProviderIds: ['blocked-cloud'],
          policyAllowedPrivacy: ['local', 'private_cloud'],
          policyPreferredPrivacy: ['local', 'private_cloud'],
          preparedRoutes: [
            {
              providerId: 'ollama-main',
              providerProfileId: 'ollama-main',
              providerProfileSource: 'byok_local',
              providerProfileConfigPath: 'workspace.byok.local',
              providerConfiguredModelIds: [
                'workspace-embedding',
                'nomic-embed-text',
              ],
              providerConfiguredModelCount: 2,
              providerSource: 'byok_local',
              providerType: 'openaiCompatible',
              providerPriority: 10,
              modelId: 'nomic-embed-text',
              protocol: 'openai_chat',
              requestLayer: 'chat_completions',
              modelBackendKind: 'openai_chat',
              canonicalModelKey: 'workspace-embedding',
              behaviorFlags: ['disable_batch_embeddings'],
              requestedDimensions: 1024,
              modelEmbeddingDimensions: 768,
              dimensionMismatch: true,
            },
            {
              providerId: 'openai-default',
              providerProfileId: 'openai-default',
              providerProfileSource: 'configured',
              providerProfileConfigPath:
                'copilot.providers.profiles[id=openai-default]',
              providerConfiguredModelIds: ['text-embedding-3-small'],
              providerConfiguredModelCount: 1,
              providerSource: 'configured',
              providerType: 'openai',
              providerPriority: 1,
              modelId: 'text-embedding-3-small',
              protocol: 'openai_responses',
              requestLayer: 'responses',
              modelBackendKind: 'openai_responses',
              canonicalModelKey: 'workspace-embedding-fallback',
              behaviorFlags: ['embedding_fallback'],
              requestedDimensions: 1024,
              modelEmbeddingDimensions: 1024,
              dimensionMismatch: false,
            },
          ],
          routeCandidates: embeddingRouteCandidates,
          routeTrace: embeddingRouteTrace,
          prepareCandidates: embeddingPrepareCandidates,
          requestedModelId: 'ollama-main/workspace-embedding',
          fallbackProviderIds: ['ollama-main', 'openai-default'],
          requestedDimensions: 1024,
          modelEmbeddingDimensions: 1024,
          dimensionMismatch: false,
          errorCode: null,
          errorMessage: null,
          candidateCount: null,
          topK: null,
        },
        rerankRoute: {
          configured: true,
          diagnosticsErrors: [],
          featureKind: 'rerank',
          providerId: 'ollama-main',
          providerProfileId: 'ollama-main',
          providerProfileSource: 'byok_local',
          providerProfileConfigPath: 'workspace.byok.local',
          providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
          providerConfiguredModelCount: 2,
          modelId: 'bge-reranker-v2',
          preparedProviderCount: 1,
          protocol: 'openai_chat',
          requestLayer: 'chat_completions',
          modelBackendKind: 'openai_chat',
          canonicalModelKey: 'office-rerank',
          behaviorFlags: ['rerank_cross_encoder'],
          policyEnabled: true,
          policyFeatureKind: 'rerank',
          policyWorkspaceId: 'workspace-local-only',
          policyAllowedProviderIds: ['ollama-main'],
          policyBlockedProviderIds: ['blocked-cloud'],
          policyAllowedPrivacy: ['local'],
          policyPreferredPrivacy: ['local'],
          preparedRoutes: [
            {
              providerId: 'ollama-main',
              providerProfileId: 'ollama-main',
              providerProfileSource: 'byok_local',
              providerProfileConfigPath: 'workspace.byok.local',
              providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
              providerConfiguredModelCount: 2,
              providerSource: 'byok_local',
              providerType: 'openaiCompatible',
              providerPriority: 10,
              modelId: 'bge-reranker-v2',
              protocol: 'openai_chat',
              requestLayer: 'chat_completions',
              modelBackendKind: 'openai_chat',
              canonicalModelKey: 'office-rerank',
              behaviorFlags: ['rerank_cross_encoder'],
            },
          ],
          routeTrace: rerankRouteTrace,
          prepareCandidates: rerankPrepareCandidates,
          requestedModelId: 'ollama-main/office-rerank',
          fallbackProviderIds: ['ollama-main'],
          requestedDimensions: null,
          modelEmbeddingDimensions: null,
          dimensionMismatch: null,
          errorCode: null,
          errorMessage: null,
          candidateCount: 1,
          topK: null,
        },
        isDefault: false,
        isPro: true,
      },
    ]);
  });

  test('requests reset when a persisted AI model is no longer available', () => {
    const models = [
      { id: 'ollama-main/office-chat-fast' },
      { id: 'openai-default/gpt-5-mini' },
    ];

    expect(
      shouldResetUnavailableAIModel('gemini-2.5-flash', models)
    ).toBeTruthy();
    expect(
      shouldResetUnavailableAIModel('ollama-main/office-chat-fast', models)
    ).toBeFalsy();
    expect(shouldResetUnavailableAIModel(undefined, models)).toBeFalsy();
  });

  test('sorts model selection by default route, health, privacy, and capacity', () => {
    const models = sortAIModelsForSelection([
      {
        id: 'openai-default/gpt-5-mini',
        name: 'OpenAI GPT-5 Mini',
        category: 'OpenAI',
        version: 'GPT-5 Mini',
        providerPrivacy: 'cloud',
        providerHealth: 'healthy',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        sources: ['registry'],
        isDefault: false,
        isPro: false,
      },
      {
        id: 'local-small/office-chat-fast',
        name: 'Local Small',
        category: 'Local',
        version: 'Small',
        providerPrivacy: 'local',
        providerHealth: 'healthy',
        contextWindow: 32768,
        maxOutputTokens: 4096,
        sources: ['prompt'],
        isDefault: false,
        isPro: false,
      },
      {
        id: 'local-default/office-chat',
        name: 'Local Default',
        category: 'Local',
        version: 'Default',
        providerPrivacy: 'local',
        providerHealth: 'degraded',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        sources: ['default'],
        isDefault: true,
        isPro: false,
      },
      {
        id: 'private-cloud/office-chat',
        name: 'Private Cloud',
        category: 'Private',
        version: 'Cloud',
        providerPrivacy: 'private_cloud',
        providerHealth: 'healthy',
        contextWindow: 65536,
        maxOutputTokens: 4096,
        sources: ['registry'],
        isDefault: false,
        isPro: false,
      },
      {
        id: 'local-large/office-chat',
        name: 'Local Large',
        category: 'Local',
        version: 'Large',
        providerPrivacy: 'local',
        providerHealth: 'healthy',
        contextWindow: 65536,
        maxOutputTokens: 4096,
        sources: ['prompt'],
        isDefault: false,
        isPro: false,
      },
      {
        id: 'cloud-unknown/office-chat',
        name: 'Cloud Unknown',
        category: 'Cloud',
        version: 'Unknown',
        providerPrivacy: 'cloud',
        providerHealth: 'unknown',
        contextWindow: 200000,
        maxOutputTokens: 12000,
        sources: ['registry'],
        isDefault: false,
        isPro: false,
      },
    ]);

    expect(models.map(model => model.id)).toEqual([
      'local-default/office-chat',
      'local-large/office-chat',
      'local-small/office-chat-fast',
      'private-cloud/office-chat',
      'openai-default/gpt-5-mini',
      'cloud-unknown/office-chat',
    ]);
  });

  test('formats provider observability labels for the model menu', () => {
    expect(
      formatAIModelProviderLabel({
        providerId: 'ollama-main',
        providerName: 'Local Ollama',
        providerType: 'openaiCompatible',
        providerSource: 'byok_local',
        providerPrivacy: 'local',
        providerHealth: 'healthy',
      })
    ).toBe('Local Ollama (ollama-main) / BYOK local / Local / Healthy');
    expect(
      formatAIModelProviderLabel({
        providerId: null,
        providerType: 'openai',
        providerSource: 'legacy',
        providerPrivacy: 'private_cloud',
        providerHealth: 'degraded',
      })
    ).toBe('openai / Legacy config / Private cloud / Degraded');
    expect(formatAIModelProviderLabel({})).toBe('');
  });

  test('formats provider health details for diagnostics', () => {
    expect(
      formatAIModelHealthDetailLabel({
        providerHealthCheckedAt: '2026-06-15T10:00:00.000Z',
        providerHealthLastError: 'previous timeout',
      })
    ).toBe('Checked 2026-06-15T10:00:00.000Z / Last error previous timeout');
    expect(
      formatAIModelHealthDetailLabel({
        providerHealthCheckedAt: null,
        providerHealthLastError: null,
      })
    ).toBe('');
  });

  test('formats model source labels for route explanation', () => {
    expect(
      formatAIModelSourcesLabel({
        sources: ['default', 'prompt', 'registry'],
        isDefault: true,
        isPro: false,
      })
    ).toBe('Default / Prompt / Registry');
    expect(
      formatAIModelSourcesLabel({
        sources: ['registry'],
        isDefault: false,
        isPro: true,
      })
    ).toBe('Registry / Pro');
    expect(
      formatAIModelSourcesLabel({
        sources: [],
        isDefault: true,
        isPro: false,
      })
    ).toBe('Default');
    expect(
      formatAIModelSourcesLabel({
        sources: ['fallback_route', 'registry'],
        isDefault: true,
        isPro: false,
      })
    ).toBe('Fallback Route / Registry');
  });

  test('formats resolved route labels for the model menu', () => {
    expect(
      formatAIModelRouteLabel({
        providerId: 'ollama-main',
        routeModelId: 'qwen3:32b',
      })
    ).toBe('Route ollama-main/qwen3:32b');
    expect(
      formatAIModelRouteLabel({
        providerId: null,
        routeModelId: 'gpt-5',
      })
    ).toBe('Route gpt-5');
    expect(formatAIModelRouteLabel({})).toBe('');
  });

  test('formats fallback provider chains for diagnostics', () => {
    expect(
      formatAIModelFallbackLabel({
        routeFallbackProviderIds: ['ollama-main', 'openai-default'],
      })
    ).toBe('ollama-main -> openai-default');
    expect(
      formatAIModelFallbackLabel({
        routeFallbackProviderIds: null,
      })
    ).toBe('');
  });

  test('formats resolved model definition labels for diagnostics', () => {
    expect(
      formatAIModelDefinitionLabel({
        routeBackendKind: 'openai_responses',
        routeCanonicalModelKey: 'office-chat-strong',
        routeRawModelId: 'gpt-5.1',
        routeModelDefinitionSource: 'provider_profile',
        routeModelDefinitionId: 'office-chat-strong',
        routeModelDefinitionAliases: ['office-strong', 'chat-strong'],
        routeModelAliasMatched: true,
        routeProtocol: 'openai_responses',
        routeRequestLayer: 'responses',
        routeBehaviorFlags: ['reasoning', 'json_schema'],
      })
    ).toBe(
      'Provider profile / Definition office-chat-strong / Raw gpt-5.1 / Aliases office-strong, chat-strong / Alias matched / openai_responses / Canonical office-chat-strong / Protocol openai_responses / Layer responses / Flags reasoning, json_schema'
    );
    expect(
      formatAIModelDefinitionLabel({
        routeBackendKind: null,
        routeCanonicalModelKey: null,
        routeRawModelId: null,
        routeModelDefinitionSource: null,
        routeModelDefinitionId: null,
        routeModelDefinitionAliases: null,
        routeModelAliasMatched: null,
        routeProtocol: null,
        routeRequestLayer: null,
        routeBehaviorFlags: null,
      })
    ).toBe('');
  });

  test('formats provider profile registry labels for diagnostics', () => {
    expect(
      formatAIModelProviderProfileLabel({
        providerProfileId: 'ollama-main',
        providerProfileSource: 'byok_local',
        providerProfileConfigPath: 'workspace.byok.local',
        providerConfiguredModelCount: 2,
        providerConfiguredModelIds: ['office-chat-fast', 'office-chat'],
      })
    ).toBe(
      'Profile ollama-main / BYOK local / config workspace.byok.local / 2 configured models / models office-chat-fast, office-chat'
    );
    expect(
      formatAIModelProviderProfileLabel({
        providerProfileId: null,
        providerProfileSource: null,
        providerProfileConfigPath: null,
        providerConfiguredModelCount: null,
        providerConfiguredModelIds: null,
      })
    ).toBe('');
  });

  test('formats resolved model capability labels for diagnostics', () => {
    expect(
      formatAIModelCapabilityLabel({
        routeInputTypes: ['text', 'image'],
        routeOutputTypes: ['text', 'structured'],
        routeAttachmentKinds: ['file'],
        routeAttachmentSourceKinds: ['url', 'data'],
        routeAttachmentAllowRemoteUrls: false,
        routeStructuredAttachmentKinds: ['image'],
        routeStructuredAttachmentSourceKinds: ['file_handle'],
        routeStructuredAttachmentAllowRemoteUrls: true,
      })
    ).toBe(
      'Input text, image / Output text, structured / Attachments file / Attachment sources url, data / Remote attachments no / Structured attachments image / Structured attachment sources file_handle / Structured remote attachments yes'
    );
    expect(
      formatAIModelCapabilityLabel({
        routeInputTypes: null,
        routeOutputTypes: [],
      })
    ).toBe('');
  });

  test('formats route policy labels for the model menu', () => {
    expect(
      formatAIModelRoutePolicyLabel({
        routePolicyEnabled: true,
        routePolicyFeatureKind: 'chat',
        routePolicyAllowedPrivacy: ['local', 'private_cloud'],
        routePolicyPreferredPrivacy: ['local', 'cloud'],
        routePolicyAllowedProviderIds: ['ollama-main'],
        routePolicyBlockedProviderIds: ['openai-default'],
      })
    ).toBe(
      'Policy Chat / Allowed Local, Private cloud / Preferred Local, Cloud / Providers ollama-main / Blocked openai-default'
    );
    expect(
      formatAIModelRoutePolicyLabel({
        routePolicyEnabled: false,
        routePolicyFeatureKind: 'chat',
      })
    ).toBe('Policy disabled');
    expect(
      formatAIModelRoutePolicyLabel({
        routePolicyEnabled: true,
        routePolicyFeatureKind: 'chat',
      })
    ).toBe('');
  });

  test('builds structured task route policy summaries', () => {
    expect(
      getAIModelTaskRoutePolicySummary(
        {
          configured: true,
          featureKind: 'workspace_indexing',
          policyAllowedPrivacy: ['local', 'private_cloud'],
          policyAllowedProviderIds: ['ollama-main'],
          policyBlockedProviderIds: ['openai-default'],
          policyEnabled: true,
          policyFeatureKind: 'workspace_indexing',
          policyPreferredPrivacy: ['local'],
          policyWorkspaceId: 'workspace-local-only',
          preparedProviderCount: 1,
        },
        'rerank'
      )
    ).toEqual({
      allowedPrivacy: ['local', 'private_cloud'],
      allowedProviderIds: ['ollama-main'],
      blockedProviderIds: ['openai-default'],
      enabled: true,
      featureKind: 'workspace_indexing',
      label:
        'policy Workspace indexing / Workspace workspace-local-only / Allowed Local, Private cloud / Preferred Local / Providers ollama-main / Blocked openai-default',
      preferredPrivacy: ['local'],
      workspaceId: 'workspace-local-only',
    });

    expect(getAIModelTaskRoutePolicySummary(null, 'rerank')).toEqual({
      allowedPrivacy: [],
      allowedProviderIds: [],
      blockedProviderIds: [],
      enabled: null,
      featureKind: 'rerank',
      label: null,
      preferredPrivacy: [],
      workspaceId: null,
    });
  });

  test('formats chat model limits without exposing embedding-only dimensions', () => {
    expect(
      formatAIModelLimitsLabel({
        contextWindow: 32768,
        maxOutputTokens: 4096,
        embeddingDimensions: 1024,
      })
    ).toBe('32.8K ctx / 4.1K out');
    expect(
      formatAIModelLimitsLabel({
        contextWindow: 1000000,
        maxOutputTokens: null,
        embeddingDimensions: 768,
      })
    ).toBe('1M ctx');
    expect(
      formatAIModelLimitsLabel({
        contextWindow: null,
        maxOutputTokens: undefined,
        embeddingDimensions: 1024,
      })
    ).toBe('');
  });

  test('formats model cost metadata for diagnostics', () => {
    expect(
      formatAIModelCostLabel({
        costInputPer1M: 0.2,
        costOutputPer1M: 0.8,
      })
    ).toBe('$0.2000/M in / $0.8000/M out');
    expect(
      formatAIModelCostLabel({
        costInputPer1M: 1,
        costOutputPer1M: null,
      })
    ).toBe('$1/M in');
    expect(
      formatAIModelCostLabel({
        costInputPer1M: null,
        costOutputPer1M: undefined,
      })
    ).toBe('');
  });

  test('formats visible model menu labels in registry metadata order', () => {
    expect(
      formatAIModelMenuLabels({
        contextWindow: 32768,
        costInputPer1M: 0.2,
        costOutputPer1M: 0.8,
        embeddingDimensions: null,
        isDefault: true,
        isPro: false,
        maxOutputTokens: 4096,
        providerHealth: 'healthy',
        providerId: 'ollama-main',
        providerName: 'Local Ollama',
        providerPrivacy: 'local',
        providerType: 'openaiCompatible',
        effectiveSourceFingerprint: 'abc123ef45678900',
        effectiveSourceFingerprintInputs: ['id', 'providerId'],
        effectiveSourceFingerprintVersion:
          'copilot-model-list-effective-source/v1',
        routeFallbackProviderIds: ['openai-default'],
        routeAttachmentKinds: ['file'],
        routeAttachmentSourceKinds: ['url', 'data'],
        routeAttachmentAllowRemoteUrls: false,
        routeInputTypes: ['text'],
        routeModelId: 'qwen3:32b',
        routeOutputTypes: ['text'],
        routeStructuredAttachmentKinds: ['image'],
        routeStructuredAttachmentSourceKinds: ['file_handle'],
        routeStructuredAttachmentAllowRemoteUrls: true,
        routePolicyAllowedPrivacy: ['local', 'private_cloud'],
        routePolicyAllowedProviderIds: ['ollama-main'],
        routePolicyBlockedProviderIds: ['blocked-cloud'],
        routePolicyEnabled: true,
        routePolicyFeatureKind: 'chat',
        routePolicyPreferredPrivacy: ['local'],
        routePolicyWorkspaceId: 'workspace-local-only',
        sources: ['prompt', 'registry'],
      })
    ).toEqual([
      'Local Ollama (ollama-main) / Local / Healthy',
      'Route ollama-main/qwen3:32b',
      'Fallback openai-default',
      'Source fingerprint abc123ef45678900 / Source version copilot-model-list-effective-source/v1 / Source inputs id, providerId',
      'Input text / Output text / Attachments file / Attachment sources url, data / Remote attachments no / Structured attachments image / Structured attachment sources file_handle / Structured remote attachments yes',
      'Policy Chat / Workspace workspace-local-only / Allowed Local, Private cloud / Preferred Local / Providers ollama-main / Blocked blocked-cloud',
      'Default / Prompt / Registry',
      '32.8K ctx / 4.1K out',
      '$0.2000/M in / $0.8000/M out',
    ]);

    expect(formatAIModelMenuLabels({})).toEqual([]);
  });

  test('formats prompt model policy metadata for diagnostics', () => {
    expect(
      formatAIModelPromptSourcesLabel({
        promptModelSources: [
          {
            candidateSource: 'default',
            modelConfigPath: 'copilot.prompts.defaults.text.model',
            modelSource: 'default_policy',
          },
          {
            candidateSource: 'prompt',
            modelSource: 'built_in',
          },
          {
            candidateSource: 'registry',
          },
        ],
      })
    ).toBe(
      'Default Prompt default policy config copilot.prompts.defaults.text.model -> Prompt Built-in prompt -> Registry'
    );

    expect(
      formatAIModelPromptLabel({
        promptName: 'Generate image',
        promptAction: 'image',
        promptSource: 'built_in',
        promptCategory: 'image',
        promptDefaultModel: 'gemini-2.5-flash',
        defaultModelSource: 'fallback_route',
        defaultModelFallbackReason: 'prompt_default_unavailable',
        promptDefaultPolicy: 'image',
        promptModelConfigPath: 'copilot.prompts.overrides[].model',
        promptModelSource: 'override',
        promptModelSources: [
          {
            candidateSource: 'default',
            modelConfigPath: 'copilot.prompts.overrides[].model',
            modelSource: 'override',
          },
          {
            candidateSource: 'registry',
          },
        ],
        promptOverrideApplied: true,
      })
    ).toBe(
      'Generate image / Action image / Built-in / Prompt default gemini-2.5-flash / Default source Fallback Route / Fallback Prompt default unavailable / Model source Prompt override / Config copilot.prompts.overrides[].model / Source chain Default Prompt override config copilot.prompts.overrides[].model -> Registry / Category Image / Image default / Prompt override'
    );
    expect(
      formatAIModelPromptLabel({
        promptName: null,
        promptAction: null,
        promptSource: null,
        promptCategory: null,
        promptDefaultPolicy: null,
        promptOverrideApplied: false,
      })
    ).toBe('');
  });

  test('formats task route metadata for diagnostics', () => {
    const taskRouteLabel = formatAIModelTaskRoutesLabel({
      embeddingRoute: {
        configured: true,
        diagnosticsErrors: [
          {
            code: 'EmbeddingPrepareDiagnosticsFailure',
            message: 'embedding prepare diagnostics unavailable',
            stage: 'describe_embedding_prepare_candidates',
          },
        ],
        featureKind: 'workspace_indexing',
        providerId: 'ollama-main',
        providerProfileId: 'ollama-main',
        providerProfileSource: 'byok_local',
        providerProfileConfigPath: 'workspace.byok.local',
        providerConfiguredModelIds: ['workspace-embedding', 'nomic-embed-text'],
        providerConfiguredModelCount: 2,
        modelId: 'nomic-embed-text',
        preparedProviderCount: 2,
        protocol: 'openai_chat',
        requestLayer: 'chat_completions',
        modelBackendKind: 'openai_chat',
        canonicalModelKey: 'workspace-embedding',
        behaviorFlags: ['disable_batch_embeddings'],
        policyEnabled: true,
        policyFeatureKind: 'workspace_indexing',
        policyWorkspaceId: 'workspace-local-only',
        policyAllowedProviderIds: ['ollama-main', 'openai-default'],
        policyBlockedProviderIds: ['blocked-cloud'],
        policyAllowedPrivacy: ['local', 'private_cloud'],
        policyPreferredPrivacy: ['local', 'private_cloud'],
        policyCandidates: [
          {
            providerId: 'ollama-main',
            providerProfileId: 'ollama-main',
            providerProfileSource: 'byok_local',
            providerProfileConfigPath: 'workspace.byok.local',
            providerConfiguredModelIds: [
              'workspace-embedding',
              'nomic-embed-text',
            ],
            providerConfiguredModelCount: 2,
            privacy: 'local',
            health: 'healthy',
            healthCheckedAt: '2026-06-16T10:00:00.000Z',
            providerPriority: 10,
            available: true,
            allowed: true,
            reasons: ['candidate_allowed', 'privacy_preferred'],
          },
          {
            providerId: 'openai-default',
            privacy: 'private_cloud',
            health: 'degraded',
            available: true,
            allowed: true,
            reasons: ['candidate_allowed', 'privacy_preferred'],
          },
          {
            providerId: 'blocked-cloud',
            privacy: 'cloud',
            health: 'healthy',
            available: true,
            allowed: false,
            reasons: ['provider_blocked', 'privacy_not_allowed'],
          },
        ],
        routeCandidates: [
          {
            registryKind: 'byok',
            registryAvailable: true,
            registrySelected: true,
            providerId: 'ollama-main',
            providerName: 'Local Ollama',
            providerSource: 'byok_local',
            providerType: 'openaiCompatible',
            providerPriority: 10,
            privacy: 'local',
            health: 'healthy',
            healthCheckedAt: '2026-06-16T10:00:00.000Z',
            requestedModelId: 'workspace-embedding',
            modelId: 'workspace-embedding',
            candidateModelIds: ['workspace-embedding', 'local-embedding'],
            matched: true,
            reasons: ['capability_matched'],
          },
          {
            registryKind: 'quota_backed',
            registryAvailable: true,
            registrySelected: false,
            providerId: 'openai-default',
            modelId: 'text-embedding-3-small',
            candidateModelIds: ['text-embedding-3-small'],
            matched: true,
            reasons: ['profile_model_matched', 'capability_matched'],
          },
        ],
        prepareCandidates: [
          {
            registryKind: 'byok',
            registryAvailable: true,
            registrySelected: false,
            providerId: 'ollama-main',
            requestedModelId: 'workspace-embedding',
            modelId: 'workspace-embedding-large',
            candidateModelIds: ['workspace-embedding-large'],
            prepared: false,
            reasons: ['prepared_route_filtered', 'provider_prepare_error'],
          },
        ],
        preparedRoutes: [
          {
            providerId: 'ollama-main',
            providerProfileId: 'ollama-main',
            providerProfileSource: 'byok_local',
            providerProfileConfigPath: 'workspace.byok.local',
            providerConfiguredModelIds: [
              'workspace-embedding',
              'nomic-embed-text',
            ],
            providerConfiguredModelCount: 2,
            providerSource: 'byok_local',
            providerType: 'openaiCompatible',
            providerPriority: 10,
            modelId: 'nomic-embed-text',
            protocol: 'openai_chat',
            requestLayer: 'chat_completions',
            modelBackendKind: 'openai_chat',
            canonicalModelKey: 'workspace-embedding',
            behaviorFlags: ['disable_batch_embeddings'],
            requestedDimensions: 1024,
            modelEmbeddingDimensions: 768,
            dimensionMismatch: true,
          },
          {
            providerId: 'openai-default',
            providerProfileId: 'openai-default',
            providerProfileSource: 'configured',
            providerProfileConfigPath:
              'copilot.providers.profiles[id=openai-default]',
            providerConfiguredModelIds: ['text-embedding-3-small'],
            providerConfiguredModelCount: 1,
            providerSource: 'configured',
            providerType: 'openai',
            providerPriority: 1,
            modelId: 'text-embedding-3-small',
            protocol: 'openai_responses',
            requestLayer: 'responses',
            modelBackendKind: 'openai_responses',
            canonicalModelKey: 'workspace-embedding-fallback',
            behaviorFlags: ['embedding_fallback'],
            requestedDimensions: 1024,
            modelEmbeddingDimensions: 1024,
            dimensionMismatch: false,
          },
        ],
        requestedModelId: 'ollama-main/workspace-embedding',
        requestedModelConfigKey: 'workspaceIndexing',
        requestedModelConfigPath: 'copilot.tasks.models.workspaceIndexing',
        requestedModelSource: 'workspace_indexing',
        fallbackProviderIds: ['ollama-main', 'openai-default'],
        requestedDimensions: 1024,
        modelEmbeddingDimensions: 768,
        dimensionMismatch: true,
        effectiveSourceFingerprint: 'taskfeed12345678',
        effectiveSourceFingerprintInputs: [
          'featureKind',
          'preparedRoutes',
          'routeCandidates',
        ],
        effectiveSourceFingerprintVersion:
          'copilot-task-route-effective-source/v1',
      },
      rerankRoute: {
        configured: true,
        diagnosticsErrors: [],
        featureKind: 'rerank',
        providerId: 'ollama-main',
        providerProfileId: 'ollama-main',
        providerProfileSource: 'byok_local',
        providerProfileConfigPath: 'workspace.byok.local',
        providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
        providerConfiguredModelCount: 2,
        modelId: 'bge-reranker-v2',
        preparedProviderCount: 1,
        protocol: 'openai_chat',
        requestLayer: 'chat_completions',
        modelBackendKind: 'openai_chat',
        canonicalModelKey: 'office-rerank',
        behaviorFlags: ['rerank_cross_encoder'],
        policyEnabled: true,
        policyFeatureKind: 'rerank',
        policyWorkspaceId: 'workspace-local-only',
        policyAllowedProviderIds: ['ollama-main'],
        policyBlockedProviderIds: ['blocked-cloud'],
        policyAllowedPrivacy: ['local'],
        policyPreferredPrivacy: ['local'],
        policyCandidates: [
          {
            providerId: 'ollama-main',
            privacy: 'local',
            health: 'healthy',
            available: true,
            allowed: true,
            reasons: ['candidate_allowed', 'privacy_preferred'],
          },
          {
            providerId: 'blocked-cloud',
            privacy: 'cloud',
            health: 'down',
            available: false,
            allowed: false,
            reasons: [
              'provider_unavailable',
              'provider_blocked',
              'privacy_not_allowed',
            ],
          },
        ],
        routeCandidates: [
          {
            registryKind: 'byok',
            registryAvailable: true,
            registrySelected: true,
            providerId: 'ollama-main',
            requestedModelId: 'office-rerank',
            modelId: 'office-rerank',
            candidateModelIds: ['office-rerank'],
            matched: true,
            reasons: ['capability_matched'],
          },
          {
            registryKind: 'quota_backed',
            registryAvailable: false,
            registrySelected: false,
            providerId: 'blocked-cloud',
            requestedModelId: 'office-rerank',
            candidateModelIds: ['cloud-rerank'],
            matched: false,
            reasons: ['profile_model_not_allowed'],
          },
        ],
        preparedRoutes: [
          {
            providerId: 'ollama-main',
            providerProfileId: 'ollama-main',
            providerProfileSource: 'byok_local',
            providerProfileConfigPath: 'workspace.byok.local',
            providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
            providerConfiguredModelCount: 2,
            providerSource: 'byok_local',
            providerType: 'openaiCompatible',
            providerPriority: 10,
            modelId: 'bge-reranker-v2',
            protocol: 'openai_chat',
            requestLayer: 'chat_completions',
            modelBackendKind: 'openai_chat',
            canonicalModelKey: 'office-rerank',
            behaviorFlags: ['rerank_cross_encoder'],
          },
        ],
        requestedModelId: 'ollama-main/office-rerank',
        requestedModelConfigKey: 'rerank',
        requestedModelConfigPath: 'copilot.tasks.models.rerank',
        requestedModelSource: 'rerank',
        fallbackProviderIds: ['ollama-main'],
        candidateCount: 1,
      },
    });

    expect(taskRouteLabel).toContain(
      'Workspace indexing / requested ollama-main/workspace-embedding / source Workspace indexing task model / config copilot.tasks.models.workspaceIndexing'
    );
    expect(taskRouteLabel).toContain('source fingerprint taskfeed12345678');
    expect(taskRouteLabel).toContain(
      'source version copilot-task-route-effective-source/v1'
    );
    expect(taskRouteLabel).toContain(
      'source inputs featureKind, preparedRoutes, routeCandidates'
    );
    expect(taskRouteLabel).toContain(
      'profile Profile ollama-main / BYOK local / config workspace.byok.local / 2 configured models / models workspace-embedding, nomic-embed-text'
    );
    expect(taskRouteLabel).toContain(
      'policy candidates ollama-main (priority 10; allowed; available; Local; Healthy; checked 2026-06-16T10:00:00.000Z; profile Profile ollama-main / BYOK local / config workspace.byok.local / 2 configured models / models workspace-embedding, nomic-embed-text; reasons Policy allowed, Preferred privacy)'
    );
    expect(taskRouteLabel).toContain(
      'blocked-cloud (blocked; available; Cloud; Healthy; reasons Provider blocked, Privacy not allowed)'
    );
    expect(taskRouteLabel).toContain(
      'route candidates ollama-main/workspace-embedding (type openaiCompatible; source BYOK local; priority 10; Local; Healthy; checked 2026-06-16T10:00:00.000Z; registry byok; selected registry; matched; requested workspace-embedding; profile models workspace-embedding, local-embedding; reasons Capability matched)'
    );
    expect(taskRouteLabel).toContain(
      'openai-default/text-embedding-3-small (registry quota_backed; matched; profile models text-embedding-3-small; reasons Profile model matched, Capability matched)'
    );
    expect(taskRouteLabel).toContain(
      'prepare candidates ollama-main/workspace-embedding-large (registry byok; not prepared; requested workspace-embedding; profile models workspace-embedding-large; reasons Prepared route filtered, Provider prepare error)'
    );
    expect(taskRouteLabel).toContain(
      'diagnostics errors describe_embedding_prepare_candidates:EmbeddingPrepareDiagnosticsFailure:embedding prepare diagnostics unavailable'
    );
    expect(taskRouteLabel).toContain(
      'requested 1024d / model 768d / dimension mismatch'
    );
    expect(taskRouteLabel).toContain(
      'prepared routes ollama-main/nomic-embed-text protocol openai_chat layer chat_completions backend openai_chat canonical workspace-embedding flags disable_batch_embeddings type openaiCompatible source BYOK local priority 10 profile Profile ollama-main / BYOK local / config workspace.byok.local / 2 configured models / models workspace-embedding, nomic-embed-text requested 1024d model 768d dimension mismatch'
    );
    expect(taskRouteLabel).toContain(
      'openai-default/text-embedding-3-small protocol openai_responses layer responses backend openai_responses canonical workspace-embedding-fallback flags embedding_fallback type openai source Configured priority 1 profile Profile openai-default / Configured / config copilot.providers.profiles[id=openai-default] / 1 configured model / models text-embedding-3-small requested 1024d model 1024d'
    );
    expect(taskRouteLabel).toContain(
      'Rerank / requested ollama-main/office-rerank / source Rerank task model / config copilot.tasks.models.rerank'
    );
    expect(taskRouteLabel).toContain(
      'profile Profile ollama-main / BYOK local / config workspace.byok.local / 2 configured models / models office-rerank, bge-reranker-v2'
    );
    expect(taskRouteLabel).toContain(
      'blocked-cloud (blocked; unavailable; Cloud; Down; reasons Provider unavailable, Provider blocked, Privacy not allowed)'
    );
    expect(taskRouteLabel).toContain(
      'blocked-cloud (registry quota_backed; registry unavailable; unmatched; requested office-rerank; profile models cloud-rerank; reasons Profile model not allowed)'
    );
    expect(taskRouteLabel).not.toContain('candidate_allowed');
    expect(taskRouteLabel).not.toContain('capability_matched');
    expect(taskRouteLabel).not.toContain('profile_model_not_allowed');
    expect(taskRouteLabel).not.toContain('provider_prepare_error');
    expect(
      formatAIModelTaskRoutesLabel({
        embeddingRoute: null,
        rerankRoute: {
          configured: false,
          featureKind: 'rerank',
          preparedProviderCount: 0,
          errorCode: 'no_copilot_provider_available',
          errorMessage: 'No rerank provider available',
          fallbackProviderIds: [],
        },
      })
    ).toBe(
      'Rerank / not configured / code no_copilot_provider_available / error No rerank provider available'
    );
  });

  test('formats a copyable diagnostics label for self-hosted model routes', () => {
    expect(
      formatAIModelDiagnosticsLabel({
        id: 'ollama-main/office-chat-fast',
        promptName: 'Chat With AFFiNE AI',
        promptAction: null,
        promptSource: 'built_in',
        promptCategory: 'text',
        promptDefaultModel: 'gemini-2.5-flash',
        defaultModelSource: 'fallback_route',
        defaultModelFallbackReason: 'prompt_default_unavailable',
        promptDefaultPolicy: 'text',
        promptModelConfigPath: null,
        promptModelSource: null,
        promptModelSources: [
          {
            candidateSource: 'fallback_route',
          },
          {
            candidateSource: 'registry',
          },
        ],
        promptOverrideApplied: false,
        providerId: 'ollama-main',
        providerName: 'Local Ollama',
        routeModelId: 'qwen3:32b',
        providerSource: 'byok_local',
        providerProfileId: 'ollama-main',
        providerProfileSource: 'byok_local',
        providerProfileConfigPath: 'workspace.byok.local',
        providerConfiguredModelIds: [
          'office-chat-fast',
          'office-chat',
          'qwen-office',
        ],
        providerConfiguredModelCount: 3,
        providerType: 'openaiCompatible',
        providerPrivacy: 'local',
        providerHealth: 'healthy',
        providerHealthCheckedAt: '2026-06-15T10:00:00.000Z',
        providerHealthLastError: 'previous timeout',
        providerPriority: 10,
        effectiveSourceFingerprint: 'abc123ef45678900',
        effectiveSourceFingerprintInputs: ['id', 'providerId'],
        effectiveSourceFingerprintVersion:
          'copilot-model-list-effective-source/v1',
        routeBackendKind: 'openai_chat',
        routeCanonicalModelKey: 'office-chat-fast',
        routeRawModelId: 'qwen3:32b',
        routeModelDefinitionSource: 'provider_profile',
        routeModelDefinitionId: 'office-chat-fast',
        routeModelDefinitionAliases: ['office-chat', 'qwen-office'],
        routeModelAliasMatched: true,
        routeProtocol: 'openai_chat',
        routeRequestLayer: 'chat_completions',
        routeBehaviorFlags: ['disable_parallel_tool_calls'],
        routeFallbackProviderIds: ['ollama-main', 'openai-default'],
        routeInputTypes: ['text', 'image'],
        routeOutputTypes: ['text', 'structured'],
        contextWindow: 32768,
        maxOutputTokens: 4096,
        embeddingDimensions: 1024,
        costInputPer1M: 0.2,
        costOutputPer1M: 0.8,
        embeddingRoute: {
          configured: true,
          featureKind: 'workspace_indexing',
          providerId: 'ollama-main',
          providerProfileId: 'ollama-main',
          providerProfileSource: 'byok_local',
          providerProfileConfigPath: 'workspace.byok.local',
          providerConfiguredModelIds: [
            'workspace-embedding',
            'nomic-embed-text',
          ],
          providerConfiguredModelCount: 2,
          modelId: 'nomic-embed-text',
          preparedProviderCount: 2,
          protocol: 'openai_chat',
          requestLayer: 'chat_completions',
          modelBackendKind: 'openai_chat',
          canonicalModelKey: 'workspace-embedding',
          behaviorFlags: ['disable_batch_embeddings'],
          policyEnabled: true,
          policyFeatureKind: 'workspace_indexing',
          policyWorkspaceId: 'workspace-local-only',
          policyAllowedProviderIds: ['ollama-main', 'openai-default'],
          policyBlockedProviderIds: ['blocked-cloud'],
          policyAllowedPrivacy: ['local', 'private_cloud'],
          policyPreferredPrivacy: ['local', 'private_cloud'],
          preparedRoutes: [
            {
              providerId: 'ollama-main',
              providerProfileId: 'ollama-main',
              providerProfileSource: 'byok_local',
              providerProfileConfigPath: 'workspace.byok.local',
              providerConfiguredModelIds: [
                'workspace-embedding',
                'nomic-embed-text',
              ],
              providerConfiguredModelCount: 2,
              providerSource: 'byok_local',
              providerType: 'openaiCompatible',
              providerPriority: 10,
              modelId: 'nomic-embed-text',
              protocol: 'openai_chat',
              requestLayer: 'chat_completions',
              modelBackendKind: 'openai_chat',
              canonicalModelKey: 'workspace-embedding',
              behaviorFlags: ['disable_batch_embeddings'],
              requestedDimensions: 1024,
              modelEmbeddingDimensions: 1024,
              dimensionMismatch: false,
            },
            {
              providerId: 'openai-default',
              providerProfileId: 'openai-default',
              providerProfileSource: 'configured',
              providerProfileConfigPath:
                'copilot.providers.profiles[id=openai-default]',
              providerConfiguredModelIds: ['text-embedding-3-small'],
              providerConfiguredModelCount: 1,
              providerSource: 'configured',
              providerType: 'openai',
              providerPriority: 1,
              modelId: 'text-embedding-3-small',
              protocol: 'openai_responses',
              requestLayer: 'responses',
              modelBackendKind: 'openai_responses',
              canonicalModelKey: 'workspace-embedding-fallback',
              behaviorFlags: ['embedding_fallback'],
              requestedDimensions: 1024,
              modelEmbeddingDimensions: 1024,
              dimensionMismatch: false,
            },
          ],
          requestedModelId: 'ollama-main/workspace-embedding',
          requestedModelConfigKey: 'workspaceIndexing',
          requestedModelConfigPath: 'copilot.tasks.models.workspaceIndexing',
          requestedModelSource: 'workspace_indexing',
          fallbackProviderIds: ['ollama-main', 'openai-default'],
          requestedDimensions: 1024,
          modelEmbeddingDimensions: 1024,
          dimensionMismatch: false,
        },
        rerankRoute: {
          configured: true,
          featureKind: 'rerank',
          providerId: 'ollama-main',
          providerProfileId: 'ollama-main',
          providerProfileSource: 'byok_local',
          providerProfileConfigPath: 'workspace.byok.local',
          providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
          providerConfiguredModelCount: 2,
          modelId: 'bge-reranker-v2',
          preparedProviderCount: 1,
          protocol: 'openai_chat',
          requestLayer: 'chat_completions',
          modelBackendKind: 'openai_chat',
          canonicalModelKey: 'office-rerank',
          behaviorFlags: ['rerank_cross_encoder'],
          policyEnabled: true,
          policyFeatureKind: 'rerank',
          policyWorkspaceId: 'workspace-local-only',
          policyAllowedProviderIds: ['ollama-main'],
          policyBlockedProviderIds: ['blocked-cloud'],
          policyAllowedPrivacy: ['local'],
          policyPreferredPrivacy: ['local'],
          preparedRoutes: [
            {
              providerId: 'ollama-main',
              providerProfileId: 'ollama-main',
              providerProfileSource: 'byok_local',
              providerProfileConfigPath: 'workspace.byok.local',
              providerConfiguredModelIds: ['office-rerank', 'bge-reranker-v2'],
              providerConfiguredModelCount: 2,
              providerSource: 'byok_local',
              providerType: 'openaiCompatible',
              providerPriority: 10,
              modelId: 'bge-reranker-v2',
              protocol: 'openai_chat',
              requestLayer: 'chat_completions',
              modelBackendKind: 'openai_chat',
              canonicalModelKey: 'office-rerank',
              behaviorFlags: ['rerank_cross_encoder'],
            },
          ],
          requestedModelId: 'ollama-main/office-rerank',
          requestedModelConfigKey: 'rerank',
          requestedModelConfigPath: 'copilot.tasks.models.rerank',
          requestedModelSource: 'rerank',
          fallbackProviderIds: ['ollama-main'],
          candidateCount: 1,
        },
        sources: ['fallback_route', 'registry'],
        routePolicyEnabled: true,
        routePolicyFeatureKind: 'chat',
        routePolicyWorkspaceId: 'workspace-local-only',
        routePolicyAllowedPrivacy: ['local'],
        routePolicyPreferredPrivacy: ['local', 'cloud'],
        routePolicyAllowedProviderIds: ['ollama-main'],
        routePolicyBlockedProviderIds: ['openai-default'],
        isDefault: true,
        isPro: false,
      })
    ).toBe(
      [
        'Candidate ollama-main/office-chat-fast',
        'Prompt Chat With AFFiNE AI / Built-in / Prompt default gemini-2.5-flash / Default source Fallback Route / Fallback Prompt default unavailable / Source chain Fallback Route -> Registry / Category Text / Text default',
        'Provider Local Ollama (ollama-main) / BYOK local / Local / Healthy',
        'Provider profile Profile ollama-main / BYOK local / config workspace.byok.local / 3 configured models / models office-chat-fast, office-chat, qwen-office',
        'Provider health Checked 2026-06-15T10:00:00.000Z / Last error previous timeout',
        'Provider priority 10',
        'Route ollama-main/qwen3:32b',
        'Fallback providers ollama-main -> openai-default',
        'Source fingerprint abc123ef45678900 / Source version copilot-model-list-effective-source/v1 / Source inputs id, providerId',
        'Model definition Provider profile / Definition office-chat-fast / Raw qwen3:32b / Aliases office-chat, qwen-office / Alias matched / openai_chat / Canonical office-chat-fast / Protocol openai_chat / Layer chat_completions / Flags disable_parallel_tool_calls',
        'Capabilities Input text, image / Output text, structured',
        'Policy Chat / Workspace workspace-local-only / Allowed Local / Preferred Local, Cloud / Providers ollama-main / Blocked openai-default',
        'Task routes Workspace indexing / requested ollama-main/workspace-embedding / source Workspace indexing task model / config copilot.tasks.models.workspaceIndexing / ollama-main/nomic-embed-text / fallback ollama-main -> openai-default / 2 prepared providers / protocol openai_chat / layer chat_completions / backend openai_chat / canonical workspace-embedding / flags disable_batch_embeddings / profile Profile ollama-main / BYOK local / config workspace.byok.local / 2 configured models / models workspace-embedding, nomic-embed-text / policy Workspace indexing / Workspace workspace-local-only / Allowed Local, Private cloud / Preferred Local, Private cloud / Providers ollama-main, openai-default / Blocked blocked-cloud / prepared routes ollama-main/nomic-embed-text protocol openai_chat layer chat_completions backend openai_chat canonical workspace-embedding flags disable_batch_embeddings type openaiCompatible source BYOK local priority 10 profile Profile ollama-main / BYOK local / config workspace.byok.local / 2 configured models / models workspace-embedding, nomic-embed-text requested 1024d model 1024d -> openai-default/text-embedding-3-small protocol openai_responses layer responses backend openai_responses canonical workspace-embedding-fallback flags embedding_fallback type openai source Configured priority 1 profile Profile openai-default / Configured / config copilot.providers.profiles[id=openai-default] / 1 configured model / models text-embedding-3-small requested 1024d model 1024d / requested 1024d / model 1024d | Rerank / requested ollama-main/office-rerank / source Rerank task model / config copilot.tasks.models.rerank / ollama-main/bge-reranker-v2 / fallback ollama-main / 1 prepared provider / protocol openai_chat / layer chat_completions / backend openai_chat / canonical office-rerank / flags rerank_cross_encoder / profile Profile ollama-main / BYOK local / config workspace.byok.local / 2 configured models / models office-rerank, bge-reranker-v2 / policy Rerank / Workspace workspace-local-only / Allowed Local / Preferred Local / Providers ollama-main / Blocked blocked-cloud / prepared routes ollama-main/bge-reranker-v2 protocol openai_chat layer chat_completions backend openai_chat canonical office-rerank flags rerank_cross_encoder type openaiCompatible source BYOK local priority 10 profile Profile ollama-main / BYOK local / config workspace.byok.local / 2 configured models / models office-rerank, bge-reranker-v2 / 1 candidates',
        'Sources Fallback Route / Registry',
        'Limits 32.8K ctx / 4.1K out',
        'Cost $0.2000/M in / $0.8000/M out',
      ].join('\n')
    );
  });

  test('builds workspace-scoped model registry query variables', () => {
    expect(buildGetPromptModelsVariables('Chat With AFFiNE AI')).toEqual({
      promptName: 'Chat With AFFiNE AI',
      workspaceId: undefined,
    });
    expect(
      buildGetPromptModelsVariables(
        'Chat With AFFiNE AI',
        'workspace-local-only'
      )
    ).toEqual({
      promptName: 'Chat With AFFiNE AI',
      workspaceId: 'workspace-local-only',
    });
  });

  test('builds scoped prompt model preload keys', () => {
    expect(getAIModelPromptFetchKey('Generate image')).toBe(
      '[null,"Generate image"]'
    );
    expect(
      getAIModelPromptFetchKey('Generate image', 'workspace-local-only')
    ).toBe('["workspace-local-only","Generate image"]');
    expect(
      getAIModelPromptFetchKey('Summary', 'workspace-local-only')
    ).not.toBe(
      getAIModelPromptFetchKey('Generate image', 'workspace-local-only')
    );
  });

  test('builds workspace-scoped model preference keys', () => {
    expect(getAIModelIdKey()).toBe('AIModelId');
    expect(getAIModelIdKey(null)).toBe('AIModelId');
    expect(getAIModelIdKey('workspace-local-only')).toBe(
      'AIModelId:workspace-local-only'
    );
    expect(getAIModelIdKey(undefined, 'Chat With AFFiNE AI')).toBe('AIModelId');
    expect(getAIModelIdKey('workspace-local-only', 'Chat With AFFiNE AI')).toBe(
      'AIModelId:workspace-local-only'
    );
    expect(getAIModelIdKey(undefined, 'Generate image')).toBe(
      'AIModelId:prompt:Generate%20image'
    );
    expect(getAIModelIdKey('workspace-local-only', 'Generate image')).toBe(
      'AIModelId:workspace-local-only:prompt:Generate%20image'
    );
    expect(getAIModelIdKey('workspace-local-only', 'image.filter:sketch')).toBe(
      'AIModelId:workspace-local-only:prompt:image.filter%3Asketch'
    );
  });

  test('reads prompt-scoped model preference without mutating active prompt', () => {
    const values = new Map([
      ['AIModelId:workspace-local-only:prompt:Generate%20image', 'image-model'],
      ['AIModelId:prompt:Summary', 'summary-model'],
    ]);
    const service = Object.create(AIModelService.prototype) as AIModelService;
    Object.defineProperty(service, 'workspaceId', {
      configurable: true,
      value: 'workspace-local-only',
    });
    Object.defineProperty(service, 'globalStateService', {
      configurable: true,
      value: {
        globalState: {
          get: (key: string) => values.get(key),
        },
      },
    });

    expect(service.getModelForPrompt('Generate image')).toBe('image-model');
    expect(service.getModelForPrompt('Summary', null)).toBe('summary-model');
    expect(service.getModelForPrompt('Unknown prompt')).toBeUndefined();
  });

  test('filters prompt-scoped model preference against loaded prompt models', () => {
    const values = new Map([
      ['AIModelId:workspace-local-only:prompt:Generate%20image', 'stale-model'],
      ['AIModelId:workspace-local-only:prompt:Summary', 'summary-model'],
    ]);
    const service = Object.create(AIModelService.prototype) as AIModelService;
    Object.defineProperty(service, 'workspaceId', {
      configurable: true,
      value: 'workspace-local-only',
    });
    Object.defineProperty(service, 'loadedModelsScope', {
      configurable: true,
      value: {
        promptName: 'Generate image',
        workspaceId: 'workspace-local-only',
      },
    });
    Object.defineProperty(service, 'models', {
      configurable: true,
      value: {
        value: [
          {
            id: 'image-model',
          },
        ],
      },
    });
    Object.defineProperty(service, 'globalStateService', {
      configurable: true,
      value: {
        globalState: {
          get: (key: string) => values.get(key),
        },
      },
    });

    expect(service.getModelForPrompt('Generate image')).toBeUndefined();
    expect(service.getModelForPrompt('Summary')).toBe('summary-model');
  });

  test('falls back to default prompt seed for loaded prompt action model resolution', () => {
    const values = new Map([
      ['AIModelId:workspace-local-only:prompt:Generate%20image', 'stale-model'],
      ['AIModelId:workspace-local-only', 'image-model'],
      ['AIModelId', 'global-default-model'],
    ]);
    const service = Object.create(AIModelService.prototype) as AIModelService;
    Object.defineProperty(service, 'workspaceId', {
      configurable: true,
      value: 'workspace-local-only',
    });
    Object.defineProperty(service, 'loadedModelsScope', {
      configurable: true,
      value: {
        promptName: 'Generate image',
        workspaceId: 'workspace-local-only',
      },
    });
    Object.defineProperty(service, 'models', {
      configurable: true,
      value: {
        value: [
          {
            id: 'image-model',
          },
        ],
      },
    });
    Object.defineProperty(service, 'globalStateService', {
      configurable: true,
      value: {
        globalState: {
          get: (key: string) => values.get(key),
        },
      },
    });

    expect(service.getModelForPrompt('Generate image')).toBe('image-model');

    values.delete('AIModelId:workspace-local-only');
    expect(service.getModelForPrompt('Generate image')).toBeUndefined();

    values.set('AIModelId', 'image-model');
    expect(service.getModelForPrompt('Generate image')).toBe('image-model');
  });

  test('preloads prompt models before resolving unloaded action prompt preference', async () => {
    const values = new Map([
      ['AIModelId:workspace-local-only:prompt:Generate%20image', 'stale-model'],
      ['AIModelId:workspace-local-only', 'image-model'],
    ]);
    const gql = vi.fn().mockResolvedValue({
      currentUser: {
        copilot: {
          models: {
            defaultModel: 'image-model',
            optionalModels: [
              {
                id: 'image-model',
                name: 'Image model',
              },
            ],
            proModels: [],
          },
        },
      },
    });
    const service = Object.create(AIModelService.prototype) as AIModelService;
    Object.defineProperty(service, 'workspaceId', {
      configurable: true,
      value: 'workspace-local-only',
    });
    Object.defineProperty(service, 'loadedModelsScope', {
      configurable: true,
      value: {
        promptName: 'Chat With AFFiNE AI',
        workspaceId: 'workspace-local-only',
      },
    });
    Object.defineProperty(service, 'models', {
      configurable: true,
      value: {
        value: [
          {
            id: 'chat-model',
          },
        ],
      },
    });
    Object.defineProperty(service, 'globalStateService', {
      configurable: true,
      value: {
        globalState: {
          get: (key: string) => values.get(key),
        },
      },
    });
    Object.defineProperty(service, 'gqlService', {
      configurable: true,
      value: {
        gql,
      },
    });

    await expect(service.ensureModelForPrompt('Generate image')).resolves.toBe(
      'image-model'
    );
    expect(gql).toHaveBeenCalledWith({
      query: expect.anything(),
      variables: {
        promptName: 'Generate image',
        workspaceId: 'workspace-local-only',
      },
    });
    expect((service as unknown as { workspaceId?: string }).workspaceId).toBe(
      'workspace-local-only'
    );
  });

  test('dedupes concurrent prompt model preload requests by prompt scope', async () => {
    const values = new Map([
      ['AIModelId:workspace-local-only:prompt:Generate%20image', 'stale-model'],
      ['AIModelId:workspace-local-only', 'image-model'],
    ]);
    let resolveModels:
      | ((value: {
          currentUser: {
            copilot: {
              models: {
                defaultModel: string;
                optionalModels: { id: string; name: string }[];
                proModels: never[];
              };
            };
          };
        }) => void)
      | undefined;
    const gql = vi.fn(
      () =>
        new Promise<{
          currentUser: {
            copilot: {
              models: {
                defaultModel: string;
                optionalModels: { id: string; name: string }[];
                proModels: never[];
              };
            };
          };
        }>(resolve => {
          resolveModels = resolve;
        })
    );
    const service = Object.create(AIModelService.prototype) as AIModelService;
    Object.defineProperty(service, 'workspaceId', {
      configurable: true,
      value: 'workspace-local-only',
    });
    Object.defineProperty(service, 'loadedModelsScope', {
      configurable: true,
      value: {
        promptName: 'Chat With AFFiNE AI',
        workspaceId: 'workspace-local-only',
      },
    });
    Object.defineProperty(service, 'models', {
      configurable: true,
      value: {
        value: [
          {
            id: 'chat-model',
          },
        ],
      },
    });
    Object.defineProperty(service, 'globalStateService', {
      configurable: true,
      value: {
        globalState: {
          get: (key: string) => values.get(key),
        },
      },
    });
    Object.defineProperty(service, 'gqlService', {
      configurable: true,
      value: {
        gql,
      },
    });

    const first = service.ensureModelForPrompt('Generate image');
    const second = service.ensureModelForPrompt('Generate image');

    expect(gql).toHaveBeenCalledTimes(1);
    expect(gql).toHaveBeenCalledWith({
      query: expect.anything(),
      variables: {
        promptName: 'Generate image',
        workspaceId: 'workspace-local-only',
      },
    });

    resolveModels?.({
      currentUser: {
        copilot: {
          models: {
            defaultModel: 'image-model',
            optionalModels: [
              {
                id: 'image-model',
                name: 'Image model',
              },
            ],
            proModels: [],
          },
        },
      },
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      'image-model',
      'image-model',
    ]);
  });

  test('does not return stale prompt preference when prompt model preload fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const values = new Map([
      ['AIModelId:workspace-local-only:prompt:Generate%20image', 'stale-model'],
      ['AIModelId:workspace-local-only', 'chat-model'],
    ]);
    const gql = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const service = Object.create(AIModelService.prototype) as AIModelService;
    Object.defineProperty(service, 'workspaceId', {
      configurable: true,
      value: 'workspace-local-only',
    });
    Object.defineProperty(service, 'loadedModelsScope', {
      configurable: true,
      value: {
        promptName: 'Chat With AFFiNE AI',
        workspaceId: 'workspace-local-only',
      },
    });
    Object.defineProperty(service, 'globalStateService', {
      configurable: true,
      value: {
        globalState: {
          get: (key: string) => values.get(key),
        },
      },
    });
    Object.defineProperty(service, 'gqlService', {
      configurable: true,
      value: {
        gql,
      },
    });

    try {
      await expect(
        service.ensureModelForPrompt('Generate image')
      ).resolves.toBe(undefined);
      expect(consoleError).toHaveBeenCalledWith(expect.any(Error));
      expect(gql).toHaveBeenCalledWith({
        query: expect.anything(),
        variables: {
          promptName: 'Generate image',
          workspaceId: 'workspace-local-only',
        },
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  test('resolves active model prompt scope from explicit prompt or session', () => {
    expect(resolveAIModelPromptName()).toBe('Chat With AFFiNE AI');
    expect(resolveAIModelPromptName(undefined, ' Generate image ')).toBe(
      'Generate image'
    );
    expect(resolveAIModelPromptName('slides.outline', 'Generate image')).toBe(
      'slides.outline'
    );
    expect(resolveAIModelPromptName('   ', 'mindmap.generate')).toBe(
      'mindmap.generate'
    );
    expect(resolveAIModelPromptName('   ', '   ')).toBe('Chat With AFFiNE AI');
  });

  test('resolves prompt model seed from workspace default before global default', () => {
    expect(
      resolveDefaultPromptAIModelSeedId(
        'Generate image',
        'workspace-default-model',
        'global-default-model'
      )
    ).toBe('workspace-default-model');
    expect(
      resolveDefaultPromptAIModelSeedId(
        'Generate image',
        undefined,
        'global-default-model'
      )
    ).toBe('global-default-model');
    expect(
      resolveDefaultPromptAIModelSeedId(
        'Chat With AFFiNE AI',
        'workspace-default-model',
        'global-default-model'
      )
    ).toBeUndefined();
  });

  test('resolves first available model id from ordered candidates', () => {
    const models = [
      { id: 'ollama-main/office-chat-fast' },
      { id: 'openai-default/gpt-5-mini' },
    ];

    expect(
      resolveAvailableAIModelId(
        [
          undefined,
          'gemini-2.5-flash',
          'openai-default/gpt-5-mini',
          'ollama-main/office-chat-fast',
        ],
        models
      )
    ).toBe('openai-default/gpt-5-mini');
    expect(
      resolveAvailableAIModelId(['gemini-2.5-flash', 'claude-sonnet-4'], models)
    ).toBeUndefined();
  });
});
