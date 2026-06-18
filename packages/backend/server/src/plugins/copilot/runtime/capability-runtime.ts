import { Injectable } from '@nestjs/common';

import { CopilotPromptInvalid } from '../../../base';
import { ValidatedStructuredValueSchema } from '../core';
import {
  type CopilotChatOptions,
  type CopilotEmbeddingOptions,
  type CopilotImageOptions,
  type CopilotProviderType,
  type CopilotRerankRequest,
  type CopilotStructuredOptions,
  type ModelConditions,
  type PromptMessage,
  type StreamObject,
} from '../providers/types';
import {
  type RequiredStructuredOutputContract,
  requireStructuredOutputContract,
} from './contracts';
import {
  ExecutionPlanBuilder,
  type ExecutionPlanForKind,
} from './execution-plan';
import {
  NativeExecutionEngine,
  type NativeImageArtifact,
} from './native-execution-engine';

type ProviderFilter = {
  prefer?: CopilotProviderType;
};

type PreparedTaskRouteDiagnostics = {
  providerId: string;
  modelId: string;
  protocol?: string;
  requestLayer?: string;
  modelBackendKind?: string;
  canonicalModelKey?: string;
  behaviorFlags?: string[];
  providerConfiguredModelCount?: number;
  providerConfiguredModelIds?: string[];
  providerName?: string;
  providerPriority?: number;
  providerProfileConfigPath?: string;
  providerProfileId?: string;
  providerProfileSource?: string;
  providerSource?: string;
  providerType?: string;
  requestedDimensions?: number;
  modelEmbeddingDimensions?: number;
  dimensionMismatch?: boolean;
};

type PreparedTaskRouteExecution = {
  route: {
    providerId: string;
    model: string;
    protocol?: string;
    backendConfig: { request_layer?: string };
  };
  modelDefinition?: {
    backendKind?: string;
    canonicalKey?: string;
    behaviorFlags?: string[];
  };
  requestedDimensions?: number;
  modelLimits?: {
    embeddingDimensions?: number;
  };
  providerConfiguredModelCount?: number;
  providerConfiguredModelIds?: string[];
  providerName?: string;
  providerPriority?: number;
  providerProfileConfigPath?: string;
  providerProfileId?: string;
  providerProfileSource?: string;
  providerSource?: string;
  providerType?: string;
};

const providerModelId = (modelId?: string) => modelId ?? 'auto';

const routeDiagnosticErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const routeDiagnosticErrorCode = (error: unknown) =>
  error instanceof Error && error.name !== 'Error'
    ? error.name
    : 'route_preflight_error';

export type EmbeddingRouteDiagnostics = {
  configured: boolean;
  errorCode?: string;
  errorMessage?: string;
  fallbackOrder: string[];
  preparedRoutes: PreparedTaskRouteDiagnostics[];
  preparedProviderCount: number;
  requestedModelId?: string;
  providerId?: string;
  modelId?: string;
  protocol?: string;
  requestLayer?: string;
  modelBackendKind?: string;
  canonicalModelKey?: string;
  behaviorFlags?: string[];
  providerConfiguredModelCount?: number;
  providerConfiguredModelIds?: string[];
  providerName?: string;
  providerPriority?: number;
  providerProfileConfigPath?: string;
  providerProfileId?: string;
  providerProfileSource?: string;
  providerSource?: string;
  providerType?: string;
  requestedDimensions?: number;
  modelEmbeddingDimensions?: number;
  dimensionMismatch: boolean;
};

export type RerankRouteDiagnostics = {
  configured: boolean;
  errorCode?: string;
  errorMessage?: string;
  fallbackOrder: string[];
  preparedRoutes: PreparedTaskRouteDiagnostics[];
  preparedProviderCount: number;
  requestedModelId?: string;
  providerId?: string;
  modelId?: string;
  protocol?: string;
  requestLayer?: string;
  modelBackendKind?: string;
  canonicalModelKey?: string;
  behaviorFlags?: string[];
  providerConfiguredModelCount?: number;
  providerConfiguredModelIds?: string[];
  providerName?: string;
  providerPriority?: number;
  providerProfileConfigPath?: string;
  providerProfileId?: string;
  providerProfileSource?: string;
  providerSource?: string;
  providerType?: string;
  topK?: number;
  candidateCount?: number;
};

@Injectable()
export class CapabilityRuntime {
  constructor(
    private readonly plans: ExecutionPlanBuilder,
    private readonly engine: NativeExecutionEngine
  ) {}

  private async executePlan<TPlan, TResult>(
    build: () => Promise<TPlan>,
    execute: (plan: TPlan) => Promise<TResult>
  ) {
    return await execute(await build());
  }

  private executeStreamPlan<TPlan, TChunk>(
    build: () => Promise<TPlan>,
    execute: (plan: TPlan) => AsyncIterableIterator<TChunk>
  ): AsyncIterableIterator<TChunk> {
    return (async function* () {
      yield* execute(await build());
    })();
  }

  private hasNativeDispatch(
    plan: ExecutionPlanForKind<'embedding'> | ExecutionPlanForKind<'rerank'>,
    kind: 'embedding' | 'rerank'
  ) {
    return !!plan.nativeDispatch?.[kind];
  }

  private describePreparedTaskRoutes(
    routes: PreparedTaskRouteExecution[] | undefined
  ): PreparedTaskRouteDiagnostics[] {
    return (routes ?? []).map(prepared => {
      const requestedDimensions = prepared.requestedDimensions;
      const modelEmbeddingDimensions =
        prepared.modelLimits?.embeddingDimensions;
      const hasDimensionEvidence =
        requestedDimensions !== undefined ||
        modelEmbeddingDimensions !== undefined;
      return {
        providerId: prepared.route.providerId,
        modelId: prepared.route.model,
        protocol: prepared.route.protocol,
        requestLayer: prepared.route.backendConfig.request_layer,
        modelBackendKind: prepared.modelDefinition?.backendKind,
        canonicalModelKey: prepared.modelDefinition?.canonicalKey,
        behaviorFlags: prepared.modelDefinition?.behaviorFlags,
        ...(prepared.providerConfiguredModelCount != null
          ? {
              providerConfiguredModelCount:
                prepared.providerConfiguredModelCount,
            }
          : {}),
        ...(prepared.providerConfiguredModelIds?.length
          ? {
              providerConfiguredModelIds: prepared.providerConfiguredModelIds,
            }
          : {}),
        ...(prepared.providerName
          ? { providerName: prepared.providerName }
          : {}),
        ...(prepared.providerPriority != null
          ? { providerPriority: prepared.providerPriority }
          : {}),
        ...(prepared.providerProfileConfigPath
          ? { providerProfileConfigPath: prepared.providerProfileConfigPath }
          : {}),
        ...(prepared.providerProfileId
          ? { providerProfileId: prepared.providerProfileId }
          : {}),
        ...(prepared.providerProfileSource
          ? { providerProfileSource: prepared.providerProfileSource }
          : {}),
        ...(prepared.providerSource
          ? { providerSource: prepared.providerSource }
          : {}),
        ...(prepared.providerType
          ? { providerType: prepared.providerType }
          : {}),
        ...(requestedDimensions !== undefined ? { requestedDimensions } : {}),
        ...(modelEmbeddingDimensions !== undefined
          ? { modelEmbeddingDimensions }
          : {}),
        ...(hasDimensionEvidence
          ? {
              dimensionMismatch:
                requestedDimensions !== undefined &&
                modelEmbeddingDimensions !== undefined &&
                requestedDimensions !== modelEmbeddingDimensions,
            }
          : {}),
      };
    });
  }

  async text(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotChatOptions,
    filter?: ProviderFilter
  ) {
    return await this.executePlan(
      () => this.plans.buildTextPlan(cond, messages, options, filter),
      plan => this.engine.execute(plan)
    );
  }

  async *streamText(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotChatOptions,
    filter?: ProviderFilter
  ): AsyncIterableIterator<string> {
    yield* this.executeStreamPlan(
      () => this.plans.buildStreamTextPlan(cond, messages, options, filter),
      plan => this.engine.executeStream(plan)
    );
  }

  async *streamObject(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotChatOptions,
    filter?: ProviderFilter
  ): AsyncIterableIterator<StreamObject> {
    yield* this.executeStreamPlan(
      () => this.plans.buildStreamObjectPlan(cond, messages, options, filter),
      plan => this.engine.executeStream(plan)
    );
  }

  async generateStructured(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotStructuredOptions,
    filter?: ProviderFilter,
    responseContract?: RequiredStructuredOutputContract
  ) {
    return await this.executePlan(
      () =>
        this.plans.buildStructuredPlan(
          cond,
          messages,
          options,
          filter,
          responseContract
        ),
      plan => this.engine.execute(plan)
    );
  }

  async generateStructuredValue(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotStructuredOptions,
    responseContract?: RequiredStructuredOutputContract,
    filter?: ProviderFilter
  ) {
    const validatedResponseContract =
      requireStructuredOutputContract(responseContract);
    if (!options || !validatedResponseContract) {
      throw new CopilotPromptInvalid('Structured schema contract is required');
    }

    const output = await this.generateStructured(
      cond,
      messages,
      options,
      filter,
      validatedResponseContract
    );
    const value = JSON.parse(output);
    return ValidatedStructuredValueSchema.parse({
      value,
      schemaHash: validatedResponseContract.schemaHash,
      schemaValidationVersion: 'json-schema-v1',
      provider: filter?.prefer ?? 'auto',
      model: providerModelId(cond.modelId),
    });
  }

  async embeddingConfigured(
    modelId?: string,
    options?: CopilotEmbeddingOptions
  ) {
    return (await this.describeEmbeddingRoute(modelId, options)).configured;
  }

  async describeEmbeddingRoute(
    modelId?: string,
    options?: CopilotEmbeddingOptions
  ): Promise<EmbeddingRouteDiagnostics> {
    try {
      const plan = await this.plans.buildEmbeddingPlan(
        modelId,
        'ping',
        options
      );
      const prepared = plan.nativeDispatch?.embedding?.prepared;
      const preparedRouteDiagnostics = this.describePreparedTaskRoutes(
        plan.nativeDispatch?.embedding?.preparedRoutes
      );
      const selectedPreparedRoute = preparedRouteDiagnostics[0];
      const requestedDimensions =
        prepared?.requestedDimensions ?? prepared?.request.dimensions;
      const modelEmbeddingDimensions =
        prepared?.modelLimits?.embeddingDimensions;

      return {
        configured: this.hasNativeDispatch(plan, 'embedding'),
        fallbackOrder: plan.routePolicy.fallbackOrder,
        preparedRoutes: preparedRouteDiagnostics,
        preparedProviderCount:
          plan.nativeDispatch?.embedding?.preparedRoutes?.length ??
          plan.nativeDispatch?.embedding?.routes?.length ??
          plan.routePolicy.fallbackOrder.length,
        requestedModelId: modelId,
        providerId: prepared?.route.providerId,
        modelId: prepared?.route.model,
        protocol: prepared?.route.protocol,
        requestLayer: prepared?.route.backendConfig.request_layer,
        modelBackendKind: prepared?.modelDefinition?.backendKind,
        canonicalModelKey: prepared?.modelDefinition?.canonicalKey,
        behaviorFlags: prepared?.modelDefinition?.behaviorFlags,
        providerConfiguredModelCount:
          selectedPreparedRoute?.providerConfiguredModelCount,
        providerConfiguredModelIds:
          selectedPreparedRoute?.providerConfiguredModelIds,
        providerName: selectedPreparedRoute?.providerName,
        providerPriority: selectedPreparedRoute?.providerPriority,
        providerProfileConfigPath:
          selectedPreparedRoute?.providerProfileConfigPath,
        providerProfileId: selectedPreparedRoute?.providerProfileId,
        providerProfileSource: selectedPreparedRoute?.providerProfileSource,
        providerSource: selectedPreparedRoute?.providerSource,
        providerType: selectedPreparedRoute?.providerType,
        requestedDimensions,
        modelEmbeddingDimensions,
        dimensionMismatch:
          requestedDimensions !== undefined &&
          modelEmbeddingDimensions !== undefined &&
          requestedDimensions !== modelEmbeddingDimensions,
      };
    } catch (error) {
      return {
        configured: false,
        errorCode: routeDiagnosticErrorCode(error),
        errorMessage: routeDiagnosticErrorMessage(error),
        fallbackOrder: [],
        preparedRoutes: [],
        preparedProviderCount: 0,
        requestedModelId: modelId,
        dimensionMismatch: false,
      };
    }
  }

  async embed(
    modelId: string | undefined,
    input: string | string[],
    options?: CopilotEmbeddingOptions
  ) {
    return await this.executePlan(
      () => this.plans.buildEmbeddingPlan(modelId, input, options),
      plan => this.engine.execute(plan)
    );
  }

  async rerankConfigured(modelId?: string, options?: CopilotChatOptions) {
    return (await this.describeRerankRoute(modelId, options)).configured;
  }

  async describeRerankRoute(
    modelId?: string,
    options?: CopilotChatOptions
  ): Promise<RerankRouteDiagnostics> {
    const probeRequest: CopilotRerankRequest = {
      query: 'ping',
      candidates: [{ text: 'ping' }],
    };

    try {
      const plan = await this.plans.buildRerankPlan(
        modelId,
        probeRequest,
        options
      );
      const prepared = plan.nativeDispatch?.rerank?.prepared;
      const preparedRouteDiagnostics = this.describePreparedTaskRoutes(
        plan.nativeDispatch?.rerank?.preparedRoutes
      );
      const selectedPreparedRoute = preparedRouteDiagnostics[0];

      return {
        configured: this.hasNativeDispatch(plan, 'rerank'),
        fallbackOrder: plan.routePolicy.fallbackOrder,
        preparedRoutes: preparedRouteDiagnostics,
        preparedProviderCount:
          plan.nativeDispatch?.rerank?.preparedRoutes?.length ??
          plan.nativeDispatch?.rerank?.routes?.length ??
          plan.routePolicy.fallbackOrder.length,
        requestedModelId: modelId,
        providerId: prepared?.route.providerId,
        modelId: prepared?.route.model,
        protocol: prepared?.route.protocol,
        requestLayer: prepared?.route.backendConfig.request_layer,
        modelBackendKind: prepared?.modelDefinition?.backendKind,
        canonicalModelKey: prepared?.modelDefinition?.canonicalKey,
        behaviorFlags: prepared?.modelDefinition?.behaviorFlags,
        providerConfiguredModelCount:
          selectedPreparedRoute?.providerConfiguredModelCount,
        providerConfiguredModelIds:
          selectedPreparedRoute?.providerConfiguredModelIds,
        providerName: selectedPreparedRoute?.providerName,
        providerPriority: selectedPreparedRoute?.providerPriority,
        providerProfileConfigPath:
          selectedPreparedRoute?.providerProfileConfigPath,
        providerProfileId: selectedPreparedRoute?.providerProfileId,
        providerProfileSource: selectedPreparedRoute?.providerProfileSource,
        providerSource: selectedPreparedRoute?.providerSource,
        providerType: selectedPreparedRoute?.providerType,
        topK: prepared?.request.topN,
        candidateCount: prepared?.request.candidates.length,
      };
    } catch (error) {
      return {
        configured: false,
        errorCode: routeDiagnosticErrorCode(error),
        errorMessage: routeDiagnosticErrorMessage(error),
        fallbackOrder: [],
        preparedRoutes: [],
        preparedProviderCount: 0,
        requestedModelId: modelId,
      };
    }
  }

  async rerank(
    modelId: string | undefined,
    request: CopilotRerankRequest,
    options?: CopilotChatOptions
  ) {
    return await this.executePlan(
      () => this.plans.buildRerankPlan(modelId, request, options),
      plan => this.engine.execute(plan)
    );
  }

  async *streamImageArtifacts(
    cond: ModelConditions,
    messages: PromptMessage[],
    options?: CopilotImageOptions,
    filter?: ProviderFilter
  ): AsyncIterableIterator<NativeImageArtifact> {
    yield* this.executeStreamPlan(
      () => this.plans.buildImagePlan(cond, messages, options, filter),
      plan => this.engine.executeImageArtifacts(plan)
    );
  }
}
