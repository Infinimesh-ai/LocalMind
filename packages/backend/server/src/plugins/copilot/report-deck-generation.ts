import '../../core/report-deck/config';

import { gzipSync } from 'node:zlib';

import {
  DECK_LIMITS,
  type DeckAiChoice,
  type DeckConfig,
  DeckConfigSchema,
  type DeckErrorCode,
  type DeckPhase,
  type DeckSourceRef,
  type DeckSpec,
  DeckSpecSchema,
} from '@localmind/office/report-deck';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { Config, JobQueue, OnJob } from '../../base';
import {
  ReportDeckSourceService,
  type ResolvedDeckSource,
} from '../../core/report-deck/sources';
import { Models } from '../../models';
import { isInvalidStructuredOutputError } from '../../native';
import { ReportDeckAiService, ReportDeckAiUnavailable } from './report-deck-ai';
import {
  batches,
  chunkDeckDocuments,
  composeFactsPayload,
  DECK_COMPOSE_PROMPT,
  DECK_CUSTOM_BATCH,
  DECK_CUSTOM_DESIGN_PROMPT,
  DECK_CUSTOM_SLIDES_PROMPT,
  DECK_EXTRACT_PROMPT,
  DECK_PROMPTS,
  type DeckChunkPart,
  deckConfigPayload,
  type DeckCustomDesign,
  DeckCustomDesignSchema,
  DeckExtractionSchema,
  deckSlideRange,
  explainCustomDesign,
  fallbackSlide,
  groundDeckFacts,
  type GroundedDeckFact,
  htmlTextContent,
  parseCustomDesign,
  selectComposeFacts,
  splitSlideSections,
} from './report-deck-prompts';
import {
  DECK_FONT_SANS,
  deckTemplateBrief,
  renderTemplateDeck,
  sanitizeCustomCss,
  sanitizeCustomSlide,
  wrapCustomDeck,
} from './report-deck-render';
import { ReportWebGenerationService } from './report-web-design/generation';
import { ensurePromptResponseSchemaHash } from './runtime/contracts/structured-output-contract';
import { PromptRuntime } from './runtime/prompt-runtime';

declare global {
  interface Jobs {
    'copilot.reportDeck.generate': { deckId: string; attempt: number };
  }
}

const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const CALL_TIMEOUT_MS = 120 * 1000;
const COMPOSE_MAX_TOKENS = 16000;
const EXTRACT_MAX_TOKENS = 12000;

export class DeckRunError extends Error {
  constructor(
    readonly code: DeckErrorCode,
    /** The model spent its whole output budget without answering (reasoning models). */
    readonly emptyOutput = false
  ) {
    super(code);
  }
}

const MAX_RETRY_TOKENS = 32000;
// Reasoning models that run out of output budget either answer with no text
// or end the stream as incomplete.
const EMPTY_OUTPUT_PATTERN =
  /did not contain text content|response\.incomplete|max_output_tokens/i;
const REJECTED_REQUEST_PATTERN = /status (400|422)\b/;

type Run = {
  deckId: string;
  attempt: number;
  ownerUserId: string;
  config: DeckConfig;
  choice: DeckAiChoice;
  modelId: string | null;
  deadline: number;
  usage: {
    calls: number;
    inputChars: number;
    outputChars: number;
    extractChunks: number;
    skippedChunks: number;
    rejectedFacts: number;
    facts: number;
    composeRetries: number;
    slideRewrites: number;
  };
};

/** Maps a model/runtime failure to a deck error code. */
export function deckErrorCodeFor(error: unknown): DeckErrorCode {
  if (error instanceof DeckRunError) return error.code;
  if (error instanceof ReportDeckAiUnavailable) return 'provider_unavailable';
  if (isInvalidStructuredOutputError(error)) return 'model_invalid_output';
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  return 'internal';
}

/** Model calls kept back for composition so extraction cannot starve it. */
export function deckComposeReserve(
  config: Pick<DeckConfig, 'mode' | 'length'>
) {
  if (config.mode === 'template') return 2;
  const { max } = deckSlideRange(config);
  // design + retry, one call per batch, and a few single-page rewrites.
  return 2 + Math.ceil(max / DECK_CUSTOM_BATCH) + 3;
}

/**
 * One-shot report deck generation (plan §5). Runs as the deck owner with the
 * AI scope fixed at creation; it never switches scope at run time.
 */
@Injectable()
export class ReportDeckGenerationService {
  private readonly logger = new Logger(ReportDeckGenerationService.name);
  private seeded = false;

  constructor(
    private readonly models: Models,
    private readonly sources: ReportDeckSourceService,
    private readonly ai: ReportDeckAiService,
    private readonly prompts: PromptRuntime,
    private readonly config: Config,
    private readonly queue: JobQueue,
    @Optional() private readonly design?: ReportWebGenerationService
  ) {}

  async enqueue(deckId: string, attempt: number) {
    await this.queue.add(
      'copilot.reportDeck.generate',
      { deckId, attempt },
      { jobId: `report-deck-${deckId}-${attempt}` }
    );
  }

  @OnJob('copilot.reportDeck.generate')
  async generate(input: Jobs['copilot.reportDeck.generate']) {
    const pending = await this.models.reportDeck.getForRun(input.deckId);
    if (pending?.generationVersion === 3) {
      if (!this.design) throw new DeckRunError('internal');
      await this.design.generate(input.deckId, input.attempt);
      return;
    }
    if (!(await this.models.reportDeck.claim(input.deckId, input.attempt)))
      return;
    const deck = await this.models.reportDeck.getForRun(input.deckId);
    if (!deck) return;
    let run: Run | undefined;
    try {
      const config = DeckConfigSchema.parse(deck.config);
      run = {
        deckId: deck.id,
        attempt: input.attempt,
        ownerUserId: deck.ownerUserId,
        config,
        choice: {
          scopeKind: deck.aiScopeKind as DeckAiChoice['scopeKind'],
          scopeId: deck.aiScopeId,
          ...(deck.aiScopeKind === 'workspace' && deck.modelId
            ? { modelId: deck.modelId }
            : {}),
        },
        modelId: deck.modelId,
        deadline: Date.now() + RUN_TIMEOUT_MS,
        usage: {
          calls: 0,
          inputChars: 0,
          outputChars: 0,
          extractChunks: 0,
          skippedChunks: 0,
          rejectedFacts: 0,
          facts: 0,
          composeRetries: 0,
          slideRewrites: 0,
        },
      };
      await this.execute(run, deck.sources);
    } catch (error) {
      const code = deckErrorCodeFor(error);
      if (code === 'internal')
        this.logger.error(
          `Report deck ${input.deckId} failed`,
          error instanceof Error ? error.stack : String(error)
        );
      if (code !== 'cancelled')
        await this.models.reportDeck.fail(
          input.deckId,
          input.attempt,
          code,
          run ? JSON.parse(JSON.stringify(run.usage)) : undefined
        );
    }
  }

  private async execute(
    run: Run,
    rows: {
      id: string;
      scopeKind: string;
      scopeId: string;
      kind: string;
      resourceId: string | null;
      titleSnapshot: string;
    }[]
  ) {
    // Re-validate the stored AI as the owner; never fall back to another scope.
    const option = await this.ai.assertUsable(run.ownerUserId, run.choice);
    if (run.choice.scopeKind === 'project') run.modelId = option.defaultModelId;
    await this.seedPrompts();

    await this.progress(run, 'sources', 0, rows.length);
    const refs = rows.map(
      row =>
        ({
          scopeKind: row.scopeKind,
          scopeId: row.scopeId,
          kind: row.kind,
          ...(row.resourceId ? { resourceId: row.resourceId } : {}),
          title: row.titleSnapshot,
        }) as DeckSourceRef
    );
    const resolved = await this.sources.resolve(run.ownerUserId, refs, 'read', {
      cancelled: async () =>
        !(await this.models.reportDeck.isRunning(run.deckId, run.attempt)),
    });
    await this.assertRunning(run);
    await this.models.reportDeck.setSourceStatuses(
      run.deckId,
      resolved.map(source => ({
        id: rows[source.index].id,
        status: source.status,
        reason: source.reason,
        chars: source.chars,
        ...(source.title ? { titleSnapshot: source.title } : {}),
      }))
    );
    const documents = this.chunkParts(resolved);
    if (!documents.length) throw new DeckRunError('no_sources');

    const facts = await this.extract(run, documents);
    const selected = selectComposeFacts(facts);
    const excerpts = selected.length ? [] : this.excerpts(documents);
    const sourceTitles = [
      ...new Set(resolved.filter(s => s.documents.length).map(s => s.title)),
    ];

    const result =
      run.config.mode === 'template'
        ? await this.template(run, selected, excerpts, sourceTitles)
        : await this.custom(run, selected, excerpts);

    await this.progress(run, 'render', 0, 1);
    const bytes = Buffer.byteLength(result.html, 'utf8');
    if (bytes > this.config.reportDecks.maxHtmlBytes)
      throw new DeckRunError('budget_exceeded');
    await this.assertRunning(run);
    await this.models.reportDeck.complete(run.deckId, run.attempt, {
      htmlGzip: gzipSync(Buffer.from(result.html, 'utf8')),
      htmlBytes: bytes,
      slideCount: result.slideCount,
      modelId: run.modelId,
      usage: JSON.parse(JSON.stringify(run.usage)),
      ...(!run.config.title && result.title ? { title: result.title } : {}),
    });
  }

  // ------------------------------------------------------------- extraction

  private chunkParts(resolved: ResolvedDeckSource[]): DeckChunkPart[] {
    return resolved.flatMap(source =>
      source.documents
        .filter(document => document.text.trim())
        .map(document => ({
          sourceIndex: source.index,
          sourceTitle: source.title || document.title,
          title: document.title,
          role: document.role,
          text: document.text,
        }))
    );
  }

  private excerpts(parts: DeckChunkPart[]) {
    const result: { source: string; text: string }[] = [];
    let remaining = 30000;
    for (const part of parts) {
      if (remaining <= 0) break;
      const text = part.text.slice(0, Math.min(2000, remaining));
      remaining -= text.length;
      result.push({ source: part.sourceTitle, text });
    }
    return result;
  }

  private async extract(run: Run, parts: DeckChunkPart[]) {
    const chunks = chunkDeckDocuments(parts);
    const callBudget = Math.max(
      1,
      this.config.reportDecks.maxModelCalls - deckComposeReserve(run.config)
    );
    const usable = chunks.slice(0, callBudget);
    run.usage.extractChunks = usable.length;
    run.usage.skippedChunks = chunks.length - usable.length;
    const facts: GroundedDeckFact[] = [];
    await this.progress(run, 'extract', 0, usable.length);
    for (const [index, chunk] of usable.entries()) {
      let output: unknown;
      try {
        output = await this.structured(
          run,
          DECK_EXTRACT_PROMPT,
          DeckExtractionSchema,
          {
            config: deckConfigPayload(run.config),
            documents: chunk.parts.map((part, doc) => ({
              doc,
              title: part.title,
              source: part.sourceTitle,
              ...(part.role === 'background' ? { backgroundOnly: true } : {}),
              ...(part.role === 'work_order' ? { workOrderStatus: true } : {}),
              text: part.text,
            })),
          },
          EXTRACT_MAX_TOKENS
        );
      } catch (error) {
        // One unusable extraction should not discard the whole deck.
        if (deckErrorCodeFor(error) !== 'model_invalid_output') throw error;
        await this.progress(run, 'extract', index + 1, usable.length);
        continue;
      }
      const grounded = groundDeckFacts(output, chunk);
      run.usage.rejectedFacts += grounded.rejected;
      for (const fact of grounded.facts)
        if (!facts.some(existing => existing.id === fact.id)) facts.push(fact);
      await this.progress(run, 'extract', index + 1, usable.length);
    }
    run.usage.facts = facts.length;
    return facts;
  }

  // --------------------------------------------------------------- template

  private async template(
    run: Run,
    facts: GroundedDeckFact[],
    excerpts: { source: string; text: string }[],
    sourceTitles: string[]
  ) {
    await this.progress(run, 'compose', 0, 1);
    const template = deckTemplateBrief(run.config.templateKey);
    if (!template) throw new DeckRunError('internal');
    const range = deckSlideRange(run.config);
    const payload = {
      config: deckConfigPayload(run.config, template),
      instructions: run.config.instructions,
      sources: sourceTitles,
      facts: composeFactsPayload(facts),
      ...(excerpts.length ? { excerpts } : {}),
    };
    let previousError: string | undefined;
    let fallback: DeckSpec | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let output: unknown;
      try {
        output = await this.structured(
          run,
          DECK_COMPOSE_PROMPT,
          DeckSpecSchema,
          previousError ? { ...payload, previousError } : payload,
          COMPOSE_MAX_TOKENS
        );
      } catch (error) {
        if (deckErrorCodeFor(error) !== 'model_invalid_output') throw error;
        previousError =
          'The output was not valid JSON for the DeckSpec schema. Return only the JSON object.';
        run.usage.composeRetries++;
        continue;
      }
      const parsed = DeckSpecSchema.safeParse(output);
      if (!parsed.success) {
        previousError = parsed.error.issues
          .slice(0, 12)
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join('\n');
        run.usage.composeRetries++;
        continue;
      }
      const count = parsed.data.slides.length;
      if (count < range.min || count > range.max) {
        fallback = parsed.data;
        previousError = `The deck has ${count} slides; it must have between ${range.min} and ${range.max}.`;
        run.usage.composeRetries++;
        continue;
      }
      return this.renderTemplate(run, parsed.data);
    }
    // A schema-valid deck with a slightly wrong length is still usable.
    if (fallback && fallback.slides.length >= DECK_LIMITS.minSlides)
      return this.renderTemplate(run, {
        ...fallback,
        slides: fallback.slides.slice(0, range.max),
      });
    throw new DeckRunError('model_invalid_output');
  }

  private renderTemplate(run: Run, spec: DeckSpec) {
    const cleaned: DeckSpec = run.config.preferences.citations
      ? spec
      : {
          ...spec,
          slides: spec.slides.map(
            ({ citations: _citations, ...slide }) => slide
          ),
        };
    const titled = run.config.title
      ? { ...cleaned, title: run.config.title }
      : cleaned;
    const rendered = renderTemplateDeck({ spec: titled, config: run.config });
    return { ...rendered, title: titled.title };
  }

  // ----------------------------------------------------------------- custom

  private async custom(
    run: Run,
    facts: GroundedDeckFact[],
    excerpts: { source: string; text: string }[]
  ) {
    const range = deckSlideRange(run.config);
    const base = {
      config: deckConfigPayload(run.config),
      instructions: run.config.instructions,
      fonts: DECK_FONT_SANS,
    };
    const factsPayload = composeFactsPayload(selectComposeFacts(facts, 40000));
    const designPayload = (previousError?: string) => ({
      ...base,
      facts: factsPayload,
      ...(excerpts.length ? { excerpts } : {}),
      ...(previousError ? { previousError } : {}),
    });
    // Structured output keeps long CSS strings valid JSON; plain text with
    // defensive parsing is the fallback for providers that reject the schema.
    let design: DeckCustomDesign | null = null;
    try {
      const value = await this.structured(
        run,
        DECK_CUSTOM_DESIGN_PROMPT,
        DeckCustomDesignSchema,
        designPayload(),
        COMPOSE_MAX_TOKENS
      );
      const parsed = DeckCustomDesignSchema.safeParse(value);
      if (parsed.success) design = parsed.data;
      else
        this.logger.warn(
          `Report deck custom design was invalid: ${parsed.error.issues
            .slice(0, 3)
            .map(issue => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`
        );
    } catch (error) {
      if (deckErrorCodeFor(error) !== 'model_invalid_output') throw error;
      this.logger.warn(
        `Report deck structured custom design failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!design) {
      const text = await this.text(
        run,
        DECK_CUSTOM_DESIGN_PROMPT,
        designPayload(
          'Return only one JSON object {"title","css","outline"} without Markdown. Escape newlines and quotes inside the css string.'
        ),
        COMPOSE_MAX_TOKENS
      );
      design = parseCustomDesign(text);
      if (!design)
        this.logger.warn(
          `Report deck custom design could not be parsed (${text.length} chars): ${explainCustomDesign(text)}; tail: ${text.slice(-160)}`
        );
    }
    if (!design) throw new DeckRunError('model_invalid_output');
    const outline = design.outline.slice(0, range.max);
    const css = sanitizeCustomCss(design.css);
    const groups = batches(outline, DECK_CUSTOM_BATCH);
    await this.progress(run, 'compose', 0, groups.length);
    const slides: string[] = [];
    for (const [groupIndex, group] of groups.entries()) {
      const first = groupIndex * DECK_CUSTOM_BATCH;
      const slidePayload = (items: typeof group, offset: number) => ({
        ...base,
        deckTitle: run.config.title || design.title || '',
        css,
        facts: factsPayload,
        ...(excerpts.length ? { excerpts } : {}),
        slides: items.map((item, index) => ({
          number: offset + index + 1,
          total: outline.length,
          ...item,
        })),
      });
      const sections = splitSlideSections(
        await this.text(
          run,
          DECK_CUSTOM_SLIDES_PROMPT,
          slidePayload(group, first),
          COMPOSE_MAX_TOKENS
        )
      );
      for (const [index, item] of group.entries()) {
        let html = this.cleanSlide(sections[index]);
        if (!html) {
          // Rewrite an empty or fully-removed page once.
          run.usage.slideRewrites++;
          const retry = splitSlideSections(
            await this.text(
              run,
              DECK_CUSTOM_SLIDES_PROMPT,
              slidePayload([item], first + index),
              COMPOSE_MAX_TOKENS
            )
          );
          html = this.cleanSlide(retry[0]);
        }
        slides.push(
          html ??
            sanitizeCustomSlide(fallbackSlide(item.title, item.summary)).html
        );
      }
      await this.progress(run, 'compose', groupIndex + 1, groups.length);
    }
    const title = run.config.title || design.title || outline[0]?.title || '';
    const html = wrapCustomDeck({
      title,
      language: run.config.language,
      accentColor: run.config.accentColor,
      css,
      slidesHtml: slides.join('\n'),
    });
    return { html, slideCount: slides.length, title };
  }

  private cleanSlide(section: string | undefined) {
    if (!section) return null;
    const sanitized = sanitizeCustomSlide(section);
    if (sanitized.slideCount < 1 || !htmlTextContent(sanitized.html))
      return null;
    return sanitized.html;
  }

  // ------------------------------------------------------------- model calls

  private async seedPrompts() {
    if (this.seeded) return;
    for (const prompt of DECK_PROMPTS)
      await this.models.projectReportGeneration.seedPrompt(prompt);
    this.seeded = true;
  }

  private async beforeCall(run: Run, content: string) {
    await this.assertRunning(run);
    if (Date.now() >= run.deadline) throw new DeckRunError('timeout');
    if (run.usage.calls >= this.config.reportDecks.maxModelCalls)
      throw new DeckRunError('budget_exceeded');
    run.usage.calls++;
    run.usage.inputChars += content.length;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(CALL_TIMEOUT_MS, Math.max(1000, run.deadline - Date.now()))
    );
    return { controller, done: () => clearTimeout(timer) };
  }

  /**
   * Reasoning models can exhaust `maxTokens` before writing the answer; such
   * calls are retried once with a larger budget.
   */
  private async structured<T>(
    run: Run,
    promptName: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    payload: unknown,
    maxTokens: number
  ): Promise<unknown> {
    try {
      return await this.structuredOnce(
        run,
        promptName,
        schema,
        payload,
        maxTokens
      );
    } catch (error) {
      if (!(error instanceof DeckRunError) || !error.emptyOutput) throw error;
      return await this.structuredOnce(
        run,
        promptName,
        schema,
        payload,
        Math.min(maxTokens * 2, MAX_RETRY_TOKENS)
      );
    }
  }

  private async structuredOnce<T>(
    run: Run,
    promptName: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    payload: unknown,
    maxTokens: number
  ): Promise<unknown> {
    const content = JSON.stringify(payload);
    const responseSchemaJson = zodToJsonSchema(schema, {
      $refStrategy: 'none',
      target: 'openAi',
    }) as Record<string, unknown>;
    delete responseSchemaJson.$schema;
    const schemaHash = ensurePromptResponseSchemaHash(responseSchemaJson);
    if (!schemaHash) throw new DeckRunError('internal');
    const call = await this.beforeCall(run, content);
    const { modelId, providerOptions } = this.ai.providerOptions(
      run.ownerUserId,
      run.choice
    );
    try {
      const output = await this.prompts.runStructured(
        promptName,
        { content },
        {
          modelId,
          responseContract: { responseSchemaJson, schemaHash },
          providerOptions: {
            ...providerOptions,
            signal: call.controller.signal,
            maxTokens,
          },
        }
      );
      if (output.model) run.modelId = output.model;
      run.usage.outputChars += (JSON.stringify(output.value) ?? '').length;
      return output.value;
    } catch (error) {
      throw this.callError(error, call.controller);
    } finally {
      call.done();
    }
  }

  private async text(
    run: Run,
    promptName: string,
    payload: unknown,
    maxTokens: number
  ): Promise<string> {
    try {
      return await this.textOnce(run, promptName, payload, maxTokens);
    } catch (error) {
      if (!(error instanceof DeckRunError) || !error.emptyOutput) throw error;
      return await this.textOnce(
        run,
        promptName,
        payload,
        Math.min(maxTokens * 2, MAX_RETRY_TOKENS)
      );
    }
  }

  private async textOnce(
    run: Run,
    promptName: string,
    payload: unknown,
    maxTokens: number
  ): Promise<string> {
    const content = JSON.stringify(payload);
    const call = await this.beforeCall(run, content);
    const { modelId, providerOptions } = this.ai.providerOptions(
      run.ownerUserId,
      run.choice
    );
    try {
      const output = await this.prompts.runText(
        promptName,
        { content },
        {
          modelId,
          providerOptions: {
            ...providerOptions,
            signal: call.controller.signal,
            maxTokens,
          },
        }
      );
      const text = typeof output === 'string' ? output : String(output ?? '');
      run.usage.outputChars += text.length;
      return text;
    } catch (error) {
      throw this.callError(error, call.controller);
    } finally {
      call.done();
    }
  }

  private callError(error: unknown, controller: AbortController) {
    if (error instanceof DeckRunError) return error;
    if (controller.signal.aborted) return new DeckRunError('timeout');
    if (isInvalidStructuredOutputError(error)) {
      this.logger.warn(
        `Report deck structured output was invalid: ${error instanceof Error ? error.message : String(error)}`
      );
      return new DeckRunError('model_invalid_output');
    }
    if (error instanceof Error && EMPTY_OUTPUT_PATTERN.test(error.message))
      return new DeckRunError('model_invalid_output', true);
    // A rejected request (bad schema, unsupported parameter) is not a missing
    // provider; keep "unavailable" for auth, quota and network failures.
    if (
      error instanceof Error &&
      REJECTED_REQUEST_PATTERN.test(error.message)
    ) {
      this.logger.warn(`Report deck model request rejected: ${error.message}`);
      return new DeckRunError('model_invalid_output');
    }
    this.logger.warn(
      `Report deck model call failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return new DeckRunError('provider_unavailable');
  }

  private async assertRunning(run: Run) {
    if (!(await this.models.reportDeck.isRunning(run.deckId, run.attempt)))
      throw new DeckRunError('cancelled');
  }

  private async progress(
    run: Run,
    phase: DeckPhase,
    done: number,
    total: number
  ) {
    await this.models.reportDeck.setProgress(run.deckId, run.attempt, {
      phase,
      done,
      total,
    });
  }
}
