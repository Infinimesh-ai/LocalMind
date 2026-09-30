ALTER TABLE work_orders
  ADD COLUMN template_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_template_version_check CHECK (template_version > 0);

CREATE TABLE work_order_delivery_drafts (
  work_order_id VARCHAR PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
  owner_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT work_order_delivery_drafts_version_check CHECK (version > 0),
  CONSTRAINT work_order_delivery_drafts_items_check CHECK (jsonb_typeof(items) = 'array')
);

CREATE INDEX work_order_delivery_drafts_owner_updated_idx
  ON work_order_delivery_drafts(owner_id, updated_at DESC);

CREATE FUNCTION check_work_order_delivery_draft_owner()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_orders
    WHERE id = NEW.work_order_id AND recipient_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'Work-order delivery draft owner must be its recipient';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_order_delivery_draft_owner_guard
  BEFORE INSERT OR UPDATE OF work_order_id, owner_id
  ON work_order_delivery_drafts
  FOR EACH ROW EXECUTE FUNCTION check_work_order_delivery_draft_owner();
