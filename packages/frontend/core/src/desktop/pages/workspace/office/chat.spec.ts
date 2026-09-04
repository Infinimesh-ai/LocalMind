/**
 * @vitest-environment happy-dom
 */
import { OfficeArtifactKind } from '@affine/graphql';
import type { OfficeSelection } from '@localmind/office';
import { describe, expect, test } from 'vitest';

import type { CopilotTask } from '../../../../modules/copilot-tasks/utils';
import {
  officeSelectionForArtifact,
  officeSelectionLabel,
  officeTaskRevisionEvidence,
  officeTaskVisualStatus,
  shouldRefreshOfficeTaskRevision,
} from './chat';

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    status: 'completed',
    approval: null,
    failureCode: null,
    failureMessage: null,
    resultEvidence: null,
    artifacts: [{ kind: 'office', id: 'artifact-1' }],
    ...overrides,
  } as unknown as CopilotTask;
}

describe('Office chat task state', () => {
  test('maps approval, rejection, conflict, and execution states distinctly', () => {
    expect(officeTaskVisualStatus(task({ status: 'waiting_approval' }))).toBe(
      'waiting'
    );
    expect(
      officeTaskVisualStatus(
        task({ status: 'cancelled', approval: { status: 'rejected' } })
      )
    ).toBe('rejected');
    expect(
      officeTaskVisualStatus(
        task({
          status: 'failed',
          failureMessage: 'Office artifact revision conflict',
        })
      )
    ).toBe('conflict');
    expect(officeTaskVisualStatus(task({ status: 'running' }))).toBe('running');
    expect(officeTaskVisualStatus(task({ status: 'completed' }))).toBe(
      'completed'
    );
  });

  test('accepts immutable Office revision evidence only for completed tasks', () => {
    const evidence = {
      sideEffectKind: 'office_revision',
      artifactId: 'artifact-1',
      revisionId: 'revision-2',
      sequence: 2,
    };
    expect(
      officeTaskRevisionEvidence(task({ resultEvidence: evidence }))
    ).toEqual({
      taskId: 'task-1',
      artifactId: 'artifact-1',
      revisionId: 'revision-2',
      sequence: 2,
    });
    expect(
      officeTaskRevisionEvidence(
        task({ status: 'running', resultEvidence: evidence })
      )
    ).toBeNull();
    expect(
      officeTaskRevisionEvidence(
        task({
          resultEvidence: { ...evidence, sideEffectKind: 'workspace_write' },
        })
      )
    ).toBeNull();
  });

  test('refreshes only a newer revision for the current artifact', () => {
    const current = { id: 'revision-1', sequence: 1 };
    const evidence = {
      taskId: 'task-1',
      artifactId: 'artifact-1',
      revisionId: 'revision-2',
      sequence: 2,
    };
    expect(
      shouldRefreshOfficeTaskRevision(evidence, 'artifact-1', current)
    ).toBe(true);
    expect(
      shouldRefreshOfficeTaskRevision(
        { ...evidence, artifactId: 'artifact-2' },
        'artifact-1',
        current
      )
    ).toBe(false);
    expect(
      shouldRefreshOfficeTaskRevision(
        { ...evidence, revisionId: 'revision-1', sequence: 1 },
        'artifact-1',
        current
      )
    ).toBe(false);
    expect(
      shouldRefreshOfficeTaskRevision(
        { ...evidence, sequence: null },
        'artifact-1',
        current
      )
    ).toBe(true);
  });
});

describe('Office chat selection labels', () => {
  test('projects stable targets for all four native resource kinds', () => {
    const selections: Array<[OfficeSelection, string]> = [
      [
        {
          kind: 'document',
          target: {
            type: 'text_range',
            start: { blockId: 'paragraph-1', offset: 1 },
            end: { blockId: 'paragraph-1', offset: 4 },
          },
        },
        'Text paragraph-1 (1-4)',
      ],
      [
        {
          kind: 'workbook',
          target: { type: 'cell_range', sheetId: 'sheet-1', range: 'A1:B2' },
        },
        'sheet-1 A1:B2',
      ],
      [
        {
          kind: 'presentation',
          target: { type: 'shape', slideId: 'slide-1', shapeId: 'shape-1' },
        },
        'slide-1 / shape-1',
      ],
      [{ kind: 'pdf', target: { type: 'page', pageIndex: 2 } }, 'Page 3'],
    ];

    for (const [selection, expected] of selections) {
      expect(officeSelectionLabel(selection)).toBe(expected);
    }
  });

  test('drops a stale selection while navigating between Office kinds', () => {
    const presentationSelection: OfficeSelection = {
      kind: 'presentation',
      target: { type: 'slide', slideId: 'slide-1' },
    };

    expect(
      officeSelectionForArtifact(
        presentationSelection,
        OfficeArtifactKind.presentation
      )
    ).toBe(presentationSelection);
    expect(
      officeSelectionForArtifact(
        presentationSelection,
        OfficeArtifactKind.workbook
      )
    ).toBeNull();
    expect(
      officeSelectionForArtifact(null, OfficeArtifactKind.workbook)
    ).toBeNull();
  });
});
