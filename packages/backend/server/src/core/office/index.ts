import { Module } from '@nestjs/common';

import { DocStorageModule } from '../doc';
import { PermissionModule } from '../permission';
import { ProjectModule } from '../project';
import { QuotaModule } from '../quota';
import { RealtimeModule } from '../realtime';
import { StorageModule } from '../storage';
import { OfficeArtifactService } from './artifact-service';
import { OfficeCommandService } from './command-service';
import { OfficeCommentRealtimeProvider } from './comment-realtime';
import { OfficeCommentResolver } from './comment-resolver';
import { OfficeCommentService } from './comment-service';
import { OfficeController } from './controller';
import { NativeFileCreateService } from './create-service';
import { OfficeDocxCommandService } from './docx-command';
import { OfficeDocxImportService } from './docx-import';
import { WorkspaceFileController } from './file-controller';
import { OfficeImportService } from './import-service';
import { ProjectOfficeController } from './project-controller';
import { ProjectResourceIndexer } from './project-indexer';
import { ProjectOfficeResolver } from './project-resolver';
import { OfficeResolver } from './resolver';
import { OfficeResourceStorage } from './resource-storage';
import { WorkspaceNativeResourceIndexer } from './workspace-resource-indexer';
import { WorkspaceNativeResourceRealtime } from './workspace-resource-realtime';
import { WorkspaceNativeResourceResolver } from './workspace-resource-resolver';
import { WorkspaceNativeResourceService } from './workspace-resource-service';

@Module({
  imports: [
    QuotaModule,
    DocStorageModule,
    PermissionModule,
    ProjectModule,
    RealtimeModule,
    StorageModule,
  ],
  controllers: [
    OfficeController,
    ProjectOfficeController,
    WorkspaceFileController,
  ],
  providers: [
    WorkspaceNativeResourceIndexer,
    WorkspaceNativeResourceRealtime,
    WorkspaceNativeResourceService,
    WorkspaceNativeResourceResolver,
    NativeFileCreateService,
    OfficeArtifactService,
    OfficeResourceStorage,
    OfficeCommentResolver,
    OfficeCommentRealtimeProvider,
    OfficeCommentService,
    OfficeCommandService,
    OfficeDocxCommandService,
    OfficeDocxImportService,
    OfficeImportService,
    OfficeResolver,
    ProjectOfficeResolver,
    ProjectResourceIndexer,
  ],
  exports: [
    WorkspaceNativeResourceService,
    NativeFileCreateService,
    OfficeArtifactService,
    OfficeCommentService,
    OfficeCommandService,
    OfficeDocxCommandService,
    OfficeDocxImportService,
    OfficeImportService,
    ProjectResourceIndexer,
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
