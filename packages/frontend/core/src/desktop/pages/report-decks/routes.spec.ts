import { matchRoutes } from 'react-router-dom';
import { expect, it } from 'vitest';

import { projectTopLevelRoutes } from '../../project-router';

const routes = projectTopLevelRoutes.map(route => ({
  path: route.path,
  source: 'lazy' in route ? String(route.lazy) : '',
}));
const match = (path: string) => matchRoutes(routes, path)?.at(-1);

it.each([
  ['/reports', '/reports', {}],
  ['/reports/new', '/reports/new', {}],
  ['/reports/deck-1', '/reports/:deckId', { deckId: 'deck-1' }],
  ['/reports/deck-1/present', '/reports/:deckId/present', { deckId: 'deck-1' }],
  ['/share/decks/share-1', '/share/decks/:shareId', { shareId: 'share-1' }],
])('matches %s at the top level', (path, routePath, params) => {
  const matched = match(path);
  expect(matched?.route.path).toBe(routePath);
  expect(matched?.params).toEqual(params);
});

it('routes legacy project report pages through the feature-flag gate', () => {
  for (const path of [
    '/project/p1/reports',
    '/project/p1/reports/r1',
    '/project/p1/report-templates',
    '/project/p1/report-schedules',
  ])
    expect(match(path)?.route.source).toContain('legacy-reports-route');
  expect(match('/share/reports/s1')?.route.source).toContain(
    'intelligence/reports/shared-route'
  );
});
