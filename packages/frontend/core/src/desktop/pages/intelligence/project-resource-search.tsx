import { Button, Loading } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { GraphQLService } from '@affine/core/modules/cloud';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import {
  projectResourceQuery,
  searchProjectResourcesQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useEffect, useRef, useState } from 'react';

import * as styles from './project-files.css';
import type { ProjectFile } from './project-files-data';
import { ProjectResourceIcon } from './project-resource-icon';

export function ProjectResourceSearch({
  projectId,
  query: text,
  onOpen,
  selection,
}: {
  projectId: string;
  query: string;
  onOpen: (id: string) => void;
  selection?: {
    ids: ReadonlySet<string>;
    disabled: boolean;
    toggle: (id: string, file?: ProjectFile) => void;
  };
}) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const results = useQuery(
    {
      query: searchProjectResourcesQuery,
      variables: { projectId, query: text, cursor: cursors.at(-1), limit: 50 },
    },
    { suspense: false, shouldRetryOnError: false }
  );
  const toggle = async (id: string) => {
    if (
      !selection ||
      selection.disabled ||
      pending ||
      (selection.ids.size >= 50 && !selection.ids.has(id))
    )
      return;
    if (selection.ids.has(id)) {
      selection.toggle(id);
      return;
    }
    setPending(id);
    setError(null);
    try {
      const data = await graphql.gql({
        query: projectResourceQuery,
        variables: { projectId, resourceId: id },
      });
      // Selection carries the resource's metadata revision for existing CAS mutations.
      if (mounted.current) selection.toggle(id, data.projectResource);
    } catch (caught) {
      if (mounted.current) setError(projectErrorMessage(caught));
    } finally {
      if (mounted.current) setPending(null);
    }
  };
  return (
    <div className={styles.fileScroll} aria-busy={results.isLoading}>
      {results.isLoading ? (
        <Loading size={20} />
      ) : results.error ? (
        <div className={styles.state} role="alert">
          <span>{projectErrorMessage(results.error)}</span>
          <Button onClick={() => void results.mutate()}>{t['Retry']()}</Button>
        </div>
      ) : results.data?.searchProjectResources.items.length ? (
        <ul className={styles.list}>
          {results.data.searchProjectResources.items.map(item => (
            <li key={item.id} className={styles.row}>
              {selection ? (
                <input
                  type="checkbox"
                  className={styles.selectionCheckbox}
                  aria-label={item.title}
                  checked={selection.ids.has(item.id)}
                  disabled={
                    selection.disabled ||
                    !!pending ||
                    (selection.ids.size >= 50 && !selection.ids.has(item.id))
                  }
                  onChange={() => void toggle(item.id)}
                />
              ) : null}
              <button
                type="button"
                className={styles.open}
                data-project-resource-id={item.id}
                disabled={
                  !!selection &&
                  (selection.disabled ||
                    !!pending ||
                    (selection.ids.size >= 50 && !selection.ids.has(item.id)))
                }
                onClick={() =>
                  selection ? void toggle(item.id) : onOpen(item.id)
                }
              >
                <ProjectResourceIcon kind={item.kind} title={item.title} />
                <span className={styles.searchCopy}>
                  <strong title={item.title}>{item.title}</strong>
                  <small>
                    {item.path
                      .slice(0, -1)
                      .map(part => part.title)
                      .join(' / ') ||
                      t['com.affine.localmind.project-files.root']()}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.state}>
          {t['com.affine.localmind.workbench.fusion.fileSearchEmpty']()}
        </div>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.actions}>
        {cursors.length > 1 ? (
          <Button onClick={() => setCursors(current => current.slice(0, -1))}>
            {t['com.affine.localmind.documentCreation.previous']()}
          </Button>
        ) : null}
        {results.data?.searchProjectResources.nextCursor ? (
          <Button
            disabled={results.isLoading}
            onClick={() =>
              setCursors(current => [
                ...current,
                results.data?.searchProjectResources.nextCursor ?? undefined,
              ])
            }
          >
            {t['Load more']()}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
