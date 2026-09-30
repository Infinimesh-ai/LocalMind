CREATE INDEX "work_order_dispatch_graph_lookup_idx"
  ON "work_order_dispatches"("sender_id", "status", "expires_at", "updated_at" DESC);

CREATE INDEX "work_order_adoption_delivery_idx"
  ON "work_order_adoption_items"("delivery_revision_id");
