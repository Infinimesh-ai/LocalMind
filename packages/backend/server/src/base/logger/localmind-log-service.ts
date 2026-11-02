import { createHash, randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsServiceManager } from 'nestjs-cls';

import {
  createLocalMindLogArchiveEnvelope,
  LOCALMIND_LOG_ARCHIVE_SCHEMA,
  localMindLogArchiveDirectory,
  type LocalMindLogArchiveManifest,
  readAndVerifyLocalMindLogArchiveEnvelope,
  readLocalMindLogArchiveKeyring,
  writeLocalMindLogArchiveEnvelope,
} from './localmind-log-archive';
import { LocalMindLogDatabase } from './localmind-log-database';
import { hashActor, redact } from './redactor';
import {
  LocalMindLogSpool,
  SpoolCapacityError,
  type SpoolRecord,
} from './spool';

/** Requests at or above this duration keep a per-request completion log. */
export const SLOW_REQUEST_THRESHOLD_MS = 3_000;

/**
 * Runtime log ingestion budgets. Records beyond them are dropped and counted
 * instead of queueing unbounded work; audit writes do not use this path.
 */
export const LOCALMIND_LOG_INGESTION_LIMITS = {
  maxInFlightRecords: 1_000,
  maxInFlightBytes: 4 * 1024 * 1024,
  // error/fatal may use a reserved share above the runtime budget.
  criticalBudgetFactor: 2,
  breakerFailureThreshold: 5,
  breakerInitialOpenMs: 5_000,
  breakerMaxOpenMs: 60_000,
  slowPersistMs: 2_000,
  mirrorMaxQueuedBytes: 8 * 1024 * 1024,
  summaryIntervalMs: 60_000,
  // Accepted runtime records are written in small batches, one at a time.
  batchMaxRecords: 100,
  batchMaxBytes: 256 * 1024,
  batchDelayMs: 200,
  // Each scheduled spool replay is bounded by files and wall time.
  spoolReplayLimit: 500,
  spoolReplayBatch: 100,
  spoolReplayBudgetMs: 10_000,
  // Retention deletes in committed batches sized to the measured duration.
  // Each deleted row also removes its global ID registration; on cold storage
  // that costs about 10-20 ms per row, so batches start small.
  retentionInitialBatch: 100,
  retentionMinBatch: 10,
  retentionMaxBatch: 5_000,
  retentionTargetBatchMs: 2_000,
  // PostgreSQL cancels a slow batch first; the transaction budget is larger.
  retentionStatementTimeoutMs: 10_000,
  retentionBatchTimeoutMs: 15_000,
  // An unfinished run is continued by the next one within this window.
  retentionResumeWindowMs: 24 * 60 * 60 * 1000,
  retentionRunBudgetMs: 60_000,
  retentionRunMaxRows: 500_000,
  retentionRunHistoryDays: 90,
  retentionDryRunCountLimit: 100_000,
};

type PendingRuntimeRecord = {
  record: SpoolRecord;
  bytes: number;
  fresh: boolean;
  resolve: (eventId: string) => void;
};

export type LocalMindLogInput = {
  eventId?: string;
  eventName: string;
  severity?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message?: string;
  metadata?: unknown;
  status?: string;
  errorCode?: string;
  durationMs?: number;
  service?: string;
  component?: string;
  actorId?: string;
  actorType?: string;
  workspaceId?: string;
  projectId?: string;
  resourceType?: string;
  resourceId?: string;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  retentionClass?: string;
};

export type LocalMindAuditInput = {
  auditEventId?: string;
  action: string;
  outcome: string;
  metadata?: unknown;
  actorId?: string;
  actorType?: string;
  workspaceId?: string;
  projectId?: string;
  resourceType?: string;
  resourceId?: string;
  authorizationFingerprint?: string;
};

@Injectable()
export class LocalMindLogService implements OnModuleDestroy {
  private static sink?: (input: LocalMindLogInput) => void;
  private static consoleInstalled = false;
  private readonly instanceId = process.env.LOCALMIND_INSTANCE_ID ?? 'local';
  private readonly nodeId = process.env.LOCALMIND_NODE_ID ?? `${process.pid}`;
  private readonly spoolRoot = join(
    process.env.LOCALMIND_DATA_DIR ?? '/tmp/localmind',
    'logs',
    'spool'
  );
  // The spool directory name must survive restarts; a process ID does not.
  private readonly spool = new LocalMindLogSpool(
    process.env.LOCALMIND_LOG_SPOOL_DIR ??
      join(this.spoolRoot, process.env.LOCALMIND_NODE_ID ?? 'primary')
  );
  private legacySpoolsAdopted = false;
  private flushing = false;
  private lastSpoolError?: string;
  private lastSpoolFlushAt?: Date;
  private lastSpoolFlushed = 0;
  readonly limits = { ...LOCALMIND_LOG_INGESTION_LIMITS };
  private inFlightRecords = 0;
  private inFlightBytes = 0;
  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;
  private breakerOpenMs = this.limits.breakerInitialOpenMs;
  private probeInFlight = false;
  private degradedSince?: Date;
  private window = LocalMindLogService.emptyWindow();
  private mirrorSkipped = 0;
  private readonly pending: PendingRuntimeRecord[] = [];
  private pendingBytes = 0;
  private draining = false;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private readonly logger = new Logger(LocalMindLogService.name);
  /** Runtime ingestion, spool replay and retention use the small log pool. */
  private readonly logDb: PrismaClient;

  constructor(
    private readonly prisma: PrismaClient,
    @Optional() logDatabase?: LocalMindLogDatabase
  ) {
    this.logDb = logDatabase?.client ?? prisma;
  }

  static registerSink(sink: (input: LocalMindLogInput) => void) {
    LocalMindLogService.sink = sink;
  }

  static emit(input: LocalMindLogInput) {
    // Debug output stays on stdout unless persistence is explicitly enabled.
    if (
      input.severity === 'debug' &&
      process.env.LOCALMIND_LOG_PERSIST_DEBUG !== 'true'
    )
      return;
    try {
      LocalMindLogService.sink?.(input);
    } catch {
      // Logging must never break the caller.
    }
  }

  /** Route legacy console calls through the same redaction/persistence sink. */
  static installConsoleBridge() {
    if (this.consoleInstalled) return;
    this.consoleInstalled = true;
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const original = console[level].bind(console);
      console[level] = ((...args: unknown[]) => {
        const [message, ...metadata] = args;
        this.emit({
          eventName: `console.${level}`,
          severity:
            level === 'error'
              ? 'error'
              : level === 'warn'
                ? 'warn'
                : level === 'debug'
                  ? 'debug'
                  : 'info',
          message: typeof message === 'string' ? message : undefined,
          metadata: metadata.length ? { args: metadata } : message,
          component: 'console-bridge',
        });
        original(...args);
      }) as (typeof console)[typeof level];
    }
  }

  /**
   * Accepts a runtime record into the bounded batch writer. The promise settles
   * once its batch reached the database or spool, or was dropped; callers that
   * do not await it are never blocked by log I/O.
   */
  async write(input: LocalMindLogInput) {
    const record = this.buildRecord(input);
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (!this.admit(1, bytes, isCritical(record))) {
      this.countDropped('admission');
      return record.eventId;
    }
    return await new Promise<string>(resolve => {
      // A server-generated ID on its first attempt cannot already be stored.
      this.pending.push({
        record,
        bytes,
        fresh: input.eventId === undefined,
        resolve,
      });
      this.pendingBytes += bytes;
      this.scheduleDrain();
    });
  }

  private scheduleDrain() {
    if (this.draining) return;
    if (
      this.pending.length >= this.limits.batchMaxRecords ||
      this.pendingBytes >= this.limits.batchMaxBytes
    ) {
      this.drain().catch(() => undefined);
      return;
    }
    if (this.drainTimer) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = undefined;
      this.drain().catch(() => undefined);
    }, this.limits.batchDelayMs);
  }

  /** Flushes queued runtime records on shutdown, bounded so exit is not held. */
  async onModuleDestroy() {
    await Promise.race([
      this.drain(),
      new Promise(resolve => setTimeout(resolve, 2_000).unref?.()),
    ]);
  }

  /** Writes queued records one batch at a time until the queue is empty. */
  private async drain() {
    if (this.draining) return;
    this.draining = true;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = undefined;
    }
    try {
      while (this.pending.length) {
        const batch = this.takeBatch();
        try {
          await this.persistRuntimeRecords(
            batch.map(entry => entry.record),
            { fresh: batch.every(entry => entry.fresh) }
          );
        } catch {
          // Spool failures are already counted; the queue must keep moving.
        }
        for (const entry of batch) {
          this.release(1, entry.bytes);
          entry.resolve(entry.record.eventId);
        }
      }
    } finally {
      this.draining = false;
      if (this.pending.length) this.scheduleDrain();
    }
  }

  private takeBatch() {
    let bytes = 0;
    let count = 0;
    while (
      count < this.pending.length &&
      count < this.limits.batchMaxRecords &&
      (count === 0 ||
        bytes + this.pending[count].bytes <= this.limits.batchMaxBytes)
    ) {
      bytes += this.pending[count].bytes;
      count++;
    }
    this.pendingBytes -= bytes;
    return this.pending.splice(0, count);
  }

  /**
   * Persists one runtime batch in a single transaction, or spools each record
   * when the breaker is open or the write fails. Returns accepted event IDs.
   */
  private async persistRuntimeRecords(
    records: SpoolRecord[],
    { fresh = false, rethrowSpoolErrors = false } = {}
  ) {
    const mode = this.databaseMode();
    if (mode !== 'open') {
      const startedAt = Date.now();
      try {
        const inserted = await this.logDb.$transaction(
          tx => this.persistRuntimeBatch(tx, records, { fresh }),
          { maxWait: 5000 }
        );
        this.recordDatabaseResult(true, Date.now() - startedAt, mode);
        const insertedIds = new Set(inserted.map(row => row.eventId));
        for (const record of records) {
          if (insertedIds.has(record.eventId)) this.mirror(record);
        }
        // Rows that already existed are durable and keep their receipt.
        return records.map(record => record.eventId);
      } catch {
        this.recordDatabaseResult(false, Date.now() - startedAt, mode);
      }
    }
    // A database outage costs one failed insert per batch, then durable spool.
    const accepted: string[] = [];
    for (const record of records) {
      try {
        if (await this.spoolRuntime(record)) {
          this.mirror(record);
          accepted.push(record.eventId);
        }
      } catch (error) {
        if (rethrowSpoolErrors) throw error;
        this.countDropped('spool_failed');
      }
    }
    return accepted;
  }

  /** Current ingestion budgets and breaker state, without touching the database. */
  ingestionStatus() {
    return {
      inFlightRecords: this.inFlightRecords,
      inFlightBytes: this.inFlightBytes,
      consecutiveFailures: this.consecutiveFailures,
      breakerOpen: this.breakerIsOpen(),
      degradedSince: this.degradedSince?.toISOString(),
      window: {
        ...this.window,
        startedAt: new Date(this.window.startedAt).toISOString(),
        dropped: Object.fromEntries(this.window.dropped),
      },
    };
  }

  private static emptyWindow() {
    return {
      startedAt: Date.now(),
      failures: 0,
      slow: 0,
      spooled: 0,
      mirrorSkipped: 0,
      dropped: new Map<string, number>(),
    };
  }

  private admit(records: number, bytes: number, critical: boolean) {
    const factor = critical ? this.limits.criticalBudgetFactor : 1;
    if (
      this.inFlightRecords + records >
        this.limits.maxInFlightRecords * factor ||
      this.inFlightBytes + bytes > this.limits.maxInFlightBytes * factor
    )
      return false;
    this.inFlightRecords += records;
    this.inFlightBytes += bytes;
    return true;
  }

  private release(records: number, bytes: number) {
    this.inFlightRecords -= records;
    this.inFlightBytes -= bytes;
  }

  private countDropped(reason: string, count = 1) {
    this.window.dropped.set(
      reason,
      (this.window.dropped.get(reason) ?? 0) + count
    );
  }

  private breakerIsOpen() {
    return this.consecutiveFailures >= this.limits.breakerFailureThreshold;
  }

  /**
   * closed: write to the database; open: go straight to spool; probe: the one
   * write allowed through after the backoff to test recovery.
   */
  private databaseMode(): 'closed' | 'open' | 'probe' {
    if (!this.breakerIsOpen()) return 'closed';
    if (this.probeInFlight || Date.now() < this.breakerOpenUntil) return 'open';
    this.probeInFlight = true;
    return 'probe';
  }

  private recordDatabaseResult(
    ok: boolean,
    durationMs: number,
    mode: 'closed' | 'open' | 'probe'
  ) {
    if (mode === 'probe') this.probeInFlight = false;
    const slow = ok && durationMs >= this.limits.slowPersistMs;
    if (ok && !slow) {
      this.consecutiveFailures = 0;
      this.breakerOpenMs = this.limits.breakerInitialOpenMs;
      if (this.degradedSince) this.recover();
      return;
    }
    if (slow) this.window.slow++;
    else this.window.failures++;
    const wasOpen = this.breakerIsOpen();
    this.consecutiveFailures++;
    if (mode === 'probe') {
      this.breakerOpenMs = Math.min(
        this.breakerOpenMs * 2,
        this.limits.breakerMaxOpenMs
      );
      this.breakerOpenUntil = Date.now() + this.breakerOpenMs;
    } else if (!wasOpen && this.breakerIsOpen()) {
      this.breakerOpenUntil = Date.now() + this.breakerOpenMs;
      this.enterDegraded(
        slow ? 'database_write_slow' : 'database_write_failed'
      );
    }
  }

  /** One record per state change instead of one per failed event. */
  private enterDegraded(reason: string) {
    if (this.degradedSince) return;
    this.degradedSince = new Date();
    const record = this.buildRecord({
      eventName: 'log.ingestion.degraded',
      severity: 'warn',
      status: 'degraded',
      metadata: {
        reason,
        consecutiveFailures: this.consecutiveFailures,
        breakerOpenMs: this.breakerOpenMs,
      },
    });
    void this.spoolRuntime(record)
      .then(spooled => spooled && this.mirror(record))
      .catch(() => undefined);
  }

  private recover() {
    const since = this.degradedSince;
    this.degradedSince = undefined;
    if (!since) return;
    void this.write({
      eventName: 'log.ingestion.recovered',
      severity: 'info',
      status: 'recovered',
      durationMs: Date.now() - since.getTime(),
      metadata: { degradedSince: since.toISOString() },
    }).catch(() => undefined);
  }

  /** Writes bounded failure/drop counters for the elapsed window, if any. */
  async flushIngestionSummary(now = Date.now()) {
    const window = this.window;
    if (now - window.startedAt < this.limits.summaryIntervalMs) return false;
    this.window = LocalMindLogService.emptyWindow();
    const dropped = Object.fromEntries(window.dropped);
    if (
      !window.failures &&
      !window.slow &&
      !window.spooled &&
      !window.mirrorSkipped &&
      !Object.keys(dropped).length
    )
      return false;
    await this.write({
      eventName: 'log.ingestion.summary',
      severity: 'warn',
      status: this.degradedSince ? 'degraded' : 'ok',
      metadata: {
        windowStartedAt: new Date(window.startedAt).toISOString(),
        windowMs: now - window.startedAt,
        failures: window.failures,
        slow: window.slow,
        spooled: window.spooled,
        mirrorSkipped: window.mirrorSkipped,
        dropped,
      },
    });
    return true;
  }

  async writeBatch(inputs: LocalMindLogInput[]) {
    const records = new Map<string, SpoolRecord>();
    for (const input of inputs.slice(0, 100)) {
      const record = this.buildRecord(input);
      if (!records.has(record.eventId)) records.set(record.eventId, record);
    }
    if (!records.size) return [];
    const bytes = [...records.values()].reduce(
      (total, record) => total + Buffer.byteLength(JSON.stringify(record)),
      0
    );
    // Over budget, nothing is accepted and the client keeps its retry copy.
    if (!this.admit(records.size, bytes, false)) {
      this.countDropped('admission', records.size);
      return [];
    }
    try {
      // Client receipts must surface a critical spool failure to the caller.
      return await this.persistRuntimeRecords([...records.values()], {
        rethrowSpoolErrors: true,
      });
    } finally {
      this.release(records.size, bytes);
    }
  }

  private async spoolRuntime(record: SpoolRecord) {
    const critical = isCritical(record);
    const capacityReached = () => {
      this.countDropped('spool_capacity');
      this.mirror({
        ...record,
        eventId: randomUUID(),
        eventName: 'log.spool.capacity_reached',
        severity: 'warn',
        metadata: { droppedEventName: record.eventName, reason: 'capacity' },
      });
    };
    if (!critical && (await this.spool.bytes()) >= this.spool.maxBytes) {
      capacityReached();
      return false;
    }
    try {
      await this.spool.append(record);
    } catch (error) {
      if (!(error instanceof SpoolCapacityError) || critical) throw error;
      capacityReached();
      return false;
    }
    // Degradation is reported once per state change and in window summaries.
    this.window.spooled++;
    return true;
  }

  async writeAudit(input: LocalMindAuditInput) {
    const auditEventId = input.auditEventId ?? randomUUID();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          action: input.action,
          outcome: input.outcome,
          metadata: redact(input.metadata),
        })
      )
      .digest('hex');
    const logInput: LocalMindLogInput = {
      eventId: auditEventId,
      eventName: `audit.${input.action}`,
      severity: input.outcome === 'success' ? 'info' : 'warn',
      status: input.outcome,
      metadata: input.metadata,
      actorId: input.actorId,
      actorType: input.actorType,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      retentionClass: 'audit',
    };
    const record: SpoolRecord = {
      ...this.buildRecord(logInput),
      auditAction: input.action,
      auditOutcome: input.outcome,
      authorizationFingerprint: input.authorizationFingerprint,
    };
    this.mirror(record);
    try {
      const existing = await this.prisma.localMindAuditEnvelope.findUnique({
        where: { auditEventId },
        select: { auditEventId: true, fingerprint: true },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new Error('LOCALMIND_AUDIT_EVENT_ID_CONFLICT');
        }
        return existing.auditEventId;
      }
      await this.prisma.$transaction(async tx => {
        await this.persistWithClient(tx, record);
        await tx.localMindAuditEnvelope.create({
          data: {
            id: randomUUID(),
            auditEventId,
            eventId: auditEventId,
            action: input.action,
            outcome: input.outcome,
            actorType: input.actorType,
            actorIdHash: hashActor(input.actorId),
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            authorizationFp: input.authorizationFingerprint,
            fingerprint,
            metadata: redact(input.metadata) as object,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'LOCALMIND_AUDIT_EVENT_ID_CONFLICT'
      ) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.localMindAuditEnvelope.findUnique({
          where: { auditEventId },
          select: { auditEventId: true, fingerprint: true },
        });
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new Error('LOCALMIND_AUDIT_EVENT_ID_CONFLICT');
          }
          return existing.auditEventId;
        }
      }
      // Audit evidence is fail-closed: preserve it in durable spool and surface the failure.
      await this.spool.append({ ...record, auditEnvelope: true, fingerprint });
      await this.spool.append({
        ...record,
        eventId: randomUUID(),
        eventName: 'log.ingestion.degraded',
        severity: 'warn',
        status: 'degraded',
        metadata: {
          reason: 'postgres_unavailable',
          failedEventName: record.eventName,
        },
      });
      throw error;
    }
    return auditEventId;
  }

  /**
   * Replays spooled records: runtime records in deduplicated batches, audit
   * envelopes one by one. Corrupted files are quarantined instead of blocking
   * every later replay. Bounded by file count and wall time per call.
   */
  async flushSpool(limit = this.limits.spoolReplayLimit) {
    // While the breaker is open the probe write decides recovery; replaying
    // the backlog would only add load to a failing database.
    if (this.flushing || this.breakerIsOpen()) return 0;
    const releaseLease = await this.spool.acquireFlushLease();
    if (!releaseLease) return 0;
    this.flushing = true;
    try {
      if (!this.legacySpoolsAdopted) {
        this.legacySpoolsAdopted = true;
        await this.adoptLegacySpools().catch(() => undefined);
      }
      let flushed = 0;
      const deadline = Date.now() + this.limits.spoolReplayBudgetMs;
      this.lastSpoolFlushAt = new Date();
      this.lastSpoolError = undefined;
      const files = await this.spool.list(limit);
      replay: for (
        let offset = 0;
        offset < files.length && Date.now() < deadline;
        offset += this.limits.spoolReplayBatch
      ) {
        const runtime: { file: string; record: SpoolRecord }[] = [];
        for (const file of files.slice(
          offset,
          offset + this.limits.spoolReplayBatch
        )) {
          let record: SpoolRecord;
          try {
            record = await this.spool.read(file);
          } catch (error) {
            this.lastSpoolError =
              error instanceof Error ? error.message : String(error);
            if (await this.spool.quarantine(file).catch(() => false)) {
              this.countDropped('spool_quarantined');
            }
            continue;
          }
          if (!record.auditEnvelope) {
            runtime.push({ file, record });
            continue;
          }
          if (!(await this.replayAuditRecord(file, record))) break replay;
          flushed++;
        }
        if (!runtime.length) continue;
        const startedAt = Date.now();
        try {
          await this.logDb.$transaction(
            tx =>
              this.persistRuntimeBatch(
                tx,
                runtime.map(entry => entry.record)
              ),
            { maxWait: 5000 }
          );
          this.recordDatabaseResult(true, Date.now() - startedAt, 'closed');
        } catch (error) {
          this.lastSpoolError =
            error instanceof Error ? error.message : String(error);
          this.recordDatabaseResult(false, Date.now() - startedAt, 'closed');
          break;
        }
        for (const { file } of runtime) {
          await this.spool.remove(file).catch(() => undefined);
          flushed++;
        }
      }
      this.lastSpoolFlushed = flushed;
      return flushed;
    } finally {
      this.flushing = false;
      await releaseLease();
    }
  }

  /**
   * Earlier versions named the spool directory after the process ID. Pending
   * files left in such directories are moved into the current spool once,
   * unless another process currently holds that directory's flush lock.
   */
  private async adoptLegacySpools() {
    const entries = await readdir(this.spoolRoot, {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const directory = join(this.spoolRoot, entry.name);
      if (resolve(directory) === resolve(this.spool.directory)) continue;
      const locked = await stat(join(directory, '.flush-lock')).then(
        () => true,
        () => false
      );
      if (locked) continue;
      const files = await this.spool.adopt(directory);
      if (files) {
        this.write({
          eventName: 'log.spool.adopted',
          severity: 'info',
          metadata: { legacyDirectory: entry.name, files },
        }).catch(() => undefined);
      }
    }
  }

  private async replayAuditRecord(file: string, record: SpoolRecord) {
    const startedAt = Date.now();
    try {
      await this.persist(record);
      this.recordDatabaseResult(true, Date.now() - startedAt, 'closed');
    } catch (error) {
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
      ) {
        this.lastSpoolError =
          error instanceof Error ? error.message : String(error);
        this.recordDatabaseResult(false, Date.now() - startedAt, 'closed');
        return false;
      }
      await this.persistAuditEnvelopeOnly(record);
    }
    await this.spool.remove(file);
    return true;
  }

  @Interval(15_000)
  async scheduledSpoolFlush() {
    await this.flushSpool();
    await this.flushIngestionSummary().catch(() => undefined);
  }

  @Interval(3_600_000)
  async scheduledRetentionCleanup() {
    // A failed run is recorded in localmind_log_retention_runs; the reason is
    // also logged here instead of being swallowed.
    const result = await this.cleanupRetention(new Date(), {
      trigger: 'scheduled',
    }).catch((error: unknown) => {
      this.logger.error(
        `Scheduled log retention cleanup failed: ${retentionFailureMessage(error)}`
      );
      return null;
    });
    if (!result) return;
    try {
      await this.writeAudit({
        action: 'logs.retention.scheduled_cleanup',
        outcome: result.skipped ? 'skipped' : 'success',
        metadata: result,
      });
    } catch {
      // Cleanup evidence is retried through the audit spool on the next cycle.
    }
  }

  @Interval(86_400_000)
  async scheduledRetentionArchive() {
    try {
      const result = await this.archiveRetention();
      await this.writeAudit({
        action: 'logs.retention.scheduled_archive',
        outcome: result.skipped ? 'skipped' : 'success',
        metadata: result,
      });
    } catch {
      // Archive retries on the next interval; the failed batch remains intact.
    }
  }

  async query(args: {
    from?: Date | null;
    to?: Date | null;
    severity?: string | null;
    service?: string | null;
    component?: string | null;
    eventName?: string | null;
    requestId?: string | null;
    traceId?: string | null;
    workspaceId?: string | null;
    projectId?: string | null;
    runId?: string | null;
    jobId?: string | null;
    status?: string | null;
    errorCode?: string | null;
    keyword?: string | null;
    limit?: number | null;
  }) {
    return this.prisma.localMindLogEvent.findMany({
      where: {
        occurredAt: { gte: args.from ?? undefined, lte: args.to ?? undefined },
        severity: args.severity ?? undefined,
        service: args.service ?? undefined,
        component: args.component ?? undefined,
        eventName: args.eventName ?? undefined,
        requestId: args.requestId ?? undefined,
        traceId: args.traceId ?? undefined,
        workspaceId: args.workspaceId ?? undefined,
        projectId: args.projectId ?? undefined,
        runId: args.runId ?? undefined,
        jobId: args.jobId ?? undefined,
        status: args.status ?? undefined,
        errorCode: args.errorCode ?? undefined,
        ...(args.keyword
          ? {
              OR: [
                {
                  messageTemplate: {
                    contains: args.keyword,
                    mode: 'insensitive',
                  },
                },
                { eventName: { contains: args.keyword, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(args.limit ?? 100, 1000),
    });
  }

  /**
   * Ingestion health for Admin. In-memory counters never wait on the log
   * table; the retention history read is bounded and may be unavailable.
   */
  async spoolStatus() {
    const retention = await Promise.race([
      this.retentionRuns(5).then(
        runs => ({ available: true as const, runs }),
        () => ({ available: false as const, runs: [] })
      ),
      new Promise<{ available: false; runs: [] }>(resolve =>
        setTimeout(
          () => resolve({ available: false, runs: [] }),
          2_000
        ).unref?.()
      ),
    ]);
    return {
      directory: this.spool.directory,
      bytes: await this.spool.bytes(),
      files: await this.spool.files(),
      lastFlushAt: this.lastSpoolFlushAt,
      lastFlushed: this.lastSpoolFlushed,
      lastError: this.lastSpoolError,
      ingestion: {
        ...this.ingestionStatus(),
        queuedRecords: this.pending.length,
        queuedBytes: this.pendingBytes,
      },
      retention,
    };
  }

  async auditForEvent(eventId: string) {
    return this.prisma.localMindAuditEnvelope.findFirst({
      where: { eventId },
      orderBy: { occurredAt: 'desc' },
    });
  }

  async queryAudits(args: {
    workspaceId: string;
    projectId?: string;
    limit?: number;
  }) {
    return this.prisma.localMindAuditEnvelope.findMany({
      where: {
        workspaceId: args.workspaceId,
        projectId: args.projectId,
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(args.limit ?? 100, 500),
    });
  }

  async getPolicy() {
    const policy = await this.prisma.localMindLogPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    this.spool.setMaxBytes(Number(policy.spoolMaxBytes));
    return policy;
  }

  async updatePolicy(input: {
    runtimeRetentionDays?: number;
    failureRetentionDays?: number;
    traceRetentionDays?: number;
    auditRetentionDays?: number;
    spoolMaxBytes?: number;
    legalHold?: boolean;
    retentionFrozen?: boolean;
    externalTelemetryEnabled?: boolean;
  }) {
    const bounded = (value: number | undefined, min: number, max: number) =>
      value === undefined
        ? undefined
        : Math.max(min, Math.min(max, Math.floor(value)));
    const policy = await this.prisma.localMindLogPolicy.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        runtimeRetentionDays:
          bounded(input.runtimeRetentionDays, 1, 3650) ?? 30,
        failureRetentionDays:
          bounded(input.failureRetentionDays, 1, 3650) ?? 90,
        traceRetentionDays: bounded(input.traceRetentionDays, 1, 365) ?? 14,
        auditRetentionDays: bounded(input.auditRetentionDays, 30, 3650) ?? 365,
        spoolMaxBytes: BigInt(
          Math.max(
            1024 * 1024,
            Math.min(input.spoolMaxBytes ?? 52428800, 10 * 1024 * 1024 * 1024)
          )
        ),
        legalHold: input.legalHold ?? false,
        retentionFrozen: input.retentionFrozen ?? false,
        frozenAt: input.retentionFrozen ? new Date() : undefined,
        externalTelemetryEnabled: false,
      },
      update: {
        ...(bounded(input.runtimeRetentionDays, 1, 3650) === undefined
          ? {}
          : {
              runtimeRetentionDays: bounded(
                input.runtimeRetentionDays,
                1,
                3650
              ),
            }),
        ...(bounded(input.failureRetentionDays, 1, 3650) === undefined
          ? {}
          : {
              failureRetentionDays: bounded(
                input.failureRetentionDays,
                1,
                3650
              ),
            }),
        ...(bounded(input.traceRetentionDays, 1, 365) === undefined
          ? {}
          : { traceRetentionDays: bounded(input.traceRetentionDays, 1, 365) }),
        ...(bounded(input.auditRetentionDays, 30, 3650) === undefined
          ? {}
          : {
              auditRetentionDays: bounded(input.auditRetentionDays, 30, 3650),
            }),
        ...(input.spoolMaxBytes === undefined
          ? {}
          : {
              spoolMaxBytes: BigInt(
                Math.max(
                  1024 * 1024,
                  Math.min(input.spoolMaxBytes, 10 * 1024 * 1024 * 1024)
                )
              ),
            }),
        ...(input.legalHold === undefined
          ? {}
          : { legalHold: input.legalHold }),
        ...(input.retentionFrozen === undefined
          ? {}
          : {
              retentionFrozen: input.retentionFrozen,
              frozenAt: input.retentionFrozen ? new Date() : null,
            }),
        // External telemetry remains hard-disabled for self-hosted instances.
        externalTelemetryEnabled: false,
      },
    });
    this.spool.setMaxBytes(Number(policy.spoolMaxBytes));
    return policy;
  }

  /**
   * Deletes expired runtime logs in small committed batches. Each batch takes a
   * non-blocking advisory lock, scans forward by (occurred_at, id) and adapts
   * its size to the measured duration; legal hold and freeze are re-checked
   * between batches. Progress and outcome are stored per run.
   */
  async cleanupRetention(
    now = new Date(),
    options: {
      dryRun?: boolean;
      trigger?: 'scheduled' | 'manual';
      maxDurationMs?: number;
    } = {}
  ) {
    const policy = await this.getPolicy();
    if (policy.legalHold || policy.retentionFrozen)
      return { skipped: true, dryRun: !!options.dryRun, deleted: 0 };
    const runtimeCutoff = new Date(
      now.getTime() - policy.runtimeRetentionDays * 86400000
    );
    const failureCutoff = new Date(
      now.getTime() - policy.failureRetentionDays * 86400000
    );
    if (options.dryRun) {
      // Bounded: the exact total of a large backlog is not worth a full scan.
      const deleted = await this.logDb.localMindLogEvent.count({
        where: {
          OR: [
            {
              retentionClass: 'runtime',
              occurredAt: { lt: runtimeCutoff },
              severity: { notIn: ['error', 'fatal'] },
            },
            {
              retentionClass: 'runtime',
              occurredAt: { lt: failureCutoff },
              severity: { in: ['error', 'fatal'] },
            },
          ],
        },
        take: this.limits.retentionDryRunCountLimit,
      });
      return {
        skipped: false,
        dryRun: true,
        deleted,
        bounded: deleted >= this.limits.retentionDryRunCountLimit,
      };
    }

    await this.markInterruptedRetentionRuns(now);
    const run = await this.logDb.localMindLogRetentionRun.create({
      data: {
        id: randomUUID(),
        kind: 'cleanup',
        trigger: options.trigger ?? 'manual',
        status: 'running',
        runtimeCutoff,
        failureCutoff,
      },
    });
    const deadline =
      Date.now() + (options.maxDurationMs ?? this.limits.retentionRunBudgetMs);
    const scanUntil =
      runtimeCutoff > failureCutoff ? runtimeCutoff : failureCutoff;
    // Continue after the previous unfinished run: rows it already passed were
    // deleted or kept, and rescanning them (and their not yet vacuumed dead
    // tuples) on cold storage costs the whole budget. A completed run resets
    // the cursor so kept failures are reconsidered once they expire.
    let cursor = {
      at: (await this.retentionResumePoint(run.id, now)) ?? new Date(0),
      id: '',
    };
    const resumedFrom = cursor.at.getTime() > 0 ? cursor.at : null;
    let batchSize = this.limits.retentionInitialBatch;
    let scanned = 0;
    let deleted = 0;
    let batches = 0;
    const timing = {
      lastBatchSize: null as number | null,
      lastBatchMs: null as number | null,
      maxBatchMs: null as number | null,
      batchTimeouts: 0,
    };
    let lastTimeout: string | undefined;
    let status: 'completed' | 'partial' | 'contended' | 'paused' = 'completed';
    try {
      while (true) {
        if (
          Date.now() >= deadline ||
          deleted >= this.limits.retentionRunMaxRows
        ) {
          status = 'partial';
          break;
        }
        if (batches > 0 && (await this.retentionPaused())) {
          status = 'paused';
          break;
        }
        const startedAt = Date.now();
        let batch: RetentionBatchResult | null;
        try {
          batch = await this.deleteRetentionBatch({
            cursor,
            scanUntil,
            runtimeCutoff,
            failureCutoff,
            batchSize,
          });
        } catch (error) {
          if (!isRetentionBatchTimeout(error)) throw error;
          // The batch rolled back; retry the same cursor with a smaller batch
          // instead of failing the whole run.
          timing.batchTimeouts++;
          lastTimeout = retentionFailureMessage(error);
          if (batchSize <= this.limits.retentionMinBatch) {
            throw new RetentionRunError(
              'LOCALMIND_LOG_RETENTION_BATCH_TIMEOUT',
              lastTimeout
            );
          }
          batchSize = Math.max(
            this.limits.retentionMinBatch,
            Math.floor(batchSize / 4)
          );
          continue;
        }
        if (!batch) {
          status = 'contended';
          break;
        }
        batches++;
        scanned += batch.scanned;
        deleted += batch.deleted;
        const elapsed = Date.now() - startedAt;
        timing.lastBatchSize = batchSize;
        timing.lastBatchMs = elapsed;
        timing.maxBatchMs = Math.max(timing.maxBatchMs ?? 0, elapsed);
        if (batch.scanned < batchSize || !batch.lastAt || !batch.lastId) break;
        cursor = { at: batch.lastAt, id: batch.lastId };
        batchSize =
          elapsed > this.limits.retentionTargetBatchMs
            ? Math.max(this.limits.retentionMinBatch, Math.floor(batchSize / 2))
            : elapsed < this.limits.retentionTargetBatchMs / 4
              ? Math.min(this.limits.retentionMaxBatch, batchSize * 2)
              : batchSize;
        await this.logDb.localMindLogRetentionRun.update({
          where: { id: run.id },
          data: {
            scanned,
            deleted,
            batches,
            lastOccurredAt: cursor.at,
            ...timing,
          },
        });
      }
    } catch (error) {
      await this.logDb.localMindLogRetentionRun
        .update({
          where: { id: run.id },
          data: {
            status: 'failed',
            scanned,
            deleted,
            batches,
            ...timing,
            lastOccurredAt: batches ? cursor.at : resumedFrom,
            failureCode:
              error instanceof RetentionRunError
                ? error.code
                : error instanceof Error &&
                    /^LOCALMIND_[A-Z0-9_]+$/.test(error.message)
                  ? error.message
                  : 'LOCALMIND_LOG_RETENTION_FAILED',
            failureMessage: retentionFailureMessage(error),
            finishedAt: new Date(),
            nextAttemptAt: new Date(Date.now() + 3_600_000),
          },
        })
        .catch(() => undefined);
      throw error;
    }
    await this.logDb.localMindLogRetentionRun.update({
      where: { id: run.id },
      data: {
        status,
        scanned,
        deleted,
        batches,
        ...timing,
        // A timeout that was recovered by a smaller batch is kept for review.
        failureMessage: lastTimeout ?? null,
        lastOccurredAt: batches ? cursor.at : resumedFrom,
        finishedAt: new Date(),
        nextAttemptAt: new Date(Date.now() + 3_600_000),
      },
    });
    await this.logDb.localMindLogRetentionRun
      .deleteMany({
        where: {
          finishedAt: {
            lt: new Date(
              now.getTime() - this.limits.retentionRunHistoryDays * 86400000
            ),
          },
        },
      })
      .catch(() => undefined);
    return {
      skipped: status === 'contended' || status === 'paused',
      dryRun: false,
      deleted,
      scanned,
      batches,
      status,
      complete: status === 'completed',
      batchTimeouts: timing.batchTimeouts,
      maxBatchMs: timing.maxBatchMs,
      runId: run.id,
    };
  }

  /** Cursor time left by the latest run, if it stopped before finishing. */
  private async retentionResumePoint(currentRunId: string, now: Date) {
    const previous = await this.logDb.localMindLogRetentionRun.findFirst({
      where: { kind: 'cleanup', id: { not: currentRunId } },
      orderBy: { startedAt: 'desc' },
      select: { status: true, lastOccurredAt: true, finishedAt: true },
    });
    if (
      !previous?.lastOccurredAt ||
      !['partial', 'failed', 'paused', 'contended', 'interrupted'].includes(
        previous.status
      ) ||
      (previous.finishedAt &&
        now.getTime() - previous.finishedAt.getTime() >
          this.limits.retentionResumeWindowMs)
    ) {
      return null;
    }
    return previous.lastOccurredAt;
  }

  /** Latest retention runs for the Admin ingestion status. */
  async retentionRuns(limit = 5) {
    return await this.logDb.localMindLogRetentionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    });
  }

  private async markInterruptedRetentionRuns(now: Date) {
    // A process that died mid-run leaves `running`; batches it committed stay.
    await this.logDb.localMindLogRetentionRun.updateMany({
      where: {
        status: 'running',
        updatedAt: { lt: new Date(now.getTime() - 3_600_000) },
      },
      data: {
        status: 'interrupted',
        failureCode: 'LOCALMIND_LOG_RETENTION_INTERRUPTED',
        finishedAt: now,
      },
    });
  }

  private async retentionPaused() {
    const policy = await this.logDb.localMindLogPolicy.findUnique({
      where: { id: 'default' },
      select: { legalHold: true, retentionFrozen: true },
    });
    return !!(policy?.legalHold || policy?.retentionFrozen);
  }

  /**
   * One committed delete batch. Returns null when another worker holds the
   * retention lock. `scanned` counts expired-window runtime rows visited, so a
   * short batch means the window is exhausted.
   */
  private async deleteRetentionBatch(args: {
    cursor: { at: Date; id: string };
    scanUntil: Date;
    runtimeCutoff: Date;
    failureCutoff: Date;
    batchSize: number;
  }) {
    const statementTimeoutMs = Math.max(
      1,
      Math.floor(this.limits.retentionStatementTimeoutMs)
    );
    return await this.logDb.$transaction(
      async tx => {
        // Cancel a slow batch inside PostgreSQL rather than leaving the delete
        // running after the client-side transaction timeout.
        await tx.$executeRawUnsafe(
          `SET LOCAL statement_timeout = ${statementTimeoutMs}`
        );
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext('localmind_log_retention')) AS locked
        `;
        if (!lock?.locked) return null;
        const [row] = await tx.$queryRaw<RetentionBatchResult[]>`
          WITH scanned AS (
            SELECT "id", "occurred_at", "severity"
            FROM "localmind_log_events"
            WHERE "retention_class" = 'runtime'
              AND "occurred_at" < ${args.scanUntil}
              AND "occurred_at" >= ${args.cursor.at}
              AND ("occurred_at", "id") > (${args.cursor.at}, ${args.cursor.id})
            ORDER BY "occurred_at", "id"
            LIMIT ${args.batchSize}
          ), removed AS (
            DELETE FROM "localmind_log_events" AS e
            USING scanned AS s
            WHERE e."id" = s."id"
              AND e."occurred_at" = s."occurred_at"
              AND (
                (s."severity" NOT IN ('error', 'fatal') AND s."occurred_at" < ${args.runtimeCutoff})
                OR (s."severity" IN ('error', 'fatal') AND s."occurred_at" < ${args.failureCutoff})
              )
            RETURNING 1
          ), last AS (
            SELECT "occurred_at", "id" FROM scanned
            ORDER BY "occurred_at" DESC, "id" DESC
            LIMIT 1
          )
          SELECT
            (SELECT count(*) FROM scanned)::int AS "scanned",
            (SELECT count(*) FROM removed)::int AS "deleted",
            (SELECT "occurred_at" FROM last) AS "lastAt",
            (SELECT "id" FROM last) AS "lastId"
        `;
        return row ?? { scanned: 0, deleted: 0, lastAt: null, lastId: null };
      },
      {
        maxWait: 5000,
        timeout: this.limits.retentionBatchTimeoutMs,
      }
    );
  }

  async archiveRetention(now = new Date(), options: { dryRun?: boolean } = {}) {
    const policy = await this.getPolicy();
    if (policy.legalHold || policy.retentionFrozen)
      return { skipped: true, dryRun: !!options.dryRun, archived: 0 };
    const runtimeCutoff = new Date(
      now.getTime() - policy.runtimeRetentionDays * 86400000
    );
    const failureCutoff = new Date(
      now.getTime() - policy.failureRetentionDays * 86400000
    );
    const auditCutoff = new Date(
      now.getTime() - policy.auditRetentionDays * 86400000
    );
    // Same retention classes as cleanup: error/fatal stay online for the
    // failure retention period.
    const archiveWhere: Prisma.LocalMindLogEventWhereInput = {
      OR: [
        {
          retentionClass: 'runtime',
          occurredAt: { lt: runtimeCutoff },
          severity: { notIn: ['error', 'fatal'] },
        },
        {
          retentionClass: 'runtime',
          occurredAt: { lt: failureCutoff },
          severity: { in: ['error', 'fatal'] },
        },
        {
          retentionClass: 'audit',
          occurredAt: { lt: auditCutoff },
        },
      ],
    };
    if (options.dryRun) {
      // One archive batch holds at most 1000 rows; do not count past that.
      const archived = await this.prisma.localMindLogEvent.count({
        where: archiveWhere,
        take: 1000,
      });
      return {
        skipped: false,
        dryRun: true,
        archived,
      };
    }
    if (
      !(await this.prisma.localMindLogEvent.findFirst({
        where: archiveWhere,
        select: { id: true },
      }))
    ) {
      return { skipped: true, dryRun: false, archived: 0 };
    }

    const workerLeaseId = randomUUID();
    const workerLeaseExpiresAt = new Date(now.getTime() + 5 * 60_000);
    const due = await this.prisma.localMindLogArchiveBatch.findFirst({
      where: {
        OR: [
          {
            status: { in: ['pending', 'retry_wait'] },
            nextAttemptAt: { lte: now },
          },
          { status: 'running', workerLeaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    });
    let batch;
    if (due) {
      const claimed = await this.prisma.localMindLogArchiveBatch.updateMany({
        where:
          due.status === 'running'
            ? {
                id: due.id,
                status: 'running',
                attempt: due.attempt,
                workerLeaseId: due.workerLeaseId,
                workerLeaseExpiresAt: { lte: now },
              }
            : {
                id: due.id,
                status: due.status,
                attempt: due.attempt,
                nextAttemptAt: { lte: now },
              },
        data: {
          status: 'running',
          workerLeaseId,
          workerLeaseExpiresAt,
          attempt: { increment: 1 },
          failureCode: null,
        },
      });
      if (claimed.count !== 1) {
        return {
          skipped: true,
          dryRun: false,
          archived: 0,
          contended: true,
        };
      }
      batch = await this.prisma.localMindLogArchiveBatch.findFirstOrThrow({
        where: { id: due.id, status: 'running', workerLeaseId },
      });
    } else {
      batch = await this.prisma.localMindLogArchiveBatch.create({
        data: {
          id: randomUUID(),
          status: 'running',
          workerLeaseId,
          workerLeaseExpiresAt,
          attempt: 1,
        },
      });
    }

    try {
      const keyring = readLocalMindLogArchiveKeyring();
      return await this.prisma.$transaction(
        async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('localmind_log_retention'))`;
          const rows = await tx.localMindLogEvent.findMany({
            where: archiveWhere,
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            take: 1000,
          });
          const eventIds = [...new Set(rows.map(row => row.eventId))];
          const auditEnvelopes = eventIds.length
            ? await tx.localMindAuditEnvelope.findMany({
                where: { eventId: { in: eventIds } },
              })
            : [];
          const auditByEventId = new Map(
            auditEnvelopes
              .filter(envelope => envelope.eventId)
              .map(envelope => [envelope.eventId as string, envelope])
          );
          const normalize = (value: unknown) =>
            redact(JSON.parse(JSON.stringify(value))) as object;
          const manifest: LocalMindLogArchiveManifest = {
            schemaVersion: LOCALMIND_LOG_ARCHIVE_SCHEMA,
            batchId: batch.id,
            instanceId: this.instanceId,
            createdAt: now.toISOString(),
            itemCount: rows.length,
            fromOccurredAt: rows[0]?.occurredAt.toISOString() ?? null,
            toOccurredAt: rows.at(-1)?.occurredAt.toISOString() ?? null,
            entries: rows.map(row => ({
              log: normalize(row),
              audit:
                row.retentionClass === 'audit'
                  ? normalize(auditByEventId.get(row.eventId) ?? null)
                  : null,
            })),
          };
          const envelope = createLocalMindLogArchiveEnvelope(manifest, keyring);
          const archivePath = await writeLocalMindLogArchiveEnvelope(
            localMindLogArchiveDirectory(),
            envelope
          );
          const verified = await readAndVerifyLocalMindLogArchiveEnvelope(
            archivePath,
            keyring
          );
          if (verified.envelope.manifest.batchId !== batch.id) {
            throw new Error('LOCALMIND_AUDIT_ARCHIVE_BATCH_MISMATCH');
          }

          for (const row of rows) {
            await tx.localMindLogArchive.upsert({
              where: { eventId: row.eventId },
              create: {
                id: randomUUID(),
                eventId: row.eventId,
                batchId: batch.id,
                occurredAt: row.occurredAt,
                retentionClass: row.retentionClass,
                payload: {
                  schemaVersion: LOCALMIND_LOG_ARCHIVE_SCHEMA,
                  batchId: batch.id,
                  manifestFingerprint: envelope.fingerprint,
                },
              },
              update: {
                batchId: batch.id,
                payload: {
                  schemaVersion: LOCALMIND_LOG_ARCHIVE_SCHEMA,
                  batchId: batch.id,
                  manifestFingerprint: envelope.fingerprint,
                },
              },
            });
          }
          const completed = await tx.localMindLogArchiveBatch.updateMany({
            where: {
              id: batch.id,
              status: 'running',
              workerLeaseId,
            },
            data: {
              status: 'completed',
              archivePath,
              keyVersion: envelope.keyVersion,
              manifestFingerprint: envelope.fingerprint,
              signature: envelope.signature,
              itemCount: rows.length,
              fromOccurredAt: rows[0]?.occurredAt ?? null,
              toOccurredAt: rows.at(-1)?.occurredAt ?? null,
              workerLeaseId: null,
              workerLeaseExpiresAt: null,
              completedAt: new Date(),
            },
          });
          if (completed.count !== 1) {
            throw new Error('LOCALMIND_AUDIT_ARCHIVE_LEASE_LOST');
          }
          if (eventIds.length) {
            await tx.$executeRaw`
              SELECT set_config('localmind.audit_archive_batch_id', ${batch.id}, true)
            `;
            await tx.localMindAuditEnvelope.deleteMany({
              where: {
                eventId: { in: eventIds },
                occurredAt: { lt: auditCutoff },
              },
            });
            await tx.localMindLogEvent.deleteMany({
              where: { eventId: { in: eventIds } },
            });
          }
          return {
            skipped: false,
            dryRun: false,
            archived: rows.length,
            batchId: batch.id,
            fingerprint: envelope.fingerprint,
            keyVersion: envelope.keyVersion,
            verified: true,
          };
        },
        { timeout: 30_000 }
      );
    } catch (error) {
      const exhausted = batch.attempt >= batch.maxAttempts;
      await this.prisma.localMindLogArchiveBatch.updateMany({
        where: { id: batch.id, status: 'running', workerLeaseId },
        data: {
          status: exhausted ? 'failed' : 'retry_wait',
          failureCode:
            error instanceof Error &&
            /^LOCALMIND_[A-Z0-9_]+$/.test(error.message)
              ? error.message
              : 'LOCALMIND_AUDIT_ARCHIVE_FAILED',
          nextAttemptAt: new Date(Date.now() + 60_000),
          workerLeaseId: null,
          workerLeaseExpiresAt: null,
        },
      });
      throw error;
    }
  }

  async listArchiveBatches(limit = 50) {
    return await this.prisma.localMindLogArchiveBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async verifyArchiveBatch(batchId: string) {
    const batch = await this.prisma.localMindLogArchiveBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch?.archivePath || batch.status !== 'completed') {
      throw new Error('LOCALMIND_AUDIT_ARCHIVE_NOT_READY');
    }
    const { envelope, verification } =
      await readAndVerifyLocalMindLogArchiveEnvelope(
        batch.archivePath,
        readLocalMindLogArchiveKeyring()
      );
    if (
      envelope.manifest.batchId !== batch.id ||
      verification.fingerprint !== batch.manifestFingerprint ||
      envelope.signature !== batch.signature ||
      verification.keyVersion !== batch.keyVersion
    ) {
      throw new Error('LOCALMIND_AUDIT_ARCHIVE_DATABASE_MISMATCH');
    }
    return { batchId, verified: true, ...verification };
  }

  private async persist(record: SpoolRecord) {
    if (record.auditEnvelope) {
      await this.logDb.$transaction(async tx => {
        await this.persistWithClient(tx, record);
        await tx.localMindAuditEnvelope.create({
          data: {
            id: randomUUID(),
            auditEventId: record.eventId,
            eventId: record.eventId,
            action: String(record.auditAction ?? record.eventName).replace(
              /^audit\./,
              ''
            ),
            outcome: String(record.auditOutcome ?? record.status ?? 'unknown'),
            actorType: record.actorType ? String(record.actorType) : undefined,
            actorIdHash: record.actorIdHash
              ? String(record.actorIdHash)
              : undefined,
            workspaceId: record.workspaceId
              ? String(record.workspaceId)
              : undefined,
            projectId: record.projectId ? String(record.projectId) : undefined,
            resourceType: record.resourceType
              ? String(record.resourceType)
              : undefined,
            resourceId: record.resourceId
              ? String(record.resourceId)
              : undefined,
            authorizationFp: record.authorizationFingerprint
              ? String(record.authorizationFingerprint)
              : undefined,
            fingerprint: String(record.fingerprint ?? ''),
            metadata: record.metadata as object,
          },
        });
      });
      return true;
    }
    const inserted = await this.logDb.$transaction(
      tx => this.persistRuntimeBatch(tx, [record]),
      { maxWait: 5000 }
    );
    return inserted.length > 0;
  }

  private async persistRuntimeBatch(
    tx: Prisma.TransactionClient,
    records: SpoolRecord[],
    { fresh = false }: { fresh?: boolean } = {}
  ) {
    if (fresh) {
      // First attempts of server-generated UUIDs skip the lock and lookups; the
      // global event ID registry trigger still rejects any duplicate.
      return await tx.localMindLogEvent.createManyAndReturn({
        data: records.map(record => this.eventData(record)),
        select: { eventId: true },
      });
    }
    const eventIds = records.map(record => record.eventId);
    // Time partitions cannot enforce global event_id uniqueness. Lock hashes in
    // a stable order, then check committed live/archive rows before insertion.
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(lock_id)
      FROM (
        SELECT DISTINCT hashtextextended(event_key, 0) AS lock_id
        FROM unnest(ARRAY[${Prisma.join(eventIds.map(id => `log-ingestion:${id}`))}]::text[]) AS events(event_key)
        ORDER BY lock_id
      ) AS locks
    `);
    // UNION keeps the result distinct and bounded even if legacy ingestion has already
    // stored many copies of these events in the partitioned table.
    const accepted = await tx.$queryRaw<{ eventId: string }[]>(Prisma.sql`
      SELECT event_id AS "eventId" FROM localmind_log_events
      WHERE event_id IN (${Prisma.join(eventIds)})
      UNION
      SELECT event_id AS "eventId" FROM localmind_log_archives
      WHERE event_id IN (${Prisma.join(eventIds)})
    `);
    const existing = new Set(accepted.map(row => row.eventId));
    const missing = records.filter(record => !existing.has(record.eventId));
    if (!missing.length) return [];
    return await tx.localMindLogEvent.createManyAndReturn({
      data: missing.map(record => this.eventData(record)),
      skipDuplicates: true,
      select: { eventId: true },
    });
  }

  private async persistAuditEnvelopeOnly(record: SpoolRecord) {
    const existing = await this.logDb.localMindAuditEnvelope.findUnique({
      where: { auditEventId: record.eventId },
      select: { auditEventId: true, fingerprint: true },
    });
    if (existing) {
      if (existing.fingerprint !== String(record.fingerprint ?? '')) {
        throw new Error('LOCALMIND_AUDIT_EVENT_ID_CONFLICT');
      }
      return;
    }
    await this.logDb.localMindAuditEnvelope.create({
      data: {
        id: randomUUID(),
        auditEventId: record.eventId,
        eventId: record.eventId,
        action: String(record.auditAction ?? record.eventName).replace(
          /^audit\./,
          ''
        ),
        outcome: String(record.auditOutcome ?? record.status ?? 'unknown'),
        actorType: record.actorType ? String(record.actorType) : undefined,
        actorIdHash: record.actorIdHash
          ? String(record.actorIdHash)
          : undefined,
        workspaceId: record.workspaceId
          ? String(record.workspaceId)
          : undefined,
        projectId: record.projectId ? String(record.projectId) : undefined,
        resourceType: record.resourceType
          ? String(record.resourceType)
          : undefined,
        resourceId: record.resourceId ? String(record.resourceId) : undefined,
        authorizationFp: record.authorizationFingerprint
          ? String(record.authorizationFingerprint)
          : undefined,
        fingerprint: String(record.fingerprint ?? ''),
        metadata: record.metadata as object,
      },
    });
  }

  private buildRecord(input: LocalMindLogInput): SpoolRecord {
    const cls = ClsServiceManager.getClsService();
    return {
      eventId: input.eventId ?? randomUUID(),
      occurredAt: new Date().toISOString(),
      instanceId: this.instanceId,
      nodeId: this.nodeId,
      service: input.service ?? 'backend',
      component: input.component,
      severity: input.severity ?? 'info',
      eventName: input.eventName,
      messageTemplate: this.safeMessage(input.message),
      requestId: input.requestId ?? cls?.getId(),
      traceId: input.traceId,
      spanId: input.spanId,
      actorType: input.actorType,
      actorIdHash: hashActor(input.actorId),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      status: input.status,
      errorCode: input.errorCode,
      durationMs: input.durationMs,
      metadata: redact(input.metadata),
      redactionVersion: 'v1',
      retentionClass: input.retentionClass ?? 'runtime',
    };
  }

  private async persistWithClient(
    client:
      | PrismaClient
      | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    record: SpoolRecord
  ) {
    await client.localMindLogEvent.create({ data: this.eventData(record) });
  }

  private eventData(
    record: SpoolRecord
  ): Prisma.LocalMindLogEventCreateManyInput {
    return {
      id: randomUUID(),
      eventId: record.eventId,
      occurredAt: new Date(String(record.occurredAt)),
      ingestedAt: new Date(),
      instanceId: String(record.instanceId),
      nodeId: String(record.nodeId),
      service: String(record.service),
      component: record.component ? String(record.component) : undefined,
      severity: String(record.severity),
      eventName: String(record.eventName),
      messageTemplate: record.messageTemplate
        ? String(record.messageTemplate)
        : undefined,
      requestId: record.requestId ? String(record.requestId) : undefined,
      traceId: record.traceId ? String(record.traceId) : undefined,
      spanId: record.spanId ? String(record.spanId) : undefined,
      actorType: record.actorType ? String(record.actorType) : undefined,
      actorIdHash: record.actorIdHash ? String(record.actorIdHash) : undefined,
      workspaceId: record.workspaceId ? String(record.workspaceId) : undefined,
      projectId: record.projectId ? String(record.projectId) : undefined,
      resourceType: record.resourceType
        ? String(record.resourceType)
        : undefined,
      resourceId: record.resourceId ? String(record.resourceId) : undefined,
      status: record.status ? String(record.status) : undefined,
      errorCode: record.errorCode ? String(record.errorCode) : undefined,
      durationMs:
        typeof record.durationMs === 'number' ? record.durationMs : undefined,
      metadata: record.metadata as object,
      redactionVersion: 'v1',
      retentionClass: String(record.retentionClass ?? 'runtime'),
    };
  }

  private safeMessage(message?: string) {
    if (!message) return undefined;
    const value = message.replace(/[\r\n\t]/g, ' ').trim();
    if (value.length > 512) return '[message omitted]';
    return /(?:api[_-]?key|token|secret|password|cookie|authorization|prompt|document|attachment|content)/i.test(
      value
    )
      ? '[message redacted]'
      : value;
  }

  /**
   * stdout is a compatibility mirror. When its reader stalls Node queues the
   * strings in the JS heap, so skip and count instead of growing the queue.
   */
  private mirror(record: SpoolRecord) {
    if (process.stdout.writableLength > this.limits.mirrorMaxQueuedBytes) {
      this.mirrorSkipped++;
      this.window.mirrorSkipped++;
      return;
    }
    if (this.mirrorSkipped) {
      const skipped = this.mirrorSkipped;
      this.mirrorSkipped = 0;
      process.stdout.write(
        `${JSON.stringify({
          eventName: 'log.mirror.skipped',
          severity: 'warn',
          occurredAt: new Date().toISOString(),
          metadata: { skipped },
          transport: 'stdout-mirror',
        })}\n`
      );
    }
    process.stdout.write(
      `${JSON.stringify({ ...record, transport: 'stdout-mirror' })}\n`
    );
  }
}

function isCritical(record: SpoolRecord) {
  return record.severity === 'error' || record.severity === 'fatal';
}

type RetentionBatchResult = {
  scanned: number;
  deleted: number;
  lastAt: Date | null;
  lastId: string | null;
};

/** A retention run failure with a stable code for the run record. */
class RetentionRunError extends Error {
  constructor(
    readonly code: string,
    detail: string
  ) {
    super(`${code}: ${detail}`);
    this.name = 'RetentionRunError';
  }
}

/**
 * Batch timeouts: PostgreSQL statement timeout (57014), Prisma interactive
 * transaction expiry (P2028) and connection acquisition timeout (P2024).
 */
function isRetentionBatchTimeout(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2028' || error.code === 'P2024') return true;
    if (error.code === 'P2010' && error.meta?.code === '57014') return true;
  }
  return (
    error instanceof Error &&
    /statement timeout|expired transaction|transaction already closed/i.test(
      error.message
    )
  );
}

/** Bounded single-line failure text; query parameters are never included. */
function retentionFailureMessage(error: unknown) {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}
