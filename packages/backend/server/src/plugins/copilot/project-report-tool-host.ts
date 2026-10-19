import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { Config } from '../../base';
import { ProjectReportContentService } from '../../core/project-report/content';
import { ProjectReportService } from '../../core/project-report/service';
import { Models } from '../../models';
import { ProjectReportGenerationService } from './report-generation-service';
import type { ProjectReportToolBackend } from './tools/project-report';

/**
 * Adapts the Project report domain for AI tools. Every call goes through the
 * report model/service, which re-checks Project membership; generation uses
 * the same `generate` command path as the report editor.
 */
@Injectable()
export class ProjectReportToolHost implements ProjectReportToolBackend {
  constructor(
    private readonly models: Models,
    private readonly config: Config,
    private readonly ref: ModuleRef,
    private readonly generation: ProjectReportGenerationService
  ) {}

  private get content() {
    return this.ref.get(ProjectReportContentService, { strict: false });
  }

  private get reports() {
    return this.ref.get(ProjectReportService, { strict: false });
  }

  enabled = () => this.config.projectReports.enabled;

  list: ProjectReportToolBackend['list'] = input =>
    this.models.projectReport.list({ ...input, lifecycle: 'active' });

  read: ProjectReportToolBackend['read'] = input => this.content.read(input);

  task: ProjectReportToolBackend['task'] = input =>
    this.generation.getTask(input);

  generate: ProjectReportToolBackend['generate'] = ({ actorId, ...input }) =>
    this.reports.command(actorId, input);
}
