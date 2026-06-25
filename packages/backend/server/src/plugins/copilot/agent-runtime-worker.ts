import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { JOB_SIGNAL, OnJob } from '../../base';
import { Models } from '../../models';
import type { CopilotAgentRunRecord } from '../../models/copilot-agent-runtime';
import {
  CopilotAgentRuntimeWorkflowRegistry,
  type CopilotAgentRuntimeWorkflowAdapter,
} from './agent-runtime-workflow-registry';

const AGENT_RUNTIME_WORKER_LEASE_MS = 5 * 60 * 1000;
const AGENT_RUNTIME_ADAPTER_RESOLUTION_VERSION =
  'agent-runtime-worker-adapter-resolution/v1';

declare global {
  interface Jobs {
    'copilot.agentRuntime.run': {
      workspaceId?: string;
      runId?: string;
    };
  }
}

@Injectable()
export class CopilotAgentRuntimeWorker {
  private readonly logger = new Logger(CopilotAgentRuntimeWorker.name);

  constructor(
    private readonly models: Models,
    private readonly workflowRegistry: CopilotAgentRuntimeWorkflowRegistry
  ) {}

  @OnJob('copilot.agentRuntime.run')
  async runStandaloneAgentRuntime(params: Jobs['copilot.agentRuntime.run']) {
    const workerId = `agent-runtime-worker-${randomUUID()}`;
    const run =
      await this.models.copilotAgentRuntime.acquireStandaloneWorkerLease({
        workspaceId: params.workspaceId,
        id: params.runId,
        workerId,
        leaseMs: AGENT_RUNTIME_WORKER_LEASE_MS,
      });

    if (!run) {
      this.logger.debug(
        params.runId
          ? `Agent runtime run ${params.runId} was not leaseable`
          : 'No standalone Agent Runtime run was leaseable'
      );
      return JOB_SIGNAL.Done;
    }

    const cancelled =
      await this.models.copilotAgentRuntime.cancelLeasedStandaloneRunIfCancellationRequested(
        {
          workspaceId: run.workspaceId,
          id: run.id,
          workerLeaseId: workerId,
          workerAttempt: run.workerAttempt,
        }
      );
    if (cancelled) {
      return params.runId ? JOB_SIGNAL.Done : JOB_SIGNAL.Repeat;
    }

    const current =
      await this.models.copilotAgentRuntime.currentLeasedStandaloneRunBeforeAdapterExecution(
        {
          workspaceId: run.workspaceId,
          id: run.id,
          workerLeaseId: workerId,
          workerAttempt: run.workerAttempt,
        }
      );
    if (!current) {
      this.logger.debug(
        `Agent runtime run ${run.id} worker lease changed before adapter execution`
      );
      return params.runId ? JOB_SIGNAL.Done : JOB_SIGNAL.Repeat;
    }

    const adapter = this.workflowRegistry.get(current.workflow);
    if (adapter) {
      const unsupportedContract = this.workflowRegistry.assertRunSupported(
        adapter,
        current
      );
      if (unsupportedContract) {
        await this.models.copilotAgentRuntime.failStandaloneWorkerExecution({
          workspaceId: current.workspaceId,
          id: current.id,
          workerLeaseId: workerId,
          workerAttempt: current.workerAttempt,
          code: unsupportedContract.code,
          message: unsupportedContract.message,
          adapterResolution: this.adapterContractResolution(
            current,
            adapter,
            unsupportedContract.unsupportedStepTypes
          ),
        });
        return params.runId ? JOB_SIGNAL.Done : JOB_SIGNAL.Repeat;
      }

      try {
        const checkCancellationRequested = () =>
          this.models.copilotAgentRuntime.cancelLeasedStandaloneRunIfCancellationRequested(
            {
              workspaceId: current.workspaceId,
              id: current.id,
              workerLeaseId: workerId,
              workerAttempt: current.workerAttempt,
            }
          );
        const execution = adapter.execute({
          run: current,
          workerLeaseId: workerId,
          workerAttempt: current.workerAttempt,
          checkCancellationRequested,
        });
        if (!execution || typeof execution.then !== 'function') {
          await this.failInvalidAdapterExecutorResultIfStillLeased(
            current,
            adapter,
            workerId
          );
          return params.runId ? JOB_SIGNAL.Done : JOB_SIGNAL.Repeat;
        }
        await execution;
      } catch (error) {
        await this.failAdapterExecutionExceptionIfStillLeased(
          current,
          adapter,
          workerId,
          error
        );
        return params.runId ? JOB_SIGNAL.Done : JOB_SIGNAL.Repeat;
      }
      const cancelledAfterAdapter =
        await this.cancelIfRequestedAfterAdapterExecution(
          current,
          adapter,
          workerId
        );
      if (cancelledAfterAdapter) {
        return params.runId ? JOB_SIGNAL.Done : JOB_SIGNAL.Repeat;
      }
      await this.failIncompleteAdapterExecutionIfStillLeased(
        current,
        adapter,
        workerId
      );
      return params.runId ? JOB_SIGNAL.Done : JOB_SIGNAL.Repeat;
    }

    await this.models.copilotAgentRuntime.failStandaloneWorkerExecution({
      workspaceId: current.workspaceId,
      id: current.id,
      workerLeaseId: workerId,
      workerAttempt: current.workerAttempt,
      code: 'unsupported_agent_runtime_adapter',
      message: [
        'Standalone Agent Runtime worker leased this run, but no workflow',
        'adapter is registered for durable execution yet.',
        `Registered adapters: ${this.workflowRegistry
          .adapterCapabilities()
          .map(
            adapter =>
              `${adapter.workflow}[steps=${adapter.capabilities.supportedStepTypes.join(
                '|'
              )}; sideEffects=${adapter.capabilities.sideEffectMode}]`
          )
          .join(', ') || 'none'}.`,
      ].join(' '),
      adapterResolution: this.unsupportedWorkflowResolution(current),
    });

    return params.runId ? JOB_SIGNAL.Done : JOB_SIGNAL.Repeat;
  }

  private async cancelIfRequestedAfterAdapterExecution(
    run: CopilotAgentRunRecord,
    adapter: CopilotAgentRuntimeWorkflowAdapter,
    workerId: string
  ) {
    const current = await this.models.copilotAgentRuntime.get(
      run.workspaceId,
      run.id
    );
    if (
      current?.status !== 'running' ||
      current.workerLeaseId !== workerId ||
      current.workerAttempt !== run.workerAttempt
    ) {
      return null;
    }

    const cancelled =
      await this.models.copilotAgentRuntime.cancelLeasedStandaloneRunIfCancellationRequested(
        {
          workspaceId: run.workspaceId,
          id: run.id,
          workerLeaseId: workerId,
          workerAttempt: run.workerAttempt,
        }
      );
    if (cancelled) {
      this.logger.debug(
        `Agent runtime adapter ${adapter.workflow} yielded to cancellation for run ${run.id}`
      );
    }
    return cancelled;
  }

  private async failAdapterExecutionExceptionIfStillLeased(
    run: CopilotAgentRunRecord,
    adapter: CopilotAgentRuntimeWorkflowAdapter,
    workerId: string,
    error: unknown
  ) {
    const current = await this.models.copilotAgentRuntime.get(
      run.workspaceId,
      run.id
    );
    if (
      current?.status !== 'running' ||
      current.workerLeaseId !== workerId ||
      current.workerAttempt !== run.workerAttempt
    ) {
      this.logger.debug(
        `Agent runtime adapter ${adapter.workflow} threw after releasing run ${run.id}`
      );
      return;
    }

    await this.models.copilotAgentRuntime.failStandaloneWorkerExecution({
      workspaceId: run.workspaceId,
      id: run.id,
      workerLeaseId: workerId,
      workerAttempt: run.workerAttempt,
      code: 'agent_runtime_adapter_execution_failed',
      message:
        error instanceof Error
          ? error.message
          : 'Agent Runtime workflow adapter execution failed',
      adapterResolution: this.adapterExecutionFailureResolution(
        current,
        adapter
      ),
    });
  }

  private async failInvalidAdapterExecutorResultIfStillLeased(
    run: CopilotAgentRunRecord,
    adapter: CopilotAgentRuntimeWorkflowAdapter,
    workerId: string
  ) {
    const current = await this.models.copilotAgentRuntime.get(
      run.workspaceId,
      run.id
    );
    if (
      current?.status !== 'running' ||
      current.workerLeaseId !== workerId ||
      current.workerAttempt !== run.workerAttempt
    ) {
      return;
    }

    await this.models.copilotAgentRuntime.failStandaloneWorkerExecution({
      workspaceId: run.workspaceId,
      id: run.id,
      workerLeaseId: workerId,
      workerAttempt: run.workerAttempt,
      code: 'agent_runtime_adapter_invalid_executor_result',
      message: [
        'Agent Runtime workflow adapter returned a non-promise executor',
        'result. Adapters must complete asynchronously through the leased',
        'runtime contract.',
      ].join(' '),
      adapterResolution: this.adapterInvalidExecutorResultResolution(
        current,
        adapter
      ),
    });
  }

  private async failIncompleteAdapterExecutionIfStillLeased(
    run: CopilotAgentRunRecord,
    adapter: CopilotAgentRuntimeWorkflowAdapter,
    workerId: string
  ) {
    const current = await this.models.copilotAgentRuntime.get(
      run.workspaceId,
      run.id
    );
    if (
      current?.status !== 'running' ||
      current.workerLeaseId !== workerId ||
      current.workerAttempt !== run.workerAttempt
    ) {
      return;
    }

    await this.models.copilotAgentRuntime.failStandaloneWorkerExecution({
      workspaceId: run.workspaceId,
      id: run.id,
      workerLeaseId: workerId,
      workerAttempt: run.workerAttempt,
      code: 'agent_runtime_adapter_incomplete_execution',
      message: [
        'Agent Runtime workflow adapter returned without completing,',
        'failing, cancelling, or releasing the leased run.',
      ].join(' '),
      adapterResolution: this.adapterIncompleteExecutionResolution(
        current,
        adapter
      ),
    });
  }

  private adapterCapabilitySnapshots() {
    return this.workflowRegistry.adapterCapabilities().map(adapter => ({
      workflow: adapter.workflow,
      supportedStepTypes: [...adapter.capabilities.supportedStepTypes],
      sideEffectMode: adapter.capabilities.sideEffectMode,
    }));
  }

  private requestedStepTypes(run: CopilotAgentRunRecord) {
    return [...new Set(run.steps.map(step => step.stepType))].sort();
  }

  private unsupportedWorkflowResolution(run: CopilotAgentRunRecord) {
    return {
      version: AGENT_RUNTIME_ADAPTER_RESOLUTION_VERSION,
      status: 'unsupported_workflow',
      workflow: run.workflow,
      requestedStepTypes: this.requestedStepTypes(run),
      registeredAdapters: this.adapterCapabilitySnapshots(),
    };
  }

  private adapterContractResolution(
    run: CopilotAgentRunRecord,
    adapter: CopilotAgentRuntimeWorkflowAdapter,
    unsupportedStepTypes: readonly string[]
  ) {
    return {
      version: AGENT_RUNTIME_ADAPTER_RESOLUTION_VERSION,
      status: 'unsupported_contract',
      workflow: run.workflow,
      requestedStepTypes: this.requestedStepTypes(run),
      unsupportedStepTypes: [...unsupportedStepTypes],
      adapter: {
        workflow: adapter.workflow,
        supportedStepTypes: [...adapter.capabilities.supportedStepTypes],
        sideEffectMode: adapter.capabilities.sideEffectMode,
      },
      registeredAdapters: this.adapterCapabilitySnapshots(),
    };
  }

  private adapterExecutionFailureResolution(
    run: CopilotAgentRunRecord,
    adapter: CopilotAgentRuntimeWorkflowAdapter
  ) {
    return {
      version: AGENT_RUNTIME_ADAPTER_RESOLUTION_VERSION,
      status: 'execution_failed',
      workflow: run.workflow,
      requestedStepTypes: this.requestedStepTypes(run),
      adapter: {
        workflow: adapter.workflow,
        supportedStepTypes: [...adapter.capabilities.supportedStepTypes],
        sideEffectMode: adapter.capabilities.sideEffectMode,
      },
      registeredAdapters: this.adapterCapabilitySnapshots(),
    };
  }

  private adapterInvalidExecutorResultResolution(
    run: CopilotAgentRunRecord,
    adapter: CopilotAgentRuntimeWorkflowAdapter
  ) {
    return {
      version: AGENT_RUNTIME_ADAPTER_RESOLUTION_VERSION,
      status: 'invalid_executor_result',
      workflow: run.workflow,
      requestedStepTypes: this.requestedStepTypes(run),
      adapter: {
        workflow: adapter.workflow,
        supportedStepTypes: [...adapter.capabilities.supportedStepTypes],
        sideEffectMode: adapter.capabilities.sideEffectMode,
      },
      registeredAdapters: this.adapterCapabilitySnapshots(),
    };
  }

  private adapterIncompleteExecutionResolution(
    run: CopilotAgentRunRecord,
    adapter: CopilotAgentRuntimeWorkflowAdapter
  ) {
    return {
      version: AGENT_RUNTIME_ADAPTER_RESOLUTION_VERSION,
      status: 'incomplete_execution',
      workflow: run.workflow,
      requestedStepTypes: this.requestedStepTypes(run),
      adapter: {
        workflow: adapter.workflow,
        supportedStepTypes: [...adapter.capabilities.supportedStepTypes],
        sideEffectMode: adapter.capabilities.sideEffectMode,
      },
      registeredAdapters: this.adapterCapabilitySnapshots(),
    };
  }
}
