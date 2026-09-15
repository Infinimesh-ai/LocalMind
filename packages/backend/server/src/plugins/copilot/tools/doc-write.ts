import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { DocWriter } from '../../../core/doc';
import { PermissionAccess } from '../../../core/permission';
import type { Models } from '../../../models';
import type { CopilotDocumentCopyService } from '../document-copy-service';
import type { CopilotDocumentOperationService } from '../document-operation-service';
import { toolError } from './error';
import { defineTool } from './tool';
import type { CopilotChatOptions } from './types';

const logger = new Logger('DocWriteTool');

export const createDocCopyRequestTool = (
  copies: CopilotDocumentCopyService,
  options: CopilotChatOptions
) =>
  defineTool({
    description:
      'Prepare an independent copy of an existing document into another workspace only when the user requests it. Preserve the original; do not synchronize or copy its permissions. The user must choose a destination before creation. This returns a pending operation, not a created document. Check doc_creation_status for the real result.',
    inputSchema: z
      .object({
        source_workspace_id: z.string().min(1).max(256),
        source_document_id: z.string().min(1).max(256),
        title: z.string().trim().min(1).max(512),
        add_to_project: z
          .boolean()
          .default(false)
          .describe(
            'Only request project addition if the user explicitly requested it.'
          ),
      })
      .strict(),
    execute: async ({
      source_workspace_id,
      source_document_id,
      title,
      add_to_project,
    }) => {
      try {
        if (!options?.user || !options.session)
          throw new Error(
            'Document copying requires the current user conversation'
          );
        const operation = await copies.prepare({
          actorId: options.user,
          sessionId: options.session,
          workspaceId: source_workspace_id,
          documentId: source_document_id,
          title,
          addToProject: add_to_project,
        });
        return {
          operationId: operation.id,
          status: operation.status,
          documentCreated: !!operation.createdDocumentAt,
          documentId: operation.createdDocumentAt ? operation.documentId : null,
          message: operation.createdDocumentAt
            ? 'Copy creation is recorded. Check its current placement and project status.'
            : 'Waiting for the user to choose the copy destination. No copy has been created.',
        };
      } catch (error) {
        return toolError(
          'Document Copy Request Failed',
          error instanceof Error
            ? error.message
            : 'Document copy request is unavailable'
        );
      }
    },
  });

export const createDocCreationStatusTool = (
  models: Models,
  options: CopilotChatOptions
) =>
  defineTool({
    description:
      'Read persisted document creation and project-addition results for this conversation. Only documentCreated=true proves creation; projectStatus=requested is still awaiting authorization.',
    inputSchema: z
      .object({ operation_id: z.string().min(1).max(256) })
      .strict(),
    execute: async ({ operation_id }) => {
      try {
        if (!options?.user || !options.session)
          throw new Error(
            'Document status requires the current user conversation'
          );
        const operation = await models.copilotDocumentOperation.receipt({
          operationId: operation_id,
          actorId: options.user,
          sessionId: options.session,
        });
        return {
          operationId: operation.id,
          status: operation.status,
          documentCreated: !!operation.createdDocumentAt,
          placementComplete: !!operation.placedDocumentAt,
          documentId: operation.createdDocumentAt ? operation.documentId : null,
          workspaceId: operation.destinationWorkspaceId,
          projectStatus: operation.projectStatus,
          accessRequestId: operation.accessRequestId,
        };
      } catch (error) {
        return toolError(
          'Document Creation Status Failed',
          error instanceof Error
            ? error.message
            : 'Document status is unavailable'
        );
      }
    },
  });

export const createDocCreateRequestTool = (
  ac: PermissionAccess,
  models: Models,
  options: CopilotChatOptions,
  documentOperations?: CopilotDocumentOperationService
) =>
  defineTool({
    description: documentOperations
      ? 'Create and save a new document in the current workspace immediately. It is stored at the workspace root unless the user named a target folder. The returned documentId is persisted; report the real result instead of asking the user to confirm a location. Never use a document or folder as a substitute for creating a Project.'
      : 'Prepare a new document for the user to choose its storage workspace and explicit root or folder. This does not create a document. Report waiting for location selection until a persisted operation result confirms creation. Never use a document or folder as a substitute for creating a Project.',
    inputSchema: z
      .object({
        title: z.string().trim().min(1).max(512),
        content: z.string().max(1024 * 1024),
        folder_id: z
          .string()
          .min(1)
          .max(256)
          .nullish()
          .describe(
            'Only set this when the user explicitly named a destination folder. Leave it empty to store the document at the workspace root.'
          ),
        add_to_project: z
          .boolean()
          .default(false)
          .describe(
            'Request addition only if the user explicitly asked to add the created document to the current Project.'
          ),
      })
      .strict(),
    execute: async (
      { title, content, folder_id, add_to_project },
      executeOptions
    ) => {
      try {
        if (!options?.user || !options.workspace || !options.session)
          throw new Error(
            'Document creation requires a user conversation and workspace'
          );
        const session = await models.copilotSession.getMeta(options.session);
        if (
          !session ||
          session.userId !== options.user ||
          session.workspaceId !== options.workspace
        )
          throw new Error('Document creation conversation is unavailable');
        await ac
          .user(options.user)
          .workspace(options.workspace)
          .assert('Workspace.Copilot');
        let operation =
          await models.copilotDocumentOperation.prepareForLatestTurn({
            actorId: options.user,
            sessionId: options.session,
            title: sanitizeTitle(title),
            markdown: stripLeadingH1(content),
            addToProject: add_to_project,
            requestedDestination: {
              workspaceId: options.workspace,
              folderId: folder_id ?? null,
            },
            ...(options.taskId
              ? { delegatedCallId: executeOptions.toolCallId }
              : {}),
          });
        let folderFallback = false;
        let locationFailure: string | undefined;
        // Project-bound operations keep the explicit location workflow; Project
        // resources are published through the Project workflows, not this tool.
        if (documentOperations && !operation.projectId) {
          try {
            const result = await documentOperations.autoConfirmAndExecute({
              operationId: operation.id,
              actorId: options.user,
              workspaceId: options.workspace,
              folderId: folder_id ?? null,
            });
            operation = result.operation;
            folderFallback = result.folderFallback;
          } catch (error) {
            // Degrade to the explicit location workflow instead of failing the
            // draft; the prepared operation stays available for its owner.
            locationFailure =
              error instanceof Error
                ? error.message
                : 'Automatic document location failed';
            logger.warn(
              `Automatic document location failed for operation ${operation.id}: ${locationFailure}`
            );
            try {
              // The failure may land after the body was written, so report the
              // persisted state instead of the pre-execution draft.
              operation = await models.copilotDocumentOperation.receipt({
                operationId: operation.id,
                actorId: options.user,
              });
            } catch {
              logger.warn(
                `Document operation ${operation.id} could not be reloaded after an automatic location failure; its outcome is unknown`
              );
              return {
                type: 'error' as const,
                name: 'Document Creation Outcome Unavailable',
                operationId: operation.id,
                status: 'unknown' as const,
                documentCreated: null,
                retrySafe: false,
                message:
                  'The document creation outcome could not be verified. Do not call doc_create again. Use doc_creation_status with this operationId before taking further action.',
              };
            }
          }
        }
        // A failed automatic location can still leave a written document behind,
        // so the wording follows the persisted state rather than the failure.
        const message = operation.createdDocumentAt
          ? locationFailure
            ? 'The document was created and saved, but finishing its location failed. Do not create it again; report the recorded result and check its creation status separately.'
            : folderFallback
              ? 'Document created and saved at the workspace root because the requested folder was unavailable.'
              : 'Document created and saved. Check its placement and project-addition status separately.'
          : `${locationFailure ? 'Automatic document location failed. ' : ''}Waiting for the user to select a storage workspace and location. No document has been created.`;
        return {
          operationId: operation.id,
          status: operation.status,
          documentCreated: !!operation.createdDocumentAt,
          projectStatus: operation.projectStatus,
          documentId: operation.createdDocumentAt ? operation.documentId : null,
          workspaceId: operation.destinationWorkspaceId,
          folderId: operation.destinationFolderId,
          folderFallback,
          message,
        };
      } catch (error) {
        return toolError(
          'Document Creation Request Failed',
          error instanceof Error
            ? error.message
            : 'Document creation request failed'
        );
      }
    },
  });

const stripLeadingH1 = (content: string) =>
  content.replace(/^[ \t]{0,3}#\s+[^\n]*#*\s*\n*/, '');

const sanitizeTitle = (title: string) => title.replace(/[\r\n]+/g, ' ').trim();

const delegatedDocumentId = (taskId: string, title: string) =>
  createHash('sha256')
    .update('localmind-delegated-doc-create/v1\0')
    .update(taskId)
    .update('\0')
    .update(title)
    .digest('base64url')
    .slice(0, 21);

export const buildDocCreateHandler = (
  ac: PermissionAccess,
  writer: DocWriter
) => {
  return async (
    options: CopilotChatOptions,
    title: string,
    content: string
  ) => {
    if (!options?.user || !options.workspace) {
      return toolError(
        'Doc Create Failed',
        'Missing user or workspace context'
      );
    }

    await ac
      .user(options.user)
      .workspace(options.workspace)
      .assert('Workspace.CreateDoc');

    const sanitizedTitle = sanitizeTitle(title);
    if (!sanitizedTitle) {
      return toolError('Doc Create Failed', 'Title cannot be empty');
    }

    const strippedContent = stripLeadingH1(content);
    const requestedDocId = options.taskId
      ? delegatedDocumentId(options.taskId, sanitizedTitle)
      : undefined;
    const result = await writer.createDoc(
      options.workspace,
      sanitizedTitle,
      strippedContent,
      options.user,
      requestedDocId
    );

    return {
      success: true,
      docId: result.docId,
      idempotentReplay: result.idempotentReplay ?? false,
      message: `Document "${sanitizedTitle}" created successfully`,
    };
  };
};

function documentWriteSourceGuard(
  models: Models,
  actorId: string,
  workspaceId: string,
  sessionId: string | undefined,
  docId: string,
  delegatedExecution = false
) {
  if (delegatedExecution) return async () => undefined;
  return () =>
    models.copilotContext.assertDocumentSourcesShared({
      actorId,
      sessionId,
      sink: {
        type: 'document_update',
        id: docId,
        documentId: docId,
        workspaceId,
        phase: 'execute',
      },
    });
}

export const buildDocUpdateHandler = (
  ac: PermissionAccess,
  writer: DocWriter,
  models: Models
) => {
  return async (
    options: CopilotChatOptions,
    docId: string,
    content: string
  ) => {
    const notFound = toolError(
      'Doc Update Failed',
      `Doc with id ${docId} not found.`
    );

    if (!options?.user || !options.workspace) {
      return notFound;
    }

    const canAccess = await ac
      .user(options.user)
      .workspace(options.workspace)
      .doc(docId)
      .can('Doc.Update');

    if (!canAccess) {
      return notFound;
    }

    const beforeWrite = documentWriteSourceGuard(
      models,
      options.user,
      options.workspace,
      options.session,
      docId,
      Boolean(options.delegatedExecution)
    );
    await beforeWrite();
    const result = await writer.updateDoc(
      options.workspace,
      docId,
      content,
      options.user,
      beforeWrite
    );

    return {
      success: true,
      docId,
      changed: result.changed !== false,
      idempotentReplay: result.changed === false,
      message: 'Document updated successfully',
    };
  };
};

export const buildDocUpdateMetaHandler = (
  ac: PermissionAccess,
  writer: DocWriter,
  models: Models
) => {
  return async (options: CopilotChatOptions, docId: string, title: string) => {
    const notFound = toolError(
      'Doc Meta Update Failed',
      `Doc with id ${docId} not found.`
    );

    if (!options?.user || !options.workspace) {
      return notFound;
    }

    const canAccess = await ac
      .user(options.user)
      .workspace(options.workspace)
      .doc(docId)
      .can('Doc.Update');

    if (!canAccess) {
      return notFound;
    }

    const sanitizedTitle = sanitizeTitle(title);
    if (!sanitizedTitle) {
      return toolError('Doc Meta Update Failed', 'Title cannot be empty');
    }

    const beforeWrite = documentWriteSourceGuard(
      models,
      options.user,
      options.workspace,
      options.session,
      docId,
      Boolean(options.delegatedExecution)
    );
    await beforeWrite();
    await writer.updateDocMeta(
      options.workspace,
      docId,
      { title: sanitizedTitle },
      options.user,
      beforeWrite
    );

    return {
      success: true,
      docId,
      message: 'Document title updated successfully',
    };
  };
};

export const createDocCreateTool = (
  createDoc: (title: string, content: string) => Promise<object>
) => {
  return defineTool({
    description:
      'Create a new document in the workspace with the given title and markdown content. Returns the ID of the created document. This tool not support insert or update database block and image yet.',
    inputSchema: z.object({
      title: z.string().min(1).describe('The title of the new document'),
      content: z
        .string()
        .describe('The markdown content for the document body'),
    }),
    execute: async ({ title, content }) => {
      try {
        return await createDoc(title, content);
      } catch (err: any) {
        logger.error(`Failed to create document: ${title}`, err);
        return toolError('Doc Create Failed', err.message);
      }
    },
  });
};

export const createDocUpdateTool = (
  updateDoc: (docId: string, content: string) => Promise<object>
) => {
  return defineTool({
    description:
      'Update an existing document with new markdown content (body only). Uses structural diffing to apply minimal changes. This does NOT update the document title. This tool not support insert or update database block and image yet.',
    inputSchema: z.object({
      doc_id: z.string().describe('The ID of the document to update'),
      content: z
        .string()
        .describe(
          'The complete new markdown content for the document body (do NOT include a title H1)'
        ),
    }),
    execute: async ({ doc_id, content }) => {
      try {
        return await updateDoc(doc_id, content);
      } catch (err: any) {
        logger.error(`Failed to update document: ${doc_id}`, err);
        return toolError('Doc Update Failed', err.message);
      }
    },
  });
};

export const createDocUpdateMetaTool = (
  updateDocMeta: (docId: string, title: string) => Promise<object>
) => {
  return defineTool({
    description: 'Update document metadata (currently title only).',
    inputSchema: z.object({
      doc_id: z.string().describe('The ID of the document to update'),
      title: z.string().min(1).describe('The new document title'),
    }),
    execute: async ({ doc_id, title }) => {
      try {
        return await updateDocMeta(doc_id, title);
      } catch (err: any) {
        logger.error(`Failed to update document meta: ${doc_id}`, err);
        return toolError('Doc Meta Update Failed', err.message);
      }
    },
  });
};
