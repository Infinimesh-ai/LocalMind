import { Button } from '@affine/component';
import { GraphQLService } from '@affine/core/modules/cloud';
import {
  type WorkspaceDirectoryQuery,
  workspaceDirectoryQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useEffect, useState } from 'react';

type Entry = WorkspaceDirectoryQuery['workspaceDirectory']['items'][number];
export function WorkspaceNativeFolderSelect({
  workspaceId,
  value,
  disabled,
  onChange,
  onVersion,
}: {
  workspaceId: string;
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
  onVersion: (revision: string | null) => void;
}) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [root, setRoot] = useState(false);
  const [revision, setRevision] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setRevision(null);
    void (async () => {
      let after: string | undefined;
      let revision: string | undefined;
      let authorizationRevision: string | undefined;
      const rows: Entry[] = [];
      let rootWritable = false;
      do {
        const page = (
          await graphql.gql({
            query: workspaceDirectoryQuery,
            variables: { workspaceId, after },
            signal: controller.signal,
          })
        ).workspaceDirectory;
        if (
          revision !== undefined &&
          (revision !== page.revision ||
            authorizationRevision !== page.authorizationRevision)
        )
          throw new Error('Directory changed');
        revision = page.revision;
        authorizationRevision = page.authorizationRevision;
        rootWritable =
          page.rootRights.canRead &&
          page.rootRights.canWrite &&
          page.rootRights.canOrganize;
        rows.push(...page.items);
        after = page.nextCursor ?? undefined;
        if (rows.length > 10000) throw new Error('Directory is too large');
      } while (after);
      if (controller.signal.aborted) return;
      setEntries(rows);
      setRoot(rootWritable);
      setRevision(revision ?? null);
    })()
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [graphql, workspaceId, retry]);
  useEffect(() => {
    const writable =
      value === null
        ? root
        : entries.some(
            row =>
              row.id === value &&
              row.type === 'folder' &&
              row.rights.canRead &&
              row.rights.canWrite &&
              row.rights.canOrganize
          );
    onVersion(!loading && !error && writable ? revision : null);
  }, [value, entries, root, revision, loading, error, onVersion]);
  const path = (row: Entry) => {
    const labels = [row.data];
    let parentId = row.parentId;
    for (let count = 0; parentId && count < 64; count++) {
      const parent = entries.find(entry => entry.id === parentId);
      if (!parent) break;
      labels.unshift(parent.data);
      parentId = parent.parentId;
    }
    return labels.join(' / ');
  };
  return (
    <label>
      {t['com.affine.localmind.native-files.folder']()}
      <select
        disabled={disabled || loading || error}
        value={value ?? ''}
        onChange={event => onChange(event.target.value || null)}
      >
        <option value="" disabled={!root}>
          {t['com.affine.localmind.native-files.root']()}
        </option>
        {entries
          .filter(
            row =>
              row.type === 'folder' &&
              row.rights.canRead &&
              row.rights.canWrite &&
              row.rights.canOrganize
          )
          .map(row => (
            <option key={row.id} value={row.id}>
              {path(row)}
            </option>
          ))}
      </select>
      {loading && <span role="status">{t['Loading']()}</span>}
      {error && (
        <p role="alert">
          {t['com.affine.localmind.project-files.operationFailed']()}{' '}
          <Button onClick={() => setRetry(value => value + 1)}>
            {t['com.affine.error.retry']()}
          </Button>
        </p>
      )}
    </label>
  );
}
