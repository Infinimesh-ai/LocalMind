-- The 1024-dimensional vectors were produced under a different storage and
-- model contract. They cannot be compared safely with new 4096-dimensional
-- vectors. Preserve the derived chunk text, mark its vectors pending, and let
-- the bounded runtime backfill rebuild 4096-dimensional embeddings without
-- requiring users to re-upload source files. Durable memory text is retained
-- with its embedding cleared for the same backfill path.
DO $$
DECLARE
  has_hnsw BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION
      'LocalMind 4096-dimensional embeddings require the pgvector extension';
  END IF;

  IF to_regprocedure('binary_quantize(vector)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_opclass WHERE opcname = 'bit_hamming_ops'
  ) THEN
    RAISE EXCEPTION
      'LocalMind 4096-dimensional embedding search requires pgvector binary quantization support';
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_am WHERE amname = 'hnsw') INTO has_hnsw;

  DROP INDEX IF EXISTS "ai_context_embeddings_idx";
  DROP INDEX IF EXISTS "ai_workspace_embeddings_idx";
  DROP INDEX IF EXISTS "ai_workspace_file_embeddings_idx";
  DROP INDEX IF EXISTS "ai_workspace_blob_embeddings_idx";
  DROP INDEX IF EXISTS "ai_context_memories_embedding_hnsw_idx";

  IF to_regclass('public.ai_context_embeddings') IS NOT NULL THEN
    ALTER TABLE "ai_context_embeddings"
      ALTER COLUMN "embedding" DROP NOT NULL,
      ALTER COLUMN "embedding" TYPE vector(4096)
      USING NULL::vector(4096);

    IF has_hnsw THEN
      CREATE INDEX "ai_context_embeddings_idx"
        ON "ai_context_embeddings" USING hnsw
        ((binary_quantize("embedding")::bit(4096)) bit_hamming_ops)
        WHERE "embedding" IS NOT NULL;
    END IF;
  END IF;

  IF to_regclass('public.ai_workspace_embeddings') IS NOT NULL THEN
    ALTER TABLE "ai_workspace_embeddings"
      ALTER COLUMN "embedding" DROP NOT NULL,
      ALTER COLUMN "embedding" TYPE vector(4096)
      USING NULL::vector(4096);

    IF has_hnsw THEN
      CREATE INDEX "ai_workspace_embeddings_idx"
        ON "ai_workspace_embeddings" USING hnsw
        ((binary_quantize("embedding")::bit(4096)) bit_hamming_ops)
        WHERE "embedding" IS NOT NULL;
    END IF;
  END IF;

  IF to_regclass('public.ai_workspace_file_embeddings') IS NOT NULL THEN
    ALTER TABLE "ai_workspace_file_embeddings"
      ALTER COLUMN "embedding" DROP NOT NULL,
      ALTER COLUMN "embedding" TYPE vector(4096)
      USING NULL::vector(4096);

    IF has_hnsw THEN
      CREATE INDEX "ai_workspace_file_embeddings_idx"
        ON "ai_workspace_file_embeddings" USING hnsw
        ((binary_quantize("embedding")::bit(4096)) bit_hamming_ops)
        WHERE "embedding" IS NOT NULL;
    END IF;
  END IF;

  IF to_regclass('public.ai_workspace_blob_embeddings') IS NOT NULL THEN
    ALTER TABLE "ai_workspace_blob_embeddings"
      ALTER COLUMN "embedding" DROP NOT NULL,
      ALTER COLUMN "embedding" TYPE vector(4096)
      USING NULL::vector(4096);

    IF has_hnsw THEN
      CREATE INDEX "ai_workspace_blob_embeddings_idx"
        ON "ai_workspace_blob_embeddings" USING hnsw
        ((binary_quantize("embedding")::bit(4096)) bit_hamming_ops)
        WHERE "embedding" IS NOT NULL;
    END IF;
  END IF;

  IF to_regclass('public.ai_context_memories') IS NOT NULL THEN
    UPDATE "ai_context_memories" SET "embedding" = NULL
    WHERE "embedding" IS NOT NULL;
    ALTER TABLE "ai_context_memories"
      ALTER COLUMN "embedding" TYPE vector(4096)
      USING NULL::vector(4096);

    IF has_hnsw THEN
      CREATE INDEX "ai_context_memories_embedding_hnsw_idx"
        ON "ai_context_memories" USING hnsw
        ((binary_quantize("embedding")::bit(4096)) bit_hamming_ops)
        WHERE "embedding" IS NOT NULL;
    END IF;
  END IF;
END $$;
