/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type ButtonHTMLAttributes, StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  openOffice: vi.fn(),
  id: 'workspace-a',
}));
vi.mock('@affine/core/modules/cloud', () => ({ FetchService: class {} }));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class {},
}));
vi.mock('@toeverything/infra', () => {
  const fetcher = { fetch: state.fetch };
  return {
    useService: () => ({
      workspace: { id: state.id, flavour: 'affine-cloud' },
      workbench: { openOffice: state.openOffice },
    }),
    useServiceOptional: () => fetcher,
  };
});
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/component', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('./workspace-files.css', () => ({
  panel: '',
  controls: '',
  list: '',
  row: '',
  name: '',
}));

import { WorkspaceFiles } from './workspace-files';

beforeEach(() => {
  state.id = 'workspace-a';
  state.fetch.mockReset();
  state.openOffice.mockReset();
});
afterEach(cleanup);
const response = (items: object[]) => ({
  ok: true,
  json: async () => ({ items, nextCursor: null }),
});

test('shows independent files and opens native Office in the workspace editor', async () => {
  state.fetch.mockResolvedValue(
    response([
      { id: 'docx', fileName: '报告.docx', byteSize: 2048, kind: 'office' },
      { id: 'txt', fileName: '记录.txt', byteSize: 12, kind: 'file' },
    ])
  );
  render(
    <StrictMode>
      <WorkspaceFiles />
    </StrictMode>
  );
  expect(await screen.findByText('报告.docx')).toBeTruthy();
  expect(screen.getByText('记录.txt')).toBeTruthy();
  fireEvent.click(screen.getByText('com.affine.localmind.project-files.open'));
  expect(state.openOffice).toHaveBeenCalledWith('docx');
});

test('reports a failed request and retries without duplicate submissions', async () => {
  state.fetch
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(response([]));
  render(<WorkspaceFiles />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByText('com.affine.error.retry'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(
    await screen.findByText('com.affine.localmind.project-files.empty')
  ).toBeTruthy();
  expect(state.fetch).toHaveBeenCalledTimes(2);
});

test('does not show files from the previous workspace after switching', async () => {
  state.fetch
    .mockResolvedValueOnce(
      response([{ id: 'old', fileName: 'old.txt', byteSize: 1, kind: 'file' }])
    )
    .mockResolvedValueOnce(response([]));
  const view = render(<WorkspaceFiles />);
  expect(await screen.findByText('old.txt')).toBeTruthy();
  state.id = 'workspace-b';
  view.rerender(<WorkspaceFiles />);
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('old.txt')).toBeNull();
  expect(state.fetch.mock.calls[1][0]).toContain('/workspace-b/');
});
