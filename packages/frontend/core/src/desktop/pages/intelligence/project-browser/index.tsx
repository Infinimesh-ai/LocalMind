import {
  Button,
  ContextMenu,
  IconButton,
  Loading,
  Menu,
  MenuItem,
  Modal,
} from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { useProjectUnsavedConfirmation } from '@affine/core/modules/project-resources/edit-guard';
import { ProjectResourceKind, projectResourcePathQuery } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  DeleteTemporarilyIcon,
  FolderIcon,
  PlusIcon,
  PresentationIcon,
  UploadIcon,
  ViewIcon,
} from '@blocksuite/icons/rc';
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ProjectFolderDropTarget } from '../project-file-drop-target';
import { type ProjectFile, useProjectFolder } from '../project-files-data';
import type { WorkbenchProject } from '../types';
import * as styles from './browser.css';
import { ColumnView } from './column-view';
import {
  CreateMenuItems,
  FileMenuItems,
  SelectionToolbar,
  useProjectFileActions,
} from './file-actions';
import { GalleryView } from './gallery-view';
import { IconView } from './icon-view';
import {
  BrowserItemContext,
  type BrowserItemContextValue,
  ITEM_ATTRIBUTE,
} from './item';
import { ListView } from './list-view';
import { PreviewPane } from './preview';
import { ProjectsOverview } from './projects-overview';
import { type SearchResult, SearchResults } from './search-results';
import { BrowserToolbar, type Crumb, SearchScopeBar } from './toolbar';
import {
  type ProjectBrowserState,
  sortProjectFiles,
} from './use-browser-state';

export { recordRecentProjectFile, useRecentProjectFiles } from './recent';
export { ProjectBrowserSidebar } from './sidebar';
export { useProjectBrowserState } from './use-browser-state';

type BrowserProps = {
  /** Active projects of the signed-in user. */
  projects: readonly WorkbenchProject[];
  projectsLoading: boolean;
  projectsError?: string;
  onRetryProjects: () => void;
  projectId: string | null;
  /** Current folder from the URL; `undefined` while it is still resolving. */
  folderId: string | null | undefined;
  state: ProjectBrowserState;
  onOpen: (projectId: string, resourceId: string) => void;
};

const isTextTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input, textarea, select, [contenteditable="true"]');

/** Finder-style browser for project documents. */
export function ProjectBrowser(props: BrowserProps) {
  const t = useI18n();
  const project = props.projects.find(item => item.id === props.projectId);
  if (project)
    return (
      <ProjectFolderBrowser key={project.id} {...props} project={project} />
    );
  const searching = !!props.state.search.trim();
  return (
    <section
      className={styles.root}
      aria-label={t['com.affine.localmind.workbench.systemRail.docs']()}
    >
      <BrowserToolbar
        state={props.state}
        hasProject={false}
        crumbs={[
          {
            id: 'all',
            label: t['com.affine.localmind.project-browser.allProjects'](),
            onSelect: () => props.state.setSearch(''),
          },
        ]}
      />
      {searching ? (
        <>
          <SearchScopeBar
            scope="all"
            hasProject={false}
            onScopeChange={props.state.setScope}
          />
          <div className={styles.scroll}>
            <SearchResults
              projects={props.projects}
              query={props.state.search}
              onReveal={(projectId, item) =>
                revealResult(props.state, projectId, item)
              }
              onOpen={props.onOpen}
            />
          </div>
        </>
      ) : (
        <div className={styles.scroll}>
          {props.state.trash ? (
            <p className={styles.hint} role="note">
              {t['com.affine.localmind.project-browser.sidebar.trashHint']()}
            </p>
          ) : null}
          {props.projectId && props.projectsLoading ? (
            <div className={styles.state} role="status">
              <Loading />
            </div>
          ) : (
            <ProjectsOverview
              projects={props.projects}
              loading={props.projectsLoading}
              error={props.projectsError}
              onRetry={props.onRetryProjects}
              onOpenProject={projectId =>
                props.state.navigate({ projectId, folderId: null })
              }
            />
          )}
        </div>
      )}
    </section>
  );
}

function revealResult(
  state: ProjectBrowserState,
  projectId: string,
  item: Pick<SearchResult, 'id' | 'path'>
) {
  const folderId = item.path.at(-2)?.id ?? null;
  state.setTrash(false);
  state.setSearch('');
  state.setReveal({ projectId, folderId, resourceId: item.id });
  state.navigate({ projectId, folderId });
}

function ProjectFolderBrowser({
  project,
  projects,
  folderId,
  state,
  onOpen,
}: BrowserProps & { project: WorkbenchProject }) {
  const t = useI18n();
  const confirmUnsaved = useProjectUnsavedConfirmation();
  const lastFolder = useRef<string | null>(folderId ?? null);
  if (folderId !== undefined) lastFolder.current = folderId;
  const currentFolderId = lastFolder.current;
  const projectId = project.id;
  const { trash, viewMode, sort } = state;
  const openResource = useCallback(
    (resourceId: string) => onOpen(projectId, resourceId),
    [onOpen, projectId]
  );
  const actions = useProjectFileActions({
    projectId,
    parentId: currentFolderId,
    onOpen: openResource,
  });
  const reportError = actions.report;
  const query = useProjectFolder({
    projectId,
    parentId: trash ? null : currentFolderId,
    trash,
  });
  const files = useMemo(
    () => sortProjectFiles(query.items, sort),
    [query.items, sort]
  );
  const pathQuery = useQuery(
    currentFolderId
      ? {
          query: projectResourcePathQuery,
          variables: { projectId, resourceId: currentFolderId },
        }
      : undefined,
    { suspense: false, shouldRetryOnError: false }
  );
  const path = useMemo(
    () => (currentFolderId ? (pathQuery.data?.projectResourcePath ?? []) : []),
    [currentFolderId, pathQuery.data]
  );

  const [focusId, setFocusId] = useState<string | null>(null);
  const [quickLook, setQuickLook] = useState<ProjectFile | null>(null);
  const [contextTarget, setContextTarget] = useState<string | null>(null);
  const anchorId = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const registry = useRef(
    new Map<string, { file: ProjectFile; siblings: readonly ProjectFile[] }>()
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const { replaceSelection, selected } = actions;
  const replaceSelectionRef = useRef(replaceSelection);
  replaceSelectionRef.current = replaceSelection;

  const navigateFolder = useCallback(
    (id: string | null) => state.navigate({ projectId, folderId: id }),
    [projectId, state]
  );

  // A new location starts with an empty selection (or the pending focus).
  useEffect(() => {
    replaceSelectionRef.current([]);
    setFocusId(pendingFocus.current);
    pendingFocus.current = null;
    anchorId.current = null;
    setQuickLook(null);
  }, [currentFolderId, trash]);

  const { reveal, setReveal } = state;
  useEffect(() => {
    if (
      !reveal ||
      reveal.projectId !== projectId ||
      reveal.folderId !== currentFolderId ||
      trash ||
      query.isLoading
    )
      return;
    const file = query.items.find(item => item.id === reveal.resourceId);
    if (file) {
      replaceSelectionRef.current([file]);
      setFocusId(file.id);
      anchorId.current = file.id;
      setReveal(null);
      requestAnimationFrame(() => {
        const element = bodyRef.current?.querySelector<HTMLElement>(
          `[${ITEM_ATTRIBUTE}="${CSS.escape(file.id)}"]`
        );
        element?.focus();
        element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      });
    } else if (query.error || !query.hasMore) setReveal(null);
    else if (!query.loadingMore) query.loadMore().catch(reportError);
  }, [
    currentFolderId,
    projectId,
    query,
    reportError,
    reveal,
    setReveal,
    trash,
  ]);

  const single = selected.size === 1 ? [...selected.values()][0] : null;
  const previewing =
    (viewMode === 'gallery' || viewMode === 'columns') &&
    !!single &&
    single.kind !== ProjectResourceKind.folder;

  // The gallery always shows something on stage.
  useEffect(() => {
    if (viewMode !== 'gallery' || selected.size || !files.length) return;
    replaceSelectionRef.current([files[0]]);
    setFocusId(files[0].id);
    anchorId.current = files[0].id;
  }, [files, selected.size, viewMode]);

  const openFile = useCallback(
    (file: ProjectFile) => {
      if (trash) return;
      if (file.kind === ProjectResourceKind.folder) navigateFolder(file.id);
      else openResource(file.id);
    },
    [navigateFolder, openResource, trash]
  );

  const itemIds = useCallback(
    () =>
      Array.from(
        bodyRef.current?.querySelectorAll<HTMLElement>(`[${ITEM_ATTRIBUTE}]`) ??
          []
      ).map(element => element.getAttribute(ITEM_ATTRIBUTE) as string),
    []
  );

  const onSelect = useCallback(
    (file: ProjectFile, event: MouseEvent) => {
      if (event.shiftKey && anchorId.current) {
        const ids = itemIds();
        const from = ids.indexOf(anchorId.current);
        const to = ids.indexOf(file.id);
        if (from >= 0 && to >= 0) {
          replaceSelection(
            ids
              .slice(Math.min(from, to), Math.max(from, to) + 1)
              .map(id => registry.current.get(id)?.file)
              .filter((item): item is ProjectFile => !!item)
          );
          setFocusId(file.id);
          return;
        }
      }
      if (event.metaKey || event.ctrlKey || actions.selecting) {
        actions.toggleSelected(file.id, file);
        setFocusId(file.id);
        anchorId.current = file.id;
        return;
      }
      const apply = () => {
        replaceSelection([file]);
        setFocusId(file.id);
        anchorId.current = file.id;
        if (viewMode !== 'columns' || trash) return;
        if (file.kind === ProjectResourceKind.folder) {
          if (file.id !== currentFolderId) {
            pendingFocus.current = file.id;
            navigateFolder(file.id);
          }
        } else if (file.parentId !== currentFolderId) {
          setReveal({
            projectId,
            folderId: file.parentId ?? null,
            resourceId: file.id,
          });
          navigateFolder(file.parentId ?? null);
        }
      };
      if (previewing && single?.id !== file.id)
        void confirmUnsaved()
          .then(allowed => {
            if (allowed) apply();
          })
          .catch(actions.report);
      else apply();
    },
    [
      actions,
      confirmUnsaved,
      currentFolderId,
      itemIds,
      navigateFolder,
      previewing,
      projectId,
      replaceSelection,
      setReveal,
      single?.id,
      trash,
      viewMode,
    ]
  );

  const itemContext = useMemo<BrowserItemContextValue>(
    () => ({
      selectedIds: actions.selectionIds,
      focusId,
      trash,
      pendingKeys: actions.pendingKeys,
      readOnly: actions.selecting,
      register: (file, siblings) =>
        registry.current.set(file.id, { file, siblings }),
      onSelect,
      onOpen: openFile,
      onMove: actions.changeFile,
      onFiles: actions.enqueueFiles,
    }),
    [actions, focusId, onSelect, openFile, trash]
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTextTarget(event.target)) return;
    const target = event.target as HTMLElement;
    // Keys inside an embedded preview belong to the preview.
    if (
      target !== event.currentTarget &&
      !target.closest(`[${ITEM_ATTRIBUTE}]`)
    )
      return;
    const all = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(`[${ITEM_ATTRIBUTE}]`)
    );
    const current = focusId
      ? all.find(element => element.getAttribute(ITEM_ATTRIBUTE) === focusId)
      : undefined;
    const columnOf = (element?: HTMLElement) =>
      element?.closest<HTMLElement>('[data-browser-column]') ?? null;
    let scope = all;
    if (viewMode === 'columns') {
      const columns = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          '[data-browser-column]'
        )
      );
      const column = columnOf(current) ?? columns.at(-1) ?? null;
      scope = column ? all.filter(element => column.contains(element)) : [];
    }
    const index = current ? scope.indexOf(current) : -1;
    const activate = (element: HTMLElement | undefined, shiftKey = false) => {
      if (!element) return;
      event.preventDefault();
      element.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, shiftKey })
      );
      element.focus();
      element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    const step = (delta: number) =>
      activate(
        scope[
          index < 0
            ? delta > 0
              ? 0
              : scope.length - 1
            : Math.max(0, Math.min(scope.length - 1, index + delta))
        ],
        event.shiftKey
      );
    const gridColumns = () => {
      const top = scope[0]?.offsetTop;
      const count = scope.filter(element => element.offsetTop === top).length;
      return count > 0 && count < scope.length ? count : 1;
    };
    const focused = focusId ? registry.current.get(focusId)?.file : undefined;
    switch (event.key) {
      case 'ArrowDown':
        step(viewMode === 'icons' ? gridColumns() : 1);
        break;
      case 'ArrowUp':
        step(viewMode === 'icons' ? -gridColumns() : -1);
        break;
      case 'ArrowRight':
        if (viewMode === 'list') {
          current
            ?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
            ?.click();
          event.preventDefault();
        } else if (viewMode === 'columns') {
          if (!current || focused?.kind !== ProjectResourceKind.folder) break;
          if (current.dataset.open === 'true') {
            const columns = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                '[data-browser-column]'
              )
            );
            const next =
              columns[columns.indexOf(columnOf(current) as HTMLElement) + 1];
            activate(
              next?.querySelector<HTMLElement>(`[${ITEM_ATTRIBUTE}]`) ??
                undefined
            );
          } else activate(current);
        } else step(1);
        break;
      case 'ArrowLeft':
        if (viewMode === 'list') {
          current
            ?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')
            ?.click();
          event.preventDefault();
        } else if (viewMode === 'columns') {
          const column = Number(columnOf(current)?.dataset.browserColumn ?? -1);
          const parent = path[column - 1];
          if (column <= 0 || !parent || trash) break;
          event.preventDefault();
          const parentFolder = path[column - 2]?.id ?? null;
          setReveal({
            projectId,
            folderId: parentFolder,
            resourceId: parent.id,
          });
          navigateFolder(parentFolder);
        } else step(-1);
        break;
      case 'Home':
        activate(scope[0]);
        break;
      case 'End':
        activate(scope.at(-1));
        break;
      case 'Enter':
        if (!focused) break;
        event.preventDefault();
        openFile(focused);
        break;
      case ' ':
        if (viewMode !== 'icons' && viewMode !== 'list') break;
        event.preventDefault();
        if (quickLook) setQuickLook(null);
        else if (focused && focused.kind !== ProjectResourceKind.folder)
          setQuickLook(focused);
        break;
      case 'Escape':
        if (quickLook) setQuickLook(null);
        else if (selected.size) replaceSelection([]);
        else break;
        event.preventDefault();
        break;
      case 'a':
        if (!(event.metaKey || event.ctrlKey)) break;
        event.preventDefault();
        replaceSelection(
          scope
            .map(element =>
              registry.current.get(element.getAttribute(ITEM_ATTRIBUTE) ?? '')
            )
            .map(entry => entry?.file)
            .filter((file): file is ProjectFile => !!file)
        );
        break;
    }
  };

  const searching = !!state.search.trim();
  const searchProjects = state.scope === 'project' ? [project] : projects;
  const crumbs: Crumb[] = [
    {
      id: 'all',
      label: t['com.affine.localmind.project-browser.allProjects'](),
      onSelect: () => state.navigate({ projectId: null, folderId: null }),
    },
    {
      id: project.id,
      label: project.name,
      onSelect: () => {
        state.setSearch('');
        if (trash) state.setTrash(false);
        navigateFolder(null);
      },
    },
    ...(trash
      ? [
          {
            id: 'trash',
            label: t['com.affine.localmind.project-files.trash'](),
          },
        ]
      : path.map(folder => ({
          id: folder.id,
          label: folder.title,
          onSelect: () => {
            state.setSearch('');
            navigateFolder(folder.id);
          },
        }))),
  ];

  const target = contextTarget
    ? registry.current.get(contextTarget)
    : undefined;
  const contextItems = target ? (
    selected.size > 1 && selected.has(target.file.id) && !trash ? (
      <>
        <MenuItem prefixIcon={<FolderIcon />} onClick={actions.batchMove}>
          {t['com.affine.localmind.workbench.fusion.batchMove']()}
        </MenuItem>
        <MenuItem
          prefixIcon={<DeleteTemporarilyIcon />}
          onClick={actions.batchTrash}
        >
          {t['com.affine.localmind.workbench.fusion.batchTrash']()}
        </MenuItem>
        {actions.reportDeckAvailable ? (
          <MenuItem
            prefixIcon={<PresentationIcon />}
            onClick={actions.presentSelection}
          >
            {t['com.affine.localmind.reportDeck.entry']()}
          </MenuItem>
        ) : null}
      </>
    ) : (
      <>
        {!trash ? (
          <MenuItem onClick={() => openFile(target.file)}>
            {t['com.affine.localmind.project-files.open']()}
          </MenuItem>
        ) : null}
        {!trash && target.file.kind !== ProjectResourceKind.folder ? (
          <MenuItem
            prefixIcon={<ViewIcon />}
            onClick={() => setQuickLook(target.file)}
          >
            {t['com.affine.localmind.project-browser.quickLook']()}
          </MenuItem>
        ) : null}
        <FileMenuItems
          file={target.file}
          siblings={target.siblings}
          trash={trash}
          pending={actions.pendingKeys.has(target.file.id)}
          onAction={actions.selectAction}
          onChange={actions.changeFile}
          onDelete={actions.permanentlyDelete}
          reorder={sort.key === 'manual'}
        />
      </>
    )
  ) : !trash ? (
    <>
      <CreateMenuItems actions={actions} />
      <MenuItem prefixIcon={<UploadIcon />} onClick={actions.openUpload}>
        {t['com.affine.localmind.project-files.upload']()}
      </MenuItem>
      <MenuItem onClick={actions.openImport}>
        {t['com.affine.localmind.workspace-import.title']()}
      </MenuItem>
    </>
  ) : (
    <MenuItem disabled>
      {t['com.affine.localmind.project-files.trash']()}
    </MenuItem>
  );

  const previewElement = (
    <PreviewPane
      projectId={projectId}
      file={single}
      trash={trash}
      onOpen={openFile}
      onClose={() => {
        replaceSelection([]);
        setFocusId(null);
      }}
    />
  );

  const view =
    viewMode === 'columns' ? (
      <ColumnView
        projectId={projectId}
        path={path}
        currentQuery={query}
        sort={sort}
        trash={trash}
        onMove={actions.changeFile}
        preview={previewing ? previewElement : null}
      />
    ) : viewMode === 'gallery' ? (
      <GalleryView query={query} files={files} preview={previewElement} />
    ) : (
      <ProjectFolderDropTarget
        projectId={projectId}
        parentId={trash ? null : currentFolderId}
        trash={trash}
        onMove={actions.changeFile}
      >
        {viewMode === 'list' ? (
          <ListView
            query={query}
            files={files}
            sort={sort}
            onSortChange={state.setSort}
            trash={trash}
          />
        ) : (
          <IconView query={query} files={files} />
        )}
      </ProjectFolderDropTarget>
    );

  return (
    <section
      className={styles.root}
      aria-label={
        trash
          ? t['com.affine.localmind.project-files.trash']()
          : t['com.affine.localmind.workbench.systemRail.docs']()
      }
      data-view-mode={viewMode}
      onDragOver={event => {
        if (!trash && event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={event => {
        if (!trash && event.dataTransfer.files.length) {
          event.preventDefault();
          actions.enqueueFiles(
            Array.from(event.dataTransfer.files),
            currentFolderId
          );
        }
      }}
    >
      <BrowserToolbar
        state={state}
        hasProject
        crumbs={crumbs}
        actions={
          <div className={styles.toolbarGroup}>
            <Menu items={<CreateMenuItems actions={actions} />}>
              <IconButton
                size="16"
                icon={<PlusIcon />}
                tooltip={t['com.affine.localmind.project-files.create']()}
                aria-label={t['com.affine.localmind.project-files.create']()}
                disabled={actions.createPending || trash}
              />
            </Menu>
            <IconButton
              size="16"
              icon={<UploadIcon />}
              tooltip={t['com.affine.localmind.project-files.upload']()}
              aria-label={t['com.affine.localmind.project-files.upload']()}
              disabled={trash}
              onClick={actions.openUpload}
            />
            <Button disabled={trash} onClick={actions.openImport}>
              {t['com.affine.localmind.workspace-import.title']()}
            </Button>
            <Button
              aria-pressed={actions.selecting}
              disabled={trash || actions.batchPending}
              onClick={() => {
                actions.setSelecting(value => !value);
                replaceSelection([]);
                actions.setBatchMessage(null);
              }}
            >
              {actions.selecting
                ? t['Done']()
                : t['com.affine.localmind.workbench.fusion.selectResources']()}
            </Button>
            <IconButton
              size="16"
              icon={<DeleteTemporarilyIcon />}
              tooltip={t['com.affine.localmind.project-files.trash']()}
              aria-label={t['com.affine.localmind.project-files.trash']()}
              aria-pressed={trash}
              disabled={actions.batchPending}
              onClick={() => {
                state.setTrash(!trash);
                state.setSearch('');
                actions.setSelecting(false);
                replaceSelection([]);
              }}
            />
            {actions.elements.uploadInput}
          </div>
        }
      />
      {searching ? (
        <SearchScopeBar
          scope={state.scope}
          hasProject
          onScopeChange={state.setScope}
        />
      ) : null}
      {!trash && (actions.selecting || selected.size > 1) ? (
        <SelectionToolbar actions={actions} />
      ) : null}
      {actions.elements.batchMessage}
      {!trash ? actions.elements.importStatus : null}
      {actions.elements.importPicker}
      {actions.elements.errorAlert}
      {actions.elements.uploadList}
      {searching ? (
        <div className={styles.scroll}>
          <SearchResults
            projects={searchProjects}
            query={state.search}
            onReveal={(id, item) => revealResult(state, id, item)}
            onOpen={onOpen}
            selection={
              actions.selecting
                ? {
                    projectId,
                    ids: actions.selectionIds,
                    disabled: actions.batchPending,
                    limit: 50,
                    toggle: actions.toggleSelected,
                  }
                : undefined
            }
          />
        </div>
      ) : (
        <BrowserItemContext.Provider value={itemContext}>
          <ContextMenu
            asChild
            items={contextItems}
            onOpenChange={open => {
              if (!open) setContextTarget(null);
            }}
          >
            <div
              ref={bodyRef}
              className={styles.body}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              onContextMenuCapture={event => {
                const element = (
                  event.target as HTMLElement
                ).closest<HTMLElement>(`[${ITEM_ATTRIBUTE}]`);
                const id = element?.getAttribute(ITEM_ATTRIBUTE) ?? null;
                setContextTarget(id);
                const entry = id ? registry.current.get(id) : undefined;
                if (entry && !selected.has(entry.file.id)) {
                  replaceSelection([entry.file]);
                  setFocusId(entry.file.id);
                  anchorId.current = entry.file.id;
                }
              }}
            >
              {view}
            </div>
          </ContextMenu>
        </BrowserItemContext.Provider>
      )}
      <Modal
        open={!!quickLook}
        title={quickLook?.title}
        width="min(960px, 92vw)"
        onOpenChange={open => {
          if (!open) setQuickLook(null);
        }}
      >
        {quickLook ? (
          <div
            className={styles.quickLook}
            data-testid="project-browser-quick-look"
          >
            <PreviewPane
              projectId={projectId}
              file={quickLook}
              trash={trash}
              onOpen={file => {
                setQuickLook(null);
                openFile(file);
              }}
              onClose={() => setQuickLook(null)}
            />
          </div>
        ) : null}
      </Modal>
      {actions.elements.nativeCreate}
      {actions.elements.modal}
    </section>
  );
}
