import {
  Button,
  Checkbox,
  Input,
  Modal,
  useConfirmModal,
} from '@affine/component';
import {
  createDocExplorerContext,
  DocExplorerContext,
} from '@affine/core/components/explorer/context';
import { DocListItem } from '@affine/core/components/explorer/docs-view/doc-list-item';
import { DocsExplorer } from '@affine/core/components/explorer/docs-view/docs-list';
import {
  QuickDeletePermanently,
  QuickRestore,
} from '@affine/core/components/explorer/docs-view/quick-actions';
import { GraphQLService } from '@affine/core/modules/cloud';
import { DocsService } from '@affine/core/modules/doc';
import { DocsSearchService } from '@affine/core/modules/docs-search';
import { GuardService } from '@affine/core/modules/permissions';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import type { NativeResource } from '@affine/core/modules/workspace-resources';
import { WorkspaceLifecycleService } from '@affine/core/modules/workspace-resources';
import { changeResourceBatch } from '@affine/core/modules/workspace-resources/batch';
import { useWorkspaceResources } from '@affine/core/modules/workspace-resources/use-resources';
import { UserFriendlyError } from '@affine/error';
import {
  changeWorkspaceNativeResourceMutation,
  type WorkspaceTrashedFoldersQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { PageIcon } from '@blocksuite/icons/rc';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@toeverything/infra';
import { nanoid } from 'nanoid';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { WorkspaceCreateMenu } from './create-menu';
import { LifecycleActions } from './lifecycle-actions';
import { dragNativeResource, NativeResourceDropTarget } from './resource-drag';
import * as styles from './resource-explorer.css';
import { WorkspaceNativeActions } from './workspace-actions';

export const nativeKey = (
  item: Pick<NativeResource, 'id' | 'kind' | 'workspaceId'>
) => `native:${item.workspaceId}:${item.kind}:${item.id}`;
export const nativeCategory = (
  item: Pick<NativeResource, 'kind' | 'fileName'>
) =>
  /\.pdf$/i.test(item.fileName)
    ? 'pdf'
    : item.kind === 'office'
      ? 'office'
      : /\.(txt|md|csv|json)$/i.test(item.fileName)
        ? 'text'
        : 'other';
function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function NativeRow({
  resource,
  trash,
}: {
  resource: NativeResource;
  trash: boolean;
}) {
  const context = useContext(DocExplorerContext);
  const selected = useLiveData(context.selectedDocIds$);
  const view = useLiveData(context.view$);
  const workbench = useService(WorkbenchService).workbench;
  const t = useI18n();
  const id = nativeKey(resource);
  return (
    <div
      className={view === 'list' ? styles.row : styles.card}
      draggable={!trash && resource.canMove === true}
      onDragStart={event =>
        dragNativeResource(event, {
          workspaceId: resource.workspaceId,
          resourceId: resource.id,
          kind: resource.kind,
        })
      }
    >
      <Checkbox
        aria-label={resource.fileName}
        checked={selected.includes(id)}
        onChange={(_event, value) => {
          context.selectMode$?.next(true);
          context.selectedDocIds$.next(
            value
              ? [...new Set([...context.selectedDocIds$.value, id])]
              : context.selectedDocIds$.value.filter(key => key !== id)
          );
        }}
      />
      <button
        className={styles.open}
        onClick={() =>
          resource.kind === 'office'
            ? workbench.openOffice(resource.id)
            : workbench.openNativeFile(resource.id)
        }
      >
        <PageIcon />
        <span className={styles.name} title={resource.fileName}>
          {resource.fileName}
        </span>
      </button>
      <span className={styles.metadata}>
        {resource.fileName.split('.').at(-1)?.toUpperCase()}
      </span>
      <span className={styles.metadata}>
        {new Date(
          trash
            ? (resource.trashedAt ?? resource.updatedAt)
            : resource.updatedAt
        ).toLocaleDateString()}
      </span>
      {trash && (
        <span
          className={styles.metadata}
          title={resource.folderPaths.join('; ')}
        >
          {resource.folderPaths
            .map(path => path || t['com.affine.localmind.native-files.root']())
            .join('; ')}
        </span>
      )}
      <WorkspaceNativeActions
        compact
        workspaceId={resource.workspaceId}
        resourceId={resource.id}
        kind={resource.kind}
        title={resource.fileName}
        trashed={trash}
        capabilities={resource}
        onChanged={() => {}}
      />
      {resource.searchStatus === 'pending' && (
        <span
          className={styles.metadata}
          title={t['com.affine.localmind.native-files.indexPending']()}
        >
          …
        </span>
      )}
    </div>
  );
}

function TrashedDocRow({ id }: { id: string }) {
  const docs = useService(DocsService).list;
  const doc = useLiveData(docs.doc$(id));
  const meta = useLiveData(doc?.meta$);
  const context = useContext(DocExplorerContext);
  const selected = useLiveData(context.selectedDocIds$);
  const workbench = useService(WorkbenchService).workbench;
  const lifecycle = useService(WorkspaceLifecycleService);
  const t = useI18n();
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    if (lifecycle.online)
      lifecycle
        .get('doc', id)
        .then(resource => {
          if (active) setPaths(resource.originalPaths);
        })
        .catch(() => {
          if (active) setPaths([]);
        });
    return () => {
      active = false;
    };
  }, [id, lifecycle, meta]);
  if (!doc) return null;
  return (
    <div className={styles.row}>
      <Checkbox
        aria-label={meta?.title || t['Untitled']()}
        checked={selected.includes(id)}
        onChange={(_event, checked) => {
          context.selectMode$?.next(true);
          context.selectedDocIds$.next(
            checked
              ? [...new Set([...context.selectedDocIds$.value, id])]
              : context.selectedDocIds$.value.filter(item => item !== id)
          );
        }}
      />
      <button className={styles.open} onClick={() => workbench.openDoc(id)}>
        <PageIcon />
        <span className={styles.name}>{meta?.title || t['Untitled']()}</span>
      </button>
      <span className={styles.metadata}>{t['Page']()}</span>
      <span className={styles.metadata}>
        {meta?.trashDate ? new Date(meta.trashDate).toLocaleDateString() : ''}
      </span>
      <span className={styles.metadata} title={paths.join('; ')}>
        {paths
          .map(path => path || t['com.affine.localmind.native-files.root']())
          .join('; ')}
      </span>
      <QuickRestore doc={doc} />
      <QuickDeletePermanently doc={doc} />
    </div>
  );
}

export function WorkspaceResourceExplorer({
  trash = false,
}: {
  trash?: boolean;
}) {
  const source = useContext(DocExplorerContext);
  const docGroups = useLiveData(source.groups$);
  const preference = useLiveData(source.displayPreference$);
  const docs = useService(DocsService).list;
  const docsSearch = useService(DocsSearchService);
  const [matchingDocs, setMatchingDocs] = useState(new Set<string>());
  const [droppedFiles, setDroppedFiles] = useState<File[]>();
  const guard = useService(GuardService);
  const graphql = useServiceOptional(GraphQLService);
  const workspace = useService(WorkspaceService).workspace;
  const workspaceId = workspace.id;
  const removeLocalDoc = (id: string) => workspace.docCollection.removeDoc(id);
  const lifecycle = useService(WorkspaceLifecycleService);
  const catalog = useWorkspaceResources(trash);
  const t = useI18n();
  const [context] = useState(() => createDocExplorerContext(preference));
  const selected = useLiveData(context.selectedDocIds$);
  const visibleGroups = useLiveData(context.groups$);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [folders, setFolders] = useState<
    WorkspaceTrashedFoldersQuery['workspaceTrashedFolders']
  >([]);
  const [folderError, setFolderError] = useState(false);
  const [previewFolderId, setPreviewFolderId] = useState<string | null>(null);
  const previewFolder = folders.find(folder => folder.id === previewFolderId);
  const changes = useLiveData(lifecycle.changes$);
  useEffect(() => {
    if (!trash || !lifecycle.online) return;
    const controller = new AbortController();
    setFolderError(false);
    void lifecycle
      .folders(controller.signal)
      .then(rows => {
        if (!controller.signal.aborted) setFolders(rows);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFolders([]);
          setFolderError(true);
        }
      });
    return () => controller.abort();
  }, [lifecycle, trash, changes, catalog.items]);
  const folderMap = useMemo(
    () => new Map(folders.map(row => [`folder:${workspaceId}:${row.id}`, row])),
    [folders, workspaceId]
  );
  const [queryItems, setQueryItems] = useState<NativeResource[] | null>(null);
  const [queryError, setQueryError] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [result, setResult] = useState('');
  const [capabilities, setCapabilities] = useState<
    Record<string, { restore: boolean; remove: boolean }>
  >({});
  const [failureNames, setFailureNames] = useState<string[]>([]);
  const requests = useRef(new Map<string, { key: string; version: number }>());
  const { openConfirmModal } = useConfirmModal();
  const nativeItems = useMemo(
    () =>
      queryItems
        ? queryItems.filter(item =>
            catalog.items.some(
              current => nativeKey(current) === nativeKey(item)
            )
          )
        : catalog.items,
    [queryItems, catalog.items]
  );
  useEffect(() => {
    setMatchingDocs(new Set());
    if (!search.trim()) return;
    const subscription = docsSearch
      .search$(
        search.trim(),
        workspace.flavour === 'local' ? 'local' : 'remote',
        10000
      )
      .subscribe({
        next: rows => setMatchingDocs(new Set(rows.map(row => row.docId))),
        error: () => setQueryError(true),
      });
    return () => subscription.unsubscribe();
  }, [search, workspace.flavour, docsSearch]);
  const byKey = useMemo(
    () => new Map(nativeItems.map(item => [nativeKey(item), item])),
    [nativeItems]
  );
  useEffect(
    () => context.displayPreference$.next(preference),
    [context, preference]
  );
  useEffect(() => {
    const controller = new AbortController();
    setQueryError(false);
    setQueryItems(null);
    if (!search.trim() || !catalog.service.online) {
      setQueryLoading(false);
      return;
    }
    setQueryLoading(true);
    const timer = setTimeout(() => {
      void catalog.service
        .list(search.trim(), trash, controller.signal)
        .then(items => {
          if (!controller.signal.aborted) setQueryItems(items);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setQueryItems([]);
            setQueryError(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setQueryLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [catalog.items, catalog.service, search, trash]);
  useEffect(() => {
    const query = search.toLocaleLowerCase();
    const nativeIds = new Set(catalog.items.map(item => item.id));
    const groups = new Map<string, string[]>();
    for (const group of docGroups)
      groups.set(
        group.key,
        type !== 'all' && type !== 'doc'
          ? []
          : group.items.filter(
              id =>
                !nativeIds.has(id) &&
                (!query ||
                  matchingDocs.has(id) ||
                  (docs.doc$(id).value?.title$.value ?? '')
                    .toLocaleLowerCase()
                    .includes(query))
            )
      );
    const groupKey = preference.groupBy?.key;
    for (const item of nativeItems) {
      if (type !== 'all' && type !== nativeCategory(item)) continue;
      if (query && queryItems === null) continue;
      const group = !groupKey
        ? (docGroups[0]?.key ?? '')
        : groupKey === 'createdAt' || groupKey === 'updatedAt'
          ? dateKey(item[groupKey])
          : '';
      groups.set(group, [...(groups.get(group) ?? []), nativeKey(item)]);
    }
    for (const [id, folder] of folderMap) {
      if (
        type !== 'all' ||
        (query && !folder.title.toLocaleLowerCase().includes(query))
      )
        continue;
      const group = !groupKey
        ? (docGroups[0]?.key ?? '')
        : folder.trashedAt
          ? dateKey(folder.trashedAt)
          : '';
      groups.set(group, [...(groups.get(group) ?? []), id]);
    }
    const order = preference.orderBy?.key ?? 'updatedAt';
    const value = (id: string) => {
      const folder = folderMap.get(id);
      if (folder)
        return order === 'title'
          ? folder.title
          : Date.parse(folder.trashedAt ?? '1970-01-01');
      const native = byKey.get(id);
      const doc = docs.doc$(id).value;
      return order === 'title'
        ? (native?.title ?? doc?.title$.value ?? '')
        : native
          ? Date.parse(
              order === 'createdAt' ? native.createdAt : native.updatedAt
            )
          : ((order === 'createdAt'
              ? doc?.createdAt$.value
              : doc?.updatedAt$.value) ?? 0);
    };
    const direction = preference.orderBy?.desc === false ? 1 : -1;
    const result = [...groups]
      .filter(([, ids]) => ids.length)
      .map(([key, items]) => ({
        key,
        items: items.sort((a, b) => {
          const x = value(a),
            y = value(b);
          return (x < y ? -1 : x > y ? 1 : 0) * direction || a.localeCompare(b);
        }),
      }));
    if (groupKey === 'createdAt' || groupKey === 'updatedAt')
      result.sort((a, b) => b.key.localeCompare(a.key));
    context.groups$.next(result);
  }, [
    docGroups,
    nativeItems,
    catalog.items,
    type,
    search,
    queryItems,
    docs,
    preference,
    context,
    byKey,
    folderMap,
    matchingDocs,
  ]);
  useEffect(() => {
    let current = true;
    void Promise.all(
      selected.map(async id => {
        const native = byKey.get(id),
          folder = folderMap.get(id);
        if (native || folder) {
          const resource = native ?? folder;
          return [
            id,
            {
              restore: !!resource?.canRestore,
              remove: trash
                ? !!resource?.canDeletePermanently
                : !!resource?.canTrash,
            },
          ] as const;
        }
        const [restore, remove] = await Promise.all([
          guard.can('Doc_Restore', id),
          guard.can(trash ? 'Doc_Delete' : 'Doc_Trash', id),
        ]);
        return [id, { restore, remove }] as const;
      })
    )
      .then(rows => {
        if (current) setCapabilities(Object.fromEntries(rows));
      })
      .catch(() => {
        if (current) setCapabilities({});
      });
    return () => {
      current = false;
    };
  }, [selected, byKey, folderMap, guard, trash]);
  const bulk = async (action: 'trash' | 'restore' | 'delete') => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const { succeeded, failed } = await changeResourceBatch(
        selected,
        async id => {
          try {
            const native = catalog.items.find(item => nativeKey(item) === id);
            const folder = folderMap.get(id);
            if (folder) {
              await lifecycle.change('folder', folder.id, action);
            } else if (native) {
              const allowed =
                action === 'trash'
                  ? native.canTrash
                  : action === 'restore'
                    ? native.canRestore
                    : native.canDeletePermanently;
              if (!allowed || !graphql) throw new Error('Unavailable');
              const requestId = `${action}:${id}`;
              const request = requests.current.get(requestId) ?? {
                key: nanoid(),
                version: native.metadataVersion,
              };
              requests.current.set(requestId, request);
              await graphql.gql({
                query: changeWorkspaceNativeResourceMutation,
                variables: {
                  input: {
                    workspaceId,
                    resourceId: native.id,
                    kind: native.kind,
                    action,
                    requestKey: request.key,
                    expectedVersion: request.version,
                  },
                },
              });
              requests.current.delete(requestId);
            } else {
              if (id.startsWith('native:') || id.startsWith('folder:'))
                throw new Error('Resource no longer available');
              if (
                !(await guard.can(
                  action === 'trash'
                    ? 'Doc_Trash'
                    : action === 'restore'
                      ? 'Doc_Restore'
                      : 'Doc_Delete',
                  id
                ))
              )
                throw new Error('Unavailable');
              await lifecycle.change('doc', id, action, () => {
                const doc = docs.doc$(id).value;
                if (!doc) throw new Error('Document unavailable');
                if (action === 'delete') removeLocalDoc(id);
                else
                  doc.setMeta({
                    trash: action === 'trash',
                    trashDate: action === 'trash' ? Date.now() : undefined,
                  });
              });
            }
          } catch (error) {
            if (
              [400, 403, 404, 409].includes(
                UserFriendlyError.fromAny(error).status
              )
            )
              requests.current.delete(`${action}:${id}`);
            throw error;
          }
        }
      );
      setFailureNames(
        failed.map(
          id =>
            byKey.get(id)?.fileName ??
            folderMap.get(id)?.title ??
            docs.doc$(id).value?.title$.value ??
            t['com.affine.localmind.resources.unavailable']()
        )
      );
      context.selectedDocIds$.next(failed);
      context.selectMode$?.next(failed.length > 0);
      setResult(
        t['com.affine.localmind.resources.batchResult']({
          success: String(succeeded.length),
          failed: String(failed.length),
        })
      );
      catalog.service.invalidate();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const confirm = (action: 'trash' | 'restore' | 'delete') => {
    if (selected.length > 100) {
      setResult(t['com.affine.localmind.resources.batchLimit']());
      return;
    }
    if (action === 'restore') {
      void bulk(action).catch(() =>
        setResult(t['com.affine.localmind.project-files.operationFailed']())
      );
      return;
    }
    openConfirmModal({
      title:
        action === 'delete'
          ? t['com.affine.localmind.native-files.delete']()
          : t['com.affine.localmind.resources.moveToTrash'](),
      description:
        action === 'delete'
          ? t['com.affine.localmind.native-files.deleteWarning']()
          : t['com.affine.moveToTrash.confirmModal.title.multiple']({
              number: String(selected.length),
            }),
      confirmText: t['Delete'](),
      cancelText: t['Cancel'](),
      confirmButtonOptions: { variant: 'error' },
      onConfirm: () => bulk(action),
    });
  };
  const renderItem = useCallback(
    (id: string, groupId: string) => {
      const folder = folderMap.get(id);
      if (folder)
        return (
          <div className={styles.row}>
            <Checkbox
              aria-label={folder.title}
              checked={selected.includes(id)}
              onChange={(_event, value) => {
                context.selectMode$?.next(true);
                context.selectedDocIds$.next(
                  value
                    ? [...new Set([...context.selectedDocIds$.value, id])]
                    : context.selectedDocIds$.value.filter(key => key !== id)
                );
              }}
            />
            <button
              className={styles.open}
              onClick={() => setPreviewFolderId(folder.id)}
            >
              <span className={styles.name}>{folder.title}</span>
            </button>
            <LifecycleActions
              kind="folder"
              resourceId={folder.id}
              title={folder.title}
            />
          </div>
        );
      const item = byKey.get(id);
      return item ? (
        <NativeRow resource={item} trash={trash} />
      ) : trash ? (
        <TrashedDocRow id={id} />
      ) : (
        <DocListItem docId={id} groupId={groupId} />
      );
    },
    [byKey, trash, folderMap, selected, context]
  );
  return (
    <DocExplorerContext.Provider value={context}>
      <NativeResourceDropTarget folderId={null} disabled={trash}>
        <Modal
          open={!!previewFolder}
          title={previewFolder?.title}
          onOpenChange={open => {
            if (!open) setPreviewFolderId(null);
          }}
        >
          <ul>
            {previewFolder?.children.map(child => (
              <li key={`${child.kind}:${child.id}`}>
                {child.title} · {child.kind}
              </li>
            ))}
          </ul>
          {previewFolder?.childrenTruncated && (
            <p>{t['com.affine.localmind.resources.previewLimit']()}</p>
          )}
        </Modal>
        <div
          className={styles.root}
          onDragOver={event => {
            if (!trash && event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={event => {
            if (!trash && event.dataTransfer.files.length) {
              event.preventDefault();
              event.stopPropagation();
              setDroppedFiles(Array.from(event.dataTransfer.files));
            }
          }}
        >
          {!trash && (
            <WorkspaceCreateMenu
              uploadOnly
              droppedFiles={droppedFiles}
              onPage={() => {}}
              onEdgeless={() => {}}
            />
          )}
          <div className={styles.toolbar}>
            <Input
              value={search}
              onChange={setSearch}
              placeholder={t['com.affine.localmind.native-files.search']()}
              aria-label={t['com.affine.localmind.native-files.search']()}
            />
            <select
              className={styles.select}
              value={type}
              aria-label={t['com.affine.localmind.resources.type']()}
              onChange={event => setType(event.target.value)}
            >
              {['all', 'doc', 'office', 'pdf', 'text', 'other'].map(value => (
                <option key={value} value={value}>
                  {t[`com.affine.localmind.resources.type.${value}`]()}
                </option>
              ))}
            </select>
            {(catalog.loading || queryLoading) && (
              <span role="status">{t['Loading']()}</span>
            )}
          </div>
          {(catalog.error || queryError || folderError) && (
            <div className={styles.toolbar} role="alert">
              {t['com.affine.localmind.project-files.operationFailed']()}
              <Button onClick={() => catalog.service.invalidate()}>
                {t['com.affine.error.retry']()}
              </Button>
            </div>
          )}
          {result && (
            <div className={styles.toolbar} role="status">
              {result}
              {!!failureNames.length && (
                <ul>
                  {failureNames.map((name, index) => (
                    <li key={index}>{name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className={styles.results}>
            {!visibleGroups.some(group => group.items.length) ? (
              <div className={styles.toolbar} role="status">
                {catalog.loading || queryLoading || !catalog.ready
                  ? t['Loading']()
                  : catalog.error || queryError || folderError
                    ? ''
                    : t['com.affine.localmind.resources.empty']()}
              </div>
            ) : (
              <DocsExplorer
                renderItem={renderItem}
                toolbar={
                  selected.length > 0 ? (
                    <div className={styles.toolbar}>
                      {selected.some(id => !capabilities[id]?.remove) && (
                        <span>
                          {t[
                            'com.affine.localmind.resources.batchUnavailable'
                          ]()}
                        </span>
                      )}
                      <span>
                        {t['com.affine.localmind.resources.selectedCount']({
                          count: String(selected.length),
                        })}
                      </span>
                      {trash && (
                        <Button
                          disabled={
                            pending ||
                            !selected.some(id => capabilities[id]?.restore)
                          }
                          onClick={() => confirm('restore')}
                        >
                          {t['com.affine.localmind.native-files.restore']()}
                        </Button>
                      )}
                      <Button
                        disabled={
                          pending ||
                          !selected.some(id => capabilities[id]?.remove)
                        }
                        onClick={() => confirm(trash ? 'delete' : 'trash')}
                      >
                        {trash
                          ? t['com.affine.localmind.native-files.delete']()
                          : t['com.affine.localmind.resources.moveToTrash']()}
                      </Button>
                      <Button
                        disabled={pending}
                        onClick={() => {
                          context.selectedDocIds$.next([]);
                          context.selectMode$?.next(false);
                        }}
                      >
                        {t['Cancel']()}
                      </Button>
                    </div>
                  ) : null
                }
              />
            )}
          </div>
        </div>
      </NativeResourceDropTarget>
    </DocExplorerContext.Provider>
  );
}
