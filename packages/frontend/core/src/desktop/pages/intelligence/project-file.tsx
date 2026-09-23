import { Button, Loading } from '@affine/component';
import { FetchService, ServerService } from '@affine/core/modules/cloud';
import { downloadOfficePackage } from '@affine/core/modules/office';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import {
  type ProjectFilePreview,
  readProjectFilePreview,
} from '@affine/core/modules/project-resources/file-preview';
import { useI18n } from '@affine/i18n';
import { DownloadIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useEffect, useState } from 'react';

import * as styles from './project-files.css';

export function ProjectFile({
  projectId,
  resourceId,
  title,
}: {
  projectId: string;
  resourceId: string;
  title: string;
}) {
  const t = useI18n();
  const fetcher = useService(FetchService);
  const server = useService(ServerService).server;
  const url = new URL(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(resourceId)}`,
    server.serverMetadata.baseUrl
  ).toString();
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setPreview(null);
    setMediaUrl(undefined);
    setError(undefined);
    void fetcher
      .fetch(url, { credentials: 'include', signal: controller.signal })
      .then(response => readProjectFilePreview(response, title))
      .then(result => {
        if (controller.signal.aborted) return;
        if ('blob' in result) {
          objectUrl = URL.createObjectURL(result.blob);
          setMediaUrl(objectUrl);
        }
        setPreview(result);
      })
      .catch(caught => {
        if (!controller.signal.aborted) setError(caught);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fetcher, url, title, retry]);
  return (
    <div className={styles.preview}>
      <div className={styles.toolbar}>
        <span className={styles.heading}>
          {t['com.affine.localmind.project-files.readOnly']()}
        </span>
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
          <pre className={styles.fileText}>{preview.text}</pre>
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
