import {
  effect,
  fromPromise,
  LiveData,
  OnEvent,
  Service,
  smartRetry,
} from '@toeverything/infra';
import {
  bufferTime,
  catchError,
  EMPTY,
  filter,
  finalize,
  mergeMap,
  Subject,
  type Subscription,
  tap,
} from 'rxjs';

import type { NbstoreService } from '../../storage';
import { AccountChanged } from '../events/account-changed';
import { ServerStarted } from '../events/server-started';
import type { PublicUserStore } from '../stores/public-user';
import type { AuthService } from './auth';

type RemovedUserInfo = {
  id: string;
  removed: true;
};

type ExistedUserInfo = {
  id: string;
  name?: string | null;
  avatar?: string | null;
  avatarUrl?: string | null;
  removed?: false;
};

export type PublicUserInfo = RemovedUserInfo | ExistedUserInfo;

/**
 * Current public identity (name/avatar) of users, keyed by user id.
 *
 * Cached profiles are refreshed when the server reports that a user sharing a
 * workspace or project renamed, when the realtime subscription is (re)ready
 * (covering changes missed while offline) and when the own account changes.
 */
@OnEvent(ServerStarted, s => s.subscribeChanges)
@OnEvent(AccountChanged, s => s.onAccountChanged)
export class PublicUserService extends Service {
  constructor(
    private readonly store: PublicUserStore,
    private readonly authService?: AuthService,
    private readonly nbstoreService?: NbstoreService
  ) {
    super();
    this.subscribeChanges();
  }

  private changesSubscription?: Subscription;
  private subscribedAccountId: string | null = null;
  private readonly invalidated = new Set<string>();
  private readonly changedIds$ = new Subject<string[]>();
  /** Ids whose cached public profile was invalidated and is being refetched. */
  readonly changed$ = this.changedIds$.asObservable();

  private readonly publicUsers$ = new LiveData<
    Map<string, PublicUserInfo | null>
  >(new Map());
  private readonly isLoadings$ = new LiveData<Map<string, boolean | null>>(
    new Map()
  );
  private readonly errors$ = new LiveData<Map<string, any | null>>(new Map());

  publicUser$(id: string) {
    return this.publicUsers$.selector(map => map.get(id) ?? null);
  }

  isLoading$(id: string) {
    return this.isLoadings$.selector(map => map.get(id) ?? false);
  }

  error$(id: string) {
    return this.errors$.selector(map => map.get(id));
  }

  private setPublicUser(id: string, userInfo: PublicUserInfo) {
    // Reusing the existing publicUsers Map instance instead of creating a new one.
    // While this doesn't follow immutability best practices, it reduces memory overhead
    // by avoiding the creation of new Map objects for each update.
    const publicUsers = this.publicUsers$.value;
    publicUsers.set(id, userInfo);
    this.publicUsers$.next(publicUsers);
  }

  private setLoading(id: string, loading: boolean) {
    // Similar to setPublicUser, reusing the existing Map instance to reduce memory overhead
    const loadings = this.isLoadings$.value;
    loadings.set(id, loading);
    this.isLoadings$.next(loadings);
  }

  private setError(id: string, error: any | null) {
    // Reusing the existing Map instance instead of creating a new one
    const errors = this.errors$.value;
    errors.set(id, error);
    this.errors$.next(errors);
  }

  private readonly loadedAt = new Map<string, number>();

  /**
   * Drop cached profiles of the given ids (all known ids when omitted) and
   * refetch the cached ones. A request already in flight is retried after it
   * settles so it cannot leave the pre-change name in the cache. `changed$`
   * reports every given id, so views with their own snapshots can refresh.
   */
  invalidate(ids?: Iterable<string>) {
    const known = new Set([
      ...this.loadedAt.keys(),
      ...this.publicUsers$.value.keys(),
      ...this.isLoadings$.value.keys(),
    ]);
    const changed = [...new Set(ids ?? known)];
    if (!changed.length) return;
    for (const id of changed) {
      if (!known.has(id)) continue;
      this.loadedAt.delete(id);
      this.invalidated.add(id);
      this.revalidate(id);
    }
    this.changedIds$.next(changed);
  }

  onAccountChanged(account: { id: string } | null) {
    if (account) this.invalidate([account.id]);
    this.subscribeChanges();
  }

  subscribeChanges() {
    if (!this.authService || !this.nbstoreService) return;
    const accountId = this.authService.session.account$.value?.id ?? null;
    if (
      this.changesSubscription &&
      !this.changesSubscription.closed &&
      accountId === this.subscribedAccountId
    ) {
      return;
    }
    this.changesSubscription?.unsubscribe();
    this.changesSubscription = undefined;
    this.subscribedAccountId = accountId;
    if (!accountId) return;
    this.changesSubscription = this.nbstoreService.realtime
      .subscribe('user.public-profile.changed', {})
      .subscribe({
        next: event => {
          if ('type' in event) {
            // (Re)subscribed: renames may have been missed while offline.
            this.invalidate();
            return;
          }
          this.invalidate(event.userIds);
        },
        error: () => {
          this.changesSubscription = undefined;
        },
      });
  }

  revalidate = effect(
    bufferTime<string>(10),
    filter((ids: string[]) => ids.length > 0),
    mergeMap(ids => {
      const pending = [...new Set(ids)].filter(
        id =>
          !this.isLoadings$.value.get(id) &&
          (this.invalidated.has(id) ||
            Date.now() - (this.loadedAt.get(id) ?? 0) > 60000)
      );
      const batches: string[][] = [];
      for (let offset = 0; offset < pending.length; offset += 100) {
        const batch = pending.slice(offset, offset + 100);
        batch.forEach(id => {
          this.invalidated.delete(id);
          this.setLoading(id, true);
          this.setError(id, null);
        });
        batches.push(batch);
      }
      return batches;
    }),
    mergeMap(
      ids =>
        fromPromise(async signal => {
          const users = await this.store.getPublicUsersByIds(ids, signal);
          return ids.map(id => {
            const user = users.find(user => user.id === id);
            return user
              ? {
                  id,
                  name: user.name,
                  avatar: user.avatarUrl,
                  avatarUrl: user.avatarUrl,
                }
              : { id, removed: true as const };
          });
        }).pipe(
          smartRetry(),
          tap(users =>
            users.forEach(user => {
              this.setPublicUser(user.id, user);
              this.loadedAt.set(user.id, Date.now());
            })
          ),
          catchError(error => {
            ids.forEach(id => this.setError(id, error));
            return EMPTY;
          }),
          finalize(() =>
            ids.forEach(id => {
              this.setLoading(id, false);
              // Invalidated while this request was in flight.
              if (this.invalidated.has(id)) this.revalidate(id);
            })
          )
        ),
      3
    )
  );

  override dispose() {
    this.changesSubscription?.unsubscribe();
    this.changedIds$.complete();
    this.revalidate.unsubscribe();
    super.dispose();
  }
}
