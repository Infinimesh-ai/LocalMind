import './config';

import { Module } from '@nestjs/common';

import { BackendRuntimeModule } from '../backend-runtime';
import { PermissionModule } from '../permission';
import { QuotaModule } from '../quota';
import { StorageModule } from '../storage';
import { PgUserspaceDocStorageAdapter } from './adapters/userspace';
import { PgWorkspaceDocStorageAdapter } from './adapters/workspace';
import { WorkspaceDirectoryResolver } from './directory-resolver';
import { DocumentDestinationService } from './document-destination';
import { DocEventsListener } from './event';
import { WorkspaceFolderPageResolver } from './folder-page-resolver';
import { DocStorageCronJob } from './job';
import { WorkspaceNativeResourceAccess } from './native-resource-access';
import { DocStorageOptions } from './options';
import { WorkspaceDocOutboxPublisher } from './outbox';
import { WorkspacePageTreeResolver } from './page-tree-resolver';
import { DatabaseDocReader, DocReader, DocReaderProvider } from './reader';
import { StructuredDocService } from './structured';
import { WorkspaceFolderPageService } from './workspace-folder-page';
import {
  WorkspaceLifecycleResolver,
  WorkspaceLifecycleService,
} from './workspace-lifecycle';
import { WorkspaceOrganizationService } from './workspace-organization';
import { WorkspacePageTreeService } from './workspace-page-tree';
import { WorkspaceResourceService } from './workspace-resource';
import { DocWriter, type WorkspaceDocUpdatesPushedPayload } from './writer';

@Module({
  imports: [BackendRuntimeModule, QuotaModule, PermissionModule, StorageModule],
  providers: [
    WorkspaceFolderPageService,
    WorkspaceFolderPageResolver,
    WorkspaceLifecycleService,
    WorkspaceLifecycleResolver,
    WorkspacePageTreeResolver,
    WorkspaceNativeResourceAccess,
    DocStorageOptions,
    WorkspacePageTreeService,
    WorkspaceResourceService,
    WorkspaceDocOutboxPublisher,
    PgWorkspaceDocStorageAdapter,
    PgUserspaceDocStorageAdapter,
    DocStorageCronJob,
    DocReaderProvider,
    DatabaseDocReader,
    DocEventsListener,
    DocWriter,
    StructuredDocService,
    WorkspaceOrganizationService,
    WorkspaceDirectoryResolver,
    DocumentDestinationService,
  ],
  exports: [
    WorkspaceNativeResourceAccess,
    WorkspacePageTreeService,
    WorkspaceResourceService,
    DatabaseDocReader,
    DocReader,
    DocWriter,
    StructuredDocService,
    WorkspaceOrganizationService,
    DocumentDestinationService,
    PgWorkspaceDocStorageAdapter,
    PgUserspaceDocStorageAdapter,
  ],
})
export class DocStorageModule {}
export {
  // only for doc-service
  DatabaseDocReader,
  DocReader,
  DocumentDestinationService,
  DocWriter,
  PgUserspaceDocStorageAdapter,
  PgWorkspaceDocStorageAdapter,
  StructuredDocService,
  WorkspaceNativeResourceAccess,
  WorkspaceOrganizationService,
};
export type { WorkspaceDocUpdatesPushedPayload };
export { readRootDocPageIdsWithYjs } from './root-doc-registration';
export { DocStorageAdapter, type Editor } from './storage';
export {
  WORKSPACE_DATA_TABLES,
  type WorkspaceDataOperation,
  type WorkspaceDataTable,
  type WorkspaceRootOperation,
} from './workspace-organization';

export { WorkspaceResourceService };

export { WorkspacePageTreeService };
