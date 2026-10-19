import { NavigateContext } from '@affine/core/components/hooks/use-navigate-helper';
import { ServerService } from '@affine/core/modules/cloud';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { stashDeckSources } from '@affine/core/modules/report-decks/source-handoff';
import type { DeckSourceRef } from '@localmind/office/report-deck';
import { LiveData, useLiveData, useServiceOptional } from '@toeverything/infra';
import { useCallback, useContext, useMemo } from 'react';

const DISABLED$ = new LiveData(false);

/** Legacy project report studio (schedules, PPTX template import). */
export function useLegacyProjectReportsEnabled() {
  return !!useServiceOptional(FeatureFlagService)?.flags
    .enable_legacy_project_reports.value;
}

/**
 * Report deck entry points follow the same gate as the other AI shortcuts:
 * the `enable_ai` flag and the server copilot feature.
 */
export function useReportDeckEntryAvailable() {
  const flags = useServiceOptional(FeatureFlagService)?.flags;
  const server = useServiceOptional(ServerService)?.server;
  const enableAI = useLiveData(flags?.enable_ai.$ ?? DISABLED$);
  const copilot = useLiveData(
    useMemo(
      () => server?.features$.map(features => !!features?.copilot) ?? DISABLED$,
      [server]
    )
  );
  return !!enableAI && copilot;
}

/**
 * Hands a selection to the report deck configuration page. Uses the app-level
 * navigate so callers inside a workbench view leave the workspace shell.
 */
export function useOpenReportDeck() {
  const navigate = useContext(NavigateContext);
  return useCallback(
    (sources: DeckSourceRef[]) => {
      const path = stashDeckSources(sources);
      if (navigate) void navigate(path);
      else window.location.assign(path);
    },
    [navigate]
  );
}
