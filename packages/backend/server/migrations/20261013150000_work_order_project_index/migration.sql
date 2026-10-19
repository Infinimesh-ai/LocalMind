-- Project reports read participant-visible work orders by their source project.
CREATE INDEX "work_orders_source_project_id_snapshot_updated_at_idx"
  ON "work_orders"("source_project_id_snapshot", "updated_at");
