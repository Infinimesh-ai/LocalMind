import {
  Args,
  Field,
  GraphQLISODateTime,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { PrismaClient } from '@prisma/client';
import { GraphQLJSONObject } from 'graphql-scalars';

import { LocalMindLogService } from '../../base/logger';
import { CurrentUser, type CurrentUser as CurrentUserType } from '../auth';
import { Admin } from '../common';
import { PermissionAccess } from '../permission';

@ObjectType()
export class LocalMindLogEventType {
  @Field() eventId!: string;
  @Field(() => String, { nullable: true }) auditEventId!: string | null;
  @Field(() => GraphQLISODateTime) occurredAt!: Date;
  @Field() severity!: string;
  @Field() eventName!: string;
  @Field(() => String, { nullable: true }) messageTemplate!: string | null;
  @Field(() => String, { nullable: true }) requestId!: string | null;
  @Field(() => String, { nullable: true }) traceId!: string | null;
  @Field(() => String, { nullable: true }) status!: string | null;
  @Field(() => String, { nullable: true }) errorCode!: string | null;
  @Field(() => GraphQLJSONObject, { nullable: true }) metadata!: unknown;
}

@InputType()
export class LocalMindLogPolicyInput {
  @Field(() => Int, { nullable: true }) runtimeRetentionDays?: number;
  @Field(() => Int, { nullable: true }) failureRetentionDays?: number;
  @Field(() => Int, { nullable: true }) traceRetentionDays?: number;
  @Field(() => Int, { nullable: true }) auditRetentionDays?: number;
  @Field(() => Int, { nullable: true }) spoolMaxBytes?: number;
  @Field({ nullable: true }) legalHold?: boolean;
  @Field({ nullable: true }) retentionFrozen?: boolean;
}

@Admin()
@Resolver()
export class ObservabilityResolver {
  constructor(
    private readonly logs: LocalMindLogService,
    private readonly db: PrismaClient
  ) {}

  @Query(() => [LocalMindLogEventType])
  async localmindLogEvents(
    @Args('from', { type: () => GraphQLISODateTime, nullable: true })
    from?: Date,
    @Args('to', { type: () => GraphQLISODateTime, nullable: true }) to?: Date,
    @Args('severity', { nullable: true }) severity?: string,
    @Args('service', { nullable: true }) service?: string,
    @Args('component', { nullable: true }) component?: string,
    @Args('eventName', { nullable: true }) eventName?: string,
    @Args('requestId', { nullable: true }) requestId?: string,
    @Args('traceId', { nullable: true }) traceId?: string,
    @Args('workspaceId', { nullable: true }) workspaceId?: string,
    @Args('projectId', { nullable: true }) projectId?: string,
    @Args('runId', { nullable: true }) runId?: string,
    @Args('jobId', { nullable: true }) jobId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('errorCode', { nullable: true }) errorCode?: string,
    @Args('keyword', { nullable: true }) keyword?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ) {
    const rows = await this.logs.query({
      from,
      to,
      severity,
      service,
      component,
      eventName,
      requestId,
      traceId,
      workspaceId,
      projectId,
      runId,
      jobId,
      status,
      errorCode,
      keyword,
      limit,
    });
    return Promise.all(
      rows.map(async row => {
        const audit = await this.logs.auditForEvent(row.eventId);
        return {
          ...row,
          metadata: row.metadata ?? null,
          auditEventId: audit?.auditEventId ?? null,
        };
      })
    );
  }

  @Query(() => GraphQLJSONObject)
  async localmindLogIngestionStatus() {
    return this.logs.spoolStatus();
  }

  @Query(() => [GraphQLJSONObject])
  async localmindLogArchiveBatches(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ) {
    const rows = await this.logs.listArchiveBatches(limit);
    return rows.map(row => ({
      id: row.id,
      status: row.status,
      keyVersion: row.keyVersion,
      manifestFingerprint: row.manifestFingerprint,
      itemCount: row.itemCount,
      fromOccurredAt: row.fromOccurredAt,
      toOccurredAt: row.toOccurredAt,
      attempt: row.attempt,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt,
      failureCode: row.failureCode,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }));
  }

  @Query(() => [GraphQLJSONObject])
  async localmindSessionDeletionTasks(
    @Args('status', { nullable: true }) status?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ) {
    const rows = await this.db.aiSessionDeletion.findMany({
      where: { status: status || undefined },
      orderBy: { requestedAt: 'desc' },
      take: Math.min(Math.max(limit ?? 50, 1), 200),
    });
    return rows.map(row => ({
      id: row.id,
      sessionId: row.sessionId,
      workspaceId: row.workspaceIdSnapshot,
      projectId: row.projectIdSnapshot,
      status: row.status,
      progress: row.progress,
      resultCounts: row.resultCounts,
      attempt: row.attempt,
      maxAttempts: row.maxAttempts,
      failureCode: row.failureCode,
      holdReason: row.holdReason,
      receiptFingerprint: row.receiptFingerprint,
      requestedAt: row.requestedAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      backupStatus: row.status === 'held' ? 'held' : 'pending_retention_expiry',
    }));
  }

  @Query(() => GraphQLJSONObject)
  async localmindLogPolicy() {
    const policy = await this.logs.getPolicy();
    return {
      ...policy,
      spoolMaxBytes: Number(policy.spoolMaxBytes),
      externalTelemetryEnabled: false,
      retentionFrozen: policy.retentionFrozen,
      frozenAt: policy.frozenAt,
    };
  }

  @Mutation(() => GraphQLJSONObject)
  async updateLocalmindLogPolicy(
    @Args('input') input: LocalMindLogPolicyInput
  ) {
    const policy = await this.logs.updatePolicy(input);
    return {
      ...policy,
      spoolMaxBytes: Number(policy.spoolMaxBytes),
      externalTelemetryEnabled: false,
      retentionFrozen: policy.retentionFrozen,
      frozenAt: policy.frozenAt,
    };
  }

  @Mutation(() => GraphQLJSONObject)
  async cleanupLocalmindLogRetention(
    @Args('dryRun', { nullable: true }) dryRun?: boolean
  ) {
    const result = await this.logs.cleanupRetention(new Date(), { dryRun });
    await this.logs.writeAudit({
      action: 'logs.retention.cleanup',
      outcome: result.skipped ? 'skipped' : 'success',
      metadata: result,
    });
    return result;
  }

  @Mutation(() => GraphQLJSONObject)
  async archiveLocalmindLogRetention(
    @Args('dryRun', { nullable: true }) dryRun?: boolean
  ) {
    const result = await this.logs.archiveRetention(new Date(), { dryRun });
    await this.logs.writeAudit({
      action: 'logs.retention.archive',
      outcome: result.skipped ? 'skipped' : 'success',
      metadata: result,
    });
    return result;
  }

  @Mutation(() => GraphQLJSONObject)
  async verifyLocalmindLogArchive(@Args('batchId') batchId: string) {
    const result = await this.logs.verifyArchiveBatch(batchId);
    await this.logs.writeAudit({
      action: 'logs.retention.archive_verify',
      outcome: 'success',
      resourceType: 'localmind_log_archive_batch',
      resourceId: batchId,
      metadata: result,
    });
    return result;
  }
}

/** Workspace/Project administrators may inspect audit envelopes in scope. */
@Resolver()
export class ScopedAuditObservabilityResolver {
  constructor(
    private readonly logs: LocalMindLogService,
    private readonly permissions: PermissionAccess
  ) {}

  @Query(() => [GraphQLJSONObject])
  async localmindAuditEnvelopes(
    @CurrentUser() user: CurrentUserType,
    @Args('workspaceId') workspaceId: string,
    @Args('projectId', { nullable: true }) projectId?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ) {
    await this.permissions
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Users.Manage');
    const rows = await this.logs.queryAudits({
      workspaceId,
      projectId,
      limit,
    });
    return rows.map(row => ({
      auditEventId: row.auditEventId,
      eventId: row.eventId,
      action: row.action,
      outcome: row.outcome,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      occurredAt: row.occurredAt,
      metadata: row.metadata,
    }));
  }
}
