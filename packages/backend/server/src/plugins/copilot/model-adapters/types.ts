import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { CopilotChatTools } from '../providers/types';

export const MODEL_ROUTE_LOCK_VERSION = 'copilot-model-route-lock/v1';

export type ModelRouteLock = {
  version: typeof MODEL_ROUTE_LOCK_VERSION;
  providerId: string;
  providerProfileId?: string;
  providerSource?: string;
  providerType?: string;
  modelId: string;
  responseModelId?: string;
  requestedModelId?: string;
  lockedModelId: string;
  routeFingerprint: string;
};

const ModelRouteLockSchema = z
  .object({
    version: z.literal(MODEL_ROUTE_LOCK_VERSION),
    providerId: z.string().trim().min(1),
    providerProfileId: z.string().trim().min(1).optional(),
    providerSource: z.string().trim().min(1).optional(),
    providerType: z.string().trim().min(1).optional(),
    modelId: z.string().trim().min(1),
    responseModelId: z.string().trim().min(1).optional(),
    requestedModelId: z.string().trim().min(1).optional(),
    lockedModelId: z.string().trim().min(1),
    routeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type ModelAdapterCapabilityStatus =
  | 'enabled'
  | 'testing'
  | 'disabled'
  | 'unavailable';

export type ModelAdapterCapabilityId =
  | 'answer'
  | 'document.read'
  | 'document.create'
  | 'document.update'
  | 'document.update_meta'
  | 'document.search'
  | 'workspace.folder'
  | 'artifact'
  | 'attachment'
  | 'web'
  | 'enterprise'
  | 'whiteboard'
  | 'database'
  | 'comment'
  | 'tag'
  | 'collection'
  | 'trash'
  | 'publish'
  | 'history'
  | 'asset';

export type ModelAdapterCapability = {
  id: ModelAdapterCapabilityId;
  status: ModelAdapterCapabilityStatus;
  reason: string;
  releaseGate?: ModelAdapterCapabilityReleaseGate;
};

export type ModelAdapterCapabilityReleaseGate = {
  adapterVersion: string;
  minimumRuns: number;
  totalRuns: number;
  successfulRuns: number;
  falseSuccesses: number;
  duplicateSideEffects: number;
  crossModelFallbacks: number;
};

export type ModelAdapterExecutionMode = 'production' | 'evaluation';

export type ModelAdapterProfile = {
  displayName: string;
  contextWindow: number;
  capabilities: readonly ModelAdapterCapability[];
  evaluationToolCategories: readonly CopilotChatTools[];
  productionToolCategories: readonly CopilotChatTools[];
};

export type ModelAdapterToolPolicy = {
  deduplicateSuccessfulCalls: boolean;
  maxExecutions: number;
  maxFailuresPerFingerprint: number;
  maxFailuresPerTool: number;
  requireDocumentReadBeforeUpdate?: boolean;
  mutationToolNames: readonly string[];
  normalizeArguments?: (
    toolName: string,
    args: Record<string, unknown>
  ) => Record<string, unknown>;
};

export type LocalModelAdapter = {
  id: string;
  version: string;
  profile: ModelAdapterProfile;
  matches: (route: ModelRouteLock) => boolean;
  plannerInstructions: readonly string[];
  toolPolicy?: ModelAdapterToolPolicy;
};

export type ModelAdapterSnapshot = {
  id: string;
  version: string;
  mode: ModelAdapterExecutionMode;
};

export function createModelRouteLock(input: {
  providerId: string;
  providerProfileId?: string;
  providerSource?: string;
  providerType?: string;
  modelId: string;
  responseModelId?: string;
  requestedModelId?: string;
}): ModelRouteLock {
  const lockedModelId = input.modelId.startsWith(`${input.providerId}/`)
    ? input.modelId
    : `${input.providerId}/${input.modelId}`;
  const fingerprintPayload = {
    version: MODEL_ROUTE_LOCK_VERSION,
    providerId: input.providerId,
    providerProfileId: input.providerProfileId ?? null,
    providerSource: input.providerSource ?? null,
    providerType: input.providerType ?? null,
    modelId: input.modelId,
    responseModelId: input.responseModelId ?? null,
    requestedModelId: input.requestedModelId ?? null,
    lockedModelId,
  };
  const routeFingerprint = createHash('sha256')
    .update(JSON.stringify(fingerprintPayload))
    .digest('hex');

  return {
    version: MODEL_ROUTE_LOCK_VERSION,
    providerId: input.providerId,
    ...(input.providerProfileId
      ? { providerProfileId: input.providerProfileId }
      : {}),
    ...(input.providerSource ? { providerSource: input.providerSource } : {}),
    ...(input.providerType ? { providerType: input.providerType } : {}),
    modelId: input.modelId,
    ...(input.responseModelId
      ? { responseModelId: input.responseModelId }
      : {}),
    ...(input.requestedModelId
      ? { requestedModelId: input.requestedModelId }
      : {}),
    lockedModelId,
    routeFingerprint,
  };
}

export function parseModelRouteLock(value: unknown): ModelRouteLock {
  const parsed = ModelRouteLockSchema.parse(value);
  const expected = createModelRouteLock(parsed);
  if (
    parsed.lockedModelId !== expected.lockedModelId ||
    parsed.routeFingerprint !== expected.routeFingerprint
  ) {
    throw new Error('Persisted model route lock integrity check failed');
  }
  return parsed;
}

export function modelAdapterSnapshot(
  adapter: LocalModelAdapter,
  mode: ModelAdapterExecutionMode
): ModelAdapterSnapshot {
  return { id: adapter.id, version: adapter.version, mode };
}

export function modelAdapterToolCategories(
  adapter: LocalModelAdapter,
  mode: ModelAdapterExecutionMode
) {
  return mode === 'evaluation'
    ? adapter.profile.evaluationToolCategories
    : adapter.profile.productionToolCategories;
}

export function modelAdapterReleaseGatePassed(
  gate: ModelAdapterCapabilityReleaseGate,
  adapterVersion: string
) {
  return (
    gate.adapterVersion === adapterVersion &&
    gate.minimumRuns >= 20 &&
    gate.totalRuns >= gate.minimumRuns &&
    gate.successfulRuns === gate.totalRuns &&
    gate.falseSuccesses === 0 &&
    gate.duplicateSideEffects === 0 &&
    gate.crossModelFallbacks === 0
  );
}

export function modelAdapterCapabilityReleased(
  adapter: LocalModelAdapter,
  capabilityId: ModelAdapterCapabilityId
) {
  const capability = adapter.profile.capabilities.find(
    candidate => candidate.id === capabilityId
  );
  return !!(
    capability?.status === 'enabled' &&
    capability.releaseGate &&
    modelAdapterReleaseGatePassed(capability.releaseGate, adapter.version)
  );
}
