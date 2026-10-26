import {
  Button,
  IconButton,
  Input,
  Menu,
  MenuItem,
  Modal,
} from '@affine/component';
import { GraphQLService } from '@affine/core/modules/cloud';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import type { PageTreeItem } from '@affine/core/modules/organize/services/page-tree';
import { WorkspaceResourcesService } from '@affine/core/modules/workspace-resources';
import { UserFriendlyError } from '@affine/error';
import {
  changeWorkspaceNativeResourceMutation,
  copyWorkspaceNativeResourceMutation,
  workspaceNativeResourceQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { MoreVerticalIcon } from '@blocksuite/icons/rc';
import { NativeFileTitleSchema } from '@localmind/office';
import { useService, useServiceOptional } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react';

import {
  type PageTreeTarget,
  WorkspacePageTargetSelect,
} from '../page-tree/target-select';
import { MovePageDialog } from '../root-app-sidebar/page-tree';
import * as styles from './native-files.css';
import { WorkspaceNativeFolderSelect } from './workspace-folder-select';

type Action = 'rename' | 'move' | 'copy' | 'trash' | 'restore' | 'delete';
export function WorkspaceNativeActions({
  workspaceId,
  resourceId,
  kind,
  title,
  trashed,
  onChanged,
  beforeChange,
  capabilities,
  compact = false,
  additionalItems,
  triggerRef,
}: {
  workspaceId: string;
  resourceId: string;
  kind: 'file' | 'office';
  title: string;
  trashed?: boolean;
  onChanged: () => void;
  beforeChange?: () => Promise<boolean>;
  capabilities?: Partial<
    Record<
      | 'canRename'
      | 'canMove'
      | 'canCopy'
      | 'canTrash'
      | 'canRestore'
      | 'canDeletePermanently',
      boolean | null
    >
  >;
  compact?: boolean;
  additionalItems?: ReactNode;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const catalog = useServiceOptional(WorkspaceResourcesService);
  const pageTree = useServiceOptional(WorkspacePageTreeService);
  const [treeMove, setTreeMove] = useState<{
    item: PageTreeItem;
    action: 'move' | 'restore';
  } | null>(null);
  const [rights, setRights] = useState(capabilities);
  useEffect(() => {
    if (capabilities) {
      setRights(capabilities);
      return;
    }
    let active = true;
    setRights(undefined);
    void graphql
      .gql({
        query: workspaceNativeResourceQuery,
        variables: { input: { workspaceId, resourceId, kind }, trash: true },
      })
      .then(result => {
        if (active) setRights(result.workspaceNativeResource);
      })
      .catch(() => {
        if (active) setRights({});
      });
    return () => {
      active = false;
    };
  }, [capabilities, graphql, workspaceId, resourceId, kind, trashed]);
  const [restoreElsewhere, setRestoreElsewhere] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState(title);
  const [folder, setFolder] = useState<string | null>(null);
  const [treeTarget, setTreeTarget] = useState<PageTreeTarget | null>(null);
  const [directoryVersion, setDirectoryVersion] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<'rejected' | 'uncertain' | null>(null);
  const request = useRef<{
    key: string;
    metadataVersion: number;
    contentVersion: number;
    pageTreeTarget?: PageTreeTarget;
  } | null>(null);
  const labels = {
    rename: t['com.affine.localmind.native-files.rename'](),
    move: t['com.affine.localmind.native-files.move'](),
    copy: t['com.affine.localmind.native-files.copy'](),
    trash: t['com.affine.localmind.resources.moveToTrash'](),
    restore: t['com.affine.localmind.native-files.restore'](),
    delete: t['com.affine.localmind.native-files.delete'](),
  };
  const invalidName =
    (action === 'rename' || action === 'copy') &&
    !NativeFileTitleSchema.safeParse(name).success;
  const submit = async () => {
    if (!action || pendingRef.current || invalidName) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const input = { workspaceId, resourceId, kind };
      if (
        pageTree?.enabled$.value &&
        ['trash', 'restore', 'delete'].includes(action)
      ) {
        const location = await pageTree.locate(kind, resourceId);
        if (!location.parent) throw new Error('Resource unavailable');
        if (action === 'restore' && restoreElsewhere) {
          setTreeMove({ item: location.parent, action: 'restore' });
          setAction(null);
          return;
        }
        await pageTree.execute({ action, nodeId: location.parent.nodeId });
        setAction(null);
        catalog?.invalidate();
        onChanged();
        return;
      }
      if (!request.current) {
        const current = (
          await graphql.gql({
            query: workspaceNativeResourceQuery,
            variables: { input, trash: true },
          })
        ).workspaceNativeResource;
        request.current = {
          key: nanoid(),
          metadataVersion: current.metadataVersion,
          contentVersion: current.contentVersion,
          ...(action === 'copy' && pageTree?.enabled$.value && treeTarget
            ? { pageTreeTarget: treeTarget }
            : {}),
        };
      }
      const frozen = request.current;
      if (action === 'copy')
        await graphql.gql({
          query: copyWorkspaceNativeResourceMutation,
          variables: {
            input: {
              ...input,
              title: name,
              ...(frozen.pageTreeTarget ?? { folderId: folder }),
              expectedContentVersion: frozen.contentVersion,
              requestKey: frozen.key,
            },
          },
        });
      else
        await graphql.gql({
          query: changeWorkspaceNativeResourceMutation,
          variables: {
            input: {
              ...input,
              action,
              expectedVersion: frozen.metadataVersion,
              requestKey: frozen.key,
              ...(action === 'rename' ? { title: name } : {}),
              ...(action === 'move' ||
              (action === 'restore' && restoreElsewhere)
                ? {
                    folderId: folder,
                    expectedDirectoryVersion: directoryVersion,
                  }
                : {}),
            },
          },
        });
      request.current = null;
      setAction(null);
      catalog?.invalidate();
      if (pageTree?.enabled$.value) await pageTree.load(null);
      onChanged();
    } catch (error) {
      const rejected = [400, 403, 404, 409].includes(
        UserFriendlyError.fromAny(error).status
      );
      if (rejected) request.current = null;
      setError(rejected ? 'rejected' : 'uncertain');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const choose = async (next: Action) => {
    if (beforeChange && !(await beforeChange())) return;
    request.current = null;
    setName(title);
    setFolder(null);
    setRestoreElsewhere(false);
    setError(null);
    if (next === 'move' && pageTree?.enabled$.value) {
      try {
        const location = await pageTree.locate(kind, resourceId);
        if (!location.parent) throw new Error('Resource unavailable');
        setTreeMove({ item: location.parent, action: 'move' });
      } catch {
        setError('uncertain');
      }
      return;
    }
    setAction(next);
  };
  const needsFolder =
    action === 'move' ||
    action === 'copy' ||
    (action === 'restore' && restoreElsewhere);
  const permission = {
    rename: rights?.canRename,
    move: rights?.canMove,
    copy: rights?.canCopy,
    trash: rights?.canTrash,
    restore: rights?.canRestore,
    delete: rights?.canDeletePermanently,
  };
  return (
    <>
      <Menu
        items={
          <>
            {additionalItems}
            {(trashed
              ? (['restore', 'delete'] as const)
              : (['rename', 'move', 'copy', 'trash'] as const)
            )
              .filter(item => permission[item])
              .map(item => (
                <MenuItem key={item} onClick={() => void choose(item)}>
                  {labels[item]}
                </MenuItem>
              ))}
          </>
        }
      >
        {compact ? (
          <IconButton
            ref={triggerRef}
            data-resource-operation="true"
            aria-label={`${t['com.affine.localmind.resources.actions']()}: ${title}`}
            size="16"
            disabled={!rights}
            tooltip={t['com.affine.localmind.native-files.manage']()}
          >
            <MoreVerticalIcon />
          </IconButton>
        ) : (
          <Button ref={triggerRef} disabled={!rights}>
            {t['com.affine.localmind.native-files.manage']()}
          </Button>
        )}
      </Menu>
      {treeMove && (
        <MovePageDialog
          item={treeMove.item}
          action={treeMove.action}
          onClose={() => {
            setTreeMove(null);
            catalog?.invalidate();
            onChanged();
          }}
        />
      )}
      <Modal
        open={!!action}
        onOpenChange={open => {
          if (!open && !pending) setAction(null);
        }}
        title={action ? labels[action] : ''}
      >
        <div className={styles.form}>
          <p>{title}</p>
          {(action === 'rename' || action === 'copy') && (
            <label>
              {t['com.affine.localmind.native-files.name']()}
              <Input
                autoFocus
                value={name}
                onChange={value => {
                  setName(value);
                  setError(null);
                }}
                aria-invalid={invalidName}
                disabled={pending || !!request.current}
              />
              {invalidName && (
                <span role="alert">
                  {t['com.affine.localmind.native-files.invalidName']()}
                </span>
              )}
            </label>
          )}
          {action === 'restore' && (
            <label>
              <input
                type="checkbox"
                checked={restoreElsewhere}
                disabled={pending || !!request.current}
                onChange={event => setRestoreElsewhere(event.target.checked)}
              />
              {t['com.affine.localmind.resources.restoreElsewhere']()}
            </label>
          )}
          {action === 'restore' && !restoreElsewhere && (
            <p>{t['com.affine.localmind.resources.restoreOriginal']()}</p>
          )}
          {needsFolder &&
            !(
              pageTree?.enabled$.value &&
              ['restore', 'copy'].includes(action ?? '')
            ) && (
              <WorkspaceNativeFolderSelect
                workspaceId={workspaceId}
                value={folder}
                disabled={pending || !!request.current}
                onChange={setFolder}
                onVersion={setDirectoryVersion}
              />
            )}
          {pageTree?.enabled$.value && action === 'copy' && (
            <WorkspacePageTargetSelect
              workspaceId={workspaceId}
              value={folder}
              disabled={pending || !!request.current}
              onChange={setFolder}
              onTarget={setTreeTarget}
            />
          )}
          {action === 'delete' && (
            <p>{t['com.affine.localmind.native-files.deleteWarning']()}</p>
          )}
          {error && (
            <p role="alert">
              {error === 'rejected'
                ? action === 'restore'
                  ? t['com.affine.localmind.resources.restoreRejected']()
                  : t['com.affine.localmind.project-files.operationFailed']()
                : t['com.affine.localmind.native-files.retrySameRequest']()}
            </p>
          )}
          <div className={styles.actions}>
            <Button disabled={pending} onClick={() => setAction(null)}>
              {t['Cancel']()}
            </Button>
            <Button
              variant={action === 'delete' ? 'error' : 'primary'}
              disabled={
                pending ||
                (needsFolder &&
                  !directoryVersion &&
                  !(
                    pageTree?.enabled$.value &&
                    (action === 'restore' || (action === 'copy' && treeTarget))
                  )) ||
                invalidName
              }
              onClick={() => void submit().catch(() => setError('uncertain'))}
            >
              {pending
                ? t['Loading']()
                : error
                  ? t['Retry']()
                  : action
                    ? labels[action]
                    : ''}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
