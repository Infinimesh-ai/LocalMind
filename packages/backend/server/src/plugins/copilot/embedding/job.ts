import { Injectable, Logger } from '@nestjs/common';

import {
  BlobNotFound,
  CallMetric,
  CopilotContextFileNotSupported,
  EventBus,
  JOB_SIGNAL,
  type JobExecution,
  JobQueue,
  mapAnyError,
  OneDay,
  OnEvent,
  OnJob,
} from '../../../base';
import { DocReader } from '../../../core/doc';
import { snapshotParser } from '../../../core/doc/snapshot-parser';
import { WorkspaceBlobStorage } from '../../../core/storage';
import {
  type Embedding,
  EMBEDDING_DIMENSIONS,
  Models,
  type PendingEmbeddingBackfillChunk,
} from '../../../models';
import { CopilotStorage } from '../storage';
import { readStream } from '../utils';
import { CopilotEmbeddingClientService } from './client';
import type { Chunk, DocFragment, EmbeddingCallOptions } from './types';
import { EmbeddingClient } from './types';

@Injectable()
export class CopilotEmbeddingJob {
  private readonly logger = new Logger(CopilotEmbeddingJob.name);
  private readonly workspaceJobAbortController: Map<string, AbortController> =
    new Map();

  private supportEmbedding = false;
  private client: EmbeddingClient | undefined;

  constructor(
    private readonly embeddingClients: CopilotEmbeddingClientService,
    private readonly doc: DocReader,
    private readonly event: EventBus,
    private readonly models: Models,
    private readonly queue: JobQueue,
    private readonly storage: CopilotStorage,
    private readonly workspaceStorage: WorkspaceBlobStorage
  ) {}

  @OnEvent('config.init')
  async onConfigInit() {
    await this.setup();
  }

  @OnEvent('config.changed')
  async onConfigChanged() {
    await this.setup();
  }

  private async setup() {
    this.supportEmbedding =
      await this.models.copilotContext.checkEmbeddingAvailable();
    if (this.supportEmbedding) {
      this.client = await this.embeddingClients.refresh();
    }
  }

  // public this client to allow overriding in tests
  get embeddingClient() {
    return this.client as EmbeddingClient;
  }

  @CallMetric('ai', 'addFileEmbeddingQueue')
  async addFileEmbeddingQueue(
    file: Jobs['copilot.embedding.files'],
    options?: { priority?: number }
  ) {
    let requestId = file.requestId;
    if (!file.contextId) {
      requestId =
        (await this.models.copilotWorkspace.queueEmbeddingTask(
          file.workspaceId,
          'file',
          file.fileId,
          { userId: file.userId, retry: true }
        )) ?? undefined;
      if (!requestId) return;
    }
    try {
      await this.queue.add(
        'copilot.embedding.files',
        { ...file, requestId },
        {
          priority: options?.priority,
          ...(requestId ? { jobId: `embedding-file-${requestId}` } : {}),
        }
      );
    } catch (error) {
      if (!requestId) throw error;
      await this.models.copilotWorkspace.failEmbeddingTask(
        file.workspaceId,
        'file',
        file.fileId,
        requestId,
        null,
        true,
        'queue_unavailable'
      );
      // The uploaded resource exists; expose its durable retry state instead of
      // failing the upload and encouraging duplicate resource creation.
      this.event.emit('workspace.file.embed.failed', {
        ...file,
        error: 'queue_unavailable',
      });
    }
  }

  @CallMetric('ai', 'addBlobEmbeddingQueue')
  async addBlobEmbeddingQueue(blob: Jobs['copilot.embedding.blobs']) {
    if (!this.supportEmbedding) return;

    await this.queue.add('copilot.embedding.blobs', blob);
  }

  @OnJob('copilot.embedding.backfillDimensions')
  async backfillEmbeddingDimensions({
    limit = 64,
  }: Jobs['copilot.embedding.backfillDimensions']) {
    if (!this.supportEmbedding || !this.embeddingClient) {
      return JOB_SIGNAL.Done;
    }

    const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), 128);
    const pending =
      await this.models.copilotContext.listPendingEmbeddingBackfill(
        boundedLimit
      );
    if (!pending.length) return JOB_SIGNAL.Done;

    const groups = Map.groupBy(
      pending,
      row =>
        `${row.kind}\u0000${row.workspaceId}\u0000${row.contextId ?? ''}\u0000${row.userId ?? ''}\u0000${row.entityId}`
    );
    let failedGroups = 0;
    let restoredChunks = 0;

    for (const rows of groups.values()) {
      const first = rows[0];
      try {
        const embeddings = await this.generateBackfillEmbeddings(rows);
        await this.persistBackfillEmbeddings(first, embeddings);
        restoredChunks += embeddings.length;
      } catch (error) {
        failedGroups++;
        this.logger.warn('Failed to backfill embedding chunks', {
          kind: first.kind,
          workspaceId: first.workspaceId,
          contextId: first.contextId,
          entityId: first.entityId,
          chunks: rows.length,
          error: mapAnyError(error).message,
        });
      }
    }

    this.logger.log(
      `Backfilled ${restoredChunks} embedding chunks; ${failedGroups} groups remain pending`
    );
    return failedGroups === 0 && pending.length >= boundedLimit
      ? JOB_SIGNAL.Repeat
      : JOB_SIGNAL.Done;
  }

  private async generateBackfillEmbeddings(
    rows: PendingEmbeddingBackfillChunk[]
  ): Promise<Embedding[]> {
    const emptyRows = rows.filter(row => row.content.length === 0);
    const contentRows = rows.filter(row => row.content.length > 0);
    const first = rows[0];
    const embeddings = contentRows.length
      ? await this.embeddingClient.generateEmbeddings(
          contentRows.map(row => ({ index: row.chunk, content: row.content })),
          {
            workspaceId: first.workspaceId,
            userId: first.userId ?? undefined,
            featureKind:
              first.kind === 'memory' ? 'embedding' : 'workspace_indexing',
          }
        )
      : [];

    embeddings.push(
      ...emptyRows.map(row => ({
        index: row.chunk,
        content: row.content,
        embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
      }))
    );
    return embeddings;
  }

  private async persistBackfillEmbeddings(
    row: PendingEmbeddingBackfillChunk,
    embeddings: Embedding[]
  ) {
    switch (row.kind) {
      case 'context_file':
        if (!row.contextId) {
          throw new Error('Context embedding backfill is missing context id');
        }
        await this.models.copilotContext.insertFileEmbedding(
          row.contextId,
          row.entityId,
          embeddings
        );
        break;
      case 'memory':
        if (embeddings.length !== 1) {
          throw new Error('Memory embedding backfill must contain one vector');
        }
        await this.models.copilotContextMemory.putEmbedding(
          row.entityId,
          embeddings[0].embedding
        );
        break;
      case 'workspace_document':
        await this.models.copilotContext.insertWorkspaceEmbedding(
          row.workspaceId,
          row.entityId,
          embeddings
        );
        break;
      case 'workspace_file':
        await this.models.copilotWorkspace.insertFileEmbeddings(
          row.workspaceId,
          row.entityId,
          embeddings
        );
        break;
      case 'workspace_blob':
        await this.models.copilotWorkspace.insertBlobEmbeddings(
          row.workspaceId,
          row.entityId,
          embeddings
        );
        break;
    }
  }

  @OnEvent('workspace.doc.embedding')
  async addDocEmbeddingQueue(
    docs: Events['workspace.doc.embedding'],
    options?: { contextId: string; priority: number }
  ) {
    for (const { workspaceId, docId } of docs) {
      const requestId = await this.models.copilotWorkspace.queueEmbeddingTask(
        workspaceId,
        'doc',
        docId,
        { force: true }
      );
      if (!requestId) continue;
      try {
        await this.queue.add(
          'copilot.embedding.docs',
          {
            contextId: options?.contextId,
            workspaceId,
            docId,
            requestId,
          },
          {
            jobId: `embedding-doc-${requestId}`,
            priority: options?.priority ?? 1,
          }
        );
      } catch {
        await this.models.copilotWorkspace.failEmbeddingTask(
          workspaceId,
          'doc',
          docId,
          requestId,
          null,
          true,
          'queue_unavailable'
        );
        this.event.emit('workspace.doc.embed.failed', { workspaceId, docId });
      }
    }
  }

  async retryWorkspaceEmbedding(workspaceId: string) {
    const tasks =
      await this.models.copilotWorkspace.listFailedEmbeddingTasks(workspaceId);
    const docIds = new Set(
      await this.models.copilotWorkspace.listEmbeddableDocIds(workspaceId)
    );
    const ignored = new Set(
      await this.models.copilotWorkspace.checkIgnoredDocs(workspaceId, [
        ...docIds,
      ])
    );
    const root = await this.doc.getDoc(workspaceId, workspaceId);
    const live = new Set(root ? await snapshotParser.docIds(root.bin) : []);
    let count = 0;
    for (const task of tasks) {
      if (task.kind === 'file' && task.userId) {
        const file = await this.models.copilotWorkspace.getFile(
          workspaceId,
          task.resourceId
        );
        if (!file) continue;
        await this.addFileEmbeddingQueue({
          userId: task.userId,
          workspaceId,
          fileId: file.fileId,
          blobId: file.blobId,
          fileName: file.fileName,
        });
        count++;
      } else if (
        task.kind === 'doc' &&
        docIds.has(task.resourceId) &&
        !ignored.has(task.resourceId) &&
        live.has(task.resourceId) &&
        (await this.models.workspace.allowEmbedding(workspaceId))
      ) {
        await this.addDocEmbeddingQueue([
          { workspaceId, docId: task.resourceId },
        ]);
        count++;
      }
    }
    return count;
  }

  @OnEvent('workspace.updated')
  async onWorkspaceConfigUpdate({
    id,
    enableDocEmbedding,
  }: Events['workspace.updated']) {
    // trigger workspace embedding
    this.event.emit('workspace.embedding', {
      workspaceId: id,
      enableDocEmbedding,
    });
  }

  @OnEvent('workspace.embedding')
  async addWorkspaceEmbeddingQueue({
    workspaceId,
    enableDocEmbedding,
  }: Events['workspace.embedding']) {
    if (!this.supportEmbedding || !this.embeddingClient) return;

    if (enableDocEmbedding === undefined) {
      enableDocEmbedding =
        await this.models.workspace.allowEmbedding(workspaceId);
    }

    if (enableDocEmbedding) {
      const toBeEmbedDocIds =
        await this.models.copilotWorkspace.findDocsToEmbed(workspaceId);
      if (!toBeEmbedDocIds.length) {
        return;
      }
      // filter out trashed docs
      const rootSnapshot = await this.models.doc.getSnapshot(
        workspaceId,
        workspaceId
      );
      if (!rootSnapshot) {
        this.logger.warn(
          `Root snapshot for workspace ${workspaceId} not found, skipping embedding.`
        );
        return;
      }
      const allDocIds = new Set(await snapshotParser.docIds(rootSnapshot.blob));
      this.logger.log(
        `Trigger embedding for ${toBeEmbedDocIds.length} docs in workspace ${workspaceId}`
      );
      const finalToBeEmbedDocIds = toBeEmbedDocIds.filter(docId =>
        allDocIds.has(docId)
      );
      await this.addDocEmbeddingQueue(
        finalToBeEmbedDocIds.map(docId => ({ workspaceId, docId }))
      );
    } else {
      const controller = this.workspaceJobAbortController.get(workspaceId);
      if (controller) {
        controller.abort();
        this.workspaceJobAbortController.delete(workspaceId);
      }
    }
  }

  @OnJob('copilot.embedding.updateDoc')
  async addDocEmbeddingQueueFromEvent(
    doc: Jobs['copilot.embedding.updateDoc']
  ) {
    if (
      await this.models.copilotWorkspace.checkDocNeedEmbedded(
        doc.workspaceId,
        doc.docId
      )
    ) {
      await this.addDocEmbeddingQueue([doc]);
    }
  }

  private async deleteDocEmbedding(doc: {
    workspaceId: string;
    docId: string;
  }) {
    await this.queue.remove(
      `workspace:embedding:${doc.workspaceId}:${doc.docId}`,
      'copilot.embedding.docs'
    );
    await this.models.copilotWorkspace.removeDocEmbeddingTask(
      doc.workspaceId,
      doc.docId
    );
    await this.models.copilotContext.purgeWorkspaceEmbedding(
      doc.workspaceId,
      doc.docId
    );
  }

  @OnJob('copilot.embedding.reconcileDocumentCleanup')
  async reconcileDocumentCleanup({
    workspaceId,
    docId,
    cleanupVersion,
  }: Jobs['copilot.embedding.reconcileDocumentCleanup']) {
    const root = await this.doc.getDoc(workspaceId, workspaceId);
    if (!root) {
      throw new Error(`workspace root ${workspaceId} not found`);
    }
    const live = (await snapshotParser.docIds(root.bin, true)).includes(docId);
    if (live) {
      if (!(await this.doc.getDoc(workspaceId, docId))) {
        throw new Error(`restored document ${workspaceId}/${docId} not found`);
      }
      await this.addDocEmbeddingQueueFromEvent({ workspaceId, docId });
    } else {
      await this.deleteDocEmbedding({ workspaceId, docId });
    }
    await this.queue.add('backendRuntime.ackDocumentCleanupEffect', {
      workspaceId,
      docId,
      cleanupVersion,
      effect: 'copilot',
    });
  }

  private async readCopilotBlob(
    userId: string,
    workspaceId: string,
    blobId: string,
    fileName: string
  ) {
    const { body } = await this.storage.get(userId, workspaceId, blobId);
    if (!body) throw new BlobNotFound({ spaceId: workspaceId, blobId });
    const buffer = await readStream(body);
    return new File([buffer], fileName);
  }

  private async readWorkspaceBlob(
    workspaceId: string,
    blobId: string,
    fileName: string
  ) {
    const { body } = await this.workspaceStorage.get(workspaceId, blobId);
    if (!body) throw new BlobNotFound({ spaceId: workspaceId, blobId });
    const buffer = await readStream(body);
    return new File([buffer], fileName);
  }

  private workspaceIndexingOptions(
    workspaceId: string,
    signal?: AbortSignal,
    userId?: string
  ): EmbeddingCallOptions {
    return {
      workspaceId,
      userId,
      signal,
      featureKind: 'workspace_indexing',
    };
  }

  @OnJob('copilot.embedding.files')
  async embedPendingFile(
    payload: Jobs['copilot.embedding.files'],
    execution?: JobExecution
  ) {
    const { userId, workspaceId, contextId, blobId, fileId, fileName } =
      payload;
    const tracked = !contextId;
    const requestId =
      payload.requestId ??
      (tracked
        ? await this.models.copilotWorkspace.queueEmbeddingTask(
            workspaceId,
            'file',
            fileId,
            { userId, retry: true }
          )
        : null);
    const runId = requestId
      ? await this.models.copilotWorkspace.startEmbeddingTask(
          workspaceId,
          'file',
          fileId,
          requestId
        )
      : null;
    if (tracked && (!requestId || !runId)) return;
    try {
      if (!this.supportEmbedding || !this.embeddingClient)
        throw new Error('Embedding provider unavailable');
      const file = await this.readCopilotBlob(
        userId,
        workspaceId,
        blobId,
        fileName
      );
      const chunks = await this.embeddingClient.getFileChunks(file);
      const embeddings: Embedding[] = [];
      for (const chunk of chunks) {
        if (
          requestId &&
          runId &&
          !(await this.models.copilotWorkspace.renewEmbeddingTask(
            workspaceId,
            'file',
            fileId,
            requestId,
            runId
          ))
        )
          return;
        embeddings.push(
          ...(await this.embeddingClient.generateEmbeddings(
            chunk,
            this.workspaceIndexingOptions(workspaceId, undefined, userId)
          ))
        );
      }
      if (contextId) {
        await this.models.copilotContext.insertFileEmbedding(
          contextId,
          fileId,
          embeddings
        );
      } else if (
        requestId &&
        runId &&
        !(await this.models.copilotWorkspace.completeEmbeddingTask(
          workspaceId,
          'file',
          fileId,
          requestId,
          runId,
          embeddings
        ))
      )
        return;
      this.event.emit('workspace.file.embed.finished', {
        contextId,
        workspaceId,
        fileId,
        chunkSize: embeddings.length,
      });
    } catch (error) {
      const final = !execution || execution.attempt >= execution.maxAttempts;
      if (requestId && runId)
        await this.models.copilotWorkspace.failEmbeddingTask(
          workspaceId,
          'file',
          fileId,
          requestId,
          runId,
          final
        );
      if (final)
        this.event.emit('workspace.file.embed.failed', {
          contextId,
          workspaceId,
          fileId,
          error: 'indexing_failed',
        });
      throw error;
    }
  }

  @OnJob('copilot.embedding.blobs')
  async embedPendingBlob({
    workspaceId,
    contextId,
    blobId,
  }: Jobs['copilot.embedding.blobs']) {
    if (!this.supportEmbedding || !this.embeddingClient) return;

    try {
      const file = await this.readWorkspaceBlob(workspaceId, blobId, 'blob');

      const chunks = await this.embeddingClient.getFileChunks(file);
      const total = chunks.reduce((acc, c) => acc + c.length, 0);

      for (const chunk of chunks) {
        const embeddings = await this.embeddingClient.generateEmbeddings(
          chunk,
          this.workspaceIndexingOptions(workspaceId)
        );
        await this.models.copilotWorkspace.insertBlobEmbeddings(
          workspaceId,
          blobId,
          embeddings
        );
      }

      if (contextId) {
        this.event.emit('workspace.blob.embed.finished', {
          contextId,
          blobId,
          chunkSize: total,
        });
      }
    } catch (error: any) {
      if (contextId) {
        this.event.emit('workspace.blob.embed.failed', {
          contextId,
          blobId,
          error: mapAnyError(error).message,
        });
      }

      throw error;
    }
  }

  private async getDocFragment(
    workspaceId: string,
    docId: string
  ): Promise<DocFragment | null> {
    const docContent = await this.doc.getFullDocContent(workspaceId, docId);
    const authors = await this.models.doc.getAuthors(workspaceId, docId);
    if (docContent && authors) {
      const { title, summary } = docContent;
      const { createdAt, updatedAt, createdByUser, updatedByUser } = authors;
      return {
        title: title || 'Untitled',
        summary,
        createdAt: createdAt.toDateString(),
        updatedAt: updatedAt.toDateString(),
        createdBy: createdByUser?.name,
        updatedBy: updatedByUser?.name,
      };
    }
    return null;
  }

  private formatDocChunks(chunks: Chunk[], fragment: DocFragment): Chunk[] {
    return chunks.map(chunk => ({
      index: chunk.index,
      content: [
        `Title: ${fragment.title}`,
        `Created at: ${fragment.createdAt}`,
        `Updated at: ${fragment.updatedAt}`,
        fragment.createdBy ? `Created by: ${fragment.createdBy}` : undefined,
        fragment.updatedBy ? `Updated by: ${fragment.updatedBy}` : undefined,
        chunk.content,
      ]
        .filter(Boolean)
        .join('\n'),
    }));
  }

  private getWorkspaceSignal(workspaceId: string) {
    let controller = this.workspaceJobAbortController.get(workspaceId);
    if (!controller) {
      controller = new AbortController();
      this.workspaceJobAbortController.set(workspaceId, controller);
    }
    return controller.signal;
  }

  @OnJob('copilot.embedding.docs')
  async embedPendingDocs(
    payload: Jobs['copilot.embedding.docs'],
    execution?: JobExecution
  ) {
    const { contextId, workspaceId, docId } = payload;
    if (
      workspaceId === docId ||
      docId.includes('$') ||
      docId.includes(':settings:')
    )
      return;
    const requestId =
      payload.requestId ??
      (await this.models.copilotWorkspace.queueEmbeddingTask(
        workspaceId,
        'doc',
        docId,
        { force: true, retry: true }
      ));
    if (!requestId) return;
    const runId = await this.models.copilotWorkspace.startEmbeddingTask(
      workspaceId,
      'doc',
      docId,
      requestId
    );
    if (!runId) return;
    try {
      if (!this.supportEmbedding || !this.embeddingClient)
        throw new Error('Embedding provider unavailable');
      const signal = this.getWorkspaceSignal(workspaceId);
      if (signal.aborted) throw new Error('Workspace indexing stopped');
      const hasNewDoc = await this.models.doc.exists(
        workspaceId,
        docId.split(':space:')[1] || ''
      );
      const fragment = !hasNewDoc
        ? await this.getDocFragment(workspaceId, docId)
        : null;
      let embeddings: Embedding[] = [];
      if (fragment?.summary.trim()) {
        embeddings = (
          await this.embeddingClient.getFileEmbeddings(
            new File([fragment.summary], `${fragment.title || 'Untitled'}.md`),
            chunks => this.formatDocChunks(chunks, fragment),
            this.workspaceIndexingOptions(workspaceId, signal)
          )
        ).flat();
      }
      if (
        !(await this.models.copilotWorkspace.completeEmbeddingTask(
          workspaceId,
          'doc',
          docId,
          requestId,
          runId,
          embeddings
        ))
      )
        return;
      this.event.emit('workspace.doc.embed.finished', {
        contextId,
        workspaceId,
        docId,
      });
    } catch (error) {
      if (
        error instanceof CopilotContextFileNotSupported &&
        error.message.includes('no content found')
      ) {
        if (
          await this.models.copilotWorkspace.completeEmbeddingTask(
            workspaceId,
            'doc',
            docId,
            requestId,
            runId,
            []
          )
        ) {
          this.event.emit('workspace.doc.embed.finished', {
            contextId,
            workspaceId,
            docId,
          });
        }
        return;
      }
      const final = !execution || execution.attempt >= execution.maxAttempts;
      await this.models.copilotWorkspace.failEmbeddingTask(
        workspaceId,
        'doc',
        docId,
        requestId,
        runId,
        final
      );
      if (final)
        this.event.emit('workspace.doc.embed.failed', {
          contextId,
          workspaceId,
          docId,
        });
      throw error;
    }
  }

  @OnJob('copilot.embedding.cleanupTrashedDocEmbeddings')
  async cleanupTrashedDocEmbeddings({
    workspaceId,
  }: Jobs['copilot.embedding.cleanupTrashedDocEmbeddings']) {
    const workspace = await this.models.workspace.get(workspaceId);
    if (!workspace) {
      this.logger.warn(`workspace ${workspaceId} not found`);
      return;
    }

    const oneMonthAgo = new Date(Date.now() - OneDay * 30);
    const snapshot = await this.models.doc.getSnapshot(
      workspaceId,
      workspaceId
    );
    if (!snapshot) {
      // maybe local workspace or empty workspace
      this.logger.verbose(`workspace root snapshot ${workspaceId} not found`);
      // mark last check time to avoid repeated checking
      await this.models.workspace.update(
        workspaceId,
        { lastCheckEmbeddings: new Date() },
        false
      );

      return;
    } else if (
      // always check if never cleared
      workspace.lastCheckEmbeddings > new Date(0) &&
      snapshot.updatedAt < oneMonthAgo
    ) {
      this.logger.verbose(
        `workspace ${workspaceId} is too old, skipping embeddings cleanup`
      );
      await this.models.workspace.update(
        workspaceId,
        { lastCheckEmbeddings: new Date() },
        false
      );
      return;
    }

    const [docIdsInEmbedding, docIdsInSnapshots] = await Promise.all([
      this.models.copilotContext.listWorkspaceDocEmbedding(workspaceId),
      this.models.copilotWorkspace.listEmbeddableDocIds(workspaceId),
    ]);

    if (!docIdsInEmbedding.length && !docIdsInSnapshots.length) {
      this.logger.verbose(
        `No doc embeddings and snapshots found in workspace ${workspaceId}, skipping cleanup`
      );
      await this.models.workspace.update(
        workspaceId,
        { lastCheckEmbeddings: new Date() },
        false
      );
      return;
    }

    const docIdsInWorkspace = await snapshotParser.docIds(snapshot.blob);
    const docIdsInWorkspaceSet = new Set(docIdsInWorkspace);

    const deletedDocIds = new Set(
      [...docIdsInEmbedding, ...docIdsInSnapshots].filter(
        docId => !docIdsInWorkspaceSet.has(docId)
      )
    );
    for (const docId of deletedDocIds) {
      const isPlaceholder = await this.models.copilotWorkspace.hasPlaceholder(
        workspaceId,
        docId
      );
      if (isPlaceholder) continue;
      await this.models.copilotContext.deleteWorkspaceEmbedding(
        workspaceId,
        docId
      );
    }

    await this.models.workspace.update(
      workspaceId,
      { lastCheckEmbeddings: new Date() },
      false
    );
  }

  @OnEvent('workspace.updated')
  async onWorkspaceUpdated({ id }: Events['workspace.updated']) {
    if (!this.supportEmbedding) return;

    await this.queue.add('copilot.embedding.cleanupTrashedDocEmbeddings', {
      workspaceId: id,
    });
  }
}
