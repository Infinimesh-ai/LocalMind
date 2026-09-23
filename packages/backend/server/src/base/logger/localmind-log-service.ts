import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
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
import { hashActor, redact } from './redactor';
import {
  LocalMindLogSpool,
  SpoolCapacityError,
  type SpoolRecord,
} from './spool';

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
export class LocalMindLogService {
  private static sink?: (input: LocalMindLogInput) => void;
  private static consoleInstalled = false;
  private readonly instanceId = process.env.LOCALMIND_INSTANCE_ID ?? 'local';
  private readonly nodeId = process.env.LOCALMIND_NODE_ID ?? `${process.pid}`;
  private readonly spool = new LocalMindLogSpool(
    process.env.LOCALMIND_LOG_SPOOL_DIR ??
      join(
        process.env.LOCALMIND_DATA_DIR ?? '/tmp/localmind',
        'logs',
        'spool',
        this.nodeId
      )
  );
  private flushing = false;
  private lastSpoolError?: string;
  private lastSpoolFlushAt?: Date;
  private lastSpoolFlushed = 0;

  constructor(private readonly prisma: PrismaClient) {}

  static registerSink(sink: (input: LocalMindLogInput) => void) {
    LocalMindLogService.sink = sink;
  }

  static emit(input: LocalMindLogInput) {
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

  async write(input: LocalMindLogInput) {
    const cls = ClsServiceManager.getClsService();
    const eventId = input.eventId ?? randomUUID();
    const record: SpoolRecord = {
      eventId,
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
    this.mirror(record);
    try {
      await this.persist(record);
    } catch (error) {
      // A replay with an existing event_id is already durably accepted.
      // Treat the database uniqueness response as an idempotent success so
      // duplicate client batches do not create needless spool records.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return eventId;
      }
      const hasCapacity = (await this.spool.bytes()) < this.spool.maxBytes;
      if (
        hasCapacity ||
        record.severity === 'error' ||
        record.severity === 'fatal'
      ) {
        try {
          await this.spool.append(record);
          if (record.eventName !== 'log.ingestion.degraded') {
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
          }
        } catch (spoolError) {
          if (
            !(spoolError instanceof SpoolCapacityError) ||
            record.severity === 'error' ||
            record.severity === 'fatal'
          ) {
            throw spoolError;
          }
          this.mirror({
            ...record,
            eventId: randomUUID(),
            eventName: 'log.spool.capacity_reached',
            severity: 'warn',
            metadata: {
              droppedEventName: record.eventName,
              reason: 'capacity',
            },
          });
        }
      } else {
        this.mirror({
          ...record,
          eventId: randomUUID(),
          eventName: 'log.spool.capacity_reached',
          severity: 'error',
          metadata: { droppedEventName: record.eventName, reason: 'capacity' },
        });
      }
    }
    return eventId;
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

  async flushSpool(limit = 100) {
    if (this.flushing) return 0;
    const releaseLease = await this.spool.acquireFlushLease();
    if (!releaseLease) return 0;
    this.flushing = true;
    try {
      let flushed = 0;
      this.lastSpoolFlushAt = new Date();
      this.lastSpoolError = undefined;
      for (const file of (await this.spool.list()).slice(0, limit)) {
        let record: SpoolRecord | undefined;
        try {
          record = await this.spool.read(file);
          await this.persist(record);
          await this.spool.remove(file);
          flushed++;
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            if (record?.auditEnvelope) {
              await this.persistAuditEnvelopeOnly(record);
            }
            await this.spool.remove(file);
            flushed++;
            continue;
          }
          this.lastSpoolError =
            error instanceof Error ? error.message : String(error);
          break;
        }
      }
      this.lastSpoolFlushed = flushed;
      return flushed;
    } finally {
      this.flushing = false;
      await releaseLease();
    }
  }

  @Interval(15_000)
  async scheduledSpoolFlush() {
    await this.flushSpool();
  }

  @Interval(3_600_000)
  async scheduledRetentionCleanup() {
    const result = await this.cleanupRetention();
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

  async spoolStatus() {
    return {
      directory: this.spool.directory,
      bytes: await this.spool.bytes(),
      files: (await this.spool.list()).length,
      lastFlushAt: this.lastSpoolFlushAt,
      lastFlushed: this.lastSpoolFlushed,
      lastError: this.lastSpoolError,
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

  async cleanupRetention(now = new Date(), options: { dryRun?: boolean } = {}) {
    const policy = await this.getPolicy();
    if (policy.legalHold || policy.retentionFrozen)
      return { skipped: true, dryRun: !!options.dryRun, deleted: 0 };
    const runtimeCutoff = new Date(
      now.getTime() - policy.runtimeRetentionDays * 86400000
    );
    const failureCutoff = new Date(
      now.getTime() - policy.failureRetentionDays * 86400000
    );
    const where: Prisma.LocalMindLogEventWhereInput = {
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
    };
    const result = await this.prisma.$transaction(async tx => {
      // Serialize cleanup workers across replicas and provide a bounded
      // partition/batch lock window while retention evidence is evaluated.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('localmind_log_retention'))`;
      const count = await tx.localMindLogEvent.count({ where });
      if (options.dryRun) return count;
      const deleted = await tx.localMindLogEvent.deleteMany({ where });
      return deleted.count;
    });
    return { skipped: false, dryRun: !!options.dryRun, deleted: result };
  }

  async archiveRetention(now = new Date(), options: { dryRun?: boolean } = {}) {
    const policy = await this.getPolicy();
    if (policy.legalHold || policy.retentionFrozen)
      return { skipped: true, dryRun: !!options.dryRun, archived: 0 };
    const runtimeCutoff = new Date(
      now.getTime() - policy.runtimeRetentionDays * 86400000
    );
    const auditCutoff = new Date(
      now.getTime() - policy.auditRetentionDays * 86400000
    );
    const archiveWhere: Prisma.LocalMindLogEventWhereInput = {
      OR: [
        {
          retentionClass: 'runtime',
          occurredAt: { lt: runtimeCutoff },
        },
        {
          retentionClass: 'audit',
          occurredAt: { lt: auditCutoff },
        },
      ],
    };
    if (options.dryRun) {
      const archived = await this.prisma.localMindLogEvent.count({
        where: archiveWhere,
      });
      return {
        skipped: false,
        dryRun: true,
        archived: Math.min(archived, 1000),
      };
    }
    if (
      (await this.prisma.localMindLogEvent.count({ where: archiveWhere })) === 0
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
      await this.prisma.$transaction(async tx => {
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
      return;
    }
    await this.persistWithClient(this.prisma, record);
  }

  private async persistAuditEnvelopeOnly(record: SpoolRecord) {
    const existing = await this.prisma.localMindAuditEnvelope.findUnique({
      where: { auditEventId: record.eventId },
      select: { auditEventId: true, fingerprint: true },
    });
    if (existing) {
      if (existing.fingerprint !== String(record.fingerprint ?? '')) {
        throw new Error('LOCALMIND_AUDIT_EVENT_ID_CONFLICT');
      }
      return;
    }
    await this.prisma.localMindAuditEnvelope.create({
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
    await client.localMindLogEvent.create({
      data: {
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
        status: record.status ? String(record.status) : undefined,
        errorCode: record.errorCode ? String(record.errorCode) : undefined,
        durationMs:
          typeof record.durationMs === 'number' ? record.durationMs : undefined,
        metadata: record.metadata as object,
        redactionVersion: 'v1',
        retentionClass: String(record.retentionClass ?? 'runtime'),
      },
    });
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

  private mirror(record: SpoolRecord) {
    process.stdout.write(
      `${JSON.stringify({ ...record, transport: 'stdout-mirror' })}\n`
    );
  }
}
