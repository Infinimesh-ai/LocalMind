-- CreateTable
CREATE TABLE "ai_agent_runs" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "workflow" VARCHAR NOT NULL,
    "source_type" VARCHAR NOT NULL,
    "source_id" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL,
    "title" VARCHAR,
    "target_fingerprint" VARCHAR NOT NULL,
    "evidence_fingerprint" VARCHAR NOT NULL,
    "timeline_fingerprint" VARCHAR NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "failure_code" VARCHAR,
    "failure_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_agent_runs_status_check" CHECK ("status" IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled'))
);

-- CreateTable
CREATE TABLE "ai_agent_steps" (
    "id" VARCHAR NOT NULL,
    "run_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "step_key" VARCHAR NOT NULL,
    "step_type" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL,
    "title" VARCHAR,
    "order" INTEGER NOT NULL DEFAULT 0,
    "evidence_fingerprint" VARCHAR NOT NULL,
    "output_summary" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_agent_steps_status_check" CHECK ("status" IN ('pending', 'running', 'waiting_approval', 'completed', 'failed', 'skipped')),
    CONSTRAINT "ai_agent_steps_type_check" CHECK ("step_type" IN ('model', 'tool', 'approval', 'handoff', 'codex', 'mcp'))
);

-- CreateTable
CREATE TABLE "ai_agent_timeline_events" (
    "id" VARCHAR NOT NULL,
    "run_id" VARCHAR NOT NULL,
    "step_id" VARCHAR,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "event_type" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "event_fingerprint" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_timeline_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_agent_timeline_events_type_check" CHECK ("event_type" IN ('run_status', 'model_step', 'tool_step', 'approval_step', 'handoff_step', 'codex_step', 'mcp_step', 'step_output', 'step_error', 'run_cancellation'))
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_runs_workspace_id_source_type_source_id_key" ON "ai_agent_runs"("workspace_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "ai_agent_runs_workspace_id_created_at_idx" ON "ai_agent_runs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_runs_actor_id_created_at_idx" ON "ai_agent_runs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_runs_status_created_at_idx" ON "ai_agent_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_runs_workflow_created_at_idx" ON "ai_agent_runs"("workflow", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_steps_run_id_step_key_key" ON "ai_agent_steps"("run_id", "step_key");

-- CreateIndex
CREATE INDEX "ai_agent_steps_workspace_id_created_at_idx" ON "ai_agent_steps"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_steps_actor_id_created_at_idx" ON "ai_agent_steps"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_steps_status_created_at_idx" ON "ai_agent_steps"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_steps_step_type_created_at_idx" ON "ai_agent_steps"("step_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_timeline_events_run_id_ordinal_key" ON "ai_agent_timeline_events"("run_id", "ordinal");

-- CreateIndex
CREATE INDEX "ai_agent_timeline_events_run_id_created_at_idx" ON "ai_agent_timeline_events"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_timeline_events_step_id_created_at_idx" ON "ai_agent_timeline_events"("step_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_timeline_events_workspace_id_created_at_idx" ON "ai_agent_timeline_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_timeline_events_actor_id_created_at_idx" ON "ai_agent_timeline_events"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_agent_timeline_events_event_type_created_at_idx" ON "ai_agent_timeline_events"("event_type", "created_at");

-- AddForeignKey
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_steps" ADD CONSTRAINT "ai_agent_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_steps" ADD CONSTRAINT "ai_agent_steps_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_steps" ADD CONSTRAINT "ai_agent_steps_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_timeline_events" ADD CONSTRAINT "ai_agent_timeline_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_timeline_events" ADD CONSTRAINT "ai_agent_timeline_events_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "ai_agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_timeline_events" ADD CONSTRAINT "ai_agent_timeline_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_timeline_events" ADD CONSTRAINT "ai_agent_timeline_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
