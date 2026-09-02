/**
 * @vitest-environment happy-dom
 */

import { describe, expect, test } from 'vitest';

import { ByokNotConfiguredError } from '../provider';
import { AIChatErrorRenderer } from './error';

describe('AIChatErrorRenderer', () => {
  test('directs users to their administrator without a credential action', () => {
    const template = AIChatErrorRenderer(
      new ByokNotConfiguredError('Contact your administrator.')
    );
    const [text, showAction] = template.values;

    expect(text).toBe('Contact your administrator.');
    expect(showAction).toBe(false);
  });
});
