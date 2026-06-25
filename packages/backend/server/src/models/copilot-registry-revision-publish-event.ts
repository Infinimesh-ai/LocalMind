import { createHash, randomUUID } from 'node:crypto';

type RegistryRevisionPublishEventFamily =
  | 'prompt_registry'
  | 'task_route_policy'
  | 'model_registry'
  | 'provider_registry';

type RegistryRevisionPublishEventType =
  | 'revision_published'
  | 'revision_reused';

export type RegistryRevisionPublishEventRecord = {
  id: string;
  registryFamily: RegistryRevisionPublishEventFamily;
  revisionId: string;
  registryProviderId?: string | null;
  registryModelId?: string | null;
  workspaceId?: string | null;
  actorId?: string | null;
  scopeType: 'global' | 'workspace';
  registryKey: string;
  revision: string;
  revisionFingerprint: string;
  revisionStatus: string;
  eventType: RegistryRevisionPublishEventType;
  publishSource: 'graphql_mutation' | 'repair_execution_worker';
  eventFingerprint: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type RegistryRevisionPublishEventHistory = {
  publishEventCount: number;
  publishEvents: RegistryRevisionPublishEventRecord[];
};

type RegistryRevisionPublishEventInput = {
  actorId?: string | null;
  createdAt?: Date;
  eventType: RegistryRevisionPublishEventType;
  metadata?: Record<string, unknown>;
  revisionContent?: unknown;
  revisionFallbackSourceChain?: unknown;
  revisionMetadata?: unknown;
  revisionTaskRouteConfigKey?: string | null;
  revisionTaskRouteConfigPath?: string | null;
  revisionTaskRouteModelId?: string | null;
  publishSource: 'graphql_mutation' | 'repair_execution_worker';
  registryFamily: RegistryRevisionPublishEventFamily;
  registryKey: string;
  registryModelId?: string | null;
  registryProviderId?: string | null;
  revision: string;
  revisionFingerprint: string;
  revisionId: string;
  revisionStatus: string;
  revisionUpdatedAt: Date;
  scopeType: 'global' | 'workspace';
  workspaceId?: string | null;
};

type RegistryRevisionPublishEventDb = {
  $queryRaw: <T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<T>;
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
};

type RegistryRevisionPublishEventRow = {
  id: string;
  registryFamily: RegistryRevisionPublishEventFamily;
  revisionId: string;
  registryProviderId: string | null;
  registryModelId: string | null;
  workspaceId: string | null;
  actorId: string | null;
  scopeType: 'global' | 'workspace';
  registryKey: string;
  revision: string;
  revisionFingerprint: string;
  revisionStatus: string;
  eventType: RegistryRevisionPublishEventType;
  publishSource: 'graphql_mutation' | 'repair_execution_worker';
  eventFingerprint: string;
  metadata: unknown;
  createdAt: Date;
};

type RegistryRevisionPublishEventConflictEvidence = {
  actorId: string | null;
  eventFingerprint: string;
  eventType: RegistryRevisionPublishEventType;
  metadata: Record<string, unknown>;
  publishSource: 'graphql_mutation' | 'repair_execution_worker';
  registryFamily: RegistryRevisionPublishEventFamily;
  registryKey: string;
  registryModelId: string | null;
  registryProviderId: string | null;
  revision: string;
  revisionFingerprint: string;
  revisionId: string;
  revisionStatus: string;
  scopeType: 'global' | 'workspace';
  workspaceId: string | null;
};

function stableRegistryEventStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableRegistryEventStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined
          ? null
          : `${JSON.stringify(key)}:${stableRegistryEventStringify(item)}`;
      })
      .filter(Boolean)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function registryRevisionPublishEventFingerprint(value: unknown) {
  return createHash('sha256')
    .update(stableRegistryEventStringify(value))
    .digest('hex')
    .slice(0, 16);
}

function registryRevisionPublishEventJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function registryRevisionPublishEventObjectJson(value: unknown): string {
  return JSON.stringify(
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  );
}

function registryRevisionPublishEventArrayJson(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function revisionIdsForFamily(
  family: RegistryRevisionPublishEventFamily,
  revisionId: string,
  registryKey: string,
  registryProviderId?: string | null,
  registryModelId?: string | null
) {
  if (
    family === 'model_registry' &&
    (!registryProviderId || !registryModelId)
  ) {
    throw new Error(
      'Model registry publish events require provider and model identity'
    );
  }
  if (family === 'provider_registry' && !registryProviderId) {
    throw new Error(
      'Provider registry publish events require provider identity'
    );
  }

  return {
    promptRegistryRevisionId: family === 'prompt_registry' ? revisionId : null,
    taskRoutePolicyRevisionId:
      family === 'task_route_policy' ? revisionId : null,
    modelRegistryRevisionId: family === 'model_registry' ? revisionId : null,
    providerRegistryRevisionId:
      family === 'provider_registry' ? revisionId : null,
    registryModelId: family === 'model_registry' ? registryModelId : null,
    registryProviderId:
      family === 'model_registry'
        ? registryProviderId
        : family === 'provider_registry'
          ? registryProviderId
          : null,
  };
}

export async function createRegistryRevisionPublishEvent(
  db: RegistryRevisionPublishEventDb,
  input: RegistryRevisionPublishEventInput
) {
  const nonce = randomUUID();
  const createdAt = input.createdAt ?? new Date();
  const metadata = {
    ...input.metadata,
    version: 'registry-revision-publish-event/v1',
    registryFamily: input.registryFamily,
    eventType: input.eventType,
    publishSource: input.publishSource,
    revisionId: input.revisionId,
    registryKey: input.registryKey,
    revision: input.revision,
    revisionFingerprint: input.revisionFingerprint,
    revisionStatus: input.revisionStatus,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    eventNonce: nonce,
  };
  const eventFingerprint = registryRevisionPublishEventFingerprint({
    metadata,
  });
  const id = `registry-revision-publish-event-${eventFingerprint}`;
  const revisionIds = revisionIdsForFamily(
    input.registryFamily,
    input.revisionId,
    input.registryKey,
    input.registryProviderId,
    input.registryModelId
  );

  let insertedRows: Array<{ id: string }>;
  if (input.registryFamily === 'prompt_registry') {
    insertedRows = await db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_registry_revision_publish_events (
        id,
        registry_family,
        revision_id,
        prompt_registry_revision_id,
        task_route_policy_revision_id,
        model_registry_revision_id,
        provider_registry_revision_id,
        registry_provider_id,
        registry_model_id,
        workspace_id,
        actor_id,
        scope_type,
        registry_key,
        revision,
        revision_fingerprint,
        revision_status,
        event_type,
        publish_source,
        event_fingerprint,
        metadata,
        created_at
      )
      SELECT
        ${id},
        ${input.registryFamily},
        ${input.revisionId},
        ${revisionIds.promptRegistryRevisionId},
        ${revisionIds.taskRoutePolicyRevisionId},
        ${revisionIds.modelRegistryRevisionId},
        ${revisionIds.providerRegistryRevisionId},
        ${revisionIds.registryProviderId},
        ${revisionIds.registryModelId},
        ${input.workspaceId ?? null},
        ${input.actorId ?? null},
        ${input.scopeType},
        ${input.registryKey},
        ${input.revision},
        ${input.revisionFingerprint},
        ${input.revisionStatus},
        ${input.eventType},
        ${input.publishSource},
        ${eventFingerprint},
        ${JSON.stringify(metadata)}::jsonb,
        ${createdAt}
      FROM ai_prompt_registry_revisions revision
      WHERE revision.id = ${input.revisionId}
        AND revision.scope_type = ${input.scopeType}
        AND revision.workspace_id IS NOT DISTINCT FROM ${input.workspaceId ?? null}
        AND revision.actor_id IS NOT DISTINCT FROM ${input.actorId ?? null}
        AND revision.prompt_name = ${input.registryKey}
        AND revision.revision = ${input.revision}
        AND revision.fingerprint = ${input.revisionFingerprint}
        AND revision.status = ${input.revisionStatus}
        AND revision.fallback_source_chain = ${registryRevisionPublishEventArrayJson(
          input.revisionFallbackSourceChain
        )}::jsonb
        AND revision.metadata = ${registryRevisionPublishEventObjectJson(
          input.revisionMetadata
        )}::jsonb
        AND revision.updated_at IS NOT DISTINCT FROM ${input.revisionUpdatedAt}
      ON CONFLICT (event_fingerprint) DO NOTHING
      RETURNING id
    `;
  } else if (input.registryFamily === 'task_route_policy') {
    insertedRows = await db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_registry_revision_publish_events (
        id,
        registry_family,
        revision_id,
        prompt_registry_revision_id,
        task_route_policy_revision_id,
        model_registry_revision_id,
        provider_registry_revision_id,
        registry_provider_id,
        registry_model_id,
        workspace_id,
        actor_id,
        scope_type,
        registry_key,
        revision,
        revision_fingerprint,
        revision_status,
        event_type,
        publish_source,
        event_fingerprint,
        metadata,
        created_at
      )
      SELECT
        ${id},
        ${input.registryFamily},
        ${input.revisionId},
        ${revisionIds.promptRegistryRevisionId},
        ${revisionIds.taskRoutePolicyRevisionId},
        ${revisionIds.modelRegistryRevisionId},
        ${revisionIds.providerRegistryRevisionId},
        ${revisionIds.registryProviderId},
        ${revisionIds.registryModelId},
        ${input.workspaceId ?? null},
        ${input.actorId ?? null},
        ${input.scopeType},
        ${input.registryKey},
        ${input.revision},
        ${input.revisionFingerprint},
        ${input.revisionStatus},
        ${input.eventType},
        ${input.publishSource},
        ${eventFingerprint},
        ${JSON.stringify(metadata)}::jsonb,
        ${createdAt}
      FROM ai_task_route_policy_revisions revision
      WHERE revision.id = ${input.revisionId}
        AND revision.scope_type = ${input.scopeType}
        AND revision.workspace_id IS NOT DISTINCT FROM ${input.workspaceId ?? null}
        AND revision.actor_id IS NOT DISTINCT FROM ${input.actorId ?? null}
        AND revision.feature_kind = ${input.registryKey}
        AND revision.revision = ${input.revision}
        AND revision.fingerprint = ${input.revisionFingerprint}
        AND revision.status = ${input.revisionStatus}
        AND revision.model_id = ${input.revisionTaskRouteModelId ?? null}
        AND revision.config_key IS NOT DISTINCT FROM ${
          input.revisionTaskRouteConfigKey ?? null
        }
        AND revision.config_path IS NOT DISTINCT FROM ${
          input.revisionTaskRouteConfigPath ?? null
        }
        AND revision.fallback_source_chain = ${registryRevisionPublishEventArrayJson(
          input.revisionFallbackSourceChain
        )}::jsonb
        AND revision.metadata = ${registryRevisionPublishEventObjectJson(
          input.revisionMetadata
        )}::jsonb
        AND revision.updated_at IS NOT DISTINCT FROM ${input.revisionUpdatedAt}
      ON CONFLICT (event_fingerprint) DO NOTHING
      RETURNING id
    `;
  } else if (input.registryFamily === 'model_registry') {
    insertedRows = await db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_registry_revision_publish_events (
        id,
        registry_family,
        revision_id,
        prompt_registry_revision_id,
        task_route_policy_revision_id,
        model_registry_revision_id,
        provider_registry_revision_id,
        registry_provider_id,
        registry_model_id,
        workspace_id,
        actor_id,
        scope_type,
        registry_key,
        revision,
        revision_fingerprint,
        revision_status,
        event_type,
        publish_source,
        event_fingerprint,
        metadata,
        created_at
      )
      SELECT
        ${id},
        ${input.registryFamily},
        ${input.revisionId},
        ${revisionIds.promptRegistryRevisionId},
        ${revisionIds.taskRoutePolicyRevisionId},
        ${revisionIds.modelRegistryRevisionId},
        ${revisionIds.providerRegistryRevisionId},
        ${revisionIds.registryProviderId},
        ${revisionIds.registryModelId},
        ${input.workspaceId ?? null},
        ${input.actorId ?? null},
        ${input.scopeType},
        ${input.registryKey},
        ${input.revision},
        ${input.revisionFingerprint},
        ${input.revisionStatus},
        ${input.eventType},
        ${input.publishSource},
        ${eventFingerprint},
        ${JSON.stringify(metadata)}::jsonb,
        ${createdAt}
      FROM ai_model_registry_revisions revision
      WHERE revision.id = ${input.revisionId}
        AND revision.scope_type = ${input.scopeType}
        AND revision.workspace_id IS NOT DISTINCT FROM ${input.workspaceId ?? null}
        AND revision.actor_id IS NOT DISTINCT FROM ${input.actorId ?? null}
        AND revision.provider_id = ${input.registryProviderId ?? null}
        AND revision.model_id = ${input.registryModelId ?? null}
        AND revision.revision = ${input.revision}
        AND revision.fingerprint = ${input.revisionFingerprint}
        AND revision.status = ${input.revisionStatus}
        AND revision.model_definition = ${registryRevisionPublishEventJson(
          input.revisionContent
        )}::jsonb
        AND revision.fallback_source_chain = ${registryRevisionPublishEventArrayJson(
          input.revisionFallbackSourceChain
        )}::jsonb
        AND revision.metadata = ${registryRevisionPublishEventObjectJson(
          input.revisionMetadata
        )}::jsonb
        AND revision.updated_at IS NOT DISTINCT FROM ${input.revisionUpdatedAt}
      ON CONFLICT (event_fingerprint) DO NOTHING
      RETURNING id
    `;
  } else {
    insertedRows = await db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_registry_revision_publish_events (
        id,
        registry_family,
        revision_id,
        prompt_registry_revision_id,
        task_route_policy_revision_id,
        model_registry_revision_id,
        provider_registry_revision_id,
        registry_provider_id,
        registry_model_id,
        workspace_id,
        actor_id,
        scope_type,
        registry_key,
        revision,
        revision_fingerprint,
        revision_status,
        event_type,
        publish_source,
        event_fingerprint,
        metadata,
        created_at
      )
      SELECT
        ${id},
        ${input.registryFamily},
        ${input.revisionId},
        ${revisionIds.promptRegistryRevisionId},
        ${revisionIds.taskRoutePolicyRevisionId},
        ${revisionIds.modelRegistryRevisionId},
        ${revisionIds.providerRegistryRevisionId},
        ${revisionIds.registryProviderId},
        ${revisionIds.registryModelId},
        ${input.workspaceId ?? null},
        ${input.actorId ?? null},
        ${input.scopeType},
        ${input.registryKey},
        ${input.revision},
        ${input.revisionFingerprint},
        ${input.revisionStatus},
        ${input.eventType},
        ${input.publishSource},
        ${eventFingerprint},
        ${JSON.stringify(metadata)}::jsonb,
        ${createdAt}
      FROM ai_provider_registry_revisions revision
      WHERE revision.id = ${input.revisionId}
        AND revision.scope_type = ${input.scopeType}
        AND revision.workspace_id IS NOT DISTINCT FROM ${input.workspaceId ?? null}
        AND revision.actor_id IS NOT DISTINCT FROM ${input.actorId ?? null}
        AND revision.provider_id = ${input.registryProviderId ?? null}
        AND revision.revision = ${input.revision}
        AND revision.fingerprint = ${input.revisionFingerprint}
        AND revision.status = ${input.revisionStatus}
        AND revision.provider_profile = ${registryRevisionPublishEventJson(
          input.revisionContent
        )}::jsonb
        AND revision.fallback_source_chain = ${registryRevisionPublishEventArrayJson(
          input.revisionFallbackSourceChain
        )}::jsonb
        AND revision.metadata = ${registryRevisionPublishEventObjectJson(
          input.revisionMetadata
        )}::jsonb
        AND revision.updated_at IS NOT DISTINCT FROM ${input.revisionUpdatedAt}
      ON CONFLICT (event_fingerprint) DO NOTHING
      RETURNING id
    `;
  }

  if (!insertedRows.length) {
    const existing = await getRegistryRevisionPublishEventByFingerprint(
      db,
      eventFingerprint
    );
    if (!existing) {
      throw new Error(
        `Registry revision publish event could not be recorded because its revision state changed: ${input.revisionId}`
      );
    }
    assertPublishEventMatchesConflictEvidence(existing, {
      actorId: input.actorId ?? null,
      eventFingerprint,
      eventType: input.eventType,
      metadata,
      publishSource: input.publishSource,
      registryFamily: input.registryFamily,
      registryKey: input.registryKey,
      registryModelId: revisionIds.registryModelId,
      registryProviderId: revisionIds.registryProviderId,
      revision: input.revision,
      revisionFingerprint: input.revisionFingerprint,
      revisionId: input.revisionId,
      revisionStatus: input.revisionStatus,
      scopeType: input.scopeType,
      workspaceId: input.workspaceId ?? null,
    });
    return;
  }
}

function normalizeRegistryRevisionPublishEventMetadata(
  value: unknown
): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function metadataFingerprint(value: Record<string, unknown>) {
  return registryRevisionPublishEventFingerprint({
    version: 'registry-revision-publish-event-metadata/readback/v1',
    value,
  });
}

function assertPublishEventMatchesConflictEvidence(
  event: RegistryRevisionPublishEventRecord,
  expected: RegistryRevisionPublishEventConflictEvidence
) {
  if (
    event.registryFamily !== expected.registryFamily ||
    event.revisionId !== expected.revisionId ||
    (event.registryProviderId ?? null) !== expected.registryProviderId ||
    (event.registryModelId ?? null) !== expected.registryModelId ||
    (event.workspaceId ?? null) !== expected.workspaceId ||
    (event.actorId ?? null) !== expected.actorId ||
    event.scopeType !== expected.scopeType ||
    event.registryKey !== expected.registryKey ||
    event.revision !== expected.revision ||
    event.revisionFingerprint !== expected.revisionFingerprint ||
    event.revisionStatus !== expected.revisionStatus ||
    event.eventType !== expected.eventType ||
    event.publishSource !== expected.publishSource ||
    event.eventFingerprint !== expected.eventFingerprint ||
    metadataFingerprint(event.metadata) !==
      metadataFingerprint(expected.metadata)
  ) {
    throw new Error(
      'Registry revision publish event conflict reused mismatched evidence'
    );
  }
}

function toPublishEventRecord(
  row: RegistryRevisionPublishEventRow
): RegistryRevisionPublishEventRecord {
  return {
    id: row.id,
    registryFamily: row.registryFamily,
    revisionId: row.revisionId,
    registryProviderId: row.registryProviderId,
    registryModelId: row.registryModelId,
    workspaceId: row.workspaceId,
    actorId: row.actorId,
    scopeType: row.scopeType,
    registryKey: row.registryKey,
    revision: row.revision,
    revisionFingerprint: row.revisionFingerprint,
    revisionStatus: row.revisionStatus,
    eventType: row.eventType,
    publishSource: row.publishSource,
    eventFingerprint: row.eventFingerprint,
    metadata: normalizeRegistryRevisionPublishEventMetadata(row.metadata),
    createdAt: row.createdAt,
  };
}

async function getRegistryRevisionPublishEventByFingerprint(
  db: RegistryRevisionPublishEventDb,
  eventFingerprint: string
) {
  const rows = await db.$queryRaw<RegistryRevisionPublishEventRow[]>`
    SELECT
      id,
      registry_family AS "registryFamily",
      revision_id AS "revisionId",
      registry_provider_id AS "registryProviderId",
      registry_model_id AS "registryModelId",
      workspace_id AS "workspaceId",
      actor_id AS "actorId",
      scope_type AS "scopeType",
      registry_key AS "registryKey",
      revision,
      revision_fingerprint AS "revisionFingerprint",
      revision_status AS "revisionStatus",
      event_type AS "eventType",
      publish_source AS "publishSource",
      event_fingerprint AS "eventFingerprint",
      metadata,
      created_at AS "createdAt"
    FROM ai_registry_revision_publish_events
    WHERE event_fingerprint = ${eventFingerprint}
    LIMIT 1
  `;
  return rows[0] ? toPublishEventRecord(rows[0]) : null;
}

export async function getRegistryRevisionPublishEventHistory(
  db: RegistryRevisionPublishEventDb,
  revisionId: string,
  options: { limit?: number } = {}
): Promise<RegistryRevisionPublishEventHistory> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
  const rows = await db.$queryRaw<
    Array<
      RegistryRevisionPublishEventRow & {
        publishEventCount: number;
      }
    >
  >`
    SELECT
      id,
      registry_family AS "registryFamily",
      revision_id AS "revisionId",
      registry_provider_id AS "registryProviderId",
      registry_model_id AS "registryModelId",
      workspace_id AS "workspaceId",
      actor_id AS "actorId",
      scope_type AS "scopeType",
      registry_key AS "registryKey",
      revision,
      revision_fingerprint AS "revisionFingerprint",
      revision_status AS "revisionStatus",
      event_type AS "eventType",
      publish_source AS "publishSource",
      event_fingerprint AS "eventFingerprint",
      metadata,
      created_at AS "createdAt",
      COUNT(*) OVER()::int AS "publishEventCount"
    FROM ai_registry_revision_publish_events
    WHERE revision_id = ${revisionId}
    ORDER BY
      created_at DESC,
      CASE event_type
        WHEN 'revision_reused' THEN 0
        WHEN 'revision_published' THEN 1
        ELSE 2
      END ASC,
      id DESC
    LIMIT ${limit}
  `;

  return {
    publishEventCount: rows[0]?.publishEventCount ?? 0,
    publishEvents: rows.map(toPublishEventRecord),
  };
}

export async function withRegistryRevisionPublishEventHistory<
  T extends { id: string },
>(
  db: RegistryRevisionPublishEventDb,
  revision: T
): Promise<T & RegistryRevisionPublishEventHistory> {
  const history = await getRegistryRevisionPublishEventHistory(db, revision.id);
  return {
    ...revision,
    ...history,
  };
}
