import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma, PrismaClient } from '@prisma/client';

import { PaginationInput } from '../base';
import { BaseModel } from './base';
import {
  type BlobChunkSimilarity,
  clearEmbeddingContent,
  type CopilotWorkspaceFile,
  type CopilotWorkspaceFileMetadata,
  type Embedding,
  embeddingSearchCandidateLimit,
  type FileChunkSimilarity,
  type IgnoredDoc,
  toPgVector,
} from './common';

@Injectable()
export class CopilotWorkspaceConfigModel extends BaseModel {
  constructor(private readonly database: PrismaClient) {
    super();
  }

  async queueEmbeddingTask(
    workspaceId: string,
    kind: 'doc' | 'file',
    resourceId: string,
    options: { userId?: string; retry?: boolean; force?: boolean } = {}
  ) {
    const requestId = randomUUID();
    const data = {
      requestId,
      runId: null,
      status: 'queued',
      errorCode: null,
      leaseUntil: new Date(Date.now() + 15 * 60_000),
      ...(options.userId ? { userId: options.userId } : {}),
    };
    const created = await this.database.aiWorkspaceEmbeddingTask.createMany({
      data: [{ workspaceId, kind, resourceId, ...data }],
      skipDuplicates: true,
    });
    if (created.count) return requestId;
    const claimed = await this.database.aiWorkspaceEmbeddingTask.updateMany({
      where: {
        workspaceId,
        kind,
        resourceId,
        OR: [
          {
            status: { in: ['queued', 'running'] },
            leaseUntil: { lte: new Date() },
          },
          ...(options.retry ? [{ status: 'failed' }] : []),
          ...(options.force
            ? [{ status: { in: ['failed', 'succeeded'] } }]
            : []),
        ],
      },
      data,
    });
    return claimed.count ? requestId : null;
  }

  async startEmbeddingTask(
    workspaceId: string,
    kind: 'doc' | 'file',
    resourceId: string,
    requestId: string
  ) {
    const runId = randomUUID();
    const claimed = await this.database.aiWorkspaceEmbeddingTask.updateMany({
      where: {
        workspaceId,
        kind,
        resourceId,
        requestId,
        status: { in: ['queued', 'running'] },
      },
      data: {
        runId,
        status: 'running',
        leaseUntil: new Date(Date.now() + 15 * 60_000),
      },
    });
    return claimed.count ? runId : null;
  }

  async renewEmbeddingTask(
    workspaceId: string,
    kind: 'doc' | 'file',
    resourceId: string,
    requestId: string,
    runId: string
  ) {
    const result = await this.database.aiWorkspaceEmbeddingTask.updateMany({
      where: {
        workspaceId,
        kind,
        resourceId,
        requestId,
        runId,
        status: 'running',
      },
      data: { leaseUntil: new Date(Date.now() + 15 * 60_000) },
    });
    return result.count === 1;
  }

  async failEmbeddingTask(
    workspaceId: string,
    kind: 'doc' | 'file',
    resourceId: string,
    requestId: string,
    runId: string | null,
    final: boolean,
    errorCode = 'indexing_failed'
  ) {
    return this.database.aiWorkspaceEmbeddingTask.updateMany({
      where: {
        workspaceId,
        kind,
        resourceId,
        requestId,
        runId,
        status: { in: ['queued', 'running'] },
      },
      data: {
        status: final ? 'failed' : 'queued',
        errorCode: final ? errorCode : null,
        leaseUntil: new Date(Date.now() + 15 * 60_000),
      },
    });
  }

  @Transactional()
  async completeEmbeddingTask(
    workspaceId: string,
    kind: 'doc' | 'file',
    resourceId: string,
    requestId: string,
    runId: string,
    embeddings?: Embedding[]
  ) {
    // Lock and compare the generation before changing vectors in the same transaction.
    const result = await this.db.aiWorkspaceEmbeddingTask.updateMany({
      where: {
        workspaceId,
        kind,
        resourceId,
        requestId,
        runId,
        status: 'running',
      },
      data: { status: 'succeeded', errorCode: null },
    });
    if (!result.count) return false;
    if (kind === 'file') {
      if (
        !(await this.db.aiWorkspaceFiles.findUnique({
          where: { workspaceId_fileId: { workspaceId, fileId: resourceId } },
        }))
      ) {
        await this.db.aiWorkspaceEmbeddingTask.deleteMany({
          where: { workspaceId, kind, resourceId, requestId },
        });
        return false;
      }
      if (embeddings) {
        await this.db.aiWorkspaceFileEmbedding.deleteMany({
          where: { workspaceId, fileId: resourceId },
        });
        await this.insertFileEmbeddings(workspaceId, resourceId, embeddings);
      }
    } else {
      if (!(await this.models.doc.exists(workspaceId, resourceId))) {
        await this.db.aiWorkspaceEmbeddingTask.deleteMany({
          where: { workspaceId, kind, resourceId, requestId },
        });
        return false;
      }
      if (embeddings) {
        await this.models.copilotContext.purgeWorkspaceEmbedding(
          workspaceId,
          resourceId
        );
        if (embeddings.length) {
          await this.models.copilotContext.insertWorkspaceEmbedding(
            workspaceId,
            resourceId,
            embeddings
          );
        } else {
          await this.models.copilotContext.fulfillEmptyEmbedding(
            workspaceId,
            resourceId
          );
        }
      }
    }
    return true;
  }

  async removeDocEmbeddingTask(workspaceId: string, docId: string) {
    await this.database.aiWorkspaceEmbeddingTask.deleteMany({
      where: { workspaceId, kind: 'doc', resourceId: docId },
    });
  }

  async listFailedEmbeddingTasks(workspaceId: string) {
    return this.database.aiWorkspaceEmbeddingTask.findMany({
      where: {
        workspaceId,
        OR: [
          { status: 'failed' },
          {
            status: { in: ['queued', 'running'] },
            leaseUntil: { lte: new Date() },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
  }

  @Transactional()
  private async listIgnoredDocIds(
    workspaceId: string,
    options?: PaginationInput
  ) {
    return await this.db.aiWorkspaceIgnoredDocs.findMany({
      where: {
        workspaceId,
      },
      select: {
        docId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: options?.offset,
      take: options?.first,
    });
  }

  /**
   * find docs to embed, excluding ignored and already embedded docs
   * newer docs will be list first
   * @param workspaceId id of the workspace
   * @returns docIds
   */
  async findDocsToEmbed(workspaceId: string): Promise<string[]> {
    // NOTE: for unknown reason, the transaction will timeout if call from event handler
    // so we use an independent client here
    const docIds = await this.database.$queryRaw<{ id: string }[]>`
      SELECT s.guid as id
        FROM snapshots AS s
          LEFT JOIN (
            SELECT workspace_id, doc_id
            FROM ai_workspace_embeddings
            GROUP BY workspace_id, doc_id
            HAVING BOOL_AND(embedding IS NOT NULL)
          ) e
            ON e.workspace_id = s.workspace_id
               AND e.doc_id = s.guid
          LEFT JOIN ai_workspace_ignored_docs id
            ON id.workspace_id = s.workspace_id
               AND id.doc_id = s.guid
        WHERE s.workspace_id = ${workspaceId}
          AND s.guid <> s.workspace_id
          AND s.guid NOT LIKE '%$%'
          AND s.guid NOT LIKE '%:settings:%'
          AND e.doc_id IS NULL
          AND id.doc_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM ai_workspace_embedding_tasks t
            WHERE t.workspace_id = s.workspace_id AND t.kind = 'doc'
              AND t.resource_id = s.guid AND t.status = 'failed'
          )
          AND s.blob <> E'\\\\x0000';`;

    return docIds.map(r => r.id);
  }

  @Transactional()
  async updateIgnoredDocs(
    workspaceId: string,
    add: string[] = [],
    remove: string[] = []
  ) {
    const removed = new Set(remove);
    const ignored = await this.listIgnoredDocIds(workspaceId).then(
      r => new Set(r.map(r => r.docId).filter(id => !removed.has(id)))
    );
    const added = add.filter(id => !ignored.has(id));

    const { count: addedCount } =
      await this.db.aiWorkspaceIgnoredDocs.createMany({
        data: added.map(docId => ({
          workspaceId,
          docId,
        })),
      });

    const { count: removedCount } =
      await this.db.aiWorkspaceIgnoredDocs.deleteMany({
        where: {
          workspaceId,
          docId: {
            in: Array.from(removed),
          },
        },
      });

    return addedCount + removedCount;
  }

  @Transactional()
  async listIgnoredDocs(
    workspaceId: string,
    options?: PaginationInput
  ): Promise<IgnoredDoc[]> {
    const row = await this.listIgnoredDocIds(workspaceId, options);
    const ids = row.map(r => ({ workspaceId, docId: r.docId }));
    const docs = await this.models.doc.findMetas(ids);
    const docsMap = new Map(
      docs.filter(r => !!r).map(r => [`${r.workspaceId}-${r.docId}`, r])
    );
    const authors = await this.models.doc.findAuthors(ids);
    const authorsMap = new Map(
      authors.filter(r => !!r).map(r => [`${r.workspaceId}-${r.id}`, r])
    );

    return row.map(r => {
      const docMeta = docsMap.get(`${workspaceId}-${r.docId}`);
      const docAuthor = authorsMap.get(`${workspaceId}-${r.docId}`);
      return {
        ...r,
        docCreatedAt: docAuthor?.createdAt,
        docUpdatedAt: docAuthor?.updatedAt,
        title: docMeta?.title || undefined,
        createdBy: docAuthor?.createdByUser?.name,
        createdByAvatar: docAuthor?.createdByUser?.avatarUrl || undefined,
        updatedBy: docAuthor?.updatedByUser?.name,
      };
    });
  }

  @Transactional()
  async countIgnoredDocs(workspaceId: string): Promise<number> {
    const count = await this.db.aiWorkspaceIgnoredDocs.count({
      where: {
        workspaceId,
      },
    });
    return count;
  }

  @Transactional()
  async checkIgnoredDocs(workspaceId: string, docIds: string[]) {
    const ignored = await this.listIgnoredDocIds(workspaceId).then(
      r => new Set(r.map(r => r.docId))
    );

    return docIds.filter(id => ignored.has(id));
  }

  // check if a docId has only placeholder embeddings
  @Transactional()
  async hasPlaceholder(workspaceId: string, docId: string): Promise<boolean> {
    const [row] = await this.db.$queryRaw<
      Array<{ total: number; nonPlaceholder: number }>
    >`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (
          WHERE NOT ("chunk" = 0 AND "content" = '')
        )::int AS "nonPlaceholder"
      FROM "ai_workspace_embeddings"
      WHERE "workspace_id" = ${workspaceId}
        AND "doc_id" = ${docId}
        AND "embedding" IS NOT NULL
    `;
    return (row?.total ?? 0) > 0 && row?.nonPlaceholder === 0;
  }

  private getEmbeddableCondition(
    workspaceId: string,
    ignoredDocIds?: string[]
  ): Prisma.SnapshotWhereInput {
    const condition: Prisma.SnapshotWhereInput['AND'] = [
      { id: { not: workspaceId } },
      { id: { not: { contains: '$' } } },
      { id: { not: { contains: ':settings:' } } },
      { blob: { not: new Uint8Array([0, 0]) } },
    ];
    if (ignoredDocIds && ignoredDocIds.length > 0) {
      condition.push({ id: { notIn: ignoredDocIds } });
    }
    return { workspaceId, AND: condition };
  }

  async listEmbeddableDocIds(workspaceId: string) {
    const condition = this.getEmbeddableCondition(workspaceId);
    const rows = await this.db.snapshot.findMany({
      where: condition,
      select: { id: true },
    });
    return rows.map(r => r.id);
  }

  @Transactional()
  async getEmbeddingStatus(workspaceId: string) {
    const ignoredDocIds = (await this.listIgnoredDocIds(workspaceId)).map(
      d => d.docId
    );
    const snapshotCondition = this.getEmbeddableCondition(
      workspaceId,
      ignoredDocIds
    );

    const [docTotal, docEmbedded, files, fileEmbedded, tasks] =
      await Promise.all([
        this.db.snapshot.findMany({
          where: snapshotCondition,
          select: { id: true },
        }),
        this.db.$queryRaw<Array<{ id: string }>>`
        SELECT doc_id AS id FROM ai_workspace_embeddings WHERE workspace_id = ${workspaceId}
        GROUP BY doc_id HAVING BOOL_AND(embedding IS NOT NULL)`,
        this.db.aiWorkspaceFiles.findMany({
          where: { workspaceId },
          select: { fileId: true },
        }),
        this.db.$queryRaw<Array<{ id: string }>>`
        SELECT file_id AS id FROM ai_workspace_file_embeddings WHERE workspace_id = ${workspaceId}
        GROUP BY file_id HAVING BOOL_AND(embedding IS NOT NULL)`,
        this.db.aiWorkspaceEmbeddingTask.findMany({ where: { workspaceId } }),
      ]);
    const docIds = new Set(docTotal.map(d => d.id));
    const prefix = `${workspaceId}:space:`;
    const resources = [
      ...docTotal
        .filter(
          d =>
            !(d.id.startsWith(prefix) && docIds.has(d.id.slice(prefix.length)))
        )
        .map(d => ({ kind: 'doc', id: d.id })),
      ...files.map(f => ({ kind: 'file', id: f.fileId })),
    ];
    const taskMap = new Map(tasks.map(t => [`${t.kind}:${t.resourceId}`, t]));
    const embeddedIds = new Set([
      ...docEmbedded.map(d => `doc:${d.id}`),
      ...fileEmbedded.map(f => `file:${f.id}`),
    ]);
    let embedded = 0,
      failed = 0,
      retryable = 0;
    for (const resource of resources) {
      const key = `${resource.kind}:${resource.id}`;
      const task = taskMap.get(key);
      if (
        task &&
        (task.status === 'failed' ||
          (['queued', 'running'].includes(task.status) &&
            task.leaseUntil.getTime() <= Date.now()))
      ) {
        failed++;
        if (resource.kind === 'doc' || task.userId) retryable++;
      } else if (
        (!task || task.status === 'succeeded') &&
        embeddedIds.has(key)
      ) {
        embedded++;
      }
    }
    return { total: resources.length, embedded, failed, retryable };
  }

  @Transactional()
  async checkDocNeedEmbedded(workspaceId: string, docId: string) {
    // NOTE: check if the document needs re-embedding.
    // 1. first-time embedding when no embedding exists
    // 2. re-embedding only when the doc has updates newer than the last embedding
    //    AND the last embedding is older than 10 minutes (avoid frequent updates)
    const result = await this.db.$queryRaw<{ needs_embedding: boolean }[]>`
      SELECT
        EXISTS (
          WITH docs AS (
            SELECT
              s.workspace_id,
              s.guid AS doc_id,
              s.updated_at
            FROM
              snapshots s
            WHERE
              s.workspace_id = ${workspaceId}
              AND s.guid = ${docId}
            UNION
            ALL
            SELECT
              u.workspace_id,
              u.guid AS doc_id,
              u.created_at AS updated_at
            FROM
              "updates" u
            WHERE
              u.workspace_id = ${workspaceId}
              AND u.guid = ${docId}
          )
          SELECT
            1
          FROM
            docs
            LEFT JOIN ai_workspace_embeddings e
              ON e.workspace_id = docs.workspace_id
              AND e.doc_id = docs.doc_id
          WHERE
            e.updated_at IS NULL
            OR e.embedding IS NULL
            OR (docs.updated_at > e.updated_at AND e.updated_at < NOW() - INTERVAL '10 minutes')
        ) AS needs_embedding;
    `;

    return result[0]?.needs_embedding ?? false;
  }

  // ================ embeddings ================

  async checkEmbeddingAvailable(): Promise<boolean> {
    const [{ count }] = await this.db.$queryRaw<
      { count: number }[]
    >`SELECT count(1) FROM pg_tables WHERE tablename in ('ai_workspace_embeddings', 'ai_workspace_file_embeddings', 'ai_workspace_blob_embeddings')`;
    return Number(count) === 3;
  }

  private processEmbeddings(
    workspaceId: string,
    fileOrBlobId: string,
    embeddings: Embedding[]
  ) {
    const groups = embeddings.map(e =>
      [
        workspaceId,
        fileOrBlobId,
        e.index,
        e.content,
        Prisma.raw(`'${toPgVector(e.embedding)}'`),
      ].filter(v => v !== undefined)
    );
    return Prisma.join(groups.map(row => Prisma.sql`(${Prisma.join(row)})`));
  }

  async addFile(
    workspaceId: string,
    file: CopilotWorkspaceFileMetadata
  ): Promise<CopilotWorkspaceFile> {
    const fileId = randomUUID();
    const row = await this.db.aiWorkspaceFiles.create({
      data: { ...file, workspaceId, fileId },
    });

    return row;
  }

  async getFile(workspaceId: string, fileId: string) {
    const file = await this.db.aiWorkspaceFiles.findFirst({
      where: {
        workspaceId,
        fileId,
      },
    });
    return file;
  }

  @Transactional()
  async insertFileEmbeddings(
    workspaceId: string,
    fileId: string,
    embeddings: Embedding[]
  ) {
    if (embeddings.length === 0) {
      this.logger.warn(
        `No embeddings provided for workspaceId: ${workspaceId}, fileId: ${fileId}. Skipping insertion.`
      );
      return;
    }

    const values = this.processEmbeddings(workspaceId, fileId, embeddings);
    await this.db.$executeRaw`
          INSERT INTO "ai_workspace_file_embeddings"
          ("workspace_id", "file_id", "chunk", "content", "embedding") VALUES ${values}
          ON CONFLICT (workspace_id, file_id, chunk) DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding;
      `;
  }

  async listFiles(
    workspaceId: string,
    options?: {
      includeRead?: boolean;
    } & PaginationInput
  ): Promise<CopilotWorkspaceFile[]> {
    const files = await this.db.aiWorkspaceFiles.findMany({
      where: {
        workspaceId,
      },
      orderBy: { createdAt: 'desc' },
      skip: options?.offset,
      take: options?.first,
    });
    return files;
  }

  async countFiles(workspaceId: string): Promise<number> {
    const count = await this.db.aiWorkspaceFiles.count({
      where: {
        workspaceId,
      },
    });
    return count;
  }

  async matchFileEmbedding(
    workspaceId: string,
    embedding: number[],
    topK: number,
    threshold: number
  ): Promise<FileChunkSimilarity[]> {
    if (!(await this.allowEmbedding(workspaceId))) {
      return [];
    }
    const vector = toPgVector(embedding);
    const candidateLimit = embeddingSearchCandidateLimit(topK);

    const similarityChunks = await this.db.$queryRaw<
      Array<FileChunkSimilarity>
    >`
      WITH "candidates" AS MATERIALIZED (
        SELECT
          e."file_id",
          f."file_name" as "name",
          f."blob_id" as "blobId",
          f."mime_type" as "mimeType",
          e."chunk",
          e."content",
          e."embedding"
        FROM "ai_workspace_file_embeddings" e
        JOIN "ai_workspace_files" f
          ON e."workspace_id" = f."workspace_id"
          AND e."file_id" = f."file_id"
        WHERE e.workspace_id = ${workspaceId}
          AND e."embedding" IS NOT NULL
        ORDER BY
          binary_quantize(e."embedding")::bit(4096) <~>
          binary_quantize(${vector}::vector)::bit(4096)
        LIMIT ${candidateLimit}
      )
      SELECT
        "file_id" as "fileId",
        "name",
        "blobId",
        "mimeType",
        "chunk",
        "content",
        "embedding" <=> ${vector}::vector as "distance"
      FROM "candidates"
      ORDER BY "distance" ASC
      LIMIT ${topK};
    `;
    return similarityChunks.filter(c => Number(c.distance) <= threshold);
  }

  async getBlobContent(
    workspaceId: string,
    blobId: string,
    chunk?: number
  ): Promise<string | undefined> {
    const blob = await this.db.aiWorkspaceBlobEmbedding.findMany({
      where: { workspaceId, blobId, chunk },
      select: { content: true },
      orderBy: { chunk: 'asc' },
    });
    return blob?.map(f => clearEmbeddingContent(f.content)).join('\n');
  }

  async getBlobChunkSizes(workspaceId: string, blobIds: string[]) {
    const sizes = await this.db.aiWorkspaceBlobEmbedding.groupBy({
      by: ['blobId'],
      _count: { chunk: true },
      where: { workspaceId, blobId: { in: blobIds } },
    });
    return sizes.reduce((acc, cur) => {
      if (cur._count.chunk) {
        acc.set(cur.blobId, cur._count.chunk);
      }
      return acc;
    }, new Map<string, number>());
  }

  @Transactional()
  async insertBlobEmbeddings(
    workspaceId: string,
    blobId: string,
    embeddings: Embedding[]
  ) {
    if (embeddings.length === 0) {
      this.logger.warn(
        `No embeddings provided for workspaceId: ${workspaceId}, blobId: ${blobId}. Skipping insertion.`
      );
      return;
    }

    const values = this.processEmbeddings(workspaceId, blobId, embeddings);
    await this.db.$executeRaw`
          INSERT INTO "ai_workspace_blob_embeddings"
          ("workspace_id", "blob_id", "chunk", "content", "embedding") VALUES ${values}
          ON CONFLICT (workspace_id, blob_id, chunk) DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding;
      `;
  }

  async matchBlobEmbedding(
    workspaceId: string,
    embedding: number[],
    topK: number,
    threshold: number
  ): Promise<BlobChunkSimilarity[]> {
    if (!(await this.allowEmbedding(workspaceId))) {
      return [];
    }
    const vector = toPgVector(embedding);
    const candidateLimit = embeddingSearchCandidateLimit(topK);

    const similarityChunks = await this.db.$queryRaw<
      Array<BlobChunkSimilarity>
    >`
      WITH "candidates" AS MATERIALIZED (
        SELECT e."blob_id", e."chunk", e."content", e."embedding"
        FROM "ai_workspace_blob_embeddings" e
        WHERE e.workspace_id = ${workspaceId}
          AND e."embedding" IS NOT NULL
        ORDER BY
          binary_quantize(e."embedding")::bit(4096) <~>
          binary_quantize(${vector}::vector)::bit(4096)
        LIMIT ${candidateLimit}
      )
      SELECT
        "blob_id" as "blobId",
        "chunk",
        "content",
        "embedding" <=> ${vector}::vector as "distance"
      FROM "candidates"
      ORDER BY "distance" ASC
      LIMIT ${topK};
    `;
    return similarityChunks.filter(c => Number(c.distance) <= threshold);
  }

  async removeBlob(workspaceId: string, blobId: string) {
    await this.db.$executeRaw`
      DELETE FROM "ai_workspace_blob_embeddings"
      WHERE workspace_id = ${workspaceId} AND blob_id = ${blobId};
    `;
    return true;
  }

  @Transactional()
  async removeFile(workspaceId: string, fileId: string) {
    await this.db.aiWorkspaceEmbeddingTask.deleteMany({
      where: { workspaceId, kind: 'file', resourceId: fileId },
    });
    // embeddings will be removed by foreign key constraint
    await this.db.aiWorkspaceFiles.deleteMany({
      where: {
        workspaceId,
        fileId,
      },
    });
    return true;
  }

  private allowEmbedding(workspaceId: string) {
    return this.models.workspace.allowEmbedding(workspaceId);
  }
}
