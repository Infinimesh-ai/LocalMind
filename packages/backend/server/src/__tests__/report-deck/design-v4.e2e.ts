import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import {
  DeckConfigSchema,
  type ReportExperiencePlan,
} from '@localmind/office/report-deck';
import {
  V4_PLAN,
  v4Artifact,
} from '@localmind/office/report-deck/web-v4.fixture';
import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { Config, type JobQueue } from '../../base';
import type { ReportDeckSourceService } from '../../core/report-deck/sources';
import { Models } from '../../models';
import { reportHash, reportJson } from '../../models/report-deck-design';
import type { ReportDeckAiService } from '../../plugins/copilot/report-deck-ai';
import { ReportWebGenerationService } from '../../plugins/copilot/report-web-design/generation';
import { REPORT_WEB_V4_PROMPTS } from '../../plugins/copilot/report-web-design/prompts-v4';
import { ReportWebRenderer } from '../../plugins/copilot/report-web-design/renderer';
import type { PromptRuntime } from '../../plugins/copilot/runtime/prompt-runtime';
import { createTestingApp, type TestingApp } from '../utils';

const enabled = process.env.LOCALMIND_REPORT_DESIGN_ISOLATED === 'yes';
const isolated = enabled ? test.serial : test.skip;
let module: TestingApp, models: Models, db: PrismaClient;
test.before(async () => {
  if (!enabled) return;
  if (
    !process.env.DATABASE_URL?.includes('localmind_report_v3_postgres') &&
    new URL(process.env.DATABASE_URL ?? 'postgres://invalid/').pathname !==
      '/qa_repair_20261026'
  )
    throw new Error('Disposable report test database required');
  module = await createTestingApp();
  models = module.get(Models);
  db = module.get(PrismaClient);
});
test.after.always(async () => {
  if (module) await module.close();
});

const SOURCE =
  'Atlas 季度报告（虚构材料）。一季度营收 412 万元。二季度营收 468 万元。三季度营收 530 万元。2026 年 10 月的原型验收共有 12 项检查，其中 9 项通过，3 项仍待修复。移动端长表格仍有溢出风险。下一阶段计划修复剩余 3 项检查，然后再讨论发布。';
const QUOTES: Record<string, string> = {
  'f-total':
    '2026 年 10 月的原型验收共有 12 项检查，其中 9 项通过，3 项仍待修复。',
  'f-q1': '一季度营收 412 万元',
  'f-q2': '二季度营收 468 万元',
  'f-q3': '三季度营收 530 万元',
  'f-risk': '移动端长表格仍有溢出风险。',
  'f-next': '下一阶段计划修复剩余 3 项检查，然后再讨论发布。',
};
const KIND: Record<string, string> = {
  'f-total': 'number',
  'f-q1': 'number',
  'f-q2': 'number',
  'f-q3': 'number',
  'f-risk': 'risk',
  'f-next': 'decision',
};

const sources = {
  resolve: async () => [
    {
      index: 0,
      title: 'Fixture',
      status: 'included',
      reason: null,
      chars: SOURCE.length,
      documents: [{ title: 'Fixture', role: 'document', text: SOURCE }],
    },
  ],
} as unknown as ReportDeckSourceService;

/** Rewrites fixture ids to the grounded fact/dataset ids of this run. */
function mapIds(
  text: string,
  facts: Array<{ id: string; quote: string }>,
  datasets: Array<{ id: string; title: string }>
) {
  let out = text;
  for (const [fixture, quote] of Object.entries(QUOTES)) {
    const id = facts.find(f => f.quote === quote)?.id;
    if (id)
      out = out
        .replaceAll(`"${fixture}"`, `"${id}"`)
        .replaceAll(`${fixture} `, `${id} `)
        .replaceAll(` ${fixture}"`, ` ${id}"`);
  }
  for (const d of datasets)
    out = out.replaceAll(
      d.title.includes('营收') ? '"ds-revenue"' : '"ds-checks"',
      `"${d.id}"`
    );
  return out;
}

const refineScenario = test.macro(
  async (
    t,
    reviewOutcome: 'complete' | 'failed' | 'partial' | 'count' | 'no-vision'
  ) => {
    t.timeout(300000);
    const deck = await db.reportDeck.create({
      data: {
        ownerUserId: randomUUID(),
        title: 'Atlas',
        mode: 'custom',
        config: reportJson(
          DeckConfigSchema.parse({
            mode: 'custom',
            designMode: 'refine',
            length: 'standard',
            language: 'zh-CN',
            ...(reviewOutcome === 'count'
              ? { instructions: '用3个章节呈现' }
              : {}),
          })
        ),
        aiScopeKind: 'workspace',
        aiScopeId: randomUUID(),
        generationVersion: 3,
        sources: {
          create: {
            position: 0,
            scopeKind: 'workspace',
            scopeId: 'fixture',
            kind: 'doc',
            resourceId: 'source',
            titleSnapshot: 'Fixture',
          },
        },
      },
    });
    const calls: string[] = [];
    const contents: Record<string, string[]> = {};
    let plans = 0;
    let critiques = 0;
    const runtime = {
      snapshot: async (name: string) => ({
        name,
        source: 'registry',
        messages: [
          {
            role: 'system',
            content: REPORT_WEB_V4_PROMPTS.find(p => p.name === name)!.system,
          },
        ],
      }),
      runStructured: async (name: string, params: { content: string }) =>
        respond(name, params.content, true),
      runText: async (
        name: string,
        params: { content: string },
        options: { attachments?: unknown[] }
      ) => {
        if (reviewOutcome === 'no-vision' && name.includes('Repair'))
          t.is(
            options.attachments?.length,
            0,
            'a failed visual probe must fall back to text-only repair'
          );
        return respond(name, params.content, false);
      },
    } as unknown as PromptRuntime;
    async function respond(
      name: string,
      content: string,
      structured: boolean
    ): Promise<unknown> {
      calls.push(name);
      if (reviewOutcome === 'no-vision' && name.includes('Vision'))
        throw new Error('Fixture image input unavailable');
      if (
        (reviewOutcome === 'failed' && /Critique|Motion/.test(name)) ||
        (reviewOutcome === 'partial' && name.includes('Motion'))
      )
        throw new Error('Fixture image review unavailable');
      (contents[name] ??= []).push(content);
      const data = JSON.parse(content).data;
      const wrap = (value: unknown) =>
        structured ? { value } : JSON.stringify(value);
      if (name.includes('Facts'))
        return wrap({
          facts: Object.entries(QUOTES).map(([key, quote], i) => ({
            ref: `f${i + 1}`,
            doc: 0,
            text: quote,
            quote,
            kind: KIND[key],
            status: key === 'f-next' ? 'planned' : 'completed',
            timeScope: null,
            quantities: [],
            salience: key === 'f-total' ? 'headline' : 'key',
            section: null,
          })),
          datasets: [
            {
              ref: 'revenue',
              title: '2026 年前三季度营收',
              unit: '万元',
              kind: 'series',
              rows: [
                { label: '一季度', value: '412', fact: 'f2' },
                { label: '二季度', value: '468', fact: 'f3' },
                { label: '三季度', value: '530', fact: 'f4' },
              ],
            },
            {
              ref: 'checks',
              title: '原型验收检查状态',
              unit: '项',
              kind: 'status_count',
              rows: [
                { label: '通过', value: '9', fact: 'f1' },
                { label: '待修复', value: '3', fact: 'f1' },
              ],
            },
          ],
          relations: [
            { type: 'sequence', from: 'f1', to: 'f6', evidence: 'f6' },
          ],
        });
      if (name.includes('Plan')) {
        plans++;
        const plan = JSON.parse(
          mapIds(
            JSON.stringify(V4_PLAN),
            data.evidence.facts,
            data.evidence.datasets
          )
        ) as ReportExperiencePlan;
        // The first plan repeats a layout; the lint feedback must fix it.
        if (plans === 1) plan.chapters[2].layout.archetype = 'figure-dominant';
        return wrap(plan);
      }
      if (name.includes('Build')) {
        const art = v4Artifact();
        if (reviewOutcome === 'no-vision')
          art.sharedCss += '.rd-hidden{opacity:0}';
        const text =
          `<rd-shared>${art.sharedCss}</rd-shared>\n` +
          art.chapters
            .map(
              ch =>
                `<rd-chapter id="${ch.id}">${reviewOutcome === 'no-vision' ? ch.html.replace('<h2>', '<h2 class="rd-hidden">') : ch.html}<style>${ch.css}</style></rd-chapter>`
            )
            .join('\n');
        return mapIds(text, data.evidence.facts, data.evidence.datasets);
      }
      if (name.includes('Critique')) {
        critiques++;
        return wrap({
          artifactHash: data.artifactHash,
          observed: data.captures.map((c: { id: string }) => c.id),
          verdict: critiques === 1 ? 'improve' : 'ship',
          assessment: Object.fromEntries(
            [
              'narrative',
              'composition',
              'typography',
              'charts',
              'responsive',
            ].map(k => [
              k,
              { result: 'met', evidence: 'Observed in the sheet.' },
            ])
          ),
          moves:
            critiques === 1
              ? [
                  {
                    id: 'merge-thin',
                    rank: 1,
                    chapterIds: ['rd-c-trend', 'rd-c-checks'],
                    dimension: 'narrative',
                    severity: 'must',
                    problem: 'The checks chapter repeats the opening numbers.',
                    why: 'Readers see the same evidence twice.',
                    move: 'Merge the checks into the trend chapter as a second view.',
                    evidence: 'sheet-desktop 3',
                  },
                ]
              : [],
          strengths: ['The opening has one clear focal point.'],
        });
      }
      if (name.includes('Motion'))
        return wrap({
          artifactHash: data.artifactHash,
          observed: data.captures.map((c: { id: string }) => c.id),
          verdict: 'ship',
          assessment: {
            motion: { result: 'met', evidence: 'Line draws before labels.' },
            interaction: {
              result: 'met',
              evidence: 'Tabs work with keyboard.',
            },
          },
          moves: [],
          brokenBehaviors: data.behaviors
            .filter((b: { ok: boolean }) => !b.ok)
            .map((b: { id: string }) => b.id),
          strengths: [],
        });
      if (name.includes('Repair')) {
        if (
          reviewOutcome === 'no-vision' ||
          (reviewOutcome === 'count' &&
            JSON.parse(content).previousError?.includes('exactly 3 chapters'))
        )
          return (
            `<rd-repair>{"ops":[],"addressed":[],"unresolved":[]}</rd-repair>` +
            data.chapters
              .map(
                (ch: { id: string; html: string; css: string }) =>
                  `<rd-chapter id="${ch.id}">${ch.html.replace('class="rd-hidden"', '')}<style>${ch.css}</style></rd-chapter>`
              )
              .join('')
          );
        const trend = data.chapters.find(
          (c: { id: string }) => c.id === 'rd-c-trend'
        ).html as string;
        const checks = data.chapters.find(
          (c: { id: string }) => c.id === 'rd-c-checks'
        ).html as string;
        const body = checks
          .replace(/^<section[^>]*>/, '')
          .replace(/<\/section>$/, '')
          .replace('<h2>剩余三项检查决定发布节奏</h2>', '<h3>剩余三项检查</h3>')
          .replace(
            'data-rd-chart="rd-c-checks-units"',
            'data-rd-chart="rd-c-trend-units"'
          );
        const merged = trend.replace('</section>', `${body}</section>`);
        return `<rd-repair>${JSON.stringify({ ops: [{ op: 'mergeChapters', into: 'rd-c-trend', from: 'rd-c-checks' }], addressed: ['merge-thin'], unresolved: [] })}</rd-repair>\n<rd-chapter id="rd-c-trend">${merged}<style>.rd-merged{display:grid}</style></rd-chapter>`;
      }
      if (name.includes('Compare'))
        return wrap({
          preferred: data.A.chapters === 2 ? 'A' : 'B',
          confidence: 'high',
          reasons: ['The merged report removes the repeated evidence.'],
          regressions: [],
        });
      throw new Error(`Unexpected stage ${name}`);
    }
    const ai = {
      assertUsable: async () => {},
      designCapabilities: async () => ({
        modelId: 'fixture',
        vision: reviewOutcome !== 'no-vision',
        structured: true,
        contextWindow: 200000,
      }),
      providerOptions: () => ({ providerOptions: {} }),
    } as unknown as ReportDeckAiService;
    const settings = {
      reportDecks: {
        maxModelCalls: 40,
        maxHtmlBytes: 5 * 1024 * 1024,
        rendererExecutablePath: '/usr/bin/chromium',
        webRefine: false,
      },
    } as Config;
    const service = new ReportWebGenerationService(
      models,
      sources,
      ai,
      runtime,
      new ReportWebRenderer(settings),
      settings,
      {} as JobQueue
    );
    if (reviewOutcome !== 'complete') {
      await service.generate(deck.id, 0);
      const row = await db.reportDeck.findUniqueOrThrow({
        where: { id: deck.id },
      });
      t.is(row.status, 'ready', row.errorCode ?? '');
      if (reviewOutcome === 'count') {
        t.is(row.slideCount, 3);
        t.true(
          contents['Report Web Repair v4'].some(value =>
            value.includes('exactly 3 chapters')
          )
        );
        return;
      }
      const quality = row.quality as {
        visual: string;
        warnings: string[];
        checkedCaptures: number;
      };
      t.is(
        quality.visual,
        reviewOutcome === 'failed' || reviewOutcome === 'no-vision'
          ? 'unavailable'
          : 'partial'
      );
      t.true(
        quality.warnings.includes(
          reviewOutcome === 'failed' || reviewOutcome === 'no-vision'
            ? 'visual_unavailable'
            : 'visual_partial'
        )
      );
      t.is((row.usage as { mode: string }).mode, 'refine');
      if (reviewOutcome === 'failed' || reviewOutcome === 'no-vision')
        t.is(quality.checkedCaptures, 0);
      else t.true(quality.checkedCaptures > 0);
      return;
    }
    const complete = models.reportDeckDesign.complete.bind(
      models.reportDeckDesign
    );
    const fail = models.reportDeckDesign.fail.bind(models.reportDeckDesign);
    models.reportDeckDesign.complete = async () => {
      throw new Error('Simulated interruption before publication');
    };
    models.reportDeckDesign.fail = async () => {};
    try {
      await service.generate(deck.id, 0);
    } finally {
      models.reportDeckDesign.complete = complete;
      models.reportDeckDesign.fail = fail;
    }
    const run = await models.reportDeckDesign.existing(deck.id, 0);
    t.is(
      (run?.snapshot as { version?: string } | undefined)?.version,
      'report-web-v4'
    );
    t.is(plans, 2, 'plan lint feedback triggers one corrective call');
    t.true(
      contents['Report Web Plan v4'][1].includes(
        'repeats the figure-dominant layout'
      )
    );
    await db.reportDeckRun.update({
      where: { id: run!.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const before = calls.length;
    await service.generate(deck.id, 0);
    t.deepEqual(
      calls.slice(before),
      [],
      'resume reuses every checkpoint, screenshot and review'
    );
    const row = await db.reportDeck.findUniqueOrThrow({
      where: { id: deck.id },
    });
    t.is(row.status, 'ready', row.errorCode ?? '');
    const html = gunzipSync(row.htmlGzip!).toString();
    const quality = row.quality as {
      version: string;
      artifactHash: string;
      repairs: number;
      visual: string;
      experience: {
        behaviorsVerified: number;
        motion: string;
        charts: number;
      };
    };
    t.is(quality.version, 'report-web-v4');
    t.is(quality.artifactHash, reportHash(html));
    t.is(quality.repairs, 1);
    t.is(quality.visual, 'complete');
    t.is(
      row.slideCount,
      2,
      'the structural repair merged the repeated chapter'
    );
    t.is(quality.experience.motion, 'verified');
    t.true(quality.experience.behaviorsVerified >= 3);
    t.is(quality.experience.charts, 2);
    t.true(html.includes('data-content-root="rd-custom-v4"'));
    t.true(html.includes('rd-chart--unit'));
    t.true(calls.includes('Report Web Compare v4'));
    const usage = row.usage as {
      formatRetries: number;
      behaviors: Array<{ ok: boolean }>;
    };
    t.true(usage.formatRetries >= 1);
    t.true(usage.behaviors.every(b => b.ok));
  }
);
for (const reviewOutcome of [
  'complete',
  'failed',
  'partial',
  'count',
  'no-vision',
] as const)
  isolated(
    `v4 refine: ${reviewOutcome} review, explicit mode, browser checks and recovery`,
    refineScenario,
    reviewOutcome
  );

isolated(
  'v4 fast path: parallel chapters on rd-kit, browser-found overflow regenerates one chapter, no model review',
  async t => {
    t.timeout(300000);
    const deck = await db.reportDeck.create({
      data: {
        ownerUserId: randomUUID(),
        title: 'Atlas fast',
        mode: 'custom',
        config: reportJson(
          DeckConfigSchema.parse({
            mode: 'custom',
            designMode: 'fast',
            length: 'standard',
            language: 'zh-CN',
          })
        ),
        aiScopeKind: 'workspace',
        aiScopeId: randomUUID(),
        generationVersion: 3,
        sources: {
          create: {
            position: 0,
            scopeKind: 'workspace',
            scopeId: 'fixture',
            kind: 'doc',
            resourceId: 'source',
            titleSnapshot: 'Fixture',
          },
        },
      },
    });
    const calls: string[] = [];
    const chapterCalls: Record<string, number> = {};
    const respond = async (
      name: string,
      content: string,
      structured: boolean
    ) => {
      calls.push(name);
      const data = JSON.parse(content).data;
      const wrap = (value: unknown) =>
        structured ? { value } : JSON.stringify(value);
      if (name.includes('Facts'))
        return wrap({
          facts: Object.entries(QUOTES).map(([key, quote], i) => ({
            ref: `f${i + 1}`,
            doc: 0,
            text: '',
            quote,
            kind: KIND[key],
            status: key === 'f-next' ? 'planned' : 'completed',
            timeScope: null,
            quantities: [],
            salience: key === 'f-total' ? 'headline' : 'key',
            section: null,
          })),
          datasets: [
            {
              ref: 'revenue',
              title: '2026 年前三季度营收',
              unit: '万元',
              kind: 'series',
              rows: [
                { label: '一季度', value: '412', fact: 'f2' },
                { label: '二季度', value: '468', fact: 'f3' },
                { label: '三季度', value: '530', fact: 'f4' },
              ],
            },
            {
              ref: 'checks',
              title: '原型验收检查状态',
              unit: '项',
              kind: 'status_count',
              rows: [
                { label: '通过', value: '9', fact: 'f1' },
                { label: '待修复', value: '3', fact: 'f1' },
              ],
            },
          ],
          relations: [],
        });
      if (name.includes('Plan'))
        return wrap(
          JSON.parse(
            mapIds(
              JSON.stringify(V4_PLAN),
              data.evidence.facts,
              data.evidence.datasets
            )
          )
        );
      if (name.includes('Chapter')) {
        const id = data.chapterId as string;
        chapterCalls[id] = (chapterCalls[id] ?? 0) + 1;
        const ch = v4Artifact().chapters.find(c => c.id === id)!;
        // The first draft of one chapter overflows the page; the browser must catch it.
        const css =
          id === 'rd-c-checks' && !data.previousIssues
            ? `${ch.css}.rd-overflow{width:2400px;min-width:2400px}`
            : ch.css;
        const html =
          id === 'rd-c-checks' && !data.previousIssues
            ? ch.html.replace('<h2>', '<h2 class="rd-overflow">')
            : ch.html;
        return mapIds(
          `<rd-chapter id="${id}">${html}<style>${css}</style></rd-chapter>`,
          data.evidence.facts,
          data.evidence.datasets
        );
      }
      throw new Error(`Unexpected stage ${name}`);
    };
    const runtime = {
      snapshot: async (name: string) => ({
        name,
        source: 'registry',
        messages: [
          {
            role: 'system',
            content: REPORT_WEB_V4_PROMPTS.find(p => p.name === name)!.system,
          },
        ],
      }),
      runStructured: async (name: string, params: { content: string }) =>
        respond(name, params.content, true),
      runText: async (name: string, params: { content: string }) =>
        respond(name, params.content, false),
    } as unknown as PromptRuntime;
    const ai = {
      assertUsable: async () => {},
      designCapabilities: async () => ({
        modelId: 'fixture',
        vision: false,
        structured: true,
        contextWindow: 32000,
        contextKnown: false,
      }),
      providerOptions: () => ({ providerOptions: {} }),
    } as unknown as ReportDeckAiService;
    const settings = {
      reportDecks: {
        maxModelCalls: 40,
        maxHtmlBytes: 5 * 1024 * 1024,
        rendererExecutablePath: '/usr/bin/chromium',
        webRefine: true,
      },
    } as Config;
    const service = new ReportWebGenerationService(
      models,
      sources,
      ai,
      runtime,
      new ReportWebRenderer(settings),
      settings,
      {} as JobQueue
    );
    const started = Date.now();
    await service.generate(deck.id, 0);
    const elapsed = Date.now() - started;
    const row = await db.reportDeck.findUniqueOrThrow({
      where: { id: deck.id },
    });
    t.is(row.status, 'ready', row.errorCode ?? '');
    t.deepEqual(chapterCalls, {
      'rd-c-open': 1,
      'rd-c-trend': 1,
      'rd-c-checks': 2,
    });
    t.false(
      calls.some(n => /Critique|Motion|Repair|Compare|Vision/.test(n)),
      'no model review on the fast path'
    );
    t.is(calls.length, 6);
    const html = gunzipSync(row.htmlGzip!).toString();
    t.true(html.includes('.rd-rail'), 'rd-kit ships with the page');
    t.false(html.includes('width:2400px'));
    const quality = row.quality as {
      warnings: string[];
      experience: { motion: string };
    };
    t.false(quality.warnings.includes('visual_unavailable'));
    t.is(quality.experience.motion, 'verified');
    t.is((row.usage as { mode: string }).mode, 'fast');
    t.is((row.quality as { visual: string }).visual, 'not_requested');
    t.log({ elapsedMsWithFakeModel: elapsed });
  }
);
