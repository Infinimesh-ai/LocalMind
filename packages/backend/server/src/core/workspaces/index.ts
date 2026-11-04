import { Module } from '@nestjs/common';

import { BackendRuntimeModule } from '../backend-runtime';
import { DocStorageModule } from '../doc';
import { DocRendererModule } from '../doc-renderer';
import { FeatureModule } from '../features';
import { MailModule } from '../mail';
import { NotificationModule } from '../notification';
import { PermissionModule } from '../permission';
import { QuotaModule } from '../quota';
import { StorageModule } from '../storage';
import { UserModule } from '../user';
import {
  InviteAbuseDispositionService,
  InviteQuotaAssertService,
} from './abuse';
import { WorkspacesController } from './controller';
import { DocumentAccessService } from './document-access';
import { DocumentEventsService } from './document-events';
import { WorkspaceEvents } from './event';
import { WorkspaceRealtimeModule } from './realtime.module';
import {
  DocHistoryResolver,
  DocResolver,
  WorkspaceBlobResolver,
  WorkspaceDocResolver,
  WorkspaceMemberResolver,
  WorkspaceResolver,
} from './resolvers';
import { AdminWorkspaceResolver } from './resolvers/admin';
import { WorkspaceService } from './service';
import { WorkspaceStatsJob } from './stats.job';

@Module({
  imports: [
    BackendRuntimeModule,
    DocStorageModule,
    DocRendererModule,
    FeatureModule,
    QuotaModule,
    StorageModule,
    UserModule,
    PermissionModule,
    NotificationModule,
    MailModule,
    WorkspaceRealtimeModule,
  ],
  controllers: [WorkspacesController],
  providers: [
    DocumentEventsService,
    WorkspaceResolver,
    WorkspaceMemberResolver,
    WorkspaceDocResolver,
    DocResolver,
    DocHistoryResolver,
    WorkspaceBlobResolver,
    WorkspaceService,
    DocumentAccessService,
    InviteAbuseDispositionService,
    InviteQuotaAssertService,
    WorkspaceEvents,
    AdminWorkspaceResolver,
    WorkspaceStatsJob,
  ],
  exports: [
    WorkspaceService,
    DocumentAccessService,
    WorkspaceResolver,
    WorkspaceMemberResolver,
    WorkspaceDocResolver,
    DocResolver,
    DocHistoryResolver,
    WorkspaceBlobResolver,
  ],
})
export class WorkspaceModule {}

export {
  getAbuseRequestSource,
  InviteAbuseDispositionService,
  InviteQuotaAssertService,
} from './abuse';
export { WorkspaceRealtimeModule } from './realtime.module';
export { WorkspaceService } from './service';
export { InvitationType, WorkspaceType } from './types';
