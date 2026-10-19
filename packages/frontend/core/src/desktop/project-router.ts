import type { LoaderFunction, RouteObject } from 'react-router-dom';
import { redirect } from 'react-router-dom';

import {
  getProjectPath,
  PROJECT_NEW_CONVERSATION_PATH,
  PROJECT_ROUTE_PATH,
  REPORT_DECKS_ROUTE_PATH,
} from './route-paths';

export { PROJECT_ROUTE_PATH } from './route-paths';
export const TASKS_ROUTE_PATH = '/tasks';

export const legacyProjectRedirectLoader: LoaderFunction = ({
  request,
  params,
}) => {
  const url = new URL(request.url);
  const projectId = params.projectId ?? url.searchParams.get('project');
  const resourceId = params.resourceId ?? url.searchParams.get('resource');
  url.searchParams.delete('project');
  url.searchParams.delete('resource');
  return redirect(
    `${getProjectPath(projectId, resourceId)}${url.search}${url.hash}`,
    301
  );
};

export const projectTopLevelRoutes = [
  ...[
    'reports',
    'reports/:reportId',
    'reports/:reportId/revisions/:revisionId',
    'reports/:reportId/present',
    'reports/:reportId/presenter',
    'report-templates',
    'report-schedules',
  ].map(path => ({
    path: `${PROJECT_ROUTE_PATH}/:projectId/${path}`,
    // Disabled unless `enable_legacy_project_reports`; then redirects to /reports.
    lazy: () => import('./pages/report-decks/legacy-reports-route'),
  })),
  ...[
    REPORT_DECKS_ROUTE_PATH,
    `${REPORT_DECKS_ROUTE_PATH}/new`,
    `${REPORT_DECKS_ROUTE_PATH}/:deckId`,
    `${REPORT_DECKS_ROUTE_PATH}/:deckId/present`,
  ].map(path => ({
    path,
    lazy: () => import('./pages/report-decks'),
  })),
  {
    path: '/share/decks/:shareId',
    lazy: () => import('./pages/report-decks/shared-route'),
  },
  {
    path: '/share/reports/:shareId',
    lazy: () => import('./pages/intelligence/reports/shared-route'),
  },
  {
    path: PROJECT_ROUTE_PATH,
    lazy: () => import('./pages/intelligence'),
  },
  {
    path: PROJECT_NEW_CONVERSATION_PATH,
    lazy: () => import('./pages/intelligence'),
  },
  {
    path: `${PROJECT_ROUTE_PATH}/work-orders/:workOrderId`,
    lazy: () => import('./pages/intelligence'),
  },
  {
    path: `${PROJECT_ROUTE_PATH}/:projectId/conversations/:sessionId`,
    lazy: () => import('./pages/intelligence'),
  },
  {
    path: `${PROJECT_ROUTE_PATH}/:projectId`,
    lazy: () => import('./pages/intelligence'),
  },
  {
    path: `${PROJECT_ROUTE_PATH}/:projectId/resources/:resourceId`,
    lazy: () => import('./pages/intelligence'),
  },
  {
    path: TASKS_ROUTE_PATH,
    lazy: () => import('./pages/tasks'),
  },
  ...[
    '/intelligence',
    '/chat',
    '/workspace/:workspaceId/chat',
    '/workspace/:workspaceId/intelligence',
  ].flatMap(path => [
    { path, loader: legacyProjectRedirectLoader },
    { path: `${path}/:projectId`, loader: legacyProjectRedirectLoader },
    {
      path: `${path}/:projectId/resources/:resourceId`,
      loader: legacyProjectRedirectLoader,
    },
  ]),
] satisfies RouteObject[];
