import { Injectable } from '@nestjs/common';

import { Config } from '../../../base';
import { QuotaStateService } from '../../../core/quota/state';
import { PromptService } from '../prompt/service';

export type TaskModelSource =
  | 'embedding'
  | 'workspace_indexing'
  | 'workspace_indexing_embedding_fallback'
  | 'rerank'
  | 'provider_default';

export interface ResolvedTaskModel {
  configKey?: 'embedding' | 'workspaceIndexing' | 'rerank';
  configPath?: string;
  modelId?: string;
  source: TaskModelSource;
}

@Injectable()
export class TaskPolicy {
  constructor(
    private readonly config: Config,
    private readonly quotaState: QuotaStateService,
    private readonly prompts: PromptService
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
}
