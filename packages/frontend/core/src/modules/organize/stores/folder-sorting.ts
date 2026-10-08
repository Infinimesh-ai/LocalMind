import { LiveData, Store } from '@toeverything/infra';
import { map, of, switchMap } from 'rxjs';

import type { WorkspaceServerService } from '../../cloud';
import type { CollectionService } from '../../collection';
import type { WorkspaceDBService } from '../../db';
import type { DocsService } from '../../doc';
import type { DocDisplayMetaService } from '../../doc-display-meta';
import type { TagService } from '../../tag';
import { UserspaceService as UserDBService } from '../../userspace/services/userspace';
import type { WorkspaceService } from '../../workspace';
import type { WorkspaceResourcesService } from '../../workspace-resources';
import type { FolderSortMode } from '../folder-sorting';

/** Personal display preferences never change the shared directory indices. */
export class FolderSortingStore extends Store {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly serverService: WorkspaceServerService,
    private readonly dbService: WorkspaceDBService,
    private readonly docsService: DocsService,
    private readonly tagsService: TagService,
    private readonly collectionsService: CollectionService,
    private readonly resourcesService: WorkspaceResourcesService,
    private readonly docDisplayMetaService?: DocDisplayMetaService
  ) {
    super();
  }

  private readonly userDB$ = LiveData.from(
    this.serverService.server$.pipe(
      switchMap(server =>
        server ? server.scope.get(UserDBService).currentUserDB.db$ : of(null)
      )
    ),
    null
  );

  readonly ready$ = LiveData.computed(get => {
    if (this.workspaceService.workspace.flavour === 'local')
      return get(get(this.dbService.userdataDB$).settings.isReady$);
    const db = get(this.userDB$);
    return db
      ? (get(db.folderSortPreference.docSyncState$)?.loaded ?? false)
      : false;
  });

  private key(folderId: string) {
    return JSON.stringify([this.workspaceService.workspace.id, folderId]);
  }

  watchMode(folderId: string) {
    const key = this.key(folderId);
    return this.workspaceService.workspace.flavour === 'local'
      ? this.dbService.userdataDB$.pipe(
          switchMap(db => db.settings.get$(`folder-sort:${key}`)),
          // Local settings use the same bounded enum as synchronized preferences.
          map(record => this.parseMode(record?.value))
        )
      : this.userDB$.pipe(
          switchMap(db => db?.folderSortPreference.get$(key) ?? of(null)),
          map(record => this.parseMode(record?.mode))
        );
  }

  private parseMode(value: unknown): FolderSortMode | null {
    const mode =
      value && typeof value === 'object' && 'mode' in value
        ? value.mode
        : value;
    return mode === 'name-asc' || mode === 'name-desc' || mode === 'manual'
      ? mode
      : null;
  }

  setMode(folderId: string, mode: FolderSortMode) {
    if (!this.ready$.value) throw new Error('Folder preferences are loading');
    const key = this.key(folderId);
    if (this.workspaceService.workspace.flavour === 'local') {
      const table = this.dbService.userdataDB$.value.settings;
      const settingKey = `folder-sort:${key}`;
      if (table.get(settingKey)) table.update(settingKey, { value: { mode } });
      else table.create({ key: settingKey, value: { mode } });
    } else {
      const table = this.userDB$.value?.folderSortPreference;
      if (!table) throw new Error('Sign in before changing folder preferences');
      if (table.get(key)) table.update(key, { mode });
      else table.create({ key, mode });
    }
  }

  identity() {
    const server = this.serverService.server;
    return JSON.stringify([server?.id, server?.account$.value?.id]);
  }

  private readonly displayTitles = new Map<string, LiveData<string>>();
  readonly titles$ = LiveData.computed(get => {
    const titles = new Map<string, string>();
    const docs = get(this.docsService.list.docsMap$);
    for (const id of this.displayTitles.keys())
      if (!docs.has(id)) this.displayTitles.delete(id);
    for (const [id, doc] of docs) {
      if (get(doc.meta$).trash) continue;
      let title$ = this.displayTitles.get(id);
      if (!title$) {
        title$ = this.docDisplayMetaService?.title$(id) ?? doc.title$;
        this.displayTitles.set(id, title$);
      }
      titles.set(`doc:${id}`, get(title$));
    }
    for (const tag of get(this.tagsService.tagList.tags$))
      titles.set(`tag:${tag.id}`, get(tag.value$));
    for (const collection of get(this.collectionsService.collectionMetas$))
      titles.set(`collection:${collection.id}`, collection.name);
    for (const resource of get(this.resourcesService.active$).items) {
      if (resource.trashedAt) continue;
      titles.set(`${resource.kind}:${resource.id}`, resource.title);
      // Older directory placements can still use a doc node for Office files.
      if (resource.kind === 'office')
        titles.set(`doc:${resource.id}`, resource.title);
    }
    return titles;
  });
}
