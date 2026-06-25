import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import type {
  TaskRoutePolicyFeatureKind,
  TaskRoutePolicyRevision,
  TaskRoutePolicySourceChainEntry,
} from '../plugins/copilot/runtime/task-policy';
import { BaseModel } from './base';
import {
  createRegistryRevisionPublishEvent,
  getRegistryRevisionPublishEventHistory,
  type RegistryRevisionPublishEventHistory,
  withRegistryRevisionPublishEventHistory,
} from './copilot-registry-revision-publish-event';

type TaskRoutePolicyRevisionRow = {
  id: string;
  featureKind: TaskRoutePolicyFeatureKind;
  scopeType: TaskRoutePolicyRevision['scopeType'];
  workspaceId: string | null;
  actorId: string | null;
  revision: string;
  status: TaskRoutePolicyRevision['status'];
  modelId: string | null;
  configKey: string | null;
  configPath: string | null;
  fingerprint: string;
  fallbackSourceChain: unknown;
  metadata?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type TaskRoutePolicyRevisionConflictEvidence = {
  actorId: string | null;
  configKey: string | null;
  configPath: string | null;
  fallbackSourceChainFingerprint: string;
  featureKind: TaskRoutePolicyFeatureKind;
  fingerprint: string;
  id: string;
  metadataFingerprint: string;
  modelId: string;
  revision: string;
  scopeType: 'workspace';
  status: 'active';
  workspaceId: string;
};

export type TaskRoutePolicyPublishInput = {
  workspaceId: string;
  actorId: string;
  featureKind: TaskRoutePolicyFeatureKind | string;
  modelId: string;
  revision?: string | null;
  idempotencyKey?: string | null;
  configKey?: 'embedding' | 'workspaceIndexing' | 'rerank' | string | null;
  configPath?: string | null;
  fallbackSourceChain?: TaskRoutePolicySourceChainEntry[];
};

export type TaskRoutePolicyRepairExecutorPayload = {
  version: 'task-route-policy-revision-executor-payload/v1';
  kind: 'task_route_policy_revision_publish';
  featureKind: TaskRoutePolicyFeatureKind;
  modelId: string;
  configKey?: 'embedding' | 'workspaceIndexing' | 'rerank';
  configPath?: string;
  operationFingerprint: string;
  operationSetFingerprint: string;
  previewFingerprint: string;
  catalogFingerprint: string;
  targetLocatorFingerprint: string;
  taskRouteEffectiveSourceFingerprints: string[];
  candidateEvidenceFingerprints: string[];
  fallbackSourceChain: TaskRoutePolicySourceChainEntry[];
};

function stableTaskRoutePolicyStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableTaskRoutePolicyStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined
          ? null
          : `${JSON.stringify(key)}:${stableTaskRoutePolicyStringify(item)}`;
      })
      .filter(Boolean)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function taskRoutePolicyRevisionFingerprint(value: unknown) {
  return createHash('sha256')
    .update(stableTaskRoutePolicyStringify(value))
    .digest('hex')
    .slice(0, 16);
}

const TASK_ROUTE_POLICY_SOURCE_CHAIN_SOURCES = new Set([
  'db_revision',
  'config_fallback',
  'provider_default',
]);
const TASK_ROUTE_POLICY_SOURCE_CHAIN_SCOPES = new Set(['global', 'workspace']);
const TASK_ROUTE_POLICY_SOURCE_CHAIN_STATUSES = new Set([
  'active',
  'available',
  'disabled',
]);
const SOURCE_CHAIN_MAX_ENTRIES = 16;
const SOURCE_CHAIN_OPTIONAL_STRING_MAX_LENGTH = 512;
const REGISTRY_PAYLOAD_STRING_MAX_LENGTH = 512;
const REGISTRY_METADATA_JSON_MAX_LENGTH = 16 * 1024;
const REPAIR_REVISION_PREFIX = 'repair-';
const TASK_ROUTE_POLICY_SOURCE_CHAIN_FEATURE_KINDS =
  new Set<TaskRoutePolicyFeatureKind>([
    'embedding',
    'workspace_indexing',
    'rerank',
  ]);
const TASK_ROUTE_POLICY_SOURCE_CHAIN_CONFIG_KEYS = new Set([
  'embedding',
  'workspaceIndexing',
  'rerank',
]);

function isSourceChainEntry(
  value: unknown
): value is TaskRoutePolicySourceChainEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as TaskRoutePolicySourceChainEntry).source === 'string' &&
    typeof (value as TaskRoutePolicySourceChainEntry).scope === 'string' &&
    typeof (value as TaskRoutePolicySourceChainEntry).status === 'string' &&
    TASK_ROUTE_POLICY_SOURCE_CHAIN_SOURCES.has(
      (value as TaskRoutePolicySourceChainEntry).source
    ) &&
    TASK_ROUTE_POLICY_SOURCE_CHAIN_SCOPES.has(
      (value as TaskRoutePolicySourceChainEntry).scope
    ) &&
    TASK_ROUTE_POLICY_SOURCE_CHAIN_STATUSES.has(
      (value as TaskRoutePolicySourceChainEntry).status
    )
  );
}

function normalizeSourceChain(
  value: unknown
): TaskRoutePolicySourceChainEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isSourceChainEntry)
    .slice(0, SOURCE_CHAIN_MAX_ENTRIES)
    .map(entry => {
      const actorId = sourceChainString(entry.actorId);
      const configKey = sourceChainValue(
        entry.configKey,
        TASK_ROUTE_POLICY_SOURCE_CHAIN_CONFIG_KEYS
      );
      const configPath = sourceChainString(entry.configPath);
      const featureKind = sourceChainValue(
        entry.featureKind,
        TASK_ROUTE_POLICY_SOURCE_CHAIN_FEATURE_KINDS
      );
      const fingerprint = sourceChainString(entry.fingerprint);
      const modelId = sourceChainString(entry.modelId);
      const revision = sourceChainString(entry.revision);
      const updatedAt = sourceChainString(entry.updatedAt);
      const workspaceId = sourceChainString(entry.workspaceId);

      return {
        source: entry.source,
        scope: entry.scope,
        status: entry.status,
        ...(actorId ? { actorId } : {}),
        ...(configKey ? { configKey } : {}),
        ...(configPath ? { configPath } : {}),
        ...(featureKind ? { featureKind } : {}),
        ...(fingerprint ? { fingerprint } : {}),
        ...(modelId ? { modelId } : {}),
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

function sourceChainValue<T extends string>(
  value: unknown,
  allowed: Set<T>
): T | undefined {
  const item = sourceChainString(value);
  return item && allowed.has(item as T) ? (item as T) : undefined;
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
    throw new Error(`Task route policy publish requires ${field}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Task route policy publish requires ${field}`);
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
    throw new Error(`Task route policy publish contains invalid ${field}`);
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > REGISTRY_PAYLOAD_STRING_MAX_LENGTH) {
    throw new Error(`Task route policy publish contains invalid ${field}`);
  }
  return normalized;
}

function toRegistryMetadataJsonString(
  metadata: Record<string, unknown>
): string {
  const serialized = JSON.stringify(metadata);
  if (serialized.length > REGISTRY_METADATA_JSON_MAX_LENGTH) {
    throw new Error('Task route policy publish metadata is too large');
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

function normalizeFeatureKind(value: string): TaskRoutePolicyFeatureKind {
  if (
    value === 'embedding' ||
    value === 'workspace_indexing' ||
    value === 'rerank'
  ) {
    return value;
  }
  throw new Error(
    `Invalid repair execution executor payload field: featureKind`
  );
}

function normalizeConfigKey(
  value?: string
): TaskRoutePolicyRepairExecutorPayload['configKey'] {
  if (!value) {
    return undefined;
  }
  if (
    value === 'embedding' ||
    value === 'workspaceIndexing' ||
    value === 'rerank'
  ) {
    return value;
  }
  throw new Error(`Invalid repair execution executor payload field: configKey`);
}

function sanitizeRevision(value: unknown): string | undefined {
  const revision = optionalString(value);
  if (!revision) {
    return undefined;
  }
  if (revision.length > REGISTRY_PAYLOAD_STRING_MAX_LENGTH) {
    throw new Error('Task route policy revision is too long');
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(revision)) {
    throw new Error('Task route policy revision contains invalid characters');
  }
  return revision;
}

function normalizeRepairExecutorPayload(
  payload: unknown
): TaskRoutePolicyRepairExecutorPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid repair execution executor payload');
  }

  const record = payload as Record<string, unknown>;
  if (record.kind !== 'task_route_policy_revision_publish') {
    throw new Error('Unsupported repair execution executor payload');
  }
  if (record.version !== 'task-route-policy-revision-executor-payload/v1') {
    throw new Error('Unsupported repair execution executor payload version');
  }

  return {
    version: 'task-route-policy-revision-executor-payload/v1',
    kind: 'task_route_policy_revision_publish',
    featureKind: normalizeFeatureKind(
      requireStringField(record, 'featureKind')
    ),
    modelId: requireStringField(record, 'modelId'),
    configKey: normalizeConfigKey(optionalStringField(record, 'configKey')),
    configPath: optionalStringField(record, 'configPath'),
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
    taskRouteEffectiveSourceFingerprints: stringsFromUnknown(
      record.taskRouteEffectiveSourceFingerprints
    ),
    candidateEvidenceFingerprints: stringsFromUnknown(
      record.candidateEvidenceFingerprints
    ),
    fallbackSourceChain: normalizeSourceChain(record.fallbackSourceChain),
  };
}

function toRevision(row: TaskRoutePolicyRevisionRow): TaskRoutePolicyRevision {
  return {
    id: row.id,
    featureKind: row.featureKind,
    scopeType: row.scopeType,
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    ...(row.actorId ? { actorId: row.actorId } : {}),
    revision: row.revision,
    status: row.status,
    ...(row.modelId ? { modelId: row.modelId } : {}),
    ...(row.configKey ? { configKey: row.configKey } : {}),
    ...(row.configPath ? { configPath: row.configPath } : {}),
    fingerprint: row.fingerprint,
    fallbackSourceChain: normalizeSourceChain(row.fallbackSourceChain),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function taskRoutePolicyRevisionJsonFingerprint(
  version: string,
  value: unknown
) {
  return taskRoutePolicyRevisionFingerprint({ version, value });
}

function assertTaskRoutePolicyRevisionMatchesConflictEvidence(
  revision: TaskRoutePolicyRevision,
  row: TaskRoutePolicyRevisionRow,
  expected: TaskRoutePolicyRevisionConflictEvidence
) {
  const fallbackSourceChainFingerprint = taskRoutePolicyRevisionJsonFingerprint(
    'task-route-policy-revision-fallback-source-chain-conflict-evidence/v1',
    revision.fallbackSourceChain
  );
  const metadataFingerprint = taskRoutePolicyRevisionJsonFingerprint(
    'task-route-policy-revision-metadata-conflict-evidence/v1',
    row.metadata ?? {}
  );

  if (
    revision.id !== expected.id ||
    revision.featureKind !== expected.featureKind ||
    revision.scopeType !== expected.scopeType ||
    revision.workspaceId !== expected.workspaceId ||
    revision.actorId !== expected.actorId ||
    revision.revision !== expected.revision ||
    revision.status !== expected.status ||
    revision.modelId !== expected.modelId ||
    (revision.configKey ?? null) !== expected.configKey ||
    (revision.configPath ?? null) !== expected.configPath ||
    revision.fingerprint !== expected.fingerprint ||
    fallbackSourceChainFingerprint !==
      expected.fallbackSourceChainFingerprint ||
    metadataFingerprint !== expected.metadataFingerprint
  ) {
    throw new Error(
      'Task route policy revision conflict reused mismatched row evidence'
    );
  }
}

@Injectable()
export class CopilotTaskRoutePolicyRevisionModel extends BaseModel {
  @Transactional()
  async publishWorkspaceRevision(
    input: TaskRoutePolicyPublishInput
  ): Promise<TaskRoutePolicyRevision & RegistryRevisionPublishEventHistory> {
    const workspaceId = requirePublishString(input.workspaceId, 'workspaceId');
    const actorId = requirePublishString(input.actorId, 'actorId');
    const modelId = requirePublishString(input.modelId, 'modelId');
    const idempotencyKey = optionalPublishString(
      input.idempotencyKey,
      'idempotencyKey'
    );

    const featureKind = normalizeFeatureKind(input.featureKind);
    const configKey = normalizeConfigKey(
      optionalPublishString(input.configKey, 'configKey')
    );
    const configPath = optionalPublishString(input.configPath, 'configPath');
    const fallbackSourceChain = normalizeSourceChain(
      input.fallbackSourceChain ?? []
    );
    const policyFingerprint = taskRoutePolicyRevisionFingerprint({
      version: 'task-route-policy-revision-policy/v1',
      featureKind,
      modelId,
      configKey: configKey ?? null,
      configPath: configPath ?? null,
      fallbackSourceChain,
    });
    const revision =
      sanitizeRevision(input.revision) ??
      `manual-${taskRoutePolicyRevisionFingerprint({
        version: 'task-route-policy-revision-id/v1',
        workspaceId,
        featureKind,
        idempotencyKey: idempotencyKey ?? null,
        policyFingerprint,
      })}`;
    const fingerprint = taskRoutePolicyRevisionFingerprint({
      version: 'task-route-policy-revision-publish/v1',
      featureKind,
      scopeType: 'workspace',
      workspaceId,
      actorId,
      revision,
      modelId,
      configKey: configKey ?? null,
      configPath: configPath ?? null,
      fallbackSourceChain,
    });
    const id = `task-route-policy-revision-${taskRoutePolicyRevisionFingerprint(
      {
        version: 'task-route-policy-revision-row-id/v1',
        workspaceId,
        featureKind,
        revision,
      }
    )}`;
    const metadata = {
      version: 'task-route-policy-revision-direct-publish/v1',
      publishSource: 'graphql_mutation',
      routeSelectionBoundary: 'configured_task_route_policy_only',
      policyFingerprint,
      ...(idempotencyKey
        ? {
            idempotencyKeyFingerprint: taskRoutePolicyRevisionFingerprint({
              version: 'task-route-policy-publish-idempotency-key/v1',
              workspaceId,
              featureKind,
              idempotencyKey,
            }),
          }
        : {}),
    };
    const expectedConflictEvidence: TaskRoutePolicyRevisionConflictEvidence = {
      actorId,
      configKey: configKey ?? null,
      configPath: configPath ?? null,
      fallbackSourceChainFingerprint: taskRoutePolicyRevisionJsonFingerprint(
        'task-route-policy-revision-fallback-source-chain-conflict-evidence/v1',
        fallbackSourceChain
      ),
      featureKind,
      fingerprint,
      id,
      metadataFingerprint: taskRoutePolicyRevisionJsonFingerprint(
        'task-route-policy-revision-metadata-conflict-evidence/v1',
        metadata
      ),
      modelId,
      revision,
      scopeType: 'workspace',
      status: 'active',
      workspaceId,
    };
    const existingRow = await this.getWorkspaceRevisionRow({
      featureKind,
      revision,
      workspaceId,
    });
    if (existingRow) {
      const existing = toRevision(existingRow);
      assertTaskRoutePolicyRevisionMatchesConflictEvidence(
        existing,
        existingRow,
        expectedConflictEvidence
      );
      await createRegistryRevisionPublishEvent(this.db, {
        actorId,
        eventType: 'revision_reused',
        metadata: {
          featureKind,
          policyFingerprint,
        },
        publishSource: 'graphql_mutation',
        registryFamily: 'task_route_policy',
        registryKey: featureKind,
        revision: existing.revision,
        revisionFallbackSourceChain: existing.fallbackSourceChain,
        revisionFingerprint: existing.fingerprint,
        revisionId: existing.id,
        revisionMetadata: existingRow.metadata,
        revisionStatus: existing.status,
        revisionTaskRouteConfigKey: existing.configKey ?? null,
        revisionTaskRouteConfigPath: existing.configPath ?? null,
        revisionTaskRouteModelId: existing.modelId,
        revisionUpdatedAt: existing.updatedAt,
        scopeType: existing.scopeType,
        workspaceId: existing.workspaceId,
      });
      return await withRegistryRevisionPublishEventHistory(this.db, existing);
    }

    const now = new Date();
    const metadataJson = toRegistryMetadataJsonString(metadata);

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${featureKind},
        ${'workspace'},
        ${workspaceId},
        ${actorId},
        ${revision},
        ${'active'},
        ${modelId},
        ${configKey ?? null},
        ${configPath ?? null},
        ${fingerprint},
        ${JSON.stringify(fallbackSourceChain)}::jsonb,
        ${metadataJson}::jsonb,
        ${now},
        ${now}
      )
      ON CONFLICT ("feature_kind", "workspace_id", "revision")
      WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    const createdRow = await this.getWorkspaceRevisionRow({
      featureKind,
      revision,
      workspaceId,
    });
    const created = createdRow ? toRevision(createdRow) : null;
    if (!created) {
      throw new Error(`Created task route policy revision not found: ${id}`);
    }
    if (!createdRow) {
      throw new Error(
        `Created task route policy revision row not found: ${id}`
      );
    }
    assertTaskRoutePolicyRevisionMatchesConflictEvidence(
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
        featureKind,
        policyFingerprint,
      },
      publishSource: 'graphql_mutation',
      registryFamily: 'task_route_policy',
      registryKey: featureKind,
      revision: created.revision,
      revisionFallbackSourceChain: created.fallbackSourceChain,
      revisionFingerprint: created.fingerprint,
      revisionId: created.id,
      revisionMetadata: createdRow.metadata,
      revisionStatus: created.status,
      revisionTaskRouteConfigKey: created.configKey ?? null,
      revisionTaskRouteConfigPath: created.configPath ?? null,
      revisionTaskRouteModelId: created.modelId,
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
  }): Promise<TaskRoutePolicyRevision & RegistryRevisionPublishEventHistory> {
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
    const fingerprint = taskRoutePolicyRevisionFingerprint({
      version: 'task-route-policy-revision-publish/v1',
      featureKind: payload.featureKind,
      scopeType: 'workspace',
      workspaceId,
      actorId,
      revision,
      modelId: payload.modelId,
      configKey: payload.configKey ?? null,
      configPath: payload.configPath ?? null,
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
      taskRouteEffectiveSourceFingerprints:
        payload.taskRouteEffectiveSourceFingerprints,
      candidateEvidenceFingerprints: payload.candidateEvidenceFingerprints,
      fallbackSourceChain,
    });
    const id = `task-route-policy-revision-${executionRequestId}`;
    const metadata = {
      version: 'task-route-policy-revision-repair-executor/v1',
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
      taskRouteEffectiveSourceFingerprints:
        payload.taskRouteEffectiveSourceFingerprints,
      candidateEvidenceFingerprints: payload.candidateEvidenceFingerprints,
    };
    const expectedConflictEvidence: TaskRoutePolicyRevisionConflictEvidence = {
      actorId,
      configKey: payload.configKey ?? null,
      configPath: payload.configPath ?? null,
      fallbackSourceChainFingerprint: taskRoutePolicyRevisionJsonFingerprint(
        'task-route-policy-revision-fallback-source-chain-conflict-evidence/v1',
        fallbackSourceChain
      ),
      featureKind: payload.featureKind,
      fingerprint,
      id,
      metadataFingerprint: taskRoutePolicyRevisionJsonFingerprint(
        'task-route-policy-revision-metadata-conflict-evidence/v1',
        metadata
      ),
      modelId: payload.modelId,
      revision,
      scopeType: 'workspace',
      status: 'active',
      workspaceId,
    };
    const existingRow = await this.getWorkspaceRevisionRow({
      featureKind: payload.featureKind,
      revision,
      workspaceId,
    });
    if (existingRow) {
      const existing = toRevision(existingRow);
      assertTaskRoutePolicyRevisionMatchesConflictEvidence(
        existing,
        existingRow,
        expectedConflictEvidence
      );
      await createRegistryRevisionPublishEvent(this.db, {
        actorId,
        eventType: 'revision_reused',
        metadata: {
          executionRequestId,
          featureKind: payload.featureKind,
          repairJobFingerprint,
        },
        publishSource: 'repair_execution_worker',
        registryFamily: 'task_route_policy',
        registryKey: payload.featureKind,
        revision: existing.revision,
        revisionFallbackSourceChain: existing.fallbackSourceChain,
        revisionFingerprint: existing.fingerprint,
        revisionId: existing.id,
        revisionMetadata: existingRow.metadata,
        revisionStatus: existing.status,
        revisionTaskRouteConfigKey: existing.configKey ?? null,
        revisionTaskRouteConfigPath: existing.configPath ?? null,
        revisionTaskRouteModelId: existing.modelId,
        revisionUpdatedAt: existing.updatedAt,
        scopeType: existing.scopeType,
        workspaceId: existing.workspaceId,
      });
      return await withRegistryRevisionPublishEventHistory(this.db, existing);
    }

    const now = new Date();
    const metadataJson = toRegistryMetadataJsonString(metadata);

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${payload.featureKind},
        ${'workspace'},
        ${workspaceId},
        ${actorId},
        ${revision},
        ${'active'},
        ${payload.modelId},
        ${payload.configKey ?? null},
        ${payload.configPath ?? null},
        ${fingerprint},
        ${JSON.stringify(fallbackSourceChain)}::jsonb,
        ${metadataJson}::jsonb,
        ${now},
        ${now}
      )
      ON CONFLICT ("feature_kind", "workspace_id", "revision")
      WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    const createdRow = await this.getWorkspaceRevisionRow({
      featureKind: payload.featureKind,
      revision,
      workspaceId,
    });
    const created = createdRow ? toRevision(createdRow) : null;
    if (!created) {
      throw new Error(`Created task route policy revision not found: ${id}`);
    }
    if (!createdRow) {
      throw new Error(
        `Created task route policy revision row not found: ${id}`
      );
    }
    assertTaskRoutePolicyRevisionMatchesConflictEvidence(
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
        featureKind: payload.featureKind,
        repairJobFingerprint,
      },
      publishSource: 'repair_execution_worker',
      registryFamily: 'task_route_policy',
      registryKey: payload.featureKind,
      revision: created.revision,
      revisionFallbackSourceChain: created.fallbackSourceChain,
      revisionFingerprint: created.fingerprint,
      revisionId: created.id,
      revisionMetadata: createdRow.metadata,
      revisionStatus: created.status,
      revisionTaskRouteConfigKey: created.configKey ?? null,
      revisionTaskRouteConfigPath: created.configPath ?? null,
      revisionTaskRouteModelId: created.modelId,
      revisionUpdatedAt: created.updatedAt,
      scopeType: created.scopeType,
      workspaceId: created.workspaceId,
    });
    return await withRegistryRevisionPublishEventHistory(this.db, created);
  }

  async listLatestActiveByFeatureKinds(input: {
    featureKinds: TaskRoutePolicyFeatureKind[];
    workspaceId?: string | null;
  }): Promise<Map<TaskRoutePolicyFeatureKind, TaskRoutePolicyRevision>> {
    const featureKinds = [...new Set(input.featureKinds)].filter(Boolean);
    if (!featureKinds.length) {
      return new Map();
    }

    const rows = input.workspaceId
      ? await this.db.$queryRaw<TaskRoutePolicyRevisionRow[]>`
          SELECT DISTINCT ON (feature_kind)
            id,
            feature_kind AS "featureKind",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            revision,
            status,
            model_id AS "modelId",
            config_key AS "configKey",
            config_path AS "configPath",
            fingerprint,
            fallback_source_chain AS "fallbackSourceChain",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_task_route_policy_revisions
          WHERE feature_kind = ANY(${featureKinds})
            AND status = 'active'
            AND (
              (scope_type = 'workspace' AND workspace_id = ${input.workspaceId})
              OR (scope_type = 'global' AND workspace_id IS NULL)
            )
          ORDER BY
            feature_kind ASC,
            CASE WHEN scope_type = 'workspace' THEN 0 ELSE 1 END ASC,
            created_at DESC,
            id DESC
        `
      : await this.db.$queryRaw<TaskRoutePolicyRevisionRow[]>`
          SELECT DISTINCT ON (feature_kind)
            id,
            feature_kind AS "featureKind",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            revision,
            status,
            model_id AS "modelId",
            config_key AS "configKey",
            config_path AS "configPath",
            fingerprint,
            fallback_source_chain AS "fallbackSourceChain",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_task_route_policy_revisions
          WHERE feature_kind = ANY(${featureKinds})
            AND status = 'active'
            AND scope_type = 'global'
            AND workspace_id IS NULL
          ORDER BY feature_kind ASC, created_at DESC, id DESC
        `;

    return new Map(rows.map(row => [row.featureKind, toRevision(row)]));
  }

  async listLatestActiveWithPublishEventsByFeatureKinds(input: {
    featureKinds: TaskRoutePolicyFeatureKind[];
    workspaceId?: string | null;
  }): Promise<
    Map<
      TaskRoutePolicyFeatureKind,
      TaskRoutePolicyRevision & RegistryRevisionPublishEventHistory
    >
  > {
    const revisionsByFeature = await this.listLatestActiveByFeatureKinds(input);
    const entries = await Promise.all(
      [...revisionsByFeature.entries()].map(async ([featureKind, revision]) => {
        const history = await getRegistryRevisionPublishEventHistory(
          this.db,
          revision.id
        );
        return [
          featureKind,
          {
            ...revision,
            ...history,
          },
        ] as const;
      })
    );

    return new Map(entries);
  }

  private async getByWorkspaceRevision(input: {
    featureKind: TaskRoutePolicyFeatureKind;
    revision: string;
    workspaceId: string;
  }) {
    const row = await this.getWorkspaceRevisionRow(input);
    return row ? toRevision(row) : null;
  }

  private async getWorkspaceRevisionRow(input: {
    featureKind: TaskRoutePolicyFeatureKind;
    revision: string;
    workspaceId: string;
  }) {
    const rows = await this.db.$queryRaw<TaskRoutePolicyRevisionRow[]>`
      SELECT
        id,
        feature_kind AS "featureKind",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        revision,
        status,
        model_id AS "modelId",
        config_key AS "configKey",
        config_path AS "configPath",
        fingerprint,
        fallback_source_chain AS "fallbackSourceChain",
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_task_route_policy_revisions
      WHERE feature_kind = ${input.featureKind}
        AND scope_type = 'workspace'
        AND workspace_id = ${input.workspaceId}
        AND revision = ${input.revision}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }
}
