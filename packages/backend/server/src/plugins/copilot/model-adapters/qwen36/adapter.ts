import type { LocalModelAdapter } from '../types';
import { QWEN36_MODEL_ADAPTER_VERSION } from './certification';
import { QWEN36_COMPLETION_MAX_EXECUTIONS } from './completion-contract';
import { qwen36Profile } from './profile';

const QWEN36_MODEL_IDS = new Set(['qwen3.6-35b-a3b', 'qwen3.6-35b-a3b-fp8']);

export const QWEN36_MODEL_ADAPTER_ID = 'qwen36-35b-a3b';

export function normalizeQwen36ToolArguments(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (
    !['workspace_folder_create', 'workspace_folder_move'].includes(toolName) ||
    !args
  ) {
    return args;
  }
  const parentFolderId = args.parent_folder_id;
  if (
    typeof parentFolderId !== 'string' ||
    !/^(?:none|null|root)$/i.test(parentFolderId.trim())
  ) {
    return args;
  }
  return { ...args, parent_folder_id: null };
}

export const qwen36ModelAdapter: LocalModelAdapter = {
  id: QWEN36_MODEL_ADAPTER_ID,
  version: QWEN36_MODEL_ADAPTER_VERSION,
  profile: qwen36Profile,
  matches: route => {
    const modelId = route.modelId.toLocaleLowerCase();
    return [...QWEN36_MODEL_IDS].some(
      candidate => modelId === candidate || modelId.endsWith(`/${candidate}`)
    );
  },
  plannerInstructions: [
    'Never use a document title where a document ID is required.',
    'Never invent missing tool arguments, identifiers, people, or destinations.',
    'A successful tool result is required before claiming that a side effect completed.',
    'Do not repeat a successful tool call with the same arguments.',
    'After a document search, call doc_read on the selected document before doc_update. Search snippets are not a substitute for reading the target document.',
    'To remove a document from all folders without deleting it, use workspace_folder_remove_document. Never substitute a folder delete or document update.',
    'For a root folder, pass parent_folder_id as JSON null. Never pass the strings "None", "null", or "root" as an ID.',
    'For a recursive folder-tree deletion, call workspace_folder_delete once on the requested parent with recursive=true. Do not delete each child separately.',
    'The title field in an authorized document snapshot is the authoritative document title. A Markdown heading is body content and must not override metadata.',
  ],
  toolPolicy: {
    deduplicateSuccessfulCalls: true,
    maxExecutions: QWEN36_COMPLETION_MAX_EXECUTIONS,
    maxFailuresPerFingerprint: 2,
    maxFailuresPerTool: 4,
    requireDocumentReadBeforeUpdate: true,
    normalizeArguments: normalizeQwen36ToolArguments,
    mutationToolNames: [
      'doc_create',
      'doc_update',
      'doc_update_meta',
      'workspace_folder_create',
      'workspace_folder_rename',
      'workspace_folder_move',
      'workspace_folder_delete',
      'workspace_folder_add_document',
      'workspace_folder_remove_document',
      'workspace_folder_move_document',
    ],
  },
};
