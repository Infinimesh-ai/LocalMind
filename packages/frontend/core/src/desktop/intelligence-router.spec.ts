import { matchRoutes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  INTELLIGENCE_ROUTE_PATH,
  intelligenceTopLevelRoutes,
  legacyChatRedirectLoader,
  TASKS_ROUTE_PATH,
} from './intelligence-router';
import { WORKSPACE_ROUTE_PATH } from './route-paths';
import { workbenchRoutes } from './workbench-router';

describe('Intelligence top-level routes', () => {
  const routesUnderRoot = [
    ...intelligenceTopLevelRoutes.map(route => ({
      path: route.path,
      loader: 'loader' in route ? route.loader : undefined,
    })),
    { path: WORKSPACE_ROUTE_PATH },
  ];

  it('matches without an active workspace', () => {
    const matches = matchRoutes(
      routesUnderRoot,
      '/intelligence?project=project-1'
    );

    expect(matches?.at(-1)?.route.path).toBe(INTELLIGENCE_ROUTE_PATH);
    expect(matches?.at(-1)?.params.workspaceId).toBeUndefined();
  });

  it('matches the full global Tasks view without an active workspace', () => {
    const matches = matchRoutes(
      routesUnderRoot,
      '/tasks?filter=all&taskId=workspace-b-task'
    );

    expect(matches?.at(-1)?.route.path).toBe(TASKS_ROUTE_PATH);
    expect(matches?.at(-1)?.params.workspaceId).toBeUndefined();
  });

  it.each([
    ['/chat?project=project-1#in-progress', undefined],
    [
      '/workspace/missing-workspace/chat?project=project-1#in-progress',
      'missing-workspace',
    ],
  ])(
    'redirects legacy route %s across the top level',
    async (path, workspaceId) => {
      const matches = matchRoutes(routesUnderRoot, path);
      const matchedRoute = matches?.at(-1)?.route;
      expect(
        matchedRoute && 'loader' in matchedRoute
          ? matchedRoute.loader
          : undefined
      ).toBe(legacyChatRedirectLoader);
      expect(matches?.at(-1)?.params.workspaceId).toBe(workspaceId);

      const response = await legacyChatRedirectLoader({
        request: new Request(`https://app.local${path}`),
        params: matches?.at(-1)?.params ?? {},
        context: undefined,
      });

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get('Location')).toBe(
        '/intelligence?project=project-1#in-progress'
      );
    }
  );

  it('keeps the workspace Tasks compatibility route and removes legacy chat', () => {
    expect(workbenchRoutes.some(route => route.path === '/tasks')).toBe(true);
    expect(workbenchRoutes.some(route => route.path === '/chat')).toBe(false);
  });
});
