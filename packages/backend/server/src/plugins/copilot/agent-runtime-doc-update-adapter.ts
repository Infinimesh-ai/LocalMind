import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { JobQueue } from '../../base';
import { DocWriter } from '../../core/doc';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import type {
  CopilotAgentRunRecord,
  CopilotAgentStepRecord,
} from '../../models/copilot-agent-runtime';
import type { McpDelegationRequestStatus } from '../../models/copilot-mcp-delegation';
import {
  type CopilotAgentRuntimeWorkflowAdapterInput,
  CopilotAgentRuntimeWorkflowRegistry,
} from './agent-runtime-workflow-registry';
import { MCP_DELEGATE_CAPABILITY } from './mcp/capabilities';

export const AGENT_RUNTIME_DOC_UPDATE_WORKFLOW = 'agent_runtime_doc_update';
export const AGENT_RUNTIME_DOC_UPDATE_REQUEST_VERSION =
  'agent-runtime-doc-update-request/v1';

const DOC_UPDATE_DOC_ID_MAX_LENGTH = 256;
const DOC_UPDATE_CONTENT_MAX_LENGTH = 6_000;

type AgentRuntimeDocUpdateRequest = {
  content: string;
  contentFingerprint: string;
  docId: string;
  expectedDocumentVersion: Date | null;
};

function agentRuntimeDocUpdateFingerprint(value: unknown) {
  return createHash('sha256')
    .update(stableAgentRuntimeDocUpdateStringify(value))
    .digest('hex');
}

function stableAgentRuntimeDocUpdateStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableAgentRuntimeDocUpdateStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined
          ? null
          : `${JSON.stringify(key)}:${stableAgentRuntimeDocUpdateStringify(
              item
            )}`;
      })
      .filter(Boolean)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function docUpdateRequestError(stepKey: string, reason: string) {
  return new Error(
    `Agent runtime doc update step "${stepKey}" has an invalid request: ${reason}`
  );
}

function requireDocUpdateString(
  value: unknown,
  stepKey: string,
  field: string,
  maxLength: number
) {
  if (typeof value !== 'string') {
    throw docUpdateRequestError(stepKey, `${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw docUpdateRequestError(stepKey, `${field} must not be blank`);
  }
  if (normalized.length > maxLength) {
    throw docUpdateRequestError(stepKey, `${field} is too long`);
  }
  return normalized;
}

function requireDocUpdateContent(value: unknown, stepKey: string) {
  if (typeof value !== 'string') {
    throw docUpdateRequestError(stepKey, 'content must be a string');
  }
  if (!value.trim()) {
    throw docUpdateRequestError(stepKey, 'content must not be blank');
  }
  if (value.length > DOC_UPDATE_CONTENT_MAX_LENGTH) {
    throw docUpdateRequestError(stepKey, 'content is too long');
  }
  return value;
}

function normalizeDocUpdateRequest(step: CopilotAgentStepRecord) {
  const request = step.outputSummary.docUpdateRequest;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw docUpdateRequestError(
      step.stepKey,
      'step output summary must persist a docUpdateRequest object'
    );
  }
  const raw = request as Record<string, unknown>;
  const version = requireDocUpdateString(
    raw.version,
    step.stepKey,
    'version',
    DOC_UPDATE_DOC_ID_MAX_LENGTH
  );
  if (version !== AGENT_RUNTIME_DOC_UPDATE_REQUEST_VERSION) {
    throw docUpdateRequestError(
      step.stepKey,
      `version must be ${AGENT_RUNTIME_DOC_UPDATE_REQUEST_VERSION}`
    );
  }
  const docId = requireDocUpdateString(
    raw.docId,
    step.stepKey,
    'docId',
    DOC_UPDATE_DOC_ID_MAX_LENGTH
  );
  const content = requireDocUpdateContent(raw.content, step.stepKey);
  const expectedDocumentVersion =
    raw.expectedDocumentVersion === undefined ||
    raw.expectedDocumentVersion === null
      ? null
      : new Date(
          requireDocUpdateString(
            raw.expectedDocumentVersion,
            step.stepKey,
            'expectedDocumentVersion',
            DOC_UPDATE_DOC_ID_MAX_LENGTH
          )
        );
  if (
    expectedDocumentVersion &&
    Number.isNaN(expectedDocumentVersion.getTime())
  ) {
    throw docUpdateRequestError(
      step.stepKey,
      'expectedDocumentVersion must be an ISO timestamp'
    );
  }
  const contentFingerprint = agentRuntimeDocUpdateFingerprint({
    version: 'agent-runtime-doc-update-content/v1',
    content,
  });
  if (raw.contentFingerprint !== undefined && raw.contentFingerprint !== null) {
    const expected = requireDocUpdateString(
      raw.contentFingerprint,
      step.stepKey,
      'contentFingerprint',
      DOC_UPDATE_DOC_ID_MAX_LENGTH
    );
    if (expected !== contentFingerprint) {
      throw docUpdateRequestError(
        step.stepKey,
        'contentFingerprint must match content'
      );
    }
  }
  return { content, contentFingerprint, docId, expectedDocumentVersion };
}

@Injectable()
export class CopilotAgentRuntimeDocUpdateAdapter {
  private readonly logger = new Logger(
    CopilotAgentRuntimeDocUpdateAdapter.name
  );

  constructor(
    private readonly ac: PermissionAccess,
    private readonly docWriter: DocWriter,
    private readonly models: Models,
    private readonly jobs: JobQueue,
    private readonly workflowRegistry: CopilotAgentRuntimeWorkflowRegistry
  ) {
    this.workflowRegistry.register({
      workflow: AGENT_RUNTIME_DOC_UPDATE_WORKFLOW,
      capabilities: {
        version: 'agent-runtime-workflow-adapter-capabilities/v1',
        supportedStepTypes: ['approval', 'tool'],
        sideEffectMode: 'workspace_write',
        summary:
          'Applies one authorization-checked workspace document update through the Agent Runtime worker and records side-effect evidence.',
      },
      execute: async input => {
        try {
          await this.execute(input);
        } catch (error) {
          await this.failPendingDelegation(input.run.id, {
            code: 'agent_runtime_adapter_execution_failed',
          });
          throw error;
        }
      },
    });
  }

  private requireToolStep(run: CopilotAgentRunRecord) {
    const activeToolSteps = run.steps.filter(
      step =>
        step.stepType === 'tool' &&
        (step.status === 'pending' ||
          step.status === 'running' ||
          step.status === 'waiting_approval')
    );
    if (activeToolSteps.length !== 1) {
      throw new Error(
        `Agent runtime doc update requires exactly one active tool step, found ${activeToolSteps.length}: ${run.id}`
      );
    }
    return activeToolSteps[0];
  }

  private assertApprovalSatisfied(run: CopilotAgentRunRecord) {
    const approvalSteps = run.steps.filter(
      step => step.stepType === 'approval'
    );
    if (!approvalSteps.length) {
      throw new Error(
        `Agent runtime doc update requires an approval step: ${run.id}`
      );
    }
    const unapproved = approvalSteps.find(step => step.status !== 'completed');
    if (unapproved) {
      throw new Error(
        `Agent runtime doc update approval step is not completed: ${unapproved.stepKey}`
      );
    }
  }

  private sideEffectFingerprint(request: AgentRuntimeDocUpdateRequest) {
    return agentRuntimeDocUpdateFingerprint({
      version: 'agent-runtime-doc-update-side-effect/v1',
      docId: request.docId,
      contentFingerprint: request.contentFingerprint,
    });
  }

  private async execute(input: CopilotAgentRuntimeWorkflowAdapterInput) {
    const { run, workerAttempt, workerLeaseId, checkCancellationRequested } =
      input;
    const step = this.requireToolStep(run);
    const request = normalizeDocUpdateRequest(step);
    const delegation =
      await this.models.copilotMcpDelegation.getRequestByAgentRun(run.id);
    if (!delegation) {
      this.assertApprovalSatisfied(run);
    }

    if (await checkCancellationRequested()) {
      this.logger.debug(
        `Agent runtime doc update cancelled before permission check: ${run.id}`
      );
      return;
    }

    if (delegation) {
      const credential =
        await this.models.mcpCredential.findUsableFamilyCredential(
          delegation.credentialFamilyId,
          delegation.actorId,
          delegation.workspaceId
        );
      if (!credential) {
        await this.failDelegation(run.id, 'failed', {
          code: 'credential_inactive',
        });
        throw new Error(
          `Agent runtime doc update credential is inactive: ${run.id}`
        );
      }
      if (!delegation.capabilitySnapshot.includes(MCP_DELEGATE_CAPABILITY)) {
        await this.failDelegation(run.id, 'credential_scope_denied', {
          code: 'credential_scope_denied',
          requiredCapabilities: [MCP_DELEGATE_CAPABILITY],
        });
        throw new Error(
          `Agent runtime doc update credential scope is insufficient: ${run.id}`
        );
      }
    }

    const [workspaceAllowed, canUpdate] = await Promise.all([
      this.ac
        .user(run.actorId)
        .workspace(run.workspaceId)
        .allowLocal()
        .can('Workspace.Copilot'),
      this.ac
        .user(run.actorId)
        .doc({ workspaceId: run.workspaceId, docId: request.docId })
        .allowLocal()
        .can('Doc.Update'),
    ]);
    if (!workspaceAllowed || !canUpdate) {
      await this.failDelegation(run.id, 'permission_denied', {
        code: 'permission_denied',
        missingPermission: workspaceAllowed
          ? 'Doc.Update'
          : 'Workspace.Copilot',
        documentId: request.docId,
      });
      throw new Error(
        `Agent runtime doc update permission was revoked: ${request.docId}`
      );
    }

    if (await checkCancellationRequested()) {
      this.logger.debug(
        `Agent runtime doc update cancelled before side effect: ${run.id}`
      );
      return;
    }

    if (request.expectedDocumentVersion) {
      const timestamps = await this.models.doc.findTimestampsByDocIds(
        run.workspaceId,
        [request.docId]
      );
      if (
        timestamps[request.docId] !== request.expectedDocumentVersion.getTime()
      ) {
        await this.failDelegation(run.id, 'failed', {
          code: 'resource_version_conflict',
          documentId: request.docId,
          expectedVersion: request.expectedDocumentVersion.toISOString(),
          actualVersion:
            timestamps[request.docId] === undefined
              ? null
              : new Date(timestamps[request.docId]).toISOString(),
        });
        throw new Error(
          `Agent runtime doc update document version changed before execution: ${request.docId}`
        );
      }
    }

    await this.docWriter.updateDoc(
      run.workspaceId,
      request.docId,
      request.content,
      run.actorId
    );

    const sideEffectFingerprint = this.sideEffectFingerprint(request);
    const sideEffectSummary = {
      version: 'agent-runtime-doc-update-side-effect/v1',
      sideEffectKind: 'workspace_doc_update',
      sideEffectRecordId: request.docId,
      sideEffectFingerprint,
      docId: request.docId,
      contentFingerprint: request.contentFingerprint,
      idempotencyMode: 'deterministic_doc_body_update',
    };
    const summary = [
      `Updated workspace document ${request.docId}`,
      delegation
        ? 'through credential-authorized MCP delegation.'
        : 'through approved Agent Runtime office task.',
    ].join(' ');

    await this.models.copilotAgentRuntime.completeStandaloneWorkerExecution({
      workspaceId: run.workspaceId,
      id: run.id,
      workerLeaseId,
      workerAttempt,
      adapterWorkflow: AGENT_RUNTIME_DOC_UPDATE_WORKFLOW,
      sideEffectMode: 'workspace_write',
      sideEffectsApplied: true,
      sideEffectSummary,
      summary,
      adapterResolution: this.workflowRegistry.completedAdapterResolution(
        run,
        AGENT_RUNTIME_DOC_UPDATE_WORKFLOW
      ),
    });

    if (delegation) {
      const completed = await this.models.copilotMcpDelegation.updateRequest(
        delegation.id,
        {
          status: 'completed',
          result: {
            kind: 'document_update',
            agentRunId: run.id,
            documentId: request.docId,
            contentFingerprint: request.contentFingerprint,
            sideEffectFingerprint,
            execution: 'completed',
          },
        }
      );
      const endpoint = await this.models.copilotMcpDelegation.getEndpoint(
        delegation.credentialFamilyId
      );
      if (endpoint) {
        await this.models.copilotMcpDelegation.enqueueCallback({
          requestId: delegation.id,
          eventType: 'task_completed',
          payload: {
            version: 'localmind-mcp-callback/v1',
            event: 'task_completed',
            requestId: delegation.id,
            status: completed.status,
            result: completed.result,
          },
        });
        await this.jobs.add(
          'copilot.mcpDelegation.deliverCallback',
          { requestId: delegation.id },
          { jobId: `copilot-mcp-delegation-completed-${delegation.id}` }
        );
      }
    }
  }

  private async failDelegation(
    agentRunId: string,
    status: Extract<
      McpDelegationRequestStatus,
      'failed' | 'permission_denied' | 'credential_scope_denied'
    >,
    result: Record<string, unknown>
  ) {
    const delegation =
      await this.models.copilotMcpDelegation.getRequestByAgentRun(agentRunId);
    if (!delegation) return;
    const failed = await this.models.copilotMcpDelegation.updateRequest(
      delegation.id,
      { status, result }
    );
    const endpoint = await this.models.copilotMcpDelegation.getEndpoint(
      delegation.credentialFamilyId
    );
    if (!endpoint) return;
    await this.models.copilotMcpDelegation.enqueueCallback({
      requestId: delegation.id,
      eventType: 'task_failed',
      payload: {
        version: 'localmind-mcp-callback/v1',
        event: 'task_failed',
        requestId: delegation.id,
        status: failed.status,
        result: failed.result,
      },
    });
    await this.jobs.add(
      'copilot.mcpDelegation.deliverCallback',
      { requestId: delegation.id },
      { jobId: `copilot-mcp-delegation-failed-${delegation.id}` }
    );
  }

  private async failPendingDelegation(
    agentRunId: string,
    result: Record<string, unknown>
  ) {
    const delegation =
      await this.models.copilotMcpDelegation.getRequestByAgentRun(agentRunId);
    if (delegation?.status !== 'processing') return;
    await this.failDelegation(agentRunId, 'failed', result);
  }
}
