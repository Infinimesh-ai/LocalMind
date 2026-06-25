import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import {
  Config,
  readableToBuffer,
  type StorageProvider,
  StorageProviderFactory,
} from '../base';
import type { PromptCatalogItem } from '../plugins/copilot/prompt/spec';
import { BaseModel } from './base';

export type CopilotSupportBundleStatus =
  | 'pending'
  | 'ready'
  | 'failed'
  | 'expired';

export type CopilotSupportBundleRetentionStatus =
  | 'active'
  | 'expired'
  | 'deleted';

export type CopilotSupportBundleListFilter = {
  query?: string | null;
  retentionStatus?: CopilotSupportBundleRetentionStatus | null;
  status?: CopilotSupportBundleStatus | null;
  transferForwardingStatus?: CopilotSupportBundleTransferForwardingEventStatus | null;
};

export type CopilotSupportBundleAuditEventType =
  | 'created'
  | 'read'
  | 'archive_created'
  | 'download_authorized'
  | 'downloaded'
  | 'retention_expired';

export type CopilotSupportBundleDownloadAuthorizationStatus =
  | 'authorized'
  | 'downloaded'
  | 'expired'
  | 'revoked';

export type CopilotSupportBundleDownloadArtifactKind =
  | 'manifest_json'
  | 'archive_json';

export type CopilotSupportBundleDownloadDeliveryMethod =
  | 'api_proxy'
  | 'object_storage_signed_url';

export type CopilotSupportBundleSourceEvidenceSummary = {
  source: string;
  promptCatalogItemCount: number;
  actionRunCount: number;
  taskRouteCount: number;
  includedSections: string[];
};

type CopilotSupportBundlePromptCatalogSnapshotItem = Pick<
  PromptCatalogItem,
  | 'category'
  | 'fingerprint'
  | 'modelSource'
  | 'name'
  | 'overrideApplied'
  | 'registryRecordSource'
  | 'registryRevision'
  | 'registryRevisionFingerprint'
  | 'registryRevisionScope'
  | 'registrySourceChainFingerprint'
  | 'revision'
  | 'source'
  | 'templateFingerprint'
> & {
  action?: string;
  defaultPolicy?: PromptCatalogItem['defaultPolicy'];
  model: string;
  optionalModelCount: number;
  paramCount: number;
};

type CopilotSupportBundlePromptCatalogSnapshot = {
  version: 'copilot-support-bundle-prompt-catalog-snapshot/v1';
  itemCount: number;
  items: CopilotSupportBundlePromptCatalogSnapshotItem[];
  fingerprint: string;
};

type CopilotSupportBundleActionRunSnapshot = {
  id: string;
  actionId: string;
  actionVersion: string;
  status: string;
  attempt: number;
  retryOf: string | null;
  docId: string | null;
  sessionId: string | null;
  errorCode: string | null;
  resultSummary: string | null;
  traceFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
};

type CopilotSupportBundleActionRunSnapshotSet = {
  version: 'copilot-support-bundle-action-run-snapshot/v1';
  workspaceId: string;
  actorId: string;
  limit: number;
  runCount: number;
  runs: CopilotSupportBundleActionRunSnapshot[];
  fingerprint: string;
};

type CopilotSupportBundleArchiveObjectCleanupResult = {
  archiveStorageKey: string | null;
  status: 'deleted' | 'missing' | 'failed';
  errorCode?: string;
  errorMessage?: string;
};

type CopilotSupportBundleManifestObjectRewriteResult = {
  manifestStorageKey: string | null;
  status: 'written' | 'missing' | 'failed';
  errorCode?: string;
  errorMessage?: string;
};

export type CopilotSupportBundleTaskRouteSnapshot = {
  featureKind: string;
  configured: boolean;
  routePolicyEnabled: boolean;
  routePolicyWorkspaceId?: string;
  requestedModelId?: string;
  requestedModelSource?: string;
  fallbackProviderIds: string[];
  preparedProviderCount: number;
  providerId?: string;
  providerProfileId?: string;
  modelId?: string;
  protocol?: string;
  requestLayer?: string;
  modelBackendKind?: string;
  canonicalModelKey?: string;
  behaviorFlags?: string[];
  errorCode?: string;
  errorMessage?: string;
  diagnosticsFingerprint?: string;
  taskRouteEffectiveSourceFingerprint?: string;
};

type CopilotSupportBundleTaskRouteSnapshotSet = {
  version: 'copilot-support-bundle-task-route-snapshot/v1';
  workspaceId: string;
  routeCount: number;
  routes: CopilotSupportBundleTaskRouteSnapshot[];
  fingerprint: string;
};

export type CopilotSupportBundleArchiveFile = {
  path: string;
  mediaType: 'application/json';
  fingerprint: string;
  byteSize: number;
  content: unknown;
};

export type CopilotSupportBundleArchiveEntry = {
  path: string;
  mediaType: 'application/json';
  fingerprint: string;
  byteSize: number;
  section: string;
};

export type CopilotSupportBundleArchive = {
  version: 'localmind-support-bundle-archive/v1';
  bundleId: string;
  workspaceId: string;
  actorId: string;
  createdAt: string;
  expiresAt: string;
  archiveIndexFingerprint: string;
  fileCount: number;
  files: CopilotSupportBundleArchiveEntry[];
  embedded: Record<string, CopilotSupportBundleArchiveFile>;
};

export type CopilotSupportBundleManifest = {
  version: string;
  bundleId: string;
  workspaceId: string;
  actorId: string;
  createdAt: string;
  expiresAt: string;
  sourceEvidenceSummary: CopilotSupportBundleSourceEvidenceSummary;
  sourceEvidenceSetFingerprint: string;
  archive: {
    artifactKind: 'archive_json';
    filename: string;
    mime: string;
    storageKey: string;
    byteSize: number;
    archiveFingerprint: string;
  };
  retention: {
    status: CopilotSupportBundleRetentionStatus;
    expiresAt: string;
  };
};

export type CopilotSupportBundleRecord = {
  id: string;
  workspaceId: string;
  actorId: string;
  status: CopilotSupportBundleStatus;
  sourceEvidenceSummary: CopilotSupportBundleSourceEvidenceSummary;
  sourceEvidenceSetFingerprint: string;
  manifestFingerprint: string;
  manifestJson: CopilotSupportBundleManifest;
  manifestStorageKey: string | null;
  manifestByteSize: number | null;
  manifestMime: string | null;
  manifestFilename: string | null;
  archiveStorageKey: string | null;
  archiveByteSize: number | null;
  archiveFingerprint: string | null;
  archiveMime: string | null;
  archiveFilename: string | null;
  retentionStatus: CopilotSupportBundleRetentionStatus;
  expiresAt: Date;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  auditEventCount: number;
  auditEvents: CopilotSupportBundleAuditEventRecord[];
  transferEventCount: number;
  transferEvents: CopilotSupportBundleTransferEventRecord[];
  transferForwardingEventCount: number;
  transferForwardingEvents: CopilotSupportBundleTransferForwardingEventRecord[];
};

export type CopilotSupportBundleAuditEventRecord = {
  id: string;
  bundleId: string;
  workspaceId: string;
  actorId: string;
  eventType: CopilotSupportBundleAuditEventType;
  eventFingerprint: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type CopilotSupportBundleTransferEventRecord = {
  id: string;
  authorizationId: string;
  artifactKind: CopilotSupportBundleDownloadArtifactKind;
  manifestFingerprint: string;
  artifactFingerprint: string;
  authorizationFingerprint: string;
  deliveryMethod: CopilotSupportBundleDownloadDeliveryMethod;
  eventId: string | null;
  eventSource: string;
  transferredAt: Date;
  notificationAuthEvidenceFingerprint: string;
  storageKey: string;
  storageByteSize: number;
  storageContentType: string;
  eventFingerprint: string;
  createdAt: Date;
};

export type CopilotSupportBundleDownloadAuthorization = {
  id: string;
  bundleId: string;
  workspaceId: string;
  actorId: string;
  status: CopilotSupportBundleDownloadAuthorizationStatus;
  artifactKind: CopilotSupportBundleDownloadArtifactKind;
  artifactFilename: string;
  artifactMime: string;
  manifestFingerprint: string;
  artifactFingerprint: string;
  authorizationFingerprint: string;
  tokenFingerprint: string;
  deliveryMethod: CopilotSupportBundleDownloadDeliveryMethod;
  directDownloadUrl: string | null;
  directDownloadExpiresAt: Date | null;
  expiresAt: Date;
  downloadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CopilotSupportBundleDownloadAuthorizationResult =
  CopilotSupportBundleDownloadAuthorization & {
    downloadToken: string;
  };

export type CopilotSupportBundleDownloadArtifact =
  CopilotSupportBundleDownloadAuthorization & {
    body: Buffer;
  };

export type CopilotSupportBundleRetentionCleanupResult = {
  workspaceId: string;
  actorId: string;
  cleanedAt: Date;
  cleanupFingerprint: string;
  expiredBundleCount: number;
  expiredAuthorizationCount: number;
  archiveObjectCleanupRetryCount: number;
  archiveObjectCleanupRecoveredCount: number;
  archiveObjectCleanupFailedCount: number;
  manifestObjectRewriteRetryCount: number;
  manifestObjectRewriteRecoveredCount: number;
  manifestObjectRewriteFailedCount: number;
  expiredBundles: CopilotSupportBundleRecord[];
};

export type CopilotSupportBundleScheduledRetentionCleanupResult = {
  actorId: string;
  cleanedAt: Date;
  cleanupFingerprint: string;
  expiredBundleCount: number;
  expiredAuthorizationCount: number;
  archiveObjectCleanupRetryCount: number;
  archiveObjectCleanupRecoveredCount: number;
  archiveObjectCleanupFailedCount: number;
  manifestObjectRewriteRetryCount: number;
  manifestObjectRewriteRecoveredCount: number;
  manifestObjectRewriteFailedCount: number;
  expiredBundles: CopilotSupportBundleRecord[];
};

export type CopilotSupportBundleDownloadAuthorizationCleanupResult = {
  cleanedAt: Date;
  cleanupFingerprint: string;
  expiredAuthorizationCount: number;
  expiredAuthorizationIds: string[];
};

export type CopilotSupportBundleTransferProviderSignatureEvidence = {
  provider: 'aws_s3' | 'cloudflare_r2' | 's3_compatible';
  status: 'verified_by_upstream';
  verifier: string;
  keyId?: string;
  algorithm?: string;
  signatureFingerprint: string;
  policy: string;
};

export type CopilotSupportBundleTransferNotificationAuthEvidence = {
  policy: 'internal_access_token';
  status: 'verified';
  method: 'x-access-token';
  providerSignatureEvidence?: CopilotSupportBundleTransferProviderSignatureEvidence;
};

export type CopilotSupportBundleDirectDownloadTransferEvent = {
  authorizationId: string;
  eventId?: string;
  eventSource?: string;
  storageKey?: string;
  notificationAuthEvidence?: CopilotSupportBundleTransferNotificationAuthEvidence;
  artifactByteSize?: number;
  artifactFingerprint?: string;
  transferredAt?: Date;
};

export type CopilotSupportBundleTransferForwardingEventStatus =
  | 'queued'
  | 'processing'
  | 'retry_scheduled'
  | 'forwarded'
  | 'dead_lettered';

export type CopilotSupportBundleTransferForwardingEventRecord = {
  id: string;
  authorizationId: string;
  status: CopilotSupportBundleTransferForwardingEventStatus;
  eventId: string | null;
  eventSource: string;
  forwardingEventFingerprint: string;
  forwardingPayload: Record<string, unknown>;
  forwardingPayloadFingerprint: string;
  providerSignatureEvidenceFingerprint: string | null;
  forwardedTransferEventFingerprint: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  workerLeaseId: string | null;
  workerLeaseExpiresAt: Date | null;
  lastAttemptAt: Date | null;
  forwardedAt: Date | null;
  deadLetteredAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CopilotSupportBundleTransferForwardingEventProcessingResult = {
  processedAt: Date;
  processedCount: number;
  forwardedCount: number;
  retryScheduledCount: number;
  deadLetteredCount: number;
  failedCount: number;
  eventIds: string[];
};

type CopilotSupportBundleVerifiedDirectDownloadTransferEvent = {
  eventId: string | null;
  eventSource: string;
  transferredAt: Date;
  notificationAuthEvidence: CopilotSupportBundleTransferNotificationAuthEvidence;
  notificationAuthEvidenceFingerprint: string;
  storageKey: string;
  storageByteSize: number;
  storageContentType: string;
  eventFingerprint: string;
};

type DirectDownloadTransferEventConflictEvidence = {
  artifactFingerprint: string;
  artifactKind: CopilotSupportBundleDownloadArtifactKind;
  authorizationFingerprint: string;
  authorizationId: string;
  deliveryMethod: CopilotSupportBundleDownloadDeliveryMethod;
  eventFingerprint: string;
  eventId: string | null;
  eventSource: string;
  manifestFingerprint: string;
  notificationAuthEvidenceFingerprint: string;
  storageByteSize: number;
  storageContentType: string;
  storageKey: string;
  transferredAt: Date;
};

type DirectDownloadTransferForwardingEventConflictEvidence = {
  authorizationId: string;
  eventId: string | null;
  eventSource: string;
  forwardingEventFingerprint: string;
  forwardingPayloadFingerprint: string;
  providerSignatureEvidenceFingerprint: string | null;
};

type CopilotSupportBundleArchiveObjectCleanupRetryCandidate =
  CopilotSupportBundleRecord & {
    archiveObjectCleanupFailureCount: number;
    previousArchiveObjectCleanupAuditActorId: string;
    previousArchiveObjectCleanupAuditCreatedAt: Date;
    previousArchiveObjectCleanupAuditEventFingerprint: string;
    previousArchiveObjectCleanupAuditId: string;
    previousArchiveObjectCleanupAuditMetadata: Record<string, unknown>;
    previousArchiveObjectCleanupErrorCode: string | null;
    previousArchiveObjectCleanupErrorMessage: string | null;
    previousArchiveObjectCleanupFingerprint: string | null;
  };

type CopilotSupportBundleManifestObjectRewriteRetryCandidate =
  CopilotSupportBundleRecord & {
    manifestObjectRewriteFailureCount: number;
    previousManifestObjectRewriteAuditActorId: string;
    previousManifestObjectRewriteAuditCreatedAt: Date;
    previousManifestObjectRewriteAuditEventFingerprint: string;
    previousManifestObjectRewriteAuditId: string;
    previousManifestObjectRewriteAuditMetadata: Record<string, unknown>;
    previousManifestObjectRewriteErrorCode: string | null;
    previousManifestObjectRewriteErrorMessage: string | null;
    previousManifestObjectRewriteFingerprint: string | null;
  };

const SCHEDULED_ARCHIVE_OBJECT_CLEANUP_FAILURE_ESCALATION_THRESHOLD = 2;
const SCHEDULED_ARCHIVE_OBJECT_CLEANUP_ESCALATION_REASON =
  'scheduled_retry_limit_exceeded';
const SCHEDULED_MANIFEST_OBJECT_REWRITE_FAILURE_ESCALATION_THRESHOLD = 2;
const SCHEDULED_MANIFEST_OBJECT_REWRITE_ESCALATION_REASON =
  'scheduled_retry_limit_exceeded';
const SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_STRING_LENGTH = 512;
const SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_SHORT_STRING_LENGTH = 128;
const SUPPORT_BUNDLE_TRANSFER_NOTIFICATION_AUTH_EVIDENCE_VERSION =
  'copilot-support-bundle-transfer-notification-auth-evidence/v1';
const SUPPORT_BUNDLE_DIRECT_DOWNLOAD_TRANSFER_EVENT_VERSION =
  'copilot-support-bundle-direct-download-transfer-event/v1';
const SUPPORT_BUNDLE_TRANSFER_FORWARDING_EVENT_VERSION =
  'copilot-support-bundle-transfer-forwarding-event/v1';
const SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_VERSION =
  'copilot-support-bundle-transfer-forwarding-payload/v1';
const SUPPORT_BUNDLE_TRANSFER_FORWARDING_REPLAY_VERSION =
  'copilot-support-bundle-transfer-forwarding-replay/v1';
const SUPPORT_BUNDLE_TRANSFER_FORWARDING_WORKER_LEASE_MS = 5 * 60 * 1000;
const SUPPORT_BUNDLE_TRANSFER_FORWARDING_DEFAULT_MAX_ATTEMPTS = 3;
const SUPPORT_BUNDLE_DOWNLOAD_AUTHORIZED_AUDIT_VERSION =
  'copilot-support-bundle-download-authorized-audit/v1';
const SUPPORT_BUNDLE_DOWNLOAD_AUTHORIZATION_EXPIRED_AUDIT_VERSION =
  'copilot-support-bundle-download-authorization-expired-audit/v1';
const SUPPORT_BUNDLE_STORAGE_ERROR_CODE_MAX_LENGTH = 128;
const SUPPORT_BUNDLE_STORAGE_ERROR_MESSAGE_MAX_LENGTH = 512;
const SUPPORT_BUNDLE_AUDIT_METADATA_JSON_MAX_LENGTH = 16 * 1024;
const SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_JSON_MAX_LENGTH = 64 * 1024;
const SUPPORT_BUNDLE_MANIFEST_JSON_MAX_LENGTH = 64 * 1024;
const SUPPORT_BUNDLE_SOURCE_EVIDENCE_JSON_MAX_LENGTH = 16 * 1024;
const SUPPORT_BUNDLE_LIST_FILTER_STRING_MAX_LENGTH = 512;
const SUPPORT_BUNDLE_STATUSES = new Set<CopilotSupportBundleStatus>([
  'pending',
  'ready',
  'failed',
  'expired',
]);
const SUPPORT_BUNDLE_RETENTION_STATUSES =
  new Set<CopilotSupportBundleRetentionStatus>([
    'active',
    'expired',
    'deleted',
  ]);
const SUPPORT_BUNDLE_TRANSFER_FORWARDING_STATUSES =
  new Set<CopilotSupportBundleTransferForwardingEventStatus>([
    'queued',
    'processing',
    'retry_scheduled',
    'forwarded',
    'dead_lettered',
  ]);
const SUPPORT_BUNDLE_AUDIT_EVENT_TYPES = new Set<string>([
  'created',
  'read',
  'archive_created',
  'download_authorized',
  'downloaded',
  'retention_expired',
]);

function stableSupportBundleStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSupportBundleStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined
          ? null
          : `${JSON.stringify(key)}:${stableSupportBundleStringify(item)}`;
      })
      .filter(Boolean)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function supportBundleFingerprint(value: unknown) {
  return createHash('sha256')
    .update(stableSupportBundleStringify(value))
    .digest('hex')
    .slice(0, 16);
}

function isSupportBundleRecord(
  value: unknown
): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAuditEventType(
  value: unknown
): CopilotSupportBundleAuditEventType {
  if (
    typeof value === 'string' &&
    SUPPORT_BUNDLE_AUDIT_EVENT_TYPES.has(value)
  ) {
    return value as CopilotSupportBundleAuditEventType;
  }
  return 'read';
}

function optionalTransferEvidenceString(value: unknown, maxLength: number) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }
  return trimmed;
}

function normalizeProviderSignatureEvidence(
  value: unknown
): CopilotSupportBundleTransferProviderSignatureEvidence | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isSupportBundleRecord(value)) {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }
  const provider = optionalTransferEvidenceString(
    value.provider,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_SHORT_STRING_LENGTH
  );
  const status = optionalTransferEvidenceString(
    value.status,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_SHORT_STRING_LENGTH
  );
  if (
    provider !== 'aws_s3' &&
    provider !== 'cloudflare_r2' &&
    provider !== 's3_compatible'
  ) {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }
  if (status !== 'verified_by_upstream') {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }
  const signatureFingerprint = optionalTransferEvidenceString(
    value.signatureFingerprint,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_STRING_LENGTH
  );
  if (signatureFingerprint && !/^[a-f0-9]{16,64}$/.test(signatureFingerprint)) {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }
  const verifier = optionalTransferEvidenceString(
    value.verifier,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_SHORT_STRING_LENGTH
  );
  const keyId = optionalTransferEvidenceString(
    value.keyId,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_STRING_LENGTH
  );
  const algorithm = optionalTransferEvidenceString(
    value.algorithm,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_SHORT_STRING_LENGTH
  );
  const policy = optionalTransferEvidenceString(
    value.policy,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_SHORT_STRING_LENGTH
  );
  if (!verifier || !signatureFingerprint || !policy) {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }

  return {
    provider,
    status,
    verifier,
    ...(keyId ? { keyId } : {}),
    ...(algorithm ? { algorithm } : {}),
    signatureFingerprint,
    policy,
  };
}

function providerSignatureEvidenceFingerprint(value: unknown) {
  if (value === undefined) {
    return null;
  }
  const evidence = normalizeProviderSignatureEvidence(value);
  if (!evidence) {
    return null;
  }
  return supportBundleFingerprint({
    version: 'copilot-support-bundle-transfer-provider-signature-evidence/v1',
    evidence,
  });
}

function normalizeTransferNotificationAuthEvidence(
  value: unknown
): CopilotSupportBundleTransferNotificationAuthEvidence {
  if (value === undefined) {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }
  if (!isSupportBundleRecord(value)) {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }
  const policy = optionalTransferEvidenceString(
    value.policy,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_SHORT_STRING_LENGTH
  );
  const status = optionalTransferEvidenceString(
    value.status,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_SHORT_STRING_LENGTH
  );
  const method = optionalTransferEvidenceString(
    value.method,
    SUPPORT_BUNDLE_TRANSFER_AUTH_EVIDENCE_MAX_SHORT_STRING_LENGTH
  );
  if (
    policy !== 'internal_access_token' ||
    status !== 'verified' ||
    method !== 'x-access-token'
  ) {
    throw new Error('Support bundle transfer event auth evidence is invalid');
  }
  const providerSignatureEvidence = normalizeProviderSignatureEvidence(
    value.providerSignatureEvidence
  );

  return {
    policy,
    status,
    method,
    ...(providerSignatureEvidence ? { providerSignatureEvidence } : {}),
  };
}

function providerTransferEventSourceRequiresSignatureEvidence(
  eventSource?: string
) {
  return eventSource === 'aws:s3' || eventSource === 'aws.s3';
}

function supportBundleDownloadTokenFingerprint(token: string) {
  return createHash('sha256')
    .update(`copilot-support-bundle-download-token/v1:${token}`)
    .digest('hex');
}

function toJsonString(value: unknown) {
  return JSON.stringify(value);
}

function boundedSupportBundleString(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, maxLength);
}

function normalizeOptionalSupportBundleListFilterString(
  value: unknown,
  field: string
) {
  if (value == null) {
    return null;
  }
  const normalized = boundedSupportBundleString(
    value,
    SUPPORT_BUNDLE_LIST_FILTER_STRING_MAX_LENGTH
  );
  if (!normalized) {
    throw new Error(`Invalid support bundle ${field} filter`);
  }
  return normalized;
}

function normalizeOptionalSupportBundleStatusFilter(
  value: unknown
): CopilotSupportBundleStatus | null {
  if (value == null) {
    return null;
  }
  if (
    typeof value === 'string' &&
    SUPPORT_BUNDLE_STATUSES.has(value as CopilotSupportBundleStatus)
  ) {
    return value as CopilotSupportBundleStatus;
  }
  throw new Error('Invalid support bundle status filter');
}

function normalizeOptionalSupportBundleRetentionStatusFilter(
  value: unknown
): CopilotSupportBundleRetentionStatus | null {
  if (value == null) {
    return null;
  }
  if (
    typeof value === 'string' &&
    SUPPORT_BUNDLE_RETENTION_STATUSES.has(
      value as CopilotSupportBundleRetentionStatus
    )
  ) {
    return value as CopilotSupportBundleRetentionStatus;
  }
  throw new Error('Invalid support bundle retention status filter');
}

function normalizeOptionalTransferForwardingStatusFilter(
  value: unknown
): CopilotSupportBundleTransferForwardingEventStatus | null {
  if (value == null) {
    return null;
  }
  if (
    typeof value === 'string' &&
    SUPPORT_BUNDLE_TRANSFER_FORWARDING_STATUSES.has(
      value as CopilotSupportBundleTransferForwardingEventStatus
    )
  ) {
    return value as CopilotSupportBundleTransferForwardingEventStatus;
  }
  throw new Error('Invalid support bundle transfer forwarding status filter');
}

function normalizeSupportBundleListFilter(
  input?: CopilotSupportBundleListFilter | null
): Required<CopilotSupportBundleListFilter> {
  return {
    query: normalizeOptionalSupportBundleListFilterString(
      input?.query,
      'query'
    ),
    retentionStatus: normalizeOptionalSupportBundleRetentionStatusFilter(
      input?.retentionStatus
    ),
    status: normalizeOptionalSupportBundleStatusFilter(input?.status),
    transferForwardingStatus: normalizeOptionalTransferForwardingStatusFilter(
      input?.transferForwardingStatus
    ),
  };
}

function normalizeStorageError(error: unknown) {
  const rawCode = error instanceof Error ? error.constructor.name : 'unknown';
  const rawMessage = error instanceof Error ? error.message : String(error);
  return {
    errorCode:
      boundedSupportBundleString(
        rawCode,
        SUPPORT_BUNDLE_STORAGE_ERROR_CODE_MAX_LENGTH
      ) ?? 'unknown',
    errorMessage:
      boundedSupportBundleString(
        rawMessage,
        SUPPORT_BUNDLE_STORAGE_ERROR_MESSAGE_MAX_LENGTH
      ) ?? 'Unknown storage error',
  };
}

function normalizeForwardingEventFailure(error: unknown) {
  const storageError = normalizeStorageError(error);
  if (error instanceof Error) {
    const retryable = ![
      'Support bundle download authorization is not direct-delivery',
      'Support bundle direct download URL is not available',
      'Support bundle transfer event is from the future',
      'Support bundle transfer event predates the authorization',
      'Support bundle download authorization has expired',
      'Support bundle transfer event storage key mismatch',
      'Support bundle transfer event byte size mismatch',
      'Support bundle transfer event fingerprint mismatch',
      'Support bundle transfer event auth evidence is invalid',
    ].includes(error.message);

    return {
      retryable,
      errorCode:
        boundedSupportBundleString(
          error.message
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, ''),
          SUPPORT_BUNDLE_STORAGE_ERROR_CODE_MAX_LENGTH
        ) ?? storageError.errorCode,
      errorMessage: storageError.errorMessage,
    };
  }

  return {
    retryable: true,
    ...storageError,
  };
}

function normalizeAuditMetadata(metadata: Record<string, unknown>) {
  let serialized: string;
  try {
    serialized = JSON.stringify(metadata);
  } catch {
    throw new Error('Support bundle audit metadata must be JSON serializable');
  }
  if (serialized.length > SUPPORT_BUNDLE_AUDIT_METADATA_JSON_MAX_LENGTH) {
    throw new Error('Support bundle audit metadata is too large');
  }
  return {
    metadata: JSON.parse(serialized) as Record<string, unknown>,
    serialized,
  };
}

function normalizeForwardingPayload(payload: Record<string, unknown>) {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new Error(
      'Support bundle transfer forwarding payload must be JSON serializable'
    );
  }
  if (
    serialized.length >
    SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_JSON_MAX_LENGTH
  ) {
    throw new Error('Support bundle transfer forwarding payload is too large');
  }
  return {
    payload: JSON.parse(serialized) as Record<string, unknown>,
    serialized,
  };
}

function assertStringField(
  record: Record<string, unknown>,
  field: string,
  maxLength: number
) {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
}

function assertNullableStringField(
  record: Record<string, unknown>,
  field: string,
  maxLength: number
) {
  const value = record[field];
  if (
    value !== null &&
    (typeof value !== 'string' || !value.trim() || value.length > maxLength)
  ) {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
}

function assertBooleanField(
  record: Record<string, unknown>,
  field: string,
  expected?: boolean
) {
  const value = record[field];
  if (
    typeof value !== 'boolean' ||
    (expected !== undefined && value !== expected)
  ) {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
}

function assertPositiveIntegerField(
  record: Record<string, unknown>,
  field: string
) {
  const value = record[field];
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > 1_000_000_000
  ) {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
}

function assertNonNegativeIntegerField(
  record: Record<string, unknown>,
  field: string
) {
  const value = record[field];
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 1_000_000_000
  ) {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
}

function assertDownloadAuditArtifactKind(value: unknown) {
  if (value !== 'manifest_json' && value !== 'archive_json') {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
}

function assertDownloadAuditDeliveryMethod(value: unknown) {
  if (value !== 'api_proxy' && value !== 'object_storage_signed_url') {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
}

function assertDownloadAuthorizationCleanupScope(value: unknown) {
  if (
    value !== 'scheduled_worker' &&
    value !== 'retention_cleanup' &&
    value !== 'api_proxy_consume' &&
    value !== 'direct_download_acknowledge' &&
    value !== 'direct_download_transfer_event'
  ) {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
}

function validateDownloadAuthorizedAuditMetadata(
  metadata: Record<string, unknown>
) {
  if (metadata.authorizationExpired === true) {
    if (
      metadata.version !==
      SUPPORT_BUNDLE_DOWNLOAD_AUTHORIZATION_EXPIRED_AUDIT_VERSION
    ) {
      throw new Error('Support bundle audit metadata contract is invalid');
    }
    assertStringField(metadata, 'authorizationId', 128);
    assertStringField(metadata, 'authorizationFingerprint', 128);
    assertDownloadAuditArtifactKind(metadata.artifactKind);
    assertStringField(metadata, 'artifactFingerprint', 128);
    assertStringField(metadata, 'cleanupActorId', 128);
    assertStringField(metadata, 'cleanupFingerprint', 128);
    assertDownloadAuthorizationCleanupScope(metadata.cleanupScope);
    assertStringField(metadata, 'cleanedAt', 128);
    assertStringField(metadata, 'expiresAt', 128);
    assertStringField(metadata, 'previousStatus', 64);
    assertStringField(metadata, 'status', 64);
    if (
      metadata.previousStatus !== 'authorized' ||
      metadata.status !== 'expired'
    ) {
      throw new Error('Support bundle audit metadata contract is invalid');
    }
    if (metadata.deliveryMethod !== undefined) {
      assertDownloadAuditDeliveryMethod(metadata.deliveryMethod);
    }
    return;
  }

  if (metadata.version !== SUPPORT_BUNDLE_DOWNLOAD_AUTHORIZED_AUDIT_VERSION) {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
  assertStringField(metadata, 'authorizationId', 128);
  assertStringField(metadata, 'authorizationFingerprint', 128);
  assertDownloadAuditArtifactKind(metadata.artifactKind);
  assertStringField(metadata, 'artifactFilename', 512);
  assertStringField(metadata, 'artifactMime', 128);
  assertDownloadAuditDeliveryMethod(metadata.deliveryMethod);
  assertNullableStringField(metadata, 'directDownloadExpiresAt', 128);
  assertBooleanField(metadata, 'hasDirectDownloadUrl');
  assertStringField(metadata, 'manifestFingerprint', 128);
  assertStringField(metadata, 'artifactFingerprint', 128);
  assertStringField(metadata, 'expiresAt', 128);
}

function validateCreationAuditMetadata(metadata: Record<string, unknown>) {
  assertStringField(metadata, 'manifestFingerprint', 128);
  assertPositiveIntegerField(metadata, 'manifestByteSize');
  assertStringField(metadata, 'manifestFilename', 512);
  assertStringField(metadata, 'manifestMime', 128);
  assertStringField(metadata, 'manifestStorageKey', 1024);
  assertStringField(metadata, 'sourceEvidenceSetFingerprint', 128);
  assertStringField(metadata, 'retentionStatus', 64);
  if (metadata.retentionStatus !== 'active') {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
}

function validateArchiveCreatedAuditMetadata(
  metadata: Record<string, unknown>
) {
  assertPositiveIntegerField(metadata, 'archiveByteSize');
  assertStringField(metadata, 'archiveFilename', 512);
  assertStringField(metadata, 'archiveFingerprint', 128);
  assertStringField(metadata, 'archiveMime', 128);
  assertStringField(metadata, 'archiveStorageKey', 1024);
  assertStringField(metadata, 'manifestFingerprint', 128);
}

function validateRetentionAuditMetadata(metadata: Record<string, unknown>) {
  assertStringField(metadata, 'cleanupActorId', 512);
  assertStringField(metadata, 'cleanupFingerprint', 128);
  assertStringField(metadata, 'cleanupScope', 64);
  if (
    metadata.cleanupScope !== 'manual_workspace' &&
    metadata.cleanupScope !== 'scheduled_worker'
  ) {
    throw new Error('Support bundle audit metadata contract is invalid');
  }
  assertStringField(metadata, 'cleanedAt', 128);
  assertNonNegativeIntegerField(metadata, 'expiredAuthorizationCount');
  assertStringField(metadata, 'manifestFingerprint', 128);
  assertStringField(metadata, 'previousManifestFingerprint', 128);
  assertStringField(metadata, 'retentionStatus', 64);
  if (metadata.retentionStatus !== 'expired') {
    throw new Error('Support bundle audit metadata contract is invalid');
  }

  if (metadata.archiveObjectCleanupStatus !== undefined) {
    assertStringField(metadata, 'archiveObjectCleanupStatus', 64);
    if (
      metadata.archiveObjectCleanupStatus !== 'deleted' &&
      metadata.archiveObjectCleanupStatus !== 'missing' &&
      metadata.archiveObjectCleanupStatus !== 'failed'
    ) {
      throw new Error('Support bundle audit metadata contract is invalid');
    }
    assertNullableStringField(metadata, 'archiveObjectCleanupErrorCode', 128);
    assertNullableStringField(
      metadata,
      'archiveObjectCleanupErrorMessage',
      512
    );
    assertNullableStringField(metadata, 'archiveStorageKey', 1024);
  }

  if (metadata.manifestObjectRewriteStatus !== undefined) {
    assertStringField(metadata, 'manifestObjectRewriteStatus', 64);
    if (
      metadata.manifestObjectRewriteStatus !== 'written' &&
      metadata.manifestObjectRewriteStatus !== 'missing' &&
      metadata.manifestObjectRewriteStatus !== 'failed'
    ) {
      throw new Error('Support bundle audit metadata contract is invalid');
    }
    assertNullableStringField(metadata, 'manifestObjectRewriteErrorCode', 128);
    assertNullableStringField(
      metadata,
      'manifestObjectRewriteErrorMessage',
      512
    );
    assertNullableStringField(metadata, 'manifestStorageKey', 1024);
    if (metadata.manifestObjectRewriteStatus !== 'missing') {
      assertPositiveIntegerField(metadata, 'manifestByteSize');
    }
  }

  if (metadata.archiveObjectCleanupRetry === true) {
    assertNonNegativeIntegerField(metadata, 'archiveObjectCleanupFailureCount');
    assertStringField(metadata, 'archiveObjectCleanupStatus', 64);
    assertStringField(metadata, 'archiveStorageKey', 1024);
    assertNullableStringField(
      metadata,
      'previousArchiveObjectCleanupErrorCode',
      128
    );
    assertNullableStringField(
      metadata,
      'previousArchiveObjectCleanupErrorMessage',
      512
    );
    assertStringField(metadata, 'previousArchiveObjectCleanupFingerprint', 128);
  }

  if (metadata.manifestObjectRewriteRetry === true) {
    assertNonNegativeIntegerField(
      metadata,
      'manifestObjectRewriteFailureCount'
    );
    assertStringField(metadata, 'manifestObjectRewriteStatus', 64);
    assertStringField(metadata, 'manifestStorageKey', 1024);
    assertPositiveIntegerField(metadata, 'manifestByteSize');
    assertNullableStringField(
      metadata,
      'previousManifestObjectRewriteErrorCode',
      128
    );
    assertNullableStringField(
      metadata,
      'previousManifestObjectRewriteErrorMessage',
      512
    );
    assertStringField(
      metadata,
      'previousManifestObjectRewriteFingerprint',
      128
    );
  }

  if (metadata.archiveObjectCleanupEscalated === true) {
    if (
      metadata.cleanupScope !== 'scheduled_worker' ||
      metadata.archiveObjectCleanupRetry !== true ||
      metadata.archiveObjectCleanupStatus !== 'failed'
    ) {
      throw new Error('Support bundle audit metadata contract is invalid');
    }
    assertStringField(metadata, 'archiveObjectCleanupEscalatedAt', 128);
    assertStringField(metadata, 'archiveObjectCleanupEscalationReason', 128);
    if (
      metadata.archiveObjectCleanupEscalationReason !==
      SCHEDULED_ARCHIVE_OBJECT_CLEANUP_ESCALATION_REASON
    ) {
      throw new Error('Support bundle audit metadata contract is invalid');
    }
  }

  if (metadata.manifestObjectRewriteEscalated === true) {
    if (
      metadata.cleanupScope !== 'scheduled_worker' ||
      metadata.manifestObjectRewriteRetry !== true ||
      metadata.manifestObjectRewriteStatus !== 'failed'
    ) {
      throw new Error('Support bundle audit metadata contract is invalid');
    }
    assertStringField(metadata, 'manifestObjectRewriteEscalatedAt', 128);
    assertStringField(metadata, 'manifestObjectRewriteEscalationReason', 128);
    if (
      metadata.manifestObjectRewriteEscalationReason !==
      SCHEDULED_MANIFEST_OBJECT_REWRITE_ESCALATION_REASON
    ) {
      throw new Error('Support bundle audit metadata contract is invalid');
    }
  }
}

function normalizeHydratedJsonObject(
  value: unknown,
  maxLength: number
): Record<string, unknown> | null {
  if (!isSupportBundleRecord(value)) {
    return null;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  if (serialized.length > maxLength) {
    return null;
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function normalizeHydratedSourceEvidenceSummary(
  value: unknown
): CopilotSupportBundleSourceEvidenceSummary | null {
  const record = normalizeHydratedJsonObject(
    value,
    SUPPORT_BUNDLE_SOURCE_EVIDENCE_JSON_MAX_LENGTH
  );
  if (!record) {
    return null;
  }
  return {
    source:
      boundedSupportBundleString(record.source, 128) ?? 'db_hydration_guard',
    promptCatalogItemCount:
      typeof record.promptCatalogItemCount === 'number' &&
      Number.isInteger(record.promptCatalogItemCount) &&
      record.promptCatalogItemCount >= 0
        ? record.promptCatalogItemCount
        : 0,
    actionRunCount:
      typeof record.actionRunCount === 'number' &&
      Number.isInteger(record.actionRunCount) &&
      record.actionRunCount >= 0
        ? record.actionRunCount
        : 0,
    taskRouteCount:
      typeof record.taskRouteCount === 'number' &&
      Number.isInteger(record.taskRouteCount) &&
      record.taskRouteCount >= 0
        ? record.taskRouteCount
        : 0,
    includedSections: Array.isArray(record.includedSections)
      ? record.includedSections
          .map(section => boundedSupportBundleString(section, 128))
          .filter((section): section is string => !!section)
          .slice(0, 32)
      : [],
  };
}

function fallbackSourceEvidenceSummary(): CopilotSupportBundleSourceEvidenceSummary {
  return {
    source: 'db_hydration_guard',
    promptCatalogItemCount: 0,
    actionRunCount: 0,
    taskRouteCount: 0,
    includedSections: [],
  };
}

function fallbackManifestForRecord(
  record: CopilotSupportBundleRecord,
  sourceEvidenceSummary: CopilotSupportBundleSourceEvidenceSummary
): CopilotSupportBundleManifest {
  const archiveFingerprint =
    record.archiveFingerprint ??
    supportBundleFingerprint({
      version: 'copilot-support-bundle-missing-archive/v1',
      bundleId: record.id,
    });
  return {
    version: 'copilot-support-bundle-manifest/v1',
    bundleId: record.id,
    workspaceId: record.workspaceId,
    actorId: record.actorId,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    sourceEvidenceSummary,
    sourceEvidenceSetFingerprint: record.sourceEvidenceSetFingerprint,
    archive: {
      artifactKind: 'archive_json',
      filename:
        record.archiveFilename ??
        `localmind-support-bundle-${record.id}.archive.json`,
      mime: record.archiveMime ?? 'application/json',
      storageKey: record.archiveStorageKey ?? archiveStorageKey(record.id),
      byteSize: record.archiveByteSize ?? 0,
      archiveFingerprint,
    },
    retention: {
      status: record.retentionStatus,
      expiresAt: record.expiresAt.toISOString(),
    },
  };
}

function normalizeHydratedManifest(
  value: unknown,
  record: CopilotSupportBundleRecord,
  sourceEvidenceSummary: CopilotSupportBundleSourceEvidenceSummary
): CopilotSupportBundleManifest {
  const manifest = normalizeHydratedJsonObject(
    value,
    SUPPORT_BUNDLE_MANIFEST_JSON_MAX_LENGTH
  );
  if (!manifest) {
    return fallbackManifestForRecord(record, sourceEvidenceSummary);
  }
  const archive = isSupportBundleRecord(manifest.archive)
    ? manifest.archive
    : {};
  const retention = isSupportBundleRecord(manifest.retention)
    ? manifest.retention
    : {};
  const manifestSourceEvidenceSummary =
    normalizeHydratedSourceEvidenceSummary(manifest.sourceEvidenceSummary) ??
    sourceEvidenceSummary;
  const archiveFingerprint =
    boundedSupportBundleString(archive.archiveFingerprint, 128) ??
    record.archiveFingerprint ??
    supportBundleFingerprint({
      version: 'copilot-support-bundle-missing-archive/v1',
      bundleId: record.id,
    });

  return {
    version:
      boundedSupportBundleString(manifest.version, 128) ??
      'copilot-support-bundle-manifest/v1',
    bundleId: boundedSupportBundleString(manifest.bundleId, 128) ?? record.id,
    workspaceId:
      boundedSupportBundleString(manifest.workspaceId, 128) ??
      record.workspaceId,
    actorId:
      boundedSupportBundleString(manifest.actorId, 128) ?? record.actorId,
    createdAt:
      boundedSupportBundleString(manifest.createdAt, 128) ??
      record.createdAt.toISOString(),
    expiresAt:
      boundedSupportBundleString(manifest.expiresAt, 128) ??
      record.expiresAt.toISOString(),
    sourceEvidenceSummary: manifestSourceEvidenceSummary,
    sourceEvidenceSetFingerprint:
      boundedSupportBundleString(manifest.sourceEvidenceSetFingerprint, 128) ??
      record.sourceEvidenceSetFingerprint,
    archive: {
      artifactKind: 'archive_json',
      filename:
        boundedSupportBundleString(archive.filename, 512) ??
        record.archiveFilename ??
        `localmind-support-bundle-${record.id}.archive.json`,
      mime:
        boundedSupportBundleString(archive.mime, 128) ??
        record.archiveMime ??
        'application/json',
      storageKey:
        boundedSupportBundleString(archive.storageKey, 1024) ??
        record.archiveStorageKey ??
        archiveStorageKey(record.id),
      byteSize:
        typeof archive.byteSize === 'number' &&
        Number.isInteger(archive.byteSize) &&
        archive.byteSize >= 0
          ? archive.byteSize
          : (record.archiveByteSize ?? 0),
      archiveFingerprint,
    },
    retention: {
      status:
        retention.status === 'active' ||
        retention.status === 'expired' ||
        retention.status === 'deleted'
          ? retention.status
          : record.retentionStatus,
      expiresAt:
        boundedSupportBundleString(retention.expiresAt, 128) ??
        record.expiresAt.toISOString(),
    },
  };
}

function hydrateSupportBundleRecord<T extends CopilotSupportBundleRecord>(
  record: T
): T {
  const sourceEvidenceSummary =
    normalizeHydratedSourceEvidenceSummary(record.sourceEvidenceSummary) ??
    fallbackSourceEvidenceSummary();
  const withSourceEvidence = {
    ...record,
    sourceEvidenceSummary,
  };
  return {
    ...withSourceEvidence,
    auditEventCount: Number(record.auditEventCount ?? 0),
    auditEvents: normalizeHydratedAuditEvents(record.auditEvents),
    transferEventCount: Number(record.transferEventCount ?? 0),
    transferEvents: normalizeHydratedTransferEvents(record.transferEvents),
    transferForwardingEventCount: Number(
      record.transferForwardingEventCount ?? 0
    ),
    transferForwardingEvents: normalizeHydratedTransferForwardingEvents(
      record.transferForwardingEvents
    ),
    manifestJson: normalizeHydratedManifest(
      record.manifestJson,
      withSourceEvidence,
      sourceEvidenceSummary
    ),
  } as T;
}

function normalizeHydratedAuditEvents(
  value: unknown
): CopilotSupportBundleAuditEventRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isSupportBundleRecord)
    .map(event => ({
      id: String(event.id ?? ''),
      bundleId: String(event.bundleId ?? ''),
      workspaceId: String(event.workspaceId ?? ''),
      actorId: String(event.actorId ?? ''),
      eventType: normalizeAuditEventType(event.eventType),
      eventFingerprint: String(event.eventFingerprint ?? ''),
      metadata:
        normalizeHydratedJsonObject(
          event.metadata,
          SUPPORT_BUNDLE_AUDIT_METADATA_JSON_MAX_LENGTH
        ) ?? {},
      createdAt: new Date(String(event.createdAt ?? '')),
    }))
    .filter(event => event.id && event.eventFingerprint);
}

function normalizeHydratedTransferEvents(
  value: unknown
): CopilotSupportBundleTransferEventRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isSupportBundleRecord)
    .map(event => ({
      id: String(event.id ?? ''),
      authorizationId: String(event.authorizationId ?? ''),
      artifactKind:
        event.artifactKind === 'archive_json'
          ? 'archive_json'
          : 'manifest_json',
      manifestFingerprint: String(event.manifestFingerprint ?? ''),
      artifactFingerprint: String(event.artifactFingerprint ?? ''),
      authorizationFingerprint: String(event.authorizationFingerprint ?? ''),
      deliveryMethod:
        event.deliveryMethod === 'object_storage_signed_url'
          ? 'object_storage_signed_url'
          : 'api_proxy',
      eventId:
        typeof event.eventId === 'string' && event.eventId.trim()
          ? event.eventId
          : null,
      eventSource: String(event.eventSource ?? ''),
      transferredAt: new Date(String(event.transferredAt ?? '')),
      notificationAuthEvidenceFingerprint: String(
        event.notificationAuthEvidenceFingerprint ?? ''
      ),
      storageKey: String(event.storageKey ?? ''),
      storageByteSize:
        typeof event.storageByteSize === 'number' ? event.storageByteSize : 0,
      storageContentType: String(event.storageContentType ?? ''),
      eventFingerprint: String(event.eventFingerprint ?? ''),
      createdAt: new Date(String(event.createdAt ?? '')),
    }))
    .filter(event => event.id && event.eventFingerprint);
}

function normalizeHydratedTransferForwardingEvents(
  value: unknown
): CopilotSupportBundleTransferForwardingEventRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isSupportBundleRecord)
    .map(event =>
      hydrateTransferForwardingEventRecord({
        id: String(event.id ?? ''),
        authorizationId: String(event.authorizationId ?? ''),
        status: String(
          event.status ?? ''
        ) as CopilotSupportBundleTransferForwardingEventStatus,
        eventId:
          typeof event.eventId === 'string' && event.eventId.trim()
            ? event.eventId
            : null,
        eventSource: String(event.eventSource ?? ''),
        forwardingEventFingerprint: String(
          event.forwardingEventFingerprint ?? ''
        ),
        forwardingPayload:
          normalizeHydratedJsonObject(
            event.forwardingPayload,
            SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_JSON_MAX_LENGTH
          ) ?? {},
        forwardingPayloadFingerprint: String(
          event.forwardingPayloadFingerprint ?? ''
        ),
        providerSignatureEvidenceFingerprint:
          typeof event.providerSignatureEvidenceFingerprint === 'string' &&
          event.providerSignatureEvidenceFingerprint.trim()
            ? event.providerSignatureEvidenceFingerprint
            : null,
        forwardedTransferEventFingerprint:
          typeof event.forwardedTransferEventFingerprint === 'string' &&
          event.forwardedTransferEventFingerprint.trim()
            ? event.forwardedTransferEventFingerprint
            : null,
        attemptCount:
          typeof event.attemptCount === 'number' ? event.attemptCount : 0,
        maxAttempts:
          typeof event.maxAttempts === 'number'
            ? event.maxAttempts
            : SUPPORT_BUNDLE_TRANSFER_FORWARDING_DEFAULT_MAX_ATTEMPTS,
        nextAttemptAt: event.nextAttemptAt
          ? new Date(String(event.nextAttemptAt))
          : null,
        workerLeaseId:
          typeof event.workerLeaseId === 'string' && event.workerLeaseId.trim()
            ? event.workerLeaseId
            : null,
        workerLeaseExpiresAt: event.workerLeaseExpiresAt
          ? new Date(String(event.workerLeaseExpiresAt))
          : null,
        lastAttemptAt: event.lastAttemptAt
          ? new Date(String(event.lastAttemptAt))
          : null,
        forwardedAt: event.forwardedAt
          ? new Date(String(event.forwardedAt))
          : null,
        deadLetteredAt: event.deadLetteredAt
          ? new Date(String(event.deadLetteredAt))
          : null,
        failureCode:
          typeof event.failureCode === 'string' && event.failureCode.trim()
            ? event.failureCode
            : null,
        failureMessage:
          typeof event.failureMessage === 'string' &&
          event.failureMessage.trim()
            ? event.failureMessage
            : null,
        createdAt: new Date(String(event.createdAt ?? '')),
        updatedAt: new Date(String(event.updatedAt ?? '')),
      })
    )
    .filter(event => event.id && event.forwardingEventFingerprint);
}

function hydrateTransferForwardingEventRecord(
  row: CopilotSupportBundleTransferForwardingEventRecord
): CopilotSupportBundleTransferForwardingEventRecord {
  return {
    ...row,
    status:
      row.status === 'processing' ||
      row.status === 'retry_scheduled' ||
      row.status === 'forwarded' ||
      row.status === 'dead_lettered'
        ? row.status
        : 'queued',
    forwardingPayload:
      normalizeHydratedJsonObject(
        row.forwardingPayload,
        SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_JSON_MAX_LENGTH
      ) ?? {},
    attemptCount: Number(row.attemptCount ?? 0),
    maxAttempts: Number(
      row.maxAttempts ?? SUPPORT_BUNDLE_TRANSFER_FORWARDING_DEFAULT_MAX_ATTEMPTS
    ),
  };
}

function retentionExpiry(createdAt: Date) {
  return new Date(createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
}

function normalizeSupportBundleExpiresAt(createdAt: Date, expiresAt?: Date) {
  if (!expiresAt) {
    return retentionExpiry(createdAt);
  }
  const normalized = new Date(expiresAt);
  if (Number.isNaN(normalized.getTime())) {
    throw new Error('Support bundle expiration time is invalid');
  }

  return normalized;
}

function normalizeLimit(limit: number | undefined) {
  return Math.min(Math.max(limit ?? 8, 1), 20);
}

function normalizeCleanupLimit(limit: number | undefined) {
  return Math.min(Math.max(limit ?? 50, 1), 100);
}

function downloadAuthorizationExpiry(createdAt: Date) {
  return new Date(createdAt.getTime() + 15 * 60 * 1000);
}

function randomDownloadToken() {
  return randomBytes(32).toString('base64url');
}

function archiveStorageKey(bundleId: string) {
  return `support-bundles/${bundleId}/archive.json`;
}

function manifestStorageKey(bundleId: string) {
  return `support-bundles/${bundleId}/manifest.json`;
}

function jsonByteSize(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8');
}

function buildArchiveFile(path: string, content: unknown) {
  return {
    path,
    mediaType: 'application/json' as const,
    fingerprint: supportBundleFingerprint(content),
    byteSize: jsonByteSize(content),
    content,
  };
}

function archiveEntry(section: string, file: CopilotSupportBundleArchiveFile) {
  return {
    path: file.path,
    mediaType: file.mediaType,
    fingerprint: file.fingerprint,
    byteSize: file.byteSize,
    section,
  };
}

@Injectable()
export class CopilotSupportBundleModel extends BaseModel {
  private storageProvider: StorageProvider | null = null;

  constructor(
    @Inject(Config)
    private readonly config: Config,
    @Inject(StorageProviderFactory)
    private readonly storageFactory: StorageProviderFactory
  ) {
    super();
  }

  @Transactional()
  async create(input: {
    workspaceId: string;
    actorId: string;
    promptCatalog: PromptCatalogItem[];
    taskRoutes?: CopilotSupportBundleTaskRouteSnapshot[];
    expiresAt?: Date;
  }): Promise<CopilotSupportBundleRecord> {
    const id = randomUUID();
    const createdAt = new Date();
    const expiresAt = normalizeSupportBundleExpiresAt(
      createdAt,
      input.expiresAt
    );
    const storageKey = archiveStorageKey(id);
    const manifestObjectStorageKey = manifestStorageKey(id);
    const sourceEvidenceSummary = await this.buildSourceEvidenceSummary(
      input.workspaceId,
      input.actorId,
      input.promptCatalog.length,
      input.taskRoutes?.length ?? 2
    );
    const sourceEvidenceSetFingerprint = supportBundleFingerprint({
      version: 'copilot-support-bundle-source-evidence-summary/v1',
      workspaceId: input.workspaceId,
      sourceEvidenceSummary,
    });
    const manifestWithoutArchive: Omit<
      CopilotSupportBundleManifest,
      'archive'
    > = {
      version: 'copilot-support-bundle-manifest/v1',
      bundleId: id,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      sourceEvidenceSummary,
      sourceEvidenceSetFingerprint,
      retention: {
        status: 'active',
        expiresAt: expiresAt.toISOString(),
      },
    };
    const archivePayload = await this.buildArchivePayload({
      bundleId: id,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      createdAt,
      expiresAt,
      manifest: manifestWithoutArchive,
      promptCatalog: input.promptCatalog,
      sourceEvidenceSummary,
      sourceEvidenceSetFingerprint,
      taskRoutes: input.taskRoutes ?? [],
    });
    const archiveBody = Buffer.from(
      JSON.stringify(archivePayload, null, 2),
      'utf8'
    );
    const archiveFingerprint = supportBundleFingerprint(archivePayload);
    const archiveFilename = `localmind-support-bundle-${id}.archive.json`;
    const archiveMime = 'application/json';
    const manifest: CopilotSupportBundleManifest = {
      version: 'copilot-support-bundle-manifest/v1',
      bundleId: id,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      sourceEvidenceSummary,
      sourceEvidenceSetFingerprint,
      archive: {
        artifactKind: 'archive_json',
        filename: archiveFilename,
        mime: archiveMime,
        storageKey,
        byteSize: archiveBody.length,
        archiveFingerprint,
      },
      retention: {
        status: 'active',
        expiresAt: expiresAt.toISOString(),
      },
    };
    const manifestFingerprint = supportBundleFingerprint(manifest);
    const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    const manifestFilename = `localmind-support-bundle-${id}.manifest.json`;
    const manifestMime = 'application/json';

    const writtenStorageKeys: string[] = [];
    try {
      await this.getStorageProvider().put(
        manifestObjectStorageKey,
        manifestBody,
        {
          contentLength: manifestBody.length,
          contentType: manifestMime,
        }
      );
      writtenStorageKeys.push(manifestObjectStorageKey);
      await this.getStorageProvider().put(storageKey, archiveBody, {
        contentLength: archiveBody.length,
        contentType: archiveMime,
      });
      writtenStorageKeys.push(storageKey);

      await this.db.$executeRaw`
        INSERT INTO ai_support_bundle_requests (
          id,
          workspace_id,
          actor_id,
          status,
          source_evidence_summary,
          source_evidence_set_fingerprint,
          manifest_fingerprint,
          manifest_json,
          manifest_storage_key,
          manifest_byte_size,
          manifest_mime,
          manifest_filename,
          archive_storage_key,
          archive_byte_size,
          archive_fingerprint,
          archive_mime,
          archive_filename,
          retention_status,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (
          ${id},
          ${input.workspaceId},
          ${input.actorId},
          ${'ready'},
          ${toJsonString(sourceEvidenceSummary)}::jsonb,
          ${sourceEvidenceSetFingerprint},
          ${manifestFingerprint},
          ${toJsonString(manifest)}::jsonb,
          ${manifestObjectStorageKey},
          ${manifestBody.length},
          ${manifestMime},
          ${manifestFilename},
          ${storageKey},
          ${archiveBody.length},
          ${archiveFingerprint},
          ${archiveMime},
          ${archiveFilename},
          ${'active'},
          ${expiresAt},
          ${createdAt},
          ${createdAt}
        )
      `;
      await this.createAuditEvent({
        bundleId: id,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        eventType: 'created',
        metadata: {
          manifestFingerprint,
          manifestByteSize: manifestBody.length,
          manifestFilename,
          manifestMime,
          manifestStorageKey: manifestObjectStorageKey,
          sourceEvidenceSetFingerprint,
          retentionStatus: 'active',
        },
      });
      await this.createAuditEvent({
        bundleId: id,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        eventType: 'archive_created',
        metadata: {
          archiveByteSize: archiveBody.length,
          archiveFilename,
          archiveFingerprint,
          archiveMime,
          archiveStorageKey: storageKey,
          manifestFingerprint,
        },
      });

      const bundle = await this.get(input.workspaceId, id);
      if (!bundle) {
        throw new Error(`Created support bundle not found: ${id}`);
      }
      return bundle;
    } catch (error) {
      await Promise.allSettled(
        writtenStorageKeys.map(key => this.getStorageProvider().delete(key))
      );
      throw error;
    }
  }

  async get(workspaceId: string, id: string) {
    const rows = await this.db.$queryRaw<CopilotSupportBundleRecord[]>`
      SELECT
        b.id,
        b.workspace_id AS "workspaceId",
        b.actor_id AS "actorId",
        b.status,
        b.source_evidence_summary AS "sourceEvidenceSummary",
        b.source_evidence_set_fingerprint AS "sourceEvidenceSetFingerprint",
        b.manifest_fingerprint AS "manifestFingerprint",
        b.manifest_json AS "manifestJson",
        b.manifest_storage_key AS "manifestStorageKey",
        b.manifest_byte_size AS "manifestByteSize",
        b.manifest_mime AS "manifestMime",
        b.manifest_filename AS "manifestFilename",
        b.archive_storage_key AS "archiveStorageKey",
        b.archive_byte_size AS "archiveByteSize",
        b.archive_fingerprint AS "archiveFingerprint",
        b.archive_mime AS "archiveMime",
        b.archive_filename AS "archiveFilename",
        b.retention_status AS "retentionStatus",
        b.expires_at AS "expiresAt",
        b.failure_code AS "failureCode",
        b.failure_message AS "failureMessage",
        b.created_at AS "createdAt",
        b.updated_at AS "updatedAt",
        COUNT(e.id)::int AS "auditEventCount",
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', audit_events.id,
                'bundleId', audit_events.bundle_id,
                'workspaceId', audit_events.workspace_id,
                'actorId', audit_events.actor_id,
                'eventType', audit_events.event_type,
                'eventFingerprint', audit_events.event_fingerprint,
                'metadata', audit_events.metadata,
                'createdAt', audit_events.created_at
              )
              ORDER BY audit_events.created_at DESC, audit_events.id DESC
            )
            FROM (
              SELECT *
              FROM ai_support_bundle_audit_events audit_events
              WHERE audit_events.bundle_id = b.id
              ORDER BY audit_events.created_at DESC, audit_events.id DESC
              LIMIT 5
            ) audit_events
          ),
          ${'[]'}::jsonb
        ) AS "auditEvents",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_transfer_events transfer_count
          WHERE transfer_count.bundle_id = b.id
        ) AS "transferEventCount",
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', transfer_events.id,
                'authorizationId', transfer_events.authorization_id,
                'artifactKind', transfer_events.artifact_kind,
                'manifestFingerprint', transfer_events.manifest_fingerprint,
                'artifactFingerprint', transfer_events.artifact_fingerprint,
                'authorizationFingerprint',
                  transfer_events.authorization_fingerprint,
                'deliveryMethod', transfer_events.delivery_method,
                'eventId', transfer_events.event_id,
                'eventSource', transfer_events.event_source,
                'transferredAt', transfer_events.transferred_at,
                'notificationAuthEvidenceFingerprint',
                  transfer_events.notification_auth_evidence_fingerprint,
                'storageKey', transfer_events.storage_key,
                'storageByteSize', transfer_events.storage_byte_size,
                'storageContentType', transfer_events.storage_content_type,
                'eventFingerprint', transfer_events.event_fingerprint,
                'createdAt', transfer_events.created_at
              )
              ORDER BY transfer_events.created_at DESC, transfer_events.id DESC
            )
            FROM (
              SELECT *
              FROM ai_support_bundle_transfer_events transfer_events
              WHERE transfer_events.bundle_id = b.id
              ORDER BY transfer_events.created_at DESC, transfer_events.id DESC
              LIMIT 5
            ) transfer_events
          ),
          ${'[]'}::jsonb
        ) AS "transferEvents"
      FROM ai_support_bundle_requests b
      LEFT JOIN ai_support_bundle_audit_events e ON e.bundle_id = b.id
      WHERE b.workspace_id = ${workspaceId} AND b.id = ${id}
      GROUP BY b.id
      LIMIT 1
    `;
    return rows[0]
      ? await this.withTransferForwardingEvents(
          hydrateSupportBundleRecord(rows[0])
        )
      : null;
  }

  async list(
    workspaceId: string,
    options: {
      filter?: CopilotSupportBundleListFilter | null;
      limit?: number;
    } = {}
  ) {
    const limit = normalizeLimit(options.limit);
    const filter = normalizeSupportBundleListFilter(options.filter);
    const rows = await this.db.$queryRaw<CopilotSupportBundleRecord[]>`
      SELECT
        b.id,
        b.workspace_id AS "workspaceId",
        b.actor_id AS "actorId",
        b.status,
        b.source_evidence_summary AS "sourceEvidenceSummary",
        b.source_evidence_set_fingerprint AS "sourceEvidenceSetFingerprint",
        b.manifest_fingerprint AS "manifestFingerprint",
        b.manifest_json AS "manifestJson",
        b.manifest_storage_key AS "manifestStorageKey",
        b.manifest_byte_size AS "manifestByteSize",
        b.manifest_mime AS "manifestMime",
        b.manifest_filename AS "manifestFilename",
        b.archive_storage_key AS "archiveStorageKey",
        b.archive_byte_size AS "archiveByteSize",
        b.archive_fingerprint AS "archiveFingerprint",
        b.archive_mime AS "archiveMime",
        b.archive_filename AS "archiveFilename",
        b.retention_status AS "retentionStatus",
        b.expires_at AS "expiresAt",
        b.failure_code AS "failureCode",
        b.failure_message AS "failureMessage",
        b.created_at AS "createdAt",
        b.updated_at AS "updatedAt",
        COUNT(e.id)::int AS "auditEventCount",
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', audit_events.id,
                'bundleId', audit_events.bundle_id,
                'workspaceId', audit_events.workspace_id,
                'actorId', audit_events.actor_id,
                'eventType', audit_events.event_type,
                'eventFingerprint', audit_events.event_fingerprint,
                'metadata', audit_events.metadata,
                'createdAt', audit_events.created_at
              )
              ORDER BY audit_events.created_at DESC, audit_events.id DESC
            )
            FROM (
              SELECT *
              FROM ai_support_bundle_audit_events audit_events
              WHERE audit_events.bundle_id = b.id
              ORDER BY audit_events.created_at DESC, audit_events.id DESC
              LIMIT 5
            ) audit_events
          ),
          ${'[]'}::jsonb
        ) AS "auditEvents",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_transfer_events transfer_count
          WHERE transfer_count.bundle_id = b.id
        ) AS "transferEventCount",
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', transfer_events.id,
                'authorizationId', transfer_events.authorization_id,
                'artifactKind', transfer_events.artifact_kind,
                'manifestFingerprint', transfer_events.manifest_fingerprint,
                'artifactFingerprint', transfer_events.artifact_fingerprint,
                'authorizationFingerprint',
                  transfer_events.authorization_fingerprint,
                'deliveryMethod', transfer_events.delivery_method,
                'eventId', transfer_events.event_id,
                'eventSource', transfer_events.event_source,
                'transferredAt', transfer_events.transferred_at,
                'notificationAuthEvidenceFingerprint',
                  transfer_events.notification_auth_evidence_fingerprint,
                'storageKey', transfer_events.storage_key,
                'storageByteSize', transfer_events.storage_byte_size,
                'storageContentType', transfer_events.storage_content_type,
                'eventFingerprint', transfer_events.event_fingerprint,
                'createdAt', transfer_events.created_at
              )
              ORDER BY transfer_events.created_at DESC, transfer_events.id DESC
            )
            FROM (
              SELECT *
              FROM ai_support_bundle_transfer_events transfer_events
              WHERE transfer_events.bundle_id = b.id
              ORDER BY transfer_events.created_at DESC, transfer_events.id DESC
              LIMIT 5
            ) transfer_events
          ),
          ${'[]'}::jsonb
        ) AS "transferEvents"
      FROM ai_support_bundle_requests b
      LEFT JOIN ai_support_bundle_audit_events e ON e.bundle_id = b.id
      WHERE b.workspace_id = ${workspaceId}
        AND (${filter.status}::varchar IS NULL OR b.status = ${filter.status})
        AND (
          ${filter.retentionStatus}::varchar IS NULL
          OR b.retention_status = ${filter.retentionStatus}
        )
        AND (
          ${filter.query}::varchar IS NULL
          OR b.id = ${filter.query}
          OR b.manifest_fingerprint = ${filter.query}
          OR b.archive_fingerprint = ${filter.query}
          OR b.source_evidence_set_fingerprint = ${filter.query}
          OR EXISTS (
            SELECT 1
            FROM ai_support_bundle_download_authorizations authz
            JOIN ai_support_bundle_transfer_forwarding_events forwarding
              ON forwarding.authorization_id = authz.id
            WHERE authz.bundle_id = b.id
              AND (
                authz.id = ${filter.query}
                OR authz.authorization_fingerprint = ${filter.query}
                OR forwarding.id = ${filter.query}
                OR forwarding.event_id = ${filter.query}
                OR forwarding.event_source = ${filter.query}
                OR forwarding.forwarding_event_fingerprint = ${filter.query}
                OR forwarding.forwarding_payload_fingerprint = ${filter.query}
                OR forwarding.provider_signature_evidence_fingerprint =
                  ${filter.query}
                OR forwarding.forwarded_transfer_event_fingerprint =
                  ${filter.query}
                OR forwarding.failure_code = ${filter.query}
              )
          )
        )
        AND (
          ${filter.transferForwardingStatus}::varchar IS NULL
          OR EXISTS (
            SELECT 1
            FROM ai_support_bundle_download_authorizations authz
            JOIN ai_support_bundle_transfer_forwarding_events forwarding
              ON forwarding.authorization_id = authz.id
            WHERE authz.bundle_id = b.id
              AND forwarding.status = ${filter.transferForwardingStatus}
          )
        )
      GROUP BY b.id
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ${limit}
    `;
    return await Promise.all(
      rows
        .map(hydrateSupportBundleRecord)
        .map(record => this.withTransferForwardingEvents(record))
    );
  }

  private async withTransferForwardingEvents<
    T extends CopilotSupportBundleRecord,
  >(record: T): Promise<T> {
    const forwardingEvents = await this.listTransferForwardingEventsForBundle(
      record.id
    );
    return {
      ...record,
      ...forwardingEvents,
    };
  }

  private async listTransferForwardingEventsForBundle(
    bundleId: string,
    options: { limit?: number } = {}
  ) {
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const rows = await this.db.$queryRaw<
      Array<
        CopilotSupportBundleTransferForwardingEventRecord & {
          transferForwardingEventCount: number;
        }
      >
    >`
      SELECT
        forwarding.id,
        forwarding.authorization_id AS "authorizationId",
        forwarding.status,
        forwarding.event_id AS "eventId",
        forwarding.event_source AS "eventSource",
        forwarding.forwarding_event_fingerprint AS "forwardingEventFingerprint",
        forwarding.forwarding_payload AS "forwardingPayload",
        forwarding.forwarding_payload_fingerprint AS "forwardingPayloadFingerprint",
        forwarding.provider_signature_evidence_fingerprint AS "providerSignatureEvidenceFingerprint",
        forwarding.forwarded_transfer_event_fingerprint AS "forwardedTransferEventFingerprint",
        forwarding.attempt_count AS "attemptCount",
        forwarding.max_attempts AS "maxAttempts",
        forwarding.next_attempt_at AS "nextAttemptAt",
        forwarding.worker_lease_id AS "workerLeaseId",
        forwarding.worker_lease_expires_at AS "workerLeaseExpiresAt",
        forwarding.last_attempt_at AS "lastAttemptAt",
        forwarding.forwarded_at AS "forwardedAt",
        forwarding.dead_lettered_at AS "deadLetteredAt",
        forwarding.failure_code AS "failureCode",
        forwarding.failure_message AS "failureMessage",
        forwarding.created_at AS "createdAt",
        forwarding.updated_at AS "updatedAt",
        COUNT(*) OVER()::int AS "transferForwardingEventCount"
      FROM ai_support_bundle_transfer_forwarding_events forwarding
      JOIN ai_support_bundle_download_authorizations authz
        ON authz.id = forwarding.authorization_id
      WHERE authz.bundle_id = ${bundleId}
      ORDER BY forwarding.created_at DESC, forwarding.id DESC
      LIMIT ${limit}
    `;
    return {
      transferForwardingEventCount: rows[0]?.transferForwardingEventCount ?? 0,
      transferForwardingEvents: rows.map(row =>
        hydrateTransferForwardingEventRecord(row)
      ),
    };
  }

  async recordRead(input: {
    bundleId: string;
    workspaceId: string;
    actorId: string;
    manifestFingerprint: string;
  }) {
    await this.createAuditEvent({
      bundleId: input.bundleId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      eventType: 'read',
      metadata: {
        manifestFingerprint: input.manifestFingerprint,
      },
    });
  }

  @Transactional()
  async authorizeDownload(input: {
    bundleId: string;
    workspaceId: string;
    actorId: string;
    artifactKind?: CopilotSupportBundleDownloadArtifactKind;
  }): Promise<CopilotSupportBundleDownloadAuthorizationResult> {
    const bundle = await this.get(input.workspaceId, input.bundleId);
    if (!bundle) {
      throw new Error('Support bundle not found');
    }
    if (bundle.status !== 'ready' || bundle.retentionStatus !== 'active') {
      throw new Error('Support bundle is not downloadable');
    }
    if (bundle.expiresAt.getTime() <= Date.now()) {
      throw new Error('Support bundle has expired');
    }

    const now = new Date();
    const id = randomUUID();
    const downloadToken = randomDownloadToken();
    const tokenFingerprint =
      supportBundleDownloadTokenFingerprint(downloadToken);
    const expiresAt = downloadAuthorizationExpiry(now);
    const artifactKind = input.artifactKind ?? 'manifest_json';
    if (
      artifactKind === 'archive_json' &&
      (!bundle.archiveStorageKey ||
        !bundle.archiveFingerprint ||
        !bundle.archiveMime ||
        !bundle.archiveFilename)
    ) {
      throw new Error('Support bundle archive is not available');
    }
    const manifestMetadata =
      artifactKind === 'manifest_json'
        ? {
            byteSize: bundle.manifestByteSize,
            filename: bundle.manifestFilename,
            fingerprint: bundle.manifestFingerprint,
            mime: bundle.manifestMime,
            storageKey: bundle.manifestStorageKey,
          }
        : null;
    const archiveMetadata =
      artifactKind === 'archive_json'
        ? {
            byteSize: bundle.archiveByteSize,
            filename: bundle.archiveFilename,
            fingerprint: bundle.archiveFingerprint,
            mime: bundle.archiveMime,
            storageKey: bundle.archiveStorageKey,
          }
        : null;
    if (
      artifactKind === 'archive_json' &&
      (!archiveMetadata?.filename ||
        !archiveMetadata.fingerprint ||
        !archiveMetadata.mime)
    ) {
      throw new Error('Support bundle archive is not available');
    }
    const artifactFilename =
      archiveMetadata?.filename ??
      manifestMetadata?.filename ??
      `localmind-support-bundle-${bundle.id}.manifest.json`;
    const artifactMime =
      archiveMetadata?.mime ?? manifestMetadata?.mime ?? 'application/json';
    const artifactFingerprint =
      archiveMetadata?.fingerprint ??
      manifestMetadata?.fingerprint ??
      bundle.manifestFingerprint;
    const directDelivery = await this.createSignedUrlDelivery(
      {
        byteSize:
          artifactKind === 'archive_json'
            ? (archiveMetadata?.byteSize ?? null)
            : (manifestMetadata?.byteSize ?? null),
        fingerprint: artifactFingerprint,
        storageKey:
          artifactKind === 'archive_json'
            ? (archiveMetadata?.storageKey ?? null)
            : (manifestMetadata?.storageKey ?? null),
      },
      expiresAt
    );
    const deliveryMethod: CopilotSupportBundleDownloadDeliveryMethod =
      directDelivery ? 'object_storage_signed_url' : 'api_proxy';
    const directDownloadUrl = directDelivery?.url ?? null;
    const directDownloadExpiresAt = directDelivery?.expiresAt ?? null;
    const authorizationFingerprint = supportBundleFingerprint({
      version: 'copilot-support-bundle-download-authorization/v1',
      id,
      bundleId: bundle.id,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      artifactKind,
      artifactFilename,
      artifactMime,
      manifestFingerprint: bundle.manifestFingerprint,
      artifactFingerprint,
      deliveryMethod,
      directDownloadExpiresAt: directDownloadExpiresAt?.toISOString() ?? null,
      expiresAt: expiresAt.toISOString(),
    });

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_support_bundle_download_authorizations (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        status,
        artifact_kind,
        artifact_filename,
        artifact_mime,
        manifest_fingerprint,
        artifact_fingerprint,
        authorization_fingerprint,
        token_fingerprint,
        delivery_method,
        direct_download_url,
        direct_download_expires_at,
        expires_at,
        created_at,
        updated_at
      )
      SELECT
        ${id},
        ${bundle.id},
        ${input.workspaceId},
        ${input.actorId},
        ${'authorized'},
        ${artifactKind},
        ${artifactFilename},
        ${artifactMime},
        ${bundle.manifestFingerprint},
        ${artifactFingerprint},
        ${authorizationFingerprint},
        ${tokenFingerprint},
        ${deliveryMethod},
        ${directDownloadUrl},
        ${directDownloadExpiresAt},
        ${expiresAt},
        ${now},
        ${now}
      FROM ai_support_bundle_requests bundle
      WHERE bundle.id = ${bundle.id}
        AND bundle.workspace_id = ${input.workspaceId}
        AND bundle.actor_id = ${bundle.actorId}
        AND bundle.status = ${'ready'}
        AND bundle.source_evidence_summary = ${toJsonString(
          bundle.sourceEvidenceSummary
        )}::jsonb
        AND bundle.source_evidence_set_fingerprint = ${
          bundle.sourceEvidenceSetFingerprint
        }
        AND bundle.retention_status = ${'active'}
        AND bundle.manifest_fingerprint = ${bundle.manifestFingerprint}
        AND bundle.manifest_json = ${toJsonString(bundle.manifestJson)}::jsonb
        AND bundle.manifest_storage_key IS NOT DISTINCT FROM ${
          bundle.manifestStorageKey
        }
        AND bundle.manifest_byte_size = ${bundle.manifestByteSize}
        AND bundle.manifest_mime = ${bundle.manifestMime}
        AND bundle.manifest_filename = ${bundle.manifestFilename}
        AND bundle.archive_storage_key IS NOT DISTINCT FROM ${
          bundle.archiveStorageKey
        }
        AND bundle.archive_byte_size IS NOT DISTINCT FROM ${
          bundle.archiveByteSize
        }
        AND bundle.archive_fingerprint IS NOT DISTINCT FROM ${
          bundle.archiveFingerprint
        }
        AND bundle.archive_mime IS NOT DISTINCT FROM ${bundle.archiveMime}
        AND bundle.archive_filename IS NOT DISTINCT FROM ${
          bundle.archiveFilename
        }
        AND bundle.expires_at = ${bundle.expiresAt}
        AND bundle.expires_at > ${now}
        AND bundle.failure_code IS NOT DISTINCT FROM ${bundle.failureCode}
        AND bundle.failure_message IS NOT DISTINCT FROM ${bundle.failureMessage}
        AND bundle.created_at = ${bundle.createdAt}
        AND bundle.updated_at = ${bundle.updatedAt}
      RETURNING id
    `;
    if (!insertedRows.length) {
      throw new Error(
        `Support bundle download could not be authorized because its state changed: ${bundle.id}`
      );
    }

    await this.createAuditEvent({
      bundleId: bundle.id,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      eventType: 'download_authorized',
      metadata: {
        version: SUPPORT_BUNDLE_DOWNLOAD_AUTHORIZED_AUDIT_VERSION,
        authorizationId: id,
        authorizationFingerprint,
        artifactKind,
        artifactFilename,
        artifactMime,
        deliveryMethod,
        directDownloadExpiresAt: directDownloadExpiresAt?.toISOString() ?? null,
        hasDirectDownloadUrl: !!directDownloadUrl,
        manifestFingerprint: bundle.manifestFingerprint,
        artifactFingerprint,
        expiresAt: expiresAt.toISOString(),
      },
    });

    const authorization =
      await this.getDownloadAuthorizationByToken(downloadToken);
    if (!authorization) {
      throw new Error(`Created support bundle authorization not found: ${id}`);
    }

    return {
      ...authorization,
      downloadToken,
    };
  }

  @Transactional()
  async consumeDownload(input: {
    authorizationId: string;
    token: string;
  }): Promise<CopilotSupportBundleDownloadArtifact | null> {
    const authorization = await this.getDownloadAuthorizationByToken(
      input.token
    );
    if (!authorization || authorization.id !== input.authorizationId) {
      return null;
    }
    if (authorization.status !== 'authorized') {
      return null;
    }
    if (authorization.expiresAt.getTime() <= Date.now()) {
      await this.markDownloadAuthorizationExpired({
        authorization,
        source: 'api_proxy_consume',
      });
      return null;
    }
    if (authorization.deliveryMethod !== 'api_proxy') {
      return null;
    }

    const bundle = await this.get(
      authorization.workspaceId,
      authorization.bundleId
    );
    if (
      !bundle ||
      bundle.status !== 'ready' ||
      bundle.retentionStatus !== 'active' ||
      bundle.manifestFingerprint !== authorization.manifestFingerprint ||
      (authorization.artifactKind === 'archive_json' &&
        bundle.archiveFingerprint !== authorization.artifactFingerprint) ||
      bundle.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }

    const body =
      authorization.artifactKind === 'archive_json'
        ? await this.readArchiveArtifact(bundle)
        : await this.readManifestArtifact(bundle);
    if (!body) {
      return null;
    }

    const now = new Date();
    const downloadedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_support_bundle_download_authorizations AS authz
      SET
        status = ${'downloaded'},
        downloaded_at = ${now},
        updated_at = ${now}
      FROM ai_support_bundle_requests AS bundle
      WHERE
        authz.id = ${authorization.id}
        AND authz.bundle_id = bundle.id
        AND authz.bundle_id = ${authorization.bundleId}
        AND authz.workspace_id = ${authorization.workspaceId}
        AND authz.actor_id = ${authorization.actorId}
        AND authz.status = ${'authorized'}
        AND authz.artifact_kind = ${authorization.artifactKind}
        AND authz.artifact_filename = ${authorization.artifactFilename}
        AND authz.artifact_mime = ${authorization.artifactMime}
        AND authz.manifest_fingerprint = ${authorization.manifestFingerprint}
        AND authz.artifact_fingerprint = ${authorization.artifactFingerprint}
        AND authz.authorization_fingerprint = ${authorization.authorizationFingerprint}
        AND authz.token_fingerprint = ${authorization.tokenFingerprint}
        AND authz.delivery_method = ${'api_proxy'}
        AND authz.direct_download_url IS NOT DISTINCT FROM ${authorization.directDownloadUrl}
        AND authz.direct_download_expires_at IS NOT DISTINCT FROM ${authorization.directDownloadExpiresAt}
        AND authz.expires_at = ${authorization.expiresAt}
        AND authz.expires_at > ${now}
        AND authz.downloaded_at IS NOT DISTINCT FROM ${authorization.downloadedAt}
        AND authz.created_at = ${authorization.createdAt}
        AND authz.updated_at = ${authorization.updatedAt}
        AND bundle.id = ${bundle.id}
        AND bundle.workspace_id = ${bundle.workspaceId}
        AND bundle.actor_id = ${bundle.actorId}
        AND bundle.status = ${'ready'}
        AND bundle.retention_status = ${'active'}
        AND bundle.manifest_fingerprint = ${bundle.manifestFingerprint}
        AND bundle.manifest_fingerprint = authz.manifest_fingerprint
        AND (
          (
            authz.artifact_kind = ${'manifest_json'}
            AND bundle.manifest_fingerprint = authz.artifact_fingerprint
          )
          OR (
            authz.artifact_kind = ${'archive_json'}
            AND bundle.archive_fingerprint = authz.artifact_fingerprint
          )
        )
        AND bundle.expires_at = ${bundle.expiresAt}
        AND bundle.expires_at > ${now}
        AND bundle.updated_at = ${bundle.updatedAt}
      RETURNING authz.id
    `;
    if (!downloadedRows.length) {
      return null;
    }

    await this.createAuditEvent({
      bundleId: authorization.bundleId,
      workspaceId: authorization.workspaceId,
      actorId: authorization.actorId,
      eventType: 'downloaded',
      metadata: {
        authorizationId: authorization.id,
        authorizationFingerprint: authorization.authorizationFingerprint,
        artifactKind: authorization.artifactKind,
        artifactFilename: authorization.artifactFilename,
        artifactMime: authorization.artifactMime,
        manifestFingerprint: authorization.manifestFingerprint,
        artifactFingerprint: authorization.artifactFingerprint,
      },
    });

    return {
      ...authorization,
      status: 'downloaded',
      downloadedAt: now,
      updatedAt: now,
      body,
    };
  }

  async acknowledgeDirectDownload(input: {
    authorizationId: string;
    workspaceId: string;
    actorId: string;
  }): Promise<CopilotSupportBundleDownloadAuthorization> {
    const result = await this.acknowledgeDirectDownloadMutation(input);
    if (result.status === 'expired') {
      throw new Error('Support bundle download authorization has expired');
    }
    return result.authorization;
  }

  @Transactional()
  private async acknowledgeDirectDownloadMutation(input: {
    authorizationId: string;
    workspaceId: string;
    actorId: string;
  }): Promise<
    | {
        status: 'downloaded';
        authorization: CopilotSupportBundleDownloadAuthorization;
      }
    | { status: 'expired' }
  > {
    const authorization = await this.getDownloadAuthorizationById(
      input.workspaceId,
      input.authorizationId
    );
    if (!authorization) {
      throw new Error('Support bundle download authorization not found');
    }
    if (authorization.status !== 'authorized') {
      throw new Error('Support bundle download authorization is not active');
    }
    if (authorization.deliveryMethod !== 'object_storage_signed_url') {
      throw new Error(
        'Support bundle download authorization is not direct-delivery'
      );
    }
    if (
      !authorization.directDownloadUrl ||
      !authorization.directDownloadExpiresAt
    ) {
      throw new Error('Support bundle direct download URL is not available');
    }

    const now = new Date();
    const directExpiresAt = Math.min(
      authorization.expiresAt.getTime(),
      authorization.directDownloadExpiresAt.getTime()
    );
    if (directExpiresAt <= now.getTime()) {
      await this.markDownloadAuthorizationExpired({
        authorization,
        source: 'direct_download_acknowledge',
      });
      return { status: 'expired' };
    }

    const bundle = await this.get(
      authorization.workspaceId,
      authorization.bundleId
    );
    if (
      !bundle ||
      bundle.status !== 'ready' ||
      bundle.retentionStatus !== 'active' ||
      bundle.manifestFingerprint !== authorization.manifestFingerprint ||
      (authorization.artifactKind === 'manifest_json' &&
        bundle.manifestFingerprint !== authorization.artifactFingerprint) ||
      (authorization.artifactKind === 'archive_json' &&
        (!bundle.archiveFingerprint ||
          bundle.archiveFingerprint !== authorization.artifactFingerprint)) ||
      bundle.expiresAt.getTime() <= now.getTime()
    ) {
      throw new Error('Support bundle is not downloadable');
    }

    const updatedRows = await this.db.$queryRaw<
      CopilotSupportBundleDownloadAuthorization[]
    >`
      UPDATE ai_support_bundle_download_authorizations AS authz
      SET
        status = ${'downloaded'},
        downloaded_at = ${now},
        updated_at = ${now}
      FROM ai_support_bundle_requests AS bundle
      WHERE
        authz.id = ${authorization.id}
        AND authz.bundle_id = bundle.id
        AND authz.bundle_id = ${authorization.bundleId}
        AND authz.workspace_id = ${authorization.workspaceId}
        AND authz.actor_id = ${authorization.actorId}
        AND authz.status = ${'authorized'}
        AND authz.artifact_kind = ${authorization.artifactKind}
        AND authz.artifact_filename = ${authorization.artifactFilename}
        AND authz.artifact_mime = ${authorization.artifactMime}
        AND authz.manifest_fingerprint = ${authorization.manifestFingerprint}
        AND authz.artifact_fingerprint = ${authorization.artifactFingerprint}
        AND authz.authorization_fingerprint = ${authorization.authorizationFingerprint}
        AND authz.token_fingerprint = ${authorization.tokenFingerprint}
        AND authz.delivery_method = ${'object_storage_signed_url'}
        AND authz.direct_download_url IS NOT DISTINCT FROM ${authorization.directDownloadUrl}
        AND authz.direct_download_expires_at IS NOT DISTINCT FROM ${authorization.directDownloadExpiresAt}
        AND authz.expires_at = ${authorization.expiresAt}
        AND authz.expires_at > ${now}
        AND authz.downloaded_at IS NOT DISTINCT FROM ${authorization.downloadedAt}
        AND authz.created_at = ${authorization.createdAt}
        AND authz.updated_at = ${authorization.updatedAt}
        AND authz.direct_download_expires_at > ${now}
        AND bundle.id = ${bundle.id}
        AND bundle.workspace_id = ${bundle.workspaceId}
        AND bundle.actor_id = ${bundle.actorId}
        AND bundle.status = ${'ready'}
        AND bundle.retention_status = ${'active'}
        AND bundle.manifest_fingerprint = ${bundle.manifestFingerprint}
        AND bundle.manifest_fingerprint = authz.manifest_fingerprint
        AND (
          (
            authz.artifact_kind = ${'manifest_json'}
            AND bundle.manifest_fingerprint = authz.artifact_fingerprint
          )
          OR (
            authz.artifact_kind = ${'archive_json'}
            AND bundle.archive_fingerprint = authz.artifact_fingerprint
          )
        )
        AND bundle.expires_at = ${bundle.expiresAt}
        AND bundle.expires_at > ${now}
        AND bundle.updated_at = ${bundle.updatedAt}
      RETURNING
        authz.id,
        authz.bundle_id AS "bundleId",
        authz.workspace_id AS "workspaceId",
        authz.actor_id AS "actorId",
        authz.status,
        authz.artifact_kind AS "artifactKind",
        authz.artifact_filename AS "artifactFilename",
        authz.artifact_mime AS "artifactMime",
        authz.manifest_fingerprint AS "manifestFingerprint",
        authz.artifact_fingerprint AS "artifactFingerprint",
        authz.authorization_fingerprint AS "authorizationFingerprint",
        authz.token_fingerprint AS "tokenFingerprint",
        authz.delivery_method AS "deliveryMethod",
        authz.direct_download_url AS "directDownloadUrl",
        authz.direct_download_expires_at AS "directDownloadExpiresAt",
        authz.expires_at AS "expiresAt",
        authz.downloaded_at AS "downloadedAt",
        authz.created_at AS "createdAt",
        authz.updated_at AS "updatedAt"
    `;
    const updatedAuthorization = updatedRows[0];
    if (!updatedAuthorization) {
      throw new Error(
        `Support bundle direct download acknowledgement could not update authorization because its authorization or bundle state changed: ${authorization.id}`
      );
    }

    await this.createAuditEvent({
      bundleId: updatedAuthorization.bundleId,
      workspaceId: updatedAuthorization.workspaceId,
      actorId: input.actorId,
      eventType: 'downloaded',
      metadata: {
        authorizationId: updatedAuthorization.id,
        authorizationActorId: updatedAuthorization.actorId,
        authorizationFingerprint: updatedAuthorization.authorizationFingerprint,
        artifactKind: updatedAuthorization.artifactKind,
        artifactFilename: updatedAuthorization.artifactFilename,
        artifactMime: updatedAuthorization.artifactMime,
        deliveryMethod: updatedAuthorization.deliveryMethod,
        directDownloadExpiresAt:
          updatedAuthorization.directDownloadExpiresAt?.toISOString() ?? null,
        clientAcknowledged: true,
        manifestFingerprint: updatedAuthorization.manifestFingerprint,
        artifactFingerprint: updatedAuthorization.artifactFingerprint,
      },
    });

    return {
      status: 'downloaded',
      authorization: updatedAuthorization,
    };
  }

  async ingestDirectDownloadTransferEvent(
    input: CopilotSupportBundleDirectDownloadTransferEvent
  ): Promise<CopilotSupportBundleDownloadAuthorization> {
    const result = await this.ingestDirectDownloadTransferEventMutation(input);
    if (result.status === 'expired') {
      throw new Error('Support bundle download authorization has expired');
    }
    return result.authorization;
  }

  @Transactional()
  private async ingestDirectDownloadTransferEventMutation(
    input: CopilotSupportBundleDirectDownloadTransferEvent
  ): Promise<
    | {
        status: 'processed';
        authorization: CopilotSupportBundleDownloadAuthorization;
      }
    | { status: 'expired' }
  > {
    const authorization = await this.getDownloadAuthorizationByIdForTransfer(
      input.authorizationId
    );
    if (!authorization) {
      throw new Error('Support bundle download authorization not found');
    }
    if (authorization.deliveryMethod !== 'object_storage_signed_url') {
      throw new Error(
        'Support bundle download authorization is not direct-delivery'
      );
    }
    if (
      !authorization.directDownloadUrl ||
      !authorization.directDownloadExpiresAt
    ) {
      throw new Error('Support bundle direct download URL is not available');
    }

    const now = new Date();
    const transferredAt = input.transferredAt ?? now;
    if (transferredAt.getTime() > now.getTime() + 60_000) {
      throw new Error('Support bundle transfer event is from the future');
    }
    if (transferredAt.getTime() < authorization.createdAt.getTime()) {
      throw new Error(
        'Support bundle transfer event predates the authorization'
      );
    }
    const directExpiresAt = Math.min(
      authorization.expiresAt.getTime(),
      authorization.directDownloadExpiresAt.getTime()
    );
    if (authorization.status === 'downloaded') {
      const replay = await this.verifyDownloadedDirectDownloadTransferReplay({
        authorization,
        event: input,
        transferredAt,
      });
      if (replay) {
        await this.createDirectDownloadTransferEvent({
          authorization,
          transferEvent: replay,
        });
      }
      return {
        status: 'processed',
        authorization,
      };
    }
    if (authorization.status !== 'authorized') {
      throw new Error('Support bundle download authorization is not active');
    }
    if (directExpiresAt < transferredAt.getTime()) {
      if (directExpiresAt <= now.getTime()) {
        await this.markDownloadAuthorizationExpired({
          authorization,
          source: 'direct_download_transfer_event',
        });
        return { status: 'expired' };
      }
      throw new Error('Support bundle download authorization has expired');
    }

    const bundle = await this.get(
      authorization.workspaceId,
      authorization.bundleId
    );
    if (
      !bundle ||
      bundle.status !== 'ready' ||
      bundle.retentionStatus !== 'active' ||
      bundle.manifestFingerprint !== authorization.manifestFingerprint ||
      (authorization.artifactKind === 'manifest_json' &&
        bundle.manifestFingerprint !== authorization.artifactFingerprint) ||
      (authorization.artifactKind === 'archive_json' &&
        (!bundle.archiveFingerprint ||
          bundle.archiveFingerprint !== authorization.artifactFingerprint)) ||
      bundle.expiresAt.getTime() <= now.getTime()
    ) {
      throw new Error('Support bundle is not downloadable');
    }

    const transferEvent = await this.buildVerifiedDirectDownloadTransferEvent({
      authorization,
      bundle,
      event: input,
      transferredAt,
    });
    const updatedRows = await this.db.$queryRaw<
      CopilotSupportBundleDownloadAuthorization[]
    >`
      UPDATE ai_support_bundle_download_authorizations AS authz
      SET
        status = ${'downloaded'},
        downloaded_at = ${transferredAt},
        updated_at = ${now}
      FROM ai_support_bundle_requests AS bundle
      WHERE
        authz.id = ${authorization.id}
        AND authz.bundle_id = bundle.id
        AND authz.bundle_id = ${authorization.bundleId}
        AND authz.workspace_id = ${authorization.workspaceId}
        AND authz.actor_id = ${authorization.actorId}
        AND authz.status = ${'authorized'}
        AND authz.artifact_kind = ${authorization.artifactKind}
        AND authz.artifact_filename = ${authorization.artifactFilename}
        AND authz.artifact_mime = ${authorization.artifactMime}
        AND authz.manifest_fingerprint = ${authorization.manifestFingerprint}
        AND authz.artifact_fingerprint = ${authorization.artifactFingerprint}
        AND authz.authorization_fingerprint = ${authorization.authorizationFingerprint}
        AND authz.token_fingerprint = ${authorization.tokenFingerprint}
        AND authz.delivery_method = ${'object_storage_signed_url'}
        AND authz.direct_download_url IS NOT DISTINCT FROM ${authorization.directDownloadUrl}
        AND authz.direct_download_expires_at IS NOT DISTINCT FROM ${authorization.directDownloadExpiresAt}
        AND authz.expires_at = ${authorization.expiresAt}
        AND authz.expires_at >= ${transferredAt}
        AND authz.downloaded_at IS NOT DISTINCT FROM ${authorization.downloadedAt}
        AND authz.created_at = ${authorization.createdAt}
        AND authz.updated_at = ${authorization.updatedAt}
        AND authz.direct_download_expires_at >= ${transferredAt}
        AND bundle.id = ${bundle.id}
        AND bundle.workspace_id = ${bundle.workspaceId}
        AND bundle.actor_id = ${bundle.actorId}
        AND bundle.status = ${'ready'}
        AND bundle.retention_status = ${'active'}
        AND bundle.manifest_fingerprint = ${bundle.manifestFingerprint}
        AND bundle.manifest_fingerprint = authz.manifest_fingerprint
        AND (
          (
            authz.artifact_kind = ${'manifest_json'}
            AND bundle.manifest_fingerprint = authz.artifact_fingerprint
          )
          OR (
            authz.artifact_kind = ${'archive_json'}
            AND bundle.archive_fingerprint = authz.artifact_fingerprint
          )
        )
        AND bundle.expires_at = ${bundle.expiresAt}
        AND bundle.expires_at > ${now}
        AND bundle.updated_at = ${bundle.updatedAt}
      RETURNING
        authz.id,
        authz.bundle_id AS "bundleId",
        authz.workspace_id AS "workspaceId",
        authz.actor_id AS "actorId",
        authz.status,
        authz.artifact_kind AS "artifactKind",
        authz.artifact_filename AS "artifactFilename",
        authz.artifact_mime AS "artifactMime",
        authz.manifest_fingerprint AS "manifestFingerprint",
        authz.artifact_fingerprint AS "artifactFingerprint",
        authz.authorization_fingerprint AS "authorizationFingerprint",
        authz.token_fingerprint AS "tokenFingerprint",
        authz.delivery_method AS "deliveryMethod",
        authz.direct_download_url AS "directDownloadUrl",
        authz.direct_download_expires_at AS "directDownloadExpiresAt",
        authz.expires_at AS "expiresAt",
        authz.downloaded_at AS "downloadedAt",
        authz.created_at AS "createdAt",
        authz.updated_at AS "updatedAt"
    `;
    const updatedAuthorization = updatedRows[0];
    if (!updatedAuthorization) {
      throw new Error(
        `Support bundle direct download transfer event could not update authorization because its authorization or bundle state changed: ${authorization.id}`
      );
    }

    await this.createDirectDownloadTransferEvent({
      authorization: updatedAuthorization,
      transferEvent,
    });
    await this.createAuditEvent({
      bundleId: updatedAuthorization.bundleId,
      workspaceId: updatedAuthorization.workspaceId,
      actorId: updatedAuthorization.actorId,
      eventType: 'downloaded',
      metadata: {
        authorizationId: updatedAuthorization.id,
        authorizationFingerprint: updatedAuthorization.authorizationFingerprint,
        artifactKind: updatedAuthorization.artifactKind,
        artifactFilename: updatedAuthorization.artifactFilename,
        artifactMime: updatedAuthorization.artifactMime,
        deliveryMethod: updatedAuthorization.deliveryMethod,
        directDownloadExpiresAt:
          updatedAuthorization.directDownloadExpiresAt?.toISOString() ?? null,
        clientAcknowledged: false,
        providerTransferEvent: true,
        transferEventId: transferEvent.eventId,
        transferEventSource: transferEvent.eventSource,
        transferredAt: transferEvent.transferredAt.toISOString(),
        serverVerified: true,
        notificationAuthEvidence: transferEvent.notificationAuthEvidence,
        notificationAuthEvidenceFingerprint:
          transferEvent.notificationAuthEvidenceFingerprint,
        storageKey: transferEvent.storageKey,
        storageByteSize: transferEvent.storageByteSize,
        storageContentType: transferEvent.storageContentType,
        manifestFingerprint: updatedAuthorization.manifestFingerprint,
        artifactFingerprint: updatedAuthorization.artifactFingerprint,
        transferEventFingerprint: transferEvent.eventFingerprint,
      },
    });

    return {
      status: 'processed',
      authorization: updatedAuthorization,
    };
  }

  async enqueueDirectDownloadTransferForwardingEvent(input: {
    transferEvent: CopilotSupportBundleDirectDownloadTransferEvent;
    maxAttempts?: number;
  }): Promise<CopilotSupportBundleTransferForwardingEventRecord> {
    const authorization = await this.getDownloadAuthorizationByIdForTransfer(
      input.transferEvent.authorizationId
    );
    if (!authorization) {
      throw new Error('Support bundle download authorization not found');
    }
    const maxAttempts = Math.min(
      Math.max(
        input.maxAttempts ??
          SUPPORT_BUNDLE_TRANSFER_FORWARDING_DEFAULT_MAX_ATTEMPTS,
        1
      ),
      10
    );
    const eventSource =
      input.transferEvent.eventSource ?? 'object_storage_event';
    const eventId = input.transferEvent.eventId ?? null;
    const transferredAt = input.transferEvent.transferredAt?.toISOString();
    const notificationAuthEvidence = normalizeTransferNotificationAuthEvidence(
      input.transferEvent.notificationAuthEvidence
    );
    if (
      providerTransferEventSourceRequiresSignatureEvidence(eventSource) &&
      !notificationAuthEvidence.providerSignatureEvidence
    ) {
      throw new Error('Support bundle transfer event auth evidence is invalid');
    }
    const providerSignatureFingerprint = providerSignatureEvidenceFingerprint(
      notificationAuthEvidence.providerSignatureEvidence
    );
    const { payload, serialized } = normalizeForwardingPayload({
      version: SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_VERSION,
      event: {
        authorizationId: input.transferEvent.authorizationId,
        ...(eventId ? { eventId } : {}),
        eventSource,
        ...(input.transferEvent.storageKey
          ? { storageKey: input.transferEvent.storageKey }
          : {}),
        notificationAuthEvidence,
        ...(input.transferEvent.artifactByteSize !== undefined
          ? { artifactByteSize: input.transferEvent.artifactByteSize }
          : {}),
        ...(input.transferEvent.artifactFingerprint
          ? { artifactFingerprint: input.transferEvent.artifactFingerprint }
          : {}),
        ...(transferredAt ? { transferredAt } : {}),
      },
    });
    const forwardingPayloadFingerprint = supportBundleFingerprint({
      version: SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_VERSION,
      payload,
    });
    const forwardingEventFingerprint = supportBundleFingerprint({
      version: SUPPORT_BUNDLE_TRANSFER_FORWARDING_EVENT_VERSION,
      authorizationId: input.transferEvent.authorizationId,
      eventId,
      eventSource,
      forwardingPayloadFingerprint,
      providerSignatureEvidenceFingerprint: providerSignatureFingerprint,
    });
    const id = [
      'support-bundle-transfer-forwarding',
      input.transferEvent.authorizationId,
      forwardingEventFingerprint,
    ].join('-');
    const now = new Date();

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_support_bundle_transfer_forwarding_events (
        id,
        authorization_id,
        status,
        event_id,
        event_source,
        forwarding_event_fingerprint,
        forwarding_payload,
        forwarding_payload_fingerprint,
        provider_signature_evidence_fingerprint,
        attempt_count,
        max_attempts,
        next_attempt_at,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${input.transferEvent.authorizationId},
        ${'queued'},
        ${eventId},
        ${eventSource},
        ${forwardingEventFingerprint},
        ${serialized}::jsonb,
        ${forwardingPayloadFingerprint},
        ${providerSignatureFingerprint},
        ${0},
        ${maxAttempts},
        ${now},
        ${now},
        ${now}
      )
      ON CONFLICT (authorization_id, forwarding_event_fingerprint) DO NOTHING
      RETURNING id
    `;

    const record = insertedRows.length
      ? await this.getDirectDownloadTransferForwardingEvent(id)
      : await this.getDirectDownloadTransferForwardingEventByFingerprint({
          authorizationId: input.transferEvent.authorizationId,
          forwardingEventFingerprint,
        });
    if (!record) {
      throw new Error(
        insertedRows.length
          ? 'Support bundle transfer forwarding event was not queued'
          : 'Support bundle transfer forwarding event conflict could not be verified'
      );
    }
    this.assertDirectDownloadTransferForwardingEventMatchesConflictEvidence(
      record,
      {
        authorizationId: input.transferEvent.authorizationId,
        eventId,
        eventSource,
        forwardingEventFingerprint,
        forwardingPayloadFingerprint,
        providerSignatureEvidenceFingerprint: providerSignatureFingerprint,
      }
    );
    return record;
  }

  async replayDeadLetteredDirectDownloadTransferForwardingEvent(input: {
    workspaceId: string;
    actorId: string;
    forwardingEventId: string;
    maxAttempts?: number;
  }): Promise<CopilotSupportBundleTransferForwardingEventRecord> {
    const rows = await this.db.$queryRaw<
      Array<
        CopilotSupportBundleTransferForwardingEventRecord & {
          workspaceId: string;
        }
      >
    >`
      SELECT
        forwarding.id,
        forwarding.authorization_id AS "authorizationId",
        forwarding.status,
        forwarding.event_id AS "eventId",
        forwarding.event_source AS "eventSource",
        forwarding.forwarding_event_fingerprint AS "forwardingEventFingerprint",
        forwarding.forwarding_payload AS "forwardingPayload",
        forwarding.forwarding_payload_fingerprint AS "forwardingPayloadFingerprint",
        forwarding.provider_signature_evidence_fingerprint AS "providerSignatureEvidenceFingerprint",
        forwarding.forwarded_transfer_event_fingerprint AS "forwardedTransferEventFingerprint",
        forwarding.attempt_count AS "attemptCount",
        forwarding.max_attempts AS "maxAttempts",
        forwarding.next_attempt_at AS "nextAttemptAt",
        forwarding.worker_lease_id AS "workerLeaseId",
        forwarding.worker_lease_expires_at AS "workerLeaseExpiresAt",
        forwarding.last_attempt_at AS "lastAttemptAt",
        forwarding.forwarded_at AS "forwardedAt",
        forwarding.dead_lettered_at AS "deadLetteredAt",
        forwarding.failure_code AS "failureCode",
        forwarding.failure_message AS "failureMessage",
        forwarding.created_at AS "createdAt",
        forwarding.updated_at AS "updatedAt",
        authz.workspace_id AS "workspaceId"
      FROM ai_support_bundle_transfer_forwarding_events forwarding
      JOIN ai_support_bundle_download_authorizations authz
        ON authz.id = forwarding.authorization_id
      WHERE forwarding.id = ${input.forwardingEventId}
        AND authz.workspace_id = ${input.workspaceId}
      LIMIT 1
    `;
    const previous = rows[0]
      ? hydrateTransferForwardingEventRecord(rows[0])
      : null;
    if (!previous) {
      throw new Error('Support bundle transfer forwarding event not found');
    }
    if (previous.status !== 'dead_lettered') {
      throw new Error(
        'Support bundle transfer forwarding event is not dead-lettered'
      );
    }

    return await this.createDeadLetteredDirectDownloadTransferForwardingReplayEvent(
      {
        actorId: input.actorId,
        maxAttempts: input.maxAttempts,
        sourceEvent: previous,
        workspaceId: input.workspaceId,
      }
    );
  }

  private async createDeadLetteredDirectDownloadTransferForwardingReplayEvent(input: {
    actorId: string;
    maxAttempts?: number;
    sourceEvent: CopilotSupportBundleTransferForwardingEventRecord;
    workspaceId: string;
  }): Promise<CopilotSupportBundleTransferForwardingEventRecord> {
    const previous = input.sourceEvent;
    if (previous.status !== 'dead_lettered') {
      throw new Error(
        'Support bundle transfer forwarding event is not dead-lettered'
      );
    }

    const transferEvent =
      this.directDownloadTransferEventFromForwardingPayload(previous);
    const eventSource = transferEvent.eventSource ?? 'object_storage_event';
    const eventId = transferEvent.eventId ?? null;
    const notificationAuthEvidence = normalizeTransferNotificationAuthEvidence(
      transferEvent.notificationAuthEvidence
    );
    const providerSignatureFingerprint = providerSignatureEvidenceFingerprint(
      notificationAuthEvidence.providerSignatureEvidence
    );
    if (
      previous.providerSignatureEvidenceFingerprint &&
      previous.providerSignatureEvidenceFingerprint !==
        providerSignatureFingerprint
    ) {
      throw new Error('Support bundle transfer event auth evidence is invalid');
    }

    const now = new Date();
    const replay = {
      version: SUPPORT_BUNDLE_TRANSFER_FORWARDING_REPLAY_VERSION,
      actorId: input.actorId,
      replayId: randomUUID(),
      replayedAt: now.toISOString(),
      sourceForwardingEventId: previous.id,
      sourceForwardingEventFingerprint: previous.forwardingEventFingerprint,
      sourceForwardingPayloadFingerprint: previous.forwardingPayloadFingerprint,
      sourceAttemptCount: previous.attemptCount,
      sourceMaxAttempts: previous.maxAttempts,
      sourceDeadLetteredAt: previous.deadLetteredAt?.toISOString() ?? null,
      sourceFailureCode: previous.failureCode,
      sourceFailureMessage: previous.failureMessage,
    };
    const { payload, serialized } = normalizeForwardingPayload({
      version: SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_VERSION,
      event: {
        authorizationId: transferEvent.authorizationId,
        ...(eventId ? { eventId } : {}),
        eventSource,
        ...(transferEvent.storageKey
          ? { storageKey: transferEvent.storageKey }
          : {}),
        notificationAuthEvidence,
        ...(transferEvent.artifactByteSize !== undefined
          ? { artifactByteSize: transferEvent.artifactByteSize }
          : {}),
        ...(transferEvent.artifactFingerprint
          ? { artifactFingerprint: transferEvent.artifactFingerprint }
          : {}),
        ...(transferEvent.transferredAt
          ? { transferredAt: transferEvent.transferredAt.toISOString() }
          : {}),
      },
      replay,
    });
    const forwardingPayloadFingerprint = supportBundleFingerprint({
      version: SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_VERSION,
      payload,
    });
    const forwardingEventFingerprint = supportBundleFingerprint({
      version: SUPPORT_BUNDLE_TRANSFER_FORWARDING_EVENT_VERSION,
      authorizationId: transferEvent.authorizationId,
      eventId,
      eventSource,
      forwardingPayloadFingerprint,
      providerSignatureEvidenceFingerprint: providerSignatureFingerprint,
    });
    const maxAttempts = Math.min(
      Math.max(
        input.maxAttempts ??
          SUPPORT_BUNDLE_TRANSFER_FORWARDING_DEFAULT_MAX_ATTEMPTS,
        1
      ),
      10
    );
    const id = [
      'support-bundle-transfer-forwarding-replay',
      transferEvent.authorizationId,
      forwardingEventFingerprint,
    ].join('-');

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_support_bundle_transfer_forwarding_events (
        id,
        authorization_id,
        status,
        event_id,
        event_source,
        forwarding_event_fingerprint,
        forwarding_payload,
        forwarding_payload_fingerprint,
        provider_signature_evidence_fingerprint,
        attempt_count,
        max_attempts,
        next_attempt_at,
        created_at,
        updated_at
      )
      SELECT
        ${id},
        source.authorization_id,
        ${'queued'},
        ${eventId},
        ${eventSource},
        ${forwardingEventFingerprint},
        ${serialized}::jsonb,
        ${forwardingPayloadFingerprint},
        ${providerSignatureFingerprint},
        ${0},
        ${maxAttempts},
        ${now},
        ${now},
        ${now}
      FROM ai_support_bundle_transfer_forwarding_events source
      JOIN ai_support_bundle_download_authorizations authz
        ON authz.id = source.authorization_id
      WHERE source.id = ${previous.id}
        AND authz.workspace_id = ${input.workspaceId}
        AND source.authorization_id = ${previous.authorizationId}
        AND source.status = ${previous.status}
        AND source.status = ${'dead_lettered'}
        AND source.event_id IS NOT DISTINCT FROM ${previous.eventId}
        AND source.event_source = ${previous.eventSource}
        AND source.forwarding_event_fingerprint = ${previous.forwardingEventFingerprint}
        AND source.forwarding_payload = ${toJsonString(previous.forwardingPayload)}::jsonb
        AND source.forwarding_payload_fingerprint = ${previous.forwardingPayloadFingerprint}
        AND source.provider_signature_evidence_fingerprint IS NOT DISTINCT FROM ${
          previous.providerSignatureEvidenceFingerprint
        }
        AND source.forwarded_transfer_event_fingerprint IS NOT DISTINCT FROM ${
          previous.forwardedTransferEventFingerprint
        }
        AND source.attempt_count = ${previous.attemptCount}
        AND source.max_attempts = ${previous.maxAttempts}
        AND source.next_attempt_at IS NOT DISTINCT FROM ${previous.nextAttemptAt}
        AND source.worker_lease_id IS NOT DISTINCT FROM ${previous.workerLeaseId}
        AND source.worker_lease_expires_at IS NOT DISTINCT FROM ${
          previous.workerLeaseExpiresAt
        }
        AND source.last_attempt_at IS NOT DISTINCT FROM ${previous.lastAttemptAt}
        AND source.forwarded_at IS NOT DISTINCT FROM ${previous.forwardedAt}
        AND source.dead_lettered_at IS NOT DISTINCT FROM ${previous.deadLetteredAt}
        AND source.failure_code IS NOT DISTINCT FROM ${previous.failureCode}
        AND source.failure_message IS NOT DISTINCT FROM ${previous.failureMessage}
        AND source.created_at = ${previous.createdAt}
        AND source.updated_at = ${previous.updatedAt}
      RETURNING id
    `;
    if (!insertedRows.length) {
      throw new Error(
        `Support bundle transfer forwarding replay event could not be queued because its source forwarding event state changed: ${previous.id}`
      );
    }

    const record = await this.getDirectDownloadTransferForwardingEvent(id);
    if (!record) {
      throw new Error(
        'Support bundle transfer forwarding replay event was not queued'
      );
    }
    return record;
  }

  async processDirectDownloadTransferForwardingEvent(input: {
    id: string;
  }): Promise<{
    event: CopilotSupportBundleTransferForwardingEventRecord;
    authorization: CopilotSupportBundleDownloadAuthorization | null;
  }> {
    const leased = await this.leaseDirectDownloadTransferForwardingEvents({
      id: input.id,
      limit: 1,
    });
    const event =
      leased[0] ??
      (await this.getDirectDownloadTransferForwardingEvent(input.id));
    if (!event) {
      throw new Error('Support bundle transfer forwarding event not found');
    }
    if (!leased[0]) {
      const authorization =
        event.status === 'forwarded'
          ? await this.getDownloadAuthorizationByIdForTransfer(
              event.authorizationId
            )
          : null;
      return {
        event,
        authorization,
      };
    }

    return await this.processLeasedDirectDownloadTransferForwardingEvent(
      leased[0]
    );
  }

  async processDueDirectDownloadTransferForwardingEvents(
    input: {
      limit?: number;
    } = {}
  ): Promise<CopilotSupportBundleTransferForwardingEventProcessingResult> {
    const processedAt = new Date();
    const limit = normalizeCleanupLimit(input.limit);
    const leased = await this.leaseDirectDownloadTransferForwardingEvents({
      limit,
    });
    let forwardedCount = 0;
    let retryScheduledCount = 0;
    let deadLetteredCount = 0;
    let failedCount = 0;

    for (const event of leased) {
      const result =
        await this.processLeasedDirectDownloadTransferForwardingEvent(event);
      if (result.event.status === 'forwarded') {
        forwardedCount += 1;
      } else if (result.event.status === 'retry_scheduled') {
        retryScheduledCount += 1;
        failedCount += 1;
      } else if (result.event.status === 'dead_lettered') {
        deadLetteredCount += 1;
        failedCount += 1;
      }
    }

    return {
      processedAt,
      processedCount: leased.length,
      forwardedCount,
      retryScheduledCount,
      deadLetteredCount,
      failedCount,
      eventIds: leased.map(event => event.id),
    };
  }

  async countAuditEvents(bundleId: string) {
    const rows = await this.db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS "count"
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundleId}
    `;
    return rows[0]?.count ?? 0;
  }

  @Transactional()
  async expireDueDownloadAuthorizations(
    input: {
      limit?: number;
    } = {}
  ): Promise<CopilotSupportBundleDownloadAuthorizationCleanupResult> {
    const limit = normalizeCleanupLimit(input.limit);
    const cleanedAt = new Date();
    const expiredRows = await this.db.$queryRaw<
      Array<{
        actorId: string;
        artifactFingerprint: string;
        artifactKind: string;
        authorizationFingerprint: string;
        bundleId: string;
        deliveryMethod: string;
        expiresAt: Date;
        id: string;
        workspaceId: string;
      }>
    >`
      WITH due_authorizations AS (
        SELECT id
        FROM ai_support_bundle_download_authorizations
        WHERE status = ${'authorized'}
          AND expires_at <= ${cleanedAt}
        ORDER BY expires_at ASC, created_at ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ai_support_bundle_download_authorizations authz
      SET
        status = ${'expired'},
        updated_at = ${cleanedAt}
      FROM due_authorizations
      WHERE authz.id = due_authorizations.id
      RETURNING
        authz.actor_id AS "actorId",
        authz.artifact_fingerprint AS "artifactFingerprint",
        authz.artifact_kind AS "artifactKind",
        authz.authorization_fingerprint AS "authorizationFingerprint",
        authz.bundle_id AS "bundleId",
        authz.delivery_method AS "deliveryMethod",
        authz.expires_at AS "expiresAt",
        authz.id,
        authz.workspace_id AS "workspaceId"
    `;
    const cleanupFingerprint = supportBundleFingerprint({
      version: 'copilot-support-bundle-download-authorization-cleanup/v1',
      cleanedAt: cleanedAt.toISOString(),
      expiredAuthorizationIds: expiredRows.map(row => row.id),
      limit,
    });

    await this.createDownloadAuthorizationExpirationAuditEvents({
      cleanupActorId: 'system_download_authorization_cleanup_worker',
      cleanupFingerprint,
      cleanupScope: 'scheduled_worker',
      expiredAt: cleanedAt,
      rows: expiredRows,
    });

    return {
      cleanedAt,
      cleanupFingerprint,
      expiredAuthorizationCount: expiredRows.length,
      expiredAuthorizationIds: expiredRows.map(row => row.id),
    };
  }

  @Transactional()
  async cleanupRetention(input: {
    workspaceId: string;
    actorId: string;
    limit?: number;
  }): Promise<CopilotSupportBundleRetentionCleanupResult> {
    const cleanup = await this.cleanupDueBundles({
      actorId: input.actorId,
      auditActorId: input.actorId,
      cleanupScope: 'manual_workspace',
      limit: input.limit,
      workspaceId: input.workspaceId,
    });

    return {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      cleanedAt: cleanup.cleanedAt,
      cleanupFingerprint: cleanup.cleanupFingerprint,
      expiredBundleCount: cleanup.expiredBundleCount,
      expiredAuthorizationCount: cleanup.expiredAuthorizationCount,
      archiveObjectCleanupRetryCount: cleanup.archiveObjectCleanupRetryCount,
      archiveObjectCleanupRecoveredCount:
        cleanup.archiveObjectCleanupRecoveredCount,
      archiveObjectCleanupFailedCount: cleanup.archiveObjectCleanupFailedCount,
      manifestObjectRewriteRetryCount: cleanup.manifestObjectRewriteRetryCount,
      manifestObjectRewriteRecoveredCount:
        cleanup.manifestObjectRewriteRecoveredCount,
      manifestObjectRewriteFailedCount:
        cleanup.manifestObjectRewriteFailedCount,
      expiredBundles: cleanup.expiredBundles,
    };
  }

  @Transactional()
  async cleanupScheduledRetention(
    input: {
      limit?: number;
    } = {}
  ): Promise<CopilotSupportBundleScheduledRetentionCleanupResult> {
    return await this.cleanupDueBundles({
      actorId: 'system_retention_worker',
      cleanupScope: 'scheduled_worker',
      limit: input.limit,
    });
  }

  private async cleanupDueBundles(input: {
    actorId: string;
    auditActorId?: string;
    cleanupScope: 'manual_workspace' | 'scheduled_worker';
    limit?: number;
    workspaceId?: string;
  }): Promise<CopilotSupportBundleScheduledRetentionCleanupResult> {
    const limit = normalizeCleanupLimit(input.limit);
    const cleanedAt = new Date();
    const dueBundleRows = await this.db.$queryRaw<CopilotSupportBundleRecord[]>`
      SELECT
        b.id,
        b.workspace_id AS "workspaceId",
        b.actor_id AS "actorId",
        b.status,
        b.source_evidence_summary AS "sourceEvidenceSummary",
        b.source_evidence_set_fingerprint AS "sourceEvidenceSetFingerprint",
        b.manifest_fingerprint AS "manifestFingerprint",
        b.manifest_json AS "manifestJson",
        b.manifest_storage_key AS "manifestStorageKey",
        b.manifest_byte_size AS "manifestByteSize",
        b.manifest_mime AS "manifestMime",
        b.manifest_filename AS "manifestFilename",
        b.archive_storage_key AS "archiveStorageKey",
        b.archive_byte_size AS "archiveByteSize",
        b.archive_fingerprint AS "archiveFingerprint",
        b.archive_mime AS "archiveMime",
        b.archive_filename AS "archiveFilename",
        b.retention_status AS "retentionStatus",
        b.expires_at AS "expiresAt",
        b.failure_code AS "failureCode",
        b.failure_message AS "failureMessage",
        b.created_at AS "createdAt",
        b.updated_at AS "updatedAt",
        COUNT(e.id)::int AS "auditEventCount"
      FROM ai_support_bundle_requests b
      LEFT JOIN ai_support_bundle_audit_events e ON e.bundle_id = b.id
      WHERE
        (${input.workspaceId ?? null}::varchar IS NULL OR b.workspace_id = ${input.workspaceId ?? null})
        AND b.retention_status = ${'active'}
        AND b.expires_at <= ${cleanedAt}
      GROUP BY b.id
      ORDER BY b.expires_at ASC, b.created_at ASC, b.id ASC
      LIMIT ${limit}
    `;
    const dueBundles = dueBundleRows.map(hydrateSupportBundleRecord);
    const retryLimit = Math.max(limit - dueBundles.length, 0);
    const archiveObjectCleanupRetryBundles = retryLimit
      ? await this.findArchiveObjectCleanupRetryBundles({
          limit: retryLimit,
          workspaceId: input.workspaceId,
        })
      : [];
    const manifestObjectRewriteRetryLimit = Math.max(
      retryLimit - archiveObjectCleanupRetryBundles.length,
      0
    );
    const manifestObjectRewriteRetryBundles = manifestObjectRewriteRetryLimit
      ? await this.findManifestObjectRewriteRetryBundles({
          limit: manifestObjectRewriteRetryLimit,
          workspaceId: input.workspaceId,
        })
      : [];
    const cleanupFingerprint = supportBundleFingerprint({
      version: 'copilot-support-bundle-retention-cleanup/v2',
      workspaceId: input.workspaceId ?? '*',
      actorId: input.actorId,
      cleanupScope: input.cleanupScope,
      cleanedAt: cleanedAt.toISOString(),
      bundleIds: dueBundles.map(bundle => bundle.id),
      archiveObjectCleanupRetryBundleIds: archiveObjectCleanupRetryBundles.map(
        bundle => bundle.id
      ),
      manifestObjectRewriteRetryBundleIds:
        manifestObjectRewriteRetryBundles.map(bundle => bundle.id),
    });

    let expiredAuthorizationCount = 0;
    let archiveObjectCleanupRetryCount = 0;
    let archiveObjectCleanupRecoveredCount = 0;
    let archiveObjectCleanupFailedCount = 0;
    let manifestObjectRewriteRetryCount = 0;
    let manifestObjectRewriteRecoveredCount = 0;
    let manifestObjectRewriteFailedCount = 0;
    const expiredBundles: CopilotSupportBundleRecord[] = [];

    for (const bundle of dueBundles) {
      const expiredManifest: CopilotSupportBundleManifest = {
        ...bundle.manifestJson,
        expiresAt: bundle.expiresAt.toISOString(),
        retention: {
          ...bundle.manifestJson.retention,
          status: 'expired',
          expiresAt: bundle.expiresAt.toISOString(),
        },
      };
      const expiredManifestFingerprint =
        supportBundleFingerprint(expiredManifest);
      const expiredManifestBody = Buffer.from(
        JSON.stringify(expiredManifest, null, 2),
        'utf8'
      );
      const updatedRows = await this.db.$queryRaw<Array<{ id: string }>>`
        UPDATE ai_support_bundle_requests
        SET
          status = ${'expired'},
          retention_status = ${'expired'},
          manifest_json = ${toJsonString(expiredManifest)}::jsonb,
          manifest_fingerprint = ${expiredManifestFingerprint},
          manifest_byte_size = CASE
            WHEN manifest_storage_key IS NULL THEN NULL
            ELSE ${expiredManifestBody.length}
          END,
          updated_at = ${cleanedAt}
        WHERE
          id = ${bundle.id}
          AND workspace_id = ${bundle.workspaceId}
          AND actor_id = ${bundle.actorId}
          AND status = ${bundle.status}
          AND source_evidence_summary = ${toJsonString(bundle.sourceEvidenceSummary)}::jsonb
          AND source_evidence_set_fingerprint = ${bundle.sourceEvidenceSetFingerprint}
          AND manifest_fingerprint = ${bundle.manifestFingerprint}
          AND manifest_json = ${toJsonString(bundle.manifestJson)}::jsonb
          AND manifest_storage_key IS NOT DISTINCT FROM ${bundle.manifestStorageKey}
          AND manifest_byte_size IS NOT DISTINCT FROM ${bundle.manifestByteSize}
          AND manifest_mime IS NOT DISTINCT FROM ${bundle.manifestMime}
          AND manifest_filename IS NOT DISTINCT FROM ${bundle.manifestFilename}
          AND archive_storage_key IS NOT DISTINCT FROM ${bundle.archiveStorageKey}
          AND archive_byte_size IS NOT DISTINCT FROM ${bundle.archiveByteSize}
          AND archive_fingerprint IS NOT DISTINCT FROM ${bundle.archiveFingerprint}
          AND archive_mime IS NOT DISTINCT FROM ${bundle.archiveMime}
          AND archive_filename IS NOT DISTINCT FROM ${bundle.archiveFilename}
          AND retention_status = ${'active'}
          AND expires_at = ${bundle.expiresAt}
          AND failure_code IS NOT DISTINCT FROM ${bundle.failureCode}
          AND failure_message IS NOT DISTINCT FROM ${bundle.failureMessage}
          AND created_at = ${bundle.createdAt}
          AND updated_at = ${bundle.updatedAt}
        RETURNING id
      `;
      if (!updatedRows.length) {
        continue;
      }

      const manifestObjectRewrite = await this.rewriteManifestObject({
        bundle,
        body: expiredManifestBody,
      });
      const archiveObjectCleanup = await this.cleanupArchiveObject(bundle);

      const authorizationRows = await this.db.$queryRaw<
        Array<{
          actorId: string;
          artifactFingerprint: string;
          artifactKind: string;
          authorizationFingerprint: string;
          bundleId: string;
          deliveryMethod: string;
          expiresAt: Date;
          id: string;
          workspaceId: string;
        }>
      >`
        UPDATE ai_support_bundle_download_authorizations
        SET
          status = ${'expired'},
          updated_at = ${cleanedAt}
        WHERE
          bundle_id = ${bundle.id}
          AND status = ${'authorized'}
        RETURNING
          actor_id AS "actorId",
          artifact_fingerprint AS "artifactFingerprint",
          artifact_kind AS "artifactKind",
          authorization_fingerprint AS "authorizationFingerprint",
          bundle_id AS "bundleId",
          delivery_method AS "deliveryMethod",
          expires_at AS "expiresAt",
          id,
          workspace_id AS "workspaceId"
      `;
      expiredAuthorizationCount += authorizationRows.length;
      await this.createDownloadAuthorizationExpirationAuditEvents({
        actorId: input.auditActorId ?? bundle.actorId,
        cleanupActorId: input.actorId,
        cleanupFingerprint,
        cleanupScope: 'retention_cleanup',
        expiredAt: cleanedAt,
        rows: authorizationRows,
      });

      await this.createAuditEvent({
        bundleId: bundle.id,
        workspaceId: bundle.workspaceId,
        actorId: input.auditActorId ?? bundle.actorId,
        eventType: 'retention_expired',
        metadata: {
          cleanupActorId: input.actorId,
          cleanupFingerprint,
          cleanupScope: input.cleanupScope,
          cleanedAt: cleanedAt.toISOString(),
          archiveObjectCleanupErrorCode: archiveObjectCleanup.errorCode ?? null,
          archiveObjectCleanupErrorMessage:
            archiveObjectCleanup.errorMessage ?? null,
          archiveObjectCleanupStatus: archiveObjectCleanup.status,
          archiveStorageKey: archiveObjectCleanup.archiveStorageKey,
          expiredAuthorizationCount: authorizationRows.length,
          manifestByteSize: expiredManifestBody.length,
          manifestObjectRewriteErrorCode:
            manifestObjectRewrite.errorCode ?? null,
          manifestObjectRewriteErrorMessage:
            manifestObjectRewrite.errorMessage ?? null,
          manifestObjectRewriteStatus: manifestObjectRewrite.status,
          manifestFingerprint: expiredManifestFingerprint,
          manifestStorageKey: manifestObjectRewrite.manifestStorageKey,
          previousManifestFingerprint: bundle.manifestFingerprint,
          retentionStatus: 'expired',
        },
      });

      const expiredBundle = await this.get(bundle.workspaceId, bundle.id);
      if (expiredBundle) {
        expiredBundles.push(expiredBundle);
      }
    }

    for (const bundle of archiveObjectCleanupRetryBundles) {
      const archiveObjectCleanup = await this.cleanupArchiveObject(bundle);
      archiveObjectCleanupRetryCount += 1;
      const archiveObjectCleanupFailureCount =
        bundle.archiveObjectCleanupFailureCount +
        (archiveObjectCleanup.status === 'failed' ? 1 : 0);
      const archiveObjectCleanupEscalationMetadata =
        input.cleanupScope === 'scheduled_worker' &&
        archiveObjectCleanup.status === 'failed' &&
        archiveObjectCleanupFailureCount >=
          SCHEDULED_ARCHIVE_OBJECT_CLEANUP_FAILURE_ESCALATION_THRESHOLD
          ? {
              archiveObjectCleanupEscalated: true,
              archiveObjectCleanupEscalatedAt: cleanedAt.toISOString(),
              archiveObjectCleanupEscalationReason:
                SCHEDULED_ARCHIVE_OBJECT_CLEANUP_ESCALATION_REASON,
            }
          : {};
      if (archiveObjectCleanup.status === 'failed') {
        archiveObjectCleanupFailedCount += 1;
      } else {
        archiveObjectCleanupRecoveredCount += 1;
      }

      await this.createRetentionRetryAuditEvent({
        bundle,
        actorId: input.auditActorId ?? bundle.actorId,
        retryKind: 'archive_object_cleanup',
        metadata: {
          cleanupActorId: input.actorId,
          cleanupFingerprint,
          cleanupScope: input.cleanupScope,
          cleanedAt: cleanedAt.toISOString(),
          archiveObjectCleanupErrorCode: archiveObjectCleanup.errorCode ?? null,
          archiveObjectCleanupErrorMessage:
            archiveObjectCleanup.errorMessage ?? null,
          archiveObjectCleanupFailureCount,
          archiveObjectCleanupRetry: true,
          archiveObjectCleanupStatus: archiveObjectCleanup.status,
          archiveStorageKey: archiveObjectCleanup.archiveStorageKey,
          ...archiveObjectCleanupEscalationMetadata,
          expiredAuthorizationCount: 0,
          manifestFingerprint: bundle.manifestFingerprint,
          previousArchiveObjectCleanupErrorCode:
            bundle.previousArchiveObjectCleanupErrorCode,
          previousArchiveObjectCleanupErrorMessage:
            bundle.previousArchiveObjectCleanupErrorMessage,
          previousArchiveObjectCleanupFingerprint:
            bundle.previousArchiveObjectCleanupFingerprint,
          previousManifestFingerprint: bundle.manifestFingerprint,
          retentionStatus: 'expired',
        },
      });
    }

    for (const bundle of manifestObjectRewriteRetryBundles) {
      const manifestBody = Buffer.from(
        JSON.stringify(bundle.manifestJson, null, 2),
        'utf8'
      );
      const manifestObjectRewrite = await this.rewriteManifestObject({
        bundle,
        body: manifestBody,
      });
      manifestObjectRewriteRetryCount += 1;
      const manifestObjectRewriteFailureCount =
        bundle.manifestObjectRewriteFailureCount +
        (manifestObjectRewrite.status === 'failed' ? 1 : 0);
      const manifestObjectRewriteEscalationMetadata =
        input.cleanupScope === 'scheduled_worker' &&
        manifestObjectRewrite.status === 'failed' &&
        manifestObjectRewriteFailureCount >=
          SCHEDULED_MANIFEST_OBJECT_REWRITE_FAILURE_ESCALATION_THRESHOLD
          ? {
              manifestObjectRewriteEscalated: true,
              manifestObjectRewriteEscalatedAt: cleanedAt.toISOString(),
              manifestObjectRewriteEscalationReason:
                SCHEDULED_MANIFEST_OBJECT_REWRITE_ESCALATION_REASON,
            }
          : {};
      if (manifestObjectRewrite.status === 'failed') {
        manifestObjectRewriteFailedCount += 1;
      } else {
        manifestObjectRewriteRecoveredCount += 1;
      }

      await this.createRetentionRetryAuditEvent({
        bundle,
        actorId: input.auditActorId ?? bundle.actorId,
        retryKind: 'manifest_object_rewrite',
        metadata: {
          cleanupActorId: input.actorId,
          cleanupFingerprint,
          cleanupScope: input.cleanupScope,
          cleanedAt: cleanedAt.toISOString(),
          expiredAuthorizationCount: 0,
          manifestByteSize: manifestBody.length,
          manifestFingerprint: bundle.manifestFingerprint,
          manifestObjectRewriteErrorCode:
            manifestObjectRewrite.errorCode ?? null,
          manifestObjectRewriteErrorMessage:
            manifestObjectRewrite.errorMessage ?? null,
          manifestObjectRewriteFailureCount,
          manifestObjectRewriteRetry: true,
          manifestObjectRewriteStatus: manifestObjectRewrite.status,
          manifestStorageKey: manifestObjectRewrite.manifestStorageKey,
          ...manifestObjectRewriteEscalationMetadata,
          previousManifestFingerprint: bundle.manifestFingerprint,
          previousManifestObjectRewriteErrorCode:
            bundle.previousManifestObjectRewriteErrorCode,
          previousManifestObjectRewriteErrorMessage:
            bundle.previousManifestObjectRewriteErrorMessage,
          previousManifestObjectRewriteFingerprint:
            bundle.previousManifestObjectRewriteFingerprint,
          retentionStatus: 'expired',
        },
      });
    }

    return {
      actorId: input.actorId,
      cleanedAt,
      cleanupFingerprint,
      expiredBundleCount: expiredBundles.length,
      expiredAuthorizationCount,
      archiveObjectCleanupRetryCount,
      archiveObjectCleanupRecoveredCount,
      archiveObjectCleanupFailedCount,
      manifestObjectRewriteRetryCount,
      manifestObjectRewriteRecoveredCount,
      manifestObjectRewriteFailedCount,
      expiredBundles,
    };
  }

  private async findArchiveObjectCleanupRetryBundles(input: {
    limit: number;
    workspaceId?: string;
  }) {
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleArchiveObjectCleanupRetryCandidate[]
    >`
      WITH latest_archive_cleanup AS (
        SELECT DISTINCT ON (e.bundle_id)
          e.bundle_id,
          e.id,
          e.actor_id,
          e.event_fingerprint,
          e.metadata,
          e.created_at
        FROM ai_support_bundle_audit_events e
        WHERE
          e.event_type = ${'retention_expired'}
          AND e.metadata ? 'archiveObjectCleanupStatus'
        ORDER BY e.bundle_id, e.created_at DESC, e.id DESC
      ),
      failed_cleanup_counts AS (
        SELECT
          e.bundle_id,
          COUNT(*)::int AS failure_count
        FROM ai_support_bundle_audit_events e
        WHERE
          e.event_type = ${'retention_expired'}
          AND e.metadata->>'archiveObjectCleanupStatus' = ${'failed'}
        GROUP BY e.bundle_id
      )
      SELECT
        b.id,
        b.workspace_id AS "workspaceId",
        b.actor_id AS "actorId",
        b.status,
        b.source_evidence_summary AS "sourceEvidenceSummary",
        b.source_evidence_set_fingerprint AS "sourceEvidenceSetFingerprint",
        b.manifest_fingerprint AS "manifestFingerprint",
        b.manifest_json AS "manifestJson",
        b.manifest_storage_key AS "manifestStorageKey",
        b.manifest_byte_size AS "manifestByteSize",
        b.manifest_mime AS "manifestMime",
        b.manifest_filename AS "manifestFilename",
        b.archive_storage_key AS "archiveStorageKey",
        b.archive_byte_size AS "archiveByteSize",
        b.archive_fingerprint AS "archiveFingerprint",
        b.archive_mime AS "archiveMime",
        b.archive_filename AS "archiveFilename",
        b.retention_status AS "retentionStatus",
        b.expires_at AS "expiresAt",
        b.failure_code AS "failureCode",
        b.failure_message AS "failureMessage",
        b.created_at AS "createdAt",
        b.updated_at AS "updatedAt",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_audit_events count_events
          WHERE count_events.bundle_id = b.id
        ) AS "auditEventCount",
        COALESCE(failed_cleanup_counts.failure_count, 0)::int
          AS "archiveObjectCleanupFailureCount",
        latest_archive_cleanup.actor_id
          AS "previousArchiveObjectCleanupAuditActorId",
        latest_archive_cleanup.created_at
          AS "previousArchiveObjectCleanupAuditCreatedAt",
        latest_archive_cleanup.event_fingerprint
          AS "previousArchiveObjectCleanupAuditEventFingerprint",
        latest_archive_cleanup.id
          AS "previousArchiveObjectCleanupAuditId",
        latest_archive_cleanup.metadata
          AS "previousArchiveObjectCleanupAuditMetadata",
        latest_archive_cleanup.metadata->>'archiveObjectCleanupErrorCode'
          AS "previousArchiveObjectCleanupErrorCode",
        latest_archive_cleanup.metadata->>'archiveObjectCleanupErrorMessage'
          AS "previousArchiveObjectCleanupErrorMessage",
        latest_archive_cleanup.metadata->>'cleanupFingerprint'
          AS "previousArchiveObjectCleanupFingerprint"
      FROM ai_support_bundle_requests b
      INNER JOIN latest_archive_cleanup
        ON latest_archive_cleanup.bundle_id = b.id
      LEFT JOIN failed_cleanup_counts
        ON failed_cleanup_counts.bundle_id = b.id
      WHERE
        (${input.workspaceId ?? null}::varchar IS NULL OR b.workspace_id = ${input.workspaceId ?? null})
        AND b.retention_status = ${'expired'}
        AND b.archive_storage_key IS NOT NULL
        AND latest_archive_cleanup.metadata->>'archiveObjectCleanupStatus' = ${'failed'}
        AND (
          ${input.workspaceId ?? null}::varchar IS NOT NULL
          OR latest_archive_cleanup.metadata->>'archiveObjectCleanupEscalated'
            IS DISTINCT FROM ${'true'}
        )
      ORDER BY latest_archive_cleanup.created_at ASC, b.expires_at ASC, b.created_at ASC, b.id ASC
      LIMIT ${input.limit}
    `;
    return rows.map(hydrateSupportBundleRecord);
  }

  private async findManifestObjectRewriteRetryBundles(input: {
    limit: number;
    workspaceId?: string;
  }) {
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleManifestObjectRewriteRetryCandidate[]
    >`
      WITH latest_manifest_rewrite AS (
        SELECT DISTINCT ON (e.bundle_id)
          e.bundle_id,
          e.id,
          e.actor_id,
          e.event_fingerprint,
          e.metadata,
          e.created_at
        FROM ai_support_bundle_audit_events e
        WHERE
          e.event_type = ${'retention_expired'}
          AND e.metadata ? 'manifestObjectRewriteStatus'
        ORDER BY e.bundle_id, e.created_at DESC, e.id DESC
      ),
      failed_rewrite_counts AS (
        SELECT
          e.bundle_id,
          COUNT(*)::int AS failure_count
        FROM ai_support_bundle_audit_events e
        WHERE
          e.event_type = ${'retention_expired'}
          AND e.metadata->>'manifestObjectRewriteStatus' = ${'failed'}
        GROUP BY e.bundle_id
      )
      SELECT
        b.id,
        b.workspace_id AS "workspaceId",
        b.actor_id AS "actorId",
        b.status,
        b.source_evidence_summary AS "sourceEvidenceSummary",
        b.source_evidence_set_fingerprint AS "sourceEvidenceSetFingerprint",
        b.manifest_fingerprint AS "manifestFingerprint",
        b.manifest_json AS "manifestJson",
        b.manifest_storage_key AS "manifestStorageKey",
        b.manifest_byte_size AS "manifestByteSize",
        b.manifest_mime AS "manifestMime",
        b.manifest_filename AS "manifestFilename",
        b.archive_storage_key AS "archiveStorageKey",
        b.archive_byte_size AS "archiveByteSize",
        b.archive_fingerprint AS "archiveFingerprint",
        b.archive_mime AS "archiveMime",
        b.archive_filename AS "archiveFilename",
        b.retention_status AS "retentionStatus",
        b.expires_at AS "expiresAt",
        b.failure_code AS "failureCode",
        b.failure_message AS "failureMessage",
        b.created_at AS "createdAt",
        b.updated_at AS "updatedAt",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_audit_events count_events
          WHERE count_events.bundle_id = b.id
        ) AS "auditEventCount",
        COALESCE(failed_rewrite_counts.failure_count, 0)::int
          AS "manifestObjectRewriteFailureCount",
        latest_manifest_rewrite.actor_id
          AS "previousManifestObjectRewriteAuditActorId",
        latest_manifest_rewrite.created_at
          AS "previousManifestObjectRewriteAuditCreatedAt",
        latest_manifest_rewrite.event_fingerprint
          AS "previousManifestObjectRewriteAuditEventFingerprint",
        latest_manifest_rewrite.id
          AS "previousManifestObjectRewriteAuditId",
        latest_manifest_rewrite.metadata
          AS "previousManifestObjectRewriteAuditMetadata",
        latest_manifest_rewrite.metadata->>'manifestObjectRewriteErrorCode'
          AS "previousManifestObjectRewriteErrorCode",
        latest_manifest_rewrite.metadata->>'manifestObjectRewriteErrorMessage'
          AS "previousManifestObjectRewriteErrorMessage",
        latest_manifest_rewrite.metadata->>'cleanupFingerprint'
          AS "previousManifestObjectRewriteFingerprint"
      FROM ai_support_bundle_requests b
      INNER JOIN latest_manifest_rewrite
        ON latest_manifest_rewrite.bundle_id = b.id
      LEFT JOIN failed_rewrite_counts
        ON failed_rewrite_counts.bundle_id = b.id
      WHERE
        (${input.workspaceId ?? null}::varchar IS NULL OR b.workspace_id = ${input.workspaceId ?? null})
        AND b.retention_status = ${'expired'}
        AND b.manifest_storage_key IS NOT NULL
        AND latest_manifest_rewrite.metadata->>'manifestObjectRewriteStatus' = ${'failed'}
        AND (
          ${input.workspaceId ?? null}::varchar IS NOT NULL
          OR latest_manifest_rewrite.metadata->>'manifestObjectRewriteEscalated'
            IS DISTINCT FROM ${'true'}
        )
      ORDER BY latest_manifest_rewrite.created_at ASC, b.expires_at ASC, b.created_at ASC, b.id ASC
      LIMIT ${input.limit}
    `;
    return rows.map(hydrateSupportBundleRecord);
  }

  private async getDownloadAuthorizationByToken(token: string) {
    const tokenFingerprint = supportBundleDownloadTokenFingerprint(token);
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleDownloadAuthorization[]
    >`
      SELECT
        id,
        bundle_id AS "bundleId",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        artifact_kind AS "artifactKind",
        artifact_filename AS "artifactFilename",
        artifact_mime AS "artifactMime",
        manifest_fingerprint AS "manifestFingerprint",
        artifact_fingerprint AS "artifactFingerprint",
        authorization_fingerprint AS "authorizationFingerprint",
        token_fingerprint AS "tokenFingerprint",
        delivery_method AS "deliveryMethod",
        direct_download_url AS "directDownloadUrl",
        direct_download_expires_at AS "directDownloadExpiresAt",
        expires_at AS "expiresAt",
        downloaded_at AS "downloadedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_support_bundle_download_authorizations
      WHERE token_fingerprint = ${tokenFingerprint}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async getDownloadAuthorizationById(
    workspaceId: string,
    authorizationId: string
  ) {
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleDownloadAuthorization[]
    >`
      SELECT
        id,
        bundle_id AS "bundleId",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        artifact_kind AS "artifactKind",
        artifact_filename AS "artifactFilename",
        artifact_mime AS "artifactMime",
        manifest_fingerprint AS "manifestFingerprint",
        artifact_fingerprint AS "artifactFingerprint",
        authorization_fingerprint AS "authorizationFingerprint",
        token_fingerprint AS "tokenFingerprint",
        delivery_method AS "deliveryMethod",
        direct_download_url AS "directDownloadUrl",
        direct_download_expires_at AS "directDownloadExpiresAt",
        expires_at AS "expiresAt",
        downloaded_at AS "downloadedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${authorizationId} AND workspace_id = ${workspaceId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async getDownloadAuthorizationByIdForTransfer(
    authorizationId: string
  ) {
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleDownloadAuthorization[]
    >`
      SELECT
        id,
        bundle_id AS "bundleId",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        artifact_kind AS "artifactKind",
        artifact_filename AS "artifactFilename",
        artifact_mime AS "artifactMime",
        manifest_fingerprint AS "manifestFingerprint",
        artifact_fingerprint AS "artifactFingerprint",
        authorization_fingerprint AS "authorizationFingerprint",
        token_fingerprint AS "tokenFingerprint",
        delivery_method AS "deliveryMethod",
        direct_download_url AS "directDownloadUrl",
        direct_download_expires_at AS "directDownloadExpiresAt",
        expires_at AS "expiresAt",
        downloaded_at AS "downloadedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${authorizationId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async getDirectDownloadTransferForwardingEvent(id: string) {
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleTransferForwardingEventRecord[]
    >`
      SELECT
        id,
        authorization_id AS "authorizationId",
        status,
        event_id AS "eventId",
        event_source AS "eventSource",
        forwarding_event_fingerprint AS "forwardingEventFingerprint",
        forwarding_payload AS "forwardingPayload",
        forwarding_payload_fingerprint AS "forwardingPayloadFingerprint",
        provider_signature_evidence_fingerprint AS "providerSignatureEvidenceFingerprint",
        forwarded_transfer_event_fingerprint AS "forwardedTransferEventFingerprint",
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_attempt_at AS "nextAttemptAt",
        worker_lease_id AS "workerLeaseId",
        worker_lease_expires_at AS "workerLeaseExpiresAt",
        last_attempt_at AS "lastAttemptAt",
        forwarded_at AS "forwardedAt",
        dead_lettered_at AS "deadLetteredAt",
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ? hydrateTransferForwardingEventRecord(rows[0]) : null;
  }

  private async getDirectDownloadTransferForwardingEventByFingerprint(input: {
    authorizationId: string;
    forwardingEventFingerprint: string;
  }) {
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleTransferForwardingEventRecord[]
    >`
      SELECT
        id,
        authorization_id AS "authorizationId",
        status,
        event_id AS "eventId",
        event_source AS "eventSource",
        forwarding_event_fingerprint AS "forwardingEventFingerprint",
        forwarding_payload AS "forwardingPayload",
        forwarding_payload_fingerprint AS "forwardingPayloadFingerprint",
        provider_signature_evidence_fingerprint AS "providerSignatureEvidenceFingerprint",
        forwarded_transfer_event_fingerprint AS "forwardedTransferEventFingerprint",
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_attempt_at AS "nextAttemptAt",
        worker_lease_id AS "workerLeaseId",
        worker_lease_expires_at AS "workerLeaseExpiresAt",
        last_attempt_at AS "lastAttemptAt",
        forwarded_at AS "forwardedAt",
        dead_lettered_at AS "deadLetteredAt",
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE authorization_id = ${input.authorizationId}
        AND forwarding_event_fingerprint = ${input.forwardingEventFingerprint}
      LIMIT 1
    `;
    return rows[0] ? hydrateTransferForwardingEventRecord(rows[0]) : null;
  }

  private assertDirectDownloadTransferForwardingEventMatchesConflictEvidence(
    event: CopilotSupportBundleTransferForwardingEventRecord,
    expected: DirectDownloadTransferForwardingEventConflictEvidence
  ) {
    if (
      event.authorizationId !== expected.authorizationId ||
      event.eventId !== expected.eventId ||
      event.eventSource !== expected.eventSource ||
      event.forwardingEventFingerprint !==
        expected.forwardingEventFingerprint ||
      event.forwardingPayloadFingerprint !==
        expected.forwardingPayloadFingerprint ||
      event.providerSignatureEvidenceFingerprint !==
        expected.providerSignatureEvidenceFingerprint
    ) {
      throw new Error(
        'Support bundle transfer forwarding event conflict reused mismatched evidence'
      );
    }
  }

  private async leaseDirectDownloadTransferForwardingEvents(input: {
    id?: string;
    limit: number;
  }) {
    const now = new Date();
    const workerLeaseId = randomUUID();
    const workerLeaseExpiresAt = new Date(
      now.getTime() + SUPPORT_BUNDLE_TRANSFER_FORWARDING_WORKER_LEASE_MS
    );
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleTransferForwardingEventRecord[]
    >`
      WITH due_events AS (
        SELECT id
        FROM ai_support_bundle_transfer_forwarding_events
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
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
        ORDER BY next_attempt_at ASC NULLS FIRST, created_at ASC, id ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ai_support_bundle_transfer_forwarding_events event
      SET
        status = ${'processing'},
        attempt_count = event.attempt_count + 1,
        worker_lease_id = ${workerLeaseId},
        worker_lease_expires_at = ${workerLeaseExpiresAt},
        last_attempt_at = ${now},
        next_attempt_at = NULL,
        failure_code = NULL,
        failure_message = NULL,
        updated_at = ${now}
      FROM due_events
      WHERE event.id = due_events.id
      RETURNING
        event.id,
        event.authorization_id AS "authorizationId",
        event.status,
        event.event_id AS "eventId",
        event.event_source AS "eventSource",
        event.forwarding_event_fingerprint AS "forwardingEventFingerprint",
        event.forwarding_payload AS "forwardingPayload",
        event.forwarding_payload_fingerprint AS "forwardingPayloadFingerprint",
        event.provider_signature_evidence_fingerprint AS "providerSignatureEvidenceFingerprint",
        event.forwarded_transfer_event_fingerprint AS "forwardedTransferEventFingerprint",
        event.attempt_count AS "attemptCount",
        event.max_attempts AS "maxAttempts",
        event.next_attempt_at AS "nextAttemptAt",
        event.worker_lease_id AS "workerLeaseId",
        event.worker_lease_expires_at AS "workerLeaseExpiresAt",
        event.last_attempt_at AS "lastAttemptAt",
        event.forwarded_at AS "forwardedAt",
        event.dead_lettered_at AS "deadLetteredAt",
        event.failure_code AS "failureCode",
        event.failure_message AS "failureMessage",
        event.created_at AS "createdAt",
        event.updated_at AS "updatedAt"
    `;
    return rows.map(hydrateTransferForwardingEventRecord);
  }

  private directDownloadTransferEventFromForwardingPayload(
    event: CopilotSupportBundleTransferForwardingEventRecord
  ): CopilotSupportBundleDirectDownloadTransferEvent {
    const payload = event.forwardingPayload;
    const payloadEvent = isSupportBundleRecord(payload.event)
      ? payload.event
      : {};
    if (
      payload.version !== SUPPORT_BUNDLE_TRANSFER_FORWARDING_PAYLOAD_VERSION ||
      typeof payloadEvent.authorizationId !== 'string'
    ) {
      throw new Error('Support bundle transfer event auth evidence is invalid');
    }
    const transferredAt =
      typeof payloadEvent.transferredAt === 'string'
        ? new Date(payloadEvent.transferredAt)
        : undefined;
    if (
      payloadEvent.transferredAt !== undefined &&
      (!transferredAt || Number.isNaN(transferredAt.getTime()))
    ) {
      throw new Error('Support bundle transfer event auth evidence is invalid');
    }

    return {
      authorizationId: payloadEvent.authorizationId,
      eventId:
        typeof payloadEvent.eventId === 'string'
          ? payloadEvent.eventId
          : undefined,
      eventSource:
        typeof payloadEvent.eventSource === 'string'
          ? payloadEvent.eventSource
          : undefined,
      storageKey:
        typeof payloadEvent.storageKey === 'string'
          ? payloadEvent.storageKey
          : undefined,
      notificationAuthEvidence: normalizeTransferNotificationAuthEvidence(
        payloadEvent.notificationAuthEvidence
      ),
      artifactByteSize:
        typeof payloadEvent.artifactByteSize === 'number'
          ? payloadEvent.artifactByteSize
          : undefined,
      artifactFingerprint:
        typeof payloadEvent.artifactFingerprint === 'string'
          ? payloadEvent.artifactFingerprint
          : undefined,
      transferredAt,
    };
  }

  private async findForwardedTransferEventFingerprint(input: {
    authorizationId: string;
    eventId?: string;
    eventSource?: string;
  }) {
    const rows = await this.db.$queryRaw<Array<{ eventFingerprint: string }>>`
      SELECT event_fingerprint AS "eventFingerprint"
      FROM ai_support_bundle_transfer_events
      WHERE authorization_id = ${input.authorizationId}
        AND event_source = ${input.eventSource ?? 'object_storage_event'}
        AND COALESCE(event_id, '') = ${input.eventId ?? ''}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    return rows[0]?.eventFingerprint ?? null;
  }

  private forwardingRetryDelay(attemptCount: number) {
    const delayMs = Math.min(
      60_000 * 2 ** Math.max(attemptCount - 1, 0),
      15 * 60_000
    );
    return new Date(Date.now() + delayMs);
  }

  private async lockDirectDownloadTransferForwardingEvent(id: string) {
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleTransferForwardingEventRecord[]
    >`
      SELECT
        id,
        authorization_id AS "authorizationId",
        status,
        event_id AS "eventId",
        event_source AS "eventSource",
        forwarding_event_fingerprint AS "forwardingEventFingerprint",
        forwarding_payload AS "forwardingPayload",
        forwarding_payload_fingerprint AS "forwardingPayloadFingerprint",
        provider_signature_evidence_fingerprint AS "providerSignatureEvidenceFingerprint",
        forwarded_transfer_event_fingerprint AS "forwardedTransferEventFingerprint",
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_attempt_at AS "nextAttemptAt",
        worker_lease_id AS "workerLeaseId",
        worker_lease_expires_at AS "workerLeaseExpiresAt",
        last_attempt_at AS "lastAttemptAt",
        forwarded_at AS "forwardedAt",
        dead_lettered_at AS "deadLetteredAt",
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE id = ${id}
      LIMIT 1
      FOR UPDATE
    `;
    return rows[0] ? hydrateTransferForwardingEventRecord(rows[0]) : null;
  }

  private isCurrentDirectDownloadTransferForwardingLease(input: {
    event: CopilotSupportBundleTransferForwardingEventRecord;
    current: CopilotSupportBundleTransferForwardingEventRecord;
    now: Date;
  }) {
    const { event, current, now } = input;
    return (
      current.status === 'processing' &&
      current.workerLeaseId === event.workerLeaseId &&
      current.attemptCount === event.attemptCount &&
      !!current.workerLeaseExpiresAt &&
      current.workerLeaseExpiresAt.getTime() > now.getTime()
    );
  }

  private async currentDirectDownloadTransferForwardingEventLease(
    event: CopilotSupportBundleTransferForwardingEventRecord
  ) {
    const now = new Date();
    const current = await this.lockDirectDownloadTransferForwardingEvent(
      event.id
    );
    if (!current) {
      throw new Error('Support bundle transfer forwarding event not found');
    }
    if (
      !this.isCurrentDirectDownloadTransferForwardingLease({
        event,
        current,
        now,
      })
    ) {
      return null;
    }
    return current;
  }

  private async markDirectDownloadTransferForwardingEventForwarded(input: {
    event: CopilotSupportBundleTransferForwardingEventRecord;
    forwardedTransferEventFingerprint: string;
  }) {
    const now = new Date();
    const updatedCount = await this.db.$executeRaw`
      UPDATE ai_support_bundle_transfer_forwarding_events
      SET
        status = ${'forwarded'},
        forwarded_transfer_event_fingerprint = ${input.forwardedTransferEventFingerprint},
        forwarded_at = ${now},
        dead_lettered_at = NULL,
        worker_lease_id = NULL,
        worker_lease_expires_at = NULL,
        next_attempt_at = NULL,
        failure_code = NULL,
        failure_message = NULL,
        updated_at = ${now}
      WHERE id = ${input.event.id}
        AND authorization_id = ${input.event.authorizationId}
        AND status = ${input.event.status}
        AND status = ${'processing'}
        AND event_id IS NOT DISTINCT FROM ${input.event.eventId}
        AND event_source = ${input.event.eventSource}
        AND forwarding_event_fingerprint = ${input.event.forwardingEventFingerprint}
        AND forwarding_payload = ${toJsonString(input.event.forwardingPayload)}::jsonb
        AND forwarding_payload_fingerprint = ${input.event.forwardingPayloadFingerprint}
        AND provider_signature_evidence_fingerprint IS NOT DISTINCT FROM ${
          input.event.providerSignatureEvidenceFingerprint
        }
        AND forwarded_transfer_event_fingerprint IS NOT DISTINCT FROM ${
          input.event.forwardedTransferEventFingerprint
        }
        AND attempt_count = ${input.event.attemptCount}
        AND max_attempts = ${input.event.maxAttempts}
        AND next_attempt_at IS NOT DISTINCT FROM ${input.event.nextAttemptAt}
        AND worker_lease_id IS NOT DISTINCT FROM ${input.event.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          input.event.workerLeaseExpiresAt
        }
        AND last_attempt_at IS NOT DISTINCT FROM ${input.event.lastAttemptAt}
        AND forwarded_at IS NOT DISTINCT FROM ${input.event.forwardedAt}
        AND dead_lettered_at IS NOT DISTINCT FROM ${input.event.deadLetteredAt}
        AND failure_code IS NOT DISTINCT FROM ${input.event.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${input.event.failureMessage}
        AND created_at = ${input.event.createdAt}
        AND updated_at = ${input.event.updatedAt}
    `;
    if (updatedCount !== 1) {
      throw new Error('Support bundle transfer forwarding event lease changed');
    }
  }

  private async markDirectDownloadTransferForwardingEventFailed(input: {
    event: CopilotSupportBundleTransferForwardingEventRecord;
    error: unknown;
  }) {
    const now = new Date();
    const normalized = normalizeForwardingEventFailure(input.error);
    const attemptsExhausted =
      input.event.attemptCount >= input.event.maxAttempts;
    const status =
      !normalized.retryable || attemptsExhausted
        ? 'dead_lettered'
        : 'retry_scheduled';
    const nextAttemptAt =
      status === 'retry_scheduled'
        ? this.forwardingRetryDelay(input.event.attemptCount)
        : null;
    const updatedCount = await this.db.$executeRaw`
      UPDATE ai_support_bundle_transfer_forwarding_events
      SET
        status = ${status},
        forwarded_transfer_event_fingerprint = NULL,
        forwarded_at = NULL,
        dead_lettered_at = ${status === 'dead_lettered' ? now : null},
        worker_lease_id = NULL,
        worker_lease_expires_at = NULL,
        next_attempt_at = ${nextAttemptAt},
        failure_code = ${normalized.errorCode},
        failure_message = ${normalized.errorMessage},
        updated_at = ${now}
      WHERE id = ${input.event.id}
        AND authorization_id = ${input.event.authorizationId}
        AND status = ${input.event.status}
        AND status = ${'processing'}
        AND event_id IS NOT DISTINCT FROM ${input.event.eventId}
        AND event_source = ${input.event.eventSource}
        AND forwarding_event_fingerprint = ${input.event.forwardingEventFingerprint}
        AND forwarding_payload = ${toJsonString(input.event.forwardingPayload)}::jsonb
        AND forwarding_payload_fingerprint = ${input.event.forwardingPayloadFingerprint}
        AND provider_signature_evidence_fingerprint IS NOT DISTINCT FROM ${
          input.event.providerSignatureEvidenceFingerprint
        }
        AND forwarded_transfer_event_fingerprint IS NOT DISTINCT FROM ${
          input.event.forwardedTransferEventFingerprint
        }
        AND attempt_count = ${input.event.attemptCount}
        AND max_attempts = ${input.event.maxAttempts}
        AND next_attempt_at IS NOT DISTINCT FROM ${input.event.nextAttemptAt}
        AND worker_lease_id IS NOT DISTINCT FROM ${input.event.workerLeaseId}
        AND worker_lease_expires_at IS NOT DISTINCT FROM ${
          input.event.workerLeaseExpiresAt
        }
        AND last_attempt_at IS NOT DISTINCT FROM ${input.event.lastAttemptAt}
        AND forwarded_at IS NOT DISTINCT FROM ${input.event.forwardedAt}
        AND dead_lettered_at IS NOT DISTINCT FROM ${input.event.deadLetteredAt}
        AND failure_code IS NOT DISTINCT FROM ${input.event.failureCode}
        AND failure_message IS NOT DISTINCT FROM ${input.event.failureMessage}
        AND created_at = ${input.event.createdAt}
        AND updated_at = ${input.event.updatedAt}
    `;
    if (updatedCount !== 1) {
      throw new Error('Support bundle transfer forwarding event lease changed');
    }
  }

  @Transactional()
  private async processLeasedDirectDownloadTransferForwardingEvent(
    event: CopilotSupportBundleTransferForwardingEventRecord
  ): Promise<{
    event: CopilotSupportBundleTransferForwardingEventRecord;
    authorization: CopilotSupportBundleDownloadAuthorization | null;
  }> {
    let authorization: CopilotSupportBundleDownloadAuthorization | null = null;
    let transferEventIngested = false;
    try {
      const current =
        await this.currentDirectDownloadTransferForwardingEventLease(event);
      if (!current) {
        const stale = await this.getDirectDownloadTransferForwardingEvent(
          event.id
        );
        if (!stale) {
          throw new Error('Support bundle transfer forwarding event not found');
        }
        return {
          event: stale,
          authorization: null,
        };
      }
      event = current;
      const transferEvent =
        this.directDownloadTransferEventFromForwardingPayload(event);
      authorization =
        await this.ingestDirectDownloadTransferEvent(transferEvent);
      transferEventIngested = true;
      const forwardedTransferEventFingerprint =
        await this.findForwardedTransferEventFingerprint({
          authorizationId: transferEvent.authorizationId,
          eventId: transferEvent.eventId,
          eventSource: transferEvent.eventSource,
        });
      if (!forwardedTransferEventFingerprint) {
        throw new Error(
          'Support bundle transfer forwarding event was not persisted'
        );
      }
      await this.markDirectDownloadTransferForwardingEventForwarded({
        event,
        forwardedTransferEventFingerprint,
      });
      authorization =
        authorization ??
        (await this.getDownloadAuthorizationByIdForTransfer(
          transferEvent.authorizationId
        ));
    } catch (error) {
      if (transferEventIngested) {
        throw error;
      }
      const current =
        await this.currentDirectDownloadTransferForwardingEventLease(event);
      if (!current) {
        const stale = await this.getDirectDownloadTransferForwardingEvent(
          event.id
        );
        if (!stale) {
          throw new Error('Support bundle transfer forwarding event not found');
        }
        return {
          event: stale,
          authorization,
        };
      }
      event = current;
      await this.markDirectDownloadTransferForwardingEventFailed({
        event,
        error,
      });
    }

    const updated = await this.getDirectDownloadTransferForwardingEvent(
      event.id
    );
    if (!updated) {
      throw new Error('Support bundle transfer forwarding event not found');
    }

    return {
      event: updated,
      authorization,
    };
  }

  private async markDownloadAuthorizationExpired(input: {
    authorization: CopilotSupportBundleDownloadAuthorization;
    source:
      | 'api_proxy_consume'
      | 'direct_download_acknowledge'
      | 'direct_download_transfer_event';
  }) {
    const now = new Date();
    const updatedRows = await this.db.$queryRaw<
      CopilotSupportBundleDownloadAuthorization[]
    >`
      UPDATE ai_support_bundle_download_authorizations
      SET
        status = ${'expired'},
        updated_at = ${now}
      WHERE id = ${input.authorization.id}
        AND bundle_id = ${input.authorization.bundleId}
        AND workspace_id = ${input.authorization.workspaceId}
        AND actor_id = ${input.authorization.actorId}
        AND status = ${'authorized'}
        AND artifact_kind = ${input.authorization.artifactKind}
        AND artifact_filename = ${input.authorization.artifactFilename}
        AND artifact_mime = ${input.authorization.artifactMime}
        AND manifest_fingerprint = ${input.authorization.manifestFingerprint}
        AND artifact_fingerprint = ${input.authorization.artifactFingerprint}
        AND authorization_fingerprint = ${input.authorization.authorizationFingerprint}
        AND token_fingerprint = ${input.authorization.tokenFingerprint}
        AND delivery_method = ${input.authorization.deliveryMethod}
        AND direct_download_url IS NOT DISTINCT FROM ${input.authorization.directDownloadUrl}
        AND direct_download_expires_at IS NOT DISTINCT FROM ${input.authorization.directDownloadExpiresAt}
        AND expires_at = ${input.authorization.expiresAt}
        AND downloaded_at IS NOT DISTINCT FROM ${input.authorization.downloadedAt}
        AND created_at = ${input.authorization.createdAt}
        AND updated_at = ${input.authorization.updatedAt}
      RETURNING
        id,
        bundle_id AS "bundleId",
        workspace_id AS "workspaceId",
        actor_id AS "actorId",
        status,
        artifact_kind AS "artifactKind",
        artifact_filename AS "artifactFilename",
        artifact_mime AS "artifactMime",
        manifest_fingerprint AS "manifestFingerprint",
        artifact_fingerprint AS "artifactFingerprint",
        authorization_fingerprint AS "authorizationFingerprint",
        token_fingerprint AS "tokenFingerprint",
        delivery_method AS "deliveryMethod",
        direct_download_url AS "directDownloadUrl",
        direct_download_expires_at AS "directDownloadExpiresAt",
        expires_at AS "expiresAt",
        downloaded_at AS "downloadedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;
    const updatedAuthorization = updatedRows[0];
    if (!updatedAuthorization) {
      const current = await this.getDownloadAuthorizationByIdForTransfer(
        input.authorization.id
      );
      if (current && current.status !== 'authorized') {
        return;
      }
      throw new Error(
        `Support bundle download authorization could not be expired because its authorization state changed: ${input.authorization.id}`
      );
    }

    if (updatedAuthorization.status !== 'expired') {
      return;
    }

    const cleanupFingerprint = supportBundleFingerprint({
      version: 'copilot-support-bundle-download-authorization-expiration/v1',
      authorizationId: updatedAuthorization.id,
      authorizationFingerprint: updatedAuthorization.authorizationFingerprint,
      expiredAt: now.toISOString(),
      source: input.source,
    });

    await this.createAuditEvent({
      bundleId: updatedAuthorization.bundleId,
      workspaceId: updatedAuthorization.workspaceId,
      actorId: updatedAuthorization.actorId,
      eventType: 'download_authorized',
      metadata: {
        version: SUPPORT_BUNDLE_DOWNLOAD_AUTHORIZATION_EXPIRED_AUDIT_VERSION,
        authorizationExpired: true,
        authorizationId: updatedAuthorization.id,
        authorizationFingerprint: updatedAuthorization.authorizationFingerprint,
        artifactKind: updatedAuthorization.artifactKind,
        artifactFingerprint: updatedAuthorization.artifactFingerprint,
        cleanupActorId: 'system_download_authorization_expiration_guard',
        cleanupFingerprint,
        cleanupScope: input.source,
        cleanedAt: now.toISOString(),
        deliveryMethod: updatedAuthorization.deliveryMethod,
        expiresAt: updatedAuthorization.expiresAt.toISOString(),
        previousStatus: 'authorized',
        status: 'expired',
      },
    });
  }

  private async createDownloadAuthorizationExpirationAuditEvents(input: {
    actorId?: string;
    cleanupActorId: string;
    cleanupFingerprint: string;
    cleanupScope:
      | 'scheduled_worker'
      | 'retention_cleanup'
      | 'api_proxy_consume'
      | 'direct_download_acknowledge'
      | 'direct_download_transfer_event';
    expiredAt: Date;
    rows: Array<{
      actorId: string;
      artifactFingerprint: string;
      artifactKind: string;
      authorizationFingerprint: string;
      bundleId: string;
      deliveryMethod?: string;
      expiresAt: Date;
      id: string;
      workspaceId: string;
    }>;
  }) {
    for (const row of input.rows) {
      await this.createAuditEvent({
        bundleId: row.bundleId,
        workspaceId: row.workspaceId,
        actorId: input.actorId ?? row.actorId,
        eventType: 'download_authorized',
        metadata: {
          version: SUPPORT_BUNDLE_DOWNLOAD_AUTHORIZATION_EXPIRED_AUDIT_VERSION,
          authorizationExpired: true,
          authorizationId: row.id,
          authorizationFingerprint: row.authorizationFingerprint,
          artifactKind: row.artifactKind,
          artifactFingerprint: row.artifactFingerprint,
          cleanupActorId: input.cleanupActorId,
          cleanupFingerprint: input.cleanupFingerprint,
          cleanupScope: input.cleanupScope,
          cleanedAt: input.expiredAt.toISOString(),
          ...(row.deliveryMethod ? { deliveryMethod: row.deliveryMethod } : {}),
          expiresAt: row.expiresAt.toISOString(),
          previousStatus: 'authorized',
          status: 'expired',
        },
      });
    }
  }

  private async createRetentionRetryAuditEvent(
    input:
      | {
          actorId: string;
          bundle: CopilotSupportBundleArchiveObjectCleanupRetryCandidate;
          metadata: Record<string, unknown>;
          retryKind: 'archive_object_cleanup';
        }
      | {
          actorId: string;
          bundle: CopilotSupportBundleManifestObjectRewriteRetryCandidate;
          metadata: Record<string, unknown>;
          retryKind: 'manifest_object_rewrite';
        }
  ) {
    const id = randomUUID();
    const createdAt = new Date();
    const { metadata, serialized } = normalizeAuditMetadata(input.metadata);
    validateRetentionAuditMetadata(metadata);
    const eventFingerprint = supportBundleFingerprint({
      version: 'copilot-support-bundle-audit-event/v1',
      bundleId: input.bundle.id,
      workspaceId: input.bundle.workspaceId,
      actorId: input.actorId,
      eventType: 'retention_expired',
      metadata,
    });
    const bundle = input.bundle;
    const sourceAuditActorId =
      input.retryKind === 'archive_object_cleanup'
        ? input.bundle.previousArchiveObjectCleanupAuditActorId
        : input.bundle.previousManifestObjectRewriteAuditActorId;
    const sourceAuditCreatedAt =
      input.retryKind === 'archive_object_cleanup'
        ? input.bundle.previousArchiveObjectCleanupAuditCreatedAt
        : input.bundle.previousManifestObjectRewriteAuditCreatedAt;
    const sourceAuditEventFingerprint =
      input.retryKind === 'archive_object_cleanup'
        ? input.bundle.previousArchiveObjectCleanupAuditEventFingerprint
        : input.bundle.previousManifestObjectRewriteAuditEventFingerprint;
    const sourceAuditId =
      input.retryKind === 'archive_object_cleanup'
        ? input.bundle.previousArchiveObjectCleanupAuditId
        : input.bundle.previousManifestObjectRewriteAuditId;
    const sourceAuditMetadata =
      input.retryKind === 'archive_object_cleanup'
        ? input.bundle.previousArchiveObjectCleanupAuditMetadata
        : input.bundle.previousManifestObjectRewriteAuditMetadata;
    const sourceFailureCount =
      input.retryKind === 'archive_object_cleanup'
        ? input.bundle.archiveObjectCleanupFailureCount
        : input.bundle.manifestObjectRewriteFailureCount;

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      WITH latest_retry_source AS (
        SELECT DISTINCT ON (e.bundle_id)
          e.id,
          e.bundle_id,
          e.workspace_id,
          e.actor_id,
          e.event_type,
          e.event_fingerprint,
          e.metadata,
          e.created_at
        FROM ai_support_bundle_audit_events e
        WHERE e.bundle_id = ${bundle.id}
          AND e.event_type = ${'retention_expired'}
          AND (
            (
              ${input.retryKind} = ${'archive_object_cleanup'}
              AND e.metadata ? 'archiveObjectCleanupStatus'
            )
            OR (
              ${input.retryKind} = ${'manifest_object_rewrite'}
              AND e.metadata ? 'manifestObjectRewriteStatus'
            )
          )
        ORDER BY e.bundle_id, e.created_at DESC, e.id DESC
      ),
      failure_counts AS (
        SELECT COUNT(*)::int AS failure_count
        FROM ai_support_bundle_audit_events e
        WHERE e.bundle_id = ${bundle.id}
          AND e.event_type = ${'retention_expired'}
          AND (
            (
              ${input.retryKind} = ${'archive_object_cleanup'}
              AND e.metadata->>'archiveObjectCleanupStatus' = ${'failed'}
            )
            OR (
              ${input.retryKind} = ${'manifest_object_rewrite'}
              AND e.metadata->>'manifestObjectRewriteStatus' = ${'failed'}
            )
          )
      )
      INSERT INTO ai_support_bundle_audit_events (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata,
        created_at
      )
      SELECT
        ${id},
        bundle.id,
        bundle.workspace_id,
        ${input.actorId},
        ${'retention_expired'},
        ${eventFingerprint},
        ${serialized}::jsonb,
        ${createdAt}
      FROM ai_support_bundle_requests bundle
      JOIN latest_retry_source source
        ON source.bundle_id = bundle.id
      CROSS JOIN failure_counts
      WHERE bundle.id = ${bundle.id}
        AND bundle.workspace_id = ${bundle.workspaceId}
        AND bundle.actor_id = ${bundle.actorId}
        AND bundle.status = ${bundle.status}
        AND bundle.source_evidence_summary = ${toJsonString(
          bundle.sourceEvidenceSummary
        )}::jsonb
        AND bundle.source_evidence_set_fingerprint = ${
          bundle.sourceEvidenceSetFingerprint
        }
        AND bundle.manifest_fingerprint = ${bundle.manifestFingerprint}
        AND bundle.manifest_json = ${toJsonString(bundle.manifestJson)}::jsonb
        AND bundle.manifest_storage_key IS NOT DISTINCT FROM ${
          bundle.manifestStorageKey
        }
        AND bundle.manifest_byte_size IS NOT DISTINCT FROM ${
          bundle.manifestByteSize
        }
        AND bundle.manifest_mime IS NOT DISTINCT FROM ${bundle.manifestMime}
        AND bundle.manifest_filename IS NOT DISTINCT FROM ${
          bundle.manifestFilename
        }
        AND bundle.archive_storage_key IS NOT DISTINCT FROM ${
          bundle.archiveStorageKey
        }
        AND bundle.archive_byte_size IS NOT DISTINCT FROM ${
          bundle.archiveByteSize
        }
        AND bundle.archive_fingerprint IS NOT DISTINCT FROM ${
          bundle.archiveFingerprint
        }
        AND bundle.archive_mime IS NOT DISTINCT FROM ${bundle.archiveMime}
        AND bundle.archive_filename IS NOT DISTINCT FROM ${
          bundle.archiveFilename
        }
        AND bundle.retention_status = ${bundle.retentionStatus}
        AND bundle.retention_status = ${'expired'}
        AND bundle.expires_at = ${bundle.expiresAt}
        AND bundle.failure_code IS NOT DISTINCT FROM ${bundle.failureCode}
        AND bundle.failure_message IS NOT DISTINCT FROM ${bundle.failureMessage}
        AND bundle.created_at = ${bundle.createdAt}
        AND bundle.updated_at = ${bundle.updatedAt}
        AND source.workspace_id = ${bundle.workspaceId}
        AND source.actor_id = ${sourceAuditActorId}
        AND source.event_type = ${'retention_expired'}
        AND source.event_fingerprint = ${sourceAuditEventFingerprint}
        AND source.id = ${sourceAuditId}
        AND source.metadata = ${toJsonString(sourceAuditMetadata)}::jsonb
        AND source.created_at = ${sourceAuditCreatedAt}
        AND (
          (
            ${input.retryKind} = ${'archive_object_cleanup'}
            AND source.metadata->>'archiveObjectCleanupStatus' = ${'failed'}
            AND failure_counts.failure_count = ${sourceFailureCount}
          )
          OR (
            ${input.retryKind} = ${'manifest_object_rewrite'}
            AND source.metadata->>'manifestObjectRewriteStatus' = ${'failed'}
            AND failure_counts.failure_count = ${sourceFailureCount}
          )
        )
      RETURNING id
    `;
    if (!insertedRows.length) {
      throw new Error(
        `Support bundle retention retry audit event could not be recorded because its source cleanup state changed: ${bundle.id}`
      );
    }
  }

  private getStorageProvider() {
    if (!this.storageProvider) {
      this.storageProvider = this.storageFactory.create(
        this.config.storages.blob.storage
      );
    }
    return this.storageProvider;
  }

  private async cleanupArchiveObject(
    bundle: CopilotSupportBundleRecord
  ): Promise<CopilotSupportBundleArchiveObjectCleanupResult> {
    if (!bundle.archiveStorageKey) {
      return {
        archiveStorageKey: null,
        status: 'missing',
      };
    }

    try {
      await this.getStorageProvider().delete(bundle.archiveStorageKey);
      return {
        archiveStorageKey: bundle.archiveStorageKey,
        status: 'deleted',
      };
    } catch (error) {
      const storageError = normalizeStorageError(error);
      return {
        archiveStorageKey: bundle.archiveStorageKey,
        status: 'failed',
        errorCode: storageError.errorCode,
        errorMessage: storageError.errorMessage,
      };
    }
  }

  private async rewriteManifestObject(input: {
    bundle: CopilotSupportBundleRecord;
    body: Buffer;
  }): Promise<CopilotSupportBundleManifestObjectRewriteResult> {
    if (!input.bundle.manifestStorageKey) {
      return {
        manifestStorageKey: null,
        status: 'missing',
      };
    }

    try {
      await this.getStorageProvider().put(
        input.bundle.manifestStorageKey,
        input.body,
        {
          contentLength: input.body.length,
          contentType: input.bundle.manifestMime ?? 'application/json',
        }
      );
      return {
        manifestStorageKey: input.bundle.manifestStorageKey,
        status: 'written',
      };
    } catch (error) {
      const storageError = normalizeStorageError(error);
      return {
        manifestStorageKey: input.bundle.manifestStorageKey,
        status: 'failed',
        errorCode: storageError.errorCode,
        errorMessage: storageError.errorMessage,
      };
    }
  }

  private async createSignedUrlDelivery(
    artifact: {
      byteSize: number | null;
      fingerprint: string | null;
      storageKey: string | null;
    },
    expiresAt: Date
  ) {
    if (!artifact.storageKey || !artifact.fingerprint || !artifact.byteSize) {
      return null;
    }

    const storedArtifact = await this.getStorageProvider().get(
      artifact.storageKey,
      true
    );
    if (!storedArtifact.redirectUrl || !storedArtifact.metadata) {
      return null;
    }
    if (storedArtifact.metadata.contentLength !== artifact.byteSize) {
      return null;
    }

    return {
      url: storedArtifact.redirectUrl,
      expiresAt,
    };
  }

  private async readManifestArtifact(bundle: CopilotSupportBundleRecord) {
    if (!bundle.manifestStorageKey) {
      return Buffer.from(JSON.stringify(bundle.manifestJson, null, 2), 'utf8');
    }

    const body = await this.readStoredJsonArtifact({
      fingerprint: bundle.manifestFingerprint,
      storageKey: bundle.manifestStorageKey,
    });
    return body;
  }

  private async readArchiveArtifact(bundle: CopilotSupportBundleRecord) {
    if (!bundle.archiveStorageKey || !bundle.archiveFingerprint) {
      return null;
    }

    return await this.readStoredJsonArtifact({
      fingerprint: bundle.archiveFingerprint,
      storageKey: bundle.archiveStorageKey,
    });
  }

  private async readStoredJsonArtifact(input: {
    fingerprint: string;
    storageKey: string;
  }) {
    const artifact = await this.getStorageProvider().get(input.storageKey);
    if (!artifact.body) {
      return null;
    }

    const body = await readableToBuffer(artifact.body);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      return null;
    }
    if (supportBundleFingerprint(parsed) !== input.fingerprint) {
      return null;
    }

    return body;
  }

  private async verifyDirectDownloadTransferEvent(input: {
    authorization: CopilotSupportBundleDownloadAuthorization;
    bundle: CopilotSupportBundleRecord;
    event: CopilotSupportBundleDirectDownloadTransferEvent;
  }) {
    const expected = this.getDirectDownloadTransferEventExpectedEvidence({
      authorization: input.authorization,
      bundle: input.bundle,
    });
    this.verifyDirectDownloadTransferEventMetadata({
      event: input.event,
      expected,
    });

    const storageMetadata = await this.getStorageProvider().head(
      expected.storageKey
    );
    if (!storageMetadata) {
      throw new Error('Support bundle artifact storage object is missing');
    }
    if (storageMetadata.contentLength !== expected.byteSize) {
      throw new Error('Support bundle stored artifact byte size mismatch');
    }

    const body =
      input.authorization.artifactKind === 'archive_json'
        ? await this.readArchiveArtifact(input.bundle)
        : await this.readManifestArtifact(input.bundle);
    if (!body) {
      throw new Error('Support bundle stored artifact fingerprint mismatch');
    }

    return {
      storageKey: expected.storageKey,
      storageByteSize: storageMetadata.contentLength,
      storageContentType: storageMetadata.contentType,
    };
  }

  private async buildVerifiedDirectDownloadTransferEvent(input: {
    authorization: CopilotSupportBundleDownloadAuthorization;
    bundle: CopilotSupportBundleRecord;
    event: CopilotSupportBundleDirectDownloadTransferEvent;
    transferredAt: Date;
  }): Promise<CopilotSupportBundleVerifiedDirectDownloadTransferEvent> {
    const verification = await this.verifyDirectDownloadTransferEvent({
      authorization: input.authorization,
      bundle: input.bundle,
      event: input.event,
    });
    const eventId = input.event.eventId ?? null;
    const eventSource = input.event.eventSource ?? 'object_storage_event';
    const notificationAuthEvidence = normalizeTransferNotificationAuthEvidence(
      input.event.notificationAuthEvidence
    );
    if (
      providerTransferEventSourceRequiresSignatureEvidence(eventSource) &&
      !notificationAuthEvidence.providerSignatureEvidence
    ) {
      throw new Error('Support bundle transfer event auth evidence is invalid');
    }
    const notificationAuthEvidenceFingerprint = supportBundleFingerprint({
      version: SUPPORT_BUNDLE_TRANSFER_NOTIFICATION_AUTH_EVIDENCE_VERSION,
      authorizationId: input.authorization.id,
      authorizationFingerprint: input.authorization.authorizationFingerprint,
      transferEventId: eventId,
      transferEventSource: eventSource,
      notificationAuthEvidence,
    });
    const storageContentType =
      verification.storageContentType ?? 'application/octet-stream';
    const eventFingerprint = supportBundleFingerprint({
      version: SUPPORT_BUNDLE_DIRECT_DOWNLOAD_TRANSFER_EVENT_VERSION,
      authorizationId: input.authorization.id,
      authorizationFingerprint: input.authorization.authorizationFingerprint,
      bundleId: input.authorization.bundleId,
      workspaceId: input.authorization.workspaceId,
      actorId: input.authorization.actorId,
      artifactKind: input.authorization.artifactKind,
      manifestFingerprint: input.authorization.manifestFingerprint,
      artifactFingerprint: input.authorization.artifactFingerprint,
      deliveryMethod: input.authorization.deliveryMethod,
      transferEventId: eventId,
      transferEventSource: eventSource,
      transferredAt: input.transferredAt.toISOString(),
      notificationAuthEvidenceFingerprint,
      storageKey: verification.storageKey,
      storageByteSize: verification.storageByteSize,
      storageContentType,
    });

    return {
      eventId,
      eventSource,
      transferredAt: input.transferredAt,
      notificationAuthEvidence,
      notificationAuthEvidenceFingerprint,
      storageKey: verification.storageKey,
      storageByteSize: verification.storageByteSize,
      storageContentType,
      eventFingerprint,
    };
  }

  private async createDirectDownloadTransferEvent(input: {
    authorization: CopilotSupportBundleDownloadAuthorization;
    transferEvent: CopilotSupportBundleVerifiedDirectDownloadTransferEvent;
  }) {
    const serializedNotificationAuthEvidence = toJsonString(
      input.transferEvent.notificationAuthEvidence
    );
    const id = [
      'support-bundle-transfer-event',
      input.authorization.id,
      input.transferEvent.eventFingerprint,
    ].join('-');

    const insertedRows = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_support_bundle_transfer_events (
        id,
        authorization_id,
        bundle_id,
        workspace_id,
        actor_id,
        artifact_kind,
        manifest_fingerprint,
        artifact_fingerprint,
        authorization_fingerprint,
        delivery_method,
        event_id,
        event_source,
        transferred_at,
        notification_auth_evidence,
        notification_auth_evidence_fingerprint,
        storage_key,
        storage_byte_size,
        storage_content_type,
        event_fingerprint
      )
      VALUES (
        ${id},
        ${input.authorization.id},
        ${input.authorization.bundleId},
        ${input.authorization.workspaceId},
        ${input.authorization.actorId},
        ${input.authorization.artifactKind},
        ${input.authorization.manifestFingerprint},
        ${input.authorization.artifactFingerprint},
        ${input.authorization.authorizationFingerprint},
        ${input.authorization.deliveryMethod},
        ${input.transferEvent.eventId},
        ${input.transferEvent.eventSource},
        ${input.transferEvent.transferredAt},
        ${serializedNotificationAuthEvidence}::jsonb,
        ${input.transferEvent.notificationAuthEvidenceFingerprint},
        ${input.transferEvent.storageKey},
        ${input.transferEvent.storageByteSize},
        ${input.transferEvent.storageContentType},
        ${input.transferEvent.eventFingerprint}
      )
      ON CONFLICT (authorization_id, event_fingerprint) DO NOTHING
      RETURNING id
    `;
    if (insertedRows.length) {
      return;
    }

    const existing = await this.getDirectDownloadTransferEventByFingerprint({
      authorizationId: input.authorization.id,
      eventFingerprint: input.transferEvent.eventFingerprint,
    });
    if (!existing) {
      throw new Error(
        'Support bundle direct download transfer event conflict could not be verified'
      );
    }
    this.assertDirectDownloadTransferEventMatchesConflictEvidence(existing, {
      artifactFingerprint: input.authorization.artifactFingerprint,
      artifactKind: input.authorization.artifactKind,
      authorizationFingerprint: input.authorization.authorizationFingerprint,
      authorizationId: input.authorization.id,
      deliveryMethod: input.authorization.deliveryMethod,
      eventFingerprint: input.transferEvent.eventFingerprint,
      eventId: input.transferEvent.eventId,
      eventSource: input.transferEvent.eventSource,
      manifestFingerprint: input.authorization.manifestFingerprint,
      notificationAuthEvidenceFingerprint:
        input.transferEvent.notificationAuthEvidenceFingerprint,
      storageByteSize: input.transferEvent.storageByteSize,
      storageContentType: input.transferEvent.storageContentType,
      storageKey: input.transferEvent.storageKey,
      transferredAt: input.transferEvent.transferredAt,
    });
  }

  private async getDirectDownloadTransferEventByFingerprint(input: {
    authorizationId: string;
    eventFingerprint: string;
  }): Promise<CopilotSupportBundleTransferEventRecord | null> {
    const rows = await this.db.$queryRaw<
      CopilotSupportBundleTransferEventRecord[]
    >`
      SELECT
        id,
        authorization_id AS "authorizationId",
        artifact_kind AS "artifactKind",
        manifest_fingerprint AS "manifestFingerprint",
        artifact_fingerprint AS "artifactFingerprint",
        authorization_fingerprint AS "authorizationFingerprint",
        delivery_method AS "deliveryMethod",
        event_id AS "eventId",
        event_source AS "eventSource",
        transferred_at AS "transferredAt",
        notification_auth_evidence_fingerprint AS "notificationAuthEvidenceFingerprint",
        storage_key AS "storageKey",
        storage_byte_size AS "storageByteSize",
        storage_content_type AS "storageContentType",
        event_fingerprint AS "eventFingerprint",
        created_at AS "createdAt"
      FROM ai_support_bundle_transfer_events
      WHERE authorization_id = ${input.authorizationId}
        AND event_fingerprint = ${input.eventFingerprint}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private assertDirectDownloadTransferEventMatchesConflictEvidence(
    event: CopilotSupportBundleTransferEventRecord,
    expected: DirectDownloadTransferEventConflictEvidence
  ) {
    if (
      event.authorizationId !== expected.authorizationId ||
      event.artifactKind !== expected.artifactKind ||
      event.manifestFingerprint !== expected.manifestFingerprint ||
      event.artifactFingerprint !== expected.artifactFingerprint ||
      event.authorizationFingerprint !== expected.authorizationFingerprint ||
      event.deliveryMethod !== expected.deliveryMethod ||
      event.eventId !== expected.eventId ||
      event.eventSource !== expected.eventSource ||
      event.notificationAuthEvidenceFingerprint !==
        expected.notificationAuthEvidenceFingerprint ||
      event.storageKey !== expected.storageKey ||
      event.storageByteSize !== expected.storageByteSize ||
      event.storageContentType !== expected.storageContentType ||
      event.eventFingerprint !== expected.eventFingerprint ||
      event.transferredAt.getTime() !== expected.transferredAt.getTime()
    ) {
      throw new Error(
        'Support bundle direct download transfer event conflict reused mismatched evidence'
      );
    }
  }

  private getDirectDownloadTransferEventExpectedEvidence(input: {
    authorization: CopilotSupportBundleDownloadAuthorization;
    bundle: CopilotSupportBundleRecord;
  }) {
    const evidence =
      this.getOptionalDirectDownloadTransferEventExpectedEvidence(input);
    if (!evidence) {
      throw new Error('Support bundle artifact storage evidence is incomplete');
    }

    return evidence;
  }

  private getOptionalDirectDownloadTransferEventExpectedEvidence(input: {
    authorization: CopilotSupportBundleDownloadAuthorization;
    bundle: CopilotSupportBundleRecord;
  }) {
    const storageKey =
      input.authorization.artifactKind === 'archive_json'
        ? input.bundle.archiveStorageKey
        : input.bundle.manifestStorageKey;
    const byteSize =
      input.authorization.artifactKind === 'archive_json'
        ? input.bundle.archiveByteSize
        : input.bundle.manifestByteSize;
    const fingerprint =
      input.authorization.artifactKind === 'archive_json'
        ? input.bundle.archiveFingerprint
        : input.bundle.manifestFingerprint;
    if (!storageKey || byteSize === null || !fingerprint) {
      return null;
    }

    return {
      byteSize,
      fingerprint,
      storageKey,
    };
  }

  private verifyDirectDownloadTransferEventMetadata(input: {
    event: CopilotSupportBundleDirectDownloadTransferEvent;
    expected: {
      byteSize: number;
      fingerprint: string;
      storageKey: string;
    };
  }) {
    if (
      input.event.storageKey !== undefined &&
      input.event.storageKey !== input.expected.storageKey
    ) {
      throw new Error('Support bundle transfer event storage key mismatch');
    }
    if (
      input.event.artifactByteSize !== undefined &&
      input.event.artifactByteSize !== input.expected.byteSize
    ) {
      throw new Error('Support bundle transfer event byte size mismatch');
    }
    if (
      input.event.artifactFingerprint !== undefined &&
      input.event.artifactFingerprint !== input.expected.fingerprint
    ) {
      throw new Error('Support bundle transfer event fingerprint mismatch');
    }
  }

  private async verifyDownloadedDirectDownloadTransferReplay(input: {
    authorization: CopilotSupportBundleDownloadAuthorization;
    event: CopilotSupportBundleDirectDownloadTransferEvent;
    transferredAt: Date;
  }): Promise<CopilotSupportBundleVerifiedDirectDownloadTransferEvent | null> {
    if (input.authorization.deliveryMethod !== 'object_storage_signed_url') {
      throw new Error(
        'Support bundle download authorization is not direct-delivery'
      );
    }
    if (
      input.event.artifactFingerprint !== undefined &&
      input.event.artifactFingerprint !==
        input.authorization.artifactFingerprint
    ) {
      throw new Error('Support bundle transfer event fingerprint mismatch');
    }

    const bundle = await this.get(
      input.authorization.workspaceId,
      input.authorization.bundleId
    );
    if (
      !bundle ||
      bundle.manifestFingerprint !== input.authorization.manifestFingerprint ||
      (input.authorization.artifactKind === 'manifest_json' &&
        bundle.manifestFingerprint !==
          input.authorization.artifactFingerprint) ||
      (input.authorization.artifactKind === 'archive_json' &&
        bundle.archiveFingerprint !== input.authorization.artifactFingerprint)
    ) {
      if (
        input.event.storageKey !== undefined ||
        input.event.artifactByteSize !== undefined
      ) {
        throw new Error(
          'Support bundle downloaded replay storage evidence is unavailable'
        );
      }
      return null;
    }
    if (
      bundle.status !== 'ready' ||
      bundle.retentionStatus !== 'active' ||
      bundle.expiresAt.getTime() <= Date.now()
    ) {
      if (
        input.event.storageKey !== undefined ||
        input.event.artifactByteSize !== undefined
      ) {
        const expected =
          this.getOptionalDirectDownloadTransferEventExpectedEvidence({
            authorization: input.authorization,
            bundle,
          });
        if (!expected) {
          throw new Error(
            'Support bundle downloaded replay storage evidence is unavailable'
          );
        }
        this.verifyDirectDownloadTransferEventMetadata({
          event: input.event,
          expected,
        });
      }
      return null;
    }
    return await this.buildVerifiedDirectDownloadTransferEvent({
      authorization: input.authorization,
      bundle,
      event: input.event,
      transferredAt: input.transferredAt,
    });
  }

  private async buildArchivePayload(input: {
    bundleId: string;
    workspaceId: string;
    actorId: string;
    createdAt: Date;
    expiresAt: Date;
    manifest: Omit<CopilotSupportBundleManifest, 'archive'>;
    promptCatalog: PromptCatalogItem[];
    sourceEvidenceSummary: CopilotSupportBundleSourceEvidenceSummary;
    sourceEvidenceSetFingerprint: string;
    taskRoutes: CopilotSupportBundleTaskRouteSnapshot[];
  }): Promise<CopilotSupportBundleArchive> {
    const sourceEvidence = {
      version: 'copilot-support-bundle-source-evidence-summary/v1',
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      sourceEvidenceSummary: input.sourceEvidenceSummary,
      sourceEvidenceSetFingerprint: input.sourceEvidenceSetFingerprint,
    };
    const actionRuns = await this.buildActionRunSnapshotSet(
      input.workspaceId,
      input.actorId
    );
    const promptCatalog = this.buildPromptCatalogSnapshot(input.promptCatalog);
    const taskRoutes = this.buildTaskRouteSnapshotSet(
      input.workspaceId,
      input.taskRoutes
    );
    const files = [
      buildArchiveFile('manifest.json', input.manifest),
      buildArchiveFile('source-evidence-summary.json', sourceEvidence),
      buildArchiveFile('prompt-catalog-summary.json', promptCatalog),
      buildArchiveFile('actor-action-runs.json', actionRuns),
      buildArchiveFile('task-route-summary.json', taskRoutes),
    ];
    const entries = files.map(file => archiveEntry(file.path, file));
    const embedded = Object.fromEntries(
      files.map(file => [file.path, file])
    ) as Record<string, CopilotSupportBundleArchiveFile>;
    const archiveIndexFingerprint = supportBundleFingerprint({
      version: 'localmind-support-bundle-archive-index/v1',
      files: entries,
    });

    return {
      version: 'localmind-support-bundle-archive/v1',
      bundleId: input.bundleId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      createdAt: input.createdAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      archiveIndexFingerprint,
      fileCount: files.length,
      files: entries,
      embedded,
    };
  }

  private buildPromptCatalogSnapshot(
    promptCatalog: PromptCatalogItem[]
  ): CopilotSupportBundlePromptCatalogSnapshot {
    const items = promptCatalog
      .map<CopilotSupportBundlePromptCatalogSnapshotItem>(prompt => ({
        name: prompt.name,
        model: prompt.model,
        modelSource: prompt.modelSource,
        source: prompt.source,
        category: prompt.category,
        revision: prompt.revision,
        fingerprint: prompt.fingerprint,
        templateFingerprint: prompt.templateFingerprint,
        optionalModelCount: prompt.optionalModelCount,
        paramCount: prompt.paramCount,
        overrideApplied: prompt.overrideApplied,
        ...(prompt.action ? { action: prompt.action } : {}),
        ...(prompt.defaultPolicy
          ? { defaultPolicy: prompt.defaultPolicy }
          : {}),
        ...(prompt.registryRecordSource
          ? { registryRecordSource: prompt.registryRecordSource }
          : {}),
        ...(prompt.registryRevision
          ? { registryRevision: prompt.registryRevision }
          : {}),
        ...(prompt.registryRevisionFingerprint
          ? { registryRevisionFingerprint: prompt.registryRevisionFingerprint }
          : {}),
        ...(prompt.registryRevisionScope
          ? { registryRevisionScope: prompt.registryRevisionScope }
          : {}),
        ...(prompt.registrySourceChainFingerprint
          ? {
              registrySourceChainFingerprint:
                prompt.registrySourceChainFingerprint,
            }
          : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const snapshot = {
      version: 'copilot-support-bundle-prompt-catalog-snapshot/v1' as const,
      itemCount: items.length,
      items,
    };

    return {
      ...snapshot,
      fingerprint: supportBundleFingerprint(snapshot),
    };
  }

  private async buildActionRunSnapshotSet(
    workspaceId: string,
    actorId: string
  ): Promise<CopilotSupportBundleActionRunSnapshotSet> {
    const limit = 20;
    const rows = await this.db.aiActionRun.findMany({
      where: {
        workspaceId,
        userId: actorId,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
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
        resultSummary: true,
        trace: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const runs = rows.map<CopilotSupportBundleActionRunSnapshot>(row => ({
      id: row.id,
      actionId: row.actionId,
      actionVersion: row.actionVersion,
      status: row.status,
      attempt: row.attempt,
      retryOf: row.retryOf,
      docId: row.docId,
      sessionId: row.sessionId,
      errorCode: row.errorCode,
      resultSummary: row.resultSummary,
      traceFingerprint: row.trace ? supportBundleFingerprint(row.trace) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
    const snapshot = {
      version: 'copilot-support-bundle-action-run-snapshot/v1' as const,
      workspaceId,
      actorId,
      limit,
      runCount: runs.length,
      runs,
    };

    return {
      ...snapshot,
      fingerprint: supportBundleFingerprint(snapshot),
    };
  }

  private buildTaskRouteSnapshotSet(
    workspaceId: string,
    routes: CopilotSupportBundleTaskRouteSnapshot[]
  ): CopilotSupportBundleTaskRouteSnapshotSet {
    const snapshotRoutes = routes
      .map(route => ({
        ...route,
        fallbackProviderIds: [...route.fallbackProviderIds],
        ...(route.behaviorFlags
          ? { behaviorFlags: [...route.behaviorFlags] }
          : {}),
      }))
      .sort((a, b) => a.featureKind.localeCompare(b.featureKind));
    const snapshot = {
      version: 'copilot-support-bundle-task-route-snapshot/v1' as const,
      workspaceId,
      routeCount: snapshotRoutes.length,
      routes: snapshotRoutes,
    };

    return {
      ...snapshot,
      fingerprint: supportBundleFingerprint(snapshot),
    };
  }

  private async buildSourceEvidenceSummary(
    workspaceId: string,
    actorId: string,
    promptCatalogItemCount: number,
    taskRouteCount: number
  ): Promise<CopilotSupportBundleSourceEvidenceSummary> {
    const actionRunCount = await this.db.aiActionRun.count({
      where: {
        workspaceId,
        userId: actorId,
      },
    });

    return {
      source: 'db_backed_packaged_archive',
      promptCatalogItemCount,
      actionRunCount,
      taskRouteCount,
      includedSections: [
        'manifest_json',
        'source_evidence_summary',
        'prompt_catalog_summary',
        'actor_action_runs',
        'task_route_summary',
      ],
    };
  }

  private async createAuditEvent(input: {
    bundleId: string;
    workspaceId: string;
    actorId: string;
    eventType: CopilotSupportBundleAuditEventType;
    metadata: Record<string, unknown>;
  }) {
    const id = randomUUID();
    const createdAt = new Date();
    const { metadata, serialized } = normalizeAuditMetadata(input.metadata);
    if (input.eventType === 'created') {
      validateCreationAuditMetadata(metadata);
    }
    if (input.eventType === 'archive_created') {
      validateArchiveCreatedAuditMetadata(metadata);
    }
    if (input.eventType === 'download_authorized') {
      validateDownloadAuthorizedAuditMetadata(metadata);
    }
    if (input.eventType === 'retention_expired') {
      validateRetentionAuditMetadata(metadata);
    }
    const eventFingerprint = supportBundleFingerprint({
      version: 'copilot-support-bundle-audit-event/v1',
      bundleId: input.bundleId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      eventType: input.eventType,
      metadata,
    });

    await this.db.$executeRaw`
      INSERT INTO ai_support_bundle_audit_events (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata,
        created_at
      )
      VALUES (
        ${id},
        ${input.bundleId},
        ${input.workspaceId},
        ${input.actorId},
        ${input.eventType},
        ${eventFingerprint},
        ${serialized}::jsonb,
        ${createdAt}
      )
    `;
  }
}
