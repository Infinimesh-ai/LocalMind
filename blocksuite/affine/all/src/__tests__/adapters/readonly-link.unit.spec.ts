/** @vitest-environment happy-dom */
import type { BlockStdScope } from '@blocksuite/std';
import { signal } from '@preact/signals-core';
import { afterEach, expect, test, vi } from 'vitest';

import { AffineLink } from '../../../../inlines/link/src/link-node/affine-link';

if (!customElements.get('qa-readonly-link'))
  customElements.define('qa-readonly-link', AffineLink);

afterEach(() => document.body.replaceChildren());

test('Enter on an AI answer link keeps native activation without reaching editing keymaps', async () => {
  const host = document.createElement('div');
  const link = document.createElement('qa-readonly-link') as AffineLink;
  link.std = {
    get: () => ({ message$: signal(null) }),
    getOptional: () => undefined,
  } as unknown as BlockStdScope;
  link.delta = {
    insert: 'Native file',
    attributes: { link: '/workspace/w/files/f' },
  };
  host.append(link);
  document.body.append(host);
  await link.updateComplete;
  const editorKeymap = vi.fn();
  host.addEventListener('keydown', editorKeymap);
  const anchor = link.querySelector('a')!;
  const enter = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  anchor.dispatchEvent(enter);
  expect(editorKeymap).not.toHaveBeenCalled();
  expect(enter.defaultPrevented).toBe(false);
  expect(anchor.getAttribute('href')).toBe('/workspace/w/files/f');
  anchor.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
  );
  expect(editorKeymap).toHaveBeenCalledOnce();
});
