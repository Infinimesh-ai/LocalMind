import type { ModelAdapterCapability, ModelAdapterProfile } from '../types';
import {
  pendingQwen36ReleaseGate,
  qwen36ProductionToolCategories,
} from './certification';

export const qwen36Capabilities: readonly ModelAdapterCapability[] = [
  {
    id: 'answer',
    status: 'testing',
    reason:
      'Baseline passed 11/12; arithmetic still needs deterministic tools.',
    releaseGate: pendingQwen36ReleaseGate(),
  },
  {
    id: 'document.read',
    status: 'testing',
    reason: 'Works in baseline but has not met the 20-run release gate.',
    releaseGate: pendingQwen36ReleaseGate(),
  },
  {
    id: 'document.create',
    status: 'testing',
    reason: 'Works with idempotency but planner misclassification remains.',
    releaseGate: pendingQwen36ReleaseGate(),
  },
  {
    id: 'document.update',
    status: 'testing',
    reason: 'Completion evidence is enforced; the 20-run gate is still open.',
    releaseGate: pendingQwen36ReleaseGate(),
  },
  {
    id: 'document.update_meta',
    status: 'testing',
    reason: 'Title changes require ID resolution and repeated verification.',
    releaseGate: pendingQwen36ReleaseGate(),
  },
  {
    id: 'document.search',
    status: 'testing',
    reason: 'Search selection, freshness, and concise output are not stable.',
    releaseGate: pendingQwen36ReleaseGate(),
  },
  {
    id: 'workspace.folder',
    status: 'testing',
    reason: 'Baseline is above 90% but has not met the 20-run release gate.',
    releaseGate: pendingQwen36ReleaseGate(),
  },
  {
    id: 'artifact',
    status: 'disabled',
    reason: 'Nested artifact execution failed 16/16 in the current runtime.',
  },
  {
    id: 'attachment',
    status: 'unavailable',
    reason: 'Delegated attachment context has not been wired and verified.',
  },
  {
    id: 'web',
    status: 'unavailable',
    reason: 'The evaluated deployment has no configured web search executor.',
  },
  {
    id: 'enterprise',
    status: 'unavailable',
    reason: 'No enterprise connection was available for release verification.',
  },
  ...(
    [
      'whiteboard',
      'database',
      'comment',
      'tag',
      'collection',
      'trash',
      'publish',
      'history',
      'asset',
    ] as const
  ).map(id => ({
    id,
    status: 'unavailable' as const,
    reason: 'This capability is not bridged into the delegated tool runtime.',
  })),
];

export const qwen36Profile: ModelAdapterProfile = {
  displayName: 'Qwen3.6 35B-A3B',
  contextWindow: 131_072,
  capabilities: qwen36Capabilities,
  evaluationToolCategories: [
    'docRead',
    'docCreate',
    'docUpdate',
    'docUpdateMeta',
    'docKeywordSearch',
    'docSemanticSearch',
    'workspaceOrganization',
  ],
  productionToolCategories: qwen36ProductionToolCategories(qwen36Capabilities),
};
