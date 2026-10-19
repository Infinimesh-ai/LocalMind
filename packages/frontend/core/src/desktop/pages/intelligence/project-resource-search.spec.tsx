/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  query: vi.fn(),
  gql: vi.fn(),
  mutate: vi.fn(),
}));
const tokens = vi.hoisted(() => ({
  search: Symbol('search'),
  resource: Symbol('resource'),
}));
vi.mock('@affine/component', () => ({
  Button: ({ children, ...props }: PropsWithChildren) => (
    <button {...props}>{children}</button>
  ),
  Loading: () => <span role="status">Loading</span>,
}));
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: state.query,
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/modules/project-resources/error', () => ({
  projectErrorMessage: () => 'Unavailable',
}));
vi.mock('@affine/graphql', () => ({
  searchProjectResourcesQuery: tokens.search,
  projectResourceQuery: tokens.resource,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', () => ({
  useService: () => ({ gql: state.gql }),
}));
vi.mock('./project-resource-icon', () => ({ ProjectResourceIcon: () => null }));

import { ProjectResourceSearch } from './project-resource-search';

const result = {
  id: 'resource-1',
  title: 'Report',
  kind: 'file',
  path: [{ title: 'Finance' }, { title: 'Report' }],
};
beforeEach(() => {
  state.query.mockReset().mockReturnValue({
    isLoading: false,
    mutate: state.mutate,
    data: {
      searchProjectResources: { items: [result], nextCursor: 'page-2' },
    },
  });
  state.gql.mockReset();
});
afterEach(cleanup);

test('search pages the selected Project and opens the stable resource ID', () => {
  const open = vi.fn();
  render(
    <ProjectResourceSearch projectId="project-1" query="Report" onOpen={open} />
  );
  expect(state.query.mock.calls.at(-1)?.[0].variables).toEqual({
    projectId: 'project-1',
    query: 'Report',
    cursor: undefined,
    limit: 50,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Report Finance' }));
  expect(open).toHaveBeenCalledWith('resource-1');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect(state.query.mock.calls.at(-1)?.[0].variables.cursor).toBe('page-2');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.documentCreation.previous',
    })
  );
  expect(state.query.mock.calls.at(-1)?.[0].variables.cursor).toBeUndefined();
});

test('selecting a search result reads its authorized metadata version and respects a busy batch', async () => {
  const toggle = vi.fn();
  const resource = { ...result, version: 7, contentVersion: 11 };
  state.gql.mockResolvedValue({ projectResource: resource });
  const props = {
    projectId: 'project-1',
    query: 'Report',
    onOpen: vi.fn(),
    selection: { ids: new Set<string>(), disabled: false, toggle },
  };
  const view = render(<ProjectResourceSearch {...props} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Report' }));
  await waitFor(() =>
    expect(toggle).toHaveBeenCalledWith('resource-1', resource)
  );
  expect(state.gql).toHaveBeenCalledWith({
    query: tokens.resource,
    variables: { projectId: 'project-1', resourceId: 'resource-1' },
  });
  view.rerender(
    <ProjectResourceSearch
      {...props}
      selection={{ ...props.selection, disabled: true }}
    />
  );
  expect(
    screen
      .getByRole('button', { name: 'Report Finance' })
      .hasAttribute('disabled')
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Report Finance' }));
  expect(state.gql).toHaveBeenCalledTimes(1);
  expect(props.onOpen).not.toHaveBeenCalled();
});

test('deselecting a stale search result needs no resource read or write', () => {
  const toggle = vi.fn();
  render(
    <ProjectResourceSearch
      projectId="project-1"
      query="Report"
      onOpen={vi.fn()}
      selection={{ ids: new Set(['resource-1']), disabled: false, toggle }}
    />
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Report' }));
  expect(toggle).toHaveBeenCalledWith('resource-1');
  expect(state.gql).not.toHaveBeenCalled();
});

test('failed search is distinct from an authorized empty result', () => {
  state.query.mockReturnValue({
    isLoading: false,
    error: new Error('Denied'),
    mutate: state.mutate,
  });
  render(
    <ProjectResourceSearch
      projectId="project-1"
      query="Report"
      onOpen={vi.fn()}
    />
  );
  expect(screen.getByRole('alert').textContent).toContain('Unavailable');
  expect(
    screen.queryByText('com.affine.localmind.workbench.fusion.fileSearchEmpty')
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(state.mutate).toHaveBeenCalledOnce();
});
