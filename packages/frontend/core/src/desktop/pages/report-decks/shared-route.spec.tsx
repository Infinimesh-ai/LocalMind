/** @vitest-environment happy-dom */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { fetchSharedDeckHtml, openDeckShare } from './__tests__/api-mock';
import { renderAt } from './__tests__/test-utils';

vi.mock('@affine/component', () => import('./__tests__/component-mock'));
vi.mock(
  '@affine/core/modules/report-decks/i18n',
  () => import('./__tests__/i18n-mock')
);
vi.mock(
  '@affine/core/modules/report-decks/api',
  () => import('./__tests__/api-mock')
);
vi.mock('@affine/core/modules/cloud', () => ({
  DefaultServerService: class {},
  ServerService: class {},
}));

import { SharedDeck } from './shared-route';

const BASE = 'https://app.local';
const open = (hash = '#token=tok') => {
  window.history.replaceState(null, '', `/share/decks/share-1${hash}`);
  return renderAt(
    '/share/decks/share-1',
    '/share/decks/:shareId',
    <SharedDeck baseUrl={BASE} />
  );
};

beforeEach(() => {
  openDeckShare.mockReset();
  fetchSharedDeckHtml.mockReset();
});
afterEach(cleanup);

it('asks for the password, rejects a wrong one and then shows the deck', async () => {
  openDeckShare
    .mockResolvedValueOnce({ status: 'password_required' })
    .mockResolvedValueOnce({ status: 'invalid_password' })
    .mockResolvedValueOnce({
      status: 'ok',
      title: '季度汇报',
      allowDownload: true,
      slideCount: 10,
    });
  fetchSharedDeckHtml.mockResolvedValue('<!doctype html><p>deck</p>');
  open();
  expect(await screen.findByText('shared.passwordTitle')).toBeTruthy();
  expect(openDeckShare).toHaveBeenLastCalledWith(BASE, 'share-1', {
    token: 'tok',
    password: undefined,
  });

  const input = screen.getByLabelText('share.passwordLabel');
  fireEvent.change(input, { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'shared.open' }));
  expect(await screen.findByText('shared.invalidPassword')).toBeTruthy();

  fireEvent.change(screen.getByLabelText('share.passwordLabel'), {
    target: { value: 'right' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'shared.open' }));
  const frame = await screen.findByTestId('deck-frame');
  expect(openDeckShare).toHaveBeenLastCalledWith(BASE, 'share-1', {
    token: 'tok',
    password: 'right',
  });
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('srcdoc')).toBe('<!doctype html><p>deck</p>');
  expect(screen.getByText('季度汇报')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: /action\.download/ }).getAttribute('href')
  ).toBe(`${BASE}/api/deck-shares/share-1/html?download=1`);
});

it.each(['expired', 'revoked', 'invalid_token'] as const)(
  'shows the %s state',
  async status => {
    openDeckShare.mockResolvedValue({ status });
    open();
    expect(await screen.findByText(`shared.${status}.title`)).toBeTruthy();
    expect(fetchSharedDeckHtml).not.toHaveBeenCalled();
  }
);

it('treats a link without a token as invalid and hides download when not allowed', async () => {
  open('');
  expect(await screen.findByText('shared.invalid_token.title')).toBeTruthy();
  expect(openDeckShare).not.toHaveBeenCalled();
  cleanup();

  openDeckShare.mockResolvedValue({
    status: 'ok',
    title: 'T',
    allowDownload: false,
    slideCount: 6,
  });
  fetchSharedDeckHtml.mockResolvedValue('<p>x</p>');
  open();
  await screen.findByTestId('deck-frame');
  await waitFor(() => expect(screen.queryByRole('link')).toBeNull());
});
