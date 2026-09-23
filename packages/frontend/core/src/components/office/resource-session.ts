import type {
  NativeOfficeState,
  OfficeCommentAnchor,
} from '@affine/core/modules/office';
import { UserFriendlyError } from '@affine/error';
import { I18n } from '@affine/i18n';
import type { OfficeSelection } from '@localmind/office';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { OfficeEditorDraft } from './edit-draft';
import {
  type OfficeResourceAdapter,
  type OfficeTaskRevisionEvidence,
  revisionBelongsTo,
  verifyOfficeTaskRevision,
} from './resource-adapter';
import {
  isOfficeSelectionAvailable,
  type OfficeArtifact,
  officeErrorMessage,
  type OfficeRevision,
} from './shared';

export type OfficeSessionStatus =
  | 'loading'
  | 'ready'
  | 'not_found'
  | 'forbidden'
  | 'load_failed';

/** One mounted session belongs to one explicit owner/artifact, never a route-derived workspace. */
export function useOfficeResourceSession(adapter: OfficeResourceAdapter) {
  const [artifact, setArtifact] = useState<OfficeArtifact | null>(null);
  const [revision, setRevision] = useState<OfficeRevision | null>(null);
  const [state, setState] = useState<NativeOfficeState | null>(null);
  const [status, setStatus] = useState<OfficeSessionStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [historical, setHistorical] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [selection, setSelection] = useState<OfficeSelection | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [commentAnchor, setCommentAnchor] =
    useState<OfficeCommentAnchor | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const drafts = useRef(new Set<OfficeEditorDraft>());
  const decision = useRef<((allowed: boolean) => void) | null>(null);
  const mounted = useRef(true);
  const version = useRef(0);
  const pending = useRef(false);
  const snapshot = useRef({ artifact, revision, historical });
  snapshot.current = { artifact, revision, historical };
  const dirty = useCallback(
    () => [...drafts.current].some(item => item.hasUnsavedChanges),
    []
  );
  const registerDraft = useCallback(
    (draft: OfficeEditorDraft) => {
      drafts.current.add(draft);
      setUnsaved(dirty());
      return () => {
        drafts.current.delete(draft);
        if (mounted.current) setUnsaved(dirty());
      };
    },
    [dirty]
  );
  const save = useCallback(async () => {
    for (const draft of drafts.current)
      if (draft.hasUnsavedChanges) await draft.save();
    setUnsaved(dirty());
  }, [dirty]);
  const discard = useCallback(async () => {
    for (const draft of drafts.current) await draft.discard();
    setUnsaved(dirty());
  }, [dirty]);
  const confirmUnsaved = useCallback(async () => {
    if (!dirty()) return true;
    if (decision.current) return false;
    setConfirmOpen(true);
    return new Promise<boolean>(resolve => {
      decision.current = resolve;
    });
  }, [dirty]);
  const decide = useCallback((allowed: boolean) => {
    decision.current?.(allowed);
    decision.current = null;
    setConfirmOpen(false);
  }, []);
  const report = useCallback(
    (caught: unknown) => {
      if (mounted.current) setError(officeErrorMessage(caught, adapter.owner));
    },
    [adapter]
  );
  const apply = useCallback(
    (next: OfficeRevision, nextState: NativeOfficeState) => {
      if (!revisionBelongsTo(adapter, next))
        throw new Error(
          I18n[
            'com.affine.office.office-task-result-targets-a-different-artifact'
          ]()
        );
      if (
        snapshot.current.revision &&
        next.sequence < snapshot.current.revision.sequence &&
        !snapshot.current.historical
      )
        return;
      version.current++;
      snapshot.current.revision = next;
      snapshot.current.historical = false;
      setRevision(next);
      setState(nextState);
      setError(null);
      setHistorical(false);
      setConflict(false);
      setCommentAnchor(null);
      setSelection(current => {
        const valid = current && isOfficeSelectionAvailable(nextState, current);
        setSelectionNotice(
          current
            ? valid
              ? I18n['com.affine.office.selection-preserved']({
                  version: String(next.sequence),
                })
              : I18n[
                  'com.affine.office.selection-cleared-because-its-stable-target-is-not-present-in-the-new-revision'
                ]()
            : null
        );
        return valid ? current : null;
      });
      setArtifact(current => {
        if (!current || next.sequence < current.currentRevision.sequence)
          return current;
        if ('projectId' in current && 'projectId' in next)
          return {
            ...current,
            revisionCounter: next.sequence,
            currentRevision: next,
          };
        if ('workspaceId' in current && 'workspaceId' in next)
          return {
            ...current,
            revisionCounter: next.sequence,
            currentRevision: next,
          };
        return current;
      });
    },
    [adapter]
  );
  const load = useCallback(
    async (next: OfficeArtifact, selected: OfficeRevision, force = false) => {
      if (!revisionBelongsTo(adapter, selected))
        throw new Error(
          I18n[
            'com.affine.office.office-task-result-targets-a-different-artifact'
          ]()
        );
      const request = ++version.current;
      const nextState = await adapter.loadState(selected, next.kind);
      if (!mounted.current || request !== version.current) return;
      // An edit can begin while a refresh is in flight. Check again after reading state.
      if (!force && dirty()) {
        setConflict(true);
        return;
      }
      snapshot.current.revision = selected;
      setRevision(selected);
      setState(nextState);
      setCommentAnchor(null);
      setError(null);
      setSelection(current =>
        current && isOfficeSelectionAvailable(nextState, current)
          ? current
          : null
      );
    },
    [adapter, dirty]
  );
  const refresh = useCallback(
    async (force = false) => {
      try {
        if (pending.current && !force) return;
        let next = await adapter.loadArtifact();
        if (!mounted.current || (pending.current && !force)) return;
        if (!next) {
          setArtifact(null);
          setState(null);
          setStatus('not_found');
          return;
        }
        if (
          next.id !== adapter.artifactId ||
          !revisionBelongsTo(adapter, next.currentRevision)
        )
          throw new Error(
            I18n[
              'com.affine.office.office-task-result-targets-a-different-artifact'
            ]()
          );
        if (
          snapshot.current.artifact &&
          next.currentRevision.sequence <
            snapshot.current.artifact.currentRevision.sequence
        )
          return;
        if (
          next.currentRevision.origin === 'ai' &&
          next.currentRevision.id !== snapshot.current.revision?.id
        ) {
          next = await verifyOfficeTaskRevision(
            adapter,
            {
              taskId: next.currentRevision.id,
              artifactId: adapter.artifactId,
              revisionId: next.currentRevision.id,
              sequence: next.currentRevision.sequence,
            },
            snapshot.current.artifact?.currentRevision.sequence
          );
          if (!mounted.current || (pending.current && !force)) return;
        }
        snapshot.current.artifact = next;
        setArtifact(next);
        setStatus('ready');
        const current = snapshot.current;
        if (
          current.historical ||
          current.revision?.id === next.currentRevision.id
        )
          return;
        if (dirty()) {
          setConflict(true);
          return;
        }
        await load(next, next.currentRevision);
      } catch (caught) {
        if (!mounted.current) return;
        const forbidden = UserFriendlyError.fromAny(caught).isStatus(403);
        if (forbidden || UserFriendlyError.fromAny(caught).isStatus(401)) {
          setState(null);
          setArtifact(null);
          setStatus('forbidden');
        } else if (!snapshot.current.artifact) setStatus('load_failed');
        report(caught);
      }
    },
    [adapter, dirty, load, report]
  );
  useEffect(() => {
    const mountedState = mounted;
    const generation = version;
    mounted.current = true;
    refresh().catch(report);
    const timer = window.setInterval(() => void refresh(), 15_000);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mountedState.current = false;
      generation.current++;
      decision.current?.(false);
      decision.current = null;
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, refresh, report]);
  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError(null);
      try {
        await action();
      } catch (caught) {
        report(caught);
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [report]
  );
  const selectRevision = useCallback(
    async (selected: OfficeRevision | null) => {
      if (!(await confirmUnsaved())) return;
      setTransitioning(true);
      try {
        const next = await adapter.loadArtifact();
        if (!next)
          throw new Error(
            I18n[
              'com.affine.office.the-latest-office-revision-is-unavailable'
            ]()
          );
        const target = selected ?? next.currentRevision;
        await load(next, target, true);
        if (!mounted.current) return;
        snapshot.current.artifact = next;
        snapshot.current.historical = target.id !== next.currentRevision.id;
        setArtifact(next);
        setHistorical(snapshot.current.historical);
        setConflict(false);
        setSelection(null);
        setSelectionNotice(null);
      } finally {
        if (mounted.current) setTransitioning(false);
      }
    },
    [adapter, confirmUnsaved, load]
  );
  const onTaskRevision = useCallback(
    async (evidence: OfficeTaskRevisionEvidence) => {
      const next = await verifyOfficeTaskRevision(
        adapter,
        evidence,
        snapshot.current.artifact?.currentRevision.sequence
      );
      if (!mounted.current) return;
      setArtifact(next);
      snapshot.current.artifact = next;
      if (snapshot.current.historical) return;
      if (dirty()) {
        setConflict(true);
        return;
      }
      await load(next, next.currentRevision);
    },
    [adapter, dirty, load]
  );
  return {
    artifact,
    revision,
    state,
    status,
    error,
    busy,
    transitioning,
    historical,
    conflict,
    selection,
    selectionNotice,
    commentAnchor,
    unsaved,
    confirmOpen,
    registerDraft,
    dirty,
    save,
    discard,
    confirmUnsaved,
    decide,
    report,
    run,
    refresh,
    selectRevision,
    onTaskRevision,
    onRevision: apply,
    setSelection,
    setCommentAnchor,
    retry: () =>
      run(async () => {
        const current = snapshot.current;
        if (current.artifact && current.revision)
          await load(current.artifact, current.revision);
        else await refresh(true);
      }),
  };
}
export type OfficeResourceSession = ReturnType<typeof useOfficeResourceSession>;
