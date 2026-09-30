import { UserFriendlyError } from '@affine/error';
import { PageIcon } from '@blocksuite/icons/rc';
import { Entity, LiveData } from '@toeverything/infra';

import type { WorkspaceResourcesService } from '../../workspace-resources';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { QuickSearchItem } from '../types/item';
export type NativeSearchPayload = {
  resourceId: string;
  kind: 'file' | 'office';
};
export class NativeResourcesQuickSearchSession
  extends Entity
  implements QuickSearchSession<'workspace-native', NativeSearchPayload>
{
  readonly items$ = new LiveData<
    QuickSearchItem<'workspace-native', NativeSearchPayload>[]
  >([]);
  readonly error$ = new LiveData<UserFriendlyError | null>(null);
  readonly isLoading$ = new LiveData(false);
  private lastQuery = '';
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly resources: WorkspaceResourcesService) {
    super();
    const subscription = resources.invalidated$.subscribe(() =>
      this.query(this.lastQuery)
    );
    this.disposables.push(() => subscription.unsubscribe());
  }
  query(query: string) {
    this.lastQuery = query;
    this.controller?.abort();
    clearTimeout(this.timer);
    this.items$.next([]);
    this.error$.next(null);
    if (!query.trim() || !this.resources.online) {
      this.isLoading$.next(false);
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.isLoading$.next(true);
    this.timer = setTimeout(() => {
      void this.resources
        .list(query.slice(0, 256), false, controller.signal)
        .then(items => {
          if (controller.signal.aborted) return;
          this.items$.next(
            items.map(item => ({
              id: `native:${item.kind}:${item.id}`,
              source: 'workspace-native',
              icon: PageIcon,
              label: { title: item.fileName, subTitle: item.mimeType },
              group: {
                id: 'workspace-native',
                label: { i18nKey: 'com.affine.rootAppSidebar.files' },
                score: 5,
              },
              payload: { resourceId: item.id, kind: item.kind },
              timestamp: Date.parse(item.updatedAt),
            }))
          );
        })
        .catch(error => {
          if (!controller.signal.aborted)
            this.error$.next(UserFriendlyError.fromAny(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) this.isLoading$.next(false);
        });
    }, 250);
  }
  override dispose() {
    clearTimeout(this.timer);
    this.controller?.abort();
    super.dispose();
  }
}
