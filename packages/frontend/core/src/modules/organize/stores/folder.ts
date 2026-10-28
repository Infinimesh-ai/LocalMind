import { UserFriendlyError } from '@affine/error';
import { I18n } from '@affine/i18n';
import {
  generateFractionalIndexingKeyBetween,
  LiveData,
  Store,
} from '@toeverything/infra';
import { nanoid } from 'nanoid';
import {
  combineLatest,
  filter,
  firstValueFrom,
  map,
  of,
  switchMap,
  timeout,
} from 'rxjs';

import type { WorkspaceDBService } from '../../db';
import type { DocsService } from '../../doc';
import { compareNodeIds } from '../folder-sorting';
import type { DirectoryAccessStore } from './directory-access';

function validFolderName(name: string) {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error(
      I18n['com.affine.localmind.resources.folderNameRequired']()
    );
  }
  return normalized;
}

export class FolderStore extends Store {
  constructor(
    private readonly dbService: WorkspaceDBService,
    private readonly docsService: DocsService,
    private readonly directoryAccess?: DirectoryAccessStore
  ) {
    super();
  }

  private readonly loading$ = LiveData.from(this.watchIsLoading(), true);

  private isRemovableLink(node: { type: string; data: string }) {
    if (node.type !== 'doc') return false;
    const list = this.docsService.list;
    return (
      list.trashDocs$.value.some(doc => doc.id === node.data) ||
      (list.isReady$.value && !list.docsMap$.value.has(node.data))
    );
  }

  watchFolderCanDelete(folderId: string) {
    const list = this.docsService.list;
    return combineLatest([
      this.watchNodeChildren(folderId),
      this.loading$,
      list.trashDocs$,
      list.docsMap$,
      list.isReady$,
      this.watchCanMutate(folderId),
    ]).pipe(
      map(
        ([children, loading, , , , canMutate]) =>
          canMutate &&
          !loading &&
          children.every(child => this.isRemovableLink(child))
      )
    );
  }

  watchNodeInfo(nodeId: string) {
    if (!this.directoryAccess) return this.dbService.db.folders.get$(nodeId);
    return this.directoryAccess.state$.pipe(
      switchMap(state =>
        state.mode === 'local' || state.mode === 'full'
          ? this.dbService.db.folders.get$(nodeId)
          : of(
              state.mode === 'filtered'
                ? (state.items.find(item => item.id === nodeId) ?? null)
                : null
            )
      )
    );
  }

  watchNodeChildren(parentId: string | null) {
    if (!this.directoryAccess)
      return this.dbService.db.folders.find$({ parentId });
    return this.directoryAccess.state$.pipe(
      switchMap(state =>
        state.mode === 'local' || state.mode === 'full'
          ? this.dbService.db.folders.find$({ parentId })
          : of(
              state.mode === 'filtered'
                ? state.items.filter(item => item.parentId === parentId)
                : []
            )
      )
    );
  }

  watchLinkedDocIds() {
    const links$ = this.directoryAccess
      ? this.directoryAccess.state$.pipe(
          switchMap(state =>
            state.mode === 'local' || state.mode === 'full'
              ? this.dbService.db.folders.find$({ type: 'doc' })
              : of(state.mode === 'filtered' ? state.items : [])
          )
        )
      : this.dbService.db.folders.find$({ type: 'doc' });
    return links$.pipe(
      map(
        items =>
          new Set(
            items.filter(item => item.type === 'doc').map(item => item.data)
          )
      )
    );
  }

  watchIsLoading() {
    if (!this.directoryAccess) return this.dbService.db.folders.isLoading$;
    return this.directoryAccess.state$.pipe(
      switchMap(state =>
        state.mode === 'local' || state.mode === 'full'
          ? this.dbService.db.folders.isLoading$
          : of(state.mode === 'loading')
      )
    );
  }

  watchCanMutate(nodeId: string | null = null) {
    return this.directoryAccess
      ? combineLatest([
          this.directoryAccess.state$,
          this.directoryAccess.saving$,
        ]).pipe(
          map(([state, saving]) => {
            if (saving) return false;
            if (state.mode === 'local') return true;
            if (state.mode === 'full') {
              const rights = state.rootRights;
              return rights
                ? rights.canRead && rights.canWrite && rights.canOrganize
                : true;
            }
            if (state.mode !== 'filtered') return false;
            const rights =
              nodeId === null
                ? state.rootRights
                : state.items.find(item => item.id === nodeId)?.rights;
            return !!rights?.canRead && rights.canWrite && rights.canOrganize;
          })
        )
      : of(true);
  }

  watchError() {
    return this.directoryAccess
      ? this.directoryAccess.state$.pipe(map(state => state.error))
      : of(null);
  }

  async refresh() {
    await this.directoryAccess?.refresh(true);
  }

  private get filtered() {
    return this.directoryAccess?.state$.value.mode === 'filtered';
  }

  private async waitForDirectoryLoad(directoryAccess: DirectoryAccessStore) {
    try {
      return await firstValueFrom(
        directoryAccess.state$.pipe(
          filter(state => state.mode !== 'loading'),
          timeout({ first: 15_000 })
        )
      );
    } catch {
      throw new Error('Reload directory permissions before editing');
    }
  }

  private async prepareAuthorizedMutation() {
    const directoryAccess = this.directoryAccess;
    if (!directoryAccess) return;
    let state = directoryAccess.state$.value;
    if (state.mode === 'loading')
      state = await this.waitForDirectoryLoad(directoryAccess);
    if (state?.mode === 'error') {
      await directoryAccess.refresh(true);
      state = directoryAccess.state$.value;
      if (state.mode === 'loading')
        state = await this.waitForDirectoryLoad(directoryAccess);
    }
    if (state?.mode === 'error')
      throw new Error(
        state.error ?? 'Reload directory permissions before editing'
      );
  }

  private filteredItems() {
    return this.directoryAccess?.state$.value.items ?? [];
  }

  async createFolderAuthorized(
    parentId: string | null,
    name: string,
    index: string
  ) {
    name = validFolderName(name);
    await this.prepareAuthorizedMutation();
    if (!this.filtered) return this.createFolder(parentId, name, index);
    if (parentId && this.getNode(parentId)?.type !== 'folder')
      throw new Error('Parent folder not found');
    const id = nanoid();
    await this.directoryAccess?.mutate([
      {
        op: 'upsert',
        key: id,
        values: {
          type: 'folder',
          data: name,
          parentId,
          index,
          defaultSortMode: 'name-desc',
        },
      },
    ]);
    return id;
  }

  async createLinkAuthorized(
    parentId: string,
    type: 'doc' | 'tag' | 'collection',
    data: string,
    index: string,
    retryCreatedDocumentConflict = false
  ) {
    await this.prepareAuthorizedMutation();
    if (!this.filtered) return this.createLink(parentId, type, data, index);
    if (this.getNode(parentId)?.type !== 'folder')
      throw new Error('Parent folder not found');
    const existing = this.filteredItems().find(
      item =>
        item.parentId === parentId && item.type === type && item.data === data
    );
    if (existing) return existing.id;
    const id = nanoid();
    const access = this.directoryAccess;
    const generation = access?.accountGeneration;
    const changes = [
      {
        op: 'upsert' as const,
        key: id,
        values: { type, data, parentId, index },
      },
    ];
    try {
      await access?.mutate(changes);
    } catch (error) {
      if (
        !retryCreatedDocumentConflict ||
        type !== 'doc' ||
        !access ||
        access.accountGeneration !== generation ||
        UserFriendlyError.fromAny(error).status !== 409
      )
        throw error;
      // mutate() refreshed the directory after a definite conflict. Recheck
      // the original destination and never retry under another account.
      const state = access.state$.value;
      const parent = state.items.find(item => item.id === parentId);
      if (
        state.mode !== 'filtered' ||
        !parent ||
        parent.type !== 'folder' ||
        !parent.rights.canRead ||
        !parent.rights.canWrite ||
        !parent.rights.canOrganize
      )
        throw error;
      const existing = state.items.find(
        item => item.type === type && item.data === data
      );
      if (existing) {
        if (existing.parentId === parentId) return existing.id;
        throw error;
      }
      await access.mutate(changes);
    }
    return id;
  }

  async renameNodeAuthorized(nodeId: string, name: string) {
    name = validFolderName(name);
    await this.prepareAuthorizedMutation();
    if (!this.filtered) return this.renameNode(nodeId, name);
    const node = this.getNode(nodeId);
    if (!node || node.type !== 'folder') throw new Error('Folder not found');
    await this.directoryAccess?.mutate([
      {
        op: 'upsert',
        key: nodeId,
        values: {
          type: node.type,
          data: name,
          parentId: node.parentId ?? null,
          index: node.index,
        },
      },
    ]);
  }

  async removeNodeAuthorized(nodeId: string) {
    await this.prepareAuthorizedMutation();
    const node = this.getNode(nodeId);
    if (!node) throw new Error('Node not found');
    if (!this.filtered) {
      if (node.type === 'folder') return this.removeFolder(nodeId);
      this.removeLink(nodeId);
      return true;
    }
    const children = this.filteredItems().filter(
      item => item.parentId === nodeId
    );
    if (
      node.type === 'folder' &&
      (this.loading$.value ||
        children.some(child => !this.isRemovableLink(child)))
    )
      return false;
    await this.directoryAccess?.mutate([
      ...children.map(child => ({ op: 'delete', key: child.id })),
      { op: 'delete', key: nodeId },
    ]);
    return true;
  }

  async moveNodeAuthorized(
    nodeId: string,
    parentId: string | null,
    index: string
  ) {
    await this.prepareAuthorizedMutation();
    if (!this.filtered) return this.moveNode(nodeId, parentId, index);
    const node = this.getNode(nodeId);
    if (!node) throw new Error('Node not found');
    if (parentId) {
      if (nodeId === parentId || this.isAncestor(parentId, nodeId))
        throw new Error('Cannot move a folder into itself or its descendant');
      if (this.getNode(parentId)?.type !== 'folder')
        throw new Error('Parent folder not found');
    } else if (node.type !== 'folder')
      throw new Error('Root node can only have folders');
    const existing =
      node.type !== 'folder'
        ? this.filteredItems().find(
            item =>
              item.id !== nodeId &&
              item.parentId === parentId &&
              item.type === node.type &&
              item.data === node.data
          )
        : undefined;
    if (existing) {
      await this.directoryAccess?.mutate([{ op: 'delete', key: nodeId }]);
      return existing.id;
    }
    await this.directoryAccess?.mutate([
      {
        op: 'upsert',
        key: nodeId,
        values: { type: node.type, data: node.data, parentId, index },
      },
    ]);
    return nodeId;
  }

  orderRevision(folderId: string) {
    const state = this.directoryAccess?.state$.value;
    if (state && state.mode !== 'local') return state.revision;
    return JSON.stringify(
      this.dbService.db.folders
        .find({ parentId: folderId })
        .sort((a, b) => compareNodeIds(a.id, b.id))
    );
  }

  async reorderChildren(
    folderId: string,
    nodeIds: string[],
    expectedOrder: string[],
    expectedRevision?: string
  ) {
    await this.prepareAuthorizedMutation();
    const selected = new Set(nodeIds);
    if (
      !nodeIds.length ||
      nodeIds.length > 10_000 ||
      selected.size !== nodeIds.length ||
      expectedOrder.length !== nodeIds.length ||
      new Set(expectedOrder).size !== expectedOrder.length ||
      expectedOrder.some(id => !selected.has(id))
    )
      throw new Error('Invalid folder order');
    if (
      this.directoryAccess &&
      this.directoryAccess.state$.value.mode !== 'local'
    ) {
      const revision = await this.directoryAccess.reorder(
        folderId,
        nodeIds,
        expectedOrder,
        expectedRevision
      );
      // Full-sync workspaces read the CRDT table. Wait for the committed order
      // before switching the view from automatic to manual.
      await firstValueFrom(
        this.watchNodeChildren(folderId).pipe(
          map(rows =>
            rows
              .filter(row => selected.has(row.id))
              .sort(
                (a, b) =>
                  compareNodeIds(a.index, b.index) || compareNodeIds(a.id, b.id)
              )
              .map(row => row.id)
          ),
          filter(ids => JSON.stringify(ids) === JSON.stringify(nodeIds)),
          timeout({ first: 15_000 })
        )
      );
      return revision;
    }
    if (expectedRevision && expectedRevision !== this.orderRevision(folderId))
      throw new Error('Folder changed; refresh before reordering');
    const folder = this.getNode(folderId);
    if (!folder || folder.type !== 'folder')
      throw new Error('Folder not found');
    const siblings = this.dbService.db.folders
      .find({ parentId: folderId })
      .sort(
        (a, b) => compareNodeIds(a.index, b.index) || compareNodeIds(a.id, b.id)
      );
    const previous = siblings
      .filter(row => selected.has(row.id))
      .map(row => row.id);
    if (JSON.stringify(previous) !== JSON.stringify(expectedOrder))
      throw new Error('Folder changed; refresh before reordering');
    let offset = 0;
    const indices = new Map<string, string>();
    for (let slot = 0; slot < siblings.length; ) {
      if (!selected.has(siblings[slot].id)) {
        slot++;
        continue;
      }
      let end = slot;
      while (end < siblings.length && selected.has(siblings[end].id)) end++;
      let before = slot ? siblings[slot - 1].index : null;
      const after = end < siblings.length ? siblings[end].index : null;
      for (; slot < end; slot++) {
        before = generateFractionalIndexingKeyBetween(before, after);
        indices.set(nodeIds[offset++], before);
      }
    }
    this.dbService.transact('folders', () => {
      for (const [id, index] of indices)
        this.dbService.db.folders.update(id, { index });
    });
    return this.orderRevision(folderId);
  }

  private getNode(id: string) {
    const state = this.directoryAccess?.state$.value;
    return !state || state.mode === 'local' || state.mode === 'full'
      ? this.dbService.db.folders.get(id)
      : state.mode === 'filtered'
        ? (state.items.find(item => item.id === id) ?? null)
        : null;
  }

  private assertLocalMutation() {
    const state = this.directoryAccess?.state$.value;
    if (state && state.mode !== 'local' && state.mode !== 'full')
      throw new Error(
        'Directory changes require an authorized server operation'
      );
  }

  isAncestor(childId: string, ancestorId: string): boolean {
    if (childId === ancestorId) {
      return false;
    }
    const history = new Set<string>([childId]);
    let current: string = childId;
    while (current) {
      const info = this.getNode(current);
      if (info === null || !info.parentId) {
        return false;
      }
      current = info.parentId;
      if (history.has(current)) {
        return false; // loop detected
      }
      history.add(current);
      if (current === ancestorId) {
        return true;
      }
    }
    return false;
  }

  createLink(
    parentId: string,
    type: 'doc' | 'tag' | 'collection',
    nodeId: string,
    index: string
  ) {
    this.assertLocalMutation();
    const parent = this.dbService.db.folders.get(parentId);
    if (parent === null || parent.type !== 'folder') {
      throw new Error('Parent folder not found');
    }

    const existing = this.dbService.db.folders.find({
      parentId,
      type,
      data: nodeId,
    })[0];
    if (existing) {
      return existing.id;
    }

    return this.dbService.db.folders.create({
      parentId,
      type,
      data: nodeId,
      index: index,
    }).id;
  }

  renameNode(nodeId: string, name: string) {
    name = validFolderName(name);
    this.assertLocalMutation();
    const node = this.dbService.db.folders.get(nodeId);
    if (node === null) {
      throw new Error('Node not found');
    }
    if (node.type !== 'folder') {
      throw new Error('Cannot rename non-folder node');
    }
    this.dbService.db.folders.update(nodeId, {
      data: name,
    });
  }

  createFolder(parentId: string | null, name: string, index: string) {
    name = validFolderName(name);
    this.assertLocalMutation();
    if (parentId) {
      const parent = this.dbService.db.folders.get(parentId);
      if (parent === null || parent.type !== 'folder') {
        throw new Error('Parent folder not found');
      }
    }

    return this.dbService.db.folders.create({
      parentId: parentId,
      type: 'folder',
      data: name,
      index: index,
      defaultSortMode: 'name-desc',
    }).id;
  }

  removeFolder(folderId: string) {
    this.assertLocalMutation();
    const info = this.dbService.db.folders.get(folderId);
    if (info === null || info.type !== 'folder') {
      throw new Error('Folder not found');
    }
    const children = this.dbService.db.folders.find({ parentId: folderId });
    if (
      this.loading$.value ||
      children.some(child => !this.isRemovableLink(child))
    ) {
      return false;
    }
    // Only discard hidden links after checking every child. Documents stay in trash;
    // restoring them preserves links in any folders that still exist.
    children.forEach(child => this.dbService.db.folders.delete(child.id));
    this.dbService.db.folders.delete(folderId);
    return true;
  }

  removeLink(linkId: string) {
    this.assertLocalMutation();
    const link = this.dbService.db.folders.get(linkId);
    if (link === null || link.type === 'folder') {
      throw new Error('Link not found');
    }
    this.dbService.db.folders.delete(linkId);
  }

  moveNode(nodeId: string, parentId: string | null, index: string) {
    this.assertLocalMutation();
    const node = this.dbService.db.folders.get(nodeId);
    if (node === null) {
      throw new Error('Node not found');
    }

    if (parentId) {
      if (nodeId === parentId) {
        throw new Error('Cannot move a node to itself');
      }
      if (this.isAncestor(parentId, nodeId)) {
        throw new Error('Cannot move a node to its descendant');
      }
      const parent = this.dbService.db.folders.get(parentId);
      if (parent === null || parent.type !== 'folder') {
        throw new Error('Parent folder not found');
      }
    } else {
      if (node.type !== 'folder') {
        throw new Error('Root node can only have folders');
      }
    }

    if (parentId && node.type !== 'folder') {
      const existing = this.dbService.db.folders
        .find({
          parentId,
          type: node.type,
          data: node.data,
        })
        .find(candidate => candidate.id !== nodeId);
      if (existing) {
        this.dbService.db.folders.delete(nodeId);
        return existing.id;
      }
    }

    this.dbService.db.folders.update(nodeId, {
      parentId,
      index,
    });
    return nodeId;
  }
}
