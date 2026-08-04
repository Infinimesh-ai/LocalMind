import { Logger } from '@nestjs/common';
import { z } from 'zod';

import type {
  PgWorkspaceDocStorageAdapter,
  StructuredDocService,
} from '../../../core/doc';
import type { PermissionAccess } from '../../../core/permission';
import {
  defineTool,
  DESTRUCTIVE_WRITE_TOOL,
  READ_ONLY_TOOL,
  RESULT_OUTPUT_SCHEMA,
  toolError,
  toolResult,
  type WorkspaceMcpToolDefinition,
} from './types';

type HistoryToolDependencies = {
  ac: PermissionAccess;
  history: PgWorkspaceDocStorageAdapter;
  structured: StructuredDocService;
  logger: Logger;
};

export function createHistoryMcpTools(
  dependencies: HistoryToolDependencies,
  userId: string,
  workspaceId: string
) {
  const { ac, history, logger, structured } = dependencies;
  const canRead = async (docId: string) =>
    await ac.user(userId).workspace(workspaceId).doc(docId).can('Doc.Read');

  const readTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'list_document_history',
      title: 'List Document History',
      description:
        'List persisted history snapshots for an authorized document, newest first.',
      parser: z
        .object({
          docId: z.string().min(1),
          before: z.string().datetime().optional(),
          limit: z.number().int().min(1).max(100).default(20),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ docId, before, limit }) => {
        if (!(await canRead(docId))) {
          return toolError(`Doc with id ${docId} not found.`);
        }
        const rows = await history.listDocHistories(workspaceId, docId, {
          before: before ? new Date(before).getTime() : Date.now(),
          limit,
        });
        return toolResult({
          docId,
          histories: rows.map(row => ({
            timestamp: new Date(row.timestamp).toISOString(),
            editor: row.editor,
          })),
        });
      },
    }),
    defineTool({
      name: 'read_document_history',
      title: 'Read Document History',
      description:
        'Read a persisted document history snapshot as complete structured blocks, whiteboard elements, and databases.',
      parser: z
        .object({
          docId: z.string().min(1),
          timestamp: z.string().datetime(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ docId, timestamp }) => {
        if (!(await canRead(docId))) {
          return toolError(`Doc with id ${docId} not found.`);
        }
        const snapshot = await history.getDocHistory(
          workspaceId,
          docId,
          new Date(timestamp).getTime()
        );
        if (!snapshot) return toolError('Document history snapshot not found.');
        return toolResult({
          timestamp: new Date(snapshot.timestamp).toISOString(),
          editor: snapshot.editor ?? null,
          snapshot: structured.readSnapshot(docId, snapshot.bin),
        });
      },
    }),
  ];

  const writeTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'restore_document_history',
      title: 'Restore Document History',
      description:
        'Restore the complete structured document state from a persisted history snapshot by publishing a real CRDT update.',
      parser: z
        .object({
          docId: z.string().min(1),
          timestamp: z.string().datetime(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async ({ docId, timestamp }) => {
        try {
          await ac
            .user(userId)
            .workspace(workspaceId)
            .doc(docId)
            .assert('Doc.Update');
          const snapshot = await history.getDocHistory(
            workspaceId,
            docId,
            new Date(timestamp).getTime()
          );
          if (!snapshot)
            return toolError('Document history snapshot not found.');
          return toolResult(
            await structured.restoreSnapshot(
              workspaceId,
              docId,
              userId,
              snapshot.bin
            )
          );
        } catch (error) {
          logger.warn(
            `Rejected document history restore ${workspaceId}/${docId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return toolError(
            error instanceof Error
              ? `Document history restore rejected: ${error.message}`
              : 'Document history restore rejected.'
          );
        }
      },
    }),
  ];

  return { readTools, writeTools };
}
