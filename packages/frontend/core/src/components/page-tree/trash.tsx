import { Button, toast } from '@affine/component';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import type { PageTreeItem } from '@affine/core/modules/organize/services/page-tree';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect, useMemo, useState } from 'react';

import { MovePageDialog } from '../root-app-sidebar/page-tree';
import * as styles from './children.css';

export function PageTreeTrash() {
  const service = useService(WorkspacePageTreeService);
  const t = useI18n();
  const saving = useLiveData(service.saving$);
  const layer = useLiveData(
    useMemo(
      () => service.layers$.map(layers => layers.get('$page-tree-trash')),
      [service]
    )
  );
  const [relocate, setRelocate] = useState<PageTreeItem | null>(null);
  useEffect(() => {
    void service.loadTrash().catch(console.error);
  }, [service]);
  return (
    <div className={styles.section}>
      {layer?.loading && (
        <p role="status">{t['com.affine.localmind.page-tree.loading']()}</p>
      )}
      {layer?.error && (
        <Button onClick={() => void service.loadTrash()}>
          {t['com.affine.error.retry']()}
        </Button>
      )}
      {layer?.page?.items.map(item => (
        <div key={item.nodeId} className={styles.header}>
          <span className={styles.heading}>
            {item.title || t['Untitled']()}
          </span>
          <Button
            disabled={saving || !item.canOrganize}
            onClick={() =>
              void service
                .confirmLifecycle('restore', item.nodeId)
                .catch(() => toast(t['com.affine.localmind.page-tree.error']()))
            }
          >
            {t['com.affine.localmind.native-files.restore']()}
          </Button>
          <Button
            disabled={saving || !item.canOrganize}
            onClick={() => setRelocate(item)}
          >
            {t['com.affine.localmind.resources.restoreElsewhere']()}
          </Button>
          <Button
            disabled={saving || !item.canOrganize}
            onClick={() => void service.confirmLifecycle('delete', item.nodeId)}
          >
            {t['com.affine.localmind.native-files.delete']()}
          </Button>
        </div>
      ))}
      {layer?.page && !layer.page.items.length && !layer.loading && (
        <p>{t['com.affine.localmind.page-tree.empty']()}</p>
      )}
      {layer?.page?.nextCursor && (
        <Button
          disabled={layer.loading}
          onClick={() => void service.loadTrash(true)}
        >
          {t['com.affine.quicksearch.load-more']()}
        </Button>
      )}
      {relocate && (
        <MovePageDialog
          item={relocate}
          action="restore"
          onClose={() => setRelocate(null)}
        />
      )}
    </div>
  );
}
