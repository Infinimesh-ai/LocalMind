import { IconButton, MenuSub } from '@affine/component';
import { usePageHelper } from '@affine/core/blocksuite/block-suite-page-list/utils';
import { useAsyncCallback } from '@affine/core/components/hooks/affine-async-hooks';
import { WorkspaceCreateMenu } from '@affine/core/components/native-files/create-menu';
import { DocsService } from '@affine/core/modules/doc';
import { TemplateDocService } from '@affine/core/modules/template-doc';
import { TemplateListMenuContentScrollable } from '@affine/core/modules/template-doc/view/template-list-menu';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { inferOpenMode } from '@affine/core/utils';
import { useI18n } from '@affine/i18n';
import type { DocMode } from '@blocksuite/affine/model';
import { PlusIcon, TemplateIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import type React from 'react';
import { type MouseEvent } from 'react';

import * as styles from './index.css';

/**
 * @return a function to create a new doc, will duplicate the template doc if the page template is enabled
 */
const useNewDoc = () => {
  const workspaceService = useService(WorkspaceService);
  const templateDocService = useService(TemplateDocService);
  const docsService = useService(DocsService);
  const workbench = useService(WorkbenchService).workbench;

  const currentWorkspace = workspaceService.workspace;
  const enablePageTemplate = useLiveData(
    templateDocService.setting.enablePageTemplate$
  );
  const pageTemplateDocId = useLiveData(
    templateDocService.setting.pageTemplateDocId$
  );

  const pageHelper = usePageHelper(currentWorkspace.docCollection);

  const createPage = useAsyncCallback(
    async (e?: MouseEvent, mode?: DocMode) => {
      if (enablePageTemplate && pageTemplateDocId) {
        const docId =
          await docsService.duplicateFromTemplate(pageTemplateDocId);
        workbench.openDoc(docId, { at: inferOpenMode(e) });
      } else {
        pageHelper.createPage(mode, { at: inferOpenMode(e) });
      }
    },
    [docsService, enablePageTemplate, pageHelper, pageTemplateDocId, workbench]
  );

  return createPage;
};

interface AddPageButtonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function AddPageButton({ className, style }: AddPageButtonProps) {
  const t = useI18n();
  const createDoc = useNewDoc();
  const docs = useService(DocsService);
  const workbench = useService(WorkbenchService).workbench;
  return (
    <WorkspaceCreateMenu
      onPage={() => createDoc(undefined, 'page')}
      onEdgeless={() => createDoc(undefined, 'edgeless')}
      extra={
        <MenuSub
          triggerOptions={{ prefixIcon: <TemplateIcon /> }}
          items={
            <TemplateListMenuContentScrollable
              onSelect={id => {
                docs
                  .duplicateFromTemplate(id)
                  .then(id => workbench.openDoc(id))
                  .catch(console.error);
              }}
            />
          }
        >
          {t['Template']()}
        </MenuSub>
      }
    >
      <IconButton
        className={className ?? styles.root}
        style={style}
        size={16}
        tooltip={t['com.affine.localmind.resources.create']()}
        data-testid="sidebar-new-page-button"
      >
        <PlusIcon />
      </IconButton>
    </WorkspaceCreateMenu>
  );
}
