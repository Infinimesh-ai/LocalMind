/**
 * @vitest-environment happy-dom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../../fetch-utils', () => ({ affineFetch: mocks.fetch }));
vi.mock('../common', () => ({
  useCurrentUser: () => null,
  useRevalidateCurrentUser: () => vi.fn(),
  isAdmin: () => false,
}));
vi.mock('sonner', () => ({
  toast: { error: mocks.error, success: vi.fn() },
}));

import { Auth } from './index';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('translates the sign-in error code instead of displaying the server message', async () => {
  mocks.fetch.mockResolvedValue({
    ok: false,
    json: async () => ({
      status: 401,
      name: 'WRONG_SIGN_IN_CREDENTIALS',
      type: 'WRONG_SIGN_IN_CREDENTIALS',
      code: 'WRONG_SIGN_IN_CREDENTIALS',
      data: { email: 'qa@example.test' },
      message: 'Raw server message',
    }),
  });
  render(<Auth />);
  const email = screen.getByLabelText('Email');
  fireEvent.change(email, { target: { value: 'qa@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'existing-password' },
  });
  fireEvent.submit(email.closest('form')!);
  await waitFor(() => {
    expect(mocks.error).toHaveBeenCalledWith(
      'Failed to login: Wrong user email or password: qa@example.test'
    );
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
