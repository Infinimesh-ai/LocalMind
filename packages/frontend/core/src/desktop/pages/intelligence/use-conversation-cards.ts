import { useQuery } from '@affine/core/components/hooks/use-query';
import { GraphQLService } from '@affine/core/modules/cloud';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import {
  type CopilotWorkbenchConversationsGetQuery,
  copilotWorkbenchConversationsGetQuery,
} from '@affine/graphql';
import { useService } from '@toeverything/infra';
import { useCallback, useMemo, useState } from 'react';

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
  hasNextPage: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<unknown>;
};

function useConversationColumn(
  column: WorkbenchConversationColumn
): ColumnState {
  const graphql = useService(GraphQLService);
  const [extraPages, setExtraPages] = useState<ConversationCardsResult[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const query = useQuery(
    {
      query: copilotWorkbenchConversationsGetQuery,
      variables: { column, first: PAGE_SIZE },
    },
    { suspense: false, shouldRetryOnError: false }
  );
  const base = query.data?.currentUser?.copilot.myConversationCards;
  const pages = useMemo(
    () => (base ? [base, ...extraPages] : extraPages),
    [base, extraPages]
  );
  const lastPage = pages.at(-1);
  const items = useMemo(() => {
    const seen = new Set<string>();
    return pages.flatMap(page =>
      page.items.filter(item => {
        if (seen.has(item.sessionId)) return false;
        seen.add(item.sessionId);
        return true;
      })
    );
  }, [pages]);

  const refresh = useCallback(async () => {
    setExtraPages([]);
    return query.mutate();
  }, [query]);

  const loadMore = useCallback(async () => {
    if (
      loadingMore ||
      !lastPage?.pageInfo.hasNextPage ||
      !lastPage.pageInfo.endCursor
    ) {
      return;
    }
    setLoadingMore(true);
    try {
      const result = await graphql.gql({
        query: copilotWorkbenchConversationsGetQuery,
        variables: {
          column,
          first: PAGE_SIZE,
          after: lastPage.pageInfo.endCursor,
        },
      });
      const next = result.currentUser?.copilot.myConversationCards;
      if (next) setExtraPages(current => [...current, next]);
    } finally {
      setLoadingMore(false);
    }
  }, [column, graphql, lastPage, loadingMore]);

  return {
    items,
    counts: base?.counts ?? null,
    loading: query.isLoading,
    loadingMore,
    error: query.error,
    hasNextPage: !!lastPage?.pageInfo.hasNextPage,
    loadMore,
    refresh,
  };
}

export function useConversationCards() {
  const todo = useConversationColumn('todo');
  const progress = useConversationColumn('progress');
  const done = useConversationColumn('done');
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
