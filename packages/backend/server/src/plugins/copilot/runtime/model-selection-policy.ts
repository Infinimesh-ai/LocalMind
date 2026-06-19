import { Injectable } from '@nestjs/common';

import { CopilotSessionInvalidInput } from '../../../base';
import { llmResolveRequestedModelMatch } from '../../../native';
import type { CopilotProviderRoutePolicyFeatureKind } from '../config';
import { applyProviderRoutePolicy } from '../providers/provider-registry';
import { CopilotProviderRegistryService } from '../providers/registry-service';

type RouteContext = {
  workspaceId?: string;
  featureKind?: CopilotProviderRoutePolicyFeatureKind;
};

export type ResolveModelInput = {
  defaultModel: string;
  optionalModels?: string[] | null;
  requestedModelId?: string;
  extraModels?: string[] | null;
  routeContext?: RouteContext | null;
  providerIds?: string[] | null;
};

@Injectable()
export class ModelSelectionPolicy {
  constructor(private readonly registries: CopilotProviderRegistryService) {}

  private getRegistry() {
    return this.registries.getRegistry();
  }

  private getScopedProviderIds(
    routeContext: RouteContext = {},
    providerIds?: string[] | null
  ) {
    if (providerIds) {
      return Array.from(new Set(providerIds.filter(Boolean)));
    }

    const registry = this.getRegistry();
    return applyProviderRoutePolicy(
      registry,
      registry.profiles.keys(),
      routeContext
    );
  }

  private matchRequestedModel(
    optionalModels: string[],
    requestedModelId?: string,
    defaultModel?: string,
    routeContext: RouteContext = {},
    providerIds?: string[] | null
  ) {
    return llmResolveRequestedModelMatch({
      providerIds: this.getScopedProviderIds(routeContext, providerIds),
      optionalModels,
      requestedModelId,
      defaultModel,
    });
  }

  mergeAvailableModels(...modelLists: Array<string[] | null | undefined>) {
    return Array.from(
      new Set(modelLists.flatMap(models => models ?? []).filter(Boolean))
    );
  }

  resolveRequestedModel(input: ResolveModelInput): {
    selectedModel: string;
    matchedOptionalModel: boolean;
  } {
    if (!input.defaultModel) {
      throw new CopilotSessionInvalidInput('Model is required');
    }
    const optionalModels = this.mergeAvailableModels(
      input.optionalModels,
      input.extraModels
    );
    const matched = this.matchRequestedModel(
      optionalModels,
      input.requestedModelId,
      input.defaultModel,
      input.routeContext ?? {},
      input.providerIds
    );
    return {
      selectedModel: matched.selectedModel ?? input.defaultModel,
      matchedOptionalModel: matched.matchedOptionalModel,
    };
  }

  matchesModelList(
    models: string[],
    modelId?: string,
    routeContext: RouteContext = {},
    providerIds?: string[] | null
  ) {
    return this.matchRequestedModel(
      models,
      modelId,
      undefined,
      routeContext,
      providerIds
    ).matchedOptionalModel;
  }
}
