import {
  Entity,
  generateFractionalIndexingKeyBetween,
  LiveData,
} from '@toeverything/infra';
import { map, of, switchMap } from 'rxjs';

import {
  compareNodeIds,
  type FolderSortMode,
  moveFolderChild,
  sortFolderChildren,
} from '../folder-sorting';
import type { FolderStore } from '../stores/folder';
import type { FolderSortingStore } from '../stores/folder-sorting';

export class FolderNode extends Entity<{
  id: string | null;
}> {
  id = this.props.id;

  info$ = LiveData.from<{
    data: string;
    type: (string & {}) | 'folder' | 'doc' | 'tag' | 'collection';
    index: string;
    id: string;
    parentId?: string | null;
    defaultSortMode?: string | null;
  } | null>(this.store.watchNodeInfo(this.id ?? ''), null);
  type$ = this.info$.map(info =>
    this.id === null ? 'folder' : (info?.type ?? '')
  );
  data$ = this.info$.map(info => info?.data);
  name$ = this.info$.map(info => (info?.type === 'folder' ? info.data : ''));
  canDelete$ = LiveData.from(
    this.id === null ? of(false) : this.store.watchFolderCanDelete(this.id),
    false
  );
  canMutate$ = LiveData.from(this.store.watchCanMutate(this.id), false);
  children$ = LiveData.from<FolderNode[]>(
    // watch children if this is a folder, otherwise return empty array
    this.type$.pipe(
      switchMap(type =>
        type === 'folder'
          ? this.store
              .watchNodeChildren(this.id)
              .pipe(
                map(children =>
                  children
                    .filter(e => this.filterInvalidChildren(e))
                    .map(child =>
                      this.framework.createEntity(FolderNode, { id: child.id })
                    )
                )
              )
              .pipe()
          : of([])
      )
    ),
    []
  );
  sortedChildren$ = LiveData.computed(get => {
    return get(this.children$)
      .map(node => [node, get(node.index$)] as const)
      .sort(
        (a, b) =>
          compareNodeIds(a[1], b[1]) ||
          compareNodeIds(a[0].id ?? '', b[0].id ?? '')
      )
      .map(([node]) => node);
  });
  index$ = this.info$.map(info => info?.index ?? '');
  private readonly preference$ = LiveData.from(
    this.id && this.sorting ? this.sorting.watchMode(this.id) : of(null),
    null
  );
  readonly sortMode$ = LiveData.computed(
    get =>
      get(this.preference$) ??
      (get(this.info$)?.defaultSortMode === 'name-desc'
        ? 'name-desc'
        : 'manual')
  );
  readonly sortReady$ = this.sorting?.ready$ ?? new LiveData(false);
  readonly sorting$ = new LiveData(false);
  readonly displayChildren$ = LiveData.computed(get => {
    const children = get(this.sortedChildren$);
    if (!this.sorting || this.id === null) return children;
    const titles = get(this.sorting.titles$);
    const visible = children.filter(child => {
      const info = get(child.info$);
      return (
        info?.type === 'folder' ||
        (!!info && titles.has(`${info.type}:${info.data}`))
      );
    });
    return sortFolderChildren(visible, get(this.sortMode$), child => {
      const info = get(child.info$);
      return info?.type === 'folder'
        ? info.data
        : (titles.get(`${info?.type}:${info?.data}`) ?? '');
    });
  });

  constructor(
    readonly store: FolderStore,
    private readonly sorting?: FolderSortingStore
  ) {
    super();
  }

  setSortMode(mode: FolderSortMode) {
    if (!this.id || !this.sorting || this.sorting$.value)
      throw new Error('Folder preferences are unavailable');
    this.sorting.setMode(this.id, mode);
  }

  async reorderChild(
    sourceId: string,
    targetId: string,
    at: 'before' | 'after'
  ) {
    if (
      !this.id ||
      !this.sorting ||
      !this.sortReady$.value ||
      this.sorting$.value
    )
      throw new Error('Folder preferences are unavailable');
    const folderId = this.id;
    const identity = this.sorting.identity();
    const previousMode = this.sortMode$.value;
    const visible = this.displayChildren$.value.map(
      child => child.id as string
    );
    const order = moveFolderChild(visible, sourceId, targetId, at);
    if (JSON.stringify(order) === JSON.stringify(visible)) return;
    const selected = new Set(visible);
    const previous = this.sortedChildren$.value
      .filter(child => selected.has(child.id as string))
      .map(child => child.id as string);
    const expectedRevision = this.store.orderRevision(folderId);
    this.sorting$.next(true);
    let revision: string | undefined;
    try {
      revision = await this.store.reorderChildren(
        folderId,
        order,
        previous,
        expectedRevision
      );
      if (identity !== this.sorting.identity())
        throw new Error('Account changed during reordering');
      this.sorting.setMode(folderId, 'manual');
    } finally {
      this.sorting$.next(false);
    }
    let undone = false;
    return async () => {
      if (
        undone ||
        this.sorting$.value ||
        identity !== this.sorting?.identity() ||
        this.sortMode$.value !== 'manual'
      )
        throw new Error('Folder changed; refresh before undoing');
      this.sorting$.next(true);
      try {
        await this.store.reorderChildren(folderId, previous, order, revision);
        this.sorting?.setMode(folderId, previousMode);
        undone = true;
      } finally {
        this.sorting$.next(false);
      }
    };
  }

  contains(childId: string | null): boolean {
    if (!this.id) {
      return true;
    }
    if (!childId) {
      return false;
    }
    return this.store.isAncestor(childId, this.id);
  }

  beChildOf(parentId: string | null): boolean {
    if (!this.id) {
      return false;
    }
    if (!parentId) {
      return true;
    }
    return this.store.isAncestor(this.id, parentId);
  }

  filterInvalidChildren(child: { type: string }): boolean {
    if (this.id === null && child.type !== 'folder') {
      return false; // root node can only have folders
    }
    return true;
  }

  createFolder(name: string, index: string) {
    if (this.type$.value !== 'folder') {
      throw new Error('Cannot create folder on non-folder node');
    }
    return this.store.createFolderAuthorized(this.id, name, index);
  }

  createLink(
    type: 'doc' | 'tag' | 'collection',
    targetId: string,
    index: string,
    retryCreatedDocumentConflict = false
  ) {
    if (this.id === null) {
      throw new Error('Cannot create link on root node');
    }
    if (this.type$.value !== 'folder') {
      throw new Error('Cannot create link on non-folder node');
    }
    return this.store.createLinkAuthorized(
      this.id,
      type,
      targetId,
      index,
      retryCreatedDocumentConflict
    );
  }

  delete() {
    if (this.id === null) {
      throw new Error('Cannot delete root node');
    }
    return this.store.removeNodeAuthorized(this.id);
  }

  moveHere(childId: string, index: string) {
    return this.store.moveNodeAuthorized(childId, this.id, index);
  }

  rename(name: string) {
    if (this.id === null) {
      throw new Error('Cannot rename root node');
    }
    return this.store.renameNodeAuthorized(this.id, name);
  }

  indexAt(at: 'before' | 'after', targetId?: string) {
    if (!targetId) {
      if (at === 'before') {
        const first = this.sortedChildren$.value.at(0);
        return generateFractionalIndexingKeyBetween(
          null,
          first?.index$.value || null
        );
      } else {
        const last = this.sortedChildren$.value.at(-1);
        return generateFractionalIndexingKeyBetween(
          last?.index$.value || null,
          null
        );
      }
    } else {
      const sortedChildren = this.sortedChildren$.value;
      const targetIndex = sortedChildren.findIndex(
        node => node.id === targetId
      );
      if (targetIndex === -1) {
        throw new Error('Target node not found');
      }
      const target = sortedChildren[targetIndex];
      const before: FolderNode | null = sortedChildren[targetIndex - 1] || null;
      const after: FolderNode | null = sortedChildren[targetIndex + 1] || null;
      if (at === 'before') {
        return generateFractionalIndexingKeyBetween(
          before?.index$.value || null,
          target.index$.value
        );
      } else {
        return generateFractionalIndexingKeyBetween(
          target.index$.value,
          after?.index$.value || null
        );
      }
    }
  }
}
