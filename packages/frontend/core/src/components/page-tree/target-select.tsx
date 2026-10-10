import { Button } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import {
  WORKSPACE_PAGE_TREE_CONTRACT,
  workspacePageTreeQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useEffect, useState } from 'react';

export type PageTreeTarget = {
  treeContractVersion: string;
  parentNodeId: string | null;
  expectedTreeRevision: number;
  expectedAuthorizationRevision: string;
};

/** Only loads the current level; sibling pages are never silently truncated. */
export function WorkspacePageTargetSelect({
  workspaceId,
  value,
  disabled,
  onChange,
  onTarget,
}: {
  workspaceId: string;
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
  onTarget: (target: PageTreeTarget | null) => void;
}) {
  const t = useI18n();
  const [cursor, setCursor] = useState<string>();
  const query = useQuery(
    {
      query: workspacePageTreeQuery,
      variables: {
        workspaceId,
        clientContract: WORKSPACE_PAGE_TREE_CONTRACT,
        parentNodeId: value,
        after: cursor,
      },
    },
    { suspense: false, shouldRetryOnError: false }
  );
  const page =
    query.error || query.isLoading ? null : query.data?.workspacePageTree;
  useEffect(() => {
    onTarget(
      page?.enabled && (!page.parent || page.parent.canOrganize)
        ? {
            treeContractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
            parentNodeId: value,
            expectedTreeRevision: page.revision,
            expectedAuthorizationRevision: page.authorizationRevision,
          }
        : null
    );
  }, [page, value, onTarget]);
  const enter = (id: string | null) => {
    setCursor(undefined);
    onChange(id);
  };
  return (
    <div>
      <nav aria-label={t['com.affine.localmind.page-tree.location']()}>
        <Button disabled={disabled} onClick={() => enter(null)}>
          {t['com.affine.localmind.page-tree.root']()}
        </Button>
        {page?.ancestors.map(item => (
          <Button
            key={item.nodeId}
            disabled={disabled}
            onClick={() => enter(item.nodeId)}
          >
            {item.title}
          </Button>
        ))}
        {page?.parent && <span aria-current="page">{page.parent.title}</span>}
      </nav>
      {query.isLoading && <p role="status">{t['Loading']()}</p>}
      {query.error && (
        <Button onClick={() => void query.mutate()}>
          {t['com.affine.error.retry']()}
        </Button>
      )}
      {page?.items
        .filter(item => item.isContainer)
        .map(item => (
          <Button
            key={item.nodeId}
            disabled={disabled || !item.canOrganize}
            onClick={() => enter(item.nodeId)}
          >
            {item.title}
          </Button>
        ))}
      {page?.nextCursor && (
        <Button
          disabled={disabled}
          onClick={() => setCursor(page.nextCursor ?? undefined)}
        >
          {t['com.affine.quicksearch.load-more']()}
        </Button>
      )}
    </div>
  );
}
