import './config';

import {
  type DeckAiChoice,
  DeckAiOptionsInputSchema,
  type DeckAiOptionsResult,
  type DeckCommandResult,
  DeckCommandSchema,
  type DeckConfig,
  DeckConfigSchema,
  type DeckDetail,
  type DeckErrorCode,
  type DeckListResult,
  DeckPreflightInputSchema,
  type DeckPreflightResult,
  type DeckProgress,
  DeckQualitySchema,
  type DeckSourceRef,
  type DeckSourceView,
  DeckSubphaseSchema,
  type DeckSummary,
} from '@localmind/office/report-deck';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';

import { AccessDenied, BadRequest, Config } from '../../base';
import { Models } from '../../models';
import {
  ReportDeckConcurrencyError,
  type ReportDeckRecord,
  type ReportDeckSummaryRecord,
} from '../../models/report-deck';
import { ReportDeckAiService } from '../../plugins/copilot/report-deck-ai';
import { ReportDeckGenerationService } from '../../plugins/copilot/report-deck-generation';
import { hasDeckTemplate } from '../../plugins/copilot/report-deck-render';
import { ReportDeckShareService } from './share';
import { estimateDeckMinutes } from './source-rules';
import { ReportDeckSourceService } from './sources';

const cursorSchema = z.object({ c: z.string(), i: z.string() }).strict();

export function encodeDeckCursor(cursor: { createdAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })
  ).toString('base64url');
}

export function decodeDeckCursor(value?: string | null) {
  if (!value) return null;
  try {
    if (value.length > 512) throw new Error('cursor too long');
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    );
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime())) throw new Error('invalid date');
    return { createdAt, id: parsed.i };
  } catch {
    throw new BadRequest('Invalid report deck cursor');
  }
}

const progressSchema = z
  .object({
    phase: z.enum([
      'queued',
      'sources',
      'extract',
      'compose',
      'render',
      'done',
    ]),
    done: z.number(),
    total: z.number(),
    subphase: DeckSubphaseSchema.optional(),
  })
  .passthrough();

function progressOf(value: unknown): DeckProgress {
  const parsed = progressSchema.safeParse(value);
  return parsed.success
    ? {
        phase: parsed.data.phase,
        done: parsed.data.done,
        total: parsed.data.total,
        ...(parsed.data.subphase ? { subphase: parsed.data.subphase } : {}),
      }
    : { phase: 'queued', done: 0, total: 0 };
}

const sourceRef = (row: ReportDeckRecord['sources'][number]): DeckSourceRef =>
  ({
    scopeKind: row.scopeKind,
    scopeId: row.scopeId,
    kind: row.kind,
    ...(row.resourceId ? { resourceId: row.resourceId } : {}),
    title: row.titleSnapshot,
  }) as DeckSourceRef;

@Injectable()
export class ReportDeckService {
  constructor(
    private readonly models: Models,
    private readonly ref: ModuleRef,
    private readonly sources: ReportDeckSourceService,
    private readonly shares: ReportDeckShareService,
    private readonly config: Config
  ) {}

  private get ai() {
    return this.ref.get(ReportDeckAiService, { strict: false });
  }
  private get generation() {
    return this.ref.get(ReportDeckGenerationService, { strict: false });
  }

  private summary(row: ReportDeckSummaryRecord): DeckSummary {
    const config = DeckConfigSchema.safeParse(row.config);
    return {
      ...(config.success &&
      config.data.mode === 'custom' &&
      config.data.designMode
        ? { designMode: config.data.designMode }
        : {}),
      id: row.id,
      title: row.title,
      status: row.status as DeckSummary['status'],
      mode: row.mode as DeckSummary['mode'],
      templateKey: row.templateKey,
      slideCount: row.slideCount,
      sourceCount: row.sources.length,
      excludedCount: row.sources.filter(source => source.status === 'excluded')
        .length,
      progress: progressOf(row.progress),
      errorCode: (row.errorCode as DeckErrorCode | null) ?? null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private async detailOf(row: ReportDeckRecord): Promise<DeckDetail> {
    const label = await this.sources.scopeLabels([
      ...row.sources.map(source => ({
        scopeKind: source.scopeKind as DeckSourceRef['scopeKind'],
        scopeId: source.scopeId,
      })),
      {
        scopeKind: row.aiScopeKind as DeckSourceRef['scopeKind'],
        scopeId: row.aiScopeId,
      },
    ]);
    const config = DeckConfigSchema.safeParse(row.config);
    const quality = DeckQualitySchema.safeParse(row.quality);
    return {
      ...this.summary(row),
      ...(quality.success ? { quality: quality.data } : {}),
      config: (config.success ? config.data : row.config) as DeckConfig,
      ai: {
        scopeKind: row.aiScopeKind as DeckSourceRef['scopeKind'],
        scopeId: row.aiScopeId,
        scopeLabel: label(
          row.aiScopeKind as DeckSourceRef['scopeKind'],
          row.aiScopeId
        ),
      },
      modelId: row.modelId,
      htmlBytes: row.htmlBytes,
      sources: row.sources.map(
        (source): DeckSourceView => ({
          scopeKind: source.scopeKind as DeckSourceView['scopeKind'],
          scopeId: source.scopeId,
          scopeLabel: label(
            source.scopeKind as DeckSourceRef['scopeKind'],
            source.scopeId
          ),
          kind: source.kind as DeckSourceView['kind'],
          resourceId: source.resourceId,
          title: source.titleSnapshot,
          status: source.status as DeckSourceView['status'],
          reason: (source.reason as DeckSourceView['reason']) ?? null,
          chars: source.chars,
        })
      ),
      shares: row.shares.map(share => this.shares.view(share)),
    };
  }

  private async owned(ownerUserId: string, deckId: string) {
    const deck = await this.models.reportDeck.get(ownerUserId, deckId);
    if (!deck) throw new AccessDenied('Report deck is unavailable');
    return deck;
  }

  async list(
    ownerUserId: string,
    input: { cursor?: string | null; limit?: number | null }
  ): Promise<DeckListResult> {
    const limit = z
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(input.limit ?? 20);
    const page = await this.models.reportDeck.list({
      ownerUserId,
      cursor: decodeDeckCursor(input.cursor),
      limit,
    });
    return {
      items: page.items.map(row => this.summary(row)),
      nextCursor: page.next ? encodeDeckCursor(page.next) : null,
    };
  }

  async detail(ownerUserId: string, deckId: string): Promise<DeckDetail> {
    return this.detailOf(await this.owned(ownerUserId, deckId));
  }

  async preflight(
    ownerUserId: string,
    raw: unknown
  ): Promise<DeckPreflightResult> {
    const input = DeckPreflightInputSchema.parse(raw);
    const resolved = await this.sources.resolve(
      ownerUserId,
      input.sources,
      'estimate'
    );
    const totalChars = resolved.reduce((sum, item) => sum + item.chars, 0);
    const excludedCount = resolved.filter(
      item => item.status === 'excluded'
    ).length;
    return {
      sources: resolved.map(item => this.sources.view(item)),
      totalChars,
      includedCount: resolved.length - excludedCount,
      excludedCount,
      estimatedMinutes: estimateDeckMinutes(totalChars),
    };
  }

  async aiOptions(
    ownerUserId: string,
    raw: unknown
  ): Promise<DeckAiOptionsResult> {
    const input = DeckAiOptionsInputSchema.parse(raw);
    const scopes = input.sources.map(source => ({
      scopeKind: source.scopeKind,
      scopeId: source.scopeId,
    }));
    // Labels are resolved in one query once every candidate scope is known.
    const options = await this.ai.options(ownerUserId, scopes, () => '');
    const label = await this.sources.scopeLabels(options.options);
    return {
      ...options,
      options: options.options.map(option => ({
        ...option,
        label: label(option.scopeKind, option.scopeId),
      })),
    };
  }

  async command(ownerUserId: string, raw: unknown): Promise<DeckCommandResult> {
    const command = DeckCommandSchema.parse(raw);
    switch (command.operation) {
      case 'create':
        return {
          deck: await this.create(ownerUserId, {
            requestKey: command.requestKey,
            sources: command.sources,
            config: command.config,
          }),
        };
      case 'regenerate': {
        const prior = await this.models.reportDeck.findByRequestKey(
          ownerUserId,
          command.requestKey
        );
        if (prior) return { deck: await this.detailOf(prior) };
        const deck = await this.owned(ownerUserId, command.deckId);
        const config = DeckConfigSchema.parse(deck.config);
        // Regeneration is a new submission; only retries retain the selection.
        if (config.mode === 'custom') config.designMode = 'fast';
        return {
          deck: await this.create(ownerUserId, {
            requestKey: command.requestKey,
            sources: deck.sources.map(sourceRef),
            config,
            // Reuse the deck's AI scope; it fails instead of switching.
            ai: {
              scopeKind: deck.aiScopeKind as DeckAiChoice['scopeKind'],
              scopeId: deck.aiScopeId,
              ...(config.ai?.modelId ? { modelId: config.ai.modelId } : {}),
            },
          }),
        };
      }
      case 'retry': {
        this.assertEnabled();
        await this.owned(ownerUserId, command.deckId);
        const attempt = await this.models.reportDeck
          .retry(ownerUserId, command.deckId, this.maxActive)
          .catch(error => {
            throw this.concurrency(error);
          });
        if (attempt === null)
          throw new BadRequest(
            'Only a failed or cancelled deck can be retried'
          );
        await this.generation.enqueue(command.deckId, attempt);
        return { deck: await this.detail(ownerUserId, command.deckId) };
      }
      case 'cancel': {
        await this.owned(ownerUserId, command.deckId);
        await this.models.reportDeck.cancel(ownerUserId, command.deckId);
        return { deck: await this.detail(ownerUserId, command.deckId) };
      }
      case 'delete': {
        await this.owned(ownerUserId, command.deckId);
        await this.models.reportDeck.softDelete(ownerUserId, command.deckId);
        return { deleted: true };
      }
      case 'share.create': {
        const share = await this.shares.create({
          ownerUserId,
          deckId: command.deckId,
          expiresInDays: command.expiresInDays,
          password: command.password,
          allowDownload: command.allowDownload,
        });
        return { share, deck: await this.detail(ownerUserId, command.deckId) };
      }
      case 'share.revoke': {
        const share = await this.shares.revoke(ownerUserId, command.shareId);
        const deck = await this.detail(ownerUserId, share.deckId);
        const view = deck.shares.find(item => item.id === share.id);
        if (!view) throw new AccessDenied('Report deck share is unavailable');
        return { share: view, deck };
      }
    }
  }

  private get maxActive() {
    return this.config.reportDecks.maxConcurrentPerUser;
  }

  private assertEnabled() {
    if (!this.config.reportDecks.enabled)
      throw new BadRequest('Report decks are disabled');
  }

  private concurrency(error: unknown) {
    return error instanceof ReportDeckConcurrencyError
      ? new BadRequest(
          `At most ${this.maxActive} report decks can generate at the same time`
        )
      : error;
  }

  private async create(
    ownerUserId: string,
    input: {
      requestKey: string;
      sources: DeckSourceRef[];
      config: DeckConfig;
      ai?: DeckAiChoice;
    }
  ): Promise<DeckDetail> {
    const prior = await this.models.reportDeck.findByRequestKey(
      ownerUserId,
      input.requestKey
    );
    if (prior) return this.detailOf(prior);
    this.assertEnabled();
    const config = { ...input.config };
    if (config.mode === 'custom' && this.config.reportDecks.customDesignV3) {
      // Freeze the effective mode at creation, before the job starts.
      config.designMode ??= this.config.reportDecks.webRefine
        ? 'refine'
        : 'fast';
    } else if (config.designMode !== undefined) {
      throw new BadRequest('Custom report generation modes are unavailable');
    }
    if (config.mode === 'template' && !hasDeckTemplate(config.templateKey))
      throw new BadRequest('Report deck template is unavailable');
    if (input.sources.length > this.config.reportDecks.maxSources)
      throw new BadRequest('Too many report deck sources');
    if (
      (await this.models.reportDeck.countActive(ownerUserId)) >= this.maxActive
    )
      throw this.concurrency(new ReportDeckConcurrencyError());
    const resolved = await this.sources.resolve(
      ownerUserId,
      input.sources,
      'estimate'
    );
    const readable = resolved.filter(source => source.status !== 'excluded');
    if (!readable.length)
      throw new BadRequest('None of the selected sources can be read');
    // Default AI follows the first readable source's scope (plan §5.1).
    const ai = await this.ai.resolve(
      ownerUserId,
      readable.map(source => source.ref),
      input.ai ?? config.ai
    );
    const title =
      config.title?.trim() ||
      readable[0]?.title?.trim() ||
      (config.language === 'en' ? 'Report' : '汇报');
    const { deck, created } = await this.models.reportDeck
      .create({
        ownerUserId,
        requestKey: input.requestKey,
        title,
        mode: config.mode,
        generationVersion:
          config.mode === 'custom' && this.config.reportDecks.customDesignV3
            ? 3
            : 2,
        templateKey:
          config.mode === 'template' ? (config.templateKey ?? null) : null,
        config: JSON.parse(JSON.stringify(config)),
        aiScopeKind: ai.scopeKind,
        aiScopeId: ai.scopeId,
        modelId: ai.scopeKind === 'workspace' ? (ai.modelId ?? null) : null,
        sources: resolved.map(source => ({
          scopeKind: source.ref.scopeKind,
          scopeId: source.ref.scopeId,
          kind: source.ref.kind,
          resourceId: source.ref.resourceId ?? null,
          titleSnapshot: source.title || source.ref.title || source.scopeLabel,
          status: source.status === 'excluded' ? 'excluded' : 'pending',
          reason: source.reason,
          chars: source.chars,
        })),
        maxActive: this.maxActive,
      })
      .catch(error => {
        throw this.concurrency(error);
      });
    if (created) await this.generation.enqueue(deck.id, deck.runAttempt);
    return this.detailOf(deck);
  }
}
