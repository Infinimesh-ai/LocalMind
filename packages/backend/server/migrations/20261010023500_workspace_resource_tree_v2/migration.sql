-- CreateTable
CREATE TABLE "workspace_page_tree_typed_mappings" (
    "workspace_id" VARCHAR NOT NULL,
    "plan_id" VARCHAR NOT NULL,
    "source_kind" VARCHAR(16) NOT NULL,
    "source_id" VARCHAR NOT NULL,
    "node_id" VARCHAR NOT NULL,
    "target_kind" VARCHAR(16) NOT NULL,
    "target_id" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_page_tree_typed_mappings_pkey" PRIMARY KEY ("plan_id","source_kind","source_id")
);

-- CreateTable
CREATE TABLE "workspace_page_tree_conversions" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "operation_id" VARCHAR NOT NULL,
    "node_id" VARCHAR NOT NULL,
    "source_kind" VARCHAR(16) NOT NULL,
    "source_id" VARCHAR NOT NULL,
    "target_kind" VARCHAR(16) NOT NULL,
    "target_id" VARCHAR NOT NULL,
    "source_version" INTEGER NOT NULL,
    "authorization_revision" VARCHAR(64) NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_page_tree_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_page_tree_typed_mappings_plan_id_node_id_key" ON "workspace_page_tree_typed_mappings"("plan_id", "node_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_page_tree_typed_mappings_plan_id_target_kind_targ_key" ON "workspace_page_tree_typed_mappings"("plan_id", "target_kind", "target_id");

-- CreateIndex
CREATE INDEX "workspace_page_tree_conversions_workspace_id_source_kind_so_idx" ON "workspace_page_tree_conversions"("workspace_id", "source_kind", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_page_tree_conversions_operation_id_key" ON "workspace_page_tree_conversions"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_page_tree_operations_id_workspace_id_key" ON "workspace_page_tree_operations"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "workspace_page_tree_typed_mappings" ADD CONSTRAINT "workspace_page_tree_typed_mappings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_page_tree_typed_mappings" ADD CONSTRAINT "workspace_page_tree_typed_mappings_plan_id_workspace_id_fkey" FOREIGN KEY ("plan_id", "workspace_id") REFERENCES "workspace_page_tree_plans"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_page_tree_conversions" ADD CONSTRAINT "workspace_page_tree_conversions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_page_tree_conversions" ADD CONSTRAINT "workspace_page_tree_conversions_operation_id_workspace_id_fkey" FOREIGN KEY ("operation_id", "workspace_id") REFERENCES "workspace_page_tree_operations"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- An upgrade retains its source contract while phase/lease fences writes.
ALTER TABLE workspace_page_tree_states DROP CONSTRAINT workspace_page_tree_cutover;
ALTER TABLE workspace_page_tree_states ADD CONSTRAINT workspace_page_tree_cutover CHECK
  ((phase <> 'switched' OR contract_version IS NOT NULL) AND
   (contract_version IS NULL OR contract_version IN ('localmind-page-tree/v1', 'localmind-page-tree/v2')));
ALTER TABLE workspace_page_tree_typed_mappings ADD CONSTRAINT workspace_page_tree_mapping_kinds CHECK
  (source_kind IN ('doc', 'folder', 'office', 'file') AND target_kind IN ('doc', 'folder', 'office', 'file'));
ALTER TABLE workspace_page_tree_conversions ADD CONSTRAINT workspace_page_tree_conversion_kinds CHECK
  (source_kind = 'folder' AND target_kind = 'doc' AND source_version > 0);
CREATE TRIGGER workspace_page_tree_typed_mapping_immutable BEFORE UPDATE ON workspace_page_tree_typed_mappings
  FOR EACH ROW EXECUTE FUNCTION localmind_page_tree_immutable();
CREATE TRIGGER workspace_page_tree_conversion_immutable BEFORE UPDATE ON workspace_page_tree_conversions
  FOR EACH ROW EXECUTE FUNCTION localmind_page_tree_immutable();
