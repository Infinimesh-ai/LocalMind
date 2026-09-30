import { Button, Modal, useConfirmModal } from '@affine/component';
import { FetchService, GraphQLService } from '@affine/core/modules/cloud';
import { readProjectFilePreview } from '@affine/core/modules/project-resources/file-preview';
import { NbstoreService } from '@affine/core/modules/storage';
import { ViewService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  restoreWorkspaceNativeVersionMutation,
  saveWorkspaceNativeFileMutation,
  workspaceNativeFileTextQuery,
  workspaceNativeResourceQuery,
  workspaceNativeRevisionsQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService, useServiceOptional } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { useEffect, useRef, useState } from 'react';

import { nativeFileError } from './file-error';
import * as styles from './native-files.css';
import { uploadWorkspaceNativeBlob } from './workspace-upload';

export function WorkspaceNativeFileEditor({
  resourceId,
  title,
  onClose,
  onChanged,
  embedded = false,
  onDirtyChange,
  unavailable = false,
}: {
  resourceId: string;
  title: string;
  onClose: () => void;
  onChanged: () => void;
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  unavailable?: boolean;
}) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const fetcher = useService(FetchService);
  const { workspace } = useService(WorkspaceService);
  const view = useServiceOptional(ViewService)?.view;
  const realtime = useServiceOptional(NbstoreService)?.realtime;
  const { openConfirmModal } = useConfirmModal();
  const identity = { workspaceId: workspace.id, resourceId, kind: 'file' };
  const [currentTitle, setCurrentTitle] = useState(title);
  const [preview, setPreview] = useState<{
    kind: 'image' | 'audio' | 'video';
    url: string;
  } | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const versionRef = useRef(0);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editable, setEditable] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<ReturnType<typeof nativeFileError> | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [reload, setReload] = useState(0);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [comparison, setComparison] = useState<{
    text: string;
    version: number;
  } | null>(null);
  const [history, setHistory] = useState<
    { sequence: number; id: string; createdAt: string }[] | null
  >(null);
  const [historical, setHistorical] = useState<{
    sequence: number;
    kind: 'text' | 'image' | 'audio' | 'video' | 'unsupported' | 'too-large';
    text?: string;
    url?: string;
  } | null>(null);
  const [historyMore, setHistoryMore] = useState(false);
  const pending = useRef<{
    requestKey: string;
    expectedContentVersion: number;
    text?: string;
    file?: File;
    blobKey?: string;
  } | null>(null);
  const restoreRequest = useRef<{
    requestKey: string;
    expectedContentVersion: number;
    sequence: number;
  } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const dirty = text !== saved || !!replacement || !!pending.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(
    () => () => {
      if (historical?.url) URL.revokeObjectURL(historical.url);
    },
    [historical]
  );
  useEffect(() => {
    if (!embedded || !view || !dirty) return;
    const unblock = view.history.block(transition =>
      openConfirmModal({
        title: t['com.affine.localmind.resources.draftWarning'](),
        description: t['com.affine.localmind.native-files.discardWarning'](),
        confirmText: t['com.affine.localmind.project-files.discard'](),
        cancelText: t['Cancel'](),
        onConfirm: () => {
          unblock();
          transition.retry();
        },
      })
    );
    return unblock;
  }, [dirty, embedded, view, openConfirmModal, t]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    const abort = new AbortController();
    let previewUrl: string | undefined;
    setPreview(null);
    setPreviewText(null);
    setLoading(true);
    setError(null);
    void (async () => {
      const resource = (
        await graphql.gql({
          query: workspaceNativeResourceQuery,
          variables: {
            input: { workspaceId: workspace.id, resourceId, kind: 'file' },
          },
          signal: abort.signal,
        })
      ).workspaceNativeResource;
      if (abort.signal.aborted) return;
      setVersion(resource.contentVersion);
      versionRef.current = resource.contentVersion;
      setCurrentTitle(resource.title);
      setCanEdit(resource.canEdit === true);
      const textEditable =
        /\.(txt|md|csv|json)$/i.test(resource.title) &&
        resource.byteSize <= 1024 * 1024;
      if (textEditable) {
        const content = (
          await graphql.gql({
            query: workspaceNativeFileTextQuery,
            variables: {
              input: { workspaceId: workspace.id, resourceId, kind: 'file' },
            },
            signal: abort.signal,
          })
        ).workspaceNativeFileText;
        if (abort.signal.aborted) return;
        setText(content.text);
        setSaved(content.text);
        setVersion(content.contentVersion);
        versionRef.current = content.contentVersion;
        setEditable(true);
      } else {
        setEditable(false);
        setText('');
        setSaved('');
        const response = await fetcher.fetch(
          `/api/workspaces/${encodeURIComponent(workspace.id)}/files/${encodeURIComponent(resourceId)}/download?sequence=${resource.contentVersion}`,
          { signal: abort.signal }
        );
        const result = await readProjectFilePreview(response, resource.title);
        if (abort.signal.aborted) return;
        if (
          result.kind === 'image' ||
          result.kind === 'audio' ||
          result.kind === 'video'
        ) {
          previewUrl = URL.createObjectURL(result.blob);
          setPreview({ kind: result.kind, url: previewUrl });
        } else if (result.kind === 'text') setPreviewText(result.text);
      }
      if (!abort.signal.aborted) setRemoteChanged(false);
    })()
      .catch(caught => {
        if (!abort.signal.aborted) {
          setError(nativeFileError(caught));
          setEditable(false);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [graphql, fetcher, workspace.id, resourceId, reload]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (savingRef.current) return;
      void graphql
        .gql({
          query: workspaceNativeResourceQuery,
          variables: {
            input: { workspaceId: workspace.id, resourceId, kind: 'file' },
          },
        })
        .then(({ workspaceNativeResource: resource }) => {
          if (!active || savingRef.current) return;
          setCurrentTitle(resource.title);
          setCanEdit(resource.canEdit === true);
          if (resource.contentVersion <= versionRef.current) return;
          if (dirtyRef.current) setRemoteChanged(true);
          else setReload(value => value + 1);
        })
        .catch(caught => {
          if (active) {
            const failure = nativeFileError(caught);
            setError(failure);
            if (failure.rejected) setCanEdit(false);
          }
        });
    };
    const subscription = realtime
      ?.subscribe('workspace.nativeResources.changed', {
        workspaceId: workspace.id,
      })
      .subscribe({
        next: refresh,
        error: caught => setError(nativeFileError(caught)),
      });
    const timer = window.setInterval(refresh, 30000);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      active = false;
      subscription?.unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [realtime, graphql, workspace.id, resourceId]);
  const save = async () => {
    if (
      savingRef.current ||
      unavailable ||
      !canEdit ||
      !version ||
      (!editable && !replacement)
    )
      return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    pending.current ??= {
      requestKey: nanoid(),
      expectedContentVersion: version,
      ...(replacement ? { file: replacement } : { text }),
    };
    try {
      const request = pending.current;
      if (request.file && !request.blobKey)
        request.blobKey = await uploadWorkspaceNativeBlob(
          workspace,
          request.file
        );
      const { file: _file, ...input } = request;
      const result = (
        await graphql.gql({
          query: saveWorkspaceNativeFileMutation,
          variables: { input: { ...identity, ...input } },
        })
      ).saveWorkspaceNativeFile;
      pending.current = null;
      setVersion(result.contentVersion);
      versionRef.current = result.contentVersion;
      setSaved(request.text ?? text);
      setReplacement(null);
      setRemoteChanged(false);
      onChanged();
      if (request.file) setReload(value => value + 1);
    } catch (caught) {
      const failure = nativeFileError(caught);
      setError(failure);
      if (failure.rejected) pending.current = null;
      if (failure.conflict) setRemoteChanged(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const compare = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const latest = (
        await graphql.gql({
          query: workspaceNativeFileTextQuery,
          variables: { input: identity },
        })
      ).workspaceNativeFileText;
      setComparison({ text: latest.text, version: latest.contentVersion });
    } catch (caught) {
      setError(nativeFileError(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const loadHistory = async (before?: number) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const rows = (
        await graphql.gql({
          query: workspaceNativeRevisionsQuery,
          variables: { input: identity, before, limit: 25 },
        })
      ).workspaceNativeRevisions;
      setHistory(previous => (before ? [...(previous ?? []), ...rows] : rows));
      setHistoryMore(rows.length === 25);
    } catch (caught) {
      setError(nativeFileError(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const previewHistory = async (sequence: number) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setHistorical(null);
    try {
      const response = await fetcher.fetch(
        `/api/workspaces/${encodeURIComponent(workspace.id)}/files/${encodeURIComponent(resourceId)}/download?sequence=${sequence}`,
        { credentials: 'include' }
      );
      const result = await readProjectFilePreview(response, currentTitle);
      setHistorical(
        result.kind === 'text'
          ? { sequence, kind: result.kind, text: result.text }
          : result.kind === 'image' ||
              result.kind === 'audio' ||
              result.kind === 'video'
            ? {
                sequence,
                kind: result.kind,
                url: URL.createObjectURL(result.blob),
              }
            : { sequence, kind: result.kind }
      );
    } catch (caught) {
      setError(nativeFileError(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const download = async (sequence?: number) => {
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetcher.fetch(
        `/api/workspaces/${encodeURIComponent(workspace.id)}/files/${encodeURIComponent(resourceId)}/download${sequence ? `?sequence=${sequence}` : ''}`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Download failed');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = currentTitle;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(nativeFileError(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const restore = async (sequence: number) => {
    if (savingRef.current) return;
    restoreRequest.current ??= {
      requestKey: nanoid(),
      expectedContentVersion: version,
      sequence,
    };
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await graphql.gql({
        query: restoreWorkspaceNativeVersionMutation,
        variables: { input: { ...identity, ...restoreRequest.current } },
      });
      restoreRequest.current = null;
      setHistory(null);
      setHistorical(null);
      setReload(value => value + 1);
      onChanged();
    } catch (caught) {
      setError(nativeFileError(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const close = () => {
    if (savingRef.current) return;
    if (dirty)
      openConfirmModal({
        confirmText: t['com.affine.localmind.project-files.discard'](),
        cancelText: t['Cancel'](),
        title: t['com.affine.localmind.project-files.unsaved'](),
        description: t['com.affine.localmind.native-files.discardWarning'](),
        onConfirm: onClose,
      });
    else onClose();
  };
  const content = (
    <div className={styles.form}>
      {loading && <span role="status">{t['Loading']()}</span>}
      {error && <p role="alert">{t[error.messageKey]()}</p>}
      {remoteChanged && (
        <p role="status">
          {t['com.affine.localmind.native-files.remoteChanged']()}
        </p>
      )}
      {editable ? (
        <textarea
          aria-label={currentTitle}
          className={styles.editor}
          value={text}
          readOnly={!canEdit || saving || !!pending.current || !!replacement}
          onChange={event => setText(event.target.value)}
        />
      ) : (
        !loading && (
          <p>{t['com.affine.localmind.native-files.downloadOrReplace']()}</p>
        )
      )}
      {preview?.kind === 'image' && (
        <img className={styles.media} src={preview.url} alt={currentTitle} />
      )}
      {preview?.kind === 'audio' && <audio controls src={preview.url} />}
      {preview?.kind === 'video' && (
        <video className={styles.media} controls src={preview.url} />
      )}
      {previewText !== null && (
        <textarea
          className={styles.editor}
          aria-label={currentTitle}
          value={previewText}
          readOnly
        />
      )}
      {replacement && (
        <p>
          {t['com.affine.localmind.native-files.replacement']({
            name: replacement.name,
          })}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          disabled={unavailable || !canEdit || loading || saving || !dirty}
          onClick={() => void save()}
        >
          {pending.current
            ? t['com.affine.error.retry']()
            : t['com.affine.localmind.project-files.save']()}
        </Button>
        <Button
          disabled={
            unavailable || !canEdit || saving || loading || !!pending.current
          }
          onClick={() => picker.current?.click()}
        >
          {t['com.affine.localmind.native-files.replace']()}
        </Button>
        <Button disabled={saving} onClick={() => void download()}>
          {t['com.affine.localmind.fileRequest.download']()}
        </Button>
        <Button disabled={saving} onClick={() => void loadHistory()}>
          {t['com.affine.localmind.native-files.history']()}
        </Button>
        {remoteChanged && editable && (
          <Button disabled={saving} onClick={() => void compare()}>
            {t['com.affine.localmind.native-files.compareLatest']()}
          </Button>
        )}
        <Button disabled={saving} onClick={close}>
          {t['com.affine.localmind.native-files.close']()}
        </Button>
      </div>
      <input
        hidden
        style={{ display: 'none' }}
        ref={picker}
        type="file"
        onChange={event => {
          setReplacement(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />
      {comparison && (
        <div className={styles.form}>
          <label>
            {t['com.affine.localmind.native-files.latest']()}
            <textarea
              readOnly
              className={styles.editor}
              value={comparison.text}
            />
          </label>
          <label>
            {t['com.affine.localmind.native-files.draft']()}
            <textarea
              className={styles.editor}
              value={text}
              onChange={event => setText(event.target.value)}
            />
          </label>
          <Button
            onClick={() => {
              pending.current = null;
              setVersion(comparison.version);
              versionRef.current = comparison.version;
              setReplacement(null);
              setSaved(comparison.text);
              setComparison(null);
              setRemoteChanged(false);
            }}
          >
            {t['com.affine.localmind.native-files.useMerged']()}
          </Button>
        </div>
      )}
      {history && (
        <ul className={styles.list}>
          {history.map(row => (
            <li className={styles.row} key={row.id}>
              <span className={styles.label}>
                v{row.sequence} · {new Date(row.createdAt).toLocaleString()}
              </span>
              <Button
                disabled={saving}
                onClick={() => void previewHistory(row.sequence)}
              >
                {t['com.affine.localmind.native-files.preview']()}
              </Button>
              <Button
                disabled={saving}
                onClick={() => void download(row.sequence)}
              >
                {t['com.affine.localmind.fileRequest.download']()}
              </Button>
              <Button
                disabled={
                  unavailable ||
                  !canEdit ||
                  saving ||
                  dirty ||
                  row.sequence === version ||
                  (!!restoreRequest.current &&
                    restoreRequest.current.sequence !== row.sequence)
                }
                onClick={() =>
                  openConfirmModal({
                    confirmText:
                      t['com.affine.localmind.native-files.restoreVersion'](),
                    cancelText: t['Cancel'](),
                    title:
                      t['com.affine.localmind.native-files.restoreVersion'](),
                    description:
                      t[
                        'com.affine.localmind.native-files.restoreVersionHint'
                      ](),
                    onConfirm: () => restore(row.sequence),
                  })
                }
              >
                {t['com.affine.localmind.native-files.restoreVersion']()}
              </Button>
            </li>
          ))}
          {historyMore && (
            <li>
              <Button
                disabled={saving}
                onClick={() => void loadHistory(history.at(-1)?.sequence)}
              >
                {t['com.affine.localmind.directoryPermissions.loadMore']()}
              </Button>
            </li>
          )}
        </ul>
      )}
      {historical && (
        <div className={styles.form}>
          <span>v{historical.sequence}</span>
          {historical.kind === 'text' && (
            <textarea
              readOnly
              className={styles.editor}
              value={historical.text}
            />
          )}
          {historical.kind === 'image' && (
            <img
              className={styles.media}
              src={historical.url}
              alt={currentTitle}
            />
          )}
          {historical.kind === 'audio' && (
            <audio controls src={historical.url} />
          )}
          {historical.kind === 'video' && (
            <video className={styles.media} controls src={historical.url} />
          )}
          {(historical.kind === 'unsupported' ||
            historical.kind === 'too-large') && (
            <p>
              {t[
                historical.kind === 'too-large'
                  ? 'com.affine.localmind.project-files.previewTooLarge'
                  : 'com.affine.localmind.project-files.previewUnsupported'
              ]()}
            </p>
          )}
        </div>
      )}
    </div>
  );
  return embedded ? (
    content
  ) : (
    <Modal
      open
      title={currentTitle}
      width={820}
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      {content}
    </Modal>
  );
}
