import type {
  DeckAiChoice,
  DeckAiOption,
  DeckAiOptionsResult,
  DeckScope,
  DeckSourceRef,
} from '@localmind/office/report-deck';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { BadRequest } from '../../base';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import { ByokEntitlementPolicy, ByokService } from './byok';
import { CopilotProviderFactory } from './providers';

/** Upper bound on non-source scopes listed in the AI picker. */
const OTHER_SCOPE_LIMIT = 50;

export class ReportDeckAiUnavailable extends BadRequest {
  readonly deckErrorCode = 'provider_unavailable' as const;
  constructor(message = 'The selected AI is unavailable for report decks') {
    super(message);
  }
}

const scopeKey = (scope: DeckScope) => `${scope.scopeKind}:${scope.scopeId}`;

/**
 * Candidate scopes in picker order: scopes of the sources (in source order),
 * then other workspaces, then other projects. Duplicates keep the first slot.
 */
export function deckAiCandidateScopes(
  sources: readonly Pick<DeckSourceRef, 'scopeKind' | 'scopeId'>[],
  others: readonly DeckScope[]
): (DeckScope & { fromSources: boolean })[] {
  const seen = new Set<string>();
  const result: (DeckScope & { fromSources: boolean })[] = [];
  for (const source of sources) {
    const scope = { scopeKind: source.scopeKind, scopeId: source.scopeId };
    if (seen.has(scopeKey(scope))) continue;
    seen.add(scopeKey(scope));
    result.push({ ...scope, fromSources: true });
  }
  for (const scope of others) {
    if (seen.has(scopeKey(scope))) continue;
    seen.add(scopeKey(scope));
    result.push({ ...scope, fromSources: false });
  }
  return result;
}

/**
 * Default AI: the first source's scope; when it has no usable AI, the next
 * source scope (in source order) that does. Scopes outside the sources are
 * never chosen implicitly.
 */
export function pickDeckAiDefault(
  options: readonly Pick<
    DeckAiOption,
    'scopeKind' | 'scopeId' | 'fromSources' | 'available' | 'defaultModelId'
  >[]
): Pick<DeckAiOptionsResult, 'defaultChoice' | 'defaultFallbackFrom'> {
  const fromSources = options.filter(option => option.fromSources);
  const first = fromSources[0];
  if (!first) return { defaultChoice: null, defaultFallbackFrom: null };
  const chosen = fromSources.find(option => option.available);
  if (!chosen)
    return {
      defaultChoice: null,
      defaultFallbackFrom: {
        scopeKind: first.scopeKind,
        scopeId: first.scopeId,
      },
    };
  return {
    defaultChoice: {
      scopeKind: chosen.scopeKind,
      scopeId: chosen.scopeId,
      ...(chosen.scopeKind === 'workspace' && chosen.defaultModelId
        ? { modelId: chosen.defaultModelId }
        : {}),
    },
    defaultFallbackFrom:
      chosen === first
        ? null
        : { scopeKind: first.scopeKind, scopeId: first.scopeId },
  };
}

export type DeckAiProviderOptions = {
  modelId?: string;
  providerOptions: {
    user: string;
    workspace?: string;
    projectId?: string;
    featureKind: 'action';
    quotaBackedRoutesAllowed: false;
  };
};

/** Prompt runtime options for an AI scope. Project AI ignores `modelId`. */
export function deckAiProviderOptions(
  userId: string,
  choice: DeckAiChoice
): DeckAiProviderOptions {
  if (choice.scopeKind === 'workspace')
    return {
      ...(choice.modelId ? { modelId: choice.modelId } : {}),
      providerOptions: {
        user: userId,
        workspace: choice.scopeId,
        featureKind: 'action',
        quotaBackedRoutesAllowed: false,
      },
    };
  return {
    providerOptions: {
      user: userId,
      projectId: choice.scopeId,
      featureKind: 'action',
      quotaBackedRoutesAllowed: false,
    },
  };
}

/**
 * AI scope resolution for report decks (plan §5.1). Background generation
 * only uses server-side credentials: browser-held local key leases cannot
 * outlive the request.
 */
@Injectable()
export class ReportDeckAiService {
  private readonly logger = new Logger(ReportDeckAiService.name);

  constructor(
    private readonly models: Models,
    private readonly db: PrismaClient,
    private readonly ac: PermissionAccess,
    private readonly byok: ByokService,
    private readonly entitlement: ByokEntitlementPolicy,
    private readonly providers: CopilotProviderFactory
  ) {}

  async options(
    userId: string,
    sources: readonly Pick<DeckSourceRef, 'scopeKind' | 'scopeId'>[],
    label: (scope: DeckScope) => string
  ): Promise<DeckAiOptionsResult> {
    const candidates = deckAiCandidateScopes(
      sources,
      await this.otherScopes(userId)
    );
    const options = await Promise.all(
      candidates.map(async candidate => ({
        ...(await this.describe(userId, candidate)),
        label: label(candidate),
        fromSources: candidate.fromSources,
      }))
    );
    // Other scopes are only listed when the user may use their AI at all.
    const visible = options.filter(
      option => option.fromSources || option.reason !== 'no_permission'
    );
    return { options: visible, ...pickDeckAiDefault(visible) };
  }

  /**
   * Resolve the AI used by a new deck: the explicit choice, else the default.
   * Throws when nothing usable remains.
   */
  async resolve(
    userId: string,
    sources: readonly Pick<DeckSourceRef, 'scopeKind' | 'scopeId'>[],
    choice?: DeckAiChoice
  ): Promise<DeckAiChoice> {
    if (choice) {
      await this.assertUsable(userId, choice);
      return choice;
    }
    const candidates = deckAiCandidateScopes(sources, []);
    const options = await Promise.all(
      candidates.map(async candidate => ({
        ...(await this.describe(userId, candidate)),
        fromSources: true,
      }))
    );
    const { defaultChoice } = pickDeckAiDefault(options);
    if (!defaultChoice)
      throw new ReportDeckAiUnavailable(
        'No source scope has an AI configured for background generation'
      );
    return defaultChoice;
  }

  /** Re-validate a stored choice (run start). Never substitutes a scope. */
  async assertUsable(userId: string, choice: DeckAiChoice) {
    const option = await this.describe(userId, choice);
    if (!option.available) throw new ReportDeckAiUnavailable();
    if (
      choice.scopeKind === 'workspace' &&
      choice.modelId &&
      option.models.length &&
      !option.models.some(model => model.id === choice.modelId)
    )
      throw new ReportDeckAiUnavailable('The selected model is unavailable');
    return option;
  }

  providerOptions(userId: string, choice: DeckAiChoice) {
    return deckAiProviderOptions(userId, choice);
  }

  async designCapabilities(userId: string, choice: DeckAiChoice) {
    const option = await this.assertUsable(userId, choice);
    const context = {
      userId,
      ...(choice.scopeKind === 'project'
        ? { projectId: choice.scopeId }
        : { workspaceId: choice.scopeId }),
      featureKind: 'action' as const,
      quotaBackedRoutesAllowed: false,
    };
    const requested =
      choice.scopeKind === 'workspace'
        ? (choice.modelId ?? option.defaultModelId)
        : option.defaultModelId;
    const modelId = await this.providers.resolveModelId(
      { ...(requested ? { modelId: requested } : {}), outputType: 'text' },
      {},
      context
    );
    if (!modelId) throw new ReportDeckAiUnavailable();
    const [vision, structured, contextWindow] = await Promise.all([
      this.providers.resolveModelId(
        { modelId, outputType: 'text', inputTypes: ['image'] },
        {},
        context
      ),
      this.providers.resolveModelId(
        { modelId, outputType: 'structured' },
        {},
        context
      ),
      this.providers.resolveModelContextWindow(
        { modelId, outputType: 'text' },
        {},
        context
      ),
    ]);
    return {
      modelId,
      vision: !!vision,
      structured: !!structured,
      contextWindow: contextWindow ?? 32000,
      contextKnown: contextWindow != null,
    };
  }

  /**
   * One broken scope (e.g. credentials that no longer decrypt) must not hide
   * the others; it is reported as not configured instead.
   */
  async describe(
    userId: string,
    scope: DeckScope
  ): Promise<Omit<DeckAiOption, 'label' | 'fromSources'>> {
    try {
      return await this.describeScope(userId, scope);
    } catch (error) {
      this.logger.warn(
        `Report deck AI scope ${scope.scopeKind}:${scope.scopeId} is unusable: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        scopeKind: scope.scopeKind,
        scopeId: scope.scopeId,
        providerName: null,
        models: [],
        defaultModelId: null,
        modelLocked: scope.scopeKind === 'project',
        available: false,
        reason: 'not_configured',
      };
    }
  }

  private async describeScope(
    userId: string,
    scope: DeckScope
  ): Promise<Omit<DeckAiOption, 'label' | 'fromSources'>> {
    const base = {
      scopeKind: scope.scopeKind,
      scopeId: scope.scopeId,
      providerName: null,
      models: [] as { id: string; name: string }[],
      defaultModelId: null,
      modelLocked: scope.scopeKind === 'project',
    };
    const unavailable = (reason: NonNullable<DeckAiOption['reason']>) => ({
      ...base,
      available: false,
      reason,
    });
    if (scope.scopeKind === 'workspace') {
      const allowed = await this.ac
        .user(userId)
        .workspace(scope.scopeId)
        .can('Workspace.Copilot')
        .catch(() => false);
      if (!allowed) return unavailable('no_permission');
      const profiles = await this.byok.getProfiles(
        { userId, workspaceId: scope.scopeId },
        { local: false, server: true }
      );
      if (!profiles.length) {
        const [local, server, manager] = await Promise.all([
          this.entitlement.hasLocalEntitlement(scope.scopeId, userId),
          this.entitlement.hasServerEntitlement(scope.scopeId),
          this.entitlement.hasManagementAccess(scope.scopeId, userId),
        ]);
        return unavailable(
          local && manager && !server ? 'local_keys_only' : 'not_configured'
        );
      }
      const selection = await this.providers.getEffectiveModelSelectionScope({
        userId,
        workspaceId: scope.scopeId,
        featureKind: 'action',
        quotaBackedRoutesAllowed: false,
      });
      // Route policy (including providers.routePolicy.byWorkspace) removed all.
      if (!selection.providerIds.length)
        return unavailable('blocked_by_policy');
      const names = new Map(
        profiles.flatMap(profile =>
          (profile.modelDefinitions ?? []).map(definition => [
            definition.id,
            definition.displayName ?? definition.id,
          ])
        )
      );
      const models = selection.configuredModelIds.map(id => ({
        id,
        name: names.get(id) ?? id,
        // Text-only BYOK defaults do not prove that image input is unsupported.
        vision: profiles.some(profile =>
          profile.modelDefinitions?.some(
            definition =>
              definition.id === id &&
              definition.capabilities?.some(
                capability =>
                  capability.input.includes('image') &&
                  capability.output.includes('text')
              )
          )
        )
          ? ('declared' as const)
          : ('unknown' as const),
      }));
      return {
        ...base,
        available: true,
        reason: null,
        providerName: profiles[0]?.type ?? null,
        models,
        defaultModelId: models[0]?.id ?? null,
      };
    }
    try {
      await this.models.projectResource.assertMember({
        projectId: scope.scopeId,
        actorId: userId,
      });
    } catch {
      return unavailable('no_permission');
    }
    const profiles = await this.byok
      .getProfiles({ userId, projectId: scope.scopeId })
      .catch(() => []);
    if (!profiles.length) return unavailable('not_configured');
    const selection = await this.providers.getEffectiveModelSelectionScope({
      userId,
      projectId: scope.scopeId,
      featureKind: 'action',
      quotaBackedRoutesAllowed: false,
    });
    if (!selection.providerIds.length) return unavailable('blocked_by_policy');
    const modelId =
      selection.projectModelId ?? selection.configuredModelIds[0] ?? null;
    const definition = profiles[0]?.modelDefinitions?.find(
      item => item.id === modelId
    );
    return {
      ...base,
      available: true,
      reason: null,
      providerName: profiles[0]?.type ?? null,
      models: modelId
        ? [
            {
              id: modelId,
              name: definition?.displayName ?? modelId,
              vision: definition?.capabilities?.some(
                capability =>
                  capability.input.includes('image') &&
                  capability.output.includes('text')
              )
                ? ('declared' as const)
                : ('unknown' as const),
            },
          ]
        : [],
      defaultModelId: modelId,
      modelLocked: true,
    };
  }

  /** Other workspaces (active membership) and active projects of the user. */
  private async otherScopes(userId: string): Promise<DeckScope[]> {
    const [roles, memberships] = await Promise.all([
      this.models.workspaceUser.getUserActiveRoles(userId),
      this.db.aiContextProjectMember.findMany({
        where: { userId, project: { status: 'active' } },
        orderBy: { createdAt: 'desc' },
        take: OTHER_SCOPE_LIMIT,
        select: { projectId: true },
      }),
    ]);
    return [
      ...roles.slice(0, OTHER_SCOPE_LIMIT).map(role => ({
        scopeKind: 'workspace' as const,
        scopeId: role.workspaceId,
      })),
      ...memberships.map(member => ({
        scopeKind: 'project' as const,
        scopeId: member.projectId,
      })),
    ];
  }
}
