import './config';

import { Module } from '@nestjs/common';

import { REPORT_MAIL_AUTHORIZER } from '../../models/project-report-schedule-contract';
import { MailModule } from '../mail';
import { OfficeModule } from '../office';
import { ProjectModule } from '../project';
import { StorageRuntimeModule } from '../storage-runtime';
import { ProjectReportContentService } from './content';
import {
  ProjectReportController,
  ProjectReportShareController,
} from './controller';
import { ProjectReportExportService } from './export';
import { ProjectReportLifecycleService } from './lifecycle';
import { ProjectReportResolver } from './resolver';
import { ProjectReportScheduleService } from './schedule';
import { ProjectReportService } from './service';
import { ProjectReportShareService } from './share';
@Module({
  imports: [ProjectModule, OfficeModule, MailModule, StorageRuntimeModule],
  providers: [
    ProjectReportLifecycleService,
    ProjectReportContentService,
    ProjectReportService,
    ProjectReportExportService,
    ProjectReportShareService,
    ProjectReportScheduleService,
    {
      provide: REPORT_MAIL_AUTHORIZER,
      useExisting: ProjectReportScheduleService,
    },
    ProjectReportResolver,
  ],
  controllers: [ProjectReportController, ProjectReportShareController],
  exports: [
    ProjectReportScheduleService,
    REPORT_MAIL_AUTHORIZER,
    ProjectReportContentService,
    ProjectReportExportService,
    ProjectReportShareService,
  ],
})
export class ProjectReportModule {}
