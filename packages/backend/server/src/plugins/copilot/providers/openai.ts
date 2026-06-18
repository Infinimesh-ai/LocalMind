import { Inject } from '@nestjs/common';

import {
  CopilotProviderSideError,
  OneMB,
  UserFriendlyError,
} from '../../../base';
import {
  type LlmBackendConfig,
  llmResolveRequestIntentOptions,
} from '../../../native';
import {
  admittedAttachmentToPromptAttachment,
  AttachmentAdmissionHost,
} from '../runtime/hosts/attachment-admission';
import { AttachmentMaterializer } from '../runtime/hosts/attachment-materializer';
import { CopilotProvider } from './provider';
import { hasProviderModelBehaviorFlag } from './provider-model-runtime';
import type {
  CopilotProviderExecution,
  ProviderDriverSpec,
} from './provider-runtime-contract';
import {
  CopilotProviderType,
  type PromptAttachment,
  type PromptMessage,
} from './types';
import { promptAttachmentToUrl } from './utils';

export const DEFAULT_DIMENSIONS = 256;

export type OpenAIRequestApiStyle = 'chat_completions' | 'responses' | 'auto';

export type OpenAIConfig = {
  apiKey: string;
  baseURL?: string;
  oldApiStyle?: boolean;
};

export type OpenAICompatibleConfig = {
  apiKey?: string;
  baseURL: string;
  headers?: Record<string, string>;
  apiStyle?: OpenAIRequestApiStyle;
};

abstract class OpenAIBaseProvider<
  C extends {
    apiKey?: string;
    baseURL?: string;
    headers?: Record<string, string>;
  },
> extends CopilotProvider<C> {
  @Inject() protected readonly attachmentMaterializer!: AttachmentMaterializer;
  @Inject()
  protected readonly attachmentAdmissionHost?: AttachmentAdmissionHost;

  protected abstract resolveBaseUrl(config: C): string;

  override configured(execution?: CopilotProviderExecution): boolean {
    return !!this.resolveBaseUrl(this.getConfig(execution));
  }

  protected handleError(e: any) {
    if (e instanceof UserFriendlyError) {
      return e;
    }
    return new CopilotProviderSideError({
      provider: this.type,
      kind: 'unexpected_response',
      message: e?.message || 'Unexpected openai response',
    });
  }

  protected createNativeConfig(
    execution?: CopilotProviderExecution
  ): LlmBackendConfig {
    const config = this.getConfig(execution);
    return {
      base_url: this.resolveBaseUrl(config),
      auth_token: config.apiKey ?? '',
      ...(config.headers ? { headers: config.headers } : {}),
    };
  }

  private getAttachmentAdmissionHost() {
    return (
      this.attachmentAdmissionHost ??
      new AttachmentAdmissionHost(this.attachmentMaterializer)
    );
  }

  private async prepareImageMessages(
    messages: PromptMessage[],
    options: {
      signal?: AbortSignal;
      user?: string;
      workspace?: string;
      session?: string;
    }
  ) {
    const prepared: PromptMessage[] = [];

    for (const message of messages) {
      options.signal?.throwIfAborted();
      if (!Array.isArray(message.attachments) || !message.attachments.length) {
        prepared.push(message);
        continue;
      }

      let changed = false;
      const attachments: PromptAttachment[] = [];
      for (const attachment of message.attachments) {
        options.signal?.throwIfAborted();
        const url = promptAttachmentToUrl(attachment);
        if (!url || url.startsWith('data:')) {
          attachments.push(attachment);
          continue;
        }

        const admitted =
          await this.getAttachmentAdmissionHost().admitPromptAttachment(
            attachment,
            {
              userId: options.user ?? 'provider-runtime',
              workspaceId: options.workspace ?? 'provider-runtime',
              sessionId: options.session,
              signal: options.signal,
              maxBytes: 50 * OneMB,
            }
          );
        attachments.push(admittedAttachmentToPromptAttachment(admitted));
        changed = true;
      }

      prepared.push(changed ? { ...message, attachments } : message);
    }

    return prepared;
  }

  override getDriverSpec(): ProviderDriverSpec {
    return {
      createBackendConfig: execution => this.createNativeConfig(execution),
      mapError: error => this.handleError(error),
      chat: {
        resolveRequestOptions: async context => {
          const requestIntent = await llmResolveRequestIntentOptions({
            protocol: context.protocol,
            backendConfig: context.backendConfig,
            include: context.options.webSearch ? ['citations'] : undefined,
            reasoning: {
              enabled: context.options.reasoning,
              supported: hasProviderModelBehaviorFlag(
                context.model,
                'reasoning_supported'
              ),
            },
          });

          return {
            attachmentCapability: this.getAttachCapability(
              context.model,
              context.outputType
            ),
            include: requestIntent.include,
            reasoning: requestIntent.reasoning,
          };
        },
      },
      structured: {},
      embedding: {
        defaultDimensions: DEFAULT_DIMENSIONS,
        taskType: 'RETRIEVAL_DOCUMENT',
      },
      image: {
        prepareMessages: async (messages, _backendConfig, options) =>
          await this.prepareImageMessages(messages, options),
      },
    };
  }
}

export class OpenAIProvider extends OpenAIBaseProvider<OpenAIConfig> {
  readonly type = CopilotProviderType.OpenAI;

  protected resolveModelBackendKind(execution?: CopilotProviderExecution) {
    return this.getConfig(execution).oldApiStyle
      ? ('openai_chat' as const)
      : ('openai_responses' as const);
  }

  protected resolveBaseUrl(config: OpenAIConfig) {
    return (config.baseURL || 'https://api.openai.com/v1').replace(
      /\/v1\/?$/,
      ''
    );
  }

  override configured(execution?: CopilotProviderExecution): boolean {
    return !!this.getConfig(execution).apiKey;
  }
}

export class OpenAICompatibleProvider extends OpenAIBaseProvider<OpenAICompatibleConfig> {
  readonly type = CopilotProviderType.OpenAICompatible;

  protected resolveModelBackendKind(execution?: CopilotProviderExecution) {
    return this.getConfig(execution).apiStyle === 'responses'
      ? ('openai_responses' as const)
      : ('openai_chat' as const);
  }

  protected resolveBaseUrl(config: OpenAICompatibleConfig) {
    return config.baseURL.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  }
}
