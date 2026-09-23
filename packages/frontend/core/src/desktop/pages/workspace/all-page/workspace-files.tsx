import { Button } from '@affine/component';
import { FetchService } from '@affine/core/modules/cloud';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import { useService, useServiceOptional } from '@toeverything/infra';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import * as styles from './workspace-files.css';

const FilePageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      fileName: z.string(),
      byteSize: z.number(),
      kind: z.enum(['office', 'file']),
    })
  ),
  nextCursor: z.string().nullable(),
});
type FilePage = z.infer<typeof FilePageSchema>;

export function WorkspaceFiles() {
  const { workspace } = useService(WorkspaceService);
  const fetcher = useServiceOptional(FetchService);
  if (workspace.flavour === 'local' || !fetcher) return null;
  return (
    <FileList key={workspace.id} workspaceId={workspace.id} fetcher={fetcher} />
  );
}

function FileList({
  workspaceId,
  fetcher,
}: {
  workspaceId: string;
  fetcher: FetchService;
}) {
  const t = useI18n();
  const { workbench } = useService(WorkbenchService);
  const [page, setPage] = useState<FilePage>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/files`;
  const load = useCallback(
    async (cursor?: string) => {
      if (pending.current) return;
      pending.current = true;
      const abort = new AbortController();
      controller.current = abort;
      setLoading(true);
      setError(false);
      try {
        const response = await fetcher.fetch(
          `${base}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
          { credentials: 'include', signal: abort.signal }
        );
        if (!response.ok) throw new Error('File list unavailable');
        const result = FilePageSchema.parse(await response.json());
        if (!abort.signal.aborted)
          setPage(previous => ({
            items: cursor ? [...previous.items, ...result.items] : result.items,
            nextCursor: result.nextCursor,
          }));
      } catch {
        if (!abort.signal.aborted) setError(true);
      } finally {
        if (controller.current === abort) {
          pending.current = false;
          if (!abort.signal.aborted) setLoading(false);
        }
      }
    },
    [base, fetcher]
  );
  useEffect(() => {
    load().catch(() => setError(true));
    return () => {
      controller.current?.abort();
      controller.current = null;
      pending.current = false;
    };
  }, [load]);
  const download = async (file: FilePage['items'][number]) => {
    if (downloading) return;
    setDownloading(file.id);
    setError(false);
    try {
      const response = await fetcher.fetch(
        `${base}/${encodeURIComponent(file.id)}/download`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Download unavailable');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(true);
    } finally {
      setDownloading(null);
    }
  };
  return (
    <details className={styles.panel} open={page.items.length > 0 || error}>
      <summary>
        {t['com.affine.rootAppSidebar.files']()} ({page.items.length}
        {page.nextCursor ? '+' : ''})
      </summary>
      <div className={styles.controls}>
        <Button disabled={loading} onClick={() => void load()}>
          {t['com.affine.error.retry']()}
        </Button>
        {loading && <span role="status">{t['Loading']()}</span>}
      </div>
      {error && (
        <p role="alert">
          {t['com.affine.localmind.project-files.operationFailed']()}
        </p>
      )}
      {!loading && !error && !page.items.length && (
        <p>{t['com.affine.localmind.project-files.empty']()}</p>
      )}
      <ul className={styles.list}>
        {page.items.map(file => (
          <li key={file.id} className={styles.row}>
            <span className={styles.name} title={file.fileName}>
              {file.fileName}
            </span>
            <span>{Math.ceil(file.byteSize / 1024)} KB</span>
            {file.kind === 'office' ? (
              <Button onClick={() => workbench.openOffice(file.id)}>
                {t['com.affine.localmind.project-files.open']()}
              </Button>
            ) : (
              <Button
                disabled={downloading !== null}
                onClick={() => void download(file)}
              >
                {t['com.affine.localmind.fileRequest.download']()}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {page.nextCursor && (
        <Button
          disabled={loading}
          onClick={() => void load(page.nextCursor ?? undefined)}
        >
          {t['com.affine.localmind.directoryPermissions.loadMore']()}
        </Button>
      )}
    </details>
  );
}
