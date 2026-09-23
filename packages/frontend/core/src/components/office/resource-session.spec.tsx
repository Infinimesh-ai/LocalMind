/** @vitest-environment happy-dom */
import type {
  NativeOfficeState,
  OfficeResourceOwner,
} from '@affine/core/modules/office';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  type OfficeResourceAdapter,
  verifyOfficeTaskRevision,
} from './resource-adapter';
import { useOfficeResourceSession } from './resource-session';
import type { OfficeArtifact, OfficeRevision } from './shared';

afterEach(cleanup);
const state = {
  schemaVersion: 'localmind-office-xlsx-state/v1',
  sheets: [{ id: 'sheet', tables: [], charts: [] }],
} as unknown as NativeOfficeState;
function fixture(
  owner: OfficeResourceOwner = { kind: 'project', projectId: 'p' }
) {
  const scope =
    owner.kind === 'project'
      ? { projectId: owner.projectId }
      : { workspaceId: owner.workspaceId };
  const revision = (sequence: number, origin = 'user') =>
    ({
      ...scope,
      id: `r${sequence}`,
      artifactId: 'a',
      sequence,
      origin,
      stateUrl: `/r${sequence}/state`,
      packageUrl: `/r${sequence}/package`,
    }) as OfficeRevision;
  let artifact = {
    ...scope,
    id: 'a',
    title: 'Fixture',
    sourceFileName: 'fixture.xlsx',
    kind: 'workbook',
    revisionCounter: 1,
    currentRevision: revision(1),
  } as OfficeArtifact;
  const adapter: OfficeResourceAdapter = {
    owner,
    artifactId: 'a',
    loadArtifact: vi.fn(async () => artifact),
    loadState: vi.fn(async () => state),
    listRevisions: vi.fn(async () => [revision(1), revision(2, 'ai')]),
    compareRevisions: vi.fn(),
    download: vi.fn(),
    exportPdf: vi.fn(),
  };
  return {
    adapter,
    revision,
    advance: (sequence: number, origin = 'user') => {
      artifact = {
        ...artifact,
        revisionCounter: sequence,
        currentRevision: revision(sequence, origin),
      } as OfficeArtifact;
    },
    replace: (next: OfficeArtifact) => {
      artifact = next;
    },
  };
}

describe('Office resource sessions', () => {
  for (const owner of [
    { kind: 'workspace', workspaceId: 'w' },
    { kind: 'project', projectId: 'p' },
  ] as const) {
    test(`${owner.kind}: remote revisions preserve unsaved drafts and require a decision`, async () => {
      const f = fixture(owner);
      const { result } = renderHook(() => useOfficeResourceSession(f.adapter));
      await waitFor(() => expect(result.current.revision?.id).toBe('r1'));
      let dirty = true;
      const save = vi.fn(async () => {
        throw new Error('save failed');
      });
      act(() => {
        result.current.registerDraft({
          get hasUnsavedChanges() {
            return dirty;
          },
          save,
          discard: async () => {
            dirty = false;
          },
        });
      });
      f.advance(2);
      await act(() => result.current.refresh());
      expect(result.current.revision?.id).toBe('r1');
      expect(result.current.conflict).toBe(true);
      let changing!: Promise<void>;
      act(() => {
        changing = result.current.selectRevision(null);
      });
      expect(result.current.confirmOpen).toBe(true);
      await act(async () => {
        result.current.decide(false);
        await changing;
      });
      expect(result.current.revision?.id).toBe('r1');
      await expect(result.current.save()).rejects.toThrow('save failed');
      expect(result.current.dirty()).toBe(true);
      act(() => {
        changing = result.current.selectRevision(null);
      });
      await act(async () => {
        await result.current.discard();
        result.current.decide(true);
        await changing;
      });
      expect(result.current.revision?.id).toBe('r2');
      expect(result.current.conflict).toBe(false);
    });
  }
  test('checks for drafts created while remote state is loading', async () => {
    const f = fixture();
    const { result } = renderHook(() => useOfficeResourceSession(f.adapter));
    await waitFor(() => expect(result.current.revision?.id).toBe('r1'));
    let finish!: (value: NativeOfficeState) => void;
    vi.mocked(f.adapter.loadState).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    f.advance(2);
    let refreshing!: Promise<void>;
    act(() => {
      refreshing = result.current.refresh();
    });
    await waitFor(() => expect(finish).toBeDefined());
    act(() => {
      result.current.registerDraft({
        hasUnsavedChanges: true,
        save: vi.fn(),
        discard: vi.fn(),
      });
    });
    await act(async () => {
      finish(state);
      await refreshing;
    });
    expect(result.current.revision?.id).toBe('r1');
    expect(result.current.conflict).toBe(true);
  });
  test('history stays selected across refresh, and returning latest clears history', async () => {
    const f = fixture();
    f.advance(2);
    const { result } = renderHook(() => useOfficeResourceSession(f.adapter));
    await waitFor(() => expect(result.current.revision?.id).toBe('r2'));
    await act(() => result.current.selectRevision(f.revision(1)));
    expect(result.current.historical).toBe(true);
    f.advance(3);
    await act(() => result.current.refresh());
    expect(result.current.revision?.id).toBe('r1');
    await act(() => result.current.selectRevision(null));
    expect(result.current.revision?.id).toBe('r3');
    expect(result.current.historical).toBe(false);
  });
  test('AI refresh preserves a valid selection and removes an invalid one', async () => {
    const f = fixture();
    const { result } = renderHook(() => useOfficeResourceSession(f.adapter));
    await waitFor(() => expect(result.current.revision?.id).toBe('r1'));
    act(() =>
      result.current.setSelection({
        kind: 'workbook',
        target: { type: 'cell', sheetId: 'sheet', address: 'A1' },
      })
    );
    f.advance(2, 'ai');
    await act(() =>
      result.current.onTaskRevision({
        taskId: 'task',
        artifactId: 'a',
        revisionId: 'r2',
        sequence: 2,
      })
    );
    expect(result.current.selection?.kind).toBe('workbook');
    act(() =>
      result.current.setSelection({
        kind: 'workbook',
        target: { type: 'cell', sheetId: 'removed', address: 'A1' },
      })
    );
    f.advance(3, 'ai');
    await act(() => result.current.refresh());
    expect(result.current.selection).toBeNull();
  });
  test('an artifact without editable state becomes a retryable error', async () => {
    const f = fixture();
    vi.mocked(f.adapter.loadState).mockRejectedValue(
      new Error('No editable state')
    );
    const { result } = renderHook(() => useOfficeResourceSession(f.adapter));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.state).toBeNull();
    vi.mocked(f.adapter.loadState).mockResolvedValue(state);
    await act(() => result.current.refresh());
    expect(result.current.state).toBe(state);
  });
});

describe('durable AI revision evidence', () => {
  test('rejects wrong artifact, owner, origin, sequence and stale latest', async () => {
    const f = fixture();
    f.advance(2, 'ai');
    const evidence = {
      taskId: 't',
      artifactId: 'a',
      revisionId: 'r2',
      sequence: 2,
    };
    await expect(
      verifyOfficeTaskRevision(f.adapter, evidence)
    ).resolves.toBeTruthy();
    await expect(
      verifyOfficeTaskRevision(f.adapter, { ...evidence, artifactId: 'other' })
    ).rejects.toThrow();
    await expect(
      verifyOfficeTaskRevision(f.adapter, { ...evidence, sequence: 4 })
    ).rejects.toThrow();
    await expect(
      verifyOfficeTaskRevision(f.adapter, evidence, 3)
    ).rejects.toThrow();
    f.advance(2, 'user');
    await expect(
      verifyOfficeTaskRevision(f.adapter, evidence)
    ).rejects.toThrow();
    const alien = fixture({ kind: 'project', projectId: 'other' });
    alien.advance(2, 'ai');
    f.replace((await alien.adapter.loadArtifact())!);
    await expect(
      verifyOfficeTaskRevision(f.adapter, evidence)
    ).rejects.toThrow();
  });
});
