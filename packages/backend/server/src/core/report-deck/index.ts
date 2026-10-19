import './config';

import { Module } from '@nestjs/common';

import { DocStorageModule } from '../doc';
import { OfficeModule } from '../office';
import { PermissionModule } from '../permission';
import { ProjectModule } from '../project';
import { ReportDeckController, ReportDeckShareController } from './controller';
import { ReportDeckResolver } from './resolver';
import { ReportDeckService } from './service';
import { ReportDeckShareService } from './share';
import { ReportDeckSourceService } from './sources';

@Module({
  imports: [DocStorageModule, OfficeModule, PermissionModule, ProjectModule],
  providers: [
    ReportDeckSourceService,
    ReportDeckShareService,
    ReportDeckService,
    ReportDeckResolver,
  ],
  controllers: [ReportDeckController, ReportDeckShareController],
  exports: [ReportDeckSourceService, ReportDeckShareService],
})
export class ReportDeckModule {}

export { ReportDeckService, ReportDeckShareService, ReportDeckSourceService };
