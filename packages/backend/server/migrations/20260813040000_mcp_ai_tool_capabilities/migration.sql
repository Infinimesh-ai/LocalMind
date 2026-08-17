-- The public MCP surface has converged to three AI tools. Legacy credentials
-- are revoked rather than silently gaining authority under the new model.
UPDATE "mcp_credentials"
SET "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP);

ALTER TABLE "mcp_credentials"
  DROP CONSTRAINT "mcp_credentials_capabilities_check";

ALTER TABLE "mcp_credentials"
  ALTER COLUMN "capabilities"
  SET DEFAULT ARRAY['get_localmind_task']::TEXT[];

UPDATE "mcp_credentials"
SET "capabilities" = CASE
  WHEN "access_mode" = 'READ_WRITE' THEN ARRAY[
    'delegate_to_localmind',
    'get_localmind_task',
    'control_localmind_task'
  ]::TEXT[]
  ELSE ARRAY['get_localmind_task']::TEXT[]
END;

ALTER TABLE "mcp_credentials"
  ADD CONSTRAINT "mcp_credentials_capabilities_check"
  CHECK (
    cardinality("capabilities") > 0
    AND "capabilities" <@ ARRAY[
      'delegate_to_localmind',
      'get_localmind_task',
      'control_localmind_task'
    ]::TEXT[]
    AND (
      (
        "access_mode" = 'READ_WRITE'
        AND "capabilities" && ARRAY[
          'delegate_to_localmind',
          'control_localmind_task'
        ]::TEXT[]
      )
      OR (
        "access_mode" = 'READ_ONLY'
        AND NOT (
          "capabilities" && ARRAY[
            'delegate_to_localmind',
            'control_localmind_task'
          ]::TEXT[]
        )
      )
    )
  );
