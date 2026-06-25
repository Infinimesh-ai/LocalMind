import type { GraphQLQuery } from '@affine/graphql';
import { PrismaClient } from '@prisma/client';
import type { TestFn } from 'ava';
import ava from 'ava';

import { AppModule } from '../../app.module';
import { JOB_SIGNAL } from '../../base';
import { ConfigModule } from '../../base/config';
import { AuthService } from '../../core/auth';
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

const promptName = 'Repair model registry route prompt';
const missingDefaultModel = 'missing-default-chat';
const providerId = 'localmind-repair-model-registry';
const providerModelId = 'available-default-chat';
const providerEmbeddingModelId = 'available-embedding';
const providerRerankModelId = 'available-rerank';

const publishGateQuery = {
  id: 'repairExecutionModelRegistryPublishGateTestQuery',
  op: 'repairExecutionModelRegistryPublishGate',
  query: `
    query repairExecutionModelRegistryPublishGate($workspaceId: String!, $name: String!) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          promptRegistryPublishGate(name: $name) {
            allowed
            publishStatus
            reason
            registryFingerprint
            registryId
            registryUpdatedAt
            modelRoute {
              available
              candidateKind
              requestedModelId
              requestedModelSource
              routeModelDefinitionSource
              modelRegistryRevision
              modelRegistryRevisionId
              modelRegistryRevisionScope
              modelRegistryRevisionStatus
              modelRegistryRevisionWorkspaceId
            }
            repairActionPreview {
              operations {
                actionKind
                candidateEvidenceCount
                targetLocator {
                  kind
                  requestedModelId
                  requestedModelConfigPath
                  outputType
                }
              }
              submissionContract {
                approvalPolicyFingerprint
                authorizationFingerprint
                candidateEvidenceSetFingerprint
                taskRouteEffectiveSourceEvidenceSetFingerprint
                embeddingIndexContractEvidenceSetFingerprint
                rerankRuntimeContractEvidenceSetFingerprint
                preparedRouteOrderEvidenceSetFingerprint
                catalogFingerprint
                contractVersion
                expectedRegistryFingerprint
                expectedRegistryId
                expectedRegistryUpdatedAt
                guardFingerprint
                idempotencyKey
                operationSetFingerprint
                previewFingerprint
                requiredInputs
                submissionFingerprint
                targetLocatorFingerprint
              }
            }
            repairGateManifest {
              fingerprint
            }
            repairGateManifestExportMetadata {
              exportPolicyFingerprint
              retentionPolicyFingerprint
            }
          }
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const preflightQuery = {
  id: 'repairExecutionModelRegistryPreflightTestQuery',
  op: 'repairExecutionModelRegistryPreflight',
  query: `
    query repairExecutionModelRegistryPreflight(
      $workspaceId: String!
      $name: String!
      $submission: CopilotPromptRegistryRepairSubmissionInput!
      $expectedVersion: CopilotPromptRegistryPublishGateExpectedVersionInput
    ) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          promptRegistryRepairPreflight(
            name: $name
            submission: $submission
            expectedVersion: $expectedVersion
          ) {
            approvalRecordFingerprint
            approvalRequestFingerprint
            auditEventFingerprint
            candidateEvidenceSetFingerprint
            taskRouteEffectiveSourceEvidenceSetFingerprint
            embeddingIndexContractEvidenceSetFingerprint
            rerankRuntimeContractEvidenceSetFingerprint
            preparedRouteOrderEvidenceSetFingerprint
            targetLocatorFingerprint
            executionGateFingerprint
            executionGateStatus
            executionStateFingerprint
            idempotencyFingerprint
            policyBindingFingerprint
            repairJobFingerprint
            reviewBindingFingerprint
            rollbackPlanFingerprint
            status
          }
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const repairExecutionMutation = {
  id: 'repairExecutionModelRegistryTestMutation',
  op: 'requestCopilotPromptRegistryRepairExecution',
  query: `
    mutation requestCopilotPromptRegistryRepairExecution(
      $input: CopilotPromptRegistryRepairExecutionRequestInput!
    ) {
      requestCopilotPromptRegistryRepairExecution(input: $input) {
        accepted
        executionRecord {
          id
          actorId
          workspaceId
          promptName
          status
          approvalState
          runtimeResult {
            executor
            sideEffectsApplied
            sideEffectKind
            sideEffectRecordId
          }
          agentRun {
            id
          }
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const approvalDecisionMutation = {
  id: 'repairExecutionModelRegistryApprovalDecisionTestMutation',
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

test.before(async t => {
  const app = await createTestingApp({
    imports: [
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              text: {
                model: missingDefaultModel,
              },
            },
          },
          providers: {
            openaiCompatible: {
              apiStyle: 'chat_completions',
              baseURL: 'http://localmind.invalid/v1',
            },
            profiles: [
              {
                id: providerId,
                type: CopilotProviderType.OpenAICompatible,
                config: {
                  baseURL: 'http://localmind.invalid/v1',
                },
                modelDefinitions: [
                  {
                    id: providerModelId,
                    rawModelId: providerModelId,
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Object, ModelOutputType.Text],
                        defaultForOutputType: true,
                      },
                    ],
                  },
                  {
                    id: providerEmbeddingModelId,
                    rawModelId: providerEmbeddingModelId,
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Embedding],
                        defaultForOutputType: true,
                      },
                    ],
                    limits: {
                      embeddingDimensions: 1024,
                    },
                  },
                  {
                    id: providerRerankModelId,
                    rawModelId: providerRerankModelId,
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Rerank],
                        defaultForOutputType: true,
                      },
                    ],
                  },
                ],
              },
            ],
            openai: { apiKey: '1' },
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

async function seedReadyRegistryPrompt(db: PrismaClient) {
  await db.aiPrompt.create({
    data: {
      action: 'chat',
      config: {},
      messages: {
        create: [
          {
            content: 'Answer with the repair execution model registry prompt.',
            idx: 0,
            role: 'system',
          },
        ],
      },
      model: providerModelId,
      modified: true,
      name: promptName,
      optionalModels: [],
      updatedAt: new Date('2026-06-22T09:00:00.000Z'),
    },
  });
}

async function buildRepairExecutionInput(input: {
  app: TestingApp;
  workspaceId: string;
}) {
  const gateResult = await input.app.gql({
    query: publishGateQuery,
    variables: {
      name: promptName,
      workspaceId: input.workspaceId,
    },
  });
  const gate = gateResult.currentUser.copilot.promptRegistryPublishGate;
  const operations = gate.repairActionPreview.operations;
  const repairModelRegistryOperation = operations.find(
    (operation: {
      actionKind: string;
      targetLocator?: { kind?: string; requestedModelId?: string };
    }) =>
      operation.actionKind === 'repair_default_model_route' &&
      operation.targetLocator?.kind === 'model_route' &&
      operation.targetLocator.requestedModelId === missingDefaultModel
  );
  if (!repairModelRegistryOperation) {
    throw new Error(
      `Expected repair_default_model_route operation; received ${operations
        .map((operation: { actionKind: string }) => operation.actionKind)
        .join(',')}`
    );
  }

  const submission = gate.repairActionPreview.submissionContract;
  const expectedVersion = {
    registryFingerprint: gate.registryFingerprint,
    registryId: gate.registryId,
    registryUpdatedAt: gate.registryUpdatedAt,
  };
  const preflightResult = await input.app.gql({
    query: preflightQuery,
    variables: {
      expectedVersion,
      name: promptName,
      submission,
      workspaceId: input.workspaceId,
    },
  });
  const preflight =
    preflightResult.currentUser.copilot.promptRegistryRepairPreflight;

  return {
    expectedApprovalRecordFingerprint: preflight.approvalRecordFingerprint,
    expectedApprovalRequestFingerprint: preflight.approvalRequestFingerprint,
    expectedAuditEventFingerprint: preflight.auditEventFingerprint,
    expectedCandidateEvidenceSetFingerprint:
      preflight.candidateEvidenceSetFingerprint,
    expectedTaskRouteEffectiveSourceEvidenceSetFingerprint:
      preflight.taskRouteEffectiveSourceEvidenceSetFingerprint,
    expectedEmbeddingIndexContractEvidenceSetFingerprint:
      preflight.embeddingIndexContractEvidenceSetFingerprint,
    expectedRerankRuntimeContractEvidenceSetFingerprint:
      preflight.rerankRuntimeContractEvidenceSetFingerprint,
    expectedPreparedRouteOrderEvidenceSetFingerprint:
      preflight.preparedRouteOrderEvidenceSetFingerprint,
    expectedTargetLocatorFingerprint: preflight.targetLocatorFingerprint,
    expectedRepairGateManifestFingerprint: gate.repairGateManifest.fingerprint,
    expectedRepairGateManifestExportPolicyFingerprint:
      gate.repairGateManifestExportMetadata.exportPolicyFingerprint,
    expectedRepairGateManifestRetentionPolicyFingerprint:
      gate.repairGateManifestExportMetadata.retentionPolicyFingerprint,
    expectedExecutionGateFingerprint: preflight.executionGateFingerprint,
    expectedExecutionGateStatus: preflight.executionGateStatus,
    expectedExecutionStateFingerprint: preflight.executionStateFingerprint,
    expectedIdempotencyFingerprint: preflight.idempotencyFingerprint,
    expectedPolicyBindingFingerprint: preflight.policyBindingFingerprint,
    expectedPreflightStatus: preflight.status,
    expectedRepairJobFingerprint: preflight.repairJobFingerprint,
    expectedReviewBindingFingerprint: preflight.reviewBindingFingerprint,
    expectedRollbackPlanFingerprint: preflight.rollbackPlanFingerprint,
    expectedVersion,
    name: promptName,
    submission,
    workspaceId: input.workspaceId,
  };
}

const modelRegistryRepairTestName = [
  'approval queues default model route repair',
  'and worker publishes DB-backed model registry revision',
].join(' ');

test(modelRegistryRepairTestName, async t => {
  const { app, db, worker } = t.context;
  const workspace = await createWorkspace(app);
  await seedReadyRegistryPrompt(db);
  const requestInput = await buildRepairExecutionInput({
    app,
    workspaceId: workspace.id,
  });

  const requestResult = await app.gql({
    query: repairExecutionMutation,
    variables: {
      input: requestInput,
    },
  });
  const waitingRecord =
    requestResult.requestCopilotPromptRegistryRepairExecution.executionRecord;
  t.is(waitingRecord.status, 'waiting_approval');
  t.is(waitingRecord.approvalState, 'waiting');

  const payloadRows = await db.$queryRaw<
    Array<{
      executorPayload: {
        kind?: string;
        modelDefinition?: {
          aliases?: string[];
          capabilities?: Array<{ output?: string[] }>;
          id?: string;
          rawModelId?: string;
        };
        modelId?: string;
        providerId?: string;
        rawModelId?: string;
      };
    }>
  >`
    SELECT executor_payload AS "executorPayload"
    FROM ai_repair_execution_requests
    WHERE id = ${waitingRecord.id}
  `;
  t.like(payloadRows[0]?.executorPayload, {
    kind: 'model_registry_revision_publish',
    modelId: missingDefaultModel,
    providerId,
    rawModelId: providerModelId,
  });
  t.like(payloadRows[0]?.executorPayload.modelDefinition, {
    aliases: [providerModelId],
    id: missingDefaultModel,
    rawModelId: providerModelId,
  });
  t.deepEqual(
    payloadRows[0]?.executorPayload.modelDefinition?.capabilities?.[0]?.output,
    [ModelOutputType.Object, ModelOutputType.Text]
  );

  const decisionResult = await app.gql({
    query: approvalDecisionMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        executionRequestId: waitingRecord.id,
        decision: 'approve',
        reason: 'validated in model registry e2e',
      },
    },
  });
  const decided = decisionResult.decideCopilotRepairExecutionApproval;
  t.is(decided.id, waitingRecord.id);
  t.is(decided.status, 'queued');
  t.is(decided.approvalState, 'approved');
  t.is(decided.runtimeResult.executor, 'queued_repair_execution_worker');
  t.false(decided.runtimeResult.sideEffectsApplied);

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
    'model_registry_revision_publish_worker'
  );
  t.true(completedRows[0]?.runtimeResult.sideEffectsApplied);
  t.is(
    completedRows[0]?.runtimeResult.sideEffectKind,
    'model_registry_revision'
  );
  t.is(
    completedRows[0]?.runtimeResult.sideEffectRecordId,
    `model-registry-revision-${waitingRecord.id}`
  );

  const revisionRows = await db.$queryRaw<
    Array<{
      actorId: string;
      fallbackSourceChain: Array<{
        modelId?: string;
        providerId?: string;
        source: string;
        status: string;
      }>;
      fingerprint: string;
      metadata: {
        executionRequestId: string;
        operationFingerprint: string;
      };
      modelDefinition: {
        aliases?: string[];
        capabilities?: Array<{ output?: string[] }>;
        id?: string;
        rawModelId?: string;
      };
      modelId: string;
      providerId: string;
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
      model_definition AS "modelDefinition",
      model_id AS "modelId",
      provider_id AS "providerId",
      revision,
      scope_type AS "scopeType",
      status,
      workspace_id AS "workspaceId"
    FROM ai_model_registry_revisions
    WHERE id = ${`model-registry-revision-${waitingRecord.id}`}
  `;
  t.is(revisionRows.length, 1);
  t.like(revisionRows[0], {
    actorId: t.context.owner.id,
    modelId: missingDefaultModel,
    providerId,
    revision: `repair-${waitingRecord.id}`,
    scopeType: 'workspace',
    status: 'active',
    workspaceId: workspace.id,
  });
  t.regex(revisionRows[0]?.fingerprint ?? '', /^[a-f0-9]{16}$/);
  t.is(revisionRows[0]?.metadata.executionRequestId, waitingRecord.id);
  t.regex(
    revisionRows[0]?.metadata.operationFingerprint ?? '',
    /^[a-f0-9]{16}$/
  );
  t.like(revisionRows[0]?.modelDefinition, {
    aliases: [providerModelId],
    id: missingDefaultModel,
    rawModelId: providerModelId,
  });
  t.deepEqual(revisionRows[0]?.modelDefinition.capabilities?.[0]?.output, [
    ModelOutputType.Object,
    ModelOutputType.Text,
  ]);
  t.true(
    revisionRows[0]?.fallbackSourceChain.some(
      entry =>
        entry.source === 'config_fallback' &&
        entry.modelId === missingDefaultModel &&
        entry.providerId === providerId
    )
  );

  const repairedGateResult = await app.gql({
    query: publishGateQuery,
    variables: {
      name: promptName,
      workspaceId: workspace.id,
    },
  });
  const repairedGate =
    repairedGateResult.currentUser.copilot.promptRegistryPublishGate;
  t.true(repairedGate.allowed);
  t.is(repairedGate.publishStatus, 'ready');
  t.is(repairedGate.reason, 'ready');
  t.true(repairedGate.modelRoute.available);
  t.is(repairedGate.modelRoute.requestedModelId, missingDefaultModel);
  t.is(repairedGate.modelRoute.requestedModelSource, 'default_policy');
  t.is(repairedGate.modelRoute.routeModelDefinitionSource, 'db_revision');
  t.is(
    repairedGate.modelRoute.modelRegistryRevision,
    `repair-${waitingRecord.id}`
  );
  t.is(
    repairedGate.modelRoute.modelRegistryRevisionId,
    `model-registry-revision-${waitingRecord.id}`
  );
  t.is(repairedGate.modelRoute.modelRegistryRevisionScope, 'workspace');
  t.is(repairedGate.modelRoute.modelRegistryRevisionStatus, 'active');
  t.is(repairedGate.modelRoute.modelRegistryRevisionWorkspaceId, workspace.id);
});
