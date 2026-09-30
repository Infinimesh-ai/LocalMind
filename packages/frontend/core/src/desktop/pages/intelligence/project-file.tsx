import { Button, Loading, Modal } from '@affine/component';
import { nativeFileError } from '@affine/core/components/native-files/file-error';
import {
  FetchService,
  GraphQLService,
  ServerService,
} from '@affine/core/modules/cloud';
import { downloadOfficePackage } from '@affine/core/modules/office';
import { useProjectEditGuard } from '@affine/core/modules/project-resources/edit-guard';
import { useProjectEditLease } from '@affine/core/modules/project-resources/edit-lease';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import {
  type ProjectFilePreview,
  readProjectFilePreview,
} from '@affine/core/modules/project-resources/file-preview';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import {
  projectResourceQuery,
  saveProjectFileMutation,
  uploadProjectBlobMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { DownloadIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useEffect, useRef, useState } from 'react';

import * as styles from './project-files.css';

export function ProjectFile({
  projectId,
  resourceId,
  title,
  sequence,
}: {
  projectId: string;
  resourceId: string;
  title: string;
  sequence?: number;
}) {
  const t = useI18n();
  const fetcher = useService(FetchService);
  const graphql = useService(GraphQLService);
  const lease = useProjectEditLease();
  const server = useService(ServerService).server;
  const url = new URL(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(resourceId)}${sequence === undefined ? '' : `?sequence=${sequence}`}`,
    server.serverMetadata.baseUrl
  ).toString();
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [text, setText] = useState('');
  const [savedText, setSavedText] = useState('');
  const [version, setVersion] = useState(0);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>();
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [comparison, setComparison] = useState<{
    version: number;
    text: string | null;
  } | null>(null);
  const [comparing, setComparing] = useState(false);
  const pending = useRef<{
    requestKey: string;
    expectedContentVersion: number;
    text?: string;
    file?: File;
    blobKey?: string;
  } | null>(null);
  const savingRef = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const dirty =
    replacement !== null || text !== savedText || pending.current !== null;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const latest = useRef({ title, lease, version, text, replacement });
  latest.current = { title, lease, version, text, replacement };
  const writable =
    sequence === undefined && !!lease?.proof && !saving && !suspended;
  const refreshGeneration = useRef(0);
  useEffect(
    () => () => {
      refreshGeneration.current++;
    },
    [projectId, resourceId]
  );
  const reload = async () => {
    if (sequence !== undefined || savingRef.current || !latest.current.version)
      return;
    const generation = refreshGeneration.current;
    const { projectResource: resource } = await graphql.gql({
      query: projectResourceQuery,
      variables: { projectId, resourceId },
    });
    if (generation !== refreshGeneration.current || savingRef.current) return;
    // Polls, other resources and our own commits are not external content changes.
    if (resource.contentVersion <= latest.current.version) return;
    if (dirtyRef.current) setRemoteChanged(true);
    else setRetry(value => value + 1);
  };
  useProjectRefresh(projectId, 'resource', reload);
  const compare = async () => {
    setComparing(true);
    try {
      const response = await fetcher.fetch(url, { credentials: 'include' });
      const current = Number(response.headers.get('x-project-content-version'));
      const result = await readProjectFilePreview(response, title);
      if (!Number.isSafeInteger(current) || current < 1)
        throw new Error('File version unavailable');
      setComparison({
        version: current,
        text: result.kind === 'text' ? result.text : null,
      });
    } catch (caught) {
      setSaveError(caught);
    } finally {
      setComparing(false);
    }
  };
  const save = async () => {
    if (sequence !== undefined) throw new Error('History is read-only');
    if (savingRef.current) throw new Error('A file save is already pending');
    const current = latest.current;
    if (!current.lease?.proof || !current.version)
      throw new Error('The file edit lease is unavailable');
    savingRef.current = true;
    setSaving(true);
    setSaveError(undefined);
    const request = pending.current ?? {
      requestKey: crypto.randomUUID(),
      expectedContentVersion: current.version,
      ...(current.replacement
        ? { file: current.replacement }
        : { text: current.text }),
    };
    pending.current = request;
    try {
      if (request.file && !request.blobKey) {
        request.blobKey = (
          await graphql.gql({
            query: uploadProjectBlobMutation,
            variables: { projectId, file: request.file },
          })
        ).uploadProjectBlob;
      }
      const result = await graphql.gql({
        query: saveProjectFileMutation,
        variables: {
          input: {
            projectId,
            resourceId,
            expectedContentVersion: request.expectedContentVersion,
            requestKey: request.requestKey,
            editLease: current.lease.proof,
            ...(request.blobKey
              ? { blobKey: request.blobKey }
              : { text: request.text }),
          },
        },
      });
      setVersion(result.saveProjectFile.sequence);
      latest.current.version = result.saveProjectFile.sequence;
      pending.current = null;
      setReplacement(null);
      setSavedText(request.text ?? '');
      if (request.file) setText('');
      dirtyRef.current = false;
      setRemoteChanged(false);
      setRetry(value => value + 1);
    } catch (caught) {
      const failure = nativeFileError(caught);
      if (failure.rejected) pending.current = null;
      if (failure.conflict) setRemoteChanged(true);
      setSaveError(caught);
      throw caught;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  useProjectEditGuard({
    hasUnsavedChanges: dirty,
    save,
    discard: async () => {
      if (savingRef.current) throw new Error('Wait for the current save');
      pending.current = null;
      setReplacement(null);
      setText(savedText);
      dirtyRef.current = false;
      setSaveError(undefined);
      setRemoteChanged(false);
      setRetry(value => value + 1);
    },
    suspend: () => setSuspended(true),
    resume: () => setSuspended(false),
  });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setPreview(null);
    setMediaUrl(undefined);
    setError(undefined);
    void fetcher
      .fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async response => ({
        result: await readProjectFilePreview(response, latest.current.title),
        contentVersion: Number(
          response.headers.get('x-project-content-version')
        ),
      }))
      .then(({ result, contentVersion }) => {
        if (controller.signal.aborted) return;
        if ('blob' in result) {
          objectUrl = URL.createObjectURL(result.blob);
          setMediaUrl(objectUrl);
        }
        setPreview(result);
        setVersion(contentVersion);
        latest.current.version = contentVersion;
        setText(result.kind === 'text' ? result.text : '');
        setSavedText(result.kind === 'text' ? result.text : '');
      })
      .catch(caught => {
        if (!controller.signal.aborted) setError(caught);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fetcher, url, retry]);
  const saveFailure = saveError ? nativeFileError(saveError) : null;
  return (
    <div className={styles.preview}>
      <div className={styles.toolbar}>
        <span className={styles.heading}>
          {t[
            dirty
              ? 'com.affine.localmind.project-files.unsaved'
              : 'com.affine.localmind.project-files.saved'
          ]()}
        </span>
        <input
          ref={picker}
          type="file"
          hidden
          style={{ display: 'none' }}
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) setReplacement(file);
            event.target.value = '';
          }}
        />
        <Button
          disabled={!writable || !!pending.current || !version}
          onClick={() => picker.current?.click()}
        >
          {t['com.affine.localmind.native-files.replace']()}
        </Button>
        <Button
          disabled={!writable || !dirty}
          loading={saving}
          onClick={() => {
            void save().catch(setSaveError);
          }}
        >
          {t['com.affine.localmind.project-files.save']()}
        </Button>
        <Button
          prefix={<DownloadIcon />}
          loading={downloading}
          disabled={downloading}
          onClick={() => {
            setDownloading(true);
            void downloadOfficePackage(url, title)
              .catch(setError)
              .finally(() => setDownloading(false));
          }}
        >
          {t['com.affine.localmind.project-files.download']()}
        </Button>
      </div>
      {replacement ? (
        <p>
          {t['com.affine.localmind.native-files.replacement']({
            name: replacement.name,
          })}
        </p>
      ) : null}
      {saveError || remoteChanged ? (
        <div role="alert" className={styles.state}>
          <span>
            {saveFailure
              ? t[saveFailure.messageKey]()
              : t['com.affine.localmind.native-files.remoteChanged']()}
          </span>
          {remoteChanged && (
            <>
              <span>{t['com.affine.localmind.native-files.draftKept']()}</span>
              <Button
                disabled={saving || comparing}
                loading={comparing}
                onClick={() => {
                  void compare().catch(setSaveError);
                }}
              >
                {t['com.affine.localmind.native-files.compareLatest']()}
              </Button>
            </>
          )}
        </div>
      ) : null}
      <Modal
        open={!!comparison}
        onOpenChange={open => {
          if (!open) setComparison(null);
        }}
        title={t['com.affine.localmind.native-files.compareLatest']()}
      >
        {comparison?.text !== null ? (
          <>
            <label>
              {t['com.affine.localmind.native-files.latest']()}
              <textarea
                className={styles.fileText}
                readOnly
                value={comparison?.text ?? ''}
              />
            </label>
            <label>
              {t['com.affine.localmind.native-files.draft']()}
              <textarea
                className={styles.fileText}
                value={text}
                onChange={event => setText(event.target.value)}
              />
            </label>
          </>
        ) : (
          <p>{t['com.affine.localmind.native-files.replaceConflict']()}</p>
        )}
        <Button
          disabled={!comparison || !lease?.proof || saving}
          onClick={() => {
            if (!comparison) return;
            pending.current = null;
            setVersion(comparison.version);
            latest.current.version = comparison.version;
            setSavedText(comparison.text ?? '');
            setSaveError(undefined);
            setRemoteChanged(false);
            setComparison(null);
          }}
        >
          {t['com.affine.localmind.native-files.useMerged']()}
        </Button>
      </Modal>
      <div className={styles.filePreview}>
        {error ? (
          <div className={styles.state} role="alert">
            <span>{projectErrorMessage(error)}</span>
            <Button onClick={() => setRetry(value => value + 1)}>
              {t['com.affine.localmind.project-files.retry']()}
            </Button>
          </div>
        ) : !preview ? (
          <Loading size={24} />
        ) : preview.kind === 'text' ? (
          /\.(txt|md|csv|json)$/i.test(title) && version ? (
            <textarea
              className={styles.fileText}
              aria-label={title}
              value={text}
              readOnly={!writable || !!pending.current || !!replacement}
              onChange={event => setText(event.target.value)}
            />
          ) : (
            <pre className={styles.fileText}>{preview.text}</pre>
          )
        ) : preview.kind === 'image' ? (
          <img
            src={mediaUrl}
            alt={title}
            onError={() => setError(new Error('Image preview failed'))}
          />
        ) : preview.kind === 'audio' ? (
          <audio
            src={mediaUrl}
            controls
            aria-label={title}
            onError={() => setError(new Error('Audio preview failed'))}
          />
        ) : preview.kind === 'video' ? (
          <video
            src={mediaUrl}
            controls
            aria-label={title}
            onError={() => setError(new Error('Video preview failed'))}
          />
        ) : (
          <p>
            {t[
              preview.kind === 'too-large'
                ? 'com.affine.localmind.project-files.previewTooLarge'
                : 'com.affine.localmind.project-files.previewUnsupported'
            ]()}
          </p>
        )}
      </div>
    </div>
  );
}
