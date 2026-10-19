import { useQuery } from '@affine/core/components/hooks/use-query';
import { GraphQLService } from '@affine/core/modules/cloud';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import {
  type CopilotWorkbenchConversationsGetQuery,
  copilotWorkbenchConversationsGetQuery,
} from '@affine/graphql';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  WorkbenchConversationCard,
  WorkbenchConversationColumn,
  WorkbenchConversationCounts,
} from './types';

const PAGE_SIZE = 30;

type ConversationCardsResult = NonNullable<
  CopilotWorkbenchConversationsGetQuery['currentUser']
>['copilot']['myConversationCards'];

type ColumnState = {
  items: WorkbenchConversationCard[];
  counts: WorkbenchConversationCounts | null;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
  authenticationRequired?: boolean;
  hasNextPage: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<unknown>;
  retry?: () => Promise<unknown>;
};

function useConversationColumn(
  column: WorkbenchConversationColumn,
  filter = '',
  enabled = true
): ColumnState {
  const graphql = useService(GraphQLService);
  const scopeKey = enabled ? filter : null;
  const currentScope = useRef({ key: scopeKey, epoch: 0 });
  if (currentScope.current.key !== scopeKey)
    currentScope.current = {
      key: scopeKey,
      epoch: currentScope.current.epoch + 1,
    };
  const epoch = currentScope.current.epoch;
  const [extraPages, setExtraPages] = useState<{
    scope: string | null;
    epoch: number;
    pages: ConversationCardsResult[];
  }>({ scope: scopeKey, epoch, pages: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const fetching = useRef(false);
  const [pageError, setPageError] = useState<unknown>(null);
  const variables = useMemo(
    () => ({
      column,
      first: PAGE_SIZE,
      projectId: filter && filter !== 'work_order' ? filter : undefined,
      scopeType: filter === 'work_order' ? 'work_order' : undefined,
    }),
    [column, filter]
  );
  useEffect(() => {
    setExtraPages({
      scope: scopeKey,
      epoch: currentScope.current.epoch,
      pages: [],
    });
    setPageError(null);
    setLoadingMore(false);
    fetching.current = false;
  }, [scopeKey]);
  const query = useQuery(
    enabled
      ? {
          query: copilotWorkbenchConversationsGetQuery,
          variables,
        }
      : undefined,
    { suspense: false, shouldRetryOnError: false }
  );
  const base = query.data?.currentUser?.copilot.myConversationCards;
  const authenticationRequired = query.data?.currentUser === null;
  useEffect(() => {
    if (!authenticationRequired) return;
    currentScope.current.epoch += 1;
    fetching.current = false;
    setExtraPages({
      scope: scopeKey,
      epoch: currentScope.current.epoch,
      pages: [],
    });
    setLoadingMore(false);
    setPageError(null);
  }, [authenticationRequired, scopeKey]);
  const pages = useMemo(() => {
    const extra =
      extraPages.scope === scopeKey && extraPages.epoch === epoch
        ? extraPages.pages
        : [];
    return base ? [base, ...extra] : extra;
  }, [base, extraPages, scopeKey, epoch]);
  const lastPage = pages.at(-1);
  const items = useMemo(() => {
    if (authenticationRequired) return [];
    const seen = new Set<string>();
    return pages.flatMap(page =>
      page.items.filter(item => {
        if (seen.has(item.sessionId)) return false;
        seen.add(item.sessionId);
        return true;
      })
    );
  }, [authenticationRequired, pages]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    currentScope.current.epoch += 1;
    fetching.current = false;
    setLoadingMore(false);
    setExtraPages({
      scope: scopeKey,
      epoch: currentScope.current.epoch,
      pages: [],
    });
    setPageError(null);
    return query.mutate();
  }, [enabled, query, scopeKey]);

  const loadMore = useCallback(async () => {
    if (
      !enabled ||
      authenticationRequired ||
      fetching.current ||
      !lastPage?.pageInfo.hasNextPage ||
      !lastPage.pageInfo.endCursor
    ) {
      return;
    }
    fetching.current = true;
    setLoadingMore(true);
    setPageError(null);
    try {
      const result = await graphql.gql({
        query: copilotWorkbenchConversationsGetQuery,
        variables: {
          ...variables,
          after: lastPage.pageInfo.endCursor,
        },
      });
      const next = result.currentUser?.copilot.myConversationCards;
      if (
        next &&
        currentScope.current.key === scopeKey &&
        currentScope.current.epoch === epoch
      )
        setExtraPages(current => ({
          scope: scopeKey,
          epoch,
          pages: [
            ...(current.scope === scopeKey && current.epoch === epoch
              ? current.pages
              : []),
            next,
          ],
        }));
    } catch (error) {
      if (
        currentScope.current.key === scopeKey &&
        currentScope.current.epoch === epoch
      )
        setPageError(error);
    } finally {
      if (
        currentScope.current.key === scopeKey &&
        currentScope.current.epoch === epoch
      ) {
        fetching.current = false;
        setLoadingMore(false);
      }
    }
  }, [
    enabled,
    authenticationRequired,
    graphql,
    lastPage,
    scopeKey,
    variables,
    epoch,
  ]);

  return {
    items,
    counts: base?.counts ?? null,
    loading: query.isLoading,
    loadingMore,
    error: query.error ?? pageError,
    authenticationRequired,
    hasNextPage: !authenticationRequired && !!lastPage?.pageInfo.hasNextPage,
    loadMore,
    refresh,
    retry: query.error ? refresh : loadMore,
  };
}

export function useConversationCards(
  options: {
    filter?: string;
    enabled?: boolean;
  } = {}
) {
  const todo = useConversationColumn('todo', options.filter, options.enabled);
  const progress = useConversationColumn(
    'progress',
    options.filter,
    options.enabled
  );
  const done = useConversationColumn('done', options.filter, options.enabled);
  const refresh = useCallback(
    () => Promise.all([todo.refresh(), progress.refresh(), done.refresh()]),
    [done, progress, todo]
  );
  useProjectRefresh(null, 'task', refresh);

  return useMemo(
    () => ({
      todo,
      progress,
      done,
      counts: todo.counts ?? progress.counts ?? done.counts,
      refresh,
    }),
    [done, progress, refresh, todo]
  );
}

export type ConversationCardsState = ReturnType<typeof useConversationCards>;
