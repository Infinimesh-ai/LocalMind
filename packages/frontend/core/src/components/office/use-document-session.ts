import type { GraphQLService } from '@affine/core/modules/cloud';
import type {
  DocxSemanticState,
  OfficeResourceOwner,
  OfficeSelectionBookmark,
} from '@affine/core/modules/office';
import {
  docxEditPatches,
  prepareDocxEditing,
} from '@affine/core/modules/office/docx-session';
import { UserFriendlyError } from '@affine/error';
import {
  type OfficeDocumentEditCommand,
  OfficeDocumentEditCommandSchema,
} from '@localmind/office';
import { nanoid } from 'nanoid';
import { useEffect, useRef, useState } from 'react';

import { executeAndReloadOfficeCommand, type OfficeRevision } from './shared';

type Snapshot = {
  state: DocxSemanticState;
  bookmark: OfficeSelectionBookmark | null;
};
export function useDocumentSession({
  remoteState,
  revision,
  artifactId,
  owner,
  graphql,
  readOnly,
  onRevision,
  onError,
  onSaved,
}: {
  remoteState: DocxSemanticState;
  revision: OfficeRevision;
  artifactId: string;
  owner: OfficeResourceOwner;
  graphql: GraphQLService;
  readOnly: boolean;
  onRevision: (revision: OfficeRevision, state: DocxSemanticState) => void;
  onError: (error: unknown) => void;
  onSaved: () => void;
}) {
  const [initial] = useState(() => prepareDocxEditing(remoteState));
  const [state, setState] = useState(initial.state);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const model = useRef({
    base: initial.state,
    draft: initial.state,
    identities: initial.identities,
    revision,
    failed: false,
    conflict: false,
    readOnly,
    composing: false,
    undo: [] as Snapshot[],
    redo: [] as Snapshot[],
    lastGroup: '',
    lastAt: 0,
    lastSaveAt: 0,
    autosavePauses: 0,
    pending: null as {
      command: OfficeDocumentEditCommand;
      snapshot: DocxSemanticState;
    } | null,
  });
  model.current.readOnly = readOnly;
  const flight = useRef<Promise<void> | null>(null);
  const callbacks = useRef({ onRevision, onError, onSaved, graphql, owner });
  callbacks.current = { onRevision, onError, onSaved, graphql, owner };
  const [restore, setRestore] = useState<OfficeSelectionBookmark | null>(null);
  const dirty = model.current.draft !== model.current.base;
  function commit(
    next: DocxSemanticState,
    bookmark: OfficeSelectionBookmark | null,
    before: OfficeSelectionBookmark | null,
    group = '',
    amendState?: DocxSemanticState
  ) {
    const m = model.current;
    if (m.readOnly || m.conflict) return;
    const now = Date.now();
    // A double click may refine the immediately preceding blank-paper click.
    // Only amend that exact snapshot; intervening edits get their own history.
    if (
      (amendState !== m.draft || !m.undo.length) &&
      (!group || group !== m.lastGroup || now - m.lastAt > 750)
    ) {
      m.undo.push({ state: m.draft, bookmark: before });
      if (m.undo.length > 100) m.undo.shift();
    }
    m.redo = [];
    m.lastAt = now;
    m.lastGroup = group;
    m.draft = next;
    setState(next);
    setRestore(bookmark);
    setVersion(v => v + 1);
  }
  function history(redo: boolean, bookmark: OfficeSelectionBookmark | null) {
    const m = model.current;
    if (m.readOnly || m.conflict) return;
    const from = redo ? m.redo : m.undo,
      to = redo ? m.undo : m.redo;
    const item = from.pop();
    if (!item) return;
    to.push({ state: m.draft, bookmark });
    m.draft = item.state;
    m.lastGroup = '';
    setState(m.draft);
    setRestore(item.bookmark);
    setVersion(v => v + 1);
  }
  function save(): Promise<void> {
    if (flight.current)
      return flight.current.then(() =>
        model.current.draft !== model.current.base ? save() : undefined
      );
    const run = async () => {
      const m = model.current;
      if (m.readOnly || m.conflict)
        throw new Error(
          m.conflict ? 'document-conflict' : 'document-read-only'
        );
      // A navigation guard must not mistake an unfinished IME composition for
      // a completed save. Autosave waits until compositionend.
      if (m.composing) throw new Error('document-composing');
      setSaving(true);
      try {
        if (!m.pending) {
          const patches = docxEditPatches(m.base, m.draft);
          if (!patches.length) {
            m.base = m.draft;
            return;
          }
          const id = nanoid();
          m.pending = {
            snapshot: m.draft,
            command: OfficeDocumentEditCommandSchema.parse({
              version: 'localmind-office-command/v1',
              source: 'user',
              operation: 'office.document.edit',
              artifactId,
              expectedRevisionId: m.revision.id,
              commandId: id,
              idempotencyKey: `office-user:${id}`,
              identities: m.identities,
              patches,
            }),
          };
        }
        const pending = m.pending;
        m.lastSaveAt = Date.now();
        const result = await executeAndReloadOfficeCommand<DocxSemanticState>({
          graphql: callbacks.current.graphql,
          owner: callbacks.current.owner,
          kind: 'document',
          command: pending.command,
        });
        m.base = pending.snapshot;
        m.identities = [];
        m.revision = result.revision;
        m.pending = null;
        m.failed = false;
        callbacks.current.onSaved();
        callbacks.current.onRevision(result.revision, result.state);
      } catch (error) {
        m.failed = true;
        if (UserFriendlyError.fromAny(error).status === 409) m.conflict = true;
        callbacks.current.onError(error);
        throw error;
      } finally {
        setSaving(false);
        setVersion(v => v + 1);
      }
    };
    const promise = run().finally(() => {
      if (flight.current === promise) flight.current = null;
    });
    flight.current = promise;
    return promise;
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const m = model.current;
    if (
      !dirty ||
      m.failed ||
      m.conflict ||
      readOnly ||
      m.composing ||
      m.autosavePauses
    )
      return;
    const timer = setTimeout(
      () => {
        if (!model.current.autosavePauses)
          void saveRef.current().catch(() => {});
      },
      Math.max(800, m.lastSaveAt + 5000 - Date.now())
    );
    return () => clearTimeout(timer);
  }, [dirty, version, readOnly]);
  useEffect(() => {
    const timer = setInterval(() => {
      const m = model.current;
      if (
        m.draft !== m.base &&
        !m.failed &&
        !m.conflict &&
        !m.readOnly &&
        !m.composing &&
        !m.autosavePauses &&
        Date.now() - m.lastSaveAt >= 5000 &&
        !flight.current
      )
        void saveRef.current().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const m = model.current;
    if (revision.id === m.revision.id) return;
    if (m.draft !== m.base || m.pending) {
      m.conflict = true;
      m.failed = true;
      callbacks.current.onError(new Error('document-conflict'));
      return;
    }
    const fresh = prepareDocxEditing(remoteState);
    m.base = fresh.state;
    m.draft = fresh.state;
    m.identities = fresh.identities;
    m.revision = revision;
    m.undo = [];
    m.redo = [];
    setState(fresh.state);
    setVersion(v => v + 1);
  }, [remoteState, revision]);
  return {
    state,
    model,
    dirty,
    saving,
    restore,
    setRestore,
    commit,
    history,
    save,
    pauseAutosave: () => {
      model.current.autosavePauses++;
      setVersion(v => v + 1);
      let paused = true;
      return {
        settled: flight.current,
        resume: () => {
          if (!paused) return;
          paused = false;
          model.current.autosavePauses--;
          setVersion(v => v + 1);
        },
      };
    },
    discard: async () => {
      if (flight.current) await flight.current.catch(() => {});
      const m = model.current;
      if (m.pending) throw new Error('document-save-uncertain');
      m.draft = m.base;
      m.undo = [];
      m.redo = [];
      setState(m.base);
      setVersion(v => v + 1);
    },
    composition: (active: boolean) => {
      model.current.composing = active;
      if (!active) setVersion(v => v + 1);
    },
  };
}
