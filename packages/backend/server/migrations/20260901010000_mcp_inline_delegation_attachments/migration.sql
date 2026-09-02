-- Inline attachments are now part of delegate_to_localmind. Remove the
-- obsolete public upload capability without widening any active credential.
ALTER TABLE "mcp_credentials"
  DROP CONSTRAINT "mcp_credentials_capabilities_check";

UPDATE "mcp_credentials"
SET "capabilities" = array_remove(
  "capabilities",
  'upload_localmind_attachment'
);

UPDATE "mcp_credentials"
SET
  "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP),
  "capabilities" = ARRAY['get_localmind_task']::TEXT[],
  "access_mode" = 'READ_ONLY'
WHERE cardinality("capabilities") = 0;

UPDATE "mcp_credentials"
SET "access_mode" = CASE
  WHEN "capabilities" && ARRAY[
    'delegate_to_localmind',
    'control_localmind_task'
  ]::TEXT[]
    THEN 'READ_WRITE'::"McpAccessMode"
  ELSE 'READ_ONLY'::"McpAccessMode"
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
