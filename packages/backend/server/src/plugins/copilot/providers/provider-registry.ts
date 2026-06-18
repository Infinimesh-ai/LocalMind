import type {
  CopilotModelDefinition,
  CopilotProviderConfigMap,
  CopilotProviderDefaults,
  CopilotProviderPrivacy,
  CopilotProviderProfile,
  CopilotProviderProfileSource,
  CopilotProviderRoutePolicy,
  CopilotProviderRoutePolicyFeatureKind,
  CopilotProviderRoutePolicyRule,
  ProviderMiddlewareConfig,
} from '../config';
import { resolveProviderMiddleware } from './provider-middleware';
import { CopilotProviderType, ModelOutputType } from './types';

const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9-_]+$/;

const LEGACY_PROVIDER_ORDER: CopilotProviderType[] = [
  CopilotProviderType.OpenAI,
  CopilotProviderType.OpenAICompatible,
  CopilotProviderType.CloudflareWorkersAi,
  CopilotProviderType.FAL,
  CopilotProviderType.Gemini,
  CopilotProviderType.GeminiVertex,
  CopilotProviderType.Anthropic,
  CopilotProviderType.AnthropicVertex,
];

const LEGACY_PROVIDER_PRIORITY = LEGACY_PROVIDER_ORDER.reduce(
  (acc, type, index) => {
    acc[type] = LEGACY_PROVIDER_ORDER.length - index;
    return acc;
  },
  {} as Record<CopilotProviderType, number>
);

type LegacyProvidersConfig = Partial<
  Record<CopilotProviderType, CopilotProviderConfigMap[CopilotProviderType]>
>;

export type CopilotProvidersConfigInput = LegacyProvidersConfig & {
  profiles?: CopilotProviderProfile[] | null;
  defaults?: CopilotProviderDefaults | null;
  routePolicy?: CopilotProviderRoutePolicy | null;
};

export type NormalizedCopilotProviderProfile = Omit<
  CopilotProviderProfile,
  'enabled' | 'priority' | 'privacy' | 'source' | 'middleware'
> & {
  enabled: boolean;
  priority: number;
  privacy: CopilotProviderPrivacy;
  source: CopilotProviderProfileSource;
  middleware: ProviderMiddlewareConfig;
  modelDefinitions: CopilotModelDefinition[];
};

export type CopilotProviderRegistry = {
  profiles: Map<string, NormalizedCopilotProviderProfile>;
  defaults: CopilotProviderDefaults;
  routePolicy: CopilotProviderRoutePolicy;
  order: string[];
  byType: Map<CopilotProviderType, string[]>;
};

export type ResolveModelResult = {
  rawModelId?: string;
  modelId?: string;
  explicitProviderId?: string;
  candidateProviderIds: string[];
};

type ResolveModelOptions = {
  registry: CopilotProviderRegistry;
  modelId?: string;
  outputType?: ModelOutputType;
  availableProviderIds?: Iterable<string>;
  preferredProviderIds?: Iterable<string>;
  routePolicyContext?: CopilotProviderRoutePolicyContext;
};

export type CopilotProviderRoutePolicyContext = {
  workspaceId?: string;
  featureKind?: string;
};

export type CopilotProviderRoutePolicySummary = {
  enabled: boolean;
  featureKind?: CopilotProviderRoutePolicyFeatureKind;
  workspaceId?: string;
  allowedProviderIds?: string[];
  blockedProviderIds?: string[];
  allowedPrivacy?: CopilotProviderPrivacy[];
  preferredPrivacy?: CopilotProviderPrivacy[];
};

export type CopilotProviderRoutePolicyCandidateDiagnostics = {
  providerId: string;
  providerName?: string;
  providerConfiguredModelIds?: string[];
  providerConfiguredModelCount?: number;
  providerProfileId?: string;
  providerProfileSource?: CopilotProviderProfileSource;
  providerProfileConfigPath?: string;
  providerSource: CopilotProviderProfileSource;
  providerType: CopilotProviderType;
  providerPriority: number;
  privacy: CopilotProviderPrivacy;
  health: string;
  healthCheckedAt?: string;
  available: boolean;
  allowed: boolean;
  reasons: string[];
};

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

function asArray<T>(iter?: Iterable<T>): T[] {
  return iter ? Array.from(iter) : [];
}

const DEFAULT_PROVIDER_PRIVACY: CopilotProviderPrivacy = 'cloud';
const ROUTE_POLICY_FEATURE_KINDS =
  new Set<CopilotProviderRoutePolicyFeatureKind>([
    'chat',
    'action',
    'image',
    'embedding',
    'workspace_indexing',
    'rerank',
    'transcript',
  ]);

function isRoutePolicyFeatureKind(
  featureKind?: string
): featureKind is CopilotProviderRoutePolicyFeatureKind {
  return (
    !!featureKind &&
    ROUTE_POLICY_FEATURE_KINDS.has(
      featureKind as CopilotProviderRoutePolicyFeatureKind
    )
  );
}

function intersectOptional<T>(left: T[] | undefined, right: T[] | undefined) {
  if (right === undefined) {
    return left;
  }
  if (left === undefined) {
    return unique(right);
  }

  const rightValues = new Set(right);
  return unique(left).filter(value => rightValues.has(value));
}

function unionOptional<T>(left: T[] | undefined, right: T[] | undefined) {
  if (left === undefined) {
    return right === undefined ? undefined : unique(right);
  }
  if (right === undefined) {
    return unique(left);
  }
  return unique([...left, ...right]);
}

export function providerProfileConfigPathHint(
  profile: Pick<NormalizedCopilotProviderProfile, 'id' | 'source' | 'type'>
) {
  if (profile.source === 'configured') {
    return `copilot.providers.profiles[id=${profile.id}]`;
  }
  if (profile.source === 'legacy') {
    return `copilot.providers.${profile.type}`;
  }
  if (profile.source === 'byok_local') {
    return 'workspace.byok.local';
  }
  if (profile.source === 'byok_server') {
    return 'workspace.byok.server';
  }
  return undefined;
}

export function getProfileModelIds(
  profile: Pick<NormalizedCopilotProviderProfile, 'modelDefinitions' | 'models'>
) {
  return unique([
    ...(profile.models ?? []),
    ...profile.modelDefinitions.flatMap(model => [
      model.id,
      ...(model.aliases ?? []),
    ]),
  ]);
}

function providerProfileMetadata(profile: NormalizedCopilotProviderProfile) {
  const providerConfiguredModelIds = getProfileModelIds(profile);
  const providerProfileConfigPath = providerProfileConfigPathHint(profile);

  return {
    providerProfileId: profile.id,
    providerProfileSource: profile.source,
    ...(providerProfileConfigPath ? { providerProfileConfigPath } : {}),
    ...(providerConfiguredModelIds.length
      ? {
          providerConfiguredModelIds,
          providerConfiguredModelCount: providerConfiguredModelIds.length,
        }
      : {}),
  };
}

function baseRoutePolicyRule(
  policy: CopilotProviderRoutePolicy
): CopilotProviderRoutePolicyRule {
  return {
    allowedProviderIds: policy.allowedProviderIds,
    blockedProviderIds: policy.blockedProviderIds,
    allowedPrivacy: policy.allowedPrivacy,
    preferredPrivacy: policy.preferredPrivacy,
  };
}

function resolveRoutePolicyRule(
  policy: CopilotProviderRoutePolicy,
  context: CopilotProviderRoutePolicyContext = {}
): CopilotProviderRoutePolicyRule {
  if (policy.enabled === false) {
    return {};
  }

  const featureRule = isRoutePolicyFeatureKind(context.featureKind)
    ? policy.byFeature?.[context.featureKind]
    : undefined;
  const workspaceRule = context.workspaceId
    ? policy.byWorkspace?.[context.workspaceId]
    : undefined;
  const rules = [baseRoutePolicyRule(policy), featureRule, workspaceRule];

  return {
    allowedProviderIds: rules.reduce(
      (allowed, rule) => intersectOptional(allowed, rule?.allowedProviderIds),
      undefined as string[] | undefined
    ),
    blockedProviderIds: rules.reduce(
      (blocked, rule) => unionOptional(blocked, rule?.blockedProviderIds),
      undefined as string[] | undefined
    ),
    allowedPrivacy: rules.reduce(
      (allowed, rule) => intersectOptional(allowed, rule?.allowedPrivacy),
      undefined as CopilotProviderPrivacy[] | undefined
    ),
    preferredPrivacy:
      workspaceRule?.preferredPrivacy ??
      featureRule?.preferredPrivacy ??
      policy.preferredPrivacy,
  };
}

export function describeProviderRoutePolicy(
  registry: CopilotProviderRegistry,
  context: CopilotProviderRoutePolicyContext = {}
): CopilotProviderRoutePolicySummary {
  const enabled = registry.routePolicy.enabled !== false;
  const rule = resolveRoutePolicyRule(registry.routePolicy, context);
  const featureKind = isRoutePolicyFeatureKind(context.featureKind)
    ? context.featureKind
    : undefined;

  return {
    enabled,
    ...(featureKind ? { featureKind } : {}),
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(rule.allowedProviderIds !== undefined
      ? { allowedProviderIds: rule.allowedProviderIds }
      : {}),
    ...(rule.blockedProviderIds !== undefined
      ? { blockedProviderIds: rule.blockedProviderIds }
      : {}),
    ...(rule.allowedPrivacy !== undefined
      ? { allowedPrivacy: rule.allowedPrivacy }
      : {}),
    ...(rule.preferredPrivacy !== undefined
      ? { preferredPrivacy: rule.preferredPrivacy }
      : {}),
  };
}

function profileAllowedByRoutePolicy(
  profile: NormalizedCopilotProviderProfile,
  providerId: string,
  policy: CopilotProviderRoutePolicyRule
) {
  if (policy.blockedProviderIds?.includes(providerId)) {
    return false;
  }
  if (
    policy.allowedProviderIds !== undefined &&
    !policy.allowedProviderIds.includes(providerId)
  ) {
    return false;
  }
  if (
    policy.allowedPrivacy !== undefined &&
    !policy.allowedPrivacy.includes(profile.privacy)
  ) {
    return false;
  }
  return true;
}

export function applyProviderRoutePolicy(
  registry: CopilotProviderRegistry,
  providerIds: Iterable<string>,
  context: CopilotProviderRoutePolicyContext = {}
) {
  const policy = resolveRoutePolicyRule(registry.routePolicy, context);
  const candidateIds = unique(asArray(providerIds)).filter(providerId => {
    const profile = registry.profiles.get(providerId);
    return profile
      ? profileAllowedByRoutePolicy(profile, providerId, policy)
      : false;
  });

  const preferredPrivacy = policy.preferredPrivacy;
  if (!preferredPrivacy?.length) {
    return candidateIds;
  }

  const originalIndex = new Map(
    candidateIds.map((providerId, index) => [providerId, index] as const)
  );
  const privacyIndex = new Map(
    preferredPrivacy.map((privacy, index) => [privacy, index] as const)
  );
  return candidateIds.toSorted((a, b) => {
    const privacyA =
      registry.profiles.get(a)?.privacy ?? DEFAULT_PROVIDER_PRIVACY;
    const privacyB =
      registry.profiles.get(b)?.privacy ?? DEFAULT_PROVIDER_PRIVACY;
    const privacyOrderA = privacyIndex.get(privacyA) ?? Number.MAX_SAFE_INTEGER;
    const privacyOrderB = privacyIndex.get(privacyB) ?? Number.MAX_SAFE_INTEGER;
    if (privacyOrderA !== privacyOrderB) {
      return privacyOrderA - privacyOrderB;
    }
    return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
  });
}

export function describeProviderRoutePolicyCandidates(
  registry: CopilotProviderRegistry,
  providerIds: Iterable<string>,
  context: CopilotProviderRoutePolicyContext = {},
  availableProviderIds?: Iterable<string>
): CopilotProviderRoutePolicyCandidateDiagnostics[] {
  const enabled = registry.routePolicy.enabled !== false;
  const policy = resolveRoutePolicyRule(registry.routePolicy, context);
  const available = availableProviderIds
    ? new Set(asArray(availableProviderIds))
    : undefined;
  const candidates = unique(asArray(providerIds)).filter(providerId =>
    registry.profiles.has(providerId)
  );
  const originalIndex = new Map(
    candidates.map((providerId, index) => [providerId, index] as const)
  );
  const allowedOrder = new Map(
    applyProviderRoutePolicy(
      registry,
      candidates.filter(providerId => {
        const profile = registry.profiles.get(providerId);
        if (!profile) {
          return false;
        }
        return available
          ? available.has(providerId)
          : isProviderRouteHealthy(profile);
      }),
      context
    ).map((providerId, index) => [providerId, index] as const)
  );

  return candidates
    .map(providerId => {
      const profile = registry.profiles.get(providerId);
      if (!profile) {
        return null;
      }

      const providerAvailable = available
        ? available.has(providerId)
        : isProviderRouteHealthy(profile);
      const policyAllowed = profileAllowedByRoutePolicy(
        profile,
        providerId,
        policy
      );
      const allowed = providerAvailable && policyAllowed;
      const reasons = [
        allowed ? 'candidate_allowed' : null,
        !enabled ? 'policy_disabled' : null,
        !providerAvailable ? 'provider_unavailable' : null,
        policy.blockedProviderIds?.includes(providerId)
          ? 'provider_blocked'
          : null,
        policy.allowedProviderIds !== undefined &&
        !policy.allowedProviderIds.includes(providerId)
          ? 'provider_not_allowed'
          : null,
        policy.allowedPrivacy !== undefined &&
        !policy.allowedPrivacy.includes(profile.privacy)
          ? 'privacy_not_allowed'
          : null,
        policy.preferredPrivacy?.length
          ? policy.preferredPrivacy.includes(profile.privacy)
            ? 'privacy_preferred'
            : 'privacy_not_preferred'
          : null,
      ].filter((reason): reason is string => !!reason);

      return {
        providerId,
        ...(profile.displayName ? { providerName: profile.displayName } : {}),
        ...providerProfileMetadata(profile),
        providerSource: profile.source,
        providerType: profile.type,
        providerPriority: profile.priority,
        privacy: profile.privacy,
        health: profile.health?.status ?? 'unknown',
        ...(profile.health?.lastCheckedAt
          ? { healthCheckedAt: profile.health.lastCheckedAt }
          : {}),
        available: providerAvailable,
        allowed,
        reasons,
      };
    })
    .filter(
      (
        candidate
      ): candidate is CopilotProviderRoutePolicyCandidateDiagnostics =>
        candidate !== null
    )
    .toSorted((a, b) => {
      const allowedA = allowedOrder.get(a.providerId);
      const allowedB = allowedOrder.get(b.providerId);
      if (allowedA !== undefined && allowedB !== undefined) {
        return allowedA - allowedB;
      }
      if (allowedA !== undefined) {
        return -1;
      }
      if (allowedB !== undefined) {
        return 1;
      }
      return (
        (originalIndex.get(a.providerId) ?? 0) -
        (originalIndex.get(b.providerId) ?? 0)
      );
    });
}

function parseModelPrefix(
  registry: CopilotProviderRegistry,
  modelId: string
): { providerId: string; modelId?: string } | null {
  const index = modelId.indexOf('/');
  if (index <= 0) {
    return null;
  }

  const providerId = modelId.slice(0, index);
  if (!registry.profiles.has(providerId)) {
    return null;
  }

  const model = modelId.slice(index + 1);
  return { providerId, modelId: model || undefined };
}

function normalizeProfile(
  profile: CopilotProviderProfile
): NormalizedCopilotProviderProfile {
  return {
    ...profile,
    enabled: profile.enabled !== false,
    priority: profile.priority ?? 0,
    privacy: profile.privacy ?? DEFAULT_PROVIDER_PRIVACY,
    source: profile.source ?? 'configured',
    middleware: resolveProviderMiddleware(profile.type, profile.middleware),
    modelDefinitions:
      profile.modelDefinitions?.filter(model => model.enabled !== false) ?? [],
  };
}

function toLegacyProfiles(
  config: CopilotProvidersConfigInput
): CopilotProviderProfile[] {
  const legacyProfiles: CopilotProviderProfile[] = [];
  for (const type of LEGACY_PROVIDER_ORDER) {
    const legacyConfig = config[type];
    if (!legacyConfig) {
      continue;
    }
    legacyProfiles.push({
      id: `${type}-default`,
      type,
      priority: LEGACY_PROVIDER_PRIORITY[type],
      source: 'legacy',
      config: legacyConfig,
    } as CopilotProviderProfile);
  }
  return legacyProfiles;
}

function mergeProfiles(
  explicitProfiles: CopilotProviderProfile[],
  legacyProfiles: CopilotProviderProfile[]
): CopilotProviderProfile[] {
  const profiles = new Map<string, CopilotProviderProfile>();

  for (const profile of explicitProfiles) {
    if (!PROVIDER_ID_PATTERN.test(profile.id)) {
      throw new Error(`Invalid copilot provider profile id: ${profile.id}`);
    }
    if (profiles.has(profile.id)) {
      throw new Error(`Duplicated copilot provider profile id: ${profile.id}`);
    }
    profiles.set(profile.id, profile);
  }

  for (const profile of legacyProfiles) {
    if (!profiles.has(profile.id)) {
      profiles.set(profile.id, profile);
    }
  }

  return Array.from(profiles.values());
}

function sortProfiles(profiles: NormalizedCopilotProviderProfile[]) {
  return profiles.toSorted((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return a.id.localeCompare(b.id);
  });
}

function assertDefaults(
  defaults: CopilotProviderDefaults,
  profiles: Map<string, NormalizedCopilotProviderProfile>
) {
  for (const providerId of Object.values(defaults)) {
    if (!providerId) {
      continue;
    }
    if (!profiles.has(providerId)) {
      throw new Error(
        `Copilot provider defaults references unknown providerId: ${providerId}`
      );
    }
  }
}

export function isProviderRouteHealthy(
  profile: Pick<NormalizedCopilotProviderProfile, 'enabled' | 'health'>
) {
  return profile.enabled && profile.health?.status !== 'down';
}

export function buildProviderRegistry(
  config: CopilotProvidersConfigInput
): CopilotProviderRegistry {
  const explicitProfiles = config.profiles ?? [];
  const legacyProfiles = toLegacyProfiles(config);
  const mergedProfiles = mergeProfiles(explicitProfiles, legacyProfiles)
    .map(normalizeProfile)
    .filter(profile => profile.enabled);
  const sortedProfiles = sortProfiles(mergedProfiles);

  const profiles = new Map(
    sortedProfiles.map(profile => [profile.id, profile] as const)
  );
  const defaults = config.defaults ?? {};
  assertDefaults(defaults, profiles);
  const routePolicy = config.routePolicy ?? {};

  const order = sortedProfiles.map(profile => profile.id);
  const byType = new Map<CopilotProviderType, string[]>();
  for (const profile of sortedProfiles) {
    const ids = byType.get(profile.type) ?? [];
    ids.push(profile.id);
    byType.set(profile.type, ids);
  }

  return { profiles, defaults, routePolicy, order, byType };
}

export function resolveModel({
  registry,
  modelId,
  outputType,
  availableProviderIds,
  preferredProviderIds,
  routePolicyContext,
}: ResolveModelOptions): ResolveModelResult {
  const available = new Set(asArray(availableProviderIds));
  const preferred = new Set(asArray(preferredProviderIds));
  const hasAvailableFilter = available.size > 0;
  const hasPreferredFilter = preferred.size > 0;

  const isAllowed = (providerId: string) => {
    const profile = registry.profiles.get(providerId);
    if (!profile || !isProviderRouteHealthy(profile)) {
      return false;
    }
    if (hasAvailableFilter && !available.has(providerId)) {
      return false;
    }
    if (hasPreferredFilter && !preferred.has(providerId)) {
      return false;
    }
    return true;
  };

  const prefixed = modelId ? parseModelPrefix(registry, modelId) : null;
  if (prefixed) {
    return {
      rawModelId: modelId,
      modelId: prefixed.modelId,
      explicitProviderId: prefixed.providerId,
      candidateProviderIds: isAllowed(prefixed.providerId)
        ? applyProviderRoutePolicy(
            registry,
            [prefixed.providerId],
            routePolicyContext
          )
        : [],
    };
  }

  if (modelId) {
    return {
      rawModelId: modelId,
      modelId,
      candidateProviderIds: applyProviderRoutePolicy(
        registry,
        registry.order.filter(providerId => isAllowed(providerId)),
        routePolicyContext
      ),
    };
  }

  const defaultProviderId = outputType
    ? registry.defaults[outputType]
    : undefined;

  const fallbackOrder = [
    ...(defaultProviderId ? [defaultProviderId] : []),
    registry.defaults.fallback,
    ...registry.order,
  ].filter((id): id is string => !!id);

  return {
    rawModelId: modelId,
    modelId,
    candidateProviderIds: applyProviderRoutePolicy(
      registry,
      fallbackOrder.filter(providerId => isAllowed(providerId)),
      routePolicyContext
    ),
  };
}

export function stripProviderPrefix(
  registry: CopilotProviderRegistry,
  providerId: string,
  modelId?: string
) {
  if (!modelId) {
    return modelId;
  }
  const prefixed = parseModelPrefix(registry, modelId);
  if (!prefixed) {
    return modelId;
  }
  if (prefixed.providerId !== providerId) {
    return modelId;
  }
  return prefixed.modelId;
}
