/** @vitest-environment happy-dom */
import { Framework } from '@toeverything/infra';
import { expect, test } from 'vitest';

import { type Server, ServerScope, WorkspaceServerService } from '../cloud';
import { WorkspaceScope } from '../workspace';
import {
  configureQuickSearchModule,
  ProjectsQuickSearchSession,
  QuickSearchService,
} from './index';

test('Workspace and standalone Server shells resolve independent quick search instances', () => {
  const framework = new Framework();
  framework.service(WorkspaceServerService);
  configureQuickSearchModule(framework);
  const root = framework.provider();
  const workspace = root.createScope(
    WorkspaceScope,
    {} as WorkspaceScope['props']
  );
  const server = root.createScope(ServerScope, { server: {} as Server });
  try {
    const workspaceSearch = workspace.get(QuickSearchService).quickSearch;
    const projectSearch = server.get(QuickSearchService).quickSearch;
    expect(workspaceSearch).not.toBe(projectSearch);
    expect(() =>
      workspace.createEntity(ProjectsQuickSearchSession)
    ).not.toThrow();
    workspaceSearch.show([], () => {});
    expect(workspaceSearch.show$.value).toBe(true);
    expect(projectSearch.show$.value).toBe(false);
  } finally {
    workspace.dispose();
    server.dispose();
    root.dispose();
  }
});
