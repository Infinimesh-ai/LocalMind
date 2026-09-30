import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { DocReader } from '../../../core/doc';
import { PermissionAccess } from '../../../core/permission';
import { Models } from '../../../models';
import {
  documentSyncPendingError,
  workspaceSyncRequiredError,
} from './doc-sync';
import { type ToolError, toolError } from './error';
import { defineTool } from './tool';
import type { CopilotChatOptions } from './types';

const logger = new Logger('DocReadTool');

const isToolError = (result: ToolError | object): result is ToolError =>
  'type' in result && result.type === 'error';

export const buildDocContentGetter = (
  ac: PermissionAccess,
  docReader: DocReader,
  models: Models
) => {
  const getDoc = async (options: CopilotChatOptions, docId?: string) => {
    if (!options?.user || !options?.workspace || !docId) {
      return toolError(
        'Doc Read Failed',
        'Missing workspace, user, or document id for workspace_doc_read.'
      );
    }

    const workspace = await models.workspace.get(options.workspace);
    if (!workspace) {
      return workspaceSyncRequiredError();
    }

    const canAccess = await ac
      .user(options.user)
      .workspace(options.workspace)
      .doc(docId)
      .projectScope(null)
      .can('Doc.Read');
    if (!canAccess) {
      logger.warn(
        `User ${options.user} does not have access to doc ${docId} in workspace ${options.workspace}`
      );
      return toolError(
        'Doc Read Failed',
        `You do not have permission to read document ${docId} in this workspace.`
      );
    }

    const docMeta = await models.doc.getAuthors(options.workspace, docId);
    if (!docMeta) {
      return documentSyncPendingError(docId);
    }

    const content = await docReader.getVersionedDocMarkdown(
      options.workspace,
      docId
    );
    if (!content) {
      return documentSyncPendingError(docId);
    }

    return {
      docId,
      title: content.title,
      markdown: content.markdown,
      version: content.version,
      createdAt: docMeta.createdAt.toISOString(),
      updatedAt: docMeta.updatedAt.toISOString(),
      createdByUser: docMeta.createdByUser,
      updatedByUser: docMeta.updatedByUser,
    };
  };
  return getDoc;
};

type DocReadToolResult = Awaited<
  ReturnType<ReturnType<typeof buildDocContentGetter>>
>;

export const createDocReadTool = (
  getDoc: (targetId?: string) => Promise<DocReadToolResult>
) => {
  return defineTool({
    description:
      'Return the complete text, content version and basic metadata of a single document. Before workspace_doc_update, read the document and pass its version as expected_version. A conflict requires a new read and merge.',
    inputSchema: z.object({
      doc_id: z.string().describe('The target doc to read'),
    }),
    execute: async ({ doc_id }) => {
      try {
        const doc = await getDoc(doc_id);
        return isToolError(doc) ? doc : { ...doc };
      } catch (err: any) {
        logger.error(`Failed to read the doc ${doc_id}`, err);
        return toolError('Doc Read Failed', err.message ?? String(err));
      }
    },
  });
};
