import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { set } from 'lodash-es';

import {
  ConfigFactory,
  EventBus,
  InvalidAppConfig,
  InvalidAppConfigInput,
  OnEvent,
} from '../../base';
import { Models } from '../../models';
import { ServerFeature } from './types';

declare global {
  interface Events {
    'config.init': {
      config: DeepReadonly<AppConfig>;
    };
    'config.changed': {
      updates: DeepPartial<AppConfig>;
    };
    'config.changed.broadcast': {
      updates: DeepPartial<AppConfig>;
    };
  }
}

export const APP_CONFIG_SECRET_REDACTED =
  '__LOCALMIND_SECRET_REDACTED__' as const;

type AppConfigUpdate = { module: string; key: string; value: any };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class ServerService implements OnApplicationBootstrap {
  private _initialized: boolean | null = null;
  readonly #features = new Set<ServerFeature>();
  readonly #logger = new Logger(ServerService.name);

  constructor(
    private readonly models: Models,
    private readonly configFactory: ConfigFactory,
    private readonly event: EventBus
  ) {}

  async onApplicationBootstrap() {
    await this.setup();
  }

  get features() {
    return Array.from(this.#features);
  }

  async initialized() {
    if (!this._initialized) {
      const userCount = await this.models.user.count();
      this._initialized = userCount > 0;
    }

    return this._initialized;
  }

  enableFeature(feature: ServerFeature) {
    this.#features.add(feature);
  }

  disableFeature(feature: ServerFeature) {
    this.#features.delete(feature);
  }

  getConfig() {
    return this.configFactory.clone();
  }

  getAdminConfig() {
    return this.redactConfig(this.getConfig());
  }

  redactConfig<T extends DeepPartial<AppConfig>>(config: T): T {
    const redacted = structuredClone(config);
    if (!isRecord(redacted)) {
      return redacted;
    }

    const redactedRecord = redacted as Record<string, unknown>;
    const copilot = redactedRecord['copilot'];
    if (!isRecord(copilot)) {
      return redacted;
    }

    const copilotRecord = copilot as Record<string, unknown>;
    const providers = copilotRecord['providers'];
    if (!isRecord(providers)) {
      return redacted;
    }

    const providersRecord = providers as Record<string, unknown>;
    const profiles = providersRecord['profiles'];
    if (!Array.isArray(profiles)) {
      return redacted;
    }

    providersRecord['profiles'] = profiles.map(profile => {
      if (!isRecord(profile)) {
        return profile;
      }
      const profileRecord = profile as Record<string, unknown>;
      const profileConfig = profileRecord['config'];
      if (!isRecord(profileConfig)) {
        return profile;
      }
      if (typeof profileConfig['apiKey'] !== 'string') {
        return profile;
      }
      return {
        ...profile,
        config: {
          ...profileConfig,
          apiKey: APP_CONFIG_SECRET_REDACTED,
        },
      };
    });
    return redacted;
  }

  validateConfig(updates: AppConfigUpdate[]) {
    const prepared = this.prepareConfigUpdates(updates);
    return prepared.errors ?? this.configFactory.validate(prepared.updates);
  }

  async updateConfig(
    user: string,
    updates: AppConfigUpdate[]
  ): Promise<DeepPartial<AppConfig>> {
    const prepared = this.prepareConfigUpdates(updates);
    const errors =
      prepared.errors ?? this.configFactory.validate(prepared.updates);

    if (errors?.length) {
      throw new InvalidAppConfigInput({
        message: errors.map(error => error.message).join('\n'),
      });
    }

    const promises = await this.models.appConfig.save(
      user,
      prepared.updates.map(update => ({
        key: `${update.module}.${update.key}`,
        value: update.value,
      }))
    );

    const overrides: DeepPartial<AppConfig> = {};
    // only take successfully saved configs
    promises.forEach(promise => {
      if (promise.status === 'fulfilled') {
        set(overrides, promise.value.id, promise.value.value);
      } else {
        this.#logger.error(`Failed to save app config`, promise.reason);
      }
    });
    this.configFactory.override(overrides);
    await this.event.emitAsync('config.changed', { updates: overrides });
    this.event.broadcast('config.changed.broadcast', { updates: overrides });
    return overrides;
  }

  private prepareConfigUpdates(updates: AppConfigUpdate[]): {
    updates: AppConfigUpdate[];
    errors: InvalidAppConfig[] | null;
  } {
    const currentProfiles = this.configFactory.clone().copilot.providers
      .profiles as unknown;
    const currentById = new Map(
      Array.isArray(currentProfiles)
        ? currentProfiles
            .filter(
              (profile): profile is Record<string, unknown> =>
                isRecord(profile) && typeof profile.id === 'string'
            )
            .map(profile => [profile.id as string, profile])
        : []
    );
    const errors: InvalidAppConfig[] = [];

    const prepared = updates.map(update => {
      if (
        update.module !== 'copilot' ||
        update.key !== 'providers.profiles' ||
        !Array.isArray(update.value)
      ) {
        return update;
      }

      const value = update.value.map((profile: unknown) => {
        if (!isRecord(profile) || !isRecord(profile.config)) {
          return profile;
        }
        if (profile.config.apiKey !== APP_CONFIG_SECRET_REDACTED) {
          return profile;
        }

        const current =
          typeof profile.id === 'string' ? currentById.get(profile.id) : null;
        const currentConfig = current?.config;
        const apiKey = isRecord(currentConfig) ? currentConfig.apiKey : null;
        if (typeof apiKey !== 'string') {
          errors.push(
            new InvalidAppConfig({
              module: update.module,
              key: update.key,
              hint: 'A redacted Provider Profile API key can only preserve an existing profile secret.',
            })
          );
          return profile;
        }
        return {
          ...profile,
          config: {
            ...profile.config,
            apiKey,
          },
        };
      });

      return { ...update, value };
    });

    return { updates: prepared, errors: errors.length ? errors : null };
  }

  @OnEvent('config.changed.broadcast')
  onConfigChangedBroadcast(event: Events['config.changed.broadcast']) {
    this.configFactory.override(event.updates);
    this.event.emit('config.changed', event);
  }

  @OnEvent('config.changed')
  onConfigChanged(event: Events['config.changed']) {
    if ('flags' in event.updates) {
      this.onFlagsChanged();
    }
  }

  async revalidateConfig() {
    const overrides = await this.loadDbOverrides();
    this.configFactory.override(overrides);
    this.event.emit('config.changed', { updates: overrides });
  }

  private async setup() {
    const overrides = await this.loadDbOverrides();
    this.configFactory.override(overrides);
    await this.event.emitAsync('config.init', {
      config: this.getConfig(),
    });
    this.onFlagsChanged();
  }

  private async loadDbOverrides() {
    const configs = await this.models.appConfig.load([
      'auth.session.signingKeys',
    ]);
    const overrides: DeepPartial<AppConfig> = {};

    configs.forEach(config => {
      set(overrides, config.id, config.value);
    });

    return overrides;
  }

  private onFlagsChanged() {
    const flags = this.configFactory.config.flags;
    if (flags.allowGuestDemoWorkspace) {
      this.enableFeature(ServerFeature.LocalWorkspace);
    } else {
      this.disableFeature(ServerFeature.LocalWorkspace);
    }
  }
}
