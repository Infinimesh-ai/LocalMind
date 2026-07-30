import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { CurrentUser } from '../../core/auth';
import { PermissionAccess, PermissionService } from '../../core/permission';
import { QuotaStateService } from '../../core/quota/state';
import { UserType } from '../../core/user';
import { WorkspaceType } from '../../core/workspaces';
import { IndexerService } from './service';
import {
  AggregateInput,
  AggregateResultObjectType,
  SearchDocObjectType,
  SearchDocsInput,
  SearchInput,
  SearchQuery,
  SearchQueryOccur,
  SearchQueryType,
  SearchResultObjectType,
} from './types';

@Resolver(() => WorkspaceType)
export class IndexerResolver {
  constructor(
    private readonly indexer: IndexerService,
    private readonly ac: PermissionAccess,
    private readonly permission: PermissionService,
    private readonly quotaState: QuotaStateService
  ) {}

  @ResolveField(() => SearchResultObjectType, {
    description: 'Search a specific table',
  })
  async search(
    @CurrentUser() me: UserType,
    @Parent() workspace: WorkspaceType,
    @Args('input') input: SearchInput
  ): Promise<SearchResultObjectType> {
    // currentUser can read the workspace
    await this.ac.user(me.id).workspace(workspace.id).assert('Workspace.Read');
    this.#addWorkspaceFilter(workspace, input);
    if (!(await this.#addReadableDocFilter(workspace, me, input))) {
      return {
        nodes: [],
        pagination: {
          count: 0,
          hasMore: false,
        },
      };
    }

    const result = await this.indexer.search(input);
    return {
      nodes: result.nodes,
      pagination: {
        count: result.total,
        hasMore: result.nodes.length > 0,
        nextCursor: result.nextCursor,
      },
    };
  }

  @ResolveField(() => AggregateResultObjectType, {
    description: 'Search a specific table with aggregate',
  })
  async aggregate(
    @CurrentUser() me: UserType,
    @Parent() workspace: WorkspaceType,
    @Args('input') input: AggregateInput
  ): Promise<AggregateResultObjectType> {
    // currentUser can read the workspace
    await this.ac.user(me.id).workspace(workspace.id).assert('Workspace.Read');
    this.#addWorkspaceFilter(workspace, input);
    if (!(await this.#addReadableDocFilter(workspace, me, input))) {
      return {
        buckets: [],
        pagination: {
          count: 0,
          hasMore: false,
        },
      };
    }

    const result = await this.indexer.aggregate(input);
    return {
      buckets: result.buckets,
      pagination: {
        count: result.total,
        hasMore: result.buckets.length > 0,
        nextCursor: result.nextCursor,
      },
    };
  }

  @ResolveField(() => [SearchDocObjectType], {
    description: 'Search docs by keyword',
  })
  async searchDocs(
    @CurrentUser() me: UserType,
    @Parent() workspace: WorkspaceType,
    @Args('input') input: SearchDocsInput
  ): Promise<SearchDocObjectType[]> {
    const readableDocIds = await this.#readableDocIdsForSearch(workspace, me);
    const docs = await this.indexer.searchDocsByKeyword(
      workspace.id,
      input.keyword,
      {
        limit: input.limit,
        docIds: readableDocIds ?? undefined,
      }
    );

    return docs;
  }

  #addWorkspaceFilter(
    workspace: WorkspaceType,
    input: SearchInput | AggregateInput
  ) {
    // filter by workspace id
    input.query = {
      type: SearchQueryType.boolean,
      occur: SearchQueryOccur.must,
      queries: [
        {
          type: SearchQueryType.match,
          field: 'workspaceId',
          match: workspace.id,
        },
        input.query,
      ],
    };
  }

  async #addReadableDocFilter(
    workspace: WorkspaceType,
    user: UserType,
    input: SearchInput | AggregateInput
  ) {
    const docIds = await this.#readableDocIdsForSearch(workspace, user);
    if (docIds === null) {
      return true;
    }

    if (docIds.length === 0) {
      return false;
    }

    input.query = {
      type: SearchQueryType.boolean,
      occur: SearchQueryOccur.must,
      queries: [input.query, this.#docIdFilterQuery(docIds)],
    };
    return true;
  }

  async #readableDocIdsForSearch(workspace: WorkspaceType, user: UserType) {
    const state = await this.quotaState.reconcileWorkspaceQuotaState(
      workspace.id
    );
    const isTeamWorkspace =
      state.plan === 'team' || state.plan === 'selfhost_team';
    if (!isTeamWorkspace) {
      return null;
    }

    return await this.permission.listReadableDocIds({
      userId: user.id,
      workspaceId: workspace.id,
    });
  }

  #docIdFilterQuery(docIds: string[]): SearchQuery {
    return {
      type: SearchQueryType.boolean,
      occur: SearchQueryOccur.should,
      queries: docIds.map(docId => ({
        type: SearchQueryType.match,
        field: 'docId',
        match: docId,
      })),
    };
  }
}
