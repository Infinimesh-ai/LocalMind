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

const modelRegistryQuery = {
  id: 'modelRegistryRevisionTestQuery',
  op: 'modelRegistryRevision',
  query: `
    query modelRegistryRevision($workspaceId: String) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          models(promptName: "Chat With AFFiNE AI") {
            defaultModel
            defaultModelSource
            optionalModels {
              id
              name
              providerId
              providerProfileId
              providerProfileSource
              providerConfiguredModelIds
              routeModelId
              routeRawModelId
              routeModelDefinitionAliases
              routeModelDefinitionId
              routeModelDefinitionSource
              routeInputTypes
              routeOutputTypes
              modelRegistryRevision
              modelRegistryRevisionActorId
              modelRegistryRevisionFingerprint
              modelRegistryRevisionId
              modelRegistryRevisionScope
              modelRegistryRevisionSourceChainFingerprint
              modelRegistryRevisionStatus
              modelRegistryRevisionWorkspaceId
              modelRegistryRevisionSourceChain {
                actorId
                fingerprint
                modelId
                providerId
                revision
                scope
                source
                status
                updatedAt
                workspaceId
              }
              effectiveSourceFingerprint
              effectiveSourceFingerprintInputs
              effectiveSourceFingerprintVersion
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
    registryModelId
    registryProviderId
    revisionId
    scopeType
    workspaceId
  }
`;

const modelRegistryPublishMutation = {
  id: 'modelRegistryRevisionPublishTestMutation',
  op: 'publishCopilotModelRegistryRevision',
  query: `
    mutation modelRegistryRevisionPublish(
      $input: CopilotModelRegistryPublishInput!
    ) {
      publishCopilotModelRegistryRevision(input: $input) {
        id
        providerId
        modelId
        scopeType
        workspaceId
        actorId
        revision
        status
        fingerprint
        modelDefinition
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
          providers: {
            openaiCompatible: {
              apiStyle: 'chat_completions',
              baseURL: 'http://localmind.invalid/v1',
            },
            profiles: [
              {
                id: 'localmind-db-model-provider',
                type: CopilotProviderType.OpenAICompatible,
                config: {
                  apiKey: 'test',
                  baseURL: 'http://localmind.invalid/v1',
                },
                modelDefinitions: [
                  {
                    id: 'gpt-4o-mini',
                    rawModelId: 'gpt-4o-mini',
                    aliases: ['fast-chat'],
                    displayName: 'Config fallback chat',
                    capabilities: [
                      {
                        input: [ModelInputType.Text],
                        output: [ModelOutputType.Text],
                      },
                    ],
                  },
                ],
              },
            ],
            openai: { apiKey: '1' },
          },
          prompts: {
            defaults: {
              text: {
                optionalModels: ['db-office-chat'],
              },
            },
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

async function insertModelRegistryRevision(input: {
  actorId: string;
  db: PrismaClient;
  displayName: string;
  fingerprint: string;
  id: string;
  modelId: string;
  rawModelId: string;
  revision: string;
  scopeType: 'global' | 'workspace';
  workspaceId?: string | null;
}) {
  await input.db.$executeRaw`
    INSERT INTO ai_model_registry_revisions (
      id,
      provider_id,
      model_id,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      model_definition,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${input.id},
      ${'localmind-db-model-provider'},
      ${input.modelId},
      ${input.scopeType},
      ${input.workspaceId ?? null},
      ${input.actorId},
      ${input.revision},
      ${'active'},
      ${input.fingerprint},
      ${JSON.stringify({
        id: input.modelId,
        rawModelId: input.rawModelId,
        displayName: input.displayName,
        aliases: ['db-chat-alias'],
        capabilities: [
          {
            input: [ModelInputType.Text],
            output: [ModelOutputType.Text],
          },
        ],
      })}::jsonb,
      ${JSON.stringify([
        {
          source: 'provider_profile',
          scope: 'global',
          status: 'available',
          providerId: 'localmind-db-model-provider',
          modelId: 'gpt-4o-mini',
          revision: 'config-profile-model',
          fingerprint: 'configprofile1111',
        },
      ])}::jsonb,
      ${JSON.stringify({ version: 'model-registry-revision-test/v1' })}::jsonb,
      ${new Date('2026-06-21T10:00:00.000Z')},
      ${new Date('2026-06-21T10:00:00.000Z')}
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

async function insertModelRegistryRevisionWithDriftedMetadata(input: {
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
    providerId,
    modelId,
    scopeType,
    workspaceId,
    actorId,
    revision,
    status,
    fingerprint,
    modelDefinitionJson,
    fallbackSourceChainJson,
    metadataJson,
    createdAt,
    updatedAt,
  ] = input.values;
  if (
    typeof revisionId !== 'string' ||
    typeof providerId !== 'string' ||
    typeof modelId !== 'string' ||
    scopeType !== 'workspace' ||
    typeof workspaceId !== 'string' ||
    typeof actorId !== 'string' ||
    typeof revision !== 'string' ||
    status !== 'active' ||
    typeof fingerprint !== 'string' ||
    typeof modelDefinitionJson !== 'string' ||
    typeof fallbackSourceChainJson !== 'string' ||
    typeof metadataJson !== 'string'
  ) {
    throw new Error('Invalid model registry revision insert fixture');
  }
  const createdAtDate =
    createdAt instanceof Date ? createdAt : new Date(String(createdAt));
  const updatedAtDate =
    updatedAt instanceof Date ? updatedAt : new Date(String(updatedAt));
  if (
    Number.isNaN(createdAtDate.getTime()) ||
    Number.isNaN(updatedAtDate.getTime())
  ) {
    throw new Error('Invalid model registry revision timestamp fixture');
  }
  const modelDefinition = JSON.parse(modelDefinitionJson) as unknown;
  const fallbackSourceChain = JSON.parse(fallbackSourceChainJson) as unknown;
  const expectedMetadata = JSON.parse(metadataJson) as Record<string, unknown>;
  const driftedMetadata = {
    ...expectedMetadata,
    modelRegistryRevisionConflictFixture: true,
  };

  await input.db.$executeRaw`
    INSERT INTO ai_model_registry_revisions (
      id,
      provider_id,
      model_id,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      model_definition,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${revisionId},
      ${providerId},
      ${modelId},
      ${scopeType},
      ${workspaceId},
      ${actorId},
      ${revision},
      ${status},
      ${fingerprint},
      ${JSON.stringify(modelDefinition)}::jsonb,
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

test('model registry DB constraints reject invalid revision scope and status rows', async t => {
  const { db, owner } = t.context;
  const workspace = await createWorkspace(t.context.app);
  const now = new Date('2026-06-22T12:00:00.000Z');
  const modelDefinition = JSON.stringify({
    id: 'db-office-chat',
    rawModelId: 'db-office-chat-raw',
    capabilities: [],
  });

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_model_registry_revisions (
      id,
      provider_id,
      model_id,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      model_definition,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'model-registry-invalid-status-row'},
      ${'localmind-db-model-provider'},
      ${'db-office-chat'},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'invalid-status-row'},
      ${'available'},
      ${'invalidstatus111'},
      ${modelDefinition}::jsonb,
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_model_registry_revisions (
      id,
      provider_id,
      model_id,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      model_definition,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'model-registry-invalid-scope-row'},
      ${'localmind-db-model-provider'},
      ${'db-office-chat'},
      ${'tenant'},
      ${workspace.id},
      ${owner.id},
      ${'invalid-scope-row'},
      ${'active'},
      ${'invalidscope111'},
      ${modelDefinition}::jsonb,
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_model_registry_revisions (
      id,
      provider_id,
      model_id,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      model_definition,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'model-registry-global-with-workspace-row'},
      ${'localmind-db-model-provider'},
      ${'db-office-chat'},
      ${'global'},
      ${workspace.id},
      ${owner.id},
      ${'global-with-workspace-row'},
      ${'active'},
      ${'globalworkspace1'},
      ${modelDefinition}::jsonb,
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_model_registry_revisions (
      id,
      provider_id,
      model_id,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      model_definition,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'model-registry-workspace-without-workspace-row'},
      ${'localmind-db-model-provider'},
      ${'db-office-chat'},
      ${'workspace'},
      ${null},
      ${owner.id},
      ${'workspace-without-workspace-row'},
      ${'active'},
      ${'workspacewithout1'},
      ${modelDefinition}::jsonb,
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'model-registry-invalid-json-shape-row'},
        ${'localmind-db-model-provider'},
        ${'db-office-chat'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-json-shape-row'},
        ${'active'},
        ${'invalidjson111'},
        ${modelDefinition}::jsonb,
        ${'{}'}::jsonb,
        ${'[]'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_model_registry_revisions_json_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'model-registry-invalid-source-chain-provenance-row'},
        ${'localmind-db-model-provider'},
        ${'db-office-chat'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-source-chain-provenance-row'},
        ${'active'},
        ${'invalidsourcechain3'},
        ${modelDefinition}::jsonb,
        ${JSON.stringify([
          {
            source: 'native_registry',
            scope: 'tenant',
            status: 'available',
          },
        ])}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_model_registry_revisions_source_chain_provenance_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'model-registry-invalid-source-chain-metadata-row'},
        ${'localmind-db-model-provider'},
        ${'db-office-chat'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-source-chain-metadata-row'},
        ${'active'},
        ${'invalidsourcechain7'},
        ${modelDefinition}::jsonb,
        ${JSON.stringify([
          {
            source: 'native_registry',
            scope: 'global',
            status: 'available',
            modelId: 42,
          },
        ])}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_model_registry_revisions_source_chain_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'model-registry-invalid-payload-json-shape-row'},
        ${'localmind-db-model-provider'},
        ${'db-office-chat'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-payload-json-shape-row'},
        ${'active'},
        ${'invalidpayload1'},
        ${'[]'}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_model_registry_revisions_payload_json_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'model-registry-invalid-revision-shape-row'},
        ${'localmind-db-model-provider'},
        ${'db-office-chat'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid revision shape'},
        ${'active'},
        ${'invalidrevision3'},
        ${modelDefinition}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_model_registry_revisions_revision_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'model-registry-invalid-identity-shape-row'},
        ${'   '},
        ${'db-office-chat'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'model-identity-shape-r1'},
        ${'active'},
        ${'invalidmodelid1'},
        ${modelDefinition}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_model_registry_revisions_identity_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'model-registry-invalid-fingerprint-shape-row'},
        ${'localmind-db-model-provider'},
        ${'db-office-chat'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'model-fingerprint-shape-r1'},
        ${'active'},
        ${'   '},
        ${modelDefinition}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_model_registry_revisions_fingerprint_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_model_registry_revisions (
        id,
        provider_id,
        model_id,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        model_definition,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'model-registry-invalid-timestamp-row'},
        ${'localmind-db-model-provider'},
        ${'db-office-chat'},
        ${'global'},
        ${null},
        ${owner.id},
        ${'model-timestamp-r1'},
        ${'active'},
        ${'invalidtimestamp2'},
        ${modelDefinition}::jsonb,
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${new Date(now.getTime() - 60_000)}
      )
    `,
    {
      message: /ai_model_registry_revisions_timestamp_coherence_check/,
    }
  );

  const repairMetadataRowId = 'model-registry-repair-metadata-contract-row';
  await db.$executeRaw`
    INSERT INTO ai_model_registry_revisions (
      id,
      provider_id,
      model_id,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      model_definition,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${repairMetadataRowId},
      ${'localmind-db-model-provider'},
      ${'db-office-chat'},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'repair-model-metadata-contract'},
      ${'active'},
      ${'repairmetadata11'},
      ${modelDefinition}::jsonb,
      ${'[]'}::jsonb,
      ${JSON.stringify({
        version: 'model-registry-revision-repair-executor/v1',
        publishSource: 'repair_execution_worker',
        executionRequestId: 'repair-model-metadata-contract',
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
        candidateEvidenceFingerprints: ['candidate-evidence-fp'],
      })}::jsonb,
      ${now},
      ${now}
    )
  `;
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_model_registry_revisions
      SET metadata = metadata - ${'operationFingerprint'}
      WHERE id = ${repairMetadataRowId}
    `,
    {
      message: /ai_model_registry_revisions_repair_metadata_evidence_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_model_registry_revisions
      SET metadata = jsonb_set(
        metadata,
        ${'{candidateEvidenceFingerprints}'}::text[],
        ${'[]'}::jsonb
      )
      WHERE id = ${repairMetadataRowId}
    `,
    {
      message: /ai_model_registry_revisions_repair_metadata_evidence_check/,
    }
  );

  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_model_registry_revisions
    WHERE id = ANY(${[
      'model-registry-invalid-status-row',
      'model-registry-invalid-scope-row',
      'model-registry-global-with-workspace-row',
      'model-registry-workspace-without-workspace-row',
      'model-registry-invalid-json-shape-row',
      'model-registry-invalid-source-chain-provenance-row',
      'model-registry-invalid-source-chain-metadata-row',
      'model-registry-invalid-payload-json-shape-row',
      'model-registry-invalid-revision-shape-row',
      'model-registry-invalid-identity-shape-row',
      'model-registry-invalid-fingerprint-shape-row',
      'model-registry-invalid-timestamp-row',
    ]})
  `;
  t.deepEqual(rows, []);
});

test('models diagnostics resolve workspace DB-backed model registry revision before provider profile fallback', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  await insertModelRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Global DB chat',
    fingerprint: 'globalmodel111111',
    id: 'model-registry-global-db-office-chat',
    modelId: 'db-office-chat',
    rawModelId: 'global-db-office-chat-raw',
    revision: 'global-r1',
    scopeType: 'global',
  });
  await insertModelRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Workspace DB chat',
    fingerprint: 'workspacemodel22',
    id: 'model-registry-workspace-db-office-chat',
    modelId: 'db-office-chat',
    rawModelId: 'workspace-db-office-chat-raw',
    revision: 'workspace-r2',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  const result = await app.gql({
    query: modelRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const models = result.currentUser.copilot.models.optionalModels;
  const model = models.find(
    (item: { id: string }) => item.id === 'db-office-chat'
  );

  t.truthy(model);
  t.is(model.name, 'Workspace DB chat');
  t.is(model.providerId, 'localmind-db-model-provider');
  t.is(model.providerProfileSource, 'configured');
  t.true(model.providerConfiguredModelIds.includes('db-office-chat'));
  t.is(model.routeModelId, 'workspace-db-office-chat-raw');
  t.is(model.routeRawModelId, 'workspace-db-office-chat-raw');
  t.is(model.routeModelDefinitionId, 'db-office-chat');
  t.is(model.routeModelDefinitionSource, 'db_revision');
  t.deepEqual(model.routeModelDefinitionAliases, ['db-chat-alias']);
  t.deepEqual(model.routeInputTypes, ['text']);
  t.deepEqual(model.routeOutputTypes, ['text']);
  t.is(model.modelRegistryRevision, 'workspace-r2');
  t.is(
    model.modelRegistryRevisionId,
    'model-registry-workspace-db-office-chat'
  );
  t.is(model.modelRegistryRevisionScope, 'workspace');
  t.is(model.modelRegistryRevisionWorkspaceId, workspace.id);
  t.is(model.modelRegistryRevisionActorId, owner.id);
  t.is(model.modelRegistryRevisionFingerprint, 'workspacemodel22');
  t.is(model.modelRegistryRevisionStatus, 'active');
  t.regex(model.modelRegistryRevisionSourceChainFingerprint, /^[a-f0-9]{16}$/);
  t.deepEqual(
    model.modelRegistryRevisionSourceChain.map(
      (entry: { source: string; scope: string; modelId: string }) => [
        entry.source,
        entry.scope,
        entry.modelId,
      ]
    ),
    [
      ['db_revision', 'workspace', 'db-office-chat'],
      ['provider_profile', 'global', 'gpt-4o-mini'],
    ]
  );
  t.regex(model.effectiveSourceFingerprint, /^[a-f0-9]{16}$/);
  t.true(
    model.effectiveSourceFingerprintInputs.includes(
      'modelRegistryRevisionFingerprint'
    )
  );
});

test('model registry revision remains workspace-scoped and falls back to global DB revision', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const otherWorkspace = await createWorkspace(app);

  await insertModelRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Global DB chat',
    fingerprint: 'globalmodel333333',
    id: 'model-registry-global-fallback',
    modelId: 'db-office-chat',
    rawModelId: 'global-db-office-chat-raw',
    revision: 'global-r3',
    scopeType: 'global',
  });
  await insertModelRegistryRevision({
    actorId: owner.id,
    db,
    displayName: 'Workspace DB chat',
    fingerprint: 'scopedmodel44444',
    id: 'model-registry-workspace-scoped',
    modelId: 'db-office-chat',
    rawModelId: 'workspace-db-office-chat-raw',
    revision: 'workspace-r4',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  const result = await app.gql({
    query: modelRegistryQuery,
    variables: {
      workspaceId: otherWorkspace.id,
    },
  });
  const model = result.currentUser.copilot.models.optionalModels.find(
    (item: { id: string }) => item.id === 'db-office-chat'
  );

  t.truthy(model);
  t.is(model.name, 'Global DB chat');
  t.is(model.routeModelId, 'global-db-office-chat-raw');
  t.is(model.routeModelDefinitionSource, 'db_revision');
  t.is(model.modelRegistryRevision, 'global-r3');
  t.is(model.modelRegistryRevisionId, 'model-registry-global-fallback');
  t.is(model.modelRegistryRevisionScope, 'global');
  t.is(model.modelRegistryRevisionWorkspaceId, null);

  const outsider = await app.signupV1();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: modelRegistryQuery,
      variables: {
        workspaceId: workspace.id,
      },
    })
  );
});

const modelRegistryPublishTestName = [
  'model registry publish mutation writes sanitized workspace revision',
  'and drives model routing',
].join(' ');

test('model registry revision row conflict rejects mismatched evidence', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const modelRegistryRevisionModel = models.copilotModelRegistryRevision;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(modelRegistryRevisionModel),
    'db'
  );
  let insertedDriftedRevisionBeforePublish = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertModelRegistryRevisionWithDriftedMetadata>
  > | null = null;

  try {
    Object.defineProperty(modelRegistryRevisionModel, 'db', {
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
                .includes('INSERT INTO ai_model_registry_revisions')
            ) {
              insertedDriftedRevisionBeforePublish = true;
              conflictFixture =
                await insertModelRegistryRevisionWithDriftedMetadata({
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
      modelRegistryRevisionModel.publishWorkspaceRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        providerId: 'model-registry-row-conflict-provider',
        modelId: 'model-registry-row-conflict-chat',
        revision: 'model-registry-row-conflict-r1',
        modelDefinition: {
          rawModelId: 'model-registry-row-conflict-chat-raw',
          displayName: 'Model registry row conflict chat',
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
        fallbackSourceChain: [],
      }),
      {
        message:
          /Model registry revision conflict reused mismatched row evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        modelRegistryRevisionModel,
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

test('model registry repair revision row conflict rejects mismatched evidence', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const modelRegistryRevisionModel = models.copilotModelRegistryRevision;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(modelRegistryRevisionModel),
    'db'
  );
  let insertedDriftedRevisionBeforePublish = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertModelRegistryRevisionWithDriftedMetadata>
  > | null = null;

  try {
    Object.defineProperty(modelRegistryRevisionModel, 'db', {
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
                .includes('INSERT INTO ai_model_registry_revisions')
            ) {
              insertedDriftedRevisionBeforePublish = true;
              conflictFixture =
                await insertModelRegistryRevisionWithDriftedMetadata({
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
      modelRegistryRevisionModel.publishWorkspaceRepairRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        executionRequestId: 'model-registry-repair-row-conflict',
        requestFingerprint: 'request-fingerprint',
        candidateEvidenceSetFingerprint: 'candidate-evidence',
        taskRouteEvidenceSetFingerprint: 'task-route-evidence',
        repairJobFingerprint: 'repair-job',
        approvalRecordFingerprint: 'approval-record',
        payload: {
          version: 'model-registry-revision-executor-payload/v1',
          kind: 'model_registry_revision_publish',
          providerId: 'model-registry-repair-provider',
          modelId: 'model-registry-repair-chat',
          rawModelId: 'model-registry-repair-chat-raw',
          aliases: ['repair-chat'],
          modelDefinition: {
            rawModelId: 'model-registry-repair-chat-raw',
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
          operationFingerprint: 'operation',
          operationSetFingerprint: 'operation-set',
          previewFingerprint: 'preview',
          catalogFingerprint: 'catalog',
          targetLocatorFingerprint: 'target-locator',
          candidateEvidenceFingerprints: ['candidate-one'],
          fallbackSourceChain: [],
        },
      }),
      {
        message:
          /Model registry revision conflict reused mismatched row evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        modelRegistryRevisionModel,
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

test(modelRegistryPublishTestName, async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  const publishResult = await app.gql({
    query: modelRegistryPublishMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        providerId: 'localmind-db-model-provider',
        modelId: 'db-office-chat',
        revision: 'manual-model-r1',
        idempotencyKey: ' model-publish-idempotency-1 ',
        modelDefinition: {
          id: 'must-not-win',
          rawModelId: ' published-db-office-chat-raw ',
          displayName: ' Published DB office chat ',
          aliases: [' published-db-chat-alias ', 'published-db-chat-alias'],
          config: {
            apiKey: 'must-not-persist',
            baseURL: 'http://must-not-persist.invalid/v1',
          },
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
      },
    },
  });
  const revision = publishResult.publishCopilotModelRegistryRevision as {
    actorId: string;
    fingerprint: string;
    id: string;
    modelDefinition: Record<string, unknown>;
    modelId: string;
    publishEventCount: number;
    publishEvents: Array<{
      eventType: string;
      publishSource: string;
      registryFamily: string;
      registryKey: string;
      registryModelId: string | null;
      registryProviderId: string | null;
      revisionId: string;
      workspaceId: string | null;
    }>;
    providerId: string;
    revision: string;
    scopeType: string;
    status: string;
    workspaceId: string;
  };

  t.is(revision.providerId, 'localmind-db-model-provider');
  t.is(revision.modelId, 'db-office-chat');
  t.is(revision.scopeType, 'workspace');
  t.is(revision.workspaceId, workspace.id);
  t.is(revision.actorId, owner.id);
  t.is(revision.revision, 'manual-model-r1');
  t.is(revision.status, 'active');
  t.regex(revision.fingerprint, /^[a-f0-9]{16}$/);
  t.is(revision.publishEventCount, 1);
  t.like(revision.publishEvents[0], {
    eventType: 'revision_published',
    publishSource: 'graphql_mutation',
    registryFamily: 'model_registry',
    registryKey: 'localmind-db-model-provider:db-office-chat',
    registryModelId: 'db-office-chat',
    registryProviderId: 'localmind-db-model-provider',
    revisionId: revision.id,
    workspaceId: workspace.id,
  });
  t.is(revision.modelDefinition.id, 'db-office-chat');
  t.is(revision.modelDefinition.rawModelId, 'published-db-office-chat-raw');
  t.false(
    JSON.stringify(revision.modelDefinition).includes('must-not-persist')
  );

  const rows = await db.$queryRaw<
    Array<{
      id: string;
      metadata: Record<string, unknown>;
      modelDefinition: unknown;
    }>
  >`
    SELECT
      id,
      metadata,
      model_definition AS "modelDefinition"
    FROM ai_model_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.is(rows.length, 1);
  t.is(rows[0].metadata.version, 'model-registry-revision-direct-publish/v1');
  t.is(rows[0].metadata.publishSource, 'graphql_mutation');
  t.truthy(rows[0].metadata.idempotencyKeyFingerprint);
  t.false(JSON.stringify(rows[0].modelDefinition).includes('must-not-persist'));

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_model_registry_revisions
      SET metadata = jsonb_set(
        metadata,
        ${'{publishSource}'}::text[],
        ${JSON.stringify('repair_execution_worker')}::jsonb
      )
      WHERE id = ${revision.id}
    `,
    {
      message: /ai_model_registry_revisions_metadata_contract_check/,
    }
  );

  const duplicateResult = await app.gql({
    query: modelRegistryPublishMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        providerId: 'localmind-db-model-provider',
        modelId: 'db-office-chat',
        revision: 'manual-model-r1',
        idempotencyKey: 'model-publish-idempotency-1',
        modelDefinition: {
          rawModelId: 'published-db-office-chat-raw',
          displayName: 'Published DB office chat',
          aliases: ['published-db-chat-alias'],
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
      },
    },
  });
  t.is(duplicateResult.publishCopilotModelRegistryRevision.id, revision.id);
  t.is(
    duplicateResult.publishCopilotModelRegistryRevision.publishEventCount,
    2
  );
  t.deepEqual(
    duplicateResult.publishCopilotModelRegistryRevision.publishEvents.map(
      (event: { eventType: string }) => event.eventType
    ),
    ['revision_reused', 'revision_published']
  );

  const overlong = 'x'.repeat(513);
  await t.throwsAsync(
    app.gql({
      query: modelRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          providerId: 'localmind-db-model-provider',
          modelId: overlong,
          revision: 'manual-model-overlong-direct',
          modelDefinition: {
            rawModelId: 'overlong-provider-chat-raw',
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
        },
      },
    })
  );
  const overlongRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_model_registry_revisions
    WHERE revision = ${'manual-model-overlong-direct'}
  `;
  t.deepEqual(overlongRows, []);

  await t.throwsAsync(
    app.gql({
      query: modelRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          providerId: 'missing-provider',
          modelId: 'db-office-chat',
          revision: 'manual-model-missing',
          modelDefinition: {
            rawModelId: 'missing-provider-chat-raw',
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
        },
      },
    })
  );

  const result = await app.gql({
    query: modelRegistryQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const model = result.currentUser.copilot.models.optionalModels.find(
    (item: { id: string }) => item.id === 'db-office-chat'
  );

  t.truthy(model);
  t.is(model.name, 'Published DB office chat');
  t.is(model.providerId, 'localmind-db-model-provider');
  t.is(model.providerProfileSource, 'configured');
  t.is(model.routeModelId, 'published-db-office-chat-raw');
  t.is(model.routeRawModelId, 'published-db-office-chat-raw');
  t.is(model.routeModelDefinitionId, 'db-office-chat');
  t.is(model.routeModelDefinitionSource, 'db_revision');
  t.deepEqual(model.routeModelDefinitionAliases, ['published-db-chat-alias']);
  t.is(model.modelRegistryRevision, 'manual-model-r1');
  t.is(model.modelRegistryRevisionId, revision.id);
  t.is(model.modelRegistryRevisionScope, 'workspace');
  t.is(model.modelRegistryRevisionWorkspaceId, workspace.id);
  t.is(model.modelRegistryRevisionActorId, owner.id);
  t.is(model.modelRegistryRevisionFingerprint, revision.fingerprint);
  t.is(model.modelRegistryRevisionStatus, 'active');
  t.regex(model.modelRegistryRevisionSourceChainFingerprint, /^[a-f0-9]{16}$/);
  t.deepEqual(
    model.modelRegistryRevisionSourceChain.map(
      (entry: { source: string; scope: string; modelId: string }) => [
        entry.source,
        entry.scope,
        entry.modelId,
      ]
    ),
    [
      ['db_revision', 'workspace', 'db-office-chat'],
      ['provider_profile', 'global', 'db-office-chat'],
    ]
  );

  const outsider = await app.signupV1();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: modelRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          providerId: 'localmind-db-model-provider',
          modelId: 'db-office-chat',
          revision: 'manual-model-outsider',
          modelDefinition: {
            rawModelId: 'outsider-chat-raw',
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
        },
      },
    })
  );
});

test('model registry model filters unknown fallback source-chain provenance', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);

  const revision =
    await app.models.copilotModelRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      providerId: 'localmind-db-model-provider',
      modelId: 'db-office-chat',
      revision: 'manual-model-source-chain',
      modelDefinition: {
        rawModelId: 'source-chain-db-office-chat-raw',
        capabilities: [
          {
            input: [ModelInputType.Text],
            output: [ModelOutputType.Text],
          },
        ],
      },
      fallbackSourceChain: [
        {
          source: 'provider_profile',
          scope: 'global',
          status: 'available',
          providerId: 'localmind-db-model-provider',
          modelId: 'db-office-chat',
          actorId: { id: owner.id } as never,
          fingerprint: 123 as never,
          revision: ['config-profile-model'] as never,
          updatedAt: new Date('2026-06-22T10:00:00.000Z') as never,
          workspaceId: { id: workspace.id } as never,
        },
        {
          source: 'unknown_source' as never,
          scope: 'global',
          status: 'available',
          providerId: 'localmind-db-model-provider',
          modelId: 'unknown-chat',
        },
        {
          source: 'native_registry',
          scope: 'invalid_scope' as never,
          status: 'available',
          providerId: 'localmind-db-model-provider',
          modelId: 'invalid-scope-chat',
        },
        {
          source: 'native_registry',
          scope: 'global',
          status: 'untrusted_status',
          providerId: 'localmind-db-model-provider',
          modelId: 'invalid-status-chat',
        },
        ...Array.from({ length: 20 }, (_, index) => ({
          source: 'native_registry' as const,
          scope: 'global' as const,
          status: 'available' as const,
          providerId: 'localmind-db-model-provider',
          modelId: `bounded-chat-${index}`,
        })),
      ],
    });

  t.deepEqual(revision.fallbackSourceChain, [
    {
      source: 'provider_profile',
      scope: 'global',
      status: 'available',
      providerId: 'localmind-db-model-provider',
      modelId: 'db-office-chat',
    },
    ...Array.from({ length: 15 }, (_, index) => ({
      source: 'native_registry',
      scope: 'global',
      status: 'available',
      providerId: 'localmind-db-model-provider',
      modelId: `bounded-chat-${index}`,
    })),
  ]);
  t.is(revision.fallbackSourceChain.length, 16);

  const rows = await db.$queryRaw<Array<{ fallbackSourceChain: unknown }>>`
    SELECT fallback_source_chain AS "fallbackSourceChain"
    FROM ai_model_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.deepEqual(rows[0].fallbackSourceChain, revision.fallbackSourceChain);
});

test('model registry direct publish normalizes model-layer string inputs', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);

  const revision =
    await models.copilotModelRegistryRevision.publishWorkspaceRevision({
      workspaceId: ` ${workspace.id} `,
      actorId: ` ${owner.id} `,
      providerId: ' localmind-db-model-provider ',
      modelId: ' db-office-chat ',
      revision: ' manual-model-direct-bounds ',
      idempotencyKey: ' model-direct-idempotency ',
      modelDefinition: {
        rawModelId: ' direct-db-office-chat-raw ',
        displayName: ' Direct DB chat ',
        aliases: [' direct-chat ', 'direct-chat', ''],
        capabilities: [
          {
            input: [ModelInputType.Text],
            output: [ModelOutputType.Text],
          },
        ],
      },
      fallbackSourceChain: [],
    });

  t.like(revision, {
    actorId: owner.id,
    modelId: 'db-office-chat',
    providerId: 'localmind-db-model-provider',
    revision: 'manual-model-direct-bounds',
    workspaceId: workspace.id,
  });
  t.deepEqual(revision.modelDefinition.aliases, ['direct-chat']);
  t.is(revision.modelDefinition.rawModelId, 'direct-db-office-chat-raw');
});

test('model registry hydrates malformed persisted model definitions safely', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  await db.$executeRaw`
    INSERT INTO ai_model_registry_revisions (
      id,
      provider_id,
      model_id,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      model_definition,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'model-registry-legacy-hydration-row'},
      ${'localmind-db-model-provider'},
      ${'db-office-chat'},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'manual-model-hydration'},
      ${'active'},
      ${'legacy-model-hydration-fp'},
      ${JSON.stringify({
        id: 'wrong-model-id',
        rawModelId: '  hydrated-db-office-chat-raw  ',
        displayName: '  Hydrated DB chat  ',
        aliases: [' hydrated-chat ', 'hydrated-chat', ''],
        secret: 'must-not-hydrate',
        capabilities: [
          {
            input: [ModelInputType.Text],
            output: [ModelOutputType.Text],
          },
          {
            input: ['unknown-input'],
            output: [ModelOutputType.Text],
          },
        ],
      })}::jsonb,
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify({
        version: 'model-registry-revision-legacy-hydration/v1',
      })}::jsonb,
      ${new Date('2026-06-23T03:00:00.000Z')},
      ${new Date('2026-06-23T03:00:00.000Z')}
    )
  `;

  const hydrated = await app.models.copilotModelRegistryRevision.resolve(
    workspace.id,
    'localmind-db-model-provider',
    'db-office-chat'
  );
  t.truthy(hydrated);
  t.is(hydrated?.modelDefinition.id, 'db-office-chat');
  t.is(hydrated?.modelDefinition.rawModelId, 'hydrated-db-office-chat-raw');
  t.is(hydrated?.modelDefinition.displayName, 'Hydrated DB chat');
  t.deepEqual(hydrated?.modelDefinition.aliases, ['hydrated-chat']);
  t.is(hydrated?.modelDefinition.capabilities.length, 1);
  t.false(
    JSON.stringify(hydrated?.modelDefinition).includes('must-not-hydrate')
  );
});

test('model registry repair payload bounds durable string fields', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const overlong = 'x'.repeat(513);
  const metadataLargeStrings = Array.from(
    { length: 40 },
    (_, index) => `${index}-${'m'.repeat(500)}`
  );

  await t.throwsAsync(
    app.models.copilotModelRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: 'model-wrapper-overlong',
      requestFingerprint: overlong,
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'model-registry-revision-executor-payload/v1',
        kind: 'model_registry_revision_publish',
        providerId: 'localmind-db-model-provider',
        modelId: 'db-office-chat',
        rawModelId: 'raw-model',
        aliases: [],
        modelDefinition: {
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
        candidateEvidenceFingerprints: [],
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Model registry publish requires requestFingerprint/,
    }
  );

  const wrapperRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_model_registry_revisions
    WHERE revision = ${'repair-model-wrapper-overlong'}
  `;
  t.deepEqual(wrapperRows, []);

  await t.throwsAsync(
    app.models.copilotModelRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: 'model-metadata-overlarge',
      requestFingerprint: 'request-fingerprint',
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'model-registry-revision-executor-payload/v1',
        kind: 'model_registry_revision_publish',
        providerId: 'localmind-db-model-provider',
        modelId: 'db-office-chat',
        rawModelId: 'raw-model',
        aliases: [],
        modelDefinition: {
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
        candidateEvidenceFingerprints: metadataLargeStrings,
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Model registry publish metadata is too large/,
    }
  );

  const metadataRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_model_registry_revisions
    WHERE revision = ${'repair-model-metadata-overlarge'}
  `;
  t.deepEqual(metadataRows, []);

  await t.throwsAsync(
    app.models.copilotModelRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      executionRequestId: 'model-payload-overlong',
      requestFingerprint: 'request-fingerprint',
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'model-registry-revision-executor-payload/v1',
        kind: 'model_registry_revision_publish',
        providerId: 'localmind-db-model-provider',
        modelId: overlong,
        rawModelId: 'raw-model',
        aliases: [],
        modelDefinition: {
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
          ],
        },
        operationFingerprint: 'operation',
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        targetLocatorFingerprint: 'target-locator',
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
    FROM ai_model_registry_revisions
    WHERE revision = ${'repair-model-payload-overlong'}
  `;
  t.deepEqual(failedRows, []);

  const revision =
    await app.models.copilotModelRegistryRevision.publishWorkspaceRepairRevision(
      {
        workspaceId: ` ${workspace.id} `,
        actorId: ` ${owner.id} `,
        executionRequestId: ' model-payload-normalized ',
        requestFingerprint: ' request-fingerprint ',
        candidateEvidenceSetFingerprint: ' candidate-evidence ',
        taskRouteEvidenceSetFingerprint: ' task-route-evidence ',
        repairJobFingerprint: ' repair-job ',
        approvalRecordFingerprint: ' approval-record ',
        payload: {
          version: 'model-registry-revision-executor-payload/v1',
          kind: 'model_registry_revision_publish',
          providerId: ' localmind-db-model-provider ',
          modelId: ' db-office-chat ',
          rawModelId: ' raw-model ',
          displayName: ' Office Chat ',
          aliases: [' fast-chat ', 'fast-chat', overlong, ''],
          modelDefinition: {
            aliases: [' nested-alias ', 'nested-alias', overlong],
            behaviorFlags: [' flag-one ', 'flag-one', overlong],
            capabilities: [
              {
                input: [ModelInputType.Text],
                output: [ModelOutputType.Text],
              },
            ],
          },
          operationFingerprint: ' operation ',
          operationSetFingerprint: ' operation-set ',
          previewFingerprint: ' preview ',
          catalogFingerprint: ' catalog ',
          targetLocatorFingerprint: ' target-locator ',
          candidateEvidenceFingerprints: [
            ' candidate-one ',
            'candidate-one',
            overlong,
          ],
          fallbackSourceChain: [],
        },
      }
    );

  t.is(revision.providerId, 'localmind-db-model-provider');
  t.is(revision.modelId, 'db-office-chat');
  t.is(revision.workspaceId, workspace.id);
  t.is(revision.actorId, owner.id);
  t.is(revision.revision, 'repair-model-payload-normalized');
  t.deepEqual(revision.modelDefinition.aliases, ['fast-chat']);
  t.deepEqual(revision.modelDefinition.behaviorFlags, ['flag-one']);
  const rows = await db.$queryRaw<
    Array<{
      metadata: {
        candidateEvidenceFingerprints: string[];
        executionRequestId: string;
        requestFingerprint: string;
      };
    }>
  >`
    SELECT metadata
    FROM ai_model_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.like(rows[0].metadata, {
    candidateEvidenceFingerprints: ['candidate-one'],
    executionRequestId: 'model-payload-normalized',
    requestFingerprint: 'request-fingerprint',
  });
});
