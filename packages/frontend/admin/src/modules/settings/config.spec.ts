/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

describe('settings config groups', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  test('keeps Copilot configuration on the dedicated Admin AI page', async () => {
    vi.stubGlobal('environment', { isSelfHosted: true });

    const { ALL_SETTING_GROUPS } = await import('./config');

    expect(ALL_SETTING_GROUPS.some(group => group.module === 'copilot')).toBe(
      false
    );
  });
});
