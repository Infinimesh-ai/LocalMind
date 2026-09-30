/** @vitest-environment happy-dom */
import { GraphQLError } from '@affine/error';
import { NativeFileContentSchema } from '@localmind/office';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  gql: vi.fn(),
  fetch: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('@affine/core/modules/cloud', () => ({
  GraphQLService: class {},
  FetchService: class {},
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/core/modules/workbench', () => ({ ViewService: class {} }));
vi.mock('@affine/core/modules/storage', () => ({ NbstoreService: class {} }));
vi.mock('@toeverything/infra', () => {
  const service = {
    gql: state.gql,
    fetch: state.fetch,
    workspace: { id: 'workspace', flavour: 'affine-cloud' },
  };
  return { useService: () => service, useServiceOptional: () => undefined };
});
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/component', () => ({
  Button: ({
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props} />
  ),
  Input: ({ onChange, ...props }: { onChange: (value: string) => void }) => (
    <input {...props} onChange={event => onChange(event.target.value)} />
  ),
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createPortal(<div>{children}</div>, document.body) : null,
  useConfirmModal: () => ({ openConfirmModal: state.confirm }),
}));

import {
  createWorkspaceNativeResourceMutation,
  saveWorkspaceNativeFileMutation,
  workspaceDirectoryQuery,
  workspaceNativeFileTextQuery,
  workspaceNativeResourceQuery,
  workspaceNativeRevisionsQuery,
} from '@affine/graphql';

import { blankNativeContent, NativeFileCreateDialog } from './create-dialog';
import { WorkspaceNativeFileEditor } from './workspace-file-editor';
import { WorkspaceNativeFolderSelect } from './workspace-folder-select';

const label = (key: string) => `com.affine.localmind.native-files.${key}`;
beforeEach(() => {
  vi.clearAllMocks();
  state.gql.mockReset();
});
afterEach(cleanup);

test('all seven blank formats satisfy the shared native creation contract', () => {
  for (const format of [
    'docx',
    'xlsx',
    'pptx',
    'txt',
    'md',
    'csv',
    'json',
  ] as const)
    expect(
      NativeFileContentSchema.safeParse(blankNativeContent(format)).success
    ).toBe(true);
});

test('creation retries the frozen request after an uncertain result and cancel never submits', async () => {
  const closed = vi.fn();
  const created = vi.fn();
  state.gql.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({
    createWorkspaceNativeResource: { id: 'created' },
  });
  const view = render(
    <NativeFileCreateDialog
      owner={{ workspaceId: 'workspace' }}
      onClose={closed}
      onCreated={created}
    />
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '空白文档' },
  });
  fireEvent.click(
    screen.getByText('com.affine.localmind.project-files.create')
  );
  await screen.findByRole('alert');
  expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('com.affine.error.retry'));
  await waitFor(() =>
    expect(created).toHaveBeenCalledWith('created', 'office')
  );
  expect(state.gql.mock.calls[0][0]).toEqual(state.gql.mock.calls[1][0]);
  expect(state.gql.mock.calls[0][0].query).toBe(
    createWorkspaceNativeResourceMutation
  );
  view.unmount();
  state.gql.mockClear();
  render(
    <NativeFileCreateDialog
      owner={{ workspaceId: 'workspace' }}
      onClose={closed}
      onCreated={created}
    />
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '取消' } });
  fireEvent.click(screen.getByText('Cancel'));
  expect(state.gql).not.toHaveBeenCalled();
});

test.each(['workspace', 'project'] as const)(
  '%s creation uses the form submit action and blocks empty or duplicate submissions',
  async scope => {
    const created = vi.fn();
    const closed = vi.fn();
    let resolveCreation!: (result: unknown) => void;
    state.gql.mockReturnValue(
      new Promise(resolve => {
        resolveCreation = resolve;
      })
    );
    render(
      <NativeFileCreateDialog
        owner={
          scope === 'workspace'
            ? { workspaceId: 'workspace' }
            : { projectId: 'project' }
        }
        initialFormat="txt"
        parentId="folder"
        onClose={closed}
        onCreated={created}
      />
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    const form = input.form!;
    const cancel = screen.getByText('Cancel') as HTMLButtonElement;
    const create = screen.getByText(
      'com.affine.localmind.project-files.create'
    ) as HTMLButtonElement;
    expect(cancel.type).toBe('button');
    expect(create.type).toBe('submit');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(form);
    expect(state.gql).not.toHaveBeenCalled();
    expect(create.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '  Keyboard note  ' } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.click(create);
    expect(state.gql).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
    expect(state.gql.mock.calls[0][0].variables.input).toMatchObject({
      [`${scope}Id`]: scope,
      [scope === 'workspace' ? 'folderId' : 'parentId']: 'folder',
      title: 'Keyboard note',
      content: { format: 'txt', text: '' },
    });
    resolveCreation({
      [scope === 'workspace'
        ? 'createWorkspaceNativeResource'
        : 'createProjectNativeFile']: { id: 'created' },
    });
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith('created', 'file')
    );
    expect(closed).toHaveBeenCalledTimes(1);
  }
);

test('confirming an IME candidate cannot implicitly submit the creation form', () => {
  render(
    <NativeFileCreateDialog
      owner={{ workspaceId: 'workspace' }}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />
  );
  const input = screen.getByRole('textbox');
  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(
    false
  );
  expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(false);
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
  expect(state.gql).not.toHaveBeenCalled();
});

test('an inaccessible root stays unselectable until an authorized folder is selected', async () => {
  const rights = {
    canRead: true,
    canWrite: true,
    canOrganize: true,
    canCreateFolder: true,
  };
  state.gql.mockResolvedValue({
    workspaceDirectory: {
      revision: 'directory-v1',
      authorizationRevision: 'acl-v1',
      rootRights: { ...rights, canWrite: false },
      nextCursor: null,
      items: [
        {
          id: 'allowed',
          type: 'folder',
          data: 'Allowed',
          parentId: null,
          rights,
        },
      ],
    },
  });
  const revision = vi.fn();
  function Select() {
    const [value, setValue] = useState<string | null>(null);
    return (
      <WorkspaceNativeFolderSelect
        workspaceId="workspace"
        value={value}
        onChange={setValue}
        onVersion={revision}
      />
    );
  }
  render(<Select />);
  await screen.findByRole('option', { name: 'Allowed' });
  expect(revision).toHaveBeenLastCalledWith(null);
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'allowed' },
  });
  await waitFor(() =>
    expect(revision).toHaveBeenLastCalledWith('directory-v1')
  );
  expect(state.gql.mock.calls[0][0].query).toBe(workspaceDirectoryQuery);
});

test('a conflict retains the draft and request; merging uses the newly read version on the same file', async () => {
  let reads = 0;
  let writes = 0;
  state.gql.mockImplementation(async ({ query, variables }) => {
    if (query === workspaceNativeResourceQuery)
      return {
        workspaceNativeResource: {
          title: 'note.txt',
          byteSize: 4,
          contentVersion: 1,
          canEdit: true,
        },
      };
    if (query === workspaceNativeFileTextQuery)
      return {
        workspaceNativeFileText:
          ++reads === 1
            ? { text: 'base', contentVersion: 1 }
            : { text: 'remote', contentVersion: 2 },
      };
    if (query === saveWorkspaceNativeFileMutation) {
      if (++writes < 3)
        throw new GraphQLError('conflict', {
          extensions: {
            status: 409,
            name: 'BAD_REQUEST',
            type: 'BAD_REQUEST',
            code: 'BAD_REQUEST',
            message: 'Content changed',
          },
        });
      return {
        saveWorkspaceNativeFile: {
          contentVersion: variables.input.expectedContentVersion + 1,
        },
      };
    }
    throw new Error('Unexpected operation');
  });
  const changed = vi.fn();
  const closed = vi.fn();
  render(
    <WorkspaceNativeFileEditor
      resourceId="same-id"
      title="note.txt"
      onChanged={changed}
      onClose={closed}
    />
  );
  const editor = await screen.findByRole('textbox', { name: 'note.txt' });
  fireEvent.change(editor, { target: { value: 'my draft' } });
  fireEvent.click(screen.getByText('com.affine.localmind.project-files.save'));
  await screen.findByRole('alert');
  expect((editor as HTMLTextAreaElement).value).toBe('my draft');
  fireEvent.click(screen.getByText('com.affine.error.retry'));
  await waitFor(() => expect(writes).toBe(2));
  const requests = state.gql.mock.calls.filter(
    ([call]) => call.query === saveWorkspaceNativeFileMutation
  );
  expect(requests[0][0].variables).toEqual(requests[1][0].variables);
  fireEvent.click(screen.getByText(label('compareLatest')));
  const draft = await screen.findByRole('textbox', { name: label('draft') });
  expect((draft as HTMLTextAreaElement).value).toBe('my draft');
  fireEvent.change(draft, { target: { value: 'merged draft' } });
  fireEvent.click(screen.getByText(label('useMerged')));
  fireEvent.click(screen.getByText('com.affine.localmind.project-files.save'));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const last = [...state.gql.mock.calls]
    .reverse()
    .find(([call]) => call.query === saveWorkspaceNativeFileMutation)![0]
    .variables.input;
  expect(last).toMatchObject({
    resourceId: 'same-id',
    text: 'merged draft',
    expectedContentVersion: 2,
  });
  expect(last.requestKey).not.toBe(requests[0][0].variables.input.requestKey);
  fireEvent.change(editor, { target: { value: 'unsaved' } });
  fireEvent.click(screen.getByText(label('close')));
  expect(closed).not.toHaveBeenCalled();
  expect(state.confirm).toHaveBeenCalledOnce();
  expect(state.confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      confirmText: 'com.affine.localmind.project-files.discard',
      cancelText: 'Cancel',
    })
  );
});

test('read-only content can be opened but cannot be edited or replaced', async () => {
  state.gql.mockImplementation(async ({ query }) =>
    query === workspaceNativeResourceQuery
      ? {
          workspaceNativeResource: {
            title: 'readonly.txt',
            byteSize: 4,
            contentVersion: 1,
            canEdit: false,
          },
        }
      : { workspaceNativeFileText: { text: 'read', contentVersion: 1 } }
  );
  render(
    <WorkspaceNativeFileEditor
      resourceId="readonly"
      title="readonly.txt"
      onChanged={vi.fn()}
      onClose={vi.fn()}
    />
  );
  const editor = await screen.findByRole('textbox');
  expect((editor as HTMLTextAreaElement).readOnly).toBe(true);
  expect(
    (screen.getByText(label('replace')) as HTMLButtonElement).disabled
  ).toBe(true);
});

test('a sidebar format choice keeps the destination and avoids a second format selection', async () => {
  state.gql.mockResolvedValue({
    createWorkspaceNativeResource: { id: 'text', kind: 'file' },
  });
  render(
    <NativeFileCreateDialog
      owner={{ workspaceId: 'workspace' }}
      initialFormat="md"
      parentId="chosen-folder"
      onClose={() => {}}
      onCreated={() => {}}
    />
  );
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Notes' } });
  fireEvent.click(
    screen.getByText('com.affine.localmind.project-files.create')
  );
  await waitFor(() => expect(state.gql).toHaveBeenCalled());
  expect(state.gql.mock.calls[0][0].variables.input).toMatchObject({
    folderId: 'chosen-folder',
    content: { format: 'md' },
  });
});

test.each(['txt', 'md', 'csv', 'json', 'docx', 'xlsx', 'pptx'] as const)(
  'folder portal allows %s creation despite its parent cancelling link clicks',
  async format => {
    const parent = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const created = vi.fn();
    state.gql.mockResolvedValue({
      createWorkspaceNativeResource: { id: 'new' },
    });
    render(
      <div onClick={parent}>
        <NativeFileCreateDialog
          owner={{ workspaceId: 'workspace' }}
          parentId="folder"
          initialFormat={format}
          onClose={vi.fn()}
          onCreated={created}
        />
      </div>
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Nested file' },
    });
    fireEvent.click(
      screen.getByText('com.affine.localmind.project-files.create')
    );
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(parent).not.toHaveBeenCalled();
    expect(state.gql.mock.calls[0][0].variables.input).toMatchObject({
      folderId: 'folder',
      content: { format },
    });
  }
);

test('invalid JSON remains editable and corrected content gets a new request without merging', async () => {
  const writes: { requestKey: string; text: string; resourceId: string }[] = [];
  state.gql.mockImplementation(async ({ query, variables }) => {
    if (query === workspaceNativeResourceQuery)
      return {
        workspaceNativeResource: {
          title: 'data.json',
          byteSize: 2,
          contentVersion: 1,
          canEdit: true,
        },
      };
    if (query === workspaceNativeFileTextQuery)
      return { workspaceNativeFileText: { text: '{}', contentVersion: 1 } };
    if (query === saveWorkspaceNativeFileMutation) {
      writes.push(variables.input);
      if (writes.length === 1)
        throw new GraphQLError('bad JSON', {
          extensions: {
            status: 400,
            name: 'BAD_REQUEST',
            type: 'BAD_REQUEST',
            code: 'BAD_REQUEST',
            message: 'The file must contain valid JSON',
          },
        });
      return { saveWorkspaceNativeFile: { contentVersion: 2 } };
    }
    throw new Error('Unexpected operation');
  });
  render(
    <WorkspaceNativeFileEditor
      resourceId="json"
      title="data.json"
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />
  );
  const editor = (await screen.findByRole('textbox', {
    name: 'data.json',
  })) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: '{"version":' } });
  fireEvent.click(screen.getByText('com.affine.localmind.project-files.save'));
  await screen.findByText(label('error.invalidJson'));
  expect(editor.readOnly).toBe(false);
  expect(editor.value).toBe('{"version":');
  expect(screen.queryByText(label('remoteChanged'))).toBeNull();
  expect(screen.queryByText(label('compareLatest'))).toBeNull();
  fireEvent.change(editor, { target: { value: '{"version":2}' } });
  fireEvent.click(screen.getByText('com.affine.localmind.project-files.save'));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toMatchObject({
    text: '{"version":2}',
    resourceId: 'json',
  });
  expect(writes[0].requestKey).not.toBe(writes[1].requestKey);
});

test('historical binary versions use the bounded preview and unsupported versions offer download', async () => {
  const createUrl = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValueOnce('blob:current')
    .mockReturnValueOnce('blob:history');
  const revokeUrl = vi
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => {});
  state.gql.mockImplementation(async ({ query }) => {
    if (query === workspaceNativeResourceQuery)
      return {
        workspaceNativeResource: {
          title: 'photo.png',
          byteSize: 4,
          contentVersion: 3,
          canEdit: true,
        },
      };
    if (query === workspaceNativeRevisionsQuery)
      return {
        workspaceNativeRevisions: [1, 2].map(sequence => ({
          id: `revision-${sequence}`,
          sequence,
          createdAt: '2026-09-01T00:00:00Z',
        })),
      };
    throw new Error('Unexpected operation');
  });
  state.fetch.mockImplementation(async (url: string) => {
    const mime = url.includes('sequence=2') ? 'application/pdf' : 'image/png';
    return new Response(new Blob(['bytes'], { type: mime }), {
      headers: { 'content-type': mime },
    });
  });
  try {
    render(
      <WorkspaceNativeFileEditor
        resourceId="photo"
        title="photo.png"
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText(label('history')));
    const previews = await screen.findAllByText(label('preview'));
    fireEvent.click(previews[0]);
    await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole('img', { name: 'photo.png' })).toHaveLength(2);
    fireEvent.click(previews[1]);
    expect(
      await screen.findByText(
        'com.affine.localmind.project-files.previewUnsupported'
      )
    ).toBeTruthy();
    expect(revokeUrl).toHaveBeenCalledWith('blob:history');
    expect(
      state.gql.mock.calls.some(
        ([call]) => call.query === workspaceNativeFileTextQuery
      )
    ).toBe(false);
  } finally {
    createUrl.mockRestore();
    revokeUrl.mockRestore();
  }
});
