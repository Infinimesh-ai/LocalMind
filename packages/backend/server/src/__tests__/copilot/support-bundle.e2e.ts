import { createHash, createHmac, randomUUID } from 'node:crypto';

import type { GraphQLQuery } from '@affine/graphql';
import { PrismaClient } from '@prisma/client';
import type { ExecutionContext, TestFn } from 'ava';
import ava from 'ava';

import { AppModule } from '../../app.module';
import {
  Config,
  CryptoHelper,
  JOB_SIGNAL,
  JobQueue,
  readableToBuffer,
  type StorageProvider,
  type StorageProviderConfig,
  StorageProviderFactory,
} from '../../base';
import { ConfigModule } from '../../base/config';
import { AuthService } from '../../core/auth';
import {
  CopilotSupportBundleArchive,
  CopilotSupportBundleManifest,
  CopilotSupportBundleRecord,
  Models,
  supportBundleFingerprint,
} from '../../models';
import { CopilotCronJobs } from '../../plugins/copilot/cron';
import { PromptService } from '../../plugins/copilot/prompt';
import { TestingPromptService } from '../mocks';
import {
  createTestingApp,
  createWorkspace,
  TestingApp,
  TestUser,
} from '../utils';

function supportBundleDownloadTokenFingerprint(token: string) {
  return createHash('sha256')
    .update(`copilot-support-bundle-download-token/v1:${token}`)
    .digest('hex');
}

const test = ava.serial as TestFn<{
  app: TestingApp;
  auth: AuthService;
  cronJobs: CopilotCronJobs;
  db: PrismaClient;
  owner: TestUser;
  prompt: TestingPromptService;
}>;

const supportBundleFields = `
  actorId
  archiveByteSize
  archiveFilename
  archiveFingerprint
  archiveMime
  archiveStorageKey
  auditEventCount
  auditEvents {
    actorId
    bundleId
    createdAt
    eventFingerprint
    eventType
    id
    metadata
    workspaceId
  }
  createdAt
  expiresAt
  failureCode
  failureMessage
  id
  manifestByteSize
  manifestFilename
  manifestFingerprint
  manifestMime
  manifestStorageKey
  manifestJson {
    actorId
    archive
    bundleId
    createdAt
    expiresAt
    retention {
      expiresAt
      status
    }
    sourceEvidenceSetFingerprint
    sourceEvidenceSummary {
      actionRunCount
      includedSections
      promptCatalogItemCount
      source
      taskRouteCount
    }
    version
    workspaceId
  }
  retentionStatus
  sourceEvidenceSetFingerprint
  sourceEvidenceSummary {
    actionRunCount
    includedSections
    promptCatalogItemCount
    source
    taskRouteCount
  }
  status
  transferEventCount
  transferEvents {
    artifactFingerprint
    artifactKind
    authorizationFingerprint
    authorizationId
    createdAt
    deliveryMethod
    eventFingerprint
    eventId
    eventSource
    id
    manifestFingerprint
    notificationAuthEvidenceFingerprint
    storageByteSize
    storageContentType
    storageKey
    transferredAt
  }
  transferForwardingEventCount
  transferForwardingEvents {
    attemptCount
    authorizationId
    createdAt
    deadLetteredAt
    eventId
    eventSource
    failureCode
    failureMessage
    forwardedAt
    forwardedTransferEventFingerprint
    forwardingEventFingerprint
    forwardingPayload
    forwardingPayloadFingerprint
    id
    lastAttemptAt
    maxAttempts
    nextAttemptAt
    providerSignatureEvidenceFingerprint
    status
    updatedAt
    workerLeaseExpiresAt
    workerLeaseId
  }
  updatedAt
  workspaceId
`;

const supportBundleDownloadAuthorizationFields = `
  actorId
  artifactFingerprint
  artifactFilename
  artifactKind
  artifactMime
  authorizationFingerprint
  bundleId
  createdAt
  deliveryMethod
  directDownloadExpiresAt
  directDownloadUrl
  downloadedAt
  downloadUrl
  expiresAt
  id
  manifestFingerprint
  status
  updatedAt
  workspaceId
`;

const supportBundleTransferEventPath =
  '/api/copilot/support-bundles/download-transfer-events';
const supportBundleObjectStorageWebhookId = 'support-bundle-s3-webhook-e2e';
const supportBundleObjectStorageWebhookSecret =
  'support-bundle-s3-webhook-secret-e2e';
const supportBundleObjectStorageWebhookPath = `/api/copilot/support-bundles/object-storage-webhooks/${supportBundleObjectStorageWebhookId}`;
const supportBundleProviderSignatureEvidenceHeader =
  'x-support-bundle-provider-signature-evidence';

const supportBundleProviderSignatureEvidence = (verifier: string) =>
  ({
    provider: 'aws_s3',
    status: 'verified_by_upstream',
    verifier,
    signatureFingerprint: 'a'.repeat(64),
    policy: 'aws-s3-event-notification',
  }) as const;

function compareTestStrings(left: string | null, right: string | null) {
  return String(left).localeCompare(String(right));
}

const createSupportBundleMutation = {
  id: 'createCopilotSupportBundleTestMutation',
  op: 'createCopilotSupportBundle',
  query: `
    mutation createCopilotSupportBundle($input: CopilotSupportBundleCreateInput!) {
      createCopilotSupportBundle(input: $input) {
        ${supportBundleFields}
      }
    }
  `,
} satisfies GraphQLQuery;

const listSupportBundlesQuery = {
  id: 'listCopilotSupportBundlesTestQuery',
  op: 'listCopilotSupportBundles',
  query: `
    query listCopilotSupportBundles(
      $workspaceId: String!
      $limit: SafeInt
      $filter: CopilotSupportBundleListFilterInput
    ) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          supportBundles(filter: $filter, limit: $limit) {
            ${supportBundleFields}
          }
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const getSupportBundleQuery = {
  id: 'getCopilotSupportBundleTestQuery',
  op: 'getCopilotSupportBundle',
  query: `
    query getCopilotSupportBundle($workspaceId: String!, $id: String!) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          supportBundle(id: $id) {
            ${supportBundleFields}
          }
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const authorizeSupportBundleDownloadMutation = {
  id: 'authorizeCopilotSupportBundleDownloadTestMutation',
  op: 'authorizeCopilotSupportBundleDownload',
  query: `
    mutation authorizeCopilotSupportBundleDownload(
      $input: CopilotSupportBundleDownloadAuthorizeInput!
    ) {
      authorizeCopilotSupportBundleDownload(input: $input) {
        ${supportBundleDownloadAuthorizationFields}
      }
    }
  `,
} satisfies GraphQLQuery;

const acknowledgeSupportBundleDirectDownloadMutation = {
  id: 'acknowledgeCopilotSupportBundleDirectDownloadTestMutation',
  op: 'acknowledgeCopilotSupportBundleDirectDownload',
  query: `
    mutation acknowledgeCopilotSupportBundleDirectDownload(
      $input: CopilotSupportBundleDirectDownloadAcknowledgeInput!
    ) {
      acknowledgeCopilotSupportBundleDirectDownload(input: $input) {
        ${supportBundleDownloadAuthorizationFields}
      }
    }
  `,
} satisfies GraphQLQuery;

const cleanupSupportBundleRetentionMutation = {
  id: 'cleanupCopilotSupportBundleRetentionTestMutation',
  op: 'cleanupCopilotSupportBundleRetention',
  query: `
    mutation cleanupCopilotSupportBundleRetention(
      $input: CopilotSupportBundleRetentionCleanupInput!
    ) {
      cleanupCopilotSupportBundleRetention(input: $input) {
        actorId
        archiveObjectCleanupFailedCount
        archiveObjectCleanupRecoveredCount
        archiveObjectCleanupRetryCount
        cleanedAt
        cleanupFingerprint
        expiredAuthorizationCount
        expiredBundleCount
        expiredBundles {
          ${supportBundleFields}
        }
        manifestObjectRewriteFailedCount
        manifestObjectRewriteRecoveredCount
        manifestObjectRewriteRetryCount
        workspaceId
      }
    }
  `,
} satisfies GraphQLQuery;

const replaySupportBundleTransferForwardingEventMutation = {
  id: 'replayCopilotSupportBundleTransferForwardingEventTestMutation',
  op: 'replayCopilotSupportBundleTransferForwardingEvent',
  query: `
    mutation replayCopilotSupportBundleTransferForwardingEvent(
      $input: CopilotSupportBundleTransferForwardingReplayInput!
    ) {
      replayCopilotSupportBundleTransferForwardingEvent(input: $input) {
        attemptCount
        authorizationId
        createdAt
        deadLetteredAt
        eventId
        eventSource
        failureCode
        failureMessage
        forwardedAt
        forwardedTransferEventFingerprint
        forwardingEventFingerprint
        forwardingPayload
        forwardingPayloadFingerprint
        id
        lastAttemptAt
        maxAttempts
        nextAttemptAt
        providerSignatureEvidenceFingerprint
        status
        updatedAt
        workerLeaseExpiresAt
        workerLeaseId
      }
    }
  `,
} satisfies GraphQLQuery;

function assertArchiveFile(
  t: ExecutionContext,
  archive: CopilotSupportBundleArchive,
  path: string,
  section: string
) {
  const entry = archive.files.find(file => file.path === path);
  const embedded = archive.embedded[path];

  t.truthy(entry);
  t.truthy(embedded);
  t.is(entry?.section, section);
  t.is(entry?.mediaType, 'application/json');
  t.is(embedded?.mediaType, 'application/json');
  t.is(embedded?.path, path);
  t.is(entry?.fingerprint, embedded?.fingerprint);
  t.is(entry?.byteSize, embedded?.byteSize);
  t.is(embedded?.fingerprint, supportBundleFingerprint(embedded?.content));
}

function installSignedUrlStorageMock(app: TestingApp) {
  const factory = app.get(StorageProviderFactory);
  const originalCreate = factory.create.bind(factory);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  supportBundleModel.storageProvider = null;

  factory.create = ((config: StorageProviderConfig) => {
    const provider = originalCreate(config);
    return {
      put: provider.put.bind(provider),
      presignPut: provider.presignPut?.bind(provider),
      createMultipartUpload: provider.createMultipartUpload?.bind(provider),
      presignUploadPart: provider.presignUploadPart?.bind(provider),
      listMultipartUploadParts:
        provider.listMultipartUploadParts?.bind(provider),
      completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
      abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
      head: provider.head.bind(provider),
      async get(key: string, signedUrl?: boolean) {
        if (signedUrl && key.startsWith('support-bundles/')) {
          const metadata = await provider.head(key);
          if (!metadata) {
            return {};
          }
          return {
            metadata,
            redirectUrl: `https://objects.example.test/${encodeURIComponent(
              key
            )}?signature=support-bundle-test`,
          };
        }

        return await provider.get(key, signedUrl);
      },
      list: provider.list.bind(provider),
      delete: provider.delete.bind(provider),
    } satisfies StorageProvider;
  }) as StorageProviderFactory['create'];

  return () => {
    factory.create = originalCreate;
    supportBundleModel.storageProvider = null;
  };
}

function createSupportBundleTransferEventAccessToken(app: TestingApp) {
  return app.get(CryptoHelper).signInternalAccessToken({
    method: 'POST',
    path: supportBundleTransferEventPath,
    nonce: `support-bundle-transfer-${randomUUID()}`,
  });
}

function supportBundleObjectStorageWebhookSignature(payload: unknown) {
  const body = JSON.stringify(payload);
  const signature = createHmac(
    'sha256',
    supportBundleObjectStorageWebhookSecret
  )
    .update(body)
    .digest('hex');

  return {
    body,
    signature: `sha256=${signature}`,
  };
}

function supportBundleProviderSignatureEvidenceHeaderValue(evidence: unknown) {
  return JSON.stringify(evidence) ?? 'null';
}

async function createExpiredSupportBundleFixture(input: {
  app: TestingApp;
  workspaceId: string;
  actorId: string;
  expiresAt?: Date;
}) {
  const prompt = input.app.get(PromptService);
  const models = input.app.get(Models);

  return await models.copilotSupportBundle.create({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    promptCatalog: await prompt.listCatalog(input.workspaceId),
    taskRoutes: [],
    expiresAt: input.expiresAt ?? new Date(Date.now() - 60_000),
  });
}

async function createDownloadAuthorizationFixture(input: {
  db: PrismaClient;
  bundle: CopilotSupportBundleRecord;
  artifactKind?: 'manifest_json' | 'archive_json';
  deliveryMethod?: 'api_proxy' | 'object_storage_signed_url';
  directDownloadExpiresAt?: Date | null;
  directDownloadUrl?: string | null;
  expiresAt?: Date;
  recordAudit?: boolean;
}) {
  const artifactKind = input.artifactKind ?? 'manifest_json';
  const now = new Date();
  const id = randomUUID();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 15 * 60_000);
  const deliveryMethod = input.deliveryMethod ?? 'api_proxy';
  const directDownloadUrl = input.directDownloadUrl ?? null;
  const directDownloadExpiresAt = input.directDownloadExpiresAt ?? null;
  const artifactFingerprint =
    artifactKind === 'archive_json'
      ? input.bundle.archiveFingerprint
      : input.bundle.manifestFingerprint;
  const artifactFilename =
    artifactKind === 'archive_json'
      ? input.bundle.archiveFilename
      : input.bundle.manifestFilename;
  const artifactMime =
    artifactKind === 'archive_json'
      ? input.bundle.archiveMime
      : input.bundle.manifestMime;
  if (!artifactFingerprint || !artifactFilename || !artifactMime) {
    throw new Error('Support bundle fixture artifact metadata is incomplete');
  }
  const authorizationFingerprint = supportBundleFingerprint({
    version: 'support-bundle-test-download-authorization/v1',
    id,
    bundleId: input.bundle.id,
    artifactKind,
    artifactFingerprint,
  });
  const downloadToken = `support-bundle-test-token-${id}`;
  const tokenFingerprint = supportBundleDownloadTokenFingerprint(downloadToken);

  const insertAuthorization = async (db: Pick<PrismaClient, '$executeRaw'>) => {
    await db.$executeRaw`
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
      VALUES (
        ${id},
        ${input.bundle.id},
        ${input.bundle.workspaceId},
        ${input.bundle.actorId},
        ${'authorized'},
        ${artifactKind},
        ${artifactFilename},
        ${artifactMime},
        ${input.bundle.manifestFingerprint},
        ${artifactFingerprint},
        ${authorizationFingerprint},
        ${tokenFingerprint},
        ${deliveryMethod},
        ${directDownloadUrl},
        ${directDownloadExpiresAt},
        ${expiresAt},
        ${now},
        ${now}
      )
    `;
  };

  if (input.recordAudit === false) {
    await insertAuthorization(input.db);
  } else {
    await input.db.$transaction(async tx => {
      await insertAuthorization(tx);
      await insertSupportBundleAuditEventFixture(tx, {
        bundleId: input.bundle.id,
        workspaceId: input.bundle.workspaceId,
        actorId: input.bundle.actorId,
        eventType: 'download_authorized',
        metadata: {
          version: 'copilot-support-bundle-download-authorized-audit/v1',
          authorizationId: id,
          authorizationFingerprint,
          artifactKind,
          artifactFilename,
          artifactMime,
          deliveryMethod,
          directDownloadExpiresAt:
            directDownloadExpiresAt?.toISOString() ?? null,
          hasDirectDownloadUrl: !!directDownloadUrl,
          manifestFingerprint: input.bundle.manifestFingerprint,
          artifactFingerprint,
          expiresAt: expiresAt.toISOString(),
        },
      });
    });
  }

  return {
    artifactFilename,
    artifactFingerprint,
    artifactKind,
    artifactMime,
    authorizationFingerprint,
    downloadToken,
    downloadUrl: `/api/copilot/support-bundles/${id}/artifact?token=${encodeURIComponent(
      downloadToken
    )}`,
    expiresAt,
    id,
  };
}

async function markDownloadAuthorizationDownloadedFixture(input: {
  db: PrismaClient;
  authorization: Awaited<ReturnType<typeof createDownloadAuthorizationFixture>>;
  bundle: CopilotSupportBundleRecord;
  downloadedAt?: Date;
}) {
  const downloadedAt = input.downloadedAt ?? new Date();
  await input.db.$transaction(async tx => {
    await tx.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET
        status = ${'downloaded'},
        downloaded_at = ${downloadedAt},
        updated_at = ${downloadedAt}
      WHERE id = ${input.authorization.id}
    `;
    await insertSupportBundleAuditEventFixture(tx, {
      bundleId: input.bundle.id,
      workspaceId: input.bundle.workspaceId,
      actorId: input.bundle.actorId,
      eventType: 'downloaded',
      metadata: {
        authorizationId: input.authorization.id,
        authorizationFingerprint: input.authorization.authorizationFingerprint,
        artifactKind: input.authorization.artifactKind,
        artifactFilename: input.authorization.artifactFilename,
        artifactMime: input.authorization.artifactMime,
        manifestFingerprint: input.bundle.manifestFingerprint,
        artifactFingerprint: input.authorization.artifactFingerprint,
      },
    });
  });
}

type SupportBundleAuditEventFixtureType =
  | 'created'
  | 'archive_created'
  | 'download_authorized'
  | 'downloaded'
  | 'retention_expired';

async function insertSupportBundleAuditEventFixture(
  db: Pick<PrismaClient, '$executeRaw'>,
  input: {
    bundleId: string;
    workspaceId: string;
    actorId: string;
    eventType: SupportBundleAuditEventFixtureType;
    metadata: Record<string, unknown>;
  }
) {
  const eventFingerprint = supportBundleFingerprint({
    version: 'copilot-support-bundle-audit-event/v1',
    bundleId: input.bundleId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    eventType: input.eventType,
    metadata: input.metadata,
  });

  await db.$executeRaw`
    INSERT INTO ai_support_bundle_audit_events (
      id,
      bundle_id,
      workspace_id,
      actor_id,
      event_type,
      event_fingerprint,
      metadata
    )
    VALUES (
      ${randomUUID()},
      ${input.bundleId},
      ${input.workspaceId},
      ${input.actorId},
      ${input.eventType},
      ${eventFingerprint},
      ${JSON.stringify(input.metadata)}::jsonb
    )
  `;
}

function supportBundleManifestByteSize(manifest: CopilotSupportBundleManifest) {
  return Buffer.byteLength(JSON.stringify(manifest, null, 2), 'utf8');
}

function supportBundleCreatedAuditMetadata(input: {
  bundleId: string;
  bundle: CopilotSupportBundleRecord;
  manifest: CopilotSupportBundleManifest;
  manifestByteSize: number | null;
  manifestFilename: string | null;
  manifestMime: string | null;
  manifestStorageKey: string | null;
  retentionStatus: string;
}) {
  return {
    manifestFingerprint: supportBundleFingerprint(input.manifest),
    manifestByteSize:
      input.manifestByteSize ?? supportBundleManifestByteSize(input.manifest),
    manifestFilename:
      input.manifestFilename ??
      `localmind-support-bundle-${input.bundleId}.manifest.json`,
    manifestMime: input.manifestMime ?? 'application/json',
    manifestStorageKey:
      input.manifestStorageKey ??
      `legacy-inline-support-bundles/${input.bundleId}.manifest.json`,
    sourceEvidenceSetFingerprint: input.bundle.sourceEvidenceSetFingerprint,
    retentionStatus: input.retentionStatus,
  };
}

function supportBundleArchiveCreatedAuditMetadata(input: {
  bundle: CopilotSupportBundleRecord;
  manifestFingerprint: string;
}) {
  if (
    !input.bundle.archiveByteSize ||
    !input.bundle.archiveFilename ||
    !input.bundle.archiveFingerprint ||
    !input.bundle.archiveMime ||
    !input.bundle.archiveStorageKey
  ) {
    throw new Error('Support bundle archive fixture metadata is incomplete');
  }

  return {
    archiveByteSize: input.bundle.archiveByteSize,
    archiveFilename: input.bundle.archiveFilename,
    archiveFingerprint: input.bundle.archiveFingerprint,
    archiveMime: input.bundle.archiveMime,
    archiveStorageKey: input.bundle.archiveStorageKey,
    manifestFingerprint: input.manifestFingerprint,
  };
}

test.before(async t => {
  const app = await createTestingApp({
    imports: [
      ConfigModule.override({
        copilot: {
          providers: {
            openai: { apiKey: '1' },
          },
          supportBundles: {
            objectStorageWebhooks: [
              {
                id: supportBundleObjectStorageWebhookId,
                provider: 'aws_s3',
                secret: supportBundleObjectStorageWebhookSecret,
                verifier: 'support-bundle-s3-webhook-e2e-verifier',
                policy: 'aws-s3-event-notification',
                signatureAlgorithm: 'hmac-sha256',
              },
            ],
          },
        },
      }),
      AppModule,
    ],
    tapModule: builder => {
      builder.overrideProvider(JobQueue).useClass(JobQueue);
      builder.overrideProvider(PromptService).useClass(TestingPromptService);
    },
  });

  t.context.app = app;
  t.context.auth = app.get(AuthService);
  t.context.cronJobs = app.get(CopilotCronJobs);
  t.context.db = app.get(PrismaClient);
  t.context.prompt = app.get(PromptService) as TestingPromptService;
});

test.beforeEach(async t => {
  await t.context.app.initTestingDB();
  t.context.prompt.reset();
  t.context.owner = await t.context.app.signupV1();
});

test.after.always(async t => {
  await t.context.app.close();
});

test('creates and reads a persisted support bundle request with manifest and audit events', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  await db.aiActionRun.create({
    data: {
      id: randomUUID(),
      workspaceId: workspace.id,
      userId: owner.id,
      actionId: 'support-bundle-test-action',
      actionVersion: '1',
      status: 'completed',
    },
  });

  const createResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
      },
    },
  });
  const bundle = createResult.createCopilotSupportBundle;

  t.is(bundle.workspaceId, workspace.id);
  t.is(bundle.actorId, owner.id);
  t.is(bundle.status, 'ready');
  t.is(bundle.retentionStatus, 'active');
  t.is(bundle.failureCode, null);
  t.is(bundle.failureMessage, null);
  t.is(bundle.auditEventCount, 2);
  t.is(bundle.auditEvents.length, 2);
  t.deepEqual(
    bundle.auditEvents
      .map((event: { eventType: string }) => event.eventType)
      .sort(compareTestStrings),
    ['archive_created', 'created']
  );
  t.true(
    bundle.auditEvents.every(
      (event: { actorId: string; bundleId: string; workspaceId: string }) =>
        event.actorId === owner.id &&
        event.bundleId === bundle.id &&
        event.workspaceId === workspace.id
    )
  );
  const archiveCreatedEvent = bundle.auditEvents.find(
    (event: { eventType: string }) => event.eventType === 'archive_created'
  );
  const createdEvent = bundle.auditEvents.find(
    (event: { eventType: string }) => event.eventType === 'created'
  );
  t.truthy(archiveCreatedEvent);
  t.truthy(createdEvent);
  t.like(archiveCreatedEvent?.metadata, {
    archiveFingerprint: bundle.archiveFingerprint,
    manifestFingerprint: bundle.manifestFingerprint,
  });
  t.like(createdEvent?.metadata, {
    manifestFingerprint: bundle.manifestFingerprint,
    sourceEvidenceSetFingerprint: bundle.sourceEvidenceSetFingerprint,
  });
  t.regex(archiveCreatedEvent?.eventFingerprint ?? '', /^[a-f0-9]{16}$/);
  t.is(bundle.transferEventCount, 0);
  t.deepEqual(bundle.transferEvents, []);
  t.is(bundle.transferForwardingEventCount, 0);
  t.deepEqual(bundle.transferForwardingEvents, []);
  t.true(bundle.manifestByteSize > 0);
  t.is(
    bundle.manifestFilename,
    `localmind-support-bundle-${bundle.id}.manifest.json`
  );
  t.is(bundle.manifestMime, 'application/json');
  t.truthy(bundle.manifestStorageKey);
  t.true(bundle.archiveByteSize > 0);
  t.is(
    bundle.archiveFilename,
    `localmind-support-bundle-${bundle.id}.archive.json`
  );
  t.is(bundle.archiveMime, 'application/json');
  t.truthy(bundle.archiveStorageKey);
  t.is(
    bundle.manifestJson.archive.archiveFingerprint,
    bundle.archiveFingerprint
  );
  t.is(bundle.manifestJson.archive.byteSize, bundle.archiveByteSize);
  t.is(bundle.manifestJson.archive.filename, bundle.archiveFilename);
  t.is(bundle.manifestJson.archive.mime, bundle.archiveMime);
  t.is(bundle.manifestJson.archive.storageKey, bundle.archiveStorageKey);
  t.is(bundle.manifestJson.version, 'copilot-support-bundle-manifest/v1');
  t.is(bundle.manifestJson.bundleId, bundle.id);
  t.is(bundle.manifestJson.workspaceId, workspace.id);
  t.is(bundle.manifestJson.actorId, owner.id);
  t.is(bundle.manifestJson.retention.status, 'active');
  t.true(bundle.manifestJson.sourceEvidenceSummary.promptCatalogItemCount > 0);
  t.is(bundle.manifestJson.sourceEvidenceSummary.actionRunCount, 1);
  t.is(bundle.manifestJson.sourceEvidenceSummary.taskRouteCount, 2);
  t.is(
    bundle.manifestJson.sourceEvidenceSummary.source,
    'db_backed_packaged_archive'
  );
  t.deepEqual(bundle.manifestJson.sourceEvidenceSummary.includedSections, [
    'manifest_json',
    'source_evidence_summary',
    'prompt_catalog_summary',
    'actor_action_runs',
    'task_route_summary',
  ]);
  t.is(
    bundle.manifestFingerprint,
    supportBundleFingerprint(
      bundle.manifestJson as CopilotSupportBundleManifest
    )
  );

  const rows = await db.$queryRaw<
    Array<{
      actorId: string;
      archiveByteSize: number | null;
      archiveFilename: string | null;
      archiveFingerprint: string | null;
      archiveMime: string | null;
      archiveStorageKey: string | null;
      manifestByteSize: number | null;
      manifestFilename: string | null;
      manifestFingerprint: string;
      manifestMime: string | null;
      manifestStorageKey: string | null;
      manifestJson: CopilotSupportBundleManifest;
      retentionStatus: string;
      sourceEvidenceSetFingerprint: string;
      status: string;
      workspaceId: string;
    }>
  >`
    SELECT
      actor_id AS "actorId",
      archive_byte_size AS "archiveByteSize",
      archive_filename AS "archiveFilename",
      archive_fingerprint AS "archiveFingerprint",
      archive_mime AS "archiveMime",
      archive_storage_key AS "archiveStorageKey",
      manifest_byte_size AS "manifestByteSize",
      manifest_filename AS "manifestFilename",
      manifest_fingerprint AS "manifestFingerprint",
      manifest_mime AS "manifestMime",
      manifest_storage_key AS "manifestStorageKey",
      manifest_json AS "manifestJson",
      retention_status AS "retentionStatus",
      source_evidence_set_fingerprint AS "sourceEvidenceSetFingerprint",
      status,
      workspace_id AS "workspaceId"
    FROM ai_support_bundle_requests
    WHERE id = ${bundle.id}
  `;
  t.is(rows.length, 1);
  t.like(rows[0], {
    actorId: owner.id,
    archiveByteSize: bundle.archiveByteSize,
    archiveFilename: bundle.archiveFilename,
    archiveFingerprint: bundle.archiveFingerprint,
    archiveMime: bundle.archiveMime,
    archiveStorageKey: bundle.archiveStorageKey,
    manifestByteSize: bundle.manifestByteSize,
    manifestFilename: bundle.manifestFilename,
    manifestFingerprint: bundle.manifestFingerprint,
    manifestMime: bundle.manifestMime,
    manifestStorageKey: bundle.manifestStorageKey,
    retentionStatus: 'active',
    sourceEvidenceSetFingerprint: bundle.sourceEvidenceSetFingerprint,
    status: 'ready',
    workspaceId: workspace.id,
  });
  t.deepEqual(rows[0].manifestJson, bundle.manifestJson);

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET updated_at = ${new Date('2026-06-22T12:49:00.000Z')}
      WHERE id = ${bundle.id}
    `,
    { message: /ai_support_bundle_requests_timestamp_coherence_check/ }
  );
  await db.$executeRaw`
    UPDATE ai_support_bundle_requests
    SET updated_at = updated_at
    WHERE id = ${bundle.id}
  `;
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET expires_at = ${new Date('2026-06-23T12:50:00.000Z')}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_lifecycle_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET
        status = ${'failed'},
        failure_code = ${'manual_status_drift'},
        failure_message = ${'Manual support bundle status drift'}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_lifecycle_update_restrict_check/,
    }
  );
  const prematureExpiredManifest = {
    ...(bundle.manifestJson as CopilotSupportBundleManifest),
    retention: {
      ...(bundle.manifestJson as CopilotSupportBundleManifest).retention,
      status: 'expired',
    },
  };
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET
        status = ${'expired'},
        retention_status = ${'expired'},
        manifest_json = ${JSON.stringify(prematureExpiredManifest)}::jsonb,
        manifest_fingerprint = ${supportBundleFingerprint(
          prematureExpiredManifest
        )},
        manifest_byte_size = ${
          JSON.stringify(prematureExpiredManifest, null, 2).length
        }
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_lifecycle_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET source_evidence_summary = source_evidence_summary ||
        ${JSON.stringify({ rewrittenAfterPersist: true })}::jsonb
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_evidence_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET archive_fingerprint = ${'0123456789abcdef'}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_evidence_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET created_at = ${new Date('2026-06-22T12:50:00.000Z')}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_evidence_update_restrict_check/,
    }
  );

  const auditAfterCreate = await db.$queryRaw<
    Array<{ eventType: string; workspaceId: string; actorId: string }>
  >`
    SELECT
      event_type AS "eventType",
      workspace_id AS "workspaceId",
      actor_id AS "actorId"
    FROM ai_support_bundle_audit_events
    WHERE bundle_id = ${bundle.id}
    ORDER BY created_at ASC
  `;
  t.deepEqual(auditAfterCreate, [
    {
      actorId: owner.id,
      eventType: 'created',
      workspaceId: workspace.id,
    },
    {
      actorId: owner.id,
      eventType: 'archive_created',
      workspaceId: workspace.id,
    },
  ]);

  const listResult = await app.gql({
    query: listSupportBundlesQuery,
    variables: {
      workspaceId: workspace.id,
      limit: 3,
    },
  });
  t.is(listResult.currentUser.copilot.supportBundles.length, 1);
  t.is(listResult.currentUser.copilot.supportBundles[0].id, bundle.id);
  t.is(listResult.currentUser.copilot.supportBundles[0].auditEventCount, 2);
  t.deepEqual(
    listResult.currentUser.copilot.supportBundles[0].auditEvents
      .map((event: { eventType: string }) => event.eventType)
      .sort(compareTestStrings),
    ['archive_created', 'created']
  );
  t.is(listResult.currentUser.copilot.supportBundles[0].transferEventCount, 0);
  t.deepEqual(
    listResult.currentUser.copilot.supportBundles[0].transferEvents,
    []
  );
  t.is(
    listResult.currentUser.copilot.supportBundles[0]
      .transferForwardingEventCount,
    0
  );
  t.deepEqual(
    listResult.currentUser.copilot.supportBundles[0].transferForwardingEvents,
    []
  );

  const getResult = await app.gql({
    query: getSupportBundleQuery,
    variables: {
      workspaceId: workspace.id,
      id: bundle.id,
    },
  });
  t.is(getResult.currentUser.copilot.supportBundle.id, bundle.id);
  t.is(getResult.currentUser.copilot.supportBundle.auditEventCount, 3);
  t.deepEqual(
    getResult.currentUser.copilot.supportBundle.auditEvents.map(
      (event: { eventType: string }) => event.eventType
    ),
    ['read', 'archive_created', 'created']
  );
  t.like(getResult.currentUser.copilot.supportBundle.auditEvents[0], {
    actorId: owner.id,
    bundleId: bundle.id,
    eventType: 'read',
    workspaceId: workspace.id,
  });
  t.deepEqual(
    getResult.currentUser.copilot.supportBundle.auditEvents[0].metadata,
    {
      manifestFingerprint: bundle.manifestFingerprint,
    }
  );
  t.is(getResult.currentUser.copilot.supportBundle.transferEventCount, 0);
  t.deepEqual(getResult.currentUser.copilot.supportBundle.transferEvents, []);
  t.is(
    getResult.currentUser.copilot.supportBundle.transferForwardingEventCount,
    0
  );
  t.deepEqual(
    getResult.currentUser.copilot.supportBundle.transferForwardingEvents,
    []
  );

  const auditAfterRead = await db.$queryRaw<
    Array<{ eventType: string; workspaceId: string; actorId: string }>
  >`
    SELECT
      event_type AS "eventType",
      workspace_id AS "workspaceId",
      actor_id AS "actorId"
    FROM ai_support_bundle_audit_events
    WHERE bundle_id = ${bundle.id}
    ORDER BY created_at ASC
  `;
  t.deepEqual(
    auditAfterRead.map(event => event.eventType),
    ['created', 'archive_created', 'read']
  );
  t.true(
    auditAfterRead.every(
      event => event.actorId === owner.id && event.workspaceId === workspace.id
    )
  );

  await db.$executeRaw`
    UPDATE ai_support_bundle_audit_events
    SET metadata = metadata
    WHERE bundle_id = ${bundle.id}
      AND event_type = ${'created'}
  `;

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET metadata = jsonb_set(
        metadata,
        ${'{manifestMime}'}::text[],
        ${JSON.stringify('application/localmind-json')}::jsonb
      )
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'created'}
    `,
    {
      message: /ai_support_bundle_audit_events_content_update_restrict_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET event_fingerprint = ${'deadbeefdeadbeef'}
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'created'}
    `,
    {
      message: /ai_support_bundle_audit_events_content_update_restrict_check/,
    }
  );

  const driftActor = await app.createUser();
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET actor_id = ${driftActor.id}
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'created'}
    `,
    {
      message: /ai_support_bundle_audit_events_content_update_restrict_check/,
    }
  );

  const authorizationResult = await app.gql({
    query: authorizeSupportBundleDownloadMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        bundleId: bundle.id,
        artifactKind: 'manifest_json',
      },
    },
  });
  const authorization =
    authorizationResult.authorizeCopilotSupportBundleDownload;
  t.like(authorization, {
    actorId: owner.id,
    artifactFingerprint: bundle.manifestFingerprint,
    artifactFilename: `localmind-support-bundle-${bundle.id}.manifest.json`,
    artifactKind: 'manifest_json',
    artifactMime: 'application/json',
    bundleId: bundle.id,
    deliveryMethod: 'api_proxy',
    directDownloadExpiresAt: null,
    directDownloadUrl: null,
    manifestFingerprint: bundle.manifestFingerprint,
    status: 'authorized',
    workspaceId: workspace.id,
  });
  t.true(
    authorization.downloadUrl.includes(
      `/api/copilot/support-bundles/${authorization.id}/artifact?token=`
    )
  );

  const authorizationRows = await db.$queryRaw<
    Array<{
      actorId: string;
      artifactFilename: string;
      artifactFingerprint: string;
      artifactKind: string;
      artifactMime: string;
      authorizationFingerprint: string;
      bundleId: string;
      deliveryMethod: string;
      directDownloadExpiresAt: Date | null;
      directDownloadUrl: string | null;
      manifestFingerprint: string;
      status: string;
      tokenFingerprint: string;
      workspaceId: string;
    }>
  >`
    SELECT
      actor_id AS "actorId",
      artifact_filename AS "artifactFilename",
      artifact_fingerprint AS "artifactFingerprint",
      artifact_kind AS "artifactKind",
      artifact_mime AS "artifactMime",
      authorization_fingerprint AS "authorizationFingerprint",
      bundle_id AS "bundleId",
      delivery_method AS "deliveryMethod",
      direct_download_expires_at AS "directDownloadExpiresAt",
      direct_download_url AS "directDownloadUrl",
      manifest_fingerprint AS "manifestFingerprint",
      status,
      token_fingerprint AS "tokenFingerprint",
      workspace_id AS "workspaceId"
    FROM ai_support_bundle_download_authorizations
    WHERE id = ${authorization.id}
  `;
  t.is(authorizationRows.length, 1);
  t.like(authorizationRows[0], {
    actorId: owner.id,
    artifactFilename: authorization.artifactFilename,
    artifactFingerprint: bundle.manifestFingerprint,
    artifactKind: 'manifest_json',
    artifactMime: 'application/json',
    authorizationFingerprint: authorization.authorizationFingerprint,
    bundleId: bundle.id,
    deliveryMethod: 'api_proxy',
    directDownloadExpiresAt: null,
    directDownloadUrl: null,
    manifestFingerprint: bundle.manifestFingerprint,
    status: 'authorized',
    workspaceId: workspace.id,
  });
  t.is(authorizationRows[0].tokenFingerprint.length, 64);
  t.false(
    authorization.downloadUrl.includes(authorizationRows[0].tokenFingerprint)
  );
  await db.$executeRaw`
    UPDATE ai_support_bundle_download_authorizations
    SET updated_at = updated_at
    WHERE id = ${authorization.id}
  `;
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET status = ${'expired'}
      WHERE id = ${authorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_lifecycle_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET status = ${'revoked'}
      WHERE id = ${authorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_lifecycle_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET token_fingerprint = ${'c'.repeat(64)}
      WHERE id = ${authorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_evidence_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET expires_at = ${new Date('2026-06-22T13:05:00.000Z')}
      WHERE id = ${authorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_evidence_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET created_at = ${new Date('2026-06-22T12:55:00.000Z')}
      WHERE id = ${authorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_evidence_update_restrict_check/,
    }
  );

  const archiveAuthorizationResult = await app.gql({
    query: authorizeSupportBundleDownloadMutation,
    variables: {
      input: {
        artifactKind: 'archive_json',
        bundleId: bundle.id,
        workspaceId: workspace.id,
      },
    },
  });
  const archiveAuthorization =
    archiveAuthorizationResult.authorizeCopilotSupportBundleDownload;
  t.like(archiveAuthorization, {
    artifactFingerprint: bundle.archiveFingerprint,
    artifactKind: 'archive_json',
    manifestFingerprint: bundle.manifestFingerprint,
  });
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET artifact_fingerprint = ${'deadbeefdeadbeef'}
      WHERE id = ${archiveAuthorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_archive_snapshot_check/,
    }
  );

  const otherWorkspace = await createWorkspace(app);
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET workspace_id = ${otherWorkspace.id}
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'created'}
    `,
    {
      message: /ai_support_bundle_audit_events_bundle_workspace_snapshot_fkey/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET workspace_id = ${otherWorkspace.id}
      WHERE id = ${authorization.id}
    `,
    {
      message: /ai_support_bundle_auth_bundle_workspace_snapshot_fkey/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET manifest_fingerprint = ${'drifted-manifest-snapshot'}
      WHERE id = ${authorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_manifest_snapshot_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
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
        expires_at
      )
      VALUES (
        ${randomUUID()},
        ${bundle.id},
        ${workspace.id},
        ${owner.id},
        ${'authorized'},
        ${'archive_json'},
        ${bundle.archiveFilename},
        ${bundle.archiveMime},
        ${'drifted-manifest-snapshot'},
        ${bundle.archiveFingerprint},
        ${supportBundleFingerprint({
          version: 'support-bundle-invalid-auth-snapshot-test/v1',
          bundleId: bundle.id,
        })},
        ${'a'.repeat(64)},
        ${'api_proxy'},
        ${new Date('2026-06-22T13:00:00.000Z')}
      )
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_manifest_snapshot_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
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
        expires_at
      )
      VALUES (
        ${randomUUID()},
        ${bundle.id},
        ${workspace.id},
        ${owner.id},
        ${'authorized'},
        ${'archive_json'},
        ${bundle.archiveFilename},
        ${bundle.archiveMime},
        ${bundle.manifestFingerprint},
        ${'deadbeefdeadbeef'},
        ${supportBundleFingerprint({
          version: 'support-bundle-invalid-archive-auth-snapshot-test/v1',
          bundleId: bundle.id,
        })},
        ${'b'.repeat(64)},
        ${'api_proxy'},
        ${new Date('2026-06-22T13:00:00.000Z')}
      )
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_archive_snapshot_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET updated_at = ${new Date('2026-06-22T12:49:00.000Z')}
      WHERE id = ${authorization.id}
    `,
    {
      message: /ai_support_bundle_download_authorizations_timestamp_coherence/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET
        status = ${'downloaded'},
        downloaded_at = ${new Date('2026-06-22T12:49:00.000Z')}
      WHERE id = ${authorization.id}
    `,
    {
      message: /ai_support_bundle_download_authorizations_timestamp_coherence/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET source_evidence_summary = ${JSON.stringify(['not-an-object'])}::jsonb
      WHERE id = ${bundle.id}
    `,
    { message: /ai_support_bundle_requests_json_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET manifest_json = ${JSON.stringify(['not-a-manifest'])}::jsonb
      WHERE id = ${bundle.id}
    `,
    { message: /ai_support_bundle_requests_json_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET manifest_json = jsonb_set(
        manifest_json,
        ${'{workspaceId}'}::text[],
        ${JSON.stringify('wrong-support-bundle-workspace')}::jsonb
      )
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_manifest_identity_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET failure_code = ${'support_bundle_orphan_failure_code'}
      WHERE id = ${bundle.id}
    `,
    { message: /ai_support_bundle_requests_failure_pair_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET failure_message = ${'Support bundle orphan failure message'}
      WHERE id = ${bundle.id}
    `,
    { message: /ai_support_bundle_requests_failure_pair_check/ }
  );

  const blankFailureCodeId = randomUUID();
  const blankFailureCodeManifest = {
    ...bundle.manifestJson,
    bundleId: blankFailureCodeId,
    workspaceId: workspace.id,
    actorId: owner.id,
    sourceEvidenceSetFingerprint: bundle.sourceEvidenceSetFingerprint,
  };
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_support_bundle_requests (
        id,
        workspace_id,
        actor_id,
        status,
        source_evidence_summary,
        source_evidence_set_fingerprint,
        manifest_fingerprint,
        manifest_json,
        retention_status,
        expires_at,
        failure_code,
        failure_message,
        created_at,
        updated_at
      )
      VALUES (
        ${blankFailureCodeId},
        ${workspace.id},
        ${owner.id},
        ${'failed'},
        ${JSON.stringify(bundle.sourceEvidenceSummary)}::jsonb,
        ${bundle.sourceEvidenceSetFingerprint},
        ${supportBundleFingerprint(blankFailureCodeManifest)},
        ${JSON.stringify(blankFailureCodeManifest)}::jsonb,
        ${'active'},
        ${new Date(bundle.expiresAt)},
        ${'   '},
        ${'Support bundle storage write failed'},
        ${new Date()},
        ${new Date()}
      )
    `,
    { message: /ai_support_bundle_requests_failure_string_shape_check/ }
  );
  const blankFailureMessageId = randomUUID();
  const blankFailureMessageManifest = {
    ...bundle.manifestJson,
    bundleId: blankFailureMessageId,
    workspaceId: workspace.id,
    actorId: owner.id,
    sourceEvidenceSetFingerprint: bundle.sourceEvidenceSetFingerprint,
  };
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_support_bundle_requests (
        id,
        workspace_id,
        actor_id,
        status,
        source_evidence_summary,
        source_evidence_set_fingerprint,
        manifest_fingerprint,
        manifest_json,
        retention_status,
        expires_at,
        failure_code,
        failure_message,
        created_at,
        updated_at
      )
      VALUES (
        ${blankFailureMessageId},
        ${workspace.id},
        ${owner.id},
        ${'failed'},
        ${JSON.stringify(bundle.sourceEvidenceSummary)}::jsonb,
        ${bundle.sourceEvidenceSetFingerprint},
        ${supportBundleFingerprint(blankFailureMessageManifest)},
        ${JSON.stringify(blankFailureMessageManifest)}::jsonb,
        ${'active'},
        ${new Date(bundle.expiresAt)},
        ${'support_bundle_storage_failure'},
        ${'   '},
        ${new Date()},
        ${new Date()}
      )
    `,
    { message: /ai_support_bundle_requests_failure_string_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET source_evidence_set_fingerprint = ${'   '}
      WHERE id = ${bundle.id}
    `,
    { message: /ai_support_bundle_requests_fingerprint_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET manifest_fingerprint = ${'   '}
      WHERE id = ${bundle.id}
    `,
    { message: /ai_support_bundle_requests_fingerprint_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET manifest_storage_key = ${null}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_manifest_artifact_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET manifest_storage_key = ${'   '}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_artifact_string_shape_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET archive_filename = ${'   '}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_artifact_string_shape_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET archive_byte_size = ${0}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_archive_artifact_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET retention_status = ${'expired'}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_status_retention_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET status = ${'expired'}
      WHERE id = ${bundle.id}
    `,
    {
      message: /ai_support_bundle_requests_status_retention_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET metadata = ${JSON.stringify(['not-metadata'])}::jsonb
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'download_authorized'}
    `,
    { message: /ai_support_bundle_audit_events_.*metadata_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET event_fingerprint = ${'   '}
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'download_authorized'}
    `,
    { message: /ai_support_bundle_audit_events_fingerprint_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET metadata = metadata - ${'manifestStorageKey'}
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'created'}
    `,
    {
      message: /ai_support_bundle_audit_events_creation_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET metadata = jsonb_set(
        metadata,
        ${'{manifestByteSize}'}::text[],
        ${'0'}::jsonb
      )
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'created'}
    `,
    {
      message: /ai_support_bundle_audit_events_creation_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET metadata = metadata - ${'archiveFingerprint'}
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'archive_created'}
    `,
    {
      message: /ai_support_bundle_audit_events_creation_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET metadata = jsonb_set(
        metadata,
        ${'{archiveByteSize}'}::text[],
        ${'0'}::jsonb
      )
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'archive_created'}
    `,
    {
      message: /ai_support_bundle_audit_events_creation_metadata_check/,
    }
  );

  const missingDownloadAuditVersionMetadata = {
    authorizationId: authorization.id,
    authorizationFingerprint: authorization.authorizationFingerprint,
    artifactKind: 'manifest_json',
    artifactFilename: authorization.artifactFilename,
    artifactMime: authorization.artifactMime,
    deliveryMethod: 'api_proxy',
    directDownloadExpiresAt: null,
    hasDirectDownloadUrl: false,
    manifestFingerprint: bundle.manifestFingerprint,
    artifactFingerprint: bundle.manifestFingerprint,
    expiresAt: authorization.expiresAt,
  };
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_audit_events
      SET metadata = ${JSON.stringify(missingDownloadAuditVersionMetadata)}::jsonb
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'download_authorized'}
        AND metadata->>'authorizationId' = ${authorization.id}
    `,
    {
      message: /ai_support_bundle_audit_events_download_metadata_check/,
    }
  );

  const missingDownloadExpirationCleanupMetadata = {
    version: 'copilot-support-bundle-download-authorization-expired-audit/v1',
    authorizationExpired: true,
    authorizationId: authorization.id,
    authorizationFingerprint: authorization.authorizationFingerprint,
    artifactKind: 'manifest_json',
    artifactFingerprint: bundle.manifestFingerprint,
    cleanupActorId: 'system_download_authorization_expiration_guard',
    cleanupScope: 'api_proxy_consume',
    cleanedAt: '2026-06-22T12:52:00.000Z',
    deliveryMethod: 'api_proxy',
    expiresAt: authorization.expiresAt,
    previousStatus: 'authorized',
    status: 'expired',
  };
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_support_bundle_audit_events (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata
      )
      VALUES (
        ${randomUUID()},
        ${bundle.id},
        ${workspace.id},
        ${owner.id},
        ${'download_authorized'},
        ${supportBundleFingerprint(missingDownloadExpirationCleanupMetadata)},
        ${JSON.stringify(missingDownloadExpirationCleanupMetadata)}::jsonb
      )
    `,
    {
      message: /ai_support_bundle_audit_events_download_metadata_check/,
    }
  );

  const invalidRetentionMetadata = {
    cleanupActorId: owner.id,
    cleanupFingerprint: 'retention-cleanup-fp',
    cleanupScope: 'manual_workspace',
    cleanedAt: '2026-06-22T12:50:00.000Z',
    archiveObjectCleanupStatus: 'retrying',
    expiredAuthorizationCount: 0,
    retentionStatus: 'expired',
  };
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_support_bundle_audit_events (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata
      )
      VALUES (
        ${randomUUID()},
        ${bundle.id},
        ${workspace.id},
        ${owner.id},
        ${'retention_expired'},
        ${supportBundleFingerprint(invalidRetentionMetadata)},
        ${JSON.stringify(invalidRetentionMetadata)}::jsonb
      )
    `,
    {
      message: /ai_support_bundle_audit_events_retention_metadata_check/,
    }
  );

  const missingCleanupFingerprintMetadata = {
    cleanupActorId: owner.id,
    cleanupScope: 'manual_workspace',
    cleanedAt: '2026-06-22T12:51:00.000Z',
    archiveObjectCleanupStatus: 'deleted',
    expiredAuthorizationCount: 0,
    retentionStatus: 'expired',
  };
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_support_bundle_audit_events (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata
      )
      VALUES (
        ${randomUUID()},
        ${bundle.id},
        ${workspace.id},
        ${owner.id},
        ${'retention_expired'},
        ${supportBundleFingerprint(missingCleanupFingerprintMetadata)},
        ${JSON.stringify(missingCleanupFingerprintMetadata)}::jsonb
      )
    `,
    {
      message: /ai_support_bundle_audit_events_retention_metadata_check/,
    }
  );

  const retentionRetryBaseMetadata = {
    cleanupActorId: owner.id,
    cleanupFingerprint: 'retention-retry-contract-fp',
    cleanupScope: 'manual_workspace',
    cleanedAt: '2026-06-22T12:53:00.000Z',
    expiredAuthorizationCount: 0,
    manifestFingerprint: bundle.manifestFingerprint,
    previousManifestFingerprint: bundle.manifestFingerprint,
    retentionStatus: 'expired',
  };

  const missingArchiveRetryPreviousFingerprintMetadata = {
    ...retentionRetryBaseMetadata,
    archiveObjectCleanupErrorCode: null,
    archiveObjectCleanupErrorMessage: null,
    archiveObjectCleanupFailureCount: 1,
    archiveObjectCleanupRetry: true,
    archiveObjectCleanupStatus: 'deleted',
    archiveStorageKey: bundle.archiveStorageKey,
    previousArchiveObjectCleanupErrorCode: 'Error',
    previousArchiveObjectCleanupErrorMessage: 'archive delete unavailable',
  };
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_support_bundle_audit_events (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata
      )
      VALUES (
        ${randomUUID()},
        ${bundle.id},
        ${workspace.id},
        ${owner.id},
        ${'retention_expired'},
        ${supportBundleFingerprint(
          missingArchiveRetryPreviousFingerprintMetadata
        )},
        ${JSON.stringify(missingArchiveRetryPreviousFingerprintMetadata)}::jsonb
      )
    `,
    {
      message: /ai_support_bundle_audit_events_retention_retry_metadata_check/,
    }
  );

  const missingManifestRetryPreviousFingerprintMetadata = {
    ...retentionRetryBaseMetadata,
    manifestByteSize: bundle.manifestByteSize,
    manifestObjectRewriteErrorCode: null,
    manifestObjectRewriteErrorMessage: null,
    manifestObjectRewriteFailureCount: 1,
    manifestObjectRewriteRetry: true,
    manifestObjectRewriteStatus: 'written',
    manifestStorageKey: bundle.manifestStorageKey,
    previousManifestObjectRewriteErrorCode: 'Error',
    previousManifestObjectRewriteErrorMessage: 'manifest rewrite unavailable',
  };
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_support_bundle_audit_events (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata
      )
      VALUES (
        ${randomUUID()},
        ${bundle.id},
        ${workspace.id},
        ${owner.id},
        ${'retention_expired'},
        ${supportBundleFingerprint(
          missingManifestRetryPreviousFingerprintMetadata
        )},
        ${JSON.stringify(
          missingManifestRetryPreviousFingerprintMetadata
        )}::jsonb
      )
    `,
    {
      message: /ai_support_bundle_audit_events_retention_retry_metadata_check/,
    }
  );

  const invalidArchiveEscalationStatusMetadata = {
    ...retentionRetryBaseMetadata,
    cleanupActorId: 'system_retention_worker',
    cleanupFingerprint: 'retention-archive-escalation-fp',
    cleanupScope: 'scheduled_worker',
    archiveObjectCleanupErrorCode: null,
    archiveObjectCleanupErrorMessage: null,
    archiveObjectCleanupEscalated: true,
    archiveObjectCleanupEscalatedAt: '2026-06-22T12:54:00.000Z',
    archiveObjectCleanupEscalationReason: 'scheduled_retry_limit_exceeded',
    archiveObjectCleanupFailureCount: 2,
    archiveObjectCleanupRetry: true,
    archiveObjectCleanupStatus: 'deleted',
    archiveStorageKey: bundle.archiveStorageKey,
    previousArchiveObjectCleanupErrorCode: 'Error',
    previousArchiveObjectCleanupErrorMessage: 'archive delete unavailable',
    previousArchiveObjectCleanupFingerprint: 'previous-archive-cleanup-fp',
  };
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_support_bundle_audit_events (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata
      )
      VALUES (
        ${randomUUID()},
        ${bundle.id},
        ${workspace.id},
        ${owner.id},
        ${'retention_expired'},
        ${supportBundleFingerprint(invalidArchiveEscalationStatusMetadata)},
        ${JSON.stringify(invalidArchiveEscalationStatusMetadata)}::jsonb
      )
    `,
    {
      message: /ai_support_bundle_audit_events_retention_retry_metadata_check/,
    }
  );

  const invalidManifestEscalationRetryMetadata = {
    ...retentionRetryBaseMetadata,
    cleanupActorId: 'system_retention_worker',
    cleanupFingerprint: 'retention-manifest-escalation-fp',
    cleanupScope: 'scheduled_worker',
    manifestByteSize: bundle.manifestByteSize,
    manifestObjectRewriteErrorCode: 'Error',
    manifestObjectRewriteErrorMessage: 'manifest rewrite unavailable',
    manifestObjectRewriteEscalated: true,
    manifestObjectRewriteEscalatedAt: '2026-06-22T12:55:00.000Z',
    manifestObjectRewriteEscalationReason: 'scheduled_retry_limit_exceeded',
    manifestObjectRewriteFailureCount: 2,
    manifestObjectRewriteStatus: 'failed',
    manifestStorageKey: bundle.manifestStorageKey,
    previousManifestObjectRewriteErrorCode: 'Error',
    previousManifestObjectRewriteErrorMessage: 'manifest rewrite unavailable',
    previousManifestObjectRewriteFingerprint: 'previous-manifest-rewrite-fp',
  };
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_support_bundle_audit_events (
        id,
        bundle_id,
        workspace_id,
        actor_id,
        event_type,
        event_fingerprint,
        metadata
      )
      VALUES (
        ${randomUUID()},
        ${bundle.id},
        ${workspace.id},
        ${owner.id},
        ${'retention_expired'},
        ${supportBundleFingerprint(invalidManifestEscalationRetryMetadata)},
        ${JSON.stringify(invalidManifestEscalationRetryMetadata)}::jsonb
      )
    `,
    {
      message: /ai_support_bundle_audit_events_retention_retry_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET artifact_fingerprint = ${'deadbeefdeadbeef'}
      WHERE id = ${authorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_manifest_artifact_fingerprint|ai_support_bundle_download_authorizations_manifest_artifact_fin/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET artifact_filename = ${'   '}
      WHERE id = ${authorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_artifact_string_shape/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET artifact_mime = ${'   '}
      WHERE id = ${authorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_artifact_string_shape/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET token_fingerprint = ${'not-a-sha256-token-fingerprint'}
      WHERE id = ${authorization.id}
    `,
    {
      message: /ai_support_bundle_download_authorizations_fingerprint_shape/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET authorization_fingerprint = ${'not-a-fingerprint'}
      WHERE id = ${authorization.id}
    `,
    {
      message: /ai_support_bundle_download_authorizations_fingerprint_shape/,
    }
  );

  const expiredAuthorization = await createDownloadAuthorizationFixture({
    db,
    bundle,
    expiresAt: new Date(Date.now() - 60_000),
  });
  const expiredArtifactUrl = new URL(
    expiredAuthorization.downloadUrl,
    app.url()
  );
  await app
    .GET(`${expiredArtifactUrl.pathname}${expiredArtifactUrl.search}`)
    .expect(404);

  const expiredAuditRows = await db.$queryRaw<
    Array<{ metadata: Record<string, unknown> }>
  >`
    SELECT metadata
    FROM ai_support_bundle_audit_events
    WHERE bundle_id = ${bundle.id}
      AND event_type = ${'download_authorized'}
      AND metadata->>'authorizationExpired' = ${'true'}
      AND metadata->>'authorizationId' = ${expiredAuthorization.id}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  t.like(expiredAuditRows[0].metadata, {
    authorizationExpired: true,
    authorizationId: expiredAuthorization.id,
    authorizationFingerprint: expiredAuthorization.authorizationFingerprint,
    artifactKind: 'manifest_json',
    cleanupActorId: 'system_download_authorization_expiration_guard',
    cleanupScope: 'api_proxy_consume',
    deliveryMethod: 'api_proxy',
    previousStatus: 'authorized',
    status: 'expired',
  });

  const artifactUrl = new URL(authorization.downloadUrl, app.url());
  const artifactPath = `${artifactUrl.pathname}${artifactUrl.search}`;
  const artifactResponse = await app.GET(artifactPath).expect(200);
  t.is(
    artifactResponse.headers['content-type'],
    'application/json; charset=utf-8'
  );
  t.is(
    artifactResponse.headers['content-disposition'],
    `attachment; filename="${authorization.artifactFilename}"`
  );
  t.deepEqual(
    typeof artifactResponse.body === 'string'
      ? JSON.parse(artifactResponse.body)
      : artifactResponse.body,
    bundle.manifestJson
  );

  await app.GET(artifactPath).expect(404);

  const downloadRows = await db.$queryRaw<
    Array<{ status: string; downloadedAt: Date | null }>
  >`
    SELECT
      status,
      downloaded_at AS "downloadedAt"
    FROM ai_support_bundle_download_authorizations
    WHERE id = ${authorization.id}
  `;
  t.is(downloadRows[0].status, 'downloaded');
  t.truthy(downloadRows[0].downloadedAt);

  const archiveArtifactAuthorizationResult = await app.gql({
    query: authorizeSupportBundleDownloadMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        bundleId: bundle.id,
        artifactKind: 'archive_json',
      },
    },
  });
  const archiveArtifactAuthorization =
    archiveArtifactAuthorizationResult.authorizeCopilotSupportBundleDownload;
  t.like(archiveArtifactAuthorization, {
    actorId: owner.id,
    artifactFilename: bundle.archiveFilename,
    artifactFingerprint: bundle.archiveFingerprint,
    artifactKind: 'archive_json',
    artifactMime: 'application/json',
    bundleId: bundle.id,
    deliveryMethod: 'api_proxy',
    directDownloadExpiresAt: null,
    directDownloadUrl: null,
    manifestFingerprint: bundle.manifestFingerprint,
    status: 'authorized',
    workspaceId: workspace.id,
  });

  const archiveUrl = new URL(
    archiveArtifactAuthorization.downloadUrl,
    app.url()
  );
  const archiveResponse = await app
    .GET(`${archiveUrl.pathname}${archiveUrl.search}`)
    .expect(200);
  t.is(
    archiveResponse.headers['content-disposition'],
    `attachment; filename="${bundle.archiveFilename}"`
  );
  const archivePayload: CopilotSupportBundleArchive =
    typeof archiveResponse.body === 'string'
      ? JSON.parse(archiveResponse.body)
      : (archiveResponse.body as CopilotSupportBundleArchive);
  t.like(archivePayload, {
    actorId: owner.id,
    bundleId: bundle.id,
    version: 'localmind-support-bundle-archive/v1',
    workspaceId: workspace.id,
  });
  t.is(archivePayload.fileCount, 5);
  t.is(archivePayload.files.length, 5);
  t.is(
    archivePayload.archiveIndexFingerprint,
    supportBundleFingerprint({
      version: 'localmind-support-bundle-archive-index/v1',
      files: archivePayload.files,
    })
  );
  assertArchiveFile(t, archivePayload, 'manifest.json', 'manifest.json');
  assertArchiveFile(
    t,
    archivePayload,
    'source-evidence-summary.json',
    'source-evidence-summary.json'
  );
  assertArchiveFile(
    t,
    archivePayload,
    'prompt-catalog-summary.json',
    'prompt-catalog-summary.json'
  );
  assertArchiveFile(
    t,
    archivePayload,
    'actor-action-runs.json',
    'actor-action-runs.json'
  );
  assertArchiveFile(
    t,
    archivePayload,
    'task-route-summary.json',
    'task-route-summary.json'
  );
  t.like(archivePayload.embedded['manifest.json'].content, {
    bundleId: bundle.id,
    workspaceId: workspace.id,
    sourceEvidenceSetFingerprint: bundle.sourceEvidenceSetFingerprint,
    retention: {
      status: 'active',
    },
  });
  t.deepEqual(archivePayload.embedded['source-evidence-summary.json'].content, {
    version: 'copilot-support-bundle-source-evidence-summary/v1',
    workspaceId: workspace.id,
    actorId: owner.id,
    sourceEvidenceSummary: bundle.manifestJson.sourceEvidenceSummary,
    sourceEvidenceSetFingerprint: bundle.sourceEvidenceSetFingerprint,
  });
  const promptCatalog = archivePayload.embedded['prompt-catalog-summary.json']
    .content as {
    fingerprint: string;
    itemCount: number;
    items: Array<{ name: string; fingerprint: string }>;
    version: string;
  };
  t.is(
    promptCatalog.version,
    'copilot-support-bundle-prompt-catalog-snapshot/v1'
  );
  t.is(
    promptCatalog.itemCount,
    bundle.sourceEvidenceSummary.promptCatalogItemCount
  );
  t.true(promptCatalog.itemCount > 0);
  t.true(
    promptCatalog.items.every(
      item => item.name.length > 0 && item.fingerprint.length > 0
    )
  );
  t.is(
    promptCatalog.fingerprint,
    supportBundleFingerprint({
      version: promptCatalog.version,
      itemCount: promptCatalog.itemCount,
      items: promptCatalog.items,
    })
  );
  const actionRuns = archivePayload.embedded['actor-action-runs.json']
    .content as {
    actorId: string;
    fingerprint: string;
    limit: number;
    runCount: number;
    runs: Array<{
      actionId: string;
      actionVersion: string;
      attempt: number;
      createdAt: string;
      docId: string | null;
      errorCode: string | null;
      id: string;
      resultSummary: string | null;
      retryOf: string | null;
      sessionId: string | null;
      status: string;
      traceFingerprint: string | null;
      updatedAt: string;
    }>;
    version: string;
    workspaceId: string;
  };
  t.like(actionRuns, {
    actorId: owner.id,
    runCount: 1,
    version: 'copilot-support-bundle-action-run-snapshot/v1',
    workspaceId: workspace.id,
  });
  t.deepEqual(actionRuns.runs, [
    {
      actionId: 'support-bundle-test-action',
      actionVersion: '1',
      attempt: 1,
      createdAt: actionRuns.runs[0]?.createdAt,
      docId: null,
      errorCode: null,
      id: actionRuns.runs[0]?.id,
      resultSummary: null,
      retryOf: null,
      sessionId: null,
      status: 'completed',
      traceFingerprint: null,
      updatedAt: actionRuns.runs[0]?.updatedAt,
    },
  ]);
  t.is(
    actionRuns.fingerprint,
    supportBundleFingerprint({
      version: actionRuns.version,
      workspaceId: actionRuns.workspaceId,
      actorId: actionRuns.actorId,
      limit: actionRuns.limit,
      runCount: actionRuns.runCount,
      runs: actionRuns.runs,
    })
  );
  const taskRoutes = archivePayload.embedded['task-route-summary.json']
    .content as {
    fingerprint: string;
    routeCount: number;
    routes: Array<{ featureKind: string; requestedModelId: string }>;
    version: string;
    workspaceId: string;
  };
  t.like(taskRoutes, {
    routeCount: 2,
    version: 'copilot-support-bundle-task-route-snapshot/v1',
    workspaceId: workspace.id,
  });
  t.deepEqual(
    taskRoutes.routes.map(route => route.featureKind).sort(compareTestStrings),
    ['rerank', 'workspace_indexing']
  );
  t.is(
    taskRoutes.fingerprint,
    supportBundleFingerprint({
      version: taskRoutes.version,
      workspaceId: taskRoutes.workspaceId,
      routeCount: taskRoutes.routeCount,
      routes: taskRoutes.routes,
    })
  );
  t.is(supportBundleFingerprint(archivePayload), bundle.archiveFingerprint);
  await app.GET(`${archiveUrl.pathname}${archiveUrl.search}`).expect(404);

  const auditAfterDownload = await db.$queryRaw<
    Array<{ eventType: string; metadata: Record<string, unknown> }>
  >`
    SELECT event_type AS "eventType", metadata
    FROM ai_support_bundle_audit_events
    WHERE bundle_id = ${bundle.id}
    ORDER BY created_at ASC
  `;
  t.deepEqual(auditAfterDownload.map(event => event.eventType).slice(0, 3), [
    'created',
    'archive_created',
    'read',
  ]);
  t.is(
    auditAfterDownload.filter(
      event =>
        event.eventType === 'download_authorized' &&
        event.metadata.authorizationExpired !== true
    ).length,
    4
  );
  t.is(
    auditAfterDownload.filter(
      event =>
        event.eventType === 'download_authorized' &&
        event.metadata.authorizationExpired === true
    ).length,
    1
  );
  t.is(
    auditAfterDownload.filter(event => event.eventType === 'downloaded').length,
    2
  );
});

test('support bundle create deletes written storage objects when DB persistence fails', async t => {
  const { app, db, owner, prompt } = t.context;
  const workspace = await createWorkspace(app);
  const provider = app
    .get(StorageProviderFactory)
    .create(app.get(Config).storages.blob.storage);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    create: Models['copilotSupportBundle']['create'];
    createAuditEvent(input: unknown): Promise<void>;
    storageProvider: StorageProvider | null;
  };
  const originalStorageProvider = supportBundleModel.storageProvider;
  const originalCreateAuditEvent =
    supportBundleModel.createAuditEvent.bind(supportBundleModel);
  const putKeys: string[] = [];
  const deleteKeys: string[] = [];
  supportBundleModel.storageProvider = {
    put: async (key, body, metadata) => {
      putKeys.push(key);
      await provider.put(key, body, metadata);
    },
    presignPut: provider.presignPut?.bind(provider),
    createMultipartUpload: provider.createMultipartUpload?.bind(provider),
    presignUploadPart: provider.presignUploadPart?.bind(provider),
    listMultipartUploadParts: provider.listMultipartUploadParts?.bind(provider),
    completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
    abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
    head: provider.head.bind(provider),
    get: provider.get.bind(provider),
    list: provider.list.bind(provider),
    delete: async key => {
      deleteKeys.push(key);
      await provider.delete(key);
    },
  } satisfies StorageProvider;
  supportBundleModel.createAuditEvent = async () => {
    throw new Error('support bundle create audit failure for cleanup test');
  };

  try {
    await t.throwsAsync(
      supportBundleModel.create({
        workspaceId: workspace.id,
        actorId: owner.id,
        promptCatalog: await prompt.listCatalog(workspace.id),
        taskRoutes: [],
      }),
      {
        message: /support bundle create audit failure for cleanup test/,
      }
    );
  } finally {
    supportBundleModel.createAuditEvent = originalCreateAuditEvent;
    supportBundleModel.storageProvider = originalStorageProvider;
  }

  t.is(putKeys.length, 2);
  t.deepEqual(
    [...deleteKeys].sort(compareTestStrings),
    [...putKeys].sort(compareTestStrings)
  );
  for (const key of putKeys) {
    t.is(await provider.head(key), undefined);
  }
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_support_bundle_requests
    WHERE workspace_id = ${workspace.id}
  `;
  t.is(rows[0]?.count, 0);
});

test('support bundle requests require matching audit history at the DB boundary', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const createResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
      },
    },
  });
  const bundle = createResult.createCopilotSupportBundle;
  const baseManifest = bundle.manifestJson as CopilotSupportBundleManifest;
  const orphanId = randomUUID();
  const orphanCreatedAt = new Date('2026-06-22T13:40:00.000Z');
  const orphanManifest: CopilotSupportBundleManifest = {
    ...baseManifest,
    bundleId: orphanId,
    createdAt: orphanCreatedAt.toISOString(),
    archive: {
      ...baseManifest.archive,
      filename: `localmind-support-bundle-${orphanId}.archive.json`,
    },
  };
  const orphanManifestFingerprint = supportBundleFingerprint(orphanManifest);
  const orphanManifestByteSize = supportBundleManifestByteSize(orphanManifest);

  await t.throwsAsync(
    db.$executeRaw`
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
        ${orphanId},
        ${workspace.id},
        ${owner.id},
        ${'ready'},
        ${JSON.stringify(bundle.sourceEvidenceSummary)}::jsonb,
        ${bundle.sourceEvidenceSetFingerprint},
        ${orphanManifestFingerprint},
        ${JSON.stringify(orphanManifest)}::jsonb,
        ${`support-bundles/${orphanId}/manifest.json`},
        ${orphanManifestByteSize},
        ${bundle.manifestMime},
        ${`localmind-support-bundle-${orphanId}.manifest.json`},
        ${bundle.archiveStorageKey},
        ${bundle.archiveByteSize},
        ${bundle.archiveFingerprint},
        ${bundle.archiveMime},
        ${`localmind-support-bundle-${orphanId}.archive.json`},
        ${'active'},
        ${new Date(bundle.expiresAt)},
        ${orphanCreatedAt},
        ${orphanCreatedAt}
      )
    `,
    {
      message: /ai_support_bundle_requests_audit_history_required_check/,
    }
  );

  const validId = randomUUID();
  const validCreatedAt = new Date('2026-06-22T13:45:00.000Z');
  const validExpiresAt = new Date(Date.now() - 60_000);
  const validManifest: CopilotSupportBundleManifest = {
    ...baseManifest,
    bundleId: validId,
    createdAt: validCreatedAt.toISOString(),
    expiresAt: validExpiresAt.toISOString(),
    retention: {
      ...baseManifest.retention,
      status: 'active',
      expiresAt: validExpiresAt.toISOString(),
    },
    archive: {
      ...baseManifest.archive,
      filename: `localmind-support-bundle-${validId}.archive.json`,
    },
  };
  const validManifestFingerprint = supportBundleFingerprint(validManifest);
  const validManifestByteSize = supportBundleManifestByteSize(validManifest);
  const validManifestStorageKey = `support-bundles/${validId}/manifest.json`;
  const validManifestFilename = `localmind-support-bundle-${validId}.manifest.json`;
  const validArchiveFilename = `localmind-support-bundle-${validId}.archive.json`;

  await db.$transaction(async tx => {
    await tx.$executeRaw`
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
        ${validId},
        ${workspace.id},
        ${owner.id},
        ${'ready'},
        ${JSON.stringify(bundle.sourceEvidenceSummary)}::jsonb,
        ${bundle.sourceEvidenceSetFingerprint},
        ${validManifestFingerprint},
        ${JSON.stringify(validManifest)}::jsonb,
        ${validManifestStorageKey},
        ${validManifestByteSize},
        ${bundle.manifestMime},
        ${validManifestFilename},
        ${bundle.archiveStorageKey},
        ${bundle.archiveByteSize},
        ${bundle.archiveFingerprint},
        ${bundle.archiveMime},
        ${validArchiveFilename},
        ${'active'},
        ${validExpiresAt},
        ${validCreatedAt},
        ${validCreatedAt}
      )
    `;
    await insertSupportBundleAuditEventFixture(tx, {
      bundleId: validId,
      workspaceId: workspace.id,
      actorId: owner.id,
      eventType: 'created',
      metadata: {
        manifestFingerprint: validManifestFingerprint,
        manifestByteSize: validManifestByteSize,
        manifestFilename: validManifestFilename,
        manifestMime: bundle.manifestMime,
        manifestStorageKey: validManifestStorageKey,
        sourceEvidenceSetFingerprint: bundle.sourceEvidenceSetFingerprint,
        retentionStatus: 'active',
      },
    });
    await insertSupportBundleAuditEventFixture(tx, {
      bundleId: validId,
      workspaceId: workspace.id,
      actorId: owner.id,
      eventType: 'archive_created',
      metadata: {
        ...supportBundleArchiveCreatedAuditMetadata({
          bundle,
          manifestFingerprint: validManifestFingerprint,
        }),
        archiveFilename: validArchiveFilename,
      },
    });
  });

  const activeRows = await db.$queryRaw<
    Array<{
      manifestJson: CopilotSupportBundleManifest;
      manifestFingerprint: string;
    }>
  >`
    SELECT
      manifest_json AS "manifestJson",
      manifest_fingerprint AS "manifestFingerprint"
    FROM ai_support_bundle_requests
    WHERE id = ${validId}
  `;
  const activeRow = activeRows[0];
  t.truthy(activeRow);
  const expiredManifest: CopilotSupportBundleManifest = {
    ...activeRow.manifestJson,
    retention: {
      ...activeRow.manifestJson.retention,
      status: 'expired',
    },
  };
  const expiredManifestFingerprint = supportBundleFingerprint(expiredManifest);
  const expiredManifestByteSize =
    supportBundleManifestByteSize(expiredManifest);
  const cleanupAt = new Date();

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET
        status = ${'expired'},
        retention_status = ${'expired'},
        manifest_json = ${JSON.stringify(expiredManifest)}::jsonb,
        manifest_fingerprint = ${expiredManifestFingerprint},
        manifest_byte_size = ${expiredManifestByteSize},
        updated_at = ${cleanupAt}
      WHERE id = ${validId}
    `,
    {
      message: /ai_support_bundle_requests_audit_history_required_check/,
    }
  );

  await db.$transaction(async tx => {
    await tx.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET
        status = ${'expired'},
        retention_status = ${'expired'},
        manifest_json = ${JSON.stringify(expiredManifest)}::jsonb,
        manifest_fingerprint = ${expiredManifestFingerprint},
        manifest_byte_size = ${expiredManifestByteSize},
        updated_at = ${cleanupAt}
      WHERE id = ${validId}
    `;
    await insertSupportBundleAuditEventFixture(tx, {
      bundleId: validId,
      workspaceId: workspace.id,
      actorId: owner.id,
      eventType: 'retention_expired',
      metadata: {
        cleanupActorId: owner.id,
        cleanupFingerprint: supportBundleFingerprint({
          version: 'support-bundle-test-retention-cleanup/v1',
          bundleId: validId,
          cleanupAt: cleanupAt.toISOString(),
        }),
        cleanupScope: 'manual_workspace',
        cleanedAt: cleanupAt.toISOString(),
        archiveObjectCleanupErrorCode: null,
        archiveObjectCleanupErrorMessage: null,
        archiveObjectCleanupStatus: 'missing',
        archiveStorageKey: bundle.archiveStorageKey,
        expiredAuthorizationCount: 0,
        manifestByteSize: expiredManifestByteSize,
        manifestObjectRewriteErrorCode: null,
        manifestObjectRewriteErrorMessage: null,
        manifestObjectRewriteStatus: 'missing',
        manifestFingerprint: expiredManifestFingerprint,
        manifestStorageKey: validManifestStorageKey,
        previousManifestFingerprint: activeRow.manifestFingerprint,
        retentionStatus: 'expired',
      },
    });
  });

  await db.$executeRaw`
    UPDATE ai_support_bundle_requests
    SET updated_at = updated_at
    WHERE id = ${validId}
  `;

  const auditRows = await db.$queryRaw<Array<{ eventType: string }>>`
    SELECT event_type AS "eventType"
    FROM ai_support_bundle_audit_events
    WHERE bundle_id = ${validId}
    ORDER BY created_at ASC
  `;
  t.deepEqual(
    auditRows.map(row => row.eventType),
    ['created', 'archive_created', 'retention_expired']
  );

  await t.throwsAsync(
    db.$transaction(async tx => {
      await tx.$executeRaw`
        DELETE FROM ai_support_bundle_audit_events
        WHERE bundle_id = ${validId}
          AND event_type = ${'created'}
      `;
      await tx.$executeRaw`
        SET CONSTRAINTS "zz_ai_support_bundle_audit_events_delete_restrict_check" IMMEDIATE
      `;
    }),
    { message: /ai_support_bundle_audit_events_delete_restrict_check/ }
  );
});

test('support bundle download authorizations require matching audit history at the DB boundary', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const createResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
      },
    },
  });
  const bundle = createResult.createCopilotSupportBundle;

  await t.throwsAsync(
    createDownloadAuthorizationFixture({
      db,
      bundle,
      recordAudit: false,
    }),
    {
      message:
        /ai_support_bundle_download_authorizations_audit_history_required_check/,
    }
  );

  const downloadedAuthorization = await createDownloadAuthorizationFixture({
    db,
    bundle,
  });
  const downloadedAt = new Date();
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET
        status = ${'downloaded'},
        downloaded_at = ${downloadedAt},
        updated_at = ${downloadedAt}
      WHERE id = ${downloadedAuthorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_audit_history_required_check/,
    }
  );

  await db.$transaction(async tx => {
    await tx.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET
        status = ${'downloaded'},
        downloaded_at = ${downloadedAt},
        updated_at = ${downloadedAt}
      WHERE id = ${downloadedAuthorization.id}
    `;
    await insertSupportBundleAuditEventFixture(tx, {
      bundleId: bundle.id,
      workspaceId: workspace.id,
      actorId: owner.id,
      eventType: 'downloaded',
      metadata: {
        authorizationId: downloadedAuthorization.id,
        authorizationFingerprint:
          downloadedAuthorization.authorizationFingerprint,
        artifactKind: 'manifest_json',
        artifactFilename: bundle.manifestFilename,
        artifactMime: bundle.manifestMime,
        manifestFingerprint: bundle.manifestFingerprint,
        artifactFingerprint: bundle.manifestFingerprint,
      },
    });
  });

  await db.$executeRaw`
    UPDATE ai_support_bundle_download_authorizations
    SET updated_at = updated_at
    WHERE id = ${downloadedAuthorization.id}
  `;

  const expiredAuthorization = await createDownloadAuthorizationFixture({
    db,
    bundle,
    expiresAt: new Date(Date.now() - 60_000),
  });
  const expiredAt = new Date();
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET
        status = ${'expired'},
        updated_at = ${expiredAt}
      WHERE id = ${expiredAuthorization.id}
    `,
    {
      message:
        /ai_support_bundle_download_authorizations_audit_history_required_check/,
    }
  );

  const expirationCleanupFingerprint = supportBundleFingerprint({
    version: 'support-bundle-test-download-authorization-expiration/v1',
    authorizationId: expiredAuthorization.id,
    expiredAt: expiredAt.toISOString(),
  });
  await db.$transaction(async tx => {
    await tx.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET
        status = ${'expired'},
        updated_at = ${expiredAt}
      WHERE id = ${expiredAuthorization.id}
    `;
    await insertSupportBundleAuditEventFixture(tx, {
      bundleId: bundle.id,
      workspaceId: workspace.id,
      actorId: owner.id,
      eventType: 'download_authorized',
      metadata: {
        version:
          'copilot-support-bundle-download-authorization-expired-audit/v1',
        authorizationExpired: true,
        authorizationId: expiredAuthorization.id,
        authorizationFingerprint: expiredAuthorization.authorizationFingerprint,
        artifactKind: 'manifest_json',
        artifactFingerprint: bundle.manifestFingerprint,
        cleanupActorId: owner.id,
        cleanupFingerprint: expirationCleanupFingerprint,
        cleanupScope: 'api_proxy_consume',
        cleanedAt: expiredAt.toISOString(),
        deliveryMethod: 'api_proxy',
        expiresAt: expiredAuthorization.expiresAt.toISOString(),
        previousStatus: 'authorized',
        status: 'expired',
      },
    });
  });

  const auditRows = await db.$queryRaw<Array<{ eventType: string }>>`
    SELECT event_type AS "eventType"
    FROM ai_support_bundle_audit_events
    WHERE bundle_id = ${bundle.id}
      AND metadata->>'authorizationId' IN (
        ${downloadedAuthorization.id},
        ${expiredAuthorization.id}
      )
    ORDER BY created_at ASC
  `;
  t.deepEqual(
    auditRows.map(row => row.eventType),
    [
      'download_authorized',
      'downloaded',
      'download_authorized',
      'download_authorized',
    ]
  );

  await t.throwsAsync(
    db.$transaction(async tx => {
      await tx.$executeRaw`
        DELETE FROM ai_support_bundle_audit_events
        WHERE bundle_id = ${bundle.id}
          AND event_type = ${'downloaded'}
          AND metadata->>'authorizationId' = ${downloadedAuthorization.id}
      `;
      await tx.$executeRaw`
        SET CONSTRAINTS "zz_ai_support_bundle_audit_events_delete_restrict_check" IMMEDIATE
      `;
    }),
    { message: /ai_support_bundle_audit_events_delete_restrict_check/ }
  );

  await t.throwsAsync(
    db.$transaction(async tx => {
      await tx.$executeRaw`
        DELETE FROM ai_support_bundle_download_authorizations
        WHERE id = ${downloadedAuthorization.id}
      `;
      await tx.$executeRaw`
        SET CONSTRAINTS "zz_ai_support_bundle_dl_auth_delete_restrict_check" IMMEDIATE
      `;
    }),
    {
      message:
        /ai_support_bundle_download_authorizations_delete_restrict_check/,
    }
  );

  const cascadeWorkspace = await createWorkspace(app);
  const cascadeBundleResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: cascadeWorkspace.id,
      },
    },
  });
  const cascadeBundle = cascadeBundleResult.createCopilotSupportBundle;
  const cascadeAuthorization = await createDownloadAuthorizationFixture({
    db,
    bundle: cascadeBundle,
  });
  await t.throwsAsync(
    db.$executeRaw`
      DELETE FROM ai_support_bundle_requests
      WHERE id = ${cascadeBundle.id}
    `,
    { message: /ai_support_bundle_requests_delete_restrict_check/ }
  );
  await db.$executeRaw`
    DELETE FROM workspaces
    WHERE id = ${cascadeWorkspace.id}
  `;
  const cascadeBundleRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_support_bundle_requests
    WHERE id = ${cascadeBundle.id}
  `;
  t.deepEqual(cascadeBundleRows, [{ count: 0 }]);
  const cascadeAuthorizationRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_support_bundle_download_authorizations
    WHERE id = ${cascadeAuthorization.id}
  `;
  t.deepEqual(cascadeAuthorizationRows, [{ count: 0 }]);
});

test('hydrates malformed legacy support bundle manifest and source evidence JSON safely', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const createResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
      },
    },
  });
  const bundle = createResult.createCopilotSupportBundle;
  const legacyBundleId = 'legacy-malformed-support-bundle';
  const legacySourceEvidenceSummary = {
    actionRunCount: 'not-a-count',
    includedSections: 'not-a-list',
    promptCatalogItemCount: -1,
    source: '   ',
    taskRouteCount: 1.5,
  };
  const legacyManifest = {
    actorId: `  ${owner.id}  `,
    archive: {
      archiveFingerprint: `  ${bundle.archiveFingerprint}  `,
      byteSize: bundle.archiveByteSize,
      filename: `  ${bundle.archiveFilename}  `,
      mime: `  ${bundle.archiveMime}  `,
      storageKey: `  ${bundle.archiveStorageKey}  `,
    },
    bundleId: `  ${legacyBundleId}  `,
    createdAt: bundle.createdAt,
    expiresAt: bundle.expiresAt,
    retention: {
      status: 'unknown',
    },
    sourceEvidenceSummary: 'not-an-object',
    sourceEvidenceSetFingerprint: `  ${bundle.sourceEvidenceSetFingerprint}  `,
    version: `  ${bundle.manifestJson.version}  `,
    workspaceId: `  ${workspace.id}  `,
  } as unknown as CopilotSupportBundleManifest;
  const legacyManifestFingerprint = supportBundleFingerprint(legacyManifest);

  await db.$transaction(async tx => {
    await tx.$executeRaw`
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
        ${legacyBundleId},
        ${workspace.id},
        ${owner.id},
        ${'ready'},
        ${JSON.stringify(legacySourceEvidenceSummary)}::jsonb,
        ${bundle.sourceEvidenceSetFingerprint},
        ${legacyManifestFingerprint},
        ${JSON.stringify(legacyManifest)}::jsonb,
        ${null},
        ${null},
        ${null},
        ${null},
        ${bundle.archiveStorageKey},
        ${bundle.archiveByteSize},
        ${bundle.archiveFingerprint},
        ${bundle.archiveMime},
        ${bundle.archiveFilename},
        ${'active'},
        ${new Date(bundle.expiresAt)},
        ${new Date(bundle.createdAt)},
        ${new Date(bundle.createdAt)}
      )
    `;
    await insertSupportBundleAuditEventFixture(tx, {
      bundleId: legacyBundleId,
      workspaceId: workspace.id,
      actorId: owner.id,
      eventType: 'created',
      metadata: supportBundleCreatedAuditMetadata({
        bundleId: legacyBundleId,
        bundle,
        manifest: legacyManifest,
        manifestByteSize: null,
        manifestFilename: null,
        manifestMime: null,
        manifestStorageKey: null,
        retentionStatus: 'active',
      }),
    });
    await insertSupportBundleAuditEventFixture(tx, {
      bundleId: legacyBundleId,
      workspaceId: workspace.id,
      actorId: owner.id,
      eventType: 'archive_created',
      metadata: supportBundleArchiveCreatedAuditMetadata({
        bundle,
        manifestFingerprint: legacyManifestFingerprint,
      }),
    });
  });

  const supportBundleModel = app.get(Models).copilotSupportBundle;
  const hydrated = await supportBundleModel.get(workspace.id, legacyBundleId);
  t.truthy(hydrated);
  t.deepEqual(hydrated?.sourceEvidenceSummary, {
    actionRunCount: 0,
    includedSections: [],
    promptCatalogItemCount: 0,
    source: 'db_hydration_guard',
    taskRouteCount: 0,
  });
  t.is(hydrated?.manifestJson.bundleId, legacyBundleId);
  t.is(hydrated?.manifestJson.workspaceId, workspace.id);
  t.is(hydrated?.manifestJson.actorId, owner.id);
  t.is(hydrated?.manifestJson.retention.status, 'active');
  t.deepEqual(
    hydrated?.manifestJson.sourceEvidenceSummary,
    hydrated?.sourceEvidenceSummary
  );
  t.is(
    hydrated?.manifestJson.archive.archiveFingerprint,
    bundle.archiveFingerprint
  );
  t.is(hydrated?.manifestJson.archive.storageKey, bundle.archiveStorageKey);

  const listed = await supportBundleModel.list(workspace.id);
  const listedLegacy = listed.find(item => item.id === legacyBundleId);
  t.truthy(listedLegacy);
  t.deepEqual(
    listedLegacy?.sourceEvidenceSummary,
    hydrated?.sourceEvidenceSummary
  );

  const authorizationResult = await app.gql({
    query: authorizeSupportBundleDownloadMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        bundleId: legacyBundleId,
        artifactKind: 'manifest_json',
      },
    },
  });
  const authorization =
    authorizationResult.authorizeCopilotSupportBundleDownload;
  const artifactUrl = new URL(authorization.downloadUrl, app.url());
  const artifactResponse = await app
    .GET(`${artifactUrl.pathname}${artifactUrl.search}`)
    .expect(200);
  const downloadedManifest =
    typeof artifactResponse.body === 'string'
      ? JSON.parse(artifactResponse.body)
      : artifactResponse.body;
  t.is(downloadedManifest.bundleId, legacyBundleId);
  t.is(downloadedManifest.sourceEvidenceSummary.source, 'db_hydration_guard');
});

test('support bundle API-proxy download consume fails closed when authorization state changes before update', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const createResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
      },
    },
  });
  const bundle = createResult.createCopilotSupportBundle;
  const supportBundleModels = app.get(Models).copilotSupportBundle;
  const authorization = await supportBundleModels.authorizeDownload({
    workspaceId: workspace.id,
    actorId: owner.id,
    bundleId: bundle.id,
    artifactKind: 'manifest_json',
  });
  const storageProvider = app
    .get(StorageProviderFactory)
    .create(app.get(Config).storages.blob.storage);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  const originalStorageProvider = supportBundleModel.storageProvider;
  let expiredBeforeDownloadUpdate = false;
  supportBundleModel.storageProvider = {
    put: storageProvider.put.bind(storageProvider),
    presignPut: storageProvider.presignPut?.bind(storageProvider),
    createMultipartUpload:
      storageProvider.createMultipartUpload?.bind(storageProvider),
    presignUploadPart: storageProvider.presignUploadPart?.bind(storageProvider),
    listMultipartUploadParts:
      storageProvider.listMultipartUploadParts?.bind(storageProvider),
    completeMultipartUpload:
      storageProvider.completeMultipartUpload?.bind(storageProvider),
    abortMultipartUpload:
      storageProvider.abortMultipartUpload?.bind(storageProvider),
    head: storageProvider.head.bind(storageProvider),
    async get(key: string, signedUrl?: boolean) {
      const result = await storageProvider.get(key, signedUrl);
      if (key === bundle.manifestStorageKey && !expiredBeforeDownloadUpdate) {
        expiredBeforeDownloadUpdate = true;
        await markDownloadAuthorizationDownloadedFixture({
          db,
          authorization,
          bundle,
        });
      }
      return result;
    },
    list: storageProvider.list.bind(storageProvider),
    delete: storageProvider.delete.bind(storageProvider),
  } satisfies StorageProvider;
  try {
    const artifact = await supportBundleModels.consumeDownload({
      authorizationId: authorization.id,
      token: authorization.downloadToken,
    });
    t.is(artifact, null);
  } finally {
    supportBundleModel.storageProvider = originalStorageProvider;
  }
  t.true(expiredBeforeDownloadUpdate);

  const rows = await db.$queryRaw<
    Array<{
      status: string;
      downloadedAt: Date | null;
      downloadedAuditCount: number;
    }>
  >`
    SELECT
      a.status,
      a.downloaded_at AS "downloadedAt",
      (
        SELECT COUNT(*)::int
        FROM ai_support_bundle_audit_events e
        WHERE e.bundle_id = a.bundle_id
          AND e.event_type = ${'downloaded'}
          AND e.metadata->>'authorizationId' = a.id
      ) AS "downloadedAuditCount"
    FROM ai_support_bundle_download_authorizations a
    WHERE a.id = ${authorization.id}
  `;
  t.is(rows.length, 1);
  t.like(rows[0], {
    status: 'downloaded',
    downloadedAuditCount: 1,
  });
  t.truthy(rows[0].downloadedAt);
});

test('support bundle API-proxy download consume fails closed when bundle snapshot changes before update', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const createResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
      },
    },
  });
  const bundle = createResult.createCopilotSupportBundle;
  const supportBundleModels = app.get(Models).copilotSupportBundle;
  const authorization = await supportBundleModels.authorizeDownload({
    workspaceId: workspace.id,
    actorId: owner.id,
    bundleId: bundle.id,
    artifactKind: 'manifest_json',
  });
  const storageProvider = app
    .get(StorageProviderFactory)
    .create(app.get(Config).storages.blob.storage);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  const originalStorageProvider = supportBundleModel.storageProvider;
  let bundleDriftedBeforeDownloadUpdate = false;
  const driftedAt = new Date(new Date(bundle.updatedAt).getTime() + 60_000);
  supportBundleModel.storageProvider = {
    put: storageProvider.put.bind(storageProvider),
    presignPut: storageProvider.presignPut?.bind(storageProvider),
    createMultipartUpload:
      storageProvider.createMultipartUpload?.bind(storageProvider),
    presignUploadPart: storageProvider.presignUploadPart?.bind(storageProvider),
    listMultipartUploadParts:
      storageProvider.listMultipartUploadParts?.bind(storageProvider),
    completeMultipartUpload:
      storageProvider.completeMultipartUpload?.bind(storageProvider),
    abortMultipartUpload:
      storageProvider.abortMultipartUpload?.bind(storageProvider),
    head: storageProvider.head.bind(storageProvider),
    async get(key: string, signedUrl?: boolean) {
      const result = await storageProvider.get(key, signedUrl);
      if (
        key === bundle.manifestStorageKey &&
        !bundleDriftedBeforeDownloadUpdate
      ) {
        bundleDriftedBeforeDownloadUpdate = true;
        await db.$executeRaw`
          UPDATE ai_support_bundle_requests
          SET updated_at = ${driftedAt}
          WHERE id = ${bundle.id}
        `;
      }
      return result;
    },
    list: storageProvider.list.bind(storageProvider),
    delete: storageProvider.delete.bind(storageProvider),
  } satisfies StorageProvider;
  try {
    const artifact = await supportBundleModels.consumeDownload({
      authorizationId: authorization.id,
      token: authorization.downloadToken,
    });
    t.is(artifact, null);
  } finally {
    supportBundleModel.storageProvider = originalStorageProvider;
  }
  t.true(bundleDriftedBeforeDownloadUpdate);

  const rows = await db.$queryRaw<
    Array<{
      bundleUpdatedAt: Date;
      downloadedAt: Date | null;
      downloadedAuditCount: number;
      status: string;
    }>
  >`
    SELECT
      a.status,
      a.downloaded_at AS "downloadedAt",
      b.updated_at AS "bundleUpdatedAt",
      (
        SELECT COUNT(*)::int
        FROM ai_support_bundle_audit_events e
        WHERE e.bundle_id = a.bundle_id
          AND e.event_type = ${'downloaded'}
          AND e.metadata->>'authorizationId' = a.id
      ) AS "downloadedAuditCount"
    FROM ai_support_bundle_download_authorizations a
    JOIN ai_support_bundle_requests b ON b.id = a.bundle_id
    WHERE a.id = ${authorization.id}
  `;
  t.deepEqual(rows, [
    {
      bundleUpdatedAt: driftedAt,
      downloadedAt: null,
      downloadedAuditCount: 0,
      status: 'authorized',
    },
  ]);
});

test('support bundle download authorization fails closed when bundle state changes before insert', async t => {
  const { app, owner } = t.context;
  const workspace = await createWorkspace(app);
  const expiredBundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const staleBundle: CopilotSupportBundleRecord = {
    ...expiredBundle,
    expiresAt: new Date(Date.now() + 60_000),
  };

  const model = app.get(Models).copilotSupportBundle;
  const originalGet = model.get.bind(model);
  let returnedStaleBundle = false;
  model.get = (async (workspaceId: string, id: string) => {
    if (!returnedStaleBundle) {
      returnedStaleBundle = true;
      return staleBundle;
    }
    return await originalGet(workspaceId, id);
  }) as typeof model.get;
  try {
    await t.throwsAsync(
      model.authorizeDownload({
        workspaceId: workspace.id,
        actorId: owner.id,
        bundleId: expiredBundle.id,
        artifactKind: 'manifest_json',
      }),
      {
        message: /could not be authorized because its state changed/,
      }
    );
  } finally {
    model.get = originalGet as typeof model.get;
  }

  const rows = await app.get(PrismaClient).$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_support_bundle_audit_events
    WHERE bundle_id = ${expiredBundle.id}
      AND event_type = ${'download_authorized'}
  `;
  t.is(rows[0]?.count, 0);
});

test('support bundle download authorization fails closed when bundle snapshot identity changes before insert', async t => {
  const { app, db, owner, prompt } = t.context;
  const workspace = await createWorkspace(app);
  const driftActor = await app.createUser();
  const supportBundleModel = app.get(Models).copilotSupportBundle;
  const bundle = await supportBundleModel.create({
    workspaceId: workspace.id,
    actorId: owner.id,
    promptCatalog: await prompt.listCatalog(workspace.id),
  });
  const staleBundle: CopilotSupportBundleRecord = {
    ...bundle,
    actorId: driftActor.id,
  };

  const originalGet = supportBundleModel.get.bind(supportBundleModel);
  let returnedStaleBundle = false;
  supportBundleModel.get = (async (workspaceId: string, id: string) => {
    if (!returnedStaleBundle) {
      returnedStaleBundle = true;
      return staleBundle;
    }
    return await originalGet(workspaceId, id);
  }) as typeof supportBundleModel.get;
  try {
    await t.throwsAsync(
      supportBundleModel.authorizeDownload({
        workspaceId: workspace.id,
        actorId: owner.id,
        bundleId: bundle.id,
        artifactKind: 'manifest_json',
      }),
      {
        message: /could not be authorized because its state changed/,
      }
    );
  } finally {
    supportBundleModel.get = originalGet as typeof supportBundleModel.get;
  }

  const rows = await db.$queryRaw<
    Array<{ authorizationCount: number; downloadAuthorizedAuditCount: number }>
  >`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM ai_support_bundle_download_authorizations
        WHERE bundle_id = ${bundle.id}
      ) AS "authorizationCount",
      (
        SELECT COUNT(*)::int
        FROM ai_support_bundle_audit_events
        WHERE bundle_id = ${bundle.id}
          AND event_type = ${'download_authorized'}
      ) AS "downloadAuthorizedAuditCount"
  `;
  t.deepEqual(rows, [
    {
      authorizationCount: 0,
      downloadAuthorizedAuditCount: 0,
    },
  ]);
});

test('support bundle direct download acknowledgement fails closed when authorization snapshot changes before update', async t => {
  const { app, db, owner, prompt } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const supportBundleModel = app.get(Models).copilotSupportBundle;
    const bundle = await supportBundleModel.create({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptCatalog: await prompt.listCatalog(workspace.id),
      taskRoutes: [],
    });
    const authorization = await supportBundleModel.authorizeDownload({
      workspaceId: workspace.id,
      actorId: owner.id,
      bundleId: bundle.id,
      artifactKind: 'archive_json',
    });
    t.is(authorization.deliveryMethod, 'object_storage_signed_url');

    await db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET updated_at = updated_at + interval '1 second'
      WHERE id = ${authorization.id}
    `;

    const modelWithPrivateGet = supportBundleModel as unknown as {
      getDownloadAuthorizationById(
        workspaceId: string,
        authorizationId: string
      ): Promise<typeof authorization | null>;
    };
    const originalGetAuthorization =
      modelWithPrivateGet.getDownloadAuthorizationById.bind(supportBundleModel);
    let returnedStaleAuthorization = false;
    modelWithPrivateGet.getDownloadAuthorizationById = async (
      workspaceId,
      authorizationId
    ) => {
      if (!returnedStaleAuthorization) {
        returnedStaleAuthorization = true;
        t.is(workspaceId, workspace.id);
        t.is(authorizationId, authorization.id);
        return authorization;
      }
      return await originalGetAuthorization(workspaceId, authorizationId);
    };

    try {
      await t.throwsAsync(
        supportBundleModel.acknowledgeDirectDownload({
          workspaceId: workspace.id,
          actorId: owner.id,
          authorizationId: authorization.id,
        }),
        {
          message:
            /direct download acknowledgement could not update authorization because its authorization or bundle state changed/,
        }
      );
    } finally {
      modelWithPrivateGet.getDownloadAuthorizationById =
        originalGetAuthorization;
    }
    t.true(returnedStaleAuthorization);

    const rows = await db.$queryRaw<
      Array<{
        downloadedAt: Date | null;
        downloadedAuditCount: number;
        status: string;
        transferEventCount: number;
      }>
    >`
      SELECT
        a.status,
        a.downloaded_at AS "downloadedAt",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_audit_events e
          WHERE e.bundle_id = a.bundle_id
            AND e.event_type = ${'downloaded'}
            AND e.metadata->>'authorizationId' = a.id
        ) AS "downloadedAuditCount",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_transfer_events te
          WHERE te.authorization_id = a.id
        ) AS "transferEventCount"
      FROM ai_support_bundle_download_authorizations a
      WHERE a.id = ${authorization.id}
    `;
    t.deepEqual(rows, [
      {
        status: 'authorized',
        downloadedAt: null,
        downloadedAuditCount: 0,
        transferEventCount: 0,
      },
    ]);
  } finally {
    restoreStorageFactory();
  }
});

test('support bundle direct download expiration fails closed when authorization snapshot changes before update', async t => {
  const { app, db, owner, prompt } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const supportBundleModel = app.get(Models).copilotSupportBundle;
    const bundle = await supportBundleModel.create({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptCatalog: await prompt.listCatalog(workspace.id),
      taskRoutes: [],
    });
    const authorizationFixture = await createDownloadAuthorizationFixture({
      db,
      bundle,
      artifactKind: 'archive_json',
      deliveryMethod: 'object_storage_signed_url',
      directDownloadExpiresAt: new Date(Date.now() - 60_000),
      directDownloadUrl: 'https://objects.example.test/expired-stale-direct',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const modelWithPrivateGet = supportBundleModel as unknown as {
      getDownloadAuthorizationById(
        workspaceId: string,
        authorizationId: string
      ): Promise<typeof authorizationFixture | null>;
    };
    const originalGetAuthorization =
      modelWithPrivateGet.getDownloadAuthorizationById.bind(supportBundleModel);
    const authorization = await originalGetAuthorization(
      workspace.id,
      authorizationFixture.id
    );
    t.truthy(authorization);
    if (!authorization) {
      throw new Error('Expected support bundle authorization fixture');
    }
    t.is(authorization.deliveryMethod, 'object_storage_signed_url');

    await db.$executeRaw`
      UPDATE ai_support_bundle_download_authorizations
      SET updated_at = updated_at + interval '1 second'
      WHERE id = ${authorization.id}
    `;
    let returnedStaleAuthorization = false;
    modelWithPrivateGet.getDownloadAuthorizationById = async (
      workspaceId,
      authorizationId
    ) => {
      if (!returnedStaleAuthorization) {
        returnedStaleAuthorization = true;
        t.is(workspaceId, workspace.id);
        t.is(authorizationId, authorization.id);
        return authorization;
      }
      return await originalGetAuthorization(workspaceId, authorizationId);
    };

    try {
      await t.throwsAsync(
        supportBundleModel.acknowledgeDirectDownload({
          workspaceId: workspace.id,
          actorId: owner.id,
          authorizationId: authorization.id,
        }),
        {
          message:
            /download authorization could not be expired because its authorization state changed/,
        }
      );
    } finally {
      modelWithPrivateGet.getDownloadAuthorizationById =
        originalGetAuthorization;
    }
    t.true(returnedStaleAuthorization);

    const rows = await db.$queryRaw<
      Array<{
        expiredAuditCount: number;
        status: string;
      }>
    >`
      SELECT
        a.status,
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_audit_events e
          WHERE e.bundle_id = a.bundle_id
            AND e.event_type = ${'download_authorized'}
            AND e.metadata->>'authorizationId' = a.id
            AND e.metadata->'authorizationExpired' = 'true'::jsonb
        ) AS "expiredAuditCount"
      FROM ai_support_bundle_download_authorizations a
      WHERE a.id = ${authorization.id}
    `;
    t.deepEqual(rows, [
      {
        status: 'authorized',
        expiredAuditCount: 0,
      },
    ]);
  } finally {
    restoreStorageFactory();
  }
});

test('support bundle direct download transfer event fails closed when bundle snapshot changes before update', async t => {
  const { app, db, owner, prompt } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const supportBundleModel = app.get(Models).copilotSupportBundle;
    const bundle = await supportBundleModel.create({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptCatalog: await prompt.listCatalog(workspace.id),
      taskRoutes: [],
    });
    const authorization = await supportBundleModel.authorizeDownload({
      workspaceId: workspace.id,
      actorId: owner.id,
      bundleId: bundle.id,
      artifactKind: 'archive_json',
    });
    t.is(authorization.deliveryMethod, 'object_storage_signed_url');

    await db.$executeRaw`
      UPDATE ai_support_bundle_requests
      SET updated_at = updated_at + interval '1 second'
      WHERE id = ${bundle.id}
    `;

    const originalGetBundle = supportBundleModel.get.bind(supportBundleModel);
    let returnedStaleBundle = false;
    supportBundleModel.get = async (workspaceId, bundleId) => {
      if (!returnedStaleBundle) {
        returnedStaleBundle = true;
        t.is(workspaceId, workspace.id);
        t.is(bundleId, bundle.id);
        return bundle;
      }
      return await originalGetBundle(workspaceId, bundleId);
    };

    try {
      await t.throwsAsync(
        supportBundleModel.ingestDirectDownloadTransferEvent({
          authorizationId: authorization.id,
          eventId: 'support-bundle-transfer-stale-bundle-e2e',
          eventSource: 'object_storage_event_e2e',
          storageKey: bundle.archiveStorageKey ?? undefined,
          notificationAuthEvidence: {
            policy: 'internal_access_token',
            status: 'verified',
            method: 'x-access-token',
          },
          artifactByteSize: bundle.archiveByteSize ?? undefined,
          artifactFingerprint: bundle.archiveFingerprint ?? undefined,
          transferredAt: new Date(),
        }),
        {
          message:
            /direct download transfer event could not update authorization because its authorization or bundle state changed/,
        }
      );
    } finally {
      supportBundleModel.get =
        originalGetBundle as typeof supportBundleModel.get;
    }
    t.true(returnedStaleBundle);

    const rows = await db.$queryRaw<
      Array<{
        downloadedAt: Date | null;
        downloadedAuditCount: number;
        status: string;
        transferEventCount: number;
      }>
    >`
      SELECT
        a.status,
        a.downloaded_at AS "downloadedAt",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_audit_events e
          WHERE e.bundle_id = a.bundle_id
            AND e.event_type = ${'downloaded'}
            AND e.metadata->>'authorizationId' = a.id
        ) AS "downloadedAuditCount",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_transfer_events te
          WHERE te.authorization_id = a.id
        ) AS "transferEventCount"
      FROM ai_support_bundle_download_authorizations a
      WHERE a.id = ${authorization.id}
    `;
    t.deepEqual(rows, [
      {
        status: 'authorized',
        downloadedAt: null,
        downloadedAuditCount: 0,
        transferEventCount: 0,
      },
    ]);
  } finally {
    restoreStorageFactory();
  }
});

test('support bundle direct download transfer event rejects mismatched conflict evidence', async t => {
  const { app, db, owner, prompt } = t.context;
  const workspace = await createWorkspace(app);
  const supportBundleModel = app.get(Models).copilotSupportBundle;
  const bundle = await supportBundleModel.create({
    workspaceId: workspace.id,
    actorId: owner.id,
    promptCatalog: await prompt.listCatalog(workspace.id),
    taskRoutes: [],
  });
  const directDownloadExpiresAt = new Date(Date.now() + 10 * 60_000);
  const authorization = await createDownloadAuthorizationFixture({
    db,
    bundle,
    deliveryMethod: 'object_storage_signed_url',
    directDownloadExpiresAt,
    directDownloadUrl: 'https://objects.example.test/support-bundle.json',
  });
  const storageKey = bundle.manifestStorageKey;
  const storageByteSize = bundle.manifestByteSize;
  if (!storageKey || storageByteSize === null) {
    throw new Error('Support bundle transfer fixture storage is incomplete');
  }
  const transferredAt = new Date('2026-06-22T12:45:00.000Z');
  const notificationAuthEvidence = {
    policy: 'internal_access_token' as const,
    status: 'verified' as const,
    method: 'x-access-token' as const,
  };
  const eventId = 'support-bundle-transfer-conflict-e2e';
  const eventSource = 'object_storage_event_e2e';
  const notificationAuthEvidenceFingerprint = supportBundleFingerprint({
    version: 'copilot-support-bundle-transfer-notification-auth-evidence/v1',
    authorizationId: authorization.id,
    authorizationFingerprint: authorization.authorizationFingerprint,
    transferEventId: eventId,
    transferEventSource: eventSource,
    notificationAuthEvidence,
  });
  const eventFingerprint = supportBundleFingerprint({
    version: 'copilot-support-bundle-direct-download-transfer-event/v1',
    authorizationId: authorization.id,
    authorizationFingerprint: authorization.authorizationFingerprint,
    bundleId: bundle.id,
    workspaceId: bundle.workspaceId,
    actorId: bundle.actorId,
    artifactKind: authorization.artifactKind,
    manifestFingerprint: bundle.manifestFingerprint,
    artifactFingerprint: authorization.artifactFingerprint,
    deliveryMethod: 'object_storage_signed_url',
    transferEventId: eventId,
    transferEventSource: eventSource,
    transferredAt: transferredAt.toISOString(),
    notificationAuthEvidenceFingerprint,
    storageKey,
    storageByteSize,
    storageContentType: 'application/json',
  });
  const authorizationRecord = {
    id: authorization.id,
    bundleId: bundle.id,
    workspaceId: bundle.workspaceId,
    actorId: bundle.actorId,
    status: 'authorized' as const,
    artifactKind: authorization.artifactKind,
    artifactFilename: authorization.artifactFilename,
    artifactMime: authorization.artifactMime,
    manifestFingerprint: bundle.manifestFingerprint,
    artifactFingerprint: authorization.artifactFingerprint,
    authorizationFingerprint: authorization.authorizationFingerprint,
    tokenFingerprint: supportBundleDownloadTokenFingerprint(
      authorization.downloadToken
    ),
    deliveryMethod: 'object_storage_signed_url' as const,
    directDownloadUrl: 'https://objects.example.test/support-bundle.json',
    directDownloadExpiresAt,
    expiresAt: authorization.expiresAt,
    downloadedAt: null,
    createdAt: transferredAt,
    updatedAt: transferredAt,
  };
  const modelWithPrivateTransferInsert = supportBundleModel as unknown as {
    createDirectDownloadTransferEvent(input: {
      authorization: typeof authorizationRecord;
      transferEvent: {
        eventId: string;
        eventSource: string;
        transferredAt: Date;
        notificationAuthEvidence: typeof notificationAuthEvidence;
        notificationAuthEvidenceFingerprint: string;
        storageKey: string;
        storageByteSize: number;
        storageContentType: string;
        eventFingerprint: string;
      };
    }): Promise<void>;
  };

  await modelWithPrivateTransferInsert.createDirectDownloadTransferEvent({
    authorization: authorizationRecord,
    transferEvent: {
      eventId,
      eventSource,
      transferredAt,
      notificationAuthEvidence,
      notificationAuthEvidenceFingerprint,
      storageKey,
      storageByteSize,
      storageContentType: 'application/json',
      eventFingerprint,
    },
  });

  await t.throwsAsync(
    modelWithPrivateTransferInsert.createDirectDownloadTransferEvent({
      authorization: authorizationRecord,
      transferEvent: {
        eventId: `${eventId}-drift`,
        eventSource,
        transferredAt,
        notificationAuthEvidence,
        notificationAuthEvidenceFingerprint,
        storageKey,
        storageByteSize,
        storageContentType: 'application/json',
        eventFingerprint,
      },
    }),
    {
      message:
        /Support bundle direct download transfer event conflict reused mismatched evidence/,
    }
  );

  const rows = await db.$queryRaw<
    Array<{ count: number; storageContentType: string }>
  >`
    SELECT
      COUNT(*)::int AS count,
      MAX(storage_content_type) AS "storageContentType"
    FROM ai_support_bundle_transfer_events
    WHERE authorization_id = ${authorization.id}
      AND event_fingerprint = ${eventFingerprint}
  `;
  t.deepEqual(rows, [
    {
      count: 1,
      storageContentType: 'application/json',
    },
  ]);
});

test('support bundle transfer forwarding enqueue rejects mismatched conflict evidence', async t => {
  const { app, db, owner, prompt } = t.context;
  const workspace = await createWorkspace(app);
  const supportBundleModel = app.get(Models).copilotSupportBundle;
  const bundle = await supportBundleModel.create({
    workspaceId: workspace.id,
    actorId: owner.id,
    promptCatalog: await prompt.listCatalog(workspace.id),
    taskRoutes: [],
  });
  const authorization = await createDownloadAuthorizationFixture({
    db,
    bundle,
    artifactKind: 'archive_json',
    deliveryMethod: 'object_storage_signed_url',
    directDownloadExpiresAt: new Date(Date.now() + 10 * 60_000),
    directDownloadUrl: 'https://objects.example.test/archive.json',
  });
  if (
    !bundle.archiveStorageKey ||
    bundle.archiveByteSize === null ||
    !bundle.archiveFingerprint
  ) {
    throw new Error('Support bundle forwarding fixture archive is incomplete');
  }
  const transferredAt = new Date('2026-06-22T13:45:00.000Z');
  const notificationAuthEvidence = {
    policy: 'internal_access_token' as const,
    status: 'verified' as const,
    method: 'x-access-token' as const,
  };
  const transferEvent = {
    authorizationId: authorization.id,
    eventId: 'support-bundle-forwarding-conflict-e2e',
    eventSource: 'object_storage_event_e2e',
    storageKey: bundle.archiveStorageKey,
    notificationAuthEvidence,
    artifactByteSize: bundle.archiveByteSize,
    artifactFingerprint: bundle.archiveFingerprint,
    transferredAt,
  };
  const forwardingPayload = {
    version: 'copilot-support-bundle-transfer-forwarding-payload/v1',
    event: {
      authorizationId: authorization.id,
      eventId: transferEvent.eventId,
      eventSource: transferEvent.eventSource,
      storageKey: transferEvent.storageKey,
      notificationAuthEvidence,
      artifactByteSize: transferEvent.artifactByteSize,
      artifactFingerprint: transferEvent.artifactFingerprint,
      transferredAt: transferredAt.toISOString(),
    },
  };
  const forwardingPayloadFingerprint = supportBundleFingerprint({
    version: 'copilot-support-bundle-transfer-forwarding-payload/v1',
    payload: forwardingPayload,
  });
  const forwardingEventFingerprint = supportBundleFingerprint({
    version: 'copilot-support-bundle-transfer-forwarding-event/v1',
    authorizationId: authorization.id,
    eventId: transferEvent.eventId,
    eventSource: transferEvent.eventSource,
    forwardingPayloadFingerprint,
    providerSignatureEvidenceFingerprint: null,
  });
  await db.$executeRaw`
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
      ${'support-bundle-forwarding-conflict-existing'},
      ${authorization.id},
      ${'queued'},
      ${`${transferEvent.eventId}-drift`},
      ${transferEvent.eventSource},
      ${forwardingEventFingerprint},
      ${JSON.stringify({
        ...forwardingPayload,
        event: {
          ...forwardingPayload.event,
          eventId: `${transferEvent.eventId}-drift`,
        },
      })}::jsonb,
      ${forwardingPayloadFingerprint},
      ${null},
      ${0},
      ${3},
      ${transferredAt},
      ${transferredAt},
      ${transferredAt}
    )
  `;

  await t.throwsAsync(
    supportBundleModel.enqueueDirectDownloadTransferForwardingEvent({
      transferEvent,
      maxAttempts: 3,
    }),
    {
      message:
        /Support bundle transfer forwarding event conflict reused mismatched evidence/,
    }
  );

  const rows = await db.$queryRaw<
    Array<{ count: number; eventId: string | null }>
  >`
    SELECT COUNT(*)::int AS count, MAX(event_id) AS "eventId"
    FROM ai_support_bundle_transfer_forwarding_events
    WHERE authorization_id = ${authorization.id}
      AND forwarding_event_fingerprint = ${forwardingEventFingerprint}
  `;
  t.deepEqual(rows, [
    {
      count: 1,
      eventId: `${transferEvent.eventId}-drift`,
    },
  ]);
});

test('rejects API-proxy manifest downloads when stored manifest bytes fail fingerprint validation', async t => {
  const { app, db } = t.context;
  const workspace = await createWorkspace(app);
  const createResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
      },
    },
  });
  const bundle = createResult.createCopilotSupportBundle;
  const authorizationResult = await app.gql({
    query: authorizeSupportBundleDownloadMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        bundleId: bundle.id,
        artifactKind: 'manifest_json',
      },
    },
  });
  const authorization =
    authorizationResult.authorizeCopilotSupportBundleDownload;
  const storageProvider = app
    .get(StorageProviderFactory)
    .create(app.get(Config).storages.blob.storage);

  await storageProvider.put(
    bundle.manifestStorageKey,
    Buffer.from(JSON.stringify({ version: 'tampered-manifest' }), 'utf8'),
    {
      contentType: 'application/json',
    }
  );

  const artifactUrl = new URL(authorization.downloadUrl, app.url());
  await app.GET(`${artifactUrl.pathname}${artifactUrl.search}`).expect(404);

  const authorizationRows = await db.$queryRaw<
    Array<{ downloadedAt: Date | null; status: string }>
  >`
    SELECT downloaded_at AS "downloadedAt", status
    FROM ai_support_bundle_download_authorizations
    WHERE id = ${authorization.id}
  `;
  t.deepEqual(authorizationRows, [
    {
      downloadedAt: null,
      status: 'authorized',
    },
  ]);
});

test('authorizes manifest and archive downloads with object-storage signed URLs when the provider supports them', async t => {
  const { app, db, owner } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const createResult = await app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    });
    const bundle = createResult.createCopilotSupportBundle;
    const authorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const authorization =
      authorizationResult.authorizeCopilotSupportBundleDownload;

    t.like(authorization, {
      actorId: owner.id,
      artifactFilename: bundle.archiveFilename,
      artifactFingerprint: bundle.archiveFingerprint,
      artifactKind: 'archive_json',
      artifactMime: 'application/json',
      bundleId: bundle.id,
      deliveryMethod: 'object_storage_signed_url',
      manifestFingerprint: bundle.manifestFingerprint,
      status: 'authorized',
      workspaceId: workspace.id,
    });
    t.true(
      authorization.downloadUrl.startsWith(
        'https://objects.example.test/support-bundles%2F'
      )
    );
    t.is(authorization.directDownloadUrl, authorization.downloadUrl);
    t.truthy(authorization.directDownloadExpiresAt);

    const rows = await db.$queryRaw<
      Array<{
        deliveryMethod: string;
        downloadedAt: Date | null;
        directDownloadExpiresAt: Date | null;
        directDownloadUrl: string | null;
        status: string;
      }>
    >`
      SELECT
        delivery_method AS "deliveryMethod",
        downloaded_at AS "downloadedAt",
        direct_download_expires_at AS "directDownloadExpiresAt",
        direct_download_url AS "directDownloadUrl",
        status
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${authorization.id}
    `;
    t.like(rows[0], {
      deliveryMethod: 'object_storage_signed_url',
      directDownloadUrl: authorization.downloadUrl,
      status: 'authorized',
    });
    t.is(rows[0].downloadedAt, null);
    t.truthy(rows[0].directDownloadExpiresAt);

    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_download_authorizations
        SET direct_download_url = ${null}
        WHERE id = ${authorization.id}
      `,
      {
        message:
          /ai_support_bundle_download_authorizations_delivery_shape_check/,
      }
    );

    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_download_authorizations
        SET direct_download_url = ${'   '}
        WHERE id = ${authorization.id}
      `,
      {
        message:
          /ai_support_bundle_download_authorizations_artifact_string_shape/,
      }
    );

    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_download_authorizations
        SET direct_download_expires_at = ${new Date(
          new Date(authorization.expiresAt).getTime() + 60_000
        )}
        WHERE id = ${authorization.id}
      `,
      {
        message:
          /ai_support_bundle_download_authorizations_direct_expiry_check/,
      }
    );

    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_download_authorizations
        SET downloaded_at = ${new Date('2026-06-22T12:40:00.000Z')}
        WHERE id = ${authorization.id}
      `,
      {
        message:
          /ai_support_bundle_download_authorizations_downloaded_at_status/,
      }
    );

    const artifactUrl = new URL(
      `/api/copilot/support-bundles/${authorization.id}/artifact?token=invalid`,
      app.url()
    );
    await app.GET(`${artifactUrl.pathname}${artifactUrl.search}`).expect(404);

    const auditRows = await db.$queryRaw<Array<{ metadata: unknown }>>`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'download_authorized'}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(auditRows[0].metadata, {
      deliveryMethod: 'object_storage_signed_url',
      hasDirectDownloadUrl: true,
    });

    const transferAuthorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const transferAuthorization =
      transferAuthorizationResult.authorizeCopilotSupportBundleDownload;
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_download_authorizations
        SET delivery_method = ${'api_proxy'}
        WHERE id = ${transferAuthorization.id}
      `,
      {
        message:
          /ai_support_bundle_download_authorizations_delivery_shape_check/,
      }
    );

    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_download_authorizations
        SET status = ${'downloaded'}
        WHERE id = ${transferAuthorization.id}
      `,
      {
        message:
          /ai_support_bundle_download_authorizations_downloaded_at_status/,
      }
    );

    await app
      .POST(supportBundleTransferEventPath)
      .send({
        authorizationId: transferAuthorization.id,
      })
      .expect(403);
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: '',
        artifactByteSize: -1,
      })
      .expect(400);
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: transferAuthorization.id,
        eventId: 'x'.repeat(513),
        artifactFingerprint: bundle.archiveFingerprint,
      })
      .expect(400);
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: transferAuthorization.id,
        artifactFingerprint: 'not-a-support-fingerprint',
      })
      .expect(400);
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: transferAuthorization.id,
        providerSignatureEvidence: {
          provider: 'aws_s3',
          status: 'verified',
          verifier: 'support-bundle-client-claimed-signature',
        },
      })
      .expect(400)
      .expect(res => {
        t.is(
          res.body.message,
          'Support bundle transfer event provider signature evidence must be supplied by verified forwarding headers'
        );
      });
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .set(
        supportBundleProviderSignatureEvidenceHeader,
        supportBundleProviderSignatureEvidenceHeaderValue({
          provider: 'aws_s3',
          status: 'verified_by_upstream',
          verifier: 'support-bundle-missing-fingerprint-worker',
          policy: 'aws-s3-event-notification',
        })
      )
      .send({
        provider: 's3_object_created',
        authorizationId: transferAuthorization.id,
        event: {
          Records: [
            {
              eventName: 'ObjectCreated:Put',
              eventSource: 'aws:s3',
              eventTime: new Date().toISOString(),
              responseElements: {
                'x-amz-request-id':
                  'support-bundle-missing-signature-fingerprint-event',
              },
              s3: {
                object: {
                  key: encodeURIComponent(bundle.archiveStorageKey),
                  size: bundle.archiveByteSize,
                },
              },
            },
          ],
        },
      })
      .expect(400);
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .set(
        supportBundleProviderSignatureEvidenceHeader,
        supportBundleProviderSignatureEvidenceHeaderValue({
          provider: 'aws_s3',
          status: 'verified',
          verifier: 'support-bundle-unverified-forwarder',
        })
      )
      .send({
        provider: 's3_object_created',
        authorizationId: transferAuthorization.id,
        event: {
          Records: [
            {
              eventSource: 'aws:s3',
              eventTime: new Date().toISOString(),
              responseElements: {
                'x-amz-request-id': 'support-bundle-unverified-s3-event',
              },
              s3: {
                object: {
                  key: encodeURIComponent(bundle.archiveStorageKey),
                  size: bundle.archiveByteSize,
                },
              },
            },
          ],
        },
      })
      .expect(400);
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .set(
        supportBundleProviderSignatureEvidenceHeader,
        supportBundleProviderSignatureEvidenceHeaderValue({
          provider: 'aws_s3',
          status: 'verified_by_upstream',
          verifier: 'x'.repeat(129),
          signatureFingerprint: 'a'.repeat(64),
          policy: 'aws-s3-event-notification',
        })
      )
      .send({
        provider: 's3_object_created',
        authorizationId: transferAuthorization.id,
        event: {
          Records: [
            {
              eventSource: 'aws:s3',
              eventTime: new Date().toISOString(),
              responseElements: {
                'x-amz-request-id': 'support-bundle-overlong-s3-event',
              },
              s3: {
                object: {
                  key: encodeURIComponent(bundle.archiveStorageKey),
                  size: bundle.archiveByteSize,
                },
              },
            },
          ],
        },
      })
      .expect(400);
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: transferAuthorization.id,
        eventId: 'support-bundle-transfer-mismatch-e2e',
        eventSource: 'object_storage_event_e2e',
        storageKey: bundle.archiveStorageKey,
        artifactByteSize: bundle.archiveByteSize + 1,
        artifactFingerprint: bundle.archiveFingerprint,
        transferredAt: new Date().toISOString(),
      })
      .expect(400)
      .expect(res => {
        t.is(
          res.body.message,
          'Support bundle transfer event byte size mismatch'
        );
      });
    const mismatchRows = await db.$queryRaw<
      Array<{ downloadedAt: Date | null; status: string }>
    >`
      SELECT downloaded_at AS "downloadedAt", status
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${transferAuthorization.id}
    `;
    t.deepEqual(mismatchRows, [
      {
        downloadedAt: null,
        status: 'authorized',
      },
    ]);

    const transferredAt = new Date();
    const transferResponse = await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: transferAuthorization.id,
        eventId: 'support-bundle-transfer-ok-e2e',
        eventSource: 'object_storage_event_e2e',
        storageKey: bundle.archiveStorageKey,
        artifactByteSize: bundle.archiveByteSize,
        artifactFingerprint: bundle.archiveFingerprint,
        transferredAt: transferredAt.toISOString(),
      })
      .expect(200);
    const transferResult = transferResponse.body;
    t.like(transferResult, {
      id: transferAuthorization.id,
      artifactFingerprint: bundle.archiveFingerprint,
      artifactKind: 'archive_json',
      bundleId: bundle.id,
      deliveryMethod: 'object_storage_signed_url',
      manifestFingerprint: bundle.manifestFingerprint,
      status: 'downloaded',
      workspaceId: workspace.id,
    });
    t.truthy(transferResult.downloadedAt);
    t.false('directDownloadUrl' in transferResult);
    t.false('downloadUrl' in transferResult);

    const replayResponse = await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: transferAuthorization.id,
        eventId: 'support-bundle-transfer-ok-e2e-replay',
        eventSource: 'object_storage_event_e2e',
        storageKey: bundle.archiveStorageKey,
        artifactByteSize: bundle.archiveByteSize,
        artifactFingerprint: bundle.archiveFingerprint,
        transferredAt: transferredAt.toISOString(),
      })
      .expect(200);
    t.like(replayResponse.body, {
      id: transferAuthorization.id,
      status: 'downloaded',
    });

    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: transferAuthorization.id,
        eventId: 'support-bundle-transfer-ok-e2e-mismatch-replay',
        eventSource: 'object_storage_event_e2e',
        storageKey: bundle.archiveStorageKey,
        artifactByteSize: bundle.archiveByteSize + 1,
        artifactFingerprint: bundle.archiveFingerprint,
        transferredAt: transferredAt.toISOString(),
      })
      .expect(400)
      .expect(res => {
        t.is(
          res.body.message,
          'Support bundle transfer event byte size mismatch'
        );
      });

    const replayAuditCountRows = await db.$queryRaw<
      Array<{
        downloadedAuditCount: number;
        status: string;
        transferEventCount: number;
      }>
    >`
      SELECT
        a.status,
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_audit_events e
          WHERE e.bundle_id = a.bundle_id
            AND e.event_type = ${'downloaded'}
            AND e.metadata->>'authorizationId' = a.id
        ) AS "downloadedAuditCount",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_transfer_events te
          WHERE te.authorization_id = a.id
        ) AS "transferEventCount"
      FROM ai_support_bundle_download_authorizations a
      WHERE a.id = ${transferAuthorization.id}
    `;
    t.deepEqual(replayAuditCountRows, [
      {
        downloadedAuditCount: 1,
        status: 'downloaded',
        transferEventCount: 2,
      },
    ]);

    const transferEventRows = await db.$queryRaw<
      Array<{
        artifactFingerprint: string;
        authorizationFingerprint: string;
        deliveryMethod: string;
        eventFingerprint: string;
        eventId: string | null;
        eventSource: string;
        manifestFingerprint: string;
        notificationAuthEvidence: Record<string, unknown>;
        notificationAuthEvidenceFingerprint: string;
        storageByteSize: number;
        storageContentType: string;
        storageKey: string;
      }>
    >`
      SELECT
        artifact_fingerprint AS "artifactFingerprint",
        authorization_fingerprint AS "authorizationFingerprint",
        delivery_method AS "deliveryMethod",
        event_fingerprint AS "eventFingerprint",
        event_id AS "eventId",
        event_source AS "eventSource",
        manifest_fingerprint AS "manifestFingerprint",
        notification_auth_evidence AS "notificationAuthEvidence",
        notification_auth_evidence_fingerprint AS "notificationAuthEvidenceFingerprint",
        storage_byte_size AS "storageByteSize",
        storage_content_type AS "storageContentType",
        storage_key AS "storageKey"
      FROM ai_support_bundle_transfer_events
      WHERE authorization_id = ${transferAuthorization.id}
      ORDER BY created_at ASC, event_id ASC
    `;
    t.is(transferEventRows.length, 2);
    t.like(transferEventRows[0], {
      artifactFingerprint: bundle.archiveFingerprint,
      authorizationFingerprint: transferAuthorization.authorizationFingerprint,
      deliveryMethod: 'object_storage_signed_url',
      eventId: 'support-bundle-transfer-ok-e2e',
      eventSource: 'object_storage_event_e2e',
      manifestFingerprint: bundle.manifestFingerprint,
      notificationAuthEvidence: {
        policy: 'internal_access_token',
        status: 'verified',
        method: 'x-access-token',
      },
      storageByteSize: bundle.archiveByteSize,
      storageKey: bundle.archiveStorageKey,
    });
    t.is(transferEventRows[1].eventId, 'support-bundle-transfer-ok-e2e-replay');
    t.regex(transferEventRows[0].eventFingerprint, /^[a-f0-9]{16}$/);
    t.regex(
      transferEventRows[0].notificationAuthEvidenceFingerprint,
      /^[a-f0-9]{16}$/
    );
    t.truthy(transferEventRows[0].storageContentType);

    const forwardingRows = await db.$queryRaw<
      Array<{
        attemptCount: number;
        eventId: string | null;
        failureCode: string | null;
        failureMessage: string | null;
        forwardedTransferEventFingerprint: string | null;
        forwardingPayload: Record<string, unknown>;
        providerSignatureEvidenceFingerprint: string | null;
        status: string;
      }>
    >`
      SELECT
        attempt_count AS "attemptCount",
        event_id AS "eventId",
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        forwarded_transfer_event_fingerprint AS "forwardedTransferEventFingerprint",
        forwarding_payload AS "forwardingPayload",
        provider_signature_evidence_fingerprint AS "providerSignatureEvidenceFingerprint",
        status
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE authorization_id = ${transferAuthorization.id}
      ORDER BY created_at ASC, event_id ASC
    `;
    t.is(forwardingRows.length, 4);
    const mismatchForwardingRow = forwardingRows.find(
      row => row.eventId === 'support-bundle-transfer-mismatch-e2e'
    );
    const okForwardingRow = forwardingRows.find(
      row => row.eventId === 'support-bundle-transfer-ok-e2e'
    );
    const replayMismatchForwardingRow = forwardingRows.find(
      row => row.eventId === 'support-bundle-transfer-ok-e2e-mismatch-replay'
    );
    const replayOkForwardingRow = forwardingRows.find(
      row => row.eventId === 'support-bundle-transfer-ok-e2e-replay'
    );
    t.truthy(mismatchForwardingRow);
    t.truthy(okForwardingRow);
    t.truthy(replayMismatchForwardingRow);
    t.truthy(replayOkForwardingRow);
    t.like(mismatchForwardingRow!, {
      attemptCount: 1,
      eventId: 'support-bundle-transfer-mismatch-e2e',
      failureCode: 'support_bundle_transfer_event_byte_size_mismatch',
      forwardedTransferEventFingerprint: null,
      providerSignatureEvidenceFingerprint: null,
      status: 'dead_lettered',
    });
    t.like(okForwardingRow!, {
      attemptCount: 1,
      eventId: 'support-bundle-transfer-ok-e2e',
      forwardedTransferEventFingerprint: transferEventRows[0].eventFingerprint,
      providerSignatureEvidenceFingerprint: null,
      status: 'forwarded',
    });
    t.like(replayMismatchForwardingRow!, {
      attemptCount: 1,
      eventId: 'support-bundle-transfer-ok-e2e-mismatch-replay',
      failureCode: 'support_bundle_transfer_event_byte_size_mismatch',
      status: 'dead_lettered',
    });
    t.like(replayOkForwardingRow!, {
      attemptCount: 1,
      eventId: 'support-bundle-transfer-ok-e2e-replay',
      forwardedTransferEventFingerprint: transferEventRows[1].eventFingerprint,
      status: 'forwarded',
    });
    t.like(okForwardingRow!.forwardingPayload, {
      version: 'copilot-support-bundle-transfer-forwarding-payload/v1',
      event: {
        authorizationId: transferAuthorization.id,
        eventId: 'support-bundle-transfer-ok-e2e',
        eventSource: 'object_storage_event_e2e',
        storageKey: bundle.archiveStorageKey,
        artifactByteSize: bundle.archiveByteSize,
        artifactFingerprint: bundle.archiveFingerprint,
        notificationAuthEvidence: {
          policy: 'internal_access_token',
          status: 'verified',
          method: 'x-access-token',
        },
      },
    });
    t.truthy(mismatchForwardingRow!.failureMessage);

    const transferHistoryResult = await app.gql({
      query: getSupportBundleQuery,
      variables: {
        workspaceId: workspace.id,
        id: bundle.id,
      },
    });
    const transferHistoryBundle =
      transferHistoryResult.currentUser.copilot.supportBundle;
    t.is(transferHistoryBundle.id, bundle.id);
    t.is(transferHistoryBundle.transferEventCount, 2);
    t.is(transferHistoryBundle.transferEvents.length, 2);
    t.like(transferHistoryBundle.transferEvents[0], {
      artifactFingerprint: bundle.archiveFingerprint,
      artifactKind: 'archive_json',
      authorizationFingerprint: transferAuthorization.authorizationFingerprint,
      authorizationId: transferAuthorization.id,
      deliveryMethod: 'object_storage_signed_url',
      eventId: 'support-bundle-transfer-ok-e2e-replay',
      eventSource: 'object_storage_event_e2e',
      manifestFingerprint: bundle.manifestFingerprint,
      storageByteSize: bundle.archiveByteSize,
      storageContentType: transferEventRows[1].storageContentType,
      storageKey: bundle.archiveStorageKey,
    });
    t.like(transferHistoryBundle.transferEvents[1], {
      artifactFingerprint: bundle.archiveFingerprint,
      artifactKind: 'archive_json',
      authorizationFingerprint: transferAuthorization.authorizationFingerprint,
      authorizationId: transferAuthorization.id,
      deliveryMethod: 'object_storage_signed_url',
      eventId: 'support-bundle-transfer-ok-e2e',
      eventSource: 'object_storage_event_e2e',
      manifestFingerprint: bundle.manifestFingerprint,
      storageByteSize: bundle.archiveByteSize,
      storageContentType: transferEventRows[0].storageContentType,
      storageKey: bundle.archiveStorageKey,
    });
    t.is(
      transferHistoryBundle.transferEvents[0].eventFingerprint,
      transferEventRows[1].eventFingerprint
    );
    t.is(
      transferHistoryBundle.transferEvents[1].eventFingerprint,
      transferEventRows[0].eventFingerprint
    );
    t.is(
      transferHistoryBundle.transferEvents[0]
        .notificationAuthEvidenceFingerprint,
      transferEventRows[1].notificationAuthEvidenceFingerprint
    );
    t.is(
      transferHistoryBundle.transferEvents[1]
        .notificationAuthEvidenceFingerprint,
      transferEventRows[0].notificationAuthEvidenceFingerprint
    );
    t.truthy(transferHistoryBundle.transferEvents[0].createdAt);
    t.truthy(transferHistoryBundle.transferEvents[0].transferredAt);

    await db.$executeRaw`
      UPDATE ai_support_bundle_transfer_events
      SET notification_auth_evidence = notification_auth_evidence
      WHERE event_fingerprint = ${transferEventRows[0].eventFingerprint}
    `;

    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_transfer_events
        SET
          event_source = ${'object_storage_event_e2e_rewritten'},
          notification_auth_evidence =
            notification_auth_evidence || ${JSON.stringify({
              rewrittenAfterPersist: true,
            })}::jsonb
        WHERE event_fingerprint = ${transferEventRows[0].eventFingerprint}
      `,
      {
        message:
          /ai_support_bundle_transfer_events_content_update_restrict_check/,
      }
    );
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_transfer_events
        SET event_fingerprint = ${'0123456789abcdef'}
        WHERE event_fingerprint = ${transferEventRows[0].eventFingerprint}
      `,
      {
        message:
          /ai_support_bundle_transfer_events_content_update_restrict_check/,
      }
    );
    await t.throwsAsync(
      db.$transaction(async tx => {
        await tx.$executeRaw`
          DELETE FROM ai_support_bundle_transfer_events
          WHERE event_fingerprint = ${transferEventRows[0].eventFingerprint}
        `;
        await tx.$executeRaw`
          SET CONSTRAINTS "zz_ai_support_bundle_transfer_events_delete_restrict_check" IMMEDIATE
        `;
      }),
      {
        message: /ai_support_bundle_transfer_events_delete_restrict_check/,
      }
    );

    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_transfer_events
        SET notification_auth_evidence = notification_auth_evidence - ${'method'}
        WHERE event_fingerprint = ${transferEventRows[0].eventFingerprint}
      `,
      {
        message: /ai_support_bundle_transfer_events_auth_evidence_check/,
      }
    );
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_transfer_events
        SET storage_key = ${`${bundle.archiveStorageKey}.drift`}
        WHERE event_fingerprint = ${transferEventRows[0].eventFingerprint}
      `,
      {
        message: /ai_support_bundle_transfer_events_storage_snapshot_check/,
      }
    );
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_transfer_events
        SET storage_byte_size = ${bundle.archiveByteSize + 1}
        WHERE event_fingerprint = ${transferEventRows[0].eventFingerprint}
      `,
      {
        message: /ai_support_bundle_transfer_events_storage_snapshot_check/,
      }
    );
    await t.throwsAsync(
      db.$executeRaw`
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
          ${`support-bundle-transfer-event-drift-${randomUUID()}`},
          ${transferAuthorization.id},
          ${bundle.id},
          ${workspace.id},
          ${owner.id},
          ${'archive_json'},
          ${bundle.manifestFingerprint},
          ${bundle.archiveFingerprint},
          ${'0000000000000000'},
          ${'object_storage_signed_url'},
          ${'support-bundle-transfer-drift-e2e'},
          ${'object_storage_event_e2e'},
          ${transferredAt},
          ${JSON.stringify({
            policy: 'internal_access_token',
            status: 'verified',
            method: 'x-access-token',
          })}::jsonb,
          ${transferEventRows[0].notificationAuthEvidenceFingerprint},
          ${bundle.archiveStorageKey},
          ${bundle.archiveByteSize},
          ${transferEventRows[0].storageContentType},
          ${supportBundleFingerprint({
            version: 'support-bundle-transfer-drift-e2e',
            id: randomUUID(),
          })}
        )
      `,
      {
        message: /ai_support_bundle_transfer_events_authorization_fkey/,
      }
    );
    await t.throwsAsync(
      db.$executeRaw`
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
          ${`support-bundle-transfer-storage-drift-${randomUUID()}`},
          ${transferAuthorization.id},
          ${bundle.id},
          ${workspace.id},
          ${owner.id},
          ${'archive_json'},
          ${bundle.manifestFingerprint},
          ${bundle.archiveFingerprint},
          ${transferAuthorization.authorizationFingerprint},
          ${'object_storage_signed_url'},
          ${'support-bundle-transfer-storage-drift-e2e'},
          ${'object_storage_event_e2e'},
          ${transferredAt},
          ${JSON.stringify({
            policy: 'internal_access_token',
            status: 'verified',
            method: 'x-access-token',
          })}::jsonb,
          ${transferEventRows[0].notificationAuthEvidenceFingerprint},
          ${`${bundle.archiveStorageKey}.drift`},
          ${bundle.archiveByteSize},
          ${transferEventRows[0].storageContentType},
          ${supportBundleFingerprint({
            version: 'support-bundle-transfer-storage-drift-e2e',
            id: randomUUID(),
          })}
        )
      `,
      {
        message: /ai_support_bundle_transfer_events_storage_snapshot_check/,
      }
    );
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_download_authorizations
        SET authorization_fingerprint = ${'1111111111111111'}
        WHERE id = ${transferAuthorization.id}
      `,
      {
        message: /ai_support_bundle_transfer_events_authorization_fkey/,
      }
    );

    const transferAuditRows = await db.$queryRaw<
      Array<{ id: string; metadata: Record<string, unknown> }>
    >`
      SELECT id, metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'downloaded'}
      AND metadata->>'authorizationId' = ${transferAuthorization.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(transferAuditRows[0].metadata, {
      authorizationId: transferAuthorization.id,
      artifactKind: 'archive_json',
      artifactFingerprint: bundle.archiveFingerprint,
      clientAcknowledged: false,
      deliveryMethod: 'object_storage_signed_url',
      manifestFingerprint: bundle.manifestFingerprint,
      notificationAuthEvidence: {
        policy: 'internal_access_token',
        status: 'verified',
        method: 'x-access-token',
      },
      providerTransferEvent: true,
      serverVerified: true,
      storageByteSize: bundle.archiveByteSize,
      storageKey: bundle.archiveStorageKey,
      transferEventId: 'support-bundle-transfer-ok-e2e',
      transferEventSource: 'object_storage_event_e2e',
    });
    t.is(
      transferAuditRows[0].metadata.transferEventFingerprint,
      transferEventRows[0].eventFingerprint
    );
    t.regex(
      String(transferAuditRows[0].metadata.notificationAuthEvidenceFingerprint),
      /^[a-f0-9]{16}$/
    );
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_audit_events
        SET metadata = metadata - ${'notificationAuthEvidence'}
        WHERE id = ${transferAuditRows[0].id}
      `,
      {
        message:
          /ai_support_bundle_audit_events_(transfer_metadata_shape|provider_sig_evidence)_check/,
      }
    );

    const s3TransferAuthorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const s3TransferAuthorization =
      s3TransferAuthorizationResult.authorizeCopilotSupportBundleDownload;
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .set(
        supportBundleProviderSignatureEvidenceHeader,
        supportBundleProviderSignatureEvidenceHeaderValue(
          supportBundleProviderSignatureEvidence(
            'support-bundle-s3-notification-worker'
          )
        )
      )
      .send({
        provider: 's3_object_created',
        authorizationId: s3TransferAuthorization.id,
        artifactFingerprint: bundle.archiveFingerprint,
        event: {
          Records: [],
        },
      })
      .expect(400);
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .set(
        supportBundleProviderSignatureEvidenceHeader,
        supportBundleProviderSignatureEvidenceHeaderValue(
          supportBundleProviderSignatureEvidence(
            'support-bundle-s3-notification-worker'
          )
        )
      )
      .send({
        provider: 's3_object_created',
        authorizationId: s3TransferAuthorization.id,
        artifactFingerprint: bundle.archiveFingerprint,
        event: {
          Records: [
            {
              eventName: 'ObjectRemoved:Delete',
              eventSource: 'aws:s3',
              eventTime: new Date().toISOString(),
              responseElements: {
                'x-amz-request-id':
                  'support-bundle-non-created-s3-transfer-e2e',
              },
              s3: {
                object: {
                  key: encodeURIComponent(bundle.archiveStorageKey),
                  size: bundle.archiveByteSize,
                },
              },
            },
          ],
        },
      })
      .expect(400);
    const s3TransferredAt = new Date();
    const s3TransferResponse = await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .set(
        supportBundleProviderSignatureEvidenceHeader,
        supportBundleProviderSignatureEvidenceHeaderValue({
          ...supportBundleProviderSignatureEvidence(
            'support-bundle-s3-notification-worker'
          ),
          keyId: 'support-bundle-test-key',
          algorithm: 'AWS4-HMAC-SHA256',
        })
      )
      .send({
        provider: 's3_object_created',
        authorizationId: s3TransferAuthorization.id,
        artifactFingerprint: bundle.archiveFingerprint,
        event: {
          Records: [
            {
              eventName: 'ObjectCreated:Put',
              eventSource: 'aws:s3',
              eventTime: s3TransferredAt.toISOString(),
              responseElements: {
                'x-amz-request-id': 'support-bundle-s3-transfer-e2e',
              },
              s3: {
                object: {
                  key: encodeURIComponent(bundle.archiveStorageKey),
                  size: bundle.archiveByteSize,
                },
              },
            },
          ],
        },
      })
      .expect(200);
    t.like(s3TransferResponse.body, {
      id: s3TransferAuthorization.id,
      status: 'downloaded',
    });

    const s3TransferAuditRows = await db.$queryRaw<
      Array<{ id: string; metadata: Record<string, unknown> }>
    >`
      SELECT id, metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'downloaded'}
      AND metadata->>'authorizationId' = ${s3TransferAuthorization.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(s3TransferAuditRows[0].metadata, {
      authorizationId: s3TransferAuthorization.id,
      artifactKind: 'archive_json',
      artifactFingerprint: bundle.archiveFingerprint,
      clientAcknowledged: false,
      deliveryMethod: 'object_storage_signed_url',
      notificationAuthEvidence: {
        policy: 'internal_access_token',
        status: 'verified',
        method: 'x-access-token',
        providerSignatureEvidence: {
          provider: 'aws_s3',
          status: 'verified_by_upstream',
          verifier: 'support-bundle-s3-notification-worker',
          keyId: 'support-bundle-test-key',
          algorithm: 'AWS4-HMAC-SHA256',
          signatureFingerprint: 'a'.repeat(64),
          policy: 'aws-s3-event-notification',
        },
      },
      providerTransferEvent: true,
      serverVerified: true,
      storageByteSize: bundle.archiveByteSize,
      storageKey: bundle.archiveStorageKey,
      transferEventId: 'support-bundle-s3-transfer-e2e',
      transferEventSource: 'aws:s3',
    });
    t.regex(
      String(
        s3TransferAuditRows[0].metadata.notificationAuthEvidenceFingerprint
      ),
      /^[a-f0-9]{16}$/
    );
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_audit_events
        SET metadata = jsonb_set(
          metadata,
          ${'{notificationAuthEvidence,providerSignatureEvidence,status}'}::text[],
          ${JSON.stringify('verified')}::jsonb
        )
        WHERE id = ${s3TransferAuditRows[0].id}
      `,
      {
        message:
          /ai_support_bundle_audit_events_(transfer_metadata_shape|provider_sig_evidence)_check/,
      }
    );
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_audit_events
        SET metadata = metadata #- ${'{notificationAuthEvidence,providerSignatureEvidence,signatureFingerprint}'}::text[]
        WHERE id = ${s3TransferAuditRows[0].id}
      `,
      {
        message: /ai_support_bundle_audit_events_provider_sig_evidence_check/,
      }
    );
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_audit_events
        SET metadata = metadata #- ${'{notificationAuthEvidence,providerSignatureEvidence}'}::text[]
        WHERE id = ${s3TransferAuditRows[0].id}
      `,
      {
        message: /ai_support_bundle_audit_events_provider_sig_evidence_check/,
      }
    );
    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_audit_events
        SET metadata = jsonb_set(
          metadata,
          ${'{notificationAuthEvidence,providerSignatureEvidence,verifier}'}::text[],
          ${JSON.stringify('')}::jsonb
        )
        WHERE id = ${s3TransferAuditRows[0].id}
      `,
      {
        message: /ai_support_bundle_audit_events_provider_sig_evidence_check/,
      }
    );

    const s3EventBridgeAuthorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const s3EventBridgeAuthorization =
      s3EventBridgeAuthorizationResult.authorizeCopilotSupportBundleDownload;
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .set(
        supportBundleProviderSignatureEvidenceHeader,
        supportBundleProviderSignatureEvidenceHeaderValue(
          supportBundleProviderSignatureEvidence(
            'support-bundle-s3-eventbridge-worker'
          )
        )
      )
      .send({
        provider: 's3_object_created',
        authorizationId: s3EventBridgeAuthorization.id,
        artifactFingerprint: bundle.archiveFingerprint,
        event: {
          id: 'support-bundle-s3-eventbridge-delete-e2e',
          source: 'aws.s3',
          'detail-type': 'Object Deleted',
          time: new Date().toISOString(),
          detail: {
            object: {
              key: bundle.archiveStorageKey,
              size: bundle.archiveByteSize,
            },
          },
        },
      })
      .expect(400);
    const s3EventBridgeTransferredAt = new Date();
    const s3EventBridgeTransferResponse = await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .set(
        supportBundleProviderSignatureEvidenceHeader,
        supportBundleProviderSignatureEvidenceHeaderValue(
          supportBundleProviderSignatureEvidence(
            'support-bundle-s3-eventbridge-worker'
          )
        )
      )
      .send({
        provider: 's3_object_created',
        authorizationId: s3EventBridgeAuthorization.id,
        artifactFingerprint: bundle.archiveFingerprint,
        event: {
          id: 'support-bundle-s3-eventbridge-transfer-e2e',
          source: 'aws.s3',
          'detail-type': 'Object Created',
          time: s3EventBridgeTransferredAt.toISOString(),
          detail: {
            object: {
              key: bundle.archiveStorageKey,
              size: bundle.archiveByteSize,
            },
          },
        },
      })
      .expect(200);
    t.like(s3EventBridgeTransferResponse.body, {
      id: s3EventBridgeAuthorization.id,
      status: 'downloaded',
    });

    const s3EventBridgeAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'downloaded'}
      AND metadata->>'authorizationId' = ${s3EventBridgeAuthorization.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(s3EventBridgeAuditRows[0].metadata, {
      transferEventId: 'support-bundle-s3-eventbridge-transfer-e2e',
      transferEventSource: 'aws.s3',
      storageByteSize: bundle.archiveByteSize,
      storageKey: bundle.archiveStorageKey,
    });

    const expiredDirectAuthorization = await createDownloadAuthorizationFixture(
      {
        db,
        bundle,
        artifactKind: 'archive_json',
        deliveryMethod: 'object_storage_signed_url',
        directDownloadExpiresAt: new Date(Date.now() - 60_000),
        directDownloadUrl: 'https://objects.example.test/expired-direct',
      }
    );
    await t.throwsAsync(
      app.gql({
        query: acknowledgeSupportBundleDirectDownloadMutation,
        variables: {
          input: {
            workspaceId: workspace.id,
            authorizationId: expiredDirectAuthorization.id,
          },
        },
      })
    );
    const expiredDirectAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'download_authorized'}
        AND metadata->>'authorizationExpired' = ${'true'}
        AND metadata->>'authorizationId' = ${expiredDirectAuthorization.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(expiredDirectAuditRows[0].metadata, {
      authorizationExpired: true,
      authorizationId: expiredDirectAuthorization.id,
      authorizationFingerprint:
        expiredDirectAuthorization.authorizationFingerprint,
      artifactKind: 'archive_json',
      cleanupActorId: 'system_download_authorization_expiration_guard',
      cleanupScope: 'direct_download_acknowledge',
      deliveryMethod: 'object_storage_signed_url',
      previousStatus: 'authorized',
      status: 'expired',
    });

    const acknowledgeResult = await app.gql({
      query: acknowledgeSupportBundleDirectDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          authorizationId: authorization.id,
        },
      },
    });
    const acknowledgedAuthorization =
      acknowledgeResult.acknowledgeCopilotSupportBundleDirectDownload;
    t.like(acknowledgedAuthorization, {
      id: authorization.id,
      actorId: owner.id,
      artifactFingerprint: bundle.archiveFingerprint,
      artifactKind: 'archive_json',
      bundleId: bundle.id,
      deliveryMethod: 'object_storage_signed_url',
      directDownloadUrl: authorization.downloadUrl,
      downloadUrl: authorization.downloadUrl,
      manifestFingerprint: bundle.manifestFingerprint,
      status: 'downloaded',
      workspaceId: workspace.id,
    });
    t.truthy(acknowledgedAuthorization.downloadedAt);

    const acknowledgedRows = await db.$queryRaw<
      Array<{
        downloadedAt: Date | null;
        status: string;
      }>
    >`
      SELECT
        downloaded_at AS "downloadedAt",
        status
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${authorization.id}
    `;
    t.like(acknowledgedRows[0], {
      status: 'downloaded',
    });
    t.truthy(acknowledgedRows[0].downloadedAt);

    const downloadedAuditRows = await db.$queryRaw<
      Array<{ metadata: unknown }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'downloaded'}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(downloadedAuditRows[0].metadata, {
      authorizationId: authorization.id,
      artifactKind: 'archive_json',
      clientAcknowledged: true,
      deliveryMethod: 'object_storage_signed_url',
      manifestFingerprint: bundle.manifestFingerprint,
      artifactFingerprint: bundle.archiveFingerprint,
    });

    await t.throwsAsync(
      app.gql({
        query: acknowledgeSupportBundleDirectDownloadMutation,
        variables: {
          input: {
            workspaceId: workspace.id,
            authorizationId: authorization.id,
          },
        },
      })
    );

    const manifestAuthorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'manifest_json',
        },
      },
    });
    const manifestAuthorization =
      manifestAuthorizationResult.authorizeCopilotSupportBundleDownload;
    t.like(manifestAuthorization, {
      actorId: owner.id,
      artifactFilename: bundle.manifestFilename,
      artifactFingerprint: bundle.manifestFingerprint,
      artifactKind: 'manifest_json',
      artifactMime: 'application/json',
      bundleId: bundle.id,
      deliveryMethod: 'object_storage_signed_url',
      directDownloadUrl: manifestAuthorization.downloadUrl,
      manifestFingerprint: bundle.manifestFingerprint,
      status: 'authorized',
      workspaceId: workspace.id,
    });
    t.true(
      manifestAuthorization.downloadUrl.startsWith(
        'https://objects.example.test/support-bundles%2F'
      )
    );
    t.is(
      manifestAuthorization.directDownloadUrl,
      manifestAuthorization.downloadUrl
    );
    t.truthy(manifestAuthorization.directDownloadExpiresAt);

    const manifestAcknowledgeResult = await app.gql({
      query: acknowledgeSupportBundleDirectDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          authorizationId: manifestAuthorization.id,
        },
      },
    });
    const acknowledgedManifestAuthorization =
      manifestAcknowledgeResult.acknowledgeCopilotSupportBundleDirectDownload;
    t.like(acknowledgedManifestAuthorization, {
      id: manifestAuthorization.id,
      actorId: owner.id,
      artifactFilename: bundle.manifestFilename,
      artifactFingerprint: bundle.manifestFingerprint,
      artifactKind: 'manifest_json',
      bundleId: bundle.id,
      deliveryMethod: 'object_storage_signed_url',
      directDownloadUrl: manifestAuthorization.downloadUrl,
      downloadUrl: manifestAuthorization.downloadUrl,
      manifestFingerprint: bundle.manifestFingerprint,
      status: 'downloaded',
      workspaceId: workspace.id,
    });
    t.truthy(acknowledgedManifestAuthorization.downloadedAt);
    const manifestRows = await db.$queryRaw<
      Array<{ downloadedAt: Date | null; status: string }>
    >`
      SELECT downloaded_at AS "downloadedAt", status
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${manifestAuthorization.id}
    `;
    t.deepEqual(manifestRows, [
      {
        downloadedAt: new Date(acknowledgedManifestAuthorization.downloadedAt),
        status: 'downloaded',
      },
    ]);
    const manifestDownloadedAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'downloaded'}
      AND metadata->>'authorizationId' = ${manifestAuthorization.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(manifestDownloadedAuditRows[0].metadata, {
      authorizationId: manifestAuthorization.id,
      artifactKind: 'manifest_json',
      artifactFingerprint: bundle.manifestFingerprint,
      clientAcknowledged: true,
      deliveryMethod: 'object_storage_signed_url',
      manifestFingerprint: bundle.manifestFingerprint,
    });
  } finally {
    restoreStorageFactory();
  }
});

test('persists support bundle transfer forwarding retries and dead letters before worker replay', async t => {
  const { app, cronJobs, db } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const createResult = await app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    });
    const bundle = createResult.createCopilotSupportBundle;
    const authorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const authorization =
      authorizationResult.authorizeCopilotSupportBundleDownload;
    const storageProvider = app
      .get(StorageProviderFactory)
      .create(app.get(Config).storages.blob.storage);
    const archiveObject = await storageProvider.get(bundle.archiveStorageKey);
    const archiveBody = archiveObject.body
      ? await readableToBuffer(archiveObject.body)
      : null;
    await storageProvider.delete(bundle.archiveStorageKey);

    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .set(
        supportBundleProviderSignatureEvidenceHeader,
        supportBundleProviderSignatureEvidenceHeaderValue(
          supportBundleProviderSignatureEvidence(
            'support-bundle-forwarding-retry-worker'
          )
        )
      )
      .send({
        provider: 's3_object_created',
        authorizationId: authorization.id,
        artifactFingerprint: bundle.archiveFingerprint,
        event: {
          Records: [
            {
              eventName: 'ObjectCreated:Put',
              eventSource: 'aws:s3',
              eventTime: new Date().toISOString(),
              responseElements: {
                'x-amz-request-id': 'support-bundle-forwarding-retry-e2e',
              },
              s3: {
                object: {
                  key: encodeURIComponent(bundle.archiveStorageKey),
                  size: bundle.archiveByteSize,
                },
              },
            },
          ],
        },
      })
      .expect(400)
      .expect(res => {
        t.is(
          res.body.message,
          'Support bundle artifact storage object is missing'
        );
      });

    const retryRows = await db.$queryRaw<
      Array<{
        attemptCount: number;
        eventId: string | null;
        failureCode: string | null;
        nextAttemptAt: Date | null;
        providerSignatureEvidenceFingerprint: string | null;
        status: string;
      }>
    >`
      SELECT
        attempt_count AS "attemptCount",
        event_id AS "eventId",
        failure_code AS "failureCode",
        next_attempt_at AS "nextAttemptAt",
        provider_signature_evidence_fingerprint AS "providerSignatureEvidenceFingerprint",
        status
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE authorization_id = ${authorization.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(retryRows[0], {
      attemptCount: 1,
      eventId: 'support-bundle-forwarding-retry-e2e',
      failureCode: 'support_bundle_artifact_storage_object_is_missing',
      status: 'retry_scheduled',
    });
    t.truthy(retryRows[0].nextAttemptAt);
    t.regex(
      retryRows[0].providerSignatureEvidenceFingerprint ?? '',
      /^[a-f0-9]{16}$/
    );

    await db.$executeRaw`
      UPDATE ai_support_bundle_transfer_forwarding_events
      SET next_attempt_at = GREATEST(
        created_at,
        CURRENT_TIMESTAMP - interval '1 second'
      )
      WHERE authorization_id = ${authorization.id}
    `;
    t.truthy(archiveBody);
    await storageProvider.put(
      bundle.archiveStorageKey,
      archiveBody ?? Buffer.alloc(0),
      {
        contentType: bundle.archiveMime,
      }
    );
    const processing =
      await cronJobs.processSupportBundleTransferForwardingEvents({
        limit: 10,
      });
    t.is(processing, JOB_SIGNAL.Done);

    const forwardedRows = await db.$queryRaw<
      Array<{
        attemptCount: number;
        forwardedTransferEventFingerprint: string | null;
        status: string;
        transferEventCount: number;
      }>
    >`
      SELECT
        forwarding.attempt_count AS "attemptCount",
        forwarding.forwarded_transfer_event_fingerprint AS "forwardedTransferEventFingerprint",
        forwarding.status,
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_transfer_events transfer_event
          WHERE transfer_event.authorization_id = forwarding.authorization_id
        ) AS "transferEventCount"
      FROM ai_support_bundle_transfer_forwarding_events forwarding
      WHERE forwarding.authorization_id = ${authorization.id}
      ORDER BY forwarding.created_at DESC
      LIMIT 1
    `;
    t.like(forwardedRows[0], {
      attemptCount: 2,
      status: 'forwarded',
      transferEventCount: 1,
    });
    t.regex(
      forwardedRows[0].forwardedTransferEventFingerprint ?? '',
      /^[a-f0-9]{16}$/
    );

    const deadLetterAuthorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const deadLetterAuthorization =
      deadLetterAuthorizationResult.authorizeCopilotSupportBundleDownload;
    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: deadLetterAuthorization.id,
        eventId: 'support-bundle-forwarding-dead-letter-e2e',
        eventSource: 'object_storage_event_e2e',
        storageKey: `${bundle.archiveStorageKey}.drift`,
        artifactByteSize: bundle.archiveByteSize,
        artifactFingerprint: bundle.archiveFingerprint,
        transferredAt: new Date().toISOString(),
      })
      .expect(400)
      .expect(res => {
        t.is(
          res.body.message,
          'Support bundle transfer event storage key mismatch'
        );
      });
    const deadLetterRows = await db.$queryRaw<
      Array<{
        deadLetteredAt: Date | null;
        failureCode: string | null;
        forwardingEventFingerprint: string;
        forwardingPayloadFingerprint: string;
        id: string;
        status: string;
      }>
    >`
      SELECT
        dead_lettered_at AS "deadLetteredAt",
        failure_code AS "failureCode",
        forwarding_event_fingerprint AS "forwardingEventFingerprint",
        forwarding_payload_fingerprint AS "forwardingPayloadFingerprint",
        id,
        status
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE authorization_id = ${deadLetterAuthorization.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(deadLetterRows[0], {
      failureCode: 'support_bundle_transfer_event_storage_key_mismatch',
      status: 'dead_lettered',
    });
    t.truthy(deadLetterRows[0].deadLetteredAt);
    const deadLetterForwardingEvent = deadLetterRows[0];

    const replayResult = await app.gql({
      query: replaySupportBundleTransferForwardingEventMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          forwardingEventId: deadLetterForwardingEvent.id,
        },
      },
    });
    const replayForwardingEvent =
      replayResult.replayCopilotSupportBundleTransferForwardingEvent;
    t.like(replayForwardingEvent, {
      attemptCount: 0,
      authorizationId: deadLetterAuthorization.id,
      eventId: 'support-bundle-forwarding-dead-letter-e2e',
      eventSource: 'object_storage_event_e2e',
      failureCode: null,
      failureMessage: null,
      status: 'queued',
    });
    t.not(replayForwardingEvent.id, deadLetterForwardingEvent.id);
    t.not(
      replayForwardingEvent.forwardingEventFingerprint,
      deadLetterForwardingEvent.forwardingEventFingerprint
    );
    t.regex(replayForwardingEvent.forwardingEventFingerprint, /^[a-f0-9]{16}$/);
    t.regex(
      replayForwardingEvent.forwardingPayloadFingerprint,
      /^[a-f0-9]{16}$/
    );
    t.truthy(replayForwardingEvent.nextAttemptAt);
    t.is(replayForwardingEvent.lastAttemptAt, null);
    t.like(replayForwardingEvent.forwardingPayload, {
      version: 'copilot-support-bundle-transfer-forwarding-payload/v1',
      replay: {
        version: 'copilot-support-bundle-transfer-forwarding-replay/v1',
        sourceFailureCode: 'support_bundle_transfer_event_storage_key_mismatch',
        sourceForwardingEventFingerprint:
          deadLetterForwardingEvent.forwardingEventFingerprint,
        sourceForwardingEventId: deadLetterForwardingEvent.id,
        sourceForwardingPayloadFingerprint:
          deadLetterForwardingEvent.forwardingPayloadFingerprint,
      },
    });

    const replayRows = await db.$queryRaw<
      Array<{
        deadLetteredAt: Date | null;
        failureCode: string | null;
        forwardingEventFingerprint: string;
        id: string;
        status: string;
      }>
    >`
      SELECT
        dead_lettered_at AS "deadLetteredAt",
        failure_code AS "failureCode",
        forwarding_event_fingerprint AS "forwardingEventFingerprint",
        id,
        status
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE authorization_id = ${deadLetterAuthorization.id}
      ORDER BY created_at ASC, id ASC
    `;
    t.is(replayRows.length, 2);
    t.deepEqual(replayRows.map(row => row.status).sort(compareTestStrings), [
      'dead_lettered',
      'queued',
    ]);
    const originalDeadLetterAfterReplay = replayRows.find(
      row => row.status === 'dead_lettered'
    );
    t.truthy(originalDeadLetterAfterReplay);
    if (originalDeadLetterAfterReplay) {
      t.like(originalDeadLetterAfterReplay, {
        failureCode: 'support_bundle_transfer_event_storage_key_mismatch',
        forwardingEventFingerprint:
          deadLetterForwardingEvent.forwardingEventFingerprint,
        id: deadLetterForwardingEvent.id,
        status: 'dead_lettered',
      });
      t.truthy(originalDeadLetterAfterReplay.deadLetteredAt);
    }
    const queuedReplayRow = replayRows.find(row => row.status === 'queued');
    t.truthy(queuedReplayRow);
    if (queuedReplayRow) {
      t.like(queuedReplayRow, {
        failureCode: null,
        forwardingEventFingerprint:
          replayForwardingEvent.forwardingEventFingerprint,
        id: replayForwardingEvent.id,
        status: 'queued',
      });
      t.is(queuedReplayRow.deadLetteredAt, null);
    }

    const listResult = await app.gql({
      query: listSupportBundlesQuery,
      variables: {
        workspaceId: workspace.id,
        limit: 3,
      },
    });
    const listedBundle = listResult.currentUser.copilot.supportBundles.find(
      (item: { id: string }) => item.id === bundle.id
    );
    t.truthy(listedBundle);
    if (!listedBundle) {
      return;
    }
    t.is(listedBundle.transferForwardingEventCount, 3);
    t.is(listedBundle.transferForwardingEvents.length, 3);
    const listedRetryForwardingEvent =
      listedBundle.transferForwardingEvents.find(
        (event: { eventId: string | null }) =>
          event.eventId === 'support-bundle-forwarding-retry-e2e'
      );
    const listedDeadLetterForwardingEvent =
      listedBundle.transferForwardingEvents.find(
        (event: { eventId: string | null; status: string }) =>
          event.eventId === 'support-bundle-forwarding-dead-letter-e2e' &&
          event.status === 'dead_lettered'
      );
    t.truthy(listedRetryForwardingEvent);
    t.truthy(listedDeadLetterForwardingEvent);
    if (!listedRetryForwardingEvent || !listedDeadLetterForwardingEvent) {
      return;
    }
    const listedReplayForwardingEvent =
      listedBundle.transferForwardingEvents.find(
        (event: { id: string | null }) => event.id === replayForwardingEvent.id
      );
    t.truthy(listedReplayForwardingEvent);
    if (!listedReplayForwardingEvent) {
      return;
    }
    t.like(listedReplayForwardingEvent, {
      attemptCount: 0,
      authorizationId: deadLetterAuthorization.id,
      eventId: 'support-bundle-forwarding-dead-letter-e2e',
      eventSource: 'object_storage_event_e2e',
      failureCode: null,
      failureMessage: null,
      status: 'queued',
    });
    t.like(listedReplayForwardingEvent.forwardingPayload, {
      version: 'copilot-support-bundle-transfer-forwarding-payload/v1',
      replay: {
        sourceForwardingEventId: listedDeadLetterForwardingEvent.id,
      },
    });
    t.like(listedRetryForwardingEvent, {
      attemptCount: 2,
      authorizationId: authorization.id,
      eventId: 'support-bundle-forwarding-retry-e2e',
      eventSource: 'aws:s3',
      failureCode: null,
      failureMessage: null,
      status: 'forwarded',
    });
    t.regex(
      listedRetryForwardingEvent.forwardingEventFingerprint,
      /^[a-f0-9]{16}$/
    );
    t.regex(
      listedRetryForwardingEvent.forwardingPayloadFingerprint,
      /^[a-f0-9]{16}$/
    );
    t.regex(
      listedRetryForwardingEvent.providerSignatureEvidenceFingerprint ?? '',
      /^[a-f0-9]{16}$/
    );
    t.regex(
      listedRetryForwardingEvent.forwardedTransferEventFingerprint ?? '',
      /^[a-f0-9]{16}$/
    );
    t.like(listedRetryForwardingEvent.forwardingPayload, {
      version: 'copilot-support-bundle-transfer-forwarding-payload/v1',
    });
    t.like(listedDeadLetterForwardingEvent, {
      attemptCount: 1,
      authorizationId: deadLetterAuthorization.id,
      eventId: 'support-bundle-forwarding-dead-letter-e2e',
      eventSource: 'object_storage_event_e2e',
      failureCode: 'support_bundle_transfer_event_storage_key_mismatch',
      status: 'dead_lettered',
    });
    t.truthy(listedDeadLetterForwardingEvent.deadLetteredAt);
    t.is(
      listedDeadLetterForwardingEvent.forwardedTransferEventFingerprint,
      null
    );
    t.like(listedDeadLetterForwardingEvent.forwardingPayload, {
      version: 'copilot-support-bundle-transfer-forwarding-payload/v1',
    });

    const deadLetterFilteredListResult = await app.gql({
      query: listSupportBundlesQuery,
      variables: {
        workspaceId: workspace.id,
        limit: 3,
        filter: {
          transferForwardingStatus: 'dead_lettered',
        },
      },
    });
    t.deepEqual(
      deadLetterFilteredListResult.currentUser.copilot.supportBundles.map(
        (item: { id: string }) => item.id
      ),
      [bundle.id]
    );

    const forwardingLocatorFilteredListResult = await app.gql({
      query: listSupportBundlesQuery,
      variables: {
        workspaceId: workspace.id,
        limit: 3,
        filter: {
          query: listedRetryForwardingEvent.forwardingEventFingerprint,
        },
      },
    });
    t.deepEqual(
      forwardingLocatorFilteredListResult.currentUser.copilot.supportBundles.map(
        (item: { id: string }) => item.id
      ),
      [bundle.id]
    );

    const missingForwardingFilteredListResult = await app.gql({
      query: listSupportBundlesQuery,
      variables: {
        workspaceId: workspace.id,
        limit: 3,
        filter: {
          transferForwardingStatus: 'processing',
          query: 'missing-support-bundle-forwarding-locator',
        },
      },
    });
    t.deepEqual(
      missingForwardingFilteredListResult.currentUser.copilot.supportBundles,
      []
    );

    const getResult = await app.gql({
      query: getSupportBundleQuery,
      variables: {
        workspaceId: workspace.id,
        id: bundle.id,
      },
    });
    t.is(
      getResult.currentUser.copilot.supportBundle.transferForwardingEventCount,
      3
    );
    t.deepEqual(
      getResult.currentUser.copilot.supportBundle.transferForwardingEvents
        .map((event: { id: string | null }) => event.id)
        .sort(compareTestStrings),
      [
        listedDeadLetterForwardingEvent.id,
        listedRetryForwardingEvent.id,
        replayForwardingEvent.id,
      ].sort(compareTestStrings)
    );

    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_transfer_forwarding_events
        SET status = ${'forwarded'}
        WHERE authorization_id = ${deadLetterAuthorization.id}
      `,
      {
        message: /ai_support_bundle_transfer_forwarding_events_state_check/,
      }
    );

    await t.throwsAsync(
      db.$executeRaw`
        UPDATE ai_support_bundle_transfer_forwarding_events
        SET forwarding_payload = forwarding_payload || ${JSON.stringify({
          tampered: true,
        })}::jsonb
        WHERE authorization_id = ${authorization.id}
      `,
      {
        message:
          /Cannot mutate support bundle transfer forwarding event evidence/,
      }
    );
    await t.throwsAsync(
      db.$transaction(async tx => {
        await tx.$executeRaw`
          DELETE FROM ai_support_bundle_transfer_forwarding_events
          WHERE authorization_id = ${authorization.id}
        `;
        await tx.$executeRaw`
          SET CONSTRAINTS "zz_ai_support_bundle_tfwd_delete_check" IMMEDIATE
        `;
      }),
      {
        message:
          /Cannot delete support bundle transfer forwarding event while authorization exists/,
      }
    );
  } finally {
    restoreStorageFactory();
  }
});

test('support bundle transfer forwarding replay fails closed when source row snapshot changes', async t => {
  const { app, db } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const createResult = await app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    });
    const bundle = createResult.createCopilotSupportBundle;
    const authorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const authorization =
      authorizationResult.authorizeCopilotSupportBundleDownload;

    await app
      .POST(supportBundleTransferEventPath)
      .set('x-access-token', createSupportBundleTransferEventAccessToken(app))
      .send({
        authorizationId: authorization.id,
        eventId: 'support-bundle-forwarding-replay-source-drift-e2e',
        eventSource: 'object_storage_event_e2e',
        storageKey: `${bundle.archiveStorageKey}.drift`,
        artifactByteSize: bundle.archiveByteSize,
        artifactFingerprint: bundle.archiveFingerprint,
        transferredAt: new Date().toISOString(),
      })
      .expect(400)
      .expect(res => {
        t.is(
          res.body.message,
          'Support bundle transfer event storage key mismatch'
        );
      });

    const supportBundleModel = app.get(Models).copilotSupportBundle;
    const deadLetterRows = await db.$queryRaw<
      Array<{
        id: string;
        status: string;
      }>
    >`
      SELECT id, status
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE authorization_id = ${authorization.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(deadLetterRows[0], {
      status: 'dead_lettered',
    });
    const sourceEvent = await (
      supportBundleModel as unknown as {
        getDirectDownloadTransferForwardingEvent(id: string): Promise<unknown>;
      }
    ).getDirectDownloadTransferForwardingEvent(deadLetterRows[0].id);
    t.truthy(sourceEvent);

    await db.$executeRaw`
      UPDATE ai_support_bundle_transfer_forwarding_events
      SET updated_at = updated_at + interval '1 second'
      WHERE id = ${deadLetterRows[0].id}
    `;

    await t.throwsAsync(
      (
        supportBundleModel as unknown as {
          createDeadLetteredDirectDownloadTransferForwardingReplayEvent(input: {
            actorId: string;
            sourceEvent: unknown;
            workspaceId: string;
          }): Promise<unknown>;
        }
      ).createDeadLetteredDirectDownloadTransferForwardingReplayEvent({
        actorId: t.context.owner.id,
        sourceEvent,
        workspaceId: workspace.id,
      }),
      {
        message:
          /Support bundle transfer forwarding replay event could not be queued because its source forwarding event state changed/,
      }
    );

    const replayRows = await db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE authorization_id = ${authorization.id}
        AND status = ${'queued'}
    `;
    t.is(replayRows[0]?.count, 0);
  } finally {
    restoreStorageFactory();
  }
});

test('verifies production object-storage webhooks before durable transfer forwarding', async t => {
  const { app, cronJobs, db } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const createResult = await app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    });
    const bundle = createResult.createCopilotSupportBundle;
    const authorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const authorization =
      authorizationResult.authorizeCopilotSupportBundleDownload;
    const transferredAt = new Date();
    const webhookPayload = {
      provider: 's3_object_created',
      authorizationId: authorization.id,
      artifactFingerprint: bundle.archiveFingerprint,
      event: {
        Records: [
          {
            eventName: 'ObjectCreated:Put',
            eventSource: 'aws:s3',
            eventTime: transferredAt.toISOString(),
            responseElements: {
              'x-amz-request-id': 'support-bundle-s3-webhook-e2e-event',
            },
            s3: {
              object: {
                key: encodeURIComponent(bundle.archiveStorageKey),
                size: bundle.archiveByteSize,
              },
            },
          },
        ],
      },
    };
    const signedWebhook =
      supportBundleObjectStorageWebhookSignature(webhookPayload);

    await app
      .POST(supportBundleObjectStorageWebhookPath)
      .set('content-type', 'application/json')
      .set('x-localmind-webhook-signature', 'sha256=' + '0'.repeat(64))
      .send(signedWebhook.body)
      .expect(400)
      .expect(res => {
        t.is(
          res.body.message,
          'Invalid support bundle object storage webhook signature'
        );
      });
    const selfReportedWebhookPayload = {
      ...webhookPayload,
      providerSignatureEvidence: supportBundleProviderSignatureEvidence(
        'payload-self-reported-webhook-evidence'
      ),
    };
    const signedSelfReportedWebhook =
      supportBundleObjectStorageWebhookSignature(selfReportedWebhookPayload);
    await app
      .POST(supportBundleObjectStorageWebhookPath)
      .set('content-type', 'application/json')
      .set('x-localmind-webhook-signature', signedSelfReportedWebhook.signature)
      .send(signedSelfReportedWebhook.body)
      .expect(400)
      .expect(res => {
        t.is(
          res.body.message,
          'Support bundle transfer event provider signature evidence must be supplied by verified forwarding headers'
        );
      });

    const response = await app
      .POST(supportBundleObjectStorageWebhookPath)
      .set('content-type', 'application/json')
      .set('x-localmind-webhook-signature', signedWebhook.signature)
      .set('x-localmind-webhook-key-id', 'support-bundle-s3-webhook-key-e2e')
      .send(signedWebhook.body)
      .expect(202);
    t.like(response.body, {
      authorizationId: authorization.id,
      eventId: 'support-bundle-s3-webhook-e2e-event',
      eventSource: 'aws:s3',
      status: 'queued',
    });
    t.regex(response.body.forwardingEventFingerprint, /^[a-f0-9]{16}$/);
    t.regex(response.body.forwardingPayloadFingerprint, /^[a-f0-9]{16}$/);
    t.regex(
      response.body.providerSignatureEvidenceFingerprint,
      /^[a-f0-9]{16}$/
    );

    const authorizationRows = await db.$queryRaw<
      Array<{ downloadedAt: Date | null; status: string }>
    >`
      SELECT downloaded_at AS "downloadedAt", status
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${authorization.id}
    `;
    t.deepEqual(authorizationRows, [
      {
        downloadedAt: null,
        status: 'authorized',
      },
    ]);

    const forwardingRows = await db.$queryRaw<
      Array<{
        forwardingPayload: Record<string, unknown>;
        providerSignatureEvidenceFingerprint: string | null;
        status: string;
      }>
    >`
      SELECT
        forwarding_payload AS "forwardingPayload",
        provider_signature_evidence_fingerprint AS "providerSignatureEvidenceFingerprint",
        status
      FROM ai_support_bundle_transfer_forwarding_events
      WHERE id = ${response.body.id}
    `;
    t.is(forwardingRows[0].status, 'queued');
    t.is(
      forwardingRows[0].providerSignatureEvidenceFingerprint,
      response.body.providerSignatureEvidenceFingerprint
    );
    t.like(forwardingRows[0].forwardingPayload, {
      event: {
        notificationAuthEvidence: {
          policy: 'internal_access_token',
          status: 'verified',
          method: 'x-access-token',
          providerSignatureEvidence: {
            provider: 'aws_s3',
            status: 'verified_by_upstream',
            verifier: 'support-bundle-s3-webhook-e2e-verifier',
            keyId: 'support-bundle-s3-webhook-key-e2e',
            algorithm: 'hmac-sha256',
            policy: 'aws-s3-event-notification',
          },
        },
      },
    });
    const forwardedPayloadEvent = forwardingRows[0].forwardingPayload
      .event as Record<string, unknown>;
    const forwardedNotificationAuthEvidence =
      forwardedPayloadEvent.notificationAuthEvidence as Record<string, unknown>;
    const forwardedProviderSignatureEvidence =
      forwardedNotificationAuthEvidence.providerSignatureEvidence as Record<
        string,
        unknown
      >;
    t.regex(
      String(forwardedProviderSignatureEvidence.signatureFingerprint),
      /^[a-f0-9]{64}$/
    );

    const processing =
      await cronJobs.processSupportBundleTransferForwardingEvents({
        limit: 10,
      });
    t.is(processing, JOB_SIGNAL.Done);

    const forwardedRows = await db.$queryRaw<
      Array<{
        forwardedTransferEventFingerprint: string | null;
        status: string;
        transferEventCount: number;
      }>
    >`
      SELECT
        forwarding.forwarded_transfer_event_fingerprint AS "forwardedTransferEventFingerprint",
        forwarding.status,
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_transfer_events transfer_event
          WHERE transfer_event.authorization_id = forwarding.authorization_id
        ) AS "transferEventCount"
      FROM ai_support_bundle_transfer_forwarding_events forwarding
      WHERE forwarding.id = ${response.body.id}
    `;
    t.like(forwardedRows[0], {
      status: 'forwarded',
      transferEventCount: 1,
    });
    t.regex(
      forwardedRows[0].forwardedTransferEventFingerprint ?? '',
      /^[a-f0-9]{16}$/
    );

    const downloadedRows = await db.$queryRaw<
      Array<{ downloadedAt: Date | null; status: string }>
    >`
      SELECT downloaded_at AS "downloadedAt", status
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${authorization.id}
    `;
    t.is(downloadedRows[0].status, 'downloaded');
    t.truthy(downloadedRows[0].downloadedAt);

    const auditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'downloaded'}
      AND metadata->>'authorizationId' = ${authorization.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(auditRows[0].metadata, {
      authorizationId: authorization.id,
      clientAcknowledged: false,
      deliveryMethod: 'object_storage_signed_url',
      providerTransferEvent: true,
      serverVerified: true,
      transferEventId: 'support-bundle-s3-webhook-e2e-event',
      transferEventSource: 'aws:s3',
      notificationAuthEvidence: {
        policy: 'internal_access_token',
        status: 'verified',
        method: 'x-access-token',
        providerSignatureEvidence: {
          provider: 'aws_s3',
          status: 'verified_by_upstream',
          verifier: 'support-bundle-s3-webhook-e2e-verifier',
          keyId: 'support-bundle-s3-webhook-key-e2e',
          algorithm: 'hmac-sha256',
          policy: 'aws-s3-event-notification',
        },
      },
    });
  } finally {
    restoreStorageFactory();
  }
});

test('support bundle transfer forwarding ignores stale worker leases before verification', async t => {
  const { app, db } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const createResult = await app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    });
    const bundle = createResult.createCopilotSupportBundle;
    const authorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const authorization =
      authorizationResult.authorizeCopilotSupportBundleDownload;
    const supportBundleModel = app.get(Models).copilotSupportBundle;
    const forwardingEvent =
      await supportBundleModel.enqueueDirectDownloadTransferForwardingEvent({
        transferEvent: {
          authorizationId: authorization.id,
          eventId: 'support-bundle-forwarding-stale-lease-e2e',
          eventSource: 'object_storage_event_e2e',
          storageKey: bundle.archiveStorageKey,
          notificationAuthEvidence: {
            policy: 'internal_access_token',
            status: 'verified',
            method: 'x-access-token',
          },
          artifactByteSize: bundle.archiveByteSize,
          artifactFingerprint: bundle.archiveFingerprint,
          transferredAt: new Date(),
        },
      });

    const leasedOnce = await (
      supportBundleModel as unknown as {
        leaseDirectDownloadTransferForwardingEvents(input: {
          id?: string;
          limit: number;
        }): Promise<(typeof forwardingEvent)[]>;
      }
    ).leaseDirectDownloadTransferForwardingEvents({
      id: forwardingEvent.id,
      limit: 1,
    });
    const staleEvent = leasedOnce[0];
    t.truthy(staleEvent);
    await db.$executeRaw`
      UPDATE ai_support_bundle_transfer_forwarding_events
      SET worker_lease_expires_at = GREATEST(
        created_at,
        CURRENT_TIMESTAMP - interval '1 second'
      )
      WHERE id = ${forwardingEvent.id}
    `;
    const leasedAgain = await (
      supportBundleModel as unknown as {
        leaseDirectDownloadTransferForwardingEvents(input: {
          id?: string;
          limit: number;
        }): Promise<(typeof forwardingEvent)[]>;
      }
    ).leaseDirectDownloadTransferForwardingEvents({
      id: forwardingEvent.id,
      limit: 1,
    });
    const currentEvent = leasedAgain[0];
    t.truthy(currentEvent);
    t.not(currentEvent.workerLeaseId, staleEvent.workerLeaseId);

    const staleResult = await (
      supportBundleModel as unknown as {
        processLeasedDirectDownloadTransferForwardingEvent(
          event: typeof forwardingEvent
        ): Promise<{
          event: typeof forwardingEvent;
          authorization: unknown;
        }>;
      }
    ).processLeasedDirectDownloadTransferForwardingEvent(staleEvent);
    t.is(staleResult.event.status, 'processing');
    t.is(staleResult.event.workerLeaseId, currentEvent.workerLeaseId);
    t.is(staleResult.event.forwardedTransferEventFingerprint, null);
    t.is(staleResult.authorization, null);

    const unchangedAuthorizationRows = await db.$queryRaw<
      Array<{ status: string; downloadedAt: Date | null }>
    >`
      SELECT status, downloaded_at AS "downloadedAt"
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${authorization.id}
    `;
    t.deepEqual(unchangedAuthorizationRows, [
      {
        status: 'authorized',
        downloadedAt: null,
      },
    ]);
    const transferRowsBeforeCurrent = await db.$queryRaw<
      Array<{ count: number }>
    >`
      SELECT COUNT(*)::int AS count
      FROM ai_support_bundle_transfer_events
      WHERE authorization_id = ${authorization.id}
    `;
    t.is(transferRowsBeforeCurrent[0]?.count, 0);

    const currentResult = await (
      supportBundleModel as unknown as {
        processLeasedDirectDownloadTransferForwardingEvent(
          event: typeof forwardingEvent
        ): Promise<{
          event: typeof forwardingEvent;
          authorization: { status: string } | null;
        }>;
      }
    ).processLeasedDirectDownloadTransferForwardingEvent(currentEvent);
    t.is(currentResult.event.status, 'forwarded');
    t.regex(
      currentResult.event.forwardedTransferEventFingerprint ?? '',
      /^[a-f0-9]{16}$/
    );
    t.is(currentResult.authorization?.status, 'downloaded');
  } finally {
    restoreStorageFactory();
  }
});

test('support bundle transfer forwarding ignores stale attempt counters before terminal writes', async t => {
  const { app, db } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const createResult = await app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    });
    const bundle = createResult.createCopilotSupportBundle;
    const authorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const authorization =
      authorizationResult.authorizeCopilotSupportBundleDownload;
    const supportBundleModel = app.get(Models).copilotSupportBundle;
    const forwardingEvent =
      await supportBundleModel.enqueueDirectDownloadTransferForwardingEvent({
        transferEvent: {
          authorizationId: authorization.id,
          eventId: 'support-bundle-forwarding-stale-attempt-e2e',
          eventSource: 'object_storage_event_e2e',
          storageKey: bundle.archiveStorageKey,
          notificationAuthEvidence: {
            policy: 'internal_access_token',
            status: 'verified',
            method: 'x-access-token',
          },
          artifactByteSize: bundle.archiveByteSize,
          artifactFingerprint: bundle.archiveFingerprint,
          transferredAt: new Date(),
        },
      });

    const leased = await (
      supportBundleModel as unknown as {
        leaseDirectDownloadTransferForwardingEvents(input: {
          id?: string;
          limit: number;
        }): Promise<(typeof forwardingEvent)[]>;
      }
    ).leaseDirectDownloadTransferForwardingEvents({
      id: forwardingEvent.id,
      limit: 1,
    });
    const staleEvent = leased[0];
    t.truthy(staleEvent);
    t.is(staleEvent.attemptCount, 1);
    t.truthy(staleEvent.workerLeaseId);

    await db.$executeRaw`
      UPDATE ai_support_bundle_transfer_forwarding_events
      SET
        attempt_count = 2,
        updated_at = ${new Date()}
      WHERE id = ${forwardingEvent.id}
    `;

    const staleResult = await (
      supportBundleModel as unknown as {
        processLeasedDirectDownloadTransferForwardingEvent(
          event: typeof forwardingEvent
        ): Promise<{
          event: typeof forwardingEvent;
          authorization: unknown;
        }>;
      }
    ).processLeasedDirectDownloadTransferForwardingEvent(staleEvent);
    t.is(staleResult.event.status, 'processing');
    t.is(staleResult.event.workerLeaseId, staleEvent.workerLeaseId);
    t.is(staleResult.event.attemptCount, 2);
    t.is(staleResult.event.forwardedTransferEventFingerprint, null);
    t.is(staleResult.event.failureCode, null);
    t.is(staleResult.event.failureMessage, null);
    t.is(staleResult.authorization, null);

    const unchangedAuthorizationRows = await db.$queryRaw<
      Array<{ status: string; downloadedAt: Date | null }>
    >`
      SELECT status, downloaded_at AS "downloadedAt"
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${authorization.id}
    `;
    t.deepEqual(unchangedAuthorizationRows, [
      {
        status: 'authorized',
        downloadedAt: null,
      },
    ]);
    const transferRowsBeforeCurrent = await db.$queryRaw<
      Array<{ count: number }>
    >`
      SELECT COUNT(*)::int AS count
      FROM ai_support_bundle_transfer_events
      WHERE authorization_id = ${authorization.id}
    `;
    t.is(transferRowsBeforeCurrent[0]?.count, 0);

    const currentRows = await db.$queryRaw<Array<typeof forwardingEvent>>`
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
      WHERE id = ${forwardingEvent.id}
    `;
    const currentEvent = currentRows[0];
    t.truthy(currentEvent);
    const currentResult = await (
      supportBundleModel as unknown as {
        processLeasedDirectDownloadTransferForwardingEvent(
          event: typeof forwardingEvent
        ): Promise<{
          event: typeof forwardingEvent;
          authorization: { status: string } | null;
        }>;
      }
    ).processLeasedDirectDownloadTransferForwardingEvent(currentEvent);
    t.is(currentResult.event.status, 'forwarded');
    t.is(currentResult.event.attemptCount, 2);
    t.regex(
      currentResult.event.forwardedTransferEventFingerprint ?? '',
      /^[a-f0-9]{16}$/
    );
    t.is(currentResult.authorization?.status, 'downloaded');
  } finally {
    restoreStorageFactory();
  }
});

test('support bundle transfer forwarding forwarded terminal write fails closed when row snapshot changes', async t => {
  const { app, db } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const createResult = await app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    });
    const bundle = createResult.createCopilotSupportBundle;
    const authorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const authorization =
      authorizationResult.authorizeCopilotSupportBundleDownload;
    const supportBundleModel = app.get(Models).copilotSupportBundle;
    const forwardingEvent =
      await supportBundleModel.enqueueDirectDownloadTransferForwardingEvent({
        transferEvent: {
          authorizationId: authorization.id,
          eventId: 'support-bundle-forwarding-forwarded-snapshot-drift-e2e',
          eventSource: 'object_storage_event_e2e',
          storageKey: bundle.archiveStorageKey,
          notificationAuthEvidence: {
            policy: 'internal_access_token',
            status: 'verified',
            method: 'x-access-token',
          },
          artifactByteSize: bundle.archiveByteSize,
          artifactFingerprint: bundle.archiveFingerprint,
          transferredAt: new Date(),
        },
      });

    const leased = await (
      supportBundleModel as unknown as {
        leaseDirectDownloadTransferForwardingEvents(input: {
          id?: string;
          limit: number;
        }): Promise<(typeof forwardingEvent)[]>;
      }
    ).leaseDirectDownloadTransferForwardingEvents({
      id: forwardingEvent.id,
      limit: 1,
    });
    const staleEvent = leased[0];
    t.truthy(staleEvent);

    await db.$executeRaw`
      UPDATE ai_support_bundle_transfer_forwarding_events
      SET updated_at = updated_at + interval '1 second'
      WHERE id = ${forwardingEvent.id}
    `;

    await t.throwsAsync(
      (
        supportBundleModel as unknown as {
          markDirectDownloadTransferForwardingEventForwarded(input: {
            event: typeof forwardingEvent;
            forwardedTransferEventFingerprint: string;
          }): Promise<void>;
        }
      ).markDirectDownloadTransferForwardingEventForwarded({
        event: staleEvent,
        forwardedTransferEventFingerprint: 'a'.repeat(16),
      }),
      {
        message: /Support bundle transfer forwarding event lease changed/,
      }
    );

    const currentEvent = await (
      supportBundleModel as unknown as {
        getDirectDownloadTransferForwardingEvent(
          id: string
        ): Promise<typeof forwardingEvent | null>;
      }
    ).getDirectDownloadTransferForwardingEvent(forwardingEvent.id);
    t.truthy(currentEvent);
    t.is(currentEvent.status, 'processing');
    t.is(currentEvent.workerLeaseId, staleEvent.workerLeaseId);
    t.is(currentEvent.attemptCount, staleEvent.attemptCount);
    t.is(currentEvent.forwardedTransferEventFingerprint, null);
    t.is(currentEvent.forwardedAt, null);
    t.is(currentEvent.failureCode, null);
    t.is(currentEvent.failureMessage, null);
  } finally {
    restoreStorageFactory();
  }
});

test('support bundle transfer forwarding rolls back transfer ingestion when forwarded terminal snapshot changes', async t => {
  const { app, db } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const createResult = await app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    });
    const bundle = createResult.createCopilotSupportBundle;
    const authorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const authorization =
      authorizationResult.authorizeCopilotSupportBundleDownload;
    const supportBundleModel = app.get(Models).copilotSupportBundle;
    const forwardingEvent =
      await supportBundleModel.enqueueDirectDownloadTransferForwardingEvent({
        transferEvent: {
          authorizationId: authorization.id,
          eventId: 'support-bundle-forwarding-transactional-drift-e2e',
          eventSource: 'object_storage_event_e2e',
          storageKey: bundle.archiveStorageKey,
          notificationAuthEvidence: {
            policy: 'internal_access_token',
            status: 'verified',
            method: 'x-access-token',
          },
          artifactByteSize: bundle.archiveByteSize,
          artifactFingerprint: bundle.archiveFingerprint,
          transferredAt: new Date(),
        },
      });

    const supportBundleInternals = supportBundleModel as unknown as {
      db: PrismaClient;
      findForwardedTransferEventFingerprint(input: {
        authorizationId: string;
        eventId?: string;
        eventSource?: string;
      }): Promise<string | null>;
      getDirectDownloadTransferForwardingEvent(
        id: string
      ): Promise<typeof forwardingEvent | null>;
      leaseDirectDownloadTransferForwardingEvents(input: {
        id?: string;
        limit: number;
      }): Promise<(typeof forwardingEvent)[]>;
      processLeasedDirectDownloadTransferForwardingEvent(
        event: typeof forwardingEvent
      ): Promise<{
        event: typeof forwardingEvent;
        authorization: unknown;
      }>;
    };
    const leased =
      await supportBundleInternals.leaseDirectDownloadTransferForwardingEvents({
        id: forwardingEvent.id,
        limit: 1,
      });
    const staleEvent = leased[0];
    t.truthy(staleEvent);

    const originalFind =
      supportBundleInternals.findForwardedTransferEventFingerprint.bind(
        supportBundleModel
      );
    supportBundleInternals.findForwardedTransferEventFingerprint =
      async input => {
        await supportBundleInternals.db.$executeRaw`
          UPDATE ai_support_bundle_transfer_forwarding_events
          SET updated_at = updated_at + interval '1 second'
          WHERE id = ${forwardingEvent.id}
        `;
        return await originalFind(input);
      };
    try {
      await t.throwsAsync(
        supportBundleInternals.processLeasedDirectDownloadTransferForwardingEvent(
          staleEvent
        ),
        {
          message: /Support bundle transfer forwarding event lease changed/,
        }
      );
    } finally {
      supportBundleInternals.findForwardedTransferEventFingerprint =
        originalFind;
    }

    const currentEvent =
      await supportBundleInternals.getDirectDownloadTransferForwardingEvent(
        forwardingEvent.id
      );
    t.truthy(currentEvent);
    t.is(currentEvent.status, 'processing');
    t.is(currentEvent.workerLeaseId, staleEvent.workerLeaseId);
    t.is(currentEvent.forwardedTransferEventFingerprint, null);
    t.is(currentEvent.forwardedAt, null);
    t.is(currentEvent.failureCode, null);
    t.is(currentEvent.failureMessage, null);

    const authorizationRows = await db.$queryRaw<
      Array<{ downloadedAt: Date | null; status: string }>
    >`
      SELECT status, downloaded_at AS "downloadedAt"
      FROM ai_support_bundle_download_authorizations
      WHERE id = ${authorization.id}
    `;
    t.deepEqual(authorizationRows, [
      {
        downloadedAt: null,
        status: 'authorized',
      },
    ]);
    const evidenceRows = await db.$queryRaw<
      Array<{ downloadedAuditCount: number; transferEventCount: number }>
    >`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_transfer_events event
          WHERE event.authorization_id = ${authorization.id}
        ) AS "transferEventCount",
        (
          SELECT COUNT(*)::int
          FROM ai_support_bundle_audit_events audit
          WHERE audit.bundle_id = ${bundle.id}
            AND audit.event_type = ${'downloaded'}
            AND audit.metadata->>${'authorizationId'} = ${authorization.id}
        ) AS "downloadedAuditCount"
    `;
    t.deepEqual(evidenceRows, [
      {
        downloadedAuditCount: 0,
        transferEventCount: 0,
      },
    ]);
  } finally {
    restoreStorageFactory();
  }
});

test('support bundle transfer forwarding failed terminal write fails closed when row snapshot changes', async t => {
  const { app, db } = t.context;
  const restoreStorageFactory = installSignedUrlStorageMock(app);

  try {
    const workspace = await createWorkspace(app);
    const createResult = await app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    });
    const bundle = createResult.createCopilotSupportBundle;
    const authorizationResult = await app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
          artifactKind: 'archive_json',
        },
      },
    });
    const authorization =
      authorizationResult.authorizeCopilotSupportBundleDownload;
    const supportBundleModel = app.get(Models).copilotSupportBundle;
    const forwardingEvent =
      await supportBundleModel.enqueueDirectDownloadTransferForwardingEvent({
        transferEvent: {
          authorizationId: authorization.id,
          eventId: 'support-bundle-forwarding-failed-snapshot-drift-e2e',
          eventSource: 'object_storage_event_e2e',
          storageKey: bundle.archiveStorageKey,
          notificationAuthEvidence: {
            policy: 'internal_access_token',
            status: 'verified',
            method: 'x-access-token',
          },
          artifactByteSize: bundle.archiveByteSize,
          artifactFingerprint: bundle.archiveFingerprint,
          transferredAt: new Date(),
        },
      });

    const leased = await (
      supportBundleModel as unknown as {
        leaseDirectDownloadTransferForwardingEvents(input: {
          id?: string;
          limit: number;
        }): Promise<(typeof forwardingEvent)[]>;
      }
    ).leaseDirectDownloadTransferForwardingEvents({
      id: forwardingEvent.id,
      limit: 1,
    });
    const staleEvent = leased[0];
    t.truthy(staleEvent);

    await db.$executeRaw`
      UPDATE ai_support_bundle_transfer_forwarding_events
      SET updated_at = updated_at + interval '1 second'
      WHERE id = ${forwardingEvent.id}
    `;

    await t.throwsAsync(
      (
        supportBundleModel as unknown as {
          markDirectDownloadTransferForwardingEventFailed(input: {
            event: typeof forwardingEvent;
            error: unknown;
          }): Promise<void>;
        }
      ).markDirectDownloadTransferForwardingEventFailed({
        event: staleEvent,
        error: new Error('support bundle transfer forwarding drift test'),
      }),
      {
        message: /Support bundle transfer forwarding event lease changed/,
      }
    );

    const currentEvent = await (
      supportBundleModel as unknown as {
        getDirectDownloadTransferForwardingEvent(
          id: string
        ): Promise<typeof forwardingEvent | null>;
      }
    ).getDirectDownloadTransferForwardingEvent(forwardingEvent.id);
    t.truthy(currentEvent);
    t.is(currentEvent.status, 'processing');
    t.is(currentEvent.workerLeaseId, staleEvent.workerLeaseId);
    t.is(currentEvent.attemptCount, staleEvent.attemptCount);
    t.is(currentEvent.nextAttemptAt, null);
    t.is(currentEvent.deadLetteredAt, null);
    t.is(currentEvent.failureCode, null);
    t.is(currentEvent.failureMessage, null);
  } finally {
    restoreStorageFactory();
  }
});

test('rejects support bundle create/list/read for a workspace without access', async t => {
  const { app } = t.context;
  const workspace = await createWorkspace(app);
  const createResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
      },
    },
  });
  const bundleId = createResult.createCopilotSupportBundle.id;
  const outsider = await app.createUser();
  await app.login(outsider);
  await app.switchUser(outsider);

  await t.throwsAsync(
    app.gql({
      query: createSupportBundleMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    })
  );
  await t.throwsAsync(
    app.gql({
      query: listSupportBundlesQuery,
      variables: {
        workspaceId: workspace.id,
        limit: 3,
      },
    })
  );
  await t.throwsAsync(
    app.gql({
      query: getSupportBundleQuery,
      variables: {
        workspaceId: workspace.id,
        id: bundleId,
      },
    })
  );
  await t.throwsAsync(
    app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId,
        },
      },
    })
  );
  await t.throwsAsync(
    app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
        },
      },
    })
  );
});

test('expires due support bundles, revokes downloads, and records cleanup audit', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const authorization = await createDownloadAuthorizationFixture({
    db,
    bundle,
  });
  const config = app.get(Config);
  const storageProvider = app
    .get(StorageProviderFactory)
    .create(config.storages.blob.storage);
  t.truthy(await storageProvider.head(bundle.archiveStorageKey));

  const cleanupResult = await app.gql({
    query: cleanupSupportBundleRetentionMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        limit: 5,
      },
    },
  });
  const cleanup = cleanupResult.cleanupCopilotSupportBundleRetention;

  t.like(cleanup, {
    actorId: owner.id,
    archiveObjectCleanupFailedCount: 0,
    archiveObjectCleanupRecoveredCount: 0,
    archiveObjectCleanupRetryCount: 0,
    expiredAuthorizationCount: 1,
    expiredBundleCount: 1,
    workspaceId: workspace.id,
  });
  t.is(cleanup.cleanupFingerprint.length, 16);
  t.is(cleanup.expiredBundles.length, 1);
  t.like(cleanup.expiredBundles[0], {
    id: bundle.id,
    retentionStatus: 'expired',
    status: 'expired',
    workspaceId: workspace.id,
  });
  t.is(cleanup.expiredBundles[0].manifestJson.retention.status, 'expired');
  t.is(
    cleanup.expiredBundles[0].manifestFingerprint,
    supportBundleFingerprint(
      cleanup.expiredBundles[0].manifestJson as CopilotSupportBundleManifest
    )
  );
  t.not(
    cleanup.expiredBundles[0].manifestFingerprint,
    bundle.manifestFingerprint
  );

  const rows = await db.$queryRaw<
    Array<{
      manifestFingerprint: string;
      manifestJson: CopilotSupportBundleManifest;
      retentionStatus: string;
      status: string;
    }>
  >`
    SELECT
      manifest_fingerprint AS "manifestFingerprint",
      manifest_json AS "manifestJson",
      retention_status AS "retentionStatus",
      status
    FROM ai_support_bundle_requests
    WHERE id = ${bundle.id}
  `;
  t.is(rows.length, 1);
  t.is(rows[0].status, 'expired');
  t.is(rows[0].retentionStatus, 'expired');
  t.is(rows[0].manifestJson.retention.status, 'expired');
  t.is(
    rows[0].manifestFingerprint,
    cleanup.expiredBundles[0].manifestFingerprint
  );
  t.is(await storageProvider.head(bundle.archiveStorageKey), undefined);

  const authorizationRows = await db.$queryRaw<Array<{ status: string }>>`
    SELECT status
    FROM ai_support_bundle_download_authorizations
    WHERE id = ${authorization.id}
  `;
  t.is(authorizationRows[0].status, 'expired');

  await t.throwsAsync(
    app.gql({
      query: authorizeSupportBundleDownloadMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          bundleId: bundle.id,
        },
      },
    })
  );

  const auditRows = await db.$queryRaw<
    Array<{ eventType: string; metadata: Record<string, unknown> }>
  >`
    SELECT
      event_type AS "eventType",
      metadata
    FROM ai_support_bundle_audit_events
    WHERE bundle_id = ${bundle.id}
    ORDER BY created_at ASC
  `;
  t.deepEqual(auditRows.map(row => row.eventType).slice(0, 3), [
    'created',
    'archive_created',
    'download_authorized',
  ]);
  const expirationAudit = auditRows.find(
    row =>
      row.eventType === 'download_authorized' &&
      row.metadata.authorizationExpired === true
  );
  const retentionAudit = auditRows.find(
    row => row.eventType === 'retention_expired'
  );
  t.truthy(expirationAudit);
  t.truthy(retentionAudit);
  t.like(expirationAudit?.metadata, {
    authorizationExpired: true,
    authorizationId: authorization.id,
    authorizationFingerprint: authorization.authorizationFingerprint,
    cleanupFingerprint: cleanup.cleanupFingerprint,
    cleanupScope: 'retention_cleanup',
    previousStatus: 'authorized',
    status: 'expired',
  });
  t.like(retentionAudit?.metadata, {
    archiveObjectCleanupStatus: 'deleted',
    archiveStorageKey: bundle.archiveStorageKey,
    cleanupFingerprint: cleanup.cleanupFingerprint,
    expiredAuthorizationCount: 1,
    manifestObjectRewriteStatus: 'written',
    manifestStorageKey: bundle.manifestStorageKey,
    retentionStatus: 'expired',
  });

  const secondCleanupResult = await app.gql({
    query: cleanupSupportBundleRetentionMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        limit: 5,
      },
    },
  });
  t.is(
    secondCleanupResult.cleanupCopilotSupportBundleRetention.expiredBundleCount,
    0
  );
  t.is(
    secondCleanupResult.cleanupCopilotSupportBundleRetention
      .expiredAuthorizationCount,
    0
  );
});

test('retention cleanup skips stale bundle snapshots before expiration update', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const authorization = await createDownloadAuthorizationFixture({
    db,
    bundle,
  });

  const originalQueryRaw = db.$queryRaw.bind(db);
  let driftedBeforeExpirationUpdate = false;
  db.$queryRaw = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const sql = strings.join('?');
    if (
      !driftedBeforeExpirationUpdate &&
      sql.includes('UPDATE ai_support_bundle_requests')
    ) {
      driftedBeforeExpirationUpdate = true;
      await db.$executeRaw`
        UPDATE ai_support_bundle_requests
        SET updated_at = updated_at + interval '1 second'
        WHERE id = ${bundle.id}
      `;
    }
    return await originalQueryRaw(strings, ...values);
  }) as typeof db.$queryRaw;

  try {
    const cleanupResult = await app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          limit: 5,
        },
      },
    });
    t.like(cleanupResult.cleanupCopilotSupportBundleRetention, {
      expiredAuthorizationCount: 0,
      expiredBundleCount: 0,
      workspaceId: workspace.id,
    });
  } finally {
    db.$queryRaw = originalQueryRaw as typeof db.$queryRaw;
  }
  t.true(driftedBeforeExpirationUpdate);

  const rows = await db.$queryRaw<
    Array<{
      authorizationStatus: string;
      expiredAuditCount: number;
      manifestFingerprint: string;
      retentionAuditCount: number;
      retentionStatus: string;
      status: string;
    }>
  >`
    SELECT
      b.status,
      b.retention_status AS "retentionStatus",
      b.manifest_fingerprint AS "manifestFingerprint",
      a.status AS "authorizationStatus",
      (
        SELECT COUNT(*)::int
        FROM ai_support_bundle_audit_events e
        WHERE e.bundle_id = b.id
          AND e.event_type = ${'retention_expired'}
      ) AS "retentionAuditCount",
      (
        SELECT COUNT(*)::int
        FROM ai_support_bundle_audit_events e
        WHERE e.bundle_id = b.id
          AND e.event_type = ${'download_authorized'}
          AND e.metadata->'authorizationExpired' = 'true'::jsonb
      ) AS "expiredAuditCount"
    FROM ai_support_bundle_requests b
    JOIN ai_support_bundle_download_authorizations a
      ON a.bundle_id = b.id
    WHERE b.id = ${bundle.id}
      AND a.id = ${authorization.id}
  `;
  t.deepEqual(rows, [
    {
      authorizationStatus: 'authorized',
      expiredAuditCount: 0,
      manifestFingerprint: bundle.manifestFingerprint,
      retentionAuditCount: 0,
      retentionStatus: 'active',
      status: 'ready',
    },
  ]);
});

test('scheduled cleanup expires stale support bundle download authorizations without expiring bundles', async t => {
  const { app, cronJobs, db } = t.context;
  const workspace = await createWorkspace(app);
  const createResult = await app.gql({
    query: createSupportBundleMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
      },
    },
  });
  const bundle = createResult.createCopilotSupportBundle;
  const expiredAuthorization = await createDownloadAuthorizationFixture({
    db,
    bundle,
    artifactKind: 'manifest_json',
    expiresAt: new Date(Date.now() - 60_000),
  });
  const activeAuthorizationResult = await app.gql({
    query: authorizeSupportBundleDownloadMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        bundleId: bundle.id,
        artifactKind: 'archive_json',
      },
    },
  });
  const activeAuthorization =
    activeAuthorizationResult.authorizeCopilotSupportBundleDownload;

  const signal = await cronJobs.cleanupSupportBundleDownloadAuthorizations({
    limit: 5,
  });
  t.is(signal, JOB_SIGNAL.Done);

  const authorizationRows = await db.$queryRaw<
    Array<{ id: string; status: string }>
  >`
    SELECT id, status
    FROM ai_support_bundle_download_authorizations
    WHERE id IN (${expiredAuthorization.id}, ${activeAuthorization.id})
    ORDER BY id ASC
  `;
  t.deepEqual(
    Object.fromEntries(authorizationRows.map(row => [row.id, row.status])),
    {
      [activeAuthorization.id]: 'authorized',
      [expiredAuthorization.id]: 'expired',
    }
  );

  const bundleRows = await db.$queryRaw<
    Array<{ retentionStatus: string; status: string }>
  >`
    SELECT retention_status AS "retentionStatus", status
    FROM ai_support_bundle_requests
    WHERE id = ${bundle.id}
  `;
  t.deepEqual(bundleRows, [
    {
      retentionStatus: 'active',
      status: 'ready',
    },
  ]);

  const auditRows = await db.$queryRaw<
    Array<{ metadata: Record<string, unknown> }>
  >`
    SELECT metadata
    FROM ai_support_bundle_audit_events
    WHERE bundle_id = ${bundle.id}
      AND event_type = ${'download_authorized'}
      AND metadata->>'authorizationExpired' = ${'true'}
    ORDER BY created_at DESC, id DESC
  `;
  t.is(auditRows.length, 1);
  t.like(auditRows[0].metadata, {
    authorizationExpired: true,
    authorizationId: expiredAuthorization.id,
    authorizationFingerprint: expiredAuthorization.authorizationFingerprint,
    artifactKind: 'manifest_json',
    artifactFingerprint: bundle.manifestFingerprint,
    cleanupActorId: 'system_download_authorization_cleanup_worker',
    cleanupScope: 'scheduled_worker',
    previousStatus: 'authorized',
    status: 'expired',
  });
  t.is(typeof auditRows[0].metadata.cleanupFingerprint, 'string');
  t.is(typeof auditRows[0].metadata.cleanedAt, 'string');

  const noOpSignal = await cronJobs.cleanupSupportBundleDownloadAuthorizations({
    limit: 5,
  });
  t.is(noOpSignal, JOB_SIGNAL.Done);
});

test('retention cleanup records manifest object rewrite failure without rolling back expiration', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const factory = app.get(StorageProviderFactory);
  const originalCreate = factory.create.bind(factory);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  let failManifestRewrite = true;
  const overlongStorageError = `manifest rewrite unavailable ${'x'.repeat(
    800
  )}`;
  supportBundleModel.storageProvider = null;
  factory.create = ((config: StorageProviderConfig) => {
    const provider = originalCreate(config);
    return {
      async put(key, body, metadata) {
        if (failManifestRewrite && key === bundle.manifestStorageKey) {
          throw new Error(overlongStorageError);
        }
        await provider.put(key, body, metadata);
      },
      presignPut: provider.presignPut?.bind(provider),
      createMultipartUpload: provider.createMultipartUpload?.bind(provider),
      presignUploadPart: provider.presignUploadPart?.bind(provider),
      listMultipartUploadParts:
        provider.listMultipartUploadParts?.bind(provider),
      completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
      abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
      head: provider.head.bind(provider),
      get: provider.get.bind(provider),
      list: provider.list.bind(provider),
      delete: provider.delete.bind(provider),
    } satisfies StorageProvider;
  }) as StorageProviderFactory['create'];

  try {
    const cleanupResult = await app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          limit: 5,
        },
      },
    });
    const cleanup = cleanupResult.cleanupCopilotSupportBundleRetention;
    t.like(cleanup, {
      archiveObjectCleanupFailedCount: 0,
      archiveObjectCleanupRecoveredCount: 0,
      archiveObjectCleanupRetryCount: 0,
      expiredBundleCount: 1,
      manifestObjectRewriteFailedCount: 0,
      manifestObjectRewriteRecoveredCount: 0,
      manifestObjectRewriteRetryCount: 0,
      workspaceId: workspace.id,
    });

    const rows = await db.$queryRaw<
      Array<{
        manifestFingerprint: string;
        manifestJson: CopilotSupportBundleManifest;
        retentionStatus: string;
        status: string;
      }>
    >`
      SELECT
        manifest_fingerprint AS "manifestFingerprint",
        manifest_json AS "manifestJson",
        retention_status AS "retentionStatus",
        status
      FROM ai_support_bundle_requests
      WHERE id = ${bundle.id}
    `;
    t.like(rows[0], {
      retentionStatus: 'expired',
      status: 'expired',
    });
    t.is(rows[0].manifestJson.retention.status, 'expired');
    t.is(
      rows[0].manifestFingerprint,
      cleanup.expiredBundles[0].manifestFingerprint
    );

    const auditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(auditRows[0].metadata, {
      archiveObjectCleanupStatus: 'deleted',
      manifestObjectRewriteErrorCode: 'Error',
      manifestObjectRewriteStatus: 'failed',
      manifestStorageKey: bundle.manifestStorageKey,
      retentionStatus: 'expired',
    });
    t.is(
      auditRows[0].metadata.manifestObjectRewriteErrorMessage,
      overlongStorageError.slice(0, 512)
    );

    failManifestRewrite = false;
    supportBundleModel.storageProvider = null;

    const retryResult = await app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          limit: 5,
        },
      },
    });
    const retry = retryResult.cleanupCopilotSupportBundleRetention;
    t.like(retry, {
      archiveObjectCleanupFailedCount: 0,
      archiveObjectCleanupRecoveredCount: 0,
      archiveObjectCleanupRetryCount: 0,
      expiredBundleCount: 0,
      expiredAuthorizationCount: 0,
      manifestObjectRewriteFailedCount: 0,
      manifestObjectRewriteRecoveredCount: 1,
      manifestObjectRewriteRetryCount: 1,
      workspaceId: workspace.id,
    });

    const retryAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(retryAuditRows[0].metadata, {
      cleanupFingerprint: retry.cleanupFingerprint,
      manifestObjectRewriteFailureCount: 1,
      manifestObjectRewriteRetry: true,
      manifestObjectRewriteStatus: 'written',
      manifestStorageKey: bundle.manifestStorageKey,
      previousManifestObjectRewriteErrorCode: 'Error',
      previousManifestObjectRewriteFingerprint: cleanup.cleanupFingerprint,
      retentionStatus: 'expired',
    });
    t.is(
      retryAuditRows[0].metadata.previousManifestObjectRewriteErrorMessage,
      overlongStorageError.slice(0, 512)
    );
  } finally {
    factory.create = originalCreate;
    supportBundleModel.storageProvider = null;
  }
});

test('support bundle retention retry audit fails closed when source cleanup evidence changes', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const factory = app.get(StorageProviderFactory);
  const originalCreate = factory.create.bind(factory);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    cleanupRetention(input: {
      actorId: string;
      limit?: number;
      workspaceId: string;
    }): Promise<unknown>;
    rewriteManifestObject(input: {
      body: Buffer;
      bundle: CopilotSupportBundleRecord;
    }): Promise<{
      errorCode?: string;
      errorMessage?: string;
      manifestStorageKey: string | null;
      status: 'failed' | 'missing' | 'written';
    }>;
    storageProvider: StorageProvider | null;
  };
  let failManifestRewrite = true;
  supportBundleModel.storageProvider = null;
  factory.create = ((config: StorageProviderConfig) => {
    const provider = originalCreate(config);
    return {
      put: async (key, body, options) => {
        if (failManifestRewrite && key === bundle.manifestStorageKey) {
          throw new Error('manifest rewrite unavailable');
        }
        await provider.put(key, body, options);
      },
      presignPut: provider.presignPut?.bind(provider),
      createMultipartUpload: provider.createMultipartUpload?.bind(provider),
      presignUploadPart: provider.presignUploadPart?.bind(provider),
      listMultipartUploadParts:
        provider.listMultipartUploadParts?.bind(provider),
      completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
      abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
      head: provider.head.bind(provider),
      get: provider.get.bind(provider),
      list: provider.list.bind(provider),
      delete: provider.delete.bind(provider),
    } satisfies StorageProvider;
  }) as StorageProviderFactory['create'];

  try {
    const cleanupResult = await app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          limit: 5,
        },
      },
    });
    const cleanup = cleanupResult.cleanupCopilotSupportBundleRetention;
    t.like(cleanup, {
      expiredBundleCount: 1,
      manifestObjectRewriteFailedCount: 0,
      manifestObjectRewriteRetryCount: 0,
    });

    const initialAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    t.like(initialAuditRows[0].metadata, {
      cleanupFingerprint: cleanup.cleanupFingerprint,
      manifestObjectRewriteStatus: 'failed',
    });

    failManifestRewrite = false;
    supportBundleModel.storageProvider = null;
    const originalRewriteManifestObject =
      supportBundleModel.rewriteManifestObject.bind(supportBundleModel);
    supportBundleModel.rewriteManifestObject = async input => {
      const result = await originalRewriteManifestObject(input);
      await db.$executeRaw`
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
          ${randomUUID()},
          ${bundle.id},
          ${workspace.id},
          ${owner.id},
          ${'retention_expired'},
          ${'f'.repeat(16)},
          ${JSON.stringify({
            cleanupActorId: owner.id,
            cleanupFingerprint: 'f'.repeat(16),
            cleanupScope: 'manual_workspace',
            cleanedAt: new Date().toISOString(),
            expiredAuthorizationCount: 0,
            manifestByteSize: bundle.manifestByteSize,
            manifestFingerprint: bundle.manifestFingerprint,
            manifestObjectRewriteErrorCode: 'Error',
            manifestObjectRewriteErrorMessage: 'newer cleanup failure',
            manifestObjectRewriteStatus: 'failed',
            manifestStorageKey: bundle.manifestStorageKey,
            previousManifestFingerprint: bundle.manifestFingerprint,
            retentionStatus: 'expired',
          })}::jsonb,
          CURRENT_TIMESTAMP
      `;
      return result;
    };

    try {
      await t.throwsAsync(
        supportBundleModel.cleanupRetention({
          actorId: owner.id,
          workspaceId: workspace.id,
          limit: 5,
        }),
        {
          message:
            /Support bundle retention retry audit event could not be recorded because its source cleanup state changed/,
        }
      );
    } finally {
      supportBundleModel.rewriteManifestObject = originalRewriteManifestObject;
    }

    const retryAuditRows = await db.$queryRaw<
      Array<{ retryAuditCount: number }>
    >`
      SELECT COUNT(*)::int AS "retryAuditCount"
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
        AND event_type = ${'retention_expired'}
        AND metadata->>'manifestObjectRewriteRetry' = ${'true'}
    `;
    t.is(retryAuditRows[0]?.retryAuditCount, 0);
  } finally {
    factory.create = originalCreate;
    supportBundleModel.storageProvider = null;
  }
});

test('scheduled support bundle retention cleanup repeats after recovering failed manifest object rewrite', async t => {
  const { app, cronJobs, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const factory = app.get(StorageProviderFactory);
  const originalCreate = factory.create.bind(factory);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  let failManifestRewrite = true;
  supportBundleModel.storageProvider = null;
  factory.create = ((config: StorageProviderConfig) => {
    const provider = originalCreate(config);
    return {
      async put(key, body, metadata) {
        if (failManifestRewrite && key === bundle.manifestStorageKey) {
          throw new Error('manifest rewrite unavailable');
        }
        await provider.put(key, body, metadata);
      },
      presignPut: provider.presignPut?.bind(provider),
      createMultipartUpload: provider.createMultipartUpload?.bind(provider),
      presignUploadPart: provider.presignUploadPart?.bind(provider),
      listMultipartUploadParts:
        provider.listMultipartUploadParts?.bind(provider),
      completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
      abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
      head: provider.head.bind(provider),
      get: provider.get.bind(provider),
      list: provider.list.bind(provider),
      delete: provider.delete.bind(provider),
    } satisfies StorageProvider;
  }) as StorageProviderFactory['create'];

  try {
    const firstSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 5,
    });
    t.is(firstSignal, JOB_SIGNAL.Done);

    failManifestRewrite = false;
    supportBundleModel.storageProvider = null;

    const retrySignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 1,
    });
    t.is(retrySignal, JOB_SIGNAL.Repeat);

    const retryAuditRows = await db.$queryRaw<
      Array<{ actorId: string; metadata: Record<string, unknown> }>
    >`
      SELECT
        actor_id AS "actorId",
        metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(retryAuditRows[0], {
      actorId: bundle.actorId,
    });
    t.like(retryAuditRows[0].metadata, {
      cleanupActorId: 'system_retention_worker',
      cleanupScope: 'scheduled_worker',
      manifestObjectRewriteRetry: true,
      manifestObjectRewriteStatus: 'written',
      manifestStorageKey: bundle.manifestStorageKey,
    });

    const noOpSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 1,
    });
    t.is(noOpSignal, JOB_SIGNAL.Done);
  } finally {
    factory.create = originalCreate;
    supportBundleModel.storageProvider = null;
  }
});

test('scheduled support bundle retention cleanup escalates persistent manifest rewrite failures but manual cleanup can recover', async t => {
  const { app, cronJobs, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const factory = app.get(StorageProviderFactory);
  const originalCreate = factory.create.bind(factory);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  let failManifestRewrite = true;
  supportBundleModel.storageProvider = null;
  factory.create = ((config: StorageProviderConfig) => {
    const provider = originalCreate(config);
    return {
      async put(key, body, metadata) {
        if (failManifestRewrite && key === bundle.manifestStorageKey) {
          throw new Error('manifest rewrite unavailable');
        }
        await provider.put(key, body, metadata);
      },
      presignPut: provider.presignPut?.bind(provider),
      createMultipartUpload: provider.createMultipartUpload?.bind(provider),
      presignUploadPart: provider.presignUploadPart?.bind(provider),
      listMultipartUploadParts:
        provider.listMultipartUploadParts?.bind(provider),
      completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
      abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
      head: provider.head.bind(provider),
      get: provider.get.bind(provider),
      list: provider.list.bind(provider),
      delete: provider.delete.bind(provider),
    } satisfies StorageProvider;
  }) as StorageProviderFactory['create'];

  try {
    const firstSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 5,
    });
    t.is(firstSignal, JOB_SIGNAL.Done);

    const retryFailureSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 5,
    });
    t.is(retryFailureSignal, JOB_SIGNAL.Done);

    const escalatedAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    t.like(escalatedAuditRows[0].metadata, {
      cleanupActorId: 'system_retention_worker',
      cleanupScope: 'scheduled_worker',
      manifestObjectRewriteEscalated: true,
      manifestObjectRewriteEscalationReason: 'scheduled_retry_limit_exceeded',
      manifestObjectRewriteFailureCount: 2,
      manifestObjectRewriteRetry: true,
      manifestObjectRewriteStatus: 'failed',
      manifestStorageKey: bundle.manifestStorageKey,
    });
    t.is(
      typeof escalatedAuditRows[0].metadata.manifestObjectRewriteEscalatedAt,
      'string'
    );

    const escalatedCountRows = await db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
    `;
    t.is(escalatedCountRows[0].count, 2);

    const skippedSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 5,
    });
    t.is(skippedSignal, JOB_SIGNAL.Done);

    const skippedCountRows = await db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
    `;
    t.is(skippedCountRows[0].count, 2);

    failManifestRewrite = false;
    supportBundleModel.storageProvider = null;

    const manualRetryResult = await app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          limit: 5,
        },
      },
    });
    const manualRetry = manualRetryResult.cleanupCopilotSupportBundleRetention;
    t.like(manualRetry, {
      expiredBundleCount: 0,
      expiredAuthorizationCount: 0,
      manifestObjectRewriteFailedCount: 0,
      manifestObjectRewriteRecoveredCount: 1,
      manifestObjectRewriteRetryCount: 1,
      workspaceId: workspace.id,
    });

    const manualRetryAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    t.like(manualRetryAuditRows[0].metadata, {
      cleanupScope: 'manual_workspace',
      manifestObjectRewriteFailureCount: 2,
      manifestObjectRewriteRetry: true,
      manifestObjectRewriteStatus: 'written',
      manifestStorageKey: bundle.manifestStorageKey,
      previousManifestObjectRewriteErrorCode: 'Error',
      previousManifestObjectRewriteErrorMessage: 'manifest rewrite unavailable',
    });
    t.is(
      manualRetryAuditRows[0].metadata.manifestObjectRewriteEscalated,
      undefined
    );
  } finally {
    factory.create = originalCreate;
    supportBundleModel.storageProvider = null;
  }
});

test('retention cleanup records archive object cleanup failure without rolling back expiration', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const factory = app.get(StorageProviderFactory);
  const originalCreate = factory.create.bind(factory);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  const overlongStorageError = `archive delete unavailable ${'x'.repeat(800)}`;
  supportBundleModel.storageProvider = null;
  factory.create = ((config: StorageProviderConfig) => {
    const provider = originalCreate(config);
    return {
      put: provider.put.bind(provider),
      presignPut: provider.presignPut?.bind(provider),
      createMultipartUpload: provider.createMultipartUpload?.bind(provider),
      presignUploadPart: provider.presignUploadPart?.bind(provider),
      listMultipartUploadParts:
        provider.listMultipartUploadParts?.bind(provider),
      completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
      abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
      head: provider.head.bind(provider),
      get: provider.get.bind(provider),
      list: provider.list.bind(provider),
      async delete(key: string) {
        if (key === bundle.archiveStorageKey) {
          throw new Error(overlongStorageError);
        }
        await provider.delete(key);
      },
    } satisfies StorageProvider;
  }) as StorageProviderFactory['create'];

  try {
    const cleanupResult = await app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          limit: 5,
        },
      },
    });
    const cleanup = cleanupResult.cleanupCopilotSupportBundleRetention;
    t.like(cleanup, {
      archiveObjectCleanupFailedCount: 0,
      archiveObjectCleanupRecoveredCount: 0,
      archiveObjectCleanupRetryCount: 0,
      expiredBundleCount: 1,
      workspaceId: workspace.id,
    });

    const rows = await db.$queryRaw<
      Array<{ retentionStatus: string; status: string }>
    >`
      SELECT
        retention_status AS "retentionStatus",
        status
      FROM ai_support_bundle_requests
      WHERE id = ${bundle.id}
    `;
    t.like(rows[0], {
      retentionStatus: 'expired',
      status: 'expired',
    });

    const auditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC
      LIMIT 1
  `;
    t.like(auditRows[0].metadata, {
      archiveObjectCleanupErrorCode: 'Error',
      archiveObjectCleanupStatus: 'failed',
      archiveStorageKey: bundle.archiveStorageKey,
    });
    t.is(
      auditRows[0].metadata.archiveObjectCleanupErrorMessage,
      overlongStorageError.slice(0, 512)
    );
  } finally {
    factory.create = originalCreate;
    supportBundleModel.storageProvider = null;
  }
});

test('retention cleanup retries failed archive object cleanup on expired bundles', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const factory = app.get(StorageProviderFactory);
  const originalCreate = factory.create.bind(factory);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  let failArchiveDelete = true;
  supportBundleModel.storageProvider = null;
  factory.create = ((config: StorageProviderConfig) => {
    const provider = originalCreate(config);
    return {
      put: provider.put.bind(provider),
      presignPut: provider.presignPut?.bind(provider),
      createMultipartUpload: provider.createMultipartUpload?.bind(provider),
      presignUploadPart: provider.presignUploadPart?.bind(provider),
      listMultipartUploadParts:
        provider.listMultipartUploadParts?.bind(provider),
      completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
      abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
      head: provider.head.bind(provider),
      get: provider.get.bind(provider),
      list: provider.list.bind(provider),
      async delete(key: string) {
        if (failArchiveDelete && key === bundle.archiveStorageKey) {
          throw new Error('archive delete unavailable');
        }
        await provider.delete(key);
      },
    } satisfies StorageProvider;
  }) as StorageProviderFactory['create'];

  try {
    const cleanupResult = await app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          limit: 5,
        },
      },
    });
    const cleanup = cleanupResult.cleanupCopilotSupportBundleRetention;
    t.like(cleanup, {
      archiveObjectCleanupFailedCount: 0,
      archiveObjectCleanupRecoveredCount: 0,
      archiveObjectCleanupRetryCount: 0,
      expiredBundleCount: 1,
      workspaceId: workspace.id,
    });

    const failedAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(failedAuditRows[0].metadata, {
      archiveObjectCleanupErrorCode: 'Error',
      archiveObjectCleanupStatus: 'failed',
      archiveStorageKey: bundle.archiveStorageKey,
    });

    failArchiveDelete = false;
    supportBundleModel.storageProvider = null;

    const retryResult = await app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          limit: 5,
        },
      },
    });
    const retry = retryResult.cleanupCopilotSupportBundleRetention;
    t.like(retry, {
      archiveObjectCleanupFailedCount: 0,
      archiveObjectCleanupRecoveredCount: 1,
      archiveObjectCleanupRetryCount: 1,
      expiredBundleCount: 0,
      expiredAuthorizationCount: 0,
      workspaceId: workspace.id,
    });

    const retryAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(retryAuditRows[0].metadata, {
      archiveObjectCleanupRetry: true,
      archiveObjectCleanupStatus: 'deleted',
      archiveStorageKey: bundle.archiveStorageKey,
      cleanupFingerprint: retry.cleanupFingerprint,
      expiredAuthorizationCount: 0,
      previousArchiveObjectCleanupErrorCode: 'Error',
      previousArchiveObjectCleanupErrorMessage: 'archive delete unavailable',
      previousArchiveObjectCleanupFingerprint: cleanup.cleanupFingerprint,
    });
  } finally {
    factory.create = originalCreate;
    supportBundleModel.storageProvider = null;
  }
});

test('runs scheduled support bundle retention cleanup through the copilot job handler', async t => {
  const { app, cronJobs, db, owner } = t.context;
  const firstWorkspace = await createWorkspace(app);
  const secondWorkspace = await createWorkspace(app);
  const firstExpiredAt = new Date(Date.now() - 120_000);
  const secondExpiredAt = new Date(Date.now() - 60_000);

  const firstBundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: firstWorkspace.id,
    actorId: owner.id,
    expiresAt: firstExpiredAt,
  });
  const secondBundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: secondWorkspace.id,
    actorId: owner.id,
    expiresAt: secondExpiredAt,
  });
  const firstAuthorization = await createDownloadAuthorizationFixture({
    db,
    bundle: firstBundle,
    artifactKind: 'archive_json',
  });
  const secondAuthorization = await createDownloadAuthorizationFixture({
    db,
    bundle: secondBundle,
    artifactKind: 'archive_json',
  });

  const firstSignal = await cronJobs.cleanupSupportBundleRetention({
    limit: 1,
  });
  t.is(firstSignal, JOB_SIGNAL.Repeat);

  const firstRows = await db.$queryRaw<
    Array<{ id: string; retentionStatus: string; status: string }>
  >`
    SELECT
      id,
      retention_status AS "retentionStatus",
      status
    FROM ai_support_bundle_requests
    WHERE id IN (${firstBundle.id}, ${secondBundle.id})
    ORDER BY expires_at ASC, created_at ASC, id ASC
  `;
  t.deepEqual(
    firstRows.map(row => ({
      id: row.id,
      retentionStatus: row.retentionStatus,
      status: row.status,
    })),
    [
      {
        id: firstBundle.id,
        retentionStatus: 'expired',
        status: 'expired',
      },
      {
        id: secondBundle.id,
        retentionStatus: 'active',
        status: 'ready',
      },
    ]
  );

  const secondSignal = await cronJobs.cleanupSupportBundleRetention({
    limit: 5,
  });
  t.is(secondSignal, JOB_SIGNAL.Done);

  const authorizationRows = await db.$queryRaw<
    Array<{ id: string; status: string }>
  >`
    SELECT
      id,
      status
    FROM ai_support_bundle_download_authorizations
    WHERE id IN (${firstAuthorization.id}, ${secondAuthorization.id})
    ORDER BY id ASC
  `;
  t.deepEqual(
    authorizationRows.map(row => row.status),
    ['expired', 'expired']
  );

  const auditRows = await db.$queryRaw<
    Array<{
      actorId: string;
      bundleId: string;
      eventType: string;
      metadata: Record<string, unknown>;
      workspaceId: string;
    }>
  >`
    SELECT
      actor_id AS "actorId",
      bundle_id AS "bundleId",
      event_type AS "eventType",
      metadata,
      workspace_id AS "workspaceId"
    FROM ai_support_bundle_audit_events
    WHERE
      bundle_id IN (${firstBundle.id}, ${secondBundle.id})
      AND event_type = ${'retention_expired'}
    ORDER BY created_at ASC
  `;
  t.is(auditRows.length, 2);
  t.true(auditRows.every(row => row.actorId === owner.id));
  t.deepEqual(
    auditRows.map(row => row.workspaceId).sort(compareTestStrings),
    [firstWorkspace.id, secondWorkspace.id].sort(compareTestStrings)
  );
  t.true(
    auditRows.every(
      row =>
        row.metadata.cleanupActorId === 'system_retention_worker' &&
        row.metadata.cleanupScope === 'scheduled_worker' &&
        typeof row.metadata.cleanupFingerprint === 'string'
    )
  );

  const noOpSignal = await cronJobs.cleanupSupportBundleRetention({
    limit: 5,
  });
  t.is(noOpSignal, JOB_SIGNAL.Done);
});

test('scheduled support bundle retention cleanup retries failed archive object cleanup', async t => {
  const { app, cronJobs, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const factory = app.get(StorageProviderFactory);
  const originalCreate = factory.create.bind(factory);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  let failArchiveDelete = true;
  supportBundleModel.storageProvider = null;
  factory.create = ((config: StorageProviderConfig) => {
    const provider = originalCreate(config);
    return {
      put: provider.put.bind(provider),
      presignPut: provider.presignPut?.bind(provider),
      createMultipartUpload: provider.createMultipartUpload?.bind(provider),
      presignUploadPart: provider.presignUploadPart?.bind(provider),
      listMultipartUploadParts:
        provider.listMultipartUploadParts?.bind(provider),
      completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
      abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
      head: provider.head.bind(provider),
      get: provider.get.bind(provider),
      list: provider.list.bind(provider),
      async delete(key: string) {
        if (failArchiveDelete && key === bundle.archiveStorageKey) {
          throw new Error('archive delete unavailable');
        }
        await provider.delete(key);
      },
    } satisfies StorageProvider;
  }) as StorageProviderFactory['create'];

  try {
    const firstSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 5,
    });
    t.is(firstSignal, JOB_SIGNAL.Done);

    failArchiveDelete = false;
    supportBundleModel.storageProvider = null;

    const retrySignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 1,
    });
    t.is(retrySignal, JOB_SIGNAL.Repeat);

    const retryAuditRows = await db.$queryRaw<
      Array<{ actorId: string; metadata: Record<string, unknown> }>
    >`
      SELECT
        actor_id AS "actorId",
        metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    t.like(retryAuditRows[0], {
      actorId: bundle.actorId,
    });
    t.like(retryAuditRows[0].metadata, {
      archiveObjectCleanupRetry: true,
      archiveObjectCleanupStatus: 'deleted',
      archiveStorageKey: bundle.archiveStorageKey,
      cleanupActorId: 'system_retention_worker',
      cleanupScope: 'scheduled_worker',
    });

    const noOpSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 1,
    });
    t.is(noOpSignal, JOB_SIGNAL.Done);
  } finally {
    factory.create = originalCreate;
    supportBundleModel.storageProvider = null;
  }
});

test('scheduled support bundle retention cleanup escalates persistent archive cleanup failures but manual cleanup can recover', async t => {
  const { app, cronJobs, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const bundle = await createExpiredSupportBundleFixture({
    app,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  const factory = app.get(StorageProviderFactory);
  const originalCreate = factory.create.bind(factory);
  const supportBundleModel = app.get(Models)
    .copilotSupportBundle as unknown as {
    storageProvider: StorageProvider | null;
  };
  let failArchiveDelete = true;
  supportBundleModel.storageProvider = null;
  factory.create = ((config: StorageProviderConfig) => {
    const provider = originalCreate(config);
    return {
      put: provider.put.bind(provider),
      presignPut: provider.presignPut?.bind(provider),
      createMultipartUpload: provider.createMultipartUpload?.bind(provider),
      presignUploadPart: provider.presignUploadPart?.bind(provider),
      listMultipartUploadParts:
        provider.listMultipartUploadParts?.bind(provider),
      completeMultipartUpload: provider.completeMultipartUpload?.bind(provider),
      abortMultipartUpload: provider.abortMultipartUpload?.bind(provider),
      head: provider.head.bind(provider),
      get: provider.get.bind(provider),
      list: provider.list.bind(provider),
      async delete(key: string) {
        if (failArchiveDelete && key === bundle.archiveStorageKey) {
          throw new Error('archive delete unavailable');
        }
        await provider.delete(key);
      },
    } satisfies StorageProvider;
  }) as StorageProviderFactory['create'];

  try {
    const firstSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 5,
    });
    t.is(firstSignal, JOB_SIGNAL.Done);

    const retryFailureSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 5,
    });
    t.is(retryFailureSignal, JOB_SIGNAL.Done);

    const escalatedAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    t.like(escalatedAuditRows[0].metadata, {
      archiveObjectCleanupEscalated: true,
      archiveObjectCleanupEscalationReason: 'scheduled_retry_limit_exceeded',
      archiveObjectCleanupFailureCount: 2,
      archiveObjectCleanupRetry: true,
      archiveObjectCleanupStatus: 'failed',
      archiveStorageKey: bundle.archiveStorageKey,
      cleanupActorId: 'system_retention_worker',
      cleanupScope: 'scheduled_worker',
    });
    t.is(
      typeof escalatedAuditRows[0].metadata.archiveObjectCleanupEscalatedAt,
      'string'
    );

    const escalatedCountRows = await db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
    `;
    t.is(escalatedCountRows[0].count, 2);

    const skippedSignal = await cronJobs.cleanupSupportBundleRetention({
      limit: 5,
    });
    t.is(skippedSignal, JOB_SIGNAL.Done);

    const skippedCountRows = await db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
    `;
    t.is(skippedCountRows[0].count, 2);

    failArchiveDelete = false;
    supportBundleModel.storageProvider = null;

    const manualRetryResult = await app.gql({
      query: cleanupSupportBundleRetentionMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          limit: 5,
        },
      },
    });
    const manualRetry = manualRetryResult.cleanupCopilotSupportBundleRetention;
    t.like(manualRetry, {
      archiveObjectCleanupFailedCount: 0,
      archiveObjectCleanupRecoveredCount: 1,
      archiveObjectCleanupRetryCount: 1,
      expiredBundleCount: 0,
      expiredAuthorizationCount: 0,
      workspaceId: workspace.id,
    });

    const manualRetryAuditRows = await db.$queryRaw<
      Array<{ metadata: Record<string, unknown> }>
    >`
      SELECT metadata
      FROM ai_support_bundle_audit_events
      WHERE bundle_id = ${bundle.id}
      AND event_type = ${'retention_expired'}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    t.like(manualRetryAuditRows[0].metadata, {
      archiveObjectCleanupFailureCount: 2,
      archiveObjectCleanupRetry: true,
      archiveObjectCleanupStatus: 'deleted',
      archiveStorageKey: bundle.archiveStorageKey,
      cleanupScope: 'manual_workspace',
      previousArchiveObjectCleanupErrorCode: 'Error',
      previousArchiveObjectCleanupErrorMessage: 'archive delete unavailable',
    });
    t.is(
      manualRetryAuditRows[0].metadata.archiveObjectCleanupEscalated,
      undefined
    );
  } finally {
    factory.create = originalCreate;
    supportBundleModel.storageProvider = null;
  }
});
