import { Button, Modal } from '@affine/component';
import {
  type ResourceTagTarget,
  WorkspaceResourceTagsService,
} from '@affine/core/modules/workspace-resources';
import { changeResourceBatch } from '@affine/core/modules/workspace-resources/batch';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { type RefObject, useEffect, useRef, useState } from 'react';

import { WorkspaceTagsEditor } from '../tags';
import * as styles from './resource-explorer.css';

export type NamedTagTarget = ResourceTagTarget & { key: string; title: string };
export function ResourceTagDialog({
  mode,
  targets,
  onClose,
  onResult,
  returnFocus,
}: {
  mode: 'edit' | 'add' | 'remove';
  targets: NamedTagTarget[];
  onClose: () => void;
  onResult?: (succeeded: string[], failed: string[]) => void;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  const service = useService(WorkspaceResourceTagsService);
  const [session] = useState(() => service.begin());
  const t = useI18n();
  const [initial, setInitial] = useState<string[] | null>(
    mode === 'edit' ? null : []
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [remaining, setRemaining] = useState(targets);
  const [pending, setPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const firstTarget = useRef(targets[0]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (mode !== 'edit') return;
    let current = true;
    void session
      .read(firstTarget.current)
      .then(ids => {
        if (current) {
          setInitial(ids);
          setSelected(ids);
        }
      })
      .catch(() => {
        if (current) setLoadFailed(true);
      });
    return () => {
      current = false;
    };
  }, [session, mode]);
  const title =
    mode === 'edit'
      ? t['com.affine.localmind.resources.editTags']()
      : mode === 'add'
        ? t['com.affine.header.option.add-tag']()
        : t['com.affine.localmind.resources.removeTags']();
  const submit = async () => {
    if (busy.current || initial === null || loadFailed) return;
    busy.current = true;
    setPending(true);
    const patch =
      mode === 'edit'
        ? {
            add: selected.filter(id => !initial.includes(id)),
            remove: initial.filter(id => !selected.includes(id)),
          }
        : {
            add: mode === 'add' ? selected : [],
            remove: mode === 'remove' ? selected : [],
          };
    try {
      const result = await changeResourceBatch(
        remaining.map(item => item.key),
        async key => {
          const target = remaining.find(item => item.key === key);
          if (!target) throw new Error('Resource unavailable');
          await session.change(target, patch);
        }
      );
      if (!active.current) return;
      onResult?.(result.succeeded, result.failed);
      if (!result.failed.length) {
        onClose();
        return;
      }
      setRemaining(remaining.filter(item => result.failed.includes(item.key)));
      setFailed(true);
    } catch {
      if (active.current) setFailed(true);
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
      title={title}
      onOpenChange={open => {
        if (!open && !busy.current) onClose();
      }}
      contentOptions={{
        onCloseAutoFocus: event => {
          if (returnFocus?.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        },
        onEscapeKeyDown: event => {
          // Closing the editor must not also exit the underlying selection mode.
          event.stopPropagation();
          if (busy.current) event.preventDefault();
        },
      }}
    >
      <div className={styles.tagDialog} aria-busy={pending}>
        <p>
          {mode === 'edit'
            ? targets[0].title
            : t['com.affine.localmind.resources.selectedCount']({
                count: String(remaining.length),
              })}
        </p>
        {loadFailed ? (
          <p role="alert">
            {t['com.affine.localmind.project-files.operationFailed']()}
          </p>
        ) : initial === null ? (
          <p role="status">{t['Loading']()}</p>
        ) : (
          <div inert={pending || failed}>
            <WorkspaceTagsEditor
              tagMode="inline-tag"
              selectedTags={selected}
              onSelectTag={id => setSelected(ids => [...new Set([...ids, id])])}
              onDeselectTag={id =>
                setSelected(ids => ids.filter(value => value !== id))
              }
            />
          </div>
        )}
        {failed && (
          <div role="alert">
            <p>{t['com.affine.localmind.resources.tagsRetryFailed']()}</p>
            <ul>
              {remaining.map(item => (
                <li key={item.key}>{item.title}</li>
              ))}
            </ul>
          </div>
        )}
        <div className={styles.tagDialogActions}>
          <Button disabled={pending} onClick={onClose}>
            {t['Cancel']()}
          </Button>
          <Button
            variant="primary"
            disabled={
              pending ||
              initial === null ||
              loadFailed ||
              (mode !== 'edit' && !selected.length)
            }
            loading={pending}
            onClick={() => void submit()}
          >
            {failed
              ? t['com.affine.error.retry']()
              : t['com.affine.m.selector.confirm-default']()}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
