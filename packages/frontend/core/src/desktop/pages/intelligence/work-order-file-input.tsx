import { Button } from '@affine/component';
import { useI18n } from '@affine/i18n';
import { AttachmentIcon, UploadIcon } from '@blocksuite/icons/rc';
import { filesize } from 'filesize';
import { useId, useRef } from 'react';

import * as styles from './work-order-panel.css';

export type WorkOrderFile = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

const formatNames: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'PPTX',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'application/json': 'JSON',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
};

export function WorkOrderFileRow({
  file,
  href,
}: {
  file: Pick<WorkOrderFile, 'fileName' | 'byteSize'>;
  href?: string;
}) {
  return (
    <div className={styles.fileRow}>
      <AttachmentIcon className={styles.fileIcon} aria-hidden="true" />
      <div className={styles.fileDetails}>
        {href ? (
          <a
            className={styles.fileName}
            href={href}
            download={file.fileName}
            title={file.fileName}
          >
            {file.fileName}
          </a>
        ) : (
          <span className={styles.fileName} title={file.fileName}>
            {file.fileName}
          </span>
        )}
        <span className={styles.fileHint}>
          {filesize(file.byteSize, { standard: 'iec', round: 1 })}
        </span>
      </div>
    </div>
  );
}

export function WorkOrderFileInput({
  title,
  acceptedMimeTypes,
  maxCount,
  files,
  uploading,
  disabled,
  error,
  onSelect,
}: {
  title: string;
  acceptedMimeTypes: string[];
  maxCount: number;
  files: WorkOrderFile[];
  uploading: boolean;
  disabled: boolean;
  error?: string;
  onSelect: (files: File[]) => void;
}) {
  const t = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const formats = acceptedMimeTypes
    .map(mime => formatNames[mime] ?? mime)
    .join(' / ');
  const label = uploading
    ? t['com.affine.localmind.workbench.v9.uploading']()
    : files.length
      ? t['com.affine.localmind.workbench.v9.replaceDeliveryFiles']()
      : t['com.affine.localmind.workbench.v9.uploadDeliveryFiles']();
  return (
    <div className={styles.fileInput}>
      <input
        ref={inputRef}
        type="file"
        hidden
        aria-label={title}
        accept={acceptedMimeTypes.join(',')}
        multiple={maxCount > 1}
        disabled={disabled || uploading}
        onChange={event => {
          const selected = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (selected.length) onSelect(selected);
        }}
      />
      <div className={styles.filePicker}>
        {files.length ? (
          <div className={styles.fileList} aria-live="polite">
            {files.map(file => (
              <WorkOrderFileRow key={file.id} file={file} />
            ))}
          </div>
        ) : null}
        <Button
          type="button"
          className={styles.uploadButton}
          prefix={<UploadIcon aria-hidden="true" />}
          loading={uploading}
          disabled={disabled || uploading}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
          onClick={() => inputRef.current?.click()}
        >
          {label}
        </Button>
      </div>
      <span id={hintId} className={styles.fileHint}>
        {t['com.affine.localmind.workbench.v9.deliveryFileFormats']({
          formats,
          count: String(maxCount),
        })}
      </span>
      {error ? (
        <span id={errorId} className={styles.fileError} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
