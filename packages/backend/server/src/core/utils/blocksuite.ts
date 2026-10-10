import * as Y from 'yjs';

import {
  parsePageDocFromBinary,
  parseWorkspaceDocFromBinary,
  parseYDocFromBinary,
  parseYDocToMarkdown,
  readAllDocIdsFromRootDoc,
} from '../../native';

/** Read-only adapter for the native reader. A subpage entry exposes a reference
 * to its ID, never ownership or the target content. Canonical bytes stay intact. */
function referenceSnapshot(snapshot: Uint8Array) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, snapshot);
    let changed = false;
    for (const block of doc.getMap<Y.Map<unknown>>('blocks').values()) {
      if (
        !(block instanceof Y.Map) ||
        block.get('sys:flavour') !== 'localmind:subpage'
      )
        continue;
      const resourceId = block.get('prop:resourceId');
      if (block.get('prop:kind') !== 'doc' || typeof resourceId !== 'string')
        continue;
      block.set('sys:flavour', 'affine:embed-linked-doc');
      block.set('prop:pageId', resourceId);
      changed = true;
    }
    return changed ? Y.encodeStateAsUpdate(doc) : snapshot;
  } finally {
    doc.destroy();
  }
}

export interface PageDocContent {
  title: string;
  summary: string;
}

export interface WorkspaceDocContent {
  name: string;
  avatarKey: string;
}

export interface DocMarkdownContent {
  title: string;
  markdown: string;
  knownUnsupportedBlocks: string[];
  unknownBlocks: string[];
}

export interface ParsePageOptions {
  maxSummaryLength?: number;
}

export function parseWorkspaceDoc(
  snapshot: Uint8Array
): WorkspaceDocContent | null {
  return parseWorkspaceDocFromBinary(Buffer.from(snapshot)) ?? null;
}

export function parsePageDoc(
  docSnapshot: Uint8Array,
  opts: ParsePageOptions = { maxSummaryLength: 150 }
): PageDocContent | null {
  return (
    parsePageDocFromBinary(
      Buffer.from(referenceSnapshot(docSnapshot)),
      opts?.maxSummaryLength ?? 150
    ) ?? null
  );
}

export function readAllDocIdsFromWorkspaceSnapshot(
  snapshot: Uint8Array,
  includeTrash = false
) {
  return readAllDocIdsFromRootDoc(Buffer.from(snapshot), includeTrash);
}

function safeParseJson<T>(str: string): T | undefined {
  try {
    return JSON.parse(str) as T;
  } catch {
    return undefined;
  }
}

export async function readAllBlocksFromDocSnapshot(
  docId: string,
  docSnapshot: Uint8Array
) {
  const result = parseYDocFromBinary(
    Buffer.from(referenceSnapshot(docSnapshot)),
    docId
  );

  return {
    ...result,
    blocks: result.blocks.map(block => ({
      ...block,
      docId,
      ref: block.refInfo,
      additional: block.additional
        ? safeParseJson(block.additional)
        : undefined,
    })),
  };
}

export function parseDocToMarkdownFromDocSnapshot(
  workspaceId: string,
  docId: string,
  docSnapshot: Uint8Array,
  aiEditable = false
): DocMarkdownContent {
  const docUrlPrefix = workspaceId ? `/workspace/${workspaceId}` : undefined;
  const parsed = parseYDocToMarkdown(
    Buffer.from(referenceSnapshot(docSnapshot)),
    docId,
    aiEditable,
    docUrlPrefix
  );

  return {
    title: parsed.title,
    markdown: parsed.markdown,
    knownUnsupportedBlocks: parsed.knownUnsupportedBlocks ?? [],
    unknownBlocks: parsed.unknownBlocks ?? [],
  };
}
