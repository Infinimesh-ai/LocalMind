import { LiveData } from '@toeverything/infra';
import { useEffect, useLayoutEffect, useRef } from 'react';
// oxlint-disable-next-line no-restricted-imports
import { useLocation, useNavigate } from 'react-router-dom';

import type { Workbench } from '../entities/workbench';
import {
  captureWorkbenchState,
  readBrowserWorkbenchState,
} from './browser-state';

const belongsToWorkbench = (pathname: string, basename: string) =>
  pathname === basename || pathname.startsWith(basename + '/');

/** Browser history owns the complete pane layout, including the source page. */
export function useBindWorkbenchToBrowserRouter(
  workbench: Workbench,
  basename: string
) {
  const navigate = useNavigate();
  const location = useLocation();
  const applying = useRef(false);
  const lastState = useRef('');
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const locationRef = useRef(location);
  locationRef.current = location;

  useLayoutEffect(() => {
    const pathname =
      location.pathname === basename || location.pathname === basename + '/'
        ? basename + '/all'
        : location.pathname;
    const path = pathname + location.search + location.hash;
    const saved = readBrowserWorkbenchState(location.state, basename, path);
    if (saved && JSON.stringify(saved) === lastState.current) return;
    if (!belongsToWorkbench(location.pathname, basename)) return;
    applying.current = true;
    if (saved) {
      workbench.restoreViews(saved);
    } else {
      const view = workbench.activeView$.value;
      const next = {
        pathname: pathname.slice(basename.length),
        search: location.search,
        hash: location.hash,
      };
      const current = view.history.location;
      if (
        current.pathname !== next.pathname ||
        current.search !== next.search ||
        current.hash !== next.hash
      ) {
        view.history.push(next, 'fromBrowser');
      }
    }
    const state = captureWorkbenchState(workbench, basename);
    lastState.current = JSON.stringify(state);
    applying.current = false;
    if (!saved) navigateRef.current(path, { replace: true, state });
  }, [basename, location, workbench]);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let replace = true;
    let previous = captureWorkbenchState(workbench, basename);
    const state$ = LiveData.computed(get => {
      get(workbench.activeViewIndex$);
      for (const view of get(workbench.views$)) {
        get(view.location$);
        get(view.size$);
        get(view.scrollPositionChanged$);
      }
      return captureWorkbenchState(workbench, basename);
    });
    const subscription = state$.subscribe(state => {
      if (
        applying.current ||
        !belongsToWorkbench(locationRef.current.pathname, basename)
      ) {
        previous = state;
        return;
      }
      const current = JSON.stringify(state);
      if (current === lastState.current) {
        previous = state;
        return;
      }
      // Pane activation and resizing update this entry; navigation and closing create history.
      const samePaths =
        JSON.stringify(state.views.map(v => [v.id, v.path])) ===
        JSON.stringify(previous.views.map(v => [v.id, v.path]));
      const onlyReplacements =
        state.views.length === previous.views.length &&
        state.views.every((view, index) => {
          const previousView = previous.views[index];
          if (previousView.id !== view.id) return false;
          return (
            JSON.stringify(previousView.path) === JSON.stringify(view.path) ||
            workbench.views$.value.find(item => item.id === view.id)?.history
              .action === 'REPLACE'
          );
        });
      replace = replace && (samePaths || onlyReplacements);
      previous = state;
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        if (
          disposed ||
          applying.current ||
          !belongsToWorkbench(locationRef.current.pathname, basename)
        ) {
          replace = true;
          return;
        }
        const latest = captureWorkbenchState(workbench, basename);
        const serialized = JSON.stringify(latest);
        if (serialized !== lastState.current) {
          lastState.current = serialized;
          const active = latest.views[latest.activeViewIndex].path;
          navigateRef.current(
            { ...active, pathname: basename + active.pathname },
            { state: latest, replace }
          );
        }
        replace = true;
      });
    });
    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [basename, workbench]);
}
