import {
  effect,
  fromPromise,
  LiveData,
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
  tap,
} from 'rxjs';

import type { PublicUserStore } from '../stores/public-user';

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

export class PublicUserService extends Service {
  constructor(private readonly store: PublicUserStore) {
    super();
  }

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
  revalidate = effect(
    bufferTime<string>(10),
    filter((ids: string[]) => ids.length > 0),
    mergeMap(ids => {
      const pending = [...new Set(ids)].filter(
        id =>
          !this.isLoadings$.value.get(id) &&
          Date.now() - (this.loadedAt.get(id) ?? 0) > 60000
      );
      const batches: string[][] = [];
      for (let offset = 0; offset < pending.length; offset += 100) {
        const batch = pending.slice(offset, offset + 100);
        batch.forEach(id => {
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
          finalize(() => ids.forEach(id => this.setLoading(id, false)))
        ),
      3
    )
  );

  override dispose() {
    this.revalidate.unsubscribe();
    super.dispose();
  }
}
