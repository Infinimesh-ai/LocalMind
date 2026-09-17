import { z } from 'zod';

import { SearchProviderNotFound } from '../../../base';
import type { DocReader } from '../../../core/doc';
import type {
  PermissionAccess,
  PermissionService,
} from '../../../core/permission';
import type { Models } from '../../../models';
import type { IndexerService } from '../../indexer';
import { workspaceSyncRequiredError } from './doc-sync';
import { toolError } from './error';
import { defineTool } from './tool';
import type { CopilotChatOptions } from './types';

export type { WorkspaceKeywordSearchResult } from '../../../core/doc/keyword-search';
export {
  createReadableDocIdsLoader,
  MARKDOWN_KEYWORD_SEARCH_MAX_DOCUMENTS,
  READABLE_DOC_IDS_CACHE_TTL_MS,
} from '../../../core/doc/keyword-search';
import {
  createReadableDocIdsLoader,
  isoDate,
  searchReadableMarkdown,
  type WorkspaceKeywordSearchResult,
} from '../../../core/doc/keyword-search';

export const buildDocKeywordSearchGetter = (
  ac: PermissionAccess,
  permission: PermissionService,
  indexerService: IndexerService,
  models: Models,
  docReader: DocReader,
  logger: Pick<Console, 'debug' | 'warn'> = console
) => {
  const loadReadableDocIds = createReadableDocIdsLoader(permission, 0);
  const searchDocs = async (
    options: CopilotChatOptions,
    query?: string,
    limit = 20
  ) => {
    const queryTrimmed = query?.trim();
    if (!options || !queryTrimmed || !options.user || !options.workspace) {
      return toolError(
        'Doc Keyword Search Failed',
        'Missing workspace, user, or query for workspace_doc_keyword_search.'
      );
    }
    const workspace = await models.workspace.get(options.workspace);
    if (!workspace) {
      return workspaceSyncRequiredError();
    }
    const canAccess = await ac
      .user(options.user)
      .workspace(options.workspace)
      .can('Workspace.Read');
    if (!canAccess) {
      return toolError(
        'Doc Keyword Search Failed',
        'You do not have permission to access this workspace.'
      );
    }
    const docIds = await loadReadableDocIds({
      userId: options.user,
      workspaceId: options.workspace,
      projectId: null,
    });
    try {
      const docs = await indexerService.searchDocsByKeyword(
        options.workspace,
        queryTrimmed,
        { docIds, limit }
      );

      const readableDocs = await ac
        .user(options.user)
        .workspace(options.workspace)
        .projectScope(null)
        .docs(docs, 'Doc.Read');
      return (readableDocs ?? []).map(doc => ({
        docId: doc.docId,
        blockId: doc.blockId,
        title: doc.title,
        highlight: doc.highlight,
        createdAt: isoDate(doc.createdAt),
        updatedAt: isoDate(doc.updatedAt),
        createdByUser: doc.createdByUser,
        updatedByUser: doc.updatedByUser,
      }));
    } catch (error) {
      const reason =
        error instanceof SearchProviderNotFound
          ? 'not configured'
          : error instanceof Error
            ? error.name
            : 'unknown error';
      logger.warn(
        `Workspace keyword index is unavailable (${reason}); using bounded permission-filtered Markdown search.`
      );
      return await searchReadableMarkdown({
        ac,
        models,
        docReader,
        logger,
        workspaceId: options.workspace,
        userId: options.user,
        docIds,
        query: queryTrimmed,
        limit: Math.min(Math.max(limit, 1), 100),
      });
    }
  };
  return searchDocs;
};

export const createDocKeywordSearchTool = (
  searchDocs: (
    query: string,
    limit?: number
  ) => Promise<WorkspaceKeywordSearchResult[] | ReturnType<typeof toolError>>
) => {
  return defineTool({
    description:
      'Fuzzy search all workspace documents for the exact keyword or phrase supplied and return passages ranked by textual match. Use this tool by default whenever a straightforward term-based or keyword-base lookup is sufficient.',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'The query to search for, e.g. "meeting notes" or "project plan".'
        ),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    execute: async ({ query, limit }) => {
      try {
        const docs = await searchDocs(query, limit);
        if (!Array.isArray(docs)) {
          return docs;
        }
        return docs.map(doc => ({
          docId: doc.docId,
          title: doc.title,
          blockId: doc.blockId,
          highlight: doc.highlight,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          createdByUser: doc.createdByUser,
          updatedByUser: doc.updatedByUser,
        }));
      } catch (e: any) {
        return toolError('Doc Keyword Search Failed', e.message);
      }
    },
  });
};
