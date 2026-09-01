/**
 * @vitest-environment happy-dom
 */

import { describe, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  I18n: {
    'com.affine.ai.error.configure-byok': () => 'Configure BYOK',
  },
}));

import { AIAppEvents, ByokNotConfiguredError } from '../provider';
import { AIChatErrorRenderer } from './error';

describe('AIChatErrorRenderer', () => {
  test('offers a direct BYOK configuration action', () => {
    const requestConfigureByok = vi.fn();
    const subscription =
      AIAppEvents.requestConfigureByok.subscribe(requestConfigureByok);
    const template = AIChatErrorRenderer(
      new ByokNotConfiguredError('Configure a provider before using AI.')
    );
    const [text, actionText, onClick] = template.values;

    expect(text).toBe('Configure a provider before using AI.');
    expect(actionText).toBe('Configure BYOK');

    (onClick as () => void)();
    expect(requestConfigureByok).toHaveBeenCalledOnce();
    subscription.unsubscribe();
  });
});
