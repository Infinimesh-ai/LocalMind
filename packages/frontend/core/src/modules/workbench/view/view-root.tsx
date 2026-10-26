import { FrameworkScope, useLiveData } from '@toeverything/infra';
import { useLayoutEffect, useMemo } from 'react';
import type { RouteObject } from 'react-router-dom';
import {
  createMemoryRouter,
  RouterProvider,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
} from 'react-router-dom';

import type { View } from '../entities/view';

export const ViewRoot = ({
  view,
  routes,
}: {
  view: View;
  routes: RouteObject[];
}) => {
  const viewRouter = useMemo(
    () =>
      createMemoryRouter(routes, { initialEntries: [view.history.location] }),
    [routes, view]
  );
  const routeContextValue = useMemo(
    () => ({ outlet: null, matches: [], isDataRoute: false }),
    []
  );

  const location = useLiveData(view.location$);

  useLayoutEffect(() => {
    const current = viewRouter.state.location;
    if (
      current.pathname === location.pathname &&
      current.search === location.search &&
      current.hash === location.hash &&
      current.state === location.state
    )
      return;
    viewRouter.navigate(location).catch(err => {
      console.error('navigate error', err);
    });
  }, [location, view, viewRouter]);

  // https://github.com/remix-run/react-router/issues/7375#issuecomment-975431736
  return (
    <FrameworkScope scope={view.scope}>
      <UNSAFE_LocationContext.Provider value={null as any}>
        <UNSAFE_RouteContext.Provider value={routeContextValue}>
          <RouterProvider router={viewRouter} />
        </UNSAFE_RouteContext.Provider>
      </UNSAFE_LocationContext.Provider>
    </FrameworkScope>
  );
};
