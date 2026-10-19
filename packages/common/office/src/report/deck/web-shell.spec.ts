// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, type Mock, vi } from 'vitest';

import { LEGACY_DECK_SHELL_SCRIPT } from './legacy-shell.fixture';
import { renderCustomDeckHtml } from './sanitize';
import { DECK_SHELL_SCRIPT, setDeckDisplayMode, wrapDeckHtml } from './shell';
import { upgradeDeckHtml } from './upgrade';
import { WEB_V2_SHELL_SCRIPT } from './web-v2-shell.fixture';

const content =
  '<section class="slide" data-slide aria-hidden="true"><h1>Opening</h1><details><summary>Evidence</summary><p>Long detail</p></details></section><section class="slide" data-slide><h2>Conclusion</h2><p>All facts preserved</p></section>';
let scroll: Mock<Element['scrollIntoView']>;
let dispose: (() => void)[];
beforeEach(() => {
  dispose = [];
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  scroll = vi.fn();
  if (!Element.prototype.scrollIntoView)
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: () => {},
    });
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scroll);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      return new DOMRect(0, this.id === 'chapter-2' ? 1000 : 0, 800, 1000);
    }
  );
  // The shell registers global listeners; remove them between documents.
  for (const target of [window, document]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        original(type, listener, options);
        dispose.push(() => target.removeEventListener(type, listener, options));
      }
    );
  }
});
afterEach(() => {
  dispose.forEach(fn => fn());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function boot(mode: 'read' | 'present' = 'read') {
  document.documentElement.lang = 'en';
  document.documentElement.dataset.mode = mode;
  document.body.innerHTML = wrapDeckHtml({
    title: 'Report',
    lang: 'en',
    css: '',
    slidesHtml: content,
  })
    .split('<body>')[1]
    .split('</body>')[0];
  // Execute the actual hash-authorized runtime against a DOM, never model code.
  new Function(DECK_SHELL_SCRIPT)();
}
it('reading exposes every chapter and leaves ordinary clicks and scrolling keys alone', () => {
  boot();
  expect(document.querySelectorAll('[data-slide][aria-hidden]')).toHaveLength(
    0
  );
  document
    .querySelector('h1')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const space = new KeyboardEvent('keydown', {
    key: ' ',
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(space);
  expect(space.defaultPrevented).toBe(false);
  expect(scroll).not.toHaveBeenCalled();
  document
    .querySelector('summary')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(scroll).not.toHaveBeenCalled();
});
it('chapter navigation and mode switching keep the current chapter', () => {
  boot();
  (document.getElementById('deck-next') as HTMLButtonElement).click();
  expect(scroll.mock.contexts[0]).toBe(document.getElementById('chapter-2'));
  (document.getElementById('deck-mode') as HTMLButtonElement).click();
  expect(document.documentElement.dataset.mode).toBe('present');
  expect(
    (document.getElementById('deck-chapters') as HTMLSelectElement).value
  ).toBe('1');
  expect(document.getElementById('deck-next')!.hasAttribute('disabled')).toBe(
    true
  );
  (document.getElementById('deck-mode') as HTMLButtonElement).click();
  expect(document.documentElement.dataset.mode).toBe('read');
});
it('fullscreen refusal keeps an accessible window-filling presentation', async () => {
  boot('present');
  document.documentElement.requestFullscreen = vi
    .fn()
    .mockRejectedValue(new Error('unavailable'));
  (document.getElementById('deck-fullscreen') as HTMLButtonElement).click();
  await Promise.resolve();
  expect(document.documentElement.dataset.mode).toBe('present');
  expect(document.getElementById('deck-status')!.textContent).toContain(
    'standalone browser'
  );
});
it('uses the host fullscreen state and delegates clicks without nesting fullscreen', () => {
  boot('present');
  const request = vi.fn();
  document.documentElement.requestFullscreen = request;
  const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  const receive = (source: Window | null, active: boolean) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        data: { type: 'localmind-deck-fullscreen-state', active },
      })
    );
  receive(null, true);
  expect(document.getElementById('deck-fullscreen')!.textContent).toBe(
    'Fullscreen'
  );
  receive(window, true);
  expect(document.getElementById('deck-fullscreen')!.textContent).toBe(
    'Exit fullscreen'
  );
  (document.getElementById('deck-fullscreen') as HTMLButtonElement).click();
  expect(request).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledWith(
    { type: 'localmind-deck-fullscreen-toggle' },
    '*'
  );
  receive(window, false);
  expect(document.getElementById('deck-fullscreen')!.textContent).toBe(
    'Fullscreen'
  );
});
it('host failures enter window presentation and successful state clears the notice', () => {
  boot();
  const state = (error?: string) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: { type: 'localmind-deck-fullscreen-state', active: false, error },
      })
    );
  state('unsupported');
  expect(document.documentElement.dataset.mode).toBe('present');
  expect(document.getElementById('deck-status')!.textContent).toContain(
    'standalone browser'
  );
  state();
  expect(document.getElementById('deck-status')!.textContent).toBe('');
});
it('immersive presentation hides chrome, keeps the chapter and exits with Escape from a control', () => {
  boot();
  (document.getElementById('deck-next') as HTMLButtonElement).click();
  const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  const state = (immersive: boolean) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: 'localmind-deck-fullscreen-state',
          active: immersive,
          immersive,
        },
      })
    );
  state(true);
  expect(document.documentElement.dataset.immersive).toBe('');
  expect(document.documentElement.dataset.mode).toBe('present');
  expect(document.getElementById('deck-num')!.textContent).toBe('2 / 2');
  document
    .querySelector('summary')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
  expect(document.documentElement.dataset.immersive).toBeUndefined();
  expect(document.documentElement.dataset.mode).toBe('read');
  expect(post).toHaveBeenCalledWith({ type: 'localmind-deck-exit' }, '*');
  state(false);
  expect(document.getElementById('deck-num')!.textContent).toBe('2 / 2');
});
it('only the parent can send navigation commands', () => {
  boot();
  window.dispatchEvent(
    new MessageEvent('message', {
      source: null,
      data: { type: 'localmind-deck-command', command: 'next' },
    })
  );
  expect(scroll).not.toHaveBeenCalled();
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: { type: 'localmind-deck-command', command: 'next' },
    })
  );
  expect(scroll).toHaveBeenCalledOnce();
});
it('upgrades recognized v1 reports without losing their content or design, once only', () => {
  const legacy = `<html lang="en"><head><title>Original</title><style>old shell</style><style>.slide{color:red}</style></head><body><main id="deck-stage">${content}</main><script>${LEGACY_DECK_SHELL_SCRIPT}</script></body></html>`;
  const upgraded = upgradeDeckHtml(legacy);
  expect(upgraded).toContain('data-deck-version="2"');
  expect(upgraded).toContain('data-mode="read"');
  expect(upgraded).toContain('All facts preserved');
  expect(upgraded).toContain('.slide{color:red}');
  expect(upgraded).not.toContain(LEGACY_DECK_SHELL_SCRIPT);
  expect(upgradeDeckHtml(upgraded)).toBe(upgraded);
  expect(
    upgradeDeckHtml(legacy.replace(LEGACY_DECK_SHELL_SCRIPT, 'alert(1)'))
  ).toContain('alert(1)');
  expect(setDeckDisplayMode(upgraded, 'present')).toContain(
    'data-mode="present"'
  );
});
it('custom chapters preserve safe disclosure and responsive CSS without executable model code', () => {
  const result = renderCustomDeckHtml({
    title: 'Custom',
    language: 'en',
    html: content.replace('</details>', '<script>alert(1)</script></details>'),
    css: '.slide .grid{display:grid;grid-template-columns:1fr 1fr}@media(max-width:600px){.slide .grid{grid-template-columns:1fr}}',
  });
  expect(result.html).toContain('<details><summary>Evidence</summary>');
  expect(result.html).toContain('@media(max-width:600px)');
  expect(result.html).not.toContain('alert(1)');
  expect(result.html).toContain('data-mode="read"');
});
it('updates stored first-version web reports with the fullscreen fix', () => {
  const original = wrapDeckHtml({
    title: 'Stored web report',
    lang: 'en',
    css: '.slide{color:red}',
    slidesHtml: content,
  }).replace(DECK_SHELL_SCRIPT, WEB_V2_SHELL_SCRIPT);
  const upgraded = upgradeDeckHtml(original);
  expect(upgraded).toContain(DECK_SHELL_SCRIPT);
  expect(upgraded).not.toContain(WEB_V2_SHELL_SCRIPT);
  expect(upgraded).toContain('All facts preserved');
  expect(upgraded).toContain('.slide{color:red}');
  expect(upgradeDeckHtml(upgraded)).toBe(upgraded);
});
