export const AI_ACTION_MODEL_SELECTION_SOURCES = [
  'explicit',
  'prompt_preference',
  'unresolved',
] as const;

export type AIActionModelSelectionSource =
  (typeof AI_ACTION_MODEL_SELECTION_SOURCES)[number];
