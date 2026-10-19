import {
  Args,
  Field,
  ID,
  InputType,
  Int,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { GraphQLJSONObject } from 'graphql-scalars';

import { Throttle } from '../../base';
import { CurrentUser, type CurrentUser as User } from '../auth';
import type { ReportCommandInput, ReportQuery } from './contracts';
import { ProjectReportService } from './service';

@InputType('ProjectReportCommandInput')
export class ProjectReportCommandInputType {
  @Field(() => ID) projectId!: string;
  @Field(() => ID, { nullable: true }) reportId?: string;
  @Field() requestKey!: string;
  @Field(() => Int, { nullable: true }) expectedVersion?: number;
  @Field(() => GraphQLJSONObject, { nullable: true })
  editLease?: ReportCommandInput['editLease'];
  @Field(() => GraphQLJSONObject) command!: ReportCommandInput['command'];
}
@Resolver()
export class ProjectReportResolver {
  constructor(private readonly service: ProjectReportService) {}
  @Query(() => GraphQLJSONObject)
  projectReportState(
    @CurrentUser() user: User,
    @Args('projectId', { type: () => ID }) projectId: string,
    @Args('reportId', { type: () => ID, nullable: true }) reportId?: string,
    @Args('revisionId', { type: () => ID, nullable: true }) revisionId?: string,
    @Args('view', { type: () => String, nullable: true })
    view?: ReportQuery['view'],
    @Args('cursor', { type: () => String, nullable: true }) cursor?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('search', { type: () => String, nullable: true }) search?: string,
    @Args('lifecycle', { type: () => String, nullable: true })
    lifecycle?: ReportQuery['lifecycle'],
    @Args('scheduleId', { type: () => ID, nullable: true }) scheduleId?: string
  ) {
    return this.service.state(user.id, {
      projectId,
      reportId,
      revisionId,
      view,
      cursor,
      limit,
      search,
      lifecycle,
      scheduleId,
    });
  }
  @Mutation(() => GraphQLJSONObject)
  @Throttle('default', { bucket: 'project-report-command' })
  projectReportCommand(
    @CurrentUser() user: User,
    @Args('input', { type: () => ProjectReportCommandInputType })
    input: ProjectReportCommandInputType
  ) {
    return this.service.command(user.id, input);
  }
}
