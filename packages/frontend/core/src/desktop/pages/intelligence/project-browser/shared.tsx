import { Button, Loading } from '@affine/component';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { ProjectResourceKind } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import type { ReactNode } from 'react';

import type { useProjectFolder } from '../project-files-data';
import * as styles from './browser.css';

export type FolderQuery = ReturnType<typeof useProjectFolder>;

const KIND_KEYS = {
  [ProjectResourceKind.folder]: 'folder',
  [ProjectResourceKind.page]: 'page',
  [ProjectResourceKind.edgeless]: 'edgeless',
  [ProjectResourceKind.document]: 'document',
  [ProjectResourceKind.workbook]: 'workbook',
  [ProjectResourceKind.presentation]: 'presentation',
  [ProjectResourceKind.pdf]: 'pdf',
  [ProjectResourceKind.file]: 'file',
} as const;

export function useKindLabel() {
  const t = useI18n();
  return (kind: ProjectResourceKind) =>
    t[
      `com.affine.localmind.project-browser.kind.${KIND_KEYS[kind] ?? 'file'}`
    ]();
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatResourceDate(value: unknown) {
  const time = Date.parse(String(value ?? ''));
  return Number.isNaN(time) ? '—' : dateFormat.format(time);
}

/** Loading / error / empty placeholder for a folder listing. */
export function FolderState({
  query,
  empty,
}: {
  query: FolderQuery;
  empty?: ReactNode;
}) {
  const t = useI18n();
  if (query.isLoading && !query.error)
    return (
      <div className={styles.state} role="status">
        <Loading size={20} />
      </div>
    );
  if (query.error)
    return (
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
    );
  if (!query.items.length)
    return (
      <div className={styles.state}>
        {empty ?? t['com.affine.localmind.project-files.empty']()}
      </div>
    );
  return null;
}

export function folderReady(query: FolderQuery) {
  return (
    !(query.isLoading && !query.error) && !query.error && !!query.items.length
  );
}

export function LoadMore({ query }: { query: FolderQuery }) {
  const t = useI18n();
  if (!query.hasMore) return null;
  return (
    <div className={styles.loadMore}>
      <Button
        disabled={query.loadingMore}
        loading={query.loadingMore}
        onClick={() => void query.loadMore()}
      >
        {t['com.affine.localmind.project-files.more']()}
      </Button>
    </div>
  );
}
