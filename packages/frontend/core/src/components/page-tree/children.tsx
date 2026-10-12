import { Button, Menu } from '@affine/component';
import { WorkspaceServerService } from '@affine/core/modules/cloud';
import { DocsService } from '@affine/core/modules/doc';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import { TagService } from '@affine/core/modules/tag';
import { WorkbenchService } from '@affine/core/modules/workbench';
import {
  WorkspaceLocalState,
  WorkspaceService,
} from '@affine/core/modules/workspace';
import { useWorkspaceResources } from '@affine/core/modules/workspace-resources/use-resources';
import { resourceDate, workspaceResourceIdentity } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { LiveData, useLiveData, useService } from '@toeverything/infra';
import { Fragment, useEffect, useMemo } from 'react';

import {
  createDocExplorerContext,
  DocExplorerContext,
} from '../explorer/context';
import { ResourceDisplayMenu } from '../explorer/display-menu/resources';
import {
  defaultResourceProperties,
  migrateResourcePreference,
  resourceSortFields,
} from '../explorer/resource-preferences';
import type { ExplorerDisplayPreference } from '../explorer/types';
import { NativeRow } from '../native-files/resource-explorer';
import {
  groupWorkspaceResources,
  type ResourceDisplayRecord,
} from '../native-files/resource-groups';
import { ResourceActor } from '../native-files/resource-metadata';
import { MixedDocRow } from '../native-files/resource-rows';
import { PageTreeCreateMenu } from '../root-app-sidebar/page-tree';
import * as styles from './children.css';
import { useCreatedResourceSelection } from './created-resource';
import { FolderResourceRow } from './folder-row';
import { PageTreeLoadError } from './load-error';

function useLocation(kind: string, resourceId: string, parentNodeId?: string) {
  const service = useService(WorkspacePageTreeService);
  const enabled = useLiveData(service.enabled$);
  const key = parentNodeId
    ? service.key(parentNodeId)
    : service.resourceKey(kind, resourceId);
  const layer = useLiveData(
    useMemo(
      () => service.layers$.map(layers => layers.get(key)),
      [service, key]
    )
  );
  useEffect(() => {
    if (enabled)
      return parentNodeId
        ? service.observe(parentNodeId)
        : service.observeResource(kind, resourceId);
    return undefined;
  }, [enabled, service, kind, resourceId, parentNodeId]);
  return { service, enabled, layer };
}

export function PageTreeBreadcrumbs({
  resourceId,
  kind = 'doc',
  parentNodeId,
}: {
  resourceId: string;
  kind?: 'doc' | 'office' | 'file' | 'folder';
  parentNodeId?: string;
}) {
  const { enabled, layer } = useLocation(kind, resourceId, parentNodeId);
  const workbench = useService(WorkbenchService).workbench;
  const t = useI18n();
  if (!enabled || !layer?.page?.parent) return null;
  return (
    <nav
      className={styles.breadcrumbs}
      aria-label={t['com.affine.localmind.page-tree.location']()}
    >
      <Button variant="plain" onClick={() => workbench.openAll()}>
        {t['com.affine.localmind.page-tree.root']()}
      </Button>
      {layer.page.ancestors.map(node => (
        <Fragment key={node.nodeId}>
          <span aria-hidden> / </span>
          <Button
            variant="plain"
            onClick={() => workbench.openTreeResource(node)}
          >
            {node.title || t['Untitled']()}
          </Button>
        </Fragment>
      ))}
      <span aria-hidden> / </span>
      <span aria-current="page">
        {layer.page.parent.title || t['Untitled']()}
      </span>
    </nav>
  );
}

export function PageTreeChildrenList({
  resourceId = '',
  parentNodeId,
}: {
  resourceId?: string;
  parentNodeId?: string;
}) {
  const { service, enabled, layer } = useLocation(
    'doc',
    resourceId,
    parentNodeId
  );
  const load = (more = false) =>
    parentNodeId
      ? service.load(parentNodeId, more)
      : service.loadResource('doc', resourceId, more);
  const resources = useWorkspaceResources();
  const t = useI18n();
  const localState = useService(WorkspaceLocalState);
  const { workspace } = useService(WorkspaceService);
  const server = useLiveData(useService(WorkspaceServerService).server$);
  const account = useLiveData(server?.account$);
  const scope = JSON.stringify([
    workspace.id,
    workspace.flavour === 'local' ? 'local' : [server?.baseUrl, account?.id],
    layer?.page?.parent?.nodeId ?? parentNodeId ?? resourceId,
  ]);
  const key = `pageTree:children:v1:${scope}:list`;
  const legacyKey = `pageTree:children:v1:${JSON.stringify([workspace.id, workspace.flavour === 'local' ? 'local' : [server?.baseUrl, account?.id], resourceId])}:list`;
  const context = useMemo(
    () =>
      createDocExplorerContext(
        migrateResourcePreference(
          localState.get<ExplorerDisplayPreference>(key) ??
            (resourceId
              ? localState.get<ExplorerDisplayPreference>(legacyKey)
              : undefined),
          [],
          {
            view: 'list',
            showDocIcon: true,
            showDocPreview: false,
            showMoreOperation: false,
            showDragHandle: false,
            resourceProperties: defaultResourceProperties,
            orderBy: { type: 'system', key: 'title', desc: false },
            groupBy: undefined,
          }
        ).preference
      ),
    [key, legacyKey, localState, resourceId]
  );
  const preference = useLiveData(context.displayPreference$);
  useCreatedResourceSelection(
    context,
    layer?.page?.parent?.nodeId,
    workspace.id
  );
  const docs = useService(DocsService).list;
  const tags = useLiveData(useService(TagService).tagList.tagMetas$);
  const records = useLiveData(
    useMemo(
      () =>
        LiveData.computed(get => {
          const records: ResourceDisplayRecord[] = [];
          for (const node of layer?.page?.items ?? []) {
            if (node.kind === 'folder') {
              records.push({
                id: node.nodeId,
                identity: workspaceResourceIdentity(
                  workspace.id,
                  'folder',
                  node.resourceId
                ),
                title: node.title,
                documentType: 'folder',
                createdBy: node.folder?.createdBy ?? null,
                createdAt: resourceDate(node.folder?.createdAt),
                updatedAt: resourceDate(node.folder?.updatedAt),
                tagIds: [],
              });
            } else if (node.kind === 'doc') {
              const doc = get(docs.doc$(node.resourceId));
              if (!doc) continue;
              const meta = get(doc.meta$),
                update = get(doc.displayUpdate$);
              records.push({
                id: node.nodeId,
                identity: workspaceResourceIdentity(
                  workspace.id,
                  'doc',
                  doc.id
                ),
                title: node.title,
                documentType:
                  get(doc.primaryMode$) === 'edgeless' ? 'edgeless' : 'page',
                createdBy: get(doc.createdBy$) ?? null,
                createdAt: resourceDate(meta.createDate),
                updatedAt: update?.at ?? resourceDate(meta.updatedDate),
                tagIds: meta.tags ?? [],
              });
            } else {
              const item = resources.items.find(
                item => item.kind === node.kind && item.id === node.resourceId
              );
              if (item)
                records.push({
                  id: node.nodeId,
                  identity: workspaceResourceIdentity(
                    workspace.id,
                    item.kind,
                    item.id
                  ),
                  title: item.title,
                  documentType: item.documentType,
                  createdBy: item.createdBy,
                  createdAt: resourceDate(item.createdAt),
                  updatedAt: resourceDate(item.lastUpdatedAt),
                  tagIds: item.tags.map(tag => tag.id),
                });
            }
          }
          return records;
        }),
      [docs, layer?.page?.items, resources.items, workspace.id]
    )
  );
  const groups = groupWorkspaceResources(
    records,
    resourceSortFields.find(key => key === preference.orderBy?.key) ?? 'title',
    preference.orderBy?.desc ?? false,
    preference.groupBy?.key
  );
  // A sorted list must include the whole direct level, never a partial-page projection.
  useEffect(() => {
    if (layer?.page?.nextCursor && !layer.loading && !layer.error)
      void (
        parentNodeId
          ? service.load(parentNodeId, true)
          : service.loadResource('doc', resourceId, true)
      ).catch(console.error);
  }, [layer, service, resourceId, parentNodeId]);
  if (!enabled || layer?.page?.parent?.primaryMode === 'edgeless') return null;
  const parent = layer?.page?.parent;
  return (
    <section
      className={styles.section}
      aria-label={t['com.affine.localmind.page-tree.children']()}
    >
      <div className={styles.header}>
        <h2 className={styles.heading}>
          {t['com.affine.localmind.page-tree.children']()}
        </h2>
        <Menu
          items={
            <ResourceDisplayMenu
              displayPreference={preference}
              onDisplayPreferenceChange={value => {
                const next = {
                  ...value,
                  view: 'list' as const,
                  showDragHandle: false,
                };
                context.displayPreference$.next(next);
                localState.set(key, next);
              }}
            />
          }
        >
          <Button variant="plain">
            {t['com.affine.explorer.display-menu.button']()}
          </Button>
        </Menu>
        {parent && (
          <PageTreeCreateMenu parentId={parent.nodeId} name={parent.title} />
        )}
      </div>
      {!layer || (layer.loading && !layer.page) ? (
        <p role="status">{t['com.affine.localmind.page-tree.loading']()}</p>
      ) : null}
      {layer?.error ? (
        <PageTreeLoadError {...layer} retry={() => void load()} />
      ) : null}
      <DocExplorerContext.Provider value={context}>
        {!!layer?.page &&
          !layer.page.nextCursor &&
          groups.map(group => (
            <Fragment key={group.key}>
              {preference.groupBy && (
                <h3>
                  {preference.groupBy.key === 'createdBy' ? (
                    group.key ? (
                      <ResourceActor id={group.key} />
                    ) : (
                      t[
                        'com.affine.localmind.resource-display.unknownCreator'
                      ]()
                    )
                  ) : preference.groupBy.key === 'tags' ? (
                    group.key === '$folders' ? (
                      t['com.affine.localmind.resource-display.type.folder']()
                    ) : (
                      (tags.find(tag => tag.id === group.key)?.name ??
                      t['com.affine.localmind.resource-display.noTags']())
                    )
                  ) : preference.groupBy.key === 'documentType' ? (
                    t[
                      `com.affine.localmind.resource-display.type.${group.key}`
                    ]()
                  ) : (
                    group.key ||
                    t['com.affine.localmind.resource-display.unknownDate']()
                  )}{' '}
                  · {group.items.length}
                </h3>
              )}
              {group.items.map(id => {
                const node = layer?.page?.items.find(
                  node => node.nodeId === id
                );
                if (!node) return null;
                if (node.kind === 'folder')
                  return <FolderResourceRow key={id} item={node} />;
                if (node.kind === 'doc')
                  return <MixedDocRow key={id} id={node.resourceId} />;
                const native = resources.items.find(
                  resource =>
                    resource.kind === node.kind &&
                    resource.id === node.resourceId
                );
                return native ? (
                  <NativeRow key={id} resource={native} trash={false} />
                ) : null;
              })}
            </Fragment>
          ))}
      </DocExplorerContext.Provider>
      {resources.error && (
        <Button onClick={() => resources.service.invalidate()}>
          {t['com.affine.error.retry']()}
        </Button>
      )}
      {layer?.page &&
        !layer.page.items.length &&
        !layer.loading &&
        !layer.error && (
          <p>
            {t[
              parent?.kind === 'folder'
                ? 'com.affine.localmind.page-tree.folderEmpty'
                : 'com.affine.localmind.page-tree.empty'
            ]()}
          </p>
        )}
      {layer?.page?.nextCursor && (
        <Button disabled={layer.loading} onClick={() => void load(true)}>
          {t['com.affine.quicksearch.load-more']()}
        </Button>
      )}
    </section>
  );
}
