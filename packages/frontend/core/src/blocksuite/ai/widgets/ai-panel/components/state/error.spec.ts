/**
 * @vitest-environment happy-dom
 */

import { describe, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  I18n: {
    Cancel: () => 'Cancel',
  },
}));

import { ByokNotConfiguredError } from '../../../../provider';
import { renderByokNotConfiguredError } from './error';

describe('AIPanelError', () => {
  test('shows administrator guidance without a credential action', () => {
    const cancel = vi.fn();
    const template = renderByokNotConfiguredError({
      cancel,
      error: new ByokNotConfiguredError('Contact your administrator.'),
    });
    const [message, onCancel, actionText] = template.values;

    expect(message).toBe('Contact your administrator.');
    expect(actionText).toBe('Cancel');

    (onCancel as () => void)();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
