import {
  catchErrorInto,
  effect,
  fromPromise,
  LiveData,
  onComplete,
  onStart,
  Service,
  smartRetry,
} from '@toeverything/infra';
import { isEqual } from 'lodash-es';
import { debounceTime, EMPTY, exhaustMap, tap } from 'rxjs';

import type { Notification, NotificationStore } from '../stores/notification';
import type { NotificationCountService } from './count';

export class NotificationListService extends Service {
  mode$ = new LiveData<'unread' | 'all'>('unread');
  isLoading$ = new LiveData(false);
  isRefreshing$ = new LiveData(false);
  hasLoaded$ = new LiveData(false);
  isMutating$ = new LiveData(false);
  notifications$ = new LiveData<Notification[]>([]);
  nextCursor$ = new LiveData<string | undefined>(undefined);
  hasMore$ = new LiveData(true);
  error$ = new LiveData<any>(null);

  readonly PAGE_SIZE = 8;
  private loadedPages = 0;
  private generation = 0;
  private refreshFailed = false;
  private loadMoreRequested = false;

  constructor(
    private readonly store: NotificationStore,
    private readonly notificationCount: NotificationCountService
  ) {
    super();
    const subscription = this.notificationCount.revision$.subscribe(
      revision => {
        if (!revision || this.isMutating$.value) return;
        if (
          this.hasLoaded$.value ||
          this.isRefreshing$.value ||
          this.notifications$.value.length ||
          !this.hasMore$.value ||
          this.isLoading$.value
        ) {
          this.refresh();
        }
      }
    );
    this.disposables.push(() => subscription.unsubscribe());
    this.disposables.push(() => {
      this.generation++;
      this.loadMoreRequested = false;
      this.loadMore.unsubscribe();
      this.reconcile.unsubscribe();
    });
  }

  readonly loadMore = effect(
    exhaustMap(() => {
      if (this.isMutating$.value) {
        this.loadMoreRequested = true;
        return EMPTY;
      }
      if (!this.hasMore$.value) return EMPTY;
      if (this.isRefreshing$.value) {
        this.loadMoreRequested = true;
        return EMPTY;
      }
      if (this.refreshFailed) return EMPTY;
      const revision = this.notificationCount.revision$.value;
      return fromPromise(signal =>
        this.store.listNotification(
          {
            first: this.PAGE_SIZE,
            after: this.nextCursor$.value,
          },
          this.mode$.value === 'all',
          signal
        )
      ).pipe(
        tap(result => {
          if (!result) {
            // If the user is not logged in, we just ignore the result.
            return;
          }
          const { edges, pageInfo, totalCount } = result;
          this.hasLoaded$.setValue(true);
          this.loadedPages++;
          const byId = new Map(this.notifications$.value.map(n => [n.id, n]));
          edges.forEach(({ node }) => byId.set(node.id, node));
          this.notifications$.next([...byId.values()]);

          if (
            this.mode$.value === 'unread' &&
            revision === this.notificationCount.revision$.value
          ) {
            this.notificationCount.setCount(totalCount);
          }

          this.hasMore$.next(pageInfo.hasNextPage);
          this.nextCursor$.next(pageInfo.endCursor ?? undefined);
        }),
        smartRetry(),
        catchErrorInto(this.error$),
        onStart(() => {
          this.isLoading$.setValue(true);
        }),
        onComplete(() => this.isLoading$.setValue(false))
      );
    })
  );

  // Re-fetch the loaded window off-screen, then publish it atomically. Keep the
  // old rows and cursors until every page succeeds, including on network errors.
  private readonly reconcile = effect(
    debounceTime(80),
    exhaustMap(() => {
      const pages = Math.max(
        1,
        this.loadedPages,
        Math.ceil(this.notifications$.value.length / this.PAGE_SIZE)
      );
      const includeRead = this.mode$.value === 'all';
      const revision = this.notificationCount.revision$.value;
      return fromPromise(async signal => {
        const nodes = new Map<string, Notification>();
        let cursor: string | undefined;
        let hasMore = false;
        let totalCount = 0;
        let fetchedPages = 0;
        do {
          const result = await this.store.listNotification(
            { first: this.PAGE_SIZE, after: cursor },
            includeRead,
            signal
          );
          if (signal.aborted || !result) return;
          result.edges.forEach(({ node }) => nodes.set(node.id, node));
          totalCount = result.totalCount;
          hasMore = result.pageInfo.hasNextPage;
          const nextCursor = result.pageInfo.endCursor ?? undefined;
          // Do not loop on a malformed/non-advancing cursor.
          if (hasMore && (!nextCursor || nextCursor === cursor)) {
            throw new Error('Notification pagination did not advance');
          }
          cursor = nextCursor;
          fetchedPages++;
        } while (hasMore && fetchedPages < pages);
        return {
          nodes: [...nodes.values()],
          cursor,
          hasMore,
          totalCount,
          fetchedPages,
        };
      }).pipe(
        tap(result => {
          if (!result) return;
          this.hasLoaded$.setValue(true);
          if (!isEqual(this.notifications$.value, result.nodes)) {
            this.notifications$.next(result.nodes);
          }
          this.loadedPages = result.fetchedPages;
          this.nextCursor$.next(result.cursor);
          this.hasMore$.next(result.hasMore);
          this.refreshFailed = false;
          if (
            !includeRead &&
            revision === this.notificationCount.revision$.value
          ) {
            this.notificationCount.setCount(result.totalCount);
          }
        }),
        catchErrorInto(this.error$, () => {
          this.refreshFailed = true;
        }),
        onComplete(() => {
          this.isRefreshing$.setValue(false);
          if (this.loadMoreRequested) {
            this.loadMoreRequested = false;
            this.loadMore();
          }
        })
      );
    })
  );

  refresh() {
    if (this.isMutating$.value) return;
    // Coalesce the mutation receipt, count snapshot and realtime event. Cancel
    // stale reads immediately so they cannot resurrect an optimistically removed row.
    this.reconcile.reset();
    this.loadMore.reset();
    this.isLoading$.setValue(false);
    this.isRefreshing$.setValue(true);
    this.reconcile();
  }

  reset() {
    this.generation++;
    this.reconcile.reset();
    this.loadedPages = 0;
    this.refreshFailed = false;
    this.loadMoreRequested = false;
    this.isRefreshing$.setValue(false);
    this.hasLoaded$.setValue(false);
    this.notifications$.setValue([]);
    this.hasMore$.setValue(true);
    this.nextCursor$.setValue(undefined);
    this.isLoading$.setValue(false);
    this.error$.setValue(null);
    this.loadMore.reset();
  }

  retry() {
    this.error$.setValue(null);
    if (this.refreshFailed) {
      this.refresh();
      return;
    }
    this.loadMore.reset();
    this.loadMore();
  }

  setMode(mode: 'unread' | 'all') {
    if (mode === this.mode$.value) return;
    this.mode$.setValue(mode);
    this.reset();
    this.loadMore();
  }

  async readNotification(id: string) {
    return this.mutate(
      () => {
        const existing = this.notifications$.value.find(n => n.id === id);
        this.notifications$.next(
          this.mode$.value === 'unread'
            ? this.notifications$.value.filter(n => n.id !== id)
            : this.notifications$.value.map(n =>
                n.id === id ? { ...n, read: true } : n
              )
        );
        if (existing && !existing.read) {
          this.notificationCount.setCount(
            Math.max(this.notificationCount.count$.value - 1, 0)
          );
        }
      },
      () => this.store.readNotification(id)
    );
  }

  async readAllNotifications() {
    return this.mutate(
      () => {
        this.notifications$.next(
          this.mode$.value === 'unread'
            ? []
            : this.notifications$.value.map(n => ({ ...n, read: true }))
        );
        this.notificationCount.setCount(0);
      },
      () => this.store.readAllNotifications()
    );
  }

  async dismissNotification(id: string) {
    return this.mutate(
      () => {
        const existing = this.notifications$.value.find(n => n.id === id);
        this.notifications$.next(
          this.notifications$.value.filter(n => n.id !== id)
        );
        if (existing && !existing.read) {
          this.notificationCount.setCount(
            Math.max(this.notificationCount.count$.value - 1, 0)
          );
        }
      },
      () => this.store.dismissNotification(id)
    );
  }

  async dismissReadNotifications() {
    return this.mutate(
      () => {
        this.notifications$.next(
          this.notifications$.value.filter(n => !n.read)
        );
      },
      () => this.store.dismissReadNotifications()
    );
  }

  async dismissAllNotifications() {
    return this.mutate(
      () => {
        this.notifications$.next([]);
        this.notificationCount.setCount(0);
      },
      () => this.store.dismissAllNotifications()
    );
  }

  private async mutate(
    optimistic: () => void,
    request: () => Promise<unknown>
  ) {
    if (this.isMutating$.value) return;
    this.isMutating$.setValue(true);
    const previousCount = this.notificationCount.count$.value;
    const previousNotifications = this.notifications$.value;
    const generation = this.generation;
    const revision = this.notificationCount.revision$.value;
    this.reconcile.reset();
    this.isRefreshing$.setValue(false);
    this.loadMore.reset();
    this.isLoading$.setValue(false);
    optimistic();
    try {
      await request();
    } catch (err) {
      if (this.generation === generation) {
        this.notifications$.setValue(previousNotifications);
      }
      if (
        this.generation === generation &&
        this.notificationCount.revision$.value === revision
      ) {
        this.notificationCount.setCount(previousCount);
      }
      throw err;
    } finally {
      this.isMutating$.setValue(false);
      if (this.generation === generation) {
        this.refresh();
        this.notificationCount.revalidate();
      } else if (this.loadMoreRequested) {
        this.loadMoreRequested = false;
        this.loadMore();
      }
    }
  }
}
