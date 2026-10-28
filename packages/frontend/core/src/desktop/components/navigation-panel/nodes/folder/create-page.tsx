import { notify } from '@affine/component';
import { useCreatedResourceNavigation } from '@affine/core/components/page-tree/created-resource';
import { DocsService } from '@affine/core/modules/doc';
import {
  EditorSettingService,
  resolveNewDocTitle,
} from '@affine/core/modules/editor-setting';
import { WorkspaceFolderPageService } from '@affine/core/modules/organize';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useRef, useState } from 'react';
import { firstValueFrom } from 'rxjs';

export function useFolderPageCreation(folderId: string, onCreated: () => void) {
  const service = useService(WorkspaceFolderPageService);
  const docs = useService(DocsService);
  const editor = useService(EditorSettingService);
  const begin = useCreatedResourceNavigation();
  const t = useI18n();
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const create = async (
    primaryMode: 'page' | 'edgeless',
    recovery?: ReturnType<WorkspaceFolderPageService['prepare']>
  ) => {
    if (active.current) return;
    active.current = true;
    setPending(true);
    const identity = service.accountIdentity;
    const complete = begin();
    let prepared = recovery;
    try {
      const settings = editor.editorSetting.settings$.value;
      const titles = await firstValueFrom(docs.allDocTitle$());
      const title =
        resolveNewDocTitle({
          autoTitleEnabled: settings.autoTitleNewDocWithCurrentDate,
          existingTitles: titles.map(doc => doc.title).filter(Boolean),
          format: settings.newDocDateTitleFormat,
        }) || t['Untitled']();
      if (identity !== service.accountIdentity) return;
      prepared ??= service.prepare(folderId, primaryMode, title);
      const documentId = await service.create(
        folderId,
        primaryMode,
        title,
        prepared
      );
      onCreated();
      await complete([{ kind: 'doc', resourceId: documentId }]);
    } catch {
      if (identity !== service.accountIdentity) return;
      notify.error(
        {
          title: t['com.affine.localmind.folderCreation.failed'](),
          message: t['com.affine.localmind.folderCreation.retryHint'](),
          actions: [
            {
              key: 'retry-folder-page',
              label: t['Retry'](),
              onClick: () =>
                identity === service.accountIdentity
                  ? create(primaryMode, prepared)
                  : undefined,
            },
          ],
        },
        { duration: 30_000 }
      );
    } finally {
      active.current = false;
      setPending(false);
    }
  };
  return { create, pending };
}
