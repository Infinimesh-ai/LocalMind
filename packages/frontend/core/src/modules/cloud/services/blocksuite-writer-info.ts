import { WriterInfoServiceExtension } from '@blocksuite/affine/shared/services';
import { OnEvent, Service } from '@toeverything/infra';
import { distinctUntilChanged, map } from 'rxjs';

import { type Workspace, WorkspaceInitialized } from '../../workspace';
import type { DocImpl } from '../../workspace/impls/doc';
import type { WorkspaceServerService } from './workspace-server';

/**
 * This service is used to set the writer info for the blocksuite editor.
 * The awareness name follows the current account, so a rename is shown on the
 * collaboration cursor of already opened docs.
 */
@OnEvent(WorkspaceInitialized, i => i.onWorkspaceInitialized)
export class BlocksuiteWriterInfoService extends Service {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  onWorkspaceInitialized(workspace: Workspace) {
    const server = this.workspaceServerService.server;
    const currentAccount = () => server?.account$.value ?? null;
    const setAwarenessUser = (doc: DocImpl) => {
      doc.awarenessStore.awareness.setLocalStateField('user', {
        name: currentAccount()?.label,
      });
    };
    const setWriterInfo = (doc: DocImpl) => {
      setAwarenessUser(doc);
      doc.storeExtensions.push(
        WriterInfoServiceExtension({
          getWriterInfo: () => {
            const account = currentAccount();
            if (!account) {
              return null;
            }
            return {
              id: account.id,
              name: account.label,
              avatar: account.avatar,
            };
          },
        })
      );
    };
    const subscription = workspace.docCollection.meta.docMetaAdded.subscribe(
      docId => {
        const doc = workspace.docCollection.docs.get(docId) as DocImpl;
        setWriterInfo(doc);
      }
    );
    this.disposables.push(() => subscription.unsubscribe());

    const accountSubscription = server?.account$
      .pipe(
        map(account => account?.label),
        distinctUntilChanged()
      )
      .subscribe(() => {
        for (const doc of workspace.docCollection.docs.values()) {
          setAwarenessUser(doc as DocImpl);
        }
      });
    this.disposables.push(() => accountSubscription?.unsubscribe());
  }
}
