import { Loading } from '@affine/component';
import { SWRConfigProvider } from '@affine/core/components/providers/swr-config-provider';
import { WorkspaceServerService } from '@affine/core/modules/cloud';
import { useAppLayoutReady } from '@affine/core/modules/desktop-api';
import { useI18n } from '@affine/i18n';
import { WarningIcon } from '@blocksuite/icons/rc';
import { FrameworkScope } from '@toeverything/infra';

import { useWorkbenchHost } from '../intelligence/host';
import * as workbenchStyles from '../intelligence/index.css';
import { GlobalTasksComponent } from '../workspace/tasks';

export const Component = () => {
  useAppLayoutReady();
  const t = useI18n();
  const { hostMetadata, hostWorkspace, workspacesRevalidating } =
    useWorkbenchHost();

  if (!hostMetadata || !hostWorkspace) {
    return (
      <main className={workbenchStyles.unavailableRoot}>
        {workspacesRevalidating || hostMetadata ? (
          <Loading size={28} />
        ) : (
          <>
            <WarningIcon />
            <h1>{t['com.affine.workspaceSubPath.tasks']()}</h1>
            <p>{t['com.affine.localmind.workbench.noHost']()}</p>
          </>
        )}
      </main>
    );
  }

  const hostServer = hostWorkspace.scope.get(WorkspaceServerService).server;

  return (
    <FrameworkScope scope={hostServer?.scope}>
      <FrameworkScope scope={hostWorkspace.scope}>
        <SWRConfigProvider>
          <GlobalTasksComponent />
        </SWRConfigProvider>
      </FrameworkScope>
    </FrameworkScope>
  );
};
