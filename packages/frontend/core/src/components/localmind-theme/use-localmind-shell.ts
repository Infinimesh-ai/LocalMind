import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { useLiveData, useService } from '@toeverything/infra';

/** Whether workspace pages render the Project hub look (`enable_global_rail`). */
export function useLocalmindShell() {
  return !!useLiveData(
    useService(FeatureFlagService).flags.enable_global_rail.$
  );
}
