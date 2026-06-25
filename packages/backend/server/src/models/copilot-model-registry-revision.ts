import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import {
  ModelInputType,
  ModelOutputType,
} from '../plugins/copilot/providers/types';
import { BaseModel } from './base';
import {
  CopilotModelBackendKindValues,
  type CopilotModelDefinition,
  type CopilotModelDefinitionCapability,
  LlmProtocolValues,
  LlmRequestLayerValues,
} from './copilot-registry-definition-types';
import {
  createRegistryRevisionPublishEvent,
  getRegistryRevisionPublishEventHistory,
  type RegistryRevisionPublishEventHistory,
  withRegistryRevisionPublishEventHistory,
} from './copilot-registry-revision-publish-event';

export type ModelRegistrySourceChainEntry = {
  source:
    | 'db_revision'
    | 'provider_profile'
    | 'native_registry'
    | 'config_fallback';
  scope: 'global' | 'workspace';
  status: string;
  actorId?: string;
  fingerprint?: string;
  modelId?: string;
  providerId?: string;
  revision?: string;
  updatedAt?: string;
  workspaceId?: string;
};

export type ModelRegistryRevision = {
  id: string;
  providerId: string;
  modelId: string;
  scopeType: 'global' | 'workspace';
  workspaceId?: string;
  actorId?: string;
  revision: string;
  status: 'active' | 'archived' | 'disabled';
  fingerprint: string;
  modelDefinition: CopilotModelDefinition;
  fallbackSourceChain: ModelRegistrySourceChainEntry[];
  createdAt: Date;
  updatedAt: Date;
};

export type ModelRegistryPublishInput = {
  workspaceId: string;
  actorId: string;
  providerId: string;
  modelId: string;
  revision?: string | null;
  idempotencyKey?: string | null;
  modelDefinition: unknown;
  fallbackSourceChain?: ModelRegistrySourceChainEntry[];
};

export type ModelRegistryRepairExecutorPayload = {
  version: 'model-registry-revision-executor-payload/v1';
  kind: 'model_registry_revision_publish';
  providerId: string;
  modelId: string;
  rawModelId: string;
  displayName?: string;
  aliases: string[];
  modelDefinition: CopilotModelDefinition;
  operationFingerprint: string;
  operationSetFingerprint: string;
  previewFingerprint: string;
  catalogFingerprint: string;
  targetLocatorFingerprint: string;
  candidateEvidenceFingerprints: string[];
  fallbackSourceChain: ModelRegistrySourceChainEntry[];
};

type ModelRegistryRevisionRow = {
  id: string;
  providerId: string;
  modelId: string;
  scopeType: string;
  workspaceId: string | null;
  actorId: string | null;
  revision: string;
  status: string;
  fingerprint: string;
  modelDefinition: unknown;
  fallbackSourceChain: unknown;
  metadata?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ModelRegistryRevisionConflictEvidence = {
  actorId: string | null;
  fallbackSourceChainFingerprint: string;
  fingerprint: string;
  id: string;
  metadataFingerprint: string;
  modelDefinitionFingerprint: string;
  modelId: string;
  providerId: string;
  revision: string;
  scopeType: 'workspace';
  status: 'active';
  workspaceId: string;
};

function stableModelRegistryStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableModelRegistryStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined
          ? null
          : `${JSON.stringify(key)}:${stableModelRegistryStringify(item)}`;
      })
      .filter(Boolean)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function modelRegistryRevisionFingerprint(value: unknown) {
  return createHash('sha256')
    .update(stableModelRegistryStringify(value))
    .digest('hex')
    .slice(0, 16);
}

const MODEL_REGISTRY_SOURCE_CHAIN_SOURCES = new Set([
  'db_revision',
  'provider_profile',
  'native_registry',
  'config_fallback',
]);
const MODEL_REGISTRY_SOURCE_CHAIN_SCOPES = new Set(['global', 'workspace']);
const MODEL_REGISTRY_SOURCE_CHAIN_STATUSES = new Set([
  'active',
  'available',
  'disabled',
  'provider_available',
]);
const MODEL_REGISTRY_REVISION_SCOPE_TYPES = new Set(['global', 'workspace']);
const MODEL_REGISTRY_REVISION_STATUSES = new Set([
  'active',
  'archived',
  'disabled',
]);
const SOURCE_CHAIN_MAX_ENTRIES = 16;
const SOURCE_CHAIN_OPTIONAL_STRING_MAX_LENGTH = 512;
const REGISTRY_PAYLOAD_STRING_MAX_LENGTH = 512;
const REGISTRY_METADATA_JSON_MAX_LENGTH = 16 * 1024;
const MODEL_DEFINITION_JSON_MAX_LENGTH = 32 * 1024;
const REPAIR_REVISION_PREFIX = 'repair-';

function isSourceChainEntry(
  value: unknown
): value is ModelRegistrySourceChainEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ModelRegistrySourceChainEntry).source === 'string' &&
    typeof (value as ModelRegistrySourceChainEntry).scope === 'string' &&
    typeof (value as ModelRegistrySourceChainEntry).status === 'string' &&
    MODEL_REGISTRY_SOURCE_CHAIN_SOURCES.has(
      (value as ModelRegistrySourceChainEntry).source
    ) &&
    MODEL_REGISTRY_SOURCE_CHAIN_SCOPES.has(
      (value as ModelRegistrySourceChainEntry).scope
    ) &&
    MODEL_REGISTRY_SOURCE_CHAIN_STATUSES.has(
      (value as ModelRegistrySourceChainEntry).status
    )
  );
}

function normalizeSourceChain(value: unknown): ModelRegistrySourceChainEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isSourceChainEntry)
    .slice(0, SOURCE_CHAIN_MAX_ENTRIES)
    .map(entry => {
      const actorId = sourceChainString(entry.actorId);
      const fingerprint = sourceChainString(entry.fingerprint);
      const modelId = sourceChainString(entry.modelId);
      const providerId = sourceChainString(entry.providerId);
      const revision = sourceChainString(entry.revision);
      const updatedAt = sourceChainString(entry.updatedAt);
      const workspaceId = sourceChainString(entry.workspaceId);

      return {
        source: entry.source,
        scope: entry.scope,
        status: entry.status,
        ...(actorId ? { actorId } : {}),
        ...(fingerprint ? { fingerprint } : {}),
        ...(modelId ? { modelId } : {}),
        ...(providerId ? { providerId } : {}),
        ...(revision ? { revision } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      };
    });
}

function sourceChainString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed && trimmed.length <= SOURCE_CHAIN_OPTIONAL_STRING_MAX_LENGTH
    ? trimmed
    : undefined;
}

function stringsFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => {
          return (
            typeof item === 'string' &&
            item.trim().length > 0 &&
            item.trim().length <= REGISTRY_PAYLOAD_STRING_MAX_LENGTH
          );
        })
        .map(item => item.trim())
    ),
  ];
}

function requireStringField(
  value: Record<string, unknown>,
  field: string
): string {
  const item = value[field];
  if (typeof item !== 'string') {
    throw new Error(
      `Invalid repair execution executor payload field: ${field}`
    );
  }
  const normalized = item.trim();
  if (!normalized || normalized.length > REGISTRY_PAYLOAD_STRING_MAX_LENGTH) {
    throw new Error(
      `Invalid repair execution executor payload field: ${field}`
    );
  }
  return normalized;
}

function requirePublishString(
  value: unknown,
  field: string,
  maxLength = REGISTRY_PAYLOAD_STRING_MAX_LENGTH
): string {
  if (typeof value !== 'string') {
    throw new Error(`Model registry publish requires ${field}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Model registry publish requires ${field}`);
  }
  return normalized;
}

function optionalPublishString(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Model registry publish contains invalid ${field}`);
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > REGISTRY_PAYLOAD_STRING_MAX_LENGTH) {
    throw new Error(`Model registry publish contains invalid ${field}`);
  }
  return normalized;
}

function toRegistryMetadataJsonString(
  metadata: Record<string, unknown>
): string {
  const serialized = JSON.stringify(metadata);
  if (serialized.length > REGISTRY_METADATA_JSON_MAX_LENGTH) {
    throw new Error('Model registry publish metadata is too large');
  }
  return serialized;
}

function requireRepairExecutionRequestId(value: unknown): string {
  return requirePublishString(
    value,
    'executionRequestId',
    REGISTRY_PAYLOAD_STRING_MAX_LENGTH - REPAIR_REVISION_PREFIX.length
  );
}

function optionalStringField(
  value: Record<string, unknown>,
  field: string
): string | undefined {
  const item = value[field];
  if (typeof item !== 'string') {
    return undefined;
  }
  const normalized = item.trim();
  return normalized && normalized.length <= REGISTRY_PAYLOAD_STRING_MAX_LENGTH
    ? normalized
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= REGISTRY_PAYLOAD_STRING_MAX_LENGTH
    ? normalized
    : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

const MODEL_BACKEND_KINDS = new Set<string>(CopilotModelBackendKindValues);
const LLM_PROTOCOLS = new Set<string>(LlmProtocolValues);
const LLM_REQUEST_LAYERS = new Set<string>(LlmRequestLayerValues);

function sanitizeRouteOverride(
  value: unknown
):
  | NonNullable<
      NonNullable<CopilotModelDefinition['routeOverrides']>[keyof NonNullable<
        CopilotModelDefinition['routeOverrides']
      >]
    >
  | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const protocol = optionalString(record.protocol);
  const requestLayer = optionalString(record.requestLayer);
  return {
    ...(protocol && LLM_PROTOCOLS.has(protocol)
      ? { protocol: protocol as CopilotModelDefinition['protocol'] }
      : {}),
    ...(requestLayer && LLM_REQUEST_LAYERS.has(requestLayer)
      ? { requestLayer: requestLayer as CopilotModelDefinition['requestLayer'] }
      : {}),
  };
}

function sanitizeRouteOverrides(
  value: unknown
): CopilotModelDefinition['routeOverrides'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const outputTypes = new Set<string>(Object.values(ModelOutputType));
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => outputTypes.has(key))
    .map(([key, override]) => [key, sanitizeRouteOverride(override)] as const)
    .filter(
      (
        entry
      ): entry is readonly [
        string,
        NonNullable<ReturnType<typeof sanitizeRouteOverride>>,
      ] => {
        return !!entry[1] && Object.keys(entry[1]).length > 0;
      }
    );

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function sanitizeAttachmentCapability(
  value: unknown
): CopilotModelDefinitionCapability['attachments'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const kinds = stringsFromUnknown(record.kinds);
  if (!kinds.length) {
    return undefined;
  }

  return {
    kinds: kinds as NonNullable<
      CopilotModelDefinitionCapability['attachments']
    >['kinds'],
    ...(stringsFromUnknown(record.sourceKinds).length
      ? {
          sourceKinds: stringsFromUnknown(record.sourceKinds) as NonNullable<
            CopilotModelDefinitionCapability['attachments']
          >['sourceKinds'],
        }
      : {}),
    ...(optionalBoolean(record.allowRemoteUrls) !== undefined
      ? { allowRemoteUrls: optionalBoolean(record.allowRemoteUrls) }
      : {}),
  };
}

function sanitizeModelCapability(
  value: unknown
): CopilotModelDefinitionCapability | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const inputTypes = new Set<string>(Object.values(ModelInputType));
  const outputTypes = new Set<string>(Object.values(ModelOutputType));
  const input = stringsFromUnknown(record.input).filter(item =>
    inputTypes.has(item)
  ) as CopilotModelDefinitionCapability['input'];
  const output = stringsFromUnknown(record.output).filter(item =>
    outputTypes.has(item)
  ) as CopilotModelDefinitionCapability['output'];
  if (!input.length || !output.length) {
    return null;
  }

  const attachments = sanitizeAttachmentCapability(record.attachments);
  const structuredAttachments = sanitizeAttachmentCapability(
    record.structuredAttachments
  );

  return {
    input,
    output,
    ...(attachments ? { attachments } : {}),
    ...(structuredAttachments ? { structuredAttachments } : {}),
    ...(optionalBoolean(record.defaultForOutputType) !== undefined
      ? { defaultForOutputType: optionalBoolean(record.defaultForOutputType) }
      : {}),
  };
}

function sanitizeModelDefinition(
  value: unknown,
  modelId: string
): CopilotModelDefinition {
  if (!value || typeof value !== 'object') {
    throw new Error('Model registry model definition is required');
  }

  const record = value as Record<string, unknown>;
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities
        .map(sanitizeModelCapability)
        .filter(
          (capability): capability is CopilotModelDefinitionCapability =>
            !!capability
        )
    : [];
  if (!capabilities.length) {
    throw new Error(
      `Model registry model definition requires capabilities: ${modelId}`
    );
  }

  const limits =
    record.limits && typeof record.limits === 'object'
      ? {
          ...(optionalPositiveInt(
            (record.limits as Record<string, unknown>).contextWindow
          ) !== undefined
            ? {
                contextWindow: optionalPositiveInt(
                  (record.limits as Record<string, unknown>).contextWindow
                ),
              }
            : {}),
          ...(optionalPositiveInt(
            (record.limits as Record<string, unknown>).maxOutputTokens
          ) !== undefined
            ? {
                maxOutputTokens: optionalPositiveInt(
                  (record.limits as Record<string, unknown>).maxOutputTokens
                ),
              }
            : {}),
          ...(optionalPositiveInt(
            (record.limits as Record<string, unknown>).embeddingDimensions
          ) !== undefined
            ? {
                embeddingDimensions: optionalPositiveInt(
                  (record.limits as Record<string, unknown>).embeddingDimensions
                ),
              }
            : {}),
        }
      : undefined;
  const cost =
    record.cost && typeof record.cost === 'object'
      ? {
          ...(optionalNonNegativeNumber(
            (record.cost as Record<string, unknown>).inputPer1M
          ) !== undefined
            ? {
                inputPer1M: optionalNonNegativeNumber(
                  (record.cost as Record<string, unknown>).inputPer1M
                ),
              }
            : {}),
          ...(optionalNonNegativeNumber(
            (record.cost as Record<string, unknown>).outputPer1M
          ) !== undefined
            ? {
                outputPer1M: optionalNonNegativeNumber(
                  (record.cost as Record<string, unknown>).outputPer1M
                ),
              }
            : {}),
        }
      : undefined;
  const routeOverrides = sanitizeRouteOverrides(record.routeOverrides);
  const backendKind = optionalString(record.backendKind);
  const protocol = optionalString(record.protocol);
  const requestLayer = optionalString(record.requestLayer);

  return {
    id: modelId,
    ...(optionalString(record.rawModelId)
      ? { rawModelId: optionalString(record.rawModelId) }
      : {}),
    ...(optionalString(record.displayName)
      ? { displayName: optionalString(record.displayName) }
      : {}),
    ...(stringsFromUnknown(record.aliases).length
      ? { aliases: stringsFromUnknown(record.aliases) }
      : {}),
    ...(optionalBoolean(record.enabled) !== undefined
      ? { enabled: optionalBoolean(record.enabled) }
      : {}),
    ...(backendKind && MODEL_BACKEND_KINDS.has(backendKind)
      ? { backendKind: backendKind as CopilotModelDefinition['backendKind'] }
      : {}),
    ...(protocol && LLM_PROTOCOLS.has(protocol)
      ? { protocol: protocol as CopilotModelDefinition['protocol'] }
      : {}),
    ...(requestLayer && LLM_REQUEST_LAYERS.has(requestLayer)
      ? { requestLayer: requestLayer as CopilotModelDefinition['requestLayer'] }
      : {}),
    ...(routeOverrides
      ? {
          routeOverrides:
            routeOverrides as CopilotModelDefinition['routeOverrides'],
        }
      : {}),
    ...(stringsFromUnknown(record.behaviorFlags).length
      ? { behaviorFlags: stringsFromUnknown(record.behaviorFlags) }
      : {}),
    ...(limits && Object.keys(limits).length ? { limits } : {}),
    ...(cost && Object.keys(cost).length ? { cost } : {}),
    capabilities,
  };
}

function sanitizeRevision(value: unknown): string | undefined {
  const revision = optionalString(value);
  if (!revision) {
    return undefined;
  }
  if (revision.length > REGISTRY_PAYLOAD_STRING_MAX_LENGTH) {
    throw new Error('Model registry revision is too long');
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(revision)) {
    throw new Error('Model registry revision contains invalid characters');
  }
  return revision;
}

function normalizeModelDefinition(
  value: unknown,
  fallbackId: string
): CopilotModelDefinition {
  if (!value || typeof value !== 'object') {
    return {
      id: fallbackId,
      capabilities: [],
      enabled: false,
    };
  }

  let serialized: string | null = null;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = null;
  }
  if (!serialized || serialized.length > MODEL_DEFINITION_JSON_MAX_LENGTH) {
    return {
      id: fallbackId,
      capabilities: [],
      enabled: false,
    };
  }

  try {
    return sanitizeModelDefinition(value, fallbackId);
  } catch {
    return {
      id: fallbackId,
      capabilities: [],
      enabled: false,
    };
  }
}

function normalizeRevisionScopeType(
  value: unknown,
  workspaceId: string | null
): ModelRegistryRevision['scopeType'] {
  if (
    typeof value === 'string' &&
    MODEL_REGISTRY_REVISION_SCOPE_TYPES.has(value)
  ) {
    return value as ModelRegistryRevision['scopeType'];
  }
  return workspaceId ? 'workspace' : 'global';
}

function normalizeRevisionStatus(
  value: unknown
): ModelRegistryRevision['status'] {
  if (
    typeof value === 'string' &&
    MODEL_REGISTRY_REVISION_STATUSES.has(value)
  ) {
    return value as ModelRegistryRevision['status'];
  }
  return 'disabled';
}

function normalizeRepairExecutorPayload(
  payload: unknown
): ModelRegistryRepairExecutorPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid repair execution executor payload');
  }

  const record = payload as Record<string, unknown>;
  if (record.kind !== 'model_registry_revision_publish') {
    throw new Error('Unsupported repair execution executor payload');
  }
  if (record.version !== 'model-registry-revision-executor-payload/v1') {
    throw new Error('Unsupported repair execution executor payload version');
  }

  const modelId = requireStringField(record, 'modelId');
  const rawModelId = requireStringField(record, 'rawModelId');
  const modelDefinition = sanitizeModelDefinition(
    record.modelDefinition,
    modelId
  );
  const displayName = optionalStringField(record, 'displayName');

  return {
    version: 'model-registry-revision-executor-payload/v1',
    kind: 'model_registry_revision_publish',
    providerId: requireStringField(record, 'providerId'),
    modelId,
    rawModelId,
    displayName,
    aliases: stringsFromUnknown(record.aliases),
    modelDefinition: {
      ...modelDefinition,
      id: modelId,
      rawModelId,
      ...(displayName ? { displayName } : {}),
      aliases: stringsFromUnknown(record.aliases),
    },
    operationFingerprint: requireStringField(record, 'operationFingerprint'),
    operationSetFingerprint: requireStringField(
      record,
      'operationSetFingerprint'
    ),
    previewFingerprint: requireStringField(record, 'previewFingerprint'),
    catalogFingerprint: requireStringField(record, 'catalogFingerprint'),
    targetLocatorFingerprint: requireStringField(
      record,
      'targetLocatorFingerprint'
    ),
    candidateEvidenceFingerprints: stringsFromUnknown(
      record.candidateEvidenceFingerprints
    ),
    fallbackSourceChain: normalizeSourceChain(record.fallbackSourceChain),
  };
}

function toRevision(row: ModelRegistryRevisionRow): ModelRegistryRevision {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    scopeType: normalizeRevisionScopeType(row.scopeType, row.workspaceId),
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    ...(row.actorId ? { actorId: row.actorId } : {}),
    revision: row.revision,
    status: normalizeRevisionStatus(row.status),
    fingerprint: row.fingerprint,
    modelDefinition: normalizeModelDefinition(row.modelDefinition, row.modelId),
    fallbackSourceChain: normalizeSourceChain(row.fallbackSourceChain),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function modelRegistryRevisionJsonFingerprint(version: string, value: unknown) {
  return modelRegistryRevisionFingerprint({ version, value });
}

function assertModelRegistryRevisionMatchesConflictEvidence(
  revision: ModelRegistryRevision,
  row: ModelRegistryRevisionRow,
  expected: ModelRegistryRevisionConflictEvidence
) {
  const modelDefinitionFingerprint = modelRegistryRevisionJsonFingerprint(
    'model-registry-revision-model-definition-conflict-evidence/v1',
    revision.modelDefinition
  );
  const fallbackSourceChainFingerprint = modelRegistryRevisionJsonFingerprint(
    'model-registry-revision-fallback-source-chain-conflict-evidence/v1',
    revision.fallbackSourceChain
  );
  const metadataFingerprint = modelRegistryRevisionJsonFingerprint(
    'model-registry-revision-metadata-conflict-evidence/v1',
    row.metadata ?? {}
  );

  if (
    revision.id !== expected.id ||
    revision.providerId !== expected.providerId ||
    revision.modelId !== expected.modelId ||
    revision.scopeType !== expected.scopeType ||
    revision.workspaceId !== expected.workspaceId ||
    revision.actorId !== expected.actorId ||
    revision.revision !== expected.revision ||
    revision.status !== expected.status ||
    revision.fingerprint !== expected.fingerprint ||
    modelDefinitionFingerprint !== expected.modelDefinitionFingerprint ||
    fallbackSourceChainFingerprint !==
      expected.fallbackSourceChainFingerprint ||
    metadataFingerprint !== expected.metadataFingerprint
  ) {
    throw new Error(
      'Model registry revision conflict reused mismatched row evidence'
    );
  }
}

@Injectable()
export class CopilotModelRegistryRevisionModel extends BaseModel {
  @Transactional()
  async publishWorkspaceRevision(
    input: ModelRegistryPublishInput
  ): Promise<ModelRegistryRevision & RegistryRevisionPublishEventHistory> {
    const workspaceId = requirePublishString(input.workspaceId, 'workspaceId');
    const actorId = requirePublishString(input.actorId, 'actorId');
    const providerId = requirePublishString(input.providerId, 'providerId');
    const modelId = requirePublishString(input.modelId, 'modelId');
    const idempotencyKey = optionalPublishString(
      input.idempotencyKey,
      'idempotencyKey'
    );

    const modelDefinition = sanitizeModelDefinition(
      input.modelDefinition,
      modelId
    );
    const fallbackSourceChain = normalizeSourceChain(
      input.fallbackSourceChain ?? []
    );
    const definitionFingerprint = modelRegistryRevisionFingerprint({
      version: 'model-registry-definition/v1',
      providerId,
      modelId,
      modelDefinition,
      fallbackSourceChain,
    });
    const revision =
      sanitizeRevision(input.revision) ??
      `manual-${modelRegistryRevisionFingerprint({
        version: 'model-registry-revision-id/v1',
        workspaceId,
        providerId,
        modelId,
        idempotencyKey: idempotencyKey ?? null,
        definitionFingerprint,
      })}`;
    const fingerprint = modelRegistryRevisionFingerprint({
      version: 'model-registry-revision-publish/v1',
      providerId,
      modelId,
      scopeType: 'workspace',
      workspaceId,
      actorId,
      revision,
      modelDefinition,
      fallbackSourceChain,
    });
    const id = `model-registry-revision-${modelRegistryRevisionFingerprint({
      version: 'model-registry-revision-row-id/v1',
      workspaceId,
      providerId,
      modelId,
      revision,
    })}`;
    const metadata = {
      version: 'model-registry-revision-direct-publish/v1',
      publishSource: 'graphql_mutation',
      providerRuntimeBoundary: 'existing_configured_provider_runtime_reused',
      definitionFingerprint,
      ...(idempotencyKey
        ? {
            idempotencyKeyFingerprint: modelRegistryRevisionFingerprint({
              version: 'model-registry-publish-idempotency-key/v1',
              workspaceId,
              providerId,
              modelId,
              idempotencyKey,
            }),
          }
        : {}),
    };
    const expectedConflictEvidence: ModelRegistryRevisionConflictEvidence = {
      actorId,
      fallbackSourceChainFingerprint: modelRegistryRevisionJsonFingerprint(
        'model-registry-revision-fallback-source-chain-conflict-evidence/v1',
        fallbackSourceChain
      ),
      fingerprint,
      id,
      metadataFingerprint: modelRegistryRevisionJsonFingerprint(
        'model-registry-revision-metadata-conflict-evidence/v1',
        metadata
      ),
      modelDefinitionFingerprint: modelRegistryRevisionJsonFingerprint(
        'model-registry-revision-model-definition-conflict-evidence/v1',
        modelDefinition
      ),
      modelId,
      providerId,
      revision,
      scopeType: 'workspace',
      status: 'active',
      workspaceId,
    };
    const existingRow = await this.getWorkspaceRevisionRow({
      modelId,
      providerId,
      revision,
      workspaceId,
    });
    if (existingRow) {
      const existing = toRevision(existingRow);
      assertModelRegistryRevisionMatchesConflictEvidence(
        existing,
        existingRow,
        expectedConflictEvidence
      );
      await createRegistryRevisionPublishEvent(this.db, {
        actorId,
        eventType: 'revision_reused',
        metadata: {
          definitionFingerprint,
          modelId,
          providerId,
        },
        publishSource: 'graphql_mutation',
        registryFamily: 'model_registry',
        registryKey: `${providerId}:${modelId}`,
        registryModelId: modelId,
        registryProviderId: providerId,
        revision: existing.revision,
        revisionContent: existing.modelDefinition,
        revisionFallbackSourceChain: existing.fallbackSourceChain,
        revisionFingerprint: existing.fingerprint,
        revisionId: existing.id,
        revisionMetadata: existingRow.metadata,
        revisionStatus: existing.status,
        revisionUpdatedAt: existing.updatedAt,
        scopeType: existing.scopeType,
        workspaceId: existing.workspaceId,
      });
      return await withRegistryRevisionPublishEventHistory(this.db, existing);
    }

    const now = new Date();
    const metadataJson = toRegistryMetadataJsonString(metadata);

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${providerId},
        ${modelId},
        ${'workspace'},
        ${workspaceId},
        ${actorId},
        ${revision},
        ${'active'},
        ${fingerprint},
        ${JSON.stringify(modelDefinition)}::jsonb,
        ${JSON.stringify(fallbackSourceChain)}::jsonb,
        ${metadataJson}::jsonb,
        ${now},
        ${now}
      )
      ON CONFLICT ("provider_id", "model_id", "workspace_id", "revision")
      WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    const createdRow = await this.getWorkspaceRevisionRow({
      modelId,
      providerId,
      revision,
      workspaceId,
    });
    const created = createdRow ? toRevision(createdRow) : null;
    if (!created) {
      throw new Error(`Created model registry revision not found: ${id}`);
    }
    if (!createdRow) {
      throw new Error(`Created model registry revision row not found: ${id}`);
    }
    assertModelRegistryRevisionMatchesConflictEvidence(
      created,
      createdRow,
      expectedConflictEvidence
    );
    const revisionWasInserted = insertedRows.length > 0;
    await createRegistryRevisionPublishEvent(this.db, {
      actorId,
      ...(revisionWasInserted ? { createdAt: created.createdAt } : {}),
      eventType: revisionWasInserted ? 'revision_published' : 'revision_reused',
      metadata: {
        definitionFingerprint,
        modelId,
        providerId,
      },
      publishSource: 'graphql_mutation',
      registryFamily: 'model_registry',
      registryKey: `${providerId}:${modelId}`,
      registryModelId: modelId,
      registryProviderId: providerId,
      revision: created.revision,
      revisionContent: created.modelDefinition,
      revisionFallbackSourceChain: created.fallbackSourceChain,
      revisionFingerprint: created.fingerprint,
      revisionId: created.id,
      revisionMetadata: createdRow.metadata,
      revisionStatus: created.status,
      revisionUpdatedAt: created.updatedAt,
      scopeType: created.scopeType,
      workspaceId: created.workspaceId,
    });
    return await withRegistryRevisionPublishEventHistory(this.db, created);
  }

  @Transactional()
  async publishWorkspaceRepairRevision(input: {
    workspaceId: string;
    actorId: string;
    executionRequestId: string;
    requestFingerprint: string;
    candidateEvidenceSetFingerprint: string;
    taskRouteEvidenceSetFingerprint: string;
    repairJobFingerprint: string;
    approvalRecordFingerprint: string;
    payload: unknown;
  }): Promise<ModelRegistryRevision & RegistryRevisionPublishEventHistory> {
    const payload = normalizeRepairExecutorPayload(input.payload);
    const workspaceId = requirePublishString(input.workspaceId, 'workspaceId');
    const actorId = requirePublishString(input.actorId, 'actorId');
    const executionRequestId = requireRepairExecutionRequestId(
      input.executionRequestId
    );
    const requestFingerprint = requirePublishString(
      input.requestFingerprint,
      'requestFingerprint'
    );
    const candidateEvidenceSetFingerprint = requirePublishString(
      input.candidateEvidenceSetFingerprint,
      'candidateEvidenceSetFingerprint'
    );
    const taskRouteEvidenceSetFingerprint = requirePublishString(
      input.taskRouteEvidenceSetFingerprint,
      'taskRouteEvidenceSetFingerprint'
    );
    const repairJobFingerprint = requirePublishString(
      input.repairJobFingerprint,
      'repairJobFingerprint'
    );
    const approvalRecordFingerprint = requirePublishString(
      input.approvalRecordFingerprint,
      'approvalRecordFingerprint'
    );
    const revision = `repair-${executionRequestId}`;
    const fallbackSourceChain = normalizeSourceChain(
      payload.fallbackSourceChain
    );
    const modelDefinition = normalizeModelDefinition(
      payload.modelDefinition,
      payload.modelId
    );
    const fingerprint = modelRegistryRevisionFingerprint({
      version: 'model-registry-revision-publish/v1',
      providerId: payload.providerId,
      modelId: payload.modelId,
      scopeType: 'workspace',
      workspaceId,
      actorId,
      revision,
      modelDefinition,
      requestFingerprint,
      candidateEvidenceSetFingerprint,
      taskRouteEvidenceSetFingerprint,
      repairJobFingerprint,
      approvalRecordFingerprint,
      operationFingerprint: payload.operationFingerprint,
      operationSetFingerprint: payload.operationSetFingerprint,
      previewFingerprint: payload.previewFingerprint,
      catalogFingerprint: payload.catalogFingerprint,
      targetLocatorFingerprint: payload.targetLocatorFingerprint,
      candidateEvidenceFingerprints: payload.candidateEvidenceFingerprints,
      fallbackSourceChain,
    });
    const id = `model-registry-revision-${executionRequestId}`;
    const metadata = {
      version: 'model-registry-revision-repair-executor/v1',
      publishSource: 'repair_execution_worker',
      executionRequestId,
      requestFingerprint,
      candidateEvidenceSetFingerprint,
      taskRouteEvidenceSetFingerprint,
      repairJobFingerprint,
      approvalRecordFingerprint,
      operationFingerprint: payload.operationFingerprint,
      operationSetFingerprint: payload.operationSetFingerprint,
      previewFingerprint: payload.previewFingerprint,
      catalogFingerprint: payload.catalogFingerprint,
      targetLocatorFingerprint: payload.targetLocatorFingerprint,
      candidateEvidenceFingerprints: payload.candidateEvidenceFingerprints,
    };
    const expectedConflictEvidence: ModelRegistryRevisionConflictEvidence = {
      actorId,
      fallbackSourceChainFingerprint: modelRegistryRevisionJsonFingerprint(
        'model-registry-revision-fallback-source-chain-conflict-evidence/v1',
        fallbackSourceChain
      ),
      fingerprint,
      id,
      metadataFingerprint: modelRegistryRevisionJsonFingerprint(
        'model-registry-revision-metadata-conflict-evidence/v1',
        metadata
      ),
      modelDefinitionFingerprint: modelRegistryRevisionJsonFingerprint(
        'model-registry-revision-model-definition-conflict-evidence/v1',
        modelDefinition
      ),
      modelId: payload.modelId,
      providerId: payload.providerId,
      revision,
      scopeType: 'workspace',
      status: 'active',
      workspaceId,
    };
    const existingRow = await this.getWorkspaceRevisionRow({
      modelId: payload.modelId,
      providerId: payload.providerId,
      revision,
      workspaceId,
    });
    if (existingRow) {
      const existing = toRevision(existingRow);
      assertModelRegistryRevisionMatchesConflictEvidence(
        existing,
        existingRow,
        expectedConflictEvidence
      );
      await createRegistryRevisionPublishEvent(this.db, {
        actorId,
        eventType: 'revision_reused',
        metadata: {
          executionRequestId,
          modelId: payload.modelId,
          providerId: payload.providerId,
          repairJobFingerprint,
        },
        publishSource: 'repair_execution_worker',
        registryFamily: 'model_registry',
        registryKey: `${payload.providerId}:${payload.modelId}`,
        registryModelId: payload.modelId,
        registryProviderId: payload.providerId,
        revision: existing.revision,
        revisionContent: existing.modelDefinition,
        revisionFallbackSourceChain: existing.fallbackSourceChain,
        revisionFingerprint: existing.fingerprint,
        revisionId: existing.id,
        revisionMetadata: existingRow.metadata,
        revisionStatus: existing.status,
        revisionUpdatedAt: existing.updatedAt,
        scopeType: existing.scopeType,
        workspaceId: existing.workspaceId,
      });
      return await withRegistryRevisionPublishEventHistory(this.db, existing);
    }

    const now = new Date();
    const metadataJson = toRegistryMetadataJsonString(metadata);

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${payload.providerId},
        ${payload.modelId},
        ${'workspace'},
        ${workspaceId},
        ${actorId},
        ${revision},
        ${'active'},
        ${fingerprint},
        ${JSON.stringify(modelDefinition)}::jsonb,
        ${JSON.stringify(fallbackSourceChain)}::jsonb,
        ${metadataJson}::jsonb,
        ${now},
        ${now}
      )
      ON CONFLICT ("provider_id", "model_id", "workspace_id", "revision")
      WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    const createdRow = await this.getWorkspaceRevisionRow({
      modelId: payload.modelId,
      providerId: payload.providerId,
      revision,
      workspaceId,
    });
    const created = createdRow ? toRevision(createdRow) : null;
    if (!created) {
      throw new Error(`Created model registry revision not found: ${id}`);
    }
    if (!createdRow) {
      throw new Error(`Created model registry revision row not found: ${id}`);
    }
    assertModelRegistryRevisionMatchesConflictEvidence(
      created,
      createdRow,
      expectedConflictEvidence
    );
    const revisionWasInserted = insertedRows.length > 0;
    await createRegistryRevisionPublishEvent(this.db, {
      actorId,
      ...(revisionWasInserted ? { createdAt: created.createdAt } : {}),
      eventType: revisionWasInserted ? 'revision_published' : 'revision_reused',
      metadata: {
        executionRequestId,
        modelId: payload.modelId,
        providerId: payload.providerId,
        repairJobFingerprint,
      },
      publishSource: 'repair_execution_worker',
      registryFamily: 'model_registry',
      registryKey: `${payload.providerId}:${payload.modelId}`,
      registryModelId: payload.modelId,
      registryProviderId: payload.providerId,
      revision: created.revision,
      revisionContent: created.modelDefinition,
      revisionFallbackSourceChain: created.fallbackSourceChain,
      revisionFingerprint: created.fingerprint,
      revisionId: created.id,
      revisionMetadata: createdRow.metadata,
      revisionStatus: created.status,
      revisionUpdatedAt: created.updatedAt,
      scopeType: created.scopeType,
      workspaceId: created.workspaceId,
    });
    return await withRegistryRevisionPublishEventHistory(this.db, created);
  }

  async listLatestActiveByProviderIds(input: {
    providerIds: string[];
    workspaceId?: string | null;
  }): Promise<Map<string, ModelRegistryRevision[]>> {
    const providerIds = [...new Set(input.providerIds)].filter(Boolean);
    if (!providerIds.length) {
      return new Map();
    }

    const rows = input.workspaceId
      ? await this.db.$queryRaw<ModelRegistryRevisionRow[]>`
          SELECT DISTINCT ON (provider_id, model_id)
            id,
            provider_id AS "providerId",
            model_id AS "modelId",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            revision,
            status,
            fingerprint,
            model_definition AS "modelDefinition",
            fallback_source_chain AS "fallbackSourceChain",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_model_registry_revisions
          WHERE provider_id = ANY(${providerIds})
            AND status = 'active'
            AND (
              (scope_type = 'workspace' AND workspace_id = ${input.workspaceId})
              OR (scope_type = 'global' AND workspace_id IS NULL)
            )
          ORDER BY
            provider_id ASC,
            model_id ASC,
            CASE WHEN scope_type = 'workspace' THEN 0 ELSE 1 END ASC,
            created_at DESC,
            id DESC
        `
      : await this.db.$queryRaw<ModelRegistryRevisionRow[]>`
          SELECT DISTINCT ON (provider_id, model_id)
            id,
            provider_id AS "providerId",
            model_id AS "modelId",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            revision,
            status,
            fingerprint,
            model_definition AS "modelDefinition",
            fallback_source_chain AS "fallbackSourceChain",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_model_registry_revisions
          WHERE provider_id = ANY(${providerIds})
            AND status = 'active'
            AND scope_type = 'global'
            AND workspace_id IS NULL
          ORDER BY provider_id ASC, model_id ASC, created_at DESC, id DESC
        `;

    const revisionsByProvider = new Map<string, ModelRegistryRevision[]>();
    for (const revision of rows.map(toRevision)) {
      const revisions = revisionsByProvider.get(revision.providerId) ?? [];
      revisions.push(revision);
      revisionsByProvider.set(revision.providerId, revisions);
    }
    return revisionsByProvider;
  }

  async listLatestActiveWithPublishEventsByProviderIds(input: {
    providerIds: string[];
    workspaceId?: string | null;
  }): Promise<
    Map<string, (ModelRegistryRevision & RegistryRevisionPublishEventHistory)[]>
  > {
    const revisionsByProvider = await this.listLatestActiveByProviderIds(input);
    const entries = await Promise.all(
      [...revisionsByProvider.entries()].map(
        async ([providerId, revisions]) => {
          const revisionsWithEvents = await Promise.all(
            revisions.map(async revision => {
              const history = await getRegistryRevisionPublishEventHistory(
                this.db,
                revision.id
              );
              return {
                ...revision,
                ...history,
              };
            })
          );
          return [providerId, revisionsWithEvents] as const;
        }
      )
    );

    return new Map(entries);
  }

  async resolve(
    workspaceId: string | null | undefined,
    providerId: string,
    modelId: string
  ): Promise<ModelRegistryRevision | null> {
    const revisionsByProvider = await this.listLatestActiveByProviderIds({
      providerIds: [providerId],
      workspaceId,
    });
    return (
      revisionsByProvider
        .get(providerId)
        ?.find(revision => revision.modelId === modelId) ?? null
    );
  }

  private async getByWorkspaceRevision(input: {
    providerId: string;
    modelId: string;
    revision: string;
    workspaceId: string;
  }) {
    const row = await this.getWorkspaceRevisionRow(input);
    return row ? toRevision(row) : null;
  }

  private async getWorkspaceRevisionRow(input: {
    providerId: string;
    modelId: string;
    revision: string;
    workspaceId: string;
  }) {
    const rows = await this.db.$queryRaw<ModelRegistryRevisionRow[]>`
      SELECT
        id,
        provider_id AS "providerId",
        model_id AS "modelId",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        revision,
        status,
        fingerprint,
        model_definition AS "modelDefinition",
        fallback_source_chain AS "fallbackSourceChain",
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_model_registry_revisions
      WHERE provider_id = ${input.providerId}
        AND model_id = ${input.modelId}
        AND scope_type = 'workspace'
        AND workspace_id = ${input.workspaceId}
        AND revision = ${input.revision}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }
}
