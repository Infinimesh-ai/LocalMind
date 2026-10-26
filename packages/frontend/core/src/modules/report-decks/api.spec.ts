/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@affine/core/modules/cloud', () => ({
  GraphQLService: class {},
  ServerService: class {},
}));

import {
  createReportDeckApi,
  openDeckShare,
  readAiOptions,
  readDeckDetail,
  readDeckList,
  readPreflight,
} from './api';
import {
  LAST_CONFIG_KEY,
  loadLastDeckConfig,
  saveLastDeckConfig,
} from './hooks';
import { readDeckSources, stashDeckSources } from './source-handoff';

const BASE = 'https://app.local';

describe('response parsing', () => {
  it('normalizes deck lists loosely and drops malformed items', () => {
    const result = readDeckList({
      items: [
        {
          id: 'a',
          title: 'A',
          status: 'ready',
          mode: 'custom',
          sourceCount: 2,
          progress: { phase: 'done' },
        },
        { title: 'missing id' },
        'junk',
        { id: 'b', status: 'weird', errorCode: 'nope' },
      ],
      nextCursor: 'c1',
    });
    expect(result.nextCursor).toBe('c1');
    expect(result.items.map(item => item.id)).toEqual(['a', 'b']);
    expect(result.items[0]).toMatchObject({
      mode: 'custom',
      sourceCount: 2,
      excludedCount: 0,
    });
    expect(result.items[1]).toMatchObject({
      status: 'queued',
      errorCode: null,
      mode: 'template',
    });
    expect(readDeckList(null)).toEqual({ items: [], nextCursor: null });
  });

  it('parses details with sources and shares', () => {
    const deck = readDeckDetail({
      id: 'd',
      status: 'ready',
      ai: { scopeKind: 'project', scopeId: 'p', scopeLabel: 'P' },
      sources: [
        {
          scopeKind: 'project',
          scopeId: 'p',
          kind: 'doc',
          resourceId: 'r',
          title: 'R',
          status: 'excluded',
          reason: 'no_permission',
        },
        { scopeKind: 'bogus' },
      ],
      shares: [
        {
          id: 's',
          url: '/share/decks/s#token=t',
          hasPassword: true,
          expiresAt: 'x',
        },
        {},
      ],
    });
    expect(deck.sources).toHaveLength(1);
    expect(deck.sources[0].reason).toBe('no_permission');
    expect(deck.shares).toEqual([
      expect.objectContaining({
        id: 's',
        hasPassword: true,
        allowDownload: false,
        revokedAt: null,
      }),
    ]);
    expect(() => readDeckDetail({})).toThrow();
  });

  it('derives preflight counts and AI options defaults', () => {
    expect(
      readPreflight({
        sources: [
          {
            scopeKind: 'workspace',
            scopeId: 'w',
            kind: 'doc',
            resourceId: 'x',
            status: 'included',
          },
          {
            scopeKind: 'workspace',
            scopeId: 'w',
            kind: 'doc',
            resourceId: 'y',
            status: 'excluded',
          },
        ],
      })
    ).toMatchObject({ includedCount: 1, excludedCount: 1, totalChars: 0 });
    const options = readAiOptions({
      options: [
        {
          scopeKind: 'workspace',
          scopeId: 'w',
          available: true,
          models: [{ id: 'm' }, 3],
        },
      ],
      defaultChoice: { scopeKind: 'workspace', scopeId: 'w', modelId: 'm' },
      defaultFallbackFrom: { scopeKind: 'nope' },
    });
    expect(options.options[0]).toMatchObject({
      label: 'w',
      models: [{ id: 'm', name: 'm' }],
      modelLocked: false,
    });
    expect(options.defaultChoice).toEqual({
      scopeKind: 'workspace',
      scopeId: 'w',
      modelId: 'm',
    });
    expect(options.defaultFallbackFrom).toBeNull();
  });
});

describe('client', () => {
  it.each([401, 403, 404])(
    'preserves HTML access status %s for the viewer',
    async status => {
      const api = createReportDeckApi(
        { gql: vi.fn() } as never,
        BASE,
        async () => new Response('', { status })
      );
      await expect(api.fetchHtml('deck-1')).rejects.toMatchObject({ status });
    }
  );

  it('sends GraphQL documents and fetches owner HTML with cookies', async () => {
    const gql = vi.fn(async ({ query }: { query: { op: string } }) => ({
      [query.op]:
        query.op === 'reportDeck'
          ? { id: 'deck-1', status: 'ready' }
          : query.op === 'reportDeckCommand'
            ? { deck: { id: 'deck-2' } }
            : {},
    }));
    const fetcher = vi.fn(
      async () => new Response('<html></html>', { status: 200 })
    );
    const api = createReportDeckApi({ gql } as never, BASE, fetcher);
    await expect(api.get('deck-1')).resolves.toMatchObject({ id: 'deck-1' });
    await expect(api.get('deck-x')).rejects.toThrow();
    const sources = [
      {
        scopeKind: 'project' as const,
        scopeId: 'p',
        kind: 'project_all' as const,
      },
    ];
    await api.preflight(sources);
    expect(gql).toHaveBeenLastCalledWith(
      expect.objectContaining({ variables: { input: { sources } } })
    );
    await expect(
      api.command({ operation: 'cancel', deckId: 'deck-2' })
    ).resolves.toMatchObject({
      deck: { id: 'deck-2' },
    });
    await expect(api.fetchHtml('a/b')).resolves.toBe('<html></html>');
    expect(fetcher).toHaveBeenCalledWith(
      `${BASE}/api/report-decks/a%2Fb/html`,
      expect.objectContaining({ credentials: 'include' })
    );
    expect(api.htmlUrl('d', true)).toBe(
      `${BASE}/api/report-decks/d/html?download=1`
    );
  });

  it('maps share open responses', async () => {
    const respond = (status: number, body: unknown) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status }));
    await expect(
      openDeckShare(
        BASE,
        's',
        { token: 't' },
        respond(200, { title: 'T', allowDownload: true, slideCount: 8 })
      )
    ).resolves.toEqual({
      status: 'ok',
      title: 'T',
      allowDownload: true,
      slideCount: 8,
    });
    await expect(
      openDeckShare(
        BASE,
        's',
        { token: 't' },
        respond(401, { code: 'password_required' })
      )
    ).resolves.toEqual({ status: 'password_required' });
    await expect(
      openDeckShare(
        BASE,
        's',
        { token: 't' },
        respond(410, { code: 'revoked' })
      )
    ).resolves.toEqual({ status: 'revoked' });
    await expect(
      openDeckShare(BASE, 's', { token: 't' }, respond(410, {}))
    ).resolves.toEqual({
      status: 'expired',
    });
    const fetcher = respond(200, {});
    await openDeckShare(BASE, 's', { token: 't', password: 'pw' }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      `${BASE}/api/deck-shares/s`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 't', password: 'pw' }),
      })
    );
    await expect(
      openDeckShare(
        BASE,
        's',
        { token: 't' },
        vi.fn(async () => {
          throw new Error('x');
        })
      )
    ).resolves.toEqual({ status: 'error' });
  });
});

describe('local persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it('remembers preferences but never sources, AI, title or instructions', () => {
    saveLastDeckConfig({
      mode: 'custom',
      customStyle: '深色',
      accentColor: '#112233',
      length: 'long',
      instructions: 'secret',
      title: 'T',
      ai: { scopeKind: 'workspace', scopeId: 'w' },
      preferences: { charts: false },
    });
    const raw = JSON.parse(localStorage.getItem(LAST_CONFIG_KEY) ?? '{}');
    expect(raw.instructions).toBeUndefined();
    expect(raw.title).toBeUndefined();
    expect(raw.ai).toBeUndefined();
    expect(loadLastDeckConfig()).toEqual({
      mode: 'custom',
      customStyle: '深色',
      accentColor: '#112233',
      length: 'long',
      preferences: { charts: false },
    });
    localStorage.setItem(
      LAST_CONFIG_KEY,
      '{"mode":"evil","accentColor":"red","tone":"vivid"}'
    );
    expect(loadLastDeckConfig()).toEqual({ tone: 'vivid' });
    localStorage.setItem(LAST_CONFIG_KEY, 'not json');
    expect(loadLastDeckConfig()).toEqual({});
  });

  it('hands sources over through sessionStorage', () => {
    const path = stashDeckSources([
      { scopeKind: 'project', scopeId: 'p', kind: 'project_all' },
    ]);
    const id = new URL(path, BASE).searchParams.get('handoff');
    expect(readDeckSources(id)).toEqual([
      { scopeKind: 'project', scopeId: 'p', kind: 'project_all' },
    ]);
  });
});

it('preserves real design subphases and bounded quality metadata without requiring them on old reports', () => {
  const quality = {
    version: 'report-web-v3',
    artifactHash: 'a'.repeat(64),
    visual: 'partial',
    warnings: ['visual_partial'],
    checkedCaptures: 4,
    totalCaptures: 8,
    repairs: 1,
  };
  const result = readDeckDetail({
    id: 'v3',
    status: 'generating',
    progress: { phase: 'render', subphase: 'reviewing', done: 1, total: 2 },
    quality,
  });
  expect(result.progress?.subphase).toBe('reviewing');
  expect(result.quality).toEqual(quality);
  expect(
    readDeckDetail({ id: 'old', status: 'ready' }).quality
  ).toBeUndefined();
  expect(
    readDeckDetail({
      id: 'bad',
      quality: { ...quality, screenshotUrl: 'private' },
    }).quality
  ).toBeUndefined();
});
