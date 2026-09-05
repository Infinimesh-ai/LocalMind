/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import {
  buildProjectWorkspaceUpdateInput,
  getDirectiveConditionsInput,
  getDirectiveContentUpdate,
} from './index';

describe('AI context settings directive updates', () => {
  test('replaces one workspace document subset in the project update', () => {
    expect(
      buildProjectWorkspaceUpdateInput('project-1', 'workspace-a', {
        name: ' Project ',
        description: ' Description ',
        documentIds: ['doc-1', 'doc-2', 'doc-1'],
      })
    ).toEqual({
      id: 'project-1',
      name: 'Project',
      description: 'Description',
      workspaceDocuments: {
        workspaceId: 'workspace-a',
        documents: [
          { workspaceId: 'workspace-a', docId: 'doc-1', sortOrder: 0 },
          { workspaceId: 'workspace-a', docId: 'doc-2', sortOrder: 1 },
        ],
      },
    });
  });

  test('omits unchanged content so metadata edits do not create revisions', () => {
    expect(
      getDirectiveContentUpdate(
        'Use concise answers.',
        ' Use concise answers. '
      )
    ).toEqual({});
    expect(
      getDirectiveContentUpdate(
        'Use concise answers.',
        'Use concise answers with a rationale.'
      )
    ).toEqual({ content: 'Use concise answers with a rationale.' });
  });

  test('preserves document and project conditions while editing keywords', () => {
    const directive = {
      conditions: {
        keywords: ['old'],
        docIds: ['doc-1'],
        projectIds: ['project-1'],
        match: 'all',
      },
    } as never;

    expect(getDirectiveConditionsInput(directive, 'new, shared, new')).toEqual({
      keywords: ['new', 'shared'],
      docIds: ['doc-1'],
      projectIds: ['project-1'],
      match: 'all',
    });
  });

  test('serializes editable document, project, and match conditions', () => {
    const directive = {
      conditions: {
        keywords: ['old'],
        docIds: ['doc-1'],
        projectIds: ['project-1'],
        match: 'any',
      },
    } as never;

    expect(
      getDirectiveConditionsInput(directive, {
        description: 'Only deployment requests',
        keywords: 'deploy, release, deploy',
        documentIds: ['doc-2', 'doc-2'],
        projectIds: ['project-2', 'project-2'],
        match: 'all',
      })
    ).toEqual({
      keywords: ['deploy', 'release'],
      docIds: ['doc-2'],
      projectIds: ['project-2'],
      match: 'all',
    });
  });
});
