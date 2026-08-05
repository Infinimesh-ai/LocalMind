/**
 * @vitest-environment happy-dom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { IntegrationCardContent } from './card';

describe('IntegrationCardContent', () => {
  afterEach(() => {
    cleanup();
  });

  test('keeps the full description available when visible text is clamped', () => {
    const description =
      'A deliberately long integration description that needs several lines.';

    render(<IntegrationCardContent desc={description} />);

    expect(screen.getByText(description).getAttribute('title')).toBe(
      description
    );
  });
});
