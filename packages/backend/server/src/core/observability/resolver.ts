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
  constructor(private readonly logs: LocalMindLogService) {}

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
