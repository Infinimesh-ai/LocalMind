import { Button, Modal } from '@affine/component';
import { useI18n } from '@affine/i18n';
import { useRef, useState } from 'react';

import { type RegisterOfficeDraft, useOfficeDialogDraft } from './edit-draft';
import * as styles from './surface.css';

export type PdfRegion = {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
};

type PageSize = { widthPt: number; heightPt: number };

export function boundedPdfRegion(region: PdfRegion, page: PageSize): PdfRegion {
  const finite = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : fallback;
  const widthPt = Math.min(
    page.widthPt,
    Math.max(1, finite(region.widthPt, 1))
  );
  const heightPt = Math.min(
    page.heightPt,
    Math.max(1, finite(region.heightPt, 1))
  );
  return {
    xPt: Math.min(page.widthPt - widthPt, Math.max(0, finite(region.xPt, 0))),
    yPt: Math.min(page.heightPt - heightPt, Math.max(0, finite(region.yPt, 0))),
    widthPt,
    heightPt,
  };
}

export function PdfRegionFields({
  label,
  value,
  page,
  disabled,
  onChange,
  onPreview,
}: {
  label: string;
  value: PdfRegion;
  page: PageSize;
  disabled: boolean;
  onChange: (value: PdfRegion) => void;
  onPreview: (value: PdfRegion) => void;
}) {
  const i18n = useI18n();
  const labels = {
    xPt: i18n['com.affine.office.region-x'](),
    yPt: i18n['com.affine.office.region-y'](),
    widthPt: i18n['com.affine.office.region-width'](),
    heightPt: i18n['com.affine.office.region-height'](),
  };
  return (
    <fieldset className={styles.inspectorFieldset} disabled={disabled}>
      <legend>{label}</legend>
      <p className={styles.pdfRegionHelp}>
        {i18n['com.affine.office.region-help']()}
      </p>
      <div className={styles.inspectorGrid}>
        {(['xPt', 'yPt', 'widthPt', 'heightPt'] as const).map(key => (
          <label className={styles.fieldLabel} key={key}>
            {labels[key]}
            <input
              className={styles.field}
              type="number"
              aria-label={`${label} · ${labels[key]}`}
              min={key === 'widthPt' || key === 'heightPt' ? 1 : 0}
              max={
                key === 'xPt' || key === 'widthPt'
                  ? page.widthPt
                  : page.heightPt
              }
              step={1}
              value={value[key]}
              onFocus={() => onPreview(value)}
              onChange={event => {
                if (event.target.value === '') return;
                const number = Number(event.target.value);
                if (!Number.isFinite(number)) return;
                const next = boundedPdfRegion(
                  { ...value, [key]: number },
                  page
                );
                onChange(next);
                onPreview(next);
              }}
            />
          </label>
        ))}
      </div>
      <Button disabled={disabled} onClick={() => onPreview(value)}>
        {i18n['com.affine.office.preview-region']()}
      </Button>
    </fieldset>
  );
}

export function PdfAnnotationRegionDialog({
  initial,
  page,
  disabled,
  onPreview,
  onSubmit,
  onClose,
  registerDraft,
}: {
  initial: PdfRegion;
  page: PageSize;
  disabled: boolean;
  onPreview: (value: PdfRegion) => void;
  onSubmit: (value: PdfRegion) => Promise<boolean>;
  onClose: () => void;
  registerDraft?: RegisterOfficeDraft;
}) {
  const i18n = useI18n();
  const [value, setValue] = useState(() => boundedPdfRegion(initial, page));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const submit = async () => {
    if (disabled || inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setFailed(false);
    try {
      const saved = await onSubmit(value);
      if (saved) onClose();
      else setFailed(true);
      return saved;
    } catch {
      setFailed(true);
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const markDirty = useOfficeDialogDraft(registerDraft, submit, onClose);
  return (
    <Modal
      open
      title={i18n['com.affine.office.edit-annotation-region']()}
      width={440}
      onOpenChange={open => {
        if (!open && !inFlight.current) onClose();
      }}
    >
      <PdfRegionFields
        label={i18n['com.affine.office.annotation-region']()}
        value={value}
        page={page}
        disabled={disabled || saving}
        onChange={next => {
          setValue(next);
          markDirty();
        }}
        onPreview={onPreview}
      />
      {failed ? (
        <p role="alert">{i18n['com.affine.office.save-failed']()}</p>
      ) : null}
      <div className={styles.buttonRow}>
        <Button disabled={saving} onClick={onClose}>
          {i18n['com.affine.auth.sign-out.confirm-modal.cancel']()}
        </Button>
        <Button
          disabled={disabled || saving}
          loading={saving}
          onClick={() => void submit()}
        >
          {i18n['com.affine.office.apply-region']()}
        </Button>
      </div>
    </Modal>
  );
}
