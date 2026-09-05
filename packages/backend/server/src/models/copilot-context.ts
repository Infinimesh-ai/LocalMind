import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CopilotSessionNotFound } from '../base';
import { BaseModel } from './base';
import {
  clearEmbeddingContent,
  ContextBlob,
  ContextConfigSchema,
  ContextDoc,
  ContextEmbedStatus,
  ContextFile,
  CopilotContext,
  DocChunkSimilarity,
  Embedding,
  EMBEDDING_DIMENSIONS,
  embeddingSearchCandidateLimit,
  FileChunkSimilarity,
  MinimalContextConfigSchema,
  PendingEmbeddingBackfillChunk,
  toPgVector,
} from './common/copilot';

type UpdateCopilotContextInput = Pick<CopilotContext, 'config'>;

/**
 * Copilot Job Model
 */
@Injectable()
export class CopilotContextModel extends BaseModel {
  // ================ contexts ================

  async create(sessionId: string) {
    const session = await this.db.aiSession.findFirst({
      where: { id: sessionId },
      select: { workspaceId: true },
    });
    if (!session) {
      throw new CopilotSessionNotFound();
    }

    const row = await this.db.aiContext.create({
      data: {
        sessionId,
        config: {
          workspaceId: session.workspaceId,
          blobs: [],
          docs: [],
          files: [],
          categories: [],
        },
      },
    });
    return row;
  }

  async get(id: string) {
    const row = await this.db.aiContext.findFirst({
      where: { id },
    });
    return row;
  }

  async getAccessInfo(id: string) {
    return await this.db.aiContext.findFirst({
      where: { id },
      select: {
        id: true,
        sessionId: true,
        session: {
          select: {
            userId: true,
            workspaceId: true,
          },
        },
      },
    });
  }

  async getConfig(id: string) {
    const row = await this.get(id);
    if (row) {
      const config = ContextConfigSchema.safeParse(row.config);
      if (config.success) {
        return config.data;
      }
      const minimalConfig = MinimalContextConfigSchema.safeParse(row.config);
      if (minimalConfig.success) {
        // fulfill the missing fields
        return {
          blobs: [],
          docs: [],
          files: [],
          categories: [],
          ...minimalConfig.data,
        };
      }
    }
    return null;
  }

  async getBySessionId(sessionId: string) {
    const row = await this.db.aiContext.findFirst({
      where: { sessionId },
    });
    return row;
  }

  async listSessionDocIds(sessionId: string) {
    const row = await this.db.aiContext.findFirst({
      where: { sessionId },
      select: { config: true },
    });
    if (!row) return [];

    const config = ContextConfigSchema.safeParse(row.config);
    if (!config.success) return [];
    return Array.from(
      new Set([
        ...config.data.docs.map(doc => doc.id),
        ...config.data.categories.flatMap(category =>
          category.docs.map(doc => doc.id)
        ),
      ])
    );
  }

  async mergeBlobStatus(
    workspaceId: string,
    blobs: ContextBlob[]
  ): Promise<ContextBlob[]> {
    const canEmbedding = await this.checkEmbeddingAvailable();
    const blobIds = Array.from(new Set(blobs.map(blob => blob.id)));
    const [finishedBlobs, pendingBlobs] = canEmbedding
      ? await Promise.all([
          this.listWorkspaceBlobEmbedding(workspaceId, blobIds),
          this.listWorkspaceBlobPendingEmbedding(workspaceId, blobIds),
        ])
      : [[], []];
    const finishedBlobSet = new Set(finishedBlobs);
    const pendingBlobSet = new Set(pendingBlobs);

    for (const blob of blobs) {
      if (
        pendingBlobSet.has(blob.id) &&
        blob.status !== ContextEmbedStatus.failed
      ) {
        blob.status = ContextEmbedStatus.processing;
        continue;
      }
      const status = finishedBlobSet.has(blob.id)
        ? ContextEmbedStatus.finished
        : undefined;
      // NOTE: when the blob has not been synchronized to the server or is in the embedding queue
      // the status will be empty, fallback to processing if no status is provided
      blob.status = status || blob.status || ContextEmbedStatus.processing;
    }

    return blobs;
  }

  async mergeDocStatus(workspaceId: string, docs: ContextDoc[]) {
    const canEmbedding = await this.checkEmbeddingAvailable();
    const docIds = Array.from(new Set(docs.map(doc => doc.id)));
    const [finishedDoc, pendingDoc] = canEmbedding
      ? await Promise.all([
          this.listWorkspaceDocEmbedding(workspaceId, docIds),
          this.listWorkspaceDocPendingEmbedding(workspaceId, docIds),
        ])
      : [[], []];
    const finishedDocSet = new Set(finishedDoc);
    const pendingDocSet = new Set(pendingDoc);

    for (const doc of docs) {
      if (
        pendingDocSet.has(doc.id) &&
        doc.status !== ContextEmbedStatus.failed
      ) {
        doc.status = ContextEmbedStatus.processing;
        continue;
      }
      const status = finishedDocSet.has(doc.id)
        ? ContextEmbedStatus.finished
        : undefined;
      // NOTE: when the document has not been synchronized to the server or is in the embedding queue
      // the status will be empty, fallback to processing if no status is provided
      doc.status = status || doc.status || ContextEmbedStatus.processing;
    }

    return docs;
  }

  async mergeFileStatus(contextId: string, files: ContextFile[]) {
    if (!files.length) return files;

    const rows = await this.db.$queryRaw<
      Array<{ fileId: string; total: number; embedded: number }>
    >`
      SELECT
        "file_id" AS "fileId",
        COUNT(*)::int AS "total",
        COUNT("embedding")::int AS "embedded"
      FROM "ai_context_embeddings"
      WHERE "context_id" = ${contextId}
        AND "file_id" IN (${Prisma.join(files.map(file => file.id))})
      GROUP BY "file_id"
    `;
    const statusByFileId = new Map(rows.map(row => [row.fileId, row]));

    for (const file of files) {
      const row = statusByFileId.get(file.id);
      if (!row) continue;
      if (file.status === ContextEmbedStatus.failed) continue;
      file.status =
        row.total === row.embedded
          ? ContextEmbedStatus.finished
          : ContextEmbedStatus.processing;
      file.error = null;
    }

    return files;
  }

  async update(contextId: string, data: UpdateCopilotContextInput) {
    const ret = await this.db.aiContext.updateMany({
      where: {
        id: contextId,
      },
      data: {
        config: data.config || undefined,
      },
    });
    return ret.count > 0;
  }

  // ================ embeddings ================

  async checkEmbeddingAvailable(): Promise<boolean> {
    const [{ count }] = await this.db.$queryRaw<
      { count: number }[]
    >`SELECT count(1) FROM pg_tables WHERE tablename in ('ai_context_embeddings', 'ai_workspace_embeddings')`;
    return Number(count) === 2;
  }

  async listPendingEmbeddingBackfill(
    limit = 64
  ): Promise<PendingEmbeddingBackfillChunk[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), 128);
    return await this.db.$queryRaw<PendingEmbeddingBackfillChunk[]>`
      SELECT
        "kind",
        "workspaceId",
        "contextId",
        "userId",
        "entityId",
        "chunk",
        "content"
      FROM (
        SELECT
          pending.*,
          ROW_NUMBER() OVER (
            PARTITION BY
              "kind",
              "workspaceId",
              "contextId",
              "entityId"
            ORDER BY "chunk"
          ) AS "entityChunkOrdinal"
        FROM (
          SELECT
            'context_file'::text AS "kind",
            s."workspace_id" AS "workspaceId",
            e."context_id" AS "contextId",
            s."user_id" AS "userId",
            e."file_id" AS "entityId",
            e."chunk",
            e."content"
          FROM "ai_context_embeddings" e
          JOIN "ai_contexts" c ON c."id" = e."context_id"
          JOIN "ai_sessions_metadata" s ON s."id" = c."session_id"
          WHERE e."embedding" IS NULL

          UNION ALL

          SELECT
            'memory'::text AS "kind",
            m."workspace_id" AS "workspaceId",
            NULL::text AS "contextId",
            m."owner_user_id" AS "userId",
            m."id" AS "entityId",
            0 AS "chunk",
            m."content"
          FROM "ai_context_memories" m
          WHERE m."embedding" IS NULL
            AND m."workspace_id" IS NOT NULL
            AND m."status" IN ('active', 'disabled')

          UNION ALL

          SELECT
            'workspace_document'::text AS "kind",
            e."workspace_id" AS "workspaceId",
            NULL::text AS "contextId",
            NULL::text AS "userId",
            e."doc_id" AS "entityId",
            e."chunk",
            e."content"
          FROM "ai_workspace_embeddings" e
          JOIN "workspaces" w ON w."id" = e."workspace_id"
          WHERE e."embedding" IS NULL
            AND w."enable_doc_embedding" = TRUE

          UNION ALL

          SELECT
            'workspace_file'::text AS "kind",
            e."workspace_id" AS "workspaceId",
            NULL::text AS "contextId",
            NULL::text AS "userId",
            e."file_id" AS "entityId",
            e."chunk",
            e."content"
          FROM "ai_workspace_file_embeddings" e
          JOIN "workspaces" w ON w."id" = e."workspace_id"
          WHERE e."embedding" IS NULL
            AND w."enable_doc_embedding" = TRUE

          UNION ALL

          SELECT
            'workspace_blob'::text AS "kind",
            e."workspace_id" AS "workspaceId",
            NULL::text AS "contextId",
            NULL::text AS "userId",
            e."blob_id" AS "entityId",
            e."chunk",
            e."content"
          FROM "ai_workspace_blob_embeddings" e
          JOIN "workspaces" w ON w."id" = e."workspace_id"
          WHERE e."embedding" IS NULL
            AND w."enable_doc_embedding" = TRUE
        ) pending
      ) bounded
      WHERE "entityChunkOrdinal" <= 16
      ORDER BY "kind", "workspaceId", "entityId", "chunk"
      LIMIT ${boundedLimit}
    `;
  }

  async listWorkspaceBlobEmbedding(
    workspaceId: string,
    blobIds?: string[]
  ): Promise<string[]> {
    if (blobIds && !blobIds.length) return [];
    const rows = await this.db.$queryRaw<Array<{ blobId: string }>>`
      SELECT "blob_id" AS "blobId"
      FROM "ai_workspace_blob_embeddings"
      WHERE "workspace_id" = ${workspaceId}
        ${blobIds?.length ? Prisma.sql`AND "blob_id" IN (${Prisma.join(blobIds)})` : Prisma.empty}
      GROUP BY "blob_id"
      HAVING BOOL_AND("embedding" IS NOT NULL)
    `;
    return rows.map(row => row.blobId);
  }

  async listWorkspaceBlobPendingEmbedding(
    workspaceId: string,
    blobIds?: string[]
  ): Promise<string[]> {
    if (blobIds && !blobIds.length) return [];
    const rows = await this.db.$queryRaw<Array<{ blobId: string }>>`
      SELECT DISTINCT "blob_id" AS "blobId"
      FROM "ai_workspace_blob_embeddings"
      WHERE "workspace_id" = ${workspaceId}
        AND "embedding" IS NULL
        ${blobIds?.length ? Prisma.sql`AND "blob_id" IN (${Prisma.join(blobIds)})` : Prisma.empty}
    `;
    return rows.map(row => row.blobId);
  }

  async listWorkspaceDocEmbedding(workspaceId: string, docIds?: string[]) {
    if (docIds && !docIds.length) return [];
    const rows = await this.db.$queryRaw<Array<{ docId: string }>>`
      SELECT "doc_id" AS "docId"
      FROM "ai_workspace_embeddings"
      WHERE "workspace_id" = ${workspaceId}
        ${docIds?.length ? Prisma.sql`AND "doc_id" IN (${Prisma.join(docIds)})` : Prisma.empty}
      GROUP BY "doc_id"
      HAVING BOOL_AND("embedding" IS NOT NULL)
    `;
    return rows.map(row => row.docId);
  }

  async listWorkspaceDocPendingEmbedding(
    workspaceId: string,
    docIds?: string[]
  ) {
    if (docIds && !docIds.length) return [];
    const rows = await this.db.$queryRaw<Array<{ docId: string }>>`
      SELECT DISTINCT "doc_id" AS "docId"
      FROM "ai_workspace_embeddings"
      WHERE "workspace_id" = ${workspaceId}
        AND "embedding" IS NULL
        ${docIds?.length ? Prisma.sql`AND "doc_id" IN (${Prisma.join(docIds)})` : Prisma.empty}
    `;
    return rows.map(row => row.docId);
  }

  private processEmbeddings(
    contextOrWorkspaceId: string,
    fileOrDocId: string,
    embeddings: Embedding[],
    withId = true
  ) {
    const groups = embeddings.map(e =>
      [
        withId ? randomUUID() : undefined,
        contextOrWorkspaceId,
        fileOrDocId,
        e.index,
        e.content,
        Prisma.raw(`'${toPgVector(e.embedding)}'`),
        new Date(),
      ].filter(v => v !== undefined)
    );
    return Prisma.join(groups.map(row => Prisma.sql`(${Prisma.join(row)})`));
  }

  async getFileContent(
    contextId: string,
    fileId: string,
    chunk?: number
  ): Promise<string | undefined> {
    const file = await this.db.aiContextEmbedding.findMany({
      where: { contextId, fileId, chunk },
      select: { content: true },
      orderBy: { chunk: 'asc' },
    });
    return file?.map(f => clearEmbeddingContent(f.content)).join('\n');
  }

  async insertFileEmbedding(
    contextId: string,
    fileId: string,
    embeddings: Embedding[]
  ) {
    if (embeddings.length === 0) {
      this.logger.warn(
        `No embeddings provided for contextId: ${contextId}, fileId: ${fileId}. Skipping insertion.`
      );
      return;
    }

    const values = this.processEmbeddings(contextId, fileId, embeddings);

    await this.db.$executeRaw`
    INSERT INTO "ai_context_embeddings"
    ("id", "context_id", "file_id", "chunk", "content", "embedding", "updated_at") VALUES ${values}
    ON CONFLICT (context_id, file_id, chunk) DO UPDATE SET
    content = EXCLUDED.content, embedding = EXCLUDED.embedding, updated_at = excluded.updated_at;
  `;
  }

  async deleteFileEmbedding(contextId: string, fileId: string) {
    await this.db.aiContextEmbedding.deleteMany({
      where: { contextId, fileId },
    });
  }

  async matchFileEmbedding(
    embedding: number[],
    contextId: string,
    topK: number,
    threshold: number
  ): Promise<Omit<FileChunkSimilarity, 'blobId' | 'name' | 'mimeType'>[]> {
    const vector = toPgVector(embedding);
    const candidateLimit = embeddingSearchCandidateLimit(topK);
    const similarityChunks = await this.db.$queryRaw<
      Array<Omit<FileChunkSimilarity, 'blobId' | 'name' | 'mimeType'>>
    >`
      WITH "candidates" AS MATERIALIZED (
        SELECT "file_id", "chunk", "content", "embedding"
        FROM "ai_context_embeddings"
        WHERE context_id = ${contextId}
          AND "embedding" IS NOT NULL
        ORDER BY
          binary_quantize("embedding")::bit(4096) <~>
          binary_quantize(${vector}::vector)::bit(4096)
        LIMIT ${candidateLimit}
      )
      SELECT
        "file_id" as "fileId",
        "chunk",
        "content",
        "embedding" <=> ${vector}::vector as "distance"
      FROM "candidates"
      ORDER BY "distance" ASC
      LIMIT ${topK};
    `;
    return similarityChunks.filter(c => Number(c.distance) <= threshold);
  }

  async getWorkspaceContent(
    workspaceId: string,
    docId: string,
    chunk?: number
  ): Promise<string | undefined> {
    const file = await this.db.aiWorkspaceEmbedding.findMany({
      where: { workspaceId, docId, chunk },
      select: { content: true },
      orderBy: { chunk: 'asc' },
    });
    return file?.map(f => clearEmbeddingContent(f.content)).join('\n');
  }

  async insertWorkspaceEmbedding(
    workspaceId: string,
    docId: string,
    embeddings: Embedding[]
  ) {
    if (embeddings.length === 0) {
      this.logger.warn(
        `No embeddings provided for workspaceId: ${workspaceId}, docId: ${docId}. Skipping insertion.`
      );
      return;
    }

    const values = this.processEmbeddings(
      workspaceId,
      docId,
      embeddings,
      false
    );
    await this.db.$executeRaw`
      INSERT INTO "ai_workspace_embeddings"
        ("workspace_id", "doc_id", "chunk", "content", "embedding", "updated_at")
      VALUES ${values}
      ON CONFLICT (workspace_id, doc_id, chunk)
      DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        updated_at = excluded.updated_at;
    `;
  }

  async fulfillEmptyEmbedding(workspaceId: string, docId: string) {
    const emptyEmbedding = {
      index: 0,
      content: '',
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
    };
    await this.models.copilotContext.insertWorkspaceEmbedding(
      workspaceId,
      docId,
      [emptyEmbedding]
    );
  }

  async deleteWorkspaceEmbedding(workspaceId: string, docId: string) {
    await this.purgeWorkspaceEmbedding(workspaceId, docId);
    await this.fulfillEmptyEmbedding(workspaceId, docId);
  }

  async purgeWorkspaceEmbedding(workspaceId: string, docId: string) {
    await this.db.aiWorkspaceEmbedding.deleteMany({
      where: { workspaceId, docId },
    });
  }

  async matchWorkspaceEmbedding(
    embedding: number[],
    workspaceId: string,
    topK: number,
    threshold: number,
    readablePredicate: Prisma.Sql,
    matchDocIds?: string[],
    restrictDocIds?: string[]
  ): Promise<DocChunkSimilarity[]> {
    if (restrictDocIds?.length === 0) return [];
    const vector = toPgVector(embedding);
    const candidateLimit = embeddingSearchCandidateLimit(topK);
    const similarityChunks = await this.db.$queryRaw<Array<DocChunkSimilarity>>`
      WITH "candidates" AS MATERIALIZED (
        SELECT w."doc_id", w."chunk", w."content", w."embedding"
        FROM "ai_workspace_embeddings" w
        LEFT JOIN "ai_workspace_ignored_docs" i
          ON i."workspace_id" = w."workspace_id"
            AND i."doc_id" = w."doc_id"
            ${matchDocIds?.length ? Prisma.sql`AND w."doc_id" NOT IN (${Prisma.join(matchDocIds)})` : Prisma.empty}
        WHERE
          w."workspace_id" = ${workspaceId}
          ${restrictDocIds?.length ? Prisma.sql`AND w."doc_id" IN (${Prisma.join(restrictDocIds)})` : Prisma.empty}
          AND w."embedding" IS NOT NULL
          AND i."doc_id" IS NULL
          AND ${readablePredicate}
        ORDER BY
          binary_quantize(w."embedding")::bit(4096) <~>
          binary_quantize(${vector}::vector)::bit(4096)
        LIMIT ${candidateLimit}
      ),
      "ranked" AS (
        SELECT
          "doc_id" as "docId",
          "chunk",
          "content",
          "embedding" <=> ${vector}::vector as "distance"
        FROM "candidates"
      )
      SELECT "docId", "chunk", "content", "distance"
      FROM "ranked"
      WHERE "distance" <= ${threshold}
      ORDER BY "distance" ASC
      LIMIT ${topK};
    `;

    return similarityChunks;
  }
}
