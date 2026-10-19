/** @vitest-environment happy-dom */
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { apiState } from './__tests__/api-mock';
import { detail, mockApi, renderAt } from './__tests__/test-utils';

vi.mock('@affine/component', () => import('./__tests__/component-mock'));
vi.mock(
  '@affine/core/modules/report-decks/i18n',
  () => import('./__tests__/i18n-mock')
);
vi.mock(
  '@affine/core/modules/report-decks/api',
  () => import('./__tests__/api-mock')
);
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof Router>()),
  useNavigate: () => navigate,
}));

import type * as Router from 'react-router-dom';

import { DeckFrame, DeckPresent, DeckViewer } from './deck-viewer';

let restoreFullscreen: (() => void)[] = [];
beforeEach(() => {
  navigate.mockReset();
  restoreFullscreen = [];
});
afterEach(() => {
  cleanup();
  apiState.api = null;
  restoreFullscreen.forEach(restore => restore());
  vi.restoreAllMocks();
});

function mockFullscreen() {
  const fullscreen = { active: null as Element | null };
  const request = vi.fn(async function (this: Element) {
    fullscreen.active = this;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  const exit = vi.fn(async () => {
    fullscreen.active = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  const override = (
    target: object,
    key: string,
    descriptor: PropertyDescriptor
  ) => {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
    restoreFullscreen.push(() => {
      if (previous) Object.defineProperty(target, key, previous);
      else Reflect.deleteProperty(target, key);
    });
  };
  override(document, 'fullscreenElement', { get: () => fullscreen.active });
  override(document, 'exitFullscreen', { value: exit });
  override(Element.prototype, 'requestFullscreen', { value: request });
  return { request, exit };
}

it('fullscreens only the report iframe and restores reading on native Escape', async () => {
  const { request, exit } = mockFullscreen();
  renderAt(
    '/report',
    '/report',
    <DeckFrame html="<p>Report</p>" title="Report" />
  );
  const frame = screen.getByTestId('deck-frame') as HTMLIFrameElement;
  const post = vi
    .spyOn(frame.contentWindow!, 'postMessage')
    .mockImplementation(() => {});
  const message = (type: string, source: Window | null = frame.contentWindow) =>
    fireEvent(window, new MessageEvent('message', { source, data: { type } }));
  message('localmind-deck-ready');
  expect(post).toHaveBeenLastCalledWith(
    {
      type: 'localmind-deck-fullscreen-state',
      active: false,
      immersive: false,
      error: undefined,
    },
    '*'
  );
  message('localmind-deck-fullscreen-toggle', null);
  expect(exit).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  message('localmind-deck-fullscreen-toggle');
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(request.mock.contexts[0]).toBe(frame);
  expect(frame.dataset.immersive).toBe('true');
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith(
      {
        type: 'localmind-deck-fullscreen-state',
        active: true,
        immersive: true,
        error: undefined,
      },
      '*'
    )
  );
  // The browser consumes Escape and emits fullscreenchange, without keydown.
  await act(() => exit());
  expect(frame.dataset.immersive).toBeUndefined();
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith(
      {
        type: 'localmind-deck-fullscreen-state',
        active: false,
        immersive: false,
        error: undefined,
      },
      '*'
    )
  );
});

it('reports a refused fullscreen request back to the frame', async () => {
  const { request } = mockFullscreen();
  request.mockRejectedValue(new Error('denied'));
  renderAt(
    '/report',
    '/report',
    <DeckFrame html="<p>Report</p>" title="Report" />
  );
  const frame = screen.getByTestId('deck-frame') as HTMLIFrameElement;
  const post = vi
    .spyOn(frame.contentWindow!, 'postMessage')
    .mockImplementation(() => {});
  fireEvent(
    window,
    new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'localmind-deck-fullscreen-toggle' },
    })
  );
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      {
        type: 'localmind-deck-fullscreen-state',
        active: false,
        immersive: true,
        error: 'failed',
      },
      '*'
    )
  );
  expect(frame.dataset.immersive).toBe('true');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(frame.dataset.immersive).toBeUndefined();
});

const view = () =>
  renderAt(
    '/reports/deck-1',
    '/reports/:deckId',
    <DeckViewer deckId="deck-1" />
  );

it('shows generation steps and cancels', async () => {
  const api = mockApi({
    get: vi.fn(async () =>
      detail({
        status: 'generating',
        progress: { phase: 'compose', done: 2, total: 5 },
      })
    ),
  });
  apiState.api = api;
  view();
  const panel = await screen.findByTestId('deck-generating');
  const steps = within(panel).getAllByRole('listitem');
  expect(steps.map(step => step.dataset.state)).toEqual([
    'done',
    'done',
    'active',
    'pending',
  ]);
  expect(steps[2].textContent).toContain('2/5');
  expect(api.fetchHtml).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: /action\.cancelGeneration/ })
  );
  await waitFor(() =>
    expect(api.command).toHaveBeenCalledWith({
      operation: 'cancel',
      deckId: 'deck-1',
    })
  );
});

it('explains failures and offers retry and reconfiguration', async () => {
  const api = mockApi({
    get: vi.fn(async () =>
      detail({ status: 'failed', errorCode: 'provider_unavailable' })
    ),
  });
  apiState.api = api;
  view();
  const panel = await screen.findByTestId('deck-failed');
  expect(panel.textContent).toContain('error.provider_unavailable');
  fireEvent.click(within(panel).getByRole('button', { name: /action\.retry/ }));
  await waitFor(() =>
    expect(api.command).toHaveBeenCalledWith({
      operation: 'retry',
      deckId: 'deck-1',
    })
  );
  fireEvent.click(
    within(panel).getByRole('button', { name: 'action.reconfigure' })
  );
  expect(navigate).toHaveBeenCalledWith('/reports/new?from=deck-1');
});

it('renders a ready deck in a sandboxed iframe with toolbar actions', async () => {
  const { request } = mockFullscreen();
  const api = mockApi({
    get: vi.fn(async () => detail()),
    fetchHtml: vi.fn(async () => '<!doctype html><p>slides</p>'),
  });
  apiState.api = api;
  view();
  const frame = (await screen.findByTestId('deck-frame')) as HTMLIFrameElement;
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('allow')).toBe('fullscreen');
  expect(frame.getAttribute('srcdoc')).toBe('<!doctype html><p>slides</p>');
  expect(api.fetchHtml).toHaveBeenCalledWith('deck-1');

  const download = screen.getByRole('link', { name: /action\.download/ });
  expect(download.getAttribute('href')).toBe(
    'https://app.local/api/report-decks/deck-1/html?download=1'
  );
  // Sources panel: excluded sources carry their reason; the AI used is shown.
  expect(screen.queryByRole('complementary')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'viewer.sources' }));
  const panel = screen.getByRole('complementary', { name: 'viewer.sources' });
  expect(panel.textContent).toContain('source.reason.no_permission');
  expect(panel.textContent).toContain('"scope":"项目A"');

  fireEvent.click(screen.getByRole('button', { name: /action\.present/ }));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(request.mock.contexts[0]).toBe(frame);
  expect(frame.dataset.immersive).toBe('true');
  expect(navigate).not.toHaveBeenCalled();
  fireEvent(
    window,
    new MessageEvent('message', {
      source: frame.contentWindow,
      data: { type: 'localmind-deck-exit' },
    })
  );
  expect(frame.dataset.immersive).toBeUndefined();

  fireEvent.click(screen.getByRole('button', { name: /action\.share/ }));
  const dialog = screen.getByRole('dialog', { name: 'share.title' });
  expect(
    within(dialog).getByTestId('share-scope-warning').textContent
  ).toContain('项目A');
  expect(
    within(dialog).getByTestId('share-scope-warning').textContent
  ).not.toContain('工作区X');
});

it('creates and revokes share links', async () => {
  const share = {
    id: 'share-1',
    url: '/share/decks/share-1#token=abc',
    hasPassword: true,
    allowDownload: true,
    expiresAt: '2099-01-01T00:00:00.000Z',
    revokedAt: null,
    createdAt: '2026-10-15T00:00:00.000Z',
  };
  const api = mockApi({
    get: vi.fn(async () => detail({ shares: [share] })),
    command: vi.fn(async input =>
      input.operation === 'share.create'
        ? { share, deck: detail({ shares: [share] }) }
        : {}
    ),
  });
  apiState.api = api;
  view();
  fireEvent.click(await screen.findByRole('button', { name: /action\.share/ }));
  const dialog = screen.getByRole('dialog', { name: 'share.title' });
  fireEvent.click(within(dialog).getByRole('button', { name: /"count":30/ }));
  fireEvent.click(within(dialog).getAllByRole('checkbox')[0]);
  const create = within(dialog).getByRole('button', { name: /share\.create$/ });
  expect(create.hasAttribute('disabled')).toBe(true);
  fireEvent.change(within(dialog).getByLabelText('share.passwordLabel'), {
    target: { value: 'secret' },
  });
  fireEvent.click(create);
  await waitFor(() =>
    expect(api.command).toHaveBeenCalledWith({
      operation: 'share.create',
      deckId: 'deck-1',
      expiresInDays: 30,
      allowDownload: false,
      password: 'secret',
    })
  );
  expect(
    ((await within(dialog).findByLabelText('share.link')) as HTMLInputElement)
      .value
  ).toBe('https://app.local/share/decks/share-1#token=abc');
  fireEvent.click(within(dialog).getByRole('button', { name: 'share.revoke' }));
  await waitFor(() =>
    expect(api.command).toHaveBeenCalledWith({
      operation: 'share.revoke',
      shareId: 'share-1',
    })
  );
});

it('presents only the deck', async () => {
  apiState.api = mockApi({
    get: vi.fn(async () => detail()),
    fetchHtml: vi.fn(
      async () =>
        '<html data-deck-version="2" data-mode="read"><body>Report</body></html>'
    ),
  });
  renderAt(
    '/reports/deck-1/present',
    '/reports/:deckId/present',
    <DeckPresent deckId="deck-1" />
  );
  const frame = await screen.findByTestId('deck-frame');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('srcdoc')).toContain('data-mode="present"');
  expect(
    screen.queryByRole('button', { name: /action\.exitPresent/ })
  ).toBeNull();
  expect(frame.dataset.immersive).toBe('true');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(navigate).toHaveBeenCalledWith('/reports/deck-1');
});

it('shows actual custom design stage without an invented overall percentage', async () => {
  apiState.api = mockApi({
    get: vi.fn(async () =>
      detail({
        status: 'generating',
        mode: 'custom',
        progress: { phase: 'render', subphase: 'reviewing', done: 1, total: 3 },
      })
    ),
  });
  view();
  const panel = await screen.findByTestId('deck-generating');
  expect(within(panel).getByRole('status').textContent).toContain(
    'viewer.subphase.reviewing'
  );
  expect(within(panel).queryByRole('progressbar')).toBeNull();
});

it('shows incomplete visual coverage beside a ready artifact', async () => {
  apiState.api = mockApi({
    get: vi.fn(async () =>
      detail({
        quality: {
          version: 'report-web-v3',
          artifactHash: 'a'.repeat(64),
          visual: 'partial',
          warnings: ['visual_partial', 'source_coverage'],
          checkedCaptures: 3,
          totalCaptures: 8,
          repairs: 1,
        },
      })
    ),
  });
  view();
  const notice = await screen.findByTestId('deck-quality');
  expect(notice.textContent).toContain('quality.visual_partial');
  expect(notice.textContent).toContain('quality.source_coverage');
  expect(await screen.findByTestId('deck-frame')).toBeTruthy();
});
