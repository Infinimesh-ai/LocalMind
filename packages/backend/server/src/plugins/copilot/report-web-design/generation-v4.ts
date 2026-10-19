import {
  applyPlanOps,
  type DeckAiChoice,
  DeckAiChoiceSchema,
  DeckConfigSchema,
  type DeckProgress,
  type DeckQuality,
  type DerivedValue,
  type DesignMove,
  lintExperiencePlan,
  normalizeExperiencePlan,
  parseReportBundle,
  renderReportArtifact,
  renderReportWeb,
  REPORT_WEB_V4,
  REPORT_WEB_VERSION,
  type ReportArtifact,
  type ReportBehavior,
  type ReportCompare,
  ReportCompareSchema,
  type ReportCritique,
  ReportCritiqueSchema,
  type ReportDataset,
  type ReportExperiencePlan,
  ReportExperiencePlanSchema,
  type ReportIssue,
  type ReportMotionCritique,
  ReportMotionCritiqueSchema,
  type ReportRelation,
  ReportRepairHeaderSchema,
  type ReportWebArtifact,
  reportWebCapabilities,
  stripBehaviors,
} from '@localmind/office/report-deck';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

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
  selectComposeFacts,
} from '../report-deck-prompts';
import { estimateContextCompactionTokens } from '../runtime/context-compaction';
import { ensurePromptResponseSchemaHash } from '../runtime/contracts/structured-output-contract';
import { PromptRuntime } from '../runtime/prompt-runtime';
import { awaitReportCall } from './bounds';
import {
  EvidenceExtractionSchema,
  type EvidenceFact,
  EvidenceFactSchema,
  groundEvidence,
} from './evidence';
import { reportWebV4PromptName, type ReportWebV4Stage } from './prompts-v4';
import { ReportWebRenderer } from './renderer';
import type { WebBrowserReport, WebCapture } from './renderer-v4';
import { REPORT_WEB_SKILL_V4, REPORT_WEB_SKILL_V4_HASHES } from './skill-v4';

export const ReportWebV4SnapshotSchema = z
  .object({
    version: z.literal(REPORT_WEB_V4),
    config: DeckConfigSchema,
    choice: DeckAiChoiceSchema,
    capabilities: z.object({
      modelId: z.string(),
      vision: z.boolean(),
      structured: z.boolean(),
      contextWindow: z.number(),
      contextKnown: z.boolean().optional(),
    }),
    skill: z.object({
      version: z.string(),
      upstreamCommit: z.string(),
      fragments: z.record(z.string()),
    }),
    prompts: z.record(z.unknown()),
    promptHashes: z.record(z.string()),
    limits: z.object({
      maxCalls: z.number().int().positive(),
      maxHtmlBytes: z.number().int().positive(),
    }),
    /** fast: parallel chapters + deterministic checks; refine: model review loop. */
    mode: z.enum(['fast', 'refine']).optional(),
  })
  .strict();
export type ReportWebV4Snapshot = z.infer<typeof ReportWebV4SnapshotSchema>;
export const REPORT_WEB_V4_MAX_MS = 30 * 60000;
export const reportWebV4Skill = () => ({
  ...REPORT_WEB_SKILL_V4,
  fragments: REPORT_WEB_SKILL_V4_HASHES,
});

export type ReportWebV4Run = {
  lease: ReportDesignLease;
  owner: string;
  snapshot: ReportWebV4Snapshot;
  deadline: number;
  controller: AbortController;
  sourceCoverage: boolean;
  vision: boolean;
  timings: Record<string, number>;
  started: number;
};

type SourceRows = NonNullable<
  Awaited<ReturnType<Models['reportDeck']['getForRun']>>
>['sources'];

const EvidenceBundleSchema = z.object({
  facts: z.array(EvidenceFactSchema),
  datasets: z.array(z.custom<ReportDataset>()),
  relations: z.array(z.custom<ReportRelation>()),
  coverage: z.boolean(),
  rejected: z.number().int().optional(),
});
type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

type Candidate = {
  plan: ReportExperiencePlan;
  artifact: ReportWebArtifact;
  derived: DerivedValue[];
  html: string;
  hash: string;
  behaviors: ReportBehavior[];
  charts: number;
  issues: ReportIssue[];
  browser: WebBrowserReport;
  critique: ReportCritique | null;
  motion: ReportMotionCritique | null;
  visualChecked: number;
  visualTotal: number;
};

/** A validation failure the model can fix; the text is fed back verbatim. */
class StageFeedback extends Error {
  constructor(readonly feedback: string[]) {
    super(feedback.join('\n'));
  }
}

const hashValue = (value: unknown) => {
  const hash = ensurePromptResponseSchemaHash({ value: reportJson(value) });
  if (!hash) throw new ReportDesignError('internal');
  return hash;
};
const errorsOf = (issues: readonly ReportIssue[]) =>
  issues.filter(issue => issue.severity === 'error');
const describe = (issues: readonly ReportIssue[]) =>
  issues
    .slice(0, 24)
    .map(
      i =>
        `[${i.category}${i.chapterId ? ` ${i.chapterId}` : ''}] ${i.evidence}`
    );

const MAX_TOKENS: Record<ReportWebV4Stage, number> = {
  Vision: 512,
  Facts: 8000,
  Plan: 16000,
  Build: 32000,
  Batch: 24000,
  Chapter: 12000,
  Critique: 6000,
  Motion: 5000,
  Repair: 28000,
  Compare: 2000,
};
const TIMEOUT: Record<ReportWebV4Stage, number> = {
  Vision: 60000,
  Facts: 150000,
  Plan: 240000,
  Build: 480000,
  Batch: 360000,
  Chapter: 240000,
  Critique: 180000,
  Motion: 150000,
  Repair: 420000,
  Compare: 120000,
};

/**
 * Models without a declared window (common for BYOK) get a generous
 * default; an actual overflow surfaces as a provider error, not a silently
 * skipped review or repair.
 */
const contextWindow = (run: ReportWebV4Run) =>
  run.snapshot.capabilities.contextKnown === false
    ? 128000
    : run.snapshot.capabilities.contextWindow;

/** v4 engine; claimed and leased by ReportWebGenerationService. */
export class ReportWebV4Pipeline {
  private readonly logger = new Logger('ReportWebV4Pipeline');
  constructor(
    private readonly models: Models,
    private readonly sources: ReportDeckSourceService,
    private readonly ai: ReportDeckAiService,
    private readonly prompts: PromptRuntime,
    private readonly renderer: ReportWebRenderer
  ) {}

  private async progress(
    run: ReportWebV4Run,
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

  /**
   * One model call with checkpointing, persisted budget, bounded retries and
   * precise validation feedback. Bundle stages use plain text output.
   */
  private async request<T>(
    run: ReportWebV4Run,
    key: string,
    stage: ReportWebV4Stage,
    payload: unknown,
    parse: (raw: unknown) => T,
    options: {
      images?: WebCapture[];
      text?: boolean;
      schema?: z.ZodTypeAny;
    } = {}
  ): Promise<T> {
    const name = reportWebV4PromptName(stage);
    const prompt = run.snapshot.prompts[name] as ResolvedPrompt | undefined;
    if (!prompt || hashValue(prompt) !== run.snapshot.promptHashes[name])
      throw new ReportDesignError('internal');
    const images = options.images ?? [];
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
    // Text-bundle checkpoints store the validated result, not the raw text.
    if (cached !== null) return options.text ? (cached as T) : parse(cached);
    let feedback: string[] = [];
    for (let attempt = 0; ; attempt++) {
      await this.ai.assertUsable(run.owner, run.snapshot.choice);
      run.controller.signal.throwIfAborted();
      const responseSchemaJson = options.schema
        ? (zodToJsonSchema(options.schema, {
            $refStrategy: 'none',
            target: 'openAi',
          }) as Record<string, unknown>)
        : null;
      if (responseSchemaJson) delete responseSchemaJson.$schema;
      const structured =
        !!responseSchemaJson &&
        run.snapshot.capabilities.structured &&
        !feedback.length;
      const content = JSON.stringify({
        data: payload,
        ...(feedback.length
          ? {
              previousError:
                'Your previous output failed validation. Fix every item below and return the complete output again:\n' +
                feedback.slice(0, 30).join('\n'),
            }
          : {}),
        ...(responseSchemaJson && !structured
          ? { outputSchema: responseSchemaJson }
          : {}),
      });
      const estimated =
        estimateContextCompactionTokens(
          content + JSON.stringify(prompt.messages)
        ) +
        images.length * 1800;
      const maxTokens = Math.min(
        MAX_TOKENS[stage],
        contextWindow(run) - estimated - 2000
      );
      if (maxTokens < Math.min(MAX_TOKENS[stage], 1500))
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
          Math.max(1, Math.min(TIMEOUT[stage], run.deadline - Date.now()))
        ),
      ]);
      const attachments: PromptAttachment[] = images.map(img => ({
        kind: 'data',
        data: img.bytes.toString('base64'),
        encoding: 'base64',
        mimeType: img.mime,
        fileName: `${img.id}.jpg`,
      }));
      const callOptions = {
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
      const started = Date.now();
      let outputChars = 0;
      let rawText = '';
      try {
        let raw: unknown;
        if (structured && responseSchemaJson) {
          const schemaHash = ensurePromptResponseSchemaHash(responseSchemaJson);
          if (!schemaHash) throw new ReportDesignError('internal');
          const output = await awaitReportCall(
            this.prompts.runStructured(
              name,
              { content },
              {
                ...callOptions,
                responseContract: { responseSchemaJson, schemaHash },
              }
            ),
            signal
          );
          raw = output.value;
          outputChars = JSON.stringify(raw).length;
        } else {
          const output = await awaitReportCall(
            this.prompts.runText(name, { content }, callOptions),
            signal
          );
          outputChars = output.length;
          rawText = output;
          raw = options.text
            ? output
            : (JSON.parse(
                output
                  .trim()
                  .replace(/^```(?:json)?\s*/, '')
                  .replace(/\s*```$/, '')
              ) as unknown);
        }
        const result = parse(raw);
        run.timings[stage] = (run.timings[stage] ?? 0) + (Date.now() - started);
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
        run.timings[stage] = (run.timings[stage] ?? 0) + (Date.now() - started);
        const fixable =
          error instanceof StageFeedback ||
          error instanceof SyntaxError ||
          error instanceof z.ZodError ||
          (error instanceof ReportDesignError &&
            ['model_invalid_output', 'quality_failed'].includes(error.code)) ||
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
              : fixable
                ? 'model_invalid_output'
                : 'provider_unavailable',
          })
          .catch(() => {});
        if (run.controller.signal.aborted)
          throw new ReportDesignError('cancelled');
        if (error instanceof ReportDesignError && !fixable) throw error;
        if (
          !fixable ||
          attempt >= 2 ||
          !(await this.reserveRetry(run, key, attempt))
        )
          throw new ReportDesignError(
            fixable
              ? 'model_invalid_output'
              : signal.aborted
                ? 'timeout'
                : 'provider_unavailable'
          );
        feedback =
          error instanceof StageFeedback
            ? error.feedback
            : error instanceof z.ZodError
              ? error.issues
                  .slice(0, 20)
                  .map(i => `${i.path.join('.')}: ${i.message}`)
              : [
                  `Output was not parseable: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`,
                ];
        // Bounded diagnostics: which validation rules the model missed.
        await this.models.reportDeckDesign
          .saveJson(
            run.lease,
            `feedback-${key}-${attempt + 1}`.slice(0, 150),
            inputHash,
            {
              stage,
              feedback: feedback.slice(0, 30).map(f => f.slice(0, 400)),
              output: rawText.slice(0, 60000),
            }
          )
          .catch(() => {});
      }
    }
  }

  /** Per-stage idempotent retry reservations (max two per request key). */
  private async reserveRetry(
    run: ReportWebV4Run,
    key: string,
    attempt: number
  ) {
    const id = `v4-retry-${key}-${attempt + 1}`.slice(0, 150);
    await this.models.reportDeckDesign.saveArtifact(
      run.lease,
      id,
      reportHash(id),
      Buffer.from('retry'),
      'application/vnd.localmind.report-reservation'
    );
    return true;
  }

  private structured<S extends z.ZodTypeAny>(
    schema: S,
    validate?: (value: z.infer<S>) => void
  ) {
    return (raw: unknown) => {
      const value = schema.parse(raw) as z.infer<S>;
      validate?.(value);
      return value;
    };
  }

  private async verifyVision(run: ReportWebV4Run) {
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
    if (
      (await this.models.reportDeckDesign.priorVision(run.owner, inputHash)) ===
      true
    ) {
      run.vision = true;
      await this.models.reportDeckDesign.saveJson(
        run.lease,
        'vision-capability',
        inputHash,
        { supported: true, reused: true }
      );
      return;
    }
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
    const browser = await this.renderer.inspect(
      renderReportArtifact(artifact, 'en').html,
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
        {
          task: 'Read the code in the attached image. If unavailable, return an empty code.',
        },
        this.structured(z.object({ code: z.string().max(64) }).strict()),
        {
          images: [
            {
              id: 'vision-probe',
              chapterId: '',
              viewport: 'probe',
              kind: 'detail',
              bytes: capture.bytes,
              mime: 'image/jpeg',
            },
          ],
          schema: z.object({ code: z.string().max(64) }).strict(),
        }
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

  private async readSources(
    run: ReportWebV4Run,
    rows: SourceRows,
    record: boolean
  ) {
    const resolved = await this.sources.resolve(
      run.owner,
      rows.map(row => ({
        scopeKind: row.scopeKind as DeckAiChoice['scopeKind'],
        scopeId: row.scopeId,
        kind: row.kind as 'doc' | 'file' | 'folder' | 'project_all',
        ...(row.resourceId ? { resourceId: row.resourceId } : {}),
        ...(record ? { title: row.titleSnapshot } : {}),
      })),
      'read',
      { cancelled: async () => run.controller.signal.aborted }
    );
    if (record)
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
    return { resolved, parts };
  }

  async execute(run: ReportWebV4Run, rows: SourceRows) {
    const { config, choice } = run.snapshot;
    await this.ai.assertUsable(run.owner, choice);
    await this.progress(run, 'sources', 'reading');
    const { resolved, parts } = await this.readSources(run, rows, true);
    if (!parts.length) throw new ReportDesignError('no_sources');
    const fast = run.snapshot.mode === 'fast';
    if (!fast) await this.verifyVision(run);
    const sourceHash = hashValue(parts);
    const evidence = await this.evidence(
      run,
      parts,
      resolved.some(s => s.status !== 'included'),
      sourceHash
    );
    run.sourceCoverage = evidence.coverage;
    const maxChapters = deckSlideRange(config).max;

    await this.progress(run, 'compose', 'planning');
    let derived: DerivedValue[] = [];
    const plan = await this.request(
      run,
      'plan',
      'Plan',
      {
        config: {
          ...deckConfigPayload(config),
          slideRange: undefined,
          chapterLimit: maxChapters,
        },
        instructions: config.instructions,
        customStyle: config.customStyle ?? '',
        evidence: this.evidencePayload(evidence),
        capabilities: {
          revealEffects: reportWebCapabilities().behaviours.reveal.values,
          interactions: ['switch', 'linked', 'scrolly', 'disclosure'],
          chartMarks: reportWebCapabilities().charts.marks,
          derivationOps: [
            'difference',
            'change_pct',
            'ratio',
            'share',
            'sum',
            'average',
            'max',
            'min',
          ],
        },
      },
      this.structured(ReportExperiencePlanSchema, value => {
        normalizeExperiencePlan(value);
        const lint = lintExperiencePlan(value, {
          facts: evidence.facts,
          datasets: evidence.datasets,
          maxChapters,
        });
        if (lint.errors.length) throw new StageFeedback(lint.errors);
      }),
      { schema: ReportExperiencePlanSchema }
    );
    derived = lintExperiencePlan(plan, {
      facts: evidence.facts,
      datasets: evidence.datasets,
      maxChapters,
    }).derived;

    const best = fast
      ? await this.fast(run, plan, evidence, derived)
      : await this.refine(run, plan, evidence, derived, maxChapters);
    if (errorsOf(best.issues).length)
      throw new ReportDesignError('quality_failed');

    await this.ai.assertUsable(run.owner, choice);
    const final = await this.readSources(run, rows, false);
    if (hashValue(final.parts) !== sourceHash)
      throw new ReportDesignError('no_sources');
    const record = await this.models.reportDeckDesign.existing(
      run.lease.deckId,
      run.lease.attempt
    );
    if (!record) throw new ReportDesignError('internal');
    const verified = best.browser.behaviors.filter(b => b.ok);
    const declared = best.behaviors.filter(b => b.kind !== 'reveal').length;
    const failedBehaviors = best.browser.behaviors.filter(b => !b.ok);
    const motionChapters = best.browser.motion.filter(m => m.animations > 0);
    const warnings: DeckQuality['warnings'] = [];
    if (run.sourceCoverage) warnings.push('source_coverage');
    if (fast) {
      // Fast path: deterministic browser checks only, by design.
    } else if (!run.vision) warnings.push('visual_unavailable');
    else if (best.visualChecked < best.visualTotal)
      warnings.push('visual_partial');
    if (
      best.issues.some(i => i.severity === 'warning') ||
      best.critique?.moves.some(m => m.severity === 'must')
    )
      warnings.push('design_warnings');
    if (
      !motionChapters.length ||
      best.browser.motion.some(m => m.hiddenAfter || m.infinite)
    )
      warnings.push('motion_degraded');
    if (failedBehaviors.length) warnings.push('interaction_degraded');
    const quality: DeckQuality = {
      version: REPORT_WEB_V4,
      artifactHash: best.hash,
      visual: !run.vision
        ? 'unavailable'
        : best.visualChecked < best.visualTotal
          ? 'partial'
          : 'complete',
      warnings,
      checkedCaptures: Math.min(300, best.visualChecked),
      totalCaptures: Math.min(300, best.visualTotal),
      repairs: record.repairs,
      experience: {
        behaviorsDeclared: Math.min(500, declared),
        behaviorsVerified: Math.min(
          500,
          new Set(verified.map(b => b.id)).size -
            new Set(failedBehaviors.map(b => b.id)).size
        ),
        motion: !motionChapters.length
          ? 'none'
          : warnings.includes('motion_degraded')
            ? 'degraded'
            : 'verified',
        charts: Math.min(60, best.charts),
      },
    };
    const retries = await this.countRetries(run);
    await this.models.reportDeckDesign.complete(run.lease, {
      html: best.html,
      title: config.title || best.plan.title,
      chapters: best.artifact.chapters.length,
      modelId: run.snapshot.capabilities.modelId,
      quality,
      usage: reportJson({
        engine: REPORT_WEB_V4,
        mode: fast ? 'fast' : 'refine',
        rejectedEvidence: evidence.rejected ?? 0,
        elapsedMs: Date.now() - run.started,
        calls: record.calls,
        formatRetries: retries,
        repairs: record.repairs,
        tokens: null,
        cost: null,
        timingsMs: run.timings,
        skill: run.snapshot.skill,
        promptHashes: run.snapshot.promptHashes,
        artifactHash: best.hash,
        direction: best.plan.direction.archetype,
        layouts: best.plan.chapters.map(ch => ch.layout.archetype),
        behaviors: best.browser.behaviors.map(b => ({
          id: b.id,
          mode: b.mode,
          ok: b.ok,
        })),
        motion: best.browser.motion,
        critique: best.critique
          ? {
              verdict: best.critique.verdict,
              moves: best.critique.moves.length,
            }
          : null,
      }),
    });
  }

  /** Refine mode: model visual review, structural repair, blind choice. */
  private async refine(
    run: ReportWebV4Run,
    plan: ReportExperiencePlan,
    evidence: EvidenceBundle,
    derived: DerivedValue[],
    maxChapters: number
  ): Promise<Candidate> {
    const artifact = await this.build(run, plan, evidence, derived);
    let best = await this.inspect(
      run,
      { plan, artifact, derived },
      evidence,
      'c0'
    );
    for (let round = 1; round <= 2; round++) {
      if (
        !this.needsRepair(best, round) ||
        run.deadline - Date.now() < 6 * 60000
      )
        break;
      if (
        !(await this.models.reportDeckDesign.reserveCorrection(
          run.lease,
          'repairs',
          `v4-repair-${round}`
        ))
      )
        break;
      await this.progress(run, 'render', 'repairing', round - 1, 2);
      let next: Candidate;
      try {
        const repaired = await this.repair(
          run,
          best,
          evidence,
          maxChapters,
          `repair-${round}`
        );
        next = await this.inspect(run, repaired, evidence, `c${round}`);
      } catch (error) {
        if (run.controller.signal.aborted) throw error;
        if (
          error instanceof ReportDesignError &&
          ['budget_exceeded', 'timeout'].includes(error.code)
        )
          break;
        this.logger.warn(
          `Report v4 repair round ${round} discarded: ${error instanceof Error ? error.message : 'unknown'}`
        );
        continue;
      }
      best = await this.choose(run, best, next, `compare-${round}`);
    }
    return best;
  }

  /**
   * Fast mode (~2 minutes): chapters are generated in parallel on the shared
   * tokens + rd-kit, checked deterministically in the browser, chapters with
   * hard errors are regenerated once, failed motion/interaction degrades to
   * static content. No model review in the critical path.
   */
  private async fast(
    run: ReportWebV4Run,
    plan: ReportExperiencePlan,
    evidence: EvidenceBundle,
    derived: DerivedValue[]
  ): Promise<Candidate> {
    let artifact = await this.buildParallel(run, plan, evidence, derived);
    let candidate = await this.inspect(
      run,
      { plan, artifact, derived },
      evidence,
      'f0',
      true
    );
    const hard = [
      ...new Set(
        errorsOf(candidate.issues)
          .filter(i => i.chapterId && i.viewport !== 'desktop-motion')
          .map(i => i.chapterId)
      ),
    ];
    if (hard.length && run.deadline - Date.now() > 3 * 60000) {
      await this.progress(run, 'render', 'repairing', 0, 1);
      artifact = await this.buildParallel(run, plan, evidence, derived, {
        artifact,
        issues: new Map(
          hard.map(id => [
            id,
            describe(candidate.issues.filter(i => i.chapterId === id)),
          ])
        ),
      });
      candidate = await this.inspect(
        run,
        { plan, artifact, derived },
        evidence,
        'f1',
        true
      );
    }
    const strip = new Map<string, Set<string>>();
    const mark = (chapterId: string, kind: string) => {
      if (!strip.has(chapterId)) strip.set(chapterId, new Set());
      strip.get(chapterId)?.add(kind);
    };
    for (const m of candidate.browser.motion)
      if (m.hiddenAfter || m.infinite) mark(m.chapterId, 'motion');
    for (const b of candidate.browser.behaviors)
      if (!b.ok) mark(b.chapterId, b.kind === 'reveal' ? 'motion' : b.kind);
    if (!strip.size) return candidate;
    artifact = {
      ...artifact,
      chapters: artifact.chapters.map(ch =>
        strip.has(ch.id)
          ? {
              ...ch,
              html: stripBehaviors(ch.html, [...(strip.get(ch.id) ?? [])]),
            }
          : ch
      ),
    };
    return this.inspect(run, { plan, artifact, derived }, evidence, 'f2', true);
  }

  /** Generates chapters concurrently (or regenerates the listed ones). */
  private async buildParallel(
    run: ReportWebV4Run,
    plan: ReportExperiencePlan,
    evidence: EvidenceBundle,
    derived: DerivedValue[],
    fix?: { artifact: ReportWebArtifact; issues: Map<string, string[]> }
  ): Promise<ReportWebArtifact> {
    const planHash = hashValue(plan);
    const title = run.snapshot.config.title || plan.title;
    const ids = fix ? [...fix.issues.keys()] : plan.chapters.map(ch => ch.id);
    let done = 0;
    await this.progress(run, 'compose', 'building', 0, ids.length);
    const built = await mapLimit(ids, 6, async id => {
      const index = plan.chapters.findIndex(ch => ch.id === id);
      const brief = (n: number) => {
        const ch = plan.chapters[n];
        return ch
          ? {
              id: ch.id,
              title: ch.title,
              layout: ch.layout.archetype,
              surface: ch.layout.surface,
            }
          : null;
      };
      const previous = fix?.artifact.chapters.find(ch => ch.id === id);
      const chapter = await this.request(
        run,
        fix ? `chapter-fix-${id}` : `chapter-${id}`,
        'Chapter',
        {
          config: deckConfigPayload(run.snapshot.config),
          instructions: run.snapshot.config.instructions,
          customStyle: run.snapshot.config.customStyle ?? '',
          plan,
          chapterId: id,
          position: { n: index + 1, total: plan.chapters.length },
          neighbors: { previous: brief(index - 1), next: brief(index + 1) },
          evidence: this.buildEvidence(evidence, derived, plan, [id]),
          capabilities: reportWebCapabilities(),
          ...(fix && previous
            ? {
                previousOutput: previous,
                previousIssues: fix.issues.get(id),
                instruction:
                  'Rewrite this chapter so every listed browser issue is fixed; keep its facts and design intent.',
              }
            : {}),
        },
        raw => {
          const bundle = parseReportBundle(String(raw));
          const feedback = this.chaptersFromBundle(bundle, [id], plan);
          if (feedback.length) throw new StageFeedback(feedback);
          const partial: ReportWebArtifact = {
            schemaVersion: REPORT_WEB_V4,
            planHash,
            title,
            sharedCss: '',
            chapters: bundle.chapters,
          };
          const errors = this.renderErrors(
            run,
            partial,
            plan,
            evidence,
            derived
          );
          if (errors.length) throw new StageFeedback(errors);
          return bundle.chapters[0];
        },
        { text: true }
      );
      await this.progress(run, 'compose', 'building', ++done, ids.length);
      return chapter;
    });
    const chapters = plan.chapters.map(
      p =>
        built.find(ch => ch.id === p.id) ??
        fix?.artifact.chapters.find(ch => ch.id === p.id)
    );
    if (chapters.some(ch => !ch))
      throw new ReportDesignError('model_invalid_output');
    return {
      schemaVersion: REPORT_WEB_V4,
      planHash,
      title,
      sharedCss: fix?.artifact.sharedCss ?? '',
      chapters: chapters as ReportWebArtifact['chapters'],
    };
  }

  private countRetries(run: ReportWebV4Run) {
    return this.models.reportDeckDesign.countArtifacts(run.lease, 'v4-retry-');
  }

  private async evidence(
    run: ReportWebV4Run,
    parts: DeckChunkPart[],
    partial: boolean,
    sourceHash: string
  ): Promise<EvidenceBundle> {
    const prior = await this.models.reportDeckDesign.readJson(
      run.lease,
      'evidence',
      sourceHash
    );
    if (prior) return EvidenceBundleSchema.parse(prior);
    const { config } = run.snapshot;
    const chunks = chunkDeckDocuments(
      parts,
      Math.min(24000, Math.max(3000, contextWindow(run) - 16000))
    );
    const budget = Math.max(1, run.snapshot.limits.maxCalls - 16);
    const usable = chunks.slice(0, budget);
    const facts: EvidenceFact[] = [];
    const datasets: ReportDataset[] = [];
    const relations: ReportRelation[] = [];
    let rejected = 0;
    await this.progress(run, 'extract', 'grounding', 0, usable.length);
    // Chunks are independent: extract them concurrently, ground in order.
    const outputs = await mapLimit(usable, 4, (chunk, i) =>
      this.request(
        run,
        `evidence-${i}`,
        'Facts',
        {
          config: deckConfigPayload(config),
          instructions: config.instructions,
          maxFacts: 30,
          documents: chunk.parts.map((p, doc) => ({ ...p, doc })),
        },
        this.structured(EvidenceExtractionSchema),
        { schema: EvidenceExtractionSchema }
      )
    );
    for (const [i, chunk] of usable.entries()) {
      const output = outputs[i];
      const grounded = groundEvidence(output, chunk, {
        dataset: datasets.length,
        relation: relations.length,
      });
      rejected += grounded.rejected;
      for (const fact of grounded.facts)
        if (!facts.some(f => f.id === fact.id)) facts.push(fact);
      for (const dataset of grounded.datasets) {
        const signature = dataset.rows
          .map(r => `${r.label}=${r.value}`)
          .join('|');
        if (
          !datasets.some(
            d =>
              d.rows.map(r => `${r.label}=${r.value}`).join('|') === signature
          )
        )
          datasets.push(dataset);
      }
      relations.push(...grounded.relations);
    }
    const selected = new Set(
      selectComposeFacts(
        facts,
        Math.max(4000, Math.min(30000, contextWindow(run) - 30000))
      ).map(f => f.id)
    );
    const bundle: EvidenceBundle = {
      facts: facts.filter(f => selected.has(f.id)),
      datasets: datasets.filter(d => d.rows.every(r => selected.has(r.factId))),
      relations: relations.filter(
        r =>
          selected.has(r.from) && selected.has(r.to) && selected.has(r.factId)
      ),
      coverage:
        partial ||
        usable.length < chunks.length ||
        selected.size < facts.length,
      // Unverifiable model claims are dropped silently; they are not missing
      // source material and must not alarm the reader.
      rejected,
    };
    if (!bundle.facts.length) throw new ReportDesignError('no_sources');
    await this.models.reportDeckDesign.saveJson(
      run.lease,
      'evidence',
      sourceHash,
      bundle
    );
    return bundle;
  }

  private evidencePayload(evidence: EvidenceBundle) {
    return {
      facts: evidence.facts.map(f => ({
        id: f.id,
        kind: f.kind,
        salience: f.salience,
        status: f.status,
        timeScope: f.timeScope,
        section: f.section,
        source: f.sourceTitle,
        role: f.role,
        text: f.text,
        quote: f.quote,
      })),
      datasets: evidence.datasets,
      relations: evidence.relations,
    };
  }

  private buildEvidence(
    evidence: EvidenceBundle,
    derived: DerivedValue[],
    plan: ReportExperiencePlan,
    ids?: string[]
  ) {
    const chapters = plan.chapters.filter(ch => !ids || ids.includes(ch.id));
    const factIds = new Set(chapters.flatMap(ch => ch.factIds));
    const datasetIds = new Set(chapters.flatMap(ch => ch.datasets));
    const derivedIds = new Set(chapters.flatMap(ch => ch.derivations));
    return {
      facts: evidence.facts
        .filter(f => factIds.has(f.id))
        .map(f => ({
          id: f.id,
          kind: f.kind,
          status: f.status,
          timeScope: f.timeScope,
          text: f.text,
          quote: f.quote,
        })),
      datasets: evidence.datasets.filter(d => datasetIds.has(d.id)),
      derived: derived
        .filter(d => derivedIds.has(d.id))
        .map(d => ({
          id: d.id,
          display: d.display,
          unit: d.unit,
          formula: d.formula,
        })),
    };
  }

  /** Validates a parsed bundle by actually rendering it; returns fixable errors. */
  private renderErrors(
    run: ReportWebV4Run,
    artifact: ReportWebArtifact,
    plan: ReportExperiencePlan,
    evidence: EvidenceBundle,
    derived: DerivedValue[]
  ) {
    const out = renderReportWeb({
      artifact,
      plan,
      evidence: { facts: evidence.facts, datasets: evidence.datasets, derived },
      language: run.snapshot.config.language,
    });
    return describe(errorsOf(out.issues));
  }

  private chaptersFromBundle(
    bundle: ReturnType<typeof parseReportBundle>,
    ids: string[],
    plan: ReportExperiencePlan
  ) {
    const feedback = [...bundle.errors];
    const got = bundle.chapters.map(ch => ch.id);
    if (got.join('|') !== ids.join('|'))
      feedback.push(
        `Output chapters ${got.join(', ') || '(none)'}; expected exactly ${ids.join(', ')} in this order.`
      );
    for (const ch of bundle.chapters)
      if (!plan.chapters.some(p => p.id === ch.id))
        feedback.push(`Chapter ${ch.id} is not in the plan.`);
    return feedback;
  }

  private async build(
    run: ReportWebV4Run,
    plan: ReportExperiencePlan,
    evidence: EvidenceBundle,
    derived: DerivedValue[]
  ): Promise<ReportWebArtifact> {
    const planHash = hashValue(plan);
    const title = run.snapshot.config.title || plan.title;
    const ids = plan.chapters.map(ch => ch.id);
    const common = {
      config: deckConfigPayload(run.snapshot.config),
      instructions: run.snapshot.config.instructions,
      customStyle: run.snapshot.config.customStyle ?? '',
      capabilities: reportWebCapabilities(),
    };
    await this.progress(run, 'compose', 'building');
    if (ids.length <= 6)
      return this.request(
        run,
        'build-full',
        'Build',
        {
          ...common,
          plan,
          evidence: this.buildEvidence(evidence, derived, plan),
        },
        raw => {
          const bundle = parseReportBundle(String(raw));
          const feedback = this.chaptersFromBundle(bundle, ids, plan);
          if (bundle.sharedCss === null)
            feedback.push('Missing <rd-shared> block.');
          if (feedback.length) throw new StageFeedback(feedback);
          const artifact: ReportWebArtifact = {
            schemaVersion: REPORT_WEB_V4,
            planHash,
            title,
            sharedCss: bundle.sharedCss ?? '',
            chapters: bundle.chapters,
          };
          const errors = this.renderErrors(
            run,
            artifact,
            plan,
            evidence,
            derived
          );
          if (errors.length) throw new StageFeedback(errors);
          return artifact;
        },
        { text: true }
      );
    const complex =
      plan.chapters.find((ch, i) => i > 0 && ch.charts.length) ??
      plan.chapters.find((ch, i) => i > 0 && ch.layout.density === 'high') ??
      plan.chapters[1];
    const pilotIds = ids.filter(id => id === ids[0] || id === complex.id);
    const groups = [
      pilotIds,
      ...batches(
        ids.filter(id => !pilotIds.includes(id)),
        3
      ),
    ];
    let sharedCss = '';
    const chapters: ReportWebArtifact['chapters'] = [];
    for (const [index, requested] of groups.entries()) {
      const reference =
        chapters.find(ch => ch.id === complex.id) ?? chapters[0];
      const response = await this.request(
        run,
        `build-batch-${index}`,
        'Batch',
        {
          ...common,
          plan,
          evidence: this.buildEvidence(evidence, derived, plan, requested),
          buildMode: index ? 'continuation' : 'pilot',
          requestedChapterIds: requested,
          ...(index
            ? {
                componentInventory: inventory(sharedCss),
                referenceChapter: reference
                  ? {
                      id: reference.id,
                      html: reference.html.slice(0, 8000),
                      css: reference.css.slice(0, 4000),
                    }
                  : null,
                usedLayouts: plan.chapters
                  .filter(ch => chapters.some(c => c.id === ch.id))
                  .map(ch => ({ id: ch.id, layout: ch.layout.archetype })),
              }
            : {}),
        },
        raw => {
          const bundle = parseReportBundle(String(raw));
          const feedback = this.chaptersFromBundle(bundle, requested, plan);
          if (!index && bundle.sharedCss === null)
            feedback.push('Pilot output must include <rd-shared>.');
          if (index && bundle.sharedCss)
            feedback.push(
              'Continuation must not output <rd-shared>; use <rd-shared-add> for new classes only.'
            );
          const added = index ? (bundle.sharedAdd ?? '') : '';
          const clash = [...classNames(added)].filter(name =>
            classNames(sharedCss).has(name)
          );
          if (clash.length)
            feedback.push(
              `<rd-shared-add> redefines existing classes: ${clash.slice(0, 8).join(', ')}.`
            );
          if (feedback.length) throw new StageFeedback(feedback);
          const shared = index
            ? `${sharedCss}\n${added}`
            : (bundle.sharedCss ?? '');
          const partial: ReportWebArtifact = {
            schemaVersion: REPORT_WEB_V4,
            planHash,
            title,
            sharedCss: shared,
            chapters: bundle.chapters,
          };
          const errors = this.renderErrors(
            run,
            partial,
            plan,
            evidence,
            derived
          );
          if (errors.length) throw new StageFeedback(errors);
          return { sharedCss: shared, chapters: bundle.chapters };
        },
        { text: true }
      );
      sharedCss = response.sharedCss;
      chapters.push(...response.chapters);
      await this.progress(run, 'compose', 'building', index + 1, groups.length);
    }
    return {
      schemaVersion: REPORT_WEB_V4,
      planHash,
      title,
      sharedCss,
      chapters: ids.map(id => {
        const chapter = chapters.find(ch => ch.id === id);
        if (!chapter) throw new ReportDesignError('model_invalid_output');
        return chapter;
      }),
    };
  }

  private async inspect(
    run: ReportWebV4Run,
    input: {
      plan: ReportExperiencePlan;
      artifact: ReportWebArtifact;
      derived: DerivedValue[];
    },
    evidence: EvidenceBundle,
    label: string,
    light = false
  ): Promise<Candidate> {
    await this.progress(run, 'render', 'checking');
    const rendered = renderReportWeb({
      artifact: input.artifact,
      plan: input.plan,
      evidence: {
        facts: evidence.facts,
        datasets: evidence.datasets,
        derived: input.derived,
      },
      language: run.snapshot.config.language,
    });
    if (Buffer.byteLength(rendered.html) > run.snapshot.limits.maxHtmlBytes)
      throw new ReportDesignError('budget_exceeded');
    await this.models.reportDeckDesign.saveJson(
      run.lease,
      `candidate-${label}`,
      rendered.hash,
      { ...input, html: rendered.html }
    );
    const browser = await this.browser(
      run,
      rendered,
      input.artifact.chapters.map(ch => ch.id),
      label,
      light
    );
    if (browser.artifactHash !== rendered.hash)
      throw new ReportDesignError('quality_failed');
    const issues = [...rendered.issues, ...browser.issues];
    for (const failed of browser.behaviors.filter(b => !b.ok))
      issues.push({
        id: `behavior-${issues.length}`,
        category: 'composition',
        severity: 'warning',
        chapterId: failed.chapterId,
        viewport: failed.mode,
        elementId: '',
        evidence:
          `[interaction] ${failed.id} (${failed.mode}): ${failed.detail}`.slice(
            0,
            1200
          ),
        suggestedFix:
          'Fix the declarative behaviour markup or remove the interaction.',
      });
    const candidate: Candidate = {
      ...input,
      html: rendered.html,
      hash: rendered.hash,
      behaviors: rendered.behaviors,
      charts: rendered.charts.length,
      issues,
      browser,
      critique: null,
      motion: null,
      visualChecked: 0,
      visualTotal: 0,
    };
    if (
      light ||
      !run.vision ||
      errorsOf(issues).some(i => ['structure', 'security'].includes(i.category))
    ) {
      candidate.visualTotal = browser.captures.length;
      return candidate;
    }
    await this.progress(run, 'render', 'reviewing', 0, 2);
    const sheets = browser.captures.filter(c => c.kind === 'sheet');
    const details = pickDetails(browser.captures, input.plan, 6);
    const staticImages = [...sheets, ...details];
    const films = pickFilms(browser, input.plan, 4);
    candidate.visualTotal = staticImages.length + films.length;
    const planSummary = {
      thesis: input.plan.thesis,
      direction: input.plan.direction,
      chapters: input.plan.chapters.map((ch, i) => ({
        n: i + 1,
        id: ch.id,
        title: ch.title,
        beat: ch.beat,
        takeaway: ch.takeaway,
        layout: ch.layout,
        charts: ch.charts.map(c => ({
          id: c.id,
          mark: c.mark,
          takeaway: c.takeaway,
        })),
        motion: ch.motion,
        interactions: ch.interactions,
      })),
    };
    try {
      candidate.critique = await this.request(
        run,
        `critique-${label}`,
        'Critique',
        {
          artifactHash: rendered.hash,
          plan: planSummary,
          captures: staticImages.map(({ bytes: _b, ...meta }) => meta),
          note: 'Captures hide the shell navigation bar; review the report content, not the shell.',
          deterministic: {
            issues: describe(
              issues.filter(i => !i.evidence.startsWith('[interaction]'))
            ),
            hero: browser.metrics.desktop?.hero ?? null,
            typography: {
              desktop: browser.metrics.desktop?.typography.slice(0, 40),
              mobile: browser.metrics.mobile?.typography.slice(0, 30),
            },
            longLines: browser.metrics.desktop?.longLines ?? [],
            contrast: browser.metrics.desktop?.contrast ?? [],
            layouts: input.plan.chapters.map(ch => ch.layout.archetype),
          },
        },
        this.structured(ReportCritiqueSchema, value => {
          if (value.artifactHash !== rendered.hash)
            throw new StageFeedback([`artifactHash must be ${rendered.hash}.`]);
          if (value.verdict !== 'ship' && !value.moves.length)
            throw new StageFeedback([
              'A non-ship verdict needs at least one move.',
            ]);
        }),
        { images: staticImages, schema: ReportCritiqueSchema }
      );
      candidate.visualChecked += staticImages.length;
    } catch (error) {
      if (run.controller.signal.aborted) throw error;
    }
    await this.progress(run, 'render', 'reviewing', 1, 2);
    try {
      candidate.motion = await this.request(
        run,
        `motion-${label}`,
        'Motion',
        {
          artifactHash: rendered.hash,
          plan: planSummary.chapters.map(ch => ({
            id: ch.id,
            n: ch.n,
            motion: ch.motion,
            interactions: ch.interactions,
          })),
          tokens: input.plan.tokens.motion,
          behaviors: browser.behaviors,
          motion: browser.motion,
          fallback: browser.fallback,
          captures: films.map(({ bytes: _b, ...meta }) => meta),
        },
        this.structured(ReportMotionCritiqueSchema, value => {
          if (value.artifactHash !== rendered.hash)
            throw new StageFeedback([`artifactHash must be ${rendered.hash}.`]);
        }),
        { images: films, schema: ReportMotionCritiqueSchema }
      );
      candidate.visualChecked += films.length;
    } catch (error) {
      if (run.controller.signal.aborted) throw error;
    }
    return candidate;
  }

  private async browser(
    run: ReportWebV4Run,
    rendered: ReturnType<typeof renderReportWeb>,
    chapterIds: string[],
    label: string,
    light = false
  ): Promise<WebBrowserReport> {
    const key = `browser-${label}`;
    const saved = (await this.models.reportDeckDesign.readJson(
      run.lease,
      key,
      rendered.hash
    )) as
      | (Omit<WebBrowserReport, 'captures'> & {
          captures: Array<Omit<WebCapture, 'bytes'> & { hash: string }>;
        })
      | null;
    if (saved) {
      const captures: WebCapture[] = [];
      for (const capture of saved.captures) {
        const row = await this.models.reportDeckDesign.readArtifact(
          run.lease,
          `shot-${rendered.hash.slice(0, 12)}-${capture.hash}`,
          rendered.hash
        );
        if (!row || row.hash !== capture.hash)
          throw new ReportDesignError('quality_failed');
        const { hash: _hash, ...meta } = capture;
        captures.push({ ...meta, bytes: Buffer.from(row.payload) });
      }
      return { ...saved, captures };
    }
    const started = Date.now();
    const browser = await this.renderer.inspectWeb(
      rendered.html,
      {
        chapterIds,
        behaviors: rendered.behaviors,
        language: run.snapshot.config.language,
        light,
      },
      run.controller.signal
    );
    run.timings.Browser = (run.timings.Browser ?? 0) + (Date.now() - started);
    for (const capture of browser.captures)
      await this.models.reportDeckDesign.saveArtifact(
        run.lease,
        `shot-${rendered.hash.slice(0, 12)}-${reportHash(capture.bytes)}`,
        rendered.hash,
        capture.bytes,
        capture.mime
      );
    await this.models.reportDeckDesign.saveJson(run.lease, key, rendered.hash, {
      ...browser,
      captures: browser.captures.map(({ bytes, ...meta }) => ({
        ...meta,
        hash: reportHash(bytes),
      })),
    });
    return browser;
  }

  /**
   * Round 1 acts on any non-ship verdict; a second round is only worth its
   * cost for must-level design problems, hard errors or broken behaviour.
   */
  private needsRepair(candidate: Candidate, round: number) {
    return (
      errorsOf(candidate.issues).length > 0 ||
      !!candidate.critique?.moves.some(m => m.severity === 'must') ||
      (round === 1 && (candidate.critique?.verdict ?? 'ship') !== 'ship') ||
      !!candidate.motion?.brokenBehaviors.length ||
      !!candidate.motion?.moves.some(m => m.severity === 'must') ||
      candidate.browser.behaviors.some(b => !b.ok)
    );
  }

  private async repair(
    run: ReportWebV4Run,
    candidate: Candidate,
    evidence: EvidenceBundle,
    maxChapters: number,
    key: string
  ): Promise<{
    plan: ReportExperiencePlan;
    artifact: ReportWebArtifact;
    derived: DerivedValue[];
  }> {
    const moves: DesignMove[] = [
      ...(candidate.critique?.moves ?? []),
      ...(candidate.motion?.moves ?? []),
    ].sort(
      (a, b) =>
        Number(b.severity === 'must') - Number(a.severity === 'must') ||
        a.rank - b.rank
    );
    const ids = candidate.artifact.chapters.map(ch => ch.id);
    const errorChapters = errorsOf(candidate.issues).map(i => i.chapterId);
    const brokenChapters = candidate.browser.behaviors
      .filter(b => !b.ok)
      .map(b => b.chapterId);
    const wanted = [
      ...errorChapters,
      ...moves.flatMap(m => m.chapterIds),
      ...brokenChapters,
    ].filter(id => ids.includes(id));
    const allowed = [...new Set(wanted)].slice(0, 6);
    if (!allowed.length) allowed.push(...ids.slice(0, Math.min(3, ids.length)));
    const images = [
      ...candidate.browser.captures.filter(
        c => c.kind === 'sheet' && c.viewport === 'desktop'
      ),
      ...candidate.browser.captures
        .filter(
          c =>
            c.kind === 'detail' &&
            allowed.includes(c.chapterId) &&
            c.viewport !== 'present'
        )
        .slice(0, 5),
    ];
    const deterministic = describe(
      candidate.issues.filter(
        i => !i.chapterId || allowed.includes(i.chapterId)
      )
    );
    return this.request(
      run,
      key,
      'Repair',
      {
        config: deckConfigPayload(run.snapshot.config),
        plan: candidate.plan,
        allowedChapterIds: allowed,
        chapters: candidate.artifact.chapters.filter(ch =>
          allowed.includes(ch.id)
        ),
        sharedCss: candidate.artifact.sharedCss,
        componentInventory: inventory(candidate.artifact.sharedCss),
        moves,
        brokenBehaviors: [
          ...(candidate.motion?.brokenBehaviors ?? []),
          ...candidate.browser.behaviors
            .filter(b => !b.ok)
            .map(b => `${b.id} (${b.mode}): ${b.detail}`),
        ],
        strengths: [
          ...(candidate.critique?.strengths ?? []),
          ...(candidate.motion?.strengths ?? []),
        ],
        deterministicIssues: deterministic,
        evidence: {
          ...this.buildEvidence(
            evidence,
            candidate.derived,
            candidate.plan,
            allowed
          ),
          // Any grounded dataset may be charted by an addChart operation.
          datasets: evidence.datasets,
        },
        capabilities: reportWebCapabilities(),
        captures: images.map(({ bytes: _b, ...meta }) => meta),
      },
      raw => {
        const bundle = parseReportBundle(String(raw));
        const feedback = bundle.errors.filter(
          e => !e.startsWith('No <rd-chapter')
        );
        const header = ReportRepairHeaderSchema.safeParse(
          normalizeRepairHeader(
            bundle.repair ?? { ops: [], addressed: [], unresolved: [] }
          )
        );
        if (!header.success)
          throw new StageFeedback(
            header.error.issues
              .slice(0, 12)
              .map(i => `<rd-repair> ${i.path.join('.')}: ${i.message}`)
          );
        const touched = new Set(
          header.data.ops.flatMap(op =>
            op.op === 'mergeChapters'
              ? [op.into, op.from]
              : 'chapterId' in op
                ? [op.chapterId]
                : []
          )
        );
        for (const id of touched)
          if (!allowed.includes(id))
            feedback.push(
              `Operation touches ${id}, which is not in allowedChapterIds.`
            );
        const applied = applyPlanOps(candidate.plan, header.data.ops);
        normalizeExperiencePlan(applied.plan);
        feedback.push(...applied.errors);
        const lint = lintExperiencePlan(applied.plan, {
          facts: evidence.facts,
          datasets: evidence.datasets,
          maxChapters,
          strictComposition: false,
        });
        feedback.push(...lint.errors);
        const remaining = new Set(applied.plan.chapters.map(ch => ch.id));
        const required = allowed.filter(
          id =>
            remaining.has(id) && (touched.has(id) || errorChapters.includes(id))
        );
        // Chapters outside the allowed scope are ignored rather than fatal.
        bundle.chapters = bundle.chapters.filter(
          ch => allowed.includes(ch.id) && remaining.has(ch.id)
        );
        for (const id of required)
          if (!bundle.chapters.some(ch => ch.id === id))
            feedback.push(
              `Rewrite chapter ${id}; its plan changed or it has errors.`
            );
        if (!bundle.chapters.length && !bundle.sharedCss && !bundle.sharedAdd)
          feedback.push(
            'The repair changed nothing; rewrite the affected chapters.'
          );
        if (feedback.length) throw new StageFeedback(feedback);
        const sharedCss =
          bundle.sharedCss ??
          `${candidate.artifact.sharedCss}${bundle.sharedAdd ? `\n${bundle.sharedAdd}` : ''}`;
        const artifact: ReportWebArtifact = {
          schemaVersion: REPORT_WEB_V4,
          planHash: hashValue(applied.plan),
          title: candidate.artifact.title,
          sharedCss,
          chapters: applied.plan.chapters.flatMap(p => {
            const chapter =
              bundle.chapters.find(ch => ch.id === p.id) ??
              candidate.artifact.chapters.find(ch => ch.id === p.id);
            return chapter ? [chapter] : [];
          }),
        };
        const errors = this.renderErrors(
          run,
          artifact,
          applied.plan,
          evidence,
          lint.derived
        );
        if (errors.length) throw new StageFeedback(errors);
        return { plan: applied.plan, artifact, derived: lint.derived };
      },
      { text: true, images }
    );
  }

  /** Keeps the better candidate: hard gates first, then a blind comparison. */
  private async choose(
    run: ReportWebV4Run,
    current: Candidate,
    next: Candidate,
    key: string
  ) {
    const hard = (c: Candidate) => errorsOf(c.issues).length;
    if (hard(next) < hard(current)) return next;
    if (hard(next) > hard(current)) return current;
    const broken = (c: Candidate) =>
      c.browser.behaviors.filter(b => !b.ok).length;
    if (!run.vision)
      return broken(next) <= broken(current) &&
        next.issues.length <= current.issues.length
        ? next
        : current;
    const sheets = (c: Candidate) =>
      c.browser.captures.filter(x => x.kind === 'sheet');
    const nextFirst = parseInt(next.hash.slice(0, 2), 16) % 2 === 0;
    const [a, b] = nextFirst ? [next, current] : [current, next];
    const label = (c: Candidate, name: string) =>
      sheets(c).map(s => ({ ...s, id: `${name}-${s.viewport}` }));
    try {
      const verdict: ReportCompare = await this.request(
        run,
        key,
        'Compare',
        {
          thesis: current.plan.thesis,
          A: {
            chapters: a.artifact.chapters.length,
            issues: describe(a.issues).slice(0, 10),
            behaviorsBroken: broken(a),
          },
          B: {
            chapters: b.artifact.chapters.length,
            issues: describe(b.issues).slice(0, 10),
            behaviorsBroken: broken(b),
          },
          captures: [...label(a, 'A'), ...label(b, 'B')].map(
            ({ bytes: _b, ...meta }) => meta
          ),
        },
        this.structured(ReportCompareSchema),
        {
          images: [...label(a, 'A'), ...label(b, 'B')],
          schema: ReportCompareSchema,
        }
      );
      const preferred =
        verdict.preferred === 'A' ? a : verdict.preferred === 'B' ? b : null;
      if (
        preferred === next &&
        verdict.confidence !== 'low' &&
        broken(next) <= broken(current)
      )
        return next;
      return current;
    } catch (error) {
      if (run.controller.signal.aborted) throw error;
      return current;
    }
  }
}

/** Accepts `type` as an alias of `op` in repair operations. */
function normalizeRepairHeader(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const header = value as { ops?: unknown };
  if (Array.isArray(header.ops))
    header.ops = header.ops.map(op =>
      op && typeof op === 'object' && !('op' in op) && 'type' in op
        ? (({ type, ...rest }) => ({ op: type, ...rest }))(
            op as { type: unknown }
          )
        : op
    );
  return header;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return out;
}

function classNames(css: string) {
  return new Set([...css.matchAll(/\.(rd-[a-z0-9_-]+)/gi)].map(m => m[1]));
}

/** Shared component classes with the first declaration block, for reuse. */
function inventory(css: string) {
  const out: Array<{ className: string; rule: string }> = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const names = [...match[1].matchAll(/\.(rd-[a-z0-9_-]+)/gi)].map(m => m[1]);
    for (const name of names)
      if (!out.some(item => item.className === name))
        out.push({
          className: name,
          rule: `${match[1].trim().slice(0, 80)}{${match[2].trim().slice(0, 140)}}`,
        });
  }
  return out.slice(0, 60);
}

function pickDetails(
  captures: WebCapture[],
  plan: ReportExperiencePlan,
  limit: number
) {
  const details = captures.filter(c => c.kind === 'detail');
  const order = [
    details.find(
      c => c.viewport === 'desktop' && c.chapterId === plan.chapters[0]?.id
    ),
    details.find(
      c => c.viewport === 'mobile' && c.chapterId === plan.chapters[0]?.id
    ),
    ...plan.chapters
      .filter(ch => ch.charts.length || ch.layout.density === 'high')
      .flatMap(ch => [
        details.find(c => c.viewport === 'desktop' && c.chapterId === ch.id),
        details.find(c => c.viewport === 'mobile' && c.chapterId === ch.id),
      ]),
    details.find(c => c.viewport === 'present'),
    ...details.filter(c => c.viewport === 'desktop'),
  ].filter((c): c is WebCapture => !!c);
  return [...new Map(order.map(c => [c.id, c])).values()].slice(0, limit);
}

function pickFilms(
  browser: WebBrowserReport,
  plan: ReportExperiencePlan,
  limit: number
) {
  const films = browser.captures.filter(c => c.kind === 'film');
  const weight = (id: string) =>
    (browser.motion.find(m => m.chapterId === id)?.animations ?? 0) +
    (plan.chapters.findIndex(ch => ch.id === id) === 0 ? 100 : 0);
  return films
    .sort((a, b) => weight(b.chapterId) - weight(a.chapterId))
    .slice(0, limit);
}
