import {
  Button,
  Checkbox,
  Input,
  Modal,
  useConfirmModal,
} from '@affine/component';
import { Menu, MenuItem, MenuTrigger } from '@affine/component/ui/menu';
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
import type { FilterParams } from '@affine/core/modules/collection-rules';
import { DocsService } from '@affine/core/modules/doc';
import { DocDisplayMetaService } from '@affine/core/modules/doc-display-meta';
import { DocsSearchService } from '@affine/core/modules/docs-search';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import { GuardService } from '@affine/core/modules/permissions';
import { TagService } from '@affine/core/modules/tag';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import type { NativeResource } from '@affine/core/modules/workspace-resources';
import { WorkspaceLifecycleService } from '@affine/core/modules/workspace-resources';
import { changeResourceBatch } from '@affine/core/modules/workspace-resources/batch';
import { useWorkspaceResources } from '@affine/core/modules/workspace-resources/use-resources';
import { UserFriendlyError } from '@affine/error';
import {
  changeWorkspaceNativeResourceMutation,
  resourceDate,
  workspaceDocumentTypes,
  workspaceResourceIdentity,
  type WorkspaceTrashedFoldersQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  AllDocsIcon,
  AttachmentIcon,
  ExportToPdfIcon,
  FileIcon,
  FilterIcon,
  PageIcon,
  PresentationIcon,
  TextIcon,
} from '@blocksuite/icons/rc';
import type { DeckSourceRef } from '@localmind/office/report-deck';
import {
  LiveData,
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

import { PlainTextDocGroupHeader } from '../explorer/docs-view/group-header';
import { resourceSortFields } from '../explorer/resource-preferences';
import { useCreatedResourceSelection } from '../page-tree/created-resource';
import {
  useOpenReportDeck,
  useReportDeckEntryAvailable,
} from '../report-deck-entry';
import { WorkspaceCreateMenu } from './create-menu';
import { LifecycleActions } from './lifecycle-actions';
import { dragNativeResource, NativeResourceDropTarget } from './resource-drag';
import * as styles from './resource-explorer.css';
import {
  groupWorkspaceResources,
  matchesResourceTags,
  type ResourceDisplayRecord,
} from './resource-groups';
import { ResourceListLayout } from './resource-list-layout';
import {
  ResourceActor,
  ResourceInlineTags,
  ResourceMetadata,
} from './resource-metadata';
import {
  MixedDocRow,
  NativeTags,
  ResourceRowShell,
  ResourceTypeIcon,
} from './resource-rows';
import { ResourceSelectionModeContext } from './resource-selection-context';
import { type NamedTagTarget, ResourceTagDialog } from './resource-tag-dialog';
import { WorkspaceNativeActions } from './workspace-actions';

const EMPTY_FILTERS: FilterParams[] = [];
const resourceTypes = [
  { value: 'all', Icon: AllDocsIcon },
  { value: 'doc', Icon: PageIcon },
  { value: 'office', Icon: FileIcon },
  { value: 'pdf', Icon: ExportToPdfIcon },
  { value: 'text', Icon: TextIcon },
  { value: 'other', Icon: AttachmentIcon },
] as const;
type ResourceType = (typeof resourceTypes)[number]['value'];

export const nativeKey = (
  item: Pick<NativeResource, 'id' | 'kind' | 'workspaceId'>
) => `native:${item.workspaceId}:${item.kind}:${item.id}`;
export const nativeCategory = (item: Pick<NativeResource, 'documentType'>) =>
  item.documentType === 'pdf'
    ? 'pdf'
    : ['docx', 'xlsx', 'pptx'].includes(item.documentType)
      ? 'office'
      : ['txt', 'markdown', 'csv', 'json'].includes(item.documentType)
        ? 'text'
        : 'other';
function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function NativeRow({
  resource,
  trash,
}: {
  resource: NativeResource;
  trash: boolean;
}) {
  const context = useContext(DocExplorerContext);
  const selected = useLiveData(context.selectedDocIds$);
  const contextSelectMode = !!useLiveData(context.selectMode$);
  const explicitSelection = useContext(ResourceSelectionModeContext);
  const selectMode = explicitSelection && contextSelectMode;
  const [editingTags, setEditingTags] = useState(false);
  const operationRef = useRef<HTMLButtonElement>(null);
  const view = useLiveData(context.view$);
  const preference = useLiveData(context.displayPreference$);
  const workbench = useService(WorkbenchService).workbench;
  const t = useI18n();
  const id = nativeKey(resource);
  if (!trash && preference.resourceProperties)
    return (
      <div
        style={{ height: '100%' }}
        draggable={!selectMode && resource.canMove === true}
        onDragStart={event =>
          dragNativeResource(event, {
            workspaceId: resource.workspaceId,
            resourceId: resource.id,
            kind: resource.kind,
          })
        }
      >
        <ResourceRowShell
          id={id}
          title={resource.fileName}
          tags={
            <ResourceInlineTags empty={!resource.tags.length}>
              <NativeTags resource={resource} />
            </ResourceInlineTags>
          }
          icon={<ResourceTypeIcon type={resource.documentType} />}
          onOpen={() =>
            resource.kind === 'office'
              ? workbench.openOffice(resource.id)
              : workbench.openNativeFile(resource.id)
          }
          actions={
            preference.showMoreOperation ? (
              <WorkspaceNativeActions
                triggerRef={operationRef}
                compact
                workspaceId={resource.workspaceId}
                resourceId={resource.id}
                kind={resource.kind}
                title={resource.fileName}
                trashed={false}
                capabilities={resource}
                onChanged={() => {}}
                additionalItems={
                  <MenuItem
                    disabled={!resource.canEditTags}
                    onSelect={() => setEditingTags(true)}
                  >
                    {t['com.affine.localmind.resources.editTags']()}
                  </MenuItem>
                }
              />
            ) : null
          }
        >
          <ResourceMetadata
            properties={preference.resourceProperties}
            tags={resource.tags}
            tagEditor={<NativeTags resource={resource} />}
            createdAt={resourceDate(resource.createdAt)}
            createdBy={resource.createdBy}
            updatedAt={resourceDate(resource.lastUpdatedAt)}
            updatedBy={resource.lastUpdatedBy}
            updateActor={resource.lastUpdateActor}
            documentType={resource.documentType}
            mimeType={resource.mimeType}
          />
        </ResourceRowShell>
        {editingTags && (
          <ResourceTagDialog
            returnFocus={operationRef}
            mode="edit"
            targets={[
              {
                key: id,
                id: resource.id,
                kind: resource.kind,
                title: resource.fileName,
              },
            ]}
            onClose={() => setEditingTags(false)}
          />
        )}
      </div>
    );
  return (
    <div
      className={view === 'list' ? styles.row : styles.card}
      draggable={!selectMode && !trash && resource.canMove === true}
      onDragStart={event =>
        dragNativeResource(event, {
          workspaceId: resource.workspaceId,
          resourceId: resource.id,
          kind: resource.kind,
        })
      }
    >
      {(!explicitSelection || selectMode) && (
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
      )}
      <button
        className={styles.open}
        onClick={() =>
          selectMode
            ? context.selectedDocIds$.next(
                selected.includes(id)
                  ? selected.filter(key => key !== id)
                  : [...selected, id]
              )
            : resource.kind === 'office'
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
      {!selectMode && (
        <WorkspaceNativeActions
          triggerRef={operationRef}
          compact
          workspaceId={resource.workspaceId}
          resourceId={resource.id}
          kind={resource.kind}
          title={resource.fileName}
          trashed={trash}
          capabilities={resource}
          onChanged={() => {}}
          additionalItems={
            !trash && (
              <MenuItem
                disabled={!resource.canEditTags}
                onSelect={() => setEditingTags(true)}
              >
                {t['com.affine.localmind.resources.editTags']()}
              </MenuItem>
            )
          }
        />
      )}
      {resource.searchStatus === 'pending' && (
        <span
          className={styles.metadata}
          title={t['com.affine.localmind.native-files.indexPending']()}
        >
          …
        </span>
      )}
      {editingTags && (
        <ResourceTagDialog
          returnFocus={operationRef}
          mode="edit"
          targets={[
            {
              key: id,
              id: resource.id,
              kind: resource.kind,
              title: resource.fileName,
            },
          ]}
          onClose={() => setEditingTags(false)}
        />
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
  const selectMode = !!useLiveData(context.selectMode$);
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
      {selectMode && (
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
      )}
      <button
        className={styles.open}
        onClick={() =>
          selectMode
            ? context.selectedDocIds$.next(
                selected.includes(id)
                  ? selected.filter(key => key !== id)
                  : [...selected, id]
              )
            : workbench.openDoc(id)
        }
      >
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
      {!selectMode && (
        <>
          <QuickRestore doc={doc} />
          <QuickDeletePermanently doc={doc} />
        </>
      )}
    </div>
  );
}

export function WorkspaceResourceExplorer({
  trash = false,
  filters = EMPTY_FILTERS,
}: {
  trash?: boolean;
  filters?: FilterParams[];
}) {
  const source = useContext(DocExplorerContext);
  const docGroups = useLiveData(source.groups$);
  const preference = useLiveData(source.displayPreference$);
  const docs = useService(DocsService).list;
  const displayMeta = useService(DocDisplayMetaService);
  const resourceDisplay = !!preference.resourceProperties;
  const docsSearch = useService(DocsSearchService);
  const docsAvailable = useLiveData(docs.isAvailable$);
  const [matchingDocs, setMatchingDocs] = useState(new Set<string>());
  const [droppedFiles, setDroppedFiles] = useState<File[]>();
  const guard = useService(GuardService);
  const graphql = useServiceOptional(GraphQLService);
  const workspace = useService(WorkspaceService).workspace;
  const workspaceId = workspace.id;
  const removeLocalDoc = (id: string) => workspace.docCollection.removeDoc(id);
  const lifecycle = useService(WorkspaceLifecycleService);
  const pageTree = useService(WorkspacePageTreeService);
  const catalog = useWorkspaceResources(trash);
  const t = useI18n();
  const untitled = t['Untitled']();
  const [context] = useState(() => createDocExplorerContext(preference));
  useCreatedResourceSelection(context, trash ? undefined : null, workspaceId);
  const selected = useLiveData(context.selectedDocIds$);
  const selectMode = !!useLiveData(context.selectMode$);
  const [tagDialog, setTagDialog] = useState<{
    mode: 'add' | 'remove';
    targets: NamedTagTarget[];
  } | null>(null);
  const selectionToggleRef = useRef<HTMLButtonElement>(null);
  const batchOperationRef = useRef<HTMLButtonElement>(null);
  const visibleGroups = useLiveData(context.groups$);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<
    ResourceType | (typeof workspaceDocumentTypes)[number]
  >('all');
  const [tagFilter, setTagFilter] = useState<string>('');
  const tags = useLiveData(useService(TagService).tagList.tagMetas$);
  const docMetadata = useLiveData(
    useMemo(
      () =>
        LiveData.computed(get =>
          resourceDisplay
            ? get(docs.docs$).map(doc => ({
                id: doc.id,
                meta: get(doc.meta$),
                title: get(displayMeta.title$(doc.id)),
                createdBy: get(doc.createdBy$),
                event: get(doc.displayUpdate$),
                mode: get(doc.primaryMode$),
              }))
            : []
        ),
      [docs, displayMeta, resourceDisplay]
    )
  );
  const visiblePropertyCount = Object.values(
    preference.resourceProperties ?? {}
  ).filter(Boolean).length;
  const itemHeight =
    preference.view === 'list'
      ? 44
      : 64 + visiblePropertyCount * 54 + (preference.showDocPreview ? 40 : 0);
  useEffect(() => {
    if (resourceDisplay) catalog.service.invalidate();
  }, [tags, catalog.service, resourceDisplay]);
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
    Record<string, { restore: boolean; remove: boolean; tags: boolean }>
  >({});
  const [failureNames, setFailureNames] = useState<string[]>([]);
  const requests = useRef(new Map<string, { key: string; version: number }>());
  const { openConfirmModal } = useConfirmModal();
  const reportDeckAvailable = useReportDeckEntryAvailable();
  const openReportDeck = useOpenReportDeck();
  const nativeItems = useMemo(
    () =>
      queryItems
        ? catalog.items.filter(item =>
            queryItems.some(match => nativeKey(match) === nativeKey(item))
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
    if (!trash && preference.resourceProperties) {
      if (
        !docsAvailable ||
        !catalog.ready ||
        catalog.error ||
        queryError ||
        queryLoading
      ) {
        context.groups$.next([]);
        return;
      }
      const allowedDocs = new Set(docGroups.flatMap(group => group.items));
      const nativeIds = new Set(catalog.items.map(item => item.id));
      const knownTags = new Set(tags.map(tag => tag.id));
      const rows: ResourceDisplayRecord[] = [];
      for (const doc of docMetadata) {
        if (!allowedDocs.has(doc.id) || nativeIds.has(doc.id)) continue;
        const title = doc.title || untitled;
        const documentType = doc.mode === 'edgeless' ? 'edgeless' : 'page';
        const tagIds = (doc.meta.tags ?? []).filter(id => knownTags.has(id));
        if (
          (type !== 'all' && type !== documentType) ||
          (tagFilter && !tagIds.includes(tagFilter)) ||
          !matchesResourceTags(tagIds, filters) ||
          (query &&
            !title.toLocaleLowerCase().includes(query) &&
            !matchingDocs.has(doc.id))
        )
          continue;
        rows.push({
          id: doc.id,
          identity: workspaceResourceIdentity(workspaceId, 'doc', doc.id),
          title,
          documentType,
          createdBy: doc.createdBy ?? null,
          createdAt: resourceDate(doc.meta.createDate),
          updatedAt: doc.event?.at ?? resourceDate(doc.meta.updatedDate),
          tagIds,
        });
      }
      for (const item of nativeItems) {
        const tagIds = item.tags
          .map(tag => tag.id)
          .filter(id => knownTags.has(id));
        if (
          (type !== 'all' && type !== item.documentType) ||
          (tagFilter && !tagIds.includes(tagFilter)) ||
          !matchesResourceTags(tagIds, filters) ||
          (query && queryItems === null)
        )
          continue;
        rows.push({
          id: nativeKey(item),
          identity: workspaceResourceIdentity(workspaceId, item.kind, item.id),
          title: item.fileName,
          documentType: item.documentType,
          createdBy: item.createdBy,
          createdAt: resourceDate(item.createdAt),
          updatedAt: resourceDate(item.lastUpdatedAt),
          tagIds,
        });
      }
      const order = resourceSortFields.find(
        key => key === preference.orderBy?.key
      );
      if (!order) {
        context.groups$.next([]);
        return;
      }
      context.groups$.next(
        groupWorkspaceResources(
          rows,
          order,
          preference.orderBy?.desc ?? true,
          preference.groupBy?.key
        )
      );
      return;
    }
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
    docMetadata,
    docsAvailable,
    tags,
    tagFilter,
    filters,
    trash,
    catalog.ready,
    catalog.error,
    queryError,
    queryLoading,
    workspaceId,
    untitled,
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
              tags: !!native?.canEditTags && !trash,
              restore: !!resource?.canRestore,
              remove: trash
                ? !!resource?.canDeletePermanently
                : !!resource?.canTrash,
            },
          ] as const;
        }
        const [restore, remove, tags] = await Promise.all([
          guard.can('Doc_Restore', id),
          guard.can(trash ? 'Doc_Delete' : 'Doc_Trash', id),
          trash ? false : guard.can('Doc_Update', id),
        ]);
        return [id, { restore, remove, tags }] as const;
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
              if (pageTree.enabled$.value) {
                const location = await pageTree.locate(native.kind, native.id);
                if (!location.parent) throw new Error('Unavailable');
                await pageTree.execute({
                  action,
                  nodeId: location.parent.nodeId,
                });
                return;
              }
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
      context.selectMode$?.next(true);
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
  const chooseTags = (mode: 'add' | 'remove') => {
    if (pendingRef.current || !selected.length) return;
    if (selected.length > 100) {
      setResult(t['com.affine.localmind.resources.batchLimit']());
      return;
    }
    setTagDialog({
      mode,
      targets: selected.map(key => {
        const native = catalog.items.find(item => nativeKey(item) === key);
        return native
          ? { key, id: native.id, kind: native.kind, title: native.fileName }
          : {
              key,
              id: key,
              kind: 'doc' as const,
              title:
                docs.doc$(key).value?.title$.value ??
                t['com.affine.localmind.resources.unavailable'](),
            };
      }),
    });
  };
  const presentSelection = () => {
    const sources = selected.flatMap((key): DeckSourceRef[] => {
      const folder = folderMap.get(key);
      if (folder)
        return [
          {
            scopeKind: 'workspace',
            scopeId: workspaceId,
            kind: 'folder',
            resourceId: folder.id,
            title: folder.title,
          },
        ];
      const native = catalog.items.find(item => nativeKey(item) === key);
      if (native)
        return [
          {
            scopeKind: 'workspace',
            scopeId: workspaceId,
            kind: 'file',
            resourceId: native.id,
            title: native.fileName,
          },
        ];
      if (key.startsWith('native:') || key.startsWith('folder:')) return [];
      return [
        {
          scopeKind: 'workspace',
          scopeId: workspaceId,
          kind: 'doc',
          resourceId: key,
          title: docs.doc$(key).value?.title$.value || untitled,
        },
      ];
    });
    if (sources.length) openReportDeck(sources);
  };
  const renderItem = useCallback(
    (id: string, groupId: string) => {
      const folder = folderMap.get(id);
      if (folder)
        return (
          <div className={styles.row}>
            {selectMode && (
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
            )}
            <button
              className={styles.open}
              onClick={() =>
                selectMode
                  ? context.selectedDocIds$.next(
                      selected.includes(id)
                        ? selected.filter(key => key !== id)
                        : [...selected, id]
                    )
                  : setPreviewFolderId(folder.id)
              }
            >
              <span className={styles.name}>{folder.title}</span>
            </button>
            {!selectMode && (
              <LifecycleActions
                kind="folder"
                resourceId={folder.id}
                title={folder.title}
              />
            )}
          </div>
        );
      const item = byKey.get(id);
      return item ? (
        <NativeRow resource={item} trash={trash} />
      ) : trash ? (
        <TrashedDocRow id={id} />
      ) : preference.resourceProperties ? (
        <MixedDocRow id={id} />
      ) : (
        <DocListItem docId={id} groupId={groupId} />
      );
    },
    [
      byKey,
      trash,
      folderMap,
      selected,
      context,
      preference.resourceProperties,
      selectMode,
    ]
  );
  return (
    <DocExplorerContext.Provider value={context}>
      <ResourceSelectionModeContext.Provider value={true}>
        {tagDialog && (
          <ResourceTagDialog
            {...tagDialog}
            returnFocus={batchOperationRef}
            onClose={() => setTagDialog(null)}
            onResult={(succeeded, failed) => {
              context.selectedDocIds$.next(failed);
              context.selectMode$?.next(true);
              setFailureNames(
                tagDialog.targets
                  .filter(item => failed.includes(item.key))
                  .map(item => item.title)
              );
              setResult(
                t['com.affine.localmind.resources.batchResult']({
                  success: String(succeeded.length),
                  failed: String(failed.length),
                })
              );
            }}
          />
        )}
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
            data-select-mode={selectMode}
            onKeyDownCapture={event => {
              if (event.key === 'Escape' && pendingRef.current) {
                event.preventDefault();
                event.stopPropagation();
              } else if (
                event.key === 'Escape' &&
                selectMode &&
                !(
                  event.target instanceof Element &&
                  event.target.closest('[role="menu"], [role="dialog"]')
                )
              ) {
                context.selectedDocIds$.next([]);
                context.selectMode$?.next(false);
                context.prevCheckAnchorId$?.next(null);
                event.preventDefault();
                event.stopPropagation();
                selectionToggleRef.current?.focus();
              }
            }}
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
              <Menu
                contentOptions={{
                  className: styles.typeMenu,
                  align: 'start',
                  collisionPadding: 16,
                  'aria-label': t['com.affine.localmind.resources.type'](),
                }}
                items={(preference.resourceProperties && !trash
                  ? [
                      { value: 'all' as const, Icon: AllDocsIcon },
                      ...workspaceDocumentTypes.map(value => ({
                        value,
                        Icon: () => <ResourceTypeIcon type={value} />,
                      })),
                    ]
                  : resourceTypes
                ).map(({ value, Icon }) => (
                  <MenuItem
                    key={value}
                    className={styles.typeMenuItem}
                    prefixIcon={<Icon />}
                    selected={type === value}
                    role="menuitemradio"
                    aria-checked={type === value}
                    onSelect={() => setType(value)}
                  >
                    {value === 'all' || trash
                      ? t[`com.affine.localmind.resources.type.${value}`]()
                      : t[
                          `com.affine.localmind.resource-display.type.${value}`
                        ]()}
                  </MenuItem>
                ))}
              >
                <MenuTrigger
                  type="button"
                  className={styles.typeFilter}
                  prefix={<FilterIcon />}
                  aria-label={`${t['com.affine.localmind.resources.type']()}: ${type === 'all' || trash ? t[`com.affine.localmind.resources.type.${type}`]() : t[`com.affine.localmind.resource-display.type.${type}`]()}`}
                >
                  {type === 'all' || trash
                    ? t[`com.affine.localmind.resources.type.${type}`]()
                    : t[`com.affine.localmind.resource-display.type.${type}`]()}
                </MenuTrigger>
              </Menu>
              {!trash && preference.resourceProperties && (
                <Menu
                  items={
                    <>
                      <MenuItem
                        role="menuitemradio"
                        aria-checked={!tagFilter}
                        selected={!tagFilter}
                        onSelect={() => setTagFilter('')}
                      >
                        {t['com.affine.localmind.resource-display.allTags']()}
                      </MenuItem>
                      {tags.map(tag => (
                        <MenuItem
                          key={tag.id}
                          role="menuitemradio"
                          selected={tagFilter === tag.id}
                          aria-checked={tagFilter === tag.id}
                          onSelect={() => setTagFilter(tag.id)}
                        >
                          {tag.name}
                        </MenuItem>
                      ))}
                    </>
                  }
                >
                  <Button>
                    {tags.find(tag => tag.id === tagFilter)?.name ??
                      t['com.affine.localmind.resource-display.allTags']()}
                  </Button>
                </Menu>
              )}
              {(catalog.loading || queryLoading) && (
                <span role="status">{t['Loading']()}</span>
              )}
              <div
                className={styles.selectionToolbar}
                role={selectMode ? 'toolbar' : undefined}
                aria-label={
                  selectMode
                    ? t['com.affine.localmind.resources.actions']()
                    : undefined
                }
              >
                {selectMode && (
                  <>
                    <span role="status">
                      {t['com.affine.localmind.resources.selectedCount']({
                        count: String(selected.length),
                      })}
                    </span>
                    <Button
                      disabled={
                        pending ||
                        !visibleGroups.length ||
                        catalog.loading ||
                        queryLoading
                      }
                      onClick={() => {
                        const ids = [
                          ...new Set(
                            visibleGroups.flatMap(group => group.items)
                          ),
                        ];
                        if (ids.length > 100)
                          setResult(
                            t['com.affine.localmind.resources.batchLimit']()
                          );
                        else context.selectedDocIds$.next(ids);
                      }}
                    >
                      {t['com.affine.page.group-header.select-all']()}
                    </Button>
                    <Menu
                      items={
                        <>
                          {!trash && (
                            <>
                              <MenuItem
                                disabled={
                                  pending ||
                                  !selected.some(id => capabilities[id]?.tags)
                                }
                                onSelect={() => chooseTags('add')}
                              >
                                {t['com.affine.header.option.add-tag']()}
                              </MenuItem>
                              <MenuItem
                                disabled={
                                  pending ||
                                  !selected.some(id => capabilities[id]?.tags)
                                }
                                onSelect={() => chooseTags('remove')}
                              >
                                {t[
                                  'com.affine.localmind.resources.removeTags'
                                ]()}
                              </MenuItem>
                            </>
                          )}
                          {trash && (
                            <MenuItem
                              disabled={
                                pending ||
                                !selected.some(id => capabilities[id]?.restore)
                              }
                              onSelect={() => confirm('restore')}
                            >
                              {t['com.affine.localmind.native-files.restore']()}
                            </MenuItem>
                          )}
                          <MenuItem
                            type="danger"
                            disabled={
                              pending ||
                              !selected.some(id => capabilities[id]?.remove)
                            }
                            onSelect={() => confirm(trash ? 'delete' : 'trash')}
                          >
                            {trash
                              ? t['com.affine.localmind.native-files.delete']()
                              : t[
                                  'com.affine.localmind.resources.moveToTrash'
                                ]()}
                          </MenuItem>
                        </>
                      }
                    >
                      <MenuTrigger
                        ref={batchOperationRef}
                        contentStyle={{ width: 'auto', flex: 'none' }}
                        disabled={
                          pending || !selected.length || selected.length > 100
                        }
                      >
                        {t['com.affine.localmind.resources.actions']()}
                      </MenuTrigger>
                    </Menu>
                    {!trash && reportDeckAvailable && (
                      <Button
                        prefix={<PresentationIcon />}
                        disabled={pending || !selected.length}
                        onClick={presentSelection}
                      >
                        {t['com.affine.localmind.reportDeck.entry']()}
                      </Button>
                    )}
                  </>
                )}
                <Button
                  ref={selectionToggleRef}
                  aria-pressed={selectMode}
                  disabled={pending || !!tagDialog}
                  onClick={() => {
                    context.selectedDocIds$.next([]);
                    context.selectMode$?.next(!selectMode);
                    context.prevCheckAnchorId$?.next(null);
                  }}
                >
                  {selectMode
                    ? t['Done']()
                    : t['com.affine.localmind.resources.multiSelect']()}
                </Button>
              </div>
            </div>
            {selectMode && selected.length > 100 && (
              <div className={styles.toolbar} role="alert">
                {t['com.affine.localmind.resources.batchLimit']()}
              </div>
            )}
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
              <ResourceListLayout
                enabled={
                  !trash && resourceDisplay && preference.view === 'list'
                }
              >
                {!visibleGroups.some(group => group.items.length) ? (
                  <div className={styles.toolbar} role="status">
                    {catalog.loading ||
                    queryLoading ||
                    !catalog.ready ||
                    (!!preference.resourceProperties && !docsAvailable)
                      ? t['Loading']()
                      : catalog.error || queryError || folderError
                        ? ''
                        : t['com.affine.localmind.resources.empty']()}
                  </div>
                ) : (
                  <DocsExplorer
                    renderItem={renderItem}
                    measureResourceItems={
                      !trash && resourceDisplay && preference.view !== 'grid'
                    }
                    resourceItemHeight={
                      !trash && preference.resourceProperties
                        ? itemHeight
                        : undefined
                    }
                    renderGroupHeader={
                      !trash && preference.resourceProperties
                        ? (key, count) => (
                            <PlainTextDocGroupHeader
                              groupId={key}
                              docCount={count}
                            >
                              {preference.groupBy?.key === 'createdBy' ? (
                                key ? (
                                  <ResourceActor id={key} />
                                ) : (
                                  t[
                                    'com.affine.localmind.resource-display.unknownCreator'
                                  ]()
                                )
                              ) : preference.groupBy?.key === 'tags' ? (
                                (tags.find(tag => tag.id === key)?.name ??
                                t[
                                  'com.affine.localmind.resource-display.noTags'
                                ]())
                              ) : preference.groupBy?.key === 'documentType' ? (
                                t[
                                  `com.affine.localmind.resource-display.type.${key}`
                                ]()
                              ) : (
                                key ||
                                t[
                                  'com.affine.localmind.resource-display.unknownDate'
                                ]()
                              )}
                            </PlainTextDocGroupHeader>
                          )
                        : undefined
                    }
                    toolbar={null}
                  />
                )}
              </ResourceListLayout>
            </div>
          </div>
        </NativeResourceDropTarget>
      </ResourceSelectionModeContext.Provider>
    </DocExplorerContext.Provider>
  );
}
