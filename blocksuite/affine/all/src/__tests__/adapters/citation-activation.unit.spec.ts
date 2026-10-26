/** @vitest-environment happy-dom */
import {
  CitationService,
  NotificationProvider,
} from '@blocksuite/affine-shared/services';
import { afterEach, expect, test, vi } from 'vitest';

import { CitationCard } from '../../../../components/src/citation/citation';

if (!customElements.get('qa-citation-card'))
  customElements.define('qa-citation-card', CitationCard);

afterEach(() => document.body.replaceChildren());

test.each(['Enter', ' '])(
  'citation %s activates exactly once and does not reach the editor',
  async key => {
    const card = document.createElement('qa-citation-card') as CitationCard;
    const activate = vi.fn();
    const editorKeymap = vi.fn();
    card.citationTitle = 'Source';
    card.onClickCallback = activate;
    card.addEventListener('keydown', editorKeymap);
    document.body.append(card);
    await card.updateComplete;
    const button =
      card.shadowRoot!.querySelector<HTMLElement>('[role="button"]')!;
    expect(button.tabIndex).toBe(0);
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    button.dispatchEvent(event);
    expect(activate).toHaveBeenCalledOnce();
    expect(editorKeymap).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  }
);

test('a source without an action does not advertise a keyboard button', async () => {
  const card = document.createElement('qa-citation-card') as CitationCard;
  document.body.append(card);
  await card.updateComplete;
  expect(card.shadowRoot!.querySelector('[role="button"]')).toBeNull();
  expect(card.shadowRoot!.querySelector('[tabindex]')).toBeNull();
});

test('a read-only source without a navigable target explains why', () => {
  const toast = vi.fn();
  const service = new CitationService({
    getOptional: (identifier: unknown) =>
      identifier === NotificationProvider ? { toast } : null,
  } as never);
  service.notifySourceUnavailable({} as never);
  expect(toast).toHaveBeenCalledWith(
    expect.stringContaining('cannot be opened directly')
  );
});
