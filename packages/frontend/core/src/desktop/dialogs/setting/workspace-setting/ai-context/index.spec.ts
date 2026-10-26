/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import {
  buildProjectUpdateInput,
  getDirectiveConditionsInput,
  getDirectiveContentUpdate,
  getMemoryVisibilityLabelKey,
} from './index';

describe('AI context settings directive updates', () => {
  test.each([
    ['project', 'shared', 'sharedWithProject'],
    ['project', 'private', 'onlyYou'],
    ['project', 'legacy_private', 'onlyYou'],
    ['document', 'shared', 'onlyYou'],
    ['workspace', 'private', 'onlyYou'],
  ])(
    'labels %s/%s memory according to its sharing contract',
    (scope, sharingStatus, label) => {
      expect(getMemoryVisibilityLabelKey({ scope, sharingStatus })).toBe(
        `com.affine.localmind.aiContext.${label}`
      );
    }
  );
  test('updates project metadata independently of Workspace documents', () => {
    expect(
      buildProjectUpdateInput('project-1', {
        name: ' Project ',
        description: ' Description ',
      })
    ).toEqual({
      id: 'project-1',
      name: 'Project',
      description: 'Description',
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
