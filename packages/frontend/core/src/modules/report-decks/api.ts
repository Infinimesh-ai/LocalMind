import { GraphQLService, ServerService } from '@affine/core/modules/cloud';
import { UserFriendlyError } from '@affine/error';
import {
  reportDeckAiOptionsQuery,
  reportDeckCommandMutation,
  reportDeckPreflightQuery,
  reportDeckQuery,
  reportDecksQuery,
} from '@affine/graphql';
import type {
  DeckAiOption,
  DeckAiOptionsResult,
  DeckDetail,
  DeckListResult,
  DeckPreflightResult,
  DeckProgress,
  DeckScope,
  DeckShareView,
  DeckSourceView,
  DeckSummary,
} from '@localmind/office/report-deck';
import {
  DeckQualitySchema,
  DeckSubphaseSchema,
} from '@localmind/office/report-deck';
import { useService } from '@toeverything/infra';
import { useMemo } from 'react';

import type {
  DeckCommandResponse,
  DeckShareOpenResult,
  ReportDeckApi,
} from './types';

type Loose = Record<string, unknown>;

function record(value: unknown): Loose | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Loose)
    : null;
}
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function nullableCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
function nullableOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

const STATUSES = [
  'queued',
  'generating',
  'ready',
  'failed',
  'cancelled',
] as const;
const PHASES = [
  'queued',
  'sources',
  'extract',
  'compose',
  'render',
  'done',
] as const;
const ERRORS = [
  'no_sources',
  'provider_unavailable',
  'model_invalid_output',
  'budget_exceeded',
  'timeout',
  'cancelled',
  'internal',
  'render_failed',
  'quality_failed',
] as const;
const SCOPES = ['workspace', 'project'] as const;
const SOURCE_KINDS = ['project_all', 'doc', 'file', 'folder'] as const;
const SOURCE_STATUSES = [
  'pending',
  'included',
  'excluded',
  'truncated',
] as const;
const SOURCE_REASONS = [
  'no_permission',
  'not_found',
  'empty',
  'unsupported',
  'over_budget',
  'duplicate',
] as const;
const AI_REASONS = [
  'no_permission',
  'not_configured',
  'local_keys_only',
  'blocked_by_policy',
] as const;

function readProgress(value: unknown): DeckProgress {
  const progress = record(value) ?? {};
  const subphase = DeckSubphaseSchema.safeParse(progress.subphase);
  return {
    phase: oneOf(progress.phase, PHASES, 'queued'),
    done: count(progress.done),
    total: count(progress.total),
    ...(subphase.success ? { subphase: subphase.data } : {}),
  };
}

export function readDeckSummary(value: unknown): DeckSummary {
  const deck = record(value);
  if (!deck || typeof deck.id !== 'string' || !deck.id)
    throw new Error('Invalid report deck response');
  return {
    id: deck.id,
    title: text(deck.title),
    status: oneOf(deck.status, STATUSES, 'queued'),
    mode: oneOf(deck.mode, ['template', 'custom'] as const, 'template'),
    ...(nullableOneOf(deck.designMode, ['fast', 'refine'] as const)
      ? { designMode: deck.designMode as 'fast' | 'refine' }
      : {}),
    templateKey: nullableText(deck.templateKey),
    slideCount: nullableCount(deck.slideCount),
    sourceCount: count(deck.sourceCount),
    excludedCount: count(deck.excludedCount),
    progress: readProgress(deck.progress),
    errorCode: nullableOneOf(deck.errorCode, ERRORS),
    createdAt: text(deck.createdAt),
    completedAt: nullableText(deck.completedAt),
  };
}

export function readSourceView(value: unknown): DeckSourceView | null {
  const source = record(value);
  if (!source) return null;
  const scopeKind = nullableOneOf(source.scopeKind, SCOPES);
  const kind = nullableOneOf(source.kind, SOURCE_KINDS);
  if (!scopeKind || !kind || typeof source.scopeId !== 'string') return null;
  return {
    scopeKind,
    scopeId: source.scopeId,
    scopeLabel: text(source.scopeLabel),
    kind,
    resourceId: nullableText(source.resourceId),
    title: text(source.title),
    status: oneOf(source.status, SOURCE_STATUSES, 'pending'),
    reason: nullableOneOf(source.reason, SOURCE_REASONS),
    chars: nullableCount(source.chars),
  };
}

export function readShareView(value: unknown): DeckShareView | null {
  const share = record(value);
  if (!share || typeof share.id !== 'string') return null;
  return {
    id: share.id,
    url: nullableText(share.url),
    hasPassword: share.hasPassword === true,
    allowDownload: share.allowDownload === true,
    expiresAt: text(share.expiresAt),
    revokedAt: nullableText(share.revokedAt),
    createdAt: text(share.createdAt),
  };
}

export function readDeckDetail(value: unknown): DeckDetail {
  const deck = record(value);
  const summary = readDeckSummary(deck);
  const ai = record(deck?.ai) ?? {};
  const quality = DeckQualitySchema.safeParse(deck?.quality);
  return {
    ...summary,
    ...(quality.success ? { quality: quality.data } : {}),
    config: (record(deck?.config) ?? {
      mode: summary.mode,
    }) as DeckDetail['config'],
    ai: {
      scopeKind: oneOf(ai.scopeKind, SCOPES, 'workspace'),
      scopeId: text(ai.scopeId),
      scopeLabel: text(ai.scopeLabel),
    },
    modelId: nullableText(deck?.modelId),
    htmlBytes: nullableCount(deck?.htmlBytes),
    sources: list(deck?.sources).flatMap(item => {
      const source = readSourceView(item);
      return source ? [source] : [];
    }),
    shares: list(deck?.shares).flatMap(item => {
      const share = readShareView(item);
      return share ? [share] : [];
    }),
  };
}

export function readDeckList(value: unknown): DeckListResult {
  const result = record(value) ?? {};
  return {
    items: list(result.items).flatMap(item => {
      try {
        return [readDeckSummary(item)];
      } catch {
        return [];
      }
    }),
    nextCursor: nullableText(result.nextCursor),
  };
}

export function readPreflight(value: unknown): DeckPreflightResult {
  const result = record(value) ?? {};
  const sources = list(result.sources).flatMap(item => {
    const source = readSourceView(item);
    return source ? [source] : [];
  });
  return {
    sources,
    totalChars: count(result.totalChars),
    includedCount:
      nullableCount(result.includedCount) ??
      sources.filter(
        source => source.status === 'included' || source.status === 'truncated'
      ).length,
    excludedCount:
      nullableCount(result.excludedCount) ??
      sources.filter(source => source.status === 'excluded').length,
    estimatedMinutes: count(result.estimatedMinutes),
  };
}

function readScope(value: unknown): DeckScope | null {
  const scope = record(value);
  const scopeKind = nullableOneOf(scope?.scopeKind, SCOPES);
  if (!scope || !scopeKind || typeof scope.scopeId !== 'string') return null;
  return { scopeKind, scopeId: scope.scopeId };
}

export function readAiOptions(value: unknown): DeckAiOptionsResult {
  const result = record(value) ?? {};
  const options = list(result.options).flatMap((item): DeckAiOption[] => {
    const option = record(item);
    const scope = readScope(option);
    if (!option || !scope) return [];
    return [
      {
        ...scope,
        label: text(option.label, scope.scopeId),
        fromSources: option.fromSources === true,
        available: option.available === true,
        reason: nullableOneOf(option.reason, AI_REASONS),
        providerName: nullableText(option.providerName),
        models: list(option.models).flatMap(model => {
          const entry = record(model);
          return entry && typeof entry.id === 'string'
            ? [
                {
                  id: entry.id,
                  name: text(entry.name, entry.id),
                  vision: oneOf(
                    entry.vision,
                    ['declared', 'unknown'] as const,
                    'unknown'
                  ),
                },
              ]
            : [];
        }),
        defaultModelId: nullableText(option.defaultModelId),
        modelLocked: option.modelLocked === true,
      },
    ];
  });
  const choice = readScope(result.defaultChoice);
  const modelId = nullableText(record(result.defaultChoice)?.modelId);
  return {
    options,
    defaultChoice: choice
      ? { ...choice, ...(modelId ? { modelId } : {}) }
      : null,
    defaultFallbackFrom: readScope(result.defaultFallbackFrom),
  };
}

export function readCommandResult(value: unknown): DeckCommandResponse {
  const result = record(value) ?? {};
  return {
    deck: result.deck ? readDeckDetail(result.deck) : undefined,
    share: readShareView(result.share) ?? undefined,
    deleted: result.deleted === true ? true : undefined,
  };
}

function deckHtmlPath(deckId: string, download?: boolean) {
  return `/api/report-decks/${encodeURIComponent(deckId)}/html${download ? '?download=1' : ''}`;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function absolute(path: string, baseUrl: string) {
  return new URL(path, baseUrl).toString();
}

export function createReportDeckApi(
  graphql: Pick<GraphQLService, 'gql'>,
  baseUrl: string = window.location.origin,
  fetcher: FetchLike = (input, init) => globalThis.fetch(input, init)
): ReportDeckApi {
  return {
    async list({ cursor, limit = 20, signal }) {
      const result = await graphql.gql({
        query: reportDecksQuery,
        variables: { cursor: cursor ?? null, limit },
        context: { signal },
      });
      return readDeckList(result.reportDecks);
    },
    async get(deckId, signal) {
      const result = await graphql.gql({
        query: reportDeckQuery,
        variables: { deckId },
        context: { signal },
      });
      const deck = readDeckDetail(result.reportDeck);
      if (deck.id !== deckId)
        throw new Error('Report deck response belongs to another deck');
      return deck;
    },
    async preflight(sources, signal) {
      const result = await graphql.gql({
        query: reportDeckPreflightQuery,
        variables: { input: { sources } },
        context: { signal },
      });
      return readPreflight(result.reportDeckPreflight);
    },
    async aiOptions(sources, signal) {
      const result = await graphql.gql({
        query: reportDeckAiOptionsQuery,
        variables: { input: { sources } },
        context: { signal },
      });
      return readAiOptions(result.reportDeckAiOptions);
    },
    async command(input) {
      const result = await graphql.gql({
        query: reportDeckCommandMutation,
        variables: { input },
      });
      return readCommandResult(result.reportDeckCommand);
    },
    async fetchHtml(deckId, signal) {
      const response = await fetcher(absolute(deckHtmlPath(deckId), baseUrl), {
        credentials: 'include',
        cache: 'no-store',
        signal,
      });
      if (!response.ok) {
        const name =
          response.status === 401
            ? 'AUTHENTICATION_REQUIRED'
            : response.status === 403
              ? 'ACCESS_DENIED'
              : response.status === 404
                ? 'NOT_FOUND'
                : 'INTERNAL_SERVER_ERROR';
        throw new UserFriendlyError({
          status: response.status,
          code: name,
          type: name,
          name,
          message: 'Report deck HTML unavailable',
        });
      }
      return response.text();
    },
    htmlUrl(deckId, download) {
      return absolute(deckHtmlPath(deckId, download), baseUrl);
    },
  };
}

/** API bound to the surrounding server scope (FrameworkScope(server)). */
export function useReportDeckApi(): ReportDeckApi {
  const graphql = useService(GraphQLService);
  const baseUrl = useService(ServerService).server.serverMetadata.baseUrl;
  return useMemo(
    () => createReportDeckApi(graphql, baseUrl),
    [graphql, baseUrl]
  );
}

/* Public share links: no account, password and expiry checked by the server. */

function shareHtmlPath(shareId: string, download?: boolean) {
  return `/api/deck-shares/${encodeURIComponent(shareId)}/html${download ? '?download=1' : ''}`;
}

export function sharedDeckHtmlUrl(
  baseUrl: string,
  shareId: string,
  download?: boolean
) {
  return absolute(shareHtmlPath(shareId, download), baseUrl);
}

const SHARE_FAILURES = [
  'password_required',
  'invalid_password',
  'invalid_token',
  'expired',
  'revoked',
] as const;

export async function openDeckShare(
  baseUrl: string,
  shareId: string,
  input: { token: string; password?: string },
  fetcher: FetchLike = (url, init) => globalThis.fetch(url, init)
): Promise<DeckShareOpenResult> {
  let response: Response;
  try {
    response = await fetcher(
      absolute(`/api/deck-shares/${encodeURIComponent(shareId)}`, baseUrl),
      {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: input.token,
          ...(input.password ? { password: input.password } : {}),
        }),
      }
    );
  } catch {
    return { status: 'error' };
  }
  let body: Loose | null = null;
  try {
    body = record(await response.json());
  } catch {
    body = null;
  }
  if (response.ok) {
    return {
      status: 'ok',
      title: text(body?.title),
      allowDownload: body?.allowDownload === true,
      slideCount: nullableCount(body?.slideCount),
    };
  }
  const code = nullableOneOf(body?.code, SHARE_FAILURES);
  if (code) return { status: code };
  if (response.status === 410) return { status: 'expired' };
  if (response.status === 401 || response.status === 403)
    return { status: 'invalid_token' };
  return { status: 'error' };
}

export async function fetchSharedDeckHtml(
  baseUrl: string,
  shareId: string,
  fetcher: FetchLike = (url, init) => globalThis.fetch(url, init)
) {
  const response = await fetcher(sharedDeckHtmlUrl(baseUrl, shareId), {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(`Shared report deck unavailable (${response.status})`);
  return response.text();
}

/** Server share URLs may be relative (`/share/decks/<id>#token=…`). */
export function absoluteShareUrl(url: string, origin = window.location.origin) {
  try {
    return new URL(url, origin).toString();
  } catch {
    return url;
  }
}
