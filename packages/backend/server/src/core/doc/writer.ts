import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';

import { EventBus } from '../../base';
import {
  addDocToRootDoc,
  createDocWithMarkdown,
  readAllDocIdsFromRootDoc,
  updateDocProperties,
  updateDocTitle,
  updateDocWithMarkdown,
  updateRootDocMetaTitle,
} from '../../native';
import { PgWorkspaceDocStorageAdapter } from './adapters/workspace';

export interface CreateDocResult {
  docId: string;
  idempotentReplay?: boolean;
}

export interface UpdateDocResult {
  success: boolean;
  changed?: boolean;
}

export interface PushDocUpdateResult extends UpdateDocResult {
  timestamp: number;
}

declare global {
  interface Events {
    'doc.updates.pushed': {
      spaceType: 'workspace' | 'userspace';
      spaceId: string;
      docId: string;
      updates: Uint8Array[];
      timestamp: number;
      editor?: string;
    };
  }
}

export type WorkspaceDocUpdatesPushedPayload = Omit<
  Events['doc.updates.pushed'],
  'spaceType'
>;

export interface DeferredDocUpdateResult {
  result: UpdateDocResult;
  broadcasts: WorkspaceDocUpdatesPushedPayload[];
}

@Injectable()
export class DocWriter {
  private readonly logger = new Logger(DocWriter.name);

  constructor(
    private readonly storage: PgWorkspaceDocStorageAdapter,
    private readonly event: EventBus
  ) {}

  /**
   * Creates a new document from markdown content.
   *
   * @param workspaceId - The workspace ID
   * @param title - The document title
   * @param markdown - The markdown content (body only)
   * @param editorId - Optional editor ID for tracking
   * @returns The created document ID
   */
  async createDoc(
    workspaceId: string,
    title: string,
    markdown: string,
    editorId?: string,
    requestedDocId?: string
  ): Promise<CreateDocResult> {
    // Fetch workspace root doc first - reject if not found
    // The root doc (docId = workspaceId) contains meta.pages array
    const rootDoc = await this.storage.getDoc(workspaceId, workspaceId);
    if (!rootDoc?.bin) {
      throw new NotFoundException(
        `Workspace ${workspaceId} not found or has no root document`
      );
    }

    const rootDocBin = Buffer.isBuffer(rootDoc.bin)
      ? rootDoc.bin
      : Buffer.from(
          rootDoc.bin.buffer,
          rootDoc.bin.byteOffset,
          rootDoc.bin.byteLength
        );

    const docId = requestedDocId ?? nanoid();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(docId)) {
      throw new Error('Requested document ID is invalid');
    }
    let registeredDocIds = new Set<string>();
    try {
      registeredDocIds = new Set(readAllDocIdsFromRootDoc(rootDocBin));
    } catch {
      // Legacy/bootstrap roots can be placeholders until their first update.
    }
    const existingDoc = requestedDocId
      ? await this.storage.getDoc(workspaceId, docId)
      : null;

    if (existingDoc?.bin) {
      if (!registeredDocIds.has(docId)) {
        const rootDocUpdate = addDocToRootDoc(rootDocBin, docId, title);
        const rootTimestamp = await this.storage.pushDocUpdates(
          workspaceId,
          workspaceId,
          [rootDocUpdate],
          editorId
        );
        this.emitDocUpdatesPushed({
          spaceId: workspaceId,
          docId: workspaceId,
          updates: [rootDocUpdate],
          timestamp: rootTimestamp,
          editor: editorId,
        });
      }
      await this.updateDocProperties(
        workspaceId,
        docId,
        { updatedBy: editorId },
        editorId
      );
      return { docId, idempotentReplay: true };
    }

    this.logger.debug(
      `Creating doc ${docId} in workspace ${workspaceId} from markdown`
    );

    // Convert markdown to y-octo binary using the provided title
    const binary = createDocWithMarkdown(title, markdown, docId);

    // Prepare root doc update to register the new document
    // A retry can observe the root registration after a previous attempt
    // stopped before writing the document body.
    if (!registeredDocIds.has(docId)) {
      const rootDocUpdate = addDocToRootDoc(rootDocBin, docId, title);
      const rootTimestamp = await this.storage.pushDocUpdates(
        workspaceId,
        workspaceId,
        [rootDocUpdate],
        editorId
      );
      this.emitDocUpdatesPushed({
        spaceId: workspaceId,
        docId: workspaceId,
        updates: [rootDocUpdate],
        timestamp: rootTimestamp,
        editor: editorId,
      });
    }

    const docTimestamp = await this.storage.pushDocUpdates(
      workspaceId,
      docId,
      [binary],
      editorId
    );
    this.emitDocUpdatesPushed({
      spaceId: workspaceId,
      docId,
      updates: [binary],
      timestamp: docTimestamp,
      editor: editorId,
    });

    await this.updateDocProperties(
      workspaceId,
      docId,
      {
        createdBy: editorId,
        updatedBy: editorId,
      },
      editorId
    );

    this.logger.debug(
      `Created and registered doc ${docId} in workspace ${workspaceId}`
    );

    return { docId };
  }

  /**
   * Updates an existing document with new markdown content.
   *
   * Uses structural diffing to compute minimal changes between the existing
   * document and new markdown, then applies block-level replacements for
   * changed blocks. This preserves document history and enables proper CRDT
   * merging with concurrent edits.
   * Note: this does not update the document title.
   *
   * @param workspaceId - The workspace ID
   * @param docId - The document ID to update
   * @param markdown - The new markdown content
   * @param editorId - Optional editor ID for tracking
   */
  async updateDoc(
    workspaceId: string,
    docId: string,
    markdown: string,
    editorId?: string
  ): Promise<UpdateDocResult> {
    const deferred = await this.updateDocDeferred(
      workspaceId,
      docId,
      markdown,
      editorId
    );
    this.publishDocUpdatesPushed(deferred.broadcasts);
    return deferred.result;
  }

  async updateDocDeferred(
    workspaceId: string,
    docId: string,
    markdown: string,
    editorId?: string
  ): Promise<DeferredDocUpdateResult> {
    const broadcasts: WorkspaceDocUpdatesPushedPayload[] = [];
    this.logger.debug(
      `Updating doc ${docId} in workspace ${workspaceId} from markdown`
    );

    // Fetch existing document
    const existingDoc = await this.storage.getDoc(workspaceId, docId);
    if (!existingDoc?.bin) {
      throw new NotFoundException(`Document ${docId} not found`);
    }

    // Compute delta update using structural diff
    // Use zero-copy buffer view when possible for native function
    const existingBinary = Buffer.isBuffer(existingDoc.bin)
      ? existingDoc.bin
      : Buffer.from(
          existingDoc.bin.buffer,
          existingDoc.bin.byteOffset,
          existingDoc.bin.byteLength
        );
    const delta = updateDocWithMarkdown(existingBinary, markdown, docId);

    if (this.storage.isEmptyBin(delta)) {
      return {
        result: { success: true, changed: false },
        broadcasts,
      };
    }

    // Push only the delta changes
    const timestamp = await this.storage.pushDocUpdates(
      workspaceId,
      docId,
      [delta],
      editorId
    );
    this.recordDocUpdatesPushed(broadcasts, {
      spaceId: workspaceId,
      docId,
      updates: [delta],
      timestamp,
      editor: editorId,
    });

    await this.updateDocProperties(
      workspaceId,
      docId,
      { updatedBy: editorId },
      editorId,
      broadcasts
    );

    return {
      result: { success: true, changed: true },
      broadcasts,
    };
  }

  /**
   * Persists a validated CRDT update produced by a structured document editor.
   */
  async pushDocUpdate(
    workspaceId: string,
    docId: string,
    update: Uint8Array,
    editorId?: string
  ): Promise<PushDocUpdateResult> {
    if (this.storage.isEmptyBin(update)) {
      const current = await this.storage.getDoc(workspaceId, docId);
      if (!current) {
        throw new NotFoundException(`Document ${docId} not found`);
      }
      return { success: true, timestamp: current.timestamp };
    }

    const timestamp = await this.storage.pushDocUpdates(
      workspaceId,
      docId,
      [update],
      editorId
    );
    this.emitDocUpdatesPushed({
      spaceId: workspaceId,
      docId,
      updates: [update],
      timestamp,
      editor: editorId,
    });
    await this.updateDocProperties(
      workspaceId,
      docId,
      { updatedBy: editorId },
      editorId
    );
    return { success: true, timestamp };
  }

  async deleteDocPermanently(workspaceId: string, docId: string) {
    await this.storage.deleteDoc(workspaceId, docId);
  }

  /**
   * Updates document metadata (currently title only).
   *
   * @param workspaceId - The workspace ID
   * @param docId - The document ID to update
   * @param meta - Metadata updates
   * @param editorId - Optional editor ID for tracking
   */
  async updateDocMeta(
    workspaceId: string,
    docId: string,
    meta: { title?: string },
    editorId?: string
  ): Promise<UpdateDocResult> {
    if (meta.title === undefined) {
      throw new Error('No metadata provided');
    }

    this.logger.debug(`Updating doc meta ${docId} in workspace ${workspaceId}`);

    const existingDoc = await this.storage.getDoc(workspaceId, docId);
    if (!existingDoc?.bin) {
      throw new NotFoundException(`Document ${docId} not found`);
    }

    const rootDoc = await this.storage.getDoc(workspaceId, workspaceId);
    if (!rootDoc?.bin) {
      throw new NotFoundException(
        `Workspace ${workspaceId} not found or has no root document`
      );
    }

    const existingBinary = Buffer.isBuffer(existingDoc.bin)
      ? existingDoc.bin
      : Buffer.from(
          existingDoc.bin.buffer,
          existingDoc.bin.byteOffset,
          existingDoc.bin.byteLength
        );
    const rootDocBin = Buffer.isBuffer(rootDoc.bin)
      ? rootDoc.bin
      : Buffer.from(
          rootDoc.bin.buffer,
          rootDoc.bin.byteOffset,
          rootDoc.bin.byteLength
        );

    const titleUpdate = updateDocTitle(existingBinary, meta.title, docId);
    const rootMetaUpdate = updateRootDocMetaTitle(
      rootDocBin,
      docId,
      meta.title
    );

    const rootTimestamp = await this.storage.pushDocUpdates(
      workspaceId,
      workspaceId,
      [rootMetaUpdate],
      editorId
    );
    this.emitDocUpdatesPushed({
      spaceId: workspaceId,
      docId: workspaceId,
      updates: [rootMetaUpdate],
      timestamp: rootTimestamp,
      editor: editorId,
    });

    const docTimestamp = await this.storage.pushDocUpdates(
      workspaceId,
      docId,
      [titleUpdate],
      editorId
    );
    this.emitDocUpdatesPushed({
      spaceId: workspaceId,
      docId,
      updates: [titleUpdate],
      timestamp: docTimestamp,
      editor: editorId,
    });

    await this.updateDocProperties(
      workspaceId,
      docId,
      { updatedBy: editorId },
      editorId
    );

    return { success: true };
  }

  publishDocUpdatesPushed(
    payloads: readonly WorkspaceDocUpdatesPushedPayload[]
  ) {
    for (const payload of payloads) {
      this.event.emitDetached('doc.updates.pushed', {
        spaceType: 'workspace',
        ...payload,
      });
    }
  }

  private emitDocUpdatesPushed(payload: WorkspaceDocUpdatesPushedPayload) {
    this.publishDocUpdatesPushed([payload]);
  }

  private recordDocUpdatesPushed(
    broadcasts: WorkspaceDocUpdatesPushedPayload[],
    payload: WorkspaceDocUpdatesPushedPayload
  ) {
    broadcasts.push(payload);
  }

  private async updateDocProperties(
    workspaceId: string,
    docId: string,
    props: { createdBy?: string; updatedBy?: string },
    editorId?: string,
    broadcasts?: WorkspaceDocUpdatesPushedPayload[]
  ) {
    if (!editorId) {
      return;
    }
    if (
      workspaceId === docId ||
      docId.startsWith('db$') ||
      docId.startsWith('userdata$')
    ) {
      return;
    }
    if (!props.createdBy && !props.updatedBy) {
      return;
    }

    const propertiesDocId = `db$${workspaceId}$docProperties`;
    const existingDoc = await this.storage.getDoc(workspaceId, propertiesDocId);
    const existingBinary = existingDoc?.bin
      ? Buffer.isBuffer(existingDoc.bin)
        ? existingDoc.bin
        : Buffer.from(
            existingDoc.bin.buffer,
            existingDoc.bin.byteOffset,
            existingDoc.bin.byteLength
          )
      : Buffer.alloc(0);

    const update = updateDocProperties(
      existingBinary,
      propertiesDocId,
      docId,
      props.createdBy,
      props.updatedBy
    );
    if (this.storage.isEmptyBin(update)) {
      return;
    }

    const timestamp = await this.storage.pushDocUpdates(
      workspaceId,
      propertiesDocId,
      [update],
      editorId
    );
    const payload = {
      spaceId: workspaceId,
      docId: propertiesDocId,
      updates: [update],
      timestamp,
      editor: editorId,
    };
    if (broadcasts) {
      this.recordDocUpdatesPushed(broadcasts, payload);
    } else {
      this.emitDocUpdatesPushed(payload);
    }
  }
}
