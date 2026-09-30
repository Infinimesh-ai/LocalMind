import { useAsyncCallback } from '@affine/core/components/hooks/affine-async-hooks';
import { DocsService } from '@affine/core/modules/doc';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { WorkspaceLifecycleService } from '@affine/core/modules/workspace-resources';
import { useService } from '@toeverything/infra';
import { useCallback } from 'react';

import { useNavigateHelper } from '../use-navigate-helper';

export function useBlockSuiteMetaHelper() {
  const lifecycle = useService(WorkspaceLifecycleService);
  const workspace = useService(WorkspaceService).workspace;
  const { openPage } = useNavigateHelper();
  const docsService = useService(DocsService);
  const docRecordList = useService(DocsService).list;

  // TODO-Doma
  // "Remove" may cause ambiguity here. Consider renaming as "moveToTrash".
  const removeToTrash = useCallback(
    async (docId: string) => {
      const docRecord = docRecordList.doc$(docId).value;
      if (!docRecord) throw new Error('Document unavailable');
      await docRecord.moveToTrash();
    },
    [docRecordList]
  );

  const restoreFromTrash = useCallback(
    async (docId: string) => {
      const docRecord = docRecordList.doc$(docId).value;
      if (!docRecord) throw new Error('Document unavailable');
      await docRecord.restoreFromTrash();
    },
    [docRecordList]
  );

  const permanentlyDeletePage = useCallback(
    (pageId: string) => {
      return lifecycle.change('doc', pageId, 'delete', () =>
        workspace.docCollection.removeDoc(pageId)
      );
    },
    [workspace, lifecycle]
  );

  const duplicate = useAsyncCallback(
    async (pageId: string, openPageAfterDuplication: boolean = true) => {
      const newPageId = await docsService.duplicate(pageId);
      openPageAfterDuplication &&
        openPage(workspace.docCollection.id, newPageId);
    },
    [docsService, openPage, workspace.docCollection.id]
  );

  return {
    removeToTrash,
    restoreFromTrash,
    permanentlyDeletePage,

    duplicate,
  };
}
