import { randomUUID } from 'node:crypto';

import type { DeckDesignMode } from '@localmind/office/report-deck';
import type { ModuleRef } from '@nestjs/core';
import test from 'ava';

import type { Config } from '../../base';
import { ReportDeckService } from '../../core/report-deck/service';
import type { ReportDeckShareService } from '../../core/report-deck/share';
import type { ReportDeckSourceService } from '../../core/report-deck/sources';
import type { Models } from '../../models';
import type {
  ReportDeckCreateInput,
  ReportDeckRecord,
} from '../../models/report-deck';
import { ReportDeckAiService } from '../../plugins/copilot/report-deck-ai';

function fixture(webRefine: boolean) {
  const rows = new Map<string, ReportDeckRecord>();
  const queued: Array<[string, number]> = [];
  const config = {
    reportDecks: {
      enabled: true,
      customDesignV3: true,
      webRefine,
      maxSources: 200,
      maxConcurrentPerUser: 2,
    },
  } as Config;
  const models = {
    reportDeck: {
      findByRequestKey: async (_owner: string, key: string) =>
        [...rows.values()].find(row => row.requestKey === key),
      countActive: async () => 0,
      get: async (owner: string, id: string) => {
        const row = rows.get(id);
        return row?.ownerUserId === owner ? row : null;
      },
      create: async (input: ReportDeckCreateInput) => {
        const row = {
          ...input,
          id: randomUUID(),
          status: 'queued',
          runAttempt: 0,
          progress: {},
          quality: null,
          slideCount: null,
          errorCode: null,
          createdAt: new Date(),
          completedAt: null,
          shares: [],
          sources: input.sources,
        } as unknown as ReportDeckRecord;
        rows.set(row.id, row);
        return { deck: row, created: true };
      },
      retry: async (_owner: string, id: string) => {
        const row = rows.get(id)!;
        row.runAttempt++;
        row.status = 'queued';
        return row.runAttempt;
      },
      list: async () => ({ items: [...rows.values()], next: null }),
    },
  } as unknown as Models;
  const ai = {
    resolve: async () => ({ scopeKind: 'workspace', scopeId: 'workspace' }),
  };
  const ref = {
    get: (type: unknown) =>
      type === ReportDeckAiService
        ? ai
        : {
            enqueue: async (id: string, attempt: number) => {
              queued.push([id, attempt]);
            },
          },
  } as unknown as ModuleRef;
  const sources = {
    resolve: async (_owner: string, refs: unknown[]) =>
      refs.map(ref => ({
        ref,
        status: 'included',
        title: 'Fixture',
        chars: 100,
      })),
    scopeLabels: async () => () => 'Fixture',
  } as unknown as ReportDeckSourceService;
  const service = new ReportDeckService(
    models,
    ref,
    sources,
    {} as ReportDeckShareService,
    config
  );
  const create = (designMode?: DeckDesignMode, key = randomUUID()) =>
    service.command('owner', {
      operation: 'create',
      requestKey: key,
      config: { mode: 'custom', ...(designMode ? { designMode } : {}) },
      sources: [
        {
          scopeKind: 'workspace',
          scopeId: 'workspace',
          kind: 'doc',
          resourceId: 'doc',
        },
      ],
    });
  return { service, config, rows, queued, create };
}

for (const mode of ['fast', 'refine'] as const) {
  test(`explicit ${mode} overrides the opposite global default and survives retries`, async t => {
    const f = fixture(mode === 'fast');
    const key = randomUUID();
    const result = await f.create(mode, key);
    if (!('deck' in result)) return t.fail('missing deck');
    t.is(result.deck.config.designMode, mode);
    t.is(result.deck.designMode, mode);
    f.config.reportDecks.webRefine = !f.config.reportDecks.webRefine;
    await f.create(mode, key);
    t.is(f.rows.size, 1);
    t.is(f.queued.length, 1);
    const row = f.rows.get(result.deck.id)!;
    row.status = 'failed';
    const retry = await f.service.command('owner', {
      operation: 'retry',
      deckId: row.id,
    });
    t.true('deck' in retry && retry.deck.config.designMode === mode);
    t.deepEqual(f.queued.at(-1), [row.id, 1]);
    const history = await f.service.list('owner', {});
    t.is(history.items[0].designMode, mode);
    await t.throwsAsync(f.service.detail('other', row.id));
  });
}

test('legacy client default is frozen at creation and regeneration starts fast', async t => {
  const f = fixture(true);
  const result = await f.create();
  if (!('deck' in result)) return t.fail('missing deck');
  t.is(result.deck.designMode, 'refine');
  f.config.reportDecks.webRefine = false;
  t.is((await f.service.detail('owner', result.deck.id)).designMode, 'refine');
  const regenerated = await f.service.command('owner', {
    operation: 'regenerate',
    deckId: result.deck.id,
    requestKey: randomUUID(),
  });
  t.true('deck' in regenerated && regenerated.deck.designMode === 'fast');
  f.rows.get(result.deck.id)!.config = { mode: 'custom' };
  t.is((await f.service.detail('owner', result.deck.id)).designMode, undefined);
});

test('unsupported modes and a disabled custom pipeline reject before enqueue', async t => {
  const f = fixture(false);
  f.config.reportDecks.customDesignV3 = false;
  await t.throwsAsync(f.create('refine'));
  t.is(f.queued.length, 0);
  t.is(f.rows.size, 0);
});
