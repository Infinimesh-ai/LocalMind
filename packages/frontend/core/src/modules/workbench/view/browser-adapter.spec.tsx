/** @vitest-environment happy-dom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { LiveData } from '@toeverything/infra';
import { createMemoryHistory } from 'history';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { Observable } from 'rxjs';
import { afterEach, expect, test, vi } from 'vitest';

import type { Workbench } from '../entities/workbench';
import { useBindWorkbenchToBrowserRouter } from './browser-adapter';

afterEach(cleanup);

test('the bare workspace root can open a resource and retain it in browser history', async () => {
  const history = createMemoryHistory({ initialEntries: ['/all'] });
  const view = {
    id: 'view',
    history,
    location$: LiveData.from(
      new Observable(subscriber => {
        subscriber.next(history.location);
        return history.listen(({ location }) => subscriber.next(location));
      }),
      history.location
    ),
    size$: new LiveData(100),
    scrollPositionChanged$: new LiveData(0),
    getScrollPosition: () => 0,
  };
  const workbench = {
    views$: new LiveData([view]),
    activeView$: new LiveData(view),
    activeViewIndex$: new LiveData(0),
    restoreViews: vi.fn(),
  };
  function Content() {
    useBindWorkbenchToBrowserRouter(
      workbench as unknown as Workbench,
      '/workspace/source'
    );
    const location = useLocation(),
      navigate = useNavigate();
    return (
      <>
        <output>{location.pathname}</output>
        <button onClick={() => history.push('/files/word')}>Open</button>
        <button onClick={() => navigate(-1)}>Back</button>
        <button onClick={() => navigate(1)}>Forward</button>
      </>
    );
  }
  render(
    <MemoryRouter initialEntries={['/workspace/source']}>
      <Content />
    </MemoryRouter>
  );
  await act(async () => fireEvent.click(screen.getByText('Open')));
  expect(screen.getByRole('status').textContent).toBe(
    '/workspace/source/files/word'
  );
  await act(async () => fireEvent.click(screen.getByText('Back')));
  expect(screen.getByRole('status').textContent).toBe('/workspace/source/all');
  await act(async () => fireEvent.click(screen.getByText('Forward')));
  expect(screen.getByRole('status').textContent).toBe(
    '/workspace/source/files/word'
  );
});

test('a workspace that remains mounted during switching cannot rewrite the target route or its history', async () => {
  const history = createMemoryHistory({ initialEntries: ['/source-doc'] });
  const view = {
    id: 'source-view',
    history,
    location$: LiveData.from(
      new Observable(subscriber => {
        subscriber.next(history.location);
        return history.listen(({ location }) => subscriber.next(location));
      }),
      history.location
    ),
    size$: new LiveData(100),
    scrollPositionChanged$: new LiveData(0),
    getScrollPosition: () => 0,
  };
  const workbench = {
    views$: new LiveData([view]),
    activeView$: new LiveData(view),
    activeViewIndex$: new LiveData(0),
    restoreViews: vi.fn(),
  };
  function Content() {
    useBindWorkbenchToBrowserRouter(
      workbench as unknown as Workbench,
      '/workspace/source'
    );
    const location = useLocation();
    const navigate = useNavigate();
    return (
      <>
        <output>{location.pathname}</output>
        <button onClick={() => navigate('/workspace/target/all')}>
          Switch
        </button>
        <button onClick={() => navigate(-1)}>Back</button>
        <button onClick={() => navigate(1)}>Forward</button>
      </>
    );
  }
  render(
    <MemoryRouter initialEntries={['/workspace/source/source-doc']}>
      <Content />
    </MemoryRouter>
  );
  await act(async () => fireEvent.click(screen.getByText('Switch')));
  expect(screen.getByRole('status').textContent).toBe('/workspace/target/all');
  // A late editor/scroll update from the old scope must not navigate the browser.
  await act(async () => {
    history.push('/late-source-doc');
    view.scrollPositionChanged$.next(1);
  });
  expect(screen.getByRole('status').textContent).toBe('/workspace/target/all');
  await act(async () => fireEvent.click(screen.getByText('Back')));
  expect(screen.getByRole('status').textContent).toBe(
    '/workspace/source/source-doc'
  );
  await act(async () => fireEvent.click(screen.getByText('Forward')));
  expect(screen.getByRole('status').textContent).toBe('/workspace/target/all');
});
