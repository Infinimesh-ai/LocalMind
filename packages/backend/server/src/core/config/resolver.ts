import { Logger } from '@nestjs/common';
import {
  Args,
  Field,
  GraphQLISODateTime,
  InputType,
  Mutation,
  ObjectType,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { GraphQLJSON, GraphQLJSONObject } from 'graphql-scalars';

import { Config, hasNewerVersion, URLHelper } from '../../base';
import { Namespace } from '../../env';
import { Feature } from '../../models';
import { CurrentUser, Public } from '../auth';
import { Admin } from '../common';
import { AvailableUserFeatureConfig } from '../features';
import { ServerService } from './service';
import { ServerConfigType } from './types';

@ObjectType()
export class PasswordLimitsType {
  @Field()
  minLength!: number;
  @Field()
  maxLength!: number;
}

@ObjectType()
export class CredentialsRequirementType {
  @Field()
  password!: PasswordLimitsType;
}

@ObjectType()
export class ReleaseVersionType {
  @Field()
  version!: string;

  @Field()
  url!: string;

  @Field(() => GraphQLISODateTime)
  publishedAt!: Date;

  @Field()
  changelog!: string;
}

const RELEASE_CHANNEL_MAP = new Map<Namespace, string>([
  [Namespace.Dev, 'canary'],
  [Namespace.Beta, 'beta'],
  [Namespace.Production, 'stable'],
]);

const LOCALMIND_RELEASES_URL =
  'https://api.github.com/repos/Infinimesh-ai/LocalMind/releases?per_page=100';

interface LocalMindRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}

function matchesReleaseChannel(release: LocalMindRelease, channel: string) {
  if (release.draft) {
    return false;
  }

  if (channel === 'stable') {
    return !release.prerelease;
  }

  return (
    release.prerelease &&
    new RegExp(`-${channel}(?:\\.|-|$)`, 'i').test(release.tag_name)
  );
}

@Resolver(() => ServerConfigType)
export class ServerConfigResolver {
  private readonly logger = new Logger(ServerConfigResolver.name);

  constructor(
    private readonly config: Config,
    private readonly url: URLHelper,
    private readonly server: ServerService
  ) {}

  @Public()
  @Query(() => ServerConfigType, {
    description: 'server config',
  })
  serverConfig(): ServerConfigType {
    return {
      name:
        this.config.server.name ??
        (env.selfhosted
          ? 'LocalMind Self-hosted'
          : env.namespaces.canary
            ? 'LocalMind Canary Cloud'
            : env.namespaces.beta
              ? 'LocalMind Beta Cloud'
              : 'LocalMind Cloud'),
      version: env.version,
      baseUrl: this.url.requestBaseUrl,
      type: env.DEPLOYMENT_TYPE,
      features: this.server.features,
    };
  }

  @ResolveField(() => CredentialsRequirementType, {
    description: 'credentials requirement',
  })
  async credentialsRequirement() {
    return {
      password: {
        minLength: this.config.auth.passwordRequirements.min,
        maxLength: this.config.auth.passwordRequirements.max,
      },
    };
  }

  @ResolveField(() => Boolean, {
    description: 'whether server has been initialized',
  })
  async initialized() {
    return this.server.initialized();
  }

  @ResolveField(() => ReleaseVersionType, {
    nullable: true,
    description: 'fetch latest available upgradable release of server',
  })
  async availableUpgrade(): Promise<ReleaseVersionType | null> {
    if (!env.selfhosted) {
      return null;
    }

    const channel = RELEASE_CHANNEL_MAP.get(env.NAMESPACE) ?? 'stable';

    try {
      const response = await fetch(LOCALMIND_RELEASES_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          'User-Agent': 'LocalMind Server',
        },
      });

      if (!response.ok) {
        this.logger.error(
          'failed to fetch LocalMind releases',
          await response.text()
        );
        return null;
      }
      const releases = (await response.json()) as LocalMindRelease[];

      const latest = releases.find(release =>
        matchesReleaseChannel(release, channel)
      );
      if (!latest || !hasNewerVersion(env.version, latest.tag_name)) {
        return null;
      }

      return {
        version: latest.tag_name,
        url: latest.html_url,
        changelog: latest.body ?? '',
        publishedAt: new Date(latest.published_at),
      };
    } catch (e) {
      this.logger.error('failed to fetch LocalMind releases', e);
      return null;
    }
  }
}

@Resolver(() => ServerConfigType)
export class ServerFeatureConfigResolver extends AvailableUserFeatureConfig {
  @ResolveField(() => [Feature], {
    description: 'Features for user that can be configured',
  })
  override availableUserFeatures() {
    return super.availableUserFeatures();
  }
}

@InputType()
class UpdateAppConfigInput {
  @Field()
  module!: string;

  @Field()
  key!: string;

  @Field(() => GraphQLJSON)
  value!: any;
}

@ObjectType()
class AppConfigValidateResult {
  @Field()
  module!: string;

  @Field()
  key!: string;

  @Field(() => GraphQLJSON)
  value!: any;

  @Field()
  valid!: boolean;

  @Field(() => String, { nullable: true })
  error?: string;
}

@Admin()
@Resolver(() => GraphQLJSONObject)
export class AppConfigResolver {
  constructor(private readonly service: ServerService) {}

  @Query(() => GraphQLJSONObject, {
    description: 'get the whole app configuration',
  })
  appConfig() {
    return this.service.getAdminConfig();
  }

  @Mutation(() => GraphQLJSONObject, {
    description: 'update app configuration',
  })
  async updateAppConfig(
    @CurrentUser() me: CurrentUser,
    @Args('updates', { type: () => [UpdateAppConfigInput] })
    updates: UpdateAppConfigInput[]
  ): Promise<DeepPartial<AppConfig>> {
    return this.service.redactConfig(
      await this.service.updateConfig(me.id, updates)
    );
  }

  @Query(() => [AppConfigValidateResult], {
    description: 'validate app configuration',
  })
  async validateAppConfig(
    @Args('updates', { type: () => [UpdateAppConfigInput] })
    updates: UpdateAppConfigInput[]
  ): Promise<AppConfigValidateResult[]> {
    return this.validateConfigInternal(updates);
  }

  private validateConfigInternal(
    updates: UpdateAppConfigInput[]
  ): AppConfigValidateResult[] {
    const errors = this.service.validateConfig(updates);

    return updates.map(update => {
      const error = errors?.find(
        error =>
          error.data.module === update.module && error.data.key === update.key
      );
      return {
        module: update.module,
        key: update.key,
        value: update.value,
        valid: !error,
        error: error?.data.hint,
      };
    });
  }
}
