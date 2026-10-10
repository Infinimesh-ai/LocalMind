import { Button, useThemeColorV2 } from '@affine/component';
import {
  PageTreeCreateMenu,
  PageTreeRootSort,
  WorkspacePageTree,
} from '@affine/core/components/root-app-sidebar/page-tree';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';

import { MobileNavigationVirtualScroller } from '../../components/navigation';

export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');
  const service = useService(WorkspacePageTreeService),
    enabled = useLiveData(service.enabled$);
  const t = useI18n();
  if (enabled === null)
    return (
      <Button onClick={() => void service.load(null)}>
        {t['com.affine.error.retry']()}
      </Button>
    );
  if (!enabled) return <MobileNavigationVirtualScroller />;
  return (
    <section aria-label={t['com.affine.localmind.page-tree.root']()}>
      <PageTreeCreateMenu name={t['com.affine.localmind.page-tree.root']()} />
      <PageTreeRootSort expanded />
      <WorkspacePageTree />
    </section>
  );
};
