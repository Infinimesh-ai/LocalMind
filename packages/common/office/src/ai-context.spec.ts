import { describe, expect, test } from 'vitest';

import { parseOfficeAiContext } from './ai-context';

const context = {
  version: 'localmind-office-ai-context/v1',
  workspaceId: 'workspace-1',
  artifactId: 'artifact-1',
  artifactKind: 'document',
  revisionId: 'revision-1',
  selection: {
    kind: 'document',
    target: {
      type: 'text_range',
      start: { blockId: 'paragraph-1', offset: 0 },
      end: { blockId: 'paragraph-1', offset: 4 },
    },
  },
} as const;

describe('Office AI context', () => {
  test('parses immutable artifact, revision, and stable selection identity', () => {
    expect(parseOfficeAiContext(context)).toEqual(context);
  });

  test('rejects unknown fields and selection kinds that do not match the artifact', () => {
    expect(() =>
      parseOfficeAiContext({ ...context, unknown: 'must-not-be-dropped' })
    ).toThrow();
    expect(() =>
      parseOfficeAiContext({
        ...context,
        selection: {
          kind: 'pdf',
          target: { type: 'page', pageIndex: 0 },
        },
      })
    ).toThrow(/selection kind must match artifact kind/i);
    expect(() =>
      parseOfficeAiContext({
        ...context,
        selection: {
          ...context.selection,
          target: { type: 'current_selection' },
        },
      })
    ).toThrow();
  });
});
