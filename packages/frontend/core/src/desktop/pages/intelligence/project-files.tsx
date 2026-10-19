import { Button, IconButton, Input, Loading, Menu } from '@affine/component';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { ProjectResourceKind } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  ArrowRightSmallIcon,
  DeleteTemporarilyIcon,
  MoreHorizontalIcon,
  PlusIcon,
  UploadIcon,
} from '@blocksuite/icons/rc';
import { useDeferredValue, useState } from 'react';

import {
  CreateMenuItems,
  type FileAction,
  type FileChange,
  FileMenuItems,
  SelectionToolbar,
  useProjectFileActions,
} from './project-browser/file-actions';
import {
  ProjectFileDropTarget,
  ProjectFolderDropTarget,
} from './project-file-drop-target';
import * as styles from './project-files.css';
import { type ProjectFile, useProjectFolder } from './project-files-data';
import { ProjectResourceIcon } from './project-resource-icon';
import { ProjectResourceSearch } from './project-resource-search';

export { projectFileDeckSource } from './project-browser/file-actions';

type FileTreeProps = {
  projectId: string;
  parentId?: string | null;
  selectedResourceId: string | null;
  onOpen: (resourceId: string) => void;
};

type BranchProps = FileTreeProps & {
  parentId: string | null;
  trash: boolean;
  pending: ReadonlySet<string>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onAction: (action: FileAction) => void;
  onChange: (file: ProjectFile, change: FileChange) => void;
  onFiles: (files: File[], parentId: string | null) => void;
  onDelete?: (file: ProjectFile) => void;
  selection?: {
    ids: ReadonlySet<string>;
    disabled: boolean;
    limit?: number;
    includeFolders?: boolean;
    toggle: (id: string, file?: ProjectFile) => void;
  };
};

function FileBranch(props: BranchProps) {
  const t = useI18n();
  const query = useProjectFolder(props);
  if (query.isLoading && !query.error)
    return (
      <div className={styles.state}>
        <Loading size={16} />
      </div>
    );
  if (query.error)
    return (
      <div className={styles.state} role="alert">
        <span>{projectErrorMessage(query.error)}</span>
        <Button
          loading={query.isValidating}
          disabled={query.isValidating}
          onClick={() => void query.retry()}
        >
          {t['com.affine.localmind.project-files.retry']()}
        </Button>
      </div>
    );
  return (
    <>
      <ul className={styles.list}>
        {query.items.map((file, index) => {
          const folder = file.kind === ProjectResourceKind.folder;
          const expanded = props.expanded.has(file.id);
          const selectionDisabled =
            props.selection &&
            (props.selection.disabled ||
              (!props.selection.ids.has(file.id) &&
                props.selection.ids.size >=
                  (props.selection.limit ?? Infinity)));
          // Folders stay expandable after the selection limit is reached;
          // only their own checkbox is limited.
          const openDisabled = folder
            ? props.selection?.disabled
            : selectionDisabled;
          return (
            <li key={file.id}>
              <ProjectFileDropTarget
                file={file}
                nextId={query.items[index + 1]?.id ?? null}
                pending={props.pending.has(file.id)}
                trash={props.trash}
                onMove={props.onChange}
                onFiles={props.onFiles}
                readOnly={!!props.selection}
              >
                {props.selection &&
                (!folder || props.selection.includeFolders) ? (
                  <input
                    type="checkbox"
                    className={styles.selectionCheckbox}
                    aria-label={file.title}
                    checked={props.selection.ids.has(file.id)}
                    disabled={selectionDisabled}
                    onChange={() => props.selection?.toggle(file.id, file)}
                  />
                ) : null}
                {folder && !props.trash ? (
                  <IconButton
                    size="16"
                    icon={
                      <ArrowRightSmallIcon
                        style={{
                          transform: expanded ? 'rotate(90deg)' : undefined,
                        }}
                      />
                    }
                    aria-expanded={expanded}
                    aria-label={file.title}
                    onClick={() => props.onToggle(file.id)}
                  />
                ) : null}
                <button
                  className={styles.open}
                  type="button"
                  data-project-resource-id={file.id}
                  disabled={props.trash || openDisabled}
                  aria-current={props.selectedResourceId === file.id}
                  onClick={() =>
                    props.selection
                      ? folder
                        ? props.onToggle(file.id)
                        : props.selection.toggle(file.id, file)
                      : props.onOpen(file.id)
                  }
                  aria-disabled={openDisabled}
                >
                  <ProjectResourceIcon kind={file.kind} title={file.title} />
                  <span className={styles.title} title={file.title}>
                    {file.title}
                  </span>
                </button>
                {!props.selection ? (
                  <Menu
                    contentOptions={{ align: 'end' }}
                    items={
                      <FileMenuItems
                        file={file}
                        siblings={query.items}
                        trash={props.trash}
                        pending={props.pending.has(file.id)}
                        onAction={props.onAction}
                        onChange={props.onChange}
                        onDelete={props.onDelete}
                      />
                    }
                  >
                    <IconButton
                      size="16"
                      tooltip={t[
                        'com.affine.localmind.project-files.actions'
                      ]()}
                      aria-label={t[
                        'com.affine.localmind.project-files.actions'
                      ]()}
                      icon={<MoreHorizontalIcon />}
                    />
                  </Menu>
                ) : null}
                {props.pending.has(file.id) ? <Loading size={16} /> : null}
              </ProjectFileDropTarget>
              {folder && expanded && !props.trash ? (
                <div className={styles.nested}>
                  <FileBranch {...props} parentId={file.id} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!query.items.length ? (
        <div className={styles.state}>
          {t['com.affine.localmind.project-files.empty']()}
        </div>
      ) : null}
      {query.hasMore ? (
        <Button
          disabled={query.loadingMore}
          loading={query.loadingMore}
          onClick={() => void query.loadMore()}
        >
          {t['com.affine.localmind.project-files.more']()}
        </Button>
      ) : null}
    </>
  );
}

const ignoreTreeAction = () => {};
const NO_PENDING = new Set<string>();
export function ProjectFileSelectionTree({
  projectId,
  selected,
  disabled,
  limit,
  onToggle,
}: {
  projectId: string;
  selected: ReadonlySet<string>;
  disabled: boolean;
  limit?: number;
  onToggle: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(new Set<string>());
  return (
    <FileBranch
      projectId={projectId}
      parentId={null}
      selectedResourceId={null}
      onOpen={ignoreTreeAction}
      trash={false}
      pending={NO_PENDING}
      expanded={expanded}
      onToggle={id =>
        setExpanded(current => {
          const next = new Set(current);
          if (!next.delete(id)) next.add(id);
          return next;
        })
      }
      onAction={ignoreTreeAction}
      onChange={ignoreTreeAction}
      onFiles={ignoreTreeAction}
      selection={{ ids: selected, disabled, limit, toggle: id => onToggle(id) }}
    />
  );
}

export function ProjectFiles(props: FileTreeProps) {
  const t = useI18n();
  const parentId = props.parentId ?? null;
  const [expanded, setExpanded] = useState(new Set<string>());
  const [trash, setTrash] = useState(false);
  const [search, setSearch] = useState('');
  const searchText = useDeferredValue(search.trim());
  const actions = useProjectFileActions({
    projectId: props.projectId,
    parentId,
    onOpen: props.onOpen,
    onFolderCreated: id => setExpanded(current => new Set(current).add(id)),
  });
  const {
    selecting,
    setSelecting,
    setSelected,
    selectionIds,
    toggleSelected,
    batchPending,
    pendingKeys,
    elements,
  } = actions;

  return (
    <section
      className={styles.root}
      aria-label={t['com.affine.localmind.project-files.title']()}
      onDragOver={event => {
        if (!trash && event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={event => {
        if (!trash && event.dataTransfer.files.length) {
          event.preventDefault();
          actions.enqueueFiles(Array.from(event.dataTransfer.files), parentId);
        }
      }}
    >
      <div className={styles.toolbar}>
        <h3 className={styles.heading}>
          {trash
            ? t['com.affine.localmind.project-files.trash']()
            : t['com.affine.localmind.project-files.title']()}
        </h3>
        <IconButton
          size="16"
          icon={<DeleteTemporarilyIcon />}
          tooltip={t['com.affine.localmind.project-files.trash']()}
          aria-label={t['com.affine.localmind.project-files.trash']()}
          aria-pressed={trash}
          onClick={() => {
            setTrash(value => !value);
            setSearch('');
            setSelecting(false);
            setSelected(new Map());
          }}
          disabled={batchPending}
        />
        <IconButton
          size="16"
          icon={<UploadIcon />}
          tooltip={t['com.affine.localmind.project-files.upload']()}
          aria-label={t['com.affine.localmind.project-files.upload']()}
          disabled={trash}
          onClick={actions.openUpload}
        />
        <Menu items={<CreateMenuItems actions={actions} />}>
          <IconButton
            size="16"
            icon={<PlusIcon />}
            tooltip={t['com.affine.localmind.project-files.create']()}
            aria-label={t['com.affine.localmind.project-files.create']()}
            disabled={actions.createPending || trash}
          />
        </Menu>
        <Button disabled={trash} onClick={actions.openImport}>
          {t['com.affine.localmind.workspace-import.title']()}
        </Button>
        <Button
          aria-pressed={selecting}
          disabled={trash || batchPending}
          onClick={() => {
            setSelecting(value => !value);
            setSelected(new Map());
            actions.setBatchMessage(null);
          }}
        >
          {selecting
            ? t['Done']()
            : t['com.affine.localmind.workbench.fusion.selectResources']()}
        </Button>
        {elements.uploadInput}
      </div>
      {!trash ? (
        <div className={styles.searchToolbar}>
          <Input
            value={search}
            maxLength={128}
            aria-label={t['com.affine.localmind.workbench.fusion.fileSearch']()}
            placeholder={t[
              'com.affine.localmind.workbench.fusion.fileSearch'
            ]()}
            onChange={setSearch}
          />
        </div>
      ) : null}
      {selecting ? <SelectionToolbar actions={actions} /> : null}
      {elements.batchMessage}
      {!trash ? elements.importStatus : null}
      {elements.importPicker}
      {elements.errorAlert}
      {elements.uploadList}
      {searchText && !trash ? (
        <ProjectResourceSearch
          key={props.projectId + ':' + searchText}
          projectId={props.projectId}
          query={searchText}
          onOpen={props.onOpen}
          selection={
            selecting
              ? {
                  ids: selectionIds,
                  disabled: batchPending,
                  toggle: toggleSelected,
                }
              : undefined
          }
        />
      ) : (
        <ProjectFolderDropTarget
          projectId={props.projectId}
          parentId={parentId}
          trash={trash}
          onMove={actions.changeFile}
        >
          <FileBranch
            {...props}
            key={`${props.projectId}:${trash}`}
            parentId={trash ? null : parentId}
            trash={trash}
            pending={pendingKeys}
            onFiles={actions.enqueueFiles}
            onDelete={actions.permanentlyDelete}
            expanded={expanded}
            onToggle={id =>
              setExpanded(current => {
                const next = new Set(current);
                if (!next.delete(id)) next.add(id);
                return next;
              })
            }
            onAction={actions.selectAction}
            onChange={actions.changeFile}
            selection={
              selecting
                ? {
                    ids: selectionIds,
                    disabled: batchPending,
                    limit: 50,
                    includeFolders: true,
                    toggle: toggleSelected,
                  }
                : undefined
            }
          />
        </ProjectFolderDropTarget>
      )}
      {elements.nativeCreate}
      {elements.modal}
    </section>
  );
}
