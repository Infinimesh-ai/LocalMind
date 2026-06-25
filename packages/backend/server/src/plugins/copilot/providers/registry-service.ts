import { Injectable } from '@nestjs/common';

import { Config } from '../../../base';
import { Models } from '../../../models';
import {
  applyModelRegistryRevisions,
  applyProviderHealthStates,
  applyProviderRegistryRevisions,
  buildProviderRegistry,
  type CopilotProviderRegistry,
  type CopilotProvidersConfigInput,
  type NormalizedCopilotProviderProfile,
} from './provider-registry';

@Injectable()
export class CopilotProviderRegistryService {
  private lastConfig?: CopilotProvidersConfigInput;
  private lastRegistry?: CopilotProviderRegistry;

  constructor(
    private readonly config: Config,
    private readonly models: Models
  ) {}

  getRegistry(): CopilotProviderRegistry {
    const providerConfig = this.config.copilot.providers;
    if (this.lastConfig === providerConfig && this.lastRegistry) {
      return this.lastRegistry;
    }

    const registry = buildProviderRegistry(providerConfig);
    this.lastConfig = providerConfig;
    this.lastRegistry = registry;
    return registry;
  }

  getProviderProfile(
    providerId: string
  ): NormalizedCopilotProviderProfile | null {
    return this.getRegistry().profiles.get(providerId) ?? null;
  }

  async getRegistryWithModelRevisions(
    workspaceId?: string | null
  ): Promise<CopilotProviderRegistry> {
    const baseRegistry = this.getRegistry();
    const providerRevisions =
      await this.models.copilotProviderRegistryRevision.listLatestActiveWithPublishEventsByProviderIds(
        {
          providerIds: baseRegistry.order,
          workspaceId,
        }
      );
    const providerRegistry = applyProviderRegistryRevisions(
      baseRegistry,
      providerRevisions
    );
    const providerHealthStates =
      await this.models.copilotProviderHealthState.listLatestActiveByProviderIds(
        {
          providerIds: providerRegistry.order,
          workspaceId,
        }
      );
    const healthyProviderRegistry = applyProviderHealthStates(
      providerRegistry,
      providerHealthStates
    );
    const modelRevisions =
      await this.models.copilotModelRegistryRevision.listLatestActiveWithPublishEventsByProviderIds(
        {
          providerIds: healthyProviderRegistry.order,
          workspaceId,
        }
      );

    return applyModelRegistryRevisions(healthyProviderRegistry, modelRevisions);
  }
}
