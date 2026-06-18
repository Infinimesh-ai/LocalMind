export const ACTION_MODEL_SELECTION_SOURCES = [
  'explicit',
  'prompt_preference',
  'unresolved',
] as const;

export type ActionModelSelectionSource =
  (typeof ACTION_MODEL_SELECTION_SOURCES)[number];

export function normalizeActionModelSelectionSource(
  source: unknown
): ActionModelSelectionSource | undefined {
  return typeof source === 'string' &&
    (ACTION_MODEL_SELECTION_SOURCES as readonly string[]).includes(source)
    ? (source as ActionModelSelectionSource)
    : undefined;
}
