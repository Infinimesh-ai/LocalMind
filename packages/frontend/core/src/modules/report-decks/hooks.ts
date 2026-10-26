import type {
  DeckCommandInput,
  DeckConfigInput,
  DeckDetail,
  DeckListResult,
  DeckSourceRef,
} from '@localmind/office/report-deck';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import useSWRInfinite from 'swr/infinite';

import { useReportDeckApi } from './api';
import { deckAccessFailure } from './errors';
import {
  ACTIVE_DECK_STATUSES,
  type DeckCommandResponse,
  type DeckLastConfig,
} from './types';

const POLL_MS = 3000;
const KEY = 'report-deck';

function isDeckKey(key: unknown) {
  if (Array.isArray(key)) return key[0] === KEY;
  // useSWRInfinite stores a serialized key.
  return typeof key === 'string' && key.includes(`"${KEY}"`);
}

/** Paged history; polls while any loaded deck is queued or generating. */
export function useDeckList(limit = 20) {
  const api = useReportDeckApi();
  const query = useSWRInfinite(
    (index, previous: DeckListResult | null) =>
      index && !previous?.nextCursor
        ? null
        : ([KEY, 'list', limit, previous?.nextCursor ?? null] as const),
    ([, , pageLimit, cursor]) => api.list({ cursor, limit: pageLimit }),
    {
      suspense: false,
      shouldRetryOnError: false,
      revalidateFirstPage: true,
      refreshInterval: pages =>
        pages?.some(page =>
          page.items.some(item => ACTIVE_DECK_STATUSES.has(item.status))
        )
          ? POLL_MS
          : 0,
    }
  );
  const { mutate, setSize } = query;
  const items = useMemo(
    () => query.data?.flatMap(page => page.items) ?? [],
    [query.data]
  );
  return {
    items,
    error: query.error as unknown,
    loading: query.isLoading,
    hasMore: !!query.data?.at(-1)?.nextCursor,
    loadingMore:
      query.isLoading || !!(query.data && !query.data[query.size - 1]),
    loadMore: () => setSize(size => size + 1),
    refresh: () => mutate(),
  };
}

/** One deck; polls every 3s while it is queued or generating. */
export function useDeck(deckId: string | null | undefined) {
  const api = useReportDeckApi();
  const query = useSWR(
    deckId ? ([KEY, 'deck', deckId] as const) : null,
    ([, , id]) => api.get(id),
    {
      suspense: false,
      // Ride out short server restarts before showing the error state.
      shouldRetryOnError: error => !deckAccessFailure(error),
      errorRetryCount: 3,
      errorRetryInterval: 3000,
      refreshInterval: deck =>
        deck && ACTIVE_DECK_STATUSES.has(deck.status) ? POLL_MS : 0,
    }
  );
  return {
    // Do not retain a previously cached deck after its access is revoked.
    deck: deckAccessFailure(query.error) ? undefined : query.data,
    error: query.error as unknown,
    loading: query.isLoading,
    refresh: () => query.mutate(),
  };
}

/** Generated HTML of a ready deck; refetched when the deck completes again. */
export function useDeckHtml(deck: DeckDetail | undefined) {
  const api = useReportDeckApi();
  const ready = deck?.status === 'ready';
  const query = useSWR(
    ready && deck
      ? ([KEY, 'html', deck.id, deck.completedAt ?? ''] as const)
      : null,
    ([, , id]) => api.fetchHtml(id),
    {
      suspense: false,
      shouldRetryOnError: false,
      revalidateOnFocus: false,
      revalidateIfStale: false,
    }
  );
  return {
    html: query.data,
    error: query.error as unknown,
    loading: query.isLoading,
    refresh: () => query.mutate(),
  };
}

function useDebounced<T>(value: T, delay: number) {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return current;
}

function sourcesFingerprint(sources: DeckSourceRef[]) {
  return JSON.stringify(
    sources.map(source => [
      source.scopeKind,
      source.scopeId,
      source.kind,
      source.resourceId ?? '',
    ])
  );
}

/** Debounced permission/size preflight for the configuration page. */
export function useDeckPreflight(sources: DeckSourceRef[], delay = 350) {
  const api = useReportDeckApi();
  const fingerprint = useDebounced(sourcesFingerprint(sources), delay);
  const current = sourcesFingerprint(sources);
  const query = useSWR(
    sources.length && fingerprint === current
      ? ([KEY, 'preflight', fingerprint] as const)
      : null,
    () => api.preflight(sources),
    {
      suspense: false,
      shouldRetryOnError: false,
      revalidateOnFocus: false,
      keepPreviousData: true,
    }
  );
  return {
    preflight: sources.length ? query.data : undefined,
    error: query.error as unknown,
    loading: !!sources.length && (fingerprint !== current || query.isLoading),
    refresh: () => query.mutate(),
  };
}

/** Candidate AI scopes for the given sources (default first). */
export function useDeckAiOptions(sources: DeckSourceRef[], delay = 350) {
  const api = useReportDeckApi();
  const scopes = JSON.stringify(
    sources.map(source => [source.scopeKind, source.scopeId])
  );
  const fingerprint = useDebounced(scopes, delay);
  const query = useSWR(
    fingerprint === scopes ? ([KEY, 'ai-options', fingerprint] as const) : null,
    () => api.aiOptions(sources),
    {
      suspense: false,
      shouldRetryOnError: false,
      revalidateOnFocus: false,
      keepPreviousData: true,
    }
  );
  return {
    options: query.data,
    error: query.error as unknown,
    loading: fingerprint !== scopes || query.isLoading,
    refresh: () => query.mutate(),
  };
}

/** Runs one command and revalidates every cached deck query afterwards. */
export function useDeckCommand() {
  const api = useReportDeckApi();
  const { mutate } = useSWRConfig();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(
    async (input: DeckCommandInput): Promise<DeckCommandResponse> => {
      setPending(true);
      setError(null);
      try {
        const result = await api.command(input);
        if (result.deck)
          await mutate([KEY, 'deck', result.deck.id], result.deck, {
            revalidate: false,
          });
        void mutate(isDeckKey).catch(() => undefined);
        return result;
      } catch (failure) {
        setError(failure);
        throw failure;
      } finally {
        setPending(false);
      }
    },
    [api, mutate]
  );
  return { run, pending, error };
}

/* Last-used preferences. */

export const LAST_CONFIG_KEY = 'report-deck:last-config';

const LAST_CONFIG_FIELDS = {
  mode: ['template', 'custom'],
  purpose: [
    'periodic',
    'progress',
    'customer',
    'decision',
    'retrospective',
    'training',
    'other',
  ],
  audience: ['team', 'management', 'customer', 'public'],
  length: ['short', 'standard', 'long'],
  language: ['zh-CN', 'en'],
  tone: ['formal', 'concise', 'vivid'],
} as const;

export function loadLastDeckConfig(): DeckLastConfig {
  try {
    const raw = localStorage.getItem(LAST_CONFIG_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    const value = parsed as Record<string, unknown>;
    const config: Record<string, unknown> = {};
    for (const [field, allowed] of Object.entries(LAST_CONFIG_FIELDS))
      if ((allowed as readonly unknown[]).includes(value[field]))
        config[field] = value[field];
    if (typeof value.templateKey === 'string' && value.templateKey)
      config.templateKey = value.templateKey.slice(0, 64);
    if (typeof value.customStyle === 'string')
      config.customStyle = value.customStyle.slice(0, 500);
    if (
      typeof value.accentColor === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(value.accentColor)
    )
      config.accentColor = value.accentColor;
    const preferences = value.preferences;
    if (
      preferences &&
      typeof preferences === 'object' &&
      !Array.isArray(preferences)
    ) {
      const entries = Object.entries(preferences).filter(
        ([key, flag]) =>
          ['charts', 'citations', 'conclusionFirst'].includes(key) &&
          typeof flag === 'boolean'
      );
      if (entries.length) config.preferences = Object.fromEntries(entries);
    }
    return config as DeckLastConfig;
  } catch {
    return {};
  }
}

export function saveLastDeckConfig(config: DeckConfigInput) {
  const {
    ai: _ai,
    title: _title,
    instructions: _instructions,
    ...rest
  } = config;
  const remembered: DeckLastConfig = {
    mode: rest.mode,
    templateKey: rest.templateKey,
    customStyle: rest.customStyle,
    accentColor: rest.accentColor,
    purpose: rest.purpose,
    audience: rest.audience,
    length: rest.length,
    language: rest.language,
    tone: rest.tone,
    preferences: rest.preferences,
  };
  try {
    localStorage.setItem(LAST_CONFIG_KEY, JSON.stringify(remembered));
  } catch {
    // Storage may be full or disabled; preferences are a convenience.
  }
}
