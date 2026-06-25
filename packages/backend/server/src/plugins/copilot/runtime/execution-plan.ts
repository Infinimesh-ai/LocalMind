import { Injectable } from '@nestjs/common';

import type {
  LlmPreparedDispatchRoute,
  LlmPreparedEmbeddingDispatchRoute,
  LlmPreparedImageDispatchRoute,
  LlmPreparedRerankDispatchRoute,
  LlmPreparedStructuredDispatchRoute,
} from '../../../native';
import { llmNormalizePreparedRoutes } from '../../../native';
import type { CopilotModelDefinition } from '../config';
import {
  CopilotProviderFactory,
  type ResolvedCopilotProvider,
} from '../providers/factory';
import type { ResolvedProviderModel } from '../providers/provider-model-runtime';
import type { NormalizedCopilotProviderProfile } from '../providers/provider-registry';
import type {
  PreparedNativeEmbeddingExecution,
  PreparedNativeExecution,
  PreparedNativeImageExecution,
  PreparedNativeRerankExecution,
  PreparedNativeStructuredExecution,
} from '../providers/provider-runtime-contract';
import type {
  CopilotChatOptions,
  CopilotEmbeddingOptions,
  CopilotImageOptions,
  CopilotProviderType,
  CopilotRerankRequest,
  CopilotStructuredOptions,
  ModelConditions,
  PromptMessage,
} from '../providers/types';
import { ModelOutputType } from '../providers/types';
import type { RequiredStructuredOutputContract } from './contracts';
import {
  type ExecutionRequestKind,
  type ExecutionRoute,
  type ExecutionRouteDiagnostics,
  type ExecutionTransportContract,
  parseExecutionPlan,
  type SerializableExecutionPlan,
  type SerializableExecutionPlanRequest,
} from './contracts/execution-plan-contract';
import { CopilotExecutionMetrics } from './execution-metrics';

export type { ExecutionRequestKind };

type ProviderFilter = {
  prefer?: CopilotProviderType;
};

type BaseExecutionRequest<TKind extends ExecutionRequestKind> = {
  kind: TKind;
  cond: ModelConditions;
};

type TextExecutionRequest = BaseExecutionRequest<'text'> & {
  messages: PromptMessage[];
  options?: CopilotChatOptions;
};

type StreamTextExecutionRequest = BaseExecutionRequest<'streamText'> & {
  messages: PromptMessage[];
  options?: CopilotChatOptions;
};

type StreamObjectExecutionRequest = BaseExecutionRequest<'streamObject'> & {
  messages: PromptMessage[];
  options?: CopilotChatOptions;
};

type StructuredExecutionRequest = BaseExecutionRequest<'structured'> & {
  messages: PromptMessage[];
  options?: CopilotStructuredOptions;
};

type ImageExecutionRequest = BaseExecutionRequest<'image'> & {
  messages: PromptMessage[];
  options?: CopilotImageOptions;
};

type EmbeddingExecutionRequest = BaseExecutionRequest<'embedding'> & {
  modelId?: string;
  input: string | string[];
  options?: CopilotEmbeddingOptions;
};

type RerankExecutionRequest = BaseExecutionRequest<'rerank'> & {
  modelId?: string;
  request: CopilotRerankRequest;
  options?: CopilotChatOptions;
};

export type ExecutionPlanRequest =
  | TextExecutionRequest
  | StreamTextExecutionRequest
  | StreamObjectExecutionRequest
  | StructuredExecutionRequest
  | ImageExecutionRequest
  | EmbeddingExecutionRequest
  | RerankExecutionRequest;

export type ExecutionPlanForKind<TKind extends ExecutionRequestKind> =
  ExecutionPlan & {
    request: Extract<ExecutionPlanRequest, { kind: TKind }>;
  };

type NativePreparedDispatchPlan<TRoute, TPrepared> = {
  routes: TRoute[];
  prepared: TPrepared;
  preparedRoutes?: TPrepared[];
};

export type NativeChatDispatchPlan = NativePreparedDispatchPlan<
  LlmPreparedDispatchRoute,
  PreparedNativeExecution
> & {
  hasTools: boolean;
};

export type NativeStructuredDispatchPlan = NativePreparedDispatchPlan<
  LlmPreparedStructuredDispatchRoute,
  PreparedNativeStructuredExecution
>;

export type NativeEmbeddingDispatchPlan = NativePreparedDispatchPlan<
  LlmPreparedEmbeddingDispatchRoute,
  PreparedNativeEmbeddingExecution
>;

export type NativeRerankDispatchPlan = NativePreparedDispatchPlan<
  LlmPreparedRerankDispatchRoute,
  PreparedNativeRerankExecution
>;

export type NativeImageDispatchPlan = NativePreparedDispatchPlan<
  LlmPreparedImageDispatchRoute,
  PreparedNativeImageExecution
>;

export type ExecutionPlan = {
  routeDiagnostics?: ExecutionRouteDiagnostics[];
  nativeDispatch?: {
    chat?: NativeChatDispatchPlan;
    structured?: NativeStructuredDispatchPlan;
    embedding?: NativeEmbeddingDispatchPlan;
    rerank?: NativeRerankDispatchPlan;
    image?: NativeImageDispatchPlan;
  };
  serializable?: SerializableExecutionPlan;
  transport?: ExecutionTransportContract;
  request: ExecutionPlanRequest;
  routePolicy: { fallbackOrder: string[] };
  runtimePolicy: {
    prefer?: CopilotProviderType;
  };
  attachmentPolicy: {
    materializeRemoteAttachments: boolean;
  };
  responsePostprocess: { mode: ExecutionRequestKind };
  hostPersistence: {
    persistAssistantTurn: boolean;
    outputKind: ExecutionRequestKind;
  };
  hostContext: {
    signal?: AbortSignal;
    currentMessages?: PromptMessage[];
  };
};

type PreparedRouteLike<TRequest = unknown> = {
  route: {
    providerId: string;
    protocol: PreparedNativeExecution['route']['protocol'];
    model: string;
    backendConfig: PreparedNativeExecution['route']['backendConfig'];
  };
  request: TRequest;
};

function buildPreparedTransport<
  TKind extends ExecutionTransportContract['kind'],
  TPrepared extends PreparedRouteLike,
>(
  kind: TKind,
  routes: ResolvedCopilotProvider[],
  getPrepared: (route: ResolvedCopilotProvider) => TPrepared | undefined
): ExecutionTransportContract | undefined {
  const prepared =
    routes.length === 1 ? routes[0] && getPrepared(routes[0]) : undefined;
  if (!prepared) {
    return;
  }

  return {
    kind,
    request: prepared.request,
  } as ExecutionTransportContract;
}

function collectPreparedRoutes<TPrepared extends PreparedRouteLike, TRoute>(
  routes: ResolvedCopilotProvider[],
  getPrepared: (route: ResolvedCopilotProvider) => TPrepared | undefined,
  mapPreparedRoute: (prepared: TPrepared) => TRoute
): TRoute[] | undefined {
  if (!routes.length) {
    return;
  }

  const preparedRoutes: TRoute[] = [];
  for (const route of routes) {
    const prepared = getPrepared(route);
    if (!prepared) {
      return;
    }
    preparedRoutes.push(mapPreparedRoute(prepared));
  }

  return preparedRoutes;
}

function buildPreparedDispatchPlan<
  TPrepared extends PreparedRouteLike,
  TRoute,
  TDispatch extends NativePreparedDispatchPlan<TRoute, TPrepared>,
>(
  routes: ResolvedCopilotProvider[],
  getPrepared: (route: ResolvedCopilotProvider) => TPrepared | undefined,
  mapPreparedRoute: (prepared: TPrepared) => TRoute,
  buildPreparedDispatchResult?: (
    preparedRoutes: TRoute[],
    prepared: TPrepared,
    preparedExecutions: TPrepared[]
  ) => TDispatch
): TDispatch | undefined {
  const preparedRoutes = collectPreparedRoutes(
    routes,
    getPrepared,
    mapPreparedRoute
  );
  const preparedExecutions = collectPreparedRoutes(
    routes,
    getPrepared,
    prepared => prepared
  );
  const prepared = routes[0] && getPrepared(routes[0]);
  if (!preparedRoutes || !preparedExecutions || !prepared) {
    return;
  }

  const normalizedRoutes = llmNormalizePreparedRoutes<TRoute[]>(preparedRoutes);

  return buildPreparedDispatchResult
    ? buildPreparedDispatchResult(
        normalizedRoutes,
        prepared,
        preparedExecutions
      )
    : ({
        routes: normalizedRoutes,
        prepared,
      } as TDispatch);
}

type DispatchPreparedRoute<TRequest> = {
  provider_id: string;
  protocol: PreparedNativeExecution['route']['protocol'];
  model: string;
  config: PreparedNativeExecution['route']['backendConfig'];
  request: TRequest;
};

function mapPreparedDispatchRoute<TRequest>(
  prepared: PreparedRouteLike<TRequest>
): DispatchPreparedRoute<TRequest> {
  return {
    provider_id: prepared.route.providerId,
    protocol: prepared.route.protocol,
    model: prepared.route.model,
    config: prepared.route.backendConfig,
    request: prepared.request,
  };
}

type PreparedExecutionArtifactSpec<
  TKind extends ExecutionTransportContract['kind'],
  TPrepared extends PreparedRouteLike,
  TRoute,
  TDispatch extends NativePreparedDispatchPlan<TRoute, TPrepared>,
> = {
  transportKind: TKind;
  getPrepared: (route: ResolvedCopilotProvider) => TPrepared | undefined;
  mapPreparedRoute: (prepared: TPrepared) => TRoute;
  buildPreparedDispatch?: (
    preparedRoutes: TRoute[],
    prepared: TPrepared,
    preparedExecutions: TPrepared[]
  ) => TDispatch;
};

type PreparedExecutionArtifacts<TDispatch> = {
  dispatch?: TDispatch;
  transport?: ExecutionTransportContract;
};

function buildPreparedExecutionArtifacts<
  TKind extends ExecutionTransportContract['kind'],
  TPrepared extends PreparedRouteLike,
  TRoute,
  TDispatch extends NativePreparedDispatchPlan<TRoute, TPrepared>,
>(
  routes: ResolvedCopilotProvider[],
  spec: PreparedExecutionArtifactSpec<TKind, TPrepared, TRoute, TDispatch>
): PreparedExecutionArtifacts<TDispatch> {
  return {
    dispatch: buildPreparedDispatchPlan(
      routes,
      spec.getPrepared,
      spec.mapPreparedRoute,
      spec.buildPreparedDispatch
    ),
    transport: buildPreparedTransport(
      spec.transportKind,
      routes,
      spec.getPrepared
    ),
  };
}

const chatArtifactSpec: PreparedExecutionArtifactSpec<
  'chat',
  PreparedNativeExecution,
  LlmPreparedDispatchRoute,
  NativeChatDispatchPlan
> = {
  transportKind: 'chat',
  getPrepared: route => route.prepared,
  mapPreparedRoute: mapPreparedDispatchRoute,
  buildPreparedDispatch: (preparedRoutes, prepared) => ({
    routes: preparedRoutes,
    prepared,
    hasTools: Object.keys(prepared.tools).length > 0,
  }),
};

const structuredArtifactSpec: PreparedExecutionArtifactSpec<
  'structured',
  PreparedNativeStructuredExecution,
  LlmPreparedStructuredDispatchRoute,
  NativeStructuredDispatchPlan
> = {
  transportKind: 'structured',
  getPrepared: route => route.preparedStructured,
  mapPreparedRoute: mapPreparedDispatchRoute,
};

const embeddingArtifactSpec: PreparedExecutionArtifactSpec<
  'embedding',
  PreparedNativeEmbeddingExecution,
  LlmPreparedEmbeddingDispatchRoute,
  NativeEmbeddingDispatchPlan
> = {
  transportKind: 'embedding',
  getPrepared: route => route.preparedEmbedding,
  mapPreparedRoute: mapPreparedDispatchRoute,
  buildPreparedDispatch: (preparedRoutes, prepared, preparedExecutions) => ({
    routes: preparedRoutes,
    prepared,
    preparedRoutes: preparedExecutions,
  }),
};

const rerankArtifactSpec: PreparedExecutionArtifactSpec<
  'rerank',
  PreparedNativeRerankExecution,
  LlmPreparedRerankDispatchRoute,
  NativeRerankDispatchPlan
> = {
  transportKind: 'rerank',
  getPrepared: route => route.preparedRerank,
  mapPreparedRoute: mapPreparedDispatchRoute,
  buildPreparedDispatch: (preparedRoutes, prepared, preparedExecutions) => ({
    routes: preparedRoutes,
    prepared,
    preparedRoutes: preparedExecutions,
  }),
};

const imageArtifactSpec: PreparedExecutionArtifactSpec<
  'image',
  PreparedNativeImageExecution,
  LlmPreparedImageDispatchRoute,
  NativeImageDispatchPlan
> = {
  transportKind: 'image',
  getPrepared: route => route.preparedImage,
  mapPreparedRoute: mapPreparedDispatchRoute,
};

function buildFallbackOrder(routes: ResolvedCopilotProvider[]) {
  return routes.map(route => route.providerId);
}

function providerProfileConfigPath(
  profile: Pick<NormalizedCopilotProviderProfile, 'id' | 'source' | 'type'> &
    Pick<
      Partial<NormalizedCopilotProviderProfile>,
      'providerRegistryRevisionId'
    >
) {
  if (profile.source === 'configured') {
    return `copilot.providers.profiles[id=${profile.id}]`;
  }
  if (profile.source === 'legacy') {
    return `copilot.providers.${profile.type}`;
  }
  if (profile.source === 'db_revision') {
    return profile.providerRegistryRevisionId
      ? `ai_provider_registry_revisions[id=${profile.providerRegistryRevisionId}]`
      : `ai_provider_registry_revisions[provider_id=${profile.id}]`;
  }
  if (profile.source === 'byok_local') {
    return 'workspace.byok.local';
  }
  if (profile.source === 'byok_server') {
    return 'workspace.byok.server';
  }
  return undefined;
}

function getProfileConfiguredModelIds(
  profile: NormalizedCopilotProviderProfile
) {
  const ids = new Set<string>();
  for (const modelId of profile.models ?? []) {
    ids.add(modelId);
  }
  for (const definition of profile.modelDefinitions ?? []) {
    ids.add(definition.id);
    for (const alias of definition.aliases ?? []) {
      ids.add(alias);
    }
  }
  return Array.from(ids);
}

function resolveProfileModelDefinition(
  profile: NormalizedCopilotProviderProfile,
  requestedModelId: string | undefined,
  routeModelId: string
): CopilotModelDefinition | undefined {
  return (profile.modelDefinitions ?? []).find(definition => {
    return (
      definition.id === requestedModelId ||
      definition.id === routeModelId ||
      definition.rawModelId === requestedModelId ||
      definition.rawModelId === routeModelId ||
      definition.aliases?.includes(requestedModelId ?? '') ||
      definition.aliases?.includes(routeModelId)
    );
  });
}

function resolveModelDefinitionSource(
  profile: NormalizedCopilotProviderProfile,
  resolvedModel: Partial<ResolvedProviderModel> | undefined,
  profileDefinition: CopilotModelDefinition | undefined
): 'native_registry' | 'provider_profile' | 'provider_runtime' | undefined {
  if (profileDefinition) {
    return 'provider_profile';
  }
  if (resolvedModel?.canonicalKey) {
    return 'native_registry';
  }
  return profile.models?.length ? 'provider_runtime' : undefined;
}

function mapExecutionRoute(route: ResolvedCopilotProvider): ExecutionRoute {
  const preparedRoute =
    route.prepared?.route ??
    route.preparedStructured?.route ??
    route.preparedEmbedding?.route ??
    route.preparedRerank?.route ??
    route.preparedImage?.route;

  if (preparedRoute) {
    return {
      providerId: preparedRoute.providerId,
      protocol: preparedRoute.protocol,
      model: preparedRoute.model,
      backendConfig: preparedRoute.backendConfig,
    };
  }

  const rawRoute = route as unknown as ExecutionRoute;
  return {
    providerId: rawRoute.providerId,
    protocol: rawRoute.protocol,
    model: rawRoute.model,
    backendConfig: rawRoute.backendConfig,
  };
}

function mapExecutionRouteDiagnostics(
  route: ResolvedCopilotProvider
): ExecutionRouteDiagnostics {
  const preparedRoute =
    route.prepared?.route ??
    route.preparedStructured?.route ??
    route.preparedEmbedding?.route ??
    route.preparedRerank?.route ??
    route.preparedImage?.route;

  if (preparedRoute) {
    const resolvedModel = route.provider.resolveModel(
      preparedRoute.model,
      route.execution
    ) as Partial<ResolvedProviderModel> | undefined;
    const profileDefinition = resolveProfileModelDefinition(
      route.profile,
      route.modelId,
      preparedRoute.model
    );
    const profileConfigPath = providerProfileConfigPath(route.profile);
    const profileModelIds = getProfileConfiguredModelIds(route.profile);
    const routeModelDefinitionSource = resolveModelDefinitionSource(
      route.profile,
      resolvedModel,
      profileDefinition
    );
    const routeModelDefinitionId =
      profileDefinition?.id ??
      resolvedModel?.canonicalKey ??
      (routeModelDefinitionSource === 'provider_runtime'
        ? preparedRoute.model
        : undefined);
    const routeRawModelId =
      profileDefinition?.rawModelId ??
      (routeModelDefinitionId &&
      resolvedModel?.id &&
      resolvedModel.id !== routeModelDefinitionId
        ? resolvedModel.id
        : undefined);

    return {
      providerId: preparedRoute.providerId,
      protocol: preparedRoute.protocol,
      model: preparedRoute.model,
      backendConfig: preparedRoute.backendConfig,
      ...(resolvedModel?.backendKind
        ? { modelBackendKind: resolvedModel.backendKind }
        : {}),
      ...(resolvedModel?.canonicalKey
        ? { canonicalModelKey: resolvedModel.canonicalKey }
        : {}),
      ...(resolvedModel?.behaviorFlags?.length
        ? { behaviorFlags: resolvedModel.behaviorFlags }
        : {}),
      ...(route.profile.displayName
        ? { providerName: route.profile.displayName }
        : {}),
      ...(route.profile.source ? { providerSource: route.profile.source } : {}),
      providerProfileId: route.profile.id,
      ...(route.profile.source
        ? { providerProfileSource: route.profile.source }
        : {}),
      ...(profileConfigPath
        ? { providerProfileConfigPath: profileConfigPath }
        : {}),
      ...(profileModelIds.length
        ? {
            providerConfiguredModelCount: profileModelIds.length,
            providerConfiguredModelIds: profileModelIds,
          }
        : {}),
      providerType: route.profile.type,
      providerPrivacy: route.profile.privacy ?? 'cloud',
      providerHealth: route.profile.health?.status ?? 'unknown',
      ...(route.profile.health?.lastCheckedAt
        ? { providerHealthCheckedAt: route.profile.health.lastCheckedAt }
        : {}),
      ...(route.profile.health?.lastError
        ? { providerHealthLastError: route.profile.health.lastError }
        : {}),
      providerPriority: route.profile.priority,
      ...(route.modelId !== undefined &&
      profileDefinition?.aliases?.includes(route.modelId) !== undefined
        ? {
            routeModelAliasMatched: profileDefinition?.aliases?.includes(
              route.modelId
            ),
          }
        : {}),
      ...(profileDefinition?.aliases?.length
        ? { routeModelDefinitionAliases: profileDefinition.aliases }
        : {}),
      ...(routeModelDefinitionId ? { routeModelDefinitionId } : {}),
      ...(routeModelDefinitionSource ? { routeModelDefinitionSource } : {}),
      ...(routeRawModelId ? { routeRawModelId } : {}),
    };
  }

  const rawRoute = route as unknown as ExecutionRouteDiagnostics;
  return {
    providerId: rawRoute.providerId,
    protocol: rawRoute.protocol,
    model: rawRoute.model,
    backendConfig: rawRoute.backendConfig,
  };
}

function stripHostOnlyOptions<TOptions extends object | undefined>(
  options: TOptions
): Record<string, unknown> | undefined {
  if (!options) {
    return;
  }

  const {
    signal: _signal,
    user: _user,
    session: _session,
    workspace: _workspace,
    quotaBackedRoutesAllowed: _quotaBackedRoutesAllowed,
    ...serializable
  } = options as Record<string, unknown>;

  return Object.keys(serializable).length ? serializable : undefined;
}

function buildSerializableRequest(
  request: ExecutionPlanRequest
): SerializableExecutionPlanRequest {
  switch (request.kind) {
    case 'text':
    case 'streamText':
    case 'streamObject':
    case 'structured':
    case 'image':
      return {
        ...request,
        options: stripHostOnlyOptions(request.options),
      } as SerializableExecutionPlanRequest;
    case 'embedding':
    case 'rerank':
      return {
        ...request,
        options: stripHostOnlyOptions(request.options),
      };
  }
}

function buildSerializableExecutionPlan(
  routes: ResolvedCopilotProvider[],
  input: Omit<
    ExecutionPlan,
    'nativeDispatch' | 'serializable' | 'hostContext'
  > &
    Pick<ExecutionPlan, 'hostContext'>
): SerializableExecutionPlan {
  return parseExecutionPlan({
    routes: routes.map(mapExecutionRoute),
    request: buildSerializableRequest(input.request),
    transport: input.transport,
    routePolicy: input.routePolicy,
    runtimePolicy: input.runtimePolicy,
    attachmentPolicy: input.attachmentPolicy,
    responsePostprocess: input.responsePostprocess,
    hostContext: input.hostContext.currentMessages
      ? { currentMessages: input.hostContext.currentMessages }
      : undefined,
  });
}

type MessagePlanArtifacts = Pick<ExecutionPlan, 'nativeDispatch' | 'transport'>;

function buildMessagePlanArtifacts(
  kind: Extract<
    ExecutionRequestKind,
    'text' | 'streamText' | 'streamObject' | 'structured' | 'image'
  >,
  routes: ResolvedCopilotProvider[]
): MessagePlanArtifacts {
  const chatArtifacts =
    kind === 'text' || kind === 'streamText' || kind === 'streamObject'
      ? buildPreparedExecutionArtifacts(routes, chatArtifactSpec)
      : undefined;
  const structuredArtifacts =
    kind === 'structured'
      ? buildPreparedExecutionArtifacts(routes, structuredArtifactSpec)
      : undefined;
  const imageArtifacts =
    kind === 'image'
      ? buildPreparedExecutionArtifacts(routes, imageArtifactSpec)
      : undefined;
  const nativeDispatch = {
    chat:
      kind === 'text' || kind === 'streamText' || kind === 'streamObject'
        ? chatArtifacts?.dispatch
        : undefined,
    structured:
      kind === 'structured' ? structuredArtifacts?.dispatch : undefined,
    image: kind === 'image' ? imageArtifacts?.dispatch : undefined,
  };

  return {
    nativeDispatch,
    transport:
      kind === 'text' || kind === 'streamText' || kind === 'streamObject'
        ? chatArtifacts?.transport
        : kind === 'structured'
          ? structuredArtifacts?.transport
          : kind === 'image'
            ? imageArtifacts?.transport
            : undefined,
  };
}

function buildEmbeddingPlanArtifacts(
  routes: ResolvedCopilotProvider[]
): Pick<ExecutionPlan, 'nativeDispatch' | 'transport'> {
  const embeddingArtifacts = buildPreparedExecutionArtifacts(
    routes,
    embeddingArtifactSpec
  );
  return {
    nativeDispatch: {
      embedding: embeddingArtifacts.dispatch,
    },
    transport: embeddingArtifacts.transport,
  };
}

function buildRerankPlanArtifacts(
  routes: ResolvedCopilotProvider[]
): Pick<ExecutionPlan, 'nativeDispatch' | 'transport'> {
  const rerankArtifacts = buildPreparedExecutionArtifacts(
    routes,
    rerankArtifactSpec
  );
  return {
    nativeDispatch: {
      rerank: rerankArtifacts.dispatch,
    },
    transport: rerankArtifacts.transport,
  };
}

@Injectable()
export class ExecutionPlanBuilder {
  constructor(
    private readonly providers: CopilotProviderFactory,
    private readonly executionMetrics: CopilotExecutionMetrics
  ) {}

  private async buildMessagePlan<
    TKind extends Extract<
      ExecutionRequestKind,
      'text' | 'streamText' | 'streamObject' | 'structured' | 'image'
    >,
  >(
    kind: TKind,
    cond: ModelConditions,
    messages: PromptMessage[],
    options?:
      | CopilotChatOptions
      | CopilotStructuredOptions
      | CopilotImageOptions,
    filter: ProviderFilter = {}
  ): Promise<ExecutionPlanForKind<TKind>> {
    const outputType =
      kind === 'image'
        ? ModelOutputType.Image
        : kind === 'streamObject'
          ? ModelOutputType.Object
          : kind === 'structured'
            ? ModelOutputType.Structured
            : ModelOutputType.Text;

    const routes =
      kind === 'text' || kind === 'streamText' || kind === 'streamObject'
        ? await this.providers.prepareRoutes(
            kind,
            { ...cond, outputType },
            messages,
            (options as CopilotChatOptions | undefined) ?? {},
            filter
          )
        : kind === 'structured'
          ? await this.providers.prepareStructuredRoutes(
              { ...cond, outputType },
              messages,
              (options as CopilotStructuredOptions | undefined) ?? {},
              filter
            )
          : await this.providers.prepareImageRoutes(
              { ...cond, outputType },
              messages,
              (options as CopilotImageOptions | undefined) ?? {},
              filter
            );
    this.executionMetrics.recordPlan(kind, routes, filter.prefer);
    const { nativeDispatch, transport } = buildMessagePlanArtifacts(
      kind,
      routes
    );
    const plan = {
      transport,
      request: {
        kind,
        cond: { ...cond, modelId: cond.modelId },
        messages,
        options,
      } as Extract<ExecutionPlanRequest, { kind: TKind }>,
      routePolicy: {
        fallbackOrder: buildFallbackOrder(routes),
      },
      runtimePolicy: { prefer: filter.prefer },
      attachmentPolicy: { materializeRemoteAttachments: true },
      responsePostprocess: { mode: kind },
      hostPersistence: {
        persistAssistantTurn: true,
        outputKind: kind,
      },
      hostContext: {
        signal: options?.signal,
        currentMessages: messages,
      },
    } as Omit<ExecutionPlanForKind<TKind>, 'nativeDispatch' | 'serializable'>;

    return {
      routeDiagnostics: routes.map(mapExecutionRouteDiagnostics),
      nativeDispatch,
      serializable: buildSerializableExecutionPlan(routes, plan),
      ...plan,
    };
  }

  async buildTextPlan(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotChatOptions,
    filter?: ProviderFilter
  ): Promise<ExecutionPlanForKind<'text'>> {
    return await this.buildMessagePlan('text', cond, messages, options, filter);
  }

  async buildStreamTextPlan(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotChatOptions,
    filter?: ProviderFilter
  ): Promise<ExecutionPlanForKind<'streamText'>> {
    return await this.buildMessagePlan(
      'streamText',
      cond,
      messages,
      options,
      filter
    );
  }

  async buildStreamObjectPlan(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotChatOptions,
    filter?: ProviderFilter
  ): Promise<ExecutionPlanForKind<'streamObject'>> {
    return await this.buildMessagePlan(
      'streamObject',
      cond,
      messages,
      options,
      filter
    );
  }

  async buildStructuredPlan(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotStructuredOptions,
    filter?: ProviderFilter,
    responseContract?: RequiredStructuredOutputContract
  ): Promise<ExecutionPlanForKind<'structured'>> {
    const outputType = ModelOutputType.Structured;
    const routes = await this.providers.prepareStructuredRoutes(
      { ...cond, outputType },
      messages,
      options ?? {},
      filter ?? {},
      responseContract
    );
    this.executionMetrics.recordPlan('structured', routes, filter?.prefer);
    const { nativeDispatch, transport } = buildMessagePlanArtifacts(
      'structured',
      routes
    );
    const plan = {
      transport,
      request: {
        kind: 'structured',
        cond: { ...cond, modelId: cond.modelId },
        messages,
        options,
      },
      routePolicy: {
        fallbackOrder: buildFallbackOrder(routes),
      },
      runtimePolicy: { prefer: filter?.prefer },
      attachmentPolicy: { materializeRemoteAttachments: true },
      responsePostprocess: { mode: 'structured' },
      hostPersistence: {
        persistAssistantTurn: true,
        outputKind: 'structured',
      },
      hostContext: {
        signal: options?.signal,
        currentMessages: messages,
      },
    } as Omit<
      ExecutionPlanForKind<'structured'>,
      'nativeDispatch' | 'serializable'
    >;

    return {
      routeDiagnostics: routes.map(mapExecutionRouteDiagnostics),
      nativeDispatch,
      serializable: buildSerializableExecutionPlan(routes, plan),
      ...plan,
    };
  }

  async buildImagePlan(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotImageOptions,
    filter?: ProviderFilter
  ): Promise<ExecutionPlanForKind<'image'>> {
    return await this.buildMessagePlan(
      'image',
      cond,
      messages,
      options,
      filter
    );
  }

  async buildEmbeddingPlan(
    modelId: string | undefined,
    input: string | string[],
    options?: CopilotEmbeddingOptions
  ): Promise<ExecutionPlanForKind<'embedding'>> {
    const routes = await this.providers.prepareEmbeddingRoutes(
      modelId,
      input,
      options
    );
    this.executionMetrics.recordPlan('embedding', routes);
    const { nativeDispatch, transport } = buildEmbeddingPlanArtifacts(routes);
    const plan = {
      transport,
      request: {
        kind: 'embedding',
        cond: { modelId },
        modelId,
        input,
        options,
      },
      routePolicy: {
        fallbackOrder: buildFallbackOrder(routes),
      },
      runtimePolicy: {},
      attachmentPolicy: { materializeRemoteAttachments: false },
      responsePostprocess: { mode: 'embedding' },
      hostPersistence: {
        persistAssistantTurn: false,
        outputKind: 'embedding',
      },
      hostContext: {
        signal: options?.signal,
      },
    } as Omit<
      ExecutionPlanForKind<'embedding'>,
      'nativeDispatch' | 'serializable'
    >;

    return {
      routeDiagnostics: routes.map(mapExecutionRouteDiagnostics),
      nativeDispatch,
      serializable: buildSerializableExecutionPlan(routes, plan),
      ...plan,
    };
  }

  async buildRerankPlan(
    modelId: string | undefined,
    request: CopilotRerankRequest,
    options?: CopilotChatOptions
  ): Promise<ExecutionPlanForKind<'rerank'>> {
    const routes = await this.providers.prepareRerankRoutes(
      modelId,
      request,
      options
    );
    this.executionMetrics.recordPlan('rerank', routes);
    const { nativeDispatch, transport } = buildRerankPlanArtifacts(routes);
    const plan = {
      transport,
      request: {
        kind: 'rerank',
        cond: { modelId },
        modelId,
        request,
        options,
      },
      routePolicy: {
        fallbackOrder: buildFallbackOrder(routes),
      },
      runtimePolicy: {},
      attachmentPolicy: { materializeRemoteAttachments: false },
      responsePostprocess: { mode: 'rerank' },
      hostPersistence: {
        persistAssistantTurn: false,
        outputKind: 'rerank',
      },
      hostContext: {
        signal: options?.signal,
      },
    } as Omit<
      ExecutionPlanForKind<'rerank'>,
      'nativeDispatch' | 'serializable'
    >;

    return {
      routeDiagnostics: routes.map(mapExecutionRouteDiagnostics),
      nativeDispatch,
      serializable: buildSerializableExecutionPlan(routes, plan),
      ...plan,
    };
  }
}
