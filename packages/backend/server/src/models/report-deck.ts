import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { BaseModel } from './base';

export type ReportDeckSourceInput = {
  scopeKind: string;
  scopeId: string;
  kind: string;
  resourceId: string | null;
  titleSnapshot: string;
  status?: string;
  reason?: string | null;
  chars?: number | null;
};

export type ReportDeckCreateInput = {
  generationVersion?: number;
  ownerUserId: string;
  requestKey: string;
  title: string;
  mode: string;
  templateKey: string | null;
  config: Prisma.InputJsonValue;
  aiScopeKind: string;
  aiScopeId: string;
  modelId: string | null;
  sources: ReportDeckSourceInput[];
  maxActive: number;
};

export const REPORT_DECK_ACTIVE_STATUSES = ['queued', 'generating'];
/** Longer than the 15 minute job deadline plus queue wait. */
export const REPORT_DECK_STALE_MS = 30 * 60 * 1000;

const deckInclude = {
  sources: { orderBy: { position: 'asc' } },
  shares: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ReportDeckInclude;

export type ReportDeckRecord = Prisma.ReportDeckGetPayload<{
  include: typeof deckInclude;
}>;

const summarySelect = {
  id: true,
  title: true,
  status: true,
  mode: true,
  templateKey: true,
  slideCount: true,
  progress: true,
  errorCode: true,
  createdAt: true,
  completedAt: true,
  sources: { select: { status: true } },
} satisfies Prisma.ReportDeckSelect;

export type ReportDeckSummaryRecord = Prisma.ReportDeckGetPayload<{
  select: typeof summarySelect;
}>;

export class ReportDeckConcurrencyError extends Error {
  constructor() {
    super('Too many report decks are generating');
  }
}

@Injectable()
export class ReportDeckModel extends BaseModel {
  async findByRequestKey(ownerUserId: string, requestKey: string) {
    return this.db.reportDeck.findUnique({
      where: { ownerUserId_requestKey: { ownerUserId, requestKey } },
      include: deckInclude,
    });
  }

  /**
   * Create a deck with its ordered sources. The same request key returns the
   * existing deck. A per-owner advisory lock serializes the concurrency limit.
   */
  @Transactional()
  async create(input: ReportDeckCreateInput) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'report-deck-owner:' + input.ownerUserId}, 0))`;
    const existing = await this.findByRequestKey(
      input.ownerUserId,
      input.requestKey
    );
    if (existing) return { deck: existing, created: false };
    const active = await this.countActive(input.ownerUserId);
    if (active >= input.maxActive) throw new ReportDeckConcurrencyError();
    const deck = await this.db.reportDeck.create({
      data: {
        ownerUserId: input.ownerUserId,
        requestKey: input.requestKey,
        title: input.title,
        mode: input.mode,
        templateKey: input.templateKey,
        config: input.config,
        generationVersion: input.generationVersion ?? 2,
        progress: { phase: 'queued', done: 0, total: 0 },
        aiScopeKind: input.aiScopeKind,
        aiScopeId: input.aiScopeId,
        modelId: input.modelId,
        sources: {
          create: input.sources.map((source, position) => ({
            position,
            scopeKind: source.scopeKind,
            scopeId: source.scopeId,
            kind: source.kind,
            resourceId: source.resourceId,
            titleSnapshot: source.titleSnapshot.slice(0, 512),
            status: source.status ?? 'pending',
            reason: source.reason ?? null,
            chars: source.chars ?? null,
          })),
        },
      },
      include: deckInclude,
    });
    return { deck, created: true };
  }

  /**
   * A run that stopped reporting progress (worker crash, lost job) would hold
   * a concurrency slot forever; treat it as timed out. Progress writes bump
   * `updatedAt`, so live runs are never touched.
   */
  async expireStale(ownerUserId: string) {
    await this.db.reportDeck.updateMany({
      where: {
        ownerUserId,
        deletedAt: null,
        status: { in: REPORT_DECK_ACTIVE_STATUSES },
        updatedAt: { lt: new Date(Date.now() - REPORT_DECK_STALE_MS) },
      },
      data: { status: 'failed', errorCode: 'timeout', completedAt: new Date() },
    });
  }

  async countActive(ownerUserId: string) {
    await this.expireStale(ownerUserId);
    return this.db.reportDeck.count({
      where: {
        ownerUserId,
        deletedAt: null,
        status: { in: REPORT_DECK_ACTIVE_STATUSES },
      },
    });
  }

  async get(ownerUserId: string, deckId: string) {
    return this.db.reportDeck.findFirst({
      where: { id: deckId, ownerUserId, deletedAt: null },
      include: deckInclude,
    });
  }

  /** Internal read for the generation job; never exposed without an owner check. */
  async getForRun(deckId: string) {
    return this.db.reportDeck.findFirst({
      where: { id: deckId, deletedAt: null },
      include: { sources: { orderBy: { position: 'asc' } } },
    });
  }

  async html(ownerUserId: string, deckId: string) {
    return this.db.reportDeck.findFirst({
      where: { id: deckId, ownerUserId, deletedAt: null },
      select: { id: true, title: true, status: true, htmlGzip: true },
    });
  }

  async list(input: {
    ownerUserId: string;
    cursor?: { createdAt: Date; id: string } | null;
    limit: number;
  }) {
    if (!input.cursor) await this.expireStale(input.ownerUserId);
    const rows = await this.db.reportDeck.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        deletedAt: null,
        ...(input.cursor
          ? {
              OR: [
                { createdAt: { lt: input.cursor.createdAt } },
                {
                  createdAt: input.cursor.createdAt,
                  id: { lt: input.cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      select: summarySelect,
    });
    const more = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      next: more && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  /** Move a queued deck of the expected attempt into generation. */
  async claim(deckId: string, attempt: number) {
    const changed = await this.db.reportDeck.updateMany({
      where: {
        id: deckId,
        runAttempt: attempt,
        status: 'queued',
        deletedAt: null,
      },
      data: {
        status: 'generating',
        progress: { phase: 'sources', done: 0, total: 0 },
      },
    });
    return changed.count > 0;
  }

  /** Whether the run of this attempt may continue. */
  async isRunning(deckId: string, attempt: number) {
    return !!(await this.db.reportDeck.findFirst({
      where: {
        id: deckId,
        runAttempt: attempt,
        status: 'generating',
        deletedAt: null,
      },
      select: { id: true },
    }));
  }

  async setProgress(
    deckId: string,
    attempt: number,
    progress: { phase: string; done: number; total: number }
  ) {
    await this.db.reportDeck.updateMany({
      where: { id: deckId, runAttempt: attempt, status: 'generating' },
      data: { progress },
    });
  }

  /** Replace the source statuses observed by a run, preserving order. */
  @Transactional()
  async setSourceStatuses(
    deckId: string,
    rows: {
      id: string;
      status: string;
      reason: string | null;
      chars: number | null;
      titleSnapshot?: string;
    }[]
  ) {
    for (const row of rows)
      await this.db.reportDeckSource.updateMany({
        where: { id: row.id, deckId },
        data: {
          status: row.status,
          reason: row.reason,
          chars: row.chars,
          ...(row.titleSnapshot
            ? { titleSnapshot: row.titleSnapshot.slice(0, 512) }
            : {}),
        },
      });
  }

  async complete(
    deckId: string,
    attempt: number,
    input: {
      htmlGzip: Uint8Array;
      htmlBytes: number;
      slideCount: number;
      modelId: string | null;
      usage: Prisma.InputJsonValue;
      title?: string;
    }
  ) {
    const changed = await this.db.reportDeck.updateMany({
      where: { id: deckId, runAttempt: attempt, status: 'generating' },
      data: {
        status: 'ready',
        htmlGzip: Buffer.from(input.htmlGzip),
        htmlBytes: input.htmlBytes,
        slideCount: input.slideCount,
        modelId: input.modelId,
        usage: input.usage,
        errorCode: null,
        progress: { phase: 'done', done: 1, total: 1 },
        completedAt: new Date(),
        ...(input.title ? { title: input.title.slice(0, 512) } : {}),
      },
    });
    return changed.count > 0;
  }

  async fail(
    deckId: string,
    attempt: number,
    errorCode: string,
    usage?: Prisma.InputJsonValue
  ) {
    const changed = await this.db.reportDeck.updateMany({
      where: {
        id: deckId,
        runAttempt: attempt,
        status: { in: REPORT_DECK_ACTIVE_STATUSES },
      },
      data: {
        status: 'failed',
        errorCode,
        completedAt: new Date(),
        ...(usage ? { usage } : {}),
      },
    });
    return changed.count > 0;
  }

  async cancel(ownerUserId: string, deckId: string) {
    const changed = await this.db.reportDeck.updateMany({
      where: {
        id: deckId,
        ownerUserId,
        deletedAt: null,
        status: { in: REPORT_DECK_ACTIVE_STATUSES },
      },
      data: {
        status: 'cancelled',
        errorCode: 'cancelled',
        completedAt: new Date(),
      },
    });
    return changed.count > 0;
  }

  /** Requeue a failed or cancelled deck; returns the new attempt or null. */
  @Transactional()
  async retry(ownerUserId: string, deckId: string, maxActive: number) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'report-deck-owner:' + ownerUserId}, 0))`;
    if ((await this.countActive(ownerUserId)) >= maxActive)
      throw new ReportDeckConcurrencyError();
    const changed = await this.db.reportDeck.updateMany({
      where: {
        id: deckId,
        ownerUserId,
        deletedAt: null,
        status: { in: ['failed', 'cancelled'] },
      },
      data: {
        status: 'queued',
        errorCode: null,
        completedAt: null,
        progress: { phase: 'queued', done: 0, total: 0 },
        runAttempt: { increment: 1 },
      },
    });
    if (!changed.count) return null;
    const deck = await this.db.reportDeck.findUniqueOrThrow({
      where: { id: deckId },
      select: { runAttempt: true },
    });
    return deck.runAttempt;
  }

  /** Soft delete and revoke every share in one transaction. */
  @Transactional()
  async softDelete(ownerUserId: string, deckId: string) {
    const now = new Date();
    const changed = await this.db.reportDeck.updateMany({
      where: { id: deckId, ownerUserId, deletedAt: null },
      data: {
        deletedAt: now,
        // A running job observes the status change and stops.
        status: 'cancelled',
        htmlGzip: null,
      },
    });
    if (!changed.count) return false;
    await this.db.reportDeckShare.updateMany({
      where: { deckId, revokedAt: null },
      data: { revokedAt: now },
    });
    return true;
  }

  async createShare(input: {
    deckId: string;
    tokenHash: string;
    tokenCipher: string;
    passwordHash: string | null;
    allowDownload: boolean;
    expiresAt: Date;
  }) {
    return this.db.reportDeckShare.create({ data: input });
  }

  async revokeShare(ownerUserId: string, shareId: string) {
    const share = await this.db.reportDeckShare.findFirst({
      where: { id: shareId, deck: { ownerUserId, deletedAt: null } },
    });
    if (!share) return null;
    if (!share.revokedAt)
      await this.db.reportDeckShare.updateMany({
        where: { id: shareId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    return share;
  }

  async findShare(shareId: string) {
    return this.db.reportDeckShare.findUnique({
      where: { id: shareId },
      include: {
        deck: {
          select: {
            id: true,
            title: true,
            status: true,
            slideCount: true,
            deletedAt: true,
          },
        },
      },
    });
  }

  /** HTML of a deck already authorized through a share; never owner-scoped. */
  async sharedHtml(deckId: string) {
    return this.db.reportDeck.findFirst({
      where: { id: deckId, deletedAt: null, status: 'ready' },
      select: { id: true, title: true, htmlGzip: true },
    });
  }
}
