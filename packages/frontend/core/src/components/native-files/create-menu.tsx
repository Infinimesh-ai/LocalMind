import {
  IconButton,
  Menu,
  MenuItem,
  MenuSub,
  toast,
  usePromptModal,
} from '@affine/component';
import { useGuard } from '@affine/core/components/guard';
import { GraphQLService } from '@affine/core/modules/cloud';
import {
  OrganizeService,
  WorkspacePageTreeService,
} from '@affine/core/modules/organize';
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  WorkspaceResourcesService,
  WorkspaceUploadsService,
} from '@affine/core/modules/workspace-resources';
import {
  type CreateWorkspaceNativeResourceInput,
  WORKSPACE_PAGE_TREE_CONTRACT,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  EdgelessIcon,
  FolderIcon,
  PageIcon,
  PlusIcon,
  UploadIcon,
} from '@blocksuite/icons/rc';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@toeverything/infra';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { useCreatedResourceNavigation } from '../page-tree/created-resource';
import { NativeFileCreateDialog, type NativeFileFormat } from './create-dialog';
import * as styles from './native-files.css';

export function WorkspaceCreateMenu({
  children,
  treeTarget: providedTreeTarget,
  onNativeCreated,
  parentId = null,
  onPage,
  onEdgeless,
  onFolder,
  extra,
  droppedFiles,
  uploadOnly = false,
}: {
  children?: ReactNode;
  treeTarget?: Pick<
    CreateWorkspaceNativeResourceInput,
    | 'parentNodeId'
    | 'treeContractVersion'
    | 'expectedTreeRevision'
    | 'expectedAuthorizationRevision'
  > & {
    name: string;
    canOrganize: boolean;
    canCreateFolder?: boolean;
    canCreatePage?: boolean;
  };
  onNativeCreated?: () => void;
  parentId?: string | null;
  onPage: () => void | Promise<unknown>;
  onEdgeless: () => void | Promise<unknown>;
  onFolder?: () => void | Promise<unknown>;
  extra?: ReactNode;
  droppedFiles?: File[];
  uploadOnly?: boolean;
}) {
  const t = useI18n();
  const { workspace } = useService(WorkspaceService);
  const graphql = useServiceOptional(GraphQLService);
  const beginCreation = useCreatedResourceNavigation();
  const nativeCompletion = useRef<ReturnType<typeof beginCreation> | null>(
    null
  );
  const resources = useService(WorkspaceResourcesService);
  const tree = useService(OrganizeService).folderTree;
  const pageTree = useService(WorkspacePageTreeService);
  const pageTreeEnabled = useLiveData(pageTree.enabled$);
  const treeRoot = useLiveData(
    useMemo(() => pageTree.layer$(null), [pageTree])
  ).page;
  const treeTarget =
    providedTreeTarget ??
    (pageTreeEnabled && treeRoot && parentId === null
      ? {
          parentNodeId: null,
          treeContractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
          expectedTreeRevision: treeRoot.revision,
          expectedAuthorizationRevision: treeRoot.authorizationRevision,
          name: workspace.name$.value ?? 'Workspace',
          canOrganize: treeRoot.canCreateFolder || treeRoot.canCreatePage,
          canCreateFolder: treeRoot.canCreateFolder,
          canCreatePage: treeRoot.canCreatePage,
        }
      : undefined);
  const parent = useLiveData(parentId ? tree.folderNode$(parentId) : undefined);
  const parentName = useLiveData(parent?.name$);
  const legacyCanOrganize = useLiveData(
    parentId ? parent?.canMutate$ : tree.canMutate$
  );
  const canOrganize = treeTarget ? treeTarget.canOrganize : legacyCanOrganize;
  const treeInput = treeTarget
    ? {
        parentNodeId: treeTarget.parentNodeId,
        treeContractVersion: treeTarget.treeContractVersion,
        expectedTreeRevision: treeTarget.expectedTreeRevision,
        expectedAuthorizationRevision: treeTarget.expectedAuthorizationRevision,
      }
    : undefined;
  const canWrite = useGuard('Workspace_Blobs_Write') === true;
  const canCreate = useGuard('Workspace_CreateDoc') === true;
  const createPage = async (primaryMode: 'page' | 'edgeless') => {
    if (!providedTreeTarget && treeTarget) {
      const complete = beginCreation();
      const result = await pageTree.execute({
        action: 'create',
        parentNodeId: treeTarget.parentNodeId ?? null,
        primaryMode,
        title: t['Untitled'](),
      });
      await complete([{ ...result, kind: 'doc' }]);
    } else await (primaryMode === 'page' ? onPage() : onEdgeless());
  };
  const { openPromptModal } = usePromptModal();
  const [format, setFormat] = useState<NativeFileFormat | null>(null);
  const uploadService = useService(WorkspaceUploadsService);
  const uploads = useLiveData(uploadService.jobs$);
  const showUploads = useLiveData(uploadService.panelOpen$);
  const ownUploads = useRef<{
    ids: string[];
    complete: ReturnType<typeof beginCreation>;
  } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const online = workspace.flavour !== 'local' && !!graphql;
  const invoke = (action: () => void | Promise<unknown>) => {
    void Promise.resolve()
      .then(action)
      .catch(() =>
        toast(t['com.affine.localmind.project-files.operationFailed']())
      );
  };
  useEffect(() => {
    const batch = ownUploads.current;
    if (!batch) return;
    const jobs = uploads.filter(job => batch.ids.includes(job.requestKey));
    if (
      !jobs.length ||
      jobs.some(job => job.status === 'waiting' || job.status === 'uploading')
    )
      return;
    ownUploads.current = null;
    const created = jobs.flatMap(job => (job.resource ? [job.resource] : []));
    if (!created.length) return;
    onNativeCreated?.();
    if (showUploads)
      void batch
        .complete(created, { focusEditor: false, batch: batch.ids.length > 1 })
        .catch(() =>
          toast(t['com.affine.localmind.project-files.operationFailed']())
        );
  }, [uploads, showUploads, onNativeCreated, t]);
  const acceptFiles = (files: File[]) => {
    if (!files.length || !online || !canWrite || !canOrganize) return;
    const ids = uploadService.enqueue(files, {
      name:
        treeTarget?.name ?? parentName ?? workspace.name$.value ?? 'Workspace',
      folderId: parentId,
      ...(treeInput
        ? {
            tree: {
              parentNodeId: treeInput.parentNodeId,
              treeContractVersion: treeInput.treeContractVersion,
            },
          }
        : {}),
    });
    ownUploads.current = {
      ids: [...(ownUploads.current?.ids ?? []), ...ids],
      complete: ownUploads.current?.complete ?? beginCreation(),
    };
    uploadService.setPanelOpen(true);
  };
  const lastDrop = useRef<File[] | undefined>(undefined);
  useEffect(() => {
    if (droppedFiles && droppedFiles !== lastDrop.current) {
      lastDrop.current = droppedFiles;
      acceptFiles(droppedFiles);
    }
  });
  const createFolder = () =>
    openPromptModal({
      title: t['com.affine.rootAppSidebar.organize.folder.create-subfolder'](),
      inputOptions: {
        placeholder: t['com.affine.rootAppSidebar.organize.new-folders'](),
      },
      confirmText: t['Save'](),
      cancelText: t['Cancel'](),
      onConfirm: async name => {
        if (treeTarget) {
          const complete = beginCreation();
          const result = await pageTree.execute({
            action: 'create-folder',
            parentNodeId: treeTarget.parentNodeId ?? null,
            title: name,
          });
          await complete([{ ...result, kind: 'folder' }]);
          return;
        }
        const node = parentId
          ? tree.folderNode$(parentId).value
          : tree.rootFolder;
        if (!node || !name.trim()) throw new Error('Folder unavailable');
        await node.createFolder(name.trim(), node.indexAt('after'));
      },
    });
  return (
    <>
      {!uploadOnly && (
        <span
          style={{ display: 'inline-flex' }}
          onDragOver={event => {
            if (
              event.dataTransfer.types.includes('Files') &&
              canWrite &&
              canOrganize
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={event => {
            if (event.dataTransfer.files.length) {
              event.preventDefault();
              event.stopPropagation();
              acceptFiles(Array.from(event.dataTransfer.files));
            }
          }}
        >
          <Menu
            items={
              <>
                <div className={styles.hint}>
                  {t['com.affine.localmind.resources.destination']({
                    name:
                      treeTarget?.name ??
                      parentName ??
                      workspace.name$.value ??
                      'Workspace',
                  })}
                </div>
                <MenuItem
                  prefixIcon={<FolderIcon />}
                  disabled={
                    !canOrganize || (treeTarget && !treeTarget.canCreateFolder)
                  }
                  onClick={() => invoke(onFolder ?? createFolder)}
                >
                  {t['com.affine.rootAppSidebar.organize.new-folders']()}
                </MenuItem>
                <MenuItem
                  prefixIcon={<PageIcon />}
                  disabled={
                    !canOrganize ||
                    (treeTarget ? !treeTarget.canCreatePage : !canCreate)
                  }
                  onClick={() => invoke(() => createPage('page'))}
                >
                  {t['Page']()}
                </MenuItem>
                <MenuItem
                  prefixIcon={<EdgelessIcon />}
                  disabled={
                    !canOrganize ||
                    (treeTarget ? !treeTarget.canCreatePage : !canCreate)
                  }
                  onClick={() => invoke(() => createPage('edgeless'))}
                >
                  {t['Edgeless']()}
                </MenuItem>
                {extra}
                {online && (
                  <>
                    {(['docx', 'xlsx', 'pptx'] as const).map(value => (
                      <MenuItem
                        key={value}
                        disabled={!canWrite || !canOrganize}
                        onClick={() => setFormat(value)}
                      >
                        {
                          {
                            docx: 'Word (.docx)',
                            xlsx: 'Excel (.xlsx)',
                            pptx: 'PowerPoint (.pptx)',
                          }[value]
                        }
                      </MenuItem>
                    ))}
                    <MenuSub
                      triggerOptions={{ disabled: !canWrite || !canOrganize }}
                      items={
                        <>
                          {(['txt', 'md', 'csv', 'json'] as const).map(
                            value => (
                              <MenuItem
                                key={value}
                                onClick={() => setFormat(value)}
                              >
                                {value === 'md'
                                  ? 'Markdown (.md)'
                                  : value.toUpperCase()}
                              </MenuItem>
                            )
                          )}
                        </>
                      }
                    >
                      {t['com.affine.localmind.resources.textFiles']()}
                    </MenuSub>
                  </>
                )}

                {!!uploads.length && (
                  <MenuItem
                    prefixIcon={<UploadIcon />}
                    onClick={() => uploadService.setPanelOpen(true)}
                  >
                    {t['com.affine.localmind.resources.upload.progress']()}
                  </MenuItem>
                )}
                {online && (
                  <MenuItem
                    prefixIcon={<UploadIcon />}
                    disabled={!canWrite || !canOrganize}
                    onClick={() => picker.current?.click()}
                  >
                    {t['com.affine.localmind.resources.uploadLocal']()}
                  </MenuItem>
                )}
              </>
            }
          >
            {children ?? (
              <IconButton
                size="16"
                tooltip={t['com.affine.localmind.resources.create']()}
                aria-label={t['com.affine.localmind.resources.destination']({
                  name:
                    treeTarget?.name ??
                    parentName ??
                    workspace.name$.value ??
                    'Workspace',
                })}
              >
                <PlusIcon />
              </IconButton>
            )}
          </Menu>
        </span>
      )}
      <input
        type="file"
        multiple
        hidden
        style={{ display: 'none' }}
        ref={picker}
        // Tree-row link handlers cancel bubbled clicks, including file pickers.
        onClick={event => event.stopPropagation()}
        onChange={event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          acceptFiles(files);
        }}
      />
      {format && (
        <NativeFileCreateDialog
          owner={{ workspaceId: workspace.id }}
          parentId={parentId}
          treeTarget={treeInput}
          initialFormat={format}
          onClose={() => setFormat(null)}
          onStart={() => {
            nativeCompletion.current = beginCreation();
          }}
          onCreated={(id, kind) => {
            resources.invalidate();
            onNativeCreated?.();
            void nativeCompletion
              .current?.([{ resourceId: id, kind }])
              .catch(console.error);
          }}
        />
      )}
    </>
  );
}
