CREATE TABLE "localmind_audit_envelopes" (
  "id" VARCHAR NOT NULL,
  "audit_event_id" VARCHAR NOT NULL,
  "event_id" VARCHAR,
  "action" VARCHAR NOT NULL,
  "outcome" VARCHAR NOT NULL,
  "actor_type" VARCHAR,
  "actor_id_hash" VARCHAR,
  "workspace_id" VARCHAR,
  "project_id" VARCHAR,
  "resource_type" VARCHAR,
  "resource_id" VARCHAR,
  "authorization_fingerprint" VARCHAR,
  "fingerprint" VARCHAR NOT NULL,
  "metadata" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "localmind_audit_envelopes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "localmind_audit_envelopes_audit_event_id_key" ON "localmind_audit_envelopes"("audit_event_id");
CREATE INDEX "localmind_audit_envelopes_occurred_at_idx" ON "localmind_audit_envelopes"("occurred_at");
CREATE INDEX "localmind_audit_envelopes_workspace_id_occurred_at_idx" ON "localmind_audit_envelopes"("workspace_id", "occurred_at");
CREATE INDEX "localmind_audit_envelopes_project_id_occurred_at_idx" ON "localmind_audit_envelopes"("project_id", "occurred_at");
CREATE INDEX "localmind_audit_envelopes_event_id_idx" ON "localmind_audit_envelopes"("event_id");
CREATE OR REPLACE FUNCTION localmind_audit_envelope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'localmind audit envelopes are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER localmind_audit_envelope_immutable_trigger BEFORE UPDATE OR DELETE ON "localmind_audit_envelopes" FOR EACH ROW EXECUTE FUNCTION localmind_audit_envelope_immutable();
