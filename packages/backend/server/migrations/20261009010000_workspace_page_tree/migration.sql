-- CreateTable
CREATE TABLE "workspace_page_tree_states" (
    "workspace_id" VARCHAR NOT NULL,
    "contract_version" VARCHAR(64),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "phase" VARCHAR(32) NOT NULL DEFAULT 'preflight',
    "plan_id" VARCHAR,
    "lease_token" VARCHAR,
    "lease_expires_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(64),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_page_tree_states_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "workspace_page_tree_plans" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "source_revision" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "plan" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_page_tree_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_page_tree_mappings" (
    "workspace_id" VARCHAR NOT NULL,
    "old_folder_id" VARCHAR NOT NULL,
    "node_id" VARCHAR NOT NULL,
    "document_id" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_page_tree_mappings_pkey" PRIMARY KEY ("workspace_id","old_folder_id")
);

-- CreateTable
CREATE TABLE "workspace_page_tree_operations" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "request_key" VARCHAR(256) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "contract_version" VARCHAR(64) NOT NULL,
    "before_revision" INTEGER NOT NULL,
    "after_revision" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_page_tree_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_page_tree_plans_id_workspace_id_key" ON "workspace_page_tree_plans"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_page_tree_plans_workspace_id_fingerprint_key" ON "workspace_page_tree_plans"("workspace_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_page_tree_mappings_workspace_id_node_id_key" ON "workspace_page_tree_mappings"("workspace_id", "node_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_page_tree_mappings_workspace_id_document_id_key" ON "workspace_page_tree_mappings"("workspace_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_page_tree_operations_workspace_id_actor_id_reques_key" ON "workspace_page_tree_operations"("workspace_id", "actor_id", "request_key");

-- AddForeignKey
ALTER TABLE "workspace_page_tree_states" ADD CONSTRAINT "workspace_page_tree_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_page_tree_states" ADD CONSTRAINT "workspace_page_tree_states_plan_id_workspace_id_fkey" FOREIGN KEY ("plan_id", "workspace_id") REFERENCES "workspace_page_tree_plans"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_page_tree_plans" ADD CONSTRAINT "workspace_page_tree_plans_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_page_tree_mappings" ADD CONSTRAINT "workspace_page_tree_mappings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_page_tree_operations" ADD CONSTRAINT "workspace_page_tree_operations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE workspace_page_tree_states ADD CONSTRAINT workspace_page_tree_phase CHECK
  (phase IN ('preflight', 'frozen', 'applying', 'validating', 'switched', 'needs_resolution', 'retryable_failed'));
ALTER TABLE workspace_page_tree_states ADD CONSTRAINT workspace_page_tree_counters CHECK
  (revision >= 0 AND checkpoint >= 0 AND attempts >= 0);
ALTER TABLE workspace_page_tree_states ADD CONSTRAINT workspace_page_tree_lease_pair CHECK
  ((lease_token IS NULL) = (lease_expires_at IS NULL));
ALTER TABLE workspace_page_tree_states ADD CONSTRAINT workspace_page_tree_cutover CHECK
  ((phase = 'switched') = (contract_version IS NOT NULL));
ALTER TABLE workspace_page_tree_operations ADD CONSTRAINT workspace_page_tree_operation_revision CHECK
  (before_revision >= 0 AND after_revision >= before_revision);

CREATE FUNCTION localmind_page_tree_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Page tree migration and operation evidence is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER workspace_page_tree_plan_immutable BEFORE UPDATE ON workspace_page_tree_plans
  FOR EACH ROW EXECUTE FUNCTION localmind_page_tree_immutable();
CREATE TRIGGER workspace_page_tree_mapping_immutable BEFORE UPDATE ON workspace_page_tree_mappings
  FOR EACH ROW EXECUTE FUNCTION localmind_page_tree_immutable();
CREATE TRIGGER workspace_page_tree_operation_immutable BEFORE UPDATE ON workspace_page_tree_operations
  FOR EACH ROW EXECUTE FUNCTION localmind_page_tree_immutable();
