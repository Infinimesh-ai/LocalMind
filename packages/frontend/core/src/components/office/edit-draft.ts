import { notify } from '@affine/component';
import { UserFriendlyError } from '@affine/error';
import { useI18n } from '@affine/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useOfficeSelectionChange(confirm?: () => Promise<boolean>) {
  const t = useI18n();
  return useCallback(
    (change: () => void) => {
      if (!confirm) {
        change();
        return;
      }
      void confirm()
        .then(allowed => {
          if (allowed) change();
        })
        .catch(caught => {
          const error = UserFriendlyError.fromAny(caught);
          notify.error({
            title:
              t[
                error.isStatus(409)
                  ? 'com.affine.localmind.project-files.conflict'
                  : 'com.affine.localmind.project-files.operationFailed'
              ](),
          });
        });
    },
    [confirm, t]
  );
}

export type OfficeEditorDraft = {
  readonly hasUnsavedChanges: boolean;
  save: () => Promise<void>;
  discard: () => Promise<void>;
  pauseAutosave?: () => {
    settled: Promise<void> | null;
    resume: () => void;
  };
};

export type RegisterOfficeDraft = (draft: OfficeEditorDraft) => () => void;

export function useOfficeEditorDraft(
  register: RegisterOfficeDraft | undefined,
  draft: OfficeEditorDraft
) {
  const latest = useRef(draft);
  latest.current = draft;
  const dirty = draft.hasUnsavedChanges;
  const pausable = !!draft.pauseAutosave;
  useEffect(
    () =>
      register?.({
        get hasUnsavedChanges() {
          return latest.current.hasUnsavedChanges;
        },
        save: () => latest.current.save(),
        discard: () => latest.current.discard(),
        pauseAutosave: pausable
          ? () =>
              latest.current.pauseAutosave?.() ?? {
                settled: null,
                resume: () => {},
              }
          : undefined,
      }),
    [register, dirty, pausable]
  );
}

export function useOfficeDialogDraft(
  register: RegisterOfficeDraft | undefined,
  save: () => Promise<boolean>,
  close: () => void
) {
  const i18n = useI18n();
  const dirty = useRef(false);
  const [, setVersion] = useState(0);
  useOfficeEditorDraft(register, {
    get hasUnsavedChanges() {
      return dirty.current;
    },
    save: async () => {
      if (!(await save()))
        throw new Error(
          i18n['com.affine.office.office-dialog-changes-could-not-be-saved']()
        );
      dirty.current = false;
    },
    discard: async () => {
      dirty.current = false;
      close();
    },
  });
  return () => {
    dirty.current = true;
    setVersion(value => value + 1);
  };
}
