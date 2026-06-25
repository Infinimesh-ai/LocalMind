import { createHash } from 'node:crypto';

import { Injectable, Logger, Optional } from '@nestjs/common';

import { Config } from '../../../base';
import { Models } from '../../../models';
import type {
  CopilotPromptModelDefault,
  CopilotPromptOverride,
} from '../config';
import type {
  PromptConfig,
  PromptMessage,
  PromptParams,
} from '../providers/types';
import { isImagePromptCategory, isTranscriptPromptCategory } from './category';
import {
  collectPromptMetadataNative,
  countPromptTokensNative,
  getBuiltInPromptSpecNative,
  listBuiltInPromptSpecsNative,
  renderBuiltInPromptNative,
  renderBuiltInPromptSessionNative,
  renderPromptNative,
  renderPromptSessionNative,
} from './native-contract';
import type {
  Prompt,
  PromptCatalogItem,
  PromptRegistryDiagnostic,
  PromptRegistryRevision,
  PromptRegistryRevisionWithPublishEvents,
  PromptRegistrySourceChainEntry,
  PromptSpec,
  ResolvedPrompt,
} from './spec';

type PromptDefaultPolicyResult = {
  name: NonNullable<ResolvedPrompt['defaultPolicy']>;
  policy: CopilotPromptModelDefault;
};

type MaybePromise<T> = T | Promise<T>;

@Injectable()
export class PromptService {
  protected readonly logger = new Logger(PromptService.name);
  constructor(
    private readonly config: Config,
    @Optional() private readonly models?: Models
  ) {
    this.logger.log('Using native built-in prompt catalog with registry seed.');
  }

  async get(name: string): Promise<ResolvedPrompt | null> {
    const compatPrompt = await this.lookupCompatPrompt(name);
    if (compatPrompt) {
      return this.applyConfiguredOverride(
        this.describeCompatPrompt(this.clonePrompt(compatPrompt))
      );
    }

    const builtInPromptSpec = this.lookupBuiltInPromptSpec(name);
    if (!builtInPromptSpec) return null;

    return this.applyConfiguredOverride(
      this.describeBuiltInPromptSpec(builtInPromptSpec)
    );
  }

  async listCatalog(workspaceId?: string | null): Promise<PromptCatalogItem[]> {
    const builtInPrompts = this.listBuiltInPromptSpecs().map(spec =>
      this.describeBuiltInPromptSpec(spec)
    );
    const compatPrompts = (await this.listCompatPrompts()).map(prompt =>
      this.describeCompatPrompt(this.clonePrompt(prompt))
    );
    const registryDiagnostics = await this.listRegistryDiagnostics();
    const promptByName = new Map<string, PromptCatalogItem>();

    for (const prompt of [...builtInPrompts, ...compatPrompts]) {
      const resolved = this.applyConfiguredOverride(prompt);
      promptByName.set(resolved.name, this.toCatalogItem(resolved));
    }

    for (const diagnostic of registryDiagnostics) {
      if (diagnostic.registryValidationStatus === 'ready') {
        continue;
      }

      const existing = promptByName.get(diagnostic.name);
      if (existing) {
        promptByName.set(
          diagnostic.name,
          this.applyRegistryDiagnostic(existing, diagnostic)
        );
      } else {
        promptByName.set(
          diagnostic.name,
          this.toRegistryDiagnosticCatalogItem(diagnostic)
        );
      }
    }

    const catalog = Array.from(promptByName.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const registryRevisionModel = this.models?.copilotPromptRegistryRevision;
    if (!registryRevisionModel) {
      return catalog.map(prompt =>
        this.applyPromptRegistryFallbackSourceChain(prompt)
      );
    }

    const revisions =
      await registryRevisionModel.listLatestActiveWithPublishEventsByPromptNames(
        {
          names: catalog.map(prompt => prompt.name),
          workspaceId,
        }
      );

    return catalog.map(prompt =>
      this.applyPromptRegistryRevision(
        this.applyPromptRegistryFallbackSourceChain(prompt),
        revisions.get(prompt.name)
      )
    );
  }

  finish(
    prompt: ResolvedPrompt,
    params: PromptParams,
    sessionId?: string
  ): PromptMessage[] {
    const rendered =
      prompt.source === 'built_in'
        ? renderBuiltInPromptNative({
            name: prompt.name,
            renderParams: params,
          })
        : renderPromptNative({
            messages: this.requireTemplateMessages(prompt),
            templateParams: prompt.params,
            renderParams: params,
          });

    this.logWarnings(rendered.warnings, sessionId);
    return rendered.messages;
  }

  renderSession(
    prompt: ResolvedPrompt,
    turns: PromptMessage[],
    params: PromptParams,
    maxTokenSize = prompt.config?.maxTokens || 128 * 1024,
    sessionId?: string
  ): PromptMessage[] {
    const rendered =
      prompt.source === 'built_in'
        ? renderBuiltInPromptSessionNative({
            name: prompt.name,
            turns,
            renderParams: params,
            maxTokenSize,
          })
        : renderPromptSessionNative({
            prompt: {
              action: prompt.action,
              model: prompt.model,
              promptTokens: this.countCompatPromptTokens(prompt),
              templateParams: prompt.params,
              messages: this.requireTemplateMessages(prompt),
            },
            turns,
            renderParams: params,
            maxTokenSize,
          });

    this.logWarnings(rendered.warnings, sessionId);
    return rendered.messages;
  }

  protected lookupCompatPrompt(name: string): MaybePromise<Prompt | null> {
    return this.models?.copilotPrompt.getRegistryPrompt(name) ?? null;
  }

  protected listCompatPrompts(): MaybePromise<Prompt[]> {
    return this.models?.copilotPrompt.listRegistryPrompts() ?? [];
  }

  protected listRegistryDiagnostics(): MaybePromise<
    PromptRegistryDiagnostic[]
  > {
    return this.models?.copilotPrompt.listRegistryDiagnostics() ?? [];
  }

  protected lookupBuiltInPromptSpec(name: string): PromptSpec | null {
    const spec = getBuiltInPromptSpecNative(name);
    return spec ? this.clonePromptSpec(spec) : null;
  }

  protected listBuiltInPromptSpecs(): PromptSpec[] {
    return listBuiltInPromptSpecsNative().map(spec =>
      this.clonePromptSpec(spec)
    );
  }

  protected cloneMessages(messages: PromptMessage[]) {
    return messages.map(message => ({
      ...message,
      attachments: message.attachments ? [...message.attachments] : undefined,
      params: message.params ? structuredClone(message.params) : undefined,
      responseFormat: message.responseFormat
        ? structuredClone(message.responseFormat)
        : undefined,
    }));
  }

  protected clonePrompt(prompt: Prompt): Prompt {
    return {
      ...prompt,
      optionalModels: prompt.optionalModels
        ? [...prompt.optionalModels]
        : undefined,
      config: prompt.config ? structuredClone(prompt.config) : undefined,
      messages: this.cloneMessages(prompt.messages),
    };
  }

  protected clonePromptSpec(spec: PromptSpec): PromptSpec {
    return {
      ...spec,
      optionalModels: spec.optionalModels
        ? [...spec.optionalModels]
        : undefined,
      config: spec.config ? structuredClone(spec.config) : undefined,
      params: spec.params ? structuredClone(spec.params) : undefined,
      messages: spec.messages.map(message => ({ ...message })),
    };
  }

  private describeBuiltInPromptSpec(spec: PromptSpec): ResolvedPrompt {
    const params = this.normalizePromptSpecParams(spec.params);
    return {
      name: spec.name,
      action: spec.action,
      model: spec.model,
      modelSource: 'built_in',
      optionalModels: spec.optionalModels ?? [],
      optionalModelsSource: 'built_in',
      config: spec.config ? structuredClone(spec.config) : undefined,
      proModelsSource: 'built_in',
      paramKeys: Object.keys(params),
      params,
      source: 'built_in',
      category: this.resolvePromptCategory(spec),
      overrideApplied: false,
    };
  }

  private describeCompatPrompt(prompt: Prompt): ResolvedPrompt {
    const metadata = collectPromptMetadataNative({ messages: prompt.messages });
    const source = prompt.source ?? 'compat';
    return {
      name: prompt.name,
      action: prompt.action,
      model: prompt.model,
      ...(source === 'registry'
        ? { modelConfigPath: 'ai_prompts_metadata.model' }
        : {}),
      modelSource: source,
      optionalModels: prompt.optionalModels ?? [],
      ...(source === 'registry'
        ? { optionalModelsConfigPath: 'ai_prompts_metadata.optional_models' }
        : {}),
      optionalModelsSource: source,
      config: prompt.config ? structuredClone(prompt.config) : undefined,
      ...(source === 'registry' && prompt.config?.proModels
        ? { proModelsConfigPath: 'ai_prompts_metadata.config.proModels' }
        : {}),
      proModelsSource: source,
      paramKeys: metadata.paramKeys,
      params: metadata.templateParams,
      ...(source === 'registry' && prompt.registryFingerprint
        ? { registryFingerprint: prompt.registryFingerprint }
        : {}),
      ...(source === 'registry' && prompt.registryId !== undefined
        ? { registryId: prompt.registryId }
        : {}),
      ...(source === 'registry' && prompt.registryMessageCount !== undefined
        ? { registryMessageCount: prompt.registryMessageCount }
        : {}),
      ...(source === 'registry' && prompt.registryModified !== undefined
        ? { registryModified: prompt.registryModified }
        : {}),
      ...(source === 'registry' && prompt.registryUpdatedAt
        ? { registryUpdatedAt: prompt.registryUpdatedAt }
        : {}),
      ...(source === 'registry' &&
      prompt.registryValidationBlockingCount !== undefined
        ? {
            registryValidationBlockingCount:
              prompt.registryValidationBlockingCount,
          }
        : {}),
      ...(source === 'registry' && prompt.registryValidationDetail
        ? { registryValidationDetail: prompt.registryValidationDetail }
        : {}),
      ...(source === 'registry' &&
      prompt.registryValidationErrorCount !== undefined
        ? { registryValidationErrorCount: prompt.registryValidationErrorCount }
        : {}),
      ...(source === 'registry' &&
      prompt.registryValidationIssueCount !== undefined
        ? { registryValidationIssueCount: prompt.registryValidationIssueCount }
        : {}),
      ...(source === 'registry' && prompt.registryValidationIssues
        ? { registryValidationIssues: [...prompt.registryValidationIssues] }
        : {}),
      ...(source === 'registry' && prompt.registryValidationPublishStatus
        ? {
            registryValidationPublishStatus:
              prompt.registryValidationPublishStatus,
          }
        : {}),
      ...(source === 'registry' && prompt.registryValidationRemediations
        ? {
            registryValidationRemediations: [
              ...prompt.registryValidationRemediations,
            ],
          }
        : {}),
      ...(source === 'registry' && prompt.registryValidationReason
        ? { registryValidationReason: prompt.registryValidationReason }
        : {}),
      ...(source === 'registry' && prompt.registryValidationStatus
        ? { registryValidationStatus: prompt.registryValidationStatus }
        : {}),
      source,
      category: this.resolvePromptCategory(prompt),
      overrideApplied: false,
      messages: prompt.messages,
    };
  }

  private toCatalogItem(prompt: ResolvedPrompt): PromptCatalogItem {
    const catalogItem = {
      name: prompt.name,
      ...(prompt.action ? { action: prompt.action } : {}),
      model: prompt.model,
      ...(prompt.modelConfigPath
        ? { modelConfigPath: prompt.modelConfigPath }
        : {}),
      modelSource: prompt.modelSource,
      optionalModels: [...prompt.optionalModels],
      ...(prompt.optionalModelsConfigPath
        ? { optionalModelsConfigPath: prompt.optionalModelsConfigPath }
        : {}),
      optionalModelCount: prompt.optionalModels.length,
      optionalModelsSource: prompt.optionalModelsSource,
      paramKeys: [...prompt.paramKeys],
      paramCount: prompt.paramKeys.length,
      ...(prompt.proModelsConfigPath
        ? { proModelsConfigPath: prompt.proModelsConfigPath }
        : {}),
      source: prompt.source,
      category: prompt.category,
      ...(prompt.defaultPolicy ? { defaultPolicy: prompt.defaultPolicy } : {}),
      overrideApplied: prompt.overrideApplied,
      proModelCount: prompt.config?.proModels?.length ?? 0,
      proModelsSource: prompt.proModelsSource,
      ...(prompt.registryFingerprint
        ? { registryFingerprint: prompt.registryFingerprint }
        : {}),
      ...(prompt.registryId !== undefined
        ? { registryId: prompt.registryId }
        : {}),
      ...(prompt.registryMessageCount !== undefined
        ? { registryMessageCount: prompt.registryMessageCount }
        : {}),
      ...(prompt.registryModified !== undefined
        ? { registryModified: prompt.registryModified }
        : {}),
      ...(prompt.registryUpdatedAt
        ? { registryUpdatedAt: prompt.registryUpdatedAt }
        : {}),
      ...(prompt.registryValidationBlockingCount !== undefined
        ? {
            registryValidationBlockingCount:
              prompt.registryValidationBlockingCount,
          }
        : {}),
      ...(prompt.registryValidationDetail
        ? { registryValidationDetail: prompt.registryValidationDetail }
        : {}),
      ...(prompt.registryValidationErrorCount !== undefined
        ? { registryValidationErrorCount: prompt.registryValidationErrorCount }
        : {}),
      ...(prompt.registryValidationIssueCount !== undefined
        ? { registryValidationIssueCount: prompt.registryValidationIssueCount }
        : {}),
      ...(prompt.registryValidationIssues
        ? { registryValidationIssues: [...prompt.registryValidationIssues] }
        : {}),
      ...(prompt.registryValidationPublishStatus
        ? {
            registryValidationPublishStatus:
              prompt.registryValidationPublishStatus,
          }
        : {}),
      ...(prompt.registryValidationRemediations
        ? {
            registryValidationRemediations: [
              ...prompt.registryValidationRemediations,
            ],
          }
        : {}),
      ...(prompt.registryValidationReason
        ? { registryValidationReason: prompt.registryValidationReason }
        : {}),
      ...(prompt.registryValidationStatus
        ? { registryValidationStatus: prompt.registryValidationStatus }
        : {}),
      ...(prompt.registryRecordSource
        ? { registryRecordSource: prompt.registryRecordSource }
        : {}),
      ...(prompt.registryRevision
        ? { registryRevision: prompt.registryRevision }
        : {}),
      ...(prompt.registryRevisionActorId
        ? { registryRevisionActorId: prompt.registryRevisionActorId }
        : {}),
      ...(prompt.registryRevisionFingerprint
        ? { registryRevisionFingerprint: prompt.registryRevisionFingerprint }
        : {}),
      ...(prompt.registryRevisionId
        ? { registryRevisionId: prompt.registryRevisionId }
        : {}),
      ...(prompt.registryRevisionScope
        ? { registryRevisionScope: prompt.registryRevisionScope }
        : {}),
      ...(prompt.registryRevisionStatus
        ? { registryRevisionStatus: prompt.registryRevisionStatus }
        : {}),
      ...(prompt.registryRevisionWorkspaceId
        ? { registryRevisionWorkspaceId: prompt.registryRevisionWorkspaceId }
        : {}),
      ...(prompt.registrySourceChain
        ? { registrySourceChain: [...prompt.registrySourceChain] }
        : {}),
      ...(prompt.registrySourceChainFingerprint
        ? {
            registrySourceChainFingerprint:
              prompt.registrySourceChainFingerprint,
          }
        : {}),
    };
    const modelStrategyFingerprint =
      this.buildCatalogModelStrategyFingerprint(catalogItem);
    const templateFingerprint = this.buildCatalogTemplateFingerprint(prompt);
    const fingerprint = this.buildCatalogFingerprint({
      modelStrategyFingerprint,
      templateFingerprint,
    });

    return {
      ...catalogItem,
      fingerprint,
      modelStrategyFingerprint,
      revision: this.buildCatalogRevision(catalogItem, fingerprint),
      templateFingerprint,
      versionEvidence: this.buildCatalogVersionEvidence({
        catalogItem,
        fingerprint,
        modelStrategyFingerprint,
        templateFingerprint,
      }),
    };
  }

  private applyRegistryDiagnostic(
    prompt: PromptCatalogItem,
    diagnostic: PromptRegistryDiagnostic
  ): PromptCatalogItem {
    const catalogItem = {
      ...prompt,
      registryFingerprint: diagnostic.registryFingerprint,
      registryId: diagnostic.registryId,
      registryMessageCount: diagnostic.registryMessageCount,
      registryModified: diagnostic.registryModified,
      registryUpdatedAt: diagnostic.registryUpdatedAt,
      registryValidationBlockingCount:
        diagnostic.registryValidationBlockingCount,
      registryValidationDetail: diagnostic.registryValidationDetail,
      registryValidationErrorCount: diagnostic.registryValidationErrorCount,
      registryValidationIssueCount: diagnostic.registryValidationIssueCount,
      registryValidationIssues: [...diagnostic.registryValidationIssues],
      registryValidationPublishStatus:
        diagnostic.registryValidationPublishStatus,
      registryValidationRemediations: [
        ...diagnostic.registryValidationRemediations,
      ],
      registryValidationReason: diagnostic.registryValidationReason,
      registryValidationStatus: diagnostic.registryValidationStatus,
      registryRecordSource: prompt.registryRecordSource,
      ...(prompt.registryRevision
        ? { registryRevision: prompt.registryRevision }
        : {}),
      ...(prompt.registryRevisionActorId
        ? { registryRevisionActorId: prompt.registryRevisionActorId }
        : {}),
      ...(prompt.registryRevisionFingerprint
        ? { registryRevisionFingerprint: prompt.registryRevisionFingerprint }
        : {}),
      ...(prompt.registryRevisionId
        ? { registryRevisionId: prompt.registryRevisionId }
        : {}),
      ...(prompt.registryRevisionScope
        ? { registryRevisionScope: prompt.registryRevisionScope }
        : {}),
      ...(prompt.registryRevisionStatus
        ? { registryRevisionStatus: prompt.registryRevisionStatus }
        : {}),
      ...(prompt.registryRevisionWorkspaceId
        ? { registryRevisionWorkspaceId: prompt.registryRevisionWorkspaceId }
        : {}),
      ...(prompt.registrySourceChain
        ? { registrySourceChain: [...prompt.registrySourceChain] }
        : {}),
      ...(prompt.registrySourceChainFingerprint
        ? {
            registrySourceChainFingerprint:
              prompt.registrySourceChainFingerprint,
          }
        : {}),
    };
    const modelStrategyFingerprint =
      this.buildCatalogModelStrategyFingerprint(catalogItem);
    const fingerprint = this.buildCatalogFingerprint({
      modelStrategyFingerprint,
      templateFingerprint: catalogItem.templateFingerprint,
    });

    return {
      ...catalogItem,
      fingerprint,
      modelStrategyFingerprint,
      revision: this.buildCatalogRevision(catalogItem, fingerprint),
      versionEvidence: this.buildCatalogVersionEvidence({
        catalogItem,
        fingerprint,
        modelStrategyFingerprint,
        templateFingerprint: catalogItem.templateFingerprint,
      }),
    };
  }

  private toRegistryDiagnosticCatalogItem(
    diagnostic: PromptRegistryDiagnostic
  ): PromptCatalogItem {
    const catalogItem = {
      ...(diagnostic.action ? { action: diagnostic.action } : {}),
      category: this.resolvePromptCategory(diagnostic),
      model: diagnostic.model,
      modelConfigPath: 'ai_prompts_metadata.model',
      modelSource: 'registry',
      name: diagnostic.name,
      optionalModelCount: diagnostic.optionalModels.length,
      optionalModels: [...diagnostic.optionalModels],
      optionalModelsConfigPath: 'ai_prompts_metadata.optional_models',
      optionalModelsSource: 'registry',
      overrideApplied: false,
      paramCount: 0,
      paramKeys: [],
      proModelCount: 0,
      proModelsSource: 'registry',
      registryFingerprint: diagnostic.registryFingerprint,
      registryId: diagnostic.registryId,
      registryMessageCount: diagnostic.registryMessageCount,
      registryModified: diagnostic.registryModified,
      registryUpdatedAt: diagnostic.registryUpdatedAt,
      registryValidationBlockingCount:
        diagnostic.registryValidationBlockingCount,
      registryValidationDetail: diagnostic.registryValidationDetail,
      registryValidationErrorCount: diagnostic.registryValidationErrorCount,
      registryValidationIssueCount: diagnostic.registryValidationIssueCount,
      registryValidationIssues: [...diagnostic.registryValidationIssues],
      registryValidationPublishStatus:
        diagnostic.registryValidationPublishStatus,
      registryValidationRemediations: [
        ...diagnostic.registryValidationRemediations,
      ],
      registryValidationReason: diagnostic.registryValidationReason,
      registryValidationStatus: diagnostic.registryValidationStatus,
      registryRecordSource: 'legacy_registry' as const,
      source: 'registry',
    };
    const modelStrategyFingerprint =
      this.buildCatalogModelStrategyFingerprint(catalogItem);
    const templateFingerprint = this.hashCatalogPayload({
      name: diagnostic.name,
      registryValidationBlockingCount:
        diagnostic.registryValidationBlockingCount,
      registryValidationDetail: diagnostic.registryValidationDetail,
      registryValidationErrorCount: diagnostic.registryValidationErrorCount,
      registryValidationIssueCount: diagnostic.registryValidationIssueCount,
      registryValidationIssues: diagnostic.registryValidationIssues,
      registryValidationPublishStatus:
        diagnostic.registryValidationPublishStatus,
      registryValidationRemediations: diagnostic.registryValidationRemediations,
      registryValidationReason: diagnostic.registryValidationReason,
      registryValidationStatus: diagnostic.registryValidationStatus,
      source: diagnostic.source,
    });
    const fingerprint = this.buildCatalogFingerprint({
      modelStrategyFingerprint,
      templateFingerprint,
    });

    return {
      ...catalogItem,
      fingerprint,
      modelStrategyFingerprint,
      revision: this.buildCatalogRevision(catalogItem, fingerprint),
      templateFingerprint,
      versionEvidence: this.buildCatalogVersionEvidence({
        catalogItem,
        fingerprint,
        modelStrategyFingerprint,
        templateFingerprint,
      }),
    };
  }

  private buildCatalogVersionEvidence(input: {
    catalogItem: Omit<
      PromptCatalogItem,
      | 'fingerprint'
      | 'modelStrategyFingerprint'
      | 'revision'
      | 'templateFingerprint'
      | 'versionEvidence'
    >;
    fingerprint: string;
    modelStrategyFingerprint: string;
    templateFingerprint: string;
  }) {
    const { catalogItem, fingerprint, modelStrategyFingerprint } = input;
    return {
      ...(catalogItem.defaultPolicy
        ? { defaultPolicy: catalogItem.defaultPolicy }
        : {}),
      fingerprint,
      ...(catalogItem.modelConfigPath
        ? { modelConfigPath: catalogItem.modelConfigPath }
        : {}),
      modelStrategyFingerprint,
      ...(catalogItem.optionalModelsConfigPath
        ? { optionalModelsConfigPath: catalogItem.optionalModelsConfigPath }
        : {}),
      overrideApplied: catalogItem.overrideApplied,
      ...(catalogItem.proModelsConfigPath
        ? { proModelsConfigPath: catalogItem.proModelsConfigPath }
        : {}),
      ...(catalogItem.registryFingerprint
        ? { registryFingerprint: catalogItem.registryFingerprint }
        : {}),
      ...(catalogItem.registryId !== undefined
        ? { registryId: catalogItem.registryId }
        : {}),
      ...(catalogItem.registryMessageCount !== undefined
        ? { registryMessageCount: catalogItem.registryMessageCount }
        : {}),
      ...(catalogItem.registryModified !== undefined
        ? { registryModified: catalogItem.registryModified }
        : {}),
      ...(catalogItem.registryUpdatedAt
        ? { registryUpdatedAt: catalogItem.registryUpdatedAt }
        : {}),
      ...(catalogItem.registryValidationBlockingCount !== undefined
        ? {
            registryValidationBlockingCount:
              catalogItem.registryValidationBlockingCount,
          }
        : {}),
      ...(catalogItem.registryValidationDetail
        ? { registryValidationDetail: catalogItem.registryValidationDetail }
        : {}),
      ...(catalogItem.registryValidationErrorCount !== undefined
        ? {
            registryValidationErrorCount:
              catalogItem.registryValidationErrorCount,
          }
        : {}),
      ...(catalogItem.registryValidationIssueCount !== undefined
        ? {
            registryValidationIssueCount:
              catalogItem.registryValidationIssueCount,
          }
        : {}),
      ...(catalogItem.registryValidationIssues
        ? {
            registryValidationIssues: [...catalogItem.registryValidationIssues],
          }
        : {}),
      ...(catalogItem.registryValidationPublishStatus
        ? {
            registryValidationPublishStatus:
              catalogItem.registryValidationPublishStatus,
          }
        : {}),
      ...(catalogItem.registryValidationRemediations
        ? {
            registryValidationRemediations: [
              ...catalogItem.registryValidationRemediations,
            ],
          }
        : {}),
      ...(catalogItem.registryValidationReason
        ? { registryValidationReason: catalogItem.registryValidationReason }
        : {}),
      ...(catalogItem.registryValidationStatus
        ? { registryValidationStatus: catalogItem.registryValidationStatus }
        : {}),
      ...(catalogItem.registryRecordSource
        ? { registryRecordSource: catalogItem.registryRecordSource }
        : {}),
      ...(catalogItem.registryRevision
        ? { registryRevision: catalogItem.registryRevision }
        : {}),
      ...(catalogItem.registryRevisionActorId
        ? { registryRevisionActorId: catalogItem.registryRevisionActorId }
        : {}),
      ...(catalogItem.registryRevisionFingerprint
        ? {
            registryRevisionFingerprint:
              catalogItem.registryRevisionFingerprint,
          }
        : {}),
      ...(catalogItem.registryRevisionId
        ? { registryRevisionId: catalogItem.registryRevisionId }
        : {}),
      ...(catalogItem.registryRevisionPublishEventCount !== undefined
        ? {
            registryRevisionPublishEventCount:
              catalogItem.registryRevisionPublishEventCount,
          }
        : {}),
      ...(catalogItem.registryRevisionPublishEvents
        ? {
            registryRevisionPublishEvents: [
              ...catalogItem.registryRevisionPublishEvents,
            ],
          }
        : {}),
      ...(catalogItem.registryRevisionScope
        ? { registryRevisionScope: catalogItem.registryRevisionScope }
        : {}),
      ...(catalogItem.registryRevisionStatus
        ? { registryRevisionStatus: catalogItem.registryRevisionStatus }
        : {}),
      ...(catalogItem.registryRevisionWorkspaceId
        ? {
            registryRevisionWorkspaceId:
              catalogItem.registryRevisionWorkspaceId,
          }
        : {}),
      ...(catalogItem.registrySourceChain
        ? { registrySourceChain: [...catalogItem.registrySourceChain] }
        : {}),
      ...(catalogItem.registrySourceChainFingerprint
        ? {
            registrySourceChainFingerprint:
              catalogItem.registrySourceChainFingerprint,
          }
        : {}),
      revision: this.buildCatalogRevision(catalogItem, fingerprint),
      templateFingerprint: input.templateFingerprint,
    };
  }

  private applyPromptRegistryFallbackSourceChain(
    prompt: PromptCatalogItem
  ): PromptCatalogItem {
    const chain = this.buildPromptRegistryFallbackSourceChain(prompt);
    const registryRecordSource =
      prompt.registryRecordSource ??
      (prompt.registryId !== undefined ? 'legacy_registry' : 'config_fallback');
    const registrySourceChainFingerprint =
      this.buildPromptRegistrySourceChainFingerprint(chain);
    return {
      ...prompt,
      registryRecordSource,
      registrySourceChain: chain,
      registrySourceChainFingerprint,
      versionEvidence: {
        ...prompt.versionEvidence,
        registryRecordSource,
        registrySourceChain: chain,
        registrySourceChainFingerprint,
      },
    };
  }

  private applyPromptRegistryRevision(
    prompt: PromptCatalogItem,
    revision: PromptRegistryRevisionWithPublishEvents | undefined
  ): PromptCatalogItem {
    if (!revision) {
      return prompt;
    }

    const chain = this.mergePromptRegistrySourceChain(
      {
        source: 'db_revision',
        scope: revision.scopeType,
        status: revision.status,
        ...(revision.actorId ? { actorId: revision.actorId } : {}),
        fingerprint: revision.fingerprint,
        revision: revision.revision,
        updatedAt: revision.updatedAt.toISOString(),
        ...(revision.workspaceId ? { workspaceId: revision.workspaceId } : {}),
      },
      revision.fallbackSourceChain.length
        ? revision.fallbackSourceChain
        : prompt.registrySourceChain
    );
    const registrySourceChainFingerprint =
      this.buildPromptRegistrySourceChainFingerprint(chain);
    const catalogItem = {
      ...prompt,
      registryRecordSource: 'db_revision' as const,
      registryRevision: revision.revision,
      ...(revision.actorId
        ? { registryRevisionActorId: revision.actorId }
        : {}),
      registryRevisionFingerprint: revision.fingerprint,
      registryRevisionId: revision.id,
      registryRevisionPublishEventCount: revision.publishEventCount,
      registryRevisionPublishEvents: revision.publishEvents,
      registryRevisionScope: revision.scopeType,
      registryRevisionStatus: revision.status,
      ...(revision.workspaceId
        ? { registryRevisionWorkspaceId: revision.workspaceId }
        : {}),
      registrySourceChain: chain,
      registrySourceChainFingerprint,
    };
    const modelStrategyFingerprint =
      this.buildCatalogModelStrategyFingerprint(catalogItem);
    const fingerprint = this.buildCatalogFingerprint({
      modelStrategyFingerprint,
      templateFingerprint: catalogItem.templateFingerprint,
    });

    return {
      ...catalogItem,
      fingerprint,
      modelStrategyFingerprint,
      revision: this.buildCatalogRevision(catalogItem, fingerprint),
      versionEvidence: this.buildCatalogVersionEvidence({
        catalogItem,
        fingerprint,
        modelStrategyFingerprint,
        templateFingerprint: catalogItem.templateFingerprint,
      }),
    };
  }

  private buildPromptRegistryFallbackSourceChain(
    prompt: PromptCatalogItem
  ): PromptRegistrySourceChainEntry[] {
    const chain: PromptRegistrySourceChainEntry[] = [];

    if (prompt.registryId !== undefined) {
      chain.push({
        source: 'legacy_registry',
        scope: 'global',
        status: prompt.registryValidationStatus ?? 'unknown',
        configPath: 'ai_prompts_metadata',
        ...(prompt.registryFingerprint
          ? { fingerprint: prompt.registryFingerprint }
          : {}),
        registryId: prompt.registryId,
        revision: prompt.revision,
        ...(prompt.registryUpdatedAt
          ? { updatedAt: prompt.registryUpdatedAt.toISOString() }
          : {}),
      });
    }

    chain.push({
      source: 'config_fallback',
      scope: 'global',
      status: 'available',
      configPath: this.resolvePromptRegistryConfigFallbackPath(prompt),
      fingerprint: prompt.fingerprint,
      revision: prompt.revision,
    });

    return chain;
  }

  private mergePromptRegistrySourceChain(
    first: PromptRegistrySourceChainEntry,
    rest: PromptRegistrySourceChainEntry[] | undefined
  ): PromptRegistrySourceChainEntry[] {
    const seen = new Set<string>();
    const chain: PromptRegistrySourceChainEntry[] = [];
    for (const entry of [first, ...(rest ?? [])]) {
      const key = [
        entry.source,
        entry.scope,
        entry.workspaceId ?? 'global',
        entry.revision ?? '',
        entry.fingerprint ?? '',
      ].join(':');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      chain.push(entry);
    }
    return chain;
  }

  private resolvePromptRegistryConfigFallbackPath(prompt: PromptCatalogItem) {
    if (prompt.source === 'registry') {
      return 'ai_prompts_metadata';
    }
    if (prompt.overrideApplied) {
      return 'copilot.prompts.overrides';
    }
    if (prompt.defaultPolicy) {
      return `copilot.prompts.defaults.${prompt.defaultPolicy}`;
    }
    return prompt.source === 'built_in' ? 'native_prompt_catalog' : 'compat';
  }

  private buildPromptRegistrySourceChainFingerprint(
    chain: PromptRegistrySourceChainEntry[]
  ) {
    return this.hashCatalogPayload({
      version: 'prompt-registry-source-chain/v1',
      chain,
    });
  }

  private buildCatalogFingerprint(input: {
    modelStrategyFingerprint: string;
    templateFingerprint: string;
  }) {
    return this.hashCatalogPayload(input);
  }

  private buildCatalogModelStrategyFingerprint(
    prompt: Omit<
      PromptCatalogItem,
      | 'fingerprint'
      | 'modelStrategyFingerprint'
      | 'revision'
      | 'templateFingerprint'
      | 'versionEvidence'
    >
  ) {
    return this.hashCatalogPayload({
      action: prompt.action ?? null,
      category: prompt.category,
      defaultPolicy: prompt.defaultPolicy ?? null,
      model: prompt.model,
      modelConfigPath: prompt.modelConfigPath ?? null,
      modelSource: prompt.modelSource,
      name: prompt.name,
      optionalModels: prompt.optionalModels,
      optionalModelsConfigPath: prompt.optionalModelsConfigPath ?? null,
      optionalModelsSource: prompt.optionalModelsSource,
      overrideApplied: prompt.overrideApplied,
      paramKeys: prompt.paramKeys,
      proModelCount: prompt.proModelCount,
      proModelsConfigPath: prompt.proModelsConfigPath ?? null,
      proModelsSource: prompt.proModelsSource,
      registryFingerprint: prompt.registryFingerprint ?? null,
      registryId: prompt.registryId ?? null,
      registryMessageCount: prompt.registryMessageCount ?? null,
      registryModified: prompt.registryModified ?? null,
      registryUpdatedAt: prompt.registryUpdatedAt?.toISOString() ?? null,
      registryValidationBlockingCount:
        prompt.registryValidationBlockingCount ?? null,
      registryValidationDetail: prompt.registryValidationDetail ?? null,
      registryValidationErrorCount: prompt.registryValidationErrorCount ?? null,
      registryValidationIssueCount: prompt.registryValidationIssueCount ?? null,
      registryValidationIssues: prompt.registryValidationIssues ?? null,
      registryValidationPublishStatus:
        prompt.registryValidationPublishStatus ?? null,
      registryValidationRemediations:
        prompt.registryValidationRemediations ?? null,
      registryValidationReason: prompt.registryValidationReason ?? null,
      registryValidationStatus: prompt.registryValidationStatus ?? null,
      registryRecordSource: prompt.registryRecordSource ?? null,
      registryRevision: prompt.registryRevision ?? null,
      registryRevisionActorId: prompt.registryRevisionActorId ?? null,
      registryRevisionFingerprint: prompt.registryRevisionFingerprint ?? null,
      registryRevisionId: prompt.registryRevisionId ?? null,
      registryRevisionScope: prompt.registryRevisionScope ?? null,
      registryRevisionStatus: prompt.registryRevisionStatus ?? null,
      registryRevisionWorkspaceId: prompt.registryRevisionWorkspaceId ?? null,
      registrySourceChain: prompt.registrySourceChain ?? null,
      registrySourceChainFingerprint:
        prompt.registrySourceChainFingerprint ?? null,
      source: prompt.source,
    });
  }

  private buildCatalogTemplateFingerprint(prompt: ResolvedPrompt) {
    return this.hashCatalogPayload({
      messages: this.getPromptTemplateFingerprintMessages(prompt),
      name: prompt.name,
      paramKeys: prompt.paramKeys,
      source: prompt.source,
    });
  }

  private getPromptTemplateFingerprintMessages(prompt: ResolvedPrompt) {
    if (prompt.source !== 'built_in') {
      return this.requireTemplateMessages(prompt).map(message => ({
        content: message.content,
        params: message.params ?? null,
        responseFormat: message.responseFormat ?? null,
        role: message.role,
      }));
    }

    const spec = this.lookupBuiltInPromptSpec(prompt.name);
    return (spec?.messages ?? []).map(message => ({
      role: message.role,
      template: message.template,
    }));
  }

  private hashCatalogPayload(value: unknown) {
    const payload = this.stableStringify(value);
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  private buildCatalogRevision(
    prompt: Omit<
      PromptCatalogItem,
      | 'fingerprint'
      | 'modelStrategyFingerprint'
      | 'revision'
      | 'templateFingerprint'
      | 'versionEvidence'
    >,
    fingerprint: string
  ) {
    return [
      prompt.source,
      prompt.defaultPolicy ?? 'no-policy',
      prompt.overrideApplied ? 'override' : 'base',
      fingerprint,
    ].join(':');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map(item => this.stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, item]) =>
            `${JSON.stringify(key)}:${this.stableStringify(item)}`
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private applyConfiguredOverride(prompt: ResolvedPrompt): ResolvedPrompt {
    const withDefaults = this.applyPromptDefaults(prompt);
    return this.applyPromptOverride(withDefaults);
  }

  private applyPromptDefaults(prompt: ResolvedPrompt): ResolvedPrompt {
    const defaultPolicy = this.resolvePromptDefaultPolicy(prompt);
    if (!defaultPolicy) {
      return prompt;
    }

    return {
      ...prompt,
      defaultPolicy: defaultPolicy.name,
      model: defaultPolicy.policy.model ?? prompt.model,
      modelConfigPath: defaultPolicy.policy.model
        ? this.promptDefaultConfigPath(defaultPolicy.name, 'model')
        : prompt.modelConfigPath,
      modelSource: defaultPolicy.policy.model
        ? 'default_policy'
        : prompt.modelSource,
      optionalModels: defaultPolicy.policy.optionalModels
        ? [...defaultPolicy.policy.optionalModels]
        : prompt.optionalModels,
      optionalModelsConfigPath: defaultPolicy.policy.optionalModels
        ? this.promptDefaultConfigPath(defaultPolicy.name, 'optionalModels')
        : prompt.optionalModelsConfigPath,
      optionalModelsSource: defaultPolicy.policy.optionalModels
        ? 'default_policy'
        : prompt.optionalModelsSource,
      config: defaultPolicy.policy.proModels
        ? this.mergePromptConfig(prompt.config, {
            proModels: [...defaultPolicy.policy.proModels],
          })
        : prompt.config,
      proModelsConfigPath: defaultPolicy.policy.proModels
        ? this.promptDefaultConfigPath(defaultPolicy.name, 'proModels')
        : prompt.proModelsConfigPath,
      proModelsSource: defaultPolicy.policy.proModels
        ? 'default_policy'
        : prompt.proModelsSource,
    };
  }

  private resolvePromptDefaultPolicy(
    prompt: ResolvedPrompt
  ): PromptDefaultPolicyResult | undefined {
    const defaults = this.config.copilot.prompts.defaults;

    const imagePolicy = defaults.image;
    if (
      this.hasPromptDefaultPayload(imagePolicy) &&
      this.matchesPromptDefaultScope(prompt, imagePolicy) &&
      isImagePromptCategory(prompt)
    ) {
      return { name: 'image', policy: imagePolicy };
    }

    const transcriptPolicy = defaults.transcript;
    if (
      this.hasPromptDefaultPayload(transcriptPolicy) &&
      this.matchesPromptDefaultScope(prompt, transcriptPolicy) &&
      isTranscriptPromptCategory(prompt)
    ) {
      return { name: 'transcript', policy: transcriptPolicy };
    }

    const structuredPolicy = defaults.structured;
    if (
      this.hasPromptDefaultPayload(structuredPolicy) &&
      this.matchesPromptDefaultScope(prompt, structuredPolicy) &&
      this.isStructuredPromptDefaultCandidate(prompt, structuredPolicy)
    ) {
      return { name: 'structured', policy: structuredPolicy };
    }

    const textPolicy = defaults.text;
    if (
      this.hasPromptDefaultPayload(textPolicy) &&
      this.matchesPromptDefaultScope(prompt, textPolicy) &&
      this.isTextPromptDefaultCandidate(prompt)
    ) {
      return { name: 'text', policy: textPolicy };
    }
  }

  private applyPromptOverride(prompt: ResolvedPrompt): ResolvedPrompt {
    const override = this.findConfiguredOverride(prompt.name);
    if (!override) return prompt;
    const overridesProModels = this.promptOverrideTouchesProModels(
      override.config
    );

    return {
      ...prompt,
      model: override.model ?? prompt.model,
      modelConfigPath: override.model
        ? this.promptOverrideConfigPath('model')
        : prompt.modelConfigPath,
      modelSource: override.model ? 'override' : prompt.modelSource,
      optionalModels: override.optionalModels
        ? [...override.optionalModels]
        : prompt.optionalModels,
      optionalModelsConfigPath: override.optionalModels
        ? this.promptOverrideConfigPath('optionalModels')
        : prompt.optionalModelsConfigPath,
      optionalModelsSource: override.optionalModels
        ? 'override'
        : prompt.optionalModelsSource,
      config: this.mergePromptConfig(prompt.config, override.config),
      proModelsConfigPath: overridesProModels
        ? this.promptOverrideConfigPath(
            override.config === null ? 'config' : 'config.proModels'
          )
        : prompt.proModelsConfigPath,
      proModelsSource: overridesProModels ? 'override' : prompt.proModelsSource,
      overrideApplied: true,
    };
  }

  private promptDefaultConfigPath(
    policy: NonNullable<ResolvedPrompt['defaultPolicy']>,
    field: 'model' | 'optionalModels' | 'proModels'
  ) {
    return `copilot.prompts.defaults.${policy}.${field}`;
  }

  private promptOverrideConfigPath(
    field: 'model' | 'optionalModels' | 'config' | 'config.proModels'
  ) {
    return `copilot.prompts.overrides[].${field}`;
  }

  private promptOverrideTouchesProModels(
    config: CopilotPromptOverride['config']
  ) {
    return config === null || !!(config && 'proModels' in config);
  }

  private resolvePromptCategory(
    prompt: Pick<ResolvedPrompt, 'action' | 'config' | 'model' | 'name'>
  ): ResolvedPrompt['category'] {
    if (isImagePromptCategory(prompt)) {
      return 'image';
    }

    if (isTranscriptPromptCategory(prompt)) {
      return 'transcript';
    }

    return 'text';
  }

  private hasPromptDefaultPayload(
    defaultPolicy: CopilotPromptModelDefault | undefined
  ) {
    if (!defaultPolicy || defaultPolicy.enabled === false) {
      return false;
    }

    return !!(
      defaultPolicy.model ||
      defaultPolicy.optionalModels ||
      defaultPolicy.proModels
    );
  }

  private matchesPromptDefaultScope(
    prompt: ResolvedPrompt,
    defaultPolicy: CopilotPromptModelDefault
  ) {
    if (
      defaultPolicy.includeNames?.length &&
      !defaultPolicy.includeNames.includes(prompt.name)
    ) {
      return false;
    }

    if (defaultPolicy.excludeNames?.includes(prompt.name)) {
      return false;
    }

    const action = prompt.action;
    if (
      defaultPolicy.includeActions?.length &&
      (!action || !defaultPolicy.includeActions.includes(action))
    ) {
      return false;
    }

    if (action && defaultPolicy.excludeActions?.includes(action)) {
      return false;
    }

    return true;
  }

  private isStructuredPromptDefaultCandidate(
    prompt: ResolvedPrompt,
    defaultPolicy: CopilotPromptModelDefault
  ) {
    return !!(
      defaultPolicy.includeNames?.includes(prompt.name) ||
      (prompt.action && defaultPolicy.includeActions?.includes(prompt.action))
    );
  }

  private isTextPromptDefaultCandidate(prompt: ResolvedPrompt) {
    if (isImagePromptCategory(prompt) || isTranscriptPromptCategory(prompt)) {
      return false;
    }

    if (prompt.config?.requireAttachment && !prompt.config.requireContent) {
      return false;
    }

    return true;
  }

  private findConfiguredOverride(name: string): CopilotPromptOverride | null {
    return (
      this.config.copilot.prompts.overrides.find(
        override => override.enabled !== false && override.name === name
      ) ?? null
    );
  }

  private mergePromptConfig(
    base: PromptConfig | undefined,
    override: PromptConfig | undefined
  ): PromptConfig | undefined {
    if (override === undefined) {
      return base ? structuredClone(base) : undefined;
    }

    if (override === null) {
      return undefined;
    }

    return {
      ...(base ? structuredClone(base) : {}),
      ...structuredClone(override),
    };
  }

  private normalizePromptSpecParams(
    params?: PromptSpec['params']
  ): PromptParams {
    if (!params) return {};

    return Object.fromEntries(
      Object.entries(params).map(([key, value]) => {
        if (value.enum?.length) {
          const normalized = value.default
            ? [
                value.default,
                ...value.enum.filter(option => option !== value.default),
              ]
            : [...value.enum];
          return [key, normalized];
        }

        return [key, value.default ?? ''];
      })
    );
  }

  private countCompatPromptTokens(prompt: ResolvedPrompt): number {
    return countPromptTokensNative({
      model: prompt.model,
      messages: this.requireTemplateMessages(prompt).map(message => ({
        content: message.content,
      })),
    }).tokens;
  }

  private requireTemplateMessages(prompt: ResolvedPrompt): PromptMessage[] {
    if (prompt.source !== 'built_in' && prompt.messages) {
      return this.cloneMessages(prompt.messages);
    }

    throw new Error(`Prompt ${prompt.name} does not expose template messages`);
  }

  private logWarnings(warnings: string[], sessionId?: string) {
    if (!sessionId) {
      return;
    }

    for (const warning of warnings) {
      this.logger.warn(`${warning} in session ${sessionId}`);
    }
  }
}
