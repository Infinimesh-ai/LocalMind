import type { Models } from '../../models';
import type { PermissionAccess, PermissionService } from '../permission';
import type { DocReader } from './reader';

export const READABLE_DOC_IDS_CACHE_TTL_MS = 10_000;
export const MARKDOWN_KEYWORD_SEARCH_MAX_DOCUMENTS = 200;
const MARKDOWN_SEARCH_BATCH_SIZE = 16;
const MARKDOWN_HIGHLIGHT_CONTEXT = 120;

function isUnreadableDocumentContent(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return (
    error.message.startsWith('parser_error:') ||
    error.message === 'invalid_binary' ||
    code === 'invalid_binary'
  );
}

export type WorkspaceKeywordSearchResult = {
  sourceWorkspaceId?: string;
  docId: string;
  blockId: string | null;
  title: string;
  highlight: string;
  createdAt: string | null;
  updatedAt: string | null;
  createdByUser?: unknown;
  updatedByUser?: unknown;
};

export function isoDate(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function findMarkdownMatch(source: string, query: string) {
  const normalizedSource = source.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  const exactIndex = normalizedSource.indexOf(normalizedQuery);
  if (exactIndex >= 0) {
    return { index: exactIndex, length: query.length, exact: true };
  }

  const terms = Array.from(
    new Set(normalizedQuery.split(/\s+/).filter(term => term.length > 0))
  );
  const termIndexes = terms.map(term => normalizedSource.indexOf(term));
  if (!terms.length || termIndexes.some(index => index < 0)) {
    return null;
  }

  const firstTermIndex = Math.min(...termIndexes);
  const firstTerm = terms[termIndexes.indexOf(firstTermIndex)];
  return { index: firstTermIndex, length: firstTerm.length, exact: false };
}

function markdownHighlight(source: string, index: number, length: number) {
  const start = Math.max(0, index - MARKDOWN_HIGHLIGHT_CONTEXT);
  const end = Math.min(
    source.length,
    index + length + MARKDOWN_HIGHLIGHT_CONTEXT
  );
  const matchStart = index - start;
  const matchEnd = matchStart + length;
  const snippet = source.slice(start, end);
  return `${start > 0 ? '...' : ''}${snippet.slice(
    0,
    matchStart
  )}<b>${snippet.slice(matchStart, matchEnd)}</b>${snippet.slice(matchEnd)}${
    end < source.length ? '...' : ''
  }`;
}

export const createReadableDocIdsLoader = (
  permission: PermissionService,
  ttlMs = READABLE_DOC_IDS_CACHE_TTL_MS
) => {
  const cache = new Map<
    string,
    { expiresAt: number; promise: Promise<string[]> }
  >();
  return (input: {
    userId: string;
    workspaceId: string;
    projectId?: string | null;
  }) => {
    const key = JSON.stringify([
      input.userId,
      input.workspaceId,
      input.projectId === undefined ? { all: true } : input.projectId,
    ]);
    const existing = cache.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.promise;
    }
    const entry = {
      expiresAt: Date.now() + Math.max(ttlMs, 0),
      promise: permission.listReadableDocIds(input),
    };
    cache.set(key, entry);
    entry.promise = entry.promise.catch(error => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
    return entry.promise;
  };
};

export async function searchReadableMarkdown(input: {
  ac: PermissionAccess;
  models: Models;
  docReader: DocReader;
  logger: Pick<Console, 'debug'>;
  workspaceId: string;
  userId: string;
  docIds: string[];
  projectId?: string | null;
  query: string;
  limit: number;
}): Promise<WorkspaceKeywordSearchResult[]> {
  const timestamps = await input.models.doc.findTimestampsByDocIds(
    input.workspaceId,
    input.docIds
  );
  const boundedDocIds = input.docIds
    .map(docId => ({ docId, updatedAt: timestamps[docId] ?? 0 }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MARKDOWN_KEYWORD_SEARCH_MAX_DOCUMENTS)
    .map(item => item.docId);
  const matches: Array<
    WorkspaceKeywordSearchResult & { exact: boolean; titleMatch: boolean }
  > = [];

  for (
    let offset = 0;
    offset < boundedDocIds.length;
    offset += MARKDOWN_SEARCH_BATCH_SIZE
  ) {
    const batch = boundedDocIds.slice(
      offset,
      offset + MARKDOWN_SEARCH_BATCH_SIZE
    );
    const batchMatches = await Promise.all(
      batch.map(async docId => {
        const readable = await input.ac
          .user(input.userId)
          .workspace(input.workspaceId)
          .doc(docId)
          .projectScope(input.projectId ?? null)
          .can('Doc.Read');
        if (!readable) return null;
        let content;
        try {
          content = await input.docReader.getDocMarkdown(
            input.workspaceId,
            docId,
            false
          );
        } catch (error) {
          if (!isUnreadableDocumentContent(error)) throw error;
          input.logger.debug(
            `Skipping unreadable document ${docId} during fallback keyword search.`
          );
          return null;
        }
        if (!content) return null;
        const source = `${content.title}\n${content.markdown}`;
        const match = findMarkdownMatch(source, input.query);
        if (!match) return null;
        return {
          docId,
          blockId: null,
          title: content.title,
          highlight: markdownHighlight(source, match.index, match.length),
          exact: match.exact,
          titleMatch: findMarkdownMatch(content.title, input.query) !== null,
          createdAt: null,
          updatedAt: timestamps[docId]
            ? new Date(timestamps[docId]).toISOString()
            : null,
        };
      })
    );
    matches.push(...batchMatches.filter(match => match !== null));
  }

  return matches
    .toSorted(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        Number(right.titleMatch) - Number(left.titleMatch) ||
        (timestamps[right.docId] ?? 0) - (timestamps[left.docId] ?? 0)
    )
    .slice(0, input.limit)
    .map(({ exact: _exact, titleMatch: _titleMatch, ...match }) => match);
}
