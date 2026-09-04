import { Module } from '@nestjs/common';

import { PermissionModule } from '../permission';
import { RealtimeModule } from '../realtime';
import { StorageModule } from '../storage';
import { OfficeArtifactService } from './artifact-service';
import { OfficeCommandService } from './command-service';
import { OfficeCommentResolver } from './comment-resolver';
import { OfficeCommentService } from './comment-service';
import { OfficeController } from './controller';
import { OfficeDocxCommandService } from './docx-command';
import { OfficeDocxImportService } from './docx-import';
import { OfficeImportService } from './import-service';
import { OfficeResolver } from './resolver';

@Module({
  imports: [PermissionModule, RealtimeModule, StorageModule],
  controllers: [OfficeController],
  providers: [
    OfficeArtifactService,
    OfficeCommentResolver,
    OfficeCommentService,
    OfficeCommandService,
    OfficeDocxCommandService,
    OfficeDocxImportService,
    OfficeImportService,
    OfficeResolver,
  ],
  exports: [
    OfficeArtifactService,
    OfficeCommentService,
    OfficeCommandService,
    OfficeDocxCommandService,
    OfficeDocxImportService,
    OfficeImportService,
  ],
})
export class OfficeModule {}

export * from './artifact-service';
export * from './command-service';
export * from './comment-resolver';
export * from './comment-service';
export * from './comment-types';
export * from './controller';
export * from './docx-command';
export * from './docx-import';
export * from './evidence';
export * from './formats';
export * from './import-service';
export * from './resolver';
export * from './types';
