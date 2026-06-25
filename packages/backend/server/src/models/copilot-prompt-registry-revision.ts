import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import type {
  PromptRegistryRevision,
  PromptRegistrySourceChainEntry,
} from '../plugins/copilot/prompt/spec';
import { BaseModel } from './base';
import {
  createRegistryRevisionPublishEvent,
  getRegistryRevisionPublishEventHistory,
  type RegistryRevisionPublishEventHistory,
  withRegistryRevisionPublishEventHistory,
} from './copilot-registry-revision-publish-event';

type PromptRegistryRevisionRow = {
  id: string;
  promptName: string;
  scopeType: PromptRegistryRevision['scopeType'];
  workspaceId: string | null;
  actorId: string | null;
  revision: string;
  status: PromptRegistryRevision['status'];
  fingerprint: string;
  fallbackSourceChain: unknown;
  metadata?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type PromptRegistryRepairExecutorPayload = {
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
  fallbackSourceChain: unknown;
};

type PromptRegistryRevisionConflictEvidence = {
  actorId: string | null;
  fallbackSourceChainFingerprint: string;
  fingerprint: string;
  id: string;
  metadataFingerprint: string;
  promptName: string;
  revision: string;
  scopeType: 'workspace';
  status: 'active';
  workspaceId: string;
};

export type PromptRegistryPublishInput = {
  workspaceId: string;
  actorId: string;
  promptName: string;
  revision?: string | null;
  idempotencyKey?: string | null;
  registryFingerprint: string;
  registryId: number;
  registryUpdatedAt: string;
  gateStatus: string;
  publishStatus: string;
  validationReason: string;
  validationIssueCount: number;
  validationBlockingCount: number;
  validationErrorCount: number;
  modelRouteFingerprints?: string[];
  taskRouteFingerprints?: string[];
  actionRouteDryRunStatus?: string | null;
  repairActionCatalogFingerprint?: string | null;
  repairGateManifestFingerprint?: string | null;
  reviewNote?: string | null;
  fallbackSourceChain?: PromptRegistrySourceChainEntry[];
};

function stablePromptRegistryRevisionStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stablePromptRegistryRevisionStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined
          ? null
          : `${JSON.stringify(key)}:${stablePromptRegistryRevisionStringify(
              item
            )}`;
      })
      .filter(Boolean)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function promptRegistryRevisionFingerprint(value: unknown) {
  return createHash('sha256')
    .update(stablePromptRegistryRevisionStringify(value))
    .digest('hex')
    .slice(0, 16);
}

function toJsonString(value: unknown) {
  return JSON.stringify(value);
}

const PROMPT_REGISTRY_SOURCE_CHAIN_SOURCES = new Set([
  'db_revision',
  'legacy_registry',
  'config_fallback',
  'publish_gate_route_review',
  'direct_publish',
  'repair_execution_request',
]);
const PROMPT_REGISTRY_SOURCE_CHAIN_SCOPES = new Set(['global', 'workspace']);
const PROMPT_REGISTRY_SOURCE_CHAIN_STATUSES = new Set([
  'active',
  'allowed',
  'available',
  'blocked',
  'disabled',
  'prepared_for_approval',
  'ready',
  'reviewed',
  'route_ready',
]);
const SOURCE_CHAIN_MAX_ENTRIES = 16;
const SOURCE_CHAIN_OPTIONAL_STRING_MAX_LENGTH = 512;
const REGISTRY_PAYLOAD_STRING_MAX_LENGTH = 512;
const REGISTRY_METADATA_JSON_MAX_LENGTH = 16 * 1024;
const PROMPT_REGISTRY_PROMPT_NAME_MAX_LENGTH = 32;
const REPAIR_REVISION_PREFIX = 'repair-';

function isSourceChainEntry(
  value: unknown
): value is PromptRegistrySourceChainEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as PromptRegistrySourceChainEntry).source === 'string' &&
    typeof (value as PromptRegistrySourceChainEntry).scope === 'string' &&
    typeof (value as PromptRegistrySourceChainEntry).status === 'string' &&
    PROMPT_REGISTRY_SOURCE_CHAIN_SOURCES.has(
      (value as PromptRegistrySourceChainEntry).source
    ) &&
    PROMPT_REGISTRY_SOURCE_CHAIN_SCOPES.has(
      (value as PromptRegistrySourceChainEntry).scope
    ) &&
    PROMPT_REGISTRY_SOURCE_CHAIN_STATUSES.has(
      (value as PromptRegistrySourceChainEntry).status
    )
  );
}

function normalizeSourceChain(
  value: unknown
): PromptRegistrySourceChainEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isSourceChainEntry)
    .slice(0, SOURCE_CHAIN_MAX_ENTRIES)
    .map(entry => {
      const actorId = sourceChainString(entry.actorId);
      const configPath = sourceChainString(entry.configPath);
      const fingerprint = sourceChainString(entry.fingerprint);
      const registryId = sourceChainInteger(entry.registryId);
      const revision = sourceChainString(entry.revision);
      const updatedAt = sourceChainString(entry.updatedAt);
      const workspaceId = sourceChainString(entry.workspaceId);

      return {
        source: entry.source,
        scope: entry.scope,
        status: entry.status,
        ...(actorId ? { actorId } : {}),
        ...(configPath ? { configPath } : {}),
        ...(fingerprint ? { fingerprint } : {}),
        ...(registryId !== undefined ? { registryId } : {}),
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

function sourceChainInteger(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
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
    throw new Error(`Prompt registry publish requires ${field}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Prompt registry publish requires ${field}`);
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
    throw new Error(`Prompt registry publish contains invalid ${field}`);
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > REGISTRY_PAYLOAD_STRING_MAX_LENGTH) {
    throw new Error(`Prompt registry publish contains invalid ${field}`);
  }
  return normalized;
}

function toRegistryMetadataJsonString(
  metadata: Record<string, unknown>
): string {
  const serialized = toJsonString(metadata);
  if (serialized.length > REGISTRY_METADATA_JSON_MAX_LENGTH) {
    throw new Error('Prompt registry publish metadata is too large');
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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizeRevision(value: unknown): string | undefined {
  const revision = optionalString(value);
  if (!revision) {
    return undefined;
  }
  if (revision.length > REGISTRY_PAYLOAD_STRING_MAX_LENGTH) {
    throw new Error('Prompt registry revision is too long');
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(revision)) {
    throw new Error('Prompt registry revision contains invalid characters');
  }
  return revision;
}

function normalizeReviewNote(value: unknown): string | undefined {
  const note = optionalString(value);
  if (!note) {
    return undefined;
  }
  return note.slice(0, 2048);
}

function normalizeRepairExecutorPayload(
  payload: unknown
): PromptRegistryRepairExecutorPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid repair execution executor payload');
  }

  const record = payload as Record<string, unknown>;
  if (record.kind !== 'prompt_registry_revision_publish') {
    throw new Error('Unsupported repair execution executor payload');
  }
  if (record.version !== 'prompt-registry-revision-executor-payload/v1') {
    throw new Error('Unsupported repair execution executor payload version');
  }

  const expectedRegistryId = record.expectedRegistryId;
  if (typeof expectedRegistryId !== 'number') {
    throw new Error(
      'Invalid repair execution executor payload field: expectedRegistryId'
    );
  }

  return {
    version: 'prompt-registry-revision-executor-payload/v1',
    kind: 'prompt_registry_revision_publish',
    expectedRegistryFingerprint: requireStringField(
      record,
      'expectedRegistryFingerprint'
    ),
    expectedRegistryId,
    expectedRegistryUpdatedAt: requireStringField(
      record,
      'expectedRegistryUpdatedAt'
    ),
    operationFingerprints: stringsFromUnknown(record.operationFingerprints),
    operationKinds: stringsFromUnknown(record.operationKinds),
    operationSetFingerprint: requireStringField(
      record,
      'operationSetFingerprint'
    ),
    previewFingerprint: requireStringField(record, 'previewFingerprint'),
    catalogFingerprint: requireStringField(record, 'catalogFingerprint'),
    fallbackSourceChain: record.fallbackSourceChain,
  };
}

function toRevision(row: PromptRegistryRevisionRow): PromptRegistryRevision {
  return {
    id: row.id,
    promptName: row.promptName,
    scopeType: row.scopeType,
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    ...(row.actorId ? { actorId: row.actorId } : {}),
    revision: row.revision,
    status: row.status,
    fingerprint: row.fingerprint,
    fallbackSourceChain: normalizeSourceChain(row.fallbackSourceChain),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function promptRegistryRevisionJsonFingerprint(
  version: string,
  value: unknown
) {
  return promptRegistryRevisionFingerprint({ version, value });
}

function assertPromptRegistryRevisionMatchesConflictEvidence(
  revision: PromptRegistryRevision,
  row: PromptRegistryRevisionRow,
  expected: PromptRegistryRevisionConflictEvidence
) {
  const fallbackSourceChainFingerprint = promptRegistryRevisionJsonFingerprint(
    'prompt-registry-revision-fallback-source-chain-conflict-evidence/v1',
    revision.fallbackSourceChain
  );
  const metadataFingerprint = promptRegistryRevisionJsonFingerprint(
    'prompt-registry-revision-metadata-conflict-evidence/v1',
    row.metadata ?? {}
  );

  if (
    revision.id !== expected.id ||
    revision.promptName !== expected.promptName ||
    revision.scopeType !== expected.scopeType ||
    revision.workspaceId !== expected.workspaceId ||
    revision.actorId !== expected.actorId ||
    revision.revision !== expected.revision ||
    revision.status !== expected.status ||
    revision.fingerprint !== expected.fingerprint ||
    fallbackSourceChainFingerprint !==
      expected.fallbackSourceChainFingerprint ||
    metadataFingerprint !== expected.metadataFingerprint
  ) {
    throw new Error(
      'Prompt registry revision conflict reused mismatched row evidence'
    );
  }
}

@Injectable()
export class CopilotPromptRegistryRevisionModel extends BaseModel {
  @Transactional()
  async publishWorkspaceRevision(
    input: PromptRegistryPublishInput
  ): Promise<PromptRegistryRevision & RegistryRevisionPublishEventHistory> {
    const workspaceId = requirePublishString(input.workspaceId, 'workspaceId');
    const actorId = requirePublishString(input.actorId, 'actorId');
    const promptName = requirePublishString(
      input.promptName,
      'promptName',
      PROMPT_REGISTRY_PROMPT_NAME_MAX_LENGTH
    );
    const registryFingerprint = requirePublishString(
      input.registryFingerprint,
      'registryFingerprint'
    );
    if (
      !Number.isInteger(input.registryId) ||
      input.registryId < 0 ||
      input.registryId > Number.MAX_SAFE_INTEGER
    ) {
      throw new Error('Prompt registry publish requires registryId');
    }
    const registryUpdatedAt = requirePublishString(
      input.registryUpdatedAt,
      'registryUpdatedAt'
    );
    const gateStatus = requirePublishString(input.gateStatus, 'gateStatus');
    const publishStatus = requirePublishString(
      input.publishStatus,
      'publishStatus'
    );
    const validationReason = requirePublishString(
      input.validationReason,
      'validationReason'
    );
    const actionRouteDryRunStatus = optionalPublishString(
      input.actionRouteDryRunStatus,
      'actionRouteDryRunStatus'
    );
    const repairActionCatalogFingerprint = optionalPublishString(
      input.repairActionCatalogFingerprint,
      'repairActionCatalogFingerprint'
    );
    const repairGateManifestFingerprint = optionalPublishString(
      input.repairGateManifestFingerprint,
      'repairGateManifestFingerprint'
    );
    const idempotencyKey = optionalPublishString(
      input.idempotencyKey,
      'idempotencyKey'
    );

    const fallbackSourceChain = normalizeSourceChain(
      input.fallbackSourceChain ?? []
    );
    const modelRouteFingerprints = stringsFromUnknown(
      input.modelRouteFingerprints
    ).sort();
    const taskRouteFingerprints = stringsFromUnknown(
      input.taskRouteFingerprints
    ).sort();
    const reviewNote = normalizeReviewNote(input.reviewNote);
    const reviewFingerprint = promptRegistryRevisionFingerprint({
      version: 'prompt-registry-direct-publish-review/v1',
      promptName,
      registryFingerprint,
      registryId: input.registryId,
      registryUpdatedAt,
      gateStatus,
      publishStatus,
      validationReason,
      validationIssueCount: input.validationIssueCount,
      validationBlockingCount: input.validationBlockingCount,
      validationErrorCount: input.validationErrorCount,
      modelRouteFingerprints,
      taskRouteFingerprints,
      actionRouteDryRunStatus: actionRouteDryRunStatus ?? null,
      repairActionCatalogFingerprint: repairActionCatalogFingerprint ?? null,
      repairGateManifestFingerprint: repairGateManifestFingerprint ?? null,
      fallbackSourceChain,
      reviewNote: reviewNote ?? null,
    });
    const revision =
      sanitizeRevision(input.revision) ??
      `manual-${promptRegistryRevisionFingerprint({
        version: 'prompt-registry-revision-id/v1',
        workspaceId,
        promptName,
        idempotencyKey: idempotencyKey ?? null,
        reviewFingerprint,
      })}`;
    const fingerprint = promptRegistryRevisionFingerprint({
      version: 'prompt-registry-revision-publish/v1',
      promptName,
      scopeType: 'workspace',
      workspaceId,
      actorId,
      revision,
      registryFingerprint,
      registryId: input.registryId,
      registryUpdatedAt,
      gateStatus,
      publishStatus,
      validationReason,
      modelRouteFingerprints,
      taskRouteFingerprints,
      fallbackSourceChain,
      reviewFingerprint,
    });
    const id = `prompt-registry-revision-${promptRegistryRevisionFingerprint({
      version: 'prompt-registry-revision-row-id/v1',
      workspaceId,
      promptName,
      revision,
    })}`;
    const metadata = {
      version: 'prompt-registry-revision-direct-publish/v1',
      publishSource: 'graphql_mutation',
      promptBodyBoundary: 'legacy_registry_row_reviewed_no_body_copy',
      registryFingerprint,
      registryId: input.registryId,
      registryUpdatedAt,
      gateStatus,
      publishStatus,
      validationReason,
      validationIssueCount: input.validationIssueCount,
      validationBlockingCount: input.validationBlockingCount,
      validationErrorCount: input.validationErrorCount,
      modelRouteFingerprints,
      taskRouteFingerprints,
      actionRouteDryRunStatus: actionRouteDryRunStatus ?? null,
      repairActionCatalogFingerprint: repairActionCatalogFingerprint ?? null,
      repairGateManifestFingerprint: repairGateManifestFingerprint ?? null,
      reviewFingerprint,
      ...(reviewNote ? { reviewNote } : {}),
      ...(idempotencyKey
        ? {
            idempotencyKeyFingerprint: promptRegistryRevisionFingerprint({
              version: 'prompt-registry-publish-idempotency-key/v1',
              workspaceId,
              promptName,
              idempotencyKey,
            }),
          }
        : {}),
    };
    const expectedConflictEvidence: PromptRegistryRevisionConflictEvidence = {
      actorId,
      fallbackSourceChainFingerprint: promptRegistryRevisionJsonFingerprint(
        'prompt-registry-revision-fallback-source-chain-conflict-evidence/v1',
        fallbackSourceChain
      ),
      fingerprint,
      id,
      metadataFingerprint: promptRegistryRevisionJsonFingerprint(
        'prompt-registry-revision-metadata-conflict-evidence/v1',
        metadata
      ),
      promptName,
      revision,
      scopeType: 'workspace',
      status: 'active',
      workspaceId,
    };
    const existingRow = await this.getWorkspaceRevisionRow({
      promptName,
      revision,
      workspaceId,
    });
    if (existingRow) {
      const existing = toRevision(existingRow);
      assertPromptRegistryRevisionMatchesConflictEvidence(
        existing,
        existingRow,
        expectedConflictEvidence
      );
      await createRegistryRevisionPublishEvent(this.db, {
        actorId,
        eventType: 'revision_reused',
        metadata: {
          promptName,
          reviewFingerprint,
        },
        publishSource: 'graphql_mutation',
        registryFamily: 'prompt_registry',
        registryKey: promptName,
        revision: existing.revision,
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
      INSERT INTO ai_prompt_registry_revisions (
        id,
        prompt_name,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${promptName},
        ${'workspace'},
        ${workspaceId},
        ${actorId},
        ${revision},
        ${'active'},
        ${fingerprint},
        ${toJsonString(fallbackSourceChain)}::jsonb,
        ${metadataJson}::jsonb,
        ${now},
        ${now}
      )
      ON CONFLICT ("prompt_name", "workspace_id", "revision")
      WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    const createdRow = await this.getWorkspaceRevisionRow({
      promptName,
      revision,
      workspaceId,
    });
    const created = createdRow ? toRevision(createdRow) : null;
    if (!created) {
      throw new Error(`Created prompt registry revision not found: ${id}`);
    }
    if (!createdRow) {
      throw new Error(`Created prompt registry revision row not found: ${id}`);
    }
    assertPromptRegistryRevisionMatchesConflictEvidence(
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
        promptName,
        reviewFingerprint,
      },
      publishSource: 'graphql_mutation',
      registryFamily: 'prompt_registry',
      registryKey: promptName,
      revision: created.revision,
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
    promptName: string;
    executionRequestId: string;
    requestFingerprint: string;
    candidateEvidenceSetFingerprint: string;
    taskRouteEvidenceSetFingerprint: string;
    repairJobFingerprint: string;
    approvalRecordFingerprint: string;
    payload: unknown;
  }): Promise<PromptRegistryRevision & RegistryRevisionPublishEventHistory> {
    const payload = normalizeRepairExecutorPayload(input.payload);
    const workspaceId = requirePublishString(input.workspaceId, 'workspaceId');
    const actorId = requirePublishString(input.actorId, 'actorId');
    const promptName = requirePublishString(
      input.promptName,
      'promptName',
      PROMPT_REGISTRY_PROMPT_NAME_MAX_LENGTH
    );
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
    const fingerprint = promptRegistryRevisionFingerprint({
      version: 'prompt-registry-revision-publish/v1',
      promptName,
      scopeType: 'workspace',
      workspaceId,
      actorId,
      revision,
      requestFingerprint,
      candidateEvidenceSetFingerprint,
      taskRouteEvidenceSetFingerprint,
      repairJobFingerprint,
      approvalRecordFingerprint,
      expectedRegistryFingerprint: payload.expectedRegistryFingerprint,
      expectedRegistryId: payload.expectedRegistryId,
      expectedRegistryUpdatedAt: payload.expectedRegistryUpdatedAt,
      operationFingerprints: payload.operationFingerprints,
      operationKinds: payload.operationKinds,
      operationSetFingerprint: payload.operationSetFingerprint,
      previewFingerprint: payload.previewFingerprint,
      catalogFingerprint: payload.catalogFingerprint,
      fallbackSourceChain,
    });
    const id = `prompt-revision-${executionRequestId}`;
    const metadata = {
      version: 'prompt-registry-revision-repair-executor/v1',
      publishSource: 'repair_execution_worker',
      executionRequestId,
      requestFingerprint,
      candidateEvidenceSetFingerprint,
      taskRouteEvidenceSetFingerprint,
      repairJobFingerprint,
      approvalRecordFingerprint,
      expectedRegistryFingerprint: payload.expectedRegistryFingerprint,
      expectedRegistryId: payload.expectedRegistryId,
      expectedRegistryUpdatedAt: payload.expectedRegistryUpdatedAt,
      operationFingerprints: payload.operationFingerprints,
      operationKinds: payload.operationKinds,
      operationSetFingerprint: payload.operationSetFingerprint,
      previewFingerprint: payload.previewFingerprint,
      catalogFingerprint: payload.catalogFingerprint,
    };
    const expectedConflictEvidence: PromptRegistryRevisionConflictEvidence = {
      actorId,
      fallbackSourceChainFingerprint: promptRegistryRevisionJsonFingerprint(
        'prompt-registry-revision-fallback-source-chain-conflict-evidence/v1',
        fallbackSourceChain
      ),
      fingerprint,
      id,
      metadataFingerprint: promptRegistryRevisionJsonFingerprint(
        'prompt-registry-revision-metadata-conflict-evidence/v1',
        metadata
      ),
      promptName,
      revision,
      scopeType: 'workspace',
      status: 'active',
      workspaceId,
    };
    const existingRow = await this.getWorkspaceRevisionRow({
      promptName,
      revision,
      workspaceId,
    });
    if (existingRow) {
      const existing = toRevision(existingRow);
      assertPromptRegistryRevisionMatchesConflictEvidence(
        existing,
        existingRow,
        expectedConflictEvidence
      );
      await createRegistryRevisionPublishEvent(this.db, {
        actorId,
        eventType: 'revision_reused',
        metadata: {
          executionRequestId,
          promptName,
          repairJobFingerprint,
        },
        publishSource: 'repair_execution_worker',
        registryFamily: 'prompt_registry',
        registryKey: promptName,
        revision: existing.revision,
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
      INSERT INTO ai_prompt_registry_revisions (
        id,
        prompt_name,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${promptName},
        ${'workspace'},
        ${workspaceId},
        ${actorId},
        ${revision},
        ${'active'},
        ${fingerprint},
        ${toJsonString(fallbackSourceChain)}::jsonb,
        ${metadataJson}::jsonb,
        ${now},
        ${now}
      )
      ON CONFLICT ("prompt_name", "workspace_id", "revision")
      WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    const createdRow = await this.getWorkspaceRevisionRow({
      promptName,
      revision,
      workspaceId,
    });
    const created = createdRow ? toRevision(createdRow) : null;
    if (!created) {
      throw new Error(`Created prompt registry revision not found: ${id}`);
    }
    if (!createdRow) {
      throw new Error(`Created prompt registry revision row not found: ${id}`);
    }
    assertPromptRegistryRevisionMatchesConflictEvidence(
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
        promptName,
        repairJobFingerprint,
      },
      publishSource: 'repair_execution_worker',
      registryFamily: 'prompt_registry',
      registryKey: promptName,
      revision: created.revision,
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

  async listLatestActiveByPromptNames(input: {
    names: string[];
    workspaceId?: string | null;
  }): Promise<Map<string, PromptRegistryRevision>> {
    const names = [...new Set(input.names)].filter(Boolean);
    if (!names.length) {
      return new Map();
    }

    const rows = input.workspaceId
      ? await this.db.$queryRaw<PromptRegistryRevisionRow[]>`
          SELECT DISTINCT ON (prompt_name)
            id,
            prompt_name AS "promptName",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            revision,
            status,
            fingerprint,
            fallback_source_chain AS "fallbackSourceChain",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_prompt_registry_revisions
          WHERE prompt_name = ANY(${names})
            AND status = 'active'
            AND (
              (scope_type = 'workspace' AND workspace_id = ${input.workspaceId})
              OR (scope_type = 'global' AND workspace_id IS NULL)
            )
          ORDER BY
            prompt_name ASC,
            CASE WHEN scope_type = 'workspace' THEN 0 ELSE 1 END ASC,
            created_at DESC,
            id DESC
        `
      : await this.db.$queryRaw<PromptRegistryRevisionRow[]>`
          SELECT DISTINCT ON (prompt_name)
            id,
            prompt_name AS "promptName",
            scope_type AS "scopeType",
            workspace_id AS "workspaceId",
            actor_id AS "actorId",
            revision,
            status,
            fingerprint,
            fallback_source_chain AS "fallbackSourceChain",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM ai_prompt_registry_revisions
          WHERE prompt_name = ANY(${names})
            AND status = 'active'
            AND scope_type = 'global'
            AND workspace_id IS NULL
          ORDER BY prompt_name ASC, created_at DESC, id DESC
        `;

    return new Map(rows.map(row => [row.promptName, toRevision(row)]));
  }

  async listLatestActiveWithPublishEventsByPromptNames(input: {
    names: string[];
    workspaceId?: string | null;
  }): Promise<
    Map<string, PromptRegistryRevision & RegistryRevisionPublishEventHistory>
  > {
    const revisions = await this.listLatestActiveByPromptNames(input);
    const entries = await Promise.all(
      [...revisions.entries()].map(async ([name, revision]) => {
        const history = await getRegistryRevisionPublishEventHistory(
          this.db,
          revision.id
        );
        return [
          name,
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
    promptName: string;
    revision: string;
    workspaceId: string;
  }) {
    const row = await this.getWorkspaceRevisionRow(input);
    return row ? toRevision(row) : null;
  }

  private async getWorkspaceRevisionRow(input: {
    promptName: string;
    revision: string;
    workspaceId: string;
  }) {
    const rows = await this.db.$queryRaw<PromptRegistryRevisionRow[]>`
      SELECT
        id,
        prompt_name AS "promptName",
        scope_type AS "scopeType",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        revision,
        status,
        fingerprint,
        fallback_source_chain AS "fallbackSourceChain",
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_prompt_registry_revisions
      WHERE prompt_name = ${input.promptName}
        AND scope_type = 'workspace'
        AND workspace_id = ${input.workspaceId}
        AND revision = ${input.revision}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }
}
