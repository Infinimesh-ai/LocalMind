/** @vitest-environment happy-dom */
import { listUsersQuery } from '@affine/graphql';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Suspense, useEffect, useState } from 'react';
import useSWR, { SWRConfig, useSWRConfig } from 'swr';
import { expect, test, vi } from 'vitest';

vi.mock('./use-query', () => ({ gqlFetcher: vi.fn() }));

import { useMutateQueryResource } from './use-mutation';

test('a mutation invalidates inactive variable variants even when mount revalidation is disabled', async () => {
  const cache = new Map();
  const key = (filter: string) => ['cloud', listUsersQuery.id, { filter }];
  const fetcher = vi.fn(async (filter: string) => `fresh ${filter}`);
  function Panel({ filter }: { filter: string }) {
    const { data } = useSWR(key(filter), () => fetcher(filter), {
      suspense: true,
    });
    return <output>{data}</output>;
  }
  function Fixture() {
    const { mutate } = useSWRConfig();
    const invalidate = useMutateQueryResource();
    const [ready, setReady] = useState(false);
    const [filter, setFilter] = useState('all');
    useEffect(() => {
      void Promise.all([
        mutate(key('filtered'), 'old filtered', { revalidate: false }),
        mutate(key('all'), 'old all', { revalidate: false }),
      ])
        .then(() => setReady(true))
        .catch(console.error);
    }, [mutate]);
    return (
      <>
        {ready && (
          <Suspense fallback={<div>Loading</div>}>
            <Panel key={filter} filter={filter} />
          </Suspense>
        )}
        <button onClick={() => void invalidate(listUsersQuery)}>
          Invalidate users
        </button>
        <button onClick={() => setFilter('all')}>Open all users</button>
        <button onClick={() => setFilter('filtered')}>
          Open filtered users
        </button>
      </>
    );
  }
  render(
    <SWRConfig
      value={{
        provider: () => cache,
        revalidateOnMount: false,
        revalidateOnFocus: false,
      }}
    >
      <Fixture />
    </SWRConfig>
  );
  await screen.findByText('old all');
  await act(async () => {
    fireEvent.click(screen.getByText('Open filtered users'));
  });
  await screen.findByText('old filtered');
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText('Invalidate users'));
  });
  await screen.findByText('fresh filtered');
  await act(async () => {
    fireEvent.click(screen.getByText('Open all users'));
  });
  await screen.findByText('fresh all');
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('all'));
  expect(screen.queryByText('old all')).toBeNull();
});
