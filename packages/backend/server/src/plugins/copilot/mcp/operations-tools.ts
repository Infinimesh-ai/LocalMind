import { z } from 'zod';

import type { CurrentUser } from '../../../core/auth';
import type { CopilotResolver } from '../resolver';
import {
  defineTool,
  DESTRUCTIVE_WRITE_TOOL,
  READ_ONLY_TOOL,
  RESULT_OUTPUT_SCHEMA,
  toolResult,
  type WorkspaceMcpToolDefinition,
  WRITE_TOOL,
} from './types';

const expectedVersionSchema = z
  .object({
    registryFingerprint: z.string().optional(),
    registryId: z.number().int().optional(),
    registryUpdatedAt: z.string().optional(),
  })
  .strict();

const repairSubmissionSchema = z
  .object({
    approvalPolicyFingerprint: z.string(),
    authorizationFingerprint: z.string(),
    candidateEvidenceSetFingerprint: z.string(),
    taskRouteEffectiveSourceEvidenceSetFingerprint: z.string(),
    embeddingIndexContractEvidenceSetFingerprint: z.string(),
    rerankRuntimeContractEvidenceSetFingerprint: z.string(),
    preparedRouteOrderEvidenceSetFingerprint: z.string(),
    catalogFingerprint: z.string(),
    contractVersion: z.string(),
    expectedRegistryFingerprint: z.string(),
    expectedRegistryId: z.number().int(),
    expectedRegistryUpdatedAt: z.string(),
    guardFingerprint: z.string(),
    idempotencyKey: z.string(),
    operationSetFingerprint: z.string(),
    previewFingerprint: z.string(),
    targetLocatorFingerprint: z.string(),
    requiredInputs: z.array(z.string()),
    submissionFingerprint: z.string(),
  })
  .strict();

const repairExecutionExpectedFields = {
  expectedApprovalRecordFingerprint: z.string(),
  expectedApprovalRequestFingerprint: z.string(),
  expectedAuditEventFingerprint: z.string(),
  expectedCandidateEvidenceSetFingerprint: z.string(),
  expectedTaskRouteEffectiveSourceEvidenceSetFingerprint: z.string(),
  expectedEmbeddingIndexContractEvidenceSetFingerprint: z.string(),
  expectedRerankRuntimeContractEvidenceSetFingerprint: z.string(),
  expectedPreparedRouteOrderEvidenceSetFingerprint: z.string(),
  expectedTargetLocatorFingerprint: z.string(),
  expectedRepairGateManifestFingerprint: z.string(),
  expectedRepairGateManifestExportPolicyFingerprint: z.string(),
  expectedRepairGateManifestRetentionPolicyFingerprint: z.string(),
  expectedExecutionGateFingerprint: z.string(),
  expectedExecutionGateStatus: z.string(),
  expectedExecutionStateFingerprint: z.string(),
  expectedIdempotencyFingerprint: z.string(),
  expectedPolicyBindingFingerprint: z.string(),
  expectedPreflightStatus: z.string(),
  expectedRepairJobFingerprint: z.string(),
  expectedReviewBindingFingerprint: z.string(),
  expectedRollbackPlanFingerprint: z.string(),
};

const optionalStringFilter = z
  .object({
    query: z.string().optional(),
    status: z.string().optional(),
  })
  .strict();

export function createOperationsMcpTools(
  resolver: CopilotResolver,
  userId: string,
  workspaceId: string
): {
  readTools: WorkspaceMcpToolDefinition[];
  writeTools: WorkspaceMcpToolDefinition[];
} {
  const user = { id: userId } as CurrentUser;
  const copilot = { workspaceId };

  const readTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'list_ai_prompts',
      title: 'List AI Prompts',
      description:
        'List prompt catalog metadata, registry source, revision, and publish diagnostics.',
      parser: z.object({}).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async () => toolResult(await resolver.prompts(copilot)),
    }),
    defineTool({
      name: 'list_ai_models',
      title: 'List AI Models',
      description:
        'List available and optional models plus effective registry and route-policy diagnostics for a prompt.',
      parser: z.object({ promptName: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ promptName }) =>
        toolResult(await resolver.models(promptName, copilot)),
    }),
    defineTool({
      name: 'get_prompt_registry_publish_gate',
      title: 'Get Prompt Registry Publish Gate',
      description:
        'Evaluate prompt registry validation, route readiness, repair preview, and publish evidence.',
      parser: z
        .object({
          name: z.string().min(1),
          expectedVersion: expectedVersionSchema.optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ name, expectedVersion }) =>
        toolResult(
          await resolver.promptRegistryPublishGate(
            copilot,
            name,
            expectedVersion
          )
        ),
    }),
    defineTool({
      name: 'preflight_prompt_registry_repair',
      title: 'Preflight Prompt Registry Repair',
      description:
        'Validate a prompt repair submission contract before requesting execution.',
      parser: z
        .object({
          name: z.string().min(1),
          submission: repairSubmissionSchema,
          expectedVersion: expectedVersionSchema.optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ name, submission, expectedVersion }) =>
        toolResult(
          await resolver.promptRegistryRepairPreflight(
            user,
            copilot,
            name,
            submission as never,
            expectedVersion
          )
        ),
    }),
    defineTool({
      name: 'list_ai_action_runs',
      title: 'List AI Action Runs',
      description: 'List recent sanitized action-run diagnostics.',
      parser: z
        .object({ limit: z.number().int().min(1).max(200).default(50) })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ limit }) =>
        toolResult(await resolver.actionRuns(user, copilot, limit)),
    }),
    defineTool({
      name: 'get_ai_action_run_route_trace',
      title: 'Get AI Action Run Route Trace',
      description:
        'Get sanitized prepared-route diagnostics for an action run.',
      parser: z.object({ runId: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ runId }) =>
        toolResult(
          await resolver.actionRunPreparedRouteTrace(user, copilot, runId)
        ),
    }),
    defineTool({
      name: 'list_ai_support_bundles',
      title: 'List AI Support Bundles',
      description:
        'List persisted support bundle requests, artifacts, retention, audit, and transfer evidence.',
      parser: z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          filter: z
            .object({
              query: z.string().optional(),
              retentionStatus: z.string().optional(),
              status: z.string().optional(),
              transferForwardingStatus: z.string().optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ limit, filter }) =>
        toolResult(
          await resolver.supportBundles(user, copilot, limit, filter as never)
        ),
    }),
    defineTool({
      name: 'get_ai_support_bundle',
      title: 'Get AI Support Bundle',
      description:
        'Get one support bundle and record the existing read audit event.',
      parser: z.object({ id: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ id }) =>
        toolResult(await resolver.supportBundle(user, copilot, id)),
    }),
    defineTool({
      name: 'list_agent_runtime_runs',
      title: 'List Agent Runtime Runs',
      description:
        'List persisted Agent Runtime runs, steps, timeline events, and execution results.',
      parser: z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          filter: optionalStringFilter
            .extend({
              sourceId: z.string().optional(),
              sourceType: z.string().optional(),
              workflow: z.string().optional(),
            })
            .optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ limit, filter }) =>
        toolResult(
          await resolver.agentRuns(user, copilot, limit, filter as never)
        ),
    }),
    defineTool({
      name: 'get_agent_runtime_run',
      title: 'Get Agent Runtime Run',
      description:
        'Get one persisted Agent Runtime run with steps and timeline.',
      parser: z.object({ id: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ id }) =>
        toolResult(await resolver.agentRun(user, copilot, id)),
    }),
    defineTool({
      name: 'list_agent_runtime_workflow_adapters',
      title: 'List Agent Runtime Workflow Adapters',
      description:
        'List registered Agent Runtime workflow adapter capabilities.',
      parser: z.object({}).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async () =>
        toolResult(await resolver.agentRuntimeWorkflowAdapters(user, copilot)),
    }),
    defineTool({
      name: 'list_ai_repair_executions',
      title: 'List AI Repair Executions',
      description:
        'List persisted repair requests, approvals, worker state, audit history, and side-effect results.',
      parser: z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          filter: optionalStringFilter
            .extend({
              approvalState: z.string().optional(),
              promptName: z.string().optional(),
              requestedAction: z.string().optional(),
            })
            .optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ limit, filter }) =>
        toolResult(
          await resolver.repairExecutions(user, copilot, limit, filter as never)
        ),
    }),
    defineTool({
      name: 'list_provider_health_probe_attempts',
      title: 'List Provider Health Probe Attempts',
      description:
        'List persisted provider-health probe attempts and result evidence.',
      parser: z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          filter: optionalStringFilter
            .extend({
              providerId: z.string().optional(),
              providerRegistryRevisionId: z.string().optional(),
              providerRegistryRevisionFingerprint: z.string().optional(),
              providerProfileFingerprint: z.string().optional(),
              requestFingerprint: z.string().optional(),
              resultFingerprint: z.string().optional(),
            })
            .optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ limit, filter }) =>
        toolResult(
          await resolver.providerHealthProbeAttempts(
            user,
            copilot,
            limit,
            filter as never
          )
        ),
    }),
    defineTool({
      name: 'preview_prompt_registry_body_edit',
      title: 'Preview Prompt Registry Body Edit',
      description:
        'Preview a prompt-message edit and return its bounded diff and publish fingerprint.',
      parser: z
        .object({
          name: z.string().min(1),
          messageIndex: z.number().int().min(0),
          nextContent: z.string(),
          expectedVersion: expectedVersionSchema.optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async input =>
        toolResult(
          await resolver.previewCopilotPromptRegistryBodyEdit(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
  ];

  const writeTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'request_prompt_registry_repair',
      title: 'Request Prompt Registry Repair',
      description:
        'Create or reuse an approval-gated, persisted prompt repair execution request.',
      parser: z
        .object({
          name: z.string().min(1),
          expectedVersion: expectedVersionSchema.optional(),
          submission: repairSubmissionSchema,
          ...repairExecutionExpectedFields,
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.requestCopilotPromptRegistryRepairExecution(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'decide_ai_repair_approval',
      title: 'Decide AI Repair Approval',
      description: 'Approve or reject a waiting repair execution request.',
      parser: z
        .object({
          executionRequestId: z.string().min(1),
          decision: z.enum(['approve', 'reject']),
          reason: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.decideCopilotRepairExecutionApproval(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'control_ai_repair_execution',
      title: 'Control AI Repair Execution',
      description:
        'Cancel, retry, recover a stale repair, or resume it with a validated executor payload.',
      parser: z
        .object({
          executionRequestId: z.string().min(1),
          action: z.enum([
            'cancel',
            'retry',
            'recover_stale',
            'resume_with_payload',
          ]),
          executorPayload: z.record(z.string(), z.unknown()).optional(),
          reason: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.controlCopilotRepairExecution(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'request_agent_runtime_document_update',
      title: 'Request Agent Runtime Document Update',
      description:
        'Create an approval-gated Agent Runtime office task that updates one document after approval.',
      parser: z
        .object({
          docId: z.string().min(1),
          content: z.string(),
          contentFingerprint: z.string().optional(),
          idempotencyKey: z.string().optional(),
          title: z.string().optional(),
          reason: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.requestCopilotAgentRuntimeDocUpdate(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'control_agent_runtime_run',
      title: 'Control Agent Runtime Run',
      description: 'Approve, reject, cancel, or resume an Agent Runtime run.',
      parser: z
        .object({
          runId: z.string().min(1),
          action: z.enum(['approve', 'cancel', 'reject', 'resume']),
          reason: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.controlCopilotAgentRuntimeRun(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'create_ai_support_bundle',
      title: 'Create AI Support Bundle',
      description:
        'Create a persisted, sanitized support bundle manifest and archive.',
      parser: z.object({}).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async () =>
        toolResult(
          await resolver.createCopilotSupportBundle(user, {
            workspaceId,
          } as never)
        ),
    }),
    defineTool({
      name: 'authorize_ai_support_bundle_download',
      title: 'Authorize AI Support Bundle Download',
      description:
        'Issue a short-lived authorization for a manifest or archive artifact.',
      parser: z
        .object({
          bundleId: z.string().min(1),
          artifactKind: z
            .enum(['manifest_json', 'archive_json'])
            .default('archive_json'),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.authorizeCopilotSupportBundleDownload(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'acknowledge_ai_support_bundle_download',
      title: 'Acknowledge AI Support Bundle Download',
      description:
        'Acknowledge completion telemetry for a direct object-storage download.',
      parser: z.object({ authorizationId: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ authorizationId }) =>
        toolResult(
          await resolver.acknowledgeCopilotSupportBundleDirectDownload(user, {
            workspaceId,
            authorizationId,
          } as never)
        ),
    }),
    defineTool({
      name: 'cleanup_ai_support_bundle_retention',
      title: 'Cleanup AI Support Bundle Retention',
      description:
        'Expire due bundles and retry failed archive or manifest object cleanup.',
      parser: z
        .object({ limit: z.number().int().min(1).max(200).optional() })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async ({ limit }) =>
        toolResult(
          await resolver.cleanupCopilotSupportBundleRetention(user, {
            workspaceId,
            limit,
          } as never)
        ),
    }),
    defineTool({
      name: 'replay_ai_support_bundle_transfer',
      title: 'Replay AI Support Bundle Transfer',
      description:
        'Queue a fresh replay for a dead-lettered transfer forwarding event.',
      parser: z
        .object({
          forwardingEventId: z.string().min(1),
          maxAttempts: z.number().int().min(1).optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.replayCopilotSupportBundleTransferForwardingEvent(
            user,
            { workspaceId, ...input } as never
          )
        ),
    }),
    defineTool({
      name: 'publish_prompt_registry_body_edit',
      title: 'Publish Prompt Registry Body Edit',
      description:
        'Publish a prompt-message edit after a matching preview fingerprint.',
      parser: z
        .object({
          name: z.string().min(1),
          messageIndex: z.number().int().min(0),
          nextContent: z.string(),
          expectedPreviewFingerprint: z.string().min(1),
          expectedVersion: expectedVersionSchema.optional(),
          idempotencyKey: z.string().optional(),
          reviewNote: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.publishCopilotPromptRegistryBodyEdit(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'publish_prompt_registry_revision',
      title: 'Publish Prompt Registry Revision',
      description:
        'Publish a workspace prompt registry revision after gate and route-readiness checks.',
      parser: z
        .object({
          name: z.string().min(1),
          expectedVersion: expectedVersionSchema.optional(),
          revision: z.string().optional(),
          idempotencyKey: z.string().optional(),
          reviewNote: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.publishCopilotPromptRegistryRevision(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'publish_provider_registry_revision',
      title: 'Publish Provider Registry Revision',
      description:
        'Publish sanitized metadata for an existing configured provider. Credentials cannot be changed.',
      parser: z
        .object({
          providerId: z.string().min(1),
          revision: z.string().optional(),
          idempotencyKey: z.string().optional(),
          displayName: z.string().optional(),
          enabled: z.boolean().optional(),
          models: z.array(z.string()).optional(),
          modelDefinitions: z
            .array(z.record(z.string(), z.unknown()))
            .optional(),
          privacy: z.enum(['local', 'private_cloud', 'cloud']).optional(),
          priority: z.number().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.publishCopilotProviderRegistryRevision(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'publish_model_registry_revision',
      title: 'Publish Model Registry Revision',
      description:
        'Publish a model definition revision for an existing configured provider.',
      parser: z
        .object({
          providerId: z.string().min(1),
          modelId: z.string().min(1),
          revision: z.string().optional(),
          idempotencyKey: z.string().optional(),
          modelDefinition: z.record(z.string(), z.unknown()),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.publishCopilotModelRegistryRevision(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'publish_task_route_policy_revision',
      title: 'Publish Task Route Policy Revision',
      description:
        'Publish an embedding, workspace-indexing, or rerank model route policy revision.',
      parser: z
        .object({
          featureKind: z.enum(['embedding', 'workspace_indexing', 'rerank']),
          modelId: z.string().min(1),
          revision: z.string().optional(),
          idempotencyKey: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.publishCopilotTaskRoutePolicyRevision(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'record_provider_health_state',
      title: 'Record Provider Health State',
      description:
        'Persist a manual workspace health state for an existing provider.',
      parser: z
        .object({
          providerId: z.string().min(1),
          status: z.enum(['unknown', 'healthy', 'degraded', 'down']),
          lastError: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: { ...WRITE_TOOL, idempotentHint: true },
      execute: async input =>
        toolResult(
          await resolver.recordCopilotProviderHealthState(user, {
            workspaceId,
            ...input,
          } as never)
        ),
    }),
    defineTool({
      name: 'retry_provider_health_probe',
      title: 'Retry Provider Health Probe',
      description:
        'Queue a fresh attempt for a dead-lettered provider health probe.',
      parser: z.object({ attemptId: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ attemptId }) =>
        toolResult(
          await resolver.retryCopilotProviderHealthProbeAttempt(user, {
            workspaceId,
            attemptId,
          } as never)
        ),
    }),
  ];

  return { readTools, writeTools };
}
