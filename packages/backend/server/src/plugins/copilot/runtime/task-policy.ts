import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { Config } from '../../../base';
import { QuotaStateService } from '../../../core/quota/state';
import { Models } from '../../../models';
import type { RegistryRevisionPublishEventRecord } from '../../../models/copilot-registry-revision-publish-event';
import { PromptService } from '../prompt/service';

export type TaskRoutePolicyFeatureKind =
  | 'embedding'
  | 'workspace_indexing'
  | 'rerank';

export type TaskModelSource =
  | 'embedding'
  | 'db_revision'
  | 'workspace_indexing'
  | 'workspace_indexing_embedding_fallback'
  | 'rerank'
  | 'provider_default';

export type TaskRoutePolicySourceChainEntry = {
  source: 'db_revision' | 'config_fallback' | 'provider_default';
  scope: 'global' | 'workspace';
  status: string;
  actorId?: string;
  configKey?: string;
  configPath?: string;
  featureKind?: TaskRoutePolicyFeatureKind;
  fingerprint?: string;
  modelId?: string;
  revision?: string;
  updatedAt?: string;
  workspaceId?: string;
};

export type TaskRoutePolicyRevision = {
  id: string;
  featureKind: TaskRoutePolicyFeatureKind;
  scopeType: 'global' | 'workspace';
  workspaceId?: string;
  actorId?: string;
  revision: string;
  status: 'active' | 'archived' | 'disabled';
  modelId?: string;
  configKey?: string;
  configPath?: string;
  fingerprint: string;
  fallbackSourceChain: TaskRoutePolicySourceChainEntry[];
  createdAt: Date;
  updatedAt: Date;
};

export interface ResolvedTaskModel {
  configKey?: 'embedding' | 'workspaceIndexing' | 'rerank';
  configPath?: string;
  fallbackSourceChain?: TaskRoutePolicySourceChainEntry[];
  modelId?: string;
  registryRevision?: TaskRoutePolicyRevision;
  registryRevisionActorId?: string;
  registryRevisionFingerprint?: string;
  registryRevisionId?: string;
  registryRevisionScope?: string;
  registryRevisionStatus?: string;
  registryRevisionWorkspaceId?: string;
  registryRevisionPublishEventCount?: number;
  registryRevisionPublishEvents?: RegistryRevisionPublishEventRecord[];
  registrySourceChainFingerprint?: string;
  source: TaskModelSource;
}

@Injectable()
export class TaskPolicy {
  constructor(
    private readonly config: Config,
    private readonly quotaState: QuotaStateService,
    private readonly prompts: PromptService,
    private readonly models?: Models
  ) {}

  resolveEmbeddingModel(): ResolvedTaskModel {
    const modelId = this.config.copilot.tasks.models.embedding;
    return modelId
      ? {
          configKey: 'embedding',
          configPath: 'copilot.tasks.models.embedding',
          modelId,
          source: 'embedding',
        }
      : { source: 'provider_default' };
  }

  resolveEmbeddingModelId(): string | undefined {
    return this.resolveEmbeddingModel().modelId;
  }

  async resolveEffectiveEmbeddingModel(
    workspaceId?: string | null
  ): Promise<ResolvedTaskModel> {
    return this.resolveEffectiveModel(
      'embedding',
      this.resolveEmbeddingModel(),
      workspaceId
    );
  }

  async resolveEffectiveEmbeddingModelId(
    workspaceId?: string | null
  ): Promise<string | undefined> {
    return (await this.resolveEffectiveEmbeddingModel(workspaceId)).modelId;
  }

  resolveWorkspaceIndexingModel(): ResolvedTaskModel {
    const { embedding, workspaceIndexing } = this.config.copilot.tasks.models;
    if (workspaceIndexing) {
      return {
        configKey: 'workspaceIndexing',
        configPath: 'copilot.tasks.models.workspaceIndexing',
        modelId: workspaceIndexing,
        source: 'workspace_indexing',
      };
    }

    return embedding
      ? {
          configKey: 'embedding',
          configPath: 'copilot.tasks.models.embedding',
          modelId: embedding,
          source: 'workspace_indexing_embedding_fallback',
        }
      : { source: 'provider_default' };
  }

  resolveWorkspaceIndexingModelId(): string | undefined {
    return this.resolveWorkspaceIndexingModel().modelId;
  }

  async resolveEffectiveWorkspaceIndexingModel(
    workspaceId?: string | null
  ): Promise<ResolvedTaskModel> {
    return this.resolveEffectiveModel(
      'workspace_indexing',
      this.resolveWorkspaceIndexingModel(),
      workspaceId
    );
  }

  async resolveEffectiveWorkspaceIndexingModelId(
    workspaceId?: string | null
  ): Promise<string | undefined> {
    return (await this.resolveEffectiveWorkspaceIndexingModel(workspaceId))
      .modelId;
  }

  resolveRerankModel(): ResolvedTaskModel {
    const modelId = this.config.copilot.tasks.models.rerank;
    return modelId
      ? {
          configKey: 'rerank',
          configPath: 'copilot.tasks.models.rerank',
          modelId,
          source: 'rerank',
        }
      : { source: 'provider_default' };
  }

  resolveRerankModelId(): string | undefined {
    return this.resolveRerankModel().modelId;
  }

  async resolveEffectiveRerankModel(
    workspaceId?: string | null
  ): Promise<ResolvedTaskModel> {
    return this.resolveEffectiveModel(
      'rerank',
      this.resolveRerankModel(),
      workspaceId
    );
  }

  async resolveEffectiveRerankModelId(
    workspaceId?: string | null
  ): Promise<string | undefined> {
    return (await this.resolveEffectiveRerankModel(workspaceId)).modelId;
  }

  async resolveTranscriptionModel(userId: string) {
    const prompt = await this.prompts.get('Transcript audio');
    if (!prompt) return;

    const state = await this.quotaState.reconcileUserQuotaState(userId);
    const flags = state.flags as { unlimitedCopilot?: boolean };
    const hasAccess =
      !!flags.unlimitedCopilot ||
      ['pro', 'lifetime_pro', 'ai'].includes(state.plan);
    return prompt.optionalModels[hasAccess ? 1 : 0] ?? prompt.model;
  }

  private async resolveEffectiveModel(
    featureKind: TaskRoutePolicyFeatureKind,
    fallback: ResolvedTaskModel,
    workspaceId?: string | null
  ): Promise<ResolvedTaskModel> {
    const fallbackSourceChain = [
      this.fallbackSourceChainEntry(featureKind, fallback),
    ];
    if (!this.models) {
      return {
        ...fallback,
        fallbackSourceChain,
        registrySourceChainFingerprint:
          this.taskRoutePolicySourceChainFingerprint(fallbackSourceChain),
      };
    }

    const revisions =
      await this.models.copilotTaskRoutePolicyRevision.listLatestActiveWithPublishEventsByFeatureKinds(
        {
          featureKinds: [featureKind],
          workspaceId,
        }
      );
    const revision = revisions.get(featureKind);
    if (!revision) {
      return {
        ...fallback,
        fallbackSourceChain,
        registrySourceChainFingerprint:
          this.taskRoutePolicySourceChainFingerprint(fallbackSourceChain),
      };
    }

    const sourceChain = [
      this.revisionSourceChainEntry(revision),
      ...revision.fallbackSourceChain,
    ];

    return {
      configKey:
        this.normalizeConfigKey(revision.configKey) ?? fallback.configKey,
      configPath: revision.configPath ?? fallback.configPath,
      fallbackSourceChain: sourceChain,
      modelId: revision.modelId ?? fallback.modelId,
      registryRevision: revision,
      registryRevisionActorId: revision.actorId,
      registryRevisionFingerprint: revision.fingerprint,
      registryRevisionId: revision.id,
      registryRevisionScope: revision.scopeType,
      registryRevisionStatus: revision.status,
      registryRevisionWorkspaceId: revision.workspaceId,
      registryRevisionPublishEventCount: revision.publishEventCount,
      registryRevisionPublishEvents: revision.publishEvents,
      registrySourceChainFingerprint:
        this.taskRoutePolicySourceChainFingerprint(sourceChain),
      source: 'db_revision',
    };
  }

  private fallbackSourceChainEntry(
    featureKind: TaskRoutePolicyFeatureKind,
    model: ResolvedTaskModel
  ): TaskRoutePolicySourceChainEntry {
    if (model.modelId) {
      return {
        source: 'config_fallback',
        scope: 'global',
        status: 'available',
        featureKind,
        modelId: model.modelId,
        ...(model.configKey ? { configKey: model.configKey } : {}),
        ...(model.configPath ? { configPath: model.configPath } : {}),
      };
    }

    return {
      source: 'provider_default',
      scope: 'global',
      status: 'available',
      featureKind,
    };
  }

  private revisionSourceChainEntry(
    revision: TaskRoutePolicyRevision
  ): TaskRoutePolicySourceChainEntry {
    return {
      source: 'db_revision',
      scope: revision.scopeType,
      status: revision.status,
      featureKind: revision.featureKind,
      fingerprint: revision.fingerprint,
      revision: revision.revision,
      updatedAt: revision.updatedAt.toISOString(),
      ...(revision.actorId ? { actorId: revision.actorId } : {}),
      ...(revision.configKey ? { configKey: revision.configKey } : {}),
      ...(revision.configPath ? { configPath: revision.configPath } : {}),
      ...(revision.modelId ? { modelId: revision.modelId } : {}),
      ...(revision.workspaceId ? { workspaceId: revision.workspaceId } : {}),
    };
  }

  private normalizeConfigKey(
    value?: string
  ): ResolvedTaskModel['configKey'] | undefined {
    return value === 'embedding' ||
      value === 'workspaceIndexing' ||
      value === 'rerank'
      ? value
      : undefined;
  }

  private taskRoutePolicySourceChainFingerprint(
    sourceChain: TaskRoutePolicySourceChainEntry[]
  ) {
    return createHash('sha256')
      .update(
        JSON.stringify(
          sourceChain.map(entry => ({
            actorId: entry.actorId ?? null,
            configKey: entry.configKey ?? null,
            configPath: entry.configPath ?? null,
            featureKind: entry.featureKind ?? null,
            fingerprint: entry.fingerprint ?? null,
            modelId: entry.modelId ?? null,
            revision: entry.revision ?? null,
            scope: entry.scope,
            source: entry.source,
            status: entry.status,
            updatedAt: entry.updatedAt ?? null,
            workspaceId: entry.workspaceId ?? null,
          }))
        )
      )
      .digest('hex')
      .slice(0, 16);
  }
}
