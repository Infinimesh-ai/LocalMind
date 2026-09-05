import { useServiceOptional } from '@toeverything/infra';
import { useEffect } from 'react';

import { DesktopApiService } from '../service/desktop-api';

export const useAppLayoutReady = (enabled = true) => {
  const desktopApi = useServiceOptional(DesktopApiService);

  useEffect(() => {
    if (!BUILD_CONFIG.isElectron || !enabled || !desktopApi) {
      return;
    }

    desktopApi.handler.ui.pingAppLayoutReady().catch(console.error);
  }, [desktopApi, enabled]);
};
