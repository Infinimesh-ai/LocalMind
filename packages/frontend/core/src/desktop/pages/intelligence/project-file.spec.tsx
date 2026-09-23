/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  create: vi.fn(() => 'blob:preview'),
  revoke: vi.fn(),
}));
vi.mock('@affine/core/modules/cloud', () => ({
  FetchService: class {},
  ServerService: class {},
}));
vi.mock('@toeverything/infra', () => {
  const service = {
    fetch: state.fetch,
    server: { serverMetadata: { baseUrl: 'http://localhost:3011' } },
  };
  return { useService: () => service };
});
vi.mock('@affine/core/modules/office', () => ({
  downloadOfficePackage: vi.fn(),
}));
vi.mock('@affine/core/modules/project-resources/error', () => ({
  projectErrorMessage: () => 'preview failed',
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/component', () => ({
  Loading: () => <span>loading</span>,
  Button: ({
    loading: _loading,
    prefix: _prefix,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    prefix?: ReactNode;
  }) => <button {...props} />,
}));

import { ProjectFile } from './project-file';

beforeEach(() => {
  vi.clearAllMocks();
  state.fetch.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(state.create);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(state.revoke);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test('uses the Project authenticated file endpoint and renders text without interpreting HTML', async () => {
  state.fetch.mockResolvedValue(
    new Response('<b>test</b>', { headers: { 'content-type': 'text/html' } })
  );
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.html" />
  );
  expect(await screen.findByText('<b>test</b>')).toBeTruthy();
  expect(state.fetch).toHaveBeenCalledWith(
    'http://localhost:3011/api/projects/project/files/file',
    expect.objectContaining({
      credentials: 'include',
      signal: expect.any(AbortSignal),
    })
  );
  expect(document.querySelector('pre b')).toBeNull();
});
test('revokes media URLs and aborts outstanding requests when the resource closes', async () => {
  state.fetch.mockResolvedValue(
    new Response('image', { headers: { 'content-type': 'image/png' } })
  );
  const view = render(
    <ProjectFile projectId="project" resourceId="file" title="test.png" />
  );
  await screen.findByRole('img', { name: 'test.png' });
  const signal = state.fetch.mock.calls[0][1].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(state.revoke).toHaveBeenCalledWith('blob:preview');
});
test('does not display a late response from the previous resource', async () => {
  let resolve!: (response: Response) => void;
  state.fetch
    .mockImplementationOnce(
      () =>
        new Promise<Response>(done => {
          resolve = done;
        })
    )
    .mockResolvedValueOnce(
      new Response('current', { headers: { 'content-type': 'text/plain' } })
    );
  const view = render(
    <ProjectFile projectId="project" resourceId="old" title="old.txt" />
  );
  view.rerender(
    <ProjectFile projectId="project" resourceId="new" title="new.txt" />
  );
  await screen.findByText('current');
  resolve(new Response('stale', { headers: { 'content-type': 'text/plain' } }));
  await waitFor(() => expect(screen.queryByText('stale')).toBeNull());
  expect(screen.getByText('current')).toBeTruthy();
});
