CREATE TABLE "ai_context_plan_traces" (
    "id" VARCHAR NOT NULL,
    "session_id" VARCHAR NOT NULL,
    "source_turn_id" VARCHAR,
    "strategy_version" VARCHAR NOT NULL,
    "strategy_fingerprint" VARCHAR NOT NULL,
    "input_message_count" INTEGER NOT NULL,
    "retained_message_count" INTEGER NOT NULL,
    "omitted_message_count" INTEGER NOT NULL,
    "candidate_memory_count" INTEGER NOT NULL,
    "selected_memory_count" INTEGER NOT NULL,
    "summary_injected" BOOLEAN NOT NULL,
    "planning_passes" INTEGER NOT NULL,
    "context_char_budget" INTEGER NOT NULL,
    "context_char_count" INTEGER NOT NULL,
    "source_fingerprint" VARCHAR NOT NULL,
    "output_fingerprint" VARCHAR NOT NULL,
    "candidate_memory_ids" JSONB NOT NULL DEFAULT '[]',
    "selected_memories" JSONB NOT NULL DEFAULT '[]',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_context_plan_traces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_plan_traces_count_check"
      CHECK (
        "input_message_count" >= 0 AND
        "retained_message_count" >= 0 AND
        "omitted_message_count" >= 0 AND
        "retained_message_count" + "omitted_message_count" = "input_message_count" AND
        "candidate_memory_count" >= 0 AND
        "selected_memory_count" >= 0 AND
        "selected_memory_count" <= "candidate_memory_count" AND
        "planning_passes" > 0
      ),
    CONSTRAINT "ai_context_plan_traces_budget_check"
      CHECK (
        "context_char_budget" > 0 AND
        "context_char_count" >= 0 AND
        "context_char_count" <= "context_char_budget"
      ),
    CONSTRAINT "ai_context_plan_traces_json_shape_check"
      CHECK (
        jsonb_typeof("candidate_memory_ids") = 'array' AND
        jsonb_typeof("selected_memories") = 'array' AND
        jsonb_array_length("selected_memories") = "selected_memory_count" AND
        jsonb_typeof("scope") = 'object'
      ),
    CONSTRAINT "ai_context_plan_traces_identity_check"
      CHECK (
        length(btrim("strategy_version")) > 0 AND
        length(btrim("strategy_fingerprint")) > 0 AND
        length(btrim("source_fingerprint")) > 0 AND
        length(btrim("output_fingerprint")) > 0 AND
        ("source_turn_id" IS NULL OR length(btrim("source_turn_id")) > 0)
      )
);

CREATE INDEX "ai_context_plan_traces_session_id_created_at_idx"
  ON "ai_context_plan_traces"("session_id", "created_at");
CREATE INDEX "ai_context_plan_traces_strategy_version_created_at_idx"
  ON "ai_context_plan_traces"("strategy_version", "created_at");

ALTER TABLE "ai_context_plan_traces"
  ADD CONSTRAINT "ai_context_plan_traces_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
