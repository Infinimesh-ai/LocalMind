import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import type { CopilotProviderType } from '../plugins/copilot/providers/types';
import type { TaskRoutePolicyFeatureKind } from '../plugins/copilot/runtime/task-policy';
import { BaseModel } from './base';

export type CopilotRepairExecutionStatus =
  | 'queued'
  | 'waiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CopilotRepairExecutionApprovalState =
  | 'not_required'
  | 'waiting'
  | 'approved'
  | 'rejected';

export type CopilotRepairExecutionAuditEventType =
  | 'requested'
  | 'queued'
  | 'waiting_approval'
  | 'approval_approved'
  | 'approval_rejected'
  | 'running'
  | 'cancel_requested'
  | 'side_effect_applied'
  | 'retry_scheduled'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'manual_retry_requested'
  | 'manual_resume_requested'
  | 'stale_recovered'
  | 'reused';

export type CopilotRepairExecutionRuntimeResult = {
  version: string;
  executor: string;
  sideEffectsApplied: boolean;
  message: string;
  sideEffectFingerprint?: string;
  sideEffectKind?: string;
  sideEffectRecordId?: string;
  sideEffectSummary?: Record<string, unknown>;
};

export type CopilotRepairExecutionExecutorPayload =
  | {
      version: 'model-registry-revision-executor-payload/v1';
      kind: 'model_registry_revision_publish';
      providerId: string;
      modelId: string;
      rawModelId: string;
      displayName?: string;
      aliases: string[];
      modelDefinition: Record<string, unknown>;
      operationFingerprint: string;
      operationSetFingerprint: string;
      previewFingerprint: string;
      catalogFingerprint: string;
      targetLocatorFingerprint: string;
      candidateEvidenceFingerprints: string[];
      fallbackSourceChain: Array<Record<string, unknown>>;
    }
  | {
      version: 'provider-registry-revision-executor-payload/v1';
      kind: 'provider_registry_revision_publish';
      providerId: string;
      providerType: CopilotProviderType;
      displayName?: string;
      enabled?: boolean;
      models?: string[];
      modelDefinitions?: unknown;
      privacy?: string;
      priority?: number;
      operationFingerprint: string;
      operationSetFingerprint: string;
      previewFingerprint: string;
      catalogFingerprint: string;
      targetLocatorFingerprint: string;
      candidateEvidenceFingerprints: string[];
      fallbackSourceChain: Array<Record<string, unknown>>;
    }
  | {
      version: 'prompt-registry-revision-executor-payload/v1';
      kind: 'prompt_registry_revision_publish';
      expectedRegistryFingerprint: string;
      expectedRegistryId: number;
      expectedRegistryUpdatedAt: string;
      operationFingerprints: string[];
      operationKinds: string[];
      operationSetFingerprint: string;
      previewFingerprint: string;
      catalogFingerprint: string;
      fallbackSourceChain: Array<Record<string, unknown>>;
    }
  | {
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
      fallbackSourceChain: Array<Record<string, unknown>>;
    }
  | Record<string, unknown>;

export type CopilotRepairExecutionApprovedSideEffectResult = {
  fingerprint: string;
  kind: string;
  recordId: string;
  summary: Record<string, unknown>;
};

export type CopilotRepairExecutionSideEffectRecord = {
  id: string;
  executionRequestId: string;
  workspaceId: string;
  actorId: string;
  sideEffectKind: string;
  sideEffectRecordId: string;
  sideEffectFingerprint: string;
  sideEffectSummary: Record<string, unknown>;
  executorPayloadFingerprint: string;
  workerAttempt: number;
  workerLeaseId: string;
  appliedAt: Date;
  createdAt: Date;
};

export type CopilotRepairExecutionAuditEventRecord = {
  id: string;
  executionRequestId: string;
  workspaceId: string;
  actorId: string;
  eventType: CopilotRepairExecutionAuditEventType;
  eventFingerprint: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type CopilotRepairExecutionRecord = {
  id: string;
  workspaceId: string;
  actorId: string;
  promptName: string;
  requestedAction: string;
  status: CopilotRepairExecutionStatus;
  approvalState: CopilotRepairExecutionApprovalState;
  permissionStatus: string;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  requestFingerprint: string;
  candidateEvidenceSetFingerprint: string;
  taskRouteEvidenceSetFingerprint: string;
  targetLocatorFingerprint: string;
  repairJobFingerprint: string;
  approvalRecordFingerprint: string;
  auditEventFingerprint: string;
  runtimeResult: CopilotRepairExecutionRuntimeResult;
  executorPayload: CopilotRepairExecutionExecutorPayload;
  failureCode: string | null;
  failureMessage: string | null;
  queuedAt: Date | null;
  workerLeaseId: string | null;
  workerLeaseExpiresAt: Date | null;
  workerAttempt: number;
  workerMaxAttempts: number;
  lastAttemptAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  auditEventCount: number;
  auditEvents: CopilotRepairExecutionAuditEventRecord[];
  sideEffectCount: number;
  sideEffects: CopilotRepairExecutionSideEffectRecord[];
};

export type CopilotRepairExecutionListFilter = {
  approvalState?: CopilotRepairExecutionApprovalState | null;
  promptName?: string | null;
  query?: string | null;
  requestedAction?: string | null;
  status?: CopilotRepairExecutionStatus | null;
};

type RepairExecutionCreateConflictEvidence = {
  actorId: string;
  approvalRecordFingerprint: string;
  approvalState: CopilotRepairExecutionApprovalState;
  auditEventFingerprint: string;
  candidateEvidenceSetFingerprint: string;
  executorPayloadFingerprint: string;
  idempotencyFingerprint: string;
  idempotencyKey: string;
  permissionStatus: string;
  promptName: string;
  repairJobFingerprint: string;
  requestedAction: string;
  requestFingerprint: string;
  runtimeResultFingerprint: string;
  status: CopilotRepairExecutionStatus;
  targetLocatorFingerprint: string;
  taskRouteEvidenceSetFingerprint: string;
  workspaceId: string;
};

function stableRepairExecutionStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableRepairExecutionStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined
          ? null
          : `${JSON.stringify(key)}:${stableRepairExecutionStringify(item)}`;
      })
      .filter(Boolean)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function repairExecutionFingerprint(value: unknown) {
  return createHash('sha256')
    .update(stableRepairExecutionStringify(value))
    .digest('hex')
    .slice(0, 16);
}

function toJsonString(value: unknown) {
  return JSON.stringify(value);
}

const REPAIR_EXECUTION_FAILURE_MESSAGE_MAX_LENGTH = 2000;
const DEFAULT_REPAIR_EXECUTION_FAILURE_MESSAGE =
  'Repair execution worker failed';
const REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH = 512;
const REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH = 128;
const REPAIR_EXECUTION_IDEMPOTENCY_KEY_MAX_LENGTH = 512;
const REPAIR_EXECUTION_FAILURE_CODE_MAX_LENGTH = 128;
const REPAIR_EXECUTION_CONTROL_REASON_MAX_LENGTH = 1024;
const REPAIR_EXECUTION_AUDIT_METADATA_MAX_LENGTH = 8192;
const REPAIR_EXECUTION_EXECUTOR_PAYLOAD_MAX_LENGTH = 16 * 1024;
const REPAIR_EXECUTION_AUDIT_EVENT_TYPES = new Set<string>([
  'requested',
  'queued',
  'waiting_approval',
  'approval_approved',
  'approval_rejected',
  'running',
  'cancel_requested',
  'side_effect_applied',
  'retry_scheduled',
  'completed',
  'failed',
  'cancelled',
  'manual_retry_requested',
  'manual_resume_requested',
  'stale_recovered',
  'reused',
]);
const REPAIR_EXECUTION_STATUSES = new Set<CopilotRepairExecutionStatus>([
  'queued',
  'waiting_approval',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
const REPAIR_EXECUTION_APPROVAL_STATES =
  new Set<CopilotRepairExecutionApprovalState>([
    'not_required',
    'waiting',
    'approved',
    'rejected',
  ]);
const REPAIR_EXECUTION_SIDE_EFFECT_ROLLBACK_CONTRACT_VERSION =
  'repair-execution-side-effect-rollback-contract/v1';
const REPAIR_EXECUTION_SIDE_EFFECT_ROLLBACK_CONTRACT_MODE =
  'forward_only_followup_revision';
const REPAIR_EXECUTION_SIDE_EFFECT_ROLLBACK_CONTRACT_RECOVERY_PATH =
  'publish_follow_up_registry_revision';
const REPAIR_EXECUTION_SIDE_EFFECT_KINDS = new Set([
  'model_registry_revision',
  'prompt_registry_revision',
  'provider_registry_revision',
  'task_route_policy_revision',
]);
const REPAIR_EXECUTION_PERMISSION_STATUSES = new Set(['granted']);
const REPAIR_EXECUTION_EXECUTOR_PAYLOAD_SIDE_EFFECT_KINDS: Record<
  string,
  string
> = {
  model_registry_revision_publish: 'model_registry_revision',
  prompt_registry_revision_publish: 'prompt_registry_revision',
  provider_registry_revision_publish: 'provider_registry_revision',
  task_route_policy_revision_publish: 'task_route_policy_revision',
};

function executorPayloadFingerprint(
  payload: CopilotRepairExecutionExecutorPayload
) {
  return repairExecutionFingerprint({
    version: 'repair-execution-executor-payload-fingerprint/v1',
    payload,
  });
}

function isDeterministicExecutorPayloadFailure(code: string | null) {
  return (
    code === 'unsupported_executor_payload' ||
    code === 'invalid_executor_payload'
  );
}

function sideEffectKindForExecutorPayload(
  payload: CopilotRepairExecutionExecutorPayload
) {
  if (!isRecord(payload) || typeof payload.kind !== 'string') {
    return null;
  }
  return (
    REPAIR_EXECUTION_EXECUTOR_PAYLOAD_SIDE_EFFECT_KINDS[payload.kind] ?? null
  );
}

function normalizeWorkerFailureMessage(message: string) {
  const normalized = message.trim();
  if (!normalized) {
    return DEFAULT_REPAIR_EXECUTION_FAILURE_MESSAGE;
  }
  return normalized.slice(0, REPAIR_EXECUTION_FAILURE_MESSAGE_MAX_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRepairExecutionString(
  value: unknown,
  field: string,
  maxLength = REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH
) {
  if (typeof value !== 'string') {
    throw new Error(`Repair execution ${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Repair execution ${field} is required`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`Repair execution ${field} is too long`);
  }
  return normalized;
}

function normalizeRepairExecutionPermissionStatus(value: unknown) {
  const normalized = requireRepairExecutionString(value, 'permission status');
  if (!REPAIR_EXECUTION_PERMISSION_STATUSES.has(normalized)) {
    throw new Error(
      `Repair execution permission status is unsupported: ${normalized}`
    );
  }
  return normalized;
}

function normalizeRepairExecutionStatus(
  value: unknown
): CopilotRepairExecutionStatus {
  if (
    typeof value !== 'string' ||
    !REPAIR_EXECUTION_STATUSES.has(value as CopilotRepairExecutionStatus)
  ) {
    throw new Error('Repair execution status is invalid');
  }
  return value as CopilotRepairExecutionStatus;
}

function normalizeOptionalRepairExecutionStatusFilter(
  value: unknown
): CopilotRepairExecutionStatus | null {
  if (value == null) {
    return null;
  }
  return normalizeRepairExecutionStatus(value);
}

function normalizeRepairExecutionApprovalState(
  value: unknown
): CopilotRepairExecutionApprovalState {
  if (
    typeof value !== 'string' ||
    !REPAIR_EXECUTION_APPROVAL_STATES.has(
      value as CopilotRepairExecutionApprovalState
    )
  ) {
    throw new Error('Repair execution approval state is invalid');
  }
  return value as CopilotRepairExecutionApprovalState;
}

function normalizeOptionalRepairExecutionApprovalStateFilter(
  value: unknown
): CopilotRepairExecutionApprovalState | null {
  if (value == null) {
    return null;
  }
  return normalizeRepairExecutionApprovalState(value);
}

function normalizeRepairExecutionListFilterString(
  value: unknown,
  field: string
) {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Repair execution ${field} filter must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Repair execution ${field} filter is required`);
  }
  if (normalized.length > REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH) {
    throw new Error(`Repair execution ${field} filter is too long`);
  }
  return normalized;
}

function normalizeRepairExecutionListFilter(
  input?: CopilotRepairExecutionListFilter | null
): Required<CopilotRepairExecutionListFilter> {
  return {
    approvalState: normalizeOptionalRepairExecutionApprovalStateFilter(
      input?.approvalState
    ),
    promptName: normalizeRepairExecutionListFilterString(
      input?.promptName,
      'prompt name'
    ),
    query: normalizeRepairExecutionListFilterString(input?.query, 'query'),
    requestedAction: normalizeRepairExecutionListFilterString(
      input?.requestedAction,
      'requested action'
    ),
    status: normalizeOptionalRepairExecutionStatusFilter(input?.status),
  };
}

function normalizeRepairExecutionControlReason(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('Repair execution control reason must be a string');
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > REPAIR_EXECUTION_CONTROL_REASON_MAX_LENGTH) {
    throw new Error('Repair execution control reason is too long');
  }
  return normalized;
}

function normalizeRepairExecutionAuditMetadata(
  metadata: Record<string, unknown>
) {
  if (!isRecord(metadata)) {
    throw new Error('Repair execution audit metadata must be an object');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(metadata);
  } catch {
    throw new Error(
      'Repair execution audit metadata must be JSON serializable'
    );
  }
  if (serialized.length > REPAIR_EXECUTION_AUDIT_METADATA_MAX_LENGTH) {
    throw new Error('Repair execution audit metadata is too large');
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function normalizeRepairExecutionAuditEventType(
  value: unknown
): CopilotRepairExecutionAuditEventType {
  if (
    typeof value === 'string' &&
    REPAIR_EXECUTION_AUDIT_EVENT_TYPES.has(value)
  ) {
    return value as CopilotRepairExecutionAuditEventType;
  }
  return 'reused';
}

function assertRepairExecutionSideEffectRollbackContract(
  summary: Record<string, unknown>
) {
  if (!isRecord(summary.rollbackContract)) {
    throw new Error(
      'Repair execution side effect rollback contract must be an object'
    );
  }

  const version = requireRepairExecutionString(
    summary.rollbackContract.version,
    'side effect rollback contract version',
    REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH
  );
  if (version !== REPAIR_EXECUTION_SIDE_EFFECT_ROLLBACK_CONTRACT_VERSION) {
    throw new Error(
      `Repair execution side effect rollback contract version is unsupported: ${version}`
    );
  }
  if (summary.rollbackContract.supported !== false) {
    throw new Error(
      'Repair execution side effect rollback contract must be forward-only'
    );
  }
  const mode = requireRepairExecutionString(
    summary.rollbackContract.mode,
    'side effect rollback contract mode',
    REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH
  );
  if (mode !== REPAIR_EXECUTION_SIDE_EFFECT_ROLLBACK_CONTRACT_MODE) {
    throw new Error(
      `Repair execution side effect rollback contract mode is unsupported: ${mode}`
    );
  }
  const recoveryPath = requireRepairExecutionString(
    summary.rollbackContract.recoveryPath,
    'side effect rollback contract recovery path',
    REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH
  );
  if (
    recoveryPath !==
    REPAIR_EXECUTION_SIDE_EFFECT_ROLLBACK_CONTRACT_RECOVERY_PATH
  ) {
    throw new Error(
      `Repair execution side effect rollback contract recovery path is unsupported: ${recoveryPath}`
    );
  }
  requireRepairExecutionString(
    summary.rollbackContract.reason,
    'side effect rollback contract reason',
    REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH
  );
}

function normalizeRepairExecutionExecutorPayload(
  payload: unknown
): CopilotRepairExecutionExecutorPayload {
  if (payload === undefined || payload === null) {
    return {};
  }
  if (!isRecord(payload)) {
    throw new Error('Repair execution executor payload must be an object');
  }
  const version = payload.version;
  if (version !== undefined) {
    requireRepairExecutionString(
      version,
      'executor payload version',
      REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH
    );
  }
  const kind = payload.kind;
  if (kind !== undefined) {
    requireRepairExecutionString(
      kind,
      'executor payload kind',
      REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH
    );
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new Error(
      'Repair execution executor payload must be JSON serializable'
    );
  }
  if (serialized.length > REPAIR_EXECUTION_EXECUTOR_PAYLOAD_MAX_LENGTH) {
    throw new Error('Repair execution executor payload is too large');
  }
  return JSON.parse(serialized) as CopilotRepairExecutionExecutorPayload;
}

function normalizeHydratedRepairExecutionExecutorPayload(
  payload: unknown
): CopilotRepairExecutionExecutorPayload {
  try {
    return normalizeRepairExecutionExecutorPayload(payload);
  } catch {
    return {};
  }
}

function normalizeHydratedRepairExecutionRuntimeResult(
  value: unknown
): CopilotRepairExecutionRuntimeResult {
  const fallback: CopilotRepairExecutionRuntimeResult = {
    version: 'repair-execution-runtime-result/v1',
    executor: 'persisted_repair_execution_hydration_guard',
    sideEffectsApplied: false,
    message: 'Persisted repair execution runtime result was invalid.',
  };
  if (!isRecord(value)) {
    return fallback;
  }

  const version =
    typeof value.version === 'string' && value.version.trim()
      ? value.version
          .trim()
          .slice(0, REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH)
      : fallback.version;
  const executor =
    typeof value.executor === 'string' && value.executor.trim()
      ? value.executor
          .trim()
          .slice(0, REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH)
      : fallback.executor;
  const sideEffectsApplied =
    typeof value.sideEffectsApplied === 'boolean'
      ? value.sideEffectsApplied
      : false;
  const message =
    typeof value.message === 'string' && value.message.trim()
      ? value.message
          .trim()
          .slice(0, REPAIR_EXECUTION_FAILURE_MESSAGE_MAX_LENGTH)
      : fallback.message;
  let sideEffectSummary: Record<string, unknown> | undefined;
  if (isRecord(value.sideEffectSummary)) {
    try {
      sideEffectSummary = normalizeRepairExecutionAuditMetadata(
        value.sideEffectSummary
      );
    } catch {
      sideEffectSummary = undefined;
    }
  }

  return {
    version,
    executor,
    sideEffectsApplied,
    message,
    ...(typeof value.sideEffectFingerprint === 'string' &&
    value.sideEffectFingerprint.trim()
      ? {
          sideEffectFingerprint: value.sideEffectFingerprint
            .trim()
            .slice(0, REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH),
        }
      : {}),
    ...(typeof value.sideEffectKind === 'string' && value.sideEffectKind.trim()
      ? {
          sideEffectKind: value.sideEffectKind
            .trim()
            .slice(0, REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH),
        }
      : {}),
    ...(typeof value.sideEffectRecordId === 'string' &&
    value.sideEffectRecordId.trim()
      ? {
          sideEffectRecordId: value.sideEffectRecordId
            .trim()
            .slice(0, REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH),
        }
      : {}),
    ...(sideEffectSummary ? { sideEffectSummary } : {}),
  };
}

function normalizeApprovedSideEffect(
  value: CopilotRepairExecutionApprovedSideEffectResult | null | undefined,
  options: { executorPayload?: CopilotRepairExecutionExecutorPayload } = {}
): CopilotRepairExecutionApprovedSideEffectResult | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error('Repair execution side effect result must be an object');
  }
  const fingerprint = requireRepairExecutionString(
    value.fingerprint,
    'side effect fingerprint',
    REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH
  );
  const kind = requireRepairExecutionString(
    value.kind,
    'side effect kind',
    REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH
  );
  if (!REPAIR_EXECUTION_SIDE_EFFECT_KINDS.has(kind)) {
    throw new Error(
      `Repair execution side effect kind is unsupported: ${kind}`
    );
  }
  const expectedKind = options.executorPayload
    ? sideEffectKindForExecutorPayload(options.executorPayload)
    : null;
  if (expectedKind && expectedKind !== kind) {
    throw new Error(
      `Repair execution side effect kind does not match executor payload: expected ${expectedKind}, received ${kind}`
    );
  }
  const recordId = requireRepairExecutionString(
    value.recordId,
    'side effect record id',
    REPAIR_EXECUTION_REQUIRED_STRING_MAX_LENGTH
  );
  if (!isRecord(value.summary)) {
    throw new Error('Repair execution side effect summary must be an object');
  }
  const summary = normalizeRepairExecutionAuditMetadata(value.summary);
  assertRepairExecutionSideEffectRollbackContract(summary);

  return {
    fingerprint,
    kind,
    recordId,
    summary,
  };
}

function hydrateRepairExecutionRecord(
  record: CopilotRepairExecutionRecord
): CopilotRepairExecutionRecord {
  return {
    ...record,
    runtimeResult: normalizeHydratedRepairExecutionRuntimeResult(
      record.runtimeResult
    ),
    executorPayload: normalizeHydratedRepairExecutionExecutorPayload(
      record.executorPayload
    ),
    auditEventCount: record.auditEventCount ?? 0,
    auditEvents: (record.auditEvents ?? []).map(
      hydrateRepairExecutionAuditEvent
    ),
    sideEffectCount: record.sideEffectCount ?? 0,
    sideEffects: (record.sideEffects ?? []).map(
      hydrateRepairExecutionSideEffect
    ),
  };
}

function hydrateRepairExecutionAuditEvent(
  record: CopilotRepairExecutionAuditEventRecord
): CopilotRepairExecutionAuditEventRecord {
  return {
    ...record,
    eventType: normalizeRepairExecutionAuditEventType(record.eventType),
    metadata: normalizeRepairExecutionAuditMetadata(record.metadata ?? {}),
  };
}

function hydrateRepairExecutionSideEffect(
  record: CopilotRepairExecutionSideEffectRecord
): CopilotRepairExecutionSideEffectRecord {
  const sideEffectSummary = normalizeRepairExecutionAuditMetadata(
    record.sideEffectSummary
  );
  assertRepairExecutionSideEffectRollbackContract(sideEffectSummary);

  return {
    ...record,
    sideEffectSummary,
  };
}

function assertRepairExecutionMatchesCreateConflictEvidence(
  record: CopilotRepairExecutionRecord,
  expected: RepairExecutionCreateConflictEvidence
) {
  if (
    record.workspaceId !== expected.workspaceId ||
    record.actorId !== expected.actorId ||
    record.promptName !== expected.promptName ||
    record.requestedAction !== expected.requestedAction ||
    record.status !== expected.status ||
    record.approvalState !== expected.approvalState ||
    record.permissionStatus !== expected.permissionStatus ||
    record.idempotencyKey !== expected.idempotencyKey ||
    record.idempotencyFingerprint !== expected.idempotencyFingerprint ||
    record.requestFingerprint !== expected.requestFingerprint ||
    record.candidateEvidenceSetFingerprint !==
      expected.candidateEvidenceSetFingerprint ||
    record.taskRouteEvidenceSetFingerprint !==
      expected.taskRouteEvidenceSetFingerprint ||
    record.targetLocatorFingerprint !== expected.targetLocatorFingerprint ||
    record.repairJobFingerprint !== expected.repairJobFingerprint ||
    record.approvalRecordFingerprint !== expected.approvalRecordFingerprint ||
    record.auditEventFingerprint !== expected.auditEventFingerprint ||
    repairExecutionFingerprint({
      version: 'repair-execution-runtime-result-conflict-evidence/v1',
      runtimeResult: record.runtimeResult,
    }) !== expected.runtimeResultFingerprint ||
    executorPayloadFingerprint(record.executorPayload) !==
      expected.executorPayloadFingerprint
  ) {
    throw new Error(
      'Repair execution request conflict reused mismatched create evidence'
    );
  }
}

function initialStatus(input: { approvalRequired: boolean }) {
  return input.approvalRequired ? 'waiting_approval' : 'queued';
}

function initialApprovalState(input: {
  approvalRequired: boolean;
}): CopilotRepairExecutionApprovalState {
  return input.approvalRequired ? 'waiting' : 'not_required';
}

function runtimeResult(input: {
  approvalRequired: boolean;
}): CopilotRepairExecutionRuntimeResult {
  if (input.approvalRequired) {
    return {
      version: 'repair-execution-runtime-result/v1',
      executor: 'approval_gate',
      sideEffectsApplied: false,
      message: 'Execution request persisted and waiting for approval.',
    };
  }

  return {
    version: 'repair-execution-runtime-result/v1',
    executor: 'queued_repair_execution_worker',
    sideEffectsApplied: false,
    message: 'Execution request persisted and queued for worker execution.',
  };
}

function approvalDecisionRuntimeResult(input: {
  decision: 'approve' | 'reject';
}): CopilotRepairExecutionRuntimeResult {
  if (input.decision === 'approve') {
    return {
      version: 'repair-execution-runtime-result/v1',
      executor: 'queued_repair_execution_worker',
      sideEffectsApplied: false,
      message: 'Approval accepted; repair execution queued for worker runtime.',
    };
  }

  return {
    version: 'repair-execution-runtime-result/v1',
    executor: 'approval_decision_gate',
    sideEffectsApplied: false,
    message: 'Approval rejected; repair execution request cancelled.',
  };
}

function workerRunningRuntimeResult(): CopilotRepairExecutionRuntimeResult {
  return {
    version: 'repair-execution-runtime-result/v1',
    executor: 'repair_execution_worker',
    sideEffectsApplied: false,
    message: 'Repair execution worker lease acquired and running.',
  };
}

function workerCompletionRuntimeResult(input: {
  sideEffect?: CopilotRepairExecutionApprovedSideEffectResult | null;
}): CopilotRepairExecutionRuntimeResult {
  if (input.sideEffect) {
    const sideEffectMessages: Record<string, string> = {
      model_registry_revision:
        'Repair execution worker published a DB-backed workspace model registry revision.',
      prompt_registry_revision:
        'Repair execution worker published a DB-backed workspace prompt registry revision.',
      provider_registry_revision:
        'Repair execution worker published a DB-backed workspace provider registry revision.',
      task_route_policy_revision:
        'Repair execution worker published a DB-backed workspace task route policy revision.',
    };
    const sideEffectExecutors: Record<string, string> = {
      model_registry_revision: 'model_registry_revision_publish_worker',
      prompt_registry_revision: 'prompt_registry_revision_publish_worker',
      provider_registry_revision: 'provider_registry_revision_publish_worker',
      task_route_policy_revision: 'task_route_policy_revision_publish_worker',
    };

    return {
      version: 'repair-execution-runtime-result/v1',
      executor:
        sideEffectExecutors[input.sideEffect.kind] ??
        'repair_execution_side_effect_worker',
      sideEffectsApplied: true,
      message:
        sideEffectMessages[input.sideEffect.kind] ??
        'Repair execution worker applied an approved side effect.',
      sideEffectFingerprint: input.sideEffect.fingerprint,
      sideEffectKind: input.sideEffect.kind,
      sideEffectRecordId: input.sideEffect.recordId,
      sideEffectSummary: input.sideEffect.summary,
    };
  }

  return {
    version: 'repair-execution-runtime-result/v1',
    executor: 'safe_noop_worker',
    sideEffectsApplied: false,
    message: 'Repair execution worker completed as a safe no-op.',
  };
}

function workerCancellationRuntimeResult(input: {
  reason?: string | null;
}): CopilotRepairExecutionRuntimeResult {
  return {
    version: 'repair-execution-runtime-result/v1',
    executor: 'repair_execution_worker_cooperative_cancel',
    sideEffectsApplied: false,
    message: input.reason
      ? `Repair execution worker observed cancellation request before side effects: ${input.reason}`
      : 'Repair execution worker observed cancellation request before side effects.',
  };
}

function workerFailureRuntimeResult(input: {
  code: string;
  executorPayloadFingerprint: string;
  message: string;
  retryScheduled: boolean;
}): CopilotRepairExecutionRuntimeResult {
  return {
    version: 'repair-execution-runtime-result/v1',
    executor: 'repair_execution_worker',
    sideEffectsApplied: false,
    message: input.retryScheduled
      ? `Repair execution worker failed with ${input.code}; retry scheduled.`
      : `Repair execution worker failed with ${input.code}: ${input.message}`,
    sideEffectSummary: {
      version: 'repair-execution-worker-failure-summary/v1',
      executorPayloadFingerprint: input.executorPayloadFingerprint,
      failureCode: input.code,
      retryScheduled: input.retryScheduled,
    },
  };
}

function manualControlRuntimeResult(input: {
  action: 'cancel' | 'retry' | 'recover_stale' | 'resume_with_payload';
  executorPayloadFingerprint?: string;
  reason?: string | null;
  retryScheduled?: boolean;
  source?: 'manual' | 'system';
}): CopilotRepairExecutionRuntimeResult {
  if (input.action === 'resume_with_payload') {
    return {
      version: 'repair-execution-runtime-result/v1',
      executor: 'manual_repair_execution_payload_correction',
      sideEffectsApplied: false,
      message: input.reason
        ? `Manual resume with corrected executor payload requested: ${input.reason}`
        : 'Manual resume with corrected executor payload requested; repair execution queued for worker runtime.',
      sideEffectSummary: {
        version: 'repair-execution-payload-correction-summary/v1',
        correctedExecutorPayloadFingerprint: input.executorPayloadFingerprint,
      },
    };
  }

  if (input.action === 'retry') {
    return {
      version: 'repair-execution-runtime-result/v1',
      executor: 'manual_repair_execution_control',
      sideEffectsApplied: false,
      message: input.reason
        ? `Manual retry requested: ${input.reason}`
        : 'Manual retry requested; repair execution queued for worker runtime.',
    };
  }

  if (input.action === 'recover_stale') {
    return {
      version: 'repair-execution-runtime-result/v1',
      executor:
        input.source === 'system'
          ? 'repair_execution_stale_recovery_worker'
          : 'manual_repair_execution_control',
      sideEffectsApplied: false,
      message: input.retryScheduled
        ? 'Expired running worker lease recovered; repair execution requeued.'
        : 'Expired running worker lease recovered; repair execution failed because attempts are exhausted.',
    };
  }

  return {
    version: 'repair-execution-runtime-result/v1',
    executor: 'manual_repair_execution_control',
    sideEffectsApplied: false,
    message: input.reason
      ? `Manual cancellation requested: ${input.reason}`
      : 'Manual cancellation requested; repair execution request cancelled.',
  };
}

function normalizeListLimit(limit: number | undefined) {
  return Math.min(Math.max(limit ?? 8, 1), 20);
}

@Injectable()
export class CopilotRepairExecutionModel extends BaseModel {
  @Transactional()
  async createOrReuse(input: {
    workspaceId: string;
    actorId: string;
    promptName: string;
    requestedAction: string;
    approvalRequired: boolean;
    permissionStatus: string;
    idempotencyKey: string;
    idempotencyFingerprint: string;
    requestFingerprint: string;
    candidateEvidenceSetFingerprint: string;
    taskRouteEvidenceSetFingerprint: string;
    targetLocatorFingerprint: string;
    repairJobFingerprint: string;
    approvalRecordFingerprint: string;
    auditEventFingerprint: string;
    executorPayload?: CopilotRepairExecutionExecutorPayload;
  }): Promise<{ created: boolean; record: CopilotRepairExecutionRecord }> {
    const actorId = requireRepairExecutionString(input.actorId, 'actor id');
    const workspaceId = requireRepairExecutionString(
      input.workspaceId,
      'workspace id'
    );
    const promptName = requireRepairExecutionString(
      input.promptName,
      'prompt name'
    );
    const requestedAction = requireRepairExecutionString(
      input.requestedAction,
      'requested action'
    );
    const permissionStatus = normalizeRepairExecutionPermissionStatus(
      input.permissionStatus
    );
    const idempotencyKey = requireRepairExecutionString(
      input.idempotencyKey,
      'idempotency key',
      REPAIR_EXECUTION_IDEMPOTENCY_KEY_MAX_LENGTH
    );
    const idempotencyFingerprint = requireRepairExecutionString(
      input.idempotencyFingerprint,
      'idempotency fingerprint',
      REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH
    );
    const requestFingerprint = requireRepairExecutionString(
      input.requestFingerprint,
      'request fingerprint',
      REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH
    );
    const candidateEvidenceSetFingerprint = requireRepairExecutionString(
      input.candidateEvidenceSetFingerprint,
      'candidate evidence set fingerprint',
      REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH
    );
    const taskRouteEvidenceSetFingerprint = requireRepairExecutionString(
      input.taskRouteEvidenceSetFingerprint,
      'task route evidence set fingerprint',
      REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH
    );
    const targetLocatorFingerprint = requireRepairExecutionString(
      input.targetLocatorFingerprint,
      'target locator fingerprint',
      REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH
    );
    const repairJobFingerprint = requireRepairExecutionString(
      input.repairJobFingerprint,
      'repair job fingerprint',
      REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH
    );
    const approvalRecordFingerprint = requireRepairExecutionString(
      input.approvalRecordFingerprint,
      'approval record fingerprint',
      REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH
    );
    const auditEventFingerprint = requireRepairExecutionString(
      input.auditEventFingerprint,
      'audit event fingerprint',
      REPAIR_EXECUTION_FINGERPRINT_MAX_LENGTH
    );
    const executorPayload = normalizeRepairExecutionExecutorPayload(
      input.executorPayload
    );
    const existing = await this.getByIdempotencyKey(
      workspaceId,
      idempotencyKey
    );

    if (existing) {
      await this.createAuditEvent({
        actorId,
        eventType: 'reused',
        executionRequestId: existing.id,
        metadata: {
          idempotencyKey,
          requestFingerprint,
        },
        workspaceId,
      });

      const record = await this.get(workspaceId, existing.id);
      if (!record) {
        throw new Error(
          `Reused repair execution request not found: ${existing.id}`
        );
      }

      return {
        created: false,
        record,
      };
    }

    const id = randomUUID();
    const createdAt = new Date();
    const status = initialStatus(input);
    const approvalState = initialApprovalState(input);
    const result = runtimeResult(input);
    const queuedAt = status === 'queued' ? createdAt : null;

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_repair_execution_requests (
        id,
        workspace_id,
        actor_id,
        prompt_name,
        requested_action,
        status,
        approval_state,
        permission_status,
        idempotency_key,
        idempotency_fingerprint,
        request_fingerprint,
        candidate_evidence_set_fingerprint,
        task_route_evidence_set_fingerprint,
        target_locator_fingerprint,
        repair_job_fingerprint,
        approval_record_fingerprint,
        audit_event_fingerprint,
        runtime_result,
        executor_payload,
        queued_at,
        completed_at,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${workspaceId},
        ${actorId},
        ${promptName},
        ${requestedAction},
        ${status},
        ${approvalState},
        ${permissionStatus},
        ${idempotencyKey},
        ${idempotencyFingerprint},
        ${requestFingerprint},
        ${candidateEvidenceSetFingerprint},
        ${taskRouteEvidenceSetFingerprint},
        ${targetLocatorFingerprint},
        ${repairJobFingerprint},
        ${approvalRecordFingerprint},
        ${auditEventFingerprint},
        ${toJsonString(result)}::jsonb,
        ${toJsonString(executorPayload)}::jsonb,
        ${queuedAt},
        ${null},
        ${createdAt},
        ${createdAt}
      )
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
      RETURNING id
    `;

    if (!insertedRows.length) {
      const reused = await this.getByIdempotencyKey(
        workspaceId,
        idempotencyKey
      );
      if (!reused) {
        throw new Error(
          `Repair execution request could not be reused after idempotency conflict: ${idempotencyKey}`
        );
      }
      const record = await this.get(workspaceId, reused.id);
      if (!record) {
        throw new Error(
          `Reused repair execution request not found: ${reused.id}`
        );
      }
      assertRepairExecutionMatchesCreateConflictEvidence(record, {
        actorId,
        approvalRecordFingerprint,
        approvalState,
        auditEventFingerprint,
        candidateEvidenceSetFingerprint,
        executorPayloadFingerprint: executorPayloadFingerprint(executorPayload),
        idempotencyFingerprint,
        idempotencyKey,
        permissionStatus,
        promptName,
        repairJobFingerprint,
        requestedAction,
        requestFingerprint,
        runtimeResultFingerprint: repairExecutionFingerprint({
          version: 'repair-execution-runtime-result-conflict-evidence/v1',
          runtimeResult: result,
        }),
        status,
        targetLocatorFingerprint,
        taskRouteEvidenceSetFingerprint,
        workspaceId,
      });
      await this.createAuditEvent({
        actorId,
        eventType: 'reused',
        executionRequestId: reused.id,
        metadata: {
          idempotencyKey,
          requestFingerprint,
        },
        workspaceId,
      });

      return {
        created: false,
        record,
      };
    }

    await this.createAuditEvent({
      actorId,
      eventType: 'requested',
      executionRequestId: id,
      metadata: {
        approvalRequired: input.approvalRequired,
        requestFingerprint,
      },
      workspaceId,
    });

    if (input.approvalRequired) {
      await this.createAuditEvent({
        actorId,
        eventType: 'waiting_approval',
        executionRequestId: id,
        metadata: {
          approvalRecordFingerprint,
        },
        workspaceId,
      });
    } else {
      await this.createAuditEvent({
        actorId,
        eventType: 'queued',
        executionRequestId: id,
        metadata: {
          idempotencyKey,
          queuedAt: queuedAt?.toISOString() ?? null,
        },
        workspaceId,
      });
    }

    const record = await this.get(workspaceId, id);
    if (!record) {
      throw new Error(`Created repair execution request not found: ${id}`);
    }

    return { created: true, record };
  }

  async list(
    workspaceId: string,
    options: {
      filter?: CopilotRepairExecutionListFilter | null;
      limit?: number;
    } = {}
  ): Promise<CopilotRepairExecutionRecord[]> {
    const limit = normalizeListLimit(options.limit);
    const filter = normalizeRepairExecutionListFilter(options.filter);
    const rows = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT r.id
      FROM ai_repair_execution_requests r
      WHERE r.workspace_id = ${workspaceId}
        AND (${filter.status}::varchar IS NULL OR r.status = ${filter.status})
        AND (
          ${filter.approvalState}::varchar IS NULL
          OR r.approval_state = ${filter.approvalState}
        )
        AND (
          ${filter.promptName}::varchar IS NULL
          OR r.prompt_name = ${filter.promptName}
        )
        AND (
          ${filter.requestedAction}::varchar IS NULL
          OR r.requested_action = ${filter.requestedAction}
        )
        AND (
          ${filter.query}::varchar IS NULL
          OR r.id = ${filter.query}
          OR r.prompt_name = ${filter.query}
          OR r.requested_action = ${filter.query}
          OR r.idempotency_key = ${filter.query}
          OR r.idempotency_fingerprint = ${filter.query}
          OR r.request_fingerprint = ${filter.query}
          OR r.candidate_evidence_set_fingerprint = ${filter.query}
          OR r.task_route_evidence_set_fingerprint = ${filter.query}
          OR r.target_locator_fingerprint = ${filter.query}
          OR r.repair_job_fingerprint = ${filter.query}
          OR r.approval_record_fingerprint = ${filter.query}
          OR r.audit_event_fingerprint = ${filter.query}
          OR r.failure_code = ${filter.query}
          OR r.worker_lease_id = ${filter.query}
          OR EXISTS (
            SELECT 1
            FROM ai_repair_execution_audit_events e
            WHERE e.workspace_id = r.workspace_id
              AND e.execution_request_id = r.id
              AND (
                e.id = ${filter.query}
                OR e.event_type = ${filter.query}
                OR e.event_fingerprint = ${filter.query}
              )
          )
          OR EXISTS (
            SELECT 1
            FROM ai_repair_execution_side_effects s
            WHERE s.workspace_id = r.workspace_id
              AND s.execution_request_id = r.id
              AND (
                s.id = ${filter.query}
                OR s.side_effect_kind = ${filter.query}
                OR s.side_effect_record_id = ${filter.query}
                OR s.side_effect_fingerprint = ${filter.query}
                OR s.executor_payload_fingerprint = ${filter.query}
                OR s.worker_lease_id = ${filter.query}
              )
          )
        )
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${limit}
    `;
    const records = await Promise.all(
      rows.map(row => this.get(workspaceId, row.id))
    );
    return records.filter(
      (record): record is CopilotRepairExecutionRecord => !!record
    );
  }

  async get(workspaceId: string, id: string) {
    const rows = await this.db.$queryRaw<CopilotRepairExecutionRecord[]>`
      SELECT
        r.id,
        r.workspace_id AS "workspaceId",
        r.actor_id AS "actorId",
        r.prompt_name AS "promptName",
        r.requested_action AS "requestedAction",
        r.status,
        r.approval_state AS "approvalState",
        r.permission_status AS "permissionStatus",
        r.idempotency_key AS "idempotencyKey",
        r.idempotency_fingerprint AS "idempotencyFingerprint",
        r.request_fingerprint AS "requestFingerprint",
        r.candidate_evidence_set_fingerprint AS "candidateEvidenceSetFingerprint",
        r.task_route_evidence_set_fingerprint AS "taskRouteEvidenceSetFingerprint",
        r.target_locator_fingerprint AS "targetLocatorFingerprint",
        r.repair_job_fingerprint AS "repairJobFingerprint",
        r.approval_record_fingerprint AS "approvalRecordFingerprint",
        r.audit_event_fingerprint AS "auditEventFingerprint",
        r.runtime_result AS "runtimeResult",
        r.executor_payload AS "executorPayload",
        r.failure_code AS "failureCode",
        r.failure_message AS "failureMessage",
        r.queued_at AS "queuedAt",
        r.worker_lease_id AS "workerLeaseId",
        r.worker_lease_expires_at AS "workerLeaseExpiresAt",
        r.worker_attempt AS "workerAttempt",
        r.worker_max_attempts AS "workerMaxAttempts",
        r.last_attempt_at AS "lastAttemptAt",
        r.completed_at AS "completedAt",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        COUNT(e.id)::int AS "auditEventCount"
      FROM ai_repair_execution_requests r
      LEFT JOIN ai_repair_execution_audit_events e
        ON e.execution_request_id = r.id
      WHERE r.workspace_id = ${workspaceId} AND r.id = ${id}
      GROUP BY r.id
      LIMIT 1
    `;
    if (!rows[0]) {
      return null;
    }

    const record = hydrateRepairExecutionRecord(rows[0]);
    return {
      ...record,
      ...(await this.listAuditEvents(record.workspaceId, record.id)),
      ...(await this.listSideEffects(record.workspaceId, record.id)),
    };
  }

  @Transactional()
  async currentLeasedExecutionBeforeSideEffect(input: {
    workspaceId: string;
    id: string;
    workerLeaseId: string;
    workerAttempt: number;
  }): Promise<CopilotRepairExecutionRecord | null> {
    const now = new Date();
    const rows = await this.db.$queryRaw<CopilotRepairExecutionRecord[]>`
      SELECT
        r.id,
        r.workspace_id AS "workspaceId",
        r.actor_id AS "actorId",
        r.prompt_name AS "promptName",
        r.requested_action AS "requestedAction",
        r.status,
        r.approval_state AS "approvalState",
        r.permission_status AS "permissionStatus",
        r.idempotency_key AS "idempotencyKey",
        r.idempotency_fingerprint AS "idempotencyFingerprint",
        r.request_fingerprint AS "requestFingerprint",
        r.candidate_evidence_set_fingerprint AS "candidateEvidenceSetFingerprint",
        r.task_route_evidence_set_fingerprint AS "taskRouteEvidenceSetFingerprint",
        r.target_locator_fingerprint AS "targetLocatorFingerprint",
        r.repair_job_fingerprint AS "repairJobFingerprint",
        r.approval_record_fingerprint AS "approvalRecordFingerprint",
        r.audit_event_fingerprint AS "auditEventFingerprint",
        r.runtime_result AS "runtimeResult",
        r.executor_payload AS "executorPayload",
        r.failure_code AS "failureCode",
        r.failure_message AS "failureMessage",
        r.queued_at AS "queuedAt",
        r.worker_lease_id AS "workerLeaseId",
        r.worker_lease_expires_at AS "workerLeaseExpiresAt",
        r.worker_attempt AS "workerAttempt",
        r.worker_max_attempts AS "workerMaxAttempts",
        r.last_attempt_at AS "lastAttemptAt",
        r.completed_at AS "completedAt",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        (
          SELECT COUNT(*)::int
          FROM ai_repair_execution_audit_events e
          WHERE e.workspace_id = r.workspace_id
            AND e.execution_request_id = r.id
        ) AS "auditEventCount"
      FROM ai_repair_execution_requests r
      WHERE r.workspace_id = ${input.workspaceId}
        AND r.id = ${input.id}
      LIMIT 1
      FOR UPDATE
    `;
    const current = rows[0] ? hydrateRepairExecutionRecord(rows[0]) : null;
    if (!current) {
      throw new Error(`Repair execution request not found: ${input.id}`);
    }
    if (
      current.status !== 'running' ||
      current.workerLeaseId !== input.workerLeaseId ||
      current.workerAttempt !== input.workerAttempt ||
      !current.workerLeaseExpiresAt ||
      current.workerLeaseExpiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }

    return {
      ...current,
      ...(await this.listAuditEvents(current.workspaceId, current.id)),
      ...(await this.listSideEffects(current.workspaceId, current.id)),
    };
  }

  async getByIdempotencyKey(workspaceId: string, idempotencyKey: string) {
    const rows = await this.db.$queryRaw<CopilotRepairExecutionRecord[]>`
      SELECT
        r.id,
        r.workspace_id AS "workspaceId",
        r.actor_id AS "actorId",
        r.prompt_name AS "promptName",
        r.requested_action AS "requestedAction",
        r.status,
        r.approval_state AS "approvalState",
        r.permission_status AS "permissionStatus",
        r.idempotency_key AS "idempotencyKey",
        r.idempotency_fingerprint AS "idempotencyFingerprint",
        r.request_fingerprint AS "requestFingerprint",
        r.candidate_evidence_set_fingerprint AS "candidateEvidenceSetFingerprint",
        r.task_route_evidence_set_fingerprint AS "taskRouteEvidenceSetFingerprint",
        r.target_locator_fingerprint AS "targetLocatorFingerprint",
        r.repair_job_fingerprint AS "repairJobFingerprint",
        r.approval_record_fingerprint AS "approvalRecordFingerprint",
        r.audit_event_fingerprint AS "auditEventFingerprint",
        r.runtime_result AS "runtimeResult",
        r.executor_payload AS "executorPayload",
        r.failure_code AS "failureCode",
        r.failure_message AS "failureMessage",
        r.queued_at AS "queuedAt",
        r.worker_lease_id AS "workerLeaseId",
        r.worker_lease_expires_at AS "workerLeaseExpiresAt",
        r.worker_attempt AS "workerAttempt",
        r.worker_max_attempts AS "workerMaxAttempts",
        r.last_attempt_at AS "lastAttemptAt",
        r.completed_at AS "completedAt",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        COUNT(e.id)::int AS "auditEventCount"
      FROM ai_repair_execution_requests r
      LEFT JOIN ai_repair_execution_audit_events e
        ON e.execution_request_id = r.id
      WHERE r.workspace_id = ${workspaceId}
        AND r.idempotency_key = ${idempotencyKey}
      GROUP BY r.id
      LIMIT 1
    `;
    if (!rows[0]) {
      return null;
    }

    const record = hydrateRepairExecutionRecord(rows[0]);
    return {
      ...record,
      ...(await this.listAuditEvents(record.workspaceId, record.id)),
      ...(await this.listSideEffects(record.workspaceId, record.id)),
    };
  }

  @Transactional()
  async decideApproval(input: {
    workspaceId: string;
    actorId: string;
    id: string;
    decision: 'approve' | 'reject';
    reason?: string | null;
  }): Promise<CopilotRepairExecutionRecord> {
    const existing = await this.get(input.workspaceId, input.id);
    if (!existing) {
      throw new Error(`Repair execution request not found: ${input.id}`);
    }
    if (
      existing.status !== 'waiting_approval' ||
      existing.approvalState !== 'waiting'
    ) {
      throw new Error(
        `Repair execution request is not waiting for approval: ${input.id}`
      );
    }

    const decidedAt = new Date();
    const approved = input.decision === 'approve';
    const reason = normalizeRepairExecutionControlReason(input.reason);
    const status: CopilotRepairExecutionStatus = approved
      ? 'queued'
      : 'cancelled';
    const approvalState: CopilotRepairExecutionApprovalState = approved
      ? 'approved'
      : 'rejected';
    const result = approvalDecisionRuntimeResult({
      decision: input.decision,
    });
    const completedAt = approved ? null : decidedAt;
    const queuedAt = approved ? decidedAt : existing.queuedAt;

    const decidedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_repair_execution_requests
      SET
        status = ${status},
        approval_state = ${approvalState},
        runtime_result = ${toJsonString(result)}::jsonb,
        failure_code = ${null},
        failure_message = ${null},
        queued_at = ${queuedAt},
        worker_lease_id = ${null},
        worker_lease_expires_at = ${null},
        completed_at = ${completedAt},
        updated_at = ${decidedAt}
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND actor_id = ${existing.actorId}
        AND prompt_name = ${existing.promptName}
        AND requested_action = ${existing.requestedAction}
        AND status = ${'waiting_approval'}
        AND approval_state = ${'waiting'}
        AND permission_status = ${existing.permissionStatus}
        AND idempotency_key = ${existing.idempotencyKey}
        AND idempotency_fingerprint = ${existing.idempotencyFingerprint}
        AND request_fingerprint = ${existing.requestFingerprint}
        AND candidate_evidence_set_fingerprint = ${
          existing.candidateEvidenceSetFingerprint
        }
        AND task_route_evidence_set_fingerprint = ${
          existing.taskRouteEvidenceSetFingerprint
        }
        AND target_locator_fingerprint = ${existing.targetLocatorFingerprint}
        AND repair_job_fingerprint = ${existing.repairJobFingerprint}
        AND approval_record_fingerprint = ${existing.approvalRecordFingerprint}
        AND audit_event_fingerprint = ${existing.auditEventFingerprint}
        AND runtime_result = ${toJsonString(existing.runtimeResult)}::jsonb
        AND executor_payload = ${toJsonString(existing.executorPayload)}::jsonb
        AND failure_code IS NOT DISTINCT FROM ${existing.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${existing.failureMessage}
        AND queued_at IS NOT DISTINCT FROM ${existing.queuedAt}
        AND worker_lease_id IS NOT DISTINCT FROM ${existing.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          existing.workerLeaseExpiresAt
        }
        AND worker_attempt = ${existing.workerAttempt}
        AND worker_max_attempts = ${existing.workerMaxAttempts}
        AND last_attempt_at IS NOT DISTINCT FROM ${existing.lastAttemptAt}
        AND completed_at IS NOT DISTINCT FROM ${existing.completedAt}
        AND created_at = ${existing.createdAt}
        AND updated_at IS NOT DISTINCT FROM ${existing.updatedAt}
      RETURNING id
    `;
    if (!decidedRows.length) {
      throw new Error(
        `Repair execution request could not be decided because its state changed: ${input.id}`
      );
    }

    await this.createAuditEvent({
      actorId: input.actorId,
      eventType: approved ? 'approval_approved' : 'approval_rejected',
      executionRequestId: input.id,
      metadata: {
        decision: input.decision,
        reason,
      },
      workspaceId: input.workspaceId,
    });

    await this.createAuditEvent({
      actorId: input.actorId,
      eventType: approved ? 'queued' : 'cancelled',
      executionRequestId: input.id,
      metadata: {
        approvalState,
        sideEffectsApplied: result.sideEffectsApplied,
        ...(approved ? { queuedAt: decidedAt.toISOString() } : {}),
      },
      workspaceId: input.workspaceId,
    });

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(
        `Updated repair execution request not found: ${input.id}`
      );
    }
    return record;
  }

  @Transactional()
  async acquireWorkerLease(input: {
    workspaceId: string;
    id: string;
    workerId: string;
    leaseMs?: number;
  }): Promise<CopilotRepairExecutionRecord | null> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 300000));
    const result = workerRunningRuntimeResult();
    const affected = await this.db.$executeRaw`
      UPDATE ai_repair_execution_requests
      SET
        status = ${'running'},
        runtime_result = ${toJsonString(result)}::jsonb,
        failure_code = ${null},
        failure_message = ${null},
        worker_lease_id = ${input.workerId},
        worker_lease_expires_at = ${leaseExpiresAt},
        worker_attempt = worker_attempt + 1,
        last_attempt_at = ${now},
        completed_at = ${null},
        updated_at = ${now}
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND approval_state IN (${'approved'}, ${'not_required'})
        AND status = ${'queued'}
        AND worker_attempt < worker_max_attempts
    `;

    if (!affected) {
      return null;
    }

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(`Leased repair execution request not found: ${input.id}`);
    }

    await this.createAuditEvent({
      actorId: record.actorId,
      eventType: 'running',
      executionRequestId: record.id,
      metadata: {
        executor: 'repair_execution_worker',
        workerAttempt: record.workerAttempt,
        workerLeaseId: input.workerId,
        workerLeaseExpiresAt: leaseExpiresAt.toISOString(),
      },
      workspaceId: record.workspaceId,
    });

    return {
      ...record,
      auditEventCount: record.auditEventCount + 1,
    };
  }

  @Transactional()
  async completeWorkerExecution(input: {
    workspaceId: string;
    id: string;
    workerLeaseId: string;
    workerAttempt: number;
    sideEffect?: CopilotRepairExecutionApprovedSideEffectResult | null;
  }): Promise<CopilotRepairExecutionRecord> {
    const existing = await this.get(input.workspaceId, input.id);
    if (!existing) {
      throw new Error(`Repair execution request not found: ${input.id}`);
    }
    if (
      existing.status !== 'running' ||
      existing.workerLeaseId !== input.workerLeaseId ||
      existing.workerAttempt !== input.workerAttempt
    ) {
      throw new Error(
        `Repair execution request is not leased by this worker: ${input.id}`
      );
    }

    const completedAt = new Date();
    const sideEffect = normalizeApprovedSideEffect(input.sideEffect, {
      executorPayload: existing.executorPayload,
    });
    const result = workerCompletionRuntimeResult({
      sideEffect,
    });

    const completedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_repair_execution_requests
      SET
        status = ${'completed'},
        runtime_result = ${toJsonString(result)}::jsonb,
        failure_code = ${null},
        failure_message = ${null},
        worker_lease_id = ${null},
        worker_lease_expires_at = ${null},
        completed_at = ${completedAt},
        updated_at = ${completedAt}
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND actor_id = ${existing.actorId}
        AND prompt_name = ${existing.promptName}
        AND requested_action = ${existing.requestedAction}
        AND status = ${'running'}
        AND approval_state = ${existing.approvalState}
        AND permission_status = ${existing.permissionStatus}
        AND idempotency_key = ${existing.idempotencyKey}
        AND idempotency_fingerprint = ${existing.idempotencyFingerprint}
        AND request_fingerprint = ${existing.requestFingerprint}
        AND candidate_evidence_set_fingerprint = ${
          existing.candidateEvidenceSetFingerprint
        }
        AND task_route_evidence_set_fingerprint = ${
          existing.taskRouteEvidenceSetFingerprint
        }
        AND target_locator_fingerprint = ${existing.targetLocatorFingerprint}
        AND repair_job_fingerprint = ${existing.repairJobFingerprint}
        AND approval_record_fingerprint = ${existing.approvalRecordFingerprint}
        AND audit_event_fingerprint = ${existing.auditEventFingerprint}
        AND runtime_result = ${toJsonString(existing.runtimeResult)}::jsonb
        AND executor_payload = ${toJsonString(existing.executorPayload)}::jsonb
        AND failure_code IS NOT DISTINCT FROM ${existing.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${existing.failureMessage}
        AND queued_at IS NOT DISTINCT FROM ${existing.queuedAt}
        AND worker_lease_id = ${input.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          existing.workerLeaseExpiresAt
        }
        AND worker_attempt = ${input.workerAttempt}
        AND worker_max_attempts = ${existing.workerMaxAttempts}
        AND last_attempt_at IS NOT DISTINCT FROM ${existing.lastAttemptAt}
        AND completed_at IS NOT DISTINCT FROM ${existing.completedAt}
        AND created_at = ${existing.createdAt}
        AND updated_at IS NOT DISTINCT FROM ${existing.updatedAt}
      RETURNING id
    `;
    if (!completedRows.length) {
      throw new Error(
        `Repair execution request could not be completed because its state changed: ${input.id}`
      );
    }

    if (sideEffect) {
      await this.createSideEffectLedgerEntry({
        appliedAt: completedAt,
        executorPayloadFingerprint: executorPayloadFingerprint(
          existing.executorPayload
        ),
        record: existing,
        sideEffect,
        terminalRequestSnapshot: {
          completedAt,
          failureCode: null,
          failureMessage: null,
          runtimeResult: result,
          status: 'completed',
          updatedAt: completedAt,
          workerLeaseCleared: true,
        },
        workerLeaseId: input.workerLeaseId,
      });
      await this.createAuditEvent({
        actorId: existing.actorId,
        eventType: 'side_effect_applied',
        executionRequestId: existing.id,
        metadata: {
          sideEffectFingerprint: sideEffect.fingerprint,
          sideEffectKind: sideEffect.kind,
          sideEffectRecordId: sideEffect.recordId,
          sideEffectSummary: sideEffect.summary,
          workerAttempt: existing.workerAttempt,
          workerLeaseId: input.workerLeaseId,
        },
        workspaceId: existing.workspaceId,
      });
    }

    await this.createAuditEvent({
      actorId: existing.actorId,
      eventType: 'completed',
      executionRequestId: existing.id,
      metadata: {
        approvalState: existing.approvalState,
        sideEffectsApplied: result.sideEffectsApplied,
        workerAttempt: existing.workerAttempt,
        workerLeaseId: input.workerLeaseId,
        ...(sideEffect
          ? {
              sideEffectFingerprint: sideEffect.fingerprint,
              sideEffectKind: sideEffect.kind,
              sideEffectRecordId: sideEffect.recordId,
            }
          : {}),
      },
      workspaceId: existing.workspaceId,
    });

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(
        `Completed repair execution request not found: ${input.id}`
      );
    }
    return record;
  }

  @Transactional()
  async failWorkerExecution(input: {
    workspaceId: string;
    id: string;
    workerLeaseId: string;
    workerAttempt: number;
    code: string;
    message: string;
    retryable?: boolean;
  }): Promise<{
    record: CopilotRepairExecutionRecord;
    retryScheduled: boolean;
  }> {
    const existing = await this.get(input.workspaceId, input.id);
    if (!existing) {
      throw new Error(`Repair execution request not found: ${input.id}`);
    }
    if (
      existing.status !== 'running' ||
      existing.workerLeaseId !== input.workerLeaseId ||
      existing.workerAttempt !== input.workerAttempt
    ) {
      return null;
    }

    const retryScheduled =
      input.retryable !== false &&
      existing.workerAttempt < existing.workerMaxAttempts;
    const failedAt = new Date();
    const status: CopilotRepairExecutionStatus = retryScheduled
      ? 'queued'
      : 'failed';
    const failingExecutorPayloadFingerprint = executorPayloadFingerprint(
      existing.executorPayload
    );
    const failureCode = requireRepairExecutionString(
      input.code,
      'failure code',
      REPAIR_EXECUTION_FAILURE_CODE_MAX_LENGTH
    );
    const failureMessage = normalizeWorkerFailureMessage(input.message);
    const result = workerFailureRuntimeResult({
      code: failureCode,
      executorPayloadFingerprint: failingExecutorPayloadFingerprint,
      message: failureMessage,
      retryScheduled,
    });

    const failedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_repair_execution_requests
      SET
        status = ${status},
        runtime_result = ${toJsonString(result)}::jsonb,
        failure_code = ${failureCode},
        failure_message = ${failureMessage},
        worker_lease_id = ${null},
        worker_lease_expires_at = ${null},
        queued_at = ${retryScheduled ? failedAt : existing.queuedAt},
        completed_at = ${retryScheduled ? null : failedAt},
        updated_at = ${failedAt}
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND actor_id = ${existing.actorId}
        AND prompt_name = ${existing.promptName}
        AND requested_action = ${existing.requestedAction}
        AND status = ${'running'}
        AND approval_state = ${existing.approvalState}
        AND permission_status = ${existing.permissionStatus}
        AND idempotency_key = ${existing.idempotencyKey}
        AND idempotency_fingerprint = ${existing.idempotencyFingerprint}
        AND request_fingerprint = ${existing.requestFingerprint}
        AND candidate_evidence_set_fingerprint = ${
          existing.candidateEvidenceSetFingerprint
        }
        AND task_route_evidence_set_fingerprint = ${
          existing.taskRouteEvidenceSetFingerprint
        }
        AND target_locator_fingerprint = ${existing.targetLocatorFingerprint}
        AND repair_job_fingerprint = ${existing.repairJobFingerprint}
        AND approval_record_fingerprint = ${existing.approvalRecordFingerprint}
        AND audit_event_fingerprint = ${existing.auditEventFingerprint}
        AND runtime_result = ${toJsonString(existing.runtimeResult)}::jsonb
        AND executor_payload = ${toJsonString(existing.executorPayload)}::jsonb
        AND failure_code IS NOT DISTINCT FROM ${existing.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${existing.failureMessage}
        AND queued_at IS NOT DISTINCT FROM ${existing.queuedAt}
        AND worker_lease_id = ${input.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          existing.workerLeaseExpiresAt
        }
        AND worker_attempt = ${input.workerAttempt}
        AND worker_max_attempts = ${existing.workerMaxAttempts}
        AND last_attempt_at IS NOT DISTINCT FROM ${existing.lastAttemptAt}
        AND completed_at IS NOT DISTINCT FROM ${existing.completedAt}
        AND created_at = ${existing.createdAt}
        AND updated_at IS NOT DISTINCT FROM ${existing.updatedAt}
      RETURNING id
    `;
    if (!failedRows.length) {
      throw new Error(
        `Repair execution request could not be failed because its state changed: ${input.id}`
      );
    }

    await this.createAuditEvent({
      actorId: existing.actorId,
      eventType: 'failed',
      executionRequestId: existing.id,
      metadata: {
        failureCode,
        failureMessage,
        failingExecutorPayloadFingerprint,
        retryScheduled,
        workerAttempt: existing.workerAttempt,
        workerMaxAttempts: existing.workerMaxAttempts,
        workerLeaseId: input.workerLeaseId,
      },
      workspaceId: existing.workspaceId,
    });

    if (retryScheduled) {
      await this.createAuditEvent({
        actorId: existing.actorId,
        eventType: 'retry_scheduled',
        executionRequestId: existing.id,
        metadata: {
          nextStatus: 'queued',
          workerAttempt: existing.workerAttempt,
          workerMaxAttempts: existing.workerMaxAttempts,
        },
        workspaceId: existing.workspaceId,
      });
    }

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(`Failed repair execution request not found: ${input.id}`);
    }
    return { record, retryScheduled };
  }

  @Transactional()
  async cancelLeasedExecutionIfCancellationRequested(input: {
    workspaceId: string;
    id: string;
    workerLeaseId: string;
    workerAttempt: number;
  }): Promise<CopilotRepairExecutionRecord | null> {
    const existing = await this.get(input.workspaceId, input.id);
    if (!existing) {
      throw new Error(`Repair execution request not found: ${input.id}`);
    }
    if (
      existing.status !== 'running' ||
      existing.workerLeaseId !== input.workerLeaseId ||
      existing.workerAttempt !== input.workerAttempt
    ) {
      throw new Error(
        `Repair execution request is not leased by this worker: ${input.id}`
      );
    }

    const requestRows = await this.db.$queryRaw<
      Array<{
        actorId: string;
        createdAt: Date;
        metadata: {
          reason?: string | null;
          workerAttempt?: number;
          workerLeaseId?: string | null;
        };
      }>
    >`
      SELECT
        actor_id AS "actorId",
        metadata,
        created_at AS "createdAt"
      FROM ai_repair_execution_audit_events
      WHERE workspace_id = ${input.workspaceId}
        AND execution_request_id = ${input.id}
        AND event_type = ${'cancel_requested'}
        AND metadata->>'workerLeaseId' = ${input.workerLeaseId}
        AND (metadata->>'workerAttempt')::int = ${input.workerAttempt}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    const cancellationRequest = requestRows[0];
    if (!cancellationRequest) {
      return null;
    }

    const cancelledAt = new Date();
    const reason = normalizeRepairExecutionControlReason(
      cancellationRequest.metadata.reason
    );
    const result = workerCancellationRuntimeResult({ reason });
    const cancelledRows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_repair_execution_requests
      SET
        status = ${'cancelled'},
        runtime_result = ${toJsonString(result)}::jsonb,
        failure_code = ${null},
        failure_message = ${null},
        worker_lease_id = ${null},
        worker_lease_expires_at = ${null},
        completed_at = ${cancelledAt},
        updated_at = ${cancelledAt}
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND actor_id = ${existing.actorId}
        AND prompt_name = ${existing.promptName}
        AND requested_action = ${existing.requestedAction}
        AND status = ${'running'}
        AND approval_state = ${existing.approvalState}
        AND permission_status = ${existing.permissionStatus}
        AND idempotency_key = ${existing.idempotencyKey}
        AND idempotency_fingerprint = ${existing.idempotencyFingerprint}
        AND request_fingerprint = ${existing.requestFingerprint}
        AND candidate_evidence_set_fingerprint = ${
          existing.candidateEvidenceSetFingerprint
        }
        AND task_route_evidence_set_fingerprint = ${
          existing.taskRouteEvidenceSetFingerprint
        }
        AND target_locator_fingerprint = ${existing.targetLocatorFingerprint}
        AND repair_job_fingerprint = ${existing.repairJobFingerprint}
        AND approval_record_fingerprint = ${existing.approvalRecordFingerprint}
        AND audit_event_fingerprint = ${existing.auditEventFingerprint}
        AND runtime_result = ${toJsonString(existing.runtimeResult)}::jsonb
        AND executor_payload = ${toJsonString(existing.executorPayload)}::jsonb
        AND failure_code IS NOT DISTINCT FROM ${existing.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${existing.failureMessage}
        AND queued_at IS NOT DISTINCT FROM ${existing.queuedAt}
        AND worker_lease_id = ${input.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          existing.workerLeaseExpiresAt
        }
        AND worker_attempt = ${input.workerAttempt}
        AND worker_max_attempts = ${existing.workerMaxAttempts}
        AND last_attempt_at IS NOT DISTINCT FROM ${existing.lastAttemptAt}
        AND completed_at IS NOT DISTINCT FROM ${existing.completedAt}
        AND created_at = ${existing.createdAt}
        AND updated_at IS NOT DISTINCT FROM ${existing.updatedAt}
      RETURNING id
    `;
    if (!cancelledRows.length) {
      throw new Error(
        `Repair execution request could not be cancelled because its state changed: ${input.id}`
      );
    }

    await this.createAuditEvent({
      actorId: cancellationRequest.actorId,
      eventType: 'cancelled',
      executionRequestId: existing.id,
      metadata: {
        controlAction: 'cancel',
        previousStatus: existing.status,
        previousApprovalState: existing.approvalState,
        reason,
        workerAttempt: existing.workerAttempt,
        workerLeaseId: input.workerLeaseId,
        cooperative: true,
        cancellationRequestedAt: cancellationRequest.createdAt.toISOString(),
        sideEffectsApplied: result.sideEffectsApplied,
      },
      workspaceId: existing.workspaceId,
    });

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(
        `Cancelled repair execution request not found: ${input.id}`
      );
    }
    return record;
  }

  private async createSideEffectLedgerEntry(input: {
    appliedAt: Date;
    executorPayloadFingerprint: string;
    record: CopilotRepairExecutionRecord;
    sideEffect: CopilotRepairExecutionApprovedSideEffectResult;
    terminalRequestSnapshot?: {
      completedAt: Date;
      failureCode: string | null;
      failureMessage: string | null;
      runtimeResult: CopilotRepairExecutionRuntimeResult;
      status: CopilotRepairExecutionStatus;
      updatedAt: Date;
      workerLeaseCleared: boolean;
    };
    workerLeaseId: string;
  }) {
    const terminalRequestSnapshot =
      input.terminalRequestSnapshot ??
      ({
        completedAt: input.record.completedAt ?? input.appliedAt,
        failureCode: input.record.failureCode,
        failureMessage: input.record.failureMessage,
        runtimeResult: input.record.runtimeResult,
        status: input.record.status,
        updatedAt: input.record.updatedAt,
        workerLeaseCleared: false,
      } satisfies NonNullable<typeof input.terminalRequestSnapshot>);
    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_repair_execution_side_effects (
        id,
        execution_request_id,
        workspace_id,
        actor_id,
        side_effect_kind,
        side_effect_record_id,
        side_effect_fingerprint,
        side_effect_summary,
        executor_payload_fingerprint,
        worker_attempt,
        worker_lease_id,
        applied_at
      )
      SELECT
        ${`repair-execution-side-effect-${input.record.id}`},
        ${input.record.id},
        ${input.record.workspaceId},
        ${input.record.actorId},
        ${input.sideEffect.kind},
        ${input.sideEffect.recordId},
        ${input.sideEffect.fingerprint},
        ${toJsonString(input.sideEffect.summary)}::jsonb,
        ${input.executorPayloadFingerprint},
        ${input.record.workerAttempt},
        ${input.workerLeaseId},
        ${input.appliedAt}
      FROM ai_repair_execution_requests request
      WHERE request.id = ${input.record.id}
        AND request.workspace_id = ${input.record.workspaceId}
        AND request.actor_id = ${input.record.actorId}
        AND request.prompt_name = ${input.record.promptName}
        AND request.requested_action = ${input.record.requestedAction}
        AND request.status = ${terminalRequestSnapshot.status}
        AND request.status = ${'completed'}
        AND request.approval_state = ${input.record.approvalState}
        AND request.permission_status = ${input.record.permissionStatus}
        AND request.idempotency_key = ${input.record.idempotencyKey}
        AND request.idempotency_fingerprint = ${
          input.record.idempotencyFingerprint
        }
        AND request.request_fingerprint = ${input.record.requestFingerprint}
        AND request.candidate_evidence_set_fingerprint = ${
          input.record.candidateEvidenceSetFingerprint
        }
        AND request.task_route_evidence_set_fingerprint = ${
          input.record.taskRouteEvidenceSetFingerprint
        }
        AND request.target_locator_fingerprint = ${
          input.record.targetLocatorFingerprint
        }
        AND request.repair_job_fingerprint = ${input.record.repairJobFingerprint}
        AND request.approval_record_fingerprint = ${
          input.record.approvalRecordFingerprint
        }
        AND request.audit_event_fingerprint = ${
          input.record.auditEventFingerprint
        }
        AND request.runtime_result = ${toJsonString(
          terminalRequestSnapshot.runtimeResult
        )}::jsonb
        AND request.executor_payload = ${toJsonString(
          input.record.executorPayload
        )}::jsonb
        AND request.failure_code IS NOT DISTINCT FROM ${
          terminalRequestSnapshot.failureCode
        }
        AND request.failure_message IS NOT DISTINCT FROM ${
          terminalRequestSnapshot.failureMessage
        }
        AND request.queued_at IS NOT DISTINCT FROM ${input.record.queuedAt}
        AND (
          (
            ${terminalRequestSnapshot.workerLeaseCleared}
            AND request.worker_lease_id IS NULL
            AND request.worker_lease_expires_at IS NULL
          )
          OR (
            NOT ${terminalRequestSnapshot.workerLeaseCleared}
            AND request.worker_lease_id IS NOT DISTINCT FROM ${
              input.record.workerLeaseId
            }
            AND request.worker_lease_expires_at IS NOT DISTINCT FROM ${
              input.record.workerLeaseExpiresAt
            }
          )
        )
        AND request.worker_attempt = ${input.record.workerAttempt}
        AND request.worker_max_attempts = ${input.record.workerMaxAttempts}
        AND request.last_attempt_at IS NOT DISTINCT FROM ${
          input.record.lastAttemptAt
        }
        AND request.completed_at IS NOT DISTINCT FROM ${
          terminalRequestSnapshot.completedAt
        }
        AND request.created_at = ${input.record.createdAt}
        AND request.updated_at IS NOT DISTINCT FROM ${
          terminalRequestSnapshot.updatedAt
        }
      RETURNING id
    `;
    if (!insertedRows.length) {
      throw new Error(
        `Repair execution side effect could not be recorded because its request state changed: ${input.record.id}`
      );
    }
  }

  private async listSideEffects(
    workspaceId: string,
    executionRequestId: string,
    options: { limit?: number } = {}
  ) {
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const rows = await this.db.$queryRaw<
      Array<
        CopilotRepairExecutionSideEffectRecord & {
          sideEffectCount: number;
        }
      >
    >`
      SELECT
        id,
        execution_request_id AS "executionRequestId",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        side_effect_kind AS "sideEffectKind",
        side_effect_record_id AS "sideEffectRecordId",
        side_effect_fingerprint AS "sideEffectFingerprint",
        side_effect_summary AS "sideEffectSummary",
        executor_payload_fingerprint AS "executorPayloadFingerprint",
        worker_attempt AS "workerAttempt",
        worker_lease_id AS "workerLeaseId",
        applied_at AS "appliedAt",
        created_at AS "createdAt",
        COUNT(*) OVER()::int AS "sideEffectCount"
      FROM ai_repair_execution_side_effects
      WHERE workspace_id = ${workspaceId}
        AND execution_request_id = ${executionRequestId}
      ORDER BY worker_attempt DESC, applied_at DESC, id DESC
      LIMIT ${limit}
    `;

    return {
      sideEffectCount: rows[0]?.sideEffectCount ?? 0,
      sideEffects: rows.map(hydrateRepairExecutionSideEffect),
    };
  }

  private async listAuditEvents(
    workspaceId: string,
    executionRequestId: string,
    options: { limit?: number } = {}
  ) {
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const rows = await this.db.$queryRaw<
      Array<
        CopilotRepairExecutionAuditEventRecord & {
          auditEventCount: number;
        }
      >
    >`
      SELECT
        id,
        execution_request_id AS "executionRequestId",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        event_type AS "eventType",
        event_fingerprint AS "eventFingerprint",
        metadata,
        created_at AS "createdAt",
        COUNT(*) OVER()::int AS "auditEventCount"
      FROM ai_repair_execution_audit_events
      WHERE workspace_id = ${workspaceId}
        AND execution_request_id = ${executionRequestId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `;

    return {
      auditEventCount: rows[0]?.auditEventCount ?? 0,
      auditEvents: rows.map(hydrateRepairExecutionAuditEvent),
    };
  }

  @Transactional()
  async controlExecution(input: {
    workspaceId: string;
    actorId: string;
    id: string;
    action: 'cancel' | 'retry' | 'recover_stale' | 'resume_with_payload';
    executorPayload?: CopilotRepairExecutionExecutorPayload | null;
    reason?: string | null;
  }): Promise<CopilotRepairExecutionRecord> {
    const existing = await this.get(input.workspaceId, input.id);
    if (!existing) {
      throw new Error(`Repair execution request not found: ${input.id}`);
    }

    if (input.action === 'cancel') {
      return await this.cancelExecution(input, existing);
    }

    if (input.action === 'recover_stale') {
      return await this.recoverStaleExecution(input, existing);
    }

    if (input.action === 'resume_with_payload') {
      return await this.resumeExecutionWithPayload(input, existing);
    }

    return await this.retryExecution(input, existing);
  }

  async listExpiredRunningWorkerLeases(input: {
    limit?: number;
  }): Promise<CopilotRepairExecutionRecord[]> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const rows = await this.db.$queryRaw<CopilotRepairExecutionRecord[]>`
      SELECT
        r.id,
        r.workspace_id AS "workspaceId",
        r.actor_id AS "actorId",
        r.prompt_name AS "promptName",
        r.requested_action AS "requestedAction",
        r.status,
        r.approval_state AS "approvalState",
        r.permission_status AS "permissionStatus",
        r.idempotency_key AS "idempotencyKey",
        r.idempotency_fingerprint AS "idempotencyFingerprint",
        r.request_fingerprint AS "requestFingerprint",
        r.candidate_evidence_set_fingerprint AS "candidateEvidenceSetFingerprint",
        r.task_route_evidence_set_fingerprint AS "taskRouteEvidenceSetFingerprint",
        r.target_locator_fingerprint AS "targetLocatorFingerprint",
        r.repair_job_fingerprint AS "repairJobFingerprint",
        r.approval_record_fingerprint AS "approvalRecordFingerprint",
        r.audit_event_fingerprint AS "auditEventFingerprint",
        r.runtime_result AS "runtimeResult",
        r.executor_payload AS "executorPayload",
        r.failure_code AS "failureCode",
        r.failure_message AS "failureMessage",
        r.queued_at AS "queuedAt",
        r.worker_lease_id AS "workerLeaseId",
        r.worker_lease_expires_at AS "workerLeaseExpiresAt",
        r.worker_attempt AS "workerAttempt",
        r.worker_max_attempts AS "workerMaxAttempts",
        r.last_attempt_at AS "lastAttemptAt",
        r.completed_at AS "completedAt",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        COUNT(e.id)::int AS "auditEventCount"
      FROM ai_repair_execution_requests r
      LEFT JOIN ai_repair_execution_audit_events e
        ON e.execution_request_id = r.id
      WHERE r.status = ${'running'}
        AND r.approval_state IN (${'approved'}, ${'not_required'})
        AND r.worker_lease_expires_at IS NOT NULL
        AND r.worker_lease_expires_at <= ${new Date()}
      GROUP BY r.id
      ORDER BY r.worker_lease_expires_at ASC, r.updated_at ASC, r.id ASC
      LIMIT ${limit}
    `;

    return rows.map(hydrateRepairExecutionRecord);
  }

  async listQueuedExecutableRequests(input: {
    limit?: number;
  }): Promise<CopilotRepairExecutionRecord[]> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const rows = await this.db.$queryRaw<CopilotRepairExecutionRecord[]>`
      SELECT
        r.id,
        r.workspace_id AS "workspaceId",
        r.actor_id AS "actorId",
        r.prompt_name AS "promptName",
        r.requested_action AS "requestedAction",
        r.status,
        r.approval_state AS "approvalState",
        r.permission_status AS "permissionStatus",
        r.idempotency_key AS "idempotencyKey",
        r.idempotency_fingerprint AS "idempotencyFingerprint",
        r.request_fingerprint AS "requestFingerprint",
        r.candidate_evidence_set_fingerprint AS "candidateEvidenceSetFingerprint",
        r.task_route_evidence_set_fingerprint AS "taskRouteEvidenceSetFingerprint",
        r.target_locator_fingerprint AS "targetLocatorFingerprint",
        r.repair_job_fingerprint AS "repairJobFingerprint",
        r.approval_record_fingerprint AS "approvalRecordFingerprint",
        r.audit_event_fingerprint AS "auditEventFingerprint",
        r.runtime_result AS "runtimeResult",
        r.executor_payload AS "executorPayload",
        r.failure_code AS "failureCode",
        r.failure_message AS "failureMessage",
        r.queued_at AS "queuedAt",
        r.worker_lease_id AS "workerLeaseId",
        r.worker_lease_expires_at AS "workerLeaseExpiresAt",
        r.worker_attempt AS "workerAttempt",
        r.worker_max_attempts AS "workerMaxAttempts",
        r.last_attempt_at AS "lastAttemptAt",
        r.completed_at AS "completedAt",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        COUNT(e.id)::int AS "auditEventCount"
      FROM ai_repair_execution_requests r
      LEFT JOIN ai_repair_execution_audit_events e
        ON e.execution_request_id = r.id
      WHERE r.status = ${'queued'}
        AND r.approval_state IN (${'approved'}, ${'not_required'})
        AND r.worker_attempt < r.worker_max_attempts
      GROUP BY r.id
      ORDER BY r.queued_at ASC NULLS LAST, r.updated_at ASC, r.id ASC
      LIMIT ${limit}
    `;

    return rows.map(hydrateRepairExecutionRecord);
  }

  @Transactional()
  async recoverExpiredWorkerLease(input: {
    workspaceId: string;
    id: string;
    reason?: string | null;
  }): Promise<CopilotRepairExecutionRecord> {
    const existing = await this.get(input.workspaceId, input.id);
    if (!existing) {
      throw new Error(`Repair execution request not found: ${input.id}`);
    }
    return await this.recoverStaleExecution(
      {
        workspaceId: input.workspaceId,
        actorId: existing.actorId,
        id: input.id,
        reason:
          input.reason ??
          'system recovered expired repair execution worker lease',
        source: 'system',
      },
      existing
    );
  }

  private async cancelExecution(
    input: {
      workspaceId: string;
      actorId: string;
      id: string;
      reason?: string | null;
    },
    existing: CopilotRepairExecutionRecord
  ): Promise<CopilotRepairExecutionRecord> {
    if (existing.status === 'running') {
      return await this.requestRunningCancellation(input, existing);
    }

    if (
      existing.status !== 'waiting_approval' &&
      existing.status !== 'queued' &&
      existing.status !== 'failed'
    ) {
      throw new Error(
        `Repair execution request cannot be cancelled from status: ${existing.status}`
      );
    }

    const cancelledAt = new Date();
    const reason = normalizeRepairExecutionControlReason(input.reason);
    const result = manualControlRuntimeResult({
      action: 'cancel',
      reason,
    });

    const cancelledRows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_repair_execution_requests
      SET
        status = ${'cancelled'},
        runtime_result = ${toJsonString(result)}::jsonb,
        failure_code = ${null},
        failure_message = ${null},
        worker_lease_id = ${null},
        worker_lease_expires_at = ${null},
        completed_at = ${cancelledAt},
        updated_at = ${cancelledAt}
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND actor_id = ${existing.actorId}
        AND prompt_name = ${existing.promptName}
        AND requested_action = ${existing.requestedAction}
        AND status = ${existing.status}
        AND approval_state = ${existing.approvalState}
        AND permission_status = ${existing.permissionStatus}
        AND idempotency_key = ${existing.idempotencyKey}
        AND idempotency_fingerprint = ${existing.idempotencyFingerprint}
        AND request_fingerprint = ${existing.requestFingerprint}
        AND candidate_evidence_set_fingerprint = ${
          existing.candidateEvidenceSetFingerprint
        }
        AND task_route_evidence_set_fingerprint = ${
          existing.taskRouteEvidenceSetFingerprint
        }
        AND target_locator_fingerprint = ${existing.targetLocatorFingerprint}
        AND repair_job_fingerprint = ${existing.repairJobFingerprint}
        AND approval_record_fingerprint = ${existing.approvalRecordFingerprint}
        AND audit_event_fingerprint = ${existing.auditEventFingerprint}
        AND runtime_result = ${toJsonString(existing.runtimeResult)}::jsonb
        AND executor_payload = ${toJsonString(existing.executorPayload)}::jsonb
        AND failure_code IS NOT DISTINCT FROM ${existing.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${existing.failureMessage}
        AND queued_at IS NOT DISTINCT FROM ${existing.queuedAt}
        AND worker_lease_id IS NOT DISTINCT FROM ${existing.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          existing.workerLeaseExpiresAt
        }
        AND worker_attempt = ${existing.workerAttempt}
        AND worker_max_attempts = ${existing.workerMaxAttempts}
        AND last_attempt_at IS NOT DISTINCT FROM ${existing.lastAttemptAt}
        AND completed_at IS NOT DISTINCT FROM ${existing.completedAt}
        AND created_at = ${existing.createdAt}
        AND updated_at IS NOT DISTINCT FROM ${existing.updatedAt}
      RETURNING id
    `;
    if (!cancelledRows.length) {
      throw new Error(
        `Repair execution request could not be cancelled because its state changed: ${input.id}`
      );
    }

    await this.createAuditEvent({
      actorId: input.actorId,
      eventType: 'cancelled',
      executionRequestId: input.id,
      metadata: {
        controlAction: 'cancel',
        previousStatus: existing.status,
        previousApprovalState: existing.approvalState,
        reason,
        workerAttempt: existing.workerAttempt,
        workerLeaseId: existing.workerLeaseId,
      },
      workspaceId: input.workspaceId,
    });

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(
        `Cancelled repair execution request not found: ${input.id}`
      );
    }
    return record;
  }

  private async requestRunningCancellation(
    input: {
      workspaceId: string;
      actorId: string;
      id: string;
      reason?: string | null;
    },
    existing: CopilotRepairExecutionRecord
  ): Promise<CopilotRepairExecutionRecord> {
    if (
      existing.approvalState !== 'approved' &&
      existing.approvalState !== 'not_required'
    ) {
      throw new Error(
        [
          'Repair execution request cannot request running cancellation',
          `without executable approval state: ${existing.approvalState}`,
        ].join(' ')
      );
    }
    if (!existing.workerLeaseId || !existing.workerLeaseExpiresAt) {
      throw new Error(
        'Repair execution request cannot request running cancellation without an active worker lease'
      );
    }

    const requestedAt = new Date();
    const reason = normalizeRepairExecutionControlReason(input.reason);
    const requestedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM ai_repair_execution_requests
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND actor_id = ${existing.actorId}
        AND prompt_name = ${existing.promptName}
        AND requested_action = ${existing.requestedAction}
        AND status = ${'running'}
        AND approval_state = ${existing.approvalState}
        AND permission_status = ${existing.permissionStatus}
        AND idempotency_key = ${existing.idempotencyKey}
        AND idempotency_fingerprint = ${existing.idempotencyFingerprint}
        AND request_fingerprint = ${existing.requestFingerprint}
        AND candidate_evidence_set_fingerprint = ${
          existing.candidateEvidenceSetFingerprint
        }
        AND task_route_evidence_set_fingerprint = ${
          existing.taskRouteEvidenceSetFingerprint
        }
        AND target_locator_fingerprint = ${existing.targetLocatorFingerprint}
        AND repair_job_fingerprint = ${existing.repairJobFingerprint}
        AND approval_record_fingerprint = ${existing.approvalRecordFingerprint}
        AND audit_event_fingerprint = ${existing.auditEventFingerprint}
        AND runtime_result = ${toJsonString(existing.runtimeResult)}::jsonb
        AND executor_payload = ${toJsonString(existing.executorPayload)}::jsonb
        AND failure_code IS NOT DISTINCT FROM ${existing.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${existing.failureMessage}
        AND queued_at IS NOT DISTINCT FROM ${existing.queuedAt}
        AND worker_lease_id = ${existing.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          existing.workerLeaseExpiresAt
        }
        AND worker_attempt = ${existing.workerAttempt}
        AND worker_max_attempts = ${existing.workerMaxAttempts}
        AND last_attempt_at IS NOT DISTINCT FROM ${existing.lastAttemptAt}
        AND completed_at IS NOT DISTINCT FROM ${existing.completedAt}
        AND created_at = ${existing.createdAt}
        AND updated_at IS NOT DISTINCT FROM ${existing.updatedAt}
      LIMIT 1
      FOR UPDATE
    `;
    if (!requestedRows.length) {
      throw new Error(
        `Repair execution request could not request cancellation because its state changed: ${input.id}`
      );
    }

    await this.createAuditEvent({
      actorId: input.actorId,
      eventType: 'cancel_requested',
      executionRequestId: input.id,
      metadata: {
        controlAction: 'cancel',
        previousStatus: existing.status,
        previousApprovalState: existing.approvalState,
        reason,
        requestedAt: requestedAt.toISOString(),
        workerAttempt: existing.workerAttempt,
        workerLeaseId: existing.workerLeaseId,
        workerLeaseExpiresAt: existing.workerLeaseExpiresAt.toISOString(),
      },
      workspaceId: input.workspaceId,
    });

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(
        `Cancellation-requested repair execution request not found: ${input.id}`
      );
    }
    return record;
  }

  private async retryExecution(
    input: {
      workspaceId: string;
      actorId: string;
      id: string;
      reason?: string | null;
    },
    existing: CopilotRepairExecutionRecord
  ): Promise<CopilotRepairExecutionRecord> {
    if (existing.status !== 'failed') {
      throw new Error(
        `Repair execution request cannot be retried from status: ${existing.status}`
      );
    }
    if (
      existing.approvalState !== 'approved' &&
      existing.approvalState !== 'not_required'
    ) {
      throw new Error(
        [
          'Repair execution request cannot be retried without executable',
          `approval state: ${existing.approvalState}`,
        ].join(' ')
      );
    }
    if (isDeterministicExecutorPayloadFailure(existing.failureCode)) {
      throw new Error(
        [
          'Repair execution request cannot be retried after deterministic',
          `executor payload failure: ${existing.failureCode}`,
        ].join(' ')
      );
    }

    const currentExecutorPayloadFingerprint = executorPayloadFingerprint(
      existing.executorPayload
    );
    const previousFailureSummary = existing.runtimeResult.sideEffectSummary as
      | { executorPayloadFingerprint?: unknown }
      | undefined;
    const previousExecutorPayloadFingerprint =
      typeof previousFailureSummary?.executorPayloadFingerprint === 'string'
        ? previousFailureSummary.executorPayloadFingerprint
        : null;
    const queuedAt = new Date();
    const workerMaxAttempts =
      existing.workerAttempt >= existing.workerMaxAttempts
        ? existing.workerAttempt + 1
        : existing.workerMaxAttempts;
    const reason = normalizeRepairExecutionControlReason(input.reason);
    const result = manualControlRuntimeResult({
      action: 'retry',
      reason,
    });

    const retriedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_repair_execution_requests
      SET
        status = ${'queued'},
        runtime_result = ${toJsonString(result)}::jsonb,
        failure_code = ${null},
        failure_message = ${null},
        queued_at = ${queuedAt},
        worker_lease_id = ${null},
        worker_lease_expires_at = ${null},
        worker_max_attempts = ${workerMaxAttempts},
        completed_at = ${null},
        updated_at = ${queuedAt}
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND actor_id = ${existing.actorId}
        AND prompt_name = ${existing.promptName}
        AND requested_action = ${existing.requestedAction}
        AND status = ${'failed'}
        AND approval_state = ${existing.approvalState}
        AND permission_status = ${existing.permissionStatus}
        AND idempotency_key = ${existing.idempotencyKey}
        AND idempotency_fingerprint = ${existing.idempotencyFingerprint}
        AND request_fingerprint = ${existing.requestFingerprint}
        AND candidate_evidence_set_fingerprint = ${
          existing.candidateEvidenceSetFingerprint
        }
        AND task_route_evidence_set_fingerprint = ${
          existing.taskRouteEvidenceSetFingerprint
        }
        AND target_locator_fingerprint = ${existing.targetLocatorFingerprint}
        AND repair_job_fingerprint = ${existing.repairJobFingerprint}
        AND approval_record_fingerprint = ${existing.approvalRecordFingerprint}
        AND audit_event_fingerprint = ${existing.auditEventFingerprint}
        AND runtime_result = ${toJsonString(existing.runtimeResult)}::jsonb
        AND executor_payload = ${toJsonString(existing.executorPayload)}::jsonb
        AND failure_code IS NOT DISTINCT FROM ${existing.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${existing.failureMessage}
        AND queued_at IS NOT DISTINCT FROM ${existing.queuedAt}
        AND worker_lease_id IS NOT DISTINCT FROM ${existing.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${existing.workerLeaseExpiresAt}
        AND worker_attempt = ${existing.workerAttempt}
        AND worker_max_attempts = ${existing.workerMaxAttempts}
        AND last_attempt_at IS NOT DISTINCT FROM ${existing.lastAttemptAt}
        AND completed_at IS NOT DISTINCT FROM ${existing.completedAt}
        AND created_at = ${existing.createdAt}
        AND updated_at IS NOT DISTINCT FROM ${existing.updatedAt}
      RETURNING id
    `;
    if (!retriedRows.length) {
      throw new Error(
        `Repair execution request could not be retried because its state changed: ${input.id}`
      );
    }

    await this.createAuditEvent({
      actorId: input.actorId,
      eventType: 'manual_retry_requested',
      executionRequestId: input.id,
      metadata: {
        controlAction: 'retry',
        previousStatus: existing.status,
        previousFailureCode: existing.failureCode,
        previousFailureMessage: existing.failureMessage,
        previousExecutorPayloadFingerprint,
        currentExecutorPayloadFingerprint,
        reason,
        workerAttempt: existing.workerAttempt,
        workerMaxAttempts: existing.workerMaxAttempts,
        nextWorkerMaxAttempts: workerMaxAttempts,
      },
      workspaceId: input.workspaceId,
    });

    await this.createAuditEvent({
      actorId: input.actorId,
      eventType: 'queued',
      executionRequestId: input.id,
      metadata: {
        controlAction: 'retry',
        queuedAt: queuedAt.toISOString(),
        workerAttempt: existing.workerAttempt,
        workerMaxAttempts,
      },
      workspaceId: input.workspaceId,
    });

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(
        `Retried repair execution request not found: ${input.id}`
      );
    }
    return record;
  }

  private async resumeExecutionWithPayload(
    input: {
      workspaceId: string;
      actorId: string;
      id: string;
      executorPayload?: CopilotRepairExecutionExecutorPayload | null;
      reason?: string | null;
    },
    existing: CopilotRepairExecutionRecord
  ): Promise<CopilotRepairExecutionRecord> {
    if (existing.status !== 'failed') {
      throw new Error(
        `Repair execution request cannot resume with payload from status: ${existing.status}`
      );
    }
    if (
      existing.approvalState !== 'approved' &&
      existing.approvalState !== 'not_required'
    ) {
      throw new Error(
        [
          'Repair execution request cannot resume with payload without',
          `executable approval state: ${existing.approvalState}`,
        ].join(' ')
      );
    }
    if (existing.sideEffectCount > 0) {
      throw new Error(
        'Repair execution request cannot replace executor payload after side effects were recorded'
      );
    }
    if (input.executorPayload === undefined || input.executorPayload === null) {
      throw new Error(
        'Repair execution resume with payload requires executor payload'
      );
    }

    const previousExecutorPayloadFingerprint = executorPayloadFingerprint(
      existing.executorPayload
    );
    const nextExecutorPayload = normalizeRepairExecutionExecutorPayload(
      input.executorPayload
    );
    const nextExecutorPayloadFingerprint =
      executorPayloadFingerprint(nextExecutorPayload);
    if (previousExecutorPayloadFingerprint === nextExecutorPayloadFingerprint) {
      throw new Error(
        'Repair execution resume with payload requires a changed executor payload'
      );
    }

    const queuedAt = new Date();
    const workerMaxAttempts =
      existing.workerAttempt >= existing.workerMaxAttempts
        ? existing.workerAttempt + 1
        : existing.workerMaxAttempts;
    const reason = normalizeRepairExecutionControlReason(input.reason);
    const result = manualControlRuntimeResult({
      action: 'resume_with_payload',
      executorPayloadFingerprint: nextExecutorPayloadFingerprint,
      reason,
    });

    await this.createAuditEvent({
      actorId: input.actorId,
      eventType: 'manual_resume_requested',
      executionRequestId: input.id,
      metadata: {
        controlAction: 'resume_with_payload',
        previousStatus: existing.status,
        previousFailureCode: existing.failureCode,
        previousFailureMessage: existing.failureMessage,
        previousExecutorPayloadFingerprint,
        correctedExecutorPayloadFingerprint: nextExecutorPayloadFingerprint,
        reason,
        workerAttempt: existing.workerAttempt,
        workerMaxAttempts: existing.workerMaxAttempts,
        nextWorkerMaxAttempts: workerMaxAttempts,
      },
      workspaceId: input.workspaceId,
    });

    const resumedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_repair_execution_requests
      SET
        status = ${'queued'},
        runtime_result = ${toJsonString(result)}::jsonb,
        executor_payload = ${toJsonString(nextExecutorPayload)}::jsonb,
        failure_code = ${null},
        failure_message = ${null},
        queued_at = ${queuedAt},
        worker_lease_id = ${null},
        worker_lease_expires_at = ${null},
        worker_max_attempts = ${workerMaxAttempts},
        completed_at = ${null},
        updated_at = ${queuedAt}
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND actor_id = ${existing.actorId}
        AND prompt_name = ${existing.promptName}
        AND requested_action = ${existing.requestedAction}
        AND status = ${'failed'}
        AND approval_state = ${existing.approvalState}
        AND permission_status = ${existing.permissionStatus}
        AND idempotency_key = ${existing.idempotencyKey}
        AND idempotency_fingerprint = ${existing.idempotencyFingerprint}
        AND request_fingerprint = ${existing.requestFingerprint}
        AND candidate_evidence_set_fingerprint = ${
          existing.candidateEvidenceSetFingerprint
        }
        AND task_route_evidence_set_fingerprint = ${
          existing.taskRouteEvidenceSetFingerprint
        }
        AND target_locator_fingerprint = ${existing.targetLocatorFingerprint}
        AND repair_job_fingerprint = ${existing.repairJobFingerprint}
        AND approval_record_fingerprint = ${existing.approvalRecordFingerprint}
        AND audit_event_fingerprint = ${existing.auditEventFingerprint}
        AND runtime_result = ${toJsonString(existing.runtimeResult)}::jsonb
        AND executor_payload = ${toJsonString(existing.executorPayload)}::jsonb
        AND failure_code IS NOT DISTINCT FROM ${existing.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${existing.failureMessage}
        AND queued_at IS NOT DISTINCT FROM ${existing.queuedAt}
        AND worker_lease_id IS NOT DISTINCT FROM ${existing.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${existing.workerLeaseExpiresAt}
        AND worker_attempt = ${existing.workerAttempt}
        AND worker_max_attempts = ${existing.workerMaxAttempts}
        AND last_attempt_at IS NOT DISTINCT FROM ${existing.lastAttemptAt}
        AND completed_at IS NOT DISTINCT FROM ${existing.completedAt}
        AND created_at = ${existing.createdAt}
        AND updated_at IS NOT DISTINCT FROM ${existing.updatedAt}
        AND NOT EXISTS (
          SELECT 1
          FROM ai_repair_execution_side_effects side_effect
          WHERE side_effect.execution_request_id =
            ai_repair_execution_requests.id
            AND side_effect.workspace_id =
              ai_repair_execution_requests.workspace_id
        )
      RETURNING id
    `;
    if (!resumedRows.length) {
      throw new Error(
        `Repair execution request could not resume with payload because its state changed: ${input.id}`
      );
    }

    await this.createAuditEvent({
      actorId: input.actorId,
      eventType: 'queued',
      executionRequestId: input.id,
      metadata: {
        controlAction: 'resume_with_payload',
        correctedExecutorPayloadFingerprint: nextExecutorPayloadFingerprint,
        queuedAt: queuedAt.toISOString(),
        workerAttempt: existing.workerAttempt,
        workerMaxAttempts,
      },
      workspaceId: input.workspaceId,
    });

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(
        `Resumed repair execution request not found: ${input.id}`
      );
    }
    return record;
  }

  private async recoverStaleExecution(
    input: {
      workspaceId: string;
      actorId: string;
      id: string;
      reason?: string | null;
      source?: 'manual' | 'system';
    },
    existing: CopilotRepairExecutionRecord
  ): Promise<CopilotRepairExecutionRecord> {
    if (existing.status !== 'running') {
      throw new Error(
        `Repair execution request cannot recover stale lease from status: ${existing.status}`
      );
    }
    if (
      existing.approvalState !== 'approved' &&
      existing.approvalState !== 'not_required'
    ) {
      throw new Error(
        [
          'Repair execution request cannot recover stale lease without',
          `executable approval state: ${existing.approvalState}`,
        ].join(' ')
      );
    }
    const now = new Date();
    if (
      !existing.workerLeaseExpiresAt ||
      existing.workerLeaseExpiresAt.getTime() > now.getTime()
    ) {
      throw new Error('Repair execution worker lease has not expired');
    }

    const retryScheduled = existing.workerAttempt < existing.workerMaxAttempts;
    const reason = normalizeRepairExecutionControlReason(input.reason);
    const status: CopilotRepairExecutionStatus = retryScheduled
      ? 'queued'
      : 'failed';
    const result = manualControlRuntimeResult({
      action: 'recover_stale',
      reason,
      retryScheduled,
      source: input.source,
    });
    const failureCode = retryScheduled ? null : 'stale_worker_lease';
    const failureMessage = retryScheduled
      ? null
      : 'Expired running worker lease recovered with no attempts remaining.';

    const recoveredRows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_repair_execution_requests
      SET
        status = ${status},
        runtime_result = ${toJsonString(result)}::jsonb,
        failure_code = ${failureCode},
        failure_message = ${failureMessage},
        worker_lease_id = ${null},
        worker_lease_expires_at = ${null},
        queued_at = ${retryScheduled ? now : existing.queuedAt},
        completed_at = ${retryScheduled ? null : now},
        updated_at = ${now}
      WHERE workspace_id = ${input.workspaceId}
        AND id = ${input.id}
        AND actor_id = ${existing.actorId}
        AND prompt_name = ${existing.promptName}
        AND requested_action = ${existing.requestedAction}
        AND status = ${'running'}
        AND approval_state = ${existing.approvalState}
        AND permission_status = ${existing.permissionStatus}
        AND idempotency_key = ${existing.idempotencyKey}
        AND idempotency_fingerprint = ${existing.idempotencyFingerprint}
        AND request_fingerprint = ${existing.requestFingerprint}
        AND candidate_evidence_set_fingerprint = ${
          existing.candidateEvidenceSetFingerprint
        }
        AND task_route_evidence_set_fingerprint = ${
          existing.taskRouteEvidenceSetFingerprint
        }
        AND target_locator_fingerprint = ${existing.targetLocatorFingerprint}
        AND repair_job_fingerprint = ${existing.repairJobFingerprint}
        AND approval_record_fingerprint = ${existing.approvalRecordFingerprint}
        AND audit_event_fingerprint = ${existing.auditEventFingerprint}
        AND runtime_result = ${toJsonString(existing.runtimeResult)}::jsonb
        AND executor_payload = ${toJsonString(existing.executorPayload)}::jsonb
        AND failure_code IS NOT DISTINCT FROM ${existing.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${existing.failureMessage}
        AND queued_at IS NOT DISTINCT FROM ${existing.queuedAt}
        AND worker_lease_id IS NOT DISTINCT FROM ${existing.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          existing.workerLeaseExpiresAt
        }
        AND worker_lease_expires_at <= ${now}
        AND worker_attempt = ${existing.workerAttempt}
        AND worker_max_attempts = ${existing.workerMaxAttempts}
        AND last_attempt_at IS NOT DISTINCT FROM ${existing.lastAttemptAt}
        AND completed_at IS NOT DISTINCT FROM ${existing.completedAt}
        AND created_at = ${existing.createdAt}
        AND updated_at IS NOT DISTINCT FROM ${existing.updatedAt}
      RETURNING id
    `;
    if (!recoveredRows.length) {
      throw new Error(
        `Repair execution stale lease could not be recovered because its state changed: ${input.id}`
      );
    }

    await this.createAuditEvent({
      actorId: input.actorId,
      eventType: 'stale_recovered',
      executionRequestId: input.id,
      metadata: {
        controlAction: 'recover_stale',
        recoverySource: input.source ?? 'manual',
        previousStatus: existing.status,
        previousWorkerLeaseId: existing.workerLeaseId,
        previousWorkerLeaseExpiresAt:
          existing.workerLeaseExpiresAt?.toISOString() ?? null,
        reason,
        retryScheduled,
        nextStatus: status,
        workerAttempt: existing.workerAttempt,
        workerMaxAttempts: existing.workerMaxAttempts,
      },
      workspaceId: input.workspaceId,
    });

    if (retryScheduled) {
      await this.createAuditEvent({
        actorId: input.actorId,
        eventType: 'queued',
        executionRequestId: input.id,
        metadata: {
          controlAction: 'recover_stale',
          recoverySource: input.source ?? 'manual',
          queuedAt: now.toISOString(),
          workerAttempt: existing.workerAttempt,
          workerMaxAttempts: existing.workerMaxAttempts,
        },
        workspaceId: input.workspaceId,
      });
    } else {
      await this.createAuditEvent({
        actorId: input.actorId,
        eventType: 'failed',
        executionRequestId: input.id,
        metadata: {
          controlAction: 'recover_stale',
          recoverySource: input.source ?? 'manual',
          failureCode,
          failureMessage,
          retryScheduled,
          workerAttempt: existing.workerAttempt,
          workerMaxAttempts: existing.workerMaxAttempts,
        },
        workspaceId: input.workspaceId,
      });
    }

    const record = await this.get(input.workspaceId, input.id);
    if (!record) {
      throw new Error(
        `Recovered repair execution request not found: ${input.id}`
      );
    }
    return record;
  }

  private async createAuditEvent(input: {
    executionRequestId: string;
    workspaceId: string;
    actorId: string;
    eventType: CopilotRepairExecutionAuditEventType;
    metadata: Record<string, unknown>;
    createdAt?: Date;
  }) {
    const id = randomUUID();
    const createdAt = input.createdAt ?? new Date();
    const metadata = normalizeRepairExecutionAuditMetadata(input.metadata);
    const eventFingerprint = repairExecutionFingerprint({
      version: 'repair-execution-audit-event/v1',
      executionRequestId: input.executionRequestId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      eventType: input.eventType,
      metadata,
    });

    await this.db.$executeRaw`
      INSERT INTO ai_repair_execution_audit_events (
        id,
        execution_request_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata,
        created_at
      )
      VALUES (
        ${id},
        ${input.executionRequestId},
        ${input.workspaceId},
        ${input.actorId},
        ${input.eventType},
        ${eventFingerprint},
        ${toJsonString(metadata)}::jsonb,
        ${createdAt}
      )
    `;
  }
}
