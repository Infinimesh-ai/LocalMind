import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsServiceManager } from 'nestjs-cls';

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
        select: { auditEventId: true },
      });
      if (existing) return existing.auditEventId;
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
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.localMindAuditEnvelope.findUnique({
          where: { auditEventId },
          select: { auditEventId: true },
        });
        if (existing) return existing.auditEventId;
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
    from?: Date;
    to?: Date;
    severity?: string;
    service?: string;
    component?: string;
    eventName?: string;
    requestId?: string;
    traceId?: string;
    workspaceId?: string;
    projectId?: string;
    runId?: string;
    jobId?: string;
    status?: string;
    errorCode?: string;
    keyword?: string;
    limit?: number;
  }) {
    return this.prisma.localMindLogEvent.findMany({
      where: {
        occurredAt: { gte: args.from, lte: args.to },
        severity: args.severity,
        service: args.service,
        component: args.component,
        eventName: args.eventName,
        requestId: args.requestId,
        traceId: args.traceId,
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        runId: args.runId,
        jobId: args.jobId,
        status: args.status,
        errorCode: args.errorCode,
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
    const cutoff = new Date(
      now.getTime() - policy.runtimeRetentionDays * 86400000
    );
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('localmind_log_retention'))`;
      const rows = await tx.localMindLogEvent.findMany({
        where: { retentionClass: 'runtime', occurredAt: { lt: cutoff } },
        orderBy: { occurredAt: 'asc' },
        take: 1000,
      });
      if (options.dryRun)
        return { skipped: false, dryRun: true, archived: rows.length };
      for (const row of rows) {
        await tx.localMindLogArchive.upsert({
          where: { eventId: row.eventId },
          create: {
            id: randomUUID(),
            eventId: row.eventId,
            occurredAt: row.occurredAt,
            retentionClass: row.retentionClass,
            payload: redact(row) as object,
          },
          update: {},
        });
      }
      if (rows.length) {
        await tx.localMindLogEvent.deleteMany({
          where: { eventId: { in: rows.map(row => row.eventId) } },
        });
      }
      return { skipped: false, dryRun: false, archived: rows.length };
    });
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
      select: { auditEventId: true },
    });
    if (existing) return;
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
