import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import {
  DeckConfigSchema,
  renderReportArtifact,
  type ReportArtifact,
  type ReportDesignPlan,
} from '@localmind/office/report-deck';
import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { Config, type JobQueue } from '../../base';
import type { ReportDeckSourceService } from '../../core/report-deck/sources';
import { Models } from '../../models';
import { reportHash, reportJson } from '../../models/report-deck-design';
import type { ReportDeckAiService } from '../../plugins/copilot/report-deck-ai';
import { ReportWebGenerationService } from '../../plugins/copilot/report-web-design/generation';
import { REPORT_DESIGN_PROMPTS } from '../../plugins/copilot/report-web-design/prompts';
import { ReportWebRenderer } from '../../plugins/copilot/report-web-design/renderer';
import type { PromptRuntime } from '../../plugins/copilot/runtime/prompt-runtime';
import { createTestingApp, type TestingApp } from '../utils';

const enabled = process.env.LOCALMIND_REPORT_DESIGN_ISOLATED === 'yes';
const isolated = enabled ? test.serial : test.skip;
let module: TestingApp, models: Models, db: PrismaClient;
test.before(async () => {
  if (!enabled) return;
  if (!process.env.DATABASE_URL?.includes('localmind_report_v3_postgres'))
    throw new Error('Disposable report test database required');
  module = await createTestingApp();
  models = module.get(Models);
  db = module.get(PrismaClient);
});
test.after.always(async () => {
  if (module) await module.close();
});
const config = DeckConfigSchema.parse({
  mode: 'custom',
  length: 'short',
  language: 'en',
});
async function createDeck(length: 'short' | 'long' = 'short') {
  return db.reportDeck.create({
    data: {
      ownerUserId: randomUUID(),
      title: 'Synthetic Atlas',
      mode: 'custom',
      config: reportJson({ ...config, length }),
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
}

isolated(
  'lease fencing, persisted budgets, immutable checkpoints, cancellation and retention',
  async t => {
    const deck = await createDeck();
    const model = models.reportDeckDesign;
    const first = await model.claim(deck.id, 0, { version: 'fixture' }, 60000);
    t.truthy(first);
    if (!first) return;
    t.is(await model.claim(deck.id, 0, {}, 60000), null);
    const step = await model.reserveCall(first, 'Build', 'a'.repeat(64), 10, 2);
    await model.saveJson(first, 'plan', 'a'.repeat(64), { selected: true });
    await t.throwsAsync(
      model.saveJson(first, 'plan', 'a'.repeat(64), { selected: false })
    );
    await t.throwsAsync(
      db.reportDeckRun.update({
        where: { id: first.id },
        data: { snapshot: {} },
      })
    );
    await db.reportDeckRun.update({
      where: { id: first.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await model.fail(first, 'internal');
    t.is(
      (await db.reportDeck.findUniqueOrThrow({ where: { id: deck.id } }))
        .status,
      'generating'
    );
    const next = await model.claim(deck.id, 0, { ignored: true }, 60000);
    t.truthy(next);
    if (!next) return;
    t.is(next.fence, first.fence + 1);
    t.deepEqual(next.snapshot, { version: 'fixture' });
    t.is(
      (await db.reportDeckStep.findUniqueOrThrow({ where: { id: step.id } }))
        .status,
      'outcome_unknown'
    );
    await t.throwsAsync(
      model.progress(first, { phase: 'compose', done: 1, total: 1 })
    );
    t.deepEqual(await model.readJson(next, 'plan', 'a'.repeat(64)), {
      selected: true,
    });
    const results = await Promise.allSettled([
      model.reserveCall(next, 'Review', 'b'.repeat(64), 10, 2),
      model.reserveCall(next, 'Review', 'c'.repeat(64), 10, 2),
    ]);
    t.is(results.filter(r => r.status === 'fulfilled').length, 1);
    t.true(await model.reserveCorrection(next, 'repairs', 'repair-one'));
    t.true(await model.reserveCorrection(next, 'repairs', 'repair-one'));
    t.true(await model.reserveCorrection(next, 'repairs', 'repair-two'));
    t.false(await model.reserveCorrection(next, 'repairs'));
    await models.reportDeck.cancel(deck.ownerUserId, deck.id);
    await t.throwsAsync(model.heartbeat(next));
    await t.throwsAsync(model.saveJson(next, 'late', 'd'.repeat(64), {}));
    await model.cleanup();
    t.is((await model.existing(deck.id, 0))?.status, 'cancelled');
  }
);

const text =
  'The fictional Atlas prototype passed 12 checks. The release remains planned.';
const sources = {
  resolve: async () => [
    {
      index: 0,
      title: 'Fixture',
      status: 'included',
      reason: null,
      chars: text.length,
      documents: [{ title: 'Fixture', role: 'document', text }],
    },
  ],
} as unknown as ReportDeckSourceService;
function planFor(facts: Array<{ id: string }>, count = 3): ReportDesignPlan {
  return {
    title: 'Atlas validation',
    reportThesis: 'Evidence before release',
    directions: ['editorial', 'technical', 'briefing'].map(id => ({
      id,
      rationale: 'Fit the evidence',
      composition: 'Typographic hierarchy',
      typography: 'Readable system font',
    })),
    selectedDirection: 'editorial',
    selectionReason: 'Clear evidence hierarchy',
    designTokens: {
      palette: 'Ink and ivory with orange accent',
      typography: 'System sans, body 18px',
      spacing: 'Generous chapter rhythm',
      motion: 'None',
    },
    chapters: Array.from({ length: count }, (_, i) => ({
      id: `rd-c-${i + 1}`,
      title: ['Evidence', 'Release status', 'Next decision'][i % 3],
      task: 'Explain evidence',
      conclusion: 'Release is planned',
      factIds: facts.map(f => f.id),
      composition: 'Editorial flow',
      visualSubject: 'Evidence statement',
      mobileLayout: 'Single column',
      density: 'low' as const,
    })),
    requiredFactIds: facts.map(f => f.id),
    omittedFactIds: [],
    variationPlan: 'Lead with evidence, then decision',
    artDirection: {
      concept: 'Evidence poster',
      signatureMove: 'A measured evidence composition',
      palette: {
        canvas: '#f4f0e8',
        ink: '#17251f',
        accent: '#934123',
        contrastSurface: '#17251f',
        contrastInk: '#f4f0e8',
      },
      typography: {
        displayFamily: 'Noto Sans CJK SC',
        bodyFamily: 'Noto Sans CJK SC',
        numeralFamily: 'Georgia',
        displaySize: '64px / 36px',
        sectionSize: '36px / 28px',
        bodySize: '18px',
        labelSize: '14px',
        weightAndLineHeight: '700/1.1, 400/1.7',
      },
      chapterTreatments: Array.from({ length: count }, (_, i) => ({
        chapterId: `rd-c-${i + 1}`,
        layout: i ? 'Evidence flow' : 'Asymmetric opening',
        surface: 'Ivory',
        focalPoint: 'Verified statement',
        contrastToPrevious: i ? 'Change evidence layout' : 'Opening',
      })),
      charts: [
        {
          chapterId: 'rd-c-2',
          factIds: facts.map(f => f.id),
          encoding: 'Evidence relationship',
          visualSpec: 'Use the stated evidence',
          scaleRules: 'No unsupported quantities',
          annotation: 'Release remains planned',
        },
      ],
    },
  };
}
function artifactFor(
  plan: ReportDesignPlan,
  planHash: string,
  ids = plan.chapters.map(ch => ch.id)
): ReportArtifact {
  return {
    schemaVersion: 'report-web-v3',
    planHash,
    title: plan.title,
    sharedCss:
      '[data-content-root="rd-custom-v3"]{background:#f4f0e8;color:#17251f} .rd-body{font-size:18px;line-height:1.7} .rd-title{font-size:clamp(32px,5vw,64px);line-height:1.1}',
    chapters: ids.map(id => ({
      id,
      html: `<section class="slide rd-section" id="${id}" data-slide data-chapter-id="${id}"><h1 class="rd-title">${plan.chapters.find(ch => ch.id === id)!.title}</h1><p class="rd-body" id="${id}-fact">${text}</p></section>`,
      css: '.rd-section{padding:48px 32px}.rd-body{max-width:55ch}',
      factIds: plan.requiredFactIds,
      claims: [
        { elementId: `${id}-fact`, text, factIds: plan.requiredFactIds },
      ],
    })),
  };
}

for (const chapterCount of [3, 8]) {
  isolated(
    `one submission: ${chapterCount} chapters, repair, shared-style changes and checkpoint recovery`,
    async t => {
      t.timeout(120000);
      const deck = await createDeck(chapterCount > 6 ? 'long' : 'short');
      const calls: string[] = [];
      const runtime = {
        snapshot: async (name: string) => ({
          name,
          source: 'registry',
          messages: [
            {
              role: 'system',
              content: REPORT_DESIGN_PROMPTS.find(p => p.name === name)!.system,
            },
          ],
        }),
        runStructured: async (name: string, params: { content: string }) => {
          calls.push(name);
          const data = JSON.parse(params.content).data;
          if (name.includes('Facts'))
            return {
              value: {
                facts: [
                  {
                    doc: 0,
                    text,
                    quote: text,
                    kind: 'fact',
                    status: 'planned',
                    timeScope: null,
                    quantities: [{ value: '12', unit: null, baseline: null }],
                  },
                ],
              },
            };
          if (name.includes('Plan'))
            return { value: planFor(data.facts, chapterCount) };
          if (name.includes('Build'))
            return { value: artifactFor(data.plan, data.planHash) };
          if (name.includes('Batch')) {
            const artifact = artifactFor(
              data.plan,
              data.planHash,
              data.requestedChapterIds
            );
            const continuation = data.buildMode === 'continuation';
            return {
              value: {
                ...artifact,
                sharedCss: continuation ? data.sharedCss : artifact.sharedCss,
                sharedChangeRequest: continuation
                  ? {
                      reason: 'Keep body rhythm consistent',
                      proposedCss:
                        data.sharedCss + ' .rd-body{letter-spacing:.01em}',
                      affectedChapterIds: data.plan.chapters.map(
                        (ch: { id: string }) => ch.id
                      ),
                    }
                  : null,
              },
            };
          }
          if (name.includes('Review')) {
            t.deepEqual(
              data.plan.chapters.map((ch: { id: string }) => ch.id),
              data.reviewScope.reviewedChapterIds
            );
            t.is(data.reviewScope.plannedChapterCount, chapterCount);
            t.is(
              data.reviewScope.mode,
              data.reviewScope.renderedChapterIds.length < chapterCount
                ? 'pilot'
                : 'complete'
            );
            return {
              value: {
                artifactHash: data.artifactHash,
                designAssessment: {
                  composition: {
                    result: 'met',
                    evidence: 'The supplied composition meets the plan',
                  },
                  typography: {
                    result: 'met',
                    evidence: 'The heading and body have distinct roles',
                  },
                  chartEncoding: {
                    result: 'not_observed',
                    evidence: 'No quantitative chart in this fixture',
                  },
                },
                checkedCaptureIds: data.captures.map(
                  (c: { id: string }) => c.id
                ),
                issues:
                  calls.filter(n => n.includes('Review')).length === 1
                    ? [
                        {
                          id: 'hierarchy',
                          category: 'composition',
                          severity: 'warning',
                          chapterId: 'rd-c-1',
                          viewport: 'desktop',
                          elementId: '',
                          evidence:
                            'Lead statement can have a stronger accent.',
                          suggestedFix:
                            'Add an accent rule to the lead statement.',
                        },
                      ]
                    : [],
              },
            };
          }
          if (name.includes('Repair'))
            return {
              value: {
                expectedArtifactHash: data.expectedArtifactHash,
                addressedIssueIds: data.issues.map((i: { id: string }) => i.id),
                unresolvedIssueIds: [],
                sharedCssReplacement:
                  data.artifact.sharedCss +
                  (chapterCount === 8
                    ? ' body{display:none}'
                    : ' /* Typography repair */ .rd-title{color:#934123}'),
                chapterReplacements: [],
              },
            };
          throw new Error('Unexpected stage');
        },
      } as unknown as PromptRuntime;
      const ai = {
        assertUsable: async () => {},
        designCapabilities: async () => ({
          modelId: 'fixture',
          vision: true,
          structured: true,
          contextWindow: 128000,
        }),
        providerOptions: () => ({ providerOptions: {} }),
      } as unknown as ReportDeckAiService;
      const settings = {
        reportDecks: {
          maxModelCalls: 40,
          maxHtmlBytes: 5 * 1024 * 1024,
          rendererExecutablePath: '/usr/bin/chromium',
        },
      } as Config;
      const renderer = new ReportWebRenderer(settings);
      const service = new ReportWebGenerationService(
        models,
        sources,
        ai,
        runtime,
        renderer,
        settings,
        {} as JobQueue
      );
      const complete = models.reportDeckDesign.complete.bind(
        models.reportDeckDesign
      );
      const fail = models.reportDeckDesign.fail.bind(models.reportDeckDesign);
      models.reportDeckDesign.complete = async () => {
        throw new Error('Simulated process interruption before publication');
      };
      models.reportDeckDesign.fail = async () => {};
      try {
        await service.generate(deck.id, 0);
      } finally {
        models.reportDeckDesign.complete = complete;
        models.reportDeckDesign.fail = fail;
      }
      const interrupted = await models.reportDeckDesign.existing(deck.id, 0);
      t.truthy(interrupted);
      if (!interrupted) return;
      t.is(interrupted.status, 'running');
      await db.reportDeckRun.update({
        where: { id: interrupted.id },
        data: { leaseExpiresAt: new Date(0) },
      });
      const beforeResume = calls.length;
      await service.generate(deck.id, 0);
      t.is(
        calls.length,
        beforeResume,
        'resume must reuse prompt, build, screenshots, reviews and repair checkpoints'
      );
      const result = await db.reportDeck.findUniqueOrThrow({
        where: { id: deck.id },
      });
      t.is(result.status, 'ready', result.errorCode ?? '');
      if (!result.htmlGzip) return;
      const html = gunzipSync(result.htmlGzip).toString();
      const quality = result.quality as {
        artifactHash: string;
        visual: string;
        repairs: number;
      };
      t.is(quality.artifactHash, reportHash(html));
      t.is(quality.visual, 'complete');
      t.is(quality.repairs, 1);
      t.is(
        html.includes('#934123'),
        chapterCount === 3,
        'valid typography repairs are accepted; a failed pilot repair retains the original design'
      );
      t.is(
        calls.filter(n => n.includes(chapterCount > 6 ? 'Batch' : 'Build'))
          .length,
        chapterCount > 6 ? 3 : 1
      );
      const run = await models.reportDeckDesign.existing(deck.id, 0);
      t.is(run?.status, 'ready');
      const count = calls.length;
      await service.generate(deck.id, 0);
      t.is(calls.length, count);
    }
  );
}

isolated(
  'Linux rendering detects hidden facts and overflow while preserving chapter-root CSS',
  async t => {
    t.timeout(120000);
    const renderer = new ReportWebRenderer({
      reportDecks: { rendererExecutablePath: '/usr/bin/chromium' },
    } as Config);
    const plan = planFor([{ id: 'f1' }]);
    const artifact = artifactFor(plan, 'a'.repeat(64));
    artifact.chapters[0].css +=
      ' #rd-c-1{min-height:1200px} .rd-body{width:1600px;min-width:1600px}';
    artifact.chapters[1].css += ' .rd-body{opacity:0}';
    artifact.chapters[2].html = artifact.chapters[2].html.replace(
      '</section>',
      '<svg viewBox="0 0 100 100"><title id="rd-c-3-chart-title">Chart description</title><text x="10" y="25">Visible label</text></svg></section>'
    );
    const rendered = renderReportArtifact(artifact, 'en');
    t.deepEqual(rendered.issues, []);
    const report = await renderer.inspect(
      rendered.html,
      artifact.chapters.map(ch => ch.id),
      new AbortController().signal
    );
    t.is(report.artifactHash, rendered.hash);
    t.true(
      report.chapterMetrics.some(
        ch =>
          ch.id === 'rd-c-1' && ch.viewport === 'desktop' && ch.height >= 1200
      )
    );
    t.true(
      report.issues.some(
        i => i.category === 'overflow' && i.viewport === 'mobile'
      )
    );
    t.true(
      report.issues.some(
        i => i.category === 'visibility' && i.chapterId === 'rd-c-2'
      )
    );
    t.true(report.captures.some(c => c.viewport === 'present'));
    t.false(
      report.issues.some(i =>
        ['rd-c-3-chart-title', 'rd-c-3-chart-desc'].includes(i.elementId)
      )
    );
  }
);

isolated(
  'image protocol permits bind to the live actor, scope, lease and visual step',
  async t => {
    const deck = await createDeck();
    const run = await models.reportDeckDesign.claim(
      deck.id,
      0,
      { capabilities: { modelId: 'pinned-model' } },
      60000
    );
    t.truthy(run);
    if (!run) return;
    const context = { userId: deck.ownerUserId, workspaceId: deck.aiScopeId };
    await t.throwsAsync(
      models.reportDeckDesign.authorizeImageInput(run, context)
    );
    await models.reportDeckDesign.reserveCall(
      run,
      'Vision',
      'a'.repeat(64),
      1,
      10
    );
    t.is(
      await models.reportDeckDesign.authorizeImageInput(run, context),
      'pinned-model'
    );
    await t.throwsAsync(
      models.reportDeckDesign.authorizeImageInput(run, {
        ...context,
        userId: 'another-user',
      })
    );
    await t.throwsAsync(
      models.reportDeckDesign.authorizeImageInput(run, {
        ...context,
        workspaceId: 'another-scope',
      })
    );
    await models.reportDeck.cancel(deck.ownerUserId, deck.id);
    await t.throwsAsync(
      models.reportDeckDesign.authorizeImageInput(run, context)
    );
  }
);
