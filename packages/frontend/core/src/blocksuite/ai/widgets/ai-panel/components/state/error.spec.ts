/**
 * @vitest-environment happy-dom
 */

import { describe, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  I18n: {
    Cancel: () => 'Cancel',
    'com.affine.ai.error.configure-byok': () => 'Configure BYOK',
  },
}));

import { ByokNotConfiguredError } from '../../../../provider';
import { renderByokNotConfiguredError } from './error';

describe('AIPanelError', () => {
  test('offers a direct BYOK configuration action', () => {
    const configureByok = vi.fn();
    const template = renderByokNotConfiguredError({
      cancel: vi.fn(),
      configureByok,
      error: new ByokNotConfiguredError(
        'Configure a provider before using AI.'
      ),
    });
    const [message, , , onConfigureByok, actionText] = template.values;

    expect(message).toBe('Configure a provider before using AI.');
    expect(actionText).toBe('Configure BYOK');

    (onConfigureByok as () => void)();
    expect(configureByok).toHaveBeenCalledOnce();
  });
});
