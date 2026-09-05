import type { LoaderFunction, RouteObject } from 'react-router-dom';
import { redirect } from 'react-router-dom';

export const INTELLIGENCE_ROUTE_PATH = '/intelligence';
export const TASKS_ROUTE_PATH = '/tasks';

export const legacyChatRedirectLoader: LoaderFunction = ({ request }) => {
  const url = new URL(request.url);
  return redirect(`${INTELLIGENCE_ROUTE_PATH}${url.search}${url.hash}`);
};

export const intelligenceTopLevelRoutes = [
  {
    path: INTELLIGENCE_ROUTE_PATH,
    lazy: () => import('./pages/intelligence'),
  },
  {
    path: TASKS_ROUTE_PATH,
    lazy: () => import('./pages/tasks'),
  },
  {
    path: '/chat',
    loader: legacyChatRedirectLoader,
  },
  {
    path: '/workspace/:workspaceId/chat',
    loader: legacyChatRedirectLoader,
  },
] satisfies RouteObject[];
