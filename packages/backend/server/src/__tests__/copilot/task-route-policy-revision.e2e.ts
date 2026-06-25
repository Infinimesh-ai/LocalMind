import type { GraphQLQuery } from '@affine/graphql';
import { PrismaClient } from '@prisma/client';
import type { TestFn } from 'ava';
import ava from 'ava';

import { AppModule } from '../../app.module';
import { JobQueue } from '../../base';
import { ConfigModule } from '../../base/config';
import { AuthService } from '../../core/auth';
import { Models } from '../../models';
import {
  CopilotProviderType,
  ModelInputType,
  ModelOutputType,
} from '../../plugins/copilot/providers/types';
import {
  createTestingApp,
  createWorkspace,
  TestingApp,
  TestUser,
} from '../utils';

const test = ava as TestFn<{
  app: TestingApp;
  auth: AuthService;
  db: PrismaClient;
  owner: TestUser;
}>;

const taskRoutePolicyQuery = {
  id: 'taskRoutePolicyRevisionTestQuery',
  op: 'taskRoutePolicyRevision',
  query: `
    query taskRoutePolicyRevision($workspaceId: String) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          models(promptName: "Chat With AFFiNE AI") {
            embeddingRoute {
              configured
              effectiveSourceFingerprint
              featureKind
              modelId
              requestedModelConfigKey
              requestedModelConfigPath
              requestedModelId
              requestedModelSource
              taskRoutePolicyRevision
              taskRoutePolicyRevisionActorId
              taskRoutePolicyRevisionFingerprint
              taskRoutePolicyRevisionId
              taskRoutePolicyRevisionScope
              taskRoutePolicyRevisionSourceChainFingerprint
              taskRoutePolicyRevisionStatus
              taskRoutePolicyRevisionWorkspaceId
              taskRoutePolicyRevisionSourceChain {
                actorId
                configKey
                configPath
                featureKind
                fingerprint
                modelId
                revision
                scope
                source
                status
                updatedAt
                workspaceId
              }
            }
            rerankRoute {
              configured
              effectiveSourceFingerprint
              featureKind
              modelId
              requestedModelConfigKey
              requestedModelConfigPath
              requestedModelId
              requestedModelSource
              taskRoutePolicyRevision
              taskRoutePolicyRevisionActorId
              taskRoutePolicyRevisionFingerprint
              taskRoutePolicyRevisionId
              taskRoutePolicyRevisionScope
              taskRoutePolicyRevisionSourceChainFingerprint
              taskRoutePolicyRevisionStatus
              taskRoutePolicyRevisionWorkspaceId
              taskRoutePolicyRevisionSourceChain {
                actorId
                configKey
                configPath
                featureKind
                fingerprint
                modelId
                revision
                scope
                source
                status
                updatedAt
                workspaceId
              }
            }
          }
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const registryPublishEventFields = `
  publishEventCount
  publishEvents {
    actorId
    eventFingerprint
    eventType
    publishSource
    registryFamily
    registryKey
    revisionId
    scopeType
    workspaceId
  }
`;

const taskRoutePolicyPublishMutation = {
  id: 'taskRoutePolicyRevisionPublishTestMutation',
  op: 'publishCopilotTaskRoutePolicyRevision',
  query: `
    mutation taskRoutePolicyRevisionPublish(
      $input: CopilotTaskRoutePolicyPublishInput!
    ) {
      publishCopilotTaskRoutePolicyRevision(input: $input) {
        id
        featureKind
        scopeType
        workspaceId
        actorId
        revision
        status
        modelId
        configKey
        configPath
        fingerprint
        fallbackSourceChain
        ${registryPublishEventFields}
      }
    }
  `,
} satisfies GraphQLQuery;

test.before(async t => {
  const app = await createTestingApp({
    imports: [
      ConfigModule.override({
        copilot: {
          tasks: {
            models: {
              embedding: 'config-embedding',
              rerank: 'config-rerank',
              workspaceIndexing: 'config-workspace-embedding',
            },
          },
          providers: {
            openaiCompatible: {
              apiStyle: 'chat_completions',
              baseURL: 'http://localmind.invalid/v1',
            },
            profiles: [
              {
                id: 'localmind-test-routes',
                type: CopilotProviderType.OpenAICompatible,
                config: {
                  apiKey: 'test',
                  baseURL: 'http://localmind.invalid/v1',
                },
                modelDefinitions: [
                  {
                    id: 'db-workspace-embedding',
                    rawModelId: 'workspace-embedding-db',
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Embedding],
                      },
                    ],
                    limits: {
                      embeddingDimensions: 1024,
                    },
                  },
                  {
                    id: 'db-rerank',
                    rawModelId: 'workspace-rerank-db',
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Rerank],
                      },
                    ],
                  },
                  {
                    id: 'config-workspace-embedding',
                    rawModelId: 'config-workspace-embedding',
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Embedding],
                      },
                    ],
                    limits: {
                      embeddingDimensions: 1024,
                    },
                  },
                  {
                    id: 'config-rerank',
                    rawModelId: 'config-rerank',
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Rerank],
                      },
                    ],
                  },
                ],
              },
            ],
            openai: { apiKey: '1' },
          },
        },
      }),
      AppModule,
    ],
    tapModule: builder => {
      builder.overrideProvider(JobQueue).useClass(JobQueue);
    },
  });

  t.context.app = app;
  t.context.auth = app.get(AuthService);
  t.context.db = app.get(PrismaClient);
});

test.beforeEach(async t => {
  await t.context.app.initTestingDB();
  t.context.owner = await t.context.app.signupV1();
});

test.after.always(async t => {
  await t.context.app?.close();
});

async function insertTaskRoutePolicyRevision(input: {
  actorId: string;
  configKey: 'workspaceIndexing' | 'rerank';
  configPath: string;
  db: PrismaClient;
  featureKind: 'workspace_indexing' | 'rerank';
  fingerprint: string;
  id: string;
  modelId: string;
  revision: string;
  workspaceId: string;
}) {
  await input.db.$executeRaw`
    INSERT INTO ai_task_route_policy_revisions (
      id,
      feature_kind,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      model_id,
      config_key,
      config_path,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${input.id},
      ${input.featureKind},
      ${'workspace'},
      ${input.workspaceId},
      ${input.actorId},
      ${input.revision},
      ${'active'},
      ${input.modelId},
      ${input.configKey},
      ${input.configPath},
      ${input.fingerprint},
      ${JSON.stringify([
        {
          source: 'config_fallback',
          scope: 'global',
          status: 'available',
          featureKind: input.featureKind,
          modelId:
            input.featureKind === 'workspace_indexing'
              ? 'config-workspace-embedding'
              : 'config-rerank',
          configKey: input.configKey,
          configPath: input.configPath,
        },
      ])}::jsonb,
      ${JSON.stringify({ version: 'task-route-policy-revision-test/v1' })}::jsonb,
      ${new Date('2026-06-21T09:00:00.000Z')},
      ${new Date('2026-06-21T09:00:00.000Z')}
    )
  `;
}

function findPropertyDescriptor(
  target: object,
  propertyKey: PropertyKey
): PropertyDescriptor | undefined {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, propertyKey);
    if (descriptor) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

async function insertTaskRoutePolicyRevisionWithDriftedMetadata(input: {
  db: Pick<PrismaClient, '$executeRaw'>;
  values: unknown[];
}): Promise<{
  driftedMetadata: Record<string, unknown>;
  expectedMetadata: Record<string, unknown>;
  fingerprint: string;
  revisionId: string;
}> {
  const [
    revisionId,
    featureKind,
    scopeType,
    workspaceId,
    actorId,
    revision,
    status,
    modelId,
    configKey,
    configPath,
    fingerprint,
    fallbackSourceChainJson,
    metadataJson,
    createdAt,
    updatedAt,
  ] = input.values;
  if (
    typeof revisionId !== 'string' ||
    typeof featureKind !== 'string' ||
    scopeType !== 'workspace' ||
    typeof workspaceId !== 'string' ||
    typeof actorId !== 'string' ||
    typeof revision !== 'string' ||
    status !== 'active' ||
    typeof modelId !== 'string' ||
    (configKey !== null && typeof configKey !== 'string') ||
    (configPath !== null && typeof configPath !== 'string') ||
    typeof fingerprint !== 'string' ||
    typeof fallbackSourceChainJson !== 'string' ||
    typeof metadataJson !== 'string'
  ) {
    throw new Error('Invalid task route policy revision insert fixture');
  }
  const createdAtDate =
    createdAt instanceof Date ? createdAt : new Date(String(createdAt));
  const updatedAtDate =
    updatedAt instanceof Date ? updatedAt : new Date(String(updatedAt));
  if (
    Number.isNaN(createdAtDate.getTime()) ||
    Number.isNaN(updatedAtDate.getTime())
  ) {
    throw new Error('Invalid task route policy revision timestamp fixture');
  }
  const fallbackSourceChain = JSON.parse(fallbackSourceChainJson) as unknown;
  const expectedMetadata = JSON.parse(metadataJson) as Record<string, unknown>;
  const driftedMetadata = {
    ...expectedMetadata,
    taskRoutePolicyRevisionConflictFixture: true,
  };

  await input.db.$executeRaw`
    INSERT INTO ai_task_route_policy_revisions (
      id,
      feature_kind,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      model_id,
      config_key,
      config_path,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${revisionId},
      ${featureKind},
      ${scopeType},
      ${workspaceId},
      ${actorId},
      ${revision},
      ${status},
      ${modelId},
      ${configKey},
      ${configPath},
      ${fingerprint},
      ${JSON.stringify(fallbackSourceChain)}::jsonb,
      ${JSON.stringify(driftedMetadata)}::jsonb,
      ${createdAtDate},
      ${updatedAtDate}
    )
  `;

  return {
    driftedMetadata,
    expectedMetadata,
    fingerprint,
    revisionId,
  };
}

test('task route policy DB constraints reject mismatched revision scope and workspace rows', async t => {
  const { db, owner } = t.context;
  const workspace = await createWorkspace(t.context.app);
  const now = new Date('2026-06-22T12:30:00.000Z');

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_task_route_policy_revisions (
      id,
      feature_kind,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      model_id,
      config_key,
      config_path,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'task-route-policy-global-with-workspace-row'},
      ${'workspace_indexing'},
      ${'global'},
      ${workspace.id},
      ${owner.id},
      ${'global-with-workspace-row'},
      ${'active'},
      ${'db-workspace-embedding'},
      ${'workspaceIndexing'},
      ${'copilot.tasks.models.workspaceIndexing'},
      ${'globalworkspace4'},
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_task_route_policy_revisions (
      id,
      feature_kind,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      model_id,
      config_key,
      config_path,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'task-route-policy-workspace-without-workspace-row'},
      ${'workspace_indexing'},
      ${'workspace'},
      ${null},
      ${owner.id},
      ${'workspace-without-workspace-row'},
      ${'active'},
      ${'db-workspace-embedding'},
      ${'workspaceIndexing'},
      ${'copilot.tasks.models.workspaceIndexing'},
      ${'workspacewithout4'},
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'task-route-policy-invalid-json-shape-row'},
        ${'workspace_indexing'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-json-shape-row'},
        ${'active'},
        ${'db-workspace-embedding'},
        ${'workspaceIndexing'},
        ${'copilot.tasks.models.workspaceIndexing'},
        ${'invalidjson444'},
        ${'{}'}::jsonb,
        ${'[]'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_task_route_policy_revisions_json_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'task-route-policy-invalid-source-chain-provenance-row'},
        ${'workspace_indexing'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-source-chain-provenance-row'},
        ${'active'},
        ${'db-workspace-embedding'},
        ${'workspaceIndexing'},
        ${'copilot.tasks.models.workspaceIndexing'},
        ${'invalidsourcechain2'},
        ${JSON.stringify([
          {
            source: 'provider_default',
            scope: 'global',
            status: 'untrusted_status',
          },
        ])}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_task_route_policy_revisions_source_chain_provenance_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'task-route-policy-invalid-source-chain-metadata-row'},
        ${'workspace_indexing'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-source-chain-metadata-row'},
        ${'active'},
        ${'db-workspace-embedding'},
        ${'workspaceIndexing'},
        ${'copilot.tasks.models.workspaceIndexing'},
        ${'invalidsourcechain6'},
        ${JSON.stringify([
          {
            source: 'provider_default',
            scope: 'global',
            status: 'available',
            configKey: 'unknownConfigKey',
          },
        ])}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_task_route_policy_revisions_source_chain_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'task-route-policy-invalid-revision-shape-row'},
        ${'workspace_indexing'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid revision shape'},
        ${'active'},
        ${'db-workspace-embedding'},
        ${'workspaceIndexing'},
        ${'copilot.tasks.models.workspaceIndexing'},
        ${'invalidrevision2'},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_task_route_policy_revisions_revision_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'task-route-policy-invalid-model-id-shape-row'},
        ${'rerank'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'task-route-model-shape-r1'},
        ${'active'},
        ${'   '},
        ${'rerank'},
        ${'copilot.tasks.models.rerank'},
        ${'invalidtaskroute4'},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_task_route_policy_revisions_model_id_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'task-route-policy-invalid-fingerprint-shape-row'},
        ${'rerank'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'task-route-fingerprint-shape-r1'},
        ${'active'},
        ${'db-rerank'},
        ${'rerank'},
        ${'copilot.tasks.models.rerank'},
        ${'   '},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_task_route_policy_revisions_fingerprint_shape_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'task-route-policy-invalid-config-key-shape-row'},
        ${'rerank'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'task-route-config-key-shape-r1'},
        ${'active'},
        ${'db-rerank'},
        ${'   '},
        ${'copilot.tasks.models.rerank'},
        ${'invalidconfigkey1'},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_task_route_policy_revisions_config_string_shape_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'task-route-policy-invalid-config-path-shape-row'},
        ${'rerank'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'task-route-config-path-shape-r1'},
        ${'active'},
        ${'db-rerank'},
        ${'rerank'},
        ${'   '},
        ${'invalidconfigpath1'},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_task_route_policy_revisions_config_string_shape_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_task_route_policy_revisions (
        id,
        feature_kind,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        model_id,
        config_key,
        config_path,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'task-route-policy-invalid-timestamp-row'},
        ${'rerank'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'task-route-timestamp-r1'},
        ${'active'},
        ${'db-rerank'},
        ${'rerank'},
        ${'copilot.tasks.models.rerank'},
        ${'invalidtimestamp4'},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${new Date(now.getTime() - 60_000)}
      )
    `,
    {
      message: /ai_task_route_policy_revisions_timestamp_coherence_check/,
    }
  );

  const repairMetadataRowId = 'task-route-policy-repair-metadata-contract-row';
  await db.$executeRaw`
    INSERT INTO ai_task_route_policy_revisions (
      id,
      feature_kind,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      model_id,
      config_key,
      config_path,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${repairMetadataRowId},
      ${'rerank'},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'repair-task-route-metadata-contract'},
      ${'active'},
      ${'db-rerank'},
      ${'rerank'},
      ${'copilot.tasks.models.rerank'},
      ${'repairmetadata44'},
      ${'[]'}::jsonb,
      ${JSON.stringify({
        version: 'task-route-policy-revision-repair-executor/v1',
        publishSource: 'repair_execution_worker',
        executionRequestId: 'repair-task-route-metadata-contract',
        requestFingerprint: 'request-fp',
        candidateEvidenceSetFingerprint: 'candidate-fp',
        taskRouteEvidenceSetFingerprint: 'task-route-fp',
        repairJobFingerprint: 'repair-job-fp',
        approvalRecordFingerprint: 'approval-fp',
        operationFingerprint: 'operation-fp',
        operationSetFingerprint: 'operation-set-fp',
        previewFingerprint: 'preview-fp',
        catalogFingerprint: 'catalog-fp',
        targetLocatorFingerprint: 'target-locator-fp',
        taskRouteEffectiveSourceFingerprints: ['task-route-source-fp'],
        candidateEvidenceFingerprints: ['candidate-evidence-fp'],
      })}::jsonb,
      ${now},
      ${now}
    )
  `;
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_task_route_policy_revisions
      SET metadata = metadata - ${'targetLocatorFingerprint'}
      WHERE id = ${repairMetadataRowId}
    `,
    {
      message: /ai_task_route_policy_revisions_repair_metadata_evidence_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_task_route_policy_revisions
      SET metadata = jsonb_set(
        metadata,
        ${'{taskRouteEffectiveSourceFingerprints}'}::text[],
        ${'[]'}::jsonb
      )
      WHERE id = ${repairMetadataRowId}
    `,
    {
      message: /ai_task_route_policy_revisions_repair_metadata_evidence_check/,
    }
  );

  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_task_route_policy_revisions
    WHERE id = ANY(${[
      'task-route-policy-global-with-workspace-row',
      'task-route-policy-workspace-without-workspace-row',
      'task-route-policy-invalid-json-shape-row',
      'task-route-policy-invalid-source-chain-provenance-row',
      'task-route-policy-invalid-source-chain-metadata-row',
      'task-route-policy-invalid-revision-shape-row',
      'task-route-policy-invalid-model-id-shape-row',
      'task-route-policy-invalid-fingerprint-shape-row',
      'task-route-policy-invalid-config-key-shape-row',
      'task-route-policy-invalid-config-path-shape-row',
      'task-route-policy-invalid-timestamp-row',
    ]})
  `;
  t.deepEqual(rows, []);
});

test('models diagnostics resolve workspace DB-backed task route policy revision before config fallback', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  await insertTaskRoutePolicyRevision({
    actorId: owner.id,
    configKey: 'workspaceIndexing',
    configPath: 'copilot.tasks.models.workspaceIndexing',
    db,
    featureKind: 'workspace_indexing',
    fingerprint: 'workspaceindex1111',
    id: 'task-route-policy-workspace-indexing',
    modelId: 'db-workspace-embedding',
    revision: 'workspace-indexing-r1',
    workspaceId: workspace.id,
  });
  await insertTaskRoutePolicyRevision({
    actorId: owner.id,
    configKey: 'rerank',
    configPath: 'copilot.tasks.models.rerank',
    db,
    featureKind: 'rerank',
    fingerprint: 'workspacererank222',
    id: 'task-route-policy-rerank',
    modelId: 'db-rerank',
    revision: 'rerank-r1',
    workspaceId: workspace.id,
  });

  const result = await app.gql({
    query: taskRoutePolicyQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const models = result.currentUser.copilot.models;

  t.is(models.embeddingRoute.requestedModelSource, 'db_revision');
  t.is(models.embeddingRoute.requestedModelId, 'db-workspace-embedding');
  t.is(models.embeddingRoute.modelId, 'workspace-embedding-db');
  t.is(models.embeddingRoute.taskRoutePolicyRevision, 'workspace-indexing-r1');
  t.is(
    models.embeddingRoute.taskRoutePolicyRevisionId,
    'task-route-policy-workspace-indexing'
  );
  t.is(models.embeddingRoute.taskRoutePolicyRevisionScope, 'workspace');
  t.is(models.embeddingRoute.taskRoutePolicyRevisionStatus, 'active');
  t.is(models.embeddingRoute.taskRoutePolicyRevisionWorkspaceId, workspace.id);
  t.is(models.embeddingRoute.taskRoutePolicyRevisionActorId, owner.id);
  t.is(
    models.embeddingRoute.taskRoutePolicyRevisionFingerprint,
    'workspaceindex1111'
  );
  t.regex(
    models.embeddingRoute.taskRoutePolicyRevisionSourceChainFingerprint,
    /^[a-f0-9]{16}$/
  );
  t.deepEqual(
    models.embeddingRoute.taskRoutePolicyRevisionSourceChain.map(
      (entry: { source: string; modelId: string }) => [
        entry.source,
        entry.modelId,
      ]
    ),
    [
      ['db_revision', 'db-workspace-embedding'],
      ['config_fallback', 'config-workspace-embedding'],
    ]
  );
  t.regex(models.embeddingRoute.effectiveSourceFingerprint, /^[a-f0-9]{16}$/);

  t.is(models.rerankRoute.requestedModelSource, 'db_revision');
  t.is(models.rerankRoute.requestedModelId, 'db-rerank');
  t.is(models.rerankRoute.modelId, 'workspace-rerank-db');
  t.is(models.rerankRoute.taskRoutePolicyRevision, 'rerank-r1');
  t.is(
    models.rerankRoute.taskRoutePolicyRevisionFingerprint,
    'workspacererank222'
  );
});

test('task route policy revision remains workspace-scoped and fallback preserves config route', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const otherWorkspace = await createWorkspace(app);

  await insertTaskRoutePolicyRevision({
    actorId: owner.id,
    configKey: 'rerank',
    configPath: 'copilot.tasks.models.rerank',
    db,
    featureKind: 'rerank',
    fingerprint: 'scopedrerank3333',
    id: 'task-route-policy-scoped-rerank',
    modelId: 'db-rerank',
    revision: 'scoped-rerank-r1',
    workspaceId: workspace.id,
  });

  const otherResult = await app.gql({
    query: taskRoutePolicyQuery,
    variables: {
      workspaceId: otherWorkspace.id,
    },
  });
  const otherModels = otherResult.currentUser.copilot.models;

  t.is(otherModels.rerankRoute.requestedModelSource, 'rerank');
  t.is(otherModels.rerankRoute.requestedModelId, 'config-rerank');
  t.is(otherModels.rerankRoute.taskRoutePolicyRevision, null);
  t.deepEqual(
    otherModels.rerankRoute.taskRoutePolicyRevisionSourceChain.map(
      (entry: { source: string; modelId: string }) => [
        entry.source,
        entry.modelId,
      ]
    ),
    [['config_fallback', 'config-rerank']]
  );

  const outsider = await app.signupV1();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: taskRoutePolicyQuery,
      variables: {
        workspaceId: workspace.id,
      },
    })
  );
});

const taskRoutePolicyPublishTestName = [
  'task route policy publish mutation writes workspace revision',
  'and drives route diagnostics',
].join(' ');

test('task route policy revision row conflict rejects mismatched evidence', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const taskRoutePolicyRevisionModel = models.copilotTaskRoutePolicyRevision;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(taskRoutePolicyRevisionModel),
    'db'
  );
  let insertedDriftedRevisionBeforePublish = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertTaskRoutePolicyRevisionWithDriftedMetadata>
  > | null = null;

  try {
    Object.defineProperty(taskRoutePolicyRevisionModel, 'db', {
      configurable: true,
      get() {
        const client = originalDbDescriptor?.get?.call(this) as PrismaClient;
        const originalQueryRaw = client.$queryRaw.bind(client);
        const originalExecuteRaw = client.$executeRaw.bind(client);
        const rawInsertClient = {
          $executeRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            return await originalExecuteRaw(strings, ...values);
          }) as typeof client.$executeRaw,
        };
        const patchedClient = {
          ...client,
          $queryRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            if (
              !insertedDriftedRevisionBeforePublish &&
              strings
                .join('?')
                .includes('INSERT INTO ai_task_route_policy_revisions')
            ) {
              insertedDriftedRevisionBeforePublish = true;
              conflictFixture =
                await insertTaskRoutePolicyRevisionWithDriftedMetadata({
                  db: rawInsertClient,
                  values,
                });
            }
            return await originalQueryRaw(strings, ...values);
          }) as typeof client.$queryRaw,
        } as PrismaClient;
        return patchedClient;
      },
    });

    await t.throwsAsync(
      taskRoutePolicyRevisionModel.publishWorkspaceRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        featureKind: 'rerank',
        modelId: 'task-route-policy-row-conflict-rerank',
        revision: 'task-route-policy-row-conflict-r1',
        configKey: 'rerank',
        configPath: 'copilot.tasks.models.rerank',
        fallbackSourceChain: [],
      }),
      {
        message:
          /Task route policy revision conflict reused mismatched row evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        taskRoutePolicyRevisionModel,
        'db',
        originalDbDescriptor
      );
    }
  }

  t.true(insertedDriftedRevisionBeforePublish);
  t.truthy(conflictFixture);
  t.notDeepEqual(
    conflictFixture!.driftedMetadata,
    conflictFixture!.expectedMetadata
  );
  t.regex(conflictFixture!.fingerprint, /^[a-f0-9]{16}$/);
});

test('task route policy repair revision row conflict rejects mismatched evidence', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const taskRoutePolicyRevisionModel = models.copilotTaskRoutePolicyRevision;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(taskRoutePolicyRevisionModel),
    'db'
  );
  let insertedDriftedRevisionBeforePublish = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertTaskRoutePolicyRevisionWithDriftedMetadata>
  > | null = null;

  try {
    Object.defineProperty(taskRoutePolicyRevisionModel, 'db', {
      configurable: true,
      get() {
        const client = originalDbDescriptor?.get?.call(this) as PrismaClient;
        const originalQueryRaw = client.$queryRaw.bind(client);
        const originalExecuteRaw = client.$executeRaw.bind(client);
        const rawInsertClient = {
          $executeRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            return await originalExecuteRaw(strings, ...values);
          }) as typeof client.$executeRaw,
        };
        const patchedClient = {
          ...client,
          $queryRaw: (async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            if (
              !insertedDriftedRevisionBeforePublish &&
              strings
                .join('?')
                .includes('INSERT INTO ai_task_route_policy_revisions')
            ) {
              insertedDriftedRevisionBeforePublish = true;
              conflictFixture =
                await insertTaskRoutePolicyRevisionWithDriftedMetadata({
                  db: rawInsertClient,
                  values,
                });
            }
            return await originalQueryRaw(strings, ...values);
          }) as typeof client.$queryRaw,
        } as PrismaClient;
        return patchedClient;
      },
    });

    await t.throwsAsync(
      taskRoutePolicyRevisionModel.publishWorkspaceRepairRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        executionRequestId: 'task-route-repair-row-conflict',
        requestFingerprint: 'request-fingerprint',
        candidateEvidenceSetFingerprint: 'candidate-evidence',
        taskRouteEvidenceSetFingerprint: 'task-route-evidence',
        repairJobFingerprint: 'repair-job',
        approvalRecordFingerprint: 'approval-record',
        payload: {
          version: 'task-route-policy-revision-executor-payload/v1',
          kind: 'task_route_policy_revision_publish',
          featureKind: 'rerank',
          modelId: 'task-route-repair-rerank',
          configKey: 'rerank',
          configPath: 'copilot.tasks.models.rerank',
          operationFingerprint: 'operation',
          operationSetFingerprint: 'operation-set',
          previewFingerprint: 'preview',
          catalogFingerprint: 'catalog',
          targetLocatorFingerprint: 'target-locator',
          taskRouteEffectiveSourceFingerprints: ['source-one'],
          candidateEvidenceFingerprints: ['candidate-one'],
          fallbackSourceChain: [],
        },
      }),
      {
        message:
          /Task route policy revision conflict reused mismatched row evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        taskRoutePolicyRevisionModel,
        'db',
        originalDbDescriptor
      );
    }
  }

  t.true(insertedDriftedRevisionBeforePublish);
  t.truthy(conflictFixture);
  t.notDeepEqual(
    conflictFixture!.driftedMetadata,
    conflictFixture!.expectedMetadata
  );
  t.regex(conflictFixture!.fingerprint, /^[a-f0-9]{16}$/);
});

test(taskRoutePolicyPublishTestName, async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  const publishResult = await app.gql({
    query: taskRoutePolicyPublishMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        featureKind: 'rerank',
        modelId: 'db-rerank',
        revision: 'manual-rerank-r1',
        idempotencyKey: ' task-route-publish-idempotency-1 ',
      },
    },
  });
  const revision = publishResult.publishCopilotTaskRoutePolicyRevision as {
    actorId: string;
    configKey: string;
    configPath: string;
    fallbackSourceChain: Array<{
      modelId?: string;
      source: string;
    }>;
    featureKind: string;
    fingerprint: string;
    id: string;
    modelId: string;
    publishEventCount: number;
    publishEvents: Array<{
      eventType: string;
      publishSource: string;
      registryFamily: string;
      registryKey: string;
      revisionId: string;
      workspaceId: string | null;
    }>;
    revision: string;
    scopeType: string;
    status: string;
    workspaceId: string;
  };

  t.is(revision.featureKind, 'rerank');
  t.is(revision.modelId, 'db-rerank');
  t.is(revision.scopeType, 'workspace');
  t.is(revision.workspaceId, workspace.id);
  t.is(revision.actorId, owner.id);
  t.is(revision.revision, 'manual-rerank-r1');
  t.is(revision.status, 'active');
  t.is(revision.configKey, 'rerank');
  t.is(revision.configPath, 'copilot.tasks.models.rerank');
  t.regex(revision.fingerprint, /^[a-f0-9]{16}$/);
  t.is(revision.publishEventCount, 1);
  t.like(revision.publishEvents[0], {
    eventType: 'revision_published',
    publishSource: 'graphql_mutation',
    registryFamily: 'task_route_policy',
    registryKey: 'rerank',
    revisionId: revision.id,
    workspaceId: workspace.id,
  });
  t.deepEqual(
    revision.fallbackSourceChain.map(entry => [entry.source, entry.modelId]),
    [['config_fallback', 'config-rerank']]
  );

  const rows = await db.$queryRaw<
    Array<{
      featureKind: string;
      id: string;
      metadata: Record<string, unknown>;
      modelId: string | null;
      workspaceId: string | null;
    }>
  >`
    SELECT
      feature_kind AS "featureKind",
      id,
      metadata,
      model_id AS "modelId",
      workspace_id AS "workspaceId"
    FROM ai_task_route_policy_revisions
    WHERE id = ${revision.id}
  `;
  t.is(rows.length, 1);
  t.like(rows[0], {
    featureKind: 'rerank',
    id: revision.id,
    modelId: 'db-rerank',
    workspaceId: workspace.id,
  });
  t.is(
    rows[0].metadata.version,
    'task-route-policy-revision-direct-publish/v1'
  );
  t.is(rows[0].metadata.publishSource, 'graphql_mutation');
  t.truthy(rows[0].metadata.idempotencyKeyFingerprint);

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_task_route_policy_revisions
      SET metadata = jsonb_set(
        metadata,
        ${'{publishSource}'}::text[],
        ${JSON.stringify('repair_execution_worker')}::jsonb
      )
      WHERE id = ${revision.id}
    `,
    {
      message: /ai_task_route_policy_revisions_metadata_contract_check/,
    }
  );

  const duplicateResult = await app.gql({
    query: taskRoutePolicyPublishMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        featureKind: 'rerank',
        modelId: 'db-rerank',
        revision: 'manual-rerank-r1',
        idempotencyKey: 'task-route-publish-idempotency-1',
      },
    },
  });
  t.is(duplicateResult.publishCopilotTaskRoutePolicyRevision.id, revision.id);
  t.is(
    duplicateResult.publishCopilotTaskRoutePolicyRevision.publishEventCount,
    2
  );
  t.deepEqual(
    duplicateResult.publishCopilotTaskRoutePolicyRevision.publishEvents.map(
      (event: { eventType: string }) => event.eventType
    ),
    ['revision_reused', 'revision_published']
  );

  const overlong = 'x'.repeat(513);
  await t.throwsAsync(
    app.gql({
      query: taskRoutePolicyPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          featureKind: 'rerank',
          modelId: overlong,
          revision: 'manual-rerank-overlong-direct',
        },
      },
    })
  );
  const overlongRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_task_route_policy_revisions
    WHERE revision = ${'manual-rerank-overlong-direct'}
  `;
  t.deepEqual(overlongRows, []);

  const result = await app.gql({
    query: taskRoutePolicyQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const rerankRoute = result.currentUser.copilot.models.rerankRoute;
  t.is(rerankRoute.requestedModelSource, 'db_revision');
  t.is(rerankRoute.requestedModelId, 'db-rerank');
  t.is(rerankRoute.modelId, 'workspace-rerank-db');
  t.is(rerankRoute.taskRoutePolicyRevision, 'manual-rerank-r1');
  t.is(rerankRoute.taskRoutePolicyRevisionId, revision.id);
  t.is(rerankRoute.taskRoutePolicyRevisionScope, 'workspace');
  t.is(rerankRoute.taskRoutePolicyRevisionWorkspaceId, workspace.id);
  t.is(rerankRoute.taskRoutePolicyRevisionActorId, owner.id);
  t.is(rerankRoute.taskRoutePolicyRevisionFingerprint, revision.fingerprint);
  t.is(rerankRoute.taskRoutePolicyRevisionStatus, 'active');
  t.regex(
    rerankRoute.taskRoutePolicyRevisionSourceChainFingerprint,
    /^[a-f0-9]{16}$/
  );
  t.deepEqual(
    rerankRoute.taskRoutePolicyRevisionSourceChain.map(
      (entry: { source: string; modelId: string }) => [
        entry.source,
        entry.modelId,
      ]
    ),
    [
      ['db_revision', 'db-rerank'],
      ['config_fallback', 'config-rerank'],
    ]
  );

  const outsider = await app.signupV1();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: taskRoutePolicyPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          featureKind: 'rerank',
          modelId: 'db-rerank',
          revision: 'manual-rerank-outsider',
        },
      },
    })
  );

  await app.switchUser(owner);
  await t.throwsAsync(
    app.gql({
      query: taskRoutePolicyPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          featureKind: 'rerank',
          modelId: 'db-workspace-embedding',
          revision: 'manual-rerank-invalid-model',
        },
      },
    })
  );
  const invalidRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_task_route_policy_revisions
    WHERE revision = ${'manual-rerank-invalid-model'}
  `;
  t.deepEqual(invalidRows, []);
});

test('task route policy model filters unknown fallback source-chain provenance', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  const revision =
    await app.models.copilotTaskRoutePolicyRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      featureKind: 'rerank',
      modelId: 'db-rerank',
      revision: 'manual-task-source-chain',
      configKey: 'rerank',
      configPath: 'copilot.tasks.models.rerank',
      fallbackSourceChain: [
        {
          source: 'config_fallback',
          scope: 'global',
          status: 'available',
          configKey: 'rerank',
          configPath: 'copilot.tasks.models.rerank',
          featureKind: 'rerank',
          modelId: 'config-rerank',
          actorId: ['invalid-actor'] as never,
          fingerprint: 123 as never,
          revision: { id: 'invalid-revision' } as never,
          updatedAt: new Date('2026-06-22T10:00:00.000Z') as never,
          workspaceId: { id: workspace.id } as never,
        },
        {
          source: 'unknown_source' as never,
          scope: 'global',
          status: 'available',
          modelId: 'unknown-rerank',
        },
        {
          source: 'provider_default',
          scope: 'invalid_scope' as never,
          status: 'available',
          modelId: 'invalid-scope-rerank',
        },
        {
          source: 'provider_default',
          scope: 'global',
          status: 'untrusted_status',
          modelId: 'invalid-status-rerank',
        },
        ...Array.from({ length: 20 }, (_, index) => ({
          source: 'provider_default' as const,
          scope: 'global' as const,
          status: 'available' as const,
          modelId: `bounded-rerank-${index}`,
        })),
      ],
    });

  t.deepEqual(revision.fallbackSourceChain, [
    {
      source: 'config_fallback',
      scope: 'global',
      status: 'available',
      configKey: 'rerank',
      configPath: 'copilot.tasks.models.rerank',
      featureKind: 'rerank',
      modelId: 'config-rerank',
    },
    ...Array.from({ length: 15 }, (_, index) => ({
      source: 'provider_default',
      scope: 'global',
      status: 'available',
      modelId: `bounded-rerank-${index}`,
    })),
  ]);
  t.is(revision.fallbackSourceChain.length, 16);

  const rows = await db.$queryRaw<Array<{ fallbackSourceChain: unknown }>>`
    SELECT fallback_source_chain AS "fallbackSourceChain"
    FROM ai_task_route_policy_revisions
    WHERE id = ${revision.id}
  `;
  t.deepEqual(rows[0].fallbackSourceChain, revision.fallbackSourceChain);
});

test('task route policy direct publish normalizes model-layer string inputs', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);

  const revision =
    await models.copilotTaskRoutePolicyRevision.publishWorkspaceRevision({
      workspaceId: ` ${workspace.id} `,
      actorId: ` ${owner.id} `,
      featureKind: 'rerank',
      modelId: ' db-rerank ',
      revision: ' manual-task-direct-bounds ',
      idempotencyKey: ' task-direct-idempotency ',
      configKey: ' rerank ',
      configPath: ' copilot.tasks.models.rerank ',
      fallbackSourceChain: [],
    });

  t.like(revision, {
    actorId: owner.id,
    configKey: 'rerank',
    configPath: 'copilot.tasks.models.rerank',
    modelId: 'db-rerank',
    revision: 'manual-task-direct-bounds',
    workspaceId: workspace.id,
  });
});

test('task route policy repair payload bounds durable string fields', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const overlong = 'x'.repeat(513);
  const metadataLargeStrings = Array.from(
    { length: 40 },
    (_, index) => `${index}-${'m'.repeat(500)}`
  );

  await t.throwsAsync(
    app.models.copilotTaskRoutePolicyRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: 'task-route-wrapper-overlong',
      requestFingerprint: overlong,
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'task-route-policy-revision-executor-payload/v1',
        kind: 'task_route_policy_revision_publish',
        featureKind: 'rerank',
        modelId: 'db-rerank',
        configKey: 'rerank',
        configPath: 'copilot.tasks.models.rerank',
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
        taskRouteEffectiveSourceFingerprints: [],
        candidateEvidenceFingerprints: [],
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Task route policy publish requires requestFingerprint/,
    }
  );

  const wrapperRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_task_route_policy_revisions
    WHERE revision = ${'repair-task-route-wrapper-overlong'}
  `;
  t.deepEqual(wrapperRows, []);

  await t.throwsAsync(
    app.models.copilotTaskRoutePolicyRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: 'task-route-metadata-overlarge',
      requestFingerprint: 'request-fingerprint',
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'task-route-policy-revision-executor-payload/v1',
        kind: 'task_route_policy_revision_publish',
        featureKind: 'rerank',
        modelId: 'db-rerank',
        configKey: 'rerank',
        configPath: 'copilot.tasks.models.rerank',
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
        taskRouteEffectiveSourceFingerprints: metadataLargeStrings,
        candidateEvidenceFingerprints: metadataLargeStrings,
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Task route policy publish metadata is too large/,
    }
  );

  const metadataRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_task_route_policy_revisions
    WHERE revision = ${'repair-task-route-metadata-overlarge'}
  `;
  t.deepEqual(metadataRows, []);

  await t.throwsAsync(
    app.models.copilotTaskRoutePolicyRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: 'task-route-payload-overlong',
      requestFingerprint: 'request-fingerprint',
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'task-route-policy-revision-executor-payload/v1',
        kind: 'task_route_policy_revision_publish',
        featureKind: 'rerank',
        modelId: overlong,
        configKey: 'rerank',
        configPath: 'copilot.tasks.models.rerank',
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
        taskRouteEffectiveSourceFingerprints: [],
        candidateEvidenceFingerprints: [],
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Invalid repair execution executor payload field: modelId/,
    }
  );

  const failedRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_task_route_policy_revisions
    WHERE revision = ${'repair-task-route-payload-overlong'}
  `;
  t.deepEqual(failedRows, []);

  const revision =
    await app.models.copilotTaskRoutePolicyRevision.publishWorkspaceRepairRevision(
      {
        workspaceId: ` ${workspace.id} `,
        actorId: ` ${owner.id} `,
        executionRequestId: ' task-route-payload-normalized ',
        requestFingerprint: ' request-fingerprint ',
        candidateEvidenceSetFingerprint: ' candidate-evidence ',
        taskRouteEvidenceSetFingerprint: ' task-route-evidence ',
        repairJobFingerprint: ' repair-job ',
        approvalRecordFingerprint: ' approval-record ',
        payload: {
          version: 'task-route-policy-revision-executor-payload/v1',
          kind: 'task_route_policy_revision_publish',
          featureKind: ' rerank ',
          modelId: ' db-rerank ',
          configKey: ' rerank ',
          configPath: ' copilot.tasks.models.rerank ',
          operationFingerprint: ' operation ',
          operationSetFingerprint: ' operation-set ',
          previewFingerprint: ' preview ',
          catalogFingerprint: ' catalog ',
          targetLocatorFingerprint: ' target-locator ',
          taskRouteEffectiveSourceFingerprints: [
            ' source-one ',
            'source-one',
            overlong,
            '',
          ],
          candidateEvidenceFingerprints: [
            ' candidate-one ',
            'candidate-one',
            overlong,
          ],
          fallbackSourceChain: [],
        },
      }
    );

  t.is(revision.modelId, 'db-rerank');
  t.is(revision.workspaceId, workspace.id);
  t.is(revision.actorId, owner.id);
  t.is(revision.revision, 'repair-task-route-payload-normalized');
  t.is(revision.configPath, 'copilot.tasks.models.rerank');
  const rows = await db.$queryRaw<
    Array<{
      metadata: {
        candidateEvidenceFingerprints: string[];
        executionRequestId: string;
        requestFingerprint: string;
        taskRouteEffectiveSourceFingerprints: string[];
      };
    }>
  >`
    SELECT metadata
    FROM ai_task_route_policy_revisions
    WHERE id = ${revision.id}
  `;
  t.like(rows[0].metadata, {
    executionRequestId: 'task-route-payload-normalized',
    requestFingerprint: 'request-fingerprint',
    taskRouteEffectiveSourceFingerprints: ['source-one'],
    candidateEvidenceFingerprints: ['candidate-one'],
  });
});
