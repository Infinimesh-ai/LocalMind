/** @vitest-environment happy-dom */
import { DECK_TEMPLATES } from '@localmind/office/report-deck';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@affine/component', () => import('./__tests__/component-mock'));
vi.mock(
  '@affine/core/modules/report-decks/i18n',
  () => import('./__tests__/i18n-mock')
);

import { TemplateGallery } from './template-gallery';

const observers: {
  callback: IntersectionObserverCallback;
  target?: Element;
}[] = [];
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      entry: (typeof observers)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('renders real covers lazily in sandboxed, non-interactive iframes', () => {
  const onUse = vi.fn();
  render(<TemplateGallery onUse={onUse} />);
  expect(screen.getAllByTestId('deck-cover')).toHaveLength(
    DECK_TEMPLATES.length
  );
  // Nothing renders until a cover scrolls into view.
  expect(document.querySelectorAll('iframe')).toHaveLength(0);
  act(() => {
    for (const observer of observers)
      observer.callback(
        [
          {
            isIntersecting: true,
            target: observer.target,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
  });
  const frames = [...document.querySelectorAll('iframe')];
  expect(frames).toHaveLength(DECK_TEMPLATES.length);
  for (const frame of frames) {
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('tabindex')).toBe('-1');
    expect(frame.getAttribute('srcdoc')).toContain('<html');
    expect(frame.getAttribute('srcdoc')).toContain(
      DECK_TEMPLATES[frames.indexOf(frame)].sample.title.slice(0, 4)
    );
  }

  fireEvent.click(
    screen.getByRole('button', {
      name: `gallery.useNamed ${JSON.stringify({ name: DECK_TEMPLATES[2].name })}`,
    })
  );
  expect(onUse).toHaveBeenCalledWith(DECK_TEMPLATES[2].key);
});

it('previews a template with its full sample deck', () => {
  const onUse = vi.fn();
  render(<TemplateGallery onUse={onUse} />);
  fireEvent.click(
    screen.getAllByRole('button', { name: /gallery\.preview$/ })[1]
  );
  const dialog = screen.getByRole('dialog');
  const frame = dialog.querySelector('iframe');
  expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame?.getAttribute('srcdoc')).toContain('data-slide');
  fireEvent.click(screen.getByRole('button', { name: 'gallery.use' }));
  expect(onUse).toHaveBeenCalledWith(DECK_TEMPLATES[1].key);
});
