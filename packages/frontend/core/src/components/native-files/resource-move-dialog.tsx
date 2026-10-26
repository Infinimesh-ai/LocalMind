import { Button, Modal } from '@affine/component';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  NestedResourceMoveError,
  type ResourceMoveTarget,
  WorkspaceResourceMoveService,
} from '@affine/core/modules/workspace-resources';
import { changeResourceBatch } from '@affine/core/modules/workspace-resources/batch';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { type RefObject, useEffect, useRef, useState } from 'react';

import {
  type PageTreeTarget,
  WorkspacePageTargetSelect,
} from '../page-tree/target-select';
import { WorkspaceNativeFolderSelect } from './workspace-folder-select';

export type NamedMoveTarget = ResourceMoveTarget & {
  key: string;
  title: string;
};
export function ResourceMoveDialog({
  targets,
  onClose,
  onResult,
  returnFocus,
}: {
  targets: NamedMoveTarget[];
  onClose: () => void;
  onResult: (succeeded: string[], failed: string[]) => void;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  const t = useI18n();
  const service = useService(WorkspaceResourceMoveService);
  const [generation] = useState(() => service.accountGeneration);
  const workspaceId = useService(WorkspaceService).workspace.id;
  const tree = useLiveData(useService(WorkspacePageTreeService).enabled$);
  const [parentId, setParentId] = useState<string | null>(null);
  const [directoryVersion, setDirectoryVersion] = useState<string | null>(null);
  const [treeTarget, setTreeTarget] = useState<PageTreeTarget | null>(null);
  const [pending, setPending] = useState(false);
  const [started, setStarted] = useState(false);
  const [failure, setFailure] = useState<'nested' | 'unavailable' | null>(null);
  const [results, setResults] = useState<Record<string, 'success' | 'failed'>>(
    {}
  );
  const busy = useRef(false);
  const active = useRef(true);
  const session =
    useRef<Awaited<ReturnType<WorkspaceResourceMoveService['begin']>>>(
      undefined
    );
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const remaining = targets.filter(item => results[item.key] !== 'success');
  const successCount = targets.length - remaining.length;
  const submit = async () => {
    if (busy.current || !remaining.length) return;
    busy.current = true;
    setPending(true);
    setFailure(null);
    try {
      session.current ??= await service.begin(targets, parentId, generation);
      if (!active.current) return;
      setStarted(true);
      const current = session.current;
      const result = await changeResourceBatch(
        remaining.map(item => item.key),
        async key => {
          if (!active.current) throw new Error('Move dialog closed');
          const item = remaining.find(item => item.key === key);
          if (!item) throw new Error('Resource unavailable');
          await current.move(item);
        }
      );
      if (!active.current) return;
      const next = { ...results };
      result.succeeded.forEach(key => {
        next[key] = 'success';
      });
      result.failed.forEach(key => {
        next[key] = 'failed';
      });
      setResults(next);
      onResult(
        targets
          .filter(item => next[item.key] === 'success')
          .map(item => item.key),
        result.failed
      );
    } catch (error) {
      if (active.current)
        setFailure(
          error instanceof NestedResourceMoveError ? 'nested' : 'unavailable'
        );
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  };
  return (
    <Modal
      open
      persistent={pending}
      closeButtonOptions={{ disabled: pending }}
      title={t['com.affine.localmind.page-tree.move']()}
      onOpenChange={open => {
        if (!open && !busy.current) onClose();
      }}
      contentOptions={{
        onEscapeKeyDown: event => {
          event.stopPropagation();
          if (busy.current) event.preventDefault();
        },
        onCloseAutoFocus: event => {
          if (returnFocus?.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        },
      }}
    >
      <p>{t['com.affine.localmind.resources.batchMoveHint']()}</p>
      {tree ? (
        <WorkspacePageTargetSelect
          workspaceId={workspaceId}
          value={parentId}
          disabled={pending || started}
          onChange={setParentId}
          onTarget={setTreeTarget}
        />
      ) : (
        <WorkspaceNativeFolderSelect
          workspaceId={workspaceId}
          value={parentId}
          disabled={pending || started || tree === null}
          onChange={setParentId}
          onVersion={setDirectoryVersion}
        />
      )}
      <ul>
        {targets.map(item => (
          <li key={item.key}>
            {item.title} ·{' '}
            {t[
              `com.affine.localmind.resources.batchMove.${results[item.key] ?? 'pending'}`
            ]()}
          </li>
        ))}
      </ul>
      {started && !pending && (
        <p role="status">
          {t['com.affine.localmind.resources.batchResult']({
            success: String(successCount),
            failed: String(remaining.length),
          })}
        </p>
      )}
      {failure && (
        <p role="alert">
          {failure === 'nested'
            ? t['com.affine.localmind.resources.batchMoveNested']()
            : t['com.affine.localmind.project-files.operationFailed']()}
        </p>
      )}
      {started && remaining.length > 0 && !pending && (
        <p role="alert">
          {t['com.affine.localmind.project-files.operationFailed']()}
        </p>
      )}
      <Button disabled={pending} onClick={onClose}>
        {started ? t['Done']() : t['Cancel']()}
      </Button>
      {remaining.length > 0 && (
        <Button
          variant="primary"
          disabled={
            pending ||
            tree === null ||
            (!started && !(tree ? treeTarget : directoryVersion))
          }
          onClick={() => void submit()}
        >
          {pending
            ? t['Loading']()
            : started
              ? t['Retry']()
              : t['com.affine.localmind.page-tree.moveHere']()}
        </Button>
      )}
    </Modal>
  );
}
