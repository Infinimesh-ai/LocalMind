import type { GraphQLQuery } from '@affine/graphql';
import { PrismaClient } from '@prisma/client';
import type { TestFn } from 'ava';
import ava from 'ava';

import { AppModule } from '../../app.module';
import { JOB_SIGNAL } from '../../base';
import { ConfigModule } from '../../base/config';
import { AuthService } from '../../core/auth';
import { Models } from '../../models';
import {
  CopilotProviderType,
  ModelInputType,
  ModelOutputType,
} from '../../plugins/copilot/providers/types';
import { CopilotRepairExecutionWorker } from '../../plugins/copilot/repair-execution-worker';
import {
  createTestingApp,
  createWorkspace,
  TestingApp,
  TestUser,
} from '../utils';

const test = ava.serial as TestFn<{
  app: TestingApp;
  auth: AuthService;
  db: PrismaClient;
  owner: TestUser;
  worker: CopilotRepairExecutionWorker;
}>;

const providerId = 'localmind-repair-provider-registry';

const providerRegistryRepairTestName = [
  'worker publishes provider registry revision',
  'from approved repair execution payload',
].join(' ');

const providerRegistryBoundaryTestName = [
  'worker rejects provider registry repair payload',
  'when provider type does not match configured provider',
].join(' ');

const approvalDecisionMutation = {
  id: 'repairExecutionProviderRegistryApprovalDecisionTestMutation',
  op: 'decideCopilotRepairExecutionApproval',
  query: `
    mutation decideCopilotRepairExecutionApproval(
      $input: CopilotRepairExecutionApprovalDecisionInput!
    ) {
      decideCopilotRepairExecutionApproval(input: $input) {
        id
        status
        approvalState
        runtimeResult {
          executor
          sideEffectsApplied
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const providerRegistryQuery = {
  id: 'repairExecutionProviderRegistryModelsTestQuery',
  op: 'repairExecutionProviderRegistryModels',
  query: `
    query repairExecutionProviderRegistryModels($workspaceId: String!) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          models(promptName: "Chat With AFFiNE AI") {
            optionalModels {
              id
              name
              providerId
              providerName
              providerProfileSource
              providerProfileConfigPath
              providerConfiguredModelIds
              providerPrivacy
              providerPriority
              routeModelId
              routeModelDefinitionId
              routeModelDefinitionSource
            }
          }
        }
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
            profiles: [
              {
                id: providerId,
                type: CopilotProviderType.OpenAICompatible,
                config: {
                  apiKey: 'test-provider-secret',
                  baseURL: 'http://localmind.invalid/v1',
                },
                modelDefinitions: [
                  {
                    id: 'config-provider-chat',
                    rawModelId: 'config-provider-chat-raw',
                    displayName: 'Config provider chat',
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Text],
                      },
                    ],
                  },
                ],
              },
            ],
            openai: { apiKey: '1' },
          },
          prompts: {
            defaults: {
              text: {
                optionalModels: ['repair-provider-chat'],
              },
            },
          },
        },
      }),
      AppModule,
    ],
  });

  t.context.app = app;
  t.context.auth = app.get(AuthService);
  t.context.db = app.get(PrismaClient);
  t.context.worker = app.get(CopilotRepairExecutionWorker);
});

test.beforeEach(async t => {
  await t.context.app.initTestingDB();
  t.context.owner = await t.context.app.signupV1();
});

test.after.always(async t => {
  await t.context.app.close();
});

test(providerRegistryRepairTestName, async t => {
  const { app, db, owner, worker } = t.context;
  const workspace = await createWorkspace(app);

  const { record: waitingRecord } =
    await app.get(Models).copilotRepairExecution.createOrReuse({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName: 'provider-registry-repair-test',
      requestedAction: 'provider_registry_revision_publish',
      approvalRequired: true,
      permissionStatus: 'granted',
      idempotencyKey: `provider-registry-repair-${workspace.id}`,
      idempotencyFingerprint: 'providerrepairidem',
      requestFingerprint: 'providerrepairreq',
      candidateEvidenceSetFingerprint: 'providerrepaircand',
      taskRouteEvidenceSetFingerprint: 'providerrepairroute',
      targetLocatorFingerprint: 'providerrepairtarget',
      repairJobFingerprint: 'providerrepairjob',
      approvalRecordFingerprint: 'providerrepairapprove',
      auditEventFingerprint: 'providerrepairaudit',
      executorPayload: {
        version: 'provider-registry-revision-executor-payload/v1',
        kind: 'provider_registry_revision_publish',
        providerId,
        providerType: CopilotProviderType.OpenAICompatible,
        displayName: 'Repair published provider',
        priority: 175,
        privacy: 'local',
        enabled: true,
        models: ['repair-provider-chat'],
        modelDefinitions: [
          {
            id: 'repair-provider-chat',
            rawModelId: 'repair-provider-chat-raw',
            displayName: 'Repair provider chat',
            aliases: ['repair-provider-chat-alias'],
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
        operationFingerprint: 'providerrepairop',
        operationSetFingerprint: 'providerrepairopset',
        previewFingerprint: 'providerrepairpreview',
        catalogFingerprint: 'providerrepaircatalog',
        targetLocatorFingerprint: 'providerrepairtarget',
        candidateEvidenceFingerprints: ['providerrepaircandidate1'],
        fallbackSourceChain: [
          {
            source: 'provider_profile',
            scope: 'global',
            status: 'available',
            providerId,
            providerType: CopilotProviderType.OpenAICompatible,
            revision: 'config-profile-provider',
            fingerprint: 'providerrepairfallback',
          },
        ],
      },
    });

  t.is(waitingRecord.status, 'waiting_approval');
  t.is(waitingRecord.approvalState, 'waiting');

  const decisionResult = await app.gql({
    query: approvalDecisionMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        executionRequestId: waitingRecord.id,
        decision: 'approve',
        reason: 'validated provider registry repair payload',
      },
    },
  });
  t.is(
    decisionResult.decideCopilotRepairExecutionApproval.status,
    'queued'
  );
  t.is(
    decisionResult.decideCopilotRepairExecutionApproval.approvalState,
    'approved'
  );

  const signal = await worker.runRepairExecution({
    workspaceId: workspace.id,
    executionRequestId: waitingRecord.id,
  });
  t.is(signal, JOB_SIGNAL.Done);

  const completedRows = await db.$queryRaw<
    Array<{
      runtimeResult: {
        executor: string;
        sideEffectKind?: string;
        sideEffectRecordId?: string;
        sideEffectsApplied: boolean;
      };
      status: string;
    }>
  >`
    SELECT runtime_result AS "runtimeResult", status
    FROM ai_repair_execution_requests
    WHERE id = ${waitingRecord.id}
  `;
  t.is(completedRows[0]?.status, 'completed');
  t.is(
    completedRows[0]?.runtimeResult.executor,
    'provider_registry_revision_publish_worker'
  );
  t.true(completedRows[0]?.runtimeResult.sideEffectsApplied);
  t.is(
    completedRows[0]?.runtimeResult.sideEffectKind,
    'provider_registry_revision'
  );
  t.is(
    completedRows[0]?.runtimeResult.sideEffectRecordId,
    `provider-registry-revision-${waitingRecord.id}`
  );

  const revisionRows = await db.$queryRaw<
    Array<{
      actorId: string;
      fallbackSourceChain: Array<{
        providerId?: string;
        revision?: string;
        source: string;
      }>;
      fingerprint: string;
      metadata: {
        executionRequestId: string;
        operationFingerprint: string;
        publishSource: string;
      };
      providerProfile: Record<string, unknown>;
      providerType: string;
      revision: string;
      scopeType: string;
      status: string;
      workspaceId: string;
    }>
  >`
    SELECT
      actor_id AS "actorId",
      fallback_source_chain AS "fallbackSourceChain",
      fingerprint,
      metadata,
      provider_profile AS "providerProfile",
      provider_type AS "providerType",
      revision,
      scope_type AS "scopeType",
      status,
      workspace_id AS "workspaceId"
    FROM ai_provider_registry_revisions
    WHERE id = ${`provider-registry-revision-${waitingRecord.id}`}
  `;
  t.is(revisionRows.length, 1);
  t.like(revisionRows[0], {
    actorId: owner.id,
    providerType: CopilotProviderType.OpenAICompatible,
    revision: `repair-${waitingRecord.id}`,
    scopeType: 'workspace',
    status: 'active',
    workspaceId: workspace.id,
  });
  t.is(
    revisionRows[0]?.metadata.executionRequestId,
    waitingRecord.id
  );
  t.is(revisionRows[0]?.metadata.publishSource, 'repair_execution_worker');
  t.is(revisionRows[0]?.metadata.operationFingerprint, 'providerrepairop');
  t.deepEqual(revisionRows[0]?.providerProfile.config, {});
  t.false(
    JSON.stringify(revisionRows[0]?.providerProfile).includes(
      'must-not-persist'
    )
  );
  t.true(
    revisionRows[0]?.fallbackSourceChain.some(
      entry =>
        entry.source === 'provider_profile' &&
        entry.providerId === providerId &&
        entry.revision === 'configured'
    )
  );

  const probeAttemptRows = await db.$queryRaw<
    Array<{
      attemptCount: number;
      providerId: string;
      providerProfileFingerprint: string;
      providerProfileSource: string | null;
      providerRegistryRevisionFingerprint: string | null;
      providerRegistryRevisionId: string | null;
      requestFingerprint: string;
      resultStatus: string | null;
      scopeType: string;
      status: string;
      workspaceId: string | null;
    }>
  >`
    SELECT
      attempt_count AS "attemptCount",
      provider_id AS "providerId",
      provider_profile_fingerprint AS "providerProfileFingerprint",
      provider_profile_source AS "providerProfileSource",
      provider_registry_revision_fingerprint AS "providerRegistryRevisionFingerprint",
      provider_registry_revision_id AS "providerRegistryRevisionId",
      request_fingerprint AS "requestFingerprint",
      result_status AS "resultStatus",
      scope_type AS "scopeType",
      status,
      workspace_id AS "workspaceId"
    FROM ai_provider_health_probe_attempts
    WHERE provider_registry_revision_id = ${`provider-registry-revision-${waitingRecord.id}`}
  `;
  t.is(probeAttemptRows.length, 1);
  t.like(probeAttemptRows[0], {
    attemptCount: 0,
    providerId,
    providerProfileSource: 'db_revision',
    providerRegistryRevisionId: `provider-registry-revision-${waitingRecord.id}`,
    resultStatus: null,
    scopeType: 'workspace',
    status: 'queued',
    workspaceId: workspace.id,
  });
  t.is(
    probeAttemptRows[0]?.providerRegistryRevisionFingerprint,
    revisionRows[0]?.fingerprint
  );
  t.regex(
    probeAttemptRows[0]?.providerProfileFingerprint ?? '',
    /^[a-f0-9]{16}$/
  );
  t.regex(probeAttemptRows[0]?.requestFingerprint ?? '', /^[a-f0-9]{16}$/);

  const result = await app.gql({
    query: providerRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const model = result.currentUser.copilot.models.optionalModels.find(
    (item: { id: string; routeModelDefinitionId?: string }) =>
      item.id === 'repair-provider-chat' ||
      item.id === `${providerId}/repair-provider-chat` ||
      item.routeModelDefinitionId === 'repair-provider-chat'
  );

  t.truthy(model);
  t.is(model.name, 'Repair provider chat');
  t.is(model.providerId, providerId);
  t.is(model.providerName, 'Repair published provider');
  t.is(model.providerProfileSource, 'db_revision');
  t.is(
    model.providerProfileConfigPath,
    `ai_provider_registry_revisions[id=provider-registry-revision-${waitingRecord.id}]`
  );
  t.deepEqual(model.providerConfiguredModelIds, [
    'repair-provider-chat',
    'repair-provider-chat-alias',
  ]);
  t.is(model.providerPrivacy, 'local');
  t.is(model.providerPriority, 175);
  t.is(model.routeModelId, 'repair-provider-chat-raw');
  t.is(model.routeModelDefinitionId, 'repair-provider-chat');
  t.is(model.routeModelDefinitionSource, 'provider_profile');
});

test(providerRegistryBoundaryTestName, async t => {
  const { app, db, owner, worker } = t.context;
  const workspace = await createWorkspace(app);

  const { record: waitingRecord } =
    await app.get(Models).copilotRepairExecution.createOrReuse({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName: 'provider-registry-boundary-test',
      requestedAction: 'provider_registry_revision_publish',
      approvalRequired: true,
      permissionStatus: 'granted',
      idempotencyKey: `provider-registry-boundary-${workspace.id}`,
      idempotencyFingerprint: 'providerboundaryidem',
      requestFingerprint: 'providerboundaryreq',
      candidateEvidenceSetFingerprint: 'providerboundarycand',
      taskRouteEvidenceSetFingerprint: 'providerboundaryroute',
      targetLocatorFingerprint: 'providerboundarytarget',
      repairJobFingerprint: 'providerboundaryjob',
      approvalRecordFingerprint: 'providerboundaryapprove',
      auditEventFingerprint: 'providerboundaryaudit',
      executorPayload: {
        version: 'provider-registry-revision-executor-payload/v1',
        kind: 'provider_registry_revision_publish',
        providerId,
        providerType: CopilotProviderType.OpenAI,
        displayName: 'Rejected repair provider',
        operationFingerprint: 'providerboundaryop',
        operationSetFingerprint: 'providerboundaryopset',
        previewFingerprint: 'providerboundarypreview',
        catalogFingerprint: 'providerboundarycatalog',
        targetLocatorFingerprint: 'providerboundarytarget',
        candidateEvidenceFingerprints: ['providerboundarycandidate1'],
        fallbackSourceChain: [],
      },
    });

  await app.gql({
    query: approvalDecisionMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        executionRequestId: waitingRecord.id,
        decision: 'approve',
        reason: 'validate provider type boundary',
      },
    },
  });

  const signal = await worker.runRepairExecution({
    workspaceId: workspace.id,
    executionRequestId: waitingRecord.id,
  });
  t.is(signal, JOB_SIGNAL.Retry);

  const failureRows = await db.$queryRaw<
    Array<{
      failureCode: string | null;
      runtimeResult: {
        sideEffectsApplied: boolean;
      };
      status: string;
    }>
  >`
    SELECT
      failure_code AS "failureCode",
      runtime_result AS "runtimeResult",
      status
    FROM ai_repair_execution_requests
    WHERE id = ${waitingRecord.id}
  `;
  t.like(failureRows[0], {
    failureCode: 'invalid_executor_payload',
    status: 'queued',
  });
  t.false(failureRows[0]?.runtimeResult.sideEffectsApplied);

  const revisionRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_provider_registry_revisions
    WHERE id = ${`provider-registry-revision-${waitingRecord.id}`}
  `;
  t.deepEqual(revisionRows, []);
});
