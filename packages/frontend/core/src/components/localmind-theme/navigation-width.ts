/**
 * Width of the navigation column shared by the Project hub (`navigation` in
 * its pane widths) and the workspace sidebar, so switching between them keeps
 * the divider in place. Includes the 1px divider.
 */
const PANE_WIDTHS_STORAGE_KEY = 'localmind.project.pane-widths';
export const DEFAULT_NAVIGATION_WIDTH = 240;
export const MIN_NAVIGATION_WIDTH = 192;

export function getNavigationWidthBounds(containerWidth: number) {
  return {
    min: MIN_NAVIGATION_WIDTH,
    max: Math.max(
      MIN_NAVIGATION_WIDTH,
      Math.min(420, containerWidth - 56 - (containerWidth > 1040 ? 760 : 400))
    ),
  };
}

export function readNavigationWidth(): number | undefined {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(PANE_WIDTHS_STORAGE_KEY) ?? '{}'
    ) as Record<string, unknown>;
    for (const value of [saved.navigation, saved.documentsNavigation]) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeNavigationWidth(width: number) {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(PANE_WIDTHS_STORAGE_KEY) ?? '{}'
    ) as Record<string, unknown>;
    window.localStorage.setItem(
      PANE_WIDTHS_STORAGE_KEY,
      JSON.stringify({ ...saved, navigation: width })
    );
  } catch {
    // Resizing still works when browser storage is unavailable.
  }
}
