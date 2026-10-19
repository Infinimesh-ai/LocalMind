import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import type {
  DeckErrorCode,
  DeckProgress,
  DeckQuality,
} from '@localmind/office/report-deck';
import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { BaseModel } from './base';
import type { Models } from './index';

export const reportHash = (input: string | Uint8Array) =>
  createHash('sha256').update(input).digest('hex');
export const reportJson = (input: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(input));
export const REPORT_DESIGN_LEASE_MS = 90_000;
export class ReportDesignError extends Error {
  constructor(readonly code: DeckErrorCode) {
    super(code);
  }
}
export type ReportDesignLease = {
  id: string;
  deckId: string;
  attempt: number;
  leaseOwner: string;
  fence: number;
};

@Injectable()
export class ReportDeckDesignModel extends BaseModel {
  private async lockDeck(deckId: string) {
    await this.db
      .$queryRaw`SELECT id FROM report_decks WHERE id = ${deckId} FOR UPDATE`;
  }

  @Transactional()
  async claim(
    deckId: string,
    attempt: number,
    snapshot: Prisma.InputJsonValue,
    maxDurationMs: number
  ) {
    await this.lockDeck(deckId);
    const deck = await this.db.reportDeck.findFirst({
      where: {
        id: deckId,
        runAttempt: attempt,
        deletedAt: null,
        generationVersion: 3,
        status: { in: ['queued', 'generating'] },
      },
    });
    if (!deck) return null;
    const old = await this.db.reportDeckRun.findUnique({
      where: { deckId_attempt: { deckId, attempt } },
    });
    if (
      old &&
      (old.status !== 'running' || old.leaseExpiresAt.getTime() > Date.now())
    )
      return null;
    const leaseOwner = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + REPORT_DESIGN_LEASE_MS);
    const run = old
      ? await this.db.reportDeckRun.update({
          where: { id: old.id },
          data: { leaseOwner, leaseExpiresAt, fence: { increment: 1 } },
        })
      : await this.db.reportDeckRun.create({
          data: {
            deckId,
            attempt,
            leaseOwner,
            leaseExpiresAt,
            snapshot,
            deadline: new Date(Date.now() + maxDurationMs),
          },
        });
    await this.db.reportDeckStep.updateMany({
      where: { runId: run.id, status: 'running' },
      data: {
        status: 'outcome_unknown',
        errorCode: 'worker_interrupted',
        completedAt: new Date(),
      },
    });
    await this.db.reportDeck.update({
      where: { id: deckId },
      data: {
        status: 'generating',
        progress: { phase: 'sources', done: 0, total: 0, subphase: 'reading' },
      },
    });
    return run;
  }

  async existing(deckId: string, attempt: number) {
    return this.db.reportDeckRun.findUnique({
      where: { deckId_attempt: { deckId, attempt } },
    });
  }

  private async assertLease(lease: ReportDesignLease, checkDeadline = true) {
    await this.lockDeck(lease.deckId);
    const run = await this.db.reportDeckRun.findFirst({
      where: {
        id: lease.id,
        deckId: lease.deckId,
        attempt: lease.attempt,
        leaseOwner: lease.leaseOwner,
        fence: lease.fence,
        status: 'running',
        leaseExpiresAt: { gt: new Date() },
        deck: {
          deletedAt: null,
          runAttempt: lease.attempt,
          status: 'generating',
        },
      },
    });
    if (!run) throw new ReportDesignError('cancelled');
    if (checkDeadline && run.deadline.getTime() <= Date.now())
      throw new ReportDesignError('timeout');
    return run;
  }

  @Transactional()
  async authorizeImageInput(
    lease: ReportDesignLease,
    context: { userId?: string; projectId?: string; workspaceId?: string }
  ) {
    const run = await this.assertLease(lease);
    const deck = await this.db.reportDeck.findUniqueOrThrow({
      where: { id: lease.deckId },
    });
    const step = await this.db.reportDeckStep.findFirst({
      where: { runId: run.id, status: 'running' },
      orderBy: { sequence: 'desc' },
    });
    const snapshot = run.snapshot as { capabilities?: { modelId?: unknown } };
    const modelId = snapshot.capabilities?.modelId;
    if (
      context.userId !== deck.ownerUserId ||
      (deck.aiScopeKind === 'project'
        ? context.projectId !== deck.aiScopeId
        : context.workspaceId !== deck.aiScopeId) ||
      !step ||
      !['Vision', 'Review'].includes(step.stage) ||
      typeof modelId !== 'string' ||
      !modelId
    )
      throw new ReportDesignError('provider_unavailable');
    return modelId;
  }

  @Transactional()
  async heartbeat(lease: ReportDesignLease) {
    await this.assertLease(lease);
    await this.db.reportDeckRun.update({
      where: { id: lease.id },
      data: { leaseExpiresAt: new Date(Date.now() + REPORT_DESIGN_LEASE_MS) },
    });
    await this.db.reportDeck.update({
      where: { id: lease.deckId },
      data: { updatedAt: new Date() },
    });
  }

  @Transactional()
  async progress(lease: ReportDesignLease, progress: DeckProgress) {
    await this.assertLease(lease);
    await this.db.reportDeck.update({
      where: { id: lease.deckId },
      data: { progress: reportJson(progress) },
    });
  }

  @Transactional()
  async reserveCall(
    lease: ReportDesignLease,
    stage: string,
    inputHash: string,
    inputChars: number,
    maxCalls: number
  ) {
    const run = await this.assertLease(lease);
    if (run.calls >= maxCalls) throw new ReportDesignError('budget_exceeded');
    const next = await this.db.reportDeckRun.update({
      where: { id: lease.id },
      data: { calls: { increment: 1 } },
    });
    return this.db.reportDeckStep.create({
      data: {
        runId: run.id,
        sequence: next.calls,
        stage,
        inputHash,
        inputChars,
      },
    });
  }

  @Transactional()
  async finishCall(
    lease: ReportDesignLease,
    stepId: string,
    result: {
      status: 'completed' | 'failed' | 'outcome_unknown';
      outputChars?: number;
      errorCode?: string;
    }
  ) {
    await this.assertLease(lease, false);
    await this.db.reportDeckStep.updateMany({
      where: { id: stepId, runId: lease.id, status: 'running' },
      data: { ...result, completedAt: new Date() },
    });
  }

  @Transactional()
  async reserveCorrection(
    lease: ReportDesignLease,
    kind: 'repairs' | 'formatRetries',
    reservationKey?: string
  ) {
    const run = await this.assertLease(lease);
    const key = reservationKey ? `reservation-${kind}-${reservationKey}` : null;
    if (
      key &&
      (await this.db.reportDeckArtifact.findUnique({
        where: { runId_key: { runId: lease.id, key } },
      }))
    )
      return true;
    if (run[kind] >= 2) return false;
    if (key)
      await this.saveArtifact(
        lease,
        key,
        reportHash(key),
        Buffer.from(kind),
        'application/vnd.localmind.report-reservation'
      );
    await this.db.reportDeckRun.update({
      where: { id: lease.id },
      data: { [kind]: { increment: 1 } },
    });
    return true;
  }

  @Transactional()
  async saveArtifact(
    lease: ReportDesignLease,
    key: string,
    inputHash: string,
    payload: Uint8Array,
    mime: string
  ) {
    await this.assertLease(lease);
    if (payload.byteLength > 10 * 1024 * 1024)
      throw new ReportDesignError('budget_exceeded');
    const hash = reportHash(payload);
    const old = await this.db.reportDeckArtifact.findUnique({
      where: { runId_key: { runId: lease.id, key } },
    });
    if (old) {
      if (old.hash !== hash || old.inputHash !== inputHash)
        throw new ReportDesignError('quality_failed');
      return old;
    }
    const size = await this.db.reportDeckArtifact.aggregate({
      where: { runId: lease.id },
      _sum: { byteLength: true },
    });
    if ((size._sum.byteLength ?? 0) + payload.byteLength > 80 * 1024 * 1024)
      throw new ReportDesignError('budget_exceeded');
    return this.db.reportDeckArtifact.create({
      data: {
        runId: lease.id,
        key,
        inputHash,
        hash,
        payload: Buffer.from(payload),
        byteLength: payload.byteLength,
        mime,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
  }

  async saveJson(
    lease: ReportDesignLease,
    key: string,
    inputHash: string,
    value: unknown
  ) {
    return this.saveArtifact(
      lease,
      key,
      inputHash,
      gzipSync(Buffer.from(JSON.stringify(value))),
      'application/json+gzip'
    );
  }

  @Transactional()
  async readJson(
    lease: ReportDesignLease,
    key: string,
    inputHash: string
  ): Promise<unknown | null> {
    await this.assertLease(lease);
    const row = await this.db.reportDeckArtifact.findUnique({
      where: { runId_key: { runId: lease.id, key } },
    });
    if (!row) return null;
    if (
      row.inputHash !== inputHash ||
      row.hash !== reportHash(row.payload) ||
      row.mime !== 'application/json+gzip' ||
      row.expiresAt.getTime() <= Date.now()
    )
      throw new ReportDesignError('quality_failed');
    return JSON.parse(
      gunzipSync(row.payload, { maxOutputLength: 12 * 1024 * 1024 }).toString(
        'utf8'
      )
    ) as unknown;
  }

  @Transactional()
  async readArtifact(lease: ReportDesignLease, key: string, inputHash: string) {
    await this.assertLease(lease);
    const row = await this.db.reportDeckArtifact.findUnique({
      where: { runId_key: { runId: lease.id, key } },
    });
    if (!row) return null;
    if (
      row.inputHash !== inputHash ||
      row.hash !== reportHash(row.payload) ||
      row.expiresAt.getTime() <= Date.now()
    )
      throw new ReportDesignError('quality_failed');
    return row;
  }

  @Transactional()
  async sourceStatuses(
    lease: ReportDesignLease,
    rows: Parameters<Models['reportDeck']['setSourceStatuses']>[1]
  ) {
    await this.assertLease(lease);
    await this.models.reportDeck.setSourceStatuses(lease.deckId, rows);
  }

  @Transactional()
  async complete(
    lease: ReportDesignLease,
    input: {
      html: string;
      title: string;
      chapters: number;
      modelId: string;
      quality: DeckQuality;
      usage: Prisma.InputJsonValue;
    }
  ) {
    await this.assertLease(lease);
    if (reportHash(input.html) !== input.quality.artifactHash)
      throw new ReportDesignError('quality_failed');
    await this.db.reportDeck.update({
      where: { id: lease.deckId },
      data: {
        status: 'ready',
        title: input.title,
        htmlGzip: gzipSync(Buffer.from(input.html)),
        htmlBytes: Buffer.byteLength(input.html),
        slideCount: input.chapters,
        modelId: input.modelId,
        quality: reportJson(input.quality),
        usage: input.usage,
        completedAt: new Date(),
        errorCode: null,
        progress: { phase: 'done', done: 1, total: 1 },
      },
    });
    await this.db.reportDeckRun.update({
      where: { id: lease.id },
      data: { status: 'ready' },
    });
  }

  @Transactional()
  async fail(lease: ReportDesignLease, code: DeckErrorCode) {
    await this.lockDeck(lease.deckId);
    const run = await this.db.reportDeckRun.findFirst({
      where: {
        id: lease.id,
        leaseOwner: lease.leaseOwner,
        fence: lease.fence,
        status: 'running',
        leaseExpiresAt: { gt: new Date() },
      },
    });
    if (!run) return;
    const deck = await this.db.reportDeck.findUnique({
      where: { id: lease.deckId },
    });
    if (!deck || deck.runAttempt !== lease.attempt) return;
    const cancelled =
      deck.status === 'cancelled' || !!deck.deletedAt || code === 'cancelled';
    if (deck.status === 'generating')
      await this.db.reportDeck.update({
        where: { id: deck.id },
        data: {
          status: cancelled ? 'cancelled' : 'failed',
          errorCode: cancelled ? 'cancelled' : code,
          completedAt: new Date(),
        },
      });
    await this.db.reportDeckRun.update({
      where: { id: run.id },
      data: { status: cancelled ? 'cancelled' : 'failed' },
    });
    await this.db.reportDeckStep.updateMany({
      where: { runId: run.id, status: 'running' },
      data: {
        status: 'outcome_unknown',
        errorCode: code,
        completedAt: new Date(),
      },
    });
  }

  async recoverable() {
    return this.db.reportDeck.findMany({
      where: {
        deletedAt: null,
        generationVersion: 3,
        OR: [
          { status: 'queued' },
          {
            status: 'generating',
            runs: {
              some: { status: 'running', leaseExpiresAt: { lt: new Date() } },
            },
          },
        ],
      },
      select: { id: true, runAttempt: true },
      take: 30,
      orderBy: { updatedAt: 'asc' },
    });
  }

  async cleanup() {
    const expired = await this.db.reportDeckArtifact.findMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { run: { deck: { deletedAt: { not: null } } } },
        ],
      },
      select: { id: true },
      take: 100,
    });
    if (expired.length)
      await this.db.reportDeckArtifact.deleteMany({
        where: { id: { in: expired.map(row => row.id) } },
      });
    await this.db.reportDeckRun.updateMany({
      where: { status: 'running', deck: { status: 'cancelled' } },
      data: { status: 'cancelled' },
    });
    await this.db.reportDeckRun.updateMany({
      where: { status: 'running', deck: { status: 'failed' } },
      data: { status: 'failed' },
    });
  }
}
