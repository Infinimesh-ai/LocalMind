import { Injectable, Optional } from '@nestjs/common';

import { Models } from '../../../models';
import {
  type ActionModelSelectionSource,
  normalizeActionModelSelectionSource,
} from '../../../models/copilot-action-model-selection';
import type { AiActionRunStatus } from '../../../models/copilot-action-run';
import {
  type NativeActionEvent,
  type NativeActionRuntimeInput,
  runNativeActionRecipePreparedStream,
} from '../../../native';
import type {
  CopilotImageOptions,
  CopilotProviderType,
  CopilotStructuredOptions,
  PromptMessage,
} from '../providers/types';
import type { ChatSession } from '../session';
import {
  projectActionResultToAssistantTurn,
  summarizeActionResult,
} from './action-output-projector';
import {
  buildStructuredResponseFromSchemaJson,
  type RequiredStructuredOutputContract,
} from './contracts';
import type { ExecutionRouteDiagnostics } from './contracts/execution-plan-contract';
import { ExecutionPlanBuilder } from './execution-plan';
import { TurnPersistence } from './hosts/turn-persistence';

type ActionRuntimeBridgeNativeInput = Omit<
  NativeActionRuntimeInput,
  'recipeId' | 'recipeVersion'
>;

export type ActionRuntimeBridgeInput = {
  userId: string;
  workspaceId: string;
  docId?: string | null;
  session?: ChatSession;
  userMessageId?: string | null;
  compatSubmissionId?: string | null;
  actionId: string;
  actionVersion: string;
  attempt?: number;
  retryOf?: string | null;
  inputSnapshot?: unknown;
  nativeInput?: ActionRuntimeBridgeNativeInput;
  onRunCreated?: (
    context: ActionRuntimeBridgeRunContext
  ) => Promise<void> | void;
  prepareStructuredRoutes?: {
    stepId?: string;
    modelId?: string;
    modelSelectionSource?: ActionModelSelectionSource | string;
    messages: PromptMessage[];
    options?: CopilotStructuredOptions;
    prefer?: CopilotProviderType;
    responseSchemaJson?: Record<string, unknown>;
    responseContract?: RequiredStructuredOutputContract;
  };
  prepareImageRoutes?: {
    stepId?: string;
    modelId?: string;
    modelSelectionSource?: ActionModelSelectionSource | string;
    messages: PromptMessage[];
    options?: CopilotImageOptions;
    prefer?: CopilotProviderType;
  };
  persistAttachment?: (attachment: unknown) => Promise<unknown> | unknown;
  signal?: AbortSignal;
};

export type ActionRuntimeBridgeEvent = NativeActionEvent & {
  runId: string;
};

export type ActionRuntimeBridgeRunContext = {
  runId: string;
  attempt: number;
};

type PreparedActionRouteTrace = {
  type: 'prepared_routes';
  status: 'succeeded';
  steps: Array<{
    stepId: string;
    kind: 'structured' | 'image';
    routeCount: number;
    requestedModelId?: string;
    requestedModelSource?: ActionModelSelectionSource;
    fallbackProviderIds: string[];
    routes: Array<{
      providerId: string;
      modelId: string;
      routeIndex: number;
      fallbackOrderIndex?: number;
      protocol?: string;
      requestLayer?: string;
      providerConfiguredModelCount?: number;
      providerConfiguredModelIds?: string[];
      providerHealth?: string;
      providerHealthCheckedAt?: string;
      providerHealthLastError?: string;
      providerName?: string;
      providerPrivacy?: string;
      providerPriority?: number;
      providerProfileConfigPath?: string;
      providerProfileId?: string;
      providerProfileSource?: string;
      providerSource?: string;
      providerType?: string;
      routeModelAliasMatched?: boolean;
      routeModelDefinitionAliases?: string[];
      routeModelDefinitionId?: string;
      routeModelDefinitionSource?: string;
      routeRawModelId?: string;
    }>;
  }>;
};

function extractResultArtifacts(result: unknown) {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const value = result as { artifacts?: unknown; attachments?: unknown };
  if (Array.isArray(value.artifacts)) {
    return value.artifacts;
  }
  if (Array.isArray(value.attachments)) {
    return value.attachments;
  }
  return [];
}

function resolveFinalStatus(
  event: NativeActionEvent | undefined,
  signal?: AbortSignal
): Extract<AiActionRunStatus, 'succeeded' | 'failed' | 'aborted'> {
  if (signal?.aborted || event?.status === 'aborted') {
    return 'aborted';
  }
  if (event?.type === 'action_done' && event.status === 'succeeded') {
    return 'succeeded';
  }
  return 'failed';
}

function describePreparedActionRoutes(
  kind: PreparedActionRouteTrace['steps'][number]['kind'],
  stepId: string,
  requestedModelId: string | undefined,
  requestedModelSource: unknown,
  routes: ExecutionRouteDiagnostics[],
  fallbackProviderIds: string[]
): PreparedActionRouteTrace['steps'][number] {
  const normalizedModelSource =
    normalizeActionModelSelectionSource(requestedModelSource);

  return {
    stepId,
    kind,
    routeCount: routes.length,
    ...(requestedModelId ? { requestedModelId } : {}),
    ...(normalizedModelSource
      ? { requestedModelSource: normalizedModelSource }
      : {}),
    fallbackProviderIds,
    routes: routes.map((route, index) => {
      const fallbackOrderIndex = fallbackProviderIds.indexOf(route.providerId);

      return {
        providerId: route.providerId,
        modelId: route.model,
        routeIndex: index,
        ...(fallbackOrderIndex >= 0 ? { fallbackOrderIndex } : {}),
        protocol: route.protocol,
        requestLayer: route.backendConfig.request_layer,
        ...(route.providerName ? { providerName: route.providerName } : {}),
        ...(route.providerSource
          ? { providerSource: route.providerSource }
          : {}),
        ...(route.providerProfileId
          ? { providerProfileId: route.providerProfileId }
          : {}),
        ...(route.providerProfileSource
          ? { providerProfileSource: route.providerProfileSource }
          : {}),
        ...(route.providerProfileConfigPath
          ? { providerProfileConfigPath: route.providerProfileConfigPath }
          : {}),
        ...(route.providerConfiguredModelIds?.length
          ? { providerConfiguredModelIds: route.providerConfiguredModelIds }
          : {}),
        ...(route.providerConfiguredModelCount != null
          ? { providerConfiguredModelCount: route.providerConfiguredModelCount }
          : {}),
        ...(route.providerType ? { providerType: route.providerType } : {}),
        ...(route.providerPrivacy
          ? { providerPrivacy: route.providerPrivacy }
          : {}),
        ...(route.providerHealth
          ? { providerHealth: route.providerHealth }
          : {}),
        ...(route.providerHealthCheckedAt
          ? { providerHealthCheckedAt: route.providerHealthCheckedAt }
          : {}),
        ...(route.providerHealthLastError
          ? { providerHealthLastError: route.providerHealthLastError }
          : {}),
        ...(route.providerPriority != null
          ? { providerPriority: route.providerPriority }
          : {}),
        ...(route.routeModelAliasMatched !== undefined
          ? { routeModelAliasMatched: route.routeModelAliasMatched }
          : {}),
        ...(route.routeModelDefinitionAliases?.length
          ? { routeModelDefinitionAliases: route.routeModelDefinitionAliases }
          : {}),
        ...(route.routeModelDefinitionId
          ? { routeModelDefinitionId: route.routeModelDefinitionId }
          : {}),
        ...(route.routeModelDefinitionSource
          ? { routeModelDefinitionSource: route.routeModelDefinitionSource }
          : {}),
        ...(route.routeRawModelId
          ? { routeRawModelId: route.routeRawModelId }
          : {}),
      };
    }),
  };
}

function mergeActionTrace(
  nativeTrace: unknown,
  preparedRouteTrace: PreparedActionRouteTrace | undefined
) {
  if (!preparedRouteTrace) {
    return nativeTrace;
  }

  if (!nativeTrace) {
    return preparedRouteTrace;
  }

  return {
    native: nativeTrace,
    preparedRoutes: preparedRouteTrace,
  };
}

@Injectable()
export class ActionRuntimeBridge {
  constructor(
    private readonly models: Models,
    private readonly turnPersistence: TurnPersistence,
    @Optional() private readonly plans?: ExecutionPlanBuilder
  ) {}

  protected runNativeStream(
    input: NativeActionRuntimeInput,
    signal?: AbortSignal
  ) {
    return runNativeActionRecipePreparedStream(input, signal);
  }

  private async prepareNativeInput(input: ActionRuntimeBridgeInput): Promise<{
    nativeInput: ActionRuntimeBridgeNativeInput & { input: unknown };
    preparedRouteTrace?: PreparedActionRouteTrace;
  }> {
    const nativeInput = {
      ...input.nativeInput,
      input: input.nativeInput?.input ?? {},
    };
    const structured = input.prepareStructuredRoutes;
    const image = input.prepareImageRoutes;
    if (!structured && !image) {
      return { nativeInput };
    }
    if (!this.plans) {
      throw new Error('Action route preparation is not available');
    }
    const state =
      nativeInput.input && typeof nativeInput.input === 'object'
        ? { ...(nativeInput.input as Record<string, unknown>) }
        : {};
    const preparedRouteSteps: PreparedActionRouteTrace['steps'] = [];

    if (structured) {
      const responseContract =
        structured.responseContract ??
        (buildStructuredResponseFromSchemaJson(
          structured.responseSchemaJson ?? { type: 'object' }
        ) as RequiredStructuredOutputContract);
      const plan = await this.plans.buildStructuredPlan(
        { modelId: structured.modelId },
        structured.messages,
        structured.options,
        structured.prefer ? { prefer: structured.prefer } : undefined,
        responseContract
      );
      const preparedRoutes = plan.nativeDispatch?.structured?.routes;
      if (!preparedRoutes?.length) {
        throw new Error('No native structured provider route prepared');
      }
      const stepId = structured.stepId ?? 'generate';

      const existingPreparedRoutes =
        state.preparedRoutes &&
        typeof state.preparedRoutes === 'object' &&
        !Array.isArray(state.preparedRoutes)
          ? (state.preparedRoutes as Record<string, unknown>)
          : {};
      state.preparedRoutes = {
        ...existingPreparedRoutes,
        [stepId]: preparedRoutes,
      };
      preparedRouteSteps.push(
        describePreparedActionRoutes(
          'structured',
          stepId,
          structured.modelId,
          structured.modelSelectionSource,
          plan.routeDiagnostics ?? [],
          plan.routePolicy.fallbackOrder
        )
      );
    }

    if (image) {
      const plan = await this.plans.buildImagePlan(
        { modelId: image.modelId },
        image.messages,
        image.options,
        image.prefer ? { prefer: image.prefer } : undefined
      );
      const preparedRoutes = plan.nativeDispatch?.image?.routes;
      if (!preparedRoutes?.length) {
        throw new Error('No native image provider route prepared');
      }
      const stepId = image.stepId ?? 'generate-image';

      const existingPreparedRoutes =
        state.preparedRoutes &&
        typeof state.preparedRoutes === 'object' &&
        !Array.isArray(state.preparedRoutes)
          ? (state.preparedRoutes as Record<string, unknown>)
          : {};
      state.preparedRoutes = {
        ...existingPreparedRoutes,
        [stepId]: preparedRoutes,
      };
      preparedRouteSteps.push(
        describePreparedActionRoutes(
          'image',
          stepId,
          image.modelId,
          image.modelSelectionSource,
          plan.routeDiagnostics ?? [],
          plan.routePolicy.fallbackOrder
        )
      );
    }

    return {
      nativeInput: {
        ...nativeInput,
        input: state,
      },
      preparedRouteTrace: preparedRouteSteps.length
        ? {
            type: 'prepared_routes',
            status: 'succeeded',
            steps: preparedRouteSteps,
          }
        : undefined,
    };
  }

  private async projectAssistantResult(
    input: ActionRuntimeBridgeInput,
    result: unknown,
    artifacts: unknown[],
    wasAborted: boolean
  ) {
    if (!input.session) return null;
    const turn = projectActionResultToAssistantTurn({
      session: input.session,
      actionId: input.actionId,
      result,
      artifacts,
      wasAborted,
    });
    if (!turn) return null;
    return await this.turnPersistence.persistProjectedResult(
      input.session,
      turn,
      wasAborted
    );
  }

  private async resolveAttempt(input: ActionRuntimeBridgeInput) {
    if (!input.retryOf) {
      return input.attempt ?? 1;
    }

    const previous = await this.models.copilotActionRun.get(input.retryOf);
    if (!previous) {
      throw new Error('Retry source action run not found');
    }
    if (
      previous.userId !== input.userId ||
      previous.workspaceId !== input.workspaceId ||
      previous.actionId !== input.actionId ||
      previous.actionVersion !== input.actionVersion ||
      previous.sessionId !== (input.session?.config.sessionId ?? null)
    ) {
      throw new Error('Retry source action run does not match current action');
    }
    if (input.attempt && input.attempt <= previous.attempt) {
      throw new Error('Retry attempt must be greater than source action run');
    }
    if (input.attempt) {
      return input.attempt;
    }
    return (previous?.attempt ?? 1) + 1;
  }

  async *runStream(
    input: ActionRuntimeBridgeInput
  ): AsyncIterableIterator<ActionRuntimeBridgeEvent> {
    const attempt = await this.resolveAttempt(input);
    const run = await this.models.copilotActionRun.create({
      userId: input.userId,
      workspaceId: input.workspaceId,
      docId: input.docId,
      sessionId: input.session?.config.sessionId,
      userMessageId: input.userMessageId,
      compatSubmissionId: input.compatSubmissionId,
      actionId: input.actionId,
      actionVersion: input.actionVersion,
      attempt,
      retryOf: input.retryOf,
      inputSnapshot: input.inputSnapshot,
    });
    await this.models.copilotActionRun.markRunning(run.id);
    await input.onRunCreated?.({
      runId: run.id,
      attempt,
    });

    const inputWithBillingUnit = this.withBillingUnit(input, run.id);
    let finalEvent: NativeActionEvent | undefined;
    let preparedRouteTrace: PreparedActionRouteTrace | undefined;
    const attachments: unknown[] = [];
    try {
      const prepared = await this.prepareNativeInput({
        ...inputWithBillingUnit,
      });
      preparedRouteTrace = prepared.preparedRouteTrace;
      for await (const event of this.runNativeStream(
        {
          ...prepared.nativeInput,
          recipeId: inputWithBillingUnit.actionId,
          recipeVersion: inputWithBillingUnit.actionVersion,
        },
        inputWithBillingUnit.signal
      )) {
        finalEvent = event;
        let projectedEvent = event;
        if (event.type === 'attachment') {
          const attachment = input.persistAttachment
            ? await input.persistAttachment(event.attachment)
            : event.attachment;
          attachments.push(attachment);
          projectedEvent = { ...event, attachment };
        }
        yield { ...projectedEvent, runId: run.id };
      }
    } catch (error) {
      finalEvent = {
        type: 'error',
        actionId: input.actionId,
        actionVersion: input.actionVersion,
        status: input.signal?.aborted ? 'aborted' : 'failed',
        errorCode: input.signal?.aborted
          ? 'action_aborted'
          : 'action_bridge_stream_error',
        errorMessage:
          error instanceof Error ? error.message : 'action stream failed',
      };
      yield { ...finalEvent, runId: run.id };
    } finally {
      let status = resolveFinalStatus(finalEvent, input.signal);
      const result = finalEvent?.result;
      const artifacts =
        status === 'succeeded'
          ? [...attachments, ...extractResultArtifacts(result)]
          : undefined;
      let assistantMessageId: string | null = null;
      let errorCode = status === 'succeeded' ? null : finalEvent?.errorCode;
      if (status === 'succeeded' || status === 'aborted') {
        try {
          assistantMessageId =
            (await this.projectAssistantResult(
              input,
              result,
              artifacts ?? [],
              status === 'aborted'
            )) ?? null;
        } catch {
          status = 'failed';
          errorCode = 'action_output_projection_failed';
        }
      }

      await this.models.copilotActionRun.complete(run.id, {
        status,
        result: status === 'succeeded' ? result : undefined,
        artifacts: status === 'succeeded' ? artifacts : undefined,
        resultSummary:
          status === 'succeeded' ? summarizeActionResult(result) : null,
        errorCode,
        trace: mergeActionTrace(finalEvent?.trace, preparedRouteTrace),
        assistantMessageId,
      });
    }
  }

  private withBillingUnit(
    input: ActionRuntimeBridgeInput,
    billingUnitId: string
  ): ActionRuntimeBridgeInput {
    return {
      ...input,
      prepareStructuredRoutes: input.prepareStructuredRoutes
        ? {
            ...input.prepareStructuredRoutes,
            options: {
              ...input.prepareStructuredRoutes.options,
              actionId:
                input.prepareStructuredRoutes.options?.actionId ??
                input.actionId,
              billingUnitId:
                input.prepareStructuredRoutes.options?.billingUnitId ??
                billingUnitId,
            },
          }
        : undefined,
      prepareImageRoutes: input.prepareImageRoutes
        ? {
            ...input.prepareImageRoutes,
            options: {
              ...input.prepareImageRoutes.options,
              actionId:
                input.prepareImageRoutes.options?.actionId ?? input.actionId,
              billingUnitId:
                input.prepareImageRoutes.options?.billingUnitId ??
                billingUnitId,
            },
          }
        : undefined,
    };
  }
}
