// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';

import {
  DEFAULT_NAVIGATION_WIDTH,
  getNavigationWidthBounds,
  readNavigationWidth,
  writeNavigationWidth,
} from './navigation-width';

const key = 'localmind.project.pane-widths';

describe('shared navigation width', () => {
  beforeEach(() => localStorage.clear());

  test('uses the Project Hub default instead of the old Workspace width', () => {
    localStorage.setItem('global-state:width', '248');
    expect(readNavigationWidth() ?? DEFAULT_NAVIGATION_WIDTH).toBe(240);
  });

  test('shares a resized width without overwriting other project panes', () => {
    localStorage.setItem(
      key,
      JSON.stringify({ navigation: 280, resource: 520 })
    );
    expect(readNavigationWidth()).toBe(280);
    writeNavigationWidth(304);
    expect(readNavigationWidth()).toBe(304);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      navigation: 304,
      resource: 520,
    });
  });

  test('retains the legacy Documents width when Hub has no preference', () => {
    localStorage.setItem(key, JSON.stringify({ documentsNavigation: 288 }));
    expect(readNavigationWidth()).toBe(288);
    localStorage.setItem(
      key,
      JSON.stringify({ navigation: 264, documentsNavigation: 288 })
    );
    expect(readNavigationWidth()).toBe(264);
  });

  test.each(['null', '{', '{"navigation":-1}', '{"navigation":"280"}'])(
    'uses the default for invalid preferences: %s',
    value => {
      localStorage.setItem(key, value);
      expect(readNavigationWidth() ?? DEFAULT_NAVIGATION_WIDTH).toBe(240);
    }
  );

  test.each([
    [776, 320],
    [1040, 420],
    [1041, 225],
    [1440, 420],
    [600, 192],
  ])('keeps the same width limit at viewport %ipx', (viewport, max) => {
    expect(getNavigationWidthBounds(viewport)).toEqual({ min: 192, max });
  });
});
