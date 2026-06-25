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

const promptCatalogQuery = {
  id: 'promptRegistryRevisionCatalogTestQuery',
  op: 'promptRegistryRevisionCatalog',
  query: `
    query promptRegistryRevisionCatalog($workspaceId: String) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          prompts {
            name
            fingerprint
            modelStrategyFingerprint
            revision
            source
            registryId
            registryFingerprint
            registryRecordSource
            registryRevision
            registryRevisionActorId
            registryRevisionFingerprint
            registryRevisionId
            registryRevisionScope
            registryRevisionStatus
            registryRevisionWorkspaceId
            registrySourceChainFingerprint
            registrySourceChain {
              source
              scope
              status
              revision
              fingerprint
              registryId
              workspaceId
              actorId
              configPath
              updatedAt
            }
            versionEvidence {
              registryRecordSource
              registryRevision
              registryRevisionFingerprint
              registryRevisionScope
              registryRevisionStatus
              registryRevisionWorkspaceId
              registrySourceChainFingerprint
              registrySourceChain {
                source
                scope
                status
                revision
                fingerprint
                registryId
                workspaceId
                actorId
                configPath
                updatedAt
              }
            }
          }
        }
      }
    }
  `,
} satisfies GraphQLQuery;

const promptPublishGateQuery = {
  id: 'promptRegistryRevisionPublishGateTestQuery',
  op: 'promptRegistryRevisionPublishGate',
  query: `
    query promptRegistryRevisionPublishGate($workspaceId: String!, $name: String!) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          promptRegistryPublishGate(name: $name) {
            allowed
            name
            publishStatus
            reason
            registryFingerprint
            registryId
            registryUpdatedAt
            status
            modelRoutes {
              available
              effectiveSourceFingerprint
              requestedModelId
            }
            repairGateManifest {
              fingerprint
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

const promptRegistryPublishMutation = {
  id: 'promptRegistryRevisionPublishTestMutation',
  op: 'publishCopilotPromptRegistryRevision',
  query: `
    mutation promptRegistryRevisionPublish(
      $input: CopilotPromptRegistryPublishInput!
    ) {
      publishCopilotPromptRegistryRevision(input: $input) {
        id
        promptName
        scopeType
        workspaceId
        actorId
        revision
        status
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
          providers: {
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
  await t.context.app.close();
});

async function seedRegistryPrompt(db: PrismaClient, name: string) {
  return await db.aiPrompt.create({
    data: {
      action: 'chat',
      config: {},
      messages: {
        create: [
          {
            content: 'Answer with the DB-backed registry revision prompt.',
            idx: 0,
            role: 'system',
          },
        ],
      },
      model: 'gpt-4o-mini',
      modified: true,
      name,
      optionalModels: [],
      updatedAt: new Date('2026-06-20T10:00:00.000Z'),
    },
  });
}

async function insertRevision(input: {
  db: PrismaClient;
  actorId: string;
  fingerprint: string;
  id: string;
  promptName: string;
  revision: string;
  scopeType: 'global' | 'workspace';
  workspaceId?: string | null;
}) {
  await input.db.$executeRaw`
    INSERT INTO ai_prompt_registry_revisions (
      id,
      prompt_name,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${input.id},
      ${input.promptName},
      ${input.scopeType},
      ${input.workspaceId ?? null},
      ${input.actorId},
      ${input.revision},
      ${'active'},
      ${input.fingerprint},
      ${JSON.stringify([
        {
          source: 'legacy_registry',
          scope: 'global',
          status: 'ready',
          revision: 'legacy-registry-revision',
          fingerprint: 'legacyfeedface0001',
          registryId: 321,
          configPath: 'ai_prompts_metadata',
          updatedAt: '2026-06-20T10:00:00.000Z',
        },
        {
          source: 'config_fallback',
          scope: 'global',
          status: 'available',
          revision: 'config-fallback-revision',
          fingerprint: 'configfeedface0002',
          configPath: 'native_prompt_catalog',
        },
      ])}::jsonb,
      ${JSON.stringify({ version: 'prompt-registry-revision-test/v1' })}::jsonb,
      ${new Date('2026-06-20T10:10:00.000Z')},
      ${new Date('2026-06-20T10:10:00.000Z')}
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

async function insertPromptRegistryRevisionWithDriftedMetadata(input: {
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
    promptName,
    scopeType,
    workspaceId,
    actorId,
    revision,
    status,
    fingerprint,
    fallbackSourceChainJson,
    metadataJson,
    createdAt,
    updatedAt,
  ] = input.values;
  if (
    typeof revisionId !== 'string' ||
    typeof promptName !== 'string' ||
    scopeType !== 'workspace' ||
    typeof workspaceId !== 'string' ||
    typeof actorId !== 'string' ||
    typeof revision !== 'string' ||
    status !== 'active' ||
    typeof fingerprint !== 'string' ||
    typeof fallbackSourceChainJson !== 'string' ||
    typeof metadataJson !== 'string'
  ) {
    throw new Error('Invalid prompt registry revision insert fixture');
  }
  const createdAtDate =
    createdAt instanceof Date ? createdAt : new Date(String(createdAt));
  const updatedAtDate =
    updatedAt instanceof Date ? updatedAt : new Date(String(updatedAt));
  if (
    Number.isNaN(createdAtDate.getTime()) ||
    Number.isNaN(updatedAtDate.getTime())
  ) {
    throw new Error('Invalid prompt registry revision timestamp fixture');
  }
  const fallbackSourceChain = JSON.parse(fallbackSourceChainJson) as unknown;
  const expectedMetadata = JSON.parse(metadataJson) as Record<string, unknown>;
  const driftedMetadata = {
    ...expectedMetadata,
    promptRegistryRevisionConflictFixture: true,
  };

  await input.db.$executeRaw`
    INSERT INTO ai_prompt_registry_revisions (
      id,
      prompt_name,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${revisionId},
      ${promptName},
      ${scopeType},
      ${workspaceId},
      ${actorId},
      ${revision},
      ${status},
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

test('prompt registry DB constraints reject mismatched revision scope and workspace rows', async t => {
  const { db, owner } = t.context;
  const workspace = await createWorkspace(t.context.app);
  const now = new Date('2026-06-22T12:20:00.000Z');
  const promptName = 'Prompt registry invalid scope workspace prompt';
  await seedRegistryPrompt(db, promptName);

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_prompt_registry_revisions (
      id,
      prompt_name,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'prompt-registry-global-with-workspace-row'},
      ${promptName},
      ${'global'},
      ${workspace.id},
      ${owner.id},
      ${'global-with-workspace-row'},
      ${'active'},
      ${'globalworkspace3'},
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(db.$executeRaw`
    INSERT INTO ai_prompt_registry_revisions (
      id,
      prompt_name,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${'prompt-registry-workspace-without-workspace-row'},
      ${promptName},
      ${'workspace'},
      ${null},
      ${owner.id},
      ${'workspace-without-workspace-row'},
      ${'active'},
      ${'workspacewithout3'},
      ${'[]'}::jsonb,
      ${'{}'}::jsonb,
      ${now},
      ${now}
    )
  `);

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_prompt_registry_revisions (
        id,
        prompt_name,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'prompt-registry-invalid-json-shape-row'},
        ${promptName},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-json-shape-row'},
        ${'active'},
        ${'invalidjson333'},
        ${'{}'}::jsonb,
        ${'[]'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_prompt_registry_revisions_json_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_prompt_registry_revisions (
        id,
        prompt_name,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'prompt-registry-invalid-source-chain-provenance-row'},
        ${promptName},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-source-chain-provenance-row'},
        ${'active'},
        ${'invalidsourcechain1'},
        ${JSON.stringify([
          {
            source: 'untrusted_source',
            scope: 'global',
            status: 'ready',
          },
        ])}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_prompt_registry_revisions_source_chain_provenance_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_prompt_registry_revisions (
        id,
        prompt_name,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'prompt-registry-invalid-source-chain-metadata-row'},
        ${promptName},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid-source-chain-metadata-row'},
        ${'active'},
        ${'invalidsourcechain5'},
        ${JSON.stringify([
          {
            source: 'legacy_registry',
            scope: 'global',
            status: 'ready',
            registryId: '321',
          },
        ])}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    {
      message: /ai_prompt_registry_revisions_source_chain_metadata_check/,
    }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_prompt_registry_revisions (
        id,
        prompt_name,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'prompt-registry-invalid-revision-shape-row'},
        ${promptName},
        ${'global'},
        ${null},
        ${owner.id},
        ${'invalid revision shape'},
        ${'active'},
        ${'invalidrevision1'},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_prompt_registry_revisions_revision_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_prompt_registry_revisions (
        id,
        prompt_name,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'prompt-registry-invalid-prompt-name-shape-row'},
        ${'   '},
        ${'global'},
        ${null},
        ${owner.id},
        ${'prompt-name-shape-r1'},
        ${'active'},
        ${'invalidpromptname1'},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_prompt_registry_revisions_prompt_name_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_prompt_registry_revisions (
        id,
        prompt_name,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'prompt-registry-invalid-fingerprint-shape-row'},
        ${promptName},
        ${'global'},
        ${null},
        ${owner.id},
        ${'prompt-fingerprint-shape-r1'},
        ${'active'},
        ${'   '},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${now}
      )
    `,
    { message: /ai_prompt_registry_revisions_fingerprint_shape_check/ }
  );

  await t.throwsAsync(
    db.$executeRaw`
      INSERT INTO ai_prompt_registry_revisions (
        id,
        prompt_name,
        scope_type,
        workspace_id,
        actor_id,
        revision,
        status,
        fingerprint,
        fallback_source_chain,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${'prompt-registry-invalid-timestamp-row'},
        ${promptName},
        ${'global'},
        ${null},
        ${owner.id},
        ${'prompt-timestamp-r1'},
        ${'active'},
        ${'invalidtimestamp1'},
        ${'[]'}::jsonb,
        ${'{}'}::jsonb,
        ${now},
        ${new Date(now.getTime() - 60_000)}
      )
    `,
    {
      message: /ai_prompt_registry_revisions_timestamp_coherence_check/,
    }
  );

  const repairMetadataRowId = 'prompt-registry-repair-metadata-contract-row';
  await db.$executeRaw`
    INSERT INTO ai_prompt_registry_revisions (
      id,
      prompt_name,
      scope_type,
      workspace_id,
      actor_id,
      revision,
      status,
      fingerprint,
      fallback_source_chain,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${repairMetadataRowId},
      ${promptName},
      ${'workspace'},
      ${workspace.id},
      ${owner.id},
      ${'repair-prompt-metadata-contract'},
      ${'active'},
      ${'repairmetadata33'},
      ${'[]'}::jsonb,
      ${JSON.stringify({
        version: 'prompt-registry-revision-repair-executor/v1',
        publishSource: 'repair_execution_worker',
        executionRequestId: 'repair-prompt-metadata-contract',
        requestFingerprint: 'request-fp',
        candidateEvidenceSetFingerprint: 'candidate-fp',
        taskRouteEvidenceSetFingerprint: 'task-route-fp',
        repairJobFingerprint: 'repair-job-fp',
        approvalRecordFingerprint: 'approval-fp',
        expectedRegistryFingerprint: 'expected-registry-fp',
        expectedRegistryId: 1,
        expectedRegistryUpdatedAt: '2026-06-22T12:30:00.000Z',
        operationFingerprints: ['operation-fp'],
        operationKinds: ['replace_prompt'],
        operationSetFingerprint: 'operation-set-fp',
        previewFingerprint: 'preview-fp',
        catalogFingerprint: 'catalog-fp',
      })}::jsonb,
      ${now},
      ${now}
    )
  `;
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_prompt_registry_revisions
      SET metadata = metadata - ${'repairJobFingerprint'}
      WHERE id = ${repairMetadataRowId}
    `,
    {
      message: /ai_prompt_registry_revisions_repair_metadata_evidence_check/,
    }
  );
  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_prompt_registry_revisions
      SET metadata = jsonb_set(
        metadata,
        ${'{operationFingerprints}'}::text[],
        ${'[]'}::jsonb
      )
      WHERE id = ${repairMetadataRowId}
    `,
    {
      message: /ai_prompt_registry_revisions_repair_metadata_evidence_check/,
    }
  );

  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_prompt_registry_revisions
    WHERE id = ANY(${[
      'prompt-registry-global-with-workspace-row',
      'prompt-registry-workspace-without-workspace-row',
      'prompt-registry-invalid-json-shape-row',
      'prompt-registry-invalid-source-chain-provenance-row',
      'prompt-registry-invalid-source-chain-metadata-row',
      'prompt-registry-invalid-revision-shape-row',
      'prompt-registry-invalid-prompt-name-shape-row',
      'prompt-registry-invalid-fingerprint-shape-row',
      'prompt-registry-invalid-timestamp-row',
    ]})
  `;
  t.deepEqual(rows, []);
});

test('catalog exposes workspace DB-backed prompt registry revision before config fallback', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const promptName = 'DB backed registry prompt';
  const prompt = await seedRegistryPrompt(db, promptName);

  await insertRevision({
    db,
    actorId: owner.id,
    fingerprint: 'global111122223333',
    id: 'prompt-revision-global',
    promptName,
    revision: 'global-r1',
    scopeType: 'global',
  });
  await insertRevision({
    db,
    actorId: owner.id,
    fingerprint: 'workspace11112222',
    id: 'prompt-revision-workspace',
    promptName,
    revision: 'workspace-r2',
    scopeType: 'workspace',
    workspaceId: workspace.id,
  });

  const result = await app.gql({
    query: promptCatalogQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const catalogPrompt = result.currentUser.copilot.prompts.find(
    (item: { name: string }) => item.name === promptName
  );

  t.truthy(catalogPrompt);
  t.is(catalogPrompt.registryId, prompt.id);
  t.is(catalogPrompt.registryRecordSource, 'db_revision');
  t.is(catalogPrompt.registryRevision, 'workspace-r2');
  t.is(catalogPrompt.registryRevisionId, 'prompt-revision-workspace');
  t.is(catalogPrompt.registryRevisionScope, 'workspace');
  t.is(catalogPrompt.registryRevisionWorkspaceId, workspace.id);
  t.is(catalogPrompt.registryRevisionActorId, owner.id);
  t.is(catalogPrompt.registryRevisionFingerprint, 'workspace11112222');
  t.is(catalogPrompt.registryRevisionStatus, 'active');
  t.regex(catalogPrompt.registrySourceChainFingerprint, /^[a-f0-9]{16}$/);
  t.deepEqual(
    catalogPrompt.registrySourceChain.map(
      (entry: { source: string; scope: string }) => [entry.source, entry.scope]
    ),
    [
      ['db_revision', 'workspace'],
      ['legacy_registry', 'global'],
      ['config_fallback', 'global'],
    ]
  );
  t.is(
    catalogPrompt.versionEvidence.registryRecordSource,
    catalogPrompt.registryRecordSource
  );
  t.is(
    catalogPrompt.versionEvidence.registryRevisionFingerprint,
    catalogPrompt.registryRevisionFingerprint
  );
  t.is(
    catalogPrompt.versionEvidence.registrySourceChainFingerprint,
    catalogPrompt.registrySourceChainFingerprint
  );
});

test('catalog preserves config fallback when no DB-backed revision exists and enforces workspace access', async t => {
  const { app, db } = t.context;
  const workspace = await createWorkspace(app);
  const promptName = 'Config fallback registry prompt';
  await seedRegistryPrompt(db, promptName);

  const result = await app.gql({
    query: promptCatalogQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const catalogPrompt = result.currentUser.copilot.prompts.find(
    (item: { name: string }) => item.name === promptName
  );

  t.truthy(catalogPrompt);
  t.is(catalogPrompt.registryRecordSource, 'legacy_registry');
  t.is(catalogPrompt.registryRevision, null);
  t.deepEqual(
    catalogPrompt.registrySourceChain.map(
      (entry: { source: string; scope: string }) => [entry.source, entry.scope]
    ),
    [
      ['legacy_registry', 'global'],
      ['config_fallback', 'global'],
    ]
  );

  const outsider = await app.signupV1();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: promptCatalogQuery,
      variables: {
        workspaceId: workspace.id,
      },
    })
  );
});

const promptRegistryPublishTestName = [
  'prompt registry publish mutation writes reviewed workspace revision',
  'and drives catalog diagnostics',
].join(' ');

test('prompt registry revision row conflict rejects mismatched evidence', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const promptRegistryRevisionModel = models.copilotPromptRegistryRevision;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(promptRegistryRevisionModel),
    'db'
  );
  let insertedDriftedRevisionBeforePublish = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertPromptRegistryRevisionWithDriftedMetadata>
  > | null = null;

  try {
    Object.defineProperty(promptRegistryRevisionModel, 'db', {
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
                .includes('INSERT INTO ai_prompt_registry_revisions')
            ) {
              insertedDriftedRevisionBeforePublish = true;
              conflictFixture =
                await insertPromptRegistryRevisionWithDriftedMetadata({
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
      promptRegistryRevisionModel.publishWorkspaceRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        promptName: 'Prompt registry row conflict',
        revision: 'prompt-registry-row-conflict-r1',
        registryFingerprint: 'prompt-registry-row-conflict-fingerprint',
        registryId: 9401,
        registryUpdatedAt: '2026-06-23T10:00:00.000Z',
        gateStatus: 'allowed',
        publishStatus: 'allowed',
        validationReason: 'ready',
        validationIssueCount: 0,
        validationBlockingCount: 0,
        validationErrorCount: 0,
        fallbackSourceChain: [],
      }),
      {
        message:
          /Prompt registry revision conflict reused mismatched row evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        promptRegistryRevisionModel,
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

test('prompt registry repair revision row conflict rejects mismatched evidence', async t => {
  const { app, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const promptRegistryRevisionModel = models.copilotPromptRegistryRevision;
  const originalDbDescriptor = findPropertyDescriptor(
    Object.getPrototypeOf(promptRegistryRevisionModel),
    'db'
  );
  let insertedDriftedRevisionBeforePublish = false;
  let conflictFixture: Awaited<
    ReturnType<typeof insertPromptRegistryRevisionWithDriftedMetadata>
  > | null = null;

  try {
    Object.defineProperty(promptRegistryRevisionModel, 'db', {
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
                .includes('INSERT INTO ai_prompt_registry_revisions')
            ) {
              insertedDriftedRevisionBeforePublish = true;
              conflictFixture =
                await insertPromptRegistryRevisionWithDriftedMetadata({
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
      promptRegistryRevisionModel.publishWorkspaceRepairRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        promptName: 'Prompt repair row conflict',
        executionRequestId: 'prompt-registry-repair-row-conflict',
        requestFingerprint: 'request-fingerprint',
        candidateEvidenceSetFingerprint: 'candidate-evidence',
        taskRouteEvidenceSetFingerprint: 'task-route-evidence',
        repairJobFingerprint: 'repair-job',
        approvalRecordFingerprint: 'approval-record',
        payload: {
          version: 'prompt-registry-revision-executor-payload/v1',
          kind: 'prompt_registry_revision_publish',
          expectedRegistryFingerprint: 'expected-registry',
          expectedRegistryId: 9501,
          expectedRegistryUpdatedAt: '2026-06-23T10:00:00.000Z',
          operationFingerprints: ['operation'],
          operationKinds: ['replace_prompt'],
          operationSetFingerprint: 'operation-set',
          previewFingerprint: 'preview',
          catalogFingerprint: 'catalog',
          fallbackSourceChain: [],
        },
      }),
      {
        message:
          /Prompt registry revision conflict reused mismatched row evidence/,
      }
    );
  } finally {
    if (originalDbDescriptor) {
      Object.defineProperty(
        promptRegistryRevisionModel,
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

test(promptRegistryPublishTestName, async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const promptName = 'Direct publish registry prompt';
  const prompt = await seedRegistryPrompt(db, promptName);

  const gateResult = await app.gql({
    query: promptPublishGateQuery,
    variables: {
      workspaceId: workspace.id,
      name: promptName,
    },
  });
  const gate = gateResult.currentUser.copilot.promptRegistryPublishGate as {
    allowed: boolean;
    registryFingerprint: string;
    registryId: number;
    registryUpdatedAt: string;
  };
  t.true(gate.allowed);
  t.is(gate.registryId, prompt.id);

  const publishResult = await app.gql({
    query: promptRegistryPublishMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        name: promptName,
        expectedVersion: {
          registryFingerprint: gate.registryFingerprint,
          registryId: gate.registryId,
          registryUpdatedAt: gate.registryUpdatedAt,
        },
        revision: 'manual-prompt-r1',
        idempotencyKey: ' prompt-publish-idempotency-1 ',
        reviewNote: ' Reviewed prompt registry route and validation state. ',
      },
    },
  });
  const revision = publishResult.publishCopilotPromptRegistryRevision as {
    actorId: string;
    fallbackSourceChain: Array<{
      source: string;
      status: string;
    }>;
    fingerprint: string;
    id: string;
    publishEventCount: number;
    publishEvents: Array<{
      actorId: string | null;
      eventType: string;
      publishSource: string;
      registryFamily: string;
      registryKey: string;
      revisionId: string;
      workspaceId: string | null;
    }>;
    promptName: string;
    revision: string;
    scopeType: string;
    status: string;
    workspaceId: string;
  };

  t.is(revision.promptName, promptName);
  t.is(revision.scopeType, 'workspace');
  t.is(revision.workspaceId, workspace.id);
  t.is(revision.actorId, owner.id);
  t.is(revision.revision, 'manual-prompt-r1');
  t.is(revision.status, 'active');
  t.regex(revision.fingerprint, /^[a-f0-9]{16}$/);
  t.is(revision.publishEventCount, 1);
  t.like(revision.publishEvents[0], {
    actorId: owner.id,
    eventType: 'revision_published',
    publishSource: 'graphql_mutation',
    registryFamily: 'prompt_registry',
    registryKey: promptName,
    revisionId: revision.id,
    workspaceId: workspace.id,
  });
  t.deepEqual(
    revision.fallbackSourceChain.map(entry => [entry.source, entry.status]),
    [
      ['legacy_registry', 'ready'],
      ['publish_gate_route_review', 'route_ready'],
      ['direct_publish', 'reviewed'],
    ]
  );

  const rows = await db.$queryRaw<
    Array<{
      id: string;
      metadata: Record<string, unknown>;
      workspaceId: string | null;
    }>
  >`
    SELECT
      id,
      metadata,
      workspace_id AS "workspaceId"
    FROM ai_prompt_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.is(rows.length, 1);
  t.is(rows[0].workspaceId, workspace.id);
  t.is(rows[0].metadata.version, 'prompt-registry-revision-direct-publish/v1');
  t.is(rows[0].metadata.publishSource, 'graphql_mutation');
  t.is(rows[0].metadata.registryFingerprint, gate.registryFingerprint);
  t.is(rows[0].metadata.registryId, gate.registryId);
  t.is(
    rows[0].metadata.promptBodyBoundary,
    'legacy_registry_row_reviewed_no_body_copy'
  );
  t.is(
    rows[0].metadata.reviewNote,
    'Reviewed prompt registry route and validation state.'
  );
  t.truthy(rows[0].metadata.idempotencyKeyFingerprint);
  t.regex(rows[0].metadata.reviewFingerprint as string, /^[a-f0-9]{16}$/);

  await t.throwsAsync(
    db.$executeRaw`
      UPDATE ai_prompt_registry_revisions
      SET metadata = jsonb_set(
        metadata,
        ${'{publishSource}'}::text[],
        ${JSON.stringify('repair_execution_worker')}::jsonb
      )
      WHERE id = ${revision.id}
    `,
    {
      message: /ai_prompt_registry_revisions_metadata_contract_check/,
    }
  );

  const duplicateResult = await app.gql({
    query: promptRegistryPublishMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        name: promptName,
        expectedVersion: {
          registryFingerprint: gate.registryFingerprint,
          registryId: gate.registryId,
          registryUpdatedAt: gate.registryUpdatedAt,
        },
        revision: 'manual-prompt-r1',
        idempotencyKey: 'prompt-publish-idempotency-1',
        reviewNote: 'Reviewed prompt registry route and validation state.',
      },
    },
  });
  t.is(duplicateResult.publishCopilotPromptRegistryRevision.id, revision.id);
  t.is(
    duplicateResult.publishCopilotPromptRegistryRevision.publishEventCount,
    2
  );
  t.deepEqual(
    duplicateResult.publishCopilotPromptRegistryRevision.publishEvents.map(
      (event: { eventType: string }) => event.eventType
    ),
    ['revision_reused', 'revision_published']
  );

  const overlong = 'x'.repeat(513);
  await t.throwsAsync(
    app.gql({
      query: promptRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          name: promptName,
          expectedVersion: {
            registryFingerprint: overlong,
            registryId: gate.registryId,
            registryUpdatedAt: gate.registryUpdatedAt,
          },
          revision: 'manual-prompt-overlong-direct',
        },
      },
    })
  );
  const overlongRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_prompt_registry_revisions
    WHERE revision = ${'manual-prompt-overlong-direct'}
  `;
  t.deepEqual(overlongRows, []);

  const catalogResult = await app.gql({
    query: promptCatalogQuery,
    variables: {
      workspaceId: workspace.id,
    },
  });
  const catalogPrompt = catalogResult.currentUser.copilot.prompts.find(
    (item: { name: string }) => item.name === promptName
  );

  t.truthy(catalogPrompt);
  t.is(catalogPrompt.registryRecordSource, 'db_revision');
  t.is(catalogPrompt.registryRevision, 'manual-prompt-r1');
  t.is(catalogPrompt.registryRevisionId, revision.id);
  t.is(catalogPrompt.registryRevisionScope, 'workspace');
  t.is(catalogPrompt.registryRevisionWorkspaceId, workspace.id);
  t.is(catalogPrompt.registryRevisionActorId, owner.id);
  t.is(catalogPrompt.registryRevisionFingerprint, revision.fingerprint);
  t.deepEqual(
    catalogPrompt.registrySourceChain.map(
      (entry: { source: string; scope: string }) => [entry.source, entry.scope]
    ),
    [
      ['db_revision', 'workspace'],
      ['legacy_registry', 'global'],
      ['publish_gate_route_review', 'workspace'],
      ['direct_publish', 'workspace'],
    ]
  );

  const outsider = await app.signupV1();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: promptRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          name: promptName,
          revision: 'manual-prompt-outsider',
        },
      },
    })
  );
});

test('prompt registry model filters unknown fallback source-chain provenance', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const promptName = 'Prompt registry source-chain sanitize';

  const revision =
    await app.models.copilotPromptRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName,
      revision: 'manual-prompt-source-chain',
      registryFingerprint: 'registry-fingerprint-source-chain',
      registryId: 9001,
      registryUpdatedAt: '2026-06-22T10:00:00.000Z',
      gateStatus: 'allowed',
      publishStatus: 'allowed',
      validationReason: 'ready',
      validationIssueCount: 0,
      validationBlockingCount: 0,
      validationErrorCount: 0,
      fallbackSourceChain: [
        {
          source: 'legacy_registry',
          scope: 'global',
          status: 'ready',
          fingerprint: 'legacy-source-chain',
          registryId: 9001,
          actorId: 123 as never,
          configPath: { path: 'ai_prompts_metadata' } as never,
          revision: ['invalid-revision'] as never,
          updatedAt: new Date('2026-06-22T10:00:00.000Z') as never,
          workspaceId: { id: workspace.id } as never,
        },
        {
          source: 'unknown_source',
          scope: 'global',
          status: 'ready',
          fingerprint: 'unknown-source-chain',
        },
        {
          source: 'config_fallback',
          scope: 'invalid_scope',
          status: 'available',
          fingerprint: 'invalid-scope-source-chain',
        },
        {
          source: 'direct_publish',
          scope: 'workspace',
          status: 'untrusted_status',
          fingerprint: 'invalid-status-source-chain',
        },
        ...Array.from({ length: 20 }, (_, index) => ({
          source: 'direct_publish' as const,
          scope: 'workspace' as const,
          status: 'allowed' as const,
          fingerprint: `bounded-prompt-source-${index}`,
        })),
      ],
    });

  t.deepEqual(revision.fallbackSourceChain, [
    {
      source: 'legacy_registry',
      scope: 'global',
      status: 'ready',
      fingerprint: 'legacy-source-chain',
      registryId: 9001,
    },
    ...Array.from({ length: 15 }, (_, index) => ({
      source: 'direct_publish',
      scope: 'workspace',
      status: 'allowed',
      fingerprint: `bounded-prompt-source-${index}`,
    })),
  ]);
  t.is(revision.fallbackSourceChain.length, 16);

  const rows = await db.$queryRaw<Array<{ fallbackSourceChain: unknown }>>`
    SELECT fallback_source_chain AS "fallbackSourceChain"
    FROM ai_prompt_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.deepEqual(rows[0].fallbackSourceChain, revision.fallbackSourceChain);
});

test('prompt registry direct publish normalizes model-layer string inputs', async t => {
  const { app, db, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);

  const revision =
    await models.copilotPromptRegistryRevision.publishWorkspaceRevision({
      workspaceId: ` ${workspace.id} `,
      actorId: ` ${owner.id} `,
      promptName: ' Prompt direct bounds ',
      revision: ' manual-prompt-direct-bounds ',
      idempotencyKey: ' prompt-direct-idempotency ',
      registryFingerprint: ' registry-fingerprint ',
      registryId: 9003,
      registryUpdatedAt: ' 2026-06-22T10:00:00.000Z ',
      gateStatus: ' allowed ',
      publishStatus: ' allowed ',
      validationReason: ' ready ',
      validationIssueCount: 0,
      validationBlockingCount: 0,
      validationErrorCount: 0,
      modelRouteFingerprints: [' model-route ', 'model-route', ''],
      taskRouteFingerprints: [' task-route ', 'task-route', ''],
      fallbackSourceChain: [],
    });

  t.like(revision, {
    actorId: owner.id,
    promptName: 'Prompt direct bounds',
    revision: 'manual-prompt-direct-bounds',
    workspaceId: workspace.id,
  });

  const rows = await db.$queryRaw<
    Array<{
      createdAt: Date;
      eventCreatedAt: Date | null;
      eventType: string | null;
    }>
  >`
    SELECT
      r.created_at AS "createdAt",
      event.event_type AS "eventType",
      event.created_at AS "eventCreatedAt"
    FROM ai_prompt_registry_revisions r
    LEFT JOIN ai_registry_revision_publish_events event
      ON event.revision_id = r.id
      AND event.event_type = ${'revision_published'}
    WHERE r.id = ${revision.id}
  `;
  t.is(rows[0]?.eventType, 'revision_published');
  t.deepEqual(rows[0]?.eventCreatedAt, rows[0]?.createdAt);

  const reused =
    await models.copilotPromptRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName: 'Prompt direct bounds',
      revision: 'manual-prompt-direct-bounds',
      idempotencyKey: 'prompt-direct-idempotency',
      registryFingerprint: 'registry-fingerprint',
      registryId: 9003,
      registryUpdatedAt: '2026-06-22T10:00:00.000Z',
      gateStatus: 'allowed',
      publishStatus: 'allowed',
      validationReason: 'ready',
      validationIssueCount: 0,
      validationBlockingCount: 0,
      validationErrorCount: 0,
      modelRouteFingerprints: ['model-route'],
      taskRouteFingerprints: ['task-route'],
      fallbackSourceChain: [],
    });
  t.deepEqual(
    reused.publishEvents.map(event => event.eventType),
    ['revision_reused', 'revision_published']
  );
  const eventRows = await db.$queryRaw<
    Array<{ createdAt: Date; eventType: string }>
  >`
    SELECT event_type AS "eventType", created_at AS "createdAt"
    FROM ai_registry_revision_publish_events
    WHERE revision_id = ${revision.id}
    ORDER BY
      CASE event_type
        WHEN ${'revision_published'} THEN 0
        WHEN ${'revision_reused'} THEN 1
        ELSE 2
      END ASC,
      created_at ASC,
      id ASC
  `;
  t.is(eventRows[0]?.eventType, 'revision_published');
  t.is(eventRows[1]?.eventType, 'revision_reused');
  t.deepEqual(eventRows[0]?.createdAt, rows[0]?.createdAt);
  t.true(
    (eventRows[1]?.createdAt.getTime() ?? 0) >=
      (rows[0]?.createdAt.getTime() ?? 0)
  );
});

test('prompt registry insert conflict records reuse event when pre-read misses existing revision', async t => {
  const { app, db, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const promptName = 'Prompt insert conflict reuse';
  const publishInput = {
    workspaceId: workspace.id,
    actorId: owner.id,
    promptName,
    revision: 'manual-prompt-conflict-reuse',
    registryFingerprint: 'registry-fingerprint-conflict-reuse',
    registryId: 9005,
    registryUpdatedAt: '2026-06-22T10:00:00.000Z',
    gateStatus: 'allowed',
    publishStatus: 'allowed',
    validationReason: 'ready',
    validationIssueCount: 0,
    validationBlockingCount: 0,
    validationErrorCount: 0,
    fallbackSourceChain: [],
  };

  const revision =
    await models.copilotPromptRegistryRevision.publishWorkspaceRevision(
      publishInput
    );
  t.is(revision.publishEventCount, 1);

  const modelWithPrivateGet =
    models.copilotPromptRegistryRevision as unknown as {
      getWorkspaceRevisionRow(input: {
        promptName: string;
        revision: string;
        workspaceId: string;
      }): Promise<typeof revision | null>;
    };
  const originalGetWorkspaceRevisionRow =
    modelWithPrivateGet.getWorkspaceRevisionRow.bind(
      models.copilotPromptRegistryRevision
    );
  let forcedPreReadMiss = false;
  modelWithPrivateGet.getWorkspaceRevisionRow = async input => {
    if (!forcedPreReadMiss) {
      forcedPreReadMiss = true;
      t.like(input, {
        promptName,
        revision: 'manual-prompt-conflict-reuse',
        workspaceId: workspace.id,
      });
      return null;
    }
    return await originalGetWorkspaceRevisionRow(input);
  };

  try {
    const reused =
      await models.copilotPromptRegistryRevision.publishWorkspaceRevision(
        publishInput
      );
    t.is(reused.id, revision.id);
    t.deepEqual(
      reused.publishEvents.map(event => event.eventType),
      ['revision_reused', 'revision_published']
    );
  } finally {
    modelWithPrivateGet.getWorkspaceRevisionRow =
      originalGetWorkspaceRevisionRow;
  }
  t.true(forcedPreReadMiss);

  const eventCounts = await db.$queryRaw<
    Array<{ count: number; eventType: string }>
  >`
    SELECT event_type AS "eventType", COUNT(*)::int AS count
    FROM ai_registry_revision_publish_events
    WHERE revision_id = ${revision.id}
    GROUP BY event_type
  `;
  const countsByEventType = new Map(
    eventCounts.map(row => [row.eventType, row.count])
  );
  t.is(countsByEventType.get('revision_published'), 1);
  t.is(countsByEventType.get('revision_reused'), 1);
});

test('prompt registry publish event reuse fails closed when revision snapshot changes before insert', async t => {
  const { app, db, owner } = t.context;
  const models = app.get(Models);
  const workspace = await createWorkspace(app);
  const promptName = 'Prompt stale publish event reuse';
  const revision =
    await models.copilotPromptRegistryRevision.publishWorkspaceRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName,
      revision: 'manual-prompt-stale-event-reuse',
      registryFingerprint: 'registry-fingerprint',
      registryId: 9004,
      registryUpdatedAt: '2026-06-22T10:00:00.000Z',
      gateStatus: 'allowed',
      publishStatus: 'allowed',
      validationReason: 'ready',
      validationIssueCount: 0,
      validationBlockingCount: 0,
      validationErrorCount: 0,
      fallbackSourceChain: [],
    });
  t.is(revision.publishEventCount, 1);

  const staleRows = await db.$queryRaw<
    Array<{
      actorId: string | null;
      createdAt: Date;
      fallbackSourceChain: unknown;
      fingerprint: string;
      id: string;
      metadata: unknown;
      promptName: string;
      revision: string;
      scopeType: 'workspace';
      status: 'active';
      updatedAt: Date;
      workspaceId: string | null;
    }>
  >`
    SELECT
      id,
      prompt_name AS "promptName",
      scope_type AS "scopeType",
      workspace_id AS "workspaceId",
      actor_id AS "actorId",
      revision,
      status,
      fingerprint,
      fallback_source_chain AS "fallbackSourceChain",
      metadata,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM ai_prompt_registry_revisions
    WHERE id = ${revision.id}
    LIMIT 1
  `;
  const staleRow = staleRows[0];
  t.truthy(staleRow);

  await db.$executeRaw`
    UPDATE ai_prompt_registry_revisions
    SET updated_at = updated_at + interval '1 second'
    WHERE id = ${revision.id}
  `;

  const modelWithPrivateGet =
    models.copilotPromptRegistryRevision as unknown as {
      getWorkspaceRevisionRow(input: {
        promptName: string;
        revision: string;
        workspaceId: string;
      }): Promise<typeof staleRow | null>;
    };
  const originalGetWorkspaceRevisionRow =
    modelWithPrivateGet.getWorkspaceRevisionRow.bind(
      models.copilotPromptRegistryRevision
    );
  let returnedStaleRevision = false;
  modelWithPrivateGet.getWorkspaceRevisionRow = async input => {
    if (!returnedStaleRevision) {
      returnedStaleRevision = true;
      t.like(input, {
        promptName,
        revision: 'manual-prompt-stale-event-reuse',
        workspaceId: workspace.id,
      });
      return staleRow;
    }
    return await originalGetWorkspaceRevisionRow(input);
  };

  try {
    await t.throwsAsync(
      models.copilotPromptRegistryRevision.publishWorkspaceRevision({
        workspaceId: workspace.id,
        actorId: owner.id,
        promptName,
        revision: 'manual-prompt-stale-event-reuse',
        registryFingerprint: 'registry-fingerprint',
        registryId: 9004,
        registryUpdatedAt: '2026-06-22T10:00:00.000Z',
        gateStatus: 'allowed',
        publishStatus: 'allowed',
        validationReason: 'ready',
        validationIssueCount: 0,
        validationBlockingCount: 0,
        validationErrorCount: 0,
        fallbackSourceChain: [],
      }),
      {
        message:
          /Registry revision publish event could not be recorded because its revision state changed/,
      }
    );
  } finally {
    modelWithPrivateGet.getWorkspaceRevisionRow =
      originalGetWorkspaceRevisionRow;
  }
  t.true(returnedStaleRevision);

  const eventRows = await db.$queryRaw<Array<{ eventType: string }>>`
    SELECT event_type AS "eventType"
    FROM ai_registry_revision_publish_events
    WHERE revision_id = ${revision.id}
    ORDER BY created_at ASC, id ASC
  `;
  t.deepEqual(
    eventRows.map(row => row.eventType),
    ['revision_published']
  );
});

test('prompt registry repair payload bounds durable string fields', async t => {
  const { app, db, owner } = t.context;
  const workspace = await createWorkspace(app);
  const overlong = 'x'.repeat(513);
  const metadataLargeStrings = Array.from(
    { length: 40 },
    (_, index) => `${index}-${'m'.repeat(500)}`
  );

  await t.throwsAsync(
    app.models.copilotPromptRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName: 'Prompt payload bounds',
      executionRequestId: 'prompt-wrapper-overlong',
      requestFingerprint: overlong,
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'prompt-registry-revision-executor-payload/v1',
        kind: 'prompt_registry_revision_publish',
        expectedRegistryFingerprint: 'expected-registry',
        expectedRegistryId: 9002,
        expectedRegistryUpdatedAt: '2026-06-22T10:00:00.000Z',
        operationFingerprints: [],
        operationKinds: [],
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Prompt registry publish requires requestFingerprint/,
    }
  );

  const wrapperRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_prompt_registry_revisions
    WHERE revision = ${'repair-prompt-wrapper-overlong'}
  `;
  t.deepEqual(wrapperRows, []);

  await t.throwsAsync(
    app.models.copilotPromptRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName: 'Prompt payload bounds',
      executionRequestId: 'prompt-metadata-overlarge',
      requestFingerprint: 'request-fingerprint',
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'prompt-registry-revision-executor-payload/v1',
        kind: 'prompt_registry_revision_publish',
        expectedRegistryFingerprint: 'expected-registry',
        expectedRegistryId: 9002,
        expectedRegistryUpdatedAt: '2026-06-22T10:00:00.000Z',
        operationFingerprints: metadataLargeStrings,
        operationKinds: metadataLargeStrings,
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        fallbackSourceChain: [],
      },
    }),
    {
      message: /Prompt registry publish metadata is too large/,
    }
  );

  const metadataRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_prompt_registry_revisions
    WHERE revision = ${'repair-prompt-metadata-overlarge'}
  `;
  t.deepEqual(metadataRows, []);

  await t.throwsAsync(
    app.models.copilotPromptRegistryRevision.publishWorkspaceRepairRevision({
      workspaceId: workspace.id,
      actorId: owner.id,
      promptName: 'Prompt payload bounds',
      executionRequestId: 'prompt-payload-overlong',
      requestFingerprint: 'request-fingerprint',
      candidateEvidenceSetFingerprint: 'candidate-evidence',
      taskRouteEvidenceSetFingerprint: 'task-route-evidence',
      repairJobFingerprint: 'repair-job',
      approvalRecordFingerprint: 'approval-record',
      payload: {
        version: 'prompt-registry-revision-executor-payload/v1',
        kind: 'prompt_registry_revision_publish',
        expectedRegistryFingerprint: overlong,
        expectedRegistryId: 9002,
        expectedRegistryUpdatedAt: '2026-06-22T10:00:00.000Z',
        operationFingerprints: [],
        operationKinds: [],
        operationSetFingerprint: 'operation-set',
        previewFingerprint: 'preview',
        catalogFingerprint: 'catalog',
        fallbackSourceChain: [],
      },
    }),
    {
      message:
        /Invalid repair execution executor payload field: expectedRegistryFingerprint/,
    }
  );

  const failedRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM ai_prompt_registry_revisions
    WHERE revision = ${'repair-prompt-payload-overlong'}
  `;
  t.deepEqual(failedRows, []);

  const revision =
    await app.models.copilotPromptRegistryRevision.publishWorkspaceRepairRevision(
      {
        workspaceId: ` ${workspace.id} `,
        actorId: ` ${owner.id} `,
        promptName: ' Prompt payload bounds ',
        executionRequestId: ' prompt-payload-normalized ',
        requestFingerprint: ' request-fingerprint ',
        candidateEvidenceSetFingerprint: ' candidate-evidence ',
        taskRouteEvidenceSetFingerprint: ' task-route-evidence ',
        repairJobFingerprint: ' repair-job ',
        approvalRecordFingerprint: ' approval-record ',
        payload: {
          version: 'prompt-registry-revision-executor-payload/v1',
          kind: 'prompt_registry_revision_publish',
          expectedRegistryFingerprint: ' expected-registry ',
          expectedRegistryId: 9002,
          expectedRegistryUpdatedAt: ' 2026-06-22T10:00:00.000Z ',
          operationFingerprints: [
            ' operation-one ',
            'operation-one',
            overlong,
            '',
          ],
          operationKinds: [' replace_prompt ', 'replace_prompt', overlong],
          operationSetFingerprint: ' operation-set ',
          previewFingerprint: ' preview ',
          catalogFingerprint: ' catalog ',
          fallbackSourceChain: [],
        },
      }
    );

  const rows = await db.$queryRaw<
    Array<{
      metadata: {
        executionRequestId: string;
        expectedRegistryFingerprint: string;
        expectedRegistryUpdatedAt: string;
        operationFingerprints: string[];
        operationKinds: string[];
        requestFingerprint: string;
      };
    }>
  >`
    SELECT metadata
    FROM ai_prompt_registry_revisions
    WHERE id = ${revision.id}
  `;
  t.is(revision.promptName, 'Prompt payload bounds');
  t.is(revision.workspaceId, workspace.id);
  t.is(revision.actorId, owner.id);
  t.is(revision.revision, 'repair-prompt-payload-normalized');
  t.like(rows[0].metadata, {
    executionRequestId: 'prompt-payload-normalized',
    expectedRegistryFingerprint: 'expected-registry',
    expectedRegistryUpdatedAt: '2026-06-22T10:00:00.000Z',
    operationFingerprints: ['operation-one'],
    operationKinds: ['replace_prompt'],
    requestFingerprint: 'request-fingerprint',
  });
});

test('prompt registry publish rejects stale or blocked publish gates without writing revisions', async t => {
  const { app, db } = t.context;
  const workspace = await createWorkspace(app);
  const stalePromptName = 'Stale publish registry prompt';
  const blockedPromptName = 'Blocked publish registry prompt';
  await seedRegistryPrompt(db, stalePromptName);
  await db.aiPrompt.create({
    data: {
      action: 'chat',
      config: {},
      model: 'gpt-4o-mini',
      modified: true,
      name: blockedPromptName,
      optionalModels: [],
      updatedAt: new Date('2026-06-20T11:00:00.000Z'),
    },
  });

  const gateResult = await app.gql({
    query: promptPublishGateQuery,
    variables: {
      workspaceId: workspace.id,
      name: stalePromptName,
    },
  });
  const gate = gateResult.currentUser.copilot.promptRegistryPublishGate as {
    registryFingerprint: string;
    registryId: number;
    registryUpdatedAt: string;
  };

  await t.throwsAsync(
    app.gql({
      query: promptRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          name: stalePromptName,
          expectedVersion: {
            registryFingerprint: 'stale0000000000',
            registryId: gate.registryId,
            registryUpdatedAt: gate.registryUpdatedAt,
          },
          revision: 'manual-prompt-stale',
        },
      },
    })
  );

  await t.throwsAsync(
    app.gql({
      query: promptRegistryPublishMutation,
      variables: {
        input: {
          workspaceId: workspace.id,
          name: blockedPromptName,
          revision: 'manual-prompt-blocked',
        },
      },
    })
  );

  const rows = await db.$queryRaw<Array<{ revision: string }>>`
    SELECT revision
    FROM ai_prompt_registry_revisions
    WHERE revision = ANY(${['manual-prompt-stale', 'manual-prompt-blocked']})
  `;
  t.deepEqual(rows, []);
});
