import {
  type DeckAiChoice,
  DeckAiChoiceSchema,
  type DeckConfig,
  DeckConfigSchema,
  type DeckProgress,
  type DeckQuality,
  renderReportArtifact,
  REPORT_WEB_VERSION,
  type ReportArtifact,
  ReportArtifactSchema,
  ReportBatchSchema,
  type ReportDesignPlan,
  ReportDesignPlanSchema,
  type ReportDesignReview,
  ReportDesignReviewSchema,
  ReportDirectedPlanSchema,
  type ReportIssue,
  reportRenderCapabilities,
  ReportRepairSchema,
  ReportReviewSchema,
} from '@localmind/office/report-deck';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { Config, JobQueue } from '../../../base';
import { ReportDeckSourceService } from '../../../core/report-deck/sources';
import { Models } from '../../../models';
import {
  ReportDesignError,
  type ReportDesignLease,
  reportHash,
  reportJson,
} from '../../../models/report-deck-design';
import type { ResolvedPrompt } from '../prompt';
import type { PromptAttachment } from '../providers/types';
import { ReportDeckAiService } from '../report-deck-ai';
import {
  batches,
  chunkDeckDocuments,
  type DeckChunkPart,
  deckConfigPayload,
  deckSlideRange,
  htmlTextContent,
  selectComposeFacts,
} from '../report-deck-prompts';
import { estimateContextCompactionTokens } from '../runtime/context-compaction';
import { ensurePromptResponseSchemaHash } from '../runtime/contracts/structured-output-contract';
import { PromptRuntime } from '../runtime/prompt-runtime';
import { awaitReportCall } from './bounds';
import {
  DesignExtractionSchema,
  type DesignFact,
  DesignFactSchema,
  groundDesignFacts,
} from './facts';
import {
  REPORT_WEB_V4_MAX_MS,
  ReportWebV4Pipeline,
  type ReportWebV4Run,
  reportWebV4Skill,
  type ReportWebV4Snapshot,
  ReportWebV4SnapshotSchema,
} from './generation-v4';
import { REPORT_WEB_V4_PROMPTS } from './prompts-v4';
import {
  type BrowserReport,
  type ReportCapture,
  ReportWebRenderer,
} from './renderer';

const SnapshotSchema = z
  .object({
    version: z.literal(REPORT_WEB_VERSION),
    config: DeckConfigSchema,
    choice: DeckAiChoiceSchema,
    capabilities: z.object({
      modelId: z.string(),
      vision: z.boolean(),
      structured: z.boolean(),
      contextWindow: z.number(),
    }),
    skill: z.object({ version: z.string(), upstreamCommit: z.string() }),
    prompts: z.record(z.unknown()),
    promptHashes: z.record(z.string()),
    limits: z.object({
      maxCalls: z.number().int().positive(),
      maxHtmlBytes: z.number().int().positive(),
    }),
  })
  .strict();
type Snapshot = z.infer<typeof SnapshotSchema>;
type Run = {
  lease: ReportDesignLease;
  owner: string;
  snapshot: Snapshot;
  deadline: number;
  controller: AbortController;
  sourceCoverage: boolean;
  vision: boolean;
};
const hashValue = (value: unknown) => {
  const hash = ensurePromptResponseSchemaHash({ value: reportJson(value) });
  if (!hash) throw new ReportDesignError('internal');
  return hash;
};
const FactBundleSchema = z.object({
  facts: z.array(DesignFactSchema),
  coverage: z.boolean(),
});
type Candidate = {
  artifact: ReportArtifact;
  html: string;
  hash: string;
  issues: ReportIssue[];
  quality: DeckQuality;
};

export function reportDesignPromptName(
  stage: string,
  prompts: Record<string, unknown>
) {
  const current = `Report Web ${stage} v3.1`;
  return current in prompts ? current : `Report Web ${stage} v3`;
}

export function assertDesignReview(
  review: ReportDesignReview,
  chapterIds?: readonly string[]
) {
  for (const [dimension, assessment] of Object.entries(
    review.designAssessment
  )) {
    if (assessment.result !== 'needs_work') continue;
    const category = dimension === 'chartEncoding' ? 'composition' : dimension;
    if (
      !review.issues.some(
        issue =>
          issue.category === category &&
          (!chapterIds ||
            !issue.chapterId ||
            chapterIds.includes(issue.chapterId))
      )
    )
      throw new ReportDesignError('model_invalid_output');
  }
}

export function assertDesignPlan(
  plan: ReportDesignPlan,
  config: DeckConfig,
  facts: DesignFact[]
) {
  if (plan.artDirection) {
    const direction = plan.artDirection;
    if (
      direction.chapterTreatments.map(ch => ch.chapterId).join('|') !==
        plan.chapters.map(ch => ch.id).join('|') ||
      direction.charts.some(chart => {
        const chapter = plan.chapters.find(ch => ch.id === chart.chapterId);
        return (
          !chapter || chart.factIds.some(id => !chapter.factIds.includes(id))
        );
      })
    )
      throw new ReportDesignError('model_invalid_output');
  }
  const range = deckSlideRange(config),
    ids = new Set(facts.map(f => f.id));
  const used = new Set(plan.chapters.flatMap(ch => ch.factIds));
  if (
    plan.chapters.length < range.min ||
    plan.chapters.length > range.max ||
    new Set(plan.chapters.map(ch => ch.id)).size !== plan.chapters.length ||
    !plan.directions.some(d => d.id === plan.selectedDirection) ||
    new Set(plan.directions.map(d => d.id)).size !== 3 ||
    [...used, ...plan.requiredFactIds, ...plan.omittedFactIds].some(
      id => !ids.has(id)
    ) ||
    plan.requiredFactIds.some(id => !used.has(id)) ||
    facts.some(
      f =>
        f.kind !== 'fact' &&
        (!used.has(f.id) || !plan.requiredFactIds.includes(f.id))
    ) ||
    facts.some(f => !used.has(f.id) && !plan.omittedFactIds.includes(f.id))
  )
    throw new ReportDesignError('model_invalid_output');
}

export function assertDesignArtifact(
  artifact: ReportArtifact,
  plan: ReportDesignPlan,
  facts: DesignFact[],
  requestedIds = plan.chapters.map(ch => ch.id)
) {
  if (
    artifact.planHash !== hashValue(plan) ||
    artifact.chapters.map(ch => ch.id).join('|') !== requestedIds.join('|')
  )
    throw new ReportDesignError('model_invalid_output');
  const factMap = new Map(facts.map(f => [f.id, f]));
  for (const ch of artifact.chapters) {
    const planned = plan.chapters.find(p => p.id === ch.id);
    if (
      !planned ||
      planned.factIds.some(id => !ch.factIds.includes(id)) ||
      ch.factIds.some(id => !planned.factIds.includes(id)) ||
      ch.factIds.some(
        id => !ch.claims.some(claim => claim.factIds.includes(id))
      )
    )
      throw new ReportDesignError('model_invalid_output');
    for (const claim of ch.claims) {
      const quotes = claim.factIds
        .map(id => factMap.get(id)?.quote ?? '')
        .join('\n');
      if (
        claim.factIds.some(
          id => !factMap.has(id) || !ch.factIds.includes(id)
        ) ||
        (claim.text.match(/\d+(?:[.,]\d+)*(?:%|％)?/g) ?? []).some(
          n => !quotes.includes(n)
        )
      )
        throw new ReportDesignError('quality_failed');
    }
    // Also cover numeric text omitted from the model's own claims sidecar.
    const evidence = ch.factIds
      .map(id => factMap.get(id)?.quote ?? '')
      .join('\n');
    const visible = htmlTextContent(ch.html);
    const numbers = visible.match(/\d+(?:[.,]\d+)*(?:%|％)?/g) ?? [];
    if (
      numbers.some(n => !evidence.includes(n) && !/^0?[1-9]$|^1[0-4]$/.test(n))
    )
      throw new ReportDesignError('quality_failed');
  }
}

@Injectable()
export class ReportWebGenerationService {
  private readonly logger = new Logger(ReportWebGenerationService.name);
  private readonly v4: ReportWebV4Pipeline;
  constructor(
    private readonly models: Models,
    private readonly sources: ReportDeckSourceService,
    private readonly ai: ReportDeckAiService,
    private readonly prompts: PromptRuntime,
    private readonly renderer: ReportWebRenderer,
    private readonly config: Config,
    private readonly queue: JobQueue
  ) {
    this.v4 = new ReportWebV4Pipeline(models, sources, ai, prompts, renderer);
  }

  /** New runs use the v4 engine; existing v3 snapshots keep their engine. */
  private async createSnapshot(
    deck: NonNullable<Awaited<ReturnType<Models['reportDeck']['getForRun']>>>
  ): Promise<ReportWebV4Snapshot> {
    const config = DeckConfigSchema.parse(deck.config);
    const choice: DeckAiChoice = {
      scopeKind: deck.aiScopeKind as DeckAiChoice['scopeKind'],
      scopeId: deck.aiScopeId,
      ...(deck.modelId ? { modelId: deck.modelId } : {}),
    };
    const capabilities = await this.ai.designCapabilities(
      deck.ownerUserId,
      choice
    );
    const prompts: Record<string, ResolvedPrompt> = {},
      promptHashes: Record<string, string> = {};
    for (const seed of REPORT_WEB_V4_PROMPTS) {
      await this.models.projectReportGeneration.seedPrompt(seed);
      prompts[seed.name] = await this.prompts.snapshot(seed.name);
      promptHashes[seed.name] = hashValue(prompts[seed.name]);
    }
    return {
      version: 'report-web-v4',
      config,
      choice,
      capabilities,
      skill: reportWebV4Skill(),
      prompts,
      promptHashes,
      limits: {
        maxCalls: this.config.reportDecks.maxModelCalls,
        maxHtmlBytes: this.config.reportDecks.maxHtmlBytes,
      },
      mode: this.config.reportDecks.webRefine ? 'refine' : 'fast',
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async recover() {
    await this.models.reportDeckDesign.cleanup();
    for (const deck of await this.models.reportDeckDesign.recoverable()) {
      await this.queue.add(
        'copilot.reportDeck.generate',
        { deckId: deck.id, attempt: deck.runAttempt },
        {
          jobId: `report-v3-recover-${deck.id}-${deck.runAttempt}-${Math.floor(Date.now() / 60000)}`,
          removeOnComplete: true,
          removeOnFail: true,
        }
      );
    }
  }

  async generate(deckId: string, attempt: number) {
    const deck = await this.models.reportDeck.getForRun(deckId);
    if (
      !deck ||
      deck.generationVersion !== 3 ||
      deck.runAttempt !== attempt ||
      !['queued', 'generating'].includes(deck.status)
    )
      return;
    let run: Run | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const prior = await this.models.reportDeckDesign.existing(
        deckId,
        attempt
      );
      const priorVersion = (
        prior?.snapshot as { version?: unknown } | undefined
      )?.version;
      let snapshot: Snapshot | ReportWebV4Snapshot;
      if (prior && priorVersion === 'report-web-v4')
        snapshot = ReportWebV4SnapshotSchema.parse(prior.snapshot);
      else if (prior) snapshot = SnapshotSchema.parse(prior.snapshot);
      else snapshot = await this.createSnapshot(deck);
      const isV4 = snapshot.version === 'report-web-v4';
      const claimed = await this.models.reportDeckDesign.claim(
        deckId,
        attempt,
        reportJson(snapshot),
        isV4 ? REPORT_WEB_V4_MAX_MS : 15 * 60000
      );
      if (!claimed) return;
      const controller = new AbortController();
      const common = {
        lease: {
          id: claimed.id,
          deckId,
          attempt,
          leaseOwner: claimed.leaseOwner,
          fence: claimed.fence,
        },
        owner: deck.ownerUserId,
        deadline: claimed.deadline.getTime(),
        controller,
        sourceCoverage: false,
        vision: snapshot.capabilities.vision,
      };
      const v4Run: ReportWebV4Run | null = isV4
        ? {
            ...common,
            snapshot: snapshot as ReportWebV4Snapshot,
            timings: {},
            started: Date.now(),
          }
        : null;
      run = isV4
        ? (v4Run as unknown as Run)
        : { ...common, snapshot: snapshot as Snapshot };
      const current = run;
      let beating = false;
      timer = setInterval(() => {
        if (beating) return;
        beating = true;
        void this.models.reportDeckDesign
          .heartbeat(current.lease)
          .catch(() => controller.abort())
          .finally(() => {
            beating = false;
          });
      }, 3000);
      deadlineTimer = setTimeout(
        () => controller.abort(),
        Math.max(1, run.deadline - Date.now())
      );
      await this.renderer.available();
      if (v4Run) await this.v4.execute(v4Run, deck.sources);
      else await this.execute(run, deck.sources);
    } catch (error) {
      const code = run?.controller.signal.aborted
        ? Date.now() >= run.deadline
          ? 'timeout'
          : 'cancelled'
        : error instanceof ReportDesignError
          ? error.code
          : 'provider_unavailable';
      this.logger.warn(`Report web generation stopped: ${code}`);
      if (run) await this.models.reportDeckDesign.fail(run.lease, code);
      else await this.models.reportDeck.fail(deckId, attempt, code);
    } finally {
      if (timer) clearInterval(timer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
  }

  private async progress(
    run: Run,
    phase: DeckProgress['phase'],
    subphase: DeckProgress['subphase'],
    done = 0,
    total = 1
  ) {
    run.controller.signal.throwIfAborted();
    await this.models.reportDeckDesign.progress(run.lease, {
      phase,
      subphase,
      done,
      total,
    });
  }

  private async request<T>(
    run: Run,
    key: string,
    stage: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    payload: unknown,
    images: ReportCapture[] = [],
    validate?: (value: T) => void
  ): Promise<T> {
    const name = reportDesignPromptName(stage, run.snapshot.prompts);
    const prompt = run.snapshot.prompts[name] as ResolvedPrompt | undefined;
    if (!prompt || hashValue(prompt) !== run.snapshot.promptHashes[name])
      throw new ReportDesignError('internal');
    const inputHash = hashValue({
      payload,
      promptHash: run.snapshot.promptHashes[name],
      images: images.map(i => [i.id, reportHash(i.bytes)]),
    });
    const cached = await this.models.reportDeckDesign.readJson(
      run.lease,
      key,
      inputHash
    );
    if (cached !== null) {
      const result = schema.parse(cached);
      validate?.(result);
      return result;
    }
    let previousError = '';
    let formatAttempt = 0;
    for (;;) {
      await this.ai.assertUsable(run.owner, run.snapshot.choice);
      run.controller.signal.throwIfAborted();
      const content = JSON.stringify({
        data: payload,
        renderCapabilities: reportRenderCapabilities(),
        ...(previousError ? { previousError } : {}),
      });
      const promptText = JSON.stringify(prompt.messages);
      const estimated =
        (name.endsWith('v3.1')
          ? estimateContextCompactionTokens(
              content + promptText + JSON.stringify(zodToJsonSchema(schema))
            )
          : content.length + promptText.length) +
        images.length * 1800;
      const maxTokens = Math.min(
        stage === 'Vision'
          ? 4096
          : stage === 'Facts' || stage === 'Review'
            ? 6000
            : stage === 'Plan'
              ? 10000
              : 16000,
        run.snapshot.capabilities.contextWindow - estimated - 2000
      );
      if (maxTokens < (stage === 'Vision' ? 128 : 2000))
        throw new ReportDesignError('budget_exceeded');
      const step = await this.models.reportDeckDesign.reserveCall(
        run.lease,
        stage,
        inputHash,
        content.length,
        run.snapshot.limits.maxCalls
      );
      const signal = AbortSignal.any([
        run.controller.signal,
        AbortSignal.timeout(
          Math.max(
            1,
            Math.min(
              stage === 'Plan' && name.endsWith('v3.1') ? 180000 : 120000,
              run.deadline - Date.now()
            )
          )
        ),
      ]);
      const attachments: PromptAttachment[] = images.map(img => ({
        kind: 'data',
        data: img.bytes.toString('base64'),
        encoding: 'base64',
        mimeType: img.mime,
        fileName: `${img.id}.jpg`,
      }));
      const options = {
        modelId: run.snapshot.capabilities.modelId,
        requireModelId: true,
        promptSnapshot: prompt,
        attachments,
        providerOptions: {
          ...this.ai.providerOptions(run.owner, run.snapshot.choice)
            .providerOptions,
          signal,
          ...(images.length ? { reportImageInput: run.lease } : {}),
          maxTokens,
        },
      };
      let value: unknown;
      let outputChars = 0;
      try {
        const responseSchemaJson = zodToJsonSchema(schema, {
          $refStrategy: 'none',
          target: 'openAi',
        }) as Record<string, unknown>;
        delete responseSchemaJson.$schema;
        const schemaHash = ensurePromptResponseSchemaHash(responseSchemaJson);
        if (!schemaHash) throw new ReportDesignError('internal');
        if (run.snapshot.capabilities.structured && !previousError) {
          const output = await awaitReportCall(
            this.prompts.runStructured(
              name,
              { content },
              {
                ...options,
                responseContract: { responseSchemaJson, schemaHash },
              }
            ),
            signal
          );
          value = output.value;
        } else {
          const output = await awaitReportCall(
            this.prompts.runText(
              name,
              {
                content: JSON.stringify({
                  request: JSON.parse(content),
                  outputSchema: responseSchemaJson,
                }),
              },
              options
            ),
            signal
          );
          outputChars = output.length;
          const text = output
            .trim()
            .replace(/^```(?:json)?\s*/, '')
            .replace(/\s*```$/, '');
          value = JSON.parse(text) as unknown;
        }
        outputChars ||= JSON.stringify(value).length;
        const result = schema.parse(value);
        validate?.(result);
        await this.models.reportDeckDesign.saveJson(
          run.lease,
          key,
          inputHash,
          result
        );
        await this.models.reportDeckDesign.finishCall(run.lease, step.id, {
          status: 'completed',
          outputChars,
        });
        return result;
      } catch (error) {
        const malformed =
          (error instanceof ReportDesignError &&
            ['model_invalid_output', 'quality_failed'].includes(error.code)) ||
          error instanceof SyntaxError ||
          error instanceof z.ZodError ||
          (error instanceof Error &&
            /structured|schema|400|422|incomplete|text content/i.test(
              error.message
            ));
        await this.models.reportDeckDesign
          .finishCall(run.lease, step.id, {
            status: signal.aborted ? 'outcome_unknown' : 'failed',
            outputChars,
            errorCode: signal.aborted
              ? 'timeout'
              : malformed
                ? 'model_invalid_output'
                : 'provider_unavailable',
          })
          .catch(() => {});
        if (run.controller.signal.aborted)
          throw new ReportDesignError('cancelled');
        if (error instanceof ReportDesignError && !malformed) throw error;
        if (
          !malformed ||
          !(await this.models.reportDeckDesign.reserveCorrection(
            run.lease,
            'formatRetries',
            `${key}-${++formatAttempt}`
          ))
        )
          throw new ReportDesignError(
            malformed
              ? 'model_invalid_output'
              : signal.aborted
                ? 'timeout'
                : 'provider_unavailable'
          );
        previousError =
          'The previous response failed the output contract. Recheck the schema, plan hash, exact requested chapter order, assigned fact coverage and claim evidence. Return only one complete JSON object; never invent or change source facts.';
      }
    }
  }

  private async verifyVision(run: Run) {
    if (run.vision) return;
    const inputHash = hashValue(run.snapshot.capabilities);
    const cached = await this.models.reportDeckDesign.readJson(
      run.lease,
      'vision-capability',
      inputHash
    );
    if (cached !== null) {
      run.vision = z.object({ supported: z.boolean() }).parse(cached).supported;
      return;
    }
    // BYOK's legacy text-only declaration is not evidence that its model cannot see.
    // An unpredictable code exists only in pixels, never in the prompt/filename.
    const code = reportHash(`${run.lease.id}:visual-capability`)
      .slice(0, 12)
      .toUpperCase();
    const artifact: ReportArtifact = {
      schemaVersion: REPORT_WEB_VERSION,
      planHash: '0'.repeat(64),
      title: 'Visual capability check',
      sharedCss: '',
      chapters: [
        {
          id: 'rd-c-probe',
          html: `<section class="slide" data-slide data-chapter-id="rd-c-probe"><p id="rd-c-probe-code" style="font:48px monospace;color:#000;background:#fff;padding:40px">${code}</p></section>`,
          css: '',
          factIds: ['probe'],
          claims: [
            { elementId: 'rd-c-probe-code', text: code, factIds: ['probe'] },
          ],
        },
      ],
    };
    const rendered = renderReportArtifact(artifact, 'en');
    const browser = await this.renderer.inspect(
      rendered.html,
      ['rd-c-probe'],
      run.controller.signal
    );
    const capture = browser.captures[0];
    if (!capture) throw new ReportDesignError('render_failed');
    try {
      const answer = await this.request(
        run,
        'vision-probe',
        'Vision',
        z.object({ code: z.string().max(64) }).strict(),
        {
          task: 'Read the code in the attached image. If unavailable, return an empty code.',
        },
        [{ ...capture, id: 'vision-probe', chapterId: '', viewport: 'probe' }]
      );
      run.vision = answer.code.trim() === code;
    } catch (error) {
      if (run.controller.signal.aborted) throw error;
      run.vision = false;
    }
    await this.models.reportDeckDesign.saveJson(
      run.lease,
      'vision-capability',
      inputHash,
      { supported: run.vision }
    );
  }

  private async execute(
    run: Run,
    rows: NonNullable<
      Awaited<ReturnType<Models['reportDeck']['getForRun']>>
    >['sources']
  ) {
    const { config, choice } = run.snapshot;
    await this.ai.assertUsable(run.owner, choice);
    await this.progress(run, 'sources', 'reading');
    const resolved = await this.sources.resolve(
      run.owner,
      rows.map(row => ({
        scopeKind: row.scopeKind as DeckAiChoice['scopeKind'],
        scopeId: row.scopeId,
        kind: row.kind as 'doc' | 'file' | 'folder' | 'project_all',
        ...(row.resourceId ? { resourceId: row.resourceId } : {}),
        title: row.titleSnapshot,
      })),
      'read',
      { cancelled: async () => run.controller.signal.aborted }
    );
    await this.models.reportDeckDesign.sourceStatuses(
      run.lease,
      resolved.map(s => ({
        id: rows[s.index].id,
        status: s.status,
        reason: s.reason,
        chars: s.chars,
        titleSnapshot: s.title,
      }))
    );
    const parts: DeckChunkPart[] = resolved.flatMap(s =>
      s.documents
        .filter(d => d.text.trim())
        .map(d => ({
          sourceIndex: s.index,
          sourceTitle: s.title || d.title,
          title: d.title,
          role: d.role,
          text: d.text,
        }))
    );
    if (!parts.length) throw new ReportDesignError('no_sources');
    await this.verifyVision(run);
    const sourceHash = hashValue(parts);
    const prior = await this.models.reportDeckDesign.readJson(
      run.lease,
      'facts',
      sourceHash
    );
    let bundle: z.infer<typeof FactBundleSchema>;
    if (prior) bundle = FactBundleSchema.parse(prior);
    else {
      const chunks = chunkDeckDocuments(
        parts,
        Math.min(
          24000,
          Math.max(3000, run.snapshot.capabilities.contextWindow - 16000)
        )
      );
      const maxChapters = deckSlideRange(config).max;
      const buildCalls =
        maxChapters <= 6 ? 1 : 1 + Math.ceil((maxChapters - 2) / 3);
      const reviewCalls = Math.ceil((maxChapters * 3 + 2) / 6);
      const downstreamReserve =
        2 + buildCalls + reviewCalls * 3 + 2 + 2 + (maxChapters > 6 ? 3 : 0);
      const budget = Math.max(
        0,
        run.snapshot.limits.maxCalls - downstreamReserve
      );
      if (!budget) throw new ReportDesignError('budget_exceeded');
      const facts: DesignFact[] = [];
      let rejected = 0;
      const usable = chunks.slice(0, budget);
      for (const [i, chunk] of usable.entries()) {
        await this.progress(run, 'extract', 'grounding', i, usable.length);
        const output = await this.request(
          run,
          `extract-${i}`,
          'Facts',
          DesignExtractionSchema,
          {
            config: deckConfigPayload(config),
            instructions: config.instructions,
            maxFacts: 40,
            documents: chunk.parts.map((p, doc) => ({ ...p, doc })),
          }
        );
        const checked = groundDesignFacts(output, chunk);
        rejected += checked.rejected;
        for (const fact of checked.facts)
          if (!facts.some(f => f.id === fact.id)) facts.push(fact);
      }
      const selectedIds = new Set(
        selectComposeFacts(
          facts,
          Math.max(
            4000,
            Math.min(24000, run.snapshot.capabilities.contextWindow - 24000)
          )
        ).map(f => f.id)
      );
      bundle = {
        facts: facts.filter(f => selectedIds.has(f.id)),
        coverage:
          usable.length < chunks.length ||
          selectedIds.size < facts.length ||
          rejected > 0 ||
          resolved.some(s => s.status !== 'included'),
      };
      await this.models.reportDeckDesign.saveJson(
        run.lease,
        'facts',
        sourceHash,
        bundle
      );
    }
    if (!bundle.facts.length) throw new ReportDesignError('no_sources');
    run.sourceCoverage = bundle.coverage;
    const base = {
      config: deckConfigPayload(config),
      instructions: config.instructions,
      customStyle: config.customStyle ?? '',
      facts: bundle.facts,
    };
    await this.progress(run, 'compose', 'planning');
    const plan = await this.request(
      run,
      'plan',
      'Plan',
      'Report Web Plan v3.1' in run.snapshot.prompts
        ? ReportDirectedPlanSchema
        : ReportDesignPlanSchema.omit({ artDirection: true }),
      base,
      [],
      value => assertDesignPlan(value, config, bundle.facts)
    );
    assertDesignPlan(plan, config, bundle.facts);
    const artifact = await this.build(run, plan, bundle.facts, base);
    let current = artifact,
      best: Candidate | undefined;
    for (let revision = 0; revision <= 2; revision++) {
      let candidate: Candidate;
      try {
        candidate = await this.inspect(
          run,
          current,
          plan,
          bundle.facts,
          revision
        );
      } catch (error) {
        if (
          best &&
          error instanceof ReportDesignError &&
          [
            'budget_exceeded',
            'timeout',
            'provider_unavailable',
            'render_failed',
          ].includes(error.code)
        )
          break;
        throw error;
      }
      if (
        !candidate.issues.some(i => i.severity === 'error') &&
        (!best ||
          (candidate.quality.checkedCaptures >= best.quality.checkedCaptures &&
            candidate.issues.length < best.issues.length))
      )
        best = candidate;
      if (!candidate.issues.length || run.deadline - Date.now() < 90000) break;
      if (
        revision === 2 ||
        !(await this.models.reportDeckDesign.reserveCorrection(
          run.lease,
          'repairs',
          `repair-${revision}`
        ))
      )
        break;
      await this.progress(run, 'render', 'repairing', revision, 2);
      try {
        current = await this.repairCandidate(
          run,
          current,
          plan,
          bundle.facts,
          candidate,
          `repair-${revision}`
        );
      } catch (error) {
        if (best) break;
        throw error;
      }
    }
    if (!best) throw new ReportDesignError('quality_failed');
    await this.ai.assertUsable(run.owner, choice);
    // Re-read source authority/content before publishing a checkpoint-derived result.
    const finalSources = await this.sources.resolve(
      run.owner,
      rows.map(row => ({
        scopeKind: row.scopeKind as DeckAiChoice['scopeKind'],
        scopeId: row.scopeId,
        kind: row.kind as 'doc' | 'file' | 'folder' | 'project_all',
        ...(row.resourceId ? { resourceId: row.resourceId } : {}),
      })),
      'read',
      { cancelled: async () => run.controller.signal.aborted }
    );
    const finalParts = finalSources.flatMap(s =>
      s.documents
        .filter(d => d.text.trim())
        .map(d => ({
          sourceIndex: s.index,
          sourceTitle: s.title || d.title,
          title: d.title,
          role: d.role,
          text: d.text,
        }))
    );
    if (hashValue(finalParts) !== sourceHash)
      throw new ReportDesignError('no_sources');
    const record = await this.models.reportDeckDesign.existing(
      run.lease.deckId,
      run.lease.attempt
    );
    if (!record) throw new ReportDesignError('internal');
    best.quality.repairs = record.repairs;
    await this.models.reportDeckDesign.complete(run.lease, {
      html: best.html,
      title: config.title || best.artifact.title,
      chapters: best.artifact.chapters.length,
      modelId: run.snapshot.capabilities.modelId,
      quality: best.quality,
      usage: reportJson({
        calls: record.calls,
        formatRetries: record.formatRetries,
        repairs: record.repairs,
        tokens: null,
        cost: null,
        skill: run.snapshot.skill,
        promptHashes: run.snapshot.promptHashes,
        artifactHash: best.hash,
      }),
    });
  }

  private async repairCandidate(
    run: Run,
    artifact: ReportArtifact,
    plan: ReportDesignPlan,
    facts: DesignFact[],
    candidate: Candidate,
    key: string
  ) {
    const ids = artifact.chapters.map(ch => ch.id);
    const orderedIssues = [...candidate.issues].sort(
      (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error')
    );
    const styleOnly = orderedIssues.every(
      issue => issue.category === 'typography'
    );
    const affected = [
      ...new Set(
        orderedIssues
          .map(issue => issue.chapterId)
          .filter(id => ids.includes(id))
      ),
    ];
    const allowedIds = styleOnly
      ? []
      : (affected.length ? affected : ids).slice(0, 3);
    const issues = orderedIssues
      .filter(
        issue =>
          styleOnly || !issue.chapterId || allowedIds.includes(issue.chapterId)
      )
      .slice(0, 60);
    const selected = artifact.chapters.filter(ch => allowedIds.includes(ch.id));
    const selectedFacts = new Set(
      (styleOnly ? artifact.chapters : selected).flatMap(ch => ch.factIds)
    );
    const merge = (patch: z.infer<typeof ReportRepairSchema>) => {
      if (
        patch.expectedArtifactHash !== candidate.hash ||
        new Set(patch.chapterReplacements.map(ch => ch.id)).size !==
          patch.chapterReplacements.length ||
        patch.chapterReplacements.some(ch => !allowedIds.includes(ch.id)) ||
        [...patch.addressedIssueIds, ...patch.unresolvedIssueIds].some(
          id => !issues.some(issue => issue.id === id)
        )
      )
        throw new ReportDesignError('model_invalid_output');
      const result = {
        ...artifact,
        sharedCss: patch.sharedCssReplacement ?? artifact.sharedCss,
        chapters: artifact.chapters.map(
          ch => patch.chapterReplacements.find(p => p.id === ch.id) ?? ch
        ),
      };
      assertDesignArtifact(result, plan, facts, ids);
      return result;
    };
    const patch = await this.request(
      run,
      key,
      'Repair',
      ReportRepairSchema,
      {
        config: deckConfigPayload(run.snapshot.config),
        plan: {
          reportThesis: plan.reportThesis,
          designTokens: plan.designTokens,
          selectedDirection: plan.selectedDirection,
          chapters: plan.chapters.filter(
            ch => styleOnly || allowedIds.includes(ch.id)
          ),
          ...(plan.artDirection ? { artDirection: plan.artDirection } : {}),
        },
        facts: facts.filter(f => selectedFacts.has(f.id)),
        artifact: { ...artifact, chapters: selected },
        ...(styleOnly
          ? {
              chapterStyles: artifact.chapters.map(ch => ({
                id: ch.id,
                css: ch.css,
              })),
              repairScope:
                'Typography only: replace shared CSS; chapterReplacements must be empty.',
            }
          : {}),
        expectedArtifactHash: candidate.hash,
        issues,
        allowedChapterIds: allowedIds,
      },
      [],
      value => {
        merge(value);
      }
    );
    return merge(patch);
  }

  private async build(
    run: Run,
    plan: ReportDesignPlan,
    facts: DesignFact[],
    base: unknown
  ) {
    const planHash = hashValue(plan);
    await this.progress(run, 'compose', 'building');
    if (plan.chapters.length <= 6) {
      try {
        const whole = await this.request(
          run,
          'build-full',
          'Build',
          ReportArtifactSchema,
          { base, plan, planHash },
          [],
          value => assertDesignArtifact(value, plan, facts)
        );
        assertDesignArtifact(whole, plan, facts);
        return { ...whole, title: run.snapshot.config.title || whole.title };
      } catch (error) {
        if (
          !(error instanceof ReportDesignError) ||
          error.code !== 'model_invalid_output'
        )
          throw error;
      }
    }
    const complex =
      plan.chapters.find(
        ch =>
          ch.id !== plan.chapters[0].id &&
          plan.artDirection?.charts.some(chart => chart.chapterId === ch.id)
      ) ??
      plan.chapters.find(
        ch => ch.id !== plan.chapters[0].id && ch.density === 'high'
      ) ??
      plan.chapters[1];
    const pilotIds = [plan.chapters[0].id, complex.id];
    const groups = [
      pilotIds,
      ...batches(
        plan.chapters.filter(ch => !pilotIds.includes(ch.id)).map(ch => ch.id),
        3
      ),
    ];
    let sharedCss = '';
    const chapters: ReportArtifact['chapters'] = [];
    for (const [index, ids] of groups.entries()) {
      const assigned = new Set(
        plan.chapters
          .filter(ch => ids.includes(ch.id))
          .flatMap(ch => ch.factIds)
      );
      const response = await this.request(
        run,
        `build-batch-${index}`,
        'Batch',
        ReportBatchSchema,
        {
          config: deckConfigPayload(run.snapshot.config),
          instructions: run.snapshot.config.instructions,
          plan,
          planHash,
          buildMode: index ? 'continuation' : 'pilot',
          requestedChapterIds: ids,
          sharedCss,
          sharedCssHash: reportHash(sharedCss),
          assignedFacts: facts.filter(f => assigned.has(f.id)),
          chapterContext: chapters.map(ch => ({
            id: ch.id,
            factIds: ch.factIds,
            ...(plan.artDirection
              ? {
                  treatment: plan.artDirection.chapterTreatments.find(
                    t => t.chapterId === ch.id
                  ),
                  composition: plan.chapters.find(p => p.id === ch.id)
                    ?.composition,
                }
              : {}),
          })),
          contract:
            'Continuation returns sharedCss unchanged. Prefer chapter CSS. If unavoidable, propose sharedChangeRequest with replacement CSS, reason and every affected chapter ID; the entire assembled document will be checked again.',
        },
        [],
        value => {
          assertDesignArtifact(value, plan, facts, ids);
          if (
            (index && value.sharedCss !== sharedCss) ||
            value.sharedChangeRequest?.affectedChapterIds.some(
              id => !plan.chapters.some(ch => ch.id === id)
            )
          )
            throw new ReportDesignError('model_invalid_output');
        }
      );
      let batch = ReportArtifactSchema.parse({
        schemaVersion: response.schemaVersion,
        planHash: response.planHash,
        title: response.title,
        sharedCss:
          response.sharedChangeRequest?.proposedCss ?? response.sharedCss,
        chapters: response.chapters,
      });
      if (!index) {
        let pilot = await this.inspect(run, batch, plan, facts, 'pilot');
        if (
          pilot.issues.length &&
          (await this.models.reportDeckDesign.reserveCorrection(
            run.lease,
            'repairs',
            'repair-pilot'
          ))
        ) {
          const original = pilot;
          try {
            const patched = await this.repairCandidate(
              run,
              batch,
              plan,
              facts,
              pilot,
              'repair-pilot'
            );
            const checked = await this.inspect(
              run,
              patched,
              plan,
              facts,
              'pilot-fixed'
            );
            if (
              original.issues.some(issue => issue.severity === 'error') ||
              (!checked.issues.some(issue => issue.severity === 'error') &&
                checked.quality.checkedCaptures >=
                  original.quality.checkedCaptures &&
                checked.issues.length < original.issues.length)
            ) {
              batch = patched;
              pilot = checked;
            }
          } catch (error) {
            if (
              run.controller.signal.aborted ||
              original.issues.some(issue => issue.severity === 'error')
            )
              throw error;
          }
        }
        if (pilot.issues.some(issue => issue.severity === 'error'))
          throw new ReportDesignError('quality_failed');
      }
      sharedCss = batch.sharedCss;
      chapters.push(...batch.chapters);
      await this.progress(run, 'compose', 'building', index + 1, groups.length);
    }
    const ordered = plan.chapters.map(ch => {
      const chapter = chapters.find(c => c.id === ch.id);
      if (!chapter) throw new ReportDesignError('model_invalid_output');
      return chapter;
    });
    const artifact: ReportArtifact = {
      schemaVersion: REPORT_WEB_VERSION,
      planHash,
      title: run.snapshot.config.title || plan.title,
      sharedCss,
      chapters: ordered,
    };
    assertDesignArtifact(artifact, plan, facts);
    return artifact;
  }

  private async inspect(
    run: Run,
    artifact: ReportArtifact,
    plan: ReportDesignPlan,
    facts: DesignFact[],
    revision: number | string
  ): Promise<Candidate> {
    await this.progress(
      run,
      'render',
      'checking',
      typeof revision === 'number' ? revision : 0,
      3
    );
    assertDesignArtifact(
      artifact,
      plan,
      facts,
      artifact.chapters.map(ch => ch.id)
    );
    const rendered = renderReportArtifact(
      artifact,
      run.snapshot.config.language
    );
    if (Buffer.byteLength(rendered.html) > run.snapshot.limits.maxHtmlBytes)
      throw new ReportDesignError('budget_exceeded');
    await this.models.reportDeckDesign.saveJson(
      run.lease,
      `candidate-${revision}`,
      rendered.hash,
      { artifact, html: rendered.html }
    );
    const summary = (await this.models.reportDeckDesign.readJson(
      run.lease,
      `review-summary-${revision}`,
      rendered.hash
    )) as { issues: ReportIssue[]; quality: DeckQuality } | null;
    if (summary)
      return { artifact, html: rendered.html, hash: rendered.hash, ...summary };
    const browserKey = `browser-${revision}`;
    const saved = (await this.models.reportDeckDesign.readJson(
      run.lease,
      browserKey,
      rendered.hash
    )) as
      | (Omit<BrowserReport, 'captures'> & {
          captures: Array<Omit<ReportCapture, 'bytes'> & { hash: string }>;
        })
      | null;
    let browser: BrowserReport;
    if (saved) {
      const captures: ReportCapture[] = [];
      for (const capture of saved.captures) {
        const row = await this.models.reportDeckDesign.readArtifact(
          run.lease,
          `shot-${rendered.hash.slice(0, 12)}-${capture.hash}`,
          rendered.hash
        );
        if (!row || row.hash !== capture.hash || row.mime !== capture.mime)
          throw new ReportDesignError('quality_failed');
        captures.push({ ...capture, bytes: Buffer.from(row.payload) });
      }
      browser = { ...saved, captures };
    } else {
      browser = await this.renderer.inspect(
        rendered.html,
        artifact.chapters.map(ch => ch.id),
        run.controller.signal
      );
      for (const capture of browser.captures)
        await this.models.reportDeckDesign.saveArtifact(
          run.lease,
          `shot-${rendered.hash.slice(0, 12)}-${reportHash(capture.bytes)}`,
          rendered.hash,
          capture.bytes,
          capture.mime
        );
      await this.models.reportDeckDesign.saveJson(
        run.lease,
        browserKey,
        rendered.hash,
        {
          ...browser,
          captures: browser.captures.map(({ bytes, ...meta }) => ({
            ...meta,
            hash: reportHash(bytes),
          })),
        }
      );
    }
    if (browser.artifactHash !== rendered.hash)
      throw new ReportDesignError('quality_failed');
    const issues = [...rendered.issues, ...browser.issues];
    let checked = 0,
      unavailable = !run.vision;
    const groups = unavailable ? [[]] : batches(browser.captures, 6);
    for (const [index, images] of groups.entries()) {
      await this.progress(run, 'render', 'reviewing', index, groups.length);
      const ids = new Set(images.map(i => i.chapterId));
      const selected = images.length
        ? artifact.chapters.filter(ch => ids.has(ch.id))
        : artifact.chapters;
      const factIds = new Set(selected.flatMap(ch => ch.factIds));
      try {
        const review = await this.request(
          run,
          `review-${revision}-${index}`,
          'Review',
          plan.artDirection ? ReportDesignReviewSchema : ReportReviewSchema,
          {
            artifactHash: rendered.hash,
            ...(plan.artDirection
              ? {
                  visualIntent: {
                    customStyle: run.snapshot.config.customStyle ?? '',
                    artDirection: {
                      ...plan.artDirection,
                      chapterTreatments:
                        plan.artDirection.chapterTreatments.filter(t =>
                          selected.some(ch => ch.id === t.chapterId)
                        ),
                      charts: plan.artDirection.charts.filter(chart =>
                        selected.some(ch => ch.id === chart.chapterId)
                      ),
                    },
                  },
                  typeMeasurements:
                    browser.typography
                      ?.filter(
                        sample =>
                          selected.some(ch => ch.id === sample.chapterId) &&
                          images.some(
                            image => image.viewport === sample.viewport
                          )
                      )
                      .slice(0, 24) ?? [],
                }
              : {}),
            reviewScope: {
              mode:
                artifact.chapters.length < plan.chapters.length
                  ? 'pilot'
                  : 'complete',
              plannedChapterCount: plan.chapters.length,
              renderedChapterIds: artifact.chapters.map(ch => ch.id),
              reviewedChapterIds: selected.map(ch => ch.id),
              captureIds: images.map(image => image.id),
              instruction:
                'Review only the supplied chapters and capture regions. Pilot chapters are deliberately incomplete; unrequested chapters and captures in other batches are not missing content. The application validates full-report coverage after assembly.',
            },
            plan: {
              reportThesis: plan.reportThesis,
              selectedDirection: plan.selectedDirection,
              designTokens: plan.designTokens,
              chapters: plan.chapters.filter(ch =>
                selected.some(selectedChapter => selectedChapter.id === ch.id)
              ),
            },
            chapters: selected.map(ch => ({
              id: ch.id,
              claims: ch.claims,
              visibleText: htmlTextContent(ch.html).slice(0, 16000),
            })),
            facts: facts.filter(f => factIds.has(f.id)),
            domIssues: browser.issues.filter(
              i => !i.chapterId || ids.has(i.chapterId)
            ),
            captures: images.map(({ bytes: _bytes, ...meta }) => meta),
            visualAvailable: !unavailable,
          },
          images,
          value => {
            if (plan.artDirection)
              assertDesignReview(
                ReportDesignReviewSchema.parse(value),
                selected.map(ch => ch.id)
              );
          }
        );
        if (
          review.artifactHash !== rendered.hash ||
          review.checkedCaptureIds.some(id => !images.some(i => i.id === id))
        )
          throw new ReportDesignError('model_invalid_output');
        checked += new Set(review.checkedCaptureIds).size;
        issues.push(
          ...review.issues
            .filter(
              i => !i.chapterId || selected.some(ch => ch.id === i.chapterId)
            )
            .map((issue, issueIndex) => ({
              ...issue,
              id: `review-${index}-${issueIndex}-${issue.id.slice(0, 70)}`,
            }))
        );
      } catch (error) {
        if (run.controller.signal.aborted) throw error;
        unavailable ||= checked === 0;
        break;
      }
    }
    const warnings: DeckQuality['warnings'] = [];
    if (run.sourceCoverage) warnings.push('source_coverage');
    if (unavailable) warnings.push('visual_unavailable');
    else if (checked < browser.totalCaptures) warnings.push('visual_partial');
    if (issues.some(i => i.severity === 'warning'))
      warnings.push('design_warnings');
    const quality: DeckQuality = {
      version: REPORT_WEB_VERSION,
      artifactHash: rendered.hash,
      visual: unavailable
        ? 'unavailable'
        : checked < browser.totalCaptures
          ? 'partial'
          : 'complete',
      warnings,
      checkedCaptures: checked,
      totalCaptures: Math.min(300, browser.totalCaptures),
      repairs: typeof revision === 'number' ? revision : 0,
    };
    await this.models.reportDeckDesign.saveJson(
      run.lease,
      `review-summary-${revision}`,
      rendered.hash,
      { issues, quality }
    );
    return {
      artifact,
      html: rendered.html,
      hash: rendered.hash,
      issues,
      quality,
    };
  }
}
