import { Button, Modal } from '@affine/component';
import type { DocxSemanticState } from '@affine/core/modules/office';
import { useI18n } from '@affine/i18n';
import { useCallback, useRef, useState } from 'react';

import * as styles from './document.css';
import { type RegisterOfficeDraft, useOfficeDialogDraft } from './edit-draft';
import * as surfaceStyles from './surface.css';

export function DocumentMailMerge({
  fields,
  readOnly,
  saving,
  onSubmit,
  onClose,
  registerDraft,
}: {
  fields: DocxSemanticState['references']['mailMergeFields'];
  readOnly: boolean;
  saving: boolean;
  onSubmit: (values: Record<string, string>) => Promise<boolean>;
  onClose: () => void;
  registerDraft?: RegisterOfficeDraft;
}) {
  const i18n = useI18n();
  const names = [...new Set(fields.map(field => field.argument ?? ''))];
  const unsupported =
    !names.length ||
    names.length > 100 ||
    fields.some(field => field.mailMergeSupported !== true) ||
    names.some(name => !name || name.length > 256);
  const [values, setValues] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const busy = saving || submitting;
  const submit = useCallback(async () => {
    if (readOnly || saving || unsupported || inFlight.current) return false;
    if (!Object.keys(values).length) return false;
    inFlight.current = true;
    setSubmitting(true);
    setFailed(false);
    try {
      const applied = await onSubmit(values);
      if (applied) onClose();
      else setFailed(true);
      return applied;
    } catch {
      setFailed(true);
      return false;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [onClose, onSubmit, readOnly, saving, unsupported, values]);
  const markDirty = useOfficeDialogDraft(registerDraft, submit, onClose);

  return (
    <Modal
      open
      title={i18n['com.affine.office.mail-merge']()}
      width={520}
      onOpenChange={open => {
        if (!open && !inFlight.current && !saving) onClose();
      }}
    >
      <div className={styles.dialogForm}>
        <p>{i18n['com.affine.office.mail-merge-help']()}</p>
        {unsupported ? (
          <p role="status">
            {i18n['com.affine.office.mail-merge-unsupported']()}
          </p>
        ) : (
          names.map(name => (
            <label key={name} className={styles.dialogField}>
              <span>{name}</span>
              <input
                className={surfaceStyles.field}
                value={Object.hasOwn(values, name) ? values[name] : ''}
                maxLength={64 * 1024}
                disabled={readOnly || busy}
                onChange={event => {
                  setValues(previous => ({
                    ...previous,
                    [name]: event.target.value,
                  }));
                  markDirty();
                }}
              />
            </label>
          ))
        )}
        {failed ? (
          <p role="alert" className={styles.dialogError}>
            {i18n[
              'com.affine.office.office-dialog-changes-could-not-be-saved'
            ]()}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <Button disabled={busy} onClick={onClose}>
            {i18n['com.affine.localmind.aiContext.cancel']()}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={
              readOnly || busy || unsupported || !Object.keys(values).length
            }
            onClick={() => void submit()}
          >
            {i18n['com.affine.office.mail-merge-apply']()}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
