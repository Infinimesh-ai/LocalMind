/** @vitest-environment happy-dom */
import { renderHook } from '@testing-library/react';
import { LiveData } from '@toeverything/infra';
import { act } from 'react';
import { expect, test, vi } from 'vitest';

import { PublicUserService } from '../services/public-user';

const users$ = new LiveData<
  Record<
    string,
    { id: string; name?: string; avatarUrl?: string | null; removed?: boolean }
  >
>({});
const revalidate = vi.fn();
const service = {
  revalidate,
  // eslint-disable-next-line rxjs/finnish -- mirrors PublicUserService
  publicUser$: (id: string) => users$.selector(map => map[id] ?? null),
};

vi.mock('@affine/core/components/providers/current-server-scope', () => ({
  useCurrentServerService: () => ({
    scope: {
      get: (identifier: unknown) =>
        identifier === PublicUserService ? service : undefined,
    },
  }),
}));

import { useCurrentPublicIdentity } from './public-user';

test('stored identity is shown until the current profile loads, then follows renames', () => {
  const stored = { id: 'peer', name: 'Stored name', avatarUrl: 'stored.png' };
  const { result } = renderHook(() => useCurrentPublicIdentity('peer', stored));
  expect(revalidate).toHaveBeenCalledWith('peer');
  expect(result.current).toEqual(stored);

  act(() =>
    users$.next({ peer: { id: 'peer', name: 'Current name', avatarUrl: null } })
  );
  expect(result.current).toEqual({
    id: 'peer',
    name: 'Current name',
    avatarUrl: null,
  });

  act(() => users$.next({ peer: { id: 'peer', removed: true } }));
  expect(result.current).toEqual(stored);
});

test('records without an author id keep their stored identity', () => {
  revalidate.mockClear();
  const stored = { name: 'Legacy', avatarUrl: null };
  const { result } = renderHook(() => useCurrentPublicIdentity('', stored));
  expect(revalidate).not.toHaveBeenCalled();
  expect(result.current).toBe(stored);
});
