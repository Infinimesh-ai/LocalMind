import { describe, expect, test } from 'vitest';

import { parseProjectReportAiContext } from './report-ai-context';

const context = {
  version: 'localmind-project-report-ai-context/v1',
  projectId: 'project-1',
  reportId: 'report-1',
  revisionId: 'revision-1',
  reportVersion: 3,
  chapterIds: ['chapter-1'],
  nodeIds: ['node-1', 'node-2'],
} as const;

describe('Project report AI context', () => {
  test('parses report identity, version and scoped selection', () => {
    expect(parseProjectReportAiContext(context)).toEqual(context);
  });

  test('defaults empty selections', () => {
    const { chapterIds: _c, nodeIds: _n, ...rest } = context;
    expect(parseProjectReportAiContext(rest)).toEqual({
      ...rest,
      chapterIds: [],
      nodeIds: [],
    });
  });

  test('rejects unknown fields, wrong versions and invalid report versions', () => {
    expect(() =>
      parseProjectReportAiContext({ ...context, workspaceId: 'w' })
    ).toThrow();
    expect(() =>
      parseProjectReportAiContext({
        ...context,
        version: 'localmind-project-office-ai-context/v1',
      })
    ).toThrow();
    expect(() =>
      parseProjectReportAiContext({ ...context, reportVersion: -1 })
    ).toThrow();
    expect(() =>
      parseProjectReportAiContext({ ...context, reportId: '' })
    ).toThrow();
  });
});
