import { Button, Loading } from '@affine/component';
import { GraphQLService } from '@affine/core/modules/cloud';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import {
  projectResourceQuery,
  type SearchProjectResourcesQuery,
  searchProjectResourcesQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { FolderIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { Fragment, useEffect, useRef, useState } from 'react';

import type { ProjectFile } from '../project-files-data';
import { ProjectResourceIcon } from '../project-resource-icon';
import * as styles from './browser.css';

export type SearchResult =
  SearchProjectResourcesQuery['searchProjectResources']['items'][number];

type Group = {
  status: 'loading' | 'done' | 'error';
  items: SearchResult[];
  hasMore?: boolean;
  error?: string;
};

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_CONCURRENCY = 4;
export const SEARCH_LIMIT_PER_PROJECT = 20;
const CLICK_DELAY_MS = 250;

/** Wraps case-insensitive matches of `query` in <mark>. */
/**
 * Search snippets come from the Markdown export of documents, which carries
 * `<!-- block_id=… -->` markers; they are not meant for people.
 */
export function cleanSnippet(snippet: string) {
  return snippet
    .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function highlight(text: string, query: string) {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return text;
  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  return text
    .split(pattern)
    .map((part, index) =>
      index % 2 ? (
        <mark key={index}>{part}</mark>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      )
    );
}

/**
 * Search across projects: one `searchProjectResources` request per project,
 * debounced, with bounded concurrency, results grouped by project.
 */
export function SearchResults({
  projects,
  query,
  onReveal,
  onOpen,
  selection,
}: {
  projects: readonly { id: string; name: string }[];
  query: string;
  onReveal: (projectId: string, item: SearchResult) => void;
  onOpen: (projectId: string, resourceId: string) => void;
  selection?: {
    projectId: string;
    ids: ReadonlySet<string>;
    disabled: boolean;
    limit: number;
    toggle: (id: string, file?: ProjectFile) => void;
  };
}) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const graphqlRef = useRef(graphql);
  graphqlRef.current = graphql;
  const text = query.trim();
  const [debounced, setDebounced] = useState(text);
  const [groups, setGroups] = useState<Record<string, Group>>({});
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const projectKey = projects.map(project => project.id).join('\n');
  useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    // A new query (or leaving the view) aborts requests still in flight, so
    // fast typing never stacks searches across every project.
    const controller = new AbortController();
    const queue = projectKey ? projectKey.split('\n') : [];
    setGroups(
      Object.fromEntries(
        queue.map(id => [id, { status: 'loading', items: [] } as Group])
      )
    );
    const worker = async () => {
      while (!cancelled && queue.length) {
        const projectId = queue.shift() as string;
        let group: Group;
        try {
          const result = await graphqlRef.current.gql({
            query: searchProjectResourcesQuery,
            variables: {
              projectId,
              query: debounced,
              limit: SEARCH_LIMIT_PER_PROJECT,
            },
            context: { signal: controller.signal },
          });
          group = {
            status: 'done',
            items: result.searchProjectResources.items,
            hasMore: !!result.searchProjectResources.nextCursor,
          };
        } catch (caught) {
          group = {
            status: 'error',
            items: [],
            error: projectErrorMessage(caught),
          };
        }
        if (!cancelled)
          setGroups(current => ({ ...current, [projectId]: group }));
      }
    };
    for (let i = 0; i < Math.min(SEARCH_CONCURRENCY, queue.length); i++)
      worker().catch(caught => {
        if (cancelled) return;
        setGroups(current =>
          Object.fromEntries(
            Object.entries(current).map(([id, group]) => [
              id,
              group.status === 'loading'
                ? {
                    status: 'error',
                    items: [],
                    error: projectErrorMessage(caught),
                  }
                : group,
            ])
          )
        );
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debounced, projectKey, revision]);

  const toggle = async (projectId: string, id: string) => {
    if (!selection || selection.projectId !== projectId || pending) return;
    if (selection.ids.has(id)) {
      selection.toggle(id);
      return;
    }
    if (selection.disabled || selection.ids.size >= selection.limit) return;
    setPending(id);
    setSelectionError(null);
    try {
      const data = await graphql.gql({
        query: projectResourceQuery,
        variables: { projectId, resourceId: id },
      });
      // Selection carries the resource's metadata revision for existing CAS mutations.
      if (mounted.current) selection.toggle(id, data.projectResource);
    } catch (caught) {
      if (mounted.current) setSelectionError(projectErrorMessage(caught));
    } finally {
      if (mounted.current) setPending(null);
    }
  };

  const stale = debounced !== text;
  const entries = projects
    .map(project => ({ project, group: groups[project.id] }))
    .filter(entry => entry.group);
  const loading =
    stale || entries.some(entry => entry.group.status === 'loading');
  const visible = entries.filter(
    entry => entry.group.status === 'error' || entry.group.items.length
  );
  const errors = entries.some(entry => entry.group.status === 'error');

  return (
    <div
      className={styles.results}
      aria-busy={loading}
      data-testid="project-browser-search"
    >
      {!stale
        ? visible.map(({ project, group }) => (
            <section
              key={project.id}
              className={styles.resultGroup}
              aria-label={project.name}
            >
              <h3 className={styles.resultGroupHeader}>
                <FolderIcon />
                <span>{project.name}</span>
                <span className={styles.resultCount}>
                  {group.status === 'error'
                    ? null
                    : t['com.affine.localmind.project-browser.search.count']({
                        count: `${group.items.length}${group.hasMore ? '+' : ''}`,
                      })}
                </span>
              </h3>
              {group.status === 'error' ? (
                <p className={styles.state} role="alert">
                  {group.error}
                </p>
              ) : (
                <ul className={styles.resultList}>
                  {group.items.map(item => {
                    const selectable = selection?.projectId === project.id;
                    const checked = !!selection?.ids.has(item.id);
                    const parents = item.path.slice(0, -1);
                    return (
                      <li key={item.id} className={styles.resultRow}>
                        {selection ? (
                          <input
                            type="checkbox"
                            className={styles.resultCheckbox}
                            aria-label={item.title}
                            checked={checked}
                            disabled={
                              !selectable ||
                              !!pending ||
                              (!checked &&
                                (selection.disabled ||
                                  selection.ids.size >= selection.limit))
                            }
                            onChange={() => void toggle(project.id, item.id)}
                          />
                        ) : null}
                        <button
                          type="button"
                          className={styles.resultButton}
                          data-project-resource-id={item.id}
                          onClick={event => {
                            if (event.detail > 1) return;
                            if (clickTimer.current)
                              clearTimeout(clickTimer.current);
                            clickTimer.current = setTimeout(() => {
                              clickTimer.current = null;
                              onReveal(project.id, item);
                            }, CLICK_DELAY_MS);
                          }}
                          onDoubleClick={() => {
                            if (clickTimer.current)
                              clearTimeout(clickTimer.current);
                            clickTimer.current = null;
                            if (item.kind === 'folder')
                              onReveal(project.id, item);
                            else onOpen(project.id, item.id);
                          }}
                        >
                          <ProjectResourceIcon
                            kind={item.kind}
                            title={item.title}
                          />
                          <span className={styles.resultCopy}>
                            <span className={styles.resultTitle}>
                              {highlight(item.title, debounced)}
                            </span>
                            <span className={styles.resultPath}>
                              {[
                                project.name,
                                ...parents.map(part => part.title),
                              ].join(' / ')}
                            </span>
                            {item.snippet && cleanSnippet(item.snippet) ? (
                              <span className={styles.resultSnippet}>
                                {highlight(
                                  cleanSnippet(item.snippet),
                                  debounced
                                )}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))
        : null}
      {loading ? (
        <div className={styles.state} role="status">
          <Loading size={18} />
          <span>
            {t['com.affine.localmind.project-browser.search.searching']()}
          </span>
        </div>
      ) : !visible.length ? (
        <div className={styles.state}>
          {t['com.affine.localmind.workbench.fusion.fileSearchEmpty']()}
        </div>
      ) : null}
      {errors && !loading ? (
        <div className={styles.loadMore}>
          <Button onClick={() => setRevision(value => value + 1)}>
            {t['com.affine.localmind.project-files.retry']()}
          </Button>
        </div>
      ) : null}
      {selectionError ? <p role="alert">{selectionError}</p> : null}
    </div>
  );
}
