import { Button, notify } from '@affine/component';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import type { Store } from '@blocksuite/affine/store';
import { LiveData, useLiveData, useService } from '@toeverything/infra';
import { useCallback, useMemo, useState } from 'react';

import * as styles from './index.css';

/** Plain text of every block, in document order. */
export function localDocText(store: Store) {
  return store
    .getAllModels()
    .map(model => model.text?.toString() ?? '')
    .filter(text => text.trim().length > 0)
    .join('\n');
}

/**
 * Shown when the server rejected this doc for permission. Local changes made
 * before the permission changed stay on this device only and are never
 * retried, so the user is told plainly and can copy them out.
 */
export function SyncPermissionDeniedTip({
  docId,
  store,
}: {
  docId: string;
  store: Store;
}) {
  const t = useI18n();
  const { workspace } = useService(WorkspaceService);
  const state = useLiveData(
    useMemo(
      () => LiveData.from(workspace.engine.doc.docState$(docId), null),
      [workspace, docId]
    )
  );
  const [copying, setCopying] = useState(false);
  const copy = useCallback(() => {
    if (copying) return;
    setCopying(true);
    navigator.clipboard
      .writeText(localDocText(store))
      .then(() =>
        notify.success({
          title: t['com.affine.doc-sync.permission-denied.copied'](),
        })
      )
      .catch(() =>
        notify.error({
          title: t['com.affine.doc-sync.permission-denied.copy-failed'](),
        })
      )
      .finally(() => setCopying(false));
  }, [copying, store, t]);

  if (workspace.flavour === 'local' || !state?.syncPermissionDenied)
    return null;
  return (
    <div
      className={styles.container}
      role="alert"
      data-testid="doc-sync-permission-denied"
    >
      <span className={styles.message}>
        {t['com.affine.doc-sync.permission-denied.message']()}
      </span>
      <Button onClick={copy} loading={copying} disabled={copying}>
        {t['com.affine.doc-sync.permission-denied.copy']()}
      </Button>
    </div>
  );
}
