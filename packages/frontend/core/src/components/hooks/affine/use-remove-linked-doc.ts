import { toast, useConfirmModal } from '@affine/component';
import { DocsService } from '@affine/core/modules/doc';
import { GuardService } from '@affine/core/modules/permissions';
import { useI18n } from '@affine/i18n';
import { useLiveData, useServices } from '@toeverything/infra';
import { useCallback } from 'react';

export const useRemoveLinkedDoc = (
  sourceDocId: string | undefined,
  linkedDocId: string
) => {
  const t = useI18n();
  const { docsService, guardService } = useServices({
    DocsService,
    GuardService,
  });
  const { openConfirmModal } = useConfirmModal();
  const sourceDoc = useLiveData(
    sourceDocId ? docsService.list.doc$(sourceDocId) : null
  );
  const linkedDoc = useLiveData(docsService.list.doc$(linkedDocId));
  const sourceTitle = useLiveData(sourceDoc?.title$);
  const linkedTitle = useLiveData(linkedDoc?.title$);

  return useCallback(() => {
    if (!sourceDocId) {
      return;
    }

    openConfirmModal({
      title: t['com.affine.rootAppSidebar.doc.remove-link.confirm.title'](),
      description: t[
        'com.affine.rootAppSidebar.doc.remove-link.confirm.description'
      ]({
        title: linkedTitle || t['Untitled'](),
        parentTitle: sourceTitle || t['Untitled'](),
      }),
      confirmText:
        t['com.affine.rootAppSidebar.doc.remove-link.confirm.confirm'](),
      cancelText: t['com.affine.confirmModal.button.cancel'](),
      onConfirm: async () => {
        const canEdit = await guardService.can('Doc_Update', sourceDocId);
        if (!canEdit) {
          toast(t['com.affine.no-permission']());
          return;
        }

        try {
          const removed = await docsService.removeLinkedDoc(
            sourceDocId,
            linkedDocId
          );
          toast(
            t[
              removed
                ? 'com.affine.toastMessage.removeLinkedPage'
                : 'com.affine.toastMessage.removeLinkedPageFailed'
            ]()
          );
        } catch (error) {
          console.error(
            '[navigation-panel] Failed to remove linked doc',
            error
          );
          toast(t['com.affine.toastMessage.removeLinkedPageFailed']());
        }
      },
    });
  }, [
    docsService,
    guardService,
    linkedDocId,
    linkedTitle,
    openConfirmModal,
    sourceDocId,
    sourceTitle,
    t,
  ]);
};
