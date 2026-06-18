import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { ProjectRoot } from '@affine-tools/utils/path';
import { PrismaClient } from '@prisma/client';
import type { TestFn } from 'ava';
import ava from 'ava';
import { nanoid } from 'nanoid';
import Sinon from 'sinon';

import {
  EventBus,
  JobQueue,
  RequestMutex,
  SpaceAccessDenied,
} from '../../base';
import { ConfigModule } from '../../base/config';
import { AuthService } from '../../core/auth';
import { QuotaModule } from '../../core/quota';
import { QuotaStateService } from '../../core/quota/state';
import { StorageModule, WorkspaceBlobStorage } from '../../core/storage';
import {
  ContextCategories,
  CopilotSessionModel,
  EMBEDDING_DIMENSIONS,
  Models,
  WorkspaceMemberStatus,
  WorkspaceModel,
  WorkspaceRole,
} from '../../models';
import { CopilotModule } from '../../plugins/copilot';
import { CopilotContextService } from '../../plugins/copilot/context';
import { CopilotContextResolver } from '../../plugins/copilot/context/resolver';
import {
  chatMessageFromTurn,
  turnFromChatMessage,
} from '../../plugins/copilot/core';
import { CopilotCronJobs } from '../../plugins/copilot/cron';
import {
  CopilotEmbeddingClientService,
  CopilotEmbeddingJob,
  MockEmbeddingClient,
} from '../../plugins/copilot/embedding';
import { PromptService } from '../../plugins/copilot/prompt';
import {
  CopilotProviderFactory,
  CopilotProviderType,
  ModelInputType,
  ModelOutputType,
  OpenAIProvider,
} from '../../plugins/copilot/providers';
import { TextStreamParser } from '../../plugins/copilot/providers/utils';
import { CopilotResolver } from '../../plugins/copilot/resolver';
import { ActionRuntimeBridge } from '../../plugins/copilot/runtime/action-runtime-bridge';
import { CapabilityRuntime } from '../../plugins/copilot/runtime/capability-runtime';
import {
  parsePromptRenderContract,
  parsePromptSessionContract,
} from '../../plugins/copilot/runtime/contracts';
import { projectActionEventToChatEvent } from '../../plugins/copilot/runtime/hosts/action-stream-host';
import { CapabilityPolicyHost } from '../../plugins/copilot/runtime/hosts/capability-policy-host';
import { ConversationHost } from '../../plugins/copilot/runtime/hosts/conversation-host';
import { ImageResultHost } from '../../plugins/copilot/runtime/hosts/image-result-host';
import { ModelSelectionPolicy } from '../../plugins/copilot/runtime/model-selection-policy';
import { PromptRuntime } from '../../plugins/copilot/runtime/prompt-runtime';
import { getProviderRuntimeHost } from '../../plugins/copilot/runtime/provider-runtime-context';
import { TaskPolicy } from '../../plugins/copilot/runtime/task-policy';
import { TurnOrchestrator } from '../../plugins/copilot/runtime/turn-orchestrator';
import { ChatSession, ChatSessionService } from '../../plugins/copilot/session';
import { CopilotStorage } from '../../plugins/copilot/storage';
import { CopilotTranscriptionService } from '../../plugins/copilot/transcript';
import { CopilotWorkspaceService } from '../../plugins/copilot/workspace';
import { PaymentModule } from '../../plugins/payment';
import { SubscriptionService } from '../../plugins/payment/service';
import { SubscriptionStatus } from '../../plugins/payment/types';
import { installMockCopilotRuntime, MockCopilotProvider } from '../mocks';
import { TestingPromptService } from '../mocks/prompt-service.mock';
import { createTestingModule, TestingModule } from '../utils';
import { singleUserPromptMessages, systemPrompt } from './prompt-test-helper';

type Context = {
  auth: AuthService;
  module: TestingModule;
  db: PrismaClient;
  event: EventBus;
  models: Models;
  workspace: WorkspaceModel;
  workspaceStorage: WorkspaceBlobStorage;
  copilotSession: CopilotSessionModel;
  context: CopilotContextService;
  prompt: TestingPromptService;
  transcript: CopilotTranscriptionService;
  workspaceEmbedding: CopilotWorkspaceService;
  factory: CopilotProviderFactory;
  session: ChatSessionService;
  taskPolicy: TaskPolicy;
  promptRuntime: PromptRuntime;
  chatRuntime: CapabilityRuntime;
  conversationHost: ConversationHost;
  embeddingClients: CopilotEmbeddingClientService;
  jobs: CopilotEmbeddingJob;
  imageResults: ImageResultHost;
  orchestrator: TurnOrchestrator;
  storage: CopilotStorage;
  actionBridge: ActionRuntimeBridge;
  cronJobs: CopilotCronJobs;
  subscription: SubscriptionService;
  quotaState: QuotaStateService;
};

const buildTurn = (
  sessionId: string,
  message: Parameters<typeof turnFromChatMessage>[0]
) => turnFromChatMessage(message, sessionId);

const cleanSnapshotObject = (obj: unknown, omittedKeys: string[] = []) =>
  JSON.parse(
    JSON.stringify(obj, (k, v) =>
      ['id', 'createdAt', ...omittedKeys].includes(k) ||
      v === null ||
      (typeof v === 'object' && !Object.keys(v).length)
        ? undefined
        : v
    )
  );

const cleanFinalMessages = (messages: unknown) =>
  cleanSnapshotObject(messages, ['attachments']);

function taskRouteTargetFingerprintFixture(input: {
  featureKind: string;
  targets: string[];
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        featureKind: input.featureKind,
        targets: input.targets,
      })
    )
    .digest('hex')
    .slice(0, 16);
}

const test = ava as TestFn<Context>;
let userId: string;
let restoreMockCopilotNativeRuntime: (() => void) | undefined;

test.before(async t => {
  restoreMockCopilotNativeRuntime = installMockCopilotRuntime();
  const module = await createTestingModule({
    imports: [
      ConfigModule.override({
        copilot: {
          providers: {
            openai: {
              apiKey: process.env.COPILOT_OPENAI_API_KEY ?? '1',
            },
            fal: {
              apiKey: process.env.COPILOT_FAL_API_KEY ?? '1',
            },
            anthropic: {
              apiKey: process.env.COPILOT_ANTHROPIC_API_KEY ?? '1',
            },
          },
          exa: {
            key: process.env.COPILOT_EXA_API_KEY ?? '1',
          },
        },
      }),
      PaymentModule,
      QuotaModule,
      StorageModule,
      CopilotModule,
    ],
    tapModule: builder => {
      // use real JobQueue for testing
      builder.overrideProvider(JobQueue).useClass(JobQueue);
      builder.overrideProvider(RequestMutex).useValue({
        acquire: async () => ({
          async [Symbol.asyncDispose]() {},
        }),
      });
      builder.overrideProvider(PromptService).useClass(TestingPromptService);
      builder.overrideProvider(OpenAIProvider).useClass(MockCopilotProvider);
      builder.overrideProvider(SubscriptionService).useClass(
        class {
          select() {
            return { getSubscription: async () => undefined };
          }
        }
      );
    },
  });

  const auth = module.get(AuthService);
  const db = module.get(PrismaClient);
  const event = module.get(EventBus);
  const models = module.get(Models);
  const workspace = module.get(WorkspaceModel);
  const workspaceStorage = module.get(WorkspaceBlobStorage);
  const copilotSession = module.get(CopilotSessionModel);
  const prompt = module.get(PromptService) as TestingPromptService;
  const factory = module.get(CopilotProviderFactory);

  const session = module.get(ChatSessionService);
  const taskPolicy = module.get(TaskPolicy);
  const promptRuntime = module.get(PromptRuntime);
  const chatRuntime = module.get(CapabilityRuntime);
  const conversationHost = module.get(ConversationHost);
  const imageResults = module.get(ImageResultHost);
  const orchestrator = module.get(TurnOrchestrator);
  const actionBridge = module.get(ActionRuntimeBridge);
  const storage = module.get(CopilotStorage);

  const context = module.get(CopilotContextService);
  const embeddingClients = module.get(CopilotEmbeddingClientService);
  const jobs = module.get(CopilotEmbeddingJob);
  const transcript = module.get(CopilotTranscriptionService);
  const workspaceEmbedding = module.get(CopilotWorkspaceService);
  const cronJobs = module.get(CopilotCronJobs);
  const subscription = module.get(SubscriptionService);
  const quotaState = module.get(QuotaStateService);

  t.context.module = module;
  t.context.auth = auth;
  t.context.db = db;
  t.context.event = event;
  t.context.models = models;
  t.context.workspace = workspace;
  t.context.workspaceStorage = workspaceStorage;
  t.context.copilotSession = copilotSession;
  t.context.prompt = prompt;
  t.context.factory = factory;
  t.context.session = session;
  t.context.taskPolicy = taskPolicy;
  t.context.promptRuntime = promptRuntime;
  t.context.chatRuntime = chatRuntime;
  t.context.conversationHost = conversationHost;
  t.context.imageResults = imageResults;
  t.context.orchestrator = orchestrator;
  t.context.actionBridge = actionBridge;
  t.context.storage = storage;
  t.context.context = context;
  t.context.embeddingClients = embeddingClients;
  t.context.jobs = jobs;
  t.context.transcript = transcript;
  t.context.workspaceEmbedding = workspaceEmbedding;
  t.context.cronJobs = cronJobs;
  t.context.subscription = subscription;
  t.context.quotaState = quotaState;

  await module.initTestingDB();
});

let promptName = 'prompt';

test.beforeEach(async t => {
  Sinon.restore();
  const { auth, prompt } = t.context;
  prompt.reset();
  const user = await auth.signUp(`test-${randomUUID()}@affine.pro`, '123456');
  userId = user.id;
  promptName = randomUUID().replaceAll('-', '');
});

test.after.always(async t => {
  restoreMockCopilotNativeRuntime?.();
  await t.context.module?.close();
});

test('should reject context file uploads after workspace write access is revoked', async t => {
  const { auth, context, models, prompt, session, storage, workspace } =
    t.context;
  const contextResolver = await t.context.module.resolve(
    CopilotContextResolver
  );

  const owner = await auth.signUp(`test-${randomUUID()}@affine.pro`, '123456');
  const member = await auth.signUp(`test-${randomUUID()}@affine.pro`, '123456');
  const ws = await workspace.create(owner.id);

  await models.workspaceUser.set(ws.id, member.id, WorkspaceRole.Collaborator, {
    status: WorkspaceMemberStatus.Accepted,
  });
  await prompt.set(promptName, 'test', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  const sessionId = await session.create({
    userId: member.id,
    workspaceId: ws.id,
    docId: randomUUID(),
    promptName,
    pinned: false,
  });
  const contextSession = await context.create(sessionId);
  await models.workspaceUser.set(ws.id, member.id, WorkspaceRole.External);

  Sinon.stub(context, 'canEmbedding').get(() => true);
  Sinon.stub(context, 'embeddingClient').get(() => new MockEmbeddingClient());
  const put = Sinon.stub(storage, 'put').resolves();
  const buffer = Buffer.from('test pdf');

  await t.throwsAsync(
    contextResolver.addContextFile(
      { id: member.id } as any,
      {
        req: {
          headers: {
            'content-length': String(buffer.length),
          },
        },
      } as any,
      { contextId: contextSession.id },
      {
        filename: 'sample.pdf',
        mimetype: 'application/pdf',
        createReadStream: () => Readable.from(buffer),
      } as any
    ),
    {
      instanceOf: SpaceAccessDenied,
    }
  );

  t.false(put.called);
});

test('should prioritize user-added context file embedding jobs', async t => {
  const { context, jobs, prompt, session, storage, workspace } = t.context;
  const contextResolver = await t.context.module.resolve(
    CopilotContextResolver
  );

  const ws = await workspace.create(userId);
  await prompt.set(promptName, 'test', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  const sessionId = await session.create({
    userId,
    workspaceId: ws.id,
    docId: randomUUID(),
    promptName,
    pinned: false,
  });
  const contextSession = await context.create(sessionId);

  Sinon.stub(context, 'canEmbedding').get(() => true);
  Sinon.stub(context, 'embeddingClient').get(() => new MockEmbeddingClient());
  const put = Sinon.stub(storage, 'put').resolves();
  const queue = Sinon.stub(jobs, 'addFileEmbeddingQueue').resolves();
  const buffer = Buffer.from('test pdf');

  await contextResolver.addContextFile(
    { id: userId } as any,
    {
      req: {
        headers: {
          'content-length': String(buffer.length),
        },
      },
    } as any,
    { contextId: contextSession.id },
    {
      filename: 'sample.pdf',
      mimetype: 'application/pdf',
      createReadStream: () => Readable.from(buffer),
    } as any
  );

  t.true(put.calledOnce);
  t.true(queue.calledOnce);
  t.deepEqual(queue.firstCall.args[0], {
    userId,
    workspaceId: ws.id,
    contextId: contextSession.id,
    blobId: createHash('sha256').update(buffer).digest('base64url'),
    fileId: queue.firstCall.args[0].fileId,
    fileName: 'sample.pdf',
  });
  t.deepEqual(queue.firstCall.args[1], { priority: 0 });
});

test('should resolve context sessions with the shared embedding client', async t => {
  const { context, embeddingClients, prompt, session, workspace } = t.context;

  const ws = await workspace.create(userId);
  await prompt.set(promptName, 'test', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  const sessionId = await session.create({
    userId,
    workspaceId: ws.id,
    docId: randomUUID(),
    promptName,
    pinned: false,
  });
  const client = new MockEmbeddingClient();

  Sinon.stub(embeddingClients, 'refresh').resolves(undefined);
  Sinon.stub(embeddingClients, 'getClient').returns(client);
  await context.onConfigChanged();

  const contextSession = await context.create(sessionId);
  t.is(context.embeddingClient, client);
  await t.notThrowsAsync(context.get(contextSession.id));
});

test('should be able to render prompt', async t => {
  const { prompt } = t.context;

  const msg = {
    role: 'system' as const,
    content: 'translate {{src_language}} to {{dest_language}}: {{content}}',
    params: { src_language: ['eng'], dest_language: ['chs', 'jpn', 'kor'] },
  };
  const params = {
    src_language: 'eng',
    dest_language: 'chs',
    content: 'hello world',
  };

  await prompt.set(promptName, 'test', [msg]);
  const testPrompt = await prompt.get(promptName);
  t.assert(testPrompt, 'should have prompt');
  t.is(
    prompt.finish(testPrompt!, params).pop()?.content,
    'translate eng to chs: hello world',
    'should render the prompt'
  );
  t.deepEqual(
    testPrompt?.paramKeys,
    Object.keys(params),
    'should have param keys'
  );
  t.deepEqual(testPrompt?.params, msg.params, 'should have params');
  // will use first option if a params not provided
  t.deepEqual(prompt.finish(testPrompt!, { src_language: 'abc' }), [
    {
      content: 'translate eng to chs: ',
      params: { dest_language: 'chs', src_language: 'eng' },
      role: 'system',
    },
  ]);
});

test('should be able to render listed prompt', async t => {
  const { prompt } = t.context;

  const msg = {
    role: 'system' as const,
    content: 'links:\n{{#links}}- {{.}}\n{{/links}}',
  };
  const params = {
    links: ['https://affine.pro', 'https://github.com/toeverything/affine'],
  };

  await prompt.set(promptName, 'test', [msg]);
  const testPrompt = await prompt.get(promptName);

  t.is(
    prompt.finish(testPrompt!, params).pop()?.content,
    'links:\n- https://affine.pro\n- https://github.com/toeverything/affine\n',
    'should render the prompt'
  );
});

test('PromptContract should preserve render/session payloads and reject legacy aliases', t => {
  const render = parsePromptRenderContract({
    messages: [
      {
        role: 'system',
        content: 'Return JSON only.',
        responseFormat: {
          type: 'json_schema',
          responseSchemaJson: {
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: ['summary'],
          },
          schemaHash: 'schema-hash',
        },
      },
    ],
    templateParams: {},
    renderParams: { tone: 'brief' },
  });

  t.deepEqual(
    { messages: render.messages, warnings: [] },
    {
      messages: render.messages,
      warnings: [],
    }
  );

  const session = parsePromptSessionContract({
    prompt: {
      model: 'gpt-5-mini',
      promptTokens: 12,
      templateParams: {},
      messages: [systemPrompt('Return JSON only.')],
    },
    turns: singleUserPromptMessages('hello'),
    renderParams: { tone: 'brief' },
    maxTokenSize: 1024,
  });

  t.is(session.prompt.model, 'gpt-5-mini');

  const error = t.throws(() =>
    parsePromptRenderContract({
      messages: [
        {
          role: 'system',
          content: 'Return JSON only.',
          responseFormat: {
            type: 'json_schema',
            schemaJson: { type: 'object' },
            schemaHash: 'schema-hash',
          },
        },
      ],
      templateParams: {},
      renderParams: {},
    })
  );

  t.truthy(error);
});

test('capability runtime should require explicit structured schema contract', async t => {
  const runtime = new CapabilityRuntime({} as never, {} as never);

  const error = await t.throwsAsync(() =>
    runtime.generateStructuredValue(
      { modelId: 'gpt-5-mini' },
      singleUserPromptMessages('Summarize AFFiNE.'),
      {
        responseSchemaJson: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
          additionalProperties: false,
        },
      }
    )
  );

  t.true(error instanceof Error);
  t.regex(error.message, /Structured schema contract is required/);
});

// ==================== session ====================

test('should be able to manage chat session', async t => {
  const { prompt, session } = t.context;

  await prompt.set(promptName, 'model', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  const params = { word: 'world' };
  const commonParams = { docId: 'test', workspaceId: 'test', pinned: false };

  const sessionId = await session.create({
    userId,
    promptName,
    ...commonParams,
  });
  t.truthy(sessionId, 'should create session');

  const s = (await session.get(sessionId))!;
  t.is(s.config.sessionId, sessionId, 'should get session');
  t.is(s.config.promptName, promptName, 'should have prompt name');
  t.is(s.model, 'model', 'should have model');

  s.pushTurn(
    buildTurn(sessionId, {
      role: 'user',
      content: 'hello',
      createdAt: new Date(),
    })
  );

  const finalMessages = cleanFinalMessages(s.finish(params));
  t.snapshot(finalMessages, 'should generate the final message');
  await s.save();

  const s1 = (await session.get(sessionId))!;
  t.deepEqual(
    cleanFinalMessages(s1.finish(params)),
    finalMessages,
    'should same as before message'
  );
  t.snapshot(
    cleanFinalMessages(s1.finish(params)),
    'should generate different message with another params'
  );

  // should get main session after fork if re-create a chat session for same docId and workspaceId
  {
    const newSessionId = await session.create({
      userId,
      promptName,
      ...commonParams,
    });
    t.is(newSessionId, sessionId, 'should get same session id');
  }

  // should create a fresh session when reuseLatestChat is explicitly disabled
  {
    const newSessionId = await session.create({
      userId,
      promptName,
      ...commonParams,
      reuseLatestChat: false,
    });
    t.not(
      newSessionId,
      sessionId,
      'should create new session id when reuseLatestChat is false'
    );
  }
});

test('chat session should cap prompt render budget by model context window', t => {
  const prompt = {
    name: `context-window-${randomUUID()}`,
    model: 'local-chat',
    modelSource: 'compat',
    optionalModels: [],
    optionalModelsSource: 'compat',
    paramKeys: [],
    params: {},
    source: 'compat',
    category: 'text',
    proModelsSource: 'compat',
    overrideApplied: false,
    messages: [{ role: 'system' as const, content: 'hello' }],
    config: { maxTokens: 8192 },
  };
  const capturedBudgets: number[] = [];
  const session = new ChatSession(
    {
      userId,
      sessionId: randomUUID(),
      workspaceId: 'workspace-1',
      docId: 'doc-1',
      turns: [],
      prompt,
    },
    (_prompt, _turns, _params, maxTokenSize) => {
      capturedBudgets.push(maxTokenSize);
      return [];
    }
  );

  session.finish({}, { contextWindow: 4096 });
  session.finish({}, { contextWindow: 16384 });
  session.finish({});

  t.deepEqual(capturedBudgets, [4096, 8192, 8192]);
});

test('should be able to update chat session prompt', async t => {
  const { prompt, session } = t.context;

  // Set up a prompt to be used in the session
  await prompt.set(promptName, 'model', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  // Create a session
  const sessionId = await session.create({
    promptName,
    docId: 'test',
    workspaceId: 'test',
    userId,
    pinned: false,
  });
  t.truthy(sessionId, 'should create session');

  // Update the session
  const updatedSessionId = await session.update({
    sessionId,
    promptName: 'Chat With AFFiNE AI',
    userId,
  });
  t.is(updatedSessionId, sessionId, 'should update session with same id');

  // Verify the session was updated
  const updatedSession = await session.get(sessionId);
  t.truthy(updatedSession, 'should retrieve updated session');
  t.is(
    updatedSession?.config.promptName,
    'Chat With AFFiNE AI',
    'should have updated prompt name'
  );
});

test('should be able to fork chat session', async t => {
  const { auth, prompt, session } = t.context;

  await prompt.set(promptName, 'model', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  const params = { word: 'world' };
  const commonParams = { docId: 'test', workspaceId: 'test', pinned: false };
  // create session
  const sessionId = await session.create({
    userId,
    promptName,
    ...commonParams,
  });
  const s = (await session.get(sessionId))!;
  s.pushTurn(
    buildTurn(sessionId, {
      role: 'user',
      content: 'hello',
      createdAt: new Date(),
    })
  );
  s.pushTurn(
    buildTurn(sessionId, {
      role: 'assistant',
      content: 'world',
      createdAt: new Date(),
    })
  );
  s.pushTurn(
    buildTurn(sessionId, {
      role: 'user',
      content: 'aaa',
      createdAt: new Date(),
    })
  );
  s.pushTurn(
    buildTurn(sessionId, {
      role: 'assistant',
      content: 'bbb',
      createdAt: new Date(),
    })
  );
  await s.save();

  // fork session
  const latestMessageId = (await session.getState(sessionId))?.turns.find(
    turn => turn.role === 'assistant'
  )?.id;
  t.truthy(latestMessageId);
  const forkedSessionId1 = await session.fork({
    userId,
    sessionId,
    latestMessageId: latestMessageId!,
    ...commonParams,
  });
  t.not(sessionId, forkedSessionId1, 'should fork a new session');

  const newUser = await auth.signUp('darksky.1@affine.pro', '123456');
  const forkedSessionId2 = await session.fork({
    userId: newUser.id,
    sessionId,
    latestMessageId: latestMessageId!,
    ...commonParams,
  });
  t.not(
    forkedSessionId1,
    forkedSessionId2,
    'should fork new session with same params'
  );

  // fork session without latestMessageId
  const forkedSessionId3 = await session.fork({
    userId,
    sessionId,
    ...commonParams,
  });

  // fork session with wrong latestMessageId
  await t.throwsAsync(
    session.fork({
      userId,
      sessionId,
      latestMessageId: 'wrong-message-id',
      ...commonParams,
    }),
    {
      instanceOf: Error,
    },
    'should not able to fork new session with wrong latestMessageId'
  );

  // check forked session messages
  {
    const s2 = (await session.get(forkedSessionId1))!;

    const finalMessages = s2.finish(params);
    t.snapshot(
      cleanSnapshotObject(finalMessages),
      'should generate the final message'
    );
  }

  // check second times forked session
  {
    const s2 = (await session.get(forkedSessionId2))!;

    // should overwrite user id
    t.is(s2.config.userId, newUser.id, 'should have same user id');

    const finalMessages = s2.finish(params);
    t.snapshot(
      cleanSnapshotObject(finalMessages),
      'should generate the final message'
    );
  }

  // check third times forked session
  {
    const s3 = (await session.get(forkedSessionId3))!;
    const finalMessages = s3.finish(params);
    t.snapshot(
      cleanSnapshotObject(finalMessages),
      'should generate the final message'
    );
  }

  // check original session messages
  {
    const s4 = (await session.get(sessionId))!;
    const finalMessages = s4.finish(params);
    t.snapshot(
      cleanSnapshotObject(finalMessages),
      'should generate the final message'
    );
  }

  // should get main session after fork if re-create a chat session for same docId and workspaceId
  {
    const newSessionId = await session.create({
      userId,
      promptName,
      ...commonParams,
    });
    t.is(newSessionId, sessionId, 'should get same session id');
  }
});

test('should schedule title generation as a background job', async t => {
  const { prompt, session, module, workspace } = t.context;
  const jobs = module.get(JobQueue);

  const ws = await workspace.create(userId);
  await prompt.set(promptName, 'model', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  const sessionId = await session.create({
    userId,
    promptName,
    docId: 'test',
    workspaceId: ws.id,
    pinned: false,
  });
  const chatSession = await session.get(sessionId);
  t.truthy(chatSession);

  const addJob = Sinon.stub(jobs, 'add').resolves();

  chatSession!.pushTurn(
    buildTurn(sessionId, {
      role: 'user',
      content: 'hello',
      createdAt: new Date(),
    })
  );
  await chatSession!.save();

  t.true(addJob.calledOnce);
  t.deepEqual(addJob.firstCall.args, [
    'copilot.session.generateTitle',
    { sessionId },
    { priority: 100 },
  ]);
});

test('should merge latest user turn content and attachments into prompt', async t => {
  const { prompt, session } = t.context;

  await prompt.set(promptName, 'model', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  for (const testCase of [
    {
      title: 'text message',
      message: { content: 'hello' },
      project: (messages: { content: string }[]) =>
        messages.map(({ content }) => content),
      expected: ['hello world', 'hello'],
    },
    {
      title: 'attachment message',
      message: { attachments: ['https://affine.pro/example.jpg'] as string[] },
      project: (messages: { attachments?: unknown }[]) =>
        messages.map(({ attachments }) => attachments),
      expected: [undefined, ['https://affine.pro/example.jpg']],
    },
    {
      title: 'empty message',
      message: {},
      project: (messages: { content: string }[]) =>
        messages.map(({ content }) => content),
      expected: ['hello world'],
    },
  ]) {
    const sessionId = await session.create({
      docId: 'test',
      workspaceId: 'test',
      userId,
      promptName,
      pinned: false,
    });
    const s = (await session.get(sessionId))!;
    s.pushTurn(
      buildTurn(sessionId, {
        role: 'user',
        content: testCase.message.content ?? '',
        attachments: testCase.message.attachments,
        createdAt: new Date(),
      })
    );
    t.deepEqual(
      testCase.project(s.finish({ word: 'world' })),
      testCase.expected,
      testCase.title
    );
  }
});

test('should preserve file handle attachments when merging user content into prompt', async t => {
  const { prompt, session } = t.context;

  await prompt.set(promptName, 'model', [
    { role: 'user', content: '{{content}}' },
  ]);

  const sessionId = await session.create({
    docId: 'test',
    workspaceId: 'test',
    userId,
    promptName,
    pinned: false,
  });
  const s = (await session.get(sessionId))!;

  s.pushTurn(
    buildTurn(sessionId, {
      role: 'user',
      content: 'Summarize this file',
      attachments: [
        {
          kind: 'file_handle',
          fileHandle: 'file_123',
          mimeType: 'application/pdf',
        },
      ],
      createdAt: new Date(),
    })
  );
  const finalMessages = s.finish({});

  t.deepEqual(finalMessages, [
    {
      role: 'user',
      content: 'Summarize this file',
      attachments: [
        {
          kind: 'file_handle',
          fileHandle: 'file_123',
          mimeType: 'application/pdf',
        },
      ],
      params: {
        content: 'Summarize this file',
      },
    },
  ]);
});

test('should preserve assistant render trace when converting between chat message and turn', t => {
  const sessionId = randomUUID();
  const createdAt = new Date('2025-01-01T00:00:00.000Z');
  const message = {
    id: 'message-1',
    role: 'assistant' as const,
    content: 'Final answer',
    attachments: [
      {
        kind: 'file_handle' as const,
        fileHandle: 'file_123',
        mimeType: 'application/pdf',
      },
    ],
    params: {
      schemaVersion: 'v1',
    },
    streamObjects: [
      { type: 'reasoning' as const, textDelta: 'Plan' },
      {
        type: 'tool-call' as const,
        toolCallId: 'call_1',
        toolName: 'doc_read',
        args: { docId: 'doc-1' },
        rawArgumentsText: '{"docId":"doc-1"}',
        thought: 'Need the current doc',
      },
      { type: 'text-delta' as const, textDelta: 'Final answer' },
      {
        type: 'tool-result' as const,
        toolCallId: 'call_2',
        toolName: 'doc_keyword_search',
        args: { query: 'affine' },
        result: { hits: ['doc-2'] },
      },
    ],
    createdAt,
  };

  const turn = turnFromChatMessage(message, sessionId);

  t.deepEqual(turn.renderTrace, message.streamObjects);
  t.deepEqual(
    turn.toolEvents.map(event => event.type),
    ['tool_call', 'tool_result']
  );
  t.deepEqual(chatMessageFromTurn(turn), message);
});

test('should save message correctly', async t => {
  const { prompt, session } = t.context;

  await prompt.set(promptName, 'model', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  const sessionId = await session.create({
    docId: 'test',
    workspaceId: 'test',
    userId,
    promptName,
    pinned: false,
  });
  const s = (await session.get(sessionId))!;

  s.pushTurn(
    buildTurn(sessionId, {
      role: 'user',
      content: 'hello',
      createdAt: new Date(),
    })
  );
  t.is(s.stashTurns.length, 1, 'should get stash turns');
  await s.save();
  t.is(s.stashTurns.length, 0, 'should empty stash turns after save');
});

test('should revert message correctly', async t => {
  const { prompt, session } = t.context;

  // init session
  let sessionId: string;
  {
    await prompt.set(promptName, 'model', [
      { role: 'system', content: 'hello {{word}}' },
    ]);

    sessionId = await session.create({
      docId: 'test',
      workspaceId: 'test',
      userId,
      promptName,
      pinned: false,
    });
    const s = (await session.get(sessionId))!;

    s.pushTurn(
      buildTurn(sessionId, {
        role: 'user',
        content: '1',
        createdAt: new Date(),
      })
    );
    await s.save();
  }

  // check ChatSession behavior
  {
    const s = (await session.get(sessionId))!;
    s.pushTurn(
      buildTurn(sessionId, {
        role: 'assistant',
        content: '2',
        createdAt: new Date(),
      })
    );
    s.pushTurn(
      buildTurn(sessionId, {
        role: 'user',
        content: '3',
        createdAt: new Date(),
      })
    );
    s.pushTurn(
      buildTurn(sessionId, {
        role: 'assistant',
        content: '4',
        createdAt: new Date(),
      })
    );
    await s.save();
    const beforeRevert = s.finish({ word: 'world' });
    t.snapshot(
      cleanSnapshotObject(beforeRevert),
      'should have three messages before revert'
    );

    {
      s.revertLatestMessage(false);
      const afterRevert = s.finish({ word: 'world' });
      t.snapshot(
        cleanSnapshotObject(afterRevert),
        'should remove assistant message after revert'
      );
    }

    {
      s.revertLatestMessage(true);
      const afterRevert = s.finish({ word: 'world' });
      t.snapshot(
        cleanSnapshotObject(afterRevert),
        'should remove assistant message after revert'
      );
    }
  }

  // check database behavior
  {
    let s = (await session.get(sessionId))!;

    const beforeRevert = s.finish({ word: 'world' });
    t.snapshot(
      cleanSnapshotObject(beforeRevert),
      'should have three messages before revert'
    );

    {
      await session.revertLatestMessage(sessionId, false);
      s = (await session.get(sessionId))!;
      const afterRevert = s.finish({ word: 'world' });
      t.snapshot(
        cleanSnapshotObject(afterRevert),
        'should remove assistant message after revert'
      );
    }

    {
      await session.revertLatestMessage(sessionId, true);
      s = (await session.get(sessionId))!;
      const afterRevert = s.finish({ word: 'world' });
      t.snapshot(
        cleanSnapshotObject(afterRevert),
        'should remove assistant message after revert'
      );
    }
  }
});

test('should handle params correctly in chat session', async t => {
  const { prompt, session } = t.context;

  await prompt.set(promptName, 'model', [
    { role: 'system', content: 'hello {{word}}' },
  ]);

  const sessionId = await session.create({
    docId: 'test',
    workspaceId: 'test',
    userId,
    promptName,
    pinned: false,
  });

  const s = (await session.get(sessionId))!;

  // Case 1: When params is provided directly
  {
    const directParams = { word: 'direct' };
    const messages = s.finish(directParams);
    t.is(messages[0].content, 'hello direct', 'should use provided params');
  }

  // Case 2: When no params provided but last message has params
  {
    s.pushTurn(
      buildTurn(sessionId, {
        role: 'user',
        content: 'test message',
        params: { word: 'fromMessage' },
        createdAt: new Date(),
      })
    );
    const messages = s.finish({});
    t.is(
      messages[0].content,
      'hello fromMessage',
      'should use params from last message'
    );
  }

  // Case 3: When neither params provided nor last message has params
  {
    s.pushTurn(
      buildTurn(sessionId, {
        role: 'user',
        content: 'test message without params',
        createdAt: new Date(),
      })
    );
    const messages = s.finish({});
    t.is(messages[0].content, 'hello ', 'should use empty params');
  }
});

// ==================== provider ====================

test('should be able to get provider', async t => {
  const { factory } = t.context;

  {
    const p = await factory.getProvider({ outputType: ModelOutputType.Text });
    t.is(
      p?.type.toString(),
      'openai',
      'should get provider support text-to-text'
    );
  }

  {
    const p = await factory.getProvider({
      outputType: ModelOutputType.Image,
      inputTypes: [ModelInputType.Image],
      modelId: 'lora/image-to-image',
    });
    t.is(
      p?.type.toString(),
      'fal',
      'should get provider supporting image output'
    );
  }

  {
    const p = await factory.getProvider(
      {
        outputType: ModelOutputType.Image,
        inputTypes: [ModelInputType.Image],
      },
      { prefer: CopilotProviderType.FAL }
    );
    t.is(
      p?.type.toString(),
      'fal',
      'should get provider supporting text output with image input'
    );
  }

  // if a model is not defined and not available in online api
  // it should return null
  {
    const p = await factory.getProvider({
      outputType: ModelOutputType.Text,
      inputTypes: [ModelInputType.Text],
      modelId: 'gpt-4-not-exist',
    });
    t.falsy(p, 'should not get provider');
  }
});

test('should resolve provider by prefixed model id', async t => {
  const { factory } = t.context;

  const resolved = await factory.resolveProvider({
    modelId: 'openai-default/test',
    outputType: ModelOutputType.Text,
  });
  t.truthy(resolved, 'should resolve prefixed model id');
  if (!resolved) {
    throw new Error('should resolve prefixed model id');
  }

  t.is(resolved.provider.type, CopilotProviderType.OpenAI);

  const result = await getProviderRuntimeHost(resolved.provider).run.text(
    { modelId: resolved.modelId },
    [{ role: 'user', content: 'hello' }],
    undefined,
    resolved.execution
  );
  t.is(result, 'generate text to text');
});

test('should fallback to null when prefixed provider id does not exist', async t => {
  const { factory } = t.context;

  const provider = await factory.getProviderByModel('unknown/test');
  t.is(provider, null);
});

// ==================== action runtime ====================

const wrapAsyncIter = async <T>(iter: AsyncIterable<T>) => {
  const result: T[] = [];
  for await (const r of iter) {
    result.push(r);
  }
  return result;
};

test('action stream should expose successful text action result as message', t => {
  t.deepEqual(
    projectActionEventToChatEvent('message-1', {
      type: 'action_done',
      actionId: 'slides.outline',
      actionVersion: 'v1',
      status: 'succeeded',
      runId: 'run-1',
      result: '- Launch deck',
    }),
    {
      type: 'message',
      id: 'message-1',
      data: '- Launch deck',
    }
  );
});

test('turn orchestrator should persist generated image links through image result host', async t => {
  const { conversationHost, imageResults, orchestrator, chatRuntime, module } =
    t.context;
  const capabilityPolicy = module.get(CapabilityPolicyHost);
  const session = {
    latestUserTurn: { attachments: ['https://example.com/source.png'] },
    config: { sessionId: 'session-1' },
    finish: Sinon.stub().returns([
      {
        role: 'system',
        content: 'generate image',
        params: { quality: 'hd', seed: '7' },
      },
    ]),
  } as any;

  Sinon.stub(conversationHost, 'prepareTurn').resolves({
    messageId: 'message-1',
    params: {},
    session,
    latestTurn: undefined,
  } as any);
  Sinon.stub(capabilityPolicy, 'selectChat').resolves({
    model: 'test-image-model',
    providerOptions: { format: 'png' },
  } as any);
  Sinon.stub(chatRuntime, 'streamImageArtifacts').callsFake(async function* () {
    yield { url: 'https://remote.example/1.png', media_type: 'image/png' };
    yield { url: 'https://remote.example/2.png', media_type: 'image/png' };
  });
  const persistNativeArtifact = Sinon.stub(
    imageResults,
    'persistNativeArtifact'
  ).callsFake(
    async (_userId, _workspaceId, artifact) => `stored:${artifact.url}`
  );
  const persistAssistantTurn = Sinon.stub(
    conversationHost,
    'persistAssistantTurn'
  ).resolves();

  const prepared = await orchestrator.streamImages('user-1', 'session-1', {
    modelId: 'chat-model',
  });
  const result = await wrapAsyncIter(prepared.stream);

  t.deepEqual(result, [
    'stored:https://remote.example/1.png',
    'stored:https://remote.example/2.png',
  ]);
  t.deepEqual(
    (chatRuntime.streamImageArtifacts as Sinon.SinonStub).firstCall.args[0],
    {
      modelId: 'test-image-model',
      inputTypes: [ModelInputType.Image],
    }
  );
  t.deepEqual(
    (chatRuntime.streamImageArtifacts as Sinon.SinonStub).firstCall.args[2],
    {
      format: 'png',
      quality: 'hd',
      seed: 7,
      signal: undefined,
    }
  );
  t.deepEqual(
    persistNativeArtifact.getCalls().map(call => call.args),
    [
      [
        'user-1',
        'session-1',
        { url: 'https://remote.example/1.png', media_type: 'image/png' },
      ],
      [
        'user-1',
        'session-1',
        { url: 'https://remote.example/2.png', media_type: 'image/png' },
      ],
    ]
  );
  t.true(persistAssistantTurn.calledOnce);
  t.deepEqual(persistAssistantTurn.firstCall.args[1].attachments, result);
});

test('TextStreamParser should format different types of chunks correctly', t => {
  // Define interfaces for fixtures
  interface BaseFixture {
    chunk: any;
    description: string;
  }

  interface ContentFixture extends BaseFixture {
    expected: string;
  }

  interface ErrorFixture extends BaseFixture {
    errorMessage: string;
  }

  type ChunkFixture = ContentFixture | ErrorFixture;

  // Define test fixtures for different chunk types
  const fixtures: Record<string, ChunkFixture> = {
    textDelta: {
      chunk: {
        type: 'text-delta' as const,
        text: 'Hello world',
      },
      expected: 'Hello world',
      description: 'should format text-delta correctly',
    },
    reasoning: {
      chunk: {
        type: 'reasoning-delta' as const,
        text: 'I need to think about this',
      },
      expected: '\n> [!]\n> I need to think about this',
      description: 'should format reasoning as callout',
    },
    webSearch: {
      chunk: {
        type: 'tool-call' as const,
        toolName: 'web_search_exa' as const,
        toolCallId: 'test-id-1',
        input: { query: 'test query', mode: 'AUTO' as const },
      },
      expected: '\n> [!]\n> \n> Searching the web "test query"\n> ',
      description: 'should format web search tool call correctly',
    },
    webCrawl: {
      chunk: {
        type: 'tool-call' as const,
        toolName: 'web_crawl_exa' as const,
        toolCallId: 'test-id-2',
        input: { url: 'https://example.com' },
      },
      expected: '\n> [!]\n> \n> Crawling the web "https://example.com"\n> ',
      description: 'should format web crawl tool call correctly',
    },
    toolResult: {
      chunk: {
        type: 'tool-result' as const,
        toolName: 'web_search_exa' as const,
        toolCallId: 'test-id-1',
        input: { query: 'test query', mode: 'AUTO' as const },
        output: [
          {
            title: 'Test Title',
            url: 'https://test.com',
            content: 'Test content',
            favicon: undefined,
            publishedDate: undefined,
            author: undefined,
          },
          {
            title: null,
            url: 'https://example.com',
            content: 'Example content',
            favicon: undefined,
            publishedDate: undefined,
            author: undefined,
          },
        ],
      } as any,
      expected:
        '\n> [!]\n> \n> \n> \n> [Test Title](https://test.com)\n> \n> \n> \n> [https://example.com](https://example.com)\n> \n> \n> ',
      description: 'should format tool result correctly',
    },
    error: {
      chunk: {
        type: 'error' as const,
        error: { type: 'testError', message: 'Test error message' },
      },
      errorMessage: 'Test error message',
      description: 'should throw error for error chunks',
    },
  };

  // Test each chunk type individually
  Object.entries(fixtures).forEach(([_name, fixture]) => {
    const parser = new TextStreamParser();
    if ('errorMessage' in fixture) {
      t.throws(
        () => parser.parse(fixture.chunk),
        { message: fixture.errorMessage },
        fixture.description
      );
    } else {
      const result = parser.parse(fixture.chunk);
      t.is(result, fixture.expected, fixture.description);
    }
  });
});

test('TextStreamParser should process a sequence of message chunks', t => {
  const parser = new TextStreamParser();

  // Define test fixtures for mixed chunks sequence
  const mixedChunksFixture = {
    chunks: [
      // Reasoning chunks
      {
        id: nanoid(),
        type: 'reasoning-delta' as const,
        text: 'The user is asking about',
      },
      {
        id: nanoid(),
        type: 'reasoning-delta' as const,
        text: ' recent advances in quantum computing',
      },
      {
        id: nanoid(),
        type: 'reasoning-delta' as const,
        text: ' and how it might impact',
      },
      {
        id: nanoid(),
        type: 'reasoning-delta' as const,
        text: ' cryptography and data security.',
      },
      {
        id: nanoid(),
        type: 'reasoning-delta' as const,
        text: ' I should provide information on quantum supremacy achievements',
      },

      // Text delta
      {
        id: nanoid(),
        type: 'text-delta' as const,
        text: 'Let me search for the latest breakthroughs in quantum computing and their ',
      },

      // Tool call
      {
        type: 'tool-call' as const,
        toolCallId: 'toolu_01ABCxyz123456789',
        toolName: 'web_search_exa' as const,
        input: {
          query: 'latest quantum computing breakthroughs cryptography impact',
        },
      },

      // Tool result
      {
        type: 'tool-result' as const,
        toolCallId: 'toolu_01ABCxyz123456789',
        toolName: 'web_search_exa' as const,
        input: {
          query: 'latest quantum computing breakthroughs cryptography impact',
        },
        output: [
          {
            title: 'IBM Unveils 1000-Qubit Quantum Processor',
            url: 'https://example.com/tech/quantum-computing-milestone',
          },
        ],
      },

      // More text deltas
      {
        id: nanoid(),
        type: 'text-delta' as const,
        text: 'implications for security.',
      },
      {
        id: nanoid(),
        type: 'text-delta' as const,
        text: '\n\nQuantum computing has made ',
      },
      {
        id: nanoid(),
        type: 'text-delta' as const,
        text: 'remarkable progress in the past year. ',
      },
      {
        id: nanoid(),
        type: 'text-delta' as const,
        text: 'The development of more stable qubits has accelerated research significantly.',
      },
    ],
    expected:
      '\n> [!]\n> The user is asking about recent advances in quantum computing and how it might impact cryptography and data security. I should provide information on quantum supremacy achievements\n\nLet me search for the latest breakthroughs in quantum computing and their \n> [!]\n> \n> Searching the web "latest quantum computing breakthroughs cryptography impact"\n> \n> \n> \n> [IBM Unveils 1000-Qubit Quantum Processor](https://example.com/tech/quantum-computing-milestone)\n> \n> \n> \n\nimplications for security.\n\nQuantum computing has made remarkable progress in the past year. The development of more stable qubits has accelerated research significantly.',
    description:
      'should format the entire stream correctly with proper sequence',
  };

  // Process all chunks sequentially
  let result = '';
  for (const chunk of mixedChunksFixture.chunks) {
    result += parser.parse(chunk);
  }

  // Check final processed output
  t.is(result, mixedChunksFixture.expected, mixedChunksFixture.description);
});

// ==================== context ====================
test('should be able to manage context', async t => {
  const {
    context,
    event,
    jobs,
    prompt,
    session,
    storage,
    workspace,
    workspaceStorage,
  } = t.context;

  const ws = await workspace.create(userId);

  await prompt.set(promptName, 'model', [
    { role: 'system', content: 'hello {{word}}' },
  ]);
  const chatSession = await session.create({
    docId: 'test',
    workspaceId: ws.id,
    userId,
    promptName,
    pinned: false,
  });

  // use mocked embedding client
  Sinon.stub(context, 'embeddingClient').get(() => new MockEmbeddingClient());
  Sinon.stub(jobs, 'embeddingClient').get(() => new MockEmbeddingClient());

  {
    await t.throwsAsync(
      context.create(randomUUID()),
      { instanceOf: Error },
      'should throw error if create context with invalid session id'
    );

    const session = context.create(chatSession);
    await t.notThrowsAsync(session, 'should create context with chat session');

    await t.notThrowsAsync(
      context.get((await session).id),
      'should get context after create'
    );

    await t.throwsAsync(
      context.get(randomUUID()),
      { instanceOf: Error },
      'should throw error if get context with invalid id'
    );
  }

  const fs = await import('node:fs');
  const buffer = fs.readFileSync(
    ProjectRoot.join('packages/common/native/fixtures/sample.pdf').toFileUrl()
  );

  {
    const session = await context.create(chatSession);

    // file record
    {
      await storage.put(userId, session.workspaceId, 'blob', buffer);
      const file = await session.addFile(
        'blob',
        'sample.pdf',
        'application/pdf'
      );

      const handler = Sinon.spy(event, 'emit');

      await jobs.embedPendingFile({
        userId,
        workspaceId: session.workspaceId,
        contextId: session.id,
        blobId: file.blobId,
        fileId: file.id,
        fileName: file.name,
      });

      t.deepEqual(handler.lastCall.args, [
        'workspace.file.embed.finished',
        {
          contextId: session.id,
          workspaceId: session.workspaceId,
          fileId: file.id,
          chunkSize: 1,
        },
      ]);

      const list = session.files;
      t.deepEqual(
        list.map(f => f.id),
        [file.id],
        'should list file id'
      );

      const result = await session.matchFiles('test', 1, undefined, 1);
      t.is(result.length, 1, 'should match context');
      t.is(result[0].fileId, file.id, 'should match file id');
    }

    // blob record
    {
      const blobId = 'test-blob';
      await workspaceStorage.put(session.workspaceId, blobId, buffer);

      await jobs.embedPendingBlob({ workspaceId: session.workspaceId, blobId });

      const result = await t.context.context.matchWorkspaceBlobs(
        session.workspaceId,
        'test',
        1,
        undefined,
        1
      );
      t.is(result.length, 1, 'should match blob embedding');
      t.is(result[0].blobId, blobId, 'should match blob id');
    }

    // doc record

    const addDoc = async () => {
      const docId = randomUUID();
      await t.context.db.snapshot.create({
        data: {
          workspaceId: session.workspaceId,
          id: docId,
          blob: Buffer.from([1, 1]),
          state: Buffer.from([1, 1]),
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      });
      return docId;
    };

    {
      const docId = await addDoc();
      await session.addDocRecord(docId);
      const docs = session.docs.map(d => d.id);
      t.deepEqual(docs, [docId], 'should list doc id');

      await session.removeDocRecord(docId);
      t.deepEqual(session.docs, [], 'should remove doc id');
    }

    // tag record
    {
      const tagId = randomUUID();

      const docId1 = await addDoc();
      const docId2 = await addDoc();

      {
        await session.addCategoryRecord(ContextCategories.Tag, tagId, [docId1]);
        const tags = session.tags.map(t => t.id);
        t.deepEqual(tags, [tagId], 'should list tag id');

        const docs = session.tags.flatMap(l => l.docs.map(d => d.id));
        t.deepEqual(docs, [docId1], 'should list doc ids');
      }

      {
        await session.addCategoryRecord(ContextCategories.Tag, tagId, [docId2]);

        const docs = session.tags.flatMap(l => l.docs.map(d => d.id));
        t.deepEqual(docs, [docId1, docId2], 'should list doc ids');
      }

      await session.removeCategoryRecord(ContextCategories.Tag, tagId);
      t.deepEqual(session.tags, [], 'should remove tag id');
    }

    // collection record
    {
      const collectionId = randomUUID();

      const docId1 = await addDoc();
      const docId2 = await addDoc();
      {
        await session.addCategoryRecord(
          ContextCategories.Collection,
          collectionId,
          [docId1]
        );
        const collection = session.collections.map(l => l.id);
        t.deepEqual(collection, [collectionId], 'should list collection id');

        const docs = session.collections.flatMap(l => l.docs.map(d => d.id));
        t.deepEqual(docs, [docId1], 'should list doc ids');
      }

      {
        await session.addCategoryRecord(
          ContextCategories.Collection,
          collectionId,
          [docId2]
        );

        const docs = session.collections.flatMap(l => l.docs.map(d => d.id));
        t.deepEqual(docs, [docId1, docId2], 'should list doc ids');
      }

      await session.removeCategoryRecord(
        ContextCategories.Collection,
        collectionId
      );
      t.deepEqual(session.collections, [], 'should remove collection id');
    }
  }
});

// ==================== workspace embedding ====================
test('should be able to manage workspace embedding', async t => {
  const { db, jobs, workspace, workspaceEmbedding, context, prompt, session } =
    t.context;

  // use mocked embedding client
  Sinon.stub(context, 'embeddingClient').get(() => new MockEmbeddingClient());
  Sinon.stub(jobs, 'embeddingClient').get(() => new MockEmbeddingClient());

  const ws = await workspace.create(userId);

  // should create workspace embedding
  {
    const { blobId, file } = await workspaceEmbedding.addFile(userId, ws.id, {
      filename: 'test.txt',
      mimetype: 'text/plain',
      encoding: 'utf-8',
      createReadStream: () => {
        return new Readable({
          read() {
            this.push(Buffer.from('content'));
            this.push(null);
          },
        });
      },
    });
    await workspaceEmbedding.queueFileEmbedding({
      userId,
      workspaceId: ws.id,
      blobId,
      fileId: file.fileId,
      fileName: file.fileName,
    });

    let ret = 0;
    while (!ret) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      ret = await db.aiWorkspaceFileEmbedding.count({
        where: { workspaceId: ws.id, fileId: file.fileId },
      });
    }
  }

  // should create workspace embedding with file
  {
    await prompt.set(promptName, 'model', [
      { role: 'system', content: 'hello {{word}}' },
    ]);
    const sessionId = await session.create({
      docId: 'test',
      workspaceId: ws.id,
      userId,
      promptName,
      pinned: false,
    });
    const contextSession = await context.create(sessionId);

    const ret = await contextSession.matchFiles('test', 1, undefined, 1);
    t.is(ret.length, 1, 'should match workspace context');
    t.is(ret[0].content, 'content', 'should match content');

    await workspace.update(ws.id, { enableDocEmbedding: false });

    const ret2 = await contextSession.matchFiles('test', 1, undefined, 1);
    t.is(ret2.length, 0, 'should not match workspace context');
  }
});

test('should handle generateSessionTitle correctly under various conditions', async t => {
  const { prompt, session, promptRuntime, workspace, copilotSession } =
    t.context;

  await prompt.set(promptName, 'model', [
    { role: 'user', content: '{{content}}' },
  ]);
  const createSession = async (
    options: {
      userMessage?: string;
      assistantMessage?: string;
      existingTitle?: string;
    } = {}
  ) => {
    const ws = await workspace.create(userId);
    const sessionId = await session.create({
      docId: 'test-doc',
      workspaceId: ws.id,
      userId,
      promptName,
      pinned: false,
    });

    if (options.existingTitle) {
      await copilotSession.update({
        userId,
        sessionId,
        title: options.existingTitle,
      });
    }

    const chatSession = await session.get(sessionId);
    if (chatSession) {
      if (options.userMessage) {
        chatSession.pushTurn(
          buildTurn(sessionId, {
            role: 'user',
            content: options.userMessage,
            createdAt: new Date(),
          })
        );
      }
      if (options.assistantMessage) {
        chatSession.pushTurn(
          buildTurn(sessionId, {
            role: 'assistant',
            content: options.assistantMessage,
            createdAt: new Date(),
          })
        );
      }
      await chatSession.save();
    }

    return sessionId;
  };

  const testCases = [
    {
      name: 'should generate title when conditions are met',
      setup: () =>
        createSession({
          userMessage: 'What is machine learning?',
          assistantMessage:
            'Machine learning is a subset of artificial intelligence.',
        }),
      mockFn: () => 'What is Machine Learning?',
      expectSnapshot: true,
    },
    {
      name: 'should not generate title when session already has title',
      setup: () =>
        createSession({
          userMessage: 'Test message',
          assistantMessage: 'Test response',
          existingTitle: 'Existing Title',
        }),
      mockFn: () => 'New Title',
      expectSnapshot: true,
      expectNotCalled: true,
    },
    {
      name: 'should not generate title when no user messages exist',
      setup: () =>
        createSession({ assistantMessage: 'Hello! How can I help you?' }),
      mockFn: () => 'New Title',
      expectSnapshot: true,
      expectNotCalled: true,
    },
    {
      name: 'should not generate title when no assistant messages exist',
      setup: () => createSession({ userMessage: 'What is AI?' }),
      mockFn: () => 'New Title',
      expectSnapshot: true,
      expectNotCalled: true,
    },
    {
      name: 'should handle errors gracefully',
      setup: () =>
        createSession({
          userMessage: 'Test question',
          assistantMessage: 'Test answer',
        }),
      mockFn: () => {
        throw new Error('Mock error for testing');
      },
      expectError: 'Mock error for testing',
    },
  ];

  for (const testCase of testCases) {
    const sessionId = await testCase.setup();
    let chatWithPromptCalled = false;

    const mockStub = Sinon.stub(promptRuntime, 'runText').callsFake(
      async () => {
        chatWithPromptCalled = true;
        return testCase.mockFn();
      }
    );

    if (testCase.expectError) {
      await t.throwsAsync(
        () => session.generateSessionTitle({ sessionId }),
        { message: testCase.expectError },
        testCase.name
      );
    } else {
      await session.generateSessionTitle({ sessionId });

      if (testCase.expectSnapshot) {
        const sessionState = await session.getState(sessionId);
        t.snapshot(
          {
            chatWithPromptCalled: testCase.expectNotCalled
              ? chatWithPromptCalled
              : undefined,
            title: sessionState?.conversation.title,
            exists: !!sessionState,
          },
          testCase.name
        );
      }
    }

    mockStub.restore();
  }

  {
    const sessionId = await createSession({
      userMessage: 'Explain quantum computing briefly',
      assistantMessage: 'Quantum computing uses quantum mechanics principles.',
    });

    let capturedArgs: any[] = [];
    Sinon.stub(promptRuntime, 'runText').callsFake(async (...args) => {
      capturedArgs = args;
      return 'Quantum Computing Explained';
    });

    await session.generateSessionTitle({ sessionId });

    t.snapshot(
      {
        promptName: capturedArgs[0],
        content: capturedArgs[1]?.content,
      },
      'should use correct prompt for title generation'
    );
  }
});

test('should handle copilot cron jobs correctly', async t => {
  const { cronJobs, copilotSession } = t.context;

  // mock calls
  const mockCleanupResult = { removed: 2, cleaned: 3 };
  const mockSessions = [
    { id: 'session1', _count: { messages: 1 } },
    { id: 'session2', _count: { messages: 2 } },
  ];
  const cleanupStub = Sinon.stub(
    copilotSession,
    'cleanupEmptySessions'
  ).resolves(mockCleanupResult);
  const toBeGenerateStub = Sinon.stub(
    copilotSession,
    'toBeGenerateTitle'
  ).resolves(mockSessions);
  const jobAddStub = Sinon.stub(cronJobs['jobs'], 'add').resolves();

  // daily cleanup job scheduling
  {
    await cronJobs.dailyCleanupJob();
    t.snapshot(
      jobAddStub.getCalls().map(call => ({
        args: call.args,
      })),
      'daily job scheduling calls'
    );

    jobAddStub.reset();
    cleanupStub.reset();
    toBeGenerateStub.reset();
  }

  // cleanup empty sessions
  {
    // mock
    cleanupStub.resolves(mockCleanupResult);
    toBeGenerateStub.resolves(mockSessions);

    await cronJobs.cleanupEmptySessions();
    t.snapshot(
      cleanupStub.getCalls().map(call => ({
        args: call.args.map(arg => (arg instanceof Date ? 'Date' : arg)), // Replace Date with string for stable snapshot
      })),
      'cleanup empty sessions calls'
    );
  }

  // generate missing titles
  await cronJobs.generateMissingTitles();
  t.snapshot(
    {
      modelCalls: toBeGenerateStub.getCalls().map(call => ({
        args: call.args,
      })),
      jobCalls: jobAddStub.getCalls().map(call => ({
        args: call.args,
      })),
    },
    'title generation calls'
  );

  cleanupStub.restore();
  toBeGenerateStub.restore();
  jobAddStub.restore();
});

test('model selection policy should resolve requested optional models consistently', async t => {
  const { module } = t.context;
  const modelSelection = module.get(ModelSelectionPolicy);

  t.deepEqual(
    modelSelection.resolveRequestedModel({
      defaultModel: 'gemini-2.5-flash',
      optionalModels: [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'claude-sonnet-4-5@20250929',
      ],
      requestedModelId: 'gemini-2.5-pro',
    }),
    {
      selectedModel: 'gemini-2.5-pro',
      matchedOptionalModel: true,
    }
  );

  t.deepEqual(
    modelSelection.resolveRequestedModel({
      defaultModel: 'gemini-2.5-flash',
      optionalModels: [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'claude-sonnet-4-5@20250929',
      ],
      requestedModelId: 'openai-default/gemini-2.5-pro',
    }),
    {
      selectedModel: 'openai-default/gemini-2.5-pro',
      matchedOptionalModel: true,
    }
  );

  t.deepEqual(
    modelSelection.resolveRequestedModel({
      defaultModel: 'gemini-2.5-flash',
      optionalModels: [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'claude-sonnet-4-5@20250929',
      ],
      requestedModelId: 'not-in-optional',
    }),
    {
      selectedModel: 'gemini-2.5-flash',
      matchedOptionalModel: false,
    }
  );

  t.is(
    modelSelection.resolveRequestedModel({
      defaultModel: 'gemini-2.5-flash',
      optionalModels: [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'claude-sonnet-4-5@20250929',
      ],
      requestedModelId: 'not-in-optional',
    }).selectedModel,
    'gemini-2.5-flash'
  );
});

test('capability policy host should fallback when prompt default model is not routable', async t => {
  const { module } = t.context;
  const capabilityPolicy = module.get(CapabilityPolicyHost);
  const factory = module.get(CopilotProviderFactory);

  Sinon.stub(factory, 'getConfiguredModelIds').returns([
    'openai-default/gpt-5-mini',
  ]);
  Sinon.stub(factory, 'resolveModelId').callsFake(async cond => {
    if (cond.modelId === 'gemini-2.5-flash') {
      return undefined;
    }
    if (cond.modelId === 'openai-default/gpt-5-mini') {
      return 'openai-default/gpt-5-mini';
    }
    if (!cond.modelId && cond.outputType === ModelOutputType.Text) {
      return 'openai-default/gpt-5-mini';
    }
    return undefined;
  });

  const model = await capabilityPolicy.resolveChatModel({
    userId,
    defaultModel: 'gemini-2.5-flash',
    optionalModels: ['gemini-2.5-flash'],
    paymentEnabled: false,
  });
  t.is(model, 'openai-default/gpt-5-mini');

  const requested = await capabilityPolicy.resolveChatModel({
    userId,
    defaultModel: 'gemini-2.5-flash',
    optionalModels: ['gemini-2.5-flash'],
    requestedModelId: 'openai-default/gpt-5-mini',
    paymentEnabled: false,
  });
  t.is(requested, 'openai-default/gpt-5-mini');
});

test('capability policy host should select image routes with image output type', async t => {
  const { module } = t.context;
  const capabilityPolicy = module.get(CapabilityPolicyHost);
  const factory = module.get(CopilotProviderFactory);
  const routeContext = {
    userId,
    workspaceId: 'workspace-1',
    byokLeaseId: 'lease-1',
    featureKind: 'image' as const,
    quotaBackedRoutesAllowed: false,
  };

  Sinon.stub(factory, 'getConfiguredModelIds').returns(['local-image-model']);
  const resolveModelId = Sinon.stub(factory, 'resolveModelId').callsFake(
    async cond =>
      cond.outputType === ModelOutputType.Image &&
      cond.modelId === 'local-image-model'
        ? 'local-image-model'
        : undefined
  );
  const resolveModelContextWindow = Sinon.stub(
    factory,
    'resolveModelContextWindow'
  ).resolves(undefined);

  const selected = await capabilityPolicy.selectChat(
    {
      config: {
        userId,
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        promptConfig: {},
      },
      model: 'prompt-image-model',
      optionalModels: ['prompt-image-model', 'local-image-model'],
    } as any,
    {
      responseMode: 'image',
      modelId: 'local-image-model',
      byokLeaseId: 'lease-1',
      quotaBackedRoutesAllowed: false,
    }
  );

  t.is(selected.model, 'local-image-model');
  t.like(selected.providerOptions, {
    user: userId,
    session: 'session-1',
    workspace: 'workspace-1',
    byokLeaseId: 'lease-1',
    featureKind: 'image',
    quotaBackedRoutesAllowed: false,
  });
  t.true(
    resolveModelId.getCalls().some(call => {
      const [cond, filter, context] = call.args;
      return (
        cond.modelId === 'local-image-model' &&
        cond.outputType === ModelOutputType.Image &&
        Object.keys(filter).length === 0 &&
        context?.workspaceId === routeContext.workspaceId &&
        context.byokLeaseId === routeContext.byokLeaseId &&
        context.featureKind === routeContext.featureKind &&
        context.quotaBackedRoutesAllowed ===
          routeContext.quotaBackedRoutesAllowed
      );
    })
  );
  Sinon.assert.calledOnceWithExactly(
    resolveModelContextWindow,
    {
      modelId: 'local-image-model',
      outputType: ModelOutputType.Image,
    },
    {},
    routeContext
  );
});

test('capability policy host should gate pro model requests by subscription status', async t => {
  const { quotaState, subscription, module } = t.context;
  const capabilityPolicy = module.get(CapabilityPolicyHost);
  const defaultModel = 'gpt-5-mini';
  const proModel = 'gpt-4.1';
  const prefixedProModel = `openai-default/${proModel}`;
  const optionalModels = [defaultModel, proModel];
  const proModels = [proModel];

  const mockStatus = (status?: SubscriptionStatus) => {
    Sinon.restore();
    Sinon.stub(subscription, 'select').callsFake(() => ({
      // @ts-expect-error mock
      getSubscription: async () => (status ? { status } : null),
    }));
    Sinon.stub(quotaState, 'reconcileUserQuotaState').resolves({
      plan: status === SubscriptionStatus.Active ? 'pro' : 'free',
      flags: {},
    } as Awaited<ReturnType<QuotaStateService['reconcileUserQuotaState']>>);
  };

  // payment disabled -> allow requested if in optional; pro not blocked
  {
    const model1 = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      requestedModelId: proModel,
      paymentEnabled: false,
    });
    t.is(model1, proModel, 'should honor requested pro model');

    const model1WithPrefix = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      requestedModelId: prefixedProModel,
      paymentEnabled: false,
    });
    t.is(
      model1WithPrefix,
      prefixedProModel,
      'should honor requested prefixed pro model'
    );

    const model2 = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      requestedModelId: 'not-in-optional',
      paymentEnabled: false,
    });
    t.is(model2, defaultModel, 'should fallback to default model');
  }

  // payment enabled + trialing: requesting pro should fallback to default
  {
    mockStatus(SubscriptionStatus.Trialing);
    const model3 = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      requestedModelId: proModel,
      paymentEnabled: true,
    });
    t.is(
      model3,
      defaultModel,
      'should fallback to default model when requesting pro model during trialing'
    );

    const model3WithPrefix = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      requestedModelId: prefixedProModel,
      paymentEnabled: true,
    });
    t.is(
      model3WithPrefix,
      defaultModel,
      'should fallback to default model when requesting prefixed pro model during trialing'
    );

    const model4 = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      requestedModelId: defaultModel,
      paymentEnabled: true,
    });
    t.is(
      model4,
      defaultModel,
      'should honor requested non-pro model during trialing'
    );

    const model5 = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      paymentEnabled: true,
    });
    t.is(
      model5,
      defaultModel,
      'should pick default model when no requested model during trialing'
    );
  }

  // payment enabled + active: without requested -> default model; requested pro should be honored
  {
    mockStatus(SubscriptionStatus.Active);
    const model6 = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      paymentEnabled: true,
    });
    t.is(
      model6,
      defaultModel,
      'should pick default model when no requested model during active'
    );

    const model7 = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      requestedModelId: proModel,
      paymentEnabled: true,
    });
    t.is(model7, proModel, 'should honor requested pro model during active');

    const model7WithPrefix = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      requestedModelId: prefixedProModel,
      paymentEnabled: true,
    });
    t.is(
      model7WithPrefix,
      prefixedProModel,
      'should honor requested prefixed pro model during active'
    );

    const model8 = await capabilityPolicy.resolveChatModel({
      userId,
      defaultModel,
      optionalModels,
      proModels,
      requestedModelId: 'not-in-optional',
      paymentEnabled: true,
    });
    t.is(
      model8,
      defaultModel,
      'should fallback to default model when requesting non-optional model during active'
    );
  }
});

test('prompt runtime should resolve prefixed optional models consistently', async t => {
  const { prompt, promptRuntime, chatRuntime } = t.context;

  const promptName = randomUUID().replaceAll('-', '');
  await prompt.set(
    promptName,
    'gpt-5-mini',
    [{ role: 'user', content: '{{content}}' }],
    { proModels: ['gpt-4.1'] },
    { optionalModels: ['gpt-4.1'] }
  );

  const textStub = Sinon.stub(chatRuntime, 'text').resolves('ok');

  await promptRuntime.runText(
    promptName,
    { content: 'hello' },
    { modelId: 'openai-default/gpt-4.1' }
  );
  t.is(
    textStub.firstCall.args[0].modelId,
    'openai-default/gpt-4.1',
    'should preserve accepted provider-prefixed optional model'
  );

  await promptRuntime.runText(
    promptName,
    { content: 'hello' },
    { modelId: 'openai-default/not-in-optional' }
  );
  t.is(
    textStub.secondCall.args[0].modelId,
    'gpt-5-mini',
    'should fallback to default model for non-optional prefixed model'
  );
});

test('prompt runtime should resolve models with action route context', async t => {
  const { prompt, promptRuntime, chatRuntime, factory } = t.context;

  const promptName = randomUUID().replaceAll('-', '');
  await prompt.set(
    promptName,
    'gemini-default',
    [{ role: 'user', content: '{{content}}' }],
    {},
    { optionalModels: ['gemini-default', 'local/office-fast'] }
  );

  const resolveModelId = Sinon.stub(factory, 'resolveModelId').callsFake(
    async (cond, _filter, context) => {
      if (
        cond.modelId === 'gemini-default' &&
        context?.workspaceId === 'workspace-1' &&
        context.featureKind === 'action'
      ) {
        return undefined;
      }

      if (
        !cond.modelId &&
        cond.outputType === ModelOutputType.Text &&
        context?.workspaceId === 'workspace-1' &&
        context.featureKind === 'action'
      ) {
        return 'local/office-fast';
      }

      return cond.modelId;
    }
  );
  const textStub = Sinon.stub(chatRuntime, 'text').resolves('ok');

  await promptRuntime.runText(
    promptName,
    { content: 'hello' },
    {
      providerOptions: {
        user: 'user-1',
        workspace: 'workspace-1',
        session: 'session-1',
        byokLeaseId: 'lease-1',
        quotaBackedRoutesAllowed: false,
      },
    }
  );

  t.is(textStub.firstCall.args[0].modelId, 'local/office-fast');
  t.like(textStub.firstCall.args[2], {
    user: 'user-1',
    workspace: 'workspace-1',
    session: 'session-1',
    byokLeaseId: 'lease-1',
    quotaBackedRoutesAllowed: false,
    featureKind: 'action',
  });
  t.true(
    resolveModelId.getCalls().some(call => {
      const [cond, , context] = call.args;
      return (
        cond.modelId === 'gemini-default' &&
        context?.workspaceId === 'workspace-1' &&
        context.featureKind === 'action' &&
        context.byokLeaseId === 'lease-1' &&
        context.quotaBackedRoutesAllowed === false
      );
    })
  );
});

test('prompt runtime should infer image route context from prompt metadata', async t => {
  const { promptRuntime, chatRuntime, factory } = t.context;

  const resolveModelId = Sinon.stub(factory, 'resolveModelId').callsFake(
    async (cond, _filter, context) => {
      if (cond.modelId === 'gpt-image-1' && context?.featureKind === 'image') {
        return undefined;
      }

      if (
        !cond.modelId &&
        cond.outputType === ModelOutputType.Text &&
        context?.featureKind === 'image'
      ) {
        return 'local/image-text';
      }

      return cond.modelId;
    }
  );
  Sinon.stub(factory, 'resolveModelContextWindow').resolves(undefined);
  const textStub = Sinon.stub(chatRuntime, 'text').resolves('ok');

  await promptRuntime.runText(
    'Generate image',
    { content: 'draw a quiet workspace' },
    {
      providerOptions: {
        user: 'user-1',
        workspace: 'workspace-1',
      },
    }
  );

  t.is(textStub.firstCall.args[0].modelId, 'local/image-text');
  t.like(textStub.firstCall.args[2], {
    user: 'user-1',
    workspace: 'workspace-1',
    featureKind: 'image',
  });
  t.true(
    resolveModelId.getCalls().some(call => {
      const [cond, , context] = call.args;
      return (
        cond.modelId === 'gpt-image-1' &&
        cond.outputType === ModelOutputType.Text &&
        context?.workspaceId === 'workspace-1' &&
        context.featureKind === 'image'
      );
    })
  );
});

test('prompt runtime should resolve structured prompts with structured route policy', async t => {
  const { prompt, promptRuntime, chatRuntime, factory } = t.context;

  const promptName = randomUUID().replaceAll('-', '');
  await prompt.set(
    promptName,
    'office-chat-fast',
    [{ role: 'user', content: '{{content}}' }],
    {},
    { optionalModels: ['office-chat-fast', 'office-structured'] }
  );

  const resolveModelId = Sinon.stub(factory, 'resolveModelId').callsFake(
    async (cond, _filter, context) => {
      if (
        cond.modelId === 'office-chat-fast' &&
        cond.outputType === ModelOutputType.Structured &&
        context?.featureKind === 'action'
      ) {
        return undefined;
      }

      if (
        !cond.modelId &&
        cond.outputType === ModelOutputType.Structured &&
        context?.featureKind === 'action'
      ) {
        return 'local/office-structured';
      }

      return cond.modelId;
    }
  );
  Sinon.stub(factory, 'resolveModelContextWindow').resolves(undefined);
  const structuredStub = Sinon.stub(
    chatRuntime,
    'generateStructuredValue'
  ).resolves({
    value: { result: 'ok' },
    schemaHash: 'schema-hash',
    schemaValidationVersion: 'json-schema-v1',
    provider: 'auto',
    model: 'local/office-structured',
  });

  await promptRuntime.runStructured(
    promptName,
    { content: 'hello' },
    {
      responseContract: {
        responseSchemaJson: {
          type: 'object',
          properties: { result: { type: 'string' } },
          required: ['result'],
          additionalProperties: false,
        },
        schemaHash: 'schema-hash',
      },
      providerOptions: {
        user: 'user-1',
        workspace: 'workspace-1',
      },
    }
  );

  t.is(structuredStub.firstCall.args[0].modelId, 'local/office-structured');
  t.true(
    resolveModelId.getCalls().some(call => {
      const [cond, , context] = call.args;
      return (
        cond.modelId === 'office-chat-fast' &&
        cond.outputType === ModelOutputType.Structured &&
        context?.workspaceId === 'workspace-1' &&
        context.featureKind === 'action'
      );
    })
  );
});

test('prompt runtime should infer transcript route context for structured prompts', async t => {
  const { promptRuntime, chatRuntime, factory } = t.context;

  const resolveModelId = Sinon.stub(factory, 'resolveModelId').callsFake(
    async (cond, _filter, context) => {
      if (
        cond.modelId === 'gemini-2.5-flash' &&
        cond.outputType === ModelOutputType.Structured &&
        context?.featureKind === 'transcript'
      ) {
        return undefined;
      }

      if (
        !cond.modelId &&
        cond.outputType === ModelOutputType.Structured &&
        context?.featureKind === 'transcript'
      ) {
        return 'local/transcript-structured';
      }

      return cond.modelId;
    }
  );
  Sinon.stub(factory, 'resolveModelContextWindow').resolves(undefined);
  const structuredStub = Sinon.stub(
    chatRuntime,
    'generateStructuredValue'
  ).resolves({
    value: { result: 'ok' },
    schemaHash: 'schema-hash',
    schemaValidationVersion: 'json-schema-v1',
    provider: 'auto',
    model: 'local/transcript-structured',
  });

  await promptRuntime.runStructured(
    'Transcript audio structured',
    { content: '{}' },
    {
      responseContract: {
        responseSchemaJson: {
          type: 'object',
          properties: { result: { type: 'string' } },
          required: ['result'],
          additionalProperties: false,
        },
        schemaHash: 'schema-hash',
      },
      providerOptions: {
        user: 'user-1',
        workspace: 'workspace-1',
      },
    }
  );

  t.is(structuredStub.firstCall.args[0].modelId, 'local/transcript-structured');
  t.like(structuredStub.firstCall.args[2], {
    user: 'user-1',
    workspace: 'workspace-1',
    featureKind: 'transcript',
  });
  t.true(
    resolveModelId.getCalls().some(call => {
      const [cond, , context] = call.args;
      return (
        cond.modelId === 'gemini-2.5-flash' &&
        cond.outputType === ModelOutputType.Structured &&
        context?.workspaceId === 'workspace-1' &&
        context.featureKind === 'transcript'
      );
    })
  );
});

test('prompt runtime should keep explicit route feature context', async t => {
  const { promptRuntime, chatRuntime, factory } = t.context;

  const resolveModelId = Sinon.stub(factory, 'resolveModelId').callsFake(
    async (cond, _filter, context) => {
      if (
        cond.modelId === 'gemini-2.5-flash' &&
        cond.outputType === ModelOutputType.Structured &&
        context?.featureKind === 'action'
      ) {
        return undefined;
      }

      if (
        !cond.modelId &&
        cond.outputType === ModelOutputType.Structured &&
        context?.featureKind === 'action'
      ) {
        return 'local/action-structured';
      }

      return cond.modelId;
    }
  );
  Sinon.stub(factory, 'resolveModelContextWindow').resolves(undefined);
  const structuredStub = Sinon.stub(
    chatRuntime,
    'generateStructuredValue'
  ).resolves({
    value: { result: 'ok' },
    schemaHash: 'schema-hash',
    schemaValidationVersion: 'json-schema-v1',
    provider: 'auto',
    model: 'local/action-structured',
  });

  await promptRuntime.runStructured(
    'Transcript audio structured',
    { content: '{}' },
    {
      responseContract: {
        responseSchemaJson: {
          type: 'object',
          properties: { result: { type: 'string' } },
          required: ['result'],
          additionalProperties: false,
        },
        schemaHash: 'schema-hash',
      },
      providerOptions: {
        user: 'user-1',
        workspace: 'workspace-1',
        featureKind: 'action',
      },
    }
  );

  t.is(structuredStub.firstCall.args[0].modelId, 'local/action-structured');
  t.like(structuredStub.firstCall.args[2], {
    user: 'user-1',
    workspace: 'workspace-1',
    featureKind: 'action',
  });
  t.true(
    resolveModelId.getCalls().some(call => {
      const [cond, , context] = call.args;
      return (
        cond.modelId === 'gemini-2.5-flash' &&
        cond.outputType === ModelOutputType.Structured &&
        context?.workspaceId === 'workspace-1' &&
        context.featureKind === 'action'
      );
    })
  );
});

test('prompt runtime should cap appended prompt session by selected model context window', async t => {
  const { prompt, promptRuntime, chatRuntime, factory } = t.context;

  const promptName = randomUUID().replaceAll('-', '');
  await prompt.set(
    promptName,
    'local/office-fast',
    [{ role: 'system', content: 'summary' }],
    { maxTokens: 8192 },
    { optionalModels: ['local/office-fast'] }
  );

  Sinon.stub(factory, 'resolveModelId').callsFake(async cond => cond.modelId);
  Sinon.stub(factory, 'resolveModelContextWindow').resolves(4096);
  const renderSession = Sinon.stub(prompt, 'renderSession').returns([
    { role: 'system', content: 'summary' },
    { role: 'user', content: 'recent turn' },
  ]);
  const textStub = Sinon.stub(chatRuntime, 'text').resolves('ok');

  await promptRuntime.runText(
    promptName,
    {},
    {
      appendMessages: [{ role: 'user', content: 'recent turn' }],
      providerOptions: {
        session: 'session-1',
        workspace: 'workspace-1',
      },
    }
  );

  Sinon.assert.calledOnceWithExactly(
    renderSession,
    Sinon.match.has('name', promptName),
    [{ role: 'user', content: 'recent turn' }],
    {},
    4096,
    'session-1'
  );
  t.deepEqual(textStub.firstCall.args[1], [
    { role: 'system', content: 'summary' },
    { role: 'user', content: 'recent turn' },
  ]);
});

test('resolver models should use resolved provider metadata for display names', async t => {
  const { prompt, factory, module } = t.context;
  const resolver = module.get(CopilotResolver);

  const promptName = randomUUID().replaceAll('-', '');
  await prompt.set(
    promptName,
    'gemini-2.5-flash',
    [{ role: 'system', content: 'test' }],
    { proModels: ['gemini-2.5-pro'] },
    { optionalModels: ['gemini-2.5-flash', 'gemini-2.5-pro'] }
  );

  const resolveProvider = Sinon.stub(factory, 'resolveProvider').callsFake(
    async cond =>
      ({
        providerId: 'openai-default',
        rawModelId: cond.modelId,
        modelId: cond.modelId,
        fallbackProviderIds: ['openai-default', 'private-cloud-backup'],
        profile: {
          id: 'openai-default',
          type: CopilotProviderType.OpenAI,
          enabled: true,
          priority: 10,
          privacy: 'private_cloud',
          health: { status: 'degraded' },
          config: {},
          middleware: {},
        },
        provider: {
          resolveModel: (modelId: string) => ({
            id: modelId,
            name: `Resolved ${modelId}`,
          }),
        },
      }) as any
  );
  Sinon.stub(factory, 'describeRoutePolicy').returns({
    enabled: true,
    featureKind: 'chat',
    allowedProviderIds: ['openai-default'],
    allowedPrivacy: ['private_cloud'],
    preferredPrivacy: ['private_cloud', 'cloud'],
  });

  const models = await resolver.models(promptName);

  t.deepEqual(models.optionalModels, [
    {
      id: 'gemini-2.5-flash',
      name: 'Resolved gemini-2.5-flash',
      sources: ['default', 'prompt'],
      promptName,
      promptSource: 'compat',
      promptCategory: 'text',
      promptModelSource: 'compat',
      promptModelSources: [
        {
          candidateSource: 'default',
          modelSource: 'compat',
        },
        {
          candidateSource: 'prompt',
          modelSource: 'compat',
        },
      ],
      promptOverrideApplied: false,
      providerId: 'openai-default',
      providerProfileId: 'openai-default',
      routeModelId: 'gemini-2.5-flash',
      routeFallbackProviderIds: ['openai-default', 'private-cloud-backup'],
      providerType: CopilotProviderType.OpenAI,
      providerPrivacy: 'private_cloud',
      providerHealth: 'degraded',
      providerPriority: 10,
      routePolicyEnabled: true,
      routePolicyFeatureKind: 'chat',
      routePolicyAllowedProviderIds: ['openai-default'],
      routePolicyAllowedPrivacy: ['private_cloud'],
      routePolicyPreferredPrivacy: ['private_cloud', 'cloud'],
    },
    {
      id: 'gemini-2.5-pro',
      name: 'Resolved gemini-2.5-pro',
      sources: ['prompt'],
      promptName,
      promptSource: 'compat',
      promptCategory: 'text',
      promptModelSource: 'compat',
      promptModelSources: [
        {
          candidateSource: 'prompt',
          modelSource: 'compat',
        },
      ],
      promptOverrideApplied: false,
      providerId: 'openai-default',
      providerProfileId: 'openai-default',
      routeModelId: 'gemini-2.5-pro',
      routeFallbackProviderIds: ['openai-default', 'private-cloud-backup'],
      providerType: CopilotProviderType.OpenAI,
      providerPrivacy: 'private_cloud',
      providerHealth: 'degraded',
      providerPriority: 10,
      routePolicyEnabled: true,
      routePolicyFeatureKind: 'chat',
      routePolicyAllowedProviderIds: ['openai-default'],
      routePolicyAllowedPrivacy: ['private_cloud'],
      routePolicyPreferredPrivacy: ['private_cloud', 'cloud'],
    },
  ]);
  t.deepEqual(models.proModels, [
    {
      id: 'gemini-2.5-pro',
      name: 'Resolved gemini-2.5-pro',
      sources: ['pro'],
      promptName,
      promptSource: 'compat',
      promptCategory: 'text',
      promptModelSource: 'compat',
      promptModelSources: [
        {
          candidateSource: 'pro',
          modelSource: 'compat',
        },
      ],
      promptOverrideApplied: false,
      providerId: 'openai-default',
      providerProfileId: 'openai-default',
      routeModelId: 'gemini-2.5-pro',
      routeFallbackProviderIds: ['openai-default', 'private-cloud-backup'],
      providerType: CopilotProviderType.OpenAI,
      providerPrivacy: 'private_cloud',
      providerHealth: 'degraded',
      providerPriority: 10,
      routePolicyEnabled: true,
      routePolicyFeatureKind: 'chat',
      routePolicyAllowedProviderIds: ['openai-default'],
      routePolicyAllowedPrivacy: ['private_cloud'],
      routePolicyPreferredPrivacy: ['private_cloud', 'cloud'],
    },
  ]);
  t.true(
    resolveProvider.alwaysCalledWithMatch({
      outputType: ModelOutputType.Text,
    })
  );
  t.true(
    resolveProvider.alwaysCalledWithMatch(Sinon.match.any, Sinon.match.any, {
      featureKind: 'chat',
    })
  );
});

test('resolver prompts should expose safe prompt catalog metadata', async t => {
  const { module } = t.context;
  const resolver = module.get(CopilotResolver);

  const prompts = await resolver.prompts();
  const chat = prompts.find(prompt => prompt.name === 'Chat With AFFiNE AI');

  t.true(prompts.length > 0);
  t.truthy(chat);
  t.is(chat?.source, 'built_in');
  t.is(chat?.category, 'text');
  t.is(chat?.modelSource, 'built_in');
  t.is(chat?.modelConfigPath, undefined);
  t.true(Array.isArray(chat?.optionalModels));
  t.is(chat?.optionalModelsSource, 'built_in');
  t.is(chat?.optionalModelsConfigPath, undefined);
  t.is(chat?.optionalModelCount, chat?.optionalModels.length);
  t.is(chat?.proModelsSource, 'built_in');
  t.is(chat?.proModelsConfigPath, undefined);
  t.is(chat?.paramCount, chat?.paramKeys.length);
  t.false('messages' in (chat as object));
  t.false('config' in (chat as object));
});

test('resolver action run prepared route trace should expose sanitized workspace scoped diagnostics', async t => {
  const { models, module, workspace } = t.context;
  const resolver = module.get(CopilotResolver);
  const ws = await workspace.create(userId);
  const run = await models.copilotActionRun.create({
    userId,
    workspaceId: ws.id,
    actionId: 'mindmap.generate',
    actionVersion: 'v1',
  });

  await models.copilotActionRun.complete(run.id, {
    status: 'succeeded',
    trace: {
      native: { messages: [{ role: 'user', content: 'secret prompt' }] },
      preparedRoutes: {
        type: 'prepared_routes',
        status: 'succeeded',
        steps: [
          {
            stepId: 'generate',
            kind: 'structured',
            routeCount: 1,
            requestedModelId: 'local/office-structured',
            requestedModelSource: 'prompt_preference',
            fallbackProviderIds: ['ollama-main', 'openai-default'],
            routes: [
              {
                behaviorFlags: ['tool_calls'],
                canonicalModelKey: 'local/office-structured',
                dimensionMismatch: true,
                providerId: 'ollama-main',
                modelId: 'local/office-structured',
                modelBackendKind: 'openai_chat',
                modelEmbeddingDimensions: 1536,
                routeIndex: 0,
                fallbackOrderIndex: 0,
                protocol: 'openai_chat',
                requestLayer: 'chat_completions',
                requestedDimensions: 1024,
                providerConfiguredModelCount: 2,
                providerConfiguredModelIds: [
                  'local/office-structured',
                  'office-structured',
                ],
                providerHealth: 'healthy',
                providerHealthCheckedAt: '2026-06-16T09:30:00.000Z',
                providerName: 'Local Ollama',
                providerPrivacy: 'local',
                providerPriority: 10,
                providerProfileConfigPath:
                  'copilot.providers.profiles[id=ollama-main]',
                providerProfileId: 'ollama-main',
                providerProfileSource: 'configured',
                providerSource: 'configured',
                providerType: 'openaiCompatible',
                routeModelAliasMatched: true,
                routeModelDefinitionAliases: ['office-structured'],
                routeModelDefinitionId: 'local/office-structured',
                routeModelDefinitionSource: 'provider_profile',
                routeRawModelId: 'qwen3:32b',
                backendConfig: {
                  base_url: 'http://host.docker.internal:11434/v1',
                  auth_token: 'should-not-be-returned',
                },
              },
            ],
          },
        ],
      },
    },
  });

  const trace = await resolver.actionRunPreparedRouteTrace(
    { id: userId } as any,
    { workspaceId: ws.id },
    run.id
  );

  t.deepEqual(trace, {
    type: 'prepared_routes',
    status: 'succeeded',
    steps: [
      {
        stepId: 'generate',
        kind: 'structured',
        routeCount: 1,
        actualRouteCount: 1,
        routeCountMismatch: false,
        requestedModelId: 'local/office-structured',
        requestedModelSource: 'prompt_preference',
        fallbackProviderIds: ['ollama-main', 'openai-default'],
        routes: [
          {
            behaviorFlags: ['tool_calls'],
            canonicalModelKey: 'local/office-structured',
            dimensionMismatch: true,
            providerId: 'ollama-main',
            modelId: 'local/office-structured',
            modelBackendKind: 'openai_chat',
            modelEmbeddingDimensions: 1536,
            routeIndex: 0,
            fallbackOrderIndex: 0,
            protocol: 'openai_chat',
            requestLayer: 'chat_completions',
            requestedDimensions: 1024,
            providerConfiguredModelCount: 2,
            providerConfiguredModelIds: [
              'local/office-structured',
              'office-structured',
            ],
            providerHealth: 'healthy',
            providerHealthCheckedAt: '2026-06-16T09:30:00.000Z',
            providerName: 'Local Ollama',
            providerPrivacy: 'local',
            providerPriority: 10,
            providerProfileConfigPath:
              'copilot.providers.profiles[id=ollama-main]',
            providerProfileId: 'ollama-main',
            providerProfileSource: 'configured',
            providerSource: 'configured',
            providerType: 'openaiCompatible',
            routeModelAliasMatched: true,
            routeModelDefinitionAliases: ['office-structured'],
            routeModelDefinitionId: 'local/office-structured',
            routeModelDefinitionSource: 'provider_profile',
            routeRawModelId: 'qwen3:32b',
          },
        ],
      },
    ],
  });
});

test('resolver action run prepared route trace should return null outside current workspace scope', async t => {
  const { models, module, workspace } = t.context;
  const resolver = module.get(CopilotResolver);
  const ws = await workspace.create(userId);
  const otherWs = await workspace.create(userId);
  const run = await models.copilotActionRun.create({
    userId,
    workspaceId: otherWs.id,
    actionId: 'image.filter.sketch',
    actionVersion: 'v1',
  });

  await models.copilotActionRun.complete(run.id, {
    status: 'succeeded',
    trace: {
      type: 'prepared_routes',
      status: 'succeeded',
      steps: [
        {
          stepId: 'generate-image',
          kind: 'image',
          fallbackProviderIds: ['openai-default'],
          routes: [{ providerId: 'openai-default', modelId: 'gpt-image-1' }],
        },
      ],
    },
  });

  t.is(
    await resolver.actionRunPreparedRouteTrace(
      { id: userId } as any,
      { workspaceId: ws.id },
      run.id
    ),
    null
  );
});

test('resolver action runs should expose recent sanitized workspace scoped diagnostics', async t => {
  const { models, module, workspace } = t.context;
  const resolver = module.get(CopilotResolver);
  const ws = await workspace.create(userId);
  const otherWs = await workspace.create(userId);
  const run = await models.copilotActionRun.create({
    userId,
    workspaceId: ws.id,
    docId: 'doc-1',
    actionId: 'mindmap.generate',
    actionVersion: 'v1',
  });
  await models.copilotActionRun.complete(run.id, {
    status: 'succeeded',
    result: { secret: 'should-not-be-returned' },
    artifacts: [{ id: 'artifact-1' }],
    trace: {
      native: {
        lightweight: [
          { type: 'action_trace', prompt: 'should-not-be-returned' },
          { type: 'tool:dispatch', payload: { token: 'secret-token' } },
          { type: 'unsafe event name with spaces' },
        ],
        messages: [{ role: 'user', content: 'secret prompt' }],
      },
      preparedRoutes: {
        type: 'prepared_routes',
        status: 'succeeded',
        steps: [
          {
            stepId: 'generate',
            kind: 'structured',
            routeCount: 1,
            requestedModelId: 'local/office-structured',
            requestedModelSource: 'prompt_preference',
            fallbackProviderIds: ['ollama-main'],
            routes: [
              {
                providerId: 'ollama-main',
                modelId: 'local/office-structured',
                routeIndex: 0,
                fallbackOrderIndex: 0,
                protocol: 'openai_chat',
                requestLayer: 'chat_completions',
                backendConfig: {
                  authToken: 'should-not-be-returned',
                },
              },
            ],
          },
        ],
      },
    },
  });
  const failedRun = await models.copilotActionRun.create({
    userId,
    workspaceId: ws.id,
    actionId: 'image.filter.sketch',
    actionVersion: 'v1',
    retryOf: run.id,
  });
  await models.copilotActionRun.complete(failedRun.id, {
    status: 'failed',
    errorCode: 'action_bridge_stream_error',
    trace: { type: 'error', status: 'failed' },
  });
  await models.copilotActionRun.create({
    userId,
    workspaceId: otherWs.id,
    actionId: 'other.workspace',
    actionVersion: 'v1',
  });

  const diagnostics = await resolver.actionRuns(
    { id: userId } as any,
    { workspaceId: ws.id },
    8
  );

  t.is(diagnostics.length, 2);
  t.deepEqual(
    diagnostics.map(item => item.id).sort(),
    [run.id, failedRun.id].sort()
  );
  t.like(
    diagnostics.find(item => item.id === run.id),
    {
      actionId: 'mindmap.generate',
      actionVersion: 'v1',
      agentRuntimeNativeTraceEventTypes: ['action_trace', 'tool:dispatch'],
      agentRuntimeProjectedSchemaComponents: [
        'typescript_projection_contract',
        'graphql_string_diagnostics_fields',
        'graphql_structured_timeline_items',
      ],
      agentRuntimeProjectedRunStatuses: [
        'queued',
        'running',
        'completed',
        'failed',
        'cancelled',
      ],
      agentRuntimeProjectedStepStatuses: [
        'pending',
        'running',
        'completed',
        'failed',
        'skipped',
      ],
      agentRuntimeProjectedStepTypes: ['model'],
      agentRuntimeProjectedTimelineEventTypes: ['run_status', 'model_step'],
      agentRuntimeProjectionSource: 'ai_action_run_agent_runtime_projection/v1',
      agentRuntimeProjectionGaps: [
        'tool -> not_projected',
        'approval -> not_projected',
        'handoff -> not_projected',
        'codex -> not_projected',
        'mcp -> not_projected',
      ],
      agentRuntimeRunStatusGaps: [
        'waiting_approval -> not_projected',
        'retrying -> not_projected',
        'rollback_running -> not_projected',
        'archived -> not_projected',
      ],
      agentRuntimeRunId: run.id,
      agentRuntimeRunStatus: 'completed',
      agentRuntimeSchemaReadiness: 'projection_contract_only',
      agentRuntimeSchemaReadinessGaps: [
        'db_agent_run_table -> not_persisted',
        'db_agent_step_table -> not_persisted',
        'graphql_run_status_enum -> string_field',
        'graphql_step_status_enum -> string_field',
        'graphql_step_type_enum -> string_field',
        'schema_migration -> not_created',
        'registry_source_of_truth -> not_created',
      ],
      agentRuntimeStepCount: 1,
      agentRuntimeStepStatusGaps: [
        'waiting_approval -> not_projected',
        'retrying -> not_projected',
        'rollback_running -> not_projected',
        'blocked -> not_projected',
      ],
      agentRuntimeStepIds: ['generate'],
      agentRuntimeStepKinds: ['generate -> structured'],
      agentRuntimeStepStatuses: ['generate -> completed'],
      agentRuntimeStepTypes: ['generate -> model'],
      agentRuntimeTimelineEntries: [
        'run -> completed',
        'generate -> model_step -> completed -> structured -> 1/1',
      ],
      agentRuntimeTimelineEventTypes: ['run_status', 'model_step'],
      agentRuntimeTimelineGaps: [
        'tool_step -> not_projected',
        'approval_step -> not_projected',
        'handoff_step -> not_projected',
        'codex_step -> not_projected',
        'mcp_step -> not_projected',
        'step_output -> not_projected',
        'step_error -> not_projected',
        'retry_attempt -> not_projected',
        'rollback_state -> not_projected',
        'run_cancellation -> not_projected',
      ],
      agentRuntimeTimelineItems: [
        {
          id: `${run.id}:run_status`,
          eventKey: 'run_status',
          sequence: 0,
          eventType: 'run_status',
          label: 'run -> completed',
          runId: run.id,
          stepId: null,
          stepType: null,
          status: 'completed',
          kind: null,
          routeCount: 1,
          actualRouteCount: 1,
          routeCountMismatch: false,
          routeTargets: ['ollama-main/local/office-structured'],
          fallbackProviderIds: ['ollama-main'],
        },
        {
          id: `${run.id}:0:generate:model_step`,
          eventKey: 'model_step:generate',
          sequence: 1,
          eventType: 'model_step',
          label: 'generate -> model_step -> completed -> structured -> 1/1',
          runId: run.id,
          stepId: 'generate',
          stepType: 'model',
          status: 'completed',
          kind: 'structured',
          routeCount: 1,
          actualRouteCount: 1,
          routeCountMismatch: false,
          routeTargets: ['ollama-main/local/office-structured'],
          fallbackProviderIds: ['ollama-main'],
        },
      ],
      agentRuntimeTargetRunStatuses: [
        'queued',
        'running',
        'waiting_approval',
        'completed',
        'failed',
        'cancelled',
        'retrying',
        'rollback_running',
        'archived',
      ],
      agentRuntimeTargetSchemaComponents: [
        'db_agent_run_table',
        'db_agent_step_table',
        'graphql_run_status_enum',
        'graphql_step_status_enum',
        'graphql_step_type_enum',
        'schema_migration',
        'registry_source_of_truth',
      ],
      agentRuntimeTargetStepStatuses: [
        'pending',
        'running',
        'waiting_approval',
        'completed',
        'failed',
        'skipped',
        'retrying',
        'rollback_running',
        'blocked',
      ],
      agentRuntimeTargetStepTypes: [
        'model',
        'tool',
        'approval',
        'handoff',
        'codex',
        'mcp',
      ],
      agentRuntimeTargetTimelineEventTypes: [
        'run_status',
        'model_step',
        'tool_step',
        'approval_step',
        'handoff_step',
        'codex_step',
        'mcp_step',
        'step_output',
        'step_error',
        'retry_attempt',
        'rollback_state',
        'run_cancellation',
      ],
      agentRuntimeUnsupportedRunStatuses: [
        'waiting_approval',
        'retrying',
        'rollback_running',
        'archived',
      ],
      agentRuntimeUnsupportedStepStatuses: [
        'waiting_approval',
        'retrying',
        'rollback_running',
        'blocked',
      ],
      agentRuntimeUnsupportedStepTypes: [
        'tool',
        'approval',
        'handoff',
        'codex',
        'mcp',
      ],
      agentRuntimeUnsupportedTimelineEventTypes: [
        'tool_step',
        'approval_step',
        'handoff_step',
        'codex_step',
        'mcp_step',
        'step_output',
        'step_error',
        'retry_attempt',
        'rollback_state',
        'run_cancellation',
      ],
      status: 'succeeded',
      attempt: 1,
      retryOf: null,
      docId: 'doc-1',
      sessionId: null,
      errorCode: null,
      hasPreparedRouteTrace: true,
      preparedRouteStepCount: 1,
      preparedRouteCount: 1,
      preparedRouteActualCount: 1,
      preparedRouteStepRouteCounts: ['generate -> 1/1'],
      preparedRouteStepRouteCountMismatches: [],
      preparedRouteStepIds: ['generate'],
      preparedRouteKinds: ['structured'],
      preparedRouteModelIds: ['local/office-structured'],
      preparedRouteProtocols: ['openai_chat'],
      preparedRouteOrder: ['0 -> ollama-main/local/office-structured'],
      preparedRouteFallbackOrder: ['0 -> ollama-main/local/office-structured'],
      preparedRouteStepFallbackProviderIds: ['generate -> ollama-main'],
      preparedRouteProviderIds: ['ollama-main'],
      preparedRouteRequestedModelIds: ['local/office-structured'],
      preparedRouteRequestedModelSources: ['prompt_preference'],
      preparedRouteStepRequestedModelSources: ['generate -> prompt_preference'],
      preparedRouteRequestLayers: ['chat_completions'],
      preparedRouteStepProtocols: ['generate -> openai_chat'],
      preparedRouteStepRequestLayers: ['generate -> chat_completions'],
      preparedRouteStepOrder: [
        'generate / 0 -> ollama-main/local/office-structured',
      ],
      preparedRouteStepFallbackOrder: [
        'generate / 0 -> ollama-main/local/office-structured',
      ],
      preparedRouteFallbackProviderIds: ['ollama-main'],
      preparedRouteTargets: ['ollama-main/local/office-structured'],
      preparedRouteStepTargets: [
        'generate -> ollama-main/local/office-structured',
      ],
      preparedRouteRequestedTargets: [
        'local/office-structured -> ollama-main/local/office-structured',
      ],
      preparedRouteStepRequestedTargets: [
        'generate / local/office-structured -> ollama-main/local/office-structured',
      ],
    }
  );
  t.like(
    diagnostics.find(item => item.id === failedRun.id),
    {
      actionId: 'image.filter.sketch',
      agentRuntimeNativeTraceEventTypes: [],
      agentRuntimeProjectedSchemaComponents: [
        'typescript_projection_contract',
        'graphql_string_diagnostics_fields',
        'graphql_structured_timeline_items',
      ],
      agentRuntimeProjectedRunStatuses: [
        'queued',
        'running',
        'completed',
        'failed',
        'cancelled',
      ],
      agentRuntimeProjectedStepStatuses: [
        'pending',
        'running',
        'completed',
        'failed',
        'skipped',
      ],
      agentRuntimeProjectedStepTypes: ['model'],
      agentRuntimeProjectedTimelineEventTypes: ['run_status', 'model_step'],
      agentRuntimeProjectionSource: 'ai_action_run_agent_runtime_projection/v1',
      agentRuntimeProjectionGaps: [
        'model -> no_prepared_route_trace',
        'tool -> not_projected',
        'approval -> not_projected',
        'handoff -> not_projected',
        'codex -> not_projected',
        'mcp -> not_projected',
      ],
      agentRuntimeRunStatusGaps: [
        'waiting_approval -> not_projected',
        'retrying -> not_projected',
        'rollback_running -> not_projected',
        'archived -> not_projected',
      ],
      agentRuntimeRunId: failedRun.id,
      agentRuntimeRunStatus: 'failed',
      agentRuntimeSchemaReadiness: 'projection_contract_only',
      agentRuntimeSchemaReadinessGaps: [
        'db_agent_run_table -> not_persisted',
        'db_agent_step_table -> not_persisted',
        'graphql_run_status_enum -> string_field',
        'graphql_step_status_enum -> string_field',
        'graphql_step_type_enum -> string_field',
        'schema_migration -> not_created',
        'registry_source_of_truth -> not_created',
      ],
      agentRuntimeStepCount: 0,
      agentRuntimeStepStatusGaps: [
        'waiting_approval -> not_projected',
        'retrying -> not_projected',
        'rollback_running -> not_projected',
        'blocked -> not_projected',
      ],
      agentRuntimeStepIds: [],
      agentRuntimeStepKinds: [],
      agentRuntimeStepStatuses: [],
      agentRuntimeStepTypes: [],
      agentRuntimeTimelineEntries: ['run -> failed'],
      agentRuntimeTimelineEventTypes: ['run_status'],
      agentRuntimeTimelineGaps: [
        'model_step -> no_prepared_route_trace',
        'tool_step -> not_projected',
        'approval_step -> not_projected',
        'handoff_step -> not_projected',
        'codex_step -> not_projected',
        'mcp_step -> not_projected',
        'step_output -> not_projected',
        'step_error -> not_projected',
        'retry_attempt -> not_projected',
        'rollback_state -> not_projected',
        'run_cancellation -> not_projected',
      ],
      agentRuntimeTimelineItems: [
        {
          id: `${failedRun.id}:run_status`,
          eventKey: 'run_status',
          sequence: 0,
          eventType: 'run_status',
          label: 'run -> failed',
          runId: failedRun.id,
          stepId: null,
          stepType: null,
          status: 'failed',
          kind: null,
          routeCount: 0,
          actualRouteCount: 0,
          routeCountMismatch: false,
          routeTargets: [],
          fallbackProviderIds: [],
        },
      ],
      agentRuntimeTargetRunStatuses: [
        'queued',
        'running',
        'waiting_approval',
        'completed',
        'failed',
        'cancelled',
        'retrying',
        'rollback_running',
        'archived',
      ],
      agentRuntimeTargetSchemaComponents: [
        'db_agent_run_table',
        'db_agent_step_table',
        'graphql_run_status_enum',
        'graphql_step_status_enum',
        'graphql_step_type_enum',
        'schema_migration',
        'registry_source_of_truth',
      ],
      agentRuntimeTargetStepStatuses: [
        'pending',
        'running',
        'waiting_approval',
        'completed',
        'failed',
        'skipped',
        'retrying',
        'rollback_running',
        'blocked',
      ],
      agentRuntimeTargetStepTypes: [
        'model',
        'tool',
        'approval',
        'handoff',
        'codex',
        'mcp',
      ],
      agentRuntimeTargetTimelineEventTypes: [
        'run_status',
        'model_step',
        'tool_step',
        'approval_step',
        'handoff_step',
        'codex_step',
        'mcp_step',
        'step_output',
        'step_error',
        'retry_attempt',
        'rollback_state',
        'run_cancellation',
      ],
      agentRuntimeUnsupportedRunStatuses: [
        'waiting_approval',
        'retrying',
        'rollback_running',
        'archived',
      ],
      agentRuntimeUnsupportedStepStatuses: [
        'waiting_approval',
        'retrying',
        'rollback_running',
        'blocked',
      ],
      agentRuntimeUnsupportedStepTypes: [
        'tool',
        'approval',
        'handoff',
        'codex',
        'mcp',
      ],
      agentRuntimeUnsupportedTimelineEventTypes: [
        'tool_step',
        'approval_step',
        'handoff_step',
        'codex_step',
        'mcp_step',
        'step_output',
        'step_error',
        'retry_attempt',
        'rollback_state',
        'run_cancellation',
      ],
      status: 'failed',
      retryOf: run.id,
      errorCode: 'action_bridge_stream_error',
      hasPreparedRouteTrace: false,
      preparedRouteStepCount: 0,
      preparedRouteCount: 0,
      preparedRouteActualCount: 0,
      preparedRouteStepRouteCounts: [],
      preparedRouteStepRouteCountMismatches: [],
      preparedRouteStepIds: [],
      preparedRouteKinds: [],
      preparedRouteModelIds: [],
      preparedRouteOrder: [],
      preparedRouteFallbackOrder: [],
      preparedRouteStepFallbackProviderIds: [],
      preparedRouteProtocols: [],
      preparedRouteProviderIds: [],
      preparedRouteRequestedModelIds: [],
      preparedRouteRequestedModelSources: [],
      preparedRouteStepRequestedModelSources: [],
      preparedRouteRequestLayers: [],
      preparedRouteStepProtocols: [],
      preparedRouteStepOrder: [],
      preparedRouteStepFallbackOrder: [],
      preparedRouteStepRequestLayers: [],
      preparedRouteFallbackProviderIds: [],
      preparedRouteTargets: [],
      preparedRouteStepTargets: [],
      preparedRouteRequestedTargets: [],
      preparedRouteStepRequestedTargets: [],
    }
  );
  t.false('trace' in diagnostics[0]);
  t.false('inputSnapshot' in diagnostics[0]);
  t.false('result' in diagnostics[0]);
  t.false('artifacts' in diagnostics[0]);
  const diagnosticsJson = JSON.stringify(diagnostics);
  t.false(diagnosticsJson.includes('secret prompt'));
  t.false(diagnosticsJson.includes('secret-token'));
  t.false(diagnosticsJson.includes('unsafe event name with spaces'));
});

test('resolver models should expose configured model limits metadata', async t => {
  const { prompt, factory, module } = t.context;
  const resolver = module.get(CopilotResolver);

  const promptName = randomUUID().replaceAll('-', '');
  await prompt.set(
    promptName,
    'ollama-main/office-chat-fast',
    [{ role: 'system', content: 'test' }],
    undefined,
    { optionalModels: ['ollama-main/office-chat-fast'] }
  );

  Sinon.stub(factory, 'getConfiguredModelIds').returns([]);
  Sinon.stub(factory, 'resolveModelId').callsFake(async cond => cond.modelId);
  Sinon.stub(factory, 'describeRoutePolicy').returns({
    enabled: true,
    featureKind: 'chat',
    preferredPrivacy: ['local', 'private_cloud', 'cloud'],
  });
  Sinon.stub(factory, 'resolveProvider').callsFake(async cond => {
    if (cond.modelId !== 'ollama-main/office-chat-fast') {
      return null;
    }
    return {
      providerId: 'ollama-main',
      rawModelId: cond.modelId,
      modelId: 'office-chat-fast',
      fallbackProviderIds: ['ollama-main', 'openai-default'],
      profile: {
        id: 'ollama-main',
        displayName: 'Local Ollama',
        type: CopilotProviderType.OpenAICompatible,
        enabled: true,
        priority: 10,
        privacy: 'local',
        health: { status: 'healthy' },
        config: {},
        middleware: {},
      },
      provider: {
        resolveModel: (modelId: string) => ({
          id: 'qwen3:32b',
          name: `Resolved ${modelId}`,
          backendKind: 'openai_chat',
          canonicalKey: 'office-chat-fast',
          protocol: 'openai_chat',
          requestLayer: 'chat_completions',
          behaviorFlags: ['disable_parallel_tool_calls'],
          capabilities: [
            {
              input: [ModelInputType.Text],
              output: [ModelOutputType.Text],
            },
            {
              input: [ModelInputType.Text, ModelInputType.Image],
              output: [ModelOutputType.Structured],
            },
          ],
          limits: {
            contextWindow: 32768,
            maxOutputTokens: 4096,
            embeddingDimensions: 1024,
          },
          cost: {
            inputPer1M: 0.2,
            outputPer1M: 0.8,
          },
        }),
      },
    } as any;
  });

  const models = await resolver.models(promptName);

  t.is(models.defaultModel, 'ollama-main/office-chat-fast');
  t.is(models.promptDefaultModel, 'ollama-main/office-chat-fast');
  t.is(models.defaultModelSource, 'prompt');
  t.is(models.defaultModelFallbackReason, undefined);
  t.deepEqual(models.optionalModels, [
    {
      id: 'ollama-main/office-chat-fast',
      name: 'Resolved office-chat-fast',
      sources: ['default', 'prompt'],
      promptName,
      promptSource: 'compat',
      promptCategory: 'text',
      promptModelSource: 'compat',
      promptModelSources: [
        {
          candidateSource: 'default',
          modelSource: 'compat',
        },
        {
          candidateSource: 'prompt',
          modelSource: 'compat',
        },
      ],
      promptOverrideApplied: false,
      providerId: 'ollama-main',
      providerName: 'Local Ollama',
      providerProfileId: 'ollama-main',
      routeModelId: 'qwen3:32b',
      routeFallbackProviderIds: ['ollama-main', 'openai-default'],
      routeBackendKind: 'openai_chat',
      routeCanonicalModelKey: 'office-chat-fast',
      routeModelDefinitionId: 'office-chat-fast',
      routeModelDefinitionSource: 'native_registry',
      routeProtocol: 'openai_chat',
      routeRawModelId: 'qwen3:32b',
      routeRequestLayer: 'chat_completions',
      routeBehaviorFlags: ['disable_parallel_tool_calls'],
      routeInputTypes: [ModelInputType.Text, ModelInputType.Image],
      routeOutputTypes: [ModelOutputType.Text, ModelOutputType.Structured],
      providerType: CopilotProviderType.OpenAICompatible,
      providerPrivacy: 'local',
      providerHealth: 'healthy',
      providerPriority: 10,
      routePolicyEnabled: true,
      routePolicyFeatureKind: 'chat',
      routePolicyPreferredPrivacy: ['local', 'private_cloud', 'cloud'],
      contextWindow: 32768,
      maxOutputTokens: 4096,
      embeddingDimensions: 1024,
      costInputPer1M: 0.2,
      costOutputPer1M: 0.8,
    },
  ]);
});

test('resolver models should include configured provider models and fallback default', async t => {
  const { prompt, factory, module } = t.context;
  const resolver = module.get(CopilotResolver);

  const promptName = randomUUID().replaceAll('-', '');
  await prompt.set(
    promptName,
    'gemini-2.5-flash',
    [{ role: 'system', content: 'test' }],
    undefined,
    { optionalModels: ['gemini-2.5-flash'] }
  );

  Sinon.stub(factory, 'getConfiguredModelIds').returns([
    'openai-default/gpt-5-mini',
  ]);
  Sinon.stub(factory, 'describeRoutePolicy').returns({
    enabled: true,
    featureKind: 'chat',
  });
  Sinon.stub(factory, 'resolveModelId').callsFake(async cond => {
    if (cond.modelId === 'gemini-2.5-flash') {
      return undefined;
    }
    if (!cond.modelId && cond.outputType === ModelOutputType.Text) {
      return 'openai-default/gpt-5-mini';
    }
    if (cond.modelId === 'openai-default/gpt-5-mini') {
      return 'openai-default/gpt-5-mini';
    }
    return cond.modelId;
  });
  Sinon.stub(factory, 'resolveProvider').callsFake(async cond => {
    if (cond.modelId !== 'openai-default/gpt-5-mini') {
      return null;
    }
    return {
      providerId: 'openai-default',
      rawModelId: cond.modelId,
      modelId: String(cond.modelId).replace('openai-default/', ''),
      fallbackProviderIds: ['openai-default'],
      profile: {
        id: 'openai-default',
        type: CopilotProviderType.OpenAI,
        enabled: true,
        priority: 10,
        privacy: 'cloud',
        health: { status: 'healthy' },
        config: {},
        middleware: {},
      },
      provider: {
        resolveModel: (modelId: string) => ({
          id: modelId,
          name: `Resolved ${modelId}`,
        }),
      },
    } as any;
  });

  const models = await resolver.models(promptName);

  t.is(models.defaultModel, 'openai-default/gpt-5-mini');
  t.is(models.promptDefaultModel, 'gemini-2.5-flash');
  t.is(models.defaultModelSource, 'fallback_route');
  t.is(models.defaultModelFallbackReason, 'prompt_default_unavailable');
  t.deepEqual(
    models.optionalModels.map(model => ({
      id: model.id,
      promptModelSources: model.promptModelSources,
      routeModelId: model.routeModelId,
      sources: model.sources,
    })),
    [
      {
        id: 'openai-default/gpt-5-mini',
        promptModelSources: [
          {
            candidateSource: 'fallback_route',
          },
          {
            candidateSource: 'registry',
          },
        ],
        routeModelId: 'gpt-5-mini',
        sources: ['fallback_route', 'registry'],
      },
    ]
  );
});

test('resolver models should inherit workspace route policy context from copilot parent', async t => {
  const { prompt, factory, module } = t.context;
  const resolver = module.get(CopilotResolver);

  const promptName = randomUUID().replaceAll('-', '');
  await prompt.set(
    promptName,
    'ollama-main/office-chat-fast',
    [{ role: 'system', content: 'test' }],
    undefined,
    { optionalModels: ['ollama-main/office-chat-fast'] }
  );

  Sinon.stub(factory, 'getConfiguredModelIds').returns([]);
  const describeRoutePolicy = Sinon.stub(
    factory,
    'describeRoutePolicy'
  ).callsFake(context => {
    if (context.featureKind === 'chat') {
      return {
        enabled: true,
        featureKind: 'chat',
        workspaceId: 'workspace-local-only',
        allowedPrivacy: ['local'],
        preferredPrivacy: ['local'],
      };
    }
    return {
      enabled: true,
      featureKind: context.featureKind,
      workspaceId: 'workspace-local-only',
      preferredPrivacy: ['local'],
    };
  });
  Sinon.stub(factory, 'resolveModelId').callsFake(async cond => cond.modelId);
  const resolveProvider = Sinon.stub(factory, 'resolveProvider').callsFake(
    async cond =>
      ({
        providerId: 'ollama-main',
        rawModelId: cond.modelId,
        modelId: 'office-chat-fast',
        fallbackProviderIds: ['ollama-main'],
        profile: {
          id: 'ollama-main',
          displayName: 'Local Ollama',
          type: CopilotProviderType.OpenAICompatible,
          enabled: true,
          priority: 10,
          privacy: 'local',
          health: {
            status: 'healthy',
            lastCheckedAt: '2026-06-15T10:00:00.000Z',
            lastError: 'previous timeout',
          },
          config: {},
          middleware: {},
        },
        provider: {
          resolveModel: (modelId: string) => ({
            id: modelId,
            name: `Resolved ${modelId}`,
          }),
        },
      }) as any
  );

  const models = await resolver.models(promptName, {
    workspaceId: 'workspace-local-only',
  });

  t.true(
    describeRoutePolicy.calledWithMatch({
      featureKind: 'chat',
      workspaceId: 'workspace-local-only',
    })
  );
  t.true(
    resolveProvider.alwaysCalledWithMatch(Sinon.match.any, Sinon.match.any, {
      featureKind: 'chat',
      workspaceId: 'workspace-local-only',
    })
  );
  t.deepEqual(models.optionalModels, [
    {
      id: 'ollama-main/office-chat-fast',
      name: 'Resolved office-chat-fast',
      sources: ['default', 'prompt'],
      promptName,
      promptSource: 'compat',
      promptCategory: 'text',
      promptModelSource: 'compat',
      promptModelSources: [
        {
          candidateSource: 'default',
          modelSource: 'compat',
        },
        {
          candidateSource: 'prompt',
          modelSource: 'compat',
        },
      ],
      promptOverrideApplied: false,
      providerId: 'ollama-main',
      providerName: 'Local Ollama',
      providerProfileId: 'ollama-main',
      routeModelId: 'office-chat-fast',
      routeFallbackProviderIds: ['ollama-main'],
      providerType: CopilotProviderType.OpenAICompatible,
      providerPrivacy: 'local',
      providerHealth: 'healthy',
      providerHealthCheckedAt: '2026-06-15T10:00:00.000Z',
      providerHealthLastError: 'previous timeout',
      providerPriority: 10,
      routePolicyEnabled: true,
      routePolicyFeatureKind: 'chat',
      routePolicyWorkspaceId: 'workspace-local-only',
      routePolicyAllowedPrivacy: ['local'],
      routePolicyPreferredPrivacy: ['local'],
    },
  ]);
});

test('resolver models should expose workspace task route diagnostics', async t => {
  const { prompt, factory, module, chatRuntime, taskPolicy } = t.context;
  const resolver = module.get(CopilotResolver);

  const promptName = randomUUID().replaceAll('-', '');
  await prompt.set(
    promptName,
    'ollama-main/office-chat-fast',
    [{ role: 'system', content: 'test' }],
    undefined,
    { optionalModels: ['ollama-main/office-chat-fast'] }
  );

  Sinon.stub(factory, 'getConfiguredModelIds').returns([]);
  Sinon.stub(factory, 'describeRoutePolicy').callsFake(context => {
    if (context.featureKind === 'workspace_indexing') {
      return {
        enabled: true,
        featureKind: 'workspace_indexing',
        workspaceId: 'workspace-local-only',
        allowedProviderIds: ['ollama-main', 'openai-default'],
        blockedProviderIds: ['blocked-cloud'],
        allowedPrivacy: ['local', 'private_cloud'],
        preferredPrivacy: ['local', 'private_cloud'],
      };
    }
    if (context.featureKind === 'rerank') {
      return {
        enabled: true,
        featureKind: 'rerank',
        workspaceId: 'workspace-local-only',
        allowedProviderIds: ['ollama-main'],
        blockedProviderIds: ['blocked-cloud'],
        allowedPrivacy: ['local'],
        preferredPrivacy: ['local'],
      };
    }
    return {
      enabled: true,
      featureKind: 'chat',
    };
  });
  Sinon.stub(factory, 'describeRoutePolicyCandidates').callsFake(context => {
    if (context.featureKind === 'workspace_indexing') {
      return [
        {
          providerId: 'ollama-main',
          privacy: 'local',
          health: 'healthy',
          available: true,
          allowed: true,
          reasons: ['candidate_allowed', 'privacy_preferred'],
        },
        {
          providerId: 'openai-default',
          privacy: 'private_cloud',
          health: 'degraded',
          available: true,
          allowed: true,
          reasons: ['candidate_allowed', 'privacy_preferred'],
        },
        {
          providerId: 'blocked-cloud',
          privacy: 'cloud',
          health: 'healthy',
          available: true,
          allowed: false,
          reasons: ['provider_blocked', 'privacy_not_allowed'],
        },
      ];
    }
    if (context.featureKind === 'rerank') {
      return [
        {
          providerId: 'ollama-main',
          privacy: 'local',
          health: 'healthy',
          available: true,
          allowed: true,
          reasons: ['candidate_allowed', 'privacy_preferred'],
        },
        {
          providerId: 'blocked-cloud',
          privacy: 'cloud',
          health: 'down',
          available: false,
          allowed: false,
          reasons: [
            'provider_unavailable',
            'provider_blocked',
            'privacy_not_allowed',
          ],
        },
      ];
    }
    return [];
  });
  Sinon.stub(factory, 'describeRouteCandidates').callsFake(async cond => {
    if (cond.outputType === ModelOutputType.Embedding) {
      return [
        {
          registryKind: 'byok',
          registryAvailable: true,
          registrySelected: true,
          providerId: 'ollama-main',
          requestedModelId: 'workspace-embedding',
          modelId: 'workspace-embedding',
          candidateModelIds: ['workspace-embedding', 'local-embedding'],
          matched: true,
          reasons: ['capability_matched'],
        },
        {
          registryKind: 'byok',
          registryAvailable: true,
          registrySelected: true,
          providerId: 'ollama-main',
          requestedModelId: 'workspace-embedding-large',
          modelId: 'workspace-embedding-large',
          candidateModelIds: ['workspace-embedding-large'],
          matched: true,
          reasons: ['capability_matched'],
        },
        {
          registryKind: 'quota_backed',
          registryAvailable: true,
          registrySelected: false,
          providerId: 'openai-default',
          candidateModelIds: ['text-embedding-3-small'],
          matched: true,
          modelId: 'text-embedding-3-small',
          reasons: ['profile_model_matched', 'capability_matched'],
        },
        {
          registryKind: 'quota_backed',
          registryAvailable: true,
          registrySelected: false,
          providerId: 'openai-prepare-filtered',
          candidateModelIds: ['text-embedding-3-large'],
          matched: true,
          modelId: 'text-embedding-3-large',
          reasons: ['profile_model_matched', 'capability_matched'],
        },
      ];
    }
    if (cond.outputType === ModelOutputType.Rerank) {
      return [
        {
          registryKind: 'byok',
          registryAvailable: true,
          registrySelected: true,
          providerId: 'ollama-main',
          requestedModelId: 'office-rerank',
          modelId: 'office-rerank',
          candidateModelIds: ['office-rerank'],
          matched: true,
          reasons: ['capability_matched'],
        },
        {
          registryKind: 'quota_backed',
          registryAvailable: false,
          registrySelected: false,
          providerId: 'blocked-cloud',
          requestedModelId: 'office-rerank',
          candidateModelIds: ['cloud-rerank'],
          matched: false,
          reasons: ['profile_model_not_allowed'],
        },
      ];
    }
    return [];
  });
  Sinon.stub(factory, 'describeEmbeddingPrepareCandidates').resolves([
    {
      providerId: 'ollama-main',
      modelId: 'workspace-embedding',
      prepared: true,
      preparedModelId: 'nomic-embed-text',
      reasons: ['provider_prepare_succeeded'],
    },
    {
      providerId: 'openai-default',
      modelId: 'text-embedding-3-small',
      prepared: true,
      preparedModelId: 'text-embedding-3-small',
      reasons: ['provider_prepare_succeeded'],
    },
    {
      providerId: 'openai-prepare-filtered',
      modelId: 'text-embedding-3-large',
      prepared: false,
      reasons: ['provider_prepare_returned_empty'],
    },
  ]);
  Sinon.stub(factory, 'describeRerankPrepareCandidates').resolves([
    {
      providerId: 'ollama-main',
      modelId: 'office-rerank',
      prepared: true,
      preparedModelId: 'bge-reranker-v2',
      reasons: ['provider_prepare_succeeded'],
    },
  ]);
  Sinon.stub(factory, 'resolveModelId').callsFake(async cond => cond.modelId);
  Sinon.stub(factory, 'resolveProvider').callsFake(
    async cond =>
      ({
        providerId: 'ollama-main',
        rawModelId: cond.modelId,
        modelId: 'office-chat-fast',
        fallbackProviderIds: ['ollama-main'],
        profile: {
          id: 'ollama-main',
          displayName: 'Local Ollama',
          type: CopilotProviderType.OpenAICompatible,
          enabled: true,
          priority: 10,
          privacy: 'local',
          health: { status: 'healthy' },
          config: {},
          middleware: {},
        },
        provider: {
          resolveModel: (modelId: string) => ({
            id: modelId,
            name: `Resolved ${modelId}`,
          }),
        },
      }) as any
  );
  Sinon.stub(taskPolicy, 'resolveWorkspaceIndexingModel').returns({
    configKey: 'workspaceIndexing',
    configPath: 'copilot.tasks.models.workspaceIndexing',
    modelId: 'ollama-main/workspace-embedding',
    source: 'workspace_indexing',
  });
  Sinon.stub(taskPolicy, 'resolveRerankModel').returns({
    configKey: 'rerank',
    configPath: 'copilot.tasks.models.rerank',
    modelId: 'ollama-main/office-rerank',
    source: 'rerank',
  });
  const describeEmbeddingRoute = Sinon.stub(
    chatRuntime,
    'describeEmbeddingRoute'
  ).resolves({
    configured: true,
    errorCode: undefined,
    errorMessage: undefined,
    fallbackOrder: ['ollama-main', 'openai-default'],
    preparedProviderCount: 2,
    preparedRoutes: [
      {
        providerId: 'ollama-main',
        modelId: 'nomic-embed-text',
        protocol: 'openai_chat',
        requestLayer: 'chat_completions',
        modelBackendKind: 'openai_chat',
        canonicalModelKey: 'workspace-embedding',
        behaviorFlags: ['disable_batch_embeddings'],
      },
      {
        providerId: 'openai-default',
        modelId: 'text-embedding-3-small',
        protocol: 'openai_responses',
        requestLayer: 'responses',
        modelBackendKind: 'openai_responses',
        canonicalModelKey: 'workspace-embedding-fallback',
        behaviorFlags: ['embedding_fallback'],
      },
    ],
    requestedModelId: 'ollama-main/workspace-embedding',
    providerId: 'ollama-main',
    modelId: 'nomic-embed-text',
    protocol: 'openai_chat',
    requestLayer: 'chat_completions',
    modelBackendKind: 'openai_chat',
    canonicalModelKey: 'workspace-embedding',
    behaviorFlags: ['disable_batch_embeddings'],
    requestedDimensions: EMBEDDING_DIMENSIONS,
    modelEmbeddingDimensions: 768,
    dimensionMismatch: true,
  });
  const describeRerankRoute = Sinon.stub(
    chatRuntime,
    'describeRerankRoute'
  ).resolves({
    configured: true,
    errorCode: undefined,
    errorMessage: undefined,
    fallbackOrder: ['ollama-main'],
    preparedProviderCount: 1,
    preparedRoutes: [
      {
        providerId: 'ollama-main',
        modelId: 'bge-reranker-v2',
        protocol: 'openai_chat',
        requestLayer: 'chat_completions',
        modelBackendKind: 'openai_chat',
        canonicalModelKey: 'office-rerank',
        behaviorFlags: ['rerank_cross_encoder'],
      },
    ],
    requestedModelId: 'ollama-main/office-rerank',
    providerId: 'ollama-main',
    modelId: 'bge-reranker-v2',
    protocol: 'openai_chat',
    requestLayer: 'chat_completions',
    modelBackendKind: 'openai_chat',
    canonicalModelKey: 'office-rerank',
    behaviorFlags: ['rerank_cross_encoder'],
    candidateCount: 1,
  });

  const models = await resolver.models(promptName, {
    workspaceId: 'workspace-local-only',
  });
  const embeddingMainCandidateKey = JSON.stringify([
    'byok',
    'ollama-main',
    'workspace-embedding',
    'workspace-embedding',
    ['local-embedding', 'workspace-embedding'],
  ]);
  const embeddingLargeCandidateKey = JSON.stringify([
    'byok',
    'ollama-main',
    'workspace-embedding-large',
    'workspace-embedding-large',
    ['workspace-embedding-large'],
  ]);
  const embeddingOpenAICandidateKey = JSON.stringify([
    'quota_backed',
    'openai-default',
    '',
    'text-embedding-3-small',
    ['text-embedding-3-small'],
  ]);
  const embeddingFilteredCandidateKey = JSON.stringify([
    'quota_backed',
    'openai-prepare-filtered',
    '',
    'text-embedding-3-large',
    ['text-embedding-3-large'],
  ]);
  const rerankMainCandidateKey = JSON.stringify([
    'byok',
    'ollama-main',
    'office-rerank',
    'office-rerank',
    ['office-rerank'],
  ]);
  const rerankBlockedCandidateKey = JSON.stringify([
    'quota_backed',
    'blocked-cloud',
    'office-rerank',
    '',
    ['cloud-rerank', 'office-rerank'],
  ]);
  const normalizeTaskRouteDiagnosticsForAssertion = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (key, item) =>
        key === 'candidateFingerprint' ||
        (key === 'candidateKey' &&
          typeof item === 'string' &&
          item.startsWith('["policy"'))
          ? undefined
          : item
      )
    );

  t.true(
    models.embeddingRoute?.policyCandidates.every(
      candidate => candidate.candidateKey && candidate.candidateFingerprint
    )
  );
  t.true(
    models.rerankRoute?.policyCandidates.every(
      candidate => candidate.candidateKey && candidate.candidateFingerprint
    )
  );
  const embeddingRoute = normalizeTaskRouteDiagnosticsForAssertion(
    models.embeddingRoute
  );
  const rerankRoute = normalizeTaskRouteDiagnosticsForAssertion(
    models.rerankRoute
  );

  t.deepEqual(embeddingRoute, {
    configured: true,
    diagnosticsErrors: [],
    featureKind: 'workspace_indexing',
    policyEnabled: true,
    policyFeatureKind: 'workspace_indexing',
    policyWorkspaceId: 'workspace-local-only',
    policyAllowedProviderIds: ['ollama-main', 'openai-default'],
    policyBlockedProviderIds: ['blocked-cloud'],
    policyAllowedPrivacy: ['local', 'private_cloud'],
    policyPreferredPrivacy: ['local', 'private_cloud'],
    policyCandidates: [
      {
        providerId: 'ollama-main',
        privacy: 'local',
        health: 'healthy',
        available: true,
        allowed: true,
        reasons: ['candidate_allowed', 'privacy_preferred'],
      },
      {
        providerId: 'openai-default',
        privacy: 'private_cloud',
        health: 'degraded',
        available: true,
        allowed: true,
        reasons: ['candidate_allowed', 'privacy_preferred'],
      },
      {
        providerId: 'blocked-cloud',
        privacy: 'cloud',
        health: 'healthy',
        available: true,
        allowed: false,
        reasons: ['provider_blocked', 'privacy_not_allowed'],
      },
    ],
    routeCandidates: [
      {
        candidateKey: embeddingMainCandidateKey,
        registryKind: 'byok',
        registryAvailable: true,
        registrySelected: true,
        providerId: 'ollama-main',
        requestedModelId: 'workspace-embedding',
        modelId: 'workspace-embedding',
        candidateModelIds: ['workspace-embedding', 'local-embedding'],
        matched: true,
        reasons: ['capability_matched'],
      },
      {
        candidateKey: embeddingLargeCandidateKey,
        registryKind: 'byok',
        registryAvailable: true,
        registrySelected: true,
        providerId: 'ollama-main',
        requestedModelId: 'workspace-embedding-large',
        modelId: 'workspace-embedding-large',
        candidateModelIds: ['workspace-embedding-large'],
        matched: true,
        reasons: ['capability_matched'],
      },
      {
        candidateKey: embeddingOpenAICandidateKey,
        registryKind: 'quota_backed',
        registryAvailable: true,
        registrySelected: false,
        providerId: 'openai-default',
        candidateModelIds: ['text-embedding-3-small'],
        matched: true,
        modelId: 'text-embedding-3-small',
        reasons: ['profile_model_matched', 'capability_matched'],
      },
      {
        candidateKey: embeddingFilteredCandidateKey,
        registryKind: 'quota_backed',
        registryAvailable: true,
        registrySelected: false,
        providerId: 'openai-prepare-filtered',
        candidateModelIds: ['text-embedding-3-large'],
        matched: true,
        modelId: 'text-embedding-3-large',
        reasons: ['profile_model_matched', 'capability_matched'],
      },
    ],
    routeTrace: [
      {
        phase: 'policy',
        candidateCount: 3,
        availableCount: 3,
        selectedCount: 2,
        blockedCount: 1,
        reasons: [
          'candidate_allowed',
          'privacy_preferred',
          'provider_blocked',
          'privacy_not_allowed',
        ],
      },
      {
        phase: 'resolution',
        candidateCount: 4,
        availableCount: 4,
        selectedCount: 2,
        matchedCount: 4,
        reasons: ['capability_matched', 'profile_model_matched'],
      },
      {
        phase: 'prepared',
        candidateCount: 4,
        selectedCount: 1,
        preparedCount: 2,
        reasons: [
          'prepared_route_filtered',
          'provider_prepare_succeeded',
          'provider_prepare_returned_empty',
        ],
      },
    ],
    prepareCandidates: [
      {
        candidateKey: embeddingMainCandidateKey,
        registryKind: 'byok',
        registryAvailable: true,
        registrySelected: true,
        providerId: 'ollama-main',
        requestedModelId: 'workspace-embedding',
        modelId: 'workspace-embedding',
        candidateModelIds: ['workspace-embedding', 'local-embedding'],
        prepared: true,
        preparedModelId: 'nomic-embed-text',
        reasons: [
          'prepared_route_available',
          'provider_prepare_succeeded',
          'prepared_model_resolved',
        ],
      },
      {
        candidateKey: embeddingLargeCandidateKey,
        registryKind: 'byok',
        registryAvailable: true,
        registrySelected: true,
        providerId: 'ollama-main',
        requestedModelId: 'workspace-embedding-large',
        modelId: 'workspace-embedding-large',
        candidateModelIds: ['workspace-embedding-large'],
        prepared: false,
        reasons: ['prepared_route_filtered'],
      },
      {
        candidateKey: embeddingOpenAICandidateKey,
        registryKind: 'quota_backed',
        registryAvailable: true,
        registrySelected: false,
        providerId: 'openai-default',
        modelId: 'text-embedding-3-small',
        candidateModelIds: ['text-embedding-3-small'],
        prepared: true,
        preparedModelId: 'text-embedding-3-small',
        reasons: ['prepared_route_available', 'provider_prepare_succeeded'],
      },
      {
        candidateKey: embeddingFilteredCandidateKey,
        registryKind: 'quota_backed',
        registryAvailable: true,
        registrySelected: false,
        providerId: 'openai-prepare-filtered',
        modelId: 'text-embedding-3-large',
        candidateModelIds: ['text-embedding-3-large'],
        prepared: false,
        reasons: [
          'prepared_route_not_selected',
          'provider_prepare_returned_empty',
        ],
      },
    ],
    fallbackProviderIds: ['ollama-main', 'openai-default'],
    preparedProviderCount: 2,
    preparedRouteTargets: [
      'ollama-main/nomic-embed-text',
      'openai-default/text-embedding-3-small',
    ],
    preparedRouteTargetFingerprint: taskRouteTargetFingerprintFixture({
      featureKind: 'workspace_indexing',
      targets: [
        'ollama-main/nomic-embed-text',
        'openai-default/text-embedding-3-small',
      ],
    }),
    preparedRoutes: [
      {
        providerId: 'ollama-main',
        modelId: 'nomic-embed-text',
        protocol: 'openai_chat',
        requestLayer: 'chat_completions',
        modelBackendKind: 'openai_chat',
        canonicalModelKey: 'workspace-embedding',
        behaviorFlags: ['disable_batch_embeddings'],
      },
      {
        providerId: 'openai-default',
        modelId: 'text-embedding-3-small',
        protocol: 'openai_responses',
        requestLayer: 'responses',
        modelBackendKind: 'openai_responses',
        canonicalModelKey: 'workspace-embedding-fallback',
        behaviorFlags: ['embedding_fallback'],
      },
    ],
    requestedModelId: 'ollama-main/workspace-embedding',
    requestedModelConfigKey: 'workspaceIndexing',
    requestedModelConfigPath: 'copilot.tasks.models.workspaceIndexing',
    requestedModelSource: 'workspace_indexing',
    providerId: 'ollama-main',
    modelId: 'nomic-embed-text',
    protocol: 'openai_chat',
    requestLayer: 'chat_completions',
    modelBackendKind: 'openai_chat',
    canonicalModelKey: 'workspace-embedding',
    behaviorFlags: ['disable_batch_embeddings'],
    requestedDimensions: EMBEDDING_DIMENSIONS,
    modelEmbeddingDimensions: 768,
    dimensionMismatch: true,
  });
  t.deepEqual(rerankRoute, {
    configured: true,
    diagnosticsErrors: [],
    featureKind: 'rerank',
    policyEnabled: true,
    policyFeatureKind: 'rerank',
    policyWorkspaceId: 'workspace-local-only',
    policyAllowedProviderIds: ['ollama-main'],
    policyBlockedProviderIds: ['blocked-cloud'],
    policyAllowedPrivacy: ['local'],
    policyPreferredPrivacy: ['local'],
    policyCandidates: [
      {
        providerId: 'ollama-main',
        privacy: 'local',
        health: 'healthy',
        available: true,
        allowed: true,
        reasons: ['candidate_allowed', 'privacy_preferred'],
      },
      {
        providerId: 'blocked-cloud',
        privacy: 'cloud',
        health: 'down',
        available: false,
        allowed: false,
        reasons: [
          'provider_unavailable',
          'provider_blocked',
          'privacy_not_allowed',
        ],
      },
    ],
    routeCandidates: [
      {
        candidateKey: rerankMainCandidateKey,
        registryKind: 'byok',
        registryAvailable: true,
        registrySelected: true,
        providerId: 'ollama-main',
        requestedModelId: 'office-rerank',
        modelId: 'office-rerank',
        candidateModelIds: ['office-rerank'],
        matched: true,
        reasons: ['capability_matched'],
      },
      {
        candidateKey: rerankBlockedCandidateKey,
        registryKind: 'quota_backed',
        registryAvailable: false,
        registrySelected: false,
        providerId: 'blocked-cloud',
        requestedModelId: 'office-rerank',
        candidateModelIds: ['cloud-rerank'],
        matched: false,
        reasons: ['profile_model_not_allowed'],
      },
    ],
    routeTrace: [
      {
        phase: 'policy',
        candidateCount: 2,
        availableCount: 1,
        selectedCount: 1,
        blockedCount: 1,
        reasons: [
          'candidate_allowed',
          'privacy_preferred',
          'provider_unavailable',
          'provider_blocked',
          'privacy_not_allowed',
        ],
      },
      {
        phase: 'resolution',
        candidateCount: 2,
        availableCount: 1,
        selectedCount: 1,
        matchedCount: 1,
        reasons: ['capability_matched', 'profile_model_not_allowed'],
      },
      {
        phase: 'prepared',
        candidateCount: 1,
        selectedCount: 1,
        preparedCount: 1,
        reasons: ['provider_prepare_succeeded'],
      },
    ],
    prepareCandidates: [
      {
        candidateKey: rerankMainCandidateKey,
        registryKind: 'byok',
        registryAvailable: true,
        registrySelected: true,
        providerId: 'ollama-main',
        requestedModelId: 'office-rerank',
        modelId: 'office-rerank',
        candidateModelIds: ['office-rerank'],
        prepared: true,
        preparedModelId: 'bge-reranker-v2',
        reasons: [
          'prepared_route_available',
          'provider_prepare_succeeded',
          'prepared_model_resolved',
        ],
      },
    ],
    fallbackProviderIds: ['ollama-main'],
    preparedProviderCount: 1,
    preparedRouteTargets: ['ollama-main/bge-reranker-v2'],
    preparedRouteTargetFingerprint: taskRouteTargetFingerprintFixture({
      featureKind: 'rerank',
      targets: ['ollama-main/bge-reranker-v2'],
    }),
    preparedRoutes: [
      {
        providerId: 'ollama-main',
        modelId: 'bge-reranker-v2',
        protocol: 'openai_chat',
        requestLayer: 'chat_completions',
        modelBackendKind: 'openai_chat',
        canonicalModelKey: 'office-rerank',
        behaviorFlags: ['rerank_cross_encoder'],
      },
    ],
    requestedModelId: 'ollama-main/office-rerank',
    requestedModelConfigKey: 'rerank',
    requestedModelConfigPath: 'copilot.tasks.models.rerank',
    requestedModelSource: 'rerank',
    providerId: 'ollama-main',
    modelId: 'bge-reranker-v2',
    protocol: 'openai_chat',
    requestLayer: 'chat_completions',
    modelBackendKind: 'openai_chat',
    canonicalModelKey: 'office-rerank',
    behaviorFlags: ['rerank_cross_encoder'],
    candidateCount: 1,
  });
  Sinon.assert.calledOnceWithExactly(
    describeEmbeddingRoute,
    'ollama-main/workspace-embedding',
    {
      workspace: 'workspace-local-only',
      dimensions: EMBEDDING_DIMENSIONS,
      featureKind: 'workspace_indexing',
    }
  );
  Sinon.assert.calledOnceWithExactly(
    describeRerankRoute,
    'ollama-main/office-rerank',
    {
      workspace: 'workspace-local-only',
      featureKind: 'rerank',
    }
  );
});
