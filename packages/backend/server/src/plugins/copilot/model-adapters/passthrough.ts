import { COPILOT_CHAT_TOOL_CATEGORIES } from '../providers/types';
import type { LocalModelAdapter } from './types';

export const passthroughModelAdapter: LocalModelAdapter = {
  id: 'passthrough',
  version: '1',
  profile: {
    displayName: 'Default provider behavior',
    contextWindow: 0,
    capabilities: [],
    evaluationToolCategories: COPILOT_CHAT_TOOL_CATEGORIES,
    productionToolCategories: COPILOT_CHAT_TOOL_CATEGORIES,
  },
  matches: () => true,
  plannerInstructions: [],
};
