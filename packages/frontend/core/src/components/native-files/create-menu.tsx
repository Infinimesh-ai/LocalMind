import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  MenuSub,
  Modal,
  toast,
  usePromptModal,
} from '@affine/component';
import { GraphQLService } from '@affine/core/modules/cloud';
import { OrganizeService } from '@affine/core/modules/organize';
import { GuardService } from '@affine/core/modules/permissions';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { WorkspaceResourcesService } from '@affine/core/modules/workspace-resources';
import { createWorkspaceNativeResourceMutation } from '@affine/graphql';
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
import { nanoid } from 'nanoid';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { NativeFileCreateDialog, type NativeFileFormat } from './create-dialog';
import * as styles from './native-files.css';
import { uploadWorkspaceNativeBlob } from './workspace-upload';

type Upload = {
  file: File;
  key: string;
  blobKey?: string;
  status: 'waiting' | 'uploading' | 'done' | 'failed';
};
export function WorkspaceCreateMenu({
  children,
  parentId = null,
  onPage,
  onEdgeless,
  onFolder,
  extra,
  droppedFiles,
  uploadOnly = false,
}: {
  children?: ReactNode;
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
  const { workbench } = useService(WorkbenchService);
  const resources = useService(WorkspaceResourcesService);
  const tree = useService(OrganizeService).folderTree;
  const parent = useLiveData(parentId ? tree.folderNode$(parentId) : undefined);
  const parentName = useLiveData(parent?.name$);
  const canOrganize = useLiveData(
    parentId ? parent?.canMutate$ : tree.canMutate$
  );
  const canWrite =
    useLiveData(useService(GuardService).can$('Workspace_Blobs_Write')) ===
    true;
  const { openPromptModal } = usePromptModal();
  const [format, setFormat] = useState<NativeFileFormat | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const online = workspace.flavour !== 'local' && !!graphql;
  const invoke = (action: () => void | Promise<unknown>) => {
    void Promise.resolve()
      .then(action)
      .catch(() =>
        toast(t['com.affine.localmind.project-files.operationFailed']())
      );
  };
  const openResource = (id: string, kind: string) =>
    kind === 'office' ? workbench.openOffice(id) : workbench.openNativeFile(id);
  const upload = async (requests: Upload[]) => {
    if (busy.current || !graphql) return;
    busy.current = true;
    setUploads([...requests]);
    try {
      for (const request of requests) {
        if (request.status === 'done') continue;
        request.status = 'uploading';
        setUploads([...requests]);
        try {
          request.blobKey ??= await uploadWorkspaceNativeBlob(
            workspace,
            request.file
          );
          const resource = (
            await graphql.gql({
              query: createWorkspaceNativeResourceMutation,
              variables: {
                input: {
                  workspaceId: workspace.id,
                  folderId: parentId,
                  title: request.file.name,
                  blobKey: request.blobKey,
                  requestKey: request.key,
                },
              },
            })
          ).createWorkspaceNativeResource;
          request.status = 'done';
          resources.invalidate();
          if (requests.length === 1) openResource(resource.id, resource.kind);
        } catch {
          request.status = 'failed';
        }
        setUploads([...requests]);
      }
    } finally {
      busy.current = false;
      setUploads([...requests]);
    }
  };
  const acceptFiles = (files: File[]) => {
    if (!files.length || !online || !canWrite || !canOrganize || busy.current)
      return;
    void upload([
      ...uploads.filter(item => item.status !== 'done'),
      ...files.map(file => ({
        file,
        key: nanoid(),
        status: 'waiting' as const,
      })),
    ]).catch(() =>
      toast(t['com.affine.localmind.project-files.operationFailed']())
    );
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
      confirmText: t['save'](),
      cancelText: t['Cancel'](),
      onConfirm: async name => {
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
                    name: parentName ?? workspace.name$.value ?? 'Workspace',
                  })}
                </div>
                <MenuItem
                  prefixIcon={<PageIcon />}
                  onClick={() => invoke(onPage)}
                >
                  {t['Page']()}
                </MenuItem>
                <MenuItem
                  prefixIcon={<EdgelessIcon />}
                  disabled={!canOrganize}
                  onClick={() => invoke(onEdgeless)}
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
                <MenuItem
                  prefixIcon={<FolderIcon />}
                  disabled={!canOrganize}
                  onClick={() => invoke(onFolder ?? createFolder)}
                >
                  {t['com.affine.rootAppSidebar.organize.new-folders']()}
                </MenuItem>
                {online && (
                  <MenuItem
                    prefixIcon={<UploadIcon />}
                    disabled={!canWrite || !canOrganize || busy.current}
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
          initialFormat={format}
          onClose={() => setFormat(null)}
          onCreated={(id, kind) => {
            resources.invalidate();
            openResource(id, kind);
          }}
        />
      )}
      {!!uploads.length && (
        <Modal
          open
          title={t['com.affine.localmind.resources.uploadLocal']()}
          onOpenChange={open => {
            if (!open && !busy.current) setUploads([]);
          }}
        >
          <div className={styles.form}>
            <ul className={styles.list}>
              {uploads.map(item => (
                <li key={item.key} className={styles.row}>
                  <span className={styles.label}>{item.file.name}</span>
                  <span role="status">
                    {t[
                      `com.affine.localmind.resources.upload.${item.status}`
                    ]()}
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              {uploads.some(item => item.status === 'failed') && (
                <Button
                  disabled={busy.current}
                  onClick={() => void upload(uploads)}
                >
                  {t['com.affine.error.retry']()}
                </Button>
              )}
              <Button disabled={busy.current} onClick={() => setUploads([])}>
                {t['Close']()}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
