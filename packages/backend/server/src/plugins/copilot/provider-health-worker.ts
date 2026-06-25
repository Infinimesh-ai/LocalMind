import { Injectable, Logger } from '@nestjs/common';

import { JOB_SIGNAL, OnJob } from '../../base';
import { Models } from '../../models';
import {
  PROVIDER_HEALTH_STATE_PROBE_RESULT_MAX_AGE_MS,
  type CopilotProviderHealthProbeAttemptRecord,
} from '../../models/copilot-provider-health-state';
import { CopilotProviderFactory } from './providers/factory';
import { providerProfileConfigPathHint } from './providers/provider-registry';
import { CopilotProviderRegistryService } from './providers/registry-service';

declare global {
  interface Jobs {
    'copilot.providerHealth.persistConfiguredSnapshots': {};
    'copilot.providerHealth.enqueueWorkspaceProbeAttempts': {
      limit?: number;
    };
    'copilot.providerHealth.processProbeAttempts': {
      limit?: number;
      attemptId?: string;
    };
  }
}

@Injectable()
export class CopilotProviderHealthWorker {
  private readonly logger = new Logger(CopilotProviderHealthWorker.name);

  constructor(
    private readonly models: Models,
    private readonly providerRegistry: CopilotProviderRegistryService,
    private readonly providerFactory: CopilotProviderFactory
  ) {}

  @OnJob('copilot.providerHealth.persistConfiguredSnapshots')
  async persistConfiguredSnapshots() {
    const registry = this.providerRegistry.getRegistry();
    let persistedCount = 0;
    const activeProviderIds: string[] = [];

    for (const profile of registry.profiles.values()) {
      if (!profile.health) {
        continue;
      }
      activeProviderIds.push(profile.id);

      await this.models.copilotProviderHealthState.upsertGlobalProbeState({
        providerId: profile.id,
        providerType: profile.type,
        status: profile.health.status,
        checkedAt: profile.health.lastCheckedAt ?? null,
        lastError: profile.health.lastError ?? null,
        providerProfileSource: profile.source,
        metadata: {
          providerProfileConfigPath: providerProfileConfigPathHint(profile),
          providerProfileId: profile.id,
          providerProfileSnapshotSource: profile.source,
        },
      });
      persistedCount += 1;
    }
    const cleared =
      await this.models.copilotProviderHealthState.clearStaleConfiguredSnapshotGlobalStates(
        {
          activeProviderIds,
        }
      );
    const staleProbeResults =
      await this.models.copilotProviderHealthState.clearStaleProbeResultStates(
        {
          maxAgeMs: PROVIDER_HEALTH_STATE_PROBE_RESULT_MAX_AGE_MS,
        }
      );

    this.logger.log(
      `Persisted ${persistedCount} configured provider health snapshots, cleared ${cleared.length} stale snapshots, and expired ${staleProbeResults.length} stale probe results`
    );
    return JOB_SIGNAL.Done;
  }

  @OnJob('copilot.providerHealth.enqueueWorkspaceProbeAttempts')
  async enqueueWorkspaceProbeAttempts(
    params: Jobs['copilot.providerHealth.enqueueWorkspaceProbeAttempts']
  ) {
    const revisions =
      await this.models.copilotProviderRegistryRevision.listActiveWorkspaceProviderHealthProbeTargets(
        {
          limit: params.limit,
        }
      );
    let enqueuedCount = 0;
    for (const revision of revisions) {
      const attempt =
        await this.models.copilotProviderHealthState.enqueueWorkspaceProviderHealthProbeAttempt(
          {
            revision,
          }
        );
      if (attempt.status === 'queued' && attempt.attemptCount === 0) {
        enqueuedCount += 1;
      }
    }

    this.logger.log(
      `Enqueued ${enqueuedCount} provider health probe attempts from ${revisions.length} workspace provider registry revisions`
    );
    return JOB_SIGNAL.Done;
  }

  @OnJob('copilot.providerHealth.processProbeAttempts')
  async processProbeAttempts(
    params: Jobs['copilot.providerHealth.processProbeAttempts']
  ) {
    const result = await this.processDueProbeAttempts({
      limit: params.limit,
      attemptId: params.attemptId,
    });
    this.logger.log(
      `Processed ${result.processedCount} provider health probe attempts: ${result.completedCount} completed, ${result.retryScheduledCount} retry scheduled, ${result.deadLetteredCount} dead-lettered`
    );
    return result.retryScheduledCount > 0 ? JOB_SIGNAL.Retry : JOB_SIGNAL.Done;
  }

  async processDueProbeAttempts(input: {
    limit?: number;
    attemptId?: string;
  }) {
    const attempts =
      await this.models.copilotProviderHealthState.leaseDueProviderHealthProbeAttempts(
        {
          id: input.attemptId,
          limit: input.limit,
        }
      );
    const processedAt = new Date();
    let completedCount = 0;
    let retryScheduledCount = 0;
    let deadLetteredCount = 0;
    let failedCount = 0;

    for (const attempt of attempts) {
      const updated = await this.processLeasedProbeAttempt(attempt);
      if (updated.status === 'completed') {
        completedCount += 1;
      } else if (updated.status === 'retry_scheduled') {
        retryScheduledCount += 1;
      } else if (updated.status === 'dead_lettered') {
        deadLetteredCount += 1;
      }
      if (updated.status !== 'completed') {
        failedCount += 1;
      }
    }

    return {
      processedAt,
      processedCount: attempts.length,
      completedCount,
      retryScheduledCount,
      deadLetteredCount,
      failedCount,
      attemptIds: attempts.map(attempt => attempt.id),
    };
  }

  private async processLeasedProbeAttempt(
    attempt: CopilotProviderHealthProbeAttemptRecord
  ) {
    try {
      const result = await this.providerFactory.probeProviderProfile({
        providerId: attempt.providerId,
        workspaceId: attempt.workspaceId,
      });
      return await this.models.copilotProviderHealthState.completeProviderHealthProbeAttempt(
        {
          attempt,
          result: {
            status: result.status,
            checkedAt: result.checkedAt,
            lastError: result.errorMessage ?? null,
            metadata: {
              probeMode: 'local_provider_profile_contract',
              errorCode: result.errorCode ?? null,
              diagnostics: result.diagnostics,
            },
          },
        }
      );
    } catch (error) {
      return await this.models.copilotProviderHealthState.failProviderHealthProbeAttempt(
        {
          attempt,
          error,
        }
      );
    }
  }
}
