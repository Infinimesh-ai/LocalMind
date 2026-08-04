ALTER TABLE "mcp_credentials"
ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY['documents:read']::TEXT[];

UPDATE "mcp_credentials"
SET "capabilities" = ARRAY['documents:read', 'documents:write']::TEXT[]
WHERE "access_mode" = 'READ_WRITE';

ALTER TABLE "mcp_credentials"
ADD CONSTRAINT "mcp_credentials_capabilities_check"
CHECK (
  cardinality("capabilities") > 0
  AND "capabilities" <@ ARRAY[
    'documents:read',
    'documents:write',
    'workspace:read',
    'workspace:write',
    'assets:read',
    'assets:write',
    'comments:read',
    'comments:write',
    'collaboration:read',
    'collaboration:write',
    'history:read',
    'history:write',
    'ai-context:read',
    'ai-context:write',
    'ai-chat:read',
    'ai-chat:write',
    'ai-operations:read',
    'ai-operations:write'
  ]::TEXT[]
  AND (
    NOT ('workspace:write' = ANY("capabilities"))
    OR 'workspace:read' = ANY("capabilities")
  )
  AND (
    NOT ('assets:write' = ANY("capabilities"))
    OR 'assets:read' = ANY("capabilities")
  )
  AND (
    NOT ('comments:write' = ANY("capabilities"))
    OR 'comments:read' = ANY("capabilities")
  )
  AND (
    NOT ('collaboration:write' = ANY("capabilities"))
    OR 'collaboration:read' = ANY("capabilities")
  )
  AND (
    NOT ('history:write' = ANY("capabilities"))
    OR 'history:read' = ANY("capabilities")
  )
  AND (
    NOT ('documents:write' = ANY("capabilities"))
    OR 'documents:read' = ANY("capabilities")
  )
  AND (
    NOT ('ai-context:write' = ANY("capabilities"))
    OR 'ai-context:read' = ANY("capabilities")
  )
  AND (
    NOT ('ai-chat:write' = ANY("capabilities"))
    OR 'ai-chat:read' = ANY("capabilities")
  )
  AND (
    NOT ('ai-operations:write' = ANY("capabilities"))
    OR 'ai-operations:read' = ANY("capabilities")
  )
  AND (
    (
      "access_mode" = 'READ_WRITE'
      AND "capabilities" && ARRAY[
        'documents:write',
        'workspace:write',
        'assets:write',
        'comments:write',
        'collaboration:write',
        'history:write',
        'ai-context:write',
        'ai-chat:write',
        'ai-operations:write'
      ]::TEXT[]
    )
    OR (
      "access_mode" = 'READ_ONLY'
      AND NOT (
        "capabilities" && ARRAY[
          'documents:write',
          'workspace:write',
          'assets:write',
          'comments:write',
          'collaboration:write',
          'history:write',
          'ai-context:write',
          'ai-chat:write',
          'ai-operations:write'
        ]::TEXT[]
      )
    )
  )
);
