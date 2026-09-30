import { Button, toast, useConfirmModal } from '@affine/component';
import {
  type LifecycleAction,
  type LifecycleKind,
  WorkspaceLifecycleService,
} from '@affine/core/modules/workspace-resources';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useEffect, useRef, useState } from 'react';
export function LifecycleActions({
  kind,
  resourceId,
  title,
  onChanged,
}: {
  kind: LifecycleKind;
  resourceId: string;
  title: string;
  onChanged?: () => void;
}) {
  const lifecycle = useService(WorkspaceLifecycleService);
  const t = useI18n();
  const { openConfirmModal } = useConfirmModal();
  const [rights, setRights] = useState<{
    canRestore: boolean;
    canDeletePermanently: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let current = true;
    void lifecycle
      .get(kind, resourceId)
      .then(row => {
        if (current) setRights(row);
      })
      .catch(() => {
        if (current) setRights(null);
      });
    return () => {
      current = false;
    };
  }, [kind, resourceId, lifecycle]);
  const act = async (action: LifecycleAction) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await lifecycle.change(kind, resourceId, action);
      onChanged?.();
    } catch {
      toast(t['com.affine.localmind.project-files.operationFailed']());
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <>
      <Button
        disabled={pending || !rights?.canRestore}
        onClick={() => void act('restore')}
      >
        {t['com.affine.localmind.native-files.restore']()}
      </Button>
      <Button
        disabled={pending || !rights?.canDeletePermanently}
        onClick={() =>
          openConfirmModal({
            title: t['com.affine.localmind.native-files.delete'](),
            description: `${title}\n${t['com.affine.localmind.native-files.deleteWarning']()}`,
            confirmText: t['Delete'](),
            cancelText: t['Cancel'](),
            confirmButtonOptions: { variant: 'error' },
            onConfirm: () => act('delete'),
          })
        }
      >
        {t['com.affine.localmind.native-files.delete']()}
      </Button>
    </>
  );
}
