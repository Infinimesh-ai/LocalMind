import { Button, ConfirmModal } from '@affine/component';
import type {
  DialogComponentProps,
  WORKSPACE_DIALOG_SCHEMA,
} from '@affine/core/modules/dialogs';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import { workspaceDocumentTypes } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

type Impact = Awaited<ReturnType<WorkspacePageTreeService['lifecyclePreview']>>;
export function PageTreeLifecycleDialog({
  nodeId,
  action,
  expectedParentNodeId,
  close,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['page-tree-lifecycle']>) {
  const service = useService(WorkspacePageTreeService),
    t = useI18n();
  const [accountGeneration] = useState(service.accountGeneration);
  const [impact, setImpact] = useState<Impact>();
  const [error, setError] = useState(false),
    [pending, setPending] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setImpact(undefined);
    setError(false);
    void service
      .lifecyclePreview(nodeId, action)
      .then(value => {
        if (!cancelled) setImpact(value);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [service, nodeId, action, generation]);
  const confirm = useCallback(async () => {
    if (!impact || pending) return;
    if (accountGeneration !== service.accountGeneration) {
      close(false);
      return;
    }
    setPending(true);
    setError(false);
    try {
      await service.execute(
        {
          action,
          nodeId,
          ...(expectedParentNodeId !== undefined
            ? { expectedParentNodeId }
            : {}),
        },
        impact
      );
      close(true);
    } catch {
      setImpact(undefined);
      setError(true);
    } finally {
      setPending(false);
    }
  }, [
    service,
    action,
    nodeId,
    expectedParentNodeId,
    impact,
    pending,
    close,
    accountGeneration,
  ]);
  return (
    <ConfirmModal
      open
      title={
        action === 'trash'
          ? t['com.affine.localmind.resources.moveToTrash']()
          : t[`com.affine.localmind.native-files.${action}`]()
      }
      description={
        action === 'trash'
          ? t['com.affine.localmind.page-tree.trashDescription']()
          : action === 'delete'
            ? t['com.affine.localmind.page-tree.deleteDescription']()
            : undefined
      }
      onOpenChange={open => {
        if (!open && !pending) close(false);
      }}
      onCancel={() => {
        if (!pending) close(false);
      }}
      onConfirm={confirm}
      confirmText={
        action === 'trash'
          ? t['com.affine.localmind.resources.moveToTrash']()
          : t[`com.affine.localmind.native-files.${action}`]()
      }
      cancelText={t['Cancel']()}
      confirmButtonOptions={{
        disabled: !impact || pending,
        loading: pending,
        variant: action === 'restore' ? 'primary' : 'error',
      }}
      cancelButtonOptions={{ disabled: pending }}
    >
      {!impact && !error && <p role="status">{t['Loading']()}</p>}
      {error && (
        <div role="alert">
          <p>{t['com.affine.localmind.page-tree.error']()}</p>
          <Button onClick={() => setGeneration(value => value + 1)}>
            {t['com.affine.error.retry']()}
          </Button>
        </div>
      )}
      {impact && (
        <div>
          <p>
            {t['com.affine.localmind.page-tree.impactCount']({
              count: String(impact.total),
            })}
          </p>
          <ul>
            {impact.items.map(item => (
              <li key={item.nodeId}>
                {item.title || t['Untitled']()} ·{' '}
                {t[
                  `com.affine.localmind.resource-display.type.${workspaceDocumentTypes.find(type => type === item.documentType) ?? 'other'}`
                ]()}
              </li>
            ))}
          </ul>
          {impact.truncated && (
            <p>{t['com.affine.localmind.page-tree.impactMore']()}</p>
          )}
        </div>
      )}
    </ConfirmModal>
  );
}
