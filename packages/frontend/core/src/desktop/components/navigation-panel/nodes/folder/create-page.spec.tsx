// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import { of } from 'rxjs';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  complete: vi.fn(),
  error: vi.fn(),
  identity: 'actor',
}));
vi.mock('@affine/component', () => ({ notify: { error: mocks.error } }));
vi.mock('@affine/core/components/page-tree/created-resource', () => ({
  useCreatedResourceNavigation: () => () => mocks.complete,
}));
vi.mock('@affine/core/modules/doc', () => ({
  DocsService: class DocsService {},
}));
vi.mock('@affine/core/modules/editor-setting', () => ({
  EditorSettingService: class EditorSettingService {},
  resolveNewDocTitle: () => 'Title',
}));
vi.mock('@affine/core/modules/organize', () => ({
  WorkspaceFolderPageService: class WorkspaceFolderPageService {},
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', async importOriginal => {
  const { LiveData } = await importOriginal<typeof Infra>();
  return {
    useService: (token: { name: string }) => {
      if (token.name === 'WorkspaceFolderPageService')
        return {
          create: mocks.create,
          prepare: () => ({ intent: { requestKey: 'original' } }),
          get accountIdentity() {
            return mocks.identity;
          },
        };
      if (token.name === 'DocsService')
        return {
          // eslint-disable-next-line rxjs/finnish -- Mock method mirrors the DocsService API.
          allDocTitle$() {
            return of([]);
          },
        };
      return { editorSetting: { settings$: new LiveData({}) } };
    },
  };
});
import { useFolderPageCreation } from './create-page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity = 'actor';
  mocks.create.mockResolvedValue('one-page');
  mocks.complete.mockResolvedValue(undefined);
});

test('double click creates once and opens only after creation is confirmed', async () => {
  const changed = vi.fn();
  const { result } = renderHook(() => useFolderPageCreation('folder', changed));
  let resolve!: (id: string) => void;
  mocks.create.mockReturnValueOnce(
    new Promise<string>(done => {
      resolve = done;
    })
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.create('page');
    await Promise.resolve();
  });
  expect(result.current.pending).toBe(true);
  expect(mocks.complete).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.create('page');
    resolve('one-page');
    await pending;
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(mocks.complete).toHaveBeenCalledWith([
    { kind: 'doc', resourceId: 'one-page' },
  ]);
  expect(result.current.pending).toBe(false);
});

test('failure exposes a real retry action without opening a page', async () => {
  const { result } = renderHook(() => useFolderPageCreation('folder', vi.fn()));
  mocks.create.mockRejectedValueOnce(new Error('response lost'));
  await act(async () => {
    await result.current.create('page');
  });
  expect(mocks.complete).not.toHaveBeenCalled();
  await act(async () => {
    await mocks.error.mock.calls[0][0].actions[0].onClick();
  });
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.complete).toHaveBeenCalledTimes(1);
});

test('old error actions cannot create under a new account', async () => {
  const { result } = renderHook(() => useFolderPageCreation('folder', vi.fn()));
  mocks.create.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    await result.current.create('page');
  });
  mocks.identity = 'other';
  await act(async () => {
    await mocks.error.mock.calls[0][0].actions[0].onClick();
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
