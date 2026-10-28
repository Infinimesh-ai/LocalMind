import { Button, Modal } from '@affine/component';
import { WorkspaceUploadsService } from '@affine/core/modules/workspace-resources';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';

import * as styles from './native-files.css';

/** Mounted once per Workspace, outside transient tree rows and menus. */
export function WorkspaceUploadProgress() {
  const t = useI18n();
  const uploadService = useService(WorkspaceUploadsService);
  const uploads = useLiveData(uploadService.jobs$);
  const open = useLiveData(uploadService.panelOpen$);
  const busy = uploads.some(
    item => item.status === 'waiting' || item.status === 'uploading'
  );
  if (!open || !uploads.length) return null;
  return (
    <Modal
      open
      title={t['com.affine.localmind.resources.uploadLocal']()}
      onOpenChange={open => {
        if (!open) uploadService.setPanelOpen(false);
      }}
    >
      <div className={styles.form}>
        <div role="status">
          {t['com.affine.localmind.resources.upload.summary']({
            done: String(uploads.filter(item => item.status === 'done').length),
            total: String(uploads.length),
          })}
        </div>
        <p className={styles.uploadHint}>
          {t['com.affine.localmind.resources.upload.background']()}
        </p>
        <ul className={styles.list}>
          {uploads.map(item => (
            <li key={item.requestKey} className={styles.row}>
              <span className={styles.label}>
                {item.name}
                <small style={{ display: 'block' }}>
                  {item.destination.name}
                </small>
                {item.reason && (
                  <small style={{ display: 'block' }}>
                    {item.reason === 'rateLimited' && item.status === 'waiting'
                      ? t[
                          'com.affine.localmind.resources.upload.waitingForLimit'
                        ]()
                      : t[
                          `com.affine.localmind.resources.upload.reason.${item.reason}`
                        ]()}
                  </small>
                )}
              </span>
              <span role="status">
                {t[`com.affine.localmind.resources.upload.${item.status}`]()}
              </span>
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          {uploads.some(item => item.status === 'failed') && (
            <Button onClick={() => uploadService.retryFailed()}>
              {t['com.affine.localmind.resources.upload.retryFailed']()}
            </Button>
          )}
          {uploads.some(item => item.status === 'done') && (
            <Button disabled={busy} onClick={() => uploadService.clearDone()}>
              {t['com.affine.localmind.resources.upload.clearDone']()}
            </Button>
          )}
          <Button onClick={() => uploadService.setPanelOpen(false)}>
            {t['Close']()}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
