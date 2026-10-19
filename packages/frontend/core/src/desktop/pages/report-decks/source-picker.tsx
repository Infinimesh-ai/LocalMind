import { Modal } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { useWorkspaceInfo } from '@affine/core/components/hooks/use-workspace-info';
import { ServerService } from '@affine/core/modules/cloud';
import { useDeckText } from '@affine/core/modules/report-decks/i18n';
import type { DeckSourceRef } from '@affine/core/modules/report-decks/types';
import {
  type WorkspaceMetadata,
  WorkspacesService,
} from '@affine/core/modules/workspace';
import {
  copilotWorkbenchProjectsGetQuery,
  getRecentlyUpdatedDocsQuery,
  workspaceNativeResourcesQuery,
} from '@affine/graphql';
import {
  AllDocsIcon,
  ArrowLeftSmallIcon,
  ArrowRightSmallIcon,
  FileIcon,
  FolderIcon,
  GridIcon,
  HomeIcon,
  PageIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect, useMemo, useState } from 'react';

import { useProjectFolder } from '../intelligence/project-files-data';
import { dedupeSources, sourceKey } from './deck-ui';
import * as styles from './report-decks.css';

type Tab = 'workspace' | 'project';

function projectResourceKind(kind: string): DeckSourceRef['kind'] {
  if (kind === 'folder') return 'folder';
  if (kind === 'page' || kind === 'document' || kind === 'edgeless')
    return 'doc';
  return 'file';
}

function Item({
  source,
  checked,
  disabled,
  icon,
  label,
  onToggle,
  onOpen,
  openLabel,
}: {
  openLabel?: string;
  source: DeckSourceRef;
  checked: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onToggle: (source: DeckSourceRef) => void;
  onOpen?: () => void;
}) {
  return (
    <label className={styles.pickerItem} data-disabled={disabled || undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(source)}
      />
      {icon}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {onOpen && (
        <button
          type="button"
          className={styles.ghostButton}
          style={{ height: 26 }}
          aria-label={openLabel}
          title={openLabel}
          onClick={event => {
            event.preventDefault();
            onOpen?.();
          }}
        >
          {/* Folders open in place; the checkbox picks the whole folder. */}
          <ArrowRightSmallIcon />
        </button>
      )}
    </label>
  );
}

function WorkspaceName({ meta }: { meta: WorkspaceMetadata }) {
  const info = useWorkspaceInfo(meta);
  return <span>{info?.name || meta.id}</span>;
}

function useWorkspaceLabel(meta: WorkspaceMetadata | undefined) {
  const info = useWorkspaceInfo(meta);
  return info?.name || meta?.id || '';
}

function WorkspaceItems({
  meta,
  search,
  selected,
  onToggle,
}: {
  meta: WorkspaceMetadata;
  search: string;
  selected: ReadonlyMap<string, DeckSourceRef>;
  onToggle: (source: DeckSourceRef) => void;
}) {
  const t = useDeckText();
  const [first, setFirst] = useState(60);
  const docs = useQuery(
    {
      query: getRecentlyUpdatedDocsQuery,
      variables: { workspaceId: meta.id, pagination: { first } },
    },
    { suspense: false, shouldRetryOnError: false, keepPreviousData: true }
  );
  const files = useQuery(
    {
      query: workspaceNativeResourcesQuery,
      variables: { workspaceId: meta.id, query: search || null, limit: 50 },
    },
    { suspense: false, shouldRetryOnError: false }
  );
  const query = search.trim().toLowerCase();
  const docItems = (docs.data?.workspace.recentlyUpdatedDocs.edges ?? [])
    .map(edge => edge.node)
    .filter(node => !query || (node.title ?? '').toLowerCase().includes(query));
  const fileItems = files.data?.workspaceNativeResources.items ?? [];
  const hasMore =
    docs.data?.workspace.recentlyUpdatedDocs.pageInfo.hasNextPage ?? false;
  if (docs.isLoading && files.isLoading)
    return (
      <p className={styles.muted} role="status">
        {t('picker.loading')}
      </p>
    );
  if (docs.error && files.error)
    return (
      <p className={styles.muted} role="alert">
        {t('picker.loadFailed')}
      </p>
    );
  if (!docItems.length && !fileItems.length)
    return <p className={styles.muted}>{t('picker.empty')}</p>;
  return (
    <>
      {docItems.map(node => {
        const source: DeckSourceRef = {
          scopeKind: 'workspace',
          scopeId: meta.id,
          kind: 'doc',
          resourceId: node.id,
          title: (node.title || t('picker.untitledDoc')).slice(0, 512),
        };
        return (
          <Item
            key={node.id}
            source={source}
            checked={selected.has(sourceKey(source))}
            icon={<PageIcon />}
            label={node.title || t('picker.untitledDoc')}
            onToggle={onToggle}
          />
        );
      })}
      {fileItems.map(file => {
        const title = file.title || file.fileName || file.id;
        const source: DeckSourceRef = {
          scopeKind: 'workspace',
          scopeId: meta.id,
          kind: 'file',
          resourceId: file.id,
          title: title.slice(0, 512),
        };
        return (
          <Item
            key={`file:${file.id}`}
            source={source}
            checked={selected.has(sourceKey(source))}
            icon={<FileIcon />}
            label={title}
            onToggle={onToggle}
          />
        );
      })}
      {hasMore && (
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => setFirst(value => value + 60)}
        >
          {t('history.loadMore')}
        </button>
      )}
    </>
  );
}

function ProjectItems({
  projectId,
  projectName,
  search,
  selected,
  onToggle,
}: {
  projectId: string;
  projectName: string;
  search: string;
  selected: ReadonlyMap<string, DeckSourceRef>;
  onToggle: (source: DeckSourceRef) => void;
}) {
  const t = useDeckText();
  const [path, setPath] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => setPath([]), [projectId]);
  const parent = path.at(-1) ?? null;
  const folder = useProjectFolder({
    projectId,
    parentId: search ? null : (parent?.id ?? null),
    search: search || undefined,
  });
  const whole: DeckSourceRef = {
    scopeKind: 'project',
    scopeId: projectId,
    kind: 'project_all',
    title: projectName.slice(0, 512),
  };
  const wholeSelected = selected.has(sourceKey(whole));
  return (
    <>
      <Item
        source={whole}
        checked={wholeSelected}
        icon={<AllDocsIcon />}
        label={t('picker.wholeProject', { name: projectName })}
        onToggle={onToggle}
      />
      {path.length > 0 && !search && (
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => setPath(current => current.slice(0, -1))}
        >
          <ArrowLeftSmallIcon />
          {path.map(item => item.title).join(' / ')}
        </button>
      )}
      {folder.isLoading ? (
        <p className={styles.muted} role="status">
          {t('picker.loading')}
        </p>
      ) : folder.error ? (
        <p className={styles.muted} role="alert">
          {t('picker.loadFailed')}
        </p>
      ) : folder.items.length === 0 ? (
        <p className={styles.muted}>{t('picker.empty')}</p>
      ) : (
        folder.items.map(resource => {
          const kind = projectResourceKind(resource.kind);
          const source: DeckSourceRef = {
            scopeKind: 'project',
            scopeId: projectId,
            kind,
            resourceId: resource.id,
            title: resource.title.slice(0, 512),
          };
          return (
            <Item
              key={resource.id}
              source={source}
              checked={wholeSelected || selected.has(sourceKey(source))}
              disabled={wholeSelected}
              icon={
                kind === 'folder' ? (
                  <FolderIcon />
                ) : kind === 'doc' ? (
                  <PageIcon />
                ) : (
                  <FileIcon />
                )
              }
              label={resource.title}
              onToggle={onToggle}
              openLabel={t('picker.openFolder', { name: resource.title })}
              onOpen={
                kind === 'folder' && !search
                  ? () =>
                      setPath(current => [
                        ...current,
                        { id: resource.id, title: resource.title },
                      ])
                  : undefined
              }
            />
          );
        })
      )}
      {folder.hasMore && (
        <button
          type="button"
          className={styles.ghostButton}
          disabled={folder.loadingMore}
          onClick={() => void folder.loadMore()}
        >
          {t('history.loadMore')}
        </button>
      )}
    </>
  );
}

function lastWorkspaceId() {
  try {
    return localStorage.getItem('last_workspace_id');
  } catch {
    return null;
  }
}

/**
 * Dialog picking workspace docs/files and project resources (or whole
 * projects). Returns refs; the caller merges and deduplicates.
 */
export function SourcePicker({
  open,
  existing,
  onClose,
  onConfirm,
}: {
  open: boolean;
  existing: DeckSourceRef[];
  onClose: () => void;
  onConfirm: (sources: DeckSourceRef[]) => void;
}) {
  const t = useDeckText();
  const serverId = useService(ServerService).server.id;
  const workspaces = useLiveData(
    useService(WorkspacesService).list.workspaces$
  );
  const cloudWorkspaces = useMemo(
    () => workspaces.filter(meta => meta.flavour === serverId),
    [workspaces, serverId]
  );
  const projectsQuery = useQuery(
    {
      query: copilotWorkbenchProjectsGetQuery,
      variables: { includeArchived: false },
    },
    { suspense: false, shouldRetryOnError: false }
  );
  const projects = (
    projectsQuery.data?.currentUser?.copilot.contextProjects ?? []
  ).filter(project => project.status === 'active');
  const [tab, setTab] = useState<Tab>('workspace');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Map<string, DeckSourceRef>());
  useEffect(() => {
    if (!open) return;
    setSelected(new Map());
    setSearch('');
  }, [open]);
  const workspace =
    cloudWorkspaces.find(meta => meta.id === workspaceId) ??
    cloudWorkspaces.find(meta => meta.id === lastWorkspaceId()) ??
    cloudWorkspaces[0];
  const project = projects.find(item => item.id === projectId) ?? projects[0];
  const workspaceLabel = useWorkspaceLabel(workspace);
  const existingKeys = useMemo(
    () => new Set(existing.map(sourceKey)),
    [existing]
  );
  const toggle = (source: DeckSourceRef) =>
    setSelected(current => {
      const next = new Map(current);
      const key = sourceKey(source);
      if (!next.delete(key)) next.set(key, source);
      return next;
    });
  const additions = dedupeSources([...selected.values()]).filter(
    source => !existingKeys.has(sourceKey(source))
  );
  return (
    <Modal
      open={open}
      onOpenChange={value => !value && onClose()}
      title={t('picker.title')}
      description={t('picker.description')}
      width="min(860px, 94vw)"
    >
      <div className={styles.pickerLayout}>
        <aside className={styles.pickerSide}>
          <div className={styles.tabs} role="tablist">
            {(['workspace', 'project'] as const).map(value => (
              <button
                key={value}
                type="button"
                role="tab"
                className={styles.tab}
                aria-selected={tab === value}
                onClick={() => {
                  setTab(value);
                  setSearch('');
                }}
              >
                {t(`picker.tab.${value}`)}
              </button>
            ))}
          </div>
          {tab === 'workspace'
            ? cloudWorkspaces.map(meta => (
                <button
                  key={meta.id}
                  type="button"
                  className={styles.pickerSideItem}
                  aria-current={meta.id === workspace?.id}
                  onClick={() => setWorkspaceId(meta.id)}
                >
                  <HomeIcon />
                  <WorkspaceName meta={meta} />
                </button>
              ))
            : projects.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.pickerSideItem}
                  aria-current={item.id === project?.id}
                  onClick={() => setProjectId(item.id)}
                >
                  <GridIcon />
                  <span>{item.name}</span>
                </button>
              ))}
          {tab === 'workspace' && !cloudWorkspaces.length && (
            <p className={styles.muted}>{t('picker.noWorkspaces')}</p>
          )}
          {tab === 'project' &&
            !projectsQuery.isLoading &&
            !projects.length && (
              <p className={styles.muted}>{t('picker.noProjects')}</p>
            )}
        </aside>
        <div className={styles.pickerMain}>
          <div className={styles.pickerToolbar}>
            <input
              className={styles.input}
              type="search"
              value={search}
              placeholder={t('picker.search')}
              aria-label={t('picker.search')}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <div className={styles.pickerItems}>
            {tab === 'workspace' && workspace ? (
              <WorkspaceItems
                key={workspace.id}
                meta={workspace}
                search={search.trim()}
                selected={selected}
                onToggle={toggle}
              />
            ) : tab === 'project' && project ? (
              <ProjectItems
                key={project.id}
                projectId={project.id}
                projectName={project.name}
                search={search.trim()}
                selected={selected}
                onToggle={toggle}
              />
            ) : null}
          </div>
        </div>
      </div>
      <div className={styles.modalFooter}>
        <span className={styles.muted}>
          {tab === 'workspace' && workspace
            ? t('picker.scopeHint', { name: workspaceLabel })
            : ''}
        </span>
        <span className={styles.spacer} />
        <button type="button" className={styles.button} onClick={onClose}>
          {t('action.cancel')}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!additions.length}
          onClick={() => onConfirm(additions)}
        >
          {t('picker.add', { count: additions.length })}
        </button>
      </div>
    </Modal>
  );
}
