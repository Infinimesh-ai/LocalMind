import { Button } from '@affine/component/ui/button';
import { ConfirmModal } from '@affine/component/ui/modal';
import { DocService } from '@affine/core/modules/doc';
import { GuardService } from '@affine/core/modules/permissions';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import { DeleteIcon, ResetIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useState } from 'react';

import { useAppSettingHelper } from '../../../components/hooks/affine/use-app-setting-helper';
import { useBlockSuiteMetaHelper } from '../../../components/hooks/affine/use-block-suite-meta-helper';
import { useNavigateHelper } from '../../../components/hooks/use-navigate-helper';
import { toast } from '../../../utils';
import * as styles from './styles.css';

export const TrashPageFooter = () => {
  const workspace = useService(WorkspaceService).workspace;
  const guard = useService(GuardService);
  const doc = useService(DocService).doc;
  const t = useI18n();
  const { appSettings } = useAppSettingHelper();
  const { jumpToPage } = useNavigateHelper();
  const { restoreFromTrash, permanentlyDeletePage } = useBlockSuiteMetaHelper();
  const [pending, setPending] = useState(false);
  const canRestore = useLiveData(guard.can$('Doc_Restore', doc.id));
  const canDelete = useLiveData(guard.can$('Doc_Delete', doc.id));
  const [open, setOpen] = useState(false);
  const hintText = t['com.affine.cmdk.affine.editor.trash-footer-hint']();

  const onRestore = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await restoreFromTrash(doc.id);
      toast(
        t['com.affine.toastMessage.restored']({
          title: doc.meta$.value.title || 'Untitled',
        })
      );
    } catch {
      toast(t['com.affine.localmind.project-files.operationFailed']());
    } finally {
      setPending(false);
    }
  }, [doc, restoreFromTrash, t, pending]);
  const onConfirmDelete = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await permanentlyDeletePage(doc.id);
      jumpToPage(workspace.id, 'all');
      toast(t['com.affine.toastMessage.permanentlyDeleted']());
    } catch {
      toast(t['com.affine.localmind.project-files.operationFailed']());
    } finally {
      setPending(false);
    }
  }, [jumpToPage, workspace.id, permanentlyDeletePage, doc.id, t, pending]);

  const onDelete = useCallback(() => {
    setOpen(true);
  }, []);

  return (
    <div
      className={styles.deleteHintContainer}
      data-has-background={!appSettings.clientBorder}
    >
      <div className={styles.deleteHintText}>{hintText}</div>
      <div className={styles.group}>
        <Button
          tooltip={t['com.affine.trashOperation.restoreIt']()}
          data-testid="page-restore-button"
          variant="primary"
          disabled={pending || !canRestore}
          onClick={() => void onRestore()}
          className={styles.buttonContainer}
          prefix={<ResetIcon />}
          prefixClassName={styles.icon}
        />
        <Button
          tooltip={t['com.affine.trashOperation.deletePermanently']()}
          variant="error"
          disabled={pending || !canDelete}
          onClick={onDelete}
          className={styles.buttonContainer}
          prefix={<DeleteIcon />}
          prefixClassName={styles.icon}
        />
      </div>
      <ConfirmModal
        title={t['com.affine.trashOperation.delete.title']()}
        cancelText={t['com.affine.confirmModal.button.cancel']()}
        description={t['com.affine.trashOperation.delete.description']()}
        confirmText={t['com.affine.trashOperation.delete']()}
        confirmButtonOptions={{
          variant: 'error',
        }}
        open={open}
        onConfirm={onConfirmDelete}
        onOpenChange={setOpen}
      />
    </div>
  );
};
