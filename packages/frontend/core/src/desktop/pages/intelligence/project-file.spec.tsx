/** @vitest-environment happy-dom */
import type { ProjectEditGuard } from '@affine/core/modules/project-resources/edit-guard';
import * as fileDraft from '@affine/core/modules/project-resources/file-draft';
import { GraphQLError } from '@affine/error';
import { projectResourceQuery, saveProjectFileMutation } from '@affine/graphql';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  create: vi.fn(() => 'blob:preview'),
  revoke: vi.fn(),
  gql: vi.fn(),
  refresh: () => undefined as unknown,
  guard: null as ProjectEditGuard | null,
  accountId: 'user-1',
}));
vi.mock('@affine/core/modules/cloud', () => ({
  AuthService: class {},
  FetchService: class {},
  GraphQLService: class {},
  ServerService: class {},
}));
vi.mock('@toeverything/infra', async importOriginal => {
  const { LiveData } = await importOriginal<typeof Infra>();
  const service = {
    fetch: state.fetch,
    gql: state.gql,
    server: { serverMetadata: { baseUrl: 'http://localhost:3011' } },
    session: { account$: new LiveData(null) },
  };
  return {
    useService: () => service,
    useLiveData: () => ({ id: state.accountId }),
  };
});
vi.mock('@affine/core/modules/office', () => ({
  downloadOfficePackage: vi.fn(),
}));
vi.mock('@affine/core/modules/project-resources/edit-guard', () => ({
  useProjectEditGuard: (guard: ProjectEditGuard) => {
    state.guard = guard;
  },
}));
vi.mock('@affine/core/modules/project-resources/edit-lease', () => ({
  useProjectEditLease: () => ({ proof: { tabId: 'tab', leaseId: 'lease' } }),
}));
vi.mock('@affine/core/modules/project-resources/realtime', () => ({
  useProjectRefresh: (
    _id: string,
    _channel: string,
    refresh: () => unknown
  ) => {
    state.refresh = refresh;
  },
}));
vi.mock('@affine/core/modules/project-resources/error', () => ({
  projectErrorMessage: () => 'preview failed',
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/component', () => ({
  Loading: () => <span>loading</span>,
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
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
  state.gql.mockReset();
  state.accountId = 'user-1';
  sessionStorage.clear();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(state.create);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(state.revoke);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test('restores the same account text draft after unmount and login, without exposing it to another account', async () => {
  state.fetch.mockImplementation(() => Promise.resolve(fileResponse(1)));
  const view = render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  fireEvent.change(await screen.findByRole('textbox', { name: 'test.txt' }), {
    target: { value: 'unsaved private draft' },
  });
  view.unmount();
  state.accountId = 'user-2';
  const other = render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  expect(
    (
      (await screen.findByRole('textbox', {
        name: 'test.txt',
      })) as HTMLTextAreaElement
    ).value
  ).toBe('initial');
  other.unmount();
  state.accountId = 'user-1';
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  expect(
    (
      (await screen.findByRole('textbox', {
        name: 'test.txt',
      })) as HTMLTextAreaElement
    ).value
  ).toBe('unsaved private draft');
  expect(state.guard?.hasUnsavedChanges).toBe(true);
});

test('restored draft with a changed remote version requires comparison', async () => {
  state.fetch.mockImplementationOnce(() => Promise.resolve(fileResponse(1)));
  const view = render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  fireEvent.change(await screen.findByRole('textbox', { name: 'test.txt' }), {
    target: { value: 'local changes' },
  });
  view.unmount();
  state.fetch.mockImplementation(() =>
    Promise.resolve(fileResponse(2, 'remote changes'))
  );
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  await screen.findByText('com.affine.localmind.native-files.remoteChanged');
  expect(
    (screen.getByRole('textbox', { name: 'test.txt' }) as HTMLTextAreaElement)
      .value
  ).toBe('local changes');
});

test('retains the same save identity after an ambiguous failure and remount', async () => {
  state.fetch.mockImplementation(() => Promise.resolve(fileResponse(1)));
  state.gql
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce({ saveProjectFile: { sequence: 2 } });
  const view = render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  fireEvent.change(await screen.findByRole('textbox', { name: 'test.txt' }), {
    target: { value: 'pending draft' },
  });
  fireEvent.click(screen.getByText('com.affine.localmind.project-files.save'));
  await screen.findByText('com.affine.localmind.native-files.error.failed');
  const first = state.gql.mock.calls[0][0].variables.input;
  view.unmount();
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  const restored = (await screen.findByRole('textbox', {
    name: 'test.txt',
  })) as HTMLTextAreaElement;
  expect(restored.value).toBe('pending draft');
  expect(restored.readOnly).toBe(true);
  fireEvent.click(screen.getByText('com.affine.localmind.project-files.save'));
  await waitFor(() => expect(state.gql).toHaveBeenCalledTimes(2));
  expect(state.gql.mock.calls[1][0].variables.input).toEqual(first);
});

test('warns when local draft storage is unavailable', async () => {
  state.fetch.mockImplementation(() => Promise.resolve(fileResponse(1)));
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  const editor = await screen.findByRole('textbox', { name: 'test.txt' });
  vi.spyOn(fileDraft, 'writeProjectFileDraft').mockImplementation(() => {
    throw new Error('quota');
  });
  fireEvent.change(editor, { target: { value: 'cannot persist' } });
  expect(
    await screen.findByText(
      'com.affine.localmind.project-files.draftStorageFailed'
    )
  ).toBeTruthy();
});
test('the edit guard observes save and discard synchronously before React commits', async () => {
  state.fetch.mockImplementation(() =>
    Promise.resolve(
      new Response('initial', {
        headers: {
          'content-type': 'text/plain',
          'x-project-content-version': '1',
        },
      })
    )
  );
  state.gql.mockResolvedValue({ saveProjectFile: { sequence: 2 } });
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  const editor = await screen.findByRole('textbox', { name: 'test.txt' });
  fireEvent.change(editor, { target: { value: 'saved content' } });
  expect(state.guard?.hasUnsavedChanges).toBe(true);
  await act(async () => {
    await state.guard!.save();
    // The departure guard checks immediately after save, before a render.
    expect(state.guard!.hasUnsavedChanges).toBe(false);
  });
  fireEvent.change(await screen.findByRole('textbox', { name: 'test.txt' }), {
    target: { value: 'discarded content' },
  });
  expect(state.guard?.hasUnsavedChanges).toBe(true);
  await act(async () => {
    await state.guard!.discard();
    expect(state.guard!.hasUnsavedChanges).toBe(false);
  });
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

test('retains drafts through remote refresh and retries the identical save request after an ambiguous failure', async () => {
  state.fetch.mockImplementation(() =>
    Promise.resolve(
      new Response('initial', {
        headers: {
          'content-type': 'text/plain',
          'x-project-content-version': '1',
        },
      })
    )
  );
  let writes = 0;
  state.gql.mockImplementation(async ({ query }) => {
    if (query === projectResourceQuery)
      return { projectResource: { contentVersion: 2 } };
    if (++writes === 1) throw new Error('connection lost');
    return { saveProjectFile: { sequence: 2 } };
  });
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  const editor = await screen.findByRole('textbox', { name: 'test.txt' });
  fireEvent.change(editor, { target: { value: 'local draft' } });
  await act(async () => {
    await state.refresh();
  });
  await screen.findByText('com.affine.localmind.native-files.remoteChanged');
  expect((editor as HTMLTextAreaElement).value).toBe('local draft');
  const save = screen.getByText('com.affine.localmind.project-files.save');
  fireEvent.click(save);
  await screen.findByText('com.affine.localmind.native-files.error.failed');
  expect((editor as HTMLTextAreaElement).value).toBe('local draft');
  fireEvent.click(save);
  await waitFor(() => expect(writes).toBe(2));
  const requests = state.gql.mock.calls.filter(
    ([call]) => call.query === saveProjectFileMutation
  );
  expect(requests[0][0].variables.input).toEqual(
    requests[1][0].variables.input
  );
  expect(requests[1][0].variables.input.resourceId).toBe('file');
});

const nativeLabel = (key: string) => `com.affine.localmind.native-files.${key}`;
const projectSave = () =>
  screen.getByText('com.affine.localmind.project-files.save');
function fileResponse(version: number, text = 'initial') {
  return new Response(text, {
    headers: {
      'content-type': 'text/plain',
      'x-project-content-version': String(version),
    },
  });
}

test('unchanged polling preserves drafts without conflicts, but newer content requires comparison', async () => {
  let version = 1;
  state.fetch.mockImplementation(() => Promise.resolve(fileResponse(1)));
  state.gql.mockImplementation(async () => ({
    projectResource: { contentVersion: version },
  }));
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  const editor = (await screen.findByRole('textbox', {
    name: 'test.txt',
  })) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: 'draft' } });
  await act(async () => {
    await state.refresh();
  });
  expect(screen.queryByText(nativeLabel('remoteChanged'))).toBeNull();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(editor.value).toBe('draft');
  version = 2;
  await act(async () => {
    await state.refresh();
  });
  expect(await screen.findByText(nativeLabel('remoteChanged'))).toBeTruthy();
  expect(editor.value).toBe('draft');
});

test('own pending save and its completed revision do not produce a remote conflict', async () => {
  let version = 1;
  let resolveSave!: (result: unknown) => void;
  state.fetch.mockImplementation(() => Promise.resolve(fileResponse(version)));
  state.gql.mockImplementation(({ query }) =>
    query === projectResourceQuery
      ? Promise.resolve({ projectResource: { contentVersion: version } })
      : new Promise(resolve => {
          resolveSave = resolve;
        })
  );
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  const editor = await screen.findByRole('textbox', { name: 'test.txt' });
  fireEvent.change(editor, { target: { value: 'saved draft' } });
  fireEvent.click(projectSave());
  await act(async () => {
    await state.refresh();
  });
  expect(screen.queryByRole('alert')).toBeNull();
  version = 2;
  await act(async () => {
    resolveSave({ saveProjectFile: { sequence: 2 } });
  });
  await screen.findByText('com.affine.localmind.project-files.saved');
  await act(async () => {
    await state.refresh();
  });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a stale version probe cannot report a conflict after our save commits', async () => {
  let finishProbe!: (result: unknown) => void;
  state.fetch.mockImplementation(() => Promise.resolve(fileResponse(1)));
  state.gql.mockImplementation(({ query }) =>
    query === projectResourceQuery
      ? new Promise(resolve => {
          finishProbe = resolve;
        })
      : Promise.resolve({ saveProjectFile: { sequence: 2 } })
  );
  render(
    <ProjectFile projectId="project" resourceId="file" title="test.txt" />
  );
  const editor = await screen.findByRole('textbox', { name: 'test.txt' });
  fireEvent.change(editor, { target: { value: 'draft' } });
  let probe: unknown;
  act(() => {
    probe = state.refresh();
  });
  state.fetch.mockImplementation(() =>
    Promise.resolve(fileResponse(2, 'draft'))
  );
  fireEvent.click(projectSave());
  await screen.findByText('com.affine.localmind.project-files.saved');
  await act(async () => {
    finishProbe({ projectResource: { contentVersion: 1 } });
    await probe;
  });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('Project JSON validation failures release the request so the draft can be corrected', async () => {
  const requests: { requestKey: string; text: string }[] = [];
  state.fetch.mockImplementation(() => Promise.resolve(fileResponse(1, '{}')));
  state.gql.mockImplementation(async ({ variables }) => {
    requests.push(variables.input);
    if (requests.length === 1)
      throw new GraphQLError('invalid JSON', {
        extensions: {
          status: 400,
          name: 'BAD_REQUEST',
          type: 'BAD_REQUEST',
          code: 'BAD_REQUEST',
          message: 'The file must contain valid JSON',
        },
      });
    return { saveProjectFile: { sequence: 2 } };
  });
  render(
    <ProjectFile projectId="project" resourceId="json" title="test.json" />
  );
  const editor = (await screen.findByRole('textbox', {
    name: 'test.json',
  })) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: '{' } });
  fireEvent.click(projectSave());
  await screen.findByText(nativeLabel('error.invalidJson'));
  expect(editor.readOnly).toBe(false);
  expect(screen.queryByText(nativeLabel('compareLatest'))).toBeNull();
  fireEvent.change(editor, { target: { value: '{"fixed":true}' } });
  fireEvent.click(projectSave());
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].text).toBe('{"fixed":true}');
  expect(requests[1].requestKey).not.toBe(requests[0].requestKey);
});
