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

const publishGateQuery = {
  id: 'repairExecutionTaskRoutePublishGateTestQuery',
  op: 'repairExecutionTaskRoutePublishGate',
  query: `
    query repairExecutionTaskRoutePublishGate($workspaceId: String!, $name: String!) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          promptRegistryPublishGate(name: $name) {
            registryFingerprint
            registryId
            registryUpdatedAt
            repairActionPreview {
              operations {
                actionKind
                targetLocator {
                  featureKind
                  kind
                  requestedModelConfigKey
                  requestedModelConfigPath
                  requestedModelId
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
  id: 'repairExecutionTaskRoutePreflightTestQuery',
  op: 'repairExecutionTaskRoutePreflight',
  query: `
    query repairExecutionTaskRoutePreflight(
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
  id: 'repairExecutionTaskRouteTestMutation',
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
  id: 'repairExecutionTaskRouteApprovalDecisionTestMutation',
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

const taskRoutePolicyDiagnosticsQuery = {
  id: 'repairExecutionTaskRoutePolicyDiagnosticsTestQuery',
  op: 'repairExecutionTaskRoutePolicyDiagnostics',
  query: `
    query repairExecutionTaskRoutePolicyDiagnostics($workspaceId: String!) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          models(promptName: "Chat With AFFiNE AI") {
            rerankRoute {
              requestedModelId
              requestedModelSource
              taskRoutePolicyRevision
              taskRoutePolicyRevisionFingerprint
              taskRoutePolicyRevisionId
              taskRoutePolicyRevisionScope
              taskRoutePolicyRevisionStatus
              taskRoutePolicyRevisionWorkspaceId
              taskRoutePolicyRevisionSourceChain {
                configKey
                configPath
                featureKind
                modelId
                scope
                source
                status
                workspaceId
              }
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
          tasks: {
            models: {
              rerank: 'missing-rerank-route',
            },
          },
          providers: {
            openaiCompatible: {
              apiStyle: 'chat_completions',
              baseURL: 'http://localmind.invalid/v1',
            },
            profiles: [
              {
                id: 'localmind-repair-task-route',
                type: CopilotProviderType.OpenAICompatible,
                config: {
                  baseURL: 'http://localmind.invalid/v1',
                },
                modelDefinitions: [
                  {
                    id: 'available-rerank-route',
                    rawModelId: 'available-rerank-route',
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

async function seedReadyRegistryPrompt(db: PrismaClient, name: string) {
  await db.aiPrompt.create({
    data: {
      action: 'chat',
      config: {},
      messages: {
        create: [
          {
            content: 'Answer with the repair execution task route prompt.',
            idx: 0,
            role: 'system',
          },
        ],
      },
      model: 'openai/gpt-4.1',
      modified: true,
      name,
      optionalModels: [],
      updatedAt: new Date('2026-06-21T09:00:00.000Z'),
    },
  });
}

async function buildRepairExecutionInput(input: {
  app: TestingApp;
  name: string;
  workspaceId: string;
}) {
  const gateResult = await input.app.gql({
    query: publishGateQuery,
    variables: {
      name: input.name,
      workspaceId: input.workspaceId,
    },
  });
  const gate = gateResult.currentUser.copilot.promptRegistryPublishGate;
  const operations = gate.repairActionPreview.operations;
  const repairTaskRouteOperation = operations.find(
    (operation: {
      actionKind: string;
      targetLocator?: { featureKind?: string; kind?: string };
    }) =>
      operation.actionKind === 'repair_task_model_route' &&
      operation.targetLocator?.kind === 'task_route'
  );
  if (!repairTaskRouteOperation) {
    throw new Error(
      `Expected repair_task_model_route operation; received ${operations
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
      name: input.name,
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
    name: input.name,
    submission,
    workspaceId: input.workspaceId,
  };
}

test('approval queues task route repair and worker publishes DB-backed task route policy revision', async t => {
  const { app, db, worker } = t.context;
  const workspace = await createWorkspace(app);
  const promptName = 'Repair task route policy prompt';
  await seedReadyRegistryPrompt(db, promptName);
  const requestInput = await buildRepairExecutionInput({
    app,
    name: promptName,
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
        configKey?: string;
        featureKind?: string;
        kind?: string;
        modelId?: string;
      };
    }>
  >`
    SELECT executor_payload AS "executorPayload"
    FROM ai_repair_execution_requests
    WHERE id = ${waitingRecord.id}
  `;
  t.like(payloadRows[0]?.executorPayload, {
    configKey: 'rerank',
    featureKind: 'rerank',
    kind: 'task_route_policy_revision_publish',
    modelId: 'localmind-repair-task-route/available-rerank-route',
  });

  const decisionResult = await app.gql({
    query: approvalDecisionMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        executionRequestId: waitingRecord.id,
        decision: 'approve',
        reason: 'validated in task route policy e2e',
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
    'task_route_policy_revision_publish_worker'
  );
  t.true(completedRows[0]?.runtimeResult.sideEffectsApplied);
  t.is(
    completedRows[0]?.runtimeResult.sideEffectKind,
    'task_route_policy_revision'
  );
  t.is(
    completedRows[0]?.runtimeResult.sideEffectRecordId,
    `task-route-policy-revision-${waitingRecord.id}`
  );

  const revisionRows = await db.$queryRaw<
    Array<{
      actorId: string;
      configKey: string | null;
      configPath: string | null;
      fallbackSourceChain: Array<{
        featureKind?: string;
        modelId?: string;
        source: string;
        status: string;
      }>;
      featureKind: string;
      fingerprint: string;
      metadata: {
        executionRequestId: string;
        operationFingerprint: string;
      };
      modelId: string | null;
      revision: string;
      scopeType: string;
      status: string;
      workspaceId: string;
    }>
  >`
    SELECT
      actor_id AS "actorId",
      config_key AS "configKey",
      config_path AS "configPath",
      fallback_source_chain AS "fallbackSourceChain",
      feature_kind AS "featureKind",
      fingerprint,
      metadata,
      model_id AS "modelId",
      revision,
      scope_type AS "scopeType",
      status,
      workspace_id AS "workspaceId"
    FROM ai_task_route_policy_revisions
    WHERE id = ${`task-route-policy-revision-${waitingRecord.id}`}
  `;
  t.is(revisionRows.length, 1);
  t.like(revisionRows[0], {
    actorId: t.context.owner.id,
    configKey: 'rerank',
    configPath: 'copilot.tasks.models.rerank',
    featureKind: 'rerank',
    modelId: 'localmind-repair-task-route/available-rerank-route',
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
  t.true(
    revisionRows[0]?.fallbackSourceChain.some(
      entry =>
        entry.source === 'config_fallback' &&
        entry.featureKind === 'rerank' &&
        entry.modelId === 'missing-rerank-route'
    )
  );

  const diagnosticsResult = await app.gql({
    query: taskRoutePolicyDiagnosticsQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const rerankRoute = diagnosticsResult.currentUser.copilot.models.rerankRoute;
  t.is(rerankRoute.requestedModelSource, 'db_revision');
  t.is(
    rerankRoute.requestedModelId,
    'localmind-repair-task-route/available-rerank-route'
  );
  t.is(rerankRoute.taskRoutePolicyRevision, `repair-${waitingRecord.id}`);
  t.is(
    rerankRoute.taskRoutePolicyRevisionId,
    `task-route-policy-revision-${waitingRecord.id}`
  );
  t.is(rerankRoute.taskRoutePolicyRevisionScope, 'workspace');
  t.is(rerankRoute.taskRoutePolicyRevisionStatus, 'active');
  t.is(rerankRoute.taskRoutePolicyRevisionWorkspaceId, workspace.id);
  t.deepEqual(
    rerankRoute.taskRoutePolicyRevisionSourceChain.map(
      (entry: { modelId: string; source: string }) => [
        entry.source,
        entry.modelId,
      ]
    ),
    [
      ['db_revision', 'localmind-repair-task-route/available-rerank-route'],
      ['config_fallback', 'missing-rerank-route'],
      ['config_fallback', 'localmind-repair-task-route/available-rerank-route'],
    ]
  );

  const auditRows = await db.$queryRaw<Array<{ eventType: string }>>`
    SELECT event_type AS "eventType"
    FROM ai_repair_execution_audit_events
    WHERE execution_request_id = ${waitingRecord.id}
    ORDER BY created_at ASC
  `;
  t.deepEqual(
    auditRows.map(row => row.eventType),
    [
      'requested',
      'waiting_approval',
      'approval_approved',
      'queued',
      'running',
      'side_effect_applied',
      'completed',
    ]
  );
});
