import { useI18n } from '@affine/i18n';
import type { ImportWarning } from '@blocksuite/affine/widgets/linked-doc';

export function ImportWarningMessage({ warning }: { warning: ImportWarning }) {
  const t = useI18n();
  if (warning.code === 'pdf-pages-ocr-converted')
    return (
      <>
        {t['com.affine.import.pdf.ocr-pages-converted']({
          pages: warning.message,
        })}
      </>
    );
  if (warning.code === 'pdf-pages-ocr-failed')
    return (
      <>
        {t['com.affine.import.pdf.ocr-pages-failed']({
          pages: warning.message,
        })}
      </>
    );

  const message =
    warning.code === 'skipped_doc'
      ? t['com.affine.import.warning.skipped-document']()
      : warning.code === 'doc_meta_failed'
        ? t['com.affine.import.warning.metadata']()
        : warning.code === 'unresolved_folder'
          ? t['com.affine.import.warning.placement']()
          : warning.code === 'notion-csv-export'
            ? t['com.affine.import.warning.notion-csv']()
            : warning.code === 'bear-bundle-import-failed'
              ? t['com.affine.import.warning.bear-bundle']()
              : t['com.affine.import.warning.generic']();
  return (
    <>
      <div>{message}</div>
      {warning.sourcePath ? <div>{warning.sourcePath}</div> : null}
      {warning.message ? (
        <details>
          <summary>{t['com.affine.import.warning.details']()}</summary>
          {warning.message}
        </details>
      ) : null}
    </>
  );
}
