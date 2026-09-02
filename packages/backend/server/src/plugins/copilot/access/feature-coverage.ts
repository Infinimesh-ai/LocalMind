import type { ByokFeatureKind } from '../byok/types';

export type ByokSourceCoverage = {
  local: boolean;
  server: boolean;
};

const DEFAULT_BYOK_COVERAGE: ByokSourceCoverage = {
  local: true,
  server: true,
};

const COPILOT_FEATURE_ACCESS: Partial<
  Record<ByokFeatureKind, ByokSourceCoverage>
> = {
  transcript: { local: false, server: true },
  embedding: { local: false, server: false },
  workspace_indexing: { local: false, server: false },
  rerank: { local: false, server: false },
};

export function getByokSourceCoverage(
  featureKind?: ByokFeatureKind
): ByokSourceCoverage {
  const access = getCopilotFeatureAccess(featureKind);
  return { local: access.local, server: access.server };
}

export function getCopilotFeatureAccess(
  featureKind?: ByokFeatureKind
): ByokSourceCoverage {
  return featureKind
    ? (COPILOT_FEATURE_ACCESS[featureKind] ?? DEFAULT_BYOK_COVERAGE)
    : DEFAULT_BYOK_COVERAGE;
}
