import {
  DefaultServerService,
  FetchService,
  ServerService,
} from '@affine/core/modules/cloud';
import { FrameworkScope, useService } from '@toeverything/infra';

import { SharedReport } from './shared';
function ScopedSharedReport() {
  const fetcher = useService(FetchService);
  const baseUrl = useService(ServerService).server.serverMetadata.baseUrl;
  return <SharedReport fetcher={fetcher} baseUrl={baseUrl} />;
}
export function Component() {
  const server = useService(DefaultServerService).server;
  return (
    <FrameworkScope scope={server?.scope}>
      <ScopedSharedReport />
    </FrameworkScope>
  );
}
