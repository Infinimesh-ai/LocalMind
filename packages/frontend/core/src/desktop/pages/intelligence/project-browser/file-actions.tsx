import {
  Button,
  IconButton,
  Input,
  Loading,
  MenuItem,
  Modal,
  notify,
  useConfirmModal,
} from '@affine/component';
import { NativeFileCreateDialog } from '@affine/core/components/native-files/create-dialog';
import {
  useOpenReportDeck,
  useReportDeckEntryAvailable,
} from '@affine/core/components/report-deck-entry';
import { GraphQLService, ServerService } from '@affine/core/modules/cloud';
import { useProjectUnsavedConfirmation } from '@affine/core/modules/project-resources/edit-guard';
import { projectEditLeaseStore } from '@affine/core/modules/project-resources/edit-lease-store';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import {
  type ProjectUploadProgress,
  uploadProjectBlobWithProgress,
} from '@affine/core/modules/project-resources/upload';
import { ProjectUploadQueue } from '@affine/core/modules/project-resources/upload-queue';
import {
  changeProjectResourceMutation,
  createProjectResourceMutation,
  permanentlyDeleteProjectResourceMutation,
  type ProjectEditLeaseProofInput,
  ProjectResourceKind,
  projectResourcePathQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  ArrowDownSmallIcon,
  ArrowLeftSmallIcon,
  ArrowRightSmallIcon,
  ArrowUpSmallIcon,
  DeleteTemporarilyIcon,
  EditIcon,
  FolderIcon,
  PageIcon,
  PresentationIcon,
  ResetIcon,
} from '@blocksuite/icons/rc';
import type { DeckSourceRef } from '@localmind/office/report-deck';
import { useService } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import * as styles from '../project-files.css';
import {
  type ProjectFile,
  uploadProjectFile,
  useProjectFolder,
} from '../project-files-data';
import {
  ProjectWorkspaceImportPicker,
  ProjectWorkspaceImportStatus,
} from '../project-workspace-import';

export type FileAction =
  | {
      kind: 'create';
      parentId: string | null;
      resourceKind: ProjectResourceKind;
      name: string;
      requestKey: string;
    }
  | {
      kind: 'rename' | 'move';
      file: ProjectFile;
      files?: ProjectFile[];
      name: string;
      requestKey: string;
    };

export type FileChange = {
  trash?: boolean;
  parentId?: string | null;
  beforeId?: string | null;
};

export const SELECTION_LIMIT = 50;

/** Report deck source for a selected project resource. */
export function projectFileDeckSource(
  projectId: string,
  file: Pick<ProjectFile, 'id' | 'kind' | 'title'>
): DeckSourceRef {
  return {
    scopeKind: 'project',
    scopeId: projectId,
    kind:
      file.kind === ProjectResourceKind.folder
        ? 'folder'
        : file.kind === ProjectResourceKind.page ||
            file.kind === ProjectResourceKind.edgeless
          ? 'doc'
          : 'file',
    resourceId: file.id,
    title: file.title,
  };
}

function MoveFolderList({
  projectId,
  path,
  excludedId,
  excludedIds,
  onEnter,
}: {
  projectId: string;
  path: ProjectFile[];
  excludedId: string;
  excludedIds?: ReadonlySet<string>;
  onEnter: (file: ProjectFile) => void;
}) {
  const t = useI18n();
  const [search, setSearch] = useState('');
  const query = useProjectFolder({
    projectId,
    parentId: path.at(-1)?.id ?? null,
    search,
  });
  return (
    <>
      <Input
        value={search}
        onChange={setSearch}
        maxLength={128}
        placeholder={t['com.affine.localmind.project-files.search']()}
      />
      <div className={styles.picker}>
        {query.isLoading && !query.error ? (
          <div className={styles.state}>
            <Loading size={20} />
          </div>
        ) : query.error ? (
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
        ) : (
          <>
            {query.items
              .filter(file => file.kind === ProjectResourceKind.folder)
              .map(file => (
                <button
                  className={styles.open}
                  type="button"
                  key={file.id}
                  disabled={file.id === excludedId || excludedIds?.has(file.id)}
                  onClick={() => onEnter(file)}
                >
                  <FolderIcon />
                  <span className={styles.title}>{file.title}</span>
                  <ArrowRightSmallIcon />
                </button>
              ))}
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
        )}
      </div>
    </>
  );
}

type Upload = {
  file: File;
  requestKey: string;
  parentId: string | null;
  status: 'queued' | 'uploading' | 'processing' | 'completed' | 'failed';
  progress?: ProjectUploadProgress;
  error?: string;
  blobKey?: string;
};

/**
 * Data/action layer shared by the project file tree and the Finder-style
 * project browser: mutations, uploads, multi-select batches and dialogs.
 */
export function useProjectFileActions(props: {
  projectId: string;
  parentId: string | null;
  onOpen: (resourceId: string) => void;
  onFolderCreated?: (parentId: string) => void;
}) {
  const t = useI18n();
  const { openConfirmModal } = useConfirmModal();
  const graphql = useService(GraphQLService);
  const server = useService(ServerService).server;
  const parentId = props.parentId;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Map<string, ProjectFile>());
  const selectionIds = useMemo(() => new Set(selected.keys()), [selected]);
  const [batchPending, setBatchPending] = useState(false);
  const batchInFlight = useRef(false);
  const batchKeys = useRef(new Map<string, string>());
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const toggleSelected = (_id: string, file?: ProjectFile) => {
    if (!file || batchInFlight.current) return;
    setSelected(current => {
      const next = new Map(current);
      if (!next.delete(file.id) && next.size < SELECTION_LIMIT)
        next.set(file.id, file);
      return next;
    });
  };
  /** Replaces the selection, e.g. for a plain click or a Shift range. */
  const replaceSelection = (files: ProjectFile[]) => {
    if (batchInFlight.current) return;
    setSelected(
      new Map(
        files.slice(0, SELECTION_LIMIT).map(file => [file.id, file] as const)
      )
    );
  };
  const [importOpen, setImportOpen] = useState(false);
  const [nativeCreateOpen, setNativeCreateOpen] = useState(false);
  const [importRevision, setImportRevision] = useState(0);
  const [action, setAction] = useState<FileAction | null>(null);
  const [path, setPath] = useState<ProjectFile[]>([]);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    new Set()
  );
  const pendingRef = useRef(new Set<string>());
  const actionKey =
    action?.kind === 'create'
      ? `create:${action.parentId ?? 'root'}`
      : action?.file.id;
  const pending = !!actionKey && pendingKeys.has(actionKey);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const uploadQueue = useRef<ProjectUploadQueue<Upload> | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const report = (caught: unknown) => {
    const message = projectErrorMessage(caught);
    notify.error({ title: message });
    return message;
  };
  const run = async (key: string, operation: () => Promise<void>) => {
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPendingKeys(new Set(pendingRef.current));
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(report(caught));
    } finally {
      pendingRef.current.delete(key);
      setPendingKeys(new Set(pendingRef.current));
    }
  };

  const confirmUnsaved = useProjectUnsavedConfirmation();
  const reportDeckAvailable = useReportDeckEntryAvailable();
  const openReportDeck = useOpenReportDeck();
  const batchChange = async (
    files: ProjectFile[],
    change: { parentId?: string | null; trash?: boolean }
  ) => {
    if (batchInFlight.current) return;
    batchInFlight.current = true;
    setBatchPending(true);
    setBatchMessage(null);
    const paths = new Map<string, string[]>();
    const successful = new Set<string>();
    try {
      if (!(await confirmUnsaved())) return;
      // Resolve ancestry before changing anything, so selecting a folder and
      // its descendants never moves them twice or flattens their hierarchy.
      for (const file of files) {
        try {
          const result = await graphql.gql({
            query: projectResourcePathQuery,
            variables: { projectId: props.projectId, resourceId: file.id },
          });
          paths.set(
            file.id,
            result.projectResourcePath.map(part => part.id)
          );
        } catch (caught) {
          setError(report(caught));
        }
      }
      const ids = new Set(
        files.filter(file => paths.has(file.id)).map(file => file.id)
      );
      const roots = files.filter(
        file =>
          paths.has(file.id) &&
          !paths.get(file.id)?.some(id => id !== file.id && ids.has(id))
      );
      for (const file of roots) {
        const identity = JSON.stringify([file.id, file.version, change]);
        const requestKey = batchKeys.current.get(identity) ?? nanoid();
        batchKeys.current.set(identity, requestKey);
        pendingRef.current.add(file.id);
        setPendingKeys(new Set(pendingRef.current));
        try {
          await graphql.gql({
            query: changeProjectResourceMutation,
            variables: {
              input: {
                projectId: props.projectId,
                resourceId: file.id,
                expectedVersion: file.version,
                requestKey,
                ...change,
              },
            },
          });
          batchKeys.current.delete(identity);
          for (const selectedFile of files)
            if (paths.get(selectedFile.id)?.includes(file.id))
              successful.add(selectedFile.id);
        } catch (caught) {
          setError(report(caught));
        } finally {
          pendingRef.current.delete(file.id);
          setPendingKeys(new Set(pendingRef.current));
        }
      }
      setSelected(
        current => new Map([...current].filter(([id]) => !successful.has(id)))
      );
      setBatchMessage(
        t['com.affine.localmind.workbench.fusion.batchResult']({
          success: String(successful.size),
          failed: String(files.length - successful.size),
        })
      );
    } finally {
      batchInFlight.current = false;
      setBatchPending(false);
    }
  };

  const submit = () =>
    run(actionKey ?? 'create', async () => {
      if (!action) return;
      if (action.kind === 'create') {
        const result = await graphql.gql({
          query: createProjectResourceMutation,
          variables: {
            input: {
              projectId: props.projectId,
              parentId: action.parentId,
              kind: action.resourceKind,
              title: action.name.trim(),
              markdown: '',
              requestKey: action.requestKey,
            },
          },
        });
        if (action.parentId) props.onFolderCreated?.(action.parentId);
        if (result.createProjectResource.kind !== ProjectResourceKind.folder)
          props.onOpen(result.createProjectResource.id);
      } else if (action.kind === 'move' && action.files) {
        await batchChange(action.files, { parentId: path.at(-1)?.id ?? null });
      } else {
        const change = (editLease?: ProjectEditLeaseProofInput) =>
          graphql.gql({
            query: changeProjectResourceMutation,
            variables: {
              input: {
                projectId: props.projectId,
                resourceId: action.file.id,
                expectedVersion: action.file.version,
                requestKey: action.requestKey,
                editLease,
                ...(action.kind === 'move'
                  ? { parentId: path.at(-1)?.id ?? null }
                  : { title: action.name.trim() }),
              },
            },
          });
        if (action.kind === 'rename')
          await projectEditLeaseStore(
            graphql,
            props.projectId,
            action.file.id
          ).withProof(change);
        else await change();
      }
      setAction(null);
    });

  const permanentlyDelete = (file: ProjectFile) => {
    const requestKey = nanoid();
    openConfirmModal({
      title: t['com.affine.localmind.project-files.permanentlyDelete'](),
      description: t[
        'com.affine.localmind.project-files.permanentlyDeleteConfirm'
      ]({ title: file.title }),
      confirmText: t['com.affine.localmind.project-files.permanentlyDelete'](),
      cancelText: t['Cancel'](),
      confirmButtonOptions: { variant: 'error' },
      onConfirm: () =>
        run(file.id, async () => {
          await graphql.gql({
            query: permanentlyDeleteProjectResourceMutation,
            variables: {
              input: {
                projectId: props.projectId,
                resourceId: file.id,
                expectedVersion: file.version,
                requestKey,
              },
            },
          });
        }),
    });
  };

  const selectAction = (next: FileAction) => {
    setError(null);
    if (
      next.kind === 'create' &&
      next.resourceKind !== ProjectResourceKind.folder
    ) {
      void run(`create:${next.parentId ?? 'root'}`, async () => {
        const result = await graphql.gql({
          query: createProjectResourceMutation,
          variables: {
            input: {
              projectId: props.projectId,
              parentId: next.parentId,
              kind: next.resourceKind,
              title: t['Untitled'](),
              markdown: '',
              requestKey: next.requestKey,
            },
          },
        });
        props.onOpen(result.createProjectResource.id);
      }).catch(report);
    } else {
      setPath([]);
      setAction(next);
    }
  };

  const changeFile = (file: ProjectFile, change: FileChange) => {
    void run(file.id, async () => {
      await graphql.gql({
        query: changeProjectResourceMutation,
        variables: {
          input: {
            projectId: props.projectId,
            resourceId: file.id,
            expectedVersion: file.version,
            requestKey: nanoid(),
            ...change,
          },
        },
      });
    }).catch(report);
  };

  const upload = async (input: Upload, signal: AbortSignal) => {
    const update = (patch: Partial<Upload>) => {
      if (!signal.aborted)
        setUploads(current =>
          current.map(item =>
            item.requestKey === input.requestKey ? { ...item, ...patch } : item
          )
        );
    };
    update({ status: 'uploading', error: undefined, progress: undefined });
    await uploadProjectFile(graphql, {
      ...input,
      projectId: props.projectId,
      signal,
      uploadBlob: async file => {
        if (input.blobKey) return input.blobKey;
        const blobKey = await uploadProjectBlobWithProgress({
          baseUrl: server.serverMetadata.baseUrl,
          projectId: props.projectId,
          file,
          signal,
          onProgress: progress => update({ progress }),
        });
        input.blobKey = blobKey;
        update({ blobKey });
        return blobKey;
      },
      onUploaded: () => update({ status: 'processing' }),
    });
    update({ status: 'completed' });
  };
  const enqueueFiles = (files: File[], directoryId: string | null) => {
    const queue: Upload[] = files.map(file => ({
      file,
      parentId: directoryId,
      requestKey: nanoid(),
      status: 'queued',
    }));
    setUploads(current => [...current, ...queue]);
    uploadQueue.current?.enqueue(queue);
  };
  const executeUpload = useRef(upload);
  executeUpload.current = upload;
  const reportUpload = useRef(report);
  reportUpload.current = report;
  useEffect(() => {
    const queue = new ProjectUploadQueue<Upload>(
      (job, signal) => executeUpload.current(job, signal),
      (job, caught) => {
        const error = reportUpload.current(caught);
        setUploads(current =>
          current.map(item =>
            item.requestKey === job.requestKey
              ? { ...item, status: 'failed', error }
              : item
          )
        );
      },
      3,
      job => {
        setUploads(current =>
          current.map(item =>
            item.requestKey === job.requestKey
              ? { ...item, status: 'queued', error: 'throttled' }
              : item
          )
        );
      }
    );
    uploadQueue.current = queue;
    return () => {
      queue.dispose();
      uploadQueue.current = null;
    };
  }, []);

  const batchMove = () => {
    const files = [...selected.values()];
    if (!files.length) return;
    selectAction({
      kind: 'move',
      file: files[0],
      files,
      name: '',
      requestKey: nanoid(),
    });
  };
  const batchTrash = () => {
    const files = [...selected.values()];
    if (!files.length) return;
    openConfirmModal({
      title: t['com.affine.localmind.workbench.fusion.batchTrash'](),
      description: files.map(file => file.title).join('、'),
      confirmText: t['com.affine.localmind.workbench.fusion.batchTrash'](),
      cancelText: t['Cancel'](),
      onConfirm: () => batchChange(files, { trash: true }),
    });
  };
  const presentSelection = () => {
    const files = [...selected.values()];
    if (!files.length) return;
    void confirmUnsaved()
      .then(allowed => {
        if (!allowed) return;
        openReportDeck(
          files.map(file => projectFileDeckSource(props.projectId, file))
        );
      })
      .catch(report);
  };
  const create = (resourceKind: ProjectResourceKind, inFolder = parentId) =>
    selectAction({
      kind: 'create',
      parentId: inFolder,
      resourceKind,
      name: '',
      requestKey: nanoid(),
    });

  const title =
    action?.kind === 'move'
      ? t['com.affine.localmind.project-files.move']()
      : action?.kind === 'rename'
        ? t['com.affine.localmind.project-files.rename']()
        : action?.kind === 'create' &&
            action.resourceKind === ProjectResourceKind.folder
          ? t['com.affine.localmind.project-files.newFolder']()
          : action?.kind === 'create' &&
              action.resourceKind === ProjectResourceKind.edgeless
            ? t['com.affine.localmind.project-files.newCanvas']()
            : t['com.affine.localmind.project-files.newDocument']();

  const uploadInput = (
    <input
      className={styles.hidden}
      ref={uploadRef}
      type="file"
      multiple
      onChange={event => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        enqueueFiles(files, parentId);
      }}
    />
  );
  const batchMessageElement = batchMessage ? (
    <p className={styles.batchMessage} role="status">
      {batchMessage}
    </p>
  ) : null;
  const importStatus = (
    <ProjectWorkspaceImportStatus
      key={`${props.projectId}:${parentId}`}
      projectId={props.projectId}
      parentId={parentId}
      revision={importRevision}
      onOpen={props.onOpen}
    />
  );
  const importPicker = importOpen ? (
    <ProjectWorkspaceImportPicker
      projectId={props.projectId}
      parentId={parentId}
      onClose={() => setImportOpen(false)}
      onSubmitted={() => setImportRevision(value => value + 1)}
    />
  ) : null;
  const errorAlert =
    error && !action ? (
      <div className={styles.state} role="alert">
        <span>{error}</span>
      </div>
    ) : null;
  const uploadList = uploads.length ? (
    <ul className={styles.uploads} aria-live="polite">
      {uploads.map(item => (
        <li key={item.requestKey} className={styles.uploadRow}>
          <span className={styles.title}>{item.file.name}</span>
          <span>
            {item.status === 'queued' && item.error === 'throttled'
              ? t['com.affine.localmind.project-files.upload.waitingForLimit']()
              : t[`com.affine.localmind.project-files.upload.${item.status}`]()}
          </span>
          {item.status === 'uploading' ? (
            <progress
              aria-label={item.file.name}
              max={item.progress?.total ?? 1}
              value={item.progress?.loaded}
            />
          ) : null}
          {item.status === 'failed' ? (
            <Button onClick={() => uploadQueue.current?.enqueue([item])}>
              {t['com.affine.localmind.project-files.retry']()}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  ) : null;
  const nativeCreate = nativeCreateOpen ? (
    <NativeFileCreateDialog
      owner={{ projectId: props.projectId }}
      parentId={parentId}
      onClose={() => setNativeCreateOpen(false)}
      onCreated={id => props.onOpen(id)}
    />
  ) : null;
  const modal = (
    <Modal
      open={!!action}
      title={title}
      onOpenChange={open => {
        if (!open && !pending) setAction(null);
      }}
    >
      {action ? (
        <form
          className={styles.form}
          onSubmit={event => {
            event.preventDefault();
            void submit().catch(report);
          }}
        >
          {action.kind === 'move' ? (
            <>
              <nav
                className={styles.breadcrumbs}
                aria-label={t['com.affine.localmind.project-files.move']()}
              >
                <IconButton
                  size="16"
                  icon={<ArrowLeftSmallIcon />}
                  disabled={!path.length || pending}
                  tooltip={t['com.affine.localmind.project-files.back']()}
                  aria-label={t['com.affine.localmind.project-files.back']()}
                  onClick={() => setPath(current => current.slice(0, -1))}
                />
                <Button disabled={pending} onClick={() => setPath([])}>
                  {t['com.affine.localmind.project-files.root']()}
                </Button>
                {path.map((file, index) => (
                  <Button
                    key={file.id}
                    disabled={pending}
                    onClick={() =>
                      setPath(current => current.slice(0, index + 1))
                    }
                  >
                    {file.title}
                  </Button>
                ))}
              </nav>
              <MoveFolderList
                key={path.at(-1)?.id ?? 'root'}
                projectId={props.projectId}
                path={path}
                excludedId={action.file.id}
                excludedIds={
                  action.files
                    ? new Set(action.files.map(file => file.id))
                    : undefined
                }
                onEnter={file => {
                  if (!pending) setPath(current => [...current, file]);
                }}
              />
            </>
          ) : (
            <Input
              autoFocus
              autoSelect
              aria-label={t['com.affine.localmind.project-files.name']()}
              value={action.name}
              maxLength={512}
              disabled={pending}
              onChange={name =>
                setAction(current =>
                  current ? { ...current, name, requestKey: nanoid() } : null
                )
              }
            />
          )}
          {error ? <div role="alert">{error}</div> : null}
          <div className={styles.actions}>
            <Button disabled={pending} onClick={() => setAction(null)}>
              {t['com.affine.localmind.project-files.cancel']()}
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={
                pending || (!action.name.trim() && action.kind !== 'move')
              }
              onClick={() => void submit().catch(report)}
            >
              {action.kind === 'move'
                ? t['com.affine.localmind.project-files.moveHere']()
                : action.kind === 'rename'
                  ? t['com.affine.localmind.project-files.save']()
                  : t['com.affine.localmind.project-files.create']()}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );

  return {
    pendingKeys,
    createPending: pendingKeys.has(`create:${parentId ?? 'root'}`),
    error,
    report,
    selecting,
    setSelecting,
    selected,
    setSelected,
    selectionIds,
    toggleSelected,
    replaceSelection,
    batchPending,
    setBatchMessage,
    reportDeckAvailable,
    changeFile,
    selectAction,
    create,
    permanentlyDelete,
    enqueueFiles,
    batchMove,
    batchTrash,
    presentSelection,
    openUpload: () => uploadRef.current?.click(),
    openImport: () => setImportOpen(true),
    openNativeCreate: () => setNativeCreateOpen(true),
    elements: {
      uploadInput,
      batchMessage: batchMessageElement,
      importStatus,
      importPicker,
      errorAlert,
      uploadList,
      nativeCreate,
      modal,
    },
  };
}

export type ProjectFileActions = ReturnType<typeof useProjectFileActions>;

/** The "new" menu shared by the tree toolbar and the browser toolbar. */
export function CreateMenuItems({
  actions,
}: {
  actions: Pick<ProjectFileActions, 'openNativeCreate' | 'create'>;
}) {
  const t = useI18n();
  return (
    <>
      <MenuItem prefixIcon={<PageIcon />} onClick={actions.openNativeCreate}>
        {t['com.affine.localmind.native-files.newFile']()}
      </MenuItem>
      {(
        [
          [
            ProjectResourceKind.page,
            t['com.affine.localmind.project-files.newDocument'](),
          ],
          [
            ProjectResourceKind.edgeless,
            t['com.affine.localmind.project-files.newCanvas'](),
          ],
          [
            ProjectResourceKind.folder,
            t['com.affine.localmind.project-files.newFolder'](),
          ],
        ] as const
      ).map(([kind, label]) => (
        <MenuItem
          key={kind}
          prefixIcon={
            kind === ProjectResourceKind.folder ? <FolderIcon /> : <PageIcon />
          }
          onClick={() => actions.create(kind)}
        >
          {label}
        </MenuItem>
      ))}
    </>
  );
}

/** Batch actions over the multi-selection. */
export function SelectionToolbar({
  actions,
  extra,
}: {
  actions: ProjectFileActions;
  extra?: ReactNode;
}) {
  const t = useI18n();
  const disabled = !actions.selected.size || actions.batchPending;
  return (
    <div className={styles.selectionToolbar}>
      <span>
        {t['com.affine.localmind.workbench.fusion.selectedResources']({
          count: String(actions.selected.size),
        })}{' '}
        / {SELECTION_LIMIT}
      </span>
      <Button disabled={disabled} onClick={actions.batchMove}>
        {t['com.affine.localmind.workbench.fusion.batchMove']()}
      </Button>
      <Button disabled={disabled} onClick={actions.batchTrash}>
        {t['com.affine.localmind.workbench.fusion.batchTrash']()}
      </Button>
      {actions.reportDeckAvailable ? (
        <Button
          prefix={<PresentationIcon />}
          disabled={disabled}
          onClick={actions.presentSelection}
        >
          {t['com.affine.localmind.reportDeck.entry']()}
        </Button>
      ) : null}
      {extra}
    </div>
  );
}

/** Per-item actions, shared by the tree "more" menu and browser context menu. */
export function FileMenuItems({
  file,
  siblings,
  trash,
  pending,
  onAction,
  onChange,
  onDelete,
  reorder = true,
}: {
  file: ProjectFile;
  siblings: readonly ProjectFile[];
  trash: boolean;
  pending: boolean;
  onAction: (action: FileAction) => void;
  onChange: (file: ProjectFile, change: FileChange) => void;
  onDelete?: (file: ProjectFile) => void;
  reorder?: boolean;
}) {
  const t = useI18n();
  const folder = file.kind === ProjectResourceKind.folder;
  const index = siblings.findIndex(item => item.id === file.id);
  if (trash)
    return (
      <>
        <MenuItem
          prefixIcon={<ResetIcon />}
          disabled={pending}
          onClick={() => onChange(file, { trash: false })}
        >
          {t['com.affine.localmind.project-files.restore']()}
        </MenuItem>
        <MenuItem
          prefixIcon={<DeleteTemporarilyIcon />}
          disabled={pending}
          onClick={() => onDelete?.(file)}
        >
          {t['com.affine.localmind.project-files.permanentlyDelete']()}
        </MenuItem>
      </>
    );
  return (
    <>
      {folder ? (
        <>
          <MenuItem
            prefixIcon={<PageIcon />}
            disabled={pending}
            onClick={() =>
              onAction({
                kind: 'create',
                parentId: file.id,
                resourceKind: ProjectResourceKind.page,
                name: '',
                requestKey: nanoid(),
              })
            }
          >
            {t['com.affine.localmind.project-files.newDocument']()}
          </MenuItem>
          <MenuItem
            prefixIcon={<FolderIcon />}
            disabled={pending}
            onClick={() =>
              onAction({
                kind: 'create',
                parentId: file.id,
                resourceKind: ProjectResourceKind.folder,
                name: '',
                requestKey: nanoid(),
              })
            }
          >
            {t['com.affine.localmind.project-files.newFolder']()}
          </MenuItem>
        </>
      ) : null}
      <MenuItem
        prefixIcon={<EditIcon />}
        disabled={pending}
        onClick={() =>
          onAction({
            kind: 'rename',
            file,
            name: file.title,
            requestKey: nanoid(),
          })
        }
      >
        {t['com.affine.localmind.project-files.rename']()}
      </MenuItem>
      <MenuItem
        prefixIcon={<FolderIcon />}
        disabled={pending}
        onClick={() =>
          onAction({
            kind: 'move',
            file,
            name: file.title,
            requestKey: nanoid(),
          })
        }
      >
        {t['com.affine.localmind.project-files.move']()}
      </MenuItem>
      {reorder ? (
        <>
          <MenuItem
            prefixIcon={<ArrowUpSmallIcon />}
            disabled={pending || index <= 0}
            onClick={() => onChange(file, { beforeId: siblings[index - 1].id })}
          >
            {t['com.affine.localmind.project-files.moveUp']()}
          </MenuItem>
          <MenuItem
            prefixIcon={<ArrowDownSmallIcon />}
            disabled={pending || index < 0 || index === siblings.length - 1}
            onClick={() =>
              onChange(file, { beforeId: siblings[index + 2]?.id ?? null })
            }
          >
            {t['com.affine.localmind.project-files.moveDown']()}
          </MenuItem>
        </>
      ) : null}
      <MenuItem
        prefixIcon={<DeleteTemporarilyIcon />}
        disabled={pending}
        onClick={() => onChange(file, { trash: true })}
      >
        {t['com.affine.localmind.project-files.delete']()}
      </MenuItem>
    </>
  );
}
