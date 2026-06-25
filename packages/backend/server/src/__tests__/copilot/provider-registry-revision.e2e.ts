import type { GraphQLQuery } from '@affine/graphql';
import { PrismaClient } from '@prisma/client';
import type { TestFn } from 'ava';
import ava from 'ava';

import { AppModule } from '../../app.module';
import { JobQueue } from '../../base';
import { ConfigModule } from '../../base/config';
import { AuthService } from '../../core/auth';
import { Models } from '../../models';
import {
  type CopilotProviderHealthProbeAttemptRecord,
  PROVIDER_HEALTH_STATE_PROBE_RESULT_MAX_AGE_MS,
  providerHealthStateFingerprint,
} from '../../models/copilot-provider-health-state';
import { providerRegistryRevisionFingerprint } from '../../models/copilot-provider-registry-revision';
import { createRegistryRevisionPublishEvent } from '../../models/copilot-registry-revision-publish-event';
import { CopilotProviderHealthWorker } from '../../plugins/copilot/provider-health-worker';
import {
  CopilotProviderType,
  ModelInputType,
  ModelOutputType,
} from '../../plugins/copilot/providers/types';
import {
  createTestingApp,
  createWorkspace,
  TestingApp,
  TestUser,
} from '../utils';

const test = ava as TestFn<{
  app: TestingApp;
  auth: AuthService;
  db: PrismaClient;
  owner: TestUser;
  providerHealthWorker: CopilotProviderHealthWorker;
}>;

const providerRegistryQuery = {
  id: 'providerRegistryRevisionTestQuery',
  op: 'providerRegistryRevision',
  query: `
    query providerRegistryRevision($workspaceId: String) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          models(promptName: "Chat With AFFiNE AI") {
            optionalModels {
              id
              name
              providerId
              providerName
              providerProfileId
              providerProfileSource
              providerProfileConfigPath
              providerSource
              providerConfiguredModelIds
              providerHealth
              providerHealthCheckedAt
              providerHealthLastError
              providerPrivacy
              providerPriority
              routeModelId
              routeRawModelId
              routeModelDefinitionAliases
              routeModelDefinitionId
              routeModelDefinitionSource
              routeInputTypes
              routeOutputTypes
              effectiveSourceFingerprint
              effectiveSourceFingerprintInputs
            }
          }
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const providerHealthStateMutation = {
  id: 'providerHealthStateRecordTestMutation',
  op: 'recordCopilotProviderHealthState',
  query: `
    mutation providerHealthStateRecord(
      $input: CopilotProviderHealthStateRecordInput!
    ) {
      recordCopilotProviderHealthState(input: $input) {
        id
        providerId
        providerType
        scopeType
        workspaceId
        actorId
        status
        checkedAt
        lastError
        source
        fingerprint
        eventCount
        events {
          id
          stateId
          providerId
          providerType
          scopeType
          workspaceId
          actorId
          status
          checkedAt
          lastError
          source
          eventType
          fingerprint
          stateFingerprint
          metadata
          createdAt
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const providerHealthProbeAttemptsQuery = {
  id: 'providerHealthProbeAttemptsTestQuery',
  op: 'providerHealthProbeAttempts',
  query: `
    query providerHealthProbeAttempts(
      $workspaceId: String!
      $limit: SafeInt
      $filter: CopilotProviderHealthProbeAttemptFilterInput
    ) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          providerHealthProbeAttempts(filter: $filter, limit: $limit) {
            id
            providerId
            providerType
            scopeType
            workspaceId
            actorId
            providerRegistryRevisionId
            providerRegistryRevisionFingerprint
            providerProfileSource
            providerProfileFingerprint
            providerProfileSnapshot
            requestFingerprint
            status
            attemptCount
            maxAttempts
            scheduledAt
            workerLeaseId
            workerLeaseExpiresAt
            checkedAt
            completedAt
            deadLetteredAt
            failureCode
            failureMessage
            resultStatus
            resultLastError
            resultMetadata
            resultFingerprint
            providerHealthStateId
            providerHealthStateFingerprint
            createdAt
            updatedAt
          }
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const providerHealthProbeAttemptRetryMutation = {
  id: 'providerHealthProbeAttemptRetryTestMutation',
  op: 'retryCopilotProviderHealthProbeAttempt',
  query: `
    mutation providerHealthProbeAttemptRetry(
      $input: CopilotProviderHealthProbeAttemptRetryInput!
    ) {
      retryCopilotProviderHealthProbeAttempt(input: $input) {
        id
        providerId
        providerType
        scopeType
        workspaceId
        actorId
        providerRegistryRevisionId
        providerRegistryRevisionFingerprint
        providerProfileSource
        providerProfileFingerprint
        requestFingerprint
        status
        attemptCount
        maxAttempts
        scheduledAt
        workerLeaseId
        workerLeaseExpiresAt
        checkedAt
        completedAt
        deadLetteredAt
        failureCode
        failureMessage
        resultStatus
        resultFingerprint
        providerHealthStateId
        providerHealthStateFingerprint
        createdAt
        updatedAt
      }
    }
  `,
} satisfies GraphQLQuery;

const configuredProviderHealthCheckedAt = new Date().toISOString();

const registryPublishEventFields = `
  publishEventCount
  publishEvents {
    actorId
    eventFingerprint
    eventType
    publishSource
    registryFamily
    registryKey
    registryProviderId
    revisionId
    scopeType
    workspaceId
  }
`;

const providerRegistryPublishMutation = {
  id: 'providerRegistryRevisionPublishTestMutation',
  op: 'publishCopilotProviderRegistryRevision',
  query: `
    mutation providerRegistryRevisionPublish(
      $input: CopilotProviderRegistryPublishInput!
    ) {
      publishCopilotProviderRegistryRevision(input: $input) {
        id
        providerId
        providerType
        scopeType
        workspaceId
        actorId
        revision
        status
        fingerprint
        providerHealthProbeAttempt {
          id
          providerId
          providerType
          scopeType
          workspaceId
          providerRegistryRevisionId
          providerRegistryRevisionFingerprint
          providerProfileSource
          providerProfileFingerprint
          requestFingerprint
          status
          attemptCount
          maxAttempts
          scheduledAt
          checkedAt
          completedAt
          deadLetteredAt
          resultStatus
          resultFingerprint
          providerHealthStateId
          providerHealthStateFingerprint
        }
        providerProfile
        fallbackSourceChain
        ${registryPublishEventFields}
      }
    }
  `,
} satisfies GraphQLQuery;

test.before(async t => {
  const app = await createTestingApp({
    imports: [
      ConfigModule.override({
        copilot: {
          providers: {
            openaiCompatible: {
              apiStyle: 'chat_completions',
              baseURL: 'http://localmind.invalid/v1',
            },
            profiles: [
              {
                id: 'localmind-db-provider',
                type: CopilotProviderType.OpenAICompatible,
                config: {
                  apiKey: 'test',
                  baseURL: 'http://localmind.invalid/v1',
                },
                modelDefinitions: [
                  {
                    id: 'config-chat',
                    rawModelId: 'config-chat-raw',
                    displayName: 'Config chat',
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Text],
                      },
                    ],
                  },
                ],
                health: {
                  status: 'degraded',
                  lastCheckedAt: configuredProviderHealthCheckedAt,
                  lastError: 'configured provider health snapshot',
                },
              },
            ],
            openai: { apiKey: '1' },
          },
          prompts: {
            defaults: {
              text: {
                optionalModels: ['db-provider-chat'],
              },
            },
          },
        },
      }),
      AppModule,
    ],
    tapModule: builder => {
      builder.overrideProvider(JobQueue).useClass(JobQueue);
    },
  });

  t.context.app = app;
  t.context.auth = app.get(AuthService);
  t.context.db = app.get(PrismaClient);
  t.context.providerHealthWorker = app.get(CopilotProviderHealthWorker);
});

test.beforeEach(async t => {
  await t.context.app.initTestingDB();
  t.context.owner = await t.context.app.signupV1();
});

test.after.always(async t => {
  await t.context.app?.close();
});

function findPropertyDescriptor(
  target: object,
  propertyKey: PropertyKey
): PropertyDescriptor | undefined {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, propertyKey);
    if (descriptor) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

async function insertProviderRegistryRevision(input: {
  actorId: string;
  db: PrismaClient;
  displayName: string;
  fingerprint: string;
  id: string;
  privacy: 'cloud' | 'private_cloud' | 'local';
  priority: number;
  rawModelId: string;
  revision: string;
  scopeType: 'global' | 'workspace';
  workspaceId?: string | null;
}) {
  await input.db.$executeRaw`
    INSERT INTO ai_provider_registry_revisions (
      id,
      provider_id,
      provider_type,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      provider_profile,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${input.id},
      ${'localmind-db-provider'},
      ${CopilotProviderType.OpenAICompatible},
      ${input.scopeType},
      ${input.workspaceId ?? null},
      ${input.actorId},
      ${input.revision},
      ${'active'},
      ${input.fingerprint},
      ${JSON.stringify({
        id: 'localmind-db-provider',
        type: CopilotProviderType.OpenAICompatible,
        source: 'db_revision',
        displayName: input.displayName,
        priority: input.priority,
        privacy: input.privacy,
        health: {
          status: 'healthy',
          lastCheckedAt: '2026-06-21T11:00:00.000Z',
        },
        modelDefinitions: [
          {
            id: 'db-provider-chat',
            rawModelId: input.rawModelId,
            displayName: `${input.displayName} chat`,
            aliases: ['db-provider-chat-alias'],
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
        ],
      })}::jsonb,
      ${JSON.stringify([
        {
          source: 'provider_profile',
          scope: 'global',
          status: 'available',
          providerId: 'localmind-db-provider',
          providerType: CopilotProviderType.OpenAICompatible,
          revision: 'config-profile-provider',
          fingerprint: 'configprovider111',
        },
      ])}::jsonb,
      ${JSON.stringify({ version: 'provider-registry-revision-test/v1' })}::jsonb,
      ${new Date('2026-06-21T11:00:00.000Z')},
      ${new Date('2026-06-21T11:00:00.000Z')}
    )
  `;
}

async function insertProviderRegistryRevisionWithDriftedMetadata(input: {
  db: Pick<PrismaClient, '$executeRaw'>;
  values: unknown[];
}): Promise<{
  driftedMetadata: Record<string, unknown>;
  expectedMetadata: Record<string, unknown>;
  fingerprint: string;
  revisionId: string;
}> {
  const [
    revisionId,
    providerId,
    providerType,
    scopeType,
    workspaceId,
    actorId,
    revision,
    status,
    fingerprint,
    providerProfileJson,
    fallbackSourceChainJson,
    metadataJson,
    createdAt,
    updatedAt,
  ] = input.values;
  if (
    typeof revisionId !== 'string' ||
    typeof providerId !== 'string' ||
    (providerType !== null && typeof providerType !== 'string') ||
    scopeType !== 'workspace' ||
    typeof workspaceId !== 'string' ||
    typeof actorId !== 'string' ||
    typeof revision !== 'string' ||
    status !== 'active' ||
    typeof fingerprint !== 'string' ||
    typeof providerProfileJson !== 'string' ||
    typeof fallbackSourceChainJson !== 'string' ||
    typeof metadataJson !== 'string'
  ) {
    throw new Error('Invalid provider registry revision insert fixture');
  }
  const createdAtDate =
    createdAt instanceof Date ? createdAt : new Date(String(createdAt));
  const updatedAtDate =
    updatedAt instanceof Date ? updatedAt : new Date(String(updatedAt));
  if (
    Number.isNaN(createdAtDate.getTime()) ||
    Number.isNaN(updatedAtDate.getTime())
  ) {
    throw new Error('Invalid provider registry revision timestamp fixture');
  }
  const providerProfile = JSON.parse(providerProfileJson) as unknown;
  const fallbackSourceChain = JSON.parse(fallbackSourceChainJson) as unknown;
  const expectedMetadata = JSON.parse(metadataJson) as Record<string, unknown>;
  const driftedMetadata = {
    ...expectedMetadata,
    providerRegistryRevisionConflictFixture: true,
  };

  await input.db.$executeRaw`
    INSERT INTO ai_provider_registry_revisions (
      id,
      provider_id,
      provider_type,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      provider_profile,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${revisionId},
      ${providerId},
      ${providerType},
      ${scopeType},
      ${workspaceId},
      ${actorId},
      ${revision},
      ${status},
      ${fingerprint},
      ${JSON.stringify(providerProfile)}::jsonb,
      ${JSON.stringify(fallbackSourceChain)}::jsonb,
      ${JSON.stringify(driftedMetadata)}::jsonb,
      ${createdAtDate},
      ${updatedAtDate}
    )
  `;

  return {
    driftedMetadata,
    expectedMetadata,
    fingerprint,
    revisionId,
  };
}

async function insertProviderHealthStateWithEvent(input: {
  actorId?: string | null;
  checkedAt: Date;
  db: Pick<PrismaClient, '$executeRaw'>;
  eventType:
    | 'manual_override_recorded'
    | 'workspace_probe_result_recorded'
    | 'configured_snapshot_recorded';
  fingerprint: string;
  id: string;
  lastError?: string | null;
  metadata: Record<string, unknown>;
  providerId: string;
  providerType?: CopilotProviderType | null;
  scopeType: 'global' | 'workspace';
  source: 'manual_override' | 'probe_result';
  status: 'unknown' | 'healthy' | 'degraded' | 'down';
  workspaceId?: string | null;
}) {
  const actorId = input.actorId ?? null;
  const lastError = input.lastError ?? null;
  const metadata = JSON.stringify(input.metadata);
  const providerType = input.providerType ?? null;
  const workspaceId = input.workspaceId ?? null;
  const eventFingerprint = providerHealthStateFingerprint({
    version: 'provider-health-event/v1',
    stateId: input.id,
    providerId: input.providerId,
    providerType,
    scopeType: input.scopeType,
    workspaceId,
    actorId,
    status: input.status,
    checkedAt: input.checkedAt.toISOString(),
    lastError,
    source: input.source,
    eventType: input.eventType,
    stateFingerprint: input.fingerprint,
    metadata: input.metadata,
  });

  await input.db.$executeRaw`
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
      ${input.id},
      ${input.providerId},
      ${providerType},
      ${input.scopeType},
      ${workspaceId},
      ${actorId},
      ${input.status},
      ${input.checkedAt},
      ${lastError},
      ${input.source},
      ${input.fingerprint},
      ${metadata}::jsonb,
      ${input.checkedAt},
      ${input.checkedAt}
    )
  `;
  await input.db.$executeRaw`
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
      ${`provider-health-event-${eventFingerprint}`},
      ${input.id},
      ${input.providerId},
      ${providerType},
      ${input.scopeType},
      ${workspaceId},
      ${actorId},
      ${input.status},
      ${input.checkedAt},
      ${lastError},
      ${input.source},
      ${input.eventType},
      ${eventFingerprint},
      ${input.fingerprint},
      ${metadata}::jsonb,
      ${input.checkedAt}
    )
  `;
}

async function insertProviderHealthEventWithDriftedMetadata(input: {
  db: Pick<PrismaClient, '$executeRaw'>;
  values: unknown[];
}): Promise<{
  driftedEventFingerprint: string;
  driftedMetadata: Record<string, unknown>;
  eventId: string;
  expectedEventFingerprint: string;
}> {
  const [
    eventId,
    stateId,
    providerId,
    providerType,
    scopeType,
    workspaceId,
    actorId,
    status,
    checkedAt,
    lastError,
    source,
    eventType,
    expectedEventFingerprint,
    stateFingerprint,
    metadataJson,
    createdAt,
  ] = input.values;
  if (
    typeof eventId !== 'string' ||
    typeof stateId !== 'string' ||
    typeof providerId !== 'string' ||
    (providerType !== null && typeof providerType !== 'string') ||
    (scopeType !== 'global' && scopeType !== 'workspace') ||
    (workspaceId !== null && typeof workspaceId !== 'string') ||
    (actorId !== null && typeof actorId !== 'string') ||
    typeof status !== 'string' ||
    (lastError !== null && typeof lastError !== 'string') ||
    (source !== 'manual_override' && source !== 'probe_result') ||
    typeof eventType !== 'string' ||
    typeof expectedEventFingerprint !== 'string' ||
    typeof stateFingerprint !== 'string' ||
    typeof metadataJson !== 'string'
  ) {
    throw new Error('Invalid provider health event insert fixture');
  }
  const checkedAtDate =
    checkedAt instanceof Date ? checkedAt : new Date(String(checkedAt));
  const createdAtDate =
    createdAt instanceof Date ? createdAt : new Date(String(createdAt));
  if (
    Number.isNaN(checkedAtDate.getTime()) ||
    Number.isNaN(createdAtDate.getTime())
  ) {
    throw new Error('Invalid provider health event timestamp fixture');
  }
  const parsedMetadata = JSON.parse(metadataJson) as unknown;
  if (
    !parsedMetadata ||
    typeof parsedMetadata !== 'object' ||
    Array.isArray(parsedMetadata)
  ) {
    throw new Error('Invalid provider health event metadata fixture');
  }
  const driftedMetadata = {
    ...(parsedMetadata as Record<string, unknown>),
    providerHealthEventConflictFixture: true,
  };
  const driftedEventFingerprint = providerHealthStateFingerprint({
    version: 'provider-health-event/v1',
    stateId,
    providerId,
    providerType,
    scopeType,
    workspaceId,
    actorId,
    status,
    checkedAt: checkedAtDate.toISOString(),
    lastError,
    source,
    eventType,
    stateFingerprint,
    metadata: driftedMetadata,
  });

  await input.db.$executeRaw`
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
      ${eventId},
      ${stateId},
      ${providerId},
      ${providerType},
      ${scopeType},
      ${workspaceId},
      ${actorId},
      ${status},
      ${checkedAtDate},
      ${lastError},
      ${source},
      ${eventType},
      ${driftedEventFingerprint},
      ${stateFingerprint},
      ${JSON.stringify(driftedMetadata)}::jsonb,
      ${createdAtDate}
    )
  `;

  return {
    driftedEventFingerprint,
    driftedMetadata,
    eventId,
    expectedEventFingerprint,
  };
}

async function insertProbeAttemptWithDriftedProfileEvidence(input: {
  db: Pick<PrismaClient, '$executeRaw'>;
  values: unknown[];
}): Promise<{
  driftedProviderProfileFingerprint: string;
  driftedProviderProfileSnapshot: Record<string, unknown>;
  providerProfileFingerprint: string;
  requestFingerprint: string;
}> {
  const [
    id,
    providerId,
    providerType,
    scopeType,
    workspaceId,
    actorId,
    providerRegistryRevisionId,
    providerRegistryRevisionFingerprintValue,
    providerProfileSource,
    providerProfileFingerprint,
    providerProfileSnapshotJson,
    requestFingerprint,
    ,
    ,
    maxAttempts,
    scheduledAt,
    ,
    createdAt,
    updatedAt,
  ] = input.values;
  if (
    typeof id !== 'string' ||
    typeof providerId !== 'string' ||
    (providerType !== null && typeof providerType !== 'string') ||
    scopeType !== 'workspace' ||
    typeof workspaceId !== 'string' ||
    typeof actorId !== 'string' ||
    typeof providerRegistryRevisionId !== 'string' ||
    typeof providerRegistryRevisionFingerprintValue !== 'string' ||
    (providerProfileSource !== null &&
      typeof providerProfileSource !== 'string') ||
    typeof providerProfileFingerprint !== 'string' ||
    typeof providerProfileSnapshotJson !== 'string' ||
    typeof requestFingerprint !== 'string'
  ) {
    throw new Error('Invalid provider health probe attempt insert fixture');
  }
  const parsedProviderProfileSnapshot = JSON.parse(
    providerProfileSnapshotJson
  ) as unknown;
  if (
    !parsedProviderProfileSnapshot ||
    typeof parsedProviderProfileSnapshot !== 'object' ||
    Array.isArray(parsedProviderProfileSnapshot)
  ) {
    throw new Error('Invalid provider health probe attempt snapshot fixture');
  }
  const scheduledAtDate =
    scheduledAt instanceof Date ? scheduledAt : new Date(String(scheduledAt));
  const createdAtDate =
    createdAt instanceof Date ? createdAt : new Date(String(createdAt));
  const updatedAtDate =
    updatedAt instanceof Date ? updatedAt : new Date(String(updatedAt));
  if (
    Number.isNaN(scheduledAtDate.getTime()) ||
    Number.isNaN(createdAtDate.getTime()) ||
    Number.isNaN(updatedAtDate.getTime())
  ) {
    throw new Error('Invalid provider health probe attempt timestamp fixture');
  }
  const driftedProviderProfileSnapshot = {
    ...(parsedProviderProfileSnapshot as Record<string, unknown>),
    modelCount: 0,
    modelDefinitions: [],
    providerHealthProbeAttemptConflictFixture: true,
  };
  const driftedProviderProfileFingerprint = providerRegistryRevisionFingerprint(
    {
      version: 'provider-health-probe-profile/v1',
      providerId,
      providerType,
      providerProfileSnapshot: driftedProviderProfileSnapshot,
    }
  );

  await input.db.$executeRaw`
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
    VALUES (
      ${id},
      ${providerId},
      ${providerType},
      ${scopeType},
      ${workspaceId},
      ${actorId},
      ${providerRegistryRevisionId},
      ${providerRegistryRevisionFingerprintValue},
      ${providerProfileSource},
      ${driftedProviderProfileFingerprint},
      ${JSON.stringify(driftedProviderProfileSnapshot)}::jsonb,
      ${requestFingerprint},
      ${'queued'},
      ${0},
      ${Number(maxAttempts)},
      ${scheduledAtDate},
      ${'{}'}::jsonb,
      ${createdAtDate},
      ${updatedAtDate}
    )
  `;

  return {
    driftedProviderProfileFingerprint,
    driftedProviderProfileSnapshot,
    providerProfileFingerprint,
    requestFingerprint,
  };
}

test('provider registry DB constraints reject invalid revision scope and status rows', async t => {
  const { db, owner } = t.context;
  const workspace = await createWorkspace(t.context.app);
  const now = new Date('2026-06-22T12:10:00.000Z');
  const providerProfile = JSON.stringify({
    id: 'localmind-db-provider',
    type: CopilotProviderType.OpenAICompatible,
    source: 'db_revision',
    config: {},
  });

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_provider_registry_revisions (
      id,
      provider_id,
      provider_type,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      provider_profile,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'provider-registry-invalid-status-row'},
      ${'localmind-db-provider'},
      ${CopilotProviderType.OpenAICompatible},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'invalid-status-row'},
      ${'available'},
      ${'invalidstatus222'},
      ${providerProfile}::jsonb,
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_provider_registry_revisions (
      id,
      provider_id,
      provider_type,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      provider_profile,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'provider-registry-invalid-scope-row'},
      ${'localmind-db-provider'},
      ${CopilotProviderType.OpenAICompatible},
      ${'tenant'},
      ${workspace.id},
      ${owner.id},
      ${'invalid-scope-row'},
      ${'active'},
      ${'invalidscope222'},
      ${providerProfile}::jsonb,
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_provider_registry_revisions (
      id,
      provider_id,
      provider_type,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      provider_profile,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'provider-registry-global-with-workspace-row'},
      ${'localmind-db-provider'},
      ${CopilotProviderType.OpenAICompatible},
      ${'global'},
      ${workspace.id},
      ${owner.id},
      ${'global-with-workspace-row'},
      ${'active'},
      ${'globalworkspace2'},
      ${providerProfile}::jsonb,
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_provider_registry_revisions (
      id,
      provider_id,
      provider_type,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      provider_profile,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'provider-registry-workspace-without-workspace-row'},
      ${'localmind-db-provider'},
      ${CopilotProviderType.OpenAICompatible},
      ${'workspace'},
      ${null},
      ${owner.id},
      ${'workspace-without-workspace-row'},
      ${'active'},
      ${'workspacewithout2'},
      ${providerProfile}::jsonb,
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_provider_registry_revisions (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        provider_profile,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'provider-registry-invalid-json-shape-row'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-json-shape-row'},
        ${'active'},
        ${'invalidjson222'},
        ${providerProfile}::jsonb,
        ${'{}'}::jsonb,
        ${'[]'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_provider_registry_revisions_json_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_provider_registry_revisions (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        provider_profile,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'provider-registry-invalid-source-chain-provenance-row'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-source-chain-provenance-row'},
        ${'active'},
        ${'invalidsourcechain4'},
        ${providerProfile}::jsonb,
        ${JSON.stringify([
          {
            source: 'legacy_profile',
            scope: 'global',
            status: 'untrusted_status',
          },
        ])}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_provider_registry_revisions_source_chain_provenance_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_provider_registry_revisions (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        provider_profile,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'provider-registry-invalid-source-chain-metadata-row'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-source-chain-metadata-row'},
        ${'active'},
        ${'invalidsourcechain8'},
        ${providerProfile}::jsonb,
        ${JSON.stringify([
          {
            source: 'legacy_profile',
            scope: 'global',
            status: 'available',
            providerType: 'unknownProviderType',
          },
        ])}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_provider_registry_revisions_source_chain_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_provider_registry_revisions (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        provider_profile,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'provider-registry-invalid-payload-json-shape-row'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-payload-json-shape-row'},
        ${'active'},
        ${'invalidpayload2'},
        ${'[]'}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_provider_registry_revisions_payload_json_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_provider_registry_revisions (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        provider_profile,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'provider-registry-invalid-revision-shape-row'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid revision shape'},
        ${'active'},
        ${'invalidrevision4'},
        ${providerProfile}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_provider_registry_revisions_revision_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_provider_registry_revisions (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        provider_profile,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'provider-registry-invalid-provider-id-shape-row'},
        ${'   '},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'provider-id-shape-r1'},
        ${'active'},
        ${'invalidprovider1'},
        ${providerProfile}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_provider_registry_revisions_provider_id_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_provider_registry_revisions (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        provider_profile,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'provider-registry-invalid-provider-type-shape-row'},
        ${'localmind-db-provider'},
        ${'   '},
        ${'global'},
        ${null},
        ${owner.id},
        ${'provider-type-shape-r1'},
        ${'active'},
        ${'invalidprovider2'},
        ${providerProfile}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_provider_registry_revisions_provider_type_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_provider_registry_revisions (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        provider_profile,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'provider-registry-invalid-fingerprint-shape-row'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'provider-fingerprint-shape-r1'},
        ${'active'},
        ${'   '},
        ${providerProfile}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_provider_registry_revisions_fingerprint_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_provider_registry_revisions (
        id,
        provider_id,
        provider_type,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        provider_profile,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'provider-registry-invalid-timestamp-row'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'provider-timestamp-r1'},
        ${'active'},
        ${'invalidtimestamp3'},
        ${providerProfile}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${new Date(now.getTime() - 60_000)}
      )
    `,
    {
      message: /ai_provider_registry_revisions_timestamp_coherence_check/,
    }
  );

  const repairMetadataRowId = 'provider-registry-repair-metadata-contract-row';
  await db.$executeRaw`
    INSERT INTO ai_provider_registry_revisions (
      id,
      provider_id,
      provider_type,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      provider_profile,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${repairMetadataRowId},
      ${'localmind-db-provider'},
      ${CopilotProviderType.OpenAICompatible},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'repair-provider-metadata-contract'},
      ${'active'},
      ${'repairmetadata22'},
      ${providerProfile}::jsonb,
      ${'[]'}::jsonb,
      ${JSON.stringify({
        version: 'provider-registry-revision-repair-executor/v1',
        publishSource: 'repair_execution_worker',
        credentialBoundary: 'existing_configured_provider_runtime_reused',
        profileFingerprint: 'profile-fp',
        executionRequestId: 'repair-provider-metadata-contract',
        requestFingerprint: 'request-fp',
        candidateEvidenceSetFingerprint: 'candidate-fp',
        taskRouteEvidenceSetFingerprint: 'task-route-fp',
        repairJobFingerprint: 'repair-job-fp',
        approvalRecordFingerprint: 'approval-fp',
        operationFingerprint: 'operation-fp',
        operationSetFingerprint: 'operation-set-fp',
        previewFingerprint: 'preview-fp',
        catalogFingerprint: 'catalog-fp',
        targetLocatorFingerprint: 'target-locator-fp',
        candidateEvidenceFingerprints: ['candidate-evidence-fp'],
      })}::jsonb,
      ${now},
      ${now}
    )
  `;
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_registry_revisions
      SET metadata = metadata - ${'approvalRecordFingerprint'}
      WHERE id = ${repairMetadataRowId}
    `,
    {
      message: /ai_provider_registry_revisions_repair_metadata_evidence_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_registry_revisions
      SET metadata = jsonb_set(
        metadata,
        ${'{candidateEvidenceFingerprints}'}::text[],
        ${'[]'}::jsonb
      )
      WHERE id = ${repairMetadataRowId}
    `,
    {
      message: /ai_provider_registry_revisions_repair_metadata_evidence_check/,
    }
  );

  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_provider_registry_revisions
    WHERE id = ANY(${[
      'provider-registry-invalid-status-row',
      'provider-registry-invalid-scope-row',
      'provider-registry-global-with-workspace-row',
      'provider-registry-workspace-without-workspace-row',
      'provider-registry-invalid-json-shape-row',
      'provider-registry-invalid-source-chain-provenance-row',
      'provider-registry-invalid-source-chain-metadata-row',
      'provider-registry-invalid-payload-json-shape-row',
      'provider-registry-invalid-revision-shape-row',
      'provider-registry-invalid-provider-id-shape-row',
      'provider-registry-invalid-provider-type-shape-row',
      'provider-registry-invalid-fingerprint-shape-row',
      'provider-registry-invalid-timestamp-row',
    ]})
  `;
  t.deepEqual(rows, []);
});

const providerRegistryPrecedenceTestName = [
  'models diagnostics resolve workspace DB-backed provider registry revision',
  'before config/global fallback',
].join(' ');

test(providerRegistryPrecedenceTestName, async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Global DB provider',
    fingerprint: 'globalprovider11',
    id: 'provider-registry-global-localmind',
    privacy: 'private_cloud',
    priority: 55,
    rawModelId: 'global-db-provider-chat-raw',
    revision: 'global-provider-r1',
    scopeType: 'global',
  });
  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Workspace DB provider',
    fingerprint: 'workspaceprovide',
    id: 'provider-registry-workspace-localmind',
    privacy: 'local',
    priority: 155,
    rawModelId: 'workspace-db-provider-chat-raw',
    revision: 'workspace-provider-r2',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  const result = await app.gql({
    query: providerRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const model = result.currentUser.copilot.models.optionalModels.find(
    (item: { id: string }) => item.id === 'db-provider-chat'
  );

  t.truthy(model);
  t.is(model.name, 'Workspace DB provider chat');
  t.is(model.providerId, 'localmind-db-provider');
  t.is(model.providerName, 'Workspace DB provider');
  t.is(model.providerProfileId, 'localmind-db-provider');
  t.is(model.providerProfileSource, 'db_revision');
  t.is(model.providerSource, 'db_revision');
  t.is(
    model.providerProfileConfigPath,
    'ai_provider_registry_revisions[id=provider-registry-workspace-localmind]'
  );
  t.deepEqual(model.providerConfiguredModelIds, [
    'db-provider-chat',
    'db-provider-chat-alias',
  ]);
  t.is(model.providerHealth, 'degraded');
  t.is(model.providerHealthCheckedAt, configuredProviderHealthCheckedAt);
  t.is(model.providerHealthLastError, 'configured provider health snapshot');
  t.is(model.providerPrivacy, 'local');
  t.is(model.providerPriority, 155);
  t.is(model.routeModelId, 'workspace-db-provider-chat-raw');
  t.is(model.routeRawModelId, 'workspace-db-provider-chat-raw');
  t.is(model.routeModelDefinitionId, 'db-provider-chat');
  t.is(model.routeModelDefinitionSource, 'provider_profile');
  t.deepEqual(model.routeModelDefinitionAliases, ['db-provider-chat-alias']);
  t.deepEqual(model.routeInputTypes, ['text']);
  t.deepEqual(model.routeOutputTypes, ['text']);
  t.regex(model.effectiveSourceFingerprint, /^[a-f0-9]{16}$/);
  t.true(
    model.effectiveSourceFingerprintInputs.includes('providerProfileSource')
  );
});

test('provider health state persists and overlays effective provider routing', async t => {
  const { app, db, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const otherWorkspace = await createWorkspace(app);

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Health DB provider',
    fingerprint: 'healthprovider1',
    id: 'provider-registry-health-state',
    privacy: 'local',
    priority: 165,
    rawModelId: 'health-db-provider-chat-raw',
    revision: 'workspace-provider-health-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  const downResult = await app.gql({
    query: providerHealthStateMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        providerId: 'localmind-db-provider',
        status: 'down',
        lastError: 'provider probe timed out',
      },
    },
  });
  const downState = downResult.recordCopilotProviderHealthState;
  t.is(downState.providerId, 'localmind-db-provider');
  t.is(downState.providerType, CopilotProviderType.OpenAICompatible);
  t.is(downState.scopeType, 'workspace');
  t.is(downState.workspaceId, workspace.id);
  t.is(downState.actorId, owner.id);
  t.is(downState.status, 'down');
  t.is(downState.lastError, 'provider probe timed out');
  t.is(downState.source, 'manual_override');
  t.regex(downState.fingerprint, /^[a-f0-9]{16}$/);
  t.is(downState.eventCount, 1);
  t.is(downState.events.length, 1);
  t.like(downState.events[0], {
    actorId: owner.id,
    eventType: 'manual_override_recorded',
    lastError: 'provider probe timed out',
    providerId: 'localmind-db-provider',
    providerType: CopilotProviderType.OpenAICompatible,
    scopeType: 'workspace',
    source: 'manual_override',
    stateFingerprint: downState.fingerprint,
    stateId: downState.id,
    status: 'down',
    workspaceId: workspace.id,
  });
  t.deepEqual(downState.events[0].metadata, {
    version: 'provider-health-state-metadata/v1',
    providerProfileSource: 'configured',
    publishSource: 'graphql_mutation',
  });
  t.regex(downState.events[0].fingerprint, /^[a-f0-9]{16}$/);

  const downRows = await db.$queryRaw<
    Array<{
      lastError: string | null;
      metadata: Record<string, unknown>;
      status: string;
      workspaceId: string | null;
    }>
  >`
    SELECT
      last_error AS "lastError",
      metadata,
      status,
      workspace_id AS "workspaceId"
    FROM ai_provider_health_states
    WHERE id = ${downState.id}
  `;
  t.deepEqual(downRows, [
    {
      lastError: 'provider probe timed out',
      metadata: {
        version: 'provider-health-state-metadata/v1',
        providerProfileSource: 'configured',
        publishSource: 'graphql_mutation',
      },
      status: 'down',
      workspaceId: workspace.id,
    },
  ]);

  const downEventRows = await db.$queryRaw<
    Array<{
      eventType: string;
      fingerprint: string;
      metadata: Record<string, unknown>;
      providerId: string;
      scopeType: string;
      source: string;
      stateFingerprint: string;
      stateId: string | null;
      status: string;
      workspaceId: string | null;
    }>
  >`
    SELECT
      event_type AS "eventType",
      fingerprint,
      metadata,
      provider_id AS "providerId",
      scope_type AS "scopeType",
      source,
      state_fingerprint AS "stateFingerprint",
      state_id AS "stateId",
      status,
      workspace_id AS "workspaceId"
    FROM ai_provider_health_events
    WHERE state_id = ${downState.id}
    ORDER BY created_at ASC
  `;
  t.deepEqual(downEventRows, [
    {
      eventType: 'manual_override_recorded',
      fingerprint: downEventRows[0].fingerprint,
      metadata: {
        version: 'provider-health-state-metadata/v1',
        providerProfileSource: 'configured',
        publishSource: 'graphql_mutation',
      },
      providerId: 'localmind-db-provider',
      scopeType: 'workspace',
      source: 'manual_override',
      stateFingerprint: downState.fingerprint,
      stateId: downState.id,
      status: 'down',
      workspaceId: workspace.id,
    },
  ]);
  t.regex(downEventRows[0].fingerprint, /^[a-f0-9]{16}$/);

  await db.$executeRaw`
    UPDATE ai_provider_health_events
    SET metadata = metadata
    WHERE id = ${downState.events[0].id}
  `;
  await db.$executeRaw`
    UPDATE ai_provider_health_states
    SET updated_at = updated_at
    WHERE id = ${downState.id}
  `;
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET
        status = ${'healthy'},
        last_error = ${null},
        fingerprint = ${'0123456789abcdef'},
        checked_at = ${new Date('2026-06-21T11:02:00.000Z')},
        updated_at = ${new Date('2026-06-21T11:02:00.000Z')}
      WHERE id = ${downState.id}
    `,
    {
      message: /ai_provider_health_states_event_history_required_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_events
      SET metadata =
        metadata || ${JSON.stringify({ rewrittenAfterPersist: true })}::jsonb
      WHERE id = ${downState.events[0].id}
    `,
    {
      message: /ai_provider_health_events_content_update_restrict_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_events
      SET fingerprint = ${'0123456789abcdef'}
      WHERE id = ${downState.events[0].id}
    `,
    {
      message: /ai_provider_health_events_content_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$transaction(async tx => {
      await tx.$executeRaw`
        DELETE FROM ai_provider_health_events
        WHERE id = ${downState.events[0].id}
      `;
      await tx.$executeRaw`
        SET CONSTRAINTS "zz_ai_provider_health_events_delete_restrict_check" IMMEDIATE
      `;
    }),
    {
      message: /ai_provider_health_events_delete_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$transaction(async tx => {
      await tx.$executeRaw`
        DELETE FROM ai_provider_health_states
        WHERE id = ${downState.id}
      `;
      await tx.$executeRaw`
        SET CONSTRAINTS "zz_ai_provider_health_events_delete_restrict_check" IMMEDIATE
      `;
    }),
    {
      message: /ai_provider_health_states_delete_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$transaction(async tx => {
      await tx.$executeRaw`
        DELETE FROM ai_provider_health_events
        WHERE id = ${downState.events[0].id}
      `;
      await tx.$executeRaw`
        DELETE FROM ai_provider_health_states
        WHERE id = ${downState.id}
      `;
      await tx.$executeRaw`
        SET CONSTRAINTS "zz_ai_provider_health_events_delete_restrict_check" IMMEDIATE
      `;
    }),
    {
      message: /ai_provider_health_events_delete_restrict_check/,
    }
  );

  const cascadeWorkspace = await createWorkspace(app);
  const cascadeState =
    await models.copilotProviderHealthState.upsertWorkspaceState({
      workspaceId: cascadeWorkspace.id,
      actorId: owner.id,
      providerId: 'provider-health-state-delete-cascade-provider',
      providerType: CopilotProviderType.OpenAICompatible,
      status: 'healthy',
      checkedAt: '2026-06-21T11:03:00.000Z',
      source: 'manual_override',
      providerProfileSource: 'db_revision',
    });
  const cascadeEventId = cascadeState.events[0].id;
  await db.$executeRaw`
    DELETE FROM workspaces
    WHERE id = ${cascadeWorkspace.id}
  `;
  const cascadeRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_states
    WHERE id = ${cascadeState.id}
  `;
  t.deepEqual(cascadeRows, [{ count: 0 }]);
  const cascadeEventRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_events
    WHERE id = ${cascadeEventId}
  `;
  t.deepEqual(cascadeEventRows, [{ count: 0 }]);

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET status = ${'recovering'}
      WHERE id = ${downState.id}
    `,
    { message: /ai_provider_health_states_status_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET source = ${'manual_probe'}
      WHERE id = ${downState.id}
    `,
    {
      message:
        /ai_provider_health_states_(source|cleanup_metadata_contract)_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET scope_type = ${'global'}
      WHERE id = ${downState.id}
    `,
    { message: /ai_provider_health_states_scope_workspace_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET metadata = ${JSON.stringify(['not-metadata'])}::jsonb
      WHERE id = ${downState.id}
    `,
    {
      message:
        /ai_provider_health_states_(metadata_shape|metadata_contract)_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET metadata = ${JSON.stringify({
        publishSource: 'graphql_mutation',
      })}::jsonb
      WHERE id = ${downState.id}
    `,
    {
      message:
        /ai_provider_health_states_(metadata_contract|cleanup_metadata_contract)_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET metadata = ${JSON.stringify({
        version: 'provider-health-state-metadata/v1',
        publishSource: 'configured_provider_health_snapshot_worker',
      })}::jsonb
      WHERE id = ${downState.id}
    `,
    {
      message:
        /ai_provider_health_states_(metadata_contract|cleanup_metadata_contract)_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
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
        ${'provider-health-invalid-snapshot-metadata'},
        ${'invalid-snapshot-health-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${null},
        ${'degraded'},
        ${new Date('2026-06-21T11:10:00.000Z')},
        ${'configured provider health snapshot'},
        ${'probe_result'},
        ${'invalidsnapshot1'},
        ${JSON.stringify({
          version: 'provider-health-state-metadata/v1',
          providerProfileSource: 'configured',
          publishSource: 'configured_provider_health_snapshot_worker',
          providerProfileSnapshotSource: 'configured',
        })}::jsonb,
        ${new Date('2026-06-21T11:10:00.000Z')},
        ${new Date('2026-06-21T11:10:00.000Z')}
      )
    `,
    {
      message: /ai_provider_health_states_cleanup_metadata_contract_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
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
        ${'provider-health-direct-insert-without-event'},
        ${'direct-insert-health-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'workspace'},
        ${workspace.id},
        ${owner.id},
        ${'down'},
        ${new Date('2026-06-21T11:11:00.000Z')},
        ${'direct insert without event history'},
        ${'manual_override'},
        ${'directinsert001'},
        ${JSON.stringify({
          version: 'provider-health-state-metadata/v1',
          providerProfileSource: 'db_revision',
          publishSource: 'graphql_mutation',
        })}::jsonb,
        ${new Date('2026-06-21T11:11:00.000Z')},
        ${new Date('2026-06-21T11:11:00.000Z')}
      )
    `,
    {
      message: /ai_provider_health_states_event_history_required_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
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
        ${'provider-health-event-type-source-drift'},
        ${downState.id},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'workspace'},
        ${workspace.id},
        ${owner.id},
        ${'down'},
        ${new Date('2026-06-21T11:15:00.000Z')},
        ${'provider probe timed out'},
        ${'probe_result'},
        ${'manual_override_recorded'},
        ${'eventtypedrift1'},
        ${downState.fingerprint},
        ${JSON.stringify({
          version: 'provider-health-state-metadata/v1',
          providerProfileSource: 'db_revision',
          publishSource: 'workspace_provider_health_probe_result',
          providerProfileId: 'localmind-db-provider',
        })}::jsonb,
        ${new Date('2026-06-21T11:15:00.000Z')}
      )
    `,
    {
      message: /ai_provider_health_events_event_type_source_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
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
        ${'provider-health-event-missing-state'},
        ${null},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'workspace'},
        ${workspace.id},
        ${owner.id},
        ${'down'},
        ${new Date('2026-06-21T11:16:00.000Z')},
        ${'provider probe timed out'},
        ${'manual_override'},
        ${'manual_override_recorded'},
        ${'missingstate001'},
        ${downState.fingerprint},
        ${JSON.stringify({
          version: 'provider-health-state-metadata/v1',
          providerProfileSource: 'db_revision',
          publishSource: 'graphql_mutation',
        })}::jsonb,
        ${new Date('2026-06-21T11:16:00.000Z')}
      )
    `,
    {
      message: /ai_provider_health_events_state_id_present_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
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
        ${'provider-health-event-orphan-state'},
        ${'missing-provider-health-state'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'workspace'},
        ${workspace.id},
        ${owner.id},
        ${'down'},
        ${new Date('2026-06-21T11:17:00.000Z')},
        ${'provider probe timed out'},
        ${'manual_override'},
        ${'manual_override_recorded'},
        ${'orphanstate001'},
        ${downState.fingerprint},
        ${JSON.stringify({
          version: 'provider-health-state-metadata/v1',
          providerProfileSource: 'db_revision',
          publishSource: 'graphql_mutation',
        })}::jsonb,
        ${new Date('2026-06-21T11:17:00.000Z')}
      )
    `,
    {
      message: /ai_provider_health_events_state_id_fkey/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
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
        ${'provider-health-event-state-scope-drift'},
        ${downState.id},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'down'},
        ${new Date('2026-06-21T11:18:00.000Z')},
        ${'provider probe timed out'},
        ${'manual_override'},
        ${'manual_override_recorded'},
        ${'statescopedrift1'},
        ${downState.fingerprint},
        ${JSON.stringify({
          version: 'provider-health-state-metadata/v1',
          providerProfileSource: 'db_revision',
          publishSource: 'graphql_mutation',
        })}::jsonb,
        ${new Date('2026-06-21T11:18:00.000Z')}
      )
    `,
    {
      message: /ai_provider_health_events_state_identity_fkey/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
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
        ${'provider-health-event-state-workspace-drift'},
        ${downState.id},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'workspace'},
        ${otherWorkspace.id},
        ${owner.id},
        ${'down'},
        ${new Date('2026-06-21T11:19:00.000Z')},
        ${'provider probe timed out'},
        ${'manual_override'},
        ${'manual_override_recorded'},
        ${'stateworkspacedrift1'},
        ${downState.fingerprint},
        ${JSON.stringify({
          version: 'provider-health-state-metadata/v1',
          providerProfileSource: 'db_revision',
          publishSource: 'graphql_mutation',
        })}::jsonb,
        ${new Date('2026-06-21T11:19:00.000Z')}
      )
    `,
    {
      message: /ai_provider_health_events_state_workspace_fkey/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_events
      SET state_fingerprint = ${'eventstatedrift1'}
      WHERE id = ${downState.events[0].id}
    `,
    {
      message: /ai_provider_health_events_write_snapshot_check/,
    }
  );

  const driftActor = await app.createUser();
  await t.throwsAsync(
    db.$executeRaw`
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
        ${'provider-health-event-state-actor-drift'},
        ${downState.id},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'workspace'},
        ${workspace.id},
        ${driftActor.id},
        ${'down'},
        ${new Date('2026-06-21T11:20:00.000Z')},
        ${'provider probe timed out'},
        ${'manual_override'},
        ${'manual_override_recorded'},
        ${'stateactordrift1'},
        ${downState.fingerprint},
        ${JSON.stringify({
          version: 'provider-health-state-metadata/v1',
          providerProfileSource: 'db_revision',
          publishSource: 'graphql_mutation',
        })}::jsonb,
        ${new Date('2026-06-21T11:20:00.000Z')}
      )
    `,
    {
      message: /ai_provider_health_events_write_snapshot_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET provider_id = ${'  '}
      WHERE id = ${downState.id}
    `,
    { message: /ai_provider_health_states_identity_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET provider_type = ${'  '}
      WHERE id = ${downState.id}
    `,
    { message: /ai_provider_health_states_identity_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET last_error = ${'  '}
      WHERE id = ${downState.id}
    `,
    { message: /ai_provider_health_states_last_error_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET fingerprint = ${'  '}
      WHERE id = ${downState.id}
    `,
    { message: /ai_provider_health_states_fingerprint_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET updated_at = ${new Date('2026-06-21T10:59:00.000Z')}
      WHERE id = ${downState.id}
    `,
    {
      message: /ai_provider_health_states_timestamp_coherence_check/,
    }
  );

  const probeOverrideState =
    await models.copilotProviderHealthState.upsertWorkspaceState({
      workspaceId: workspace.id,
      actorId: owner.id,
      providerId: 'metadata-override-probe-provider',
      providerType: CopilotProviderType.OpenAICompatible,
      status: 'degraded',
      source: 'probe_result',
      checkedAt: '2026-06-21T11:05:00.000Z',
      lastError: 'workspace probe latency high',
      providerProfileSource: 'db_revision',
      metadata: {
        providerProfileId: 'metadata-override-probe-provider',
        publishSource: 'graphql_mutation',
        version: 'malformed-provider-health-metadata/v0',
      },
    });
  t.is(
    probeOverrideState.metadata.version,
    'provider-health-state-metadata/v1'
  );
  t.is(
    probeOverrideState.metadata.publishSource,
    'workspace_provider_health_probe_result'
  );

  const downModelsResult = await app.gql({
    query: providerRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const downModel =
    downModelsResult.currentUser.copilot.models.optionalModels.find(
      (item: { id: string }) => item.id === 'db-provider-chat'
    );
  t.falsy(downModel);

  const healthyResult = await app.gql({
    query: providerHealthStateMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        providerId: 'localmind-db-provider',
        status: 'healthy',
      },
    },
  });
  const healthyState = healthyResult.recordCopilotProviderHealthState;
  t.is(healthyState.id, downState.id);
  t.is(healthyState.status, 'healthy');
  t.is(healthyState.lastError, null);
  t.is(healthyState.eventCount, 2);
  t.is(healthyState.events.length, 2);
  t.like(healthyState.events[0], {
    eventType: 'manual_override_recorded',
    lastError: null,
    providerId: 'localmind-db-provider',
    stateFingerprint: healthyState.fingerprint,
    stateId: healthyState.id,
    status: 'healthy',
  });
  t.like(healthyState.events[1], {
    eventType: 'manual_override_recorded',
    lastError: 'provider probe timed out',
    providerId: 'localmind-db-provider',
    stateFingerprint: downState.fingerprint,
    stateId: downState.id,
    status: 'down',
  });

  const healthyModelsResult = await app.gql({
    query: providerRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const healthyModel =
    healthyModelsResult.currentUser.copilot.models.optionalModels.find(
      (item: { id: string }) => item.id === 'db-provider-chat'
    );
  t.truthy(healthyModel);
  t.is(healthyModel.providerHealth, 'healthy');
  t.truthy(healthyModel.providerHealthCheckedAt);
  t.is(healthyModel.providerHealthLastError, null);

  const outsider = await app.signupV1();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: providerHealthStateMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          providerId: 'localmind-db-provider',
          status: 'degraded',
        },
      },
    })
  );
});

test('provider health workspace upsert overwrites rows inserted between update and insert', async t => {
  const { app, db, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const providerId = 'provider-health-workspace-upsert-conflict';
  const staleCheckedAt = new Date('2026-06-21T11:20:00.000Z');
  const staleMetadata = {
    version: 'provider-health-state-metadata/v1',
    providerProfileSource: 'db_revision',
    publishSource: 'graphql_mutation',
  };
  const staleFingerprint = providerHealthStateFingerprint({
    version: 'provider-health-state/v1',
    workspaceId: workspace.id,
    providerId,
    providerType: CopilotProviderType.OpenAICompatible,
    status: 'down',
    checkedAt: staleCheckedAt.toISOString(),
    lastError: 'stale pre-insert health',
    source: 'manual_override',
  });
  const staleId = `provider-health-state-${providerHealthStateFingerprint({
    version: 'provider-health-state-row-id/v1',
    workspaceId: workspace.id,
    providerId,
  })}`;
  const providerHealthStateModel = models.copilotProviderHealthState;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(providerHealthStateModel),
    'db'
  );
  let insertedStaleRowBeforeUpsert = false;

  let state;
  try {
    Object.defineProperty(providerHealthStateModel, 'db', {
      configurable: true,
      get() {
        const client = originalDbDescriptor?.get?.call(this) as PrismaClient;
        const originalQueryRaw = client.$queryRaw.bind(client);
        const originalExecuteRaw = client.$executeRaw.bind(client);
        const insertStaleRow = async (
          patchedClient: Pick<PrismaClient, '$executeRaw'>
        ) => {
          if (insertedStaleRowBeforeUpsert) {
            return;
          }
          insertedStaleRowBeforeUpsert = true;
          await insertProviderHealthStateWithEvent({
            actorId: owner.id,
            checkedAt: staleCheckedAt,
            db: patchedClient,
            eventType: 'manual_override_recorded',
            fingerprint: staleFingerprint,
            id: staleId,
            lastError: 'stale pre-insert health',
            metadata: staleMetadata,
            providerId,
            providerType: CopilotProviderType.OpenAICompatible,
            scopeType: 'workspace',
            source: 'manual_override',
            status: 'down',
            workspaceId: workspace.id,
          });
        };
        const patchedClient = {
          ...client,
          $executeRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            if (
              strings
                .join('?')
                .includes('INSERT INTO ai_provider_health_states')
            ) {
              await insertStaleRow(patchedClient);
            }
            return await originalExecuteRaw(strings, ...values);
          }) as typeof client.$executeRaw,
          $queryRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            if (
              strings
                .join('?')
                .includes('INSERT INTO ai_provider_health_states')
            ) {
              await insertStaleRow(patchedClient);
            }
            return await originalQueryRaw(strings, ...values);
          }) as typeof client.$queryRaw,
        } as PrismaClient;
        return patchedClient;
      },
    });
    state = await providerHealthStateModel.upsertWorkspaceState({
      workspaceId: workspace.id,
      actorId: owner.id,
      providerId,
      providerType: CopilotProviderType.OpenAICompatible,
      status: 'healthy',
      checkedAt: '2026-06-21T11:21:00.000Z',
      source: 'manual_override',
      providerProfileSource: 'db_revision',
    });
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        providerHealthStateModel,
        'db',
        originalDbDescriptor
      );
    }
  }

  t.true(insertedStaleRowBeforeUpsert);
  t.is(state.id, staleId);
  t.is(state.status, 'healthy');
  t.is(state.lastError, undefined);
  t.is(state.checkedAt.toISOString(), '2026-06-21T11:21:00.000Z');
  t.is(state.eventCount, 2);

  const rows = await db.$queryRaw<
    Array<{
      checkedAt: Date;
      eventCount: number;
      matchingCurrentStateEventCount: number;
      lastError: string | null;
      status: string;
    }>
  >`
    SELECT
      state.status,
      state.checked_at AS "checkedAt",
      state.last_error AS "lastError",
      (
        SELECT COUNT(*)::int
        FROM ai_provider_health_events event
        WHERE event.state_id = state.id
      ) AS "eventCount",
      (
        SELECT COUNT(*)::int
        FROM ai_provider_health_events event
        WHERE event.state_id = state.id
          AND event.state_fingerprint = state.fingerprint
      ) AS "matchingCurrentStateEventCount"
    FROM ai_provider_health_states state
    WHERE state.id = ${staleId}
  `;
  t.deepEqual(rows, [
    {
      checkedAt: new Date('2026-06-21T11:21:00.000Z'),
      eventCount: 2,
      lastError: null,
      matchingCurrentStateEventCount: 1,
      status: 'healthy',
    },
  ]);
});

test('provider health global upsert overwrites rows inserted between update and insert', async t => {
  const { app, db } = t.context;
  const models = app.get(Models);
  const providerId = 'provider-health-global-upsert-conflict';
  const staleCheckedAt = new Date('2026-06-21T11:22:00.000Z');
  const staleMetadata = {
    version: 'provider-health-state-metadata/v1',
    providerProfileSource: 'configured',
    publishSource: 'configured_provider_health_snapshot_worker',
    providerProfileId: providerId,
    providerProfileSnapshotSource: 'configured',
  };
  const staleFingerprint = providerHealthStateFingerprint({
    version: 'provider-health-state/v1',
    scopeType: 'global',
    providerId,
    providerType: CopilotProviderType.OpenAICompatible,
    status: 'degraded',
    checkedAt: staleCheckedAt.toISOString(),
    lastError: 'stale configured health',
    source: 'probe_result',
  });
  const staleId = `provider-health-state-${providerHealthStateFingerprint({
    version: 'provider-health-state-row-id/v1',
    scopeType: 'global',
    providerId,
  })}`;
  const providerHealthStateModel = models.copilotProviderHealthState;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(providerHealthStateModel),
    'db'
  );
  let insertedStaleRowBeforeUpsert = false;

  let state;
  try {
    Object.defineProperty(providerHealthStateModel, 'db', {
      configurable: true,
      get() {
        const client = originalDbDescriptor?.get?.call(this) as PrismaClient;
        const originalQueryRaw = client.$queryRaw.bind(client);
        const originalExecuteRaw = client.$executeRaw.bind(client);
        const insertStaleRow = async (
          patchedClient: Pick<PrismaClient, '$executeRaw'>
        ) => {
          if (insertedStaleRowBeforeUpsert) {
            return;
          }
          insertedStaleRowBeforeUpsert = true;
          await insertProviderHealthStateWithEvent({
            checkedAt: staleCheckedAt,
            db: patchedClient,
            eventType: 'configured_snapshot_recorded',
            fingerprint: staleFingerprint,
            id: staleId,
            lastError: 'stale configured health',
            metadata: staleMetadata,
            providerId,
            providerType: CopilotProviderType.OpenAICompatible,
            scopeType: 'global',
            source: 'probe_result',
            status: 'degraded',
          });
        };
        const patchedClient = {
          ...client,
          $executeRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            if (
              strings
                .join('?')
                .includes('INSERT INTO ai_provider_health_states')
            ) {
              await insertStaleRow(patchedClient);
            }
            return await originalExecuteRaw(strings, ...values);
          }) as typeof client.$executeRaw,
          $queryRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            if (
              strings
                .join('?')
                .includes('INSERT INTO ai_provider_health_states')
            ) {
              await insertStaleRow(patchedClient);
            }
            return await originalQueryRaw(strings, ...values);
          }) as typeof client.$queryRaw,
        } as PrismaClient;
        return patchedClient;
      },
    });
    state = await providerHealthStateModel.upsertGlobalProbeState({
      providerId,
      providerType: CopilotProviderType.OpenAICompatible,
      status: 'healthy',
      checkedAt: '2026-06-21T11:23:00.000Z',
      lastError: null,
      providerProfileSource: 'configured',
      metadata: {
        providerProfileId: providerId,
        providerProfileSnapshotSource: 'configured',
      },
    });
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        providerHealthStateModel,
        'db',
        originalDbDescriptor
      );
    }
  }

  t.true(insertedStaleRowBeforeUpsert);
  t.is(state.id, staleId);
  t.is(state.status, 'healthy');
  t.is(state.lastError, undefined);
  t.is(state.checkedAt.toISOString(), '2026-06-21T11:23:00.000Z');
  t.is(state.eventCount, 2);

  const rows = await db.$queryRaw<
    Array<{
      checkedAt: Date;
      eventCount: number;
      matchingCurrentStateEventCount: number;
      lastError: string | null;
      status: string;
    }>
  >`
    SELECT
      state.status,
      state.checked_at AS "checkedAt",
      state.last_error AS "lastError",
      (
        SELECT COUNT(*)::int
        FROM ai_provider_health_events event
        WHERE event.state_id = state.id
      ) AS "eventCount",
      (
        SELECT COUNT(*)::int
        FROM ai_provider_health_events event
        WHERE event.state_id = state.id
          AND event.state_fingerprint = state.fingerprint
      ) AS "matchingCurrentStateEventCount"
    FROM ai_provider_health_states state
    WHERE state.id = ${staleId}
  `;
  t.deepEqual(rows, [
    {
      checkedAt: new Date('2026-06-21T11:23:00.000Z'),
      eventCount: 2,
      lastError: null,
      matchingCurrentStateEventCount: 1,
      status: 'healthy',
    },
  ]);
});

test('provider health event insert rejects mismatched conflict evidence', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const providerHealthStateModel = models.copilotProviderHealthState;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(providerHealthStateModel),
    'db'
  );
  let insertedDriftedEventBeforeInsert = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertProviderHealthEventWithDriftedMetadata>
  > | null = null;

  try {
    Object.defineProperty(providerHealthStateModel, 'db', {
      configurable: true,
      get() {
        const client = originalDbDescriptor?.get?.call(this) as PrismaClient;
        const originalQueryRaw = client.$queryRaw.bind(client);
        const originalExecuteRaw = client.$executeRaw.bind(client);
        const rawInsertClient = {
          $executeRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            return await originalExecuteRaw(strings, ...values);
          }) as typeof client.$executeRaw,
        };
        const patchedClient = {
          ...client,
          $queryRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            if (
              !insertedDriftedEventBeforeInsert &&
              strings
                .join('?')
                .includes('INSERT INTO ai_provider_health_events')
            ) {
              insertedDriftedEventBeforeInsert = true;
              conflictFixture =
                await insertProviderHealthEventWithDriftedMetadata({
                  db: rawInsertClient,
                  values,
                });
            }
            return await originalQueryRaw(strings, ...values);
          }) as typeof client.$queryRaw,
        } as PrismaClient;
        return patchedClient;
      },
    });

    await t.throwsAsync(
      providerHealthStateModel.upsertWorkspaceState({
        workspaceId: workspace.id,
        actorId: owner.id,
        providerId: 'provider-health-event-conflict-provider',
        providerType: CopilotProviderType.OpenAICompatible,
        status: 'healthy',
        checkedAt: '2026-06-23T10:30:00.000Z',
        source: 'manual_override',
        providerProfileSource: 'db_revision',
      }),
      {
        message:
          /Provider health event conflict reused mismatched event evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        providerHealthStateModel,
        'db',
        originalDbDescriptor
      );
    }
  }

  t.true(insertedDriftedEventBeforeInsert);
  t.truthy(conflictFixture);
  t.not(
    conflictFixture!.driftedEventFingerprint,
    conflictFixture!.expectedEventFingerprint
  );
});

test('provider health worker persists configured profile health as global DB overlay', async t => {
  const { app, db, owner, providerHealthWorker } = t.context;
  const workspace = await createWorkspace(app);

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Configured health DB provider',
    fingerprint: 'configuredhealth',
    id: 'provider-registry-configured-health-overlay',
    privacy: 'private_cloud',
    priority: 65,
    rawModelId: 'configured-health-db-provider-chat-raw',
    revision: 'configured-health-provider-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  const signal = await providerHealthWorker.persistConfiguredSnapshots();
  t.is(signal, 'done');

  const rows = await db.$queryRaw<
    Array<{
      actorId: string | null;
      lastError: string | null;
      metadata: Record<string, unknown>;
      providerId: string;
      scopeType: string;
      source: string;
      status: string;
      workspaceId: string | null;
    }>
  >`
    SELECT
      actor_id AS "actorId",
      last_error AS "lastError",
      metadata,
      provider_id AS "providerId",
      scope_type AS "scopeType",
      source,
      status,
      workspace_id AS "workspaceId"
    FROM ai_provider_health_states
    WHERE provider_id = ${'localmind-db-provider'}
      AND scope_type = ${'global'}
  `;
  t.deepEqual(rows, [
    {
      actorId: null,
      lastError: 'configured provider health snapshot',
      metadata: {
        version: 'provider-health-state-metadata/v1',
        providerProfileSource: 'configured',
        publishSource: 'configured_provider_health_snapshot_worker',
        providerProfileConfigPath:
          'copilot.providers.profiles[id=localmind-db-provider]',
        providerProfileId: 'localmind-db-provider',
        providerProfileSnapshotSource: 'configured',
      },
      providerId: 'localmind-db-provider',
      scopeType: 'global',
      source: 'probe_result',
      status: 'degraded',
      workspaceId: null,
    },
  ]);

  const snapshotEventRows = await db.$queryRaw<
    Array<{
      actorId: string | null;
      eventType: string;
      fingerprint: string;
      metadata: Record<string, unknown>;
      providerId: string;
      scopeType: string;
      source: string;
      stateFingerprint: string;
      status: string;
      workspaceId: string | null;
    }>
  >`
    SELECT
      actor_id AS "actorId",
      event_type AS "eventType",
      fingerprint,
      metadata,
      provider_id AS "providerId",
      scope_type AS "scopeType",
      source,
      state_fingerprint AS "stateFingerprint",
      status,
      workspace_id AS "workspaceId"
    FROM ai_provider_health_events
    WHERE provider_id = ${'localmind-db-provider'}
      AND event_type = ${'configured_snapshot_recorded'}
    ORDER BY created_at ASC
  `;
  t.deepEqual(snapshotEventRows, [
    {
      actorId: null,
      eventType: 'configured_snapshot_recorded',
      fingerprint: snapshotEventRows[0].fingerprint,
      metadata: rows[0].metadata,
      providerId: 'localmind-db-provider',
      scopeType: 'global',
      source: 'probe_result',
      stateFingerprint: snapshotEventRows[0].stateFingerprint,
      status: 'degraded',
      workspaceId: null,
    },
  ]);
  t.regex(snapshotEventRows[0].fingerprint, /^[a-f0-9]{16}$/);
  t.regex(snapshotEventRows[0].stateFingerprint, /^[a-f0-9]{16}$/);

  const result = await app.gql({
    query: providerRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const model = result.currentUser.copilot.models.optionalModels.find(
    (item: { id: string }) => item.id === 'db-provider-chat'
  );
  t.truthy(model);
  t.is(model.providerHealth, 'degraded');
  t.is(model.providerHealthCheckedAt, configuredProviderHealthCheckedAt);
  t.is(model.providerHealthLastError, 'configured provider health snapshot');

  await providerHealthWorker.persistConfiguredSnapshots();
  const countRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_states
    WHERE provider_id = ${'localmind-db-provider'}
      AND scope_type = ${'global'}
  `;
  t.is(countRows[0]?.count, 1);
  const eventCountRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_events
    WHERE provider_id = ${'localmind-db-provider'}
      AND event_type = ${'configured_snapshot_recorded'}
  `;
  t.is(eventCountRows[0]?.count, 1);
});

test('provider health worker clears stale configured snapshot global overlays', async t => {
  const { app, db, owner, providerHealthWorker } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Configured cleanup DB provider',
    fingerprint: 'configuredclean',
    id: 'provider-registry-configured-cleanup-overlay',
    privacy: 'private_cloud',
    priority: 75,
    rawModelId: 'configured-cleanup-db-provider-chat-raw',
    revision: 'configured-cleanup-provider-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  await models.copilotProviderHealthState.upsertGlobalProbeState({
    providerId: 'stale-configured-health-provider',
    providerType: CopilotProviderType.OpenAICompatible,
    status: 'down',
    checkedAt: '2026-06-21T10:00:00.000Z',
    lastError: 'stale configured health snapshot',
    providerProfileSource: 'configured',
    metadata: {
      providerProfileId: 'stale-configured-health-provider',
      providerProfileSnapshotSource: 'configured',
    },
  });

  const signal = await providerHealthWorker.persistConfiguredSnapshots();
  t.is(signal, 'done');

  const rows = await db.$queryRaw<
    Array<{
      lastError: string | null;
      metadata: Record<string, unknown>;
      source: string;
      status: string;
    }>
  >`
    SELECT
      last_error AS "lastError",
      metadata,
      source,
      status
    FROM ai_provider_health_states
    WHERE provider_id = ${'stale-configured-health-provider'}
      AND scope_type = ${'global'}
  `;
  t.deepEqual(rows, [
    {
      lastError: null,
      metadata: {
        version: 'provider-health-state-metadata/v1',
        providerProfileSource: 'configured',
        publishSource: 'configured_provider_health_snapshot_cleanup_worker',
        providerProfileId: 'stale-configured-health-provider',
        providerProfileSnapshotCleanupReason:
          'configured_provider_health_snapshot_missing',
        previousCheckedAt: '2026-06-21T10:00:00.000Z',
        previousFingerprint: rows[0].metadata.previousFingerprint,
        previousLastError: 'stale configured health snapshot',
        previousPublishSource: 'configured_provider_health_snapshot_worker',
        previousStatus: 'down',
      },
      source: 'probe_result',
      status: 'unknown',
    },
  ]);
  t.is(typeof rows[0].metadata.previousFingerprint, 'string');

  const cleanupEventRows = await db.$queryRaw<
    Array<{
      eventType: string;
      metadata: Record<string, unknown>;
      providerId: string;
      scopeType: string;
      source: string;
      stateFingerprint: string;
      status: string;
    }>
  >`
    SELECT
      event_type AS "eventType",
      metadata,
      provider_id AS "providerId",
      scope_type AS "scopeType",
      source,
      state_fingerprint AS "stateFingerprint",
      status
    FROM ai_provider_health_events
    WHERE provider_id = ${'stale-configured-health-provider'}
    ORDER BY created_at ASC
  `;
  t.deepEqual(
    cleanupEventRows.map(row => row.eventType),
    ['configured_snapshot_recorded', 'configured_snapshot_cleared']
  );
  t.like(cleanupEventRows[1], {
    eventType: 'configured_snapshot_cleared',
    metadata: rows[0].metadata,
    providerId: 'stale-configured-health-provider',
    scopeType: 'global',
    source: 'probe_result',
    status: 'unknown',
  });
  t.regex(cleanupEventRows[1].stateFingerprint, /^[a-f0-9]{16}$/);

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET metadata = metadata - ${'previousFingerprint'}
      WHERE provider_id = ${'stale-configured-health-provider'}
        AND scope_type = ${'global'}
    `,
    {
      message: /ai_provider_health_states_cleanup_metadata_contract_check/,
    }
  );

  const result = await app.gql({
    query: providerRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const model = result.currentUser.copilot.models.optionalModels.find(
    (item: { id: string }) => item.id === 'db-provider-chat'
  );
  t.truthy(model);
  t.is(model.providerHealth, 'degraded');
});

test('stale provider health probe results do not drive route overlays', async t => {
  const { app, db, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const now = new Date();
  const staleCheckedAt = new Date(
    now.getTime() - PROVIDER_HEALTH_STATE_PROBE_RESULT_MAX_AGE_MS - 1000
  );

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Stale health DB provider',
    fingerprint: 'stalehealth111',
    id: 'provider-registry-stale-health-overlay',
    privacy: 'local',
    priority: 175,
    rawModelId: 'stale-health-db-provider-chat-raw',
    revision: 'workspace-provider-stale-health-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });
  await models.copilotProviderHealthState.upsertWorkspaceState({
    workspaceId: workspace.id,
    actorId: owner.id,
    providerId: 'localmind-db-provider',
    providerType: CopilotProviderType.OpenAICompatible,
    status: 'down',
    source: 'probe_result',
    checkedAt: staleCheckedAt,
    lastError: 'stale workspace probe timeout',
    providerProfileSource: 'db_revision',
    metadata: {
      providerProfileId: 'localmind-db-provider',
    },
  });

  const staleOverlays =
    await models.copilotProviderHealthState.listLatestActiveByProviderIds({
      providerIds: ['localmind-db-provider'],
      workspaceId: workspace.id,
      checkedAt: now,
    });
  t.false(staleOverlays.has('localmind-db-provider'));

  const result = await app.gql({
    query: providerRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const model = result.currentUser.copilot.models.optionalModels.find(
    (item: { id: string }) => item.id === 'db-provider-chat'
  );
  t.truthy(model);
  t.is(model.providerHealth, 'healthy');
  t.is(model.providerHealthCheckedAt, '2026-06-21T11:00:00.000Z');
});

test('provider health worker clears stale probe results but keeps manual overrides', async t => {
  const { app, db, owner, providerHealthWorker } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const staleCheckedAt = new Date(
    Date.now() - PROVIDER_HEALTH_STATE_PROBE_RESULT_MAX_AGE_MS - 1000
  ).toISOString();

  await models.copilotProviderHealthState.upsertWorkspaceState({
    workspaceId: workspace.id,
    actorId: owner.id,
    providerId: 'stale-workspace-probe-provider',
    providerType: CopilotProviderType.OpenAICompatible,
    status: 'down',
    source: 'probe_result',
    checkedAt: staleCheckedAt,
    lastError: 'stale workspace probe timeout',
    providerProfileSource: 'db_revision',
    metadata: {
      providerProfileId: 'stale-workspace-probe-provider',
    },
  });
  await models.copilotProviderHealthState.upsertWorkspaceState({
    workspaceId: workspace.id,
    actorId: owner.id,
    providerId: 'manual-workspace-override-provider',
    providerType: CopilotProviderType.OpenAICompatible,
    status: 'down',
    source: 'manual_override',
    checkedAt: staleCheckedAt,
    lastError: 'operator disabled provider',
    providerProfileSource: 'db_revision',
    metadata: {
      providerProfileId: 'manual-workspace-override-provider',
    },
  });

  const signal = await providerHealthWorker.persistConfiguredSnapshots();
  t.is(signal, 'done');

  const rows = await db.$queryRaw<
    Array<{
      checkedAt: Date;
      lastError: string | null;
      metadata: Record<string, unknown>;
      providerId: string;
      source: string;
      status: string;
    }>
  >`
    SELECT
      checked_at AS "checkedAt",
      last_error AS "lastError",
      metadata,
      provider_id AS "providerId",
      source,
      status
    FROM ai_provider_health_states
    WHERE provider_id = ANY(${[
      'stale-workspace-probe-provider',
      'manual-workspace-override-provider',
    ]})
    ORDER BY provider_id ASC
  `;

  t.deepEqual(rows, [
    {
      checkedAt: rows[0].checkedAt,
      lastError: 'operator disabled provider',
      metadata: {
        version: 'provider-health-state-metadata/v1',
        providerProfileSource: 'db_revision',
        publishSource: 'graphql_mutation',
        providerProfileId: 'manual-workspace-override-provider',
      },
      providerId: 'manual-workspace-override-provider',
      source: 'manual_override',
      status: 'down',
    },
    {
      checkedAt: rows[1].checkedAt,
      lastError: null,
      metadata: {
        version: 'provider-health-state-metadata/v1',
        providerProfileSource: 'db_revision',
        publishSource: 'provider_health_probe_result_stale_cleanup_worker',
        providerProfileId: 'stale-workspace-probe-provider',
        providerHealthProbeResultCleanupReason:
          'provider_health_probe_result_stale',
        previousCheckedAt: staleCheckedAt,
        previousFingerprint: rows[1].metadata.previousFingerprint,
        previousLastError: 'stale workspace probe timeout',
        previousPublishSource: 'workspace_provider_health_probe_result',
        previousSource: 'probe_result',
        previousStatus: 'down',
        probeResultMaxAgeMs: PROVIDER_HEALTH_STATE_PROBE_RESULT_MAX_AGE_MS,
      },
      providerId: 'stale-workspace-probe-provider',
      source: 'probe_result',
      status: 'unknown',
    },
  ]);
  t.is(rows[0].checkedAt.toISOString(), staleCheckedAt);
  t.not(rows[1].checkedAt.toISOString(), staleCheckedAt);
  t.is(typeof rows[1].metadata.previousFingerprint, 'string');

  const staleProbeEventRows = await db.$queryRaw<
    Array<{
      eventType: string;
      lastError: string | null;
      metadata: Record<string, unknown>;
      providerId: string;
      scopeType: string;
      source: string;
      stateFingerprint: string;
      status: string;
      workspaceId: string | null;
    }>
  >`
    SELECT
      event_type AS "eventType",
      last_error AS "lastError",
      metadata,
      provider_id AS "providerId",
      scope_type AS "scopeType",
      source,
      state_fingerprint AS "stateFingerprint",
      status,
      workspace_id AS "workspaceId"
    FROM ai_provider_health_events
    WHERE provider_id = ${'stale-workspace-probe-provider'}
    ORDER BY created_at ASC
  `;
  t.deepEqual(
    staleProbeEventRows.map(row => row.eventType),
    ['workspace_probe_result_recorded', 'stale_probe_result_cleared']
  );
  t.like(staleProbeEventRows[1], {
    eventType: 'stale_probe_result_cleared',
    lastError: null,
    metadata: rows[1].metadata,
    providerId: 'stale-workspace-probe-provider',
    scopeType: 'workspace',
    source: 'probe_result',
    status: 'unknown',
    workspaceId: workspace.id,
  });
  t.regex(staleProbeEventRows[1].stateFingerprint, /^[a-f0-9]{16}$/);

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET metadata = jsonb_set(
        metadata,
        ${'{previousSource}'}::text[],
        ${JSON.stringify('manual_override')}::jsonb
      )
      WHERE provider_id = ${'stale-workspace-probe-provider'}
        AND source = ${'probe_result'}
    `,
    {
      message: /ai_provider_health_states_cleanup_metadata_contract_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET metadata = metadata - ${'probeResultMaxAgeMs'}
      WHERE provider_id = ${'stale-workspace-probe-provider'}
        AND source = ${'probe_result'}
    `,
    {
      message: /ai_provider_health_states_cleanup_metadata_contract_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_states
      SET metadata = jsonb_set(
        metadata - ${'probeResultMaxAgeMs'},
        ${'{version}'}::text[],
        ${JSON.stringify('  provider-health-state-metadata/v1  ')}::jsonb
      )
      WHERE provider_id = ${'stale-workspace-probe-provider'}
        AND source = ${'probe_result'}
    `,
    {
      message: /ai_provider_health_states_cleanup_metadata_contract_check/,
    }
  );
});

test('provider health probe enqueue rejects mismatched conflict evidence', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const models = app.get(Models);
  const scheduledAt = new Date('2026-06-23T10:00:00.000Z');

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Probe conflict DB provider',
    fingerprint: 'probeconflict111',
    id: 'provider-registry-probe-conflict',
    privacy: 'local',
    priority: 180,
    rawModelId: 'probe-conflict-db-provider-chat-raw',
    revision: 'workspace-provider-probe-conflict-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });
  const revision = (
    await models.copilotProviderRegistryRevision.listActiveWorkspaceProviderHealthProbeTargets(
      {
        limit: 10,
      }
    )
  ).find(target => target.id === 'provider-registry-probe-conflict');
  t.truthy(revision);

  const providerHealthStateModel = models.copilotProviderHealthState;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(providerHealthStateModel),
    'db'
  );
  let insertedDriftedAttemptBeforeEnqueue = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertProbeAttemptWithDriftedProfileEvidence>
  > | null = null;

  try {
    Object.defineProperty(providerHealthStateModel, 'db', {
      configurable: true,
      get() {
        const client = originalDbDescriptor?.get?.call(this) as PrismaClient;
        const originalQueryRaw = client.$queryRaw.bind(client);
        const rawInsertClient = {
          $executeRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            return await client.$executeRaw(strings, ...values);
          }) as typeof client.$executeRaw,
        };
        const patchedClient = {
          ...client,
          $queryRaw: (async <T>(
            strings: TemplateStringsArray,
            ...values: unknown[]
          ): Promise<T> => {
            if (
              !insertedDriftedAttemptBeforeEnqueue &&
              strings
                .join('?')
                .includes('INSERT INTO ai_provider_health_probe_attempts')
            ) {
              insertedDriftedAttemptBeforeEnqueue = true;
              conflictFixture =
                await insertProbeAttemptWithDriftedProfileEvidence({
                  db: rawInsertClient,
                  values,
                });
            }
            return await originalQueryRaw<T>(strings, ...values);
          }) as typeof client.$queryRaw,
        } as PrismaClient;
        return patchedClient;
      },
    });

    await t.throwsAsync(
      providerHealthStateModel.enqueueWorkspaceProviderHealthProbeAttempt({
        revision: revision!,
        scheduledAt,
        intervalMs: 60_000,
      }),
      {
        message:
          /Provider health probe attempt conflict reused mismatched request evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        providerHealthStateModel,
        'db',
        originalDbDescriptor
      );
    }
  }

  t.true(insertedDriftedAttemptBeforeEnqueue);
  t.truthy(conflictFixture);
  t.not(
    conflictFixture!.driftedProviderProfileFingerprint,
    conflictFixture!.providerProfileFingerprint
  );

  const rolledBackRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_probe_attempts
    WHERE request_fingerprint = ${conflictFixture!.requestFingerprint}
  `;
  t.is(rolledBackRows[0]?.count, 0);
});

test('provider health probe enqueue fails closed when provider revision snapshot changes before insert', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const models = app.get(Models);
  const scheduledAt = new Date('2026-06-23T10:05:00.000Z');

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Probe stale provider revision',
    fingerprint: 'probestale33333',
    id: 'provider-registry-probe-stale-parent',
    privacy: 'local',
    priority: 180,
    rawModelId: 'probe-stale-parent-chat-raw',
    revision: 'workspace-provider-probe-stale-parent-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });
  const revision = (
    await models.copilotProviderRegistryRevision.listActiveWorkspaceProviderHealthProbeTargets(
      {
        limit: 10,
      }
    )
  ).find(target => target.id === 'provider-registry-probe-stale-parent');
  t.truthy(revision);

  const staleRevision = {
    ...revision!,
    providerProfileSnapshot: {
      ...(revision!.providerProfileSnapshot as Record<string, unknown>),
      displayName: 'Probe stale provider revision stale snapshot',
    },
  };

  await t.throwsAsync(
    models.copilotProviderHealthState.enqueueWorkspaceProviderHealthProbeAttempt(
      {
        revision: staleRevision,
        scheduledAt,
        intervalMs: 60_000,
      }
    ),
    {
      message:
        /Provider health probe attempt could not be queued because its provider revision state changed/,
    }
  );

  const attemptRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_probe_attempts
    WHERE provider_registry_revision_id = ${'provider-registry-probe-stale-parent'}
  `;
  t.is(attemptRows[0]?.count, 0);
});

test('provider health worker persists automatic workspace probe attempt results', async t => {
  const { app, db, owner, providerHealthWorker } = t.context;
  const workspace = await createWorkspace(app);

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Probe health DB provider',
    fingerprint: 'probehealth11111',
    id: 'provider-registry-probe-health',
    privacy: 'local',
    priority: 180,
    rawModelId: 'probe-health-db-provider-chat-raw',
    revision: 'workspace-provider-probe-health-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  const enqueueSignal =
    await providerHealthWorker.enqueueWorkspaceProbeAttempts({
      limit: 10,
    });
  t.is(enqueueSignal, 'done');

  const queuedRows = await db.$queryRaw<
    Array<{
      actorId: string | null;
      providerId: string;
      providerProfileSnapshot: Record<string, unknown>;
      providerRegistryRevisionFingerprint: string | null;
      providerRegistryRevisionId: string | null;
      status: string;
      workspaceId: string | null;
    }>
  >`
    SELECT
      actor_id AS "actorId",
      provider_id AS "providerId",
      provider_profile_snapshot AS "providerProfileSnapshot",
      provider_registry_revision_fingerprint AS "providerRegistryRevisionFingerprint",
      provider_registry_revision_id AS "providerRegistryRevisionId",
      status,
      workspace_id AS "workspaceId"
    FROM ai_provider_health_probe_attempts
    WHERE provider_registry_revision_id = ${'provider-registry-probe-health'}
  `;
  t.deepEqual(queuedRows, [
    {
      actorId: owner.id,
      providerId: 'localmind-db-provider',
      providerProfileSnapshot: {
        version: 'provider-health-probe-target/v1',
        providerId: 'localmind-db-provider',
        providerType: CopilotProviderType.OpenAICompatible,
        scopeType: 'workspace',
        workspaceId: workspace.id,
        actorId: owner.id,
        revision: 'workspace-provider-probe-health-r1',
        revisionId: 'provider-registry-probe-health',
        revisionFingerprint: 'probehealth11111',
        providerProfileSource: 'db_revision',
        enabled: true,
        privacy: 'local',
        modelCount: 1,
        modelDefinitions: [
          {
            id: 'db-provider-chat',
            rawModelId: 'probe-health-db-provider-chat-raw',
            displayName: 'Probe health DB provider chat',
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
        ],
        fallbackSourceChainFingerprint:
          queuedRows[0].providerProfileSnapshot.fallbackSourceChainFingerprint,
      },
      providerRegistryRevisionFingerprint: 'probehealth11111',
      providerRegistryRevisionId: 'provider-registry-probe-health',
      status: 'queued',
      workspaceId: workspace.id,
    },
  ]);
  t.regex(
    String(
      queuedRows[0].providerProfileSnapshot.fallbackSourceChainFingerprint
    ),
    /^[a-f0-9]{16}$/
  );

  const secondEnqueueSignal =
    await providerHealthWorker.enqueueWorkspaceProbeAttempts({
      limit: 10,
    });
  t.is(secondEnqueueSignal, 'done');
  const idempotentCountRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_probe_attempts
    WHERE provider_registry_revision_id = ${'provider-registry-probe-health'}
  `;
  t.is(idempotentCountRows[0]?.count, 1);

  const processSignal = await providerHealthWorker.processProbeAttempts({
    limit: 10,
  });
  t.is(processSignal, 'done');

  const completedRows = await db.$queryRaw<
    Array<{
      attemptCount: number;
      completedAt: Date | null;
      providerHealthStateFingerprint: string | null;
      providerHealthStateId: string | null;
      resultFingerprint: string | null;
      resultLastError: string | null;
      resultMetadata: Record<string, unknown>;
      resultStatus: string | null;
      status: string;
      workerLeaseId: string | null;
    }>
  >`
    SELECT
      attempt_count AS "attemptCount",
      completed_at AS "completedAt",
      provider_health_state_fingerprint AS "providerHealthStateFingerprint",
      provider_health_state_id AS "providerHealthStateId",
      result_fingerprint AS "resultFingerprint",
      result_last_error AS "resultLastError",
      result_metadata AS "resultMetadata",
      result_status AS "resultStatus",
      status,
      worker_lease_id AS "workerLeaseId"
    FROM ai_provider_health_probe_attempts
    WHERE provider_registry_revision_id = ${'provider-registry-probe-health'}
  `;
  t.is(completedRows[0]?.status, 'completed');
  t.is(completedRows[0]?.attemptCount, 1);
  t.truthy(completedRows[0]?.completedAt);
  t.is(completedRows[0]?.workerLeaseId, null);
  t.is(completedRows[0]?.resultStatus, 'healthy');
  t.is(completedRows[0]?.resultLastError, null);
  t.regex(completedRows[0]?.resultFingerprint ?? '', /^[a-f0-9]{16}$/);
  t.truthy(completedRows[0]?.providerHealthStateId);
  t.regex(
    completedRows[0]?.providerHealthStateFingerprint ?? '',
    /^[a-f0-9]{16}$/
  );
  t.like(completedRows[0]?.resultMetadata, {
    version: 'provider-health-probe-attempt-result/v1',
    providerRegistryRevisionId: 'provider-registry-probe-health',
    providerRegistryRevisionFingerprint: 'probehealth11111',
  });

  const healthRows = await db.$queryRaw<
    Array<{
      lastError: string | null;
      metadata: Record<string, unknown>;
      providerId: string;
      source: string;
      status: string;
      workspaceId: string | null;
    }>
  >`
    SELECT
      last_error AS "lastError",
      metadata,
      provider_id AS "providerId",
      source,
      status,
      workspace_id AS "workspaceId"
    FROM ai_provider_health_states
    WHERE provider_id = ${'localmind-db-provider'}
      AND workspace_id = ${workspace.id}
  `;
  t.like(healthRows[0], {
    lastError: null,
    providerId: 'localmind-db-provider',
    source: 'probe_result',
    status: 'healthy',
    workspaceId: workspace.id,
  });
  t.like(healthRows[0].metadata, {
    version: 'provider-health-state-metadata/v1',
    publishSource: 'workspace_provider_health_probe_result',
    providerProfileSource: 'db_revision',
    providerProfileId: 'localmind-db-provider',
    providerRegistryRevisionId: 'provider-registry-probe-health',
    providerRegistryRevisionFingerprint: 'probehealth11111',
    resultFingerprint: completedRows[0]?.resultFingerprint,
  });

  const eventRows = await db.$queryRaw<
    Array<{
      eventType: string;
      metadata: Record<string, unknown>;
      source: string;
      stateFingerprint: string;
      status: string;
    }>
  >`
    SELECT
      event_type AS "eventType",
      metadata,
      source,
      state_fingerprint AS "stateFingerprint",
      status
    FROM ai_provider_health_events
    WHERE provider_id = ${'localmind-db-provider'}
      AND workspace_id = ${workspace.id}
    ORDER BY created_at ASC
  `;
  t.deepEqual(
    eventRows.map(row => row.eventType),
    ['workspace_probe_result_recorded']
  );
  t.like(eventRows[0], {
    metadata: healthRows[0].metadata,
    source: 'probe_result',
    status: 'healthy',
  });
  t.is(
    eventRows[0].stateFingerprint,
    completedRows[0]?.providerHealthStateFingerprint
  );

  const attemptsResult = await app.gql({
    query: providerHealthProbeAttemptsQuery,
    variables: {
      workspaceId: workspace.id,
      limit: 5,
    },
  });
  const attempts = attemptsResult.currentUser.copilot
    .providerHealthProbeAttempts as Array<{
    actorId: string;
    attemptCount: number;
    completedAt: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    id: string;
    maxAttempts: number;
    providerHealthStateFingerprint: string | null;
    providerHealthStateId: string | null;
    providerId: string;
    providerProfileFingerprint: string;
    providerProfileSnapshot: Record<string, unknown>;
    providerProfileSource: string | null;
    providerRegistryRevisionFingerprint: string;
    providerRegistryRevisionId: string;
    providerType: string | null;
    requestFingerprint: string;
    resultFingerprint: string | null;
    resultLastError: string | null;
    resultMetadata: Record<string, unknown>;
    resultStatus: string | null;
    scopeType: string;
    status: string;
    workerLeaseExpiresAt: string | null;
    workerLeaseId: string | null;
    workspaceId: string;
  }>;
  t.is(attempts.length, 1);
  t.like(attempts[0], {
    actorId: owner.id,
    attemptCount: 1,
    failureCode: null,
    failureMessage: null,
    maxAttempts: 3,
    providerHealthStateFingerprint:
      completedRows[0]?.providerHealthStateFingerprint,
    providerHealthStateId: completedRows[0]?.providerHealthStateId,
    providerId: 'localmind-db-provider',
    providerProfileSource: 'db_revision',
    providerRegistryRevisionFingerprint: 'probehealth11111',
    providerRegistryRevisionId: 'provider-registry-probe-health',
    providerType: CopilotProviderType.OpenAICompatible,
    resultFingerprint: completedRows[0]?.resultFingerprint,
    resultLastError: null,
    resultStatus: 'healthy',
    scopeType: 'workspace',
    status: 'completed',
    workerLeaseExpiresAt: null,
    workerLeaseId: null,
    workspaceId: workspace.id,
  });
  t.regex(attempts[0]?.providerProfileFingerprint ?? '', /^[a-f0-9]{16}$/);
  t.regex(attempts[0]?.requestFingerprint ?? '', /^[a-f0-9]{16}$/);
  t.truthy(attempts[0]?.completedAt);
  t.like(attempts[0]?.providerProfileSnapshot, {
    actorId: owner.id,
    modelCount: 1,
    providerId: 'localmind-db-provider',
    providerProfileSource: 'db_revision',
    revisionFingerprint: 'probehealth11111',
    revisionId: 'provider-registry-probe-health',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });
  t.like(attempts[0]?.resultMetadata, {
    version: 'provider-health-probe-attempt-result/v1',
    providerProfileFingerprint: attempts[0]?.providerProfileFingerprint,
    providerRegistryRevisionFingerprint: 'probehealth11111',
    providerRegistryRevisionId: 'provider-registry-probe-health',
  });

  const filteredByStatusResult = await app.gql({
    query: providerHealthProbeAttemptsQuery,
    variables: {
      workspaceId: workspace.id,
      limit: 5,
      filter: {
        status: 'completed',
      },
    },
  });
  const completedAttempts = filteredByStatusResult.currentUser.copilot
    .providerHealthProbeAttempts as Array<{ id: string; status: string }>;
  t.deepEqual(
    completedAttempts.map(attempt => [attempt.id, attempt.status]),
    [[attempts[0].id, 'completed']]
  );

  const filteredByRevisionResult = await app.gql({
    query: providerHealthProbeAttemptsQuery,
    variables: {
      workspaceId: workspace.id,
      limit: 5,
      filter: {
        providerRegistryRevisionId: 'provider-registry-probe-health',
      },
    },
  });
  const revisionAttempts = filteredByRevisionResult.currentUser.copilot
    .providerHealthProbeAttempts as Array<{ id: string }>;
  t.deepEqual(
    revisionAttempts.map(attempt => attempt.id),
    [attempts[0].id]
  );

  const filteredByQueryResult = await app.gql({
    query: providerHealthProbeAttemptsQuery,
    variables: {
      workspaceId: workspace.id,
      limit: 5,
      filter: {
        query: attempts[0].requestFingerprint,
      },
    },
  });
  const queryAttempts = filteredByQueryResult.currentUser.copilot
    .providerHealthProbeAttempts as Array<{
    id: string;
    requestFingerprint: string;
  }>;
  t.deepEqual(
    queryAttempts.map(attempt => [attempt.id, attempt.requestFingerprint]),
    [[attempts[0].id, attempts[0].requestFingerprint]]
  );

  const missingStatusResult = await app.gql({
    query: providerHealthProbeAttemptsQuery,
    variables: {
      workspaceId: workspace.id,
      limit: 5,
      filter: {
        status: 'dead_lettered',
      },
    },
  });
  t.deepEqual(
    missingStatusResult.currentUser.copilot.providerHealthProbeAttempts,
    []
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_probe_attempts
      SET result_metadata = result_metadata - ${'providerProfileFingerprint'}
      WHERE provider_registry_revision_id = ${'provider-registry-probe-health'}
    `,
    {
      message: /Cannot mutate provider health probe attempt evidence/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_health_probe_attempts
      SET provider_registry_revision_fingerprint = ${'driftedprobe111'}
      WHERE provider_registry_revision_id = ${'provider-registry-probe-health'}
    `,
    {
      message: /Cannot mutate provider health probe attempt evidence/,
    }
  );

  await t.throwsAsync(
    db.$transaction(async tx => {
      await tx.$executeRaw`
        DELETE FROM ai_provider_health_probe_attempts
        WHERE provider_registry_revision_id = ${'provider-registry-probe-health'}
      `;
      await tx.$executeRaw`
        SET CONSTRAINTS "zz_ai_provider_health_probe_attempts_delete_check" IMMEDIATE
      `;
    }),
    {
      message:
        /Cannot delete provider health probe attempt while registry revision exists/,
    }
  );
});

test('provider health probe completion ignores stale worker leases before publishing health', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const models = app.get(Models);
  const scheduledAt = new Date(Date.now() - 180_000);
  const staleCheckedAt = new Date(Date.now() - 120_000);
  const currentCheckedAt = new Date();

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Probe stale lease provider',
    fingerprint: 'probestale11111',
    id: 'provider-registry-probe-stale-lease',
    privacy: 'local',
    priority: 180,
    rawModelId: 'probe-stale-lease-chat-raw',
    revision: 'workspace-provider-probe-stale-lease-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });
  const targets =
    await models.copilotProviderRegistryRevision.listActiveWorkspaceProviderHealthProbeTargets(
      {
        limit: 10,
      }
    );
  const revision = targets.find(
    target => target.id === 'provider-registry-probe-stale-lease'
  );
  t.truthy(revision);
  const attempt =
    await models.copilotProviderHealthState.enqueueWorkspaceProviderHealthProbeAttempt(
      {
        revision: revision!,
        scheduledAt,
      }
    );
  t.is(attempt.status, 'queued');

  const firstLease =
    await models.copilotProviderHealthState.leaseDueProviderHealthProbeAttempts(
      {
        id: attempt.id,
        checkedAt: staleCheckedAt,
        leaseMs: 1,
      }
    );
  const staleAttempt = firstLease[0] as CopilotProviderHealthProbeAttemptRecord;
  t.is(staleAttempt.status, 'processing');
  t.truthy(staleAttempt.workerLeaseId);

  const secondLease =
    await models.copilotProviderHealthState.leaseDueProviderHealthProbeAttempts(
      {
        id: attempt.id,
        checkedAt: currentCheckedAt,
        leaseMs: 60_000,
      }
    );
  const currentAttempt =
    secondLease[0] as CopilotProviderHealthProbeAttemptRecord;
  t.is(currentAttempt.status, 'processing');
  t.not(currentAttempt.workerLeaseId, staleAttempt.workerLeaseId);
  t.is(currentAttempt.attemptCount, 2);

  const ignoredCompletion =
    await models.copilotProviderHealthState.completeProviderHealthProbeAttempt({
      attempt: staleAttempt,
      result: {
        status: 'down',
        checkedAt: new Date(),
        lastError: 'stale worker result must not publish',
      },
    });
  t.is(ignoredCompletion.status, 'processing');
  t.is(ignoredCompletion.workerLeaseId, currentAttempt.workerLeaseId);
  t.is(ignoredCompletion.resultStatus, null);
  t.is(ignoredCompletion.providerHealthStateId, null);

  const healthRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_states
    WHERE provider_id = ${'localmind-db-provider'}
      AND workspace_id = ${workspace.id}
  `;
  t.is(healthRows[0]?.count, 0);

  const ignoredFailure =
    await models.copilotProviderHealthState.failProviderHealthProbeAttempt({
      attempt: staleAttempt,
      error: {
        errorCode: 'stale_worker_failure',
        errorMessage: 'stale worker failure must not reschedule',
        retryable: true,
      },
    });
  t.is(ignoredFailure.status, 'processing');
  t.is(ignoredFailure.workerLeaseId, currentAttempt.workerLeaseId);
  t.is(ignoredFailure.failureCode, null);
  t.is(ignoredFailure.failureMessage, null);

  const completed =
    await models.copilotProviderHealthState.completeProviderHealthProbeAttempt({
      attempt: currentAttempt,
      result: {
        status: 'healthy',
        checkedAt: new Date(),
      },
    });
  t.is(completed.status, 'completed');
  t.is(completed.resultStatus, 'healthy');
});

test('provider health probe completion and failure ignore stale attempt counters before writing evidence', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const models = app.get(Models);
  const scheduledAt = new Date(Date.now() - 180_000);
  const checkedAt = new Date(Date.now());

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Probe stale attempt provider',
    fingerprint: 'probestale22222',
    id: 'provider-registry-probe-stale-attempt',
    privacy: 'local',
    priority: 180,
    rawModelId: 'probe-stale-attempt-chat-raw',
    revision: 'workspace-provider-probe-stale-attempt-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });
  const revision = (
    await models.copilotProviderRegistryRevision.listActiveWorkspaceProviderHealthProbeTargets(
      {
        limit: 10,
      }
    )
  ).find(target => target.id === 'provider-registry-probe-stale-attempt');
  t.truthy(revision);
  const attempt =
    await models.copilotProviderHealthState.enqueueWorkspaceProviderHealthProbeAttempt(
      {
        revision: revision!,
        scheduledAt,
      }
    );
  t.is(attempt.status, 'queued');

  const leased =
    await models.copilotProviderHealthState.leaseDueProviderHealthProbeAttempts(
      {
        id: attempt.id,
        checkedAt,
        leaseMs: 60_000,
      }
    );
  const staleAttempt = leased[0] as CopilotProviderHealthProbeAttemptRecord;
  t.is(staleAttempt.status, 'processing');
  t.is(staleAttempt.attemptCount, 1);
  t.truthy(staleAttempt.workerLeaseId);

  await db.$executeRaw`
    UPDATE ai_provider_health_probe_attempts
    SET
      attempt_count = 2,
      updated_at = ${new Date()}
    WHERE id = ${staleAttempt.id}
  `;

  const ignoredCompletion =
    await models.copilotProviderHealthState.completeProviderHealthProbeAttempt({
      attempt: staleAttempt,
      result: {
        status: 'down',
        checkedAt: new Date(),
        lastError: 'stale attempt result must not publish',
      },
    });
  t.is(ignoredCompletion.status, 'processing');
  t.is(ignoredCompletion.workerLeaseId, staleAttempt.workerLeaseId);
  t.is(ignoredCompletion.attemptCount, 2);
  t.is(ignoredCompletion.resultStatus, null);
  t.is(ignoredCompletion.providerHealthStateId, null);

  const healthRowsAfterCompletion = await db.$queryRaw<
    Array<{ count: number }>
  >`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_states
    WHERE provider_id = ${'localmind-db-provider'}
      AND workspace_id = ${workspace.id}
  `;
  t.is(healthRowsAfterCompletion[0]?.count, 0);

  const ignoredFailure =
    await models.copilotProviderHealthState.failProviderHealthProbeAttempt({
      attempt: staleAttempt,
      error: {
        errorCode: 'stale_attempt_failure',
        errorMessage: 'stale attempt failure must not reschedule',
        retryable: true,
      },
    });
  t.is(ignoredFailure.status, 'processing');
  t.is(ignoredFailure.workerLeaseId, staleAttempt.workerLeaseId);
  t.is(ignoredFailure.attemptCount, 2);
  t.is(ignoredFailure.failureCode, null);
  t.is(ignoredFailure.failureMessage, null);

  const currentAttempt =
    await models.copilotProviderHealthState.getProviderHealthProbeAttempt(
      staleAttempt.id
    );
  t.truthy(currentAttempt);
  const completed =
    await models.copilotProviderHealthState.completeProviderHealthProbeAttempt({
      attempt: currentAttempt!,
      result: {
        status: 'healthy',
        checkedAt: new Date(),
      },
    });
  t.is(completed.status, 'completed');
  t.is(completed.attemptCount, 2);
  t.is(completed.resultStatus, 'healthy');
});

test.serial(
  'provider health probe completion fails closed when attempt snapshot changes before terminal write',
  async t => {
    const { app, db, owner } = t.context;
    const workspace = await createWorkspace(app);
    const models = app.get(Models);
    const scheduledAt = new Date(Date.now() - 180_000);
    const checkedAt = new Date(Date.now());

    await insertProviderRegistryRevision({
      actorId: owner.id,
      db,
      displayName: 'Probe completion snapshot drift provider',
      fingerprint: 'probedrift11111',
      id: 'provider-registry-probe-completion-drift',
      privacy: 'local',
      priority: 180,
      rawModelId: 'probe-completion-drift-chat-raw',
      revision: 'workspace-provider-probe-completion-drift-r1',
      scopeType: 'workspace',
      workspaceId: workspace.id,
    });
    const revision = (
      await models.copilotProviderRegistryRevision.listActiveWorkspaceProviderHealthProbeTargets(
        {
          limit: 10,
        }
      )
    ).find(target => target.id === 'provider-registry-probe-completion-drift');
    t.truthy(revision);
    const attempt =
      await models.copilotProviderHealthState.enqueueWorkspaceProviderHealthProbeAttempt(
        {
          revision: revision!,
          scheduledAt,
        }
      );
    const leased =
      await models.copilotProviderHealthState.leaseDueProviderHealthProbeAttempts(
        {
          id: attempt.id,
          checkedAt,
          leaseMs: 60_000,
        }
      );
    const staleAttempt = leased[0] as CopilotProviderHealthProbeAttemptRecord;
    t.is(staleAttempt.status, 'processing');
    t.truthy(staleAttempt.workerLeaseId);

    const providerHealthModel =
      models.copilotProviderHealthState as unknown as {
        db: Pick<PrismaClient, '$executeRaw'>;
        lockProviderHealthProbeAttempt(
          id: string
        ): Promise<CopilotProviderHealthProbeAttemptRecord | null>;
      };
    const originalLock =
      providerHealthModel.lockProviderHealthProbeAttempt.bind(
        models.copilotProviderHealthState
      );
    let driftInjected = false;
    providerHealthModel.lockProviderHealthProbeAttempt = async id => {
      const locked = await originalLock(id);
      if (!driftInjected) {
        driftInjected = true;
        await providerHealthModel.db.$executeRaw`
        UPDATE ai_provider_health_probe_attempts
        SET updated_at = updated_at + interval '1 second'
        WHERE id = ${id}
      `;
      }
      return locked;
    };

    try {
      await t.throwsAsync(
        models.copilotProviderHealthState.completeProviderHealthProbeAttempt({
          attempt: staleAttempt,
          result: {
            status: 'healthy',
            checkedAt: new Date(),
          },
        }),
        {
          message: /Provider health probe attempt lease changed/,
        }
      );
    } finally {
      providerHealthModel.lockProviderHealthProbeAttempt = originalLock;
    }
    t.true(driftInjected);

    const currentAttempt =
      await models.copilotProviderHealthState.getProviderHealthProbeAttempt(
        staleAttempt.id
      );
    t.truthy(currentAttempt);
    t.is(currentAttempt?.status, 'processing');
    t.is(currentAttempt?.workerLeaseId, staleAttempt.workerLeaseId);
    t.is(currentAttempt?.attemptCount, staleAttempt.attemptCount);
    t.is(currentAttempt?.resultStatus, null);
    t.is(currentAttempt?.resultFingerprint, null);
    t.is(currentAttempt?.providerHealthStateId, null);
    const healthRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_states
    WHERE provider_id = ${'localmind-db-provider'}
      AND workspace_id = ${workspace.id}
  `;
    t.is(healthRows[0]?.count, 0);
  }
);

test.serial(
  'provider health probe failure fails closed when attempt snapshot changes before terminal write',
  async t => {
    const { app, db, owner } = t.context;
    const workspace = await createWorkspace(app);
    const models = app.get(Models);
    const scheduledAt = new Date(Date.now() - 180_000);
    const checkedAt = new Date(Date.now());

    await insertProviderRegistryRevision({
      actorId: owner.id,
      db,
      displayName: 'Probe failure snapshot drift provider',
      fingerprint: 'probedrift22222',
      id: 'provider-registry-probe-failure-drift',
      privacy: 'local',
      priority: 180,
      rawModelId: 'probe-failure-drift-chat-raw',
      revision: 'workspace-provider-probe-failure-drift-r1',
      scopeType: 'workspace',
      workspaceId: workspace.id,
    });
    const revision = (
      await models.copilotProviderRegistryRevision.listActiveWorkspaceProviderHealthProbeTargets(
        {
          limit: 10,
        }
      )
    ).find(target => target.id === 'provider-registry-probe-failure-drift');
    t.truthy(revision);
    const attempt =
      await models.copilotProviderHealthState.enqueueWorkspaceProviderHealthProbeAttempt(
        {
          revision: revision!,
          scheduledAt,
        }
      );
    const leased =
      await models.copilotProviderHealthState.leaseDueProviderHealthProbeAttempts(
        {
          id: attempt.id,
          checkedAt,
          leaseMs: 60_000,
        }
      );
    const staleAttempt = leased[0] as CopilotProviderHealthProbeAttemptRecord;
    t.is(staleAttempt.status, 'processing');
    t.truthy(staleAttempt.workerLeaseId);

    const providerHealthModel =
      models.copilotProviderHealthState as unknown as {
        db: Pick<PrismaClient, '$executeRaw'>;
        lockProviderHealthProbeAttempt(
          id: string
        ): Promise<CopilotProviderHealthProbeAttemptRecord | null>;
      };
    const originalLock =
      providerHealthModel.lockProviderHealthProbeAttempt.bind(
        models.copilotProviderHealthState
      );
    let driftInjected = false;
    providerHealthModel.lockProviderHealthProbeAttempt = async id => {
      const locked = await originalLock(id);
      if (!driftInjected) {
        driftInjected = true;
        await providerHealthModel.db.$executeRaw`
        UPDATE ai_provider_health_probe_attempts
        SET updated_at = updated_at + interval '1 second'
        WHERE id = ${id}
      `;
      }
      return locked;
    };

    try {
      await t.throwsAsync(
        models.copilotProviderHealthState.failProviderHealthProbeAttempt({
          attempt: staleAttempt,
          error: {
            errorCode: 'snapshot_drift_failure',
            errorMessage: 'snapshot drift failure must not reschedule',
            retryable: true,
          },
        }),
        {
          message: /Provider health probe attempt lease changed/,
        }
      );
    } finally {
      providerHealthModel.lockProviderHealthProbeAttempt = originalLock;
    }
    t.true(driftInjected);

    const currentAttempt =
      await models.copilotProviderHealthState.getProviderHealthProbeAttempt(
        staleAttempt.id
      );
    t.truthy(currentAttempt);
    t.is(currentAttempt?.status, 'processing');
    t.is(currentAttempt?.workerLeaseId, staleAttempt.workerLeaseId);
    t.is(currentAttempt?.attemptCount, staleAttempt.attemptCount);
    t.is(
      currentAttempt?.scheduledAt.getTime(),
      staleAttempt.scheduledAt.getTime()
    );
    t.is(currentAttempt?.failureCode, null);
    t.is(currentAttempt?.failureMessage, null);
    t.is(currentAttempt?.deadLetteredAt, null);
  }
);

test('provider health probe retry queues a fresh attempt without mutating dead-letter evidence', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const models = app.get(Models);
  const scheduledAt = new Date('2026-06-23T09:00:00.000Z');
  const checkedAt = new Date('2026-06-23T09:01:00.000Z');

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Probe dead letter retry provider',
    fingerprint: 'proberetry11111',
    id: 'provider-registry-probe-retry',
    privacy: 'local',
    priority: 180,
    rawModelId: 'probe-retry-chat-raw',
    revision: 'workspace-provider-probe-retry-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });
  const revision = (
    await models.copilotProviderRegistryRevision.listActiveWorkspaceProviderHealthProbeTargets(
      {
        limit: 10,
      }
    )
  ).find(target => target.id === 'provider-registry-probe-retry');
  t.truthy(revision);
  const attempt =
    await models.copilotProviderHealthState.enqueueWorkspaceProviderHealthProbeAttempt(
      {
        revision: revision!,
        scheduledAt,
        intervalMs: 60_000,
      }
    );
  const leased =
    await models.copilotProviderHealthState.leaseDueProviderHealthProbeAttempts(
      {
        id: attempt.id,
        checkedAt,
      }
    );
  const deadLettered =
    await models.copilotProviderHealthState.failProviderHealthProbeAttempt({
      attempt: leased[0] as CopilotProviderHealthProbeAttemptRecord,
      error: {
        errorCode: 'manual_retry_fixture',
        errorMessage: 'manual retry fixture',
        retryable: false,
      },
    });
  t.is(deadLettered.status, 'dead_lettered');

  const retryResult = await app.gql({
    query: providerHealthProbeAttemptRetryMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        attemptId: deadLettered.id,
      },
    },
  });
  const retry = retryResult.retryCopilotProviderHealthProbeAttempt as {
    attemptCount: number;
    checkedAt: string | null;
    completedAt: string | null;
    deadLetteredAt: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    id: string;
    maxAttempts: number;
    providerRegistryRevisionFingerprint: string;
    providerRegistryRevisionId: string;
    requestFingerprint: string;
    resultFingerprint: string | null;
    resultStatus: string | null;
    status: string;
    workerLeaseExpiresAt: string | null;
    workerLeaseId: string | null;
    workspaceId: string;
  };
  t.not(retry.id, deadLettered.id);
  t.not(retry.requestFingerprint, deadLettered.requestFingerprint);
  t.like(retry, {
    attemptCount: 0,
    checkedAt: null,
    completedAt: null,
    deadLetteredAt: null,
    failureCode: null,
    failureMessage: null,
    maxAttempts: 3,
    providerRegistryRevisionFingerprint: 'proberetry11111',
    providerRegistryRevisionId: 'provider-registry-probe-retry',
    resultFingerprint: null,
    resultStatus: null,
    status: 'queued',
    workerLeaseExpiresAt: null,
    workerLeaseId: null,
    workspaceId: workspace.id,
  });

  const rows = await db.$queryRaw<
    Array<{
      attemptCount: number;
      deadLetteredAt: Date | null;
      failureCode: string | null;
      id: string;
      requestFingerprint: string;
      status: string;
    }>
  >`
    SELECT
      attempt_count AS "attemptCount",
      dead_lettered_at AS "deadLetteredAt",
      failure_code AS "failureCode",
      id,
      request_fingerprint AS "requestFingerprint",
      status
    FROM ai_provider_health_probe_attempts
    WHERE provider_registry_revision_id = ${'provider-registry-probe-retry'}
    ORDER BY created_at ASC, id ASC
  `;
  t.is(rows.length, 2);
  t.like(rows[0], {
    attemptCount: 1,
    failureCode: 'manual_retry_fixture',
    id: deadLettered.id,
    requestFingerprint: deadLettered.requestFingerprint,
    status: 'dead_lettered',
  });
  t.truthy(rows[0].deadLetteredAt);
  t.like(rows[1], {
    attemptCount: 0,
    failureCode: null,
    id: retry.id,
    requestFingerprint: retry.requestFingerprint,
    status: 'queued',
  });
  t.is(rows[1].deadLetteredAt, null);
});

test('provider health probe attempt constraints reject malformed SQL writes', async t => {
  const { db, owner } = t.context;
  const workspace = await createWorkspace(t.context.app);
  const now = new Date('2026-06-23T09:30:00.000Z');

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Malformed probe DB provider',
    fingerprint: 'probehealth22222',
    id: 'provider-registry-probe-health-sql',
    privacy: 'local',
    priority: 180,
    rawModelId: 'probe-health-sql-provider-chat-raw',
    revision: 'workspace-provider-probe-health-sql-r1',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  await t.throwsAsync(
    db.$executeRaw`
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
      VALUES (
        ${'provider-health-probe-sql-bad-scope'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'global'},
        ${null},
        ${owner.id},
        ${'provider-registry-probe-health-sql'},
        ${'probehealth22222'},
        ${'db_revision'},
        ${'probeprofilebad1'},
        ${JSON.stringify({ version: 'provider-health-probe-target/v1' })}::jsonb,
        ${'probe-sql-bad-scope'},
        ${'queued'},
        ${0},
        ${3},
        ${now},
        ${JSON.stringify({})}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_provider_health_probe_attempts_scope_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
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
      VALUES (
        ${'provider-health-probe-sql-bad-revision'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'workspace'},
        ${workspace.id},
        ${owner.id},
        ${'provider-registry-probe-health-sql'},
        ${'driftedrevision1'},
        ${'db_revision'},
        ${'probeprofilebad2'},
        ${JSON.stringify({ version: 'provider-health-probe-target/v1' })}::jsonb,
        ${'probe-sql-bad-revision'},
        ${'queued'},
        ${0},
        ${3},
        ${now},
        ${JSON.stringify({})}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_provider_health_probe_attempts_revision_snapshot_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
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
      VALUES (
        ${'provider-health-probe-sql-bad-state'},
        ${'localmind-db-provider'},
        ${CopilotProviderType.OpenAICompatible},
        ${'workspace'},
        ${workspace.id},
        ${owner.id},
        ${'provider-registry-probe-health-sql'},
        ${'probehealth22222'},
        ${'db_revision'},
        ${'probeprofilebad3'},
        ${JSON.stringify({ version: 'provider-health-probe-target/v1' })}::jsonb,
        ${'probe-sql-bad-state'},
        ${'completed'},
        ${1},
        ${3},
        ${now},
        ${JSON.stringify({})}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_provider_health_probe_attempts_state_check/,
    }
  );
});

const providerRegistryScopeTestName = [
  'provider registry revision remains workspace-scoped',
  'and falls back to global DB revision',
].join(' ');

test(providerRegistryScopeTestName, async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const otherWorkspace = await createWorkspace(app);

  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Global DB provider',
    fingerprint: 'globalprovider22',
    id: 'provider-registry-global-fallback',
    privacy: 'private_cloud',
    priority: 45,
    rawModelId: 'global-db-provider-chat-raw',
    revision: 'global-provider-r3',
    scopeType: 'global',
  });
  await insertProviderRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Scoped DB provider',
    fingerprint: 'scopedprovider3',
    id: 'provider-registry-workspace-scoped',
    privacy: 'local',
    priority: 145,
    rawModelId: 'scoped-db-provider-chat-raw',
    revision: 'workspace-provider-r4',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  const result = await app.gql({
    query: providerRegistryQuery,
    variables: {
      workspaceId: otherWorkspace.id,
    },
  });
  const model = result.currentUser.copilot.models.optionalModels.find(
    (item: { id: string }) => item.id === 'db-provider-chat'
  );

  t.truthy(model);
  t.is(model.providerProfileSource, 'db_revision');
  t.is(
    model.providerProfileConfigPath,
    'ai_provider_registry_revisions[id=provider-registry-global-fallback]'
  );
  t.is(model.providerPrivacy, 'private_cloud');
  t.is(model.providerPriority, 45);
  t.is(model.routeModelId, 'global-db-provider-chat-raw');

  const outsider = await app.signupV1();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: providerRegistryQuery,
      variables: {
        workspaceId: workspace.id,
      },
    })
  );
});

const providerRegistryPublishTestName = [
  'provider registry publish mutation writes sanitized workspace revision',
  'and drives model routing',
].join(' ');

test('provider registry revision row conflict rejects mismatched evidence', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const providerRegistryRevisionModel = models.copilotProviderRegistryRevision;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(providerRegistryRevisionModel),
    'db'
  );
  let insertedDriftedRevisionBeforePublish = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertProviderRegistryRevisionWithDriftedMetadata>
  > | null = null;

  try {
    Object.defineProperty(providerRegistryRevisionModel, 'db', {
      configurable: true,
      get() {
        const client = originalDbDescriptor?.get?.call(this) as PrismaClient;
        const originalQueryRaw = client.$queryRaw.bind(client);
        const originalExecuteRaw = client.$executeRaw.bind(client);
        const rawInsertClient = {
          $executeRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            return await originalExecuteRaw(strings, ...values);
          }) as typeof client.$executeRaw,
        };
        const patchedClient = {
          ...client,
          $queryRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            if (
              !insertedDriftedRevisionBeforePublish &&
              strings
                .join('?')
                .includes('INSERT INTO ai_provider_registry_revisions')
            ) {
              insertedDriftedRevisionBeforePublish = true;
              conflictFixture =
                await insertProviderRegistryRevisionWithDriftedMetadata({
                  db: rawInsertClient,
                  values,
                });
            }
            return await originalQueryRaw(strings, ...values);
          }) as typeof client.$queryRaw,
        } as PrismaClient;
        return patchedClient;
      },
    });

    await t.throwsAsync(
      providerRegistryRevisionModel.publishWorkspaceRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        providerId: 'provider-registry-row-conflict-provider',
        providerType: CopilotProviderType.OpenAICompatible,
        revision: 'provider-registry-row-conflict-r1',
        displayName: 'Provider registry row conflict',
        priority: 220,
        privacy: 'local',
        enabled: true,
        models: ['provider-registry-row-conflict-chat'],
        modelDefinitions: [
          {
            id: 'provider-registry-row-conflict-chat',
            rawModelId: 'provider-registry-row-conflict-chat-raw',
            displayName: 'Provider registry row conflict chat',
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
        ],
      }),
      {
        message:
          /Provider registry revision conflict reused mismatched row evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        providerRegistryRevisionModel,
        'db',
        originalDbDescriptor
      );
    }
  }

  t.true(insertedDriftedRevisionBeforePublish);
  t.truthy(conflictFixture);
  t.notDeepEqual(
    conflictFixture!.driftedMetadata,
    conflictFixture!.expectedMetadata
  );
  t.regex(conflictFixture!.fingerprint, /^[a-f0-9]{16}$/);
});

test('provider registry repair revision row conflict rejects mismatched evidence', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const providerRegistryRevisionModel = models.copilotProviderRegistryRevision;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(providerRegistryRevisionModel),
    'db'
  );
  let insertedDriftedRevisionBeforePublish = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertProviderRegistryRevisionWithDriftedMetadata>
  > | null = null;

  try {
    Object.defineProperty(providerRegistryRevisionModel, 'db', {
      configurable: true,
      get() {
        const client = originalDbDescriptor?.get?.call(this) as PrismaClient;
        const originalQueryRaw = client.$queryRaw.bind(client);
        const originalExecuteRaw = client.$executeRaw.bind(client);
        const rawInsertClient = {
          $executeRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            return await originalExecuteRaw(strings, ...values);
          }) as typeof client.$executeRaw,
        };
        const patchedClient = {
          ...client,
          $queryRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            if (
              !insertedDriftedRevisionBeforePublish &&
              strings
                .join('?')
                .includes('INSERT INTO ai_provider_registry_revisions')
            ) {
              insertedDriftedRevisionBeforePublish = true;
              conflictFixture =
                await insertProviderRegistryRevisionWithDriftedMetadata({
                  db: rawInsertClient,
                  values,
                });
            }
            return await originalQueryRaw(strings, ...values);
          }) as typeof client.$queryRaw,
        } as PrismaClient;
        return patchedClient;
      },
    });

    await t.throwsAsync(
      providerRegistryRevisionModel.publishWorkspaceRepairRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        executionRequestId: 'provider-registry-repair-row-conflict',
        requestFingerprint: 'request-fingerprint',
        candidateEvidenceSetFingerprint: 'candidate-evidence',
        taskRouteEvidenceSetFingerprint: 'task-route-evidence',
        repairJobFingerprint: 'repair-job',
        approvalRecordFingerprint: 'approval-record',
        payload: {
          version: 'provider-registry-revision-executor-payload/v1',
          kind: 'provider_registry_revision_publish',
          providerId: 'provider-registry-repair-provider',
          providerType: CopilotProviderType.OpenAICompatible,
          displayName: 'Provider registry repair row conflict',
          enabled: true,
          models: ['provider-registry-repair-chat'],
          modelDefinitions: [
            {
              id: 'provider-registry-repair-chat',
              rawModelId: 'provider-registry-repair-chat-raw',
              capabilities: [
                {
                  input: [ModelInputType.Text],
                  output: [ModelOutputType.Text],
                },
              ],
            },
          ],
          privacy: 'local',
          priority: 230,
          operationFingerprint: 'operation',
          operationSetFingerprint: 'operation-set',
          previewFingerprint: 'preview',
          catalogFingerprint: 'catalog',
          targetLocatorFingerprint: 'target-locator',
          candidateEvidenceFingerprints: ['candidate-one'],
          fallbackSourceChain: [],
        },
      }),
      {
        message:
          /Provider registry revision conflict reused mismatched row evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        providerRegistryRevisionModel,
        'db',
        originalDbDescriptor
      );
    }
  }

  t.true(insertedDriftedRevisionBeforePublish);
  t.truthy(conflictFixture);
  t.notDeepEqual(
    conflictFixture!.driftedMetadata,
    conflictFixture!.expectedMetadata
  );
  t.regex(conflictFixture!.fingerprint, /^[a-f0-9]{16}$/);
});

test('provider registry publish event fails closed when revision content changes before insert', async t => {
  const { app, db, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const providerRegistryRevisionModel = models.copilotProviderRegistryRevision;
  const providerId = 'provider-registry-event-drift-provider';
  const revisionName = 'provider-registry-event-drift-r1';

  const revision = await providerRegistryRevisionModel.publishWorkspaceRevision(
    {
      workspaceId: workspace.id,
      actorId: owner.id,
      providerId,
      providerType: CopilotProviderType.OpenAICompatible,
      revision: revisionName,
      displayName: 'Provider registry event drift',
      priority: 220,
      privacy: 'local',
      enabled: true,
      models: ['provider-registry-event-drift-chat'],
      modelDefinitions: [
        {
          id: 'provider-registry-event-drift-chat',
          rawModelId: 'provider-registry-event-drift-chat-raw',
          displayName: 'Provider registry event drift chat',
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
      ],
    }
  );
  t.is(revision.publishEventCount, 1);

  const staleRows = await db.$queryRaw<
    Array<{
      actorId: string | null;
      createdAt: Date;
      fallbackSourceChain: unknown;
      fingerprint: string;
      id: string;
      metadata: unknown;
      providerId: string;
      providerProfile: unknown;
      providerType: string | null;
      revision: string;
      scopeType: 'workspace';
      status: 'active';
      updatedAt: Date;
      workspaceId: string | null;
    }>
  >`
    SELECT
      id,
      provider_id AS "providerId",
      provider_type AS "providerType",
      scope_type AS "scopeType",
      workspace_id AS "workspaceId",
      actor_id AS "actorId",
      revision,
      status,
      fingerprint,
      provider_profile AS "providerProfile",
      fallback_source_chain AS "fallbackSourceChain",
      metadata,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM ai_provider_registry_revisions
    WHERE id = ${revision.id}
    LIMIT 1
  `;
  const staleRow = staleRows[0];
  t.truthy(staleRow);

  await db.$executeRaw`
    UPDATE ai_provider_registry_revisions
    SET updated_at = updated_at + interval '1 second'
    WHERE id = ${revision.id}
  `;

  const modelWithPrivateGet = providerRegistryRevisionModel as unknown as {
    getWorkspaceRevisionRow(input: {
      providerId: string;
      revision: string;
      workspaceId: string;
    }): Promise<typeof staleRow | null>;
  };
  const originalGetWorkspaceRevisionRow =
    modelWithPrivateGet.getWorkspaceRevisionRow.bind(
      providerRegistryRevisionModel
    );
  let returnedStaleRevision = false;
  modelWithPrivateGet.getWorkspaceRevisionRow = async input => {
    if (!returnedStaleRevision) {
      returnedStaleRevision = true;
      t.like(input, {
        providerId,
        revision: revisionName,
        workspaceId: workspace.id,
      });
      return staleRow;
    }
    return await originalGetWorkspaceRevisionRow(input);
  };

  try {
    await t.throwsAsync(
      providerRegistryRevisionModel.publishWorkspaceRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        providerId,
        providerType: CopilotProviderType.OpenAICompatible,
        revision: revisionName,
        displayName: 'Provider registry event drift',
        priority: 220,
        privacy: 'local',
        enabled: true,
        models: ['provider-registry-event-drift-chat'],
        modelDefinitions: [
          {
            id: 'provider-registry-event-drift-chat',
            rawModelId: 'provider-registry-event-drift-chat-raw',
            displayName: 'Provider registry event drift chat',
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
        ],
      }),
      {
        message:
          /Registry revision publish event could not be recorded because its revision state changed/,
      }
    );
  } finally {
    modelWithPrivateGet.getWorkspaceRevisionRow =
      originalGetWorkspaceRevisionRow;
  }

  t.true(returnedStaleRevision);
  const eventRows = await db.$queryRaw<Array<{ eventType: string }>>`
    SELECT event_type AS "eventType"
    FROM ai_registry_revision_publish_events
    WHERE revision_id = ${revision.id}
    ORDER BY created_at ASC, id ASC
  `;
  t.deepEqual(
    eventRows.map(row => row.eventType),
    ['revision_published']
  );
});

test(providerRegistryPublishTestName, async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  const publishResult = await app.gql({
    query: providerRegistryPublishMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        providerId: 'localmind-db-provider',
        revision: 'manual-provider-r1',
        idempotencyKey: ' provider-publish-idempotency-1 ',
        displayName: ' Published DB provider ',
        priority: 205,
        privacy: 'local',
        enabled: true,
        models: [' published-db-provider-chat ', 'published-db-provider-chat'],
        modelDefinitions: [
          {
            id: ' published-db-provider-chat ',
            rawModelId: ' published-db-provider-chat-raw ',
            displayName: ' Published DB provider chat ',
            aliases: [
              ' published-db-provider-chat-alias ',
              'published-db-provider-chat-alias',
            ],
            config: {
              apiKey: 'must-not-persist',
              baseURL: 'http://must-not-persist.invalid/v1',
            },
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
        ],
      },
    },
  });
  const revision = publishResult.publishCopilotProviderRegistryRevision as {
    actorId: string;
    fingerprint: string;
    id: string;
    publishEventCount: number;
    publishEvents: Array<{
      eventType: string;
      publishSource: string;
      registryFamily: string;
      registryKey: string;
      registryProviderId: string | null;
      revisionId: string;
      workspaceId: string | null;
    }>;
    providerId: string;
    providerHealthProbeAttempt: {
      attemptCount: number;
      completedAt: string | null;
      id: string;
      maxAttempts: number;
      providerHealthStateFingerprint: string | null;
      providerHealthStateId: string | null;
      providerId: string;
      providerProfileFingerprint: string;
      providerProfileSource: string | null;
      providerRegistryRevisionFingerprint: string;
      providerRegistryRevisionId: string;
      providerType: string | null;
      requestFingerprint: string;
      resultFingerprint: string | null;
      resultStatus: string | null;
      scopeType: string;
      status: string;
      workspaceId: string;
    };
    providerProfile: Record<string, unknown>;
    providerType: string;
    revision: string;
    scopeType: string;
    status: string;
    workspaceId: string;
  };

  t.is(revision.providerId, 'localmind-db-provider');
  t.is(revision.providerType, CopilotProviderType.OpenAICompatible);
  t.is(revision.scopeType, 'workspace');
  t.is(revision.workspaceId, workspace.id);
  t.is(revision.actorId, owner.id);
  t.is(revision.revision, 'manual-provider-r1');
  t.is(revision.status, 'active');
  t.regex(revision.fingerprint, /^[a-f0-9]{16}$/);
  t.is(revision.publishEventCount, 1);
  t.like(revision.publishEvents[0], {
    eventType: 'revision_published',
    publishSource: 'graphql_mutation',
    registryFamily: 'provider_registry',
    registryKey: 'localmind-db-provider',
    registryProviderId: 'localmind-db-provider',
    revisionId: revision.id,
    workspaceId: workspace.id,
  });
  t.like(revision.providerHealthProbeAttempt, {
    attemptCount: 0,
    completedAt: null,
    maxAttempts: 3,
    providerHealthStateFingerprint: null,
    providerHealthStateId: null,
    providerId: 'localmind-db-provider',
    providerProfileSource: 'db_revision',
    providerRegistryRevisionFingerprint: revision.fingerprint,
    providerRegistryRevisionId: revision.id,
    providerType: CopilotProviderType.OpenAICompatible,
    resultFingerprint: null,
    resultStatus: null,
    scopeType: 'workspace',
    status: 'queued',
    workspaceId: workspace.id,
  });
  t.regex(revision.providerHealthProbeAttempt.id, /^provider-health-probe-/);
  t.regex(
    revision.providerHealthProbeAttempt.providerProfileFingerprint,
    /^[a-f0-9]{16}$/
  );
  t.regex(
    revision.providerHealthProbeAttempt.requestFingerprint,
    /^[a-f0-9]{16}$/
  );
  t.deepEqual(revision.providerProfile.config, {});
  t.false(
    JSON.stringify(revision.providerProfile).includes('must-not-persist')
  );

  const rows = await db.$queryRaw<
    Array<{
      id: string;
      metadata: Record<string, unknown>;
      providerProfile: unknown;
    }>
  >`
    SELECT
      id,
      metadata,
      provider_profile AS "providerProfile"
    FROM ai_provider_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.is(rows.length, 1);
  t.is(
    rows[0].metadata.version,
    'provider-registry-revision-direct-publish/v1'
  );
  t.is(rows[0].metadata.publishSource, 'graphql_mutation');
  t.truthy(rows[0].metadata.idempotencyKeyFingerprint);
  t.false(JSON.stringify(rows[0].providerProfile).includes('must-not-persist'));

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_registry_revisions
      SET metadata = jsonb_set(
        metadata,
        ${'{publishSource}'}::text[],
        ${JSON.stringify('repair_execution_worker')}::jsonb
      )
      WHERE id = ${revision.id}
    `,
    {
      message: /ai_provider_registry_revisions_metadata_contract_check/,
    }
  );

  const duplicateResult = await app.gql({
    query: providerRegistryPublishMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        providerId: 'localmind-db-provider',
        revision: 'manual-provider-r1',
        idempotencyKey: 'provider-publish-idempotency-1',
        displayName: 'Published DB provider',
        priority: 205,
        privacy: 'local',
        enabled: true,
        models: ['published-db-provider-chat'],
        modelDefinitions: [
          {
            id: 'published-db-provider-chat',
            rawModelId: 'published-db-provider-chat-raw',
            displayName: 'Published DB provider chat',
            aliases: ['published-db-provider-chat-alias'],
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
        ],
      },
    },
  });
  t.is(duplicateResult.publishCopilotProviderRegistryRevision.id, revision.id);
  t.is(
    duplicateResult.publishCopilotProviderRegistryRevision.publishEventCount,
    2
  );
  t.deepEqual(
    duplicateResult.publishCopilotProviderRegistryRevision.publishEvents.map(
      (event: { eventType: string }) => event.eventType
    ),
    ['revision_reused', 'revision_published']
  );
  t.is(
    duplicateResult.publishCopilotProviderRegistryRevision
      .providerHealthProbeAttempt.id,
    revision.providerHealthProbeAttempt.id
  );
  const immediateProbeRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_provider_health_probe_attempts
    WHERE provider_registry_revision_id = ${revision.id}
  `;
  t.is(immediateProbeRows[0]?.count, 1);

  const overlong = 'x'.repeat(513);
  await t.throwsAsync(
    app.gql({
      query: providerRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          providerId: overlong,
          revision: 'manual-provider-overlong-direct',
          displayName: 'Overlong provider',
        },
      },
    })
  );
  const overlongRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_provider_registry_revisions
    WHERE revision = ${'manual-provider-overlong-direct'}
  `;
  t.deepEqual(overlongRows, []);

  await t.throwsAsync(
    app.gql({
      query: providerRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          providerId: 'missing-provider',
          revision: 'manual-provider-missing',
          displayName: 'Missing provider',
        },
      },
    })
  );

  const result = await app.gql({
    query: providerRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const model = result.currentUser.copilot.models.optionalModels.find(
    (item: { id: string }) =>
      item.id === 'localmind-db-provider/published-db-provider-chat'
  );

  t.truthy(model);
  t.is(model.name, 'Published DB provider chat');
  t.is(model.providerId, 'localmind-db-provider');
  t.is(model.providerName, 'Published DB provider');
  t.is(model.providerProfileSource, 'db_revision');
  t.is(
    model.providerProfileConfigPath,
    `ai_provider_registry_revisions[id=${revision.id}]`
  );
  t.deepEqual(model.providerConfiguredModelIds, [
    'published-db-provider-chat',
    'published-db-provider-chat-alias',
  ]);
  t.is(model.providerPrivacy, 'local');
  t.is(model.providerPriority, 205);
  t.is(model.routeModelId, 'published-db-provider-chat-raw');
  t.is(model.routeRawModelId, 'published-db-provider-chat-raw');
  t.is(model.routeModelDefinitionId, 'published-db-provider-chat');
  t.is(model.routeModelDefinitionSource, 'provider_profile');

  const outsider = await app.signupV1();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: providerRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          providerId: 'localmind-db-provider',
          revision: 'manual-provider-outsider',
          displayName: 'Outsider provider',
        },
      },
    })
  );
});

test('provider registry model filters unknown fallback source-chain provenance', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  const revision =
    await app.models.copilotProviderRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      providerId: 'localmind-db-provider',
      providerType: CopilotProviderType.OpenAICompatible,
      revision: 'manual-provider-source-chain',
      displayName: 'Source-chain DB provider',
      modelDefinitions: [
        {
          id: 'source-chain-provider-chat',
          rawModelId: 'source-chain-provider-chat-raw',
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
      ],
      fallbackSourceChain: [
        {
          source: 'provider_profile',
          scope: 'global',
          status: 'available',
          providerId: 'localmind-db-provider',
          providerType: 'unknown-provider-type' as never,
          actorId: { id: owner.id } as never,
          fingerprint: 123 as never,
          revision: ['config-profile-provider'] as never,
          updatedAt: new Date('2026-06-22T10:00:00.000Z') as never,
          workspaceId: { id: workspace.id } as never,
        },
        {
          source: 'unknown_source' as never,
          scope: 'global',
          status: 'available',
          providerId: 'localmind-db-provider',
        },
        {
          source: 'legacy_profile',
          scope: 'invalid_scope' as never,
          status: 'available',
          providerId: 'localmind-db-provider',
        },
        {
          source: 'legacy_profile',
          scope: 'global',
          status: 'untrusted_status',
          providerId: 'localmind-db-provider',
        },
        ...Array.from({ length: 20 }, (_, index) => ({
          source: 'legacy_profile' as const,
          scope: 'global' as const,
          status: 'available' as const,
          providerId: `bounded-provider-${index}`,
          providerType: CopilotProviderType.OpenAICompatible,
        })),
      ],
    });

  t.deepEqual(revision.fallbackSourceChain, [
    {
      source: 'provider_profile',
      scope: 'global',
      status: 'available',
      providerId: 'localmind-db-provider',
    },
    ...Array.from({ length: 15 }, (_, index) => ({
      source: 'legacy_profile',
      scope: 'global',
      status: 'available',
      providerId: `bounded-provider-${index}`,
      providerType: CopilotProviderType.OpenAICompatible,
    })),
  ]);
  t.is(revision.fallbackSourceChain.length, 16);

  const rows = await db.$queryRaw<Array<{ fallbackSourceChain: unknown }>>`
    SELECT fallback_source_chain AS "fallbackSourceChain"
    FROM ai_provider_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.deepEqual(rows[0].fallbackSourceChain, revision.fallbackSourceChain);
});

test('provider registry direct publish normalizes model-layer string inputs', async t => {
  const { app, db, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);

  const revision =
    await models.copilotProviderRegistryRevision.publishWorkspaceRevision({
      workspaceId: ` ${workspace.id} `,
      actorId: ` ${owner.id} `,
      providerId: ' localmind-db-provider ',
      providerType: CopilotProviderType.OpenAICompatible,
      revision: ' manual-provider-direct-bounds ',
      idempotencyKey: ' provider-direct-idempotency ',
      displayName: ' Direct DB provider ',
      models: [' direct-provider-chat ', 'direct-provider-chat', ''],
      modelDefinitions: [
        {
          id: ' direct-provider-chat ',
          rawModelId: ' direct-provider-chat-raw ',
          aliases: [' direct-provider-alias ', 'direct-provider-alias'],
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
      ],
      fallbackSourceChain: [],
    });

  t.like(revision, {
    actorId: owner.id,
    providerId: 'localmind-db-provider',
    revision: 'manual-provider-direct-bounds',
    workspaceId: workspace.id,
  });
  t.deepEqual(revision.providerProfile.models, ['direct-provider-chat']);
  t.deepEqual(revision.providerProfile.modelDefinitions?.[0]?.aliases, [
    'direct-provider-alias',
  ]);
  const rows = await db.$queryRaw<
    Array<{
      metadata: {
        idempotencyKeyFingerprint: string;
      };
    }>
  >`
    SELECT metadata
    FROM ai_provider_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.is(
    rows[0].metadata.idempotencyKeyFingerprint,
    providerRegistryRevisionFingerprint({
      version: 'provider-registry-publish-idempotency-key/v1',
      workspaceId: workspace.id,
      providerId: 'localmind-db-provider',
      idempotencyKey: 'provider-direct-idempotency',
    })
  );
});

test('provider registry hydrates malformed persisted provider profiles safely', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  await db.$executeRaw`
    INSERT INTO ai_provider_registry_revisions (
      id,
      provider_id,
      provider_type,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      provider_profile,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'provider-registry-legacy-hydration-row'},
      ${'localmind-db-provider'},
      ${CopilotProviderType.OpenAICompatible},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'manual-provider-hydration'},
      ${'active'},
      ${'legacy-provider-hydration-fp'},
      ${JSON.stringify({
        id: 'wrong-provider-id',
        type: 'not-a-provider-type',
        source: 'untrusted-source',
        config: {
          apiKey: 'must-not-hydrate',
        },
        displayName: '  Hydrated provider  ',
        enabled: true,
        models: [' hydration-chat ', 'hydration-chat', ''],
        modelDefinitions: [
          {
            id: ' hydration-chat ',
            aliases: [' hydration-alias ', 'hydration-alias'],
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
          {
            id: 'broken-definition',
            capabilities: [],
          },
        ],
      })}::jsonb,
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify({
        version: 'provider-registry-revision-legacy-hydration/v1',
      })}::jsonb,
      ${new Date('2026-06-23T03:05:00.000Z')},
      ${new Date('2026-06-23T03:05:00.000Z')}
    )
  `;

  const hydrated = await app.models.copilotProviderRegistryRevision.resolve(
    workspace.id,
    'localmind-db-provider'
  );
  t.truthy(hydrated);
  t.is(hydrated?.providerProfile.id, 'localmind-db-provider');
  t.is(hydrated?.providerProfile.type, CopilotProviderType.OpenAICompatible);
  t.is(hydrated?.providerProfile.source, 'db_revision');
  t.deepEqual(hydrated?.providerProfile.config, {});
  t.is(hydrated?.providerProfile.displayName, 'Hydrated provider');
  t.true(hydrated?.providerProfile.enabled);
  t.deepEqual(hydrated?.providerProfile.models, ['hydration-chat']);
  t.is(hydrated?.providerProfile.modelDefinitions?.length, 1);
  t.is(hydrated?.providerProfile.modelDefinitions?.[0].id, 'hydration-chat');
  t.deepEqual(hydrated?.providerProfile.modelDefinitions?.[0].aliases, [
    'hydration-alias',
  ]);
});

test('provider registry repair payload bounds durable string fields', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const overlong = 'x'.repeat(513);
  const revisionOverlong = 'x'.repeat(507);
  const metadataLargeStrings = Array.from(
    { length: 40 },
    (_, index) => `${index}-${'m'.repeat(500)}`
  );

  await t.throwsAsync(
    app.models.copilotProviderRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: 'provider-wrapper-overlong',
      requestFingerprint: overlong,
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'provider-registry-revision-executor-payload/v1',
        kind: 'provider_registry_revision_publish',
        providerId: 'localmind-db-provider',
        providerType: CopilotProviderType.OpenAICompatible,
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
        candidateEvidenceFingerprints: [],
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Provider registry publish requires requestFingerprint/,
    }
  );

  const wrapperRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_provider_registry_revisions
    WHERE revision = ${'repair-provider-wrapper-overlong'}
  `;
  t.deepEqual(wrapperRows, []);

  await t.throwsAsync(
    app.models.copilotProviderRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: revisionOverlong,
      requestFingerprint: 'request-fingerprint',
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'provider-registry-revision-executor-payload/v1',
        kind: 'provider_registry_revision_publish',
        providerId: 'localmind-db-provider',
        providerType: CopilotProviderType.OpenAICompatible,
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
        candidateEvidenceFingerprints: [],
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Provider registry publish requires executionRequestId/,
    }
  );

  await t.throwsAsync(
    app.models.copilotProviderRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: 'provider-metadata-overlarge',
      requestFingerprint: 'request-fingerprint',
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'provider-registry-revision-executor-payload/v1',
        kind: 'provider_registry_revision_publish',
        providerId: 'localmind-db-provider',
        providerType: CopilotProviderType.OpenAICompatible,
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
        candidateEvidenceFingerprints: metadataLargeStrings,
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Provider registry publish metadata is too large/,
    }
  );

  const metadataRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_provider_registry_revisions
    WHERE revision = ${'repair-provider-metadata-overlarge'}
  `;
  t.deepEqual(metadataRows, []);

  await t.throwsAsync(
    app.models.copilotProviderRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: 'provider-payload-overlong',
      requestFingerprint: 'request-fingerprint',
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'provider-registry-revision-executor-payload/v1',
        kind: 'provider_registry_revision_publish',
        providerId: overlong,
        providerType: CopilotProviderType.OpenAICompatible,
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
        candidateEvidenceFingerprints: [],
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Invalid repair execution executor payload field: providerId/,
    }
  );

  const failedRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_provider_registry_revisions
    WHERE revision = ${'repair-provider-payload-overlong'}
  `;
  t.deepEqual(failedRows, []);

  const revision =
    await app.models.copilotProviderRegistryRevision.publishWorkspaceRepairRevision(
      {
        workspaceId: ` ${workspace.id} `,
        actorId: ` ${owner.id} `,
        executionRequestId: ' provider-payload-normalized ',
        requestFingerprint: ' request-fingerprint ',
        candidateEvidenceSetFingerprint: ' candidate-evidence ',
        taskRouteEvidenceSetFingerprint: ' task-route-evidence ',
        repairJobFingerprint: ' repair-job ',
        approvalRecordFingerprint: ' approval-record ',
        payload: {
          version: 'provider-registry-revision-executor-payload/v1',
          kind: 'provider_registry_revision_publish',
          providerId: ' localmind-db-provider ',
          providerType: CopilotProviderType.OpenAICompatible,
          displayName: ' Local provider ',
          models: [' model-one ', 'model-one', overlong, ''],
          modelDefinitions: [
            {
              id: ' model-one ',
              rawModelId: ' raw-model-one ',
              aliases: [' alias-one ', 'alias-one', overlong],
              behaviorFlags: [' flag-one ', 'flag-one', overlong],
              capabilities: [
                {
                  input: [ModelInputType.Text],
                  output: [ModelOutputType.Text],
                },
              ],
            },
          ],
          operationFingerprint: ' operation ',
          operationSetFingerprint: ' operation-set ',
          previewFingerprint: ' preview ',
          catalogFingerprint: ' catalog ',
          targetLocatorFingerprint: ' target-locator ',
          candidateEvidenceFingerprints: [
            ' candidate-one ',
            'candidate-one',
            overlong,
          ],
          fallbackSourceChain: [],
        },
      }
    );

  t.is(revision.providerId, 'localmind-db-provider');
  t.is(revision.workspaceId, workspace.id);
  t.is(revision.actorId, owner.id);
  t.is(revision.revision, 'repair-provider-payload-normalized');
  t.deepEqual(revision.providerProfile.models, ['model-one']);
  t.deepEqual(revision.providerProfile.modelDefinitions?.[0]?.aliases, [
    'alias-one',
  ]);
  t.deepEqual(revision.providerProfile.modelDefinitions?.[0]?.behaviorFlags, [
    'flag-one',
  ]);
  const rows = await db.$queryRaw<
    Array<{
      metadata: {
        candidateEvidenceFingerprints: string[];
        executionRequestId: string;
        requestFingerprint: string;
      };
    }>
  >`
    SELECT metadata
    FROM ai_provider_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.like(rows[0].metadata, {
    candidateEvidenceFingerprints: ['candidate-one'],
    executionRequestId: 'provider-payload-normalized',
    requestFingerprint: 'request-fingerprint',
  });
});

test('registry revision publish event conflict rejects mismatched evidence', async t => {
  let conflictFingerprint: string | null = null;
  const db = {
    $queryRaw: async <T>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T> => {
      const statement = strings.join('?');
      if (
        statement.includes('INSERT INTO ai_registry_revision_publish_events')
      ) {
        conflictFingerprint = String(values[18]);
        return [] as T;
      }
      if (statement.includes('FROM ai_registry_revision_publish_events')) {
        return [
          {
            id: `registry-revision-publish-event-${conflictFingerprint}`,
            registryFamily: 'prompt_registry',
            revisionId: 'prompt-revision-conflict',
            registryProviderId: null,
            registryModelId: null,
            workspaceId: 'workspace-registry-event-conflict',
            actorId: 'actor-registry-event-conflict',
            scopeType: 'workspace',
            registryKey: 'Prompt conflict event',
            revision: 'registry-event-conflict',
            revisionFingerprint: 'drifted-revision-fingerprint',
            revisionStatus: 'active',
            eventType: 'revision_published',
            publishSource: 'graphql_mutation',
            eventFingerprint: conflictFingerprint,
            metadata: {
              version: 'registry-revision-publish-event/v1',
              registryFamily: 'prompt_registry',
              eventType: 'revision_published',
              publishSource: 'graphql_mutation',
              revisionId: 'prompt-revision-conflict',
              registryKey: 'Prompt conflict event',
              revision: 'registry-event-conflict',
              revisionFingerprint: 'drifted-revision-fingerprint',
              revisionStatus: 'active',
              workspaceId: 'workspace-registry-event-conflict',
              actorId: 'actor-registry-event-conflict',
              eventNonce: 'existing-conflict-nonce',
            },
            createdAt: new Date('2026-06-23T08:00:00.000Z'),
          },
        ] as T;
      }
      throw new Error(`Unexpected registry publish event query: ${statement}`);
    },
    $executeRaw: () => 0,
  };

  await t.throwsAsync(
    createRegistryRevisionPublishEvent(db, {
      actorId: 'actor-registry-event-conflict',
      createdAt: new Date('2026-06-23T08:00:00.000Z'),
      eventType: 'revision_published',
      metadata: {},
      publishSource: 'graphql_mutation',
      registryFamily: 'prompt_registry',
      registryKey: 'Prompt conflict event',
      revision: 'registry-event-conflict',
      revisionFallbackSourceChain: [],
      revisionFingerprint: 'expected-revision-fingerprint',
      revisionId: 'prompt-revision-conflict',
      revisionMetadata: {},
      revisionStatus: 'active',
      revisionUpdatedAt: new Date('2026-06-23T08:00:00.000Z'),
      scopeType: 'workspace',
      workspaceId: 'workspace-registry-event-conflict',
    }),
    {
      message:
        /Registry revision publish event conflict reused mismatched evidence/,
    }
  );
  t.regex(conflictFingerprint ?? '', /^[a-f0-9]{16}$/);
});

test('registry revision publish events persist direct publish and reuse history across families', async t => {
  const { app, db, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);

  const promptRevision =
    await models.copilotPromptRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName: 'Chat With AFFiNE AI',
      registryFingerprint: 'registry-event-prompt-fingerprint',
      registryId: 42,
      registryUpdatedAt: new Date('2026-06-23T01:00:00.000Z').toISOString(),
      gateStatus: 'allowed',
      publishStatus: 'ready',
      validationReason: 'event history direct publish',
      validationIssueCount: 0,
      validationBlockingCount: 0,
      validationErrorCount: 0,
      modelRouteFingerprints: [],
      taskRouteFingerprints: [],
      revision: 'event-history-prompt',
    });
  const promptReuse =
    await models.copilotPromptRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName: 'Chat With AFFiNE AI',
      registryFingerprint: 'registry-event-prompt-fingerprint',
      registryId: 42,
      registryUpdatedAt: new Date('2026-06-23T01:00:00.000Z').toISOString(),
      gateStatus: 'allowed',
      publishStatus: 'ready',
      validationReason: 'event history direct publish',
      validationIssueCount: 0,
      validationBlockingCount: 0,
      validationErrorCount: 0,
      modelRouteFingerprints: [],
      taskRouteFingerprints: [],
      revision: 'event-history-prompt',
    });

  const taskRevision =
    await models.copilotTaskRoutePolicyRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      featureKind: 'embedding',
      modelId: 'event-history-embedding-model',
      revision: 'event-history-task-route',
    });
  const taskReuse =
    await models.copilotTaskRoutePolicyRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      featureKind: 'embedding',
      modelId: 'event-history-embedding-model',
      revision: 'event-history-task-route',
    });

  const modelRevision =
    await models.copilotModelRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      providerId: 'localmind-db-provider',
      modelId: 'event-history-model',
      revision: 'event-history-model',
      modelDefinition: {
        id: 'event-history-model',
        rawModelId: 'event-history-model',
        displayName: 'Event history model',
        capabilities: [
          {
            input: [ModelInputType.Text],
            output: [ModelOutputType.Text],
          },
        ],
      },
    });
  const modelReuse =
    await models.copilotModelRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      providerId: 'localmind-db-provider',
      modelId: 'event-history-model',
      revision: 'event-history-model',
      modelDefinition: {
        id: 'event-history-model',
        rawModelId: 'event-history-model',
        displayName: 'Event history model',
        capabilities: [
          {
            input: [ModelInputType.Text],
            output: [ModelOutputType.Text],
          },
        ],
      },
    });

  const providerRevision =
    await models.copilotProviderRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      providerId: 'event-history-provider',
      providerType: CopilotProviderType.OpenAICompatible,
      revision: 'event-history-provider',
      displayName: 'Event history provider',
      models: ['event-history-model'],
      modelDefinitions: [
        {
          id: 'event-history-model',
          rawModelId: 'event-history-model',
          displayName: 'Event history model',
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
      ],
    });
  const providerReuse =
    await models.copilotProviderRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      providerId: 'event-history-provider',
      providerType: CopilotProviderType.OpenAICompatible,
      revision: 'event-history-provider',
      displayName: 'Event history provider',
      models: ['event-history-model'],
      modelDefinitions: [
        {
          id: 'event-history-model',
          rawModelId: 'event-history-model',
          displayName: 'Event history model',
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
      ],
    });

  const assertPublishHistory = (
    revision: {
      id: string;
      publishEventCount: number;
      publishEvents: Array<{
        eventType: string;
        publishSource: string;
        registryFamily: string;
        registryKey: string;
        revisionId: string;
        workspaceId?: string | null;
      }>;
    },
    expected: {
      eventTypes: string[];
      registryFamily: string;
      registryKey: string;
    }
  ) => {
    t.is(revision.publishEventCount, expected.eventTypes.length);
    t.deepEqual(
      revision.publishEvents.map(event => event.eventType),
      expected.eventTypes
    );
    for (const event of revision.publishEvents) {
      t.like(event, {
        publishSource: 'graphql_mutation',
        registryFamily: expected.registryFamily,
        registryKey: expected.registryKey,
        revisionId: revision.id,
        workspaceId: workspace.id,
      });
    }
  };

  assertPublishHistory(promptRevision, {
    eventTypes: ['revision_published'],
    registryFamily: 'prompt_registry',
    registryKey: 'Chat With AFFiNE AI',
  });
  assertPublishHistory(promptReuse, {
    eventTypes: ['revision_reused', 'revision_published'],
    registryFamily: 'prompt_registry',
    registryKey: 'Chat With AFFiNE AI',
  });
  assertPublishHistory(taskRevision, {
    eventTypes: ['revision_published'],
    registryFamily: 'task_route_policy',
    registryKey: 'embedding',
  });
  assertPublishHistory(taskReuse, {
    eventTypes: ['revision_reused', 'revision_published'],
    registryFamily: 'task_route_policy',
    registryKey: 'embedding',
  });
  assertPublishHistory(modelRevision, {
    eventTypes: ['revision_published'],
    registryFamily: 'model_registry',
    registryKey: 'localmind-db-provider:event-history-model',
  });
  assertPublishHistory(modelReuse, {
    eventTypes: ['revision_reused', 'revision_published'],
    registryFamily: 'model_registry',
    registryKey: 'localmind-db-provider:event-history-model',
  });
  assertPublishHistory(providerRevision, {
    eventTypes: ['revision_published'],
    registryFamily: 'provider_registry',
    registryKey: 'event-history-provider',
  });
  assertPublishHistory(providerReuse, {
    eventTypes: ['revision_reused', 'revision_published'],
    registryFamily: 'provider_registry',
    registryKey: 'event-history-provider',
  });

  const eventRows = await db.$queryRaw<
    Array<{
      eventCount: number;
      eventTypes: string[];
      registryFamily: string;
      revisionId: string;
    }>
  >`
    SELECT
      registry_family AS "registryFamily",
      revision_id AS "revisionId",
      COUNT(*)::int AS "eventCount",
      array_agg(
        event_type
        ORDER BY
          created_at ASC,
          CASE event_type
            WHEN 'revision_published' THEN 0
            WHEN 'revision_reused' THEN 1
            ELSE 2
          END ASC,
          id ASC
      ) AS "eventTypes"
    FROM ai_registry_revision_publish_events
    WHERE revision_id = ANY(${[
      promptRevision.id,
      taskRevision.id,
      modelRevision.id,
      providerRevision.id,
    ]})
    GROUP BY registry_family, revision_id
    ORDER BY registry_family ASC
  `;
  t.deepEqual(
    eventRows.map(row => ({
      eventCount: row.eventCount,
      eventTypes: row.eventTypes,
      registryFamily: row.registryFamily,
      revisionId: row.revisionId,
    })),
    [
      {
        eventCount: 2,
        eventTypes: ['revision_published', 'revision_reused'],
        registryFamily: 'model_registry',
        revisionId: modelRevision.id,
      },
      {
        eventCount: 2,
        eventTypes: ['revision_published', 'revision_reused'],
        registryFamily: 'prompt_registry',
        revisionId: promptRevision.id,
      },
      {
        eventCount: 2,
        eventTypes: ['revision_published', 'revision_reused'],
        registryFamily: 'provider_registry',
        revisionId: providerRevision.id,
      },
      {
        eventCount: 2,
        eventTypes: ['revision_published', 'revision_reused'],
        registryFamily: 'task_route_policy',
        revisionId: taskRevision.id,
      },
    ]
  );

  const orphanPublishRevisionCreatedAt = new Date('2026-06-23T01:45:00.000Z');
  await t.throwsAsync(
    db.$executeRaw`
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
        ${'prompt-publish-history-orphan'},
        ${'Chat With AFFiNE AI'},
        ${'workspace'},
        ${workspace.id},
        ${owner.id},
        ${'publish-history-orphan'},
        ${'active'},
        ${'pubhistoryorphan01'},
        ${JSON.stringify([])}::jsonb,
        ${JSON.stringify({
          version: 'prompt-registry-revision-direct-publish/v1',
          publishSource: 'graphql_mutation',
        })}::jsonb,
        ${orphanPublishRevisionCreatedAt},
        ${orphanPublishRevisionCreatedAt}
      )
    `,
    {
      message: /ai_prompt_registry_revisions_publish_history_required_check/,
    }
  );

  const validPublishRevisionId = 'prompt-publish-history-valid';
  const validPublishRevision = 'publish-history-valid';
  const validPublishFingerprint = 'pubhistoryvalid01';
  const validPublishCreatedAt = new Date('2026-06-23T01:46:00.000Z');
  await db.$transaction(async tx => {
    await tx.$executeRaw`
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
        ${validPublishRevisionId},
        ${'Chat With AFFiNE AI'},
        ${'workspace'},
        ${workspace.id},
        ${owner.id},
        ${validPublishRevision},
        ${'active'},
        ${validPublishFingerprint},
        ${JSON.stringify([])}::jsonb,
        ${JSON.stringify({
          version: 'prompt-registry-revision-direct-publish/v1',
          publishSource: 'graphql_mutation',
        })}::jsonb,
        ${validPublishCreatedAt},
        ${validPublishCreatedAt}
      )
    `;
    await tx.$executeRaw`
      INSERT INTO ai_registry_revision_publish_events (
        id,
        registry_family,
        revision_id,
        prompt_registry_revision_id,
        task_route_policy_revision_id,
        model_registry_revision_id,
        provider_registry_revision_id,
        registry_provider_id,
        registry_model_id,
        workspace_id,
        actor_id,
        scope_type,
        registry_key,
        revision,
        revision_fingerprint,
        revision_status,
        event_type,
        publish_source,
        event_fingerprint,
        metadata,
        created_at
      )
      VALUES (
        ${'registry-publish-history-valid-event'},
        ${'prompt_registry'},
        ${validPublishRevisionId},
        ${validPublishRevisionId},
        ${null},
        ${null},
        ${null},
        ${null},
        ${null},
        ${workspace.id},
        ${owner.id},
        ${'workspace'},
        ${'Chat With AFFiNE AI'},
        ${validPublishRevision},
        ${validPublishFingerprint},
        ${'active'},
        ${'revision_published'},
        ${'graphql_mutation'},
        ${'1234567890abcdef'},
        ${JSON.stringify({
          version: 'registry-revision-publish-event/v1',
          registryFamily: 'prompt_registry',
          eventType: 'revision_published',
          publishSource: 'graphql_mutation',
          revisionId: validPublishRevisionId,
          registryKey: 'Chat With AFFiNE AI',
          revision: validPublishRevision,
          revisionFingerprint: validPublishFingerprint,
          revisionStatus: 'active',
          workspaceId: workspace.id,
          actorId: owner.id,
          promptName: 'Chat With AFFiNE AI',
        })}::jsonb,
        ${new Date('2026-06-23T01:46:01.000Z')}
      )
    `;
  });
  const validPublishRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_registry_revision_publish_events
    WHERE revision_id = ${validPublishRevisionId}
      AND event_type = ${'revision_published'}
  `;
  t.deepEqual(validPublishRows, [{ count: 1 }]);

  await t.throwsAsync(
    db.$executeRaw`
      DELETE FROM ai_prompt_registry_revisions
      WHERE id = ${validPublishRevisionId}
    `,
    {
      message: /ai_prompt_registry_revisions_delete_restrict_check/,
    }
  );
  const cascadeWorkspace = await createWorkspace(app);
  const cascadeRevision =
    await models.copilotPromptRegistryRevision.publishWorkspaceRevision({
      workspaceId: cascadeWorkspace.id,
      actorId: owner.id,
      promptName: 'Chat With AFFiNE AI',
      registryFingerprint: 'registry-event-cascade-prompt-fingerprint',
      registryId: 42,
      registryUpdatedAt: new Date('2026-06-23T01:46:30.000Z').toISOString(),
      gateStatus: 'allowed',
      publishStatus: 'ready',
      validationReason: 'event history cascade publish',
      validationIssueCount: 0,
      validationBlockingCount: 0,
      validationErrorCount: 0,
      modelRouteFingerprints: [],
      taskRouteFingerprints: [],
      revision: 'event-history-cascade-prompt',
    });
  await db.$executeRaw`
    DELETE FROM workspaces
    WHERE id = ${cascadeWorkspace.id}
  `;
  const cascadeRevisionRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_prompt_registry_revisions
    WHERE id = ${cascadeRevision.id}
  `;
  t.deepEqual(cascadeRevisionRows, [{ count: 0 }]);
  const validPublishCascadeRows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM ai_registry_revision_publish_events
    WHERE revision_id = ${cascadeRevision.id}
  `;
  t.deepEqual(validPublishCascadeRows, [{ count: 0 }]);

  const reuseOnlyRevisionId = 'prompt-publish-history-reuse-only';
  const reuseOnlyRevision = 'publish-history-reuse-only';
  const reuseOnlyFingerprint = 'pubhistoryreuse01';
  const reuseOnlyCreatedAt = new Date('2026-06-23T01:47:00.000Z');
  await db.$executeRaw`
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
      ${reuseOnlyRevisionId},
      ${'Chat With AFFiNE AI'},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${reuseOnlyRevision},
      ${'active'},
      ${reuseOnlyFingerprint},
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify({
        version: 'prompt-registry-revision-test/v1',
      })}::jsonb,
      ${reuseOnlyCreatedAt},
      ${reuseOnlyCreatedAt}
    )
  `;
  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_registry_revision_publish_events (
        id,
        registry_family,
        revision_id,
        prompt_registry_revision_id,
        task_route_policy_revision_id,
        model_registry_revision_id,
        provider_registry_revision_id,
        registry_provider_id,
        registry_model_id,
        workspace_id,
        actor_id,
        scope_type,
        registry_key,
        revision,
        revision_fingerprint,
        revision_status,
        event_type,
        publish_source,
        event_fingerprint,
        metadata,
        created_at
      )
      VALUES (
        ${'registry-publish-history-reuse-only-event'},
        ${'prompt_registry'},
        ${reuseOnlyRevisionId},
        ${reuseOnlyRevisionId},
        ${null},
        ${null},
        ${null},
        ${null},
        ${null},
        ${workspace.id},
        ${owner.id},
        ${'workspace'},
        ${'Chat With AFFiNE AI'},
        ${reuseOnlyRevision},
        ${reuseOnlyFingerprint},
        ${'active'},
        ${'revision_reused'},
        ${'graphql_mutation'},
        ${'abcdef1234567890'},
        ${JSON.stringify({
          version: 'registry-revision-publish-event/v1',
          registryFamily: 'prompt_registry',
          eventType: 'revision_reused',
          publishSource: 'graphql_mutation',
          revisionId: reuseOnlyRevisionId,
          registryKey: 'Chat With AFFiNE AI',
          revision: reuseOnlyRevision,
          revisionFingerprint: reuseOnlyFingerprint,
          revisionStatus: 'active',
          workspaceId: workspace.id,
          actorId: owner.id,
          promptName: 'Chat With AFFiNE AI',
        })}::jsonb,
        ${new Date('2026-06-23T01:47:01.000Z')}
      )
    `,
    {
      message: /ai_registry_revision_publish_events_history_required_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      DELETE FROM ai_registry_revision_publish_events
      WHERE revision_id = ${promptRevision.id}
        AND event_type = ${'revision_published'}
    `,
    {
      message:
        /ai_registry_revision_publish_events_delete_restrict_check|ai_registry_revision_publish_events_history_required_check|ai_prompt_registry_revisions_publish_history_required_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      DELETE FROM ai_registry_revision_publish_events
      WHERE revision_id = ${promptRevision.id}
        AND event_type = ${'revision_reused'}
    `,
    {
      message: /ai_registry_revision_publish_events_delete_restrict_check/,
    }
  );

  const promptEventRows = await db.$queryRaw<
    Array<{
      actorId: string | null;
      metadata: {
        actorId?: string;
        eventType?: string;
        promptName?: string;
        publishSource?: string;
        registryFamily?: string;
        revisionId?: string;
        workspaceId?: string;
      };
      promptRegistryRevisionId: string | null;
      publishSource: string;
      workspaceId: string | null;
    }>
  >`
    SELECT
      actor_id AS "actorId",
      metadata,
      prompt_registry_revision_id AS "promptRegistryRevisionId",
      publish_source AS "publishSource",
      workspace_id AS "workspaceId"
    FROM ai_registry_revision_publish_events
    WHERE revision_id = ${promptRevision.id}
      AND event_type = ${'revision_published'}
    LIMIT 1
  `;
  t.like(promptEventRows[0], {
    actorId: owner.id,
    promptRegistryRevisionId: promptRevision.id,
    publishSource: 'graphql_mutation',
    workspaceId: workspace.id,
  });
  t.like(promptEventRows[0].metadata, {
    actorId: owner.id,
    eventType: 'revision_published',
    promptName: 'Chat With AFFiNE AI',
    publishSource: 'graphql_mutation',
    registryFamily: 'prompt_registry',
    revisionId: promptRevision.id,
    workspaceId: workspace.id,
  });

  await db.$executeRaw`
    UPDATE ai_registry_revision_publish_events
    SET metadata = metadata
    WHERE revision_id = ${promptRevision.id}
      AND event_type = ${'revision_published'}
  `;

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_registry_revision_publish_events
      SET
        publish_source = ${'repair_execution_worker'},
        metadata = jsonb_set(
          metadata,
          ${'{publishSource}'}::text[],
          ${JSON.stringify('repair_execution_worker')}::jsonb
        )
      WHERE revision_id = ${promptRevision.id}
        AND event_type = ${'revision_published'}
    `,
    {
      message:
        /ai_registry_revision_publish_events_content_update_restrict_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_registry_revision_publish_events
      SET event_fingerprint = ${'0123456789abcdef'}
      WHERE revision_id = ${promptRevision.id}
        AND event_type = ${'revision_published'}
    `,
    {
      message:
        /ai_registry_revision_publish_events_content_update_restrict_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_registry_revision_publish_events
      SET metadata = metadata - ${'publishSource'}
      WHERE revision_id = ${promptRevision.id}
        AND event_type = ${'revision_published'}
    `,
    {
      message: /ai_registry_revision_publish_events_metadata_shape_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_registry_revision_publish_events
      SET
        registry_family = ${'model_registry'},
        model_registry_revision_id = revision_id,
        prompt_registry_revision_id = ${null}
      WHERE revision_id = ${promptRevision.id}
        AND event_type = ${'revision_published'}
    `,
    {
      message:
        /ai_registry_revision_publish_events_revision_family_check|ai_registry_revision_publish_events_model_revision_fkey|ai_registry_revision_publish_events_metadata_shape_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_registry_revision_publish_events
      SET
        revision_fingerprint = ${'drifted-event-fingerprint'},
        metadata = jsonb_set(
          metadata,
          ${'{revisionFingerprint}'}::text[],
          ${JSON.stringify('drifted-event-fingerprint')}::jsonb
        )
      WHERE revision_id = ${promptRevision.id}
        AND event_type = ${'revision_published'}
    `,
    {
      message:
        /ai_registry_revision_publish_events_prompt_snapshot_fkey|ai_registry_publish_events_prompt_global_snapshot_fkey|ai_registry_revision_publish_events_content_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_registry_revision_publish_events
      SET
        actor_id = ${null},
        metadata = metadata - ${'actorId'}
      WHERE revision_id = ${promptRevision.id}
        AND event_type = ${'revision_published'}
    `,
    {
      message:
        /ai_registry_revision_publish_events_workspace_actor_check|ai_registry_revision_publish_events_content_update_restrict_check/,
    }
  );
  const driftActor = await app.createUser();
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_prompt_registry_revisions
      SET actor_id = ${driftActor.id}
      WHERE id = ${promptRevision.id}
    `,
    {
      message: /ai_registry_revision_publish_events_prompt_snapshot_fkey/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_task_route_policy_revisions
      SET actor_id = ${driftActor.id}
      WHERE id = ${taskRevision.id}
    `,
    {
      message: /ai_registry_revision_publish_events_task_snapshot_fkey/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_model_registry_revisions
      SET actor_id = ${driftActor.id}
      WHERE id = ${modelRevision.id}
    `,
    {
      message: /ai_registry_revision_publish_events_model_snapshot_fkey/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_registry_revisions
      SET actor_id = ${driftActor.id}
      WHERE id = ${providerRevision.id}
    `,
    {
      message: /ai_registry_revision_publish_events_provider_snapshot_fkey/,
    }
  );

  const unpublishedPromptRevisionId = 'prompt-unpublished-content-immutable';
  const unpublishedTaskRevisionId = 'task-unpublished-content-immutable';
  const unpublishedModelRevisionId = 'model-unpublished-content-immutable';
  const unpublishedProviderRevisionId =
    'provider-unpublished-content-immutable';
  const unpublishedRevisionCreatedAt = new Date('2026-06-23T01:30:00.000Z');
  const unpublishedRevisionMetadata = {
    version: 'registry-revision-unpublished-content-test/v1',
  };

  await db.$executeRaw`
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
      ${unpublishedPromptRevisionId},
      ${'Chat With AFFiNE AI'},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'unpublished-content-prompt'},
      ${'active'},
      ${'unpub-prompt-fingerprint'},
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify(unpublishedRevisionMetadata)}::jsonb,
      ${unpublishedRevisionCreatedAt},
      ${unpublishedRevisionCreatedAt}
    )
  `;
  await db.$executeRaw`
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
      ${unpublishedTaskRevisionId},
      ${'rerank'},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'unpublished-content-task'},
      ${'active'},
      ${'unpublished-route-model'},
      ${'rerank'},
      ${'copilot.models.rerank'},
      ${'unpub-task-fingerprint'},
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify(unpublishedRevisionMetadata)}::jsonb,
      ${unpublishedRevisionCreatedAt},
      ${unpublishedRevisionCreatedAt}
    )
  `;
  await db.$executeRaw`
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
      ${unpublishedModelRevisionId},
      ${'unpublished-content-provider'},
      ${'unpublished-content-model'},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'unpublished-content-model'},
      ${'active'},
      ${'unpub-model-fingerprint'},
      ${JSON.stringify({
        id: 'unpublished-content-model',
        rawModelId: 'unpublished-content-model',
        displayName: 'Unpublished content model',
        capabilities: [
          {
            input: [ModelInputType.Text],
            output: [ModelOutputType.Text],
          },
        ],
      })}::jsonb,
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify(unpublishedRevisionMetadata)}::jsonb,
      ${unpublishedRevisionCreatedAt},
      ${unpublishedRevisionCreatedAt}
    )
  `;
  await db.$executeRaw`
    INSERT INTO ai_provider_registry_revisions (
      id,
      provider_id,
      provider_type,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      provider_profile,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${unpublishedProviderRevisionId},
      ${'unpublished-content-provider'},
      ${CopilotProviderType.OpenAICompatible},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'unpublished-content-provider'},
      ${'active'},
      ${'unpub-provider-fingerprint'},
      ${JSON.stringify({
        id: 'unpublished-content-provider',
        displayName: 'Unpublished content provider',
        models: ['unpublished-content-model'],
      })}::jsonb,
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify(unpublishedRevisionMetadata)}::jsonb,
      ${unpublishedRevisionCreatedAt},
      ${unpublishedRevisionCreatedAt}
    )
  `;

  await db.$executeRaw`
    UPDATE ai_prompt_registry_revisions
    SET metadata = metadata
    WHERE id = ${unpublishedPromptRevisionId}
  `;
  await db.$executeRaw`
    UPDATE ai_task_route_policy_revisions
    SET model_id = model_id
    WHERE id = ${unpublishedTaskRevisionId}
  `;
  await db.$executeRaw`
    UPDATE ai_model_registry_revisions
    SET model_definition = model_definition
    WHERE id = ${unpublishedModelRevisionId}
  `;
  await db.$executeRaw`
    UPDATE ai_provider_registry_revisions
    SET provider_profile = provider_profile
    WHERE id = ${unpublishedProviderRevisionId}
  `;

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_prompt_registry_revisions
      SET metadata = metadata || ${JSON.stringify({
        driftedBeforePublish: true,
      })}::jsonb
      WHERE id = ${unpublishedPromptRevisionId}
    `,
    {
      message: /ai_prompt_registry_revisions_content_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_task_route_policy_revisions
      SET model_id = ${'drifted-unpublished-route-model'}
      WHERE id = ${unpublishedTaskRevisionId}
    `,
    {
      message: /ai_task_route_policy_revisions_content_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_model_registry_revisions
      SET model_definition = model_definition || ${JSON.stringify({
        displayName: 'Drifted unpublished model',
      })}::jsonb
      WHERE id = ${unpublishedModelRevisionId}
    `,
    {
      message: /ai_model_registry_revisions_content_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_registry_revisions
      SET provider_profile = provider_profile || ${JSON.stringify({
        displayName: 'Drifted unpublished provider',
      })}::jsonb
      WHERE id = ${unpublishedProviderRevisionId}
    `,
    {
      message: /ai_provider_registry_revisions_content_update_restrict_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_prompt_registry_revisions
      SET metadata = metadata || ${JSON.stringify({
        driftedAfterPublish: true,
      })}::jsonb
      WHERE id = ${promptRevision.id}
    `,
    {
      message: /ai_prompt_registry_revisions_content_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_task_route_policy_revisions
      SET model_id = ${'drifted-after-publish-model'}
      WHERE id = ${taskRevision.id}
    `,
    {
      message: /ai_task_route_policy_revisions_content_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_model_registry_revisions
      SET model_definition = model_definition || ${JSON.stringify({
        displayName: 'Drifted published model',
      })}::jsonb
      WHERE id = ${modelRevision.id}
    `,
    {
      message: /ai_model_registry_revisions_content_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_provider_registry_revisions
      SET provider_profile = provider_profile || ${JSON.stringify({
        displayName: 'Drifted published provider',
      })}::jsonb
      WHERE id = ${providerRevision.id}
    `,
    {
      message: /ai_provider_registry_revisions_content_update_restrict_check/,
    }
  );

  const globalPromptRevisionId = 'prompt-global-publish-event-snapshot';
  const globalPromptRevision = 'global-publish-event-r1';
  const globalPromptFingerprint = 'globalpubsnap001';
  const globalPromptName = 'Chat With AFFiNE AI';
  await db.$executeRaw`
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
      ${globalPromptRevisionId},
      ${globalPromptName},
      ${'global'},
      ${null},
      ${owner.id},
      ${globalPromptRevision},
      ${'active'},
      ${globalPromptFingerprint},
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify({
        version: 'prompt-registry-revision-test/v1',
      })}::jsonb,
      ${new Date('2026-06-23T02:00:00.000Z')},
      ${new Date('2026-06-23T02:00:00.000Z')}
    )
  `;

  await db.$executeRaw`
    INSERT INTO ai_registry_revision_publish_events (
      id,
      registry_family,
      revision_id,
      prompt_registry_revision_id,
      task_route_policy_revision_id,
      model_registry_revision_id,
      provider_registry_revision_id,
      registry_provider_id,
      registry_model_id,
      workspace_id,
      actor_id,
      scope_type,
      registry_key,
      revision,
      revision_fingerprint,
      revision_status,
      event_type,
      publish_source,
      event_fingerprint,
      metadata,
      created_at
    )
    VALUES (
      ${'registry-global-prompt-publish-event'},
      ${'prompt_registry'},
      ${globalPromptRevisionId},
      ${globalPromptRevisionId},
      ${null},
      ${null},
      ${null},
      ${null},
      ${null},
      ${null},
      ${null},
      ${'global'},
      ${globalPromptName},
      ${globalPromptRevision},
      ${globalPromptFingerprint},
      ${'active'},
      ${'revision_published'},
      ${'graphql_mutation'},
      ${'aa11bb22cc33dd44'},
      ${JSON.stringify({
        version: 'registry-revision-publish-event/v1',
        registryFamily: 'prompt_registry',
        eventType: 'revision_published',
        publishSource: 'graphql_mutation',
        revisionId: globalPromptRevisionId,
        registryKey: globalPromptName,
        revision: globalPromptRevision,
        revisionFingerprint: globalPromptFingerprint,
        revisionStatus: 'active',
        promptName: globalPromptName,
      })}::jsonb,
      ${new Date('2026-06-23T02:05:00.000Z')}
    )
  `;

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_registry_revision_publish_events
      SET
        revision_fingerprint = ${'drifted-global-fingerprint'},
        metadata = jsonb_set(
          metadata,
          ${'{revisionFingerprint}'}::text[],
          ${JSON.stringify('drifted-global-fingerprint')}::jsonb
        )
      WHERE id = ${'registry-global-prompt-publish-event'}
    `,
    {
      message:
        /ai_registry_publish_events_prompt_global_snapshot_fkey|ai_registry_revision_publish_events_content_update_restrict_check/,
    }
  );

  await db.$executeRaw`
    INSERT INTO ai_registry_revision_publish_events (
      id,
      registry_family,
      revision_id,
      prompt_registry_revision_id,
      task_route_policy_revision_id,
      model_registry_revision_id,
      provider_registry_revision_id,
      registry_provider_id,
      registry_model_id,
      workspace_id,
      actor_id,
      scope_type,
      registry_key,
      revision,
      revision_fingerprint,
      revision_status,
      event_type,
      publish_source,
      event_fingerprint,
      metadata,
      created_at
    )
    VALUES (
      ${'registry-global-prompt-publish-event-with-actor'},
      ${'prompt_registry'},
      ${globalPromptRevisionId},
      ${globalPromptRevisionId},
      ${null},
      ${null},
      ${null},
      ${null},
      ${null},
      ${null},
      ${owner.id},
      ${'global'},
      ${globalPromptName},
      ${globalPromptRevision},
      ${globalPromptFingerprint},
      ${'active'},
      ${'revision_published'},
      ${'graphql_mutation'},
      ${'bb11cc22dd33ee44'},
      ${JSON.stringify({
        version: 'registry-revision-publish-event/v1',
        registryFamily: 'prompt_registry',
        eventType: 'revision_published',
        publishSource: 'graphql_mutation',
        revisionId: globalPromptRevisionId,
        registryKey: globalPromptName,
        revision: globalPromptRevision,
        revisionFingerprint: globalPromptFingerprint,
        revisionStatus: 'active',
        actorId: owner.id,
        promptName: globalPromptName,
      })}::jsonb,
      ${new Date('2026-06-23T02:06:00.000Z')}
    )
  `;
  const globalDriftActor = await app.createUser();
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_registry_revision_publish_events
      SET
        actor_id = ${globalDriftActor.id},
        metadata = jsonb_set(
          metadata,
          ${'{actorId}'}::text[],
          ${JSON.stringify(globalDriftActor.id)}::jsonb
        )
      WHERE id = ${'registry-global-prompt-publish-event-with-actor'}
    `,
    {
      message:
        /ai_registry_publish_events_prompt_actor_snapshot_fkey|ai_registry_revision_publish_events_content_update_restrict_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_prompt_registry_revisions
      SET actor_id = ${globalDriftActor.id}
      WHERE id = ${globalPromptRevisionId}
    `,
    {
      message: /ai_registry_publish_events_prompt_actor_snapshot_fkey/,
    }
  );
});
