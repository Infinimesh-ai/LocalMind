import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import type { CopilotProviderType } from '../plugins/copilot/providers/types';
import { BaseModel } from './base';
import {
  type ProviderRegistryRevision,
  providerRegistryRevisionFingerprint,
} from './copilot-provider-registry-revision';
import {
  type CopilotProviderHealthStatus,
  CopilotProviderHealthStatusValues,
  type CopilotProviderProfileSource,
} from './copilot-registry-definition-types';

export type CopilotProviderHealthState = {
  id: string;
  providerId: string;
  providerType?: CopilotProviderType;
  scopeType: 'global' | 'workspace';
  workspaceId?: string;
  actorId?: string;
  status: CopilotProviderHealthStatus;
  checkedAt: Date;
  lastError?: string;
  source: 'manual_override' | 'probe_result';
  fingerprint: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  eventCount: number;
  events: CopilotProviderHealthEventRecord[];
};

type CopilotProviderHealthStateRow = {
  id: string;
  providerId: string;
  providerType: string | null;
  scopeType: CopilotProviderHealthState['scopeType'];
  workspaceId: string | null;
  actorId: string | null;
  status: CopilotProviderHealthStatus;
  checkedAt: Date;
  lastError: string | null;
  source: CopilotProviderHealthState['source'];
  fingerprint: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CopilotProviderHealthEventType =
  | 'manual_override_recorded'
  | 'workspace_probe_result_recorded'
  | 'configured_snapshot_recorded'
  | 'configured_snapshot_cleared'
  | 'stale_probe_result_cleared';

export type CopilotProviderHealthEventRecord = {
  id: string;
  stateId: string;
  providerId: string;
  providerType?: CopilotProviderType;
  scopeType: CopilotProviderHealthState['scopeType'];
  workspaceId?: string;
  actorId?: string;
  status: CopilotProviderHealthStatus;
  checkedAt: Date;
  lastError?: string;
  source: CopilotProviderHealthState['source'];
  eventType: CopilotProviderHealthEventType;
  fingerprint: string;
  stateFingerprint: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

type CopilotProviderHealthEventRow = {
  id: string;
  stateId: string;
  providerId: string;
  providerType: string | null;
  scopeType: CopilotProviderHealthState['scopeType'];
  workspaceId: string | null;
  actorId: string | null;
  status: CopilotProviderHealthStatus;
  checkedAt: Date;
  lastError: string | null;
  source: CopilotProviderHealthState['source'];
  eventType: CopilotProviderHealthEventType;
  fingerprint: string;
  stateFingerprint: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type CopilotProviderHealthProbeAttemptStatus =
  | 'queued'
  | 'processing'
  | 'retry_scheduled'
  | 'completed'
  | 'dead_lettered';

export type CopilotProviderHealthProbeAttemptRecord = {
  id: string;
  providerId: string;
  providerType: CopilotProviderType | null;
  scopeType: 'workspace';
  workspaceId: string;
  actorId: string;
  providerRegistryRevisionId: string;
  providerRegistryRevisionFingerprint: string;
  providerProfileSource: CopilotProviderProfileSource | 'db_revision' | null;
  providerProfileFingerprint: string;
  providerProfileSnapshot: Record<string, unknown>;
  requestFingerprint: string;
  status: CopilotProviderHealthProbeAttemptStatus;
  attemptCount: number;
  maxAttempts: number;
  scheduledAt: Date;
  workerLeaseId: string | null;
  workerLeaseExpiresAt: Date | null;
  checkedAt: Date | null;
  completedAt: Date | null;
  deadLetteredAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  resultStatus: CopilotProviderHealthStatus | null;
  resultLastError: string | null;
  resultMetadata: Record<string, unknown>;
  resultFingerprint: string | null;
  providerHealthStateId: string | null;
  providerHealthStateFingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CopilotProviderHealthProbeAttemptListFilter = {
  providerId?: string | null;
  providerRegistryRevisionId?: string | null;
  providerRegistryRevisionFingerprint?: string | null;
  providerProfileFingerprint?: string | null;
  query?: string | null;
  requestFingerprint?: string | null;
  resultFingerprint?: string | null;
  status?: CopilotProviderHealthProbeAttemptStatus | null;
};

type CopilotProviderHealthProbeAttemptRow = {
  id: string;
  providerId: string;
  providerType: string | null;
  scopeType: string;
  workspaceId: string | null;
  actorId: string | null;
  providerRegistryRevisionId: string | null;
  providerRegistryRevisionFingerprint: string | null;
  providerProfileSource: string | null;
  providerProfileFingerprint: string;
  providerProfileSnapshot: Record<string, unknown> | null;
  requestFingerprint: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  scheduledAt: Date;
  workerLeaseId: string | null;
  workerLeaseExpiresAt: Date | null;
  checkedAt: Date | null;
  completedAt: Date | null;
  deadLetteredAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  resultStatus: string | null;
  resultLastError: string | null;
  resultMetadata: Record<string, unknown> | null;
  resultFingerprint: string | null;
  providerHealthStateId: string | null;
  providerHealthStateFingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CopilotProviderHealthProbeAttemptEnqueueEvidence = Pick<
  CopilotProviderHealthProbeAttemptRecord,
  | 'actorId'
  | 'id'
  | 'providerId'
  | 'providerProfileFingerprint'
  | 'providerProfileSnapshot'
  | 'providerProfileSource'
  | 'providerRegistryRevisionFingerprint'
  | 'providerRegistryRevisionId'
  | 'providerType'
  | 'requestFingerprint'
  | 'scopeType'
  | 'workspaceId'
>;

export type CopilotProviderHealthProbeExecutionResult = {
  status: CopilotProviderHealthStatus;
  checkedAt?: Date | string | null;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
};

export type CopilotProviderHealthProbeProcessingResult = {
  processedAt: Date;
  processedCount: number;
  completedCount: number;
  retryScheduledCount: number;
  deadLetteredCount: number;
  failedCount: number;
  attemptIds: string[];
};

export type CopilotProviderHealthWorkspaceProbeTarget = {
  providerId: string;
  providerType: CopilotProviderType | null;
  workspaceId: string;
  actorId: string;
  providerRegistryRevisionId: string;
  providerRegistryRevisionFingerprint: string;
};

type ProviderHealthEventInput = {
  stateId: string;
  providerId: string;
  providerType?: CopilotProviderType | string | null;
  scopeType: CopilotProviderHealthState['scopeType'];
  workspaceId?: string | null;
  actorId?: string | null;
  status: CopilotProviderHealthStatus;
  checkedAt: Date;
  lastError?: string | null;
  source: CopilotProviderHealthState['source'];
  eventType: CopilotProviderHealthEventType;
  stateFingerprint: string;
  metadata: Record<string, unknown>;
};

type ProviderHealthEventConflictEvidence = {
  actorId: string | null;
  checkedAt: Date;
  eventFingerprint: string;
  eventType: CopilotProviderHealthEventType;
  lastError: string | null;
  metadataFingerprint: string;
  providerId: string;
  providerType: string | null;
  scopeType: CopilotProviderHealthState['scopeType'];
  source: CopilotProviderHealthState['source'];
  stateFingerprint: string;
  stateId: string;
  status: CopilotProviderHealthStatus;
  workspaceId: string | null;
};

export type ProviderHealthStateOverlay = {
  providerId: string;
  providerType?: CopilotProviderType;
  scopeType: 'global' | 'workspace';
  workspaceId?: string;
  actorId?: string;
  status: CopilotProviderHealthStatus;
  checkedAt: Date;
  lastError?: string;
  source: CopilotProviderHealthState['source'];
  fingerprint: string;
  id: string;
  updatedAt: Date;
};

export const PROVIDER_HEALTH_STATE_PROBE_RESULT_MAX_AGE_MS =
  7 * 24 * 60 * 60 * 1000;

function stableProviderHealthStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableProviderHealthStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined
          ? null
          : `${JSON.stringify(key)}:${stableProviderHealthStringify(item)}`;
      })
      .filter(Boolean)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function providerHealthStateFingerprint(value: unknown) {
  return createHash('sha256')
    .update(stableProviderHealthStringify(value))
    .digest('hex')
    .slice(0, 16);
}

const HEALTH_STATUSES = new Set<string>(CopilotProviderHealthStatusValues);
const PROVIDER_HEALTH_LAST_ERROR_MAX_LENGTH = 512;
const PROVIDER_HEALTH_METADATA_JSON_MAX_LENGTH = 8192;
const PROVIDER_HEALTH_METADATA_STRING_MAX_LENGTH = 512;
const PROVIDER_HEALTH_METADATA_TIMESTAMP_MAX_LENGTH = 128;
const PROVIDER_HEALTH_METADATA_FINGERPRINT_MAX_LENGTH = 128;
const PROVIDER_HEALTH_STATE_ID_MAX_LENGTH = 512;
const PROVIDER_HEALTH_EVENT_TYPES = new Set<CopilotProviderHealthEventType>([
  'manual_override_recorded',
  'workspace_probe_result_recorded',
  'configured_snapshot_recorded',
  'configured_snapshot_cleared',
  'stale_probe_result_cleared',
]);
const PROVIDER_HEALTH_METADATA_VERSION = 'provider-health-state-metadata/v1';
const CONFIGURED_PROVIDER_HEALTH_SNAPSHOT_CLEANUP_REASON =
  'configured_provider_health_snapshot_missing';
const PROVIDER_HEALTH_PROBE_RESULT_STALE_CLEANUP_REASON =
  'provider_health_probe_result_stale';
const PROVIDER_HEALTH_PROBE_ATTEMPT_RESULT_VERSION =
  'provider-health-probe-attempt-result/v1';
const PROVIDER_HEALTH_PROBE_ATTEMPT_MAX_ATTEMPTS = 3;
const PROVIDER_HEALTH_PROBE_ATTEMPT_WORKER_LEASE_MS = 5 * 60 * 1000;
const PROVIDER_HEALTH_PROBE_ATTEMPT_MANUAL_RETRY_INTERVAL_MS = 60 * 1000;
const PROVIDER_HEALTH_PROBE_ATTEMPT_JSON_MAX_LENGTH = 16 * 1024;
const PROVIDER_HEALTH_PROBE_ATTEMPT_STRING_MAX_LENGTH = 512;
const PROVIDER_HEALTH_PROBE_ATTEMPT_FAILURE_CODE_MAX_LENGTH = 128;
const PROVIDER_HEALTH_PROBE_ATTEMPT_STATUSES =
  new Set<CopilotProviderHealthProbeAttemptStatus>([
    'queued',
    'processing',
    'retry_scheduled',
    'completed',
    'dead_lettered',
  ]);

function normalizeProbeAttemptStatus(
  value: unknown
): CopilotProviderHealthProbeAttemptStatus {
  if (
    typeof value === 'string' &&
    PROVIDER_HEALTH_PROBE_ATTEMPT_STATUSES.has(
      value as CopilotProviderHealthProbeAttemptStatus
    )
  ) {
    return value as CopilotProviderHealthProbeAttemptStatus;
  }
  return 'dead_lettered';
}

function normalizeOptionalProbeAttemptStatusFilter(
  value: unknown
): CopilotProviderHealthProbeAttemptStatus | null {
  if (value == null) {
    return null;
  }
  if (
    typeof value === 'string' &&
    PROVIDER_HEALTH_PROBE_ATTEMPT_STATUSES.has(
      value as CopilotProviderHealthProbeAttemptStatus
    )
  ) {
    return value as CopilotProviderHealthProbeAttemptStatus;
  }
  throw new Error('Invalid provider health probe attempt status filter');
}

function normalizeOptionalProbeAttemptFilterString(
  value: unknown,
  field: string
): string | null {
  if (value == null) {
    return null;
  }
  const normalized = optionalString(
    value,
    PROVIDER_HEALTH_PROBE_ATTEMPT_STRING_MAX_LENGTH
  );
  if (!normalized) {
    throw new Error(`Invalid provider health probe attempt ${field} filter`);
  }
  return normalized;
}

function normalizeProbeAttemptListFilter(
  input?: CopilotProviderHealthProbeAttemptListFilter | null
): Required<CopilotProviderHealthProbeAttemptListFilter> {
  return {
    providerId: normalizeOptionalProbeAttemptFilterString(
      input?.providerId,
      'providerId'
    ),
    providerProfileFingerprint: normalizeOptionalProbeAttemptFilterString(
      input?.providerProfileFingerprint,
      'providerProfileFingerprint'
    ),
    query: normalizeOptionalProbeAttemptFilterString(input?.query, 'query'),
    providerRegistryRevisionFingerprint:
      normalizeOptionalProbeAttemptFilterString(
        input?.providerRegistryRevisionFingerprint,
        'providerRegistryRevisionFingerprint'
      ),
    providerRegistryRevisionId: normalizeOptionalProbeAttemptFilterString(
      input?.providerRegistryRevisionId,
      'providerRegistryRevisionId'
    ),
    requestFingerprint: normalizeOptionalProbeAttemptFilterString(
      input?.requestFingerprint,
      'requestFingerprint'
    ),
    resultFingerprint: normalizeOptionalProbeAttemptFilterString(
      input?.resultFingerprint,
      'resultFingerprint'
    ),
    status: normalizeOptionalProbeAttemptStatusFilter(input?.status),
  };
}

function normalizeProbeAttemptScopeType(value: unknown): 'workspace' {
  if (value !== 'workspace') {
    throw new Error('Provider health probe attempt requires workspace scope');
  }
  return 'workspace';
}

function requireProbeAttemptString(value: unknown, field: string) {
  const normalized = optionalString(
    value,
    PROVIDER_HEALTH_PROBE_ATTEMPT_STRING_MAX_LENGTH
  );
  if (!normalized) {
    throw new Error(`Provider health probe attempt requires ${field}`);
  }
  return normalized;
}

function normalizeProbeAttemptJson(
  value: unknown,
  field: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Provider health probe attempt ${field} must be an object`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(
      `Provider health probe attempt ${field} must be JSON serializable`
    );
  }
  if (serialized.length > PROVIDER_HEALTH_PROBE_ATTEMPT_JSON_MAX_LENGTH) {
    throw new Error(`Provider health probe attempt ${field} is too large`);
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function normalizeProbeAttemptFailure(input: unknown): {
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
} {
  if (
    input &&
    typeof input === 'object' &&
    'retryable' in input &&
    'errorCode' in input &&
    'errorMessage' in input
  ) {
    const record = input as {
      errorCode?: unknown;
      errorMessage?: unknown;
      retryable?: unknown;
    };
    return {
      errorCode:
        optionalString(
          record.errorCode,
          PROVIDER_HEALTH_PROBE_ATTEMPT_FAILURE_CODE_MAX_LENGTH
        ) ?? 'provider_health_probe_failed',
      errorMessage:
        optionalString(
          record.errorMessage,
          PROVIDER_HEALTH_LAST_ERROR_MAX_LENGTH
        ) ?? 'Provider health probe failed',
      retryable: record.retryable !== false,
    };
  }

  return {
    errorCode: 'provider_health_probe_failed',
    errorMessage:
      optionalString(
        input instanceof Error ? input.message : undefined,
        PROVIDER_HEALTH_LAST_ERROR_MAX_LENGTH
      ) ?? 'Provider health probe failed',
    retryable: true,
  };
}

function sanitizeProbeProviderProfileSnapshot(
  revision: ProviderRegistryRevision
) {
  const profile = revision.providerProfile;
  const modelDefinitions = Array.isArray(profile.modelDefinitions)
    ? profile.modelDefinitions.map(definition => {
        const record = definition as Record<string, unknown>;
        return {
          id: record.id,
          rawModelId: record.rawModelId ?? null,
          displayName: record.displayName ?? null,
          capabilities: record.capabilities ?? [],
        };
      })
    : [];
  return normalizeProbeAttemptJson(
    {
      version: 'provider-health-probe-target/v1',
      providerId: revision.providerId,
      providerType: revision.providerType ?? revision.providerProfile.type,
      scopeType: revision.scopeType,
      workspaceId: revision.workspaceId ?? null,
      actorId: revision.actorId ?? null,
      revision: revision.revision,
      revisionId: revision.id,
      revisionFingerprint: revision.fingerprint,
      providerProfileSource: revision.providerProfile.source,
      enabled: profile.enabled ?? true,
      privacy: profile.privacy ?? null,
      modelCount: modelDefinitions.length,
      modelDefinitions,
      fallbackSourceChainFingerprint: providerHealthStateFingerprint({
        version: 'provider-health-probe-target-source-chain/v1',
        fallbackSourceChain: revision.fallbackSourceChain,
      }),
    },
    'providerProfileSnapshot'
  );
}

function hydrateProbeAttemptRecord(
  row: CopilotProviderHealthProbeAttemptRow
): CopilotProviderHealthProbeAttemptRecord {
  const workspaceId = requireProbeAttemptString(row.workspaceId, 'workspaceId');
  const actorId = requireProbeAttemptString(row.actorId, 'actorId');
  const providerRegistryRevisionId = requireProbeAttemptString(
    row.providerRegistryRevisionId,
    'providerRegistryRevisionId'
  );
  const providerRegistryRevisionFingerprint = requireProbeAttemptString(
    row.providerRegistryRevisionFingerprint,
    'providerRegistryRevisionFingerprint'
  );
  return {
    id: row.id,
    providerId: row.providerId,
    providerType: row.providerType as CopilotProviderType | null,
    scopeType: normalizeProbeAttemptScopeType(row.scopeType),
    workspaceId,
    actorId,
    providerRegistryRevisionId,
    providerRegistryRevisionFingerprint,
    providerProfileSource: row.providerProfileSource as
      | CopilotProviderProfileSource
      | 'db_revision'
      | null,
    providerProfileFingerprint: row.providerProfileFingerprint,
    providerProfileSnapshot: row.providerProfileSnapshot ?? {},
    requestFingerprint: row.requestFingerprint,
    status: normalizeProbeAttemptStatus(row.status),
    attemptCount: Number(row.attemptCount ?? 0),
    maxAttempts: Number(row.maxAttempts ?? 0),
    scheduledAt: row.scheduledAt,
    workerLeaseId: row.workerLeaseId,
    workerLeaseExpiresAt: row.workerLeaseExpiresAt,
    checkedAt: row.checkedAt,
    completedAt: row.completedAt,
    deadLetteredAt: row.deadLetteredAt,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    resultStatus: row.resultStatus ? normalizeStatus(row.resultStatus) : null,
    resultLastError: row.resultLastError,
    resultMetadata: row.resultMetadata ?? {},
    resultFingerprint: row.resultFingerprint,
    providerHealthStateId: row.providerHealthStateId,
    providerHealthStateFingerprint: row.providerHealthStateFingerprint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertProbeAttemptMatchesEnqueueEvidence(
  attempt: CopilotProviderHealthProbeAttemptRecord,
  expected: CopilotProviderHealthProbeAttemptEnqueueEvidence
) {
  if (
    attempt.id !== expected.id ||
    attempt.providerId !== expected.providerId ||
    attempt.providerType !== expected.providerType ||
    attempt.scopeType !== expected.scopeType ||
    attempt.workspaceId !== expected.workspaceId ||
    attempt.actorId !== expected.actorId ||
    attempt.providerRegistryRevisionId !==
      expected.providerRegistryRevisionId ||
    attempt.providerRegistryRevisionFingerprint !==
      expected.providerRegistryRevisionFingerprint ||
    attempt.providerProfileSource !== expected.providerProfileSource ||
    attempt.providerProfileFingerprint !==
      expected.providerProfileFingerprint ||
    attempt.requestFingerprint !== expected.requestFingerprint ||
    providerHealthStateFingerprint({
      version: 'provider-health-probe-attempt-profile-snapshot/v1',
      providerProfileSnapshot: attempt.providerProfileSnapshot,
    }) !==
      providerHealthStateFingerprint({
        version: 'provider-health-probe-attempt-profile-snapshot/v1',
        providerProfileSnapshot: expected.providerProfileSnapshot,
      })
  ) {
    throw new Error(
      'Provider health probe attempt conflict reused mismatched request evidence'
    );
  }
}

function normalizeStatus(value: unknown): CopilotProviderHealthStatus {
  if (typeof value === 'string' && HEALTH_STATUSES.has(value)) {
    return value as CopilotProviderHealthStatus;
  }
  throw new Error('Invalid provider health status');
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, maxLength);
}

function normalizeCheckedAt(
  value: Date | string | null | undefined,
  errorMessage: string
) {
  const checkedAt = value ? new Date(value) : new Date();
  if (Number.isNaN(checkedAt.getTime())) {
    throw new Error(errorMessage);
  }
  return checkedAt;
}

function normalizeProbeResultMaxAgeMs(value?: number | null) {
  const maxAgeMs = value ?? PROVIDER_HEALTH_STATE_PROBE_RESULT_MAX_AGE_MS;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error('Invalid provider health probe result max age');
  }
  return maxAgeMs;
}

function normalizeSource(value: unknown): CopilotProviderHealthState['source'] {
  return value === 'probe_result' ? 'probe_result' : 'manual_override';
}

function requireMetadataString(
  metadata: Record<string, unknown>,
  field: string,
  maxLength = PROVIDER_HEALTH_METADATA_STRING_MAX_LENGTH
) {
  const value = metadata[field];
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error('Provider health metadata contract is invalid');
  }
  return value;
}

function requireNullableMetadataString(
  metadata: Record<string, unknown>,
  field: string,
  maxLength = PROVIDER_HEALTH_METADATA_STRING_MAX_LENGTH
) {
  const value = metadata[field];
  if (
    value !== null &&
    (typeof value !== 'string' || !value.trim() || value.length > maxLength)
  ) {
    throw new Error('Provider health metadata contract is invalid');
  }
}

function requireMetadataNumber(
  metadata: Record<string, unknown>,
  field: string
) {
  const value = metadata[field];
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 31_536_000_000
  ) {
    throw new Error('Provider health metadata contract is invalid');
  }
}

function validateProviderHealthMetadata(
  metadata: Record<string, unknown>,
  source: CopilotProviderHealthState['source']
) {
  if (metadata.version !== PROVIDER_HEALTH_METADATA_VERSION) {
    throw new Error('Provider health metadata contract is invalid');
  }
  const publishSource = requireMetadataString(metadata, 'publishSource', 128);
  if (source === 'manual_override' && publishSource !== 'graphql_mutation') {
    throw new Error('Provider health metadata contract is invalid');
  }
  if (
    source === 'probe_result' &&
    publishSource !== 'workspace_provider_health_probe_result' &&
    publishSource !== 'configured_provider_health_snapshot_worker' &&
    publishSource !== 'configured_provider_health_snapshot_cleanup_worker' &&
    publishSource !== 'provider_health_probe_result_stale_cleanup_worker'
  ) {
    throw new Error('Provider health metadata contract is invalid');
  }

  requireNullableMetadataString(metadata, 'providerProfileSource', 128);
  if (metadata.providerProfileId !== undefined) {
    requireMetadataString(metadata, 'providerProfileId');
  }

  if (publishSource === 'configured_provider_health_snapshot_worker') {
    requireMetadataString(metadata, 'providerProfileId');
    requireMetadataString(metadata, 'providerProfileSnapshotSource', 128);
    if (metadata.providerProfileConfigPath !== undefined) {
      requireMetadataString(metadata, 'providerProfileConfigPath', 1024);
    }
  }

  if (publishSource === 'configured_provider_health_snapshot_cleanup_worker') {
    requireMetadataString(metadata, 'providerProfileId');
    requireMetadataString(
      metadata,
      'providerProfileSnapshotCleanupReason',
      128
    );
    if (
      metadata.providerProfileSnapshotCleanupReason !==
      CONFIGURED_PROVIDER_HEALTH_SNAPSHOT_CLEANUP_REASON
    ) {
      throw new Error('Provider health metadata contract is invalid');
    }
    requireMetadataString(
      metadata,
      'previousCheckedAt',
      PROVIDER_HEALTH_METADATA_TIMESTAMP_MAX_LENGTH
    );
    requireMetadataString(
      metadata,
      'previousFingerprint',
      PROVIDER_HEALTH_METADATA_FINGERPRINT_MAX_LENGTH
    );
    requireNullableMetadataString(metadata, 'previousLastError');
    requireNullableMetadataString(metadata, 'previousPublishSource', 128);
    const previousStatus = requireMetadataString(
      metadata,
      'previousStatus',
      64
    );
    if (!HEALTH_STATUSES.has(previousStatus)) {
      throw new Error('Provider health metadata contract is invalid');
    }
  }

  if (publishSource === 'provider_health_probe_result_stale_cleanup_worker') {
    requireMetadataString(metadata, 'providerProfileId');
    requireMetadataString(
      metadata,
      'providerHealthProbeResultCleanupReason',
      128
    );
    if (
      metadata.providerHealthProbeResultCleanupReason !==
      PROVIDER_HEALTH_PROBE_RESULT_STALE_CLEANUP_REASON
    ) {
      throw new Error('Provider health metadata contract is invalid');
    }
    requireMetadataString(
      metadata,
      'previousCheckedAt',
      PROVIDER_HEALTH_METADATA_TIMESTAMP_MAX_LENGTH
    );
    requireMetadataString(
      metadata,
      'previousFingerprint',
      PROVIDER_HEALTH_METADATA_FINGERPRINT_MAX_LENGTH
    );
    requireNullableMetadataString(metadata, 'previousLastError');
    requireNullableMetadataString(metadata, 'previousPublishSource', 128);
    const previousSource = requireMetadataString(
      metadata,
      'previousSource',
      64
    );
    if (previousSource !== 'probe_result') {
      throw new Error('Provider health metadata contract is invalid');
    }
    const previousStatus = requireMetadataString(
      metadata,
      'previousStatus',
      64
    );
    if (!HEALTH_STATUSES.has(previousStatus)) {
      throw new Error('Provider health metadata contract is invalid');
    }
    requireMetadataNumber(metadata, 'probeResultMaxAgeMs');
  }
}

function normalizeMetadata(
  metadata: Record<string, unknown>,
  source: CopilotProviderHealthState['source']
) {
  validateProviderHealthMetadata(metadata, source);
  let serialized: string;
  try {
    serialized = JSON.stringify(metadata);
  } catch {
    throw new Error('Provider health metadata must be JSON serializable');
  }
  if (serialized.length > PROVIDER_HEALTH_METADATA_JSON_MAX_LENGTH) {
    throw new Error('Provider health metadata is too large');
  }
  return {
    metadata: JSON.parse(serialized) as Record<string, unknown>,
    serialized,
  };
}

function eventTypeForWrite(input: {
  scopeType: CopilotProviderHealthState['scopeType'];
  source: CopilotProviderHealthState['source'];
  metadata: Record<string, unknown>;
}): CopilotProviderHealthEventType {
  const publishSource = input.metadata.publishSource;
  if (input.source === 'manual_override') {
    return 'manual_override_recorded';
  }
  if (publishSource === 'workspace_provider_health_probe_result') {
    return 'workspace_probe_result_recorded';
  }
  if (publishSource === 'configured_provider_health_snapshot_worker') {
    return 'configured_snapshot_recorded';
  }
  if (publishSource === 'configured_provider_health_snapshot_cleanup_worker') {
    return 'configured_snapshot_cleared';
  }
  if (publishSource === 'provider_health_probe_result_stale_cleanup_worker') {
    return 'stale_probe_result_cleared';
  }
  throw new Error('Provider health event type is invalid');
}

function toState(
  row: CopilotProviderHealthStateRow
): CopilotProviderHealthState {
  return {
    id: row.id,
    providerId: row.providerId,
    ...(row.providerType
      ? { providerType: row.providerType as CopilotProviderType }
      : {}),
    scopeType: row.scopeType,
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    ...(row.actorId ? { actorId: row.actorId } : {}),
    status: row.status,
    checkedAt: row.checkedAt,
    ...(row.lastError ? { lastError: row.lastError } : {}),
    source: row.source,
    fingerprint: row.fingerprint,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    eventCount: 0,
    events: [],
  };
}

function toEvent(
  row: CopilotProviderHealthEventRow
): CopilotProviderHealthEventRecord {
  return {
    id: row.id,
    stateId: row.stateId,
    providerId: row.providerId,
    ...(row.providerType
      ? { providerType: row.providerType as CopilotProviderType }
      : {}),
    scopeType: row.scopeType,
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    ...(row.actorId ? { actorId: row.actorId } : {}),
    status: row.status,
    checkedAt: row.checkedAt,
    ...(row.lastError ? { lastError: row.lastError } : {}),
    source: row.source,
    eventType: row.eventType,
    fingerprint: row.fingerprint,
    stateFingerprint: row.stateFingerprint,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
  };
}

function providerHealthEventMetadataFingerprint(
  metadata: Record<string, unknown>
) {
  return providerHealthStateFingerprint({
    version: 'provider-health-event-metadata-conflict-evidence/v1',
    metadata,
  });
}

function assertProviderHealthEventMatchesConflictEvidence(
  event: CopilotProviderHealthEventRecord,
  expected: ProviderHealthEventConflictEvidence
) {
  if (
    event.stateId !== expected.stateId ||
    event.providerId !== expected.providerId ||
    (event.providerType ?? null) !== expected.providerType ||
    event.scopeType !== expected.scopeType ||
    (event.workspaceId ?? null) !== expected.workspaceId ||
    (event.actorId ?? null) !== expected.actorId ||
    event.status !== expected.status ||
    event.checkedAt.getTime() !== expected.checkedAt.getTime() ||
    (event.lastError ?? null) !== expected.lastError ||
    event.source !== expected.source ||
    event.eventType !== expected.eventType ||
    event.fingerprint !== expected.eventFingerprint ||
    event.stateFingerprint !== expected.stateFingerprint ||
    providerHealthEventMetadataFingerprint(event.metadata) !==
      expected.metadataFingerprint
  ) {
    throw new Error(
      'Provider health event conflict reused mismatched event evidence'
    );
  }
}

function toOverlay(
  row: CopilotProviderHealthStateRow
): ProviderHealthStateOverlay {
  return {
    id: row.id,
    providerId: row.providerId,
    ...(row.providerType
      ? { providerType: row.providerType as CopilotProviderType }
      : {}),
    scopeType: row.scopeType,
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    ...(row.actorId ? { actorId: row.actorId } : {}),
    status: row.status,
    checkedAt: row.checkedAt,
    ...(row.lastError ? { lastError: row.lastError } : {}),
    source: row.source,
    fingerprint: row.fingerprint,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class CopilotProviderHealthStateModel extends BaseModel {
  private async insertHealthEvent(input: ProviderHealthEventInput) {
    if (!PROVIDER_HEALTH_EVENT_TYPES.has(input.eventType)) {
      throw new Error('Provider health event type is invalid');
    }
    const lastError = optionalString(
      input.lastError,
      PROVIDER_HEALTH_LAST_ERROR_MAX_LENGTH
    );
    const normalizedMetadata = normalizeMetadata(input.metadata, input.source);
    const eventFingerprint = providerHealthStateFingerprint({
      version: 'provider-health-event/v1',
      stateId: input.stateId,
      providerId: input.providerId,
      providerType: input.providerType ?? null,
      scopeType: input.scopeType,
      workspaceId: input.workspaceId ?? null,
      actorId: input.actorId ?? null,
      status: input.status,
      checkedAt: input.checkedAt.toISOString(),
      lastError: lastError ?? null,
      source: input.source,
      eventType: input.eventType,
      stateFingerprint: input.stateFingerprint,
      metadata: normalizedMetadata.metadata,
    });
    const id = `provider-health-event-${eventFingerprint}`;
    const stateId = input.stateId.slice(0, PROVIDER_HEALTH_STATE_ID_MAX_LENGTH);
    const providerType = input.providerType ?? null;
    const workspaceId = input.workspaceId ?? null;
    const actorId = input.actorId ?? null;
    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_provider_health_events (
        id,
        state_id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        status,
        checked_at,
        last_error,
        source,
        event_type,
        fingerprint,
        state_fingerprint,
        metadata,
        created_at
      )
      VALUES (
        ${id},
        ${stateId},
        ${input.providerId},
        ${providerType},
        ${input.scopeType},
        ${workspaceId},
        ${actorId},
        ${input.status},
        ${input.checkedAt},
        ${lastError ?? null},
        ${input.source},
        ${input.eventType},
        ${eventFingerprint},
        ${input.stateFingerprint},
        ${normalizedMetadata.serialized}::jsonb,
        ${input.checkedAt}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (insertedRows.length) {
      return;
    }

    const existing = await this.getHealthEventById(id);
    if (!existing) {
      throw new Error('Provider health event conflict could not be verified');
    }
    assertProviderHealthEventMatchesConflictEvidence(existing, {
      actorId,
      checkedAt: input.checkedAt,
      eventFingerprint,
      eventType: input.eventType,
      lastError: lastError ?? null,
      metadataFingerprint: providerHealthEventMetadataFingerprint(
        normalizedMetadata.metadata
      ),
      providerId: input.providerId,
      providerType,
      scopeType: input.scopeType,
      source: input.source,
      stateFingerprint: input.stateFingerprint,
      stateId,
      status: input.status,
      workspaceId,
    });
  }

  private async getHealthEventById(
    id: string
  ): Promise<CopilotProviderHealthEventRecord | null> {
    const rows = await this.db.$queryRaw<CopilotProviderHealthEventRow[]>`
      SELECT
        id,
        state_id AS "stateId",
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        checked_at AS "checkedAt",
        last_error AS "lastError",
        source,
        event_type AS "eventType",
        fingerprint,
        state_fingerprint AS "stateFingerprint",
        metadata,
        created_at AS "createdAt"
      FROM ai_provider_health_events
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ? toEvent(rows[0]) : null;
  }

  private async getProbeAttemptByRequestFingerprint(
    requestFingerprint: string
  ): Promise<CopilotProviderHealthProbeAttemptRecord | null> {
    const rows = await this.db.$queryRaw<
      CopilotProviderHealthProbeAttemptRow[]
    >`
      SELECT
        id,
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        provider_registry_revision_id AS "providerRegistryRevisionId",
        provider_registry_revision_fingerprint AS "providerRegistryRevisionFingerprint",
        provider_profile_source AS "providerProfileSource",
        provider_profile_fingerprint AS "providerProfileFingerprint",
        provider_profile_snapshot AS "providerProfileSnapshot",
        request_fingerprint AS "requestFingerprint",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        scheduled_at AS "scheduledAt",
        worker_lease_id AS "workerLeaseId",
        worker_lease_expires_at AS "workerLeaseExpiresAt",
        checked_at AS "checkedAt",
        completed_at AS "completedAt",
        dead_lettered_at AS "deadLetteredAt",
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        result_status AS "resultStatus",
        result_last_error AS "resultLastError",
        result_metadata AS "resultMetadata",
        result_fingerprint AS "resultFingerprint",
        provider_health_state_id AS "providerHealthStateId",
        provider_health_state_fingerprint AS "providerHealthStateFingerprint",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_provider_health_probe_attempts
      WHERE request_fingerprint = ${requestFingerprint}
      LIMIT 1
    `;
    return rows[0] ? hydrateProbeAttemptRecord(rows[0]) : null;
  }

  async getProviderHealthProbeAttempt(
    id: string
  ): Promise<CopilotProviderHealthProbeAttemptRecord | null> {
    const rows = await this.db.$queryRaw<
      CopilotProviderHealthProbeAttemptRow[]
    >`
      SELECT
        id,
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        provider_registry_revision_id AS "providerRegistryRevisionId",
        provider_registry_revision_fingerprint AS "providerRegistryRevisionFingerprint",
        provider_profile_source AS "providerProfileSource",
        provider_profile_fingerprint AS "providerProfileFingerprint",
        provider_profile_snapshot AS "providerProfileSnapshot",
        request_fingerprint AS "requestFingerprint",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        scheduled_at AS "scheduledAt",
        worker_lease_id AS "workerLeaseId",
        worker_lease_expires_at AS "workerLeaseExpiresAt",
        checked_at AS "checkedAt",
        completed_at AS "completedAt",
        dead_lettered_at AS "deadLetteredAt",
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        result_status AS "resultStatus",
        result_last_error AS "resultLastError",
        result_metadata AS "resultMetadata",
        result_fingerprint AS "resultFingerprint",
        provider_health_state_id AS "providerHealthStateId",
        provider_health_state_fingerprint AS "providerHealthStateFingerprint",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_provider_health_probe_attempts
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ? hydrateProbeAttemptRecord(rows[0]) : null;
  }

  async listProviderHealthProbeAttempts(input: {
    filter?: CopilotProviderHealthProbeAttemptListFilter | null;
    workspaceId: string;
    limit?: number;
  }): Promise<CopilotProviderHealthProbeAttemptRecord[]> {
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 50);
    const filter = normalizeProbeAttemptListFilter(input.filter);
    const rows = await this.db.$queryRaw<
      CopilotProviderHealthProbeAttemptRow[]
    >`
      SELECT
        id,
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        provider_registry_revision_id AS "providerRegistryRevisionId",
        provider_registry_revision_fingerprint AS "providerRegistryRevisionFingerprint",
        provider_profile_source AS "providerProfileSource",
        provider_profile_fingerprint AS "providerProfileFingerprint",
        provider_profile_snapshot AS "providerProfileSnapshot",
        request_fingerprint AS "requestFingerprint",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        scheduled_at AS "scheduledAt",
        worker_lease_id AS "workerLeaseId",
        worker_lease_expires_at AS "workerLeaseExpiresAt",
        checked_at AS "checkedAt",
        completed_at AS "completedAt",
        dead_lettered_at AS "deadLetteredAt",
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        result_status AS "resultStatus",
        result_last_error AS "resultLastError",
        result_metadata AS "resultMetadata",
        result_fingerprint AS "resultFingerprint",
        provider_health_state_id AS "providerHealthStateId",
        provider_health_state_fingerprint AS "providerHealthStateFingerprint",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_provider_health_probe_attempts
      WHERE scope_type = ${'workspace'}
        AND workspace_id = ${input.workspaceId}
        AND (${filter.status}::varchar IS NULL OR status = ${filter.status})
        AND (
          ${filter.providerId}::varchar IS NULL
          OR provider_id = ${filter.providerId}
        )
        AND (
          ${filter.providerRegistryRevisionId}::varchar IS NULL
          OR provider_registry_revision_id = ${filter.providerRegistryRevisionId}
        )
        AND (
          ${filter.providerRegistryRevisionFingerprint}::varchar IS NULL
          OR provider_registry_revision_fingerprint =
            ${filter.providerRegistryRevisionFingerprint}
        )
        AND (
          ${filter.providerProfileFingerprint}::varchar IS NULL
          OR provider_profile_fingerprint = ${filter.providerProfileFingerprint}
        )
        AND (
          ${filter.query}::varchar IS NULL
          OR provider_id = ${filter.query}
          OR provider_registry_revision_id = ${filter.query}
          OR provider_registry_revision_fingerprint = ${filter.query}
          OR provider_profile_fingerprint = ${filter.query}
          OR request_fingerprint = ${filter.query}
          OR result_fingerprint = ${filter.query}
        )
        AND (
          ${filter.requestFingerprint}::varchar IS NULL
          OR request_fingerprint = ${filter.requestFingerprint}
        )
        AND (
          ${filter.resultFingerprint}::varchar IS NULL
          OR result_fingerprint = ${filter.resultFingerprint}
        )
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT ${limit}
    `;
    return rows.map(hydrateProbeAttemptRecord);
  }

  async retryDeadLetteredProviderHealthProbeAttempt(input: {
    workspaceId: string;
    attemptId: string;
    scheduledAt?: Date | string | null;
  }): Promise<CopilotProviderHealthProbeAttemptRecord> {
    const previous = await this.getProviderHealthProbeAttempt(input.attemptId);
    if (!previous || previous.workspaceId !== input.workspaceId) {
      throw new Error('Provider health probe attempt not found');
    }
    if (previous.status !== 'dead_lettered') {
      throw new Error(
        'Provider health probe attempt retry requires a dead-lettered attempt'
      );
    }
    const revision = await this.models.copilotProviderRegistryRevision.resolve(
      previous.workspaceId,
      previous.providerId
    );
    if (!revision || revision.id !== previous.providerRegistryRevisionId) {
      throw new Error(
        'Provider health probe attempt retry requires the original active provider revision'
      );
    }
    if (revision.fingerprint !== previous.providerRegistryRevisionFingerprint) {
      throw new Error(
        'Provider health probe attempt retry requires matching revision fingerprint'
      );
    }

    const requestedScheduledAt = input.scheduledAt
      ? normalizeCheckedAt(
          input.scheduledAt,
          'Invalid provider health probe retry scheduledAt'
        )
      : new Date();
    const minimumRetryScheduledAt = new Date(
      Math.max(
        requestedScheduledAt.getTime(),
        previous.deadLetteredAt
          ? previous.deadLetteredAt.getTime() +
              PROVIDER_HEALTH_PROBE_ATTEMPT_MANUAL_RETRY_INTERVAL_MS
          : previous.scheduledAt.getTime() +
              PROVIDER_HEALTH_PROBE_ATTEMPT_MANUAL_RETRY_INTERVAL_MS
      )
    );

    return await this.enqueueWorkspaceProviderHealthProbeAttempt({
      revision,
      scheduledAt: minimumRetryScheduledAt,
      intervalMs: PROVIDER_HEALTH_PROBE_ATTEMPT_MANUAL_RETRY_INTERVAL_MS,
    });
  }

  @Transactional()
  async enqueueWorkspaceProviderHealthProbeAttempt(input: {
    revision: ProviderRegistryRevision;
    scheduledAt?: Date | string | null;
    intervalMs?: number;
  }): Promise<CopilotProviderHealthProbeAttemptRecord> {
    const revision = input.revision;
    if (revision.scopeType !== 'workspace' || !revision.workspaceId) {
      throw new Error(
        'Provider health probe attempt requires workspace revision'
      );
    }
    if (!revision.actorId) {
      throw new Error('Provider health probe attempt requires actorId');
    }
    const scheduledAt = normalizeCheckedAt(
      input.scheduledAt,
      'Invalid provider health probe scheduledAt'
    );
    const intervalMs = normalizeProbeResultMaxAgeMs(
      input.intervalMs ?? 24 * 60 * 60 * 1000
    );
    const bucketStart = new Date(
      Math.floor(scheduledAt.getTime() / intervalMs) * intervalMs
    );
    const providerProfileSnapshot =
      sanitizeProbeProviderProfileSnapshot(revision);
    const providerProfileFingerprint = providerRegistryRevisionFingerprint({
      version: 'provider-health-probe-profile/v1',
      providerId: revision.providerId,
      providerType: revision.providerType ?? revision.providerProfile.type,
      providerProfileSnapshot,
    });
    const requestFingerprint = providerHealthStateFingerprint({
      version: 'provider-health-probe-request/v1',
      providerId: revision.providerId,
      scopeType: 'workspace',
      workspaceId: revision.workspaceId,
      providerRegistryRevisionId: revision.id,
      providerRegistryRevisionFingerprint: revision.fingerprint,
      providerProfileFingerprint,
      bucketStart: bucketStart.toISOString(),
    });
    const id = `provider-health-probe-${requestFingerprint}`;
    const now = new Date();
    const enqueueEvidence: CopilotProviderHealthProbeAttemptEnqueueEvidence = {
      actorId: revision.actorId,
      id,
      providerId: revision.providerId,
      providerProfileFingerprint,
      providerProfileSnapshot,
      providerProfileSource: revision.providerProfile.source ?? null,
      providerRegistryRevisionFingerprint: revision.fingerprint,
      providerRegistryRevisionId: revision.id,
      providerType:
        revision.providerType ?? revision.providerProfile.type ?? null,
      requestFingerprint,
      scopeType: 'workspace',
      workspaceId: revision.workspaceId,
    };

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_provider_health_probe_attempts (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        provider_registry_revision_id,
        provider_registry_revision_fingerprint,
        provider_profile_source,
        provider_profile_fingerprint,
        provider_profile_snapshot,
        request_fingerprint,
        status,
        attempt_count,
        max_attempts,
        scheduled_at,
        result_metadata,
        created_at,
        updated_at
      )
      SELECT
        ${id},
        ${revision.providerId},
        ${revision.providerType ?? revision.providerProfile.type ?? null},
        ${'workspace'},
        ${revision.workspaceId},
        ${revision.actorId},
        ${revision.id},
        ${revision.fingerprint},
        ${revision.providerProfile.source ?? null},
        ${providerProfileFingerprint},
        ${JSON.stringify(providerProfileSnapshot)}::jsonb,
        ${requestFingerprint},
        ${'queued'},
        ${0},
        ${PROVIDER_HEALTH_PROBE_ATTEMPT_MAX_ATTEMPTS},
        ${scheduledAt},
        ${'{}'}::jsonb,
        ${now},
        ${now}
      FROM ai_provider_registry_revisions provider_revision
      WHERE provider_revision.id = ${revision.id}
        AND provider_revision.provider_id = ${revision.providerId}
        AND provider_revision.provider_type IS NOT DISTINCT FROM ${
          revision.providerType ?? revision.providerProfile.type ?? null
        }
        AND provider_revision.scope_type = ${revision.scopeType}
        AND provider_revision.workspace_id = ${revision.workspaceId}
        AND provider_revision.actor_id = ${revision.actorId}
        AND provider_revision.revision = ${revision.revision}
        AND provider_revision.status = ${revision.status}
        AND provider_revision.status = ${'active'}
        AND provider_revision.fingerprint = ${revision.fingerprint}
        AND provider_revision.provider_profile = ${JSON.stringify(
          revision.providerProfileSnapshot
        )}::jsonb
        AND provider_revision.fallback_source_chain = ${JSON.stringify(
          revision.fallbackSourceChainSnapshot
        )}::jsonb
        AND provider_revision.metadata = ${JSON.stringify(
          revision.metadata
        )}::jsonb
        AND provider_revision.created_at = ${revision.createdAt}
        AND provider_revision.updated_at = ${revision.updatedAt}
      ON CONFLICT (request_fingerprint) DO NOTHING
      RETURNING id
    `;

    const attempt =
      await this.getProbeAttemptByRequestFingerprint(requestFingerprint);
    if (!attempt) {
      if (!insertedRows.length) {
        throw new Error(
          `Provider health probe attempt could not be queued because its provider revision state changed: ${revision.id}`
        );
      }
      throw new Error(`Created provider health probe attempt not found: ${id}`);
    }
    assertProbeAttemptMatchesEnqueueEvidence(attempt, enqueueEvidence);
    return attempt;
  }

  async leaseDueProviderHealthProbeAttempts(input: {
    id?: string;
    limit?: number;
    checkedAt?: Date | string | null;
    leaseMs?: number;
  }): Promise<CopilotProviderHealthProbeAttemptRecord[]> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
    const now = normalizeCheckedAt(
      input.checkedAt,
      'Invalid provider health probe checkedAt'
    );
    const leaseMs = normalizeProbeResultMaxAgeMs(
      input.leaseMs ?? PROVIDER_HEALTH_PROBE_ATTEMPT_WORKER_LEASE_MS
    );
    const workerLeaseId = `provider-health-probe-worker-${randomUUID()}`;
    const workerLeaseExpiresAt = new Date(now.getTime() + leaseMs);

    const rows = await this.db.$queryRaw<
      CopilotProviderHealthProbeAttemptRow[]
    >`
      WITH due_attempts AS (
        SELECT id
        FROM ai_provider_health_probe_attempts
        WHERE
          (${input.id ?? null}::varchar IS NULL OR id = ${input.id ?? null})
          AND (
            status IN (${`queued`}, ${`retry_scheduled`})
            OR (
              status = ${'processing'}
              AND worker_lease_expires_at IS NOT NULL
              AND worker_lease_expires_at <= ${now}
            )
          )
          AND scheduled_at <= ${now}
        ORDER BY scheduled_at ASC, created_at ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ai_provider_health_probe_attempts attempt
      SET
        status = ${'processing'},
        attempt_count = LEAST(attempt.max_attempts, attempt.attempt_count + 1),
        worker_lease_id = ${workerLeaseId},
        worker_lease_expires_at = ${workerLeaseExpiresAt},
        failure_code = NULL,
        failure_message = NULL,
        updated_at = ${now}
      FROM due_attempts
      WHERE attempt.id = due_attempts.id
      RETURNING
        attempt.id,
        attempt.provider_id AS "providerId",
        attempt.provider_type AS "providerType",
        attempt.scope_type AS "scopeType",
        attempt.workspace_id AS "workspaceId",
        attempt.actor_id AS "actorId",
        attempt.provider_registry_revision_id AS "providerRegistryRevisionId",
        attempt.provider_registry_revision_fingerprint AS "providerRegistryRevisionFingerprint",
        attempt.provider_profile_source AS "providerProfileSource",
        attempt.provider_profile_fingerprint AS "providerProfileFingerprint",
        attempt.provider_profile_snapshot AS "providerProfileSnapshot",
        attempt.request_fingerprint AS "requestFingerprint",
        attempt.status,
        attempt.attempt_count AS "attemptCount",
        attempt.max_attempts AS "maxAttempts",
        attempt.scheduled_at AS "scheduledAt",
        attempt.worker_lease_id AS "workerLeaseId",
        attempt.worker_lease_expires_at AS "workerLeaseExpiresAt",
        attempt.checked_at AS "checkedAt",
        attempt.completed_at AS "completedAt",
        attempt.dead_lettered_at AS "deadLetteredAt",
        attempt.failure_code AS "failureCode",
        attempt.failure_message AS "failureMessage",
        attempt.result_status AS "resultStatus",
        attempt.result_last_error AS "resultLastError",
        attempt.result_metadata AS "resultMetadata",
        attempt.result_fingerprint AS "resultFingerprint",
        attempt.provider_health_state_id AS "providerHealthStateId",
        attempt.provider_health_state_fingerprint AS "providerHealthStateFingerprint",
        attempt.created_at AS "createdAt",
        attempt.updated_at AS "updatedAt"
    `;
    return rows.map(hydrateProbeAttemptRecord);
  }

  private probeAttemptRetryDelay(attemptCount: number) {
    const delayMs = Math.min(
      60_000 * 2 ** Math.max(attemptCount - 1, 0),
      15 * 60_000
    );
    return new Date(Date.now() + delayMs);
  }

  private async lockProviderHealthProbeAttempt(
    id: string
  ): Promise<CopilotProviderHealthProbeAttemptRecord | null> {
    const rows = await this.db.$queryRaw<
      CopilotProviderHealthProbeAttemptRow[]
    >`
      SELECT
        id,
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        provider_registry_revision_id AS "providerRegistryRevisionId",
        provider_registry_revision_fingerprint AS "providerRegistryRevisionFingerprint",
        provider_profile_source AS "providerProfileSource",
        provider_profile_fingerprint AS "providerProfileFingerprint",
        provider_profile_snapshot AS "providerProfileSnapshot",
        request_fingerprint AS "requestFingerprint",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        scheduled_at AS "scheduledAt",
        worker_lease_id AS "workerLeaseId",
        worker_lease_expires_at AS "workerLeaseExpiresAt",
        checked_at AS "checkedAt",
        completed_at AS "completedAt",
        dead_lettered_at AS "deadLetteredAt",
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        result_status AS "resultStatus",
        result_last_error AS "resultLastError",
        result_metadata AS "resultMetadata",
        result_fingerprint AS "resultFingerprint",
        provider_health_state_id AS "providerHealthStateId",
        provider_health_state_fingerprint AS "providerHealthStateFingerprint",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_provider_health_probe_attempts
      WHERE id = ${id}
      LIMIT 1
      FOR UPDATE
    `;
    return rows[0] ? hydrateProbeAttemptRecord(rows[0]) : null;
  }

  private isCurrentProviderHealthProbeAttemptLease(input: {
    attempt: CopilotProviderHealthProbeAttemptRecord;
    current: CopilotProviderHealthProbeAttemptRecord;
    now: Date;
  }) {
    const { attempt, current, now } = input;
    return (
      current.status === 'processing' &&
      current.workerLeaseId === attempt.workerLeaseId &&
      current.attemptCount === attempt.attemptCount &&
      !!current.workerLeaseExpiresAt &&
      current.workerLeaseExpiresAt.getTime() > now.getTime()
    );
  }

  @Transactional()
  async completeProviderHealthProbeAttempt(input: {
    attempt: CopilotProviderHealthProbeAttemptRecord;
    result: CopilotProviderHealthProbeExecutionResult;
  }): Promise<CopilotProviderHealthProbeAttemptRecord> {
    const attempt = input.attempt;
    if (attempt.status !== 'processing' || !attempt.workerLeaseId) {
      throw new Error('Provider health probe attempt is not leased');
    }
    const now = new Date();
    const current = await this.lockProviderHealthProbeAttempt(attempt.id);
    if (!current) {
      throw new Error('Provider health probe attempt not found');
    }
    if (
      !this.isCurrentProviderHealthProbeAttemptLease({
        attempt,
        current,
        now,
      })
    ) {
      return current;
    }
    const leasedAttempt = current;
    const status = normalizeStatus(input.result.status);
    const checkedAt = normalizeCheckedAt(
      input.result.checkedAt,
      'Invalid provider health probe checkedAt'
    );
    const lastError = optionalString(
      input.result.lastError,
      PROVIDER_HEALTH_LAST_ERROR_MAX_LENGTH
    );
    const resultMetadata = normalizeProbeAttemptJson(
      {
        ...input.result.metadata,
        version: PROVIDER_HEALTH_PROBE_ATTEMPT_RESULT_VERSION,
        providerHealthProbeAttemptId: leasedAttempt.id,
        providerHealthProbeRequestFingerprint: leasedAttempt.requestFingerprint,
        providerRegistryRevisionId: leasedAttempt.providerRegistryRevisionId,
        providerRegistryRevisionFingerprint:
          leasedAttempt.providerRegistryRevisionFingerprint,
        providerProfileFingerprint: leasedAttempt.providerProfileFingerprint,
      },
      'resultMetadata'
    );
    const resultFingerprint = providerHealthStateFingerprint({
      version: 'provider-health-probe-result/v1',
      attemptId: leasedAttempt.id,
      providerId: leasedAttempt.providerId,
      workspaceId: leasedAttempt.workspaceId,
      status,
      checkedAt: checkedAt.toISOString(),
      lastError: lastError ?? null,
      resultMetadata,
    });
    const healthState = await this.upsertWorkspaceState({
      workspaceId: leasedAttempt.workspaceId,
      actorId: leasedAttempt.actorId,
      providerId: leasedAttempt.providerId,
      providerType: leasedAttempt.providerType,
      status,
      source: 'probe_result',
      checkedAt,
      lastError,
      providerProfileSource: leasedAttempt.providerProfileSource,
      metadata: {
        providerProfileId: leasedAttempt.providerId,
        providerHealthProbeAttemptId: leasedAttempt.id,
        providerHealthProbeRequestFingerprint: leasedAttempt.requestFingerprint,
        providerRegistryRevisionId: leasedAttempt.providerRegistryRevisionId,
        providerRegistryRevisionFingerprint:
          leasedAttempt.providerRegistryRevisionFingerprint,
        providerProfileFingerprint: leasedAttempt.providerProfileFingerprint,
        resultFingerprint,
      },
    });
    const updatedCount = await this.db.$executeRaw`
      UPDATE ai_provider_health_probe_attempts
      SET
        status = ${'completed'},
        checked_at = ${checkedAt},
        completed_at = ${now},
        dead_lettered_at = NULL,
        worker_lease_id = NULL,
        worker_lease_expires_at = NULL,
        failure_code = NULL,
        failure_message = NULL,
        result_status = ${status},
        result_last_error = ${lastError ?? null},
        result_metadata = ${JSON.stringify(resultMetadata)}::jsonb,
        result_fingerprint = ${resultFingerprint},
        provider_health_state_id = ${healthState.id},
        provider_health_state_fingerprint = ${healthState.fingerprint},
        updated_at = ${now}
      WHERE id = ${leasedAttempt.id}
        AND provider_id = ${leasedAttempt.providerId}
        AND provider_type IS NOT DISTINCT FROM ${leasedAttempt.providerType}
        AND scope_type = ${leasedAttempt.scopeType}
        AND workspace_id = ${leasedAttempt.workspaceId}
        AND actor_id = ${leasedAttempt.actorId}
        AND provider_registry_revision_id = ${
          leasedAttempt.providerRegistryRevisionId
        }
        AND provider_registry_revision_fingerprint = ${
          leasedAttempt.providerRegistryRevisionFingerprint
        }
        AND provider_profile_source IS NOT DISTINCT FROM ${
          leasedAttempt.providerProfileSource
        }
        AND provider_profile_fingerprint = ${
          leasedAttempt.providerProfileFingerprint
        }
        AND provider_profile_snapshot = ${JSON.stringify(
          leasedAttempt.providerProfileSnapshot
        )}::jsonb
        AND request_fingerprint = ${leasedAttempt.requestFingerprint}
        AND status = ${leasedAttempt.status}
        AND status = ${'processing'}
        AND attempt_count = ${leasedAttempt.attemptCount}
        AND max_attempts = ${leasedAttempt.maxAttempts}
        AND scheduled_at = ${leasedAttempt.scheduledAt}
        AND worker_lease_id IS NOT DISTINCT FROM ${leasedAttempt.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          leasedAttempt.workerLeaseExpiresAt
        }
        AND checked_at IS NOT DISTINCT FROM ${leasedAttempt.checkedAt}
        AND completed_at IS NOT DISTINCT FROM ${leasedAttempt.completedAt}
        AND dead_lettered_at IS NOT DISTINCT FROM ${
          leasedAttempt.deadLetteredAt
        }
        AND failure_code IS NOT DISTINCT FROM ${leasedAttempt.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${leasedAttempt.failureMessage}
        AND result_status IS NOT DISTINCT FROM ${leasedAttempt.resultStatus}
        AND result_last_error IS NOT DISTINCT FROM ${
          leasedAttempt.resultLastError
        }
        AND result_metadata = ${JSON.stringify(
          leasedAttempt.resultMetadata
        )}::jsonb
        AND result_fingerprint IS NOT DISTINCT FROM ${
          leasedAttempt.resultFingerprint
        }
        AND provider_health_state_id IS NOT DISTINCT FROM ${
          leasedAttempt.providerHealthStateId
        }
        AND provider_health_state_fingerprint IS NOT DISTINCT FROM ${
          leasedAttempt.providerHealthStateFingerprint
        }
        AND created_at = ${leasedAttempt.createdAt}
        AND updated_at = ${leasedAttempt.updatedAt}
    `;
    if (updatedCount !== 1) {
      throw new Error('Provider health probe attempt lease changed');
    }

    const updated = await this.getProviderHealthProbeAttempt(leasedAttempt.id);
    if (!updated) {
      throw new Error('Provider health probe attempt not found');
    }
    return updated;
  }

  @Transactional()
  async failProviderHealthProbeAttempt(input: {
    attempt: CopilotProviderHealthProbeAttemptRecord;
    error: unknown;
  }): Promise<CopilotProviderHealthProbeAttemptRecord> {
    const attempt = input.attempt;
    if (attempt.status !== 'processing' || !attempt.workerLeaseId) {
      throw new Error('Provider health probe attempt is not leased');
    }
    const now = new Date();
    const current = await this.lockProviderHealthProbeAttempt(attempt.id);
    if (!current) {
      throw new Error('Provider health probe attempt not found');
    }
    if (
      !this.isCurrentProviderHealthProbeAttemptLease({
        attempt,
        current,
        now,
      })
    ) {
      return current;
    }
    const leasedAttempt = current;
    const failure = normalizeProbeAttemptFailure(input.error);
    const attemptsExhausted =
      leasedAttempt.attemptCount >= leasedAttempt.maxAttempts;
    const status =
      !failure.retryable || attemptsExhausted
        ? 'dead_lettered'
        : 'retry_scheduled';
    const updatedCount = await this.db.$executeRaw`
      UPDATE ai_provider_health_probe_attempts
      SET
        status = ${status},
        scheduled_at = ${
          status === 'retry_scheduled'
            ? this.probeAttemptRetryDelay(leasedAttempt.attemptCount)
            : leasedAttempt.scheduledAt
        },
        worker_lease_id = NULL,
        worker_lease_expires_at = NULL,
        dead_lettered_at = ${status === 'dead_lettered' ? now : null},
        failure_code = ${failure.errorCode},
        failure_message = ${failure.errorMessage},
        updated_at = ${now}
      WHERE id = ${leasedAttempt.id}
        AND provider_id = ${leasedAttempt.providerId}
        AND provider_type IS NOT DISTINCT FROM ${leasedAttempt.providerType}
        AND scope_type = ${leasedAttempt.scopeType}
        AND workspace_id = ${leasedAttempt.workspaceId}
        AND actor_id = ${leasedAttempt.actorId}
        AND provider_registry_revision_id = ${
          leasedAttempt.providerRegistryRevisionId
        }
        AND provider_registry_revision_fingerprint = ${
          leasedAttempt.providerRegistryRevisionFingerprint
        }
        AND provider_profile_source IS NOT DISTINCT FROM ${
          leasedAttempt.providerProfileSource
        }
        AND provider_profile_fingerprint = ${
          leasedAttempt.providerProfileFingerprint
        }
        AND provider_profile_snapshot = ${JSON.stringify(
          leasedAttempt.providerProfileSnapshot
        )}::jsonb
        AND request_fingerprint = ${leasedAttempt.requestFingerprint}
        AND status = ${leasedAttempt.status}
        AND status = ${'processing'}
        AND attempt_count = ${leasedAttempt.attemptCount}
        AND max_attempts = ${leasedAttempt.maxAttempts}
        AND scheduled_at = ${leasedAttempt.scheduledAt}
        AND worker_lease_id IS NOT DISTINCT FROM ${leasedAttempt.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          leasedAttempt.workerLeaseExpiresAt
        }
        AND checked_at IS NOT DISTINCT FROM ${leasedAttempt.checkedAt}
        AND completed_at IS NOT DISTINCT FROM ${leasedAttempt.completedAt}
        AND dead_lettered_at IS NOT DISTINCT FROM ${
          leasedAttempt.deadLetteredAt
        }
        AND failure_code IS NOT DISTINCT FROM ${leasedAttempt.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${leasedAttempt.failureMessage}
        AND result_status IS NOT DISTINCT FROM ${leasedAttempt.resultStatus}
        AND result_last_error IS NOT DISTINCT FROM ${
          leasedAttempt.resultLastError
        }
        AND result_metadata = ${JSON.stringify(
          leasedAttempt.resultMetadata
        )}::jsonb
        AND result_fingerprint IS NOT DISTINCT FROM ${
          leasedAttempt.resultFingerprint
        }
        AND provider_health_state_id IS NOT DISTINCT FROM ${
          leasedAttempt.providerHealthStateId
        }
        AND provider_health_state_fingerprint IS NOT DISTINCT FROM ${
          leasedAttempt.providerHealthStateFingerprint
        }
        AND created_at = ${leasedAttempt.createdAt}
        AND updated_at = ${leasedAttempt.updatedAt}
    `;
    if (updatedCount !== 1) {
      throw new Error('Provider health probe attempt lease changed');
    }

    const updated = await this.getProviderHealthProbeAttempt(leasedAttempt.id);
    if (!updated) {
      throw new Error('Provider health probe attempt not found');
    }
    return updated;
  }

  @Transactional()
  async upsertWorkspaceState(input: {
    workspaceId: string;
    actorId: string;
    providerId: string;
    providerType?: CopilotProviderType | null;
    status: CopilotProviderHealthStatus | string;
    checkedAt?: Date | string | null;
    lastError?: string | null;
    source?: CopilotProviderHealthState['source'] | null;
    providerProfileSource?: CopilotProviderProfileSource | 'db_revision' | null;
    metadata?: Record<string, unknown>;
  }): Promise<CopilotProviderHealthState> {
    if (!input.workspaceId) {
      throw new Error('Provider health state requires workspaceId');
    }
    if (!input.actorId) {
      throw new Error('Provider health state requires actorId');
    }
    if (!input.providerId) {
      throw new Error('Provider health state requires providerId');
    }

    const status = normalizeStatus(input.status);
    const source = normalizeSource(input.source);
    const checkedAt = normalizeCheckedAt(
      input.checkedAt,
      'Invalid provider health checkedAt'
    );
    const lastError = optionalString(
      input.lastError,
      PROVIDER_HEALTH_LAST_ERROR_MAX_LENGTH
    );
    const id = `provider-health-state-${providerHealthStateFingerprint({
      version: 'provider-health-state-row-id/v1',
      workspaceId: input.workspaceId,
      providerId: input.providerId,
    })}`;
    const fingerprint = providerHealthStateFingerprint({
      version: 'provider-health-state/v1',
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      providerType: input.providerType ?? null,
      status,
      checkedAt: checkedAt.toISOString(),
      lastError: lastError ?? null,
      source,
    });
    const metadata = {
      ...input.metadata,
      version: PROVIDER_HEALTH_METADATA_VERSION,
      providerProfileSource: input.providerProfileSource ?? null,
      publishSource:
        source === 'probe_result'
          ? 'workspace_provider_health_probe_result'
          : 'graphql_mutation',
    };
    const normalizedMetadata = normalizeMetadata(metadata, source);

    const stateRows = await this.db.$queryRaw<CopilotProviderHealthStateRow[]>`
      INSERT INTO ai_provider_health_states (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        status,
        checked_at,
        last_error,
        source,
        fingerprint,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${input.providerId},
        ${input.providerType ?? null},
        ${'workspace'},
        ${input.workspaceId},
        ${input.actorId},
        ${status},
        ${checkedAt},
        ${lastError ?? null},
        ${source},
        ${fingerprint},
        ${normalizedMetadata.serialized}::jsonb,
        ${checkedAt},
        ${checkedAt}
      )
      ON CONFLICT (id) DO UPDATE
      SET
        provider_type = EXCLUDED.provider_type,
        actor_id = EXCLUDED.actor_id,
        status = EXCLUDED.status,
        checked_at = EXCLUDED.checked_at,
        last_error = EXCLUDED.last_error,
        source = EXCLUDED.source,
        fingerprint = EXCLUDED.fingerprint,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
      RETURNING
        id,
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        checked_at AS "checkedAt",
        last_error AS "lastError",
        source,
        fingerprint,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const state = toState(stateRows[0]);
    await this.insertHealthEvent({
      stateId: state.id,
      providerId: state.providerId,
      providerType: state.providerType,
      scopeType: state.scopeType,
      workspaceId: state.workspaceId,
      actorId: state.actorId,
      status: state.status,
      checkedAt: state.checkedAt,
      lastError: state.lastError ?? null,
      source: state.source,
      eventType: eventTypeForWrite({
        scopeType: state.scopeType,
        source: state.source,
        metadata: state.metadata,
      }),
      stateFingerprint: state.fingerprint,
      metadata: state.metadata,
    });
    return await this.withEventHistory(state);
  }

  @Transactional()
  async upsertGlobalProbeState(input: {
    providerId: string;
    providerType?: CopilotProviderType | null;
    status: CopilotProviderHealthStatus | string;
    checkedAt?: Date | string | null;
    lastError?: string | null;
    providerProfileSource?: CopilotProviderProfileSource | 'db_revision' | null;
    metadata?: Record<string, unknown>;
  }): Promise<CopilotProviderHealthState> {
    if (!input.providerId) {
      throw new Error('Provider health state requires providerId');
    }

    const status = normalizeStatus(input.status);
    const checkedAt = normalizeCheckedAt(
      input.checkedAt,
      'Invalid provider health checkedAt'
    );
    const lastError = optionalString(
      input.lastError,
      PROVIDER_HEALTH_LAST_ERROR_MAX_LENGTH
    );
    const id = `provider-health-state-${providerHealthStateFingerprint({
      version: 'provider-health-state-row-id/v1',
      scopeType: 'global',
      providerId: input.providerId,
    })}`;
    const fingerprint = providerHealthStateFingerprint({
      version: 'provider-health-state/v1',
      scopeType: 'global',
      providerId: input.providerId,
      providerType: input.providerType ?? null,
      status,
      checkedAt: checkedAt.toISOString(),
      lastError: lastError ?? null,
      source: 'probe_result',
    });
    const metadata = {
      ...input.metadata,
      version: PROVIDER_HEALTH_METADATA_VERSION,
      providerProfileSource: input.providerProfileSource ?? null,
      publishSource: 'configured_provider_health_snapshot_worker',
    };
    const normalizedMetadata = normalizeMetadata(metadata, 'probe_result');

    const stateRows = await this.db.$queryRaw<CopilotProviderHealthStateRow[]>`
      INSERT INTO ai_provider_health_states (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        status,
        checked_at,
        last_error,
        source,
        fingerprint,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${input.providerId},
        ${input.providerType ?? null},
        ${'global'},
        ${null},
        ${null},
        ${status},
        ${checkedAt},
        ${lastError ?? null},
        ${'probe_result'},
        ${fingerprint},
        ${normalizedMetadata.serialized}::jsonb,
        ${checkedAt},
        ${checkedAt}
      )
      ON CONFLICT (id) DO UPDATE
      SET
        provider_type = EXCLUDED.provider_type,
        actor_id = EXCLUDED.actor_id,
        status = EXCLUDED.status,
        checked_at = EXCLUDED.checked_at,
        last_error = EXCLUDED.last_error,
        source = EXCLUDED.source,
        fingerprint = EXCLUDED.fingerprint,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
      RETURNING
        id,
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        checked_at AS "checkedAt",
        last_error AS "lastError",
        source,
        fingerprint,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const state = toState(stateRows[0]);
    await this.insertHealthEvent({
      stateId: state.id,
      providerId: state.providerId,
      providerType: state.providerType,
      scopeType: state.scopeType,
      workspaceId: state.workspaceId,
      actorId: state.actorId,
      status: state.status,
      checkedAt: state.checkedAt,
      lastError: state.lastError ?? null,
      source: state.source,
      eventType: eventTypeForWrite({
        scopeType: state.scopeType,
        source: state.source,
        metadata: state.metadata,
      }),
      stateFingerprint: state.fingerprint,
      metadata: state.metadata,
    });
    return await this.withEventHistory(state);
  }

  async listLatestActiveByProviderIds(input: {
    providerIds: string[];
    workspaceId?: string | null;
    checkedAt?: Date | string | null;
    probeResultMaxAgeMs?: number;
  }): Promise<Map<string, ProviderHealthStateOverlay>> {
    const providerIds = [...new Set(input.providerIds)].filter(Boolean);
    if (!providerIds.length) {
      return new Map();
    }
    const checkedAt = normalizeCheckedAt(
      input.checkedAt,
      'Invalid provider health checkedAt'
    );
    const maxAgeMs = normalizeProbeResultMaxAgeMs(input.probeResultMaxAgeMs);
    const minimumProbeResultCheckedAt = new Date(
      checkedAt.getTime() - maxAgeMs
    );

    const rows = input.workspaceId
      ? await this.db.$queryRaw<CopilotProviderHealthStateRow[]>`
          SELECT DISTINCT ON (provider_id)
            id,
            provider_id AS "providerId",
            provider_type AS "providerType",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            status,
            checked_at AS "checkedAt",
            last_error AS "lastError",
            source,
            fingerprint,
            metadata,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_provider_health_states
          WHERE provider_id = ANY(${providerIds})
            AND (
              (scope_type = 'workspace' AND workspace_id = ${input.workspaceId})
              OR (scope_type = 'global' AND workspace_id IS NULL)
            )
            AND (
              source <> ${'probe_result'}
              OR checked_at >= ${minimumProbeResultCheckedAt}
            )
          ORDER BY
            provider_id ASC,
            CASE WHEN scope_type = 'workspace' THEN 0 ELSE 1 END ASC,
            checked_at DESC,
            id DESC
        `
      : await this.db.$queryRaw<CopilotProviderHealthStateRow[]>`
          SELECT DISTINCT ON (provider_id)
            id,
            provider_id AS "providerId",
            provider_type AS "providerType",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            status,
            checked_at AS "checkedAt",
            last_error AS "lastError",
            source,
            fingerprint,
            metadata,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_provider_health_states
          WHERE provider_id = ANY(${providerIds})
            AND scope_type = 'global'
            AND workspace_id IS NULL
            AND (
              source <> ${'probe_result'}
              OR checked_at >= ${minimumProbeResultCheckedAt}
            )
          ORDER BY provider_id ASC, checked_at DESC, id DESC
        `;

    return new Map(rows.map(row => [row.providerId, toOverlay(row)]));
  }

  @Transactional()
  async clearStaleProbeResultStates(input: {
    checkedAt?: Date | string | null;
    maxAgeMs?: number;
    limit?: number;
  }): Promise<CopilotProviderHealthState[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const checkedAt = normalizeCheckedAt(
      input.checkedAt,
      'Invalid provider health checkedAt'
    );
    const maxAgeMs = normalizeProbeResultMaxAgeMs(input.maxAgeMs);
    const minimumProbeResultCheckedAt = new Date(
      checkedAt.getTime() - maxAgeMs
    );

    const staleRows = await this.db.$queryRaw<CopilotProviderHealthStateRow[]>`
      SELECT
        id,
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        checked_at AS "checkedAt",
        last_error AS "lastError",
        source,
        fingerprint,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_provider_health_states
      WHERE source = ${'probe_result'}
        AND status <> ${'unknown'}
        AND checked_at < ${minimumProbeResultCheckedAt}
      ORDER BY checked_at ASC, updated_at ASC, provider_id ASC
      LIMIT ${limit}
    `;

    const cleared: CopilotProviderHealthState[] = [];
    for (const row of staleRows) {
      const previousMetadata = row.metadata ?? {};
      const fingerprint =
        row.scopeType === 'workspace'
          ? providerHealthStateFingerprint({
              version: 'provider-health-state/v1',
              workspaceId: row.workspaceId ?? null,
              providerId: row.providerId,
              providerType: row.providerType ?? null,
              status: 'unknown',
              checkedAt: checkedAt.toISOString(),
              lastError: null,
              source: 'probe_result',
            })
          : providerHealthStateFingerprint({
              version: 'provider-health-state/v1',
              scopeType: 'global',
              providerId: row.providerId,
              providerType: row.providerType ?? null,
              status: 'unknown',
              checkedAt: checkedAt.toISOString(),
              lastError: null,
              source: 'probe_result',
            });
      const metadata = {
        version: PROVIDER_HEALTH_METADATA_VERSION,
        providerProfileSource:
          previousMetadata['providerProfileSource'] ?? null,
        publishSource: 'provider_health_probe_result_stale_cleanup_worker',
        providerProfileId:
          previousMetadata['providerProfileId'] ?? row.providerId,
        providerHealthProbeResultCleanupReason:
          PROVIDER_HEALTH_PROBE_RESULT_STALE_CLEANUP_REASON,
        previousCheckedAt: row.checkedAt.toISOString(),
        previousFingerprint: row.fingerprint,
        previousLastError: row.lastError ?? null,
        previousPublishSource: previousMetadata['publishSource'] ?? null,
        previousSource: row.source,
        previousStatus: row.status,
        probeResultMaxAgeMs: maxAgeMs,
      };
      const normalizedMetadata = normalizeMetadata(metadata, 'probe_result');

      const updatedRows = await this.db.$queryRaw<
        CopilotProviderHealthStateRow[]
      >`
        UPDATE ai_provider_health_states
        SET
          status = ${'unknown'},
          checked_at = ${checkedAt},
          last_error = ${null},
          fingerprint = ${fingerprint},
          metadata = ${normalizedMetadata.serialized}::jsonb,
          updated_at = ${checkedAt}
        WHERE id = ${row.id}
          AND source = ${'probe_result'}
          AND status <> ${'unknown'}
          AND checked_at < ${minimumProbeResultCheckedAt}
        RETURNING
          id,
          provider_id AS "providerId",
          provider_type AS "providerType",
          scope_type AS "scopeType",
          workspace_id AS "workspaceId",
          actor_id AS "actorId",
          status,
          checked_at AS "checkedAt",
          last_error AS "lastError",
          source,
          fingerprint,
          metadata,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `;
      if (updatedRows[0]) {
        const state = toState(updatedRows[0]);
        await this.insertHealthEvent({
          stateId: state.id,
          providerId: state.providerId,
          providerType: state.providerType,
          scopeType: state.scopeType,
          workspaceId: state.workspaceId,
          actorId: state.actorId,
          status: state.status,
          checkedAt: state.checkedAt,
          lastError: state.lastError ?? null,
          source: state.source,
          eventType: 'stale_probe_result_cleared',
          stateFingerprint: state.fingerprint,
          metadata: state.metadata,
        });
        cleared.push(state);
      }
    }

    return cleared;
  }

  @Transactional()
  async clearStaleConfiguredSnapshotGlobalStates(input: {
    activeProviderIds: string[];
    checkedAt?: Date | string | null;
    limit?: number;
  }): Promise<CopilotProviderHealthState[]> {
    const activeProviderIds = [...new Set(input.activeProviderIds)].filter(
      Boolean
    );
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const checkedAt = input.checkedAt ? new Date(input.checkedAt) : new Date();
    if (Number.isNaN(checkedAt.getTime())) {
      throw new Error('Invalid provider health checkedAt');
    }

    const staleRows = activeProviderIds.length
      ? await this.db.$queryRaw<CopilotProviderHealthStateRow[]>`
          SELECT
            id,
            provider_id AS "providerId",
            provider_type AS "providerType",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            status,
            checked_at AS "checkedAt",
            last_error AS "lastError",
            source,
            fingerprint,
            metadata,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_provider_health_states
          WHERE scope_type = ${'global'}
            AND workspace_id IS NULL
            AND source = ${'probe_result'}
            AND metadata->>'publishSource' = ${'configured_provider_health_snapshot_worker'}
            AND NOT (provider_id = ANY(${activeProviderIds}))
          ORDER BY updated_at ASC, provider_id ASC
          LIMIT ${limit}
        `
      : await this.db.$queryRaw<CopilotProviderHealthStateRow[]>`
          SELECT
            id,
            provider_id AS "providerId",
            provider_type AS "providerType",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            status,
            checked_at AS "checkedAt",
            last_error AS "lastError",
            source,
            fingerprint,
            metadata,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_provider_health_states
          WHERE scope_type = ${'global'}
            AND workspace_id IS NULL
            AND source = ${'probe_result'}
            AND metadata->>'publishSource' = ${'configured_provider_health_snapshot_worker'}
          ORDER BY updated_at ASC, provider_id ASC
          LIMIT ${limit}
        `;

    const cleared: CopilotProviderHealthState[] = [];
    for (const row of staleRows) {
      const previousMetadata = row.metadata ?? {};
      const fingerprint = providerHealthStateFingerprint({
        version: 'provider-health-state/v1',
        scopeType: 'global',
        providerId: row.providerId,
        providerType: row.providerType ?? null,
        status: 'unknown',
        checkedAt: checkedAt.toISOString(),
        lastError: null,
        source: 'probe_result',
      });
      const metadata = {
        version: PROVIDER_HEALTH_METADATA_VERSION,
        providerProfileSource:
          previousMetadata['providerProfileSource'] ?? null,
        publishSource: 'configured_provider_health_snapshot_cleanup_worker',
        providerProfileId:
          previousMetadata['providerProfileId'] ?? row.providerId,
        providerProfileSnapshotCleanupReason:
          CONFIGURED_PROVIDER_HEALTH_SNAPSHOT_CLEANUP_REASON,
        previousCheckedAt: row.checkedAt.toISOString(),
        previousFingerprint: row.fingerprint,
        previousLastError: row.lastError ?? null,
        previousPublishSource: previousMetadata['publishSource'] ?? null,
        previousStatus: row.status,
      };
      const normalizedMetadata = normalizeMetadata(metadata, 'probe_result');

      const updatedRows = await this.db.$queryRaw<
        CopilotProviderHealthStateRow[]
      >`
        UPDATE ai_provider_health_states
        SET
          status = ${'unknown'},
          checked_at = ${checkedAt},
          last_error = ${null},
          fingerprint = ${fingerprint},
          metadata = ${normalizedMetadata.serialized}::jsonb,
          updated_at = ${checkedAt}
        WHERE id = ${row.id}
          AND scope_type = ${'global'}
          AND workspace_id IS NULL
          AND metadata->>'publishSource' = ${'configured_provider_health_snapshot_worker'}
        RETURNING
          id,
          provider_id AS "providerId",
          provider_type AS "providerType",
          scope_type AS "scopeType",
          workspace_id AS "workspaceId",
          actor_id AS "actorId",
          status,
          checked_at AS "checkedAt",
          last_error AS "lastError",
          source,
          fingerprint,
          metadata,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `;
      if (updatedRows[0]) {
        const state = toState(updatedRows[0]);
        await this.insertHealthEvent({
          stateId: state.id,
          providerId: state.providerId,
          providerType: state.providerType,
          scopeType: state.scopeType,
          workspaceId: state.workspaceId,
          actorId: state.actorId,
          status: state.status,
          checkedAt: state.checkedAt,
          lastError: state.lastError ?? null,
          source: state.source,
          eventType: 'configured_snapshot_cleared',
          stateFingerprint: state.fingerprint,
          metadata: state.metadata,
        });
        cleared.push(state);
      }
    }

    return cleared;
  }

  async getWorkspaceState(input: {
    workspaceId: string;
    providerId: string;
  }): Promise<CopilotProviderHealthState | null> {
    const rows = await this.db.$queryRaw<CopilotProviderHealthStateRow[]>`
      SELECT
        id,
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        checked_at AS "checkedAt",
        last_error AS "lastError",
        source,
        fingerprint,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_provider_health_states
      WHERE provider_id = ${input.providerId}
        AND scope_type = 'workspace'
        AND workspace_id = ${input.workspaceId}
      LIMIT 1
    `;

    return rows[0] ? toState(rows[0]) : null;
  }

  async getGlobalState(input: {
    providerId: string;
  }): Promise<CopilotProviderHealthState | null> {
    const rows = await this.db.$queryRaw<CopilotProviderHealthStateRow[]>`
      SELECT
        id,
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        checked_at AS "checkedAt",
        last_error AS "lastError",
        source,
        fingerprint,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_provider_health_states
      WHERE provider_id = ${input.providerId}
        AND scope_type = 'global'
        AND workspace_id IS NULL
      LIMIT 1
    `;

    return rows[0] ? toState(rows[0]) : null;
  }

  private async withEventHistory(
    state: CopilotProviderHealthState,
    options: { limit?: number } = {}
  ): Promise<CopilotProviderHealthState> {
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const rows = await this.db.$queryRaw<
      Array<CopilotProviderHealthEventRow & { eventCount: number }>
    >`
      SELECT
        id,
        state_id AS "stateId",
        provider_id AS "providerId",
        provider_type AS "providerType",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        checked_at AS "checkedAt",
        last_error AS "lastError",
        source,
        event_type AS "eventType",
        fingerprint,
        state_fingerprint AS "stateFingerprint",
        metadata,
        created_at AS "createdAt",
        COUNT(*) OVER()::int AS "eventCount"
      FROM ai_provider_health_events
      WHERE state_id = ${state.id}
      ORDER BY checked_at DESC, created_at DESC, id DESC
      LIMIT ${limit}
    `;

    return {
      ...state,
      eventCount: rows[0]?.eventCount ?? 0,
      events: rows.map(toEvent),
    };
  }
}
