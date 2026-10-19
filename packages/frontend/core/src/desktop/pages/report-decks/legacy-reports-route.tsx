import { getReportDecksPath } from '@affine/core/desktop/route-paths';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { useLiveData, useService } from '@toeverything/infra';
import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';

const LegacyReports = lazy(() =>
  import('../intelligence/reports').then(module => ({
    default: module.Component,
  }))
);

/**
 * Legacy project report studio routes (`/project/:id/reports*`,
 * `report-templates`, `report-schedules`) stay reachable only behind
 * `enable_legacy_project_reports`; otherwise they lead to the new reports.
 */
export function Component() {
  const flags = useService(FeatureFlagService).flags;
  const enabled = useLiveData(flags.enable_legacy_project_reports.$);
  if (!enabled) return <Navigate to={getReportDecksPath()} replace />;
  return (
    <Suspense fallback={null}>
      <LegacyReports />
    </Suspense>
  );
}
