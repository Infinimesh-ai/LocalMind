import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Prisma as PrismaClient } from '@prisma/client';

import { BaseModel } from './base';
import { normalizeActionModelSelectionSource } from './copilot-action-model-selection';
import {
  AI_ACTION_RUN_AGENT_RUNTIME_PROJECTION_SOURCE,
  AI_ACTION_RUN_AGENT_RUNTIME_SCHEMA_READINESS,
  getActionRunAgentRuntimeProjectedRunStatuses,
  getActionRunAgentRuntimeProjectedSchemaComponents,
  getActionRunAgentRuntimeProjectedStepStatuses,
  getActionRunAgentRuntimeProjectedStepTypes,
  getActionRunAgentRuntimeProjectedTimelineEventTypes,
  getActionRunAgentRuntimeProjectionGaps,
  getActionRunAgentRuntimeRunStatusGaps,
  getActionRunAgentRuntimeSchemaReadinessGaps,
  getActionRunAgentRuntimeStepStatusGaps,
  getActionRunAgentRuntimeTimelineGaps,
  getActionRunAgentRuntimeUnsupportedRunStatuses,
  getActionRunAgentRuntimeUnsupportedStepStatuses,
  getActionRunAgentRuntimeUnsupportedStepTypes,
  getActionRunAgentRuntimeUnsupportedTimelineEventTypes,
  getAgentRuntimeTargetRunStatuses,
  getAgentRuntimeTargetSchemaComponents,
  getAgentRuntimeTargetStepStatuses,
  getAgentRuntimeTargetStepTypes,
  getAgentRuntimeTargetTimelineEventTypes,
  mapActionRunStatusToAgentRuntimeStatus,
  mapActionRunStatusToAgentRuntimeStepStatus,
} from './copilot-agent-runtime-projection';

export type AiActionRunStatus =
  | 'created'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'aborted';

export type CopilotActionRunPreparedRouteTrace = {
  type: 'prepared_routes';
  status: 'succeeded';
  steps: Array<{
    stepId: string;
    kind: 'structured' | 'image';
    routeCount: number;
    actualRouteCount: number;
    routeCountMismatch: boolean;
    requestedModelId?: string;
    requestedModelSource?: string;
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

export type CopilotActionRunAgentRuntimeTimelineItem = {
  id: string;
  eventType: string;
  label: string;
  runId: string;
  stepId: string | null;
  stepType: string | null;
  status: string;
  kind: string | null;
  routeCount: number;
  actualRouteCount: number;
};

export type CopilotActionRunDiagnosticsItem = {
  id: string;
  actionId: string;
  actionVersion: string;
  agentRuntimeNativeTraceEventTypes: string[];
  agentRuntimeProjectedSchemaComponents: string[];
  agentRuntimeProjectedRunStatuses: string[];
  agentRuntimeProjectedStepStatuses: string[];
  agentRuntimeProjectedStepTypes: string[];
  agentRuntimeProjectedTimelineEventTypes: string[];
  agentRuntimeProjectionSource: string;
  agentRuntimeProjectionGaps: string[];
  agentRuntimeRunStatusGaps: string[];
  agentRuntimeRunId: string;
  agentRuntimeRunStatus: string;
  agentRuntimeSchemaReadiness: string;
  agentRuntimeSchemaReadinessGaps: string[];
  agentRuntimeStepCount: number;
  agentRuntimeStepStatusGaps: string[];
  agentRuntimeStepIds: string[];
  agentRuntimeStepKinds: string[];
  agentRuntimeStepStatuses: string[];
  agentRuntimeStepTypes: string[];
  agentRuntimeTimelineEntries: string[];
  agentRuntimeTimelineEventTypes: string[];
  agentRuntimeTimelineGaps: string[];
  agentRuntimeTimelineItems: CopilotActionRunAgentRuntimeTimelineItem[];
  agentRuntimeTargetRunStatuses: string[];
  agentRuntimeTargetSchemaComponents: string[];
  agentRuntimeTargetStepStatuses: string[];
  agentRuntimeTargetStepTypes: string[];
  agentRuntimeTargetTimelineEventTypes: string[];
  agentRuntimeUnsupportedRunStatuses: string[];
  agentRuntimeUnsupportedStepStatuses: string[];
  agentRuntimeUnsupportedStepTypes: string[];
  agentRuntimeUnsupportedTimelineEventTypes: string[];
  status: string;
  attempt: number;
  retryOf: string | null;
  docId: string | null;
  sessionId: string | null;
  errorCode: string | null;
  hasPreparedRouteTrace: boolean;
  preparedRouteStepCount: number;
  preparedRouteCount: number;
  preparedRouteActualCount: number;
  preparedRouteStepRouteCounts: string[];
  preparedRouteStepRouteCountMismatches: string[];
  preparedRouteStepIds: string[];
  preparedRouteKinds: string[];
  preparedRouteOrder: string[];
  preparedRouteFallbackOrder: string[];
  preparedRouteProtocols: string[];
  preparedRouteRequestLayers: string[];
  preparedRouteStepOrder: string[];
  preparedRouteStepFallbackOrder: string[];
  preparedRouteStepProtocols: string[];
  preparedRouteStepRequestLayers: string[];
  preparedRouteModelIds: string[];
  preparedRouteRequestedModelIds: string[];
  preparedRouteRequestedModelSources: string[];
  preparedRouteStepRequestedModelSources: string[];
  preparedRouteProviderIds: string[];
  preparedRouteTargets: string[];
  preparedRouteStepTargets: string[];
  preparedRouteRequestedTargets: string[];
  preparedRouteStepRequestedTargets: string[];
  preparedRouteFallbackProviderIds: string[];
  preparedRouteStepFallbackProviderIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

function nullableJson(
  value: unknown
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return value === undefined
    ? PrismaClient.JsonNull
    : (value as Prisma.InputJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPreparedRouteKind(
  kind: unknown
): kind is CopilotActionRunPreparedRouteTrace['steps'][number]['kind'] {
  return kind === 'structured' || kind === 'image';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function uniqueNonEmptyStrings(values: Array<string | undefined>) {
  return Array.from(
    new Set(
      values
        .map(value => value?.trim())
        .filter((value): value is string => !!value)
    )
  );
}

function normalizeNativeTraceEventType(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const eventType = value.trim();

  return /^[a-zA-Z0-9_.:-]{1,80}$/.test(eventType) ? eventType : undefined;
}

function extractNativeTraceEventTypes(value: unknown) {
  if (!isRecord(value)) {
    return [];
  }

  const nativeTrace = isRecord(value.native) ? value.native : value;
  if (!Array.isArray(nativeTrace.lightweight)) {
    return [];
  }

  return uniqueNonEmptyStrings(
    nativeTrace.lightweight.map(event =>
      isRecord(event) ? normalizeNativeTraceEventType(event.type) : undefined
    )
  );
}

function normalizePreparedRouteTraceStep(
  value: unknown
): CopilotActionRunPreparedRouteTrace['steps'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.stepId !== 'string' || !isPreparedRouteKind(value.kind)) {
    return null;
  }

  const routes = Array.isArray(value.routes)
    ? value.routes.flatMap(route => {
        if (
          !isRecord(route) ||
          typeof route.providerId !== 'string' ||
          typeof route.modelId !== 'string'
        ) {
          return [];
        }

        return [
          {
            providerId: route.providerId,
            modelId: route.modelId,
            routeIndex:
              typeof route.routeIndex === 'number' &&
              Number.isSafeInteger(route.routeIndex) &&
              route.routeIndex >= 0
                ? route.routeIndex
                : -1,
            ...(typeof route.fallbackOrderIndex === 'number' &&
            Number.isSafeInteger(route.fallbackOrderIndex) &&
            route.fallbackOrderIndex >= 0
              ? { fallbackOrderIndex: route.fallbackOrderIndex }
              : {}),
            ...(typeof route.protocol === 'string'
              ? { protocol: route.protocol }
              : {}),
            ...(typeof route.requestLayer === 'string'
              ? { requestLayer: route.requestLayer }
              : {}),
            ...(typeof route.providerName === 'string'
              ? { providerName: route.providerName }
              : {}),
            ...(typeof route.providerSource === 'string'
              ? { providerSource: route.providerSource }
              : {}),
            ...(typeof route.providerProfileId === 'string'
              ? { providerProfileId: route.providerProfileId }
              : {}),
            ...(typeof route.providerProfileSource === 'string'
              ? { providerProfileSource: route.providerProfileSource }
              : {}),
            ...(typeof route.providerProfileConfigPath === 'string'
              ? { providerProfileConfigPath: route.providerProfileConfigPath }
              : {}),
            ...(Array.isArray(route.providerConfiguredModelIds)
              ? {
                  providerConfiguredModelIds:
                    route.providerConfiguredModelIds.filter(
                      (modelId): modelId is string =>
                        typeof modelId === 'string'
                    ),
                }
              : {}),
            ...(typeof route.providerConfiguredModelCount === 'number' &&
            Number.isSafeInteger(route.providerConfiguredModelCount) &&
            route.providerConfiguredModelCount >= 0
              ? {
                  providerConfiguredModelCount:
                    route.providerConfiguredModelCount,
                }
              : {}),
            ...(typeof route.providerType === 'string'
              ? { providerType: route.providerType }
              : {}),
            ...(typeof route.providerPrivacy === 'string'
              ? { providerPrivacy: route.providerPrivacy }
              : {}),
            ...(typeof route.providerHealth === 'string'
              ? { providerHealth: route.providerHealth }
              : {}),
            ...(typeof route.providerHealthCheckedAt === 'string'
              ? { providerHealthCheckedAt: route.providerHealthCheckedAt }
              : {}),
            ...(typeof route.providerHealthLastError === 'string'
              ? { providerHealthLastError: route.providerHealthLastError }
              : {}),
            ...(typeof route.providerPriority === 'number' &&
            Number.isSafeInteger(route.providerPriority)
              ? { providerPriority: route.providerPriority }
              : {}),
            ...(typeof route.routeModelAliasMatched === 'boolean'
              ? { routeModelAliasMatched: route.routeModelAliasMatched }
              : {}),
            ...(Array.isArray(route.routeModelDefinitionAliases)
              ? {
                  routeModelDefinitionAliases:
                    route.routeModelDefinitionAliases.filter(
                      (alias): alias is string => typeof alias === 'string'
                    ),
                }
              : {}),
            ...(typeof route.routeModelDefinitionId === 'string'
              ? { routeModelDefinitionId: route.routeModelDefinitionId }
              : {}),
            ...(typeof route.routeModelDefinitionSource === 'string'
              ? { routeModelDefinitionSource: route.routeModelDefinitionSource }
              : {}),
            ...(typeof route.routeRawModelId === 'string'
              ? { routeRawModelId: route.routeRawModelId }
              : {}),
          },
        ];
      })
    : [];
  const indexedRoutes = routes.map((route, index) => ({
    ...route,
    routeIndex:
      typeof route.routeIndex === 'number' &&
      Number.isSafeInteger(route.routeIndex) &&
      route.routeIndex >= 0
        ? route.routeIndex
        : index,
  }));
  const routeCount =
    typeof value.routeCount === 'number' &&
    Number.isSafeInteger(value.routeCount) &&
    value.routeCount >= 0
      ? value.routeCount
      : routes.length;
  const requestedModelSource = normalizeActionModelSelectionSource(
    value.requestedModelSource
  );

  return {
    stepId: value.stepId,
    kind: value.kind,
    routeCount,
    actualRouteCount: indexedRoutes.length,
    routeCountMismatch: routeCount !== indexedRoutes.length,
    ...(typeof value.requestedModelId === 'string'
      ? { requestedModelId: value.requestedModelId }
      : {}),
    ...(requestedModelSource ? { requestedModelSource } : {}),
    fallbackProviderIds: stringArray(value.fallbackProviderIds),
    routes: indexedRoutes,
  };
}

function normalizePreparedRouteTrace(
  value: unknown
): CopilotActionRunPreparedRouteTrace | null {
  if (!isRecord(value)) {
    return null;
  }

  const trace =
    value.type === 'prepared_routes'
      ? value
      : isRecord(value.preparedRoutes)
        ? value.preparedRoutes
        : null;
  if (!trace || trace.type !== 'prepared_routes') {
    return null;
  }

  const steps = Array.isArray(trace.steps)
    ? trace.steps.flatMap(step => {
        const normalized = normalizePreparedRouteTraceStep(step);
        return normalized ? [normalized] : [];
      })
    : [];

  return {
    type: 'prepared_routes',
    status: 'succeeded',
    steps,
  };
}

function summarizePreparedRouteTrace(
  value: unknown,
  status: string,
  runId: string
) {
  const trace = normalizePreparedRouteTrace(value);
  const agentRuntimeRunStatus = mapActionRunStatusToAgentRuntimeStatus(status);
  const agentRuntimeStepStatus =
    mapActionRunStatusToAgentRuntimeStepStatus(status);
  const preparedRouteStepCount = trace?.steps.length ?? 0;
  const preparedRouteCount =
    trace?.steps.reduce((total, step) => total + step.routeCount, 0) ?? 0;
  const preparedRouteActualCount =
    trace?.steps.reduce((total, step) => total + step.routes.length, 0) ?? 0;
  const preparedRouteStepRouteCounts = uniqueNonEmptyStrings(
    trace?.steps.map(
      step => `${step.stepId} -> ${step.routeCount}/${step.routes.length}`
    ) ?? []
  );
  const preparedRouteStepRouteCountMismatches = uniqueNonEmptyStrings(
    trace?.steps.map(step =>
      step.routeCount !== step.routes.length
        ? `${step.stepId} expected ${step.routeCount} actual ${step.routes.length}`
        : undefined
    ) ?? []
  );
  const preparedRouteStepIds = uniqueNonEmptyStrings(
    trace?.steps.map(step => step.stepId) ?? []
  );
  const preparedRouteProviderIds = Array.from(
    new Set(
      trace?.steps.flatMap(step =>
        step.routes.map(route => route.providerId)
      ) ?? []
    )
  );
  const preparedRouteModelIds = Array.from(
    new Set(
      trace?.steps.flatMap(step => step.routes.map(route => route.modelId)) ??
        []
    )
  );
  const preparedRouteRequestedModelIds = uniqueNonEmptyStrings(
    trace?.steps.map(step => step.requestedModelId) ?? []
  );
  const preparedRouteRequestedModelSources = uniqueNonEmptyStrings(
    trace?.steps.map(step => step.requestedModelSource) ?? []
  );
  const preparedRouteStepRequestedModelSources = uniqueNonEmptyStrings(
    trace?.steps.map(step =>
      step.requestedModelSource
        ? `${step.stepId} -> ${step.requestedModelSource}`
        : undefined
    ) ?? []
  );
  const preparedRouteFallbackProviderIds = Array.from(
    new Set(trace?.steps.flatMap(step => step.fallbackProviderIds) ?? [])
  );
  const preparedRouteStepFallbackProviderIds = uniqueNonEmptyStrings(
    trace?.steps.map(step =>
      step.fallbackProviderIds.length
        ? `${step.stepId} -> ${step.fallbackProviderIds.join(' -> ')}`
        : undefined
    ) ?? []
  );
  const preparedRouteTargets = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.routes.map(route => `${route.providerId}/${route.modelId}`)
    ) ?? []
  );
  const preparedRouteStepTargets = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.routes.map(
        route => `${step.stepId} -> ${route.providerId}/${route.modelId}`
      )
    ) ?? []
  );
  const preparedRouteRequestedTargets = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.requestedModelId
        ? step.routes.map(
            route =>
              `${step.requestedModelId} -> ${route.providerId}/${route.modelId}`
          )
        : []
    ) ?? []
  );
  const preparedRouteStepRequestedTargets = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.requestedModelId
        ? step.routes.map(
            route =>
              `${step.stepId} / ${step.requestedModelId} -> ${route.providerId}/${route.modelId}`
          )
        : []
    ) ?? []
  );
  const preparedRouteKinds = uniqueNonEmptyStrings(
    trace?.steps.map(step => step.kind) ?? []
  );
  const preparedRouteOrder = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.routes.map(
        route => `${route.routeIndex} -> ${route.providerId}/${route.modelId}`
      )
    ) ?? []
  );
  const preparedRouteFallbackOrder = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.routes.map(route =>
        route.fallbackOrderIndex !== undefined
          ? `${route.fallbackOrderIndex} -> ${route.providerId}/${route.modelId}`
          : undefined
      )
    ) ?? []
  );
  const preparedRouteProtocols = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step => step.routes.map(route => route.protocol)) ?? []
  );
  const preparedRouteRequestLayers = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.routes.map(route => route.requestLayer)
    ) ?? []
  );
  const preparedRouteStepProtocols = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.routes.map(route =>
        route.protocol ? `${step.stepId} -> ${route.protocol}` : undefined
      )
    ) ?? []
  );
  const preparedRouteStepRequestLayers = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.routes.map(route =>
        route.requestLayer
          ? `${step.stepId} -> ${route.requestLayer}`
          : undefined
      )
    ) ?? []
  );
  const preparedRouteStepOrder = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.routes.map(
        route =>
          `${step.stepId} / ${route.routeIndex} -> ${route.providerId}/${route.modelId}`
      )
    ) ?? []
  );
  const preparedRouteStepFallbackOrder = uniqueNonEmptyStrings(
    trace?.steps.flatMap(step =>
      step.routes.map(route =>
        route.fallbackOrderIndex !== undefined
          ? `${step.stepId} / ${route.fallbackOrderIndex} -> ${route.providerId}/${route.modelId}`
          : undefined
      )
    ) ?? []
  );
  const agentRuntimeStepIds = uniqueNonEmptyStrings(
    trace?.steps.map(step => step.stepId) ?? []
  );
  const agentRuntimeStepKinds = uniqueNonEmptyStrings(
    trace?.steps.map(step => `${step.stepId} -> ${step.kind}`) ?? []
  );
  const agentRuntimeStepStatuses = uniqueNonEmptyStrings(
    trace?.steps.map(step => `${step.stepId} -> ${agentRuntimeStepStatus}`) ??
      []
  );
  const agentRuntimeProjectedStepTypes =
    getActionRunAgentRuntimeProjectedStepTypes();
  const agentRuntimeProjectedPreparedRouteStepType =
    agentRuntimeProjectedStepTypes[0] ?? 'model';
  const agentRuntimeStepTypes = uniqueNonEmptyStrings(
    trace?.steps.map(
      step => `${step.stepId} -> ${agentRuntimeProjectedPreparedRouteStepType}`
    ) ?? []
  );
  const agentRuntimeNativeTraceEventTypes = extractNativeTraceEventTypes(value);
  const agentRuntimeProjectedSchemaComponents =
    getActionRunAgentRuntimeProjectedSchemaComponents();
  const agentRuntimeProjectedTimelineEventTypes =
    getActionRunAgentRuntimeProjectedTimelineEventTypes();
  const agentRuntimeProjectedRunStatuses =
    getActionRunAgentRuntimeProjectedRunStatuses();
  const agentRuntimeProjectedStepStatuses =
    getActionRunAgentRuntimeProjectedStepStatuses();
  const agentRuntimeTargetStepTypes = getAgentRuntimeTargetStepTypes();
  const agentRuntimeTargetSchemaComponents =
    getAgentRuntimeTargetSchemaComponents();
  const agentRuntimeTargetStepStatuses = getAgentRuntimeTargetStepStatuses();
  const agentRuntimeTargetTimelineEventTypes =
    getAgentRuntimeTargetTimelineEventTypes();
  const agentRuntimeTargetRunStatuses = getAgentRuntimeTargetRunStatuses();
  const agentRuntimeUnsupportedRunStatuses =
    getActionRunAgentRuntimeUnsupportedRunStatuses();
  const agentRuntimeUnsupportedStepStatuses =
    getActionRunAgentRuntimeUnsupportedStepStatuses();
  const agentRuntimeUnsupportedStepTypes =
    getActionRunAgentRuntimeUnsupportedStepTypes();
  const agentRuntimeUnsupportedTimelineEventTypes =
    getActionRunAgentRuntimeUnsupportedTimelineEventTypes();
  const agentRuntimeRunStatusGaps = uniqueNonEmptyStrings(
    getActionRunAgentRuntimeRunStatusGaps()
  );
  const agentRuntimeStepStatusGaps = uniqueNonEmptyStrings(
    getActionRunAgentRuntimeStepStatusGaps()
  );
  const agentRuntimeSchemaReadinessGaps = uniqueNonEmptyStrings(
    getActionRunAgentRuntimeSchemaReadinessGaps()
  );
  const agentRuntimeProjectionGaps = uniqueNonEmptyStrings(
    getActionRunAgentRuntimeProjectionGaps({
      hasPreparedRouteTrace: !!trace,
    })
  );
  const agentRuntimeTimelineGaps = uniqueNonEmptyStrings(
    getActionRunAgentRuntimeTimelineGaps({
      hasPreparedRouteTrace: !!trace,
    })
  );
  const agentRuntimeTimelineEventTypes = uniqueNonEmptyStrings([
    'run_status',
    ...(trace?.steps.map(() => 'model_step') ?? []),
  ]);
  const agentRuntimeTimelineEntries = uniqueNonEmptyStrings([
    `run -> ${agentRuntimeRunStatus}`,
    ...(trace?.steps.map(
      step =>
        `${step.stepId} -> model_step -> ${agentRuntimeStepStatus} -> ${step.kind} -> ${step.routes.length}/${step.routeCount}`
    ) ?? []),
  ]);
  const agentRuntimeTimelineItems: CopilotActionRunAgentRuntimeTimelineItem[] =
    [
      {
        id: `${runId}:run_status`,
        eventType: 'run_status',
        label: `run -> ${agentRuntimeRunStatus}`,
        runId,
        stepId: null,
        stepType: null,
        status: agentRuntimeRunStatus,
        kind: null,
        routeCount: preparedRouteCount,
        actualRouteCount: preparedRouteActualCount,
      },
      ...(trace?.steps.map((step, index) => ({
        id: `${runId}:${index}:${step.stepId}:model_step`,
        eventType: 'model_step',
        label: `${step.stepId} -> model_step -> ${agentRuntimeStepStatus} -> ${step.kind} -> ${step.routes.length}/${step.routeCount}`,
        runId,
        stepId: step.stepId,
        stepType: agentRuntimeProjectedPreparedRouteStepType,
        status: agentRuntimeStepStatus,
        kind: step.kind,
        routeCount: step.routeCount,
        actualRouteCount: step.routes.length,
      })) ?? []),
    ];

  return {
    agentRuntimeNativeTraceEventTypes,
    agentRuntimeProjectedSchemaComponents,
    agentRuntimeProjectedRunStatuses,
    agentRuntimeProjectedStepStatuses,
    agentRuntimeProjectedStepTypes,
    agentRuntimeProjectedTimelineEventTypes,
    agentRuntimeProjectionSource: AI_ACTION_RUN_AGENT_RUNTIME_PROJECTION_SOURCE,
    agentRuntimeProjectionGaps,
    agentRuntimeRunStatusGaps,
    agentRuntimeRunId: runId,
    agentRuntimeRunStatus,
    agentRuntimeSchemaReadiness: AI_ACTION_RUN_AGENT_RUNTIME_SCHEMA_READINESS,
    agentRuntimeSchemaReadinessGaps,
    agentRuntimeStepCount: agentRuntimeStepIds.length,
    agentRuntimeStepStatusGaps,
    agentRuntimeStepIds,
    agentRuntimeStepKinds,
    agentRuntimeStepStatuses,
    agentRuntimeStepTypes,
    agentRuntimeTimelineEntries,
    agentRuntimeTimelineEventTypes,
    agentRuntimeTimelineGaps,
    agentRuntimeTimelineItems,
    agentRuntimeTargetRunStatuses,
    agentRuntimeTargetSchemaComponents,
    agentRuntimeTargetStepStatuses,
    agentRuntimeTargetStepTypes,
    agentRuntimeTargetTimelineEventTypes,
    agentRuntimeUnsupportedRunStatuses,
    agentRuntimeUnsupportedStepStatuses,
    agentRuntimeUnsupportedStepTypes,
    agentRuntimeUnsupportedTimelineEventTypes,
    hasPreparedRouteTrace: !!trace,
    preparedRouteActualCount,
    preparedRouteCount,
    preparedRouteFallbackProviderIds,
    preparedRouteKinds,
    preparedRouteModelIds,
    preparedRouteOrder,
    preparedRouteFallbackOrder,
    preparedRouteProtocols,
    preparedRouteProviderIds,
    preparedRouteRequestedModelIds,
    preparedRouteRequestedModelSources,
    preparedRouteStepRequestedModelSources,
    preparedRouteRequestLayers,
    preparedRouteStepOrder,
    preparedRouteStepFallbackOrder,
    preparedRouteStepProtocols,
    preparedRouteStepRequestLayers,
    preparedRouteStepCount,
    preparedRouteStepFallbackProviderIds,
    preparedRouteStepIds,
    preparedRouteStepRouteCounts,
    preparedRouteStepRouteCountMismatches,
    preparedRouteStepTargets,
    preparedRouteTargets,
    preparedRouteRequestedTargets,
    preparedRouteStepRequestedTargets,
  };
}

@Injectable()
export class CopilotActionRunModel extends BaseModel {
  async create(
    input: Pick<
      Prisma.AiActionRunCreateArgs['data'],
      'userId' | 'workspaceId' | 'actionId' | 'actionVersion'
    > & { inputSnapshot?: unknown } & Omit<
        Partial<Prisma.AiActionRunCreateArgs['data']>,
        'inputSnapshot'
      >
  ) {
    return await this.db.aiActionRun.create({
      data: {
        userId: input.userId,
        workspaceId: input.workspaceId,
        docId: input.docId ?? null,
        sessionId: input.sessionId ?? null,
        userMessageId: input.userMessageId ?? null,
        compatSubmissionId: input.compatSubmissionId ?? null,
        actionId: input.actionId,
        actionVersion: input.actionVersion,
        status: 'created',
        attempt: input.attempt ?? 1,
        retryOf: input.retryOf ?? null,
        inputSnapshot: nullableJson(input.inputSnapshot),
      },
    });
  }

  async markRunning(id: string) {
    return await this.db.aiActionRun.update({
      where: { id },
      data: { status: 'running' },
    });
  }

  async complete(
    id: string,
    input: Omit<
      Prisma.AiActionRunUpdateArgs['data'],
      'artifacts' | 'result' | 'trace'
    > & {
      result?: unknown;
      artifacts?: unknown;
      trace?: unknown;
    }
  ) {
    return await this.db.aiActionRun.update({
      where: { id },
      data: {
        status: input.status,
        result: nullableJson(input.result),
        artifacts: nullableJson(input.artifacts),
        resultSummary: input.resultSummary ?? null,
        errorCode: input.errorCode ?? null,
        trace: nullableJson(input.trace),
        assistantMessageId: input.assistantMessageId ?? null,
      },
    });
  }

  async get(id: string) {
    const row = await this.db.aiActionRun.findUnique({ where: { id } });
    return row ?? null;
  }

  async getPreparedRouteTrace(
    id: string,
    scope: { userId?: string; workspaceId?: string } = {}
  ): Promise<CopilotActionRunPreparedRouteTrace | null> {
    const row = await this.db.aiActionRun.findFirst({
      where: {
        id,
        ...(scope.userId ? { userId: scope.userId } : {}),
        ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
      },
      select: { trace: true },
    });

    return normalizePreparedRouteTrace(row?.trace);
  }

  async listRecentDiagnostics(
    scope: { userId: string; workspaceId: string },
    options: { limit?: number } = {}
  ): Promise<CopilotActionRunDiagnosticsItem[]> {
    const take = Math.min(Math.max(options.limit ?? 8, 1), 20);
    const rows = await this.db.aiActionRun.findMany({
      where: {
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take,
      select: {
        id: true,
        actionId: true,
        actionVersion: true,
        status: true,
        attempt: true,
        retryOf: true,
        docId: true,
        sessionId: true,
        errorCode: true,
        trace: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return rows.map(row => {
      const traceSummary = summarizePreparedRouteTrace(
        row.trace,
        row.status,
        row.id
      );

      return {
        id: row.id,
        actionId: row.actionId,
        actionVersion: row.actionVersion,
        status: row.status,
        attempt: row.attempt,
        retryOf: row.retryOf,
        docId: row.docId,
        sessionId: row.sessionId,
        errorCode: row.errorCode,
        ...traceSummary,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async countSucceededByUser(userId: string) {
    return await this.db.aiActionRun.count({
      where: {
        userId,
        status: 'succeeded',
        NOT: {
          actionId: {
            startsWith: 'transcript.audio.',
          },
        },
      },
    });
  }

  async countLegacyPromptActionSessionsWithoutRun(userId: string) {
    return await this.db.aiSession.count({
      where: {
        userId,
        promptAction: {
          not: null,
        },
        NOT: {
          promptAction: '',
        },
        actionRuns: {
          none: {},
        },
      },
    });
  }
}
