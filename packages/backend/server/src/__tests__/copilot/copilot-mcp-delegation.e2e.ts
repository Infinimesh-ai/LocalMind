import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { McpAccessMode, PrismaClient } from '@prisma/client';
import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';

import { AppModule } from '../../app.module';
import { ConfigModule } from '../../base/config';
import { AuthService } from '../../core/auth';
import { DocReader, DocWriter } from '../../core/doc';
import { PermissionAccess } from '../../core/permission';
import { Models, WorkspaceMemberStatus, WorkspaceRole } from '../../models';
import { CopilotAgentRuntimeWorker } from '../../plugins/copilot/agent-runtime-worker';
import {
  MCP_CAPABILITIES,
  MCP_DELEGATE_CAPABILITY,
  MCP_TASK_CONTROL_CAPABILITY,
} from '../../plugins/copilot/mcp/capabilities';
import { McpCredentialService } from '../../plugins/copilot/mcp/credential';
import { McpAiDelegationService } from '../../plugins/copilot/mcp/delegation';
import { McpAiTaskControlService } from '../../plugins/copilot/mcp/task-control';
import { McpAiTaskQueryService } from '../../plugins/copilot/mcp/task-query';
import {
  createModelRouteLock,
  createQwen36CompletionContract,
  QWEN36_COMPLETION_CONTRACT_VERSION,
  QWEN36_FINAL_ANSWER_REPAIR_MAX_TOKENS,
  QWEN36_MODEL_ADAPTER_VERSION,
  resolveModelAdapter,
} from '../../plugins/copilot/model-adapters';
import { CapabilityRuntime } from '../../plugins/copilot/runtime/capability-runtime';
import { buildDocCreateHandler } from '../../plugins/copilot/tools/doc-write';
import { createTestingApp, TestingApp, TestUser } from '../utils';

type CapturedCallback = {
  body: string;
  headers: Record<string, string | string[] | undefined>;
};

type Context = {
  app?: TestingApp;
  auth: AuthService;
  callbacks: CapturedCallback[];
  callbackOrigin: string;
  callbackServer: Server;
  credentials: McpCredentialService;
  db: PrismaClient;
  delegation: McpAiDelegationService;
  models: Models;
  owner: TestUser;
  runtime: CapabilityRuntime;
  taskControl: McpAiTaskControlService;
  taskQuery: McpAiTaskQueryService;
  worker: CopilotAgentRuntimeWorker;
};

function plannerResult(result: Record<string, unknown>) {
  return {
    answer: '',
    docId: '',
    content: '',
    summary: '',
    reason: '',
    ...result,
  };
}

const test = ava.serial as TestFn<Context>;

test.before(async t => {
  const callbacks: CapturedCallback[] = [];
  const callbackServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    callbacks.push({
      body: Buffer.concat(chunks).toString('utf8'),
      headers: request.headers,
    });
    response.statusCode = 204;
    response.end();
  });
  const callbackOrigin = await listen(callbackServer);
  t.context.callbacks = callbacks;
  t.context.callbackOrigin = callbackOrigin;
  t.context.callbackServer = callbackServer;

  let app: TestingApp;
  try {
    app = await createTestingApp({
      imports: [
        ConfigModule.override({
          copilot: {
            localModelAdapters: { evaluationMode: true },
            mcpDelegation: { callbackAllowedOrigins: [callbackOrigin] },
            providers: { openai: { apiKey: '1' } },
          },
        }),
        AppModule,
      ],
    });
  } catch (error) {
    console.error('Failed to create MCP delegation testing app', error);
    await close(callbackServer);
    throw error;
  }

  t.context.app = app;
  t.context.auth = app.get(AuthService);
  t.context.credentials = app.get(McpCredentialService);
  t.context.db = app.get(PrismaClient);
  t.context.delegation = app.get(McpAiDelegationService);
  t.context.models = app.get(Models);
  t.context.runtime = app.get(CapabilityRuntime);
  t.context.taskControl = app.get(McpAiTaskControlService);
  t.context.taskQuery = app.get(McpAiTaskQueryService);
  t.context.worker = app.get(CopilotAgentRuntimeWorker);
});

test.beforeEach(async t => {
  Sinon.restore();
  t.context.callbacks.length = 0;
  await t.context.app!.initTestingDB();
  t.context.owner = await t.context.app!.signupV1();
});

test.after.always(async t => {
  Sinon.restore();
  if (t.context.callbackServer?.listening) {
    await close(t.context.callbackServer);
  }
  await t.context.app?.close();
});

test('callback URL policy accepts public HTTPS and allowlisted private HTTP only', async t => {
  const { credentials, models, owner } = t.context;
  const workspace = await models.workspace.create(owner.id);
  const publicHttps = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'Public HTTPS callback',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [MCP_DELEGATE_CAPABILITY],
    expirationDays: 30,
    callbackUrl: 'https://8.8.8.8/localmind/results',
  });
  t.truthy(publicHttps.callbackSecret);

  await t.throwsAsync(
    credentials.create({
      userId: owner.id,
      workspaceId: workspace.id,
      name: 'Unsafe public HTTP callback',
      accessMode: McpAccessMode.READ_WRITE,
      capabilities: [MCP_DELEGATE_CAPABILITY],
      expirationDays: 30,
      callbackUrl: 'http://8.8.8.8/localmind/results',
    }),
    { message: 'MCP callback URL must use HTTPS' }
  );

  const allowlistedPrivateHttp = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'Allowlisted private HTTP callback',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [MCP_DELEGATE_CAPABILITY],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  t.truthy(allowlistedPrivateHttp.callbackSecret);
});

test('real ACL denial stops before AI planning and never queues execution', async t => {
  const { auth, credentials, db, models, owner, runtime } = t.context;
  const member = await auth.signUp(
    `mcp-member-${randomUUID()}@affine.pro`,
    '123456'
  );
  const workspace = await models.workspace.create(owner.id);
  await models.workspaceUser.set(
    workspace.id,
    member.id,
    WorkspaceRole.Collaborator,
    { status: WorkspaceMemberStatus.Accepted }
  );
  const issued = await credentials.create({
    userId: member.id,
    workspaceId: workspace.id,
    name: 'SparkClaw denied ACL',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [MCP_DELEGATE_CAPABILITY],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  await models.workspaceUser.set(
    workspace.id,
    member.id,
    WorkspaceRole.External
  );
  const planner = Sinon.stub(runtime, 'generateStructuredValue');

  const result = await delegate(t.context, issued.token, {
    request: 'Summarize this workspace.',
    documentIds: [],
    idempotencyKey: 'acl-denied-before-planning',
  });

  t.is(result.status, 'permission_denied');
  t.is(result.code, 'permission_denied');
  t.is(result.missingPermission, 'Workspace.Copilot');
  t.false(planner.called);
  t.is(await db.aiMcpDelegationCallbackDelivery.count(), 0);
});

test('credential-authorized document task runs without approval and sends a signed result notification', async t => {
  const { callbacks, credentials, db, delegation, owner, runtime, worker } =
    t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Original body.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'SparkClaw result notification flow',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  t.truthy(issued.callbackSecret);
  const planner = Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: 'Credential-authorized replacement body.',
        summary: 'Replace the document body',
      }),
    },
  } as any);

  const delegated = await delegate(t.context, issued.token, {
    request: 'Replace this document body.',
    documentIds: [docId],
    idempotencyKey: 'automatic-complete-flow',
  });
  t.like(planner.firstCall.args[2], {
    maxTokens: 8_192,
    responseSchemaJson: {
      type: 'object',
      required: ['result'],
      additionalProperties: false,
    },
  });
  t.deepEqual(planner.firstCall.args[5], { allowModelFallback: false });
  t.regex(
    planner.firstCall.args[1][0].content,
    /ordinary read-only questions, summaries, explanations, or confirmations/
  );
  t.regex(
    planner.firstCall.args[1][0].content,
    /Missing document context is not an unsupported operation/
  );
  t.regex(
    planner.firstCall.args[1][0].content,
    /text is fictional, the snapshot list is empty/
  );
  t.regex(
    planner.firstCall.args[1][0].content,
    /tool_agent => non-empty summary/
  );
  t.regex(
    planner.firstCall.args[1][0].content,
    /Preserve every requested section, table, list, exact value/
  );
  t.regex(
    planner.firstCall.args[1][0].content,
    /complete replacement Markdown copied exactly once/
  );
  t.regex(
    planner.firstCall.args[1][0].content,
    /you MUST return document_update, never tool_agent/
  );
  const plannerSchema = JSON.stringify(
    planner.firstCall.args[3]!.responseSchemaJson
  );
  t.regex(plannerSchema, /Use answer for every read-only question/);
  t.regex(
    plannerSchema,
    /Never use unsupported_task for a read-only response.*missing document context/
  );
  t.regex(plannerSchema, /Never put this summary in reason/);
  t.regex(plannerSchema, /never shorten it to a planning summary/);
  t.regex(plannerSchema, /copied exactly once without repetition or padding/);
  t.false(plannerSchema.includes('anyOf'));
  t.is(delegated.status, 'queued');
  t.is(delegated.taskId, delegated.requestId);
  t.is(delegated.execution, 'queued');
  t.is(delegated.resultNotification, 'configured');
  t.false('approvalId' in delegated);
  t.false('feedbackUrl' in delegated);

  const queuedTask = await getTaskThroughMcp(t.context, issued.token, {
    taskId: String(delegated.taskId),
    waitMs: 0,
  });
  t.like(queuedTask, {
    protocolVersion: 'localmind.task.v1',
    taskId: delegated.taskId,
    status: 'queued',
    terminal: false,
    phase: 'queue',
    changed: true,
    plan: {
      version: 'localmind-task-plan/v1',
      kind: 'document_update',
      summary: 'Replace the document body',
    },
    approval: null,
  });
  t.deepEqual(
    queuedTask.steps.map((step: any) => [step.key, step.status]),
    [['update_doc', 'pending']]
  );
  t.false(
    JSON.stringify(queuedTask).includes(
      'Credential-authorized replacement body.'
    )
  );
  t.is(callbacks.length, 0);
  t.is(
    await db.aiMcpDelegationCallbackDelivery.count({
      where: { requestId: delegated.requestId },
    }),
    0
  );
  await t.throwsAsync(
    db.aiMcpDelegationRequest.update({
      where: { id: String(delegated.taskId) },
      data: {
        planSnapshot: {
          version: 'localmind-task-plan/v1',
          kind: 'answer',
          summary: 'Rewrite persisted plan evidence',
          steps: [],
        },
        planFingerprint: 'rewritten-plan-fingerprint',
      },
    }),
    { message: /ai_mcp_delegation_requests_plan_update_restrict_check/ }
  );

  const otherFamily = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Other task query family',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  t.deepEqual(
    await getTask(t.context, otherFamily.token, {
      taskId: String(delegated.taskId),
      waitMs: 0,
    }),
    { code: 'task_not_found' }
  );

  const changedTaskPromise = getTask(t.context, issued.token, {
    taskId: String(delegated.taskId),
    knownStateVersion: String(queuedTask.stateVersion),
    waitMs: 3_000,
  });
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });
  const completed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(completed.status, 'completed');
  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, docId, true);
  t.true(
    markdown?.markdown.includes('Credential-authorized replacement body.')
  );

  const completedTask = await changedTaskPromise;
  t.like(completedTask, {
    status: 'completed',
    terminal: true,
    phase: 'terminal',
    changed: true,
    result: {
      kind: 'document_update',
      documentId: docId,
    },
  });
  t.like(completedTask.artifacts[0], {
    kind: 'document',
    relation: 'updated',
    reference: { type: 'localmind_document', documentId: docId },
  });

  await delegation.deliverCallback({ requestId: delegated.requestId });
  await waitForCallbackCount(callbacks, 1);
  t.is(callbacks.length, 1);
  const completionCallback = callbacks[0];
  const completionPayload = JSON.parse(completionCallback.body) as any;
  t.like(completionPayload, {
    event: 'task_completed',
    requestId: delegated.requestId,
    status: 'completed',
  });
  t.is(completionCallback.headers['x-localmind-event'], 'task_completed');
  t.true(
    verifySignature(
      issued.callbackSecret!,
      String(completionCallback.headers['x-localmind-timestamp']),
      String(completionCallback.headers['x-localmind-signature']),
      completionCallback.body
    )
  );
});

test('LocalMind tool agent creates a document and returns a sanitized task artifact', async t => {
  const { credentials, db, owner, runtime, worker } = t.context;
  const { docId: sourceDocId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Source content for the delegated summary.'
  );
  const placedDocument = await t.context
    .app!.get(DocWriter)
    .createDoc(
      workspaceId,
      'Folder placement source',
      'Readable folder placement content.',
      owner.id
    );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'LocalMind tool agent document creation',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const modelRouteLock = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  const qwenAllowedTools = [
    ...resolveModelAdapter(modelRouteLock).profile.evaluationToolCategories,
  ];
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        summary: 'Summarize the source and create a new document',
      }),
    },
    route: modelRouteLock,
  } as any);

  let createdDocumentId = '';
  const toolLoop = Sinon.stub(runtime, 'streamObject').callsFake(((
    conditions: any,
    _messages: unknown,
    options: any
  ) => {
    return (async function* () {
      t.deepEqual(conditions, {
        modelId: 'local-qwen/qwen3.6-35b-a3b',
      });
      t.is(options.user, owner.id);
      t.is(options.workspace, workspaceId);
      t.truthy(options.signal);
      t.deepEqual(options.tools, qwenAllowedTools);
      const createDoc = buildDocCreateHandler(
        t.context.app!.get(PermissionAccess),
        t.context.app!.get(DocWriter)
      );
      const created = (await createDoc(
        options,
        '8.16日志',
        'A concise summary created by the LocalMind tool agent.'
      )) as { docId: string; idempotentReplay: boolean };
      const replayed = (await createDoc(
        options,
        '8.16日志',
        'A concise summary created by the LocalMind tool agent.'
      )) as { docId: string; idempotentReplay: boolean };
      t.is(replayed.docId, created.docId);
      t.false(created.idempotentReplay);
      t.true(replayed.idempotentReplay);
      createdDocumentId = created.docId;
      yield {
        type: 'tool-result',
        toolCallId: 'read-source-call',
        toolName: 'doc_read',
        args: { doc_id: sourceDocId },
        result: {
          success: true,
          docId: sourceDocId,
          content: 'Source content for the delegated summary.',
        },
      };
      yield {
        type: 'tool-call',
        toolCallId: 'create-doc-call',
        toolName: 'doc_create',
        args: {
          title: '8.16日志',
          content: 'A concise summary created by the LocalMind tool agent.',
        },
      };
      yield {
        type: 'tool-result',
        toolCallId: 'create-doc-call',
        toolName: 'doc_create',
        args: {
          title: '8.16日志',
          content: 'A concise summary created by the LocalMind tool agent.',
        },
        result: {
          success: true,
          docId: created.docId,
          message: 'Document created successfully',
        },
      };
      yield {
        type: 'tool-result',
        toolCallId: 'add-folder-document-call',
        toolName: 'workspace_folder_add_document',
        args: {
          folder_id: 'folder-1',
          document_id: placedDocument.docId,
        },
        result: {
          success: true,
          folderId: 'folder-1',
          documentId: placedDocument.docId,
          placementId: 'placement-1',
          idempotentReplay: false,
          workspaceEffect: {
            kind: 'workspace_organization',
            operation: 'add_document',
            folderId: 'folder-1',
          },
        },
      };
      yield {
        type: 'tool-result',
        toolCallId: 'failed-read-call',
        toolName: 'doc_read',
        args: { docId: 'missing-doc' },
        result: { message: 'Simulated read failure' },
        isError: true,
      };
      yield {
        type: 'text-delta',
        textDelta: 'Created 8.16日志 with the requested summary.',
      };
    })();
  }) as any);

  const delegated = await delegate(t.context, issued.token, {
    request:
      'Summarize the supplied document, create 8.16日志, and write the summary into it.',
    documentIds: [sourceDocId],
    idempotencyKey: 'tool-agent-create-document',
  });
  t.like(delegated, {
    status: 'queued',
    kind: 'tool_agent',
    execution: 'queued',
    resultNotification: 'not_configured',
  });

  const queued = await getTask(t.context, issued.token, {
    taskId: String(delegated.taskId),
    waitMs: 0,
  });
  t.like(queued, {
    status: 'queued',
    plan: {
      version: 'localmind-task-plan/v1',
      kind: 'tool_agent',
      summary: 'Summarize the source and create a new document',
    },
  });

  const queuedRun = await t.context.models.copilotAgentRuntime.get(
    workspaceId,
    String(delegated.agentRunId)
  );
  t.like(
    queuedRun?.steps[0].outputSummary.localMindToolAgentRequest as object,
    {
      version: 'localmind-tool-agent-request/v2',
      allowedTools: qwenAllowedTools,
      modelRouteLock: {
        providerId: 'local-qwen',
        modelId: 'qwen3.6-35b-a3b',
        lockedModelId: 'local-qwen/qwen3.6-35b-a3b',
      },
      modelAdapter: {
        id: 'qwen36-35b-a3b',
        version: QWEN36_MODEL_ADAPTER_VERSION,
        mode: 'evaluation',
      },
      completionContract: {
        version: QWEN36_COMPLETION_CONTRACT_VERSION,
      },
    }
  );

  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });
  t.true(toolLoop.calledOnce);

  const task = await getTaskThroughMcp(t.context, issued.token, {
    taskId: String(delegated.taskId),
    waitMs: 0,
  });
  t.like(task, {
    status: 'completed',
    terminal: true,
    result: {
      kind: 'tool_agent',
      summary: 'Created 8.16日志 with the requested summary.',
    },
  });
  t.like(task.result.toolExecutions[0], {
    invocationId: 'read-source-call',
    toolName: 'doc_read',
    status: 'completed',
    documentId: sourceDocId,
  });
  t.like(task.result.toolExecutions[1], {
    invocationId: 'create-doc-call',
    toolName: 'doc_create',
    status: 'completed',
    sideEffectApplied: true,
    effectSatisfied: true,
    documentId: createdDocumentId,
    relation: 'created',
  });
  t.like(task.result.toolExecutions[2], {
    invocationId: 'add-folder-document-call',
    toolName: 'workspace_folder_add_document',
    status: 'completed',
    sideEffectApplied: true,
    effectSatisfied: true,
    idempotentReplay: false,
    documentId: placedDocument.docId,
    workspaceEffect: {
      kind: 'workspace_organization',
      operation: 'add_document',
      folderId: 'folder-1',
    },
  });
  t.like(task.result.toolExecutions[3], {
    toolName: 'doc_read',
    status: 'failed',
  });
  t.like(task.artifacts[0], {
    kind: 'document',
    relation: 'created',
    reference: {
      type: 'localmind_document',
      documentId: createdDocumentId,
    },
  });
  const serializedTask = JSON.stringify(task);
  t.false(serializedTask.includes('A concise summary created by'));
  t.false(serializedTask.includes('8.16日志","content'));

  const completedRun = await t.context.models.copilotAgentRuntime.get(
    workspaceId,
    String(delegated.agentRunId)
  );
  t.true(completedRun?.executionResults[0]?.sideEffectsApplied ?? false);
  t.like(completedRun?.executionResults[0]?.resultPayload.sideEffectSummary, {
    toolExecutions: [
      { toolName: 'doc_create' },
      {
        toolName: 'workspace_folder_add_document',
        documentId: placedDocument.docId,
        workspaceEffect: {
          kind: 'workspace_organization',
          operation: 'add_document',
          folderId: 'folder-1',
        },
      },
    ],
  });

  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, createdDocumentId, true);
  t.true(markdown?.markdown.includes('A concise summary created by'));
  t.is(await db.aiMcpDelegationCallbackDelivery.count(), 0);
});

test('uploaded attachment is bound to one credential family and becomes a LocalMind document artifact', async t => {
  const { credentials, db, owner, runtime, worker } = t.context;
  const { workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Attachment processing workspace.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'LocalMind attachment processing',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const attachmentText =
    'Quarterly revenue is 42 million. Create a concise finance note.';
  const uploaded = await uploadAttachmentThroughMcp(t.context, issued.token, {
    fileName: 'finance-note.txt',
    mimeType: 'text/plain',
    base64: Buffer.from(attachmentText).toString('base64'),
    idempotencyKey: 'finance-note-upload',
  });
  t.like(uploaded, {
    fileName: 'finance-note.txt',
    mimeType: 'text/plain',
    size: Buffer.byteLength(attachmentText),
    idempotentReplay: false,
  });
  const attachmentId = String(uploaded.attachmentId);

  const replayed = await uploadAttachmentThroughMcp(t.context, issued.token, {
    fileName: 'finance-note.txt',
    mimeType: 'text/plain',
    base64: Buffer.from(attachmentText).toString('base64'),
    idempotencyKey: 'finance-note-upload',
  });
  t.is(replayed.attachmentId, attachmentId);
  t.true(replayed.idempotentReplay);
  const attachmentRecord = await db.aiMcpAttachment.findUniqueOrThrow({
    where: { id: attachmentId },
  });
  await db.blob.update({
    where: {
      workspaceId_key: {
        workspaceId,
        key: attachmentRecord.blobKey,
      },
    },
    data: { deletedAt: new Date() },
  });
  const restored = await uploadAttachmentThroughMcp(t.context, issued.token, {
    fileName: 'finance-note.txt',
    mimeType: 'text/plain',
    base64: Buffer.from(attachmentText).toString('base64'),
    idempotencyKey: 'finance-note-upload',
  });
  t.is(restored.attachmentId, attachmentId);
  t.true(restored.idempotentReplay);
  t.is(
    (
      await db.blob.findUniqueOrThrow({
        where: {
          workspaceId_key: { workspaceId, key: attachmentRecord.blobKey },
        },
      })
    ).deletedAt,
    null
  );
  t.deepEqual(
    await uploadAttachmentThroughMcp(t.context, issued.token, {
      fileName: 'different.txt',
      mimeType: 'text/plain',
      base64: Buffer.from('Different file evidence.').toString('base64'),
      idempotencyKey: 'finance-note-upload',
    }),
    { code: 'idempotency_conflict' }
  );

  const otherFamily = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Other attachment credential family',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const inaccessible = await delegate(t.context, otherFamily.token, {
    request: 'Read the uploaded attachment.',
    documentIds: [],
    attachmentIds: [attachmentId],
    idempotencyKey: 'cross-family-attachment',
  });
  t.like(inaccessible, {
    status: 'resource_not_accessible',
    code: 'resource_not_accessible',
    attachmentId,
  });

  const route = createModelRouteLock({
    providerId: 'provider-main',
    modelId: 'gpt-5.6-sol',
  });
  Sinon.stub(runtime, 'resolveStructuredRoute').resolves(route);
  const planner = Sinon.stub(runtime, 'generateStructuredValue').callsFake(((
    _conditions: unknown,
    messages: any[]
  ) => {
    t.regex(messages[1].content, /Quarterly revenue is 42 million/);
    return Promise.resolve({
      value: {
        result: plannerResult({
          kind: 'tool_agent',
          summary: 'Create a finance note from the uploaded attachment',
        }),
      },
      route,
    } as any);
  }) as any);
  let createdDocumentId = '';
  const toolLoop = Sinon.stub(runtime, 'streamObject').callsFake(((
    _conditions: unknown,
    messages: any[],
    options: any
  ) => {
    return (async function* () {
      t.regex(messages[1].content, /Quarterly revenue is 42 million/);
      const createDoc = buildDocCreateHandler(
        t.context.app!.get(PermissionAccess),
        t.context.app!.get(DocWriter)
      );
      const created = (await createDoc(
        options,
        'Finance note',
        'Quarterly revenue: 42 million.'
      )) as { docId: string };
      createdDocumentId = created.docId;
      yield {
        type: 'tool-result',
        toolCallId: 'create-finance-note',
        toolName: 'doc_create',
        args: {
          title: 'Finance note',
          content: 'Quarterly revenue: 42 million.',
        },
        result: { success: true, docId: created.docId },
      };
      yield {
        type: 'text-delta',
        textDelta: 'Created Finance note from finance-note.txt.',
      };
    })();
  }) as any);

  const delegated = await delegate(t.context, issued.token, {
    request: 'Summarize the attachment and create a LocalMind document.',
    documentIds: [],
    attachmentIds: [attachmentId],
    idempotencyKey: 'attachment-create-document',
  });
  t.is(delegated.status, 'queued');
  t.true(planner.calledOnce);
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });
  t.true(toolLoop.calledOnce);

  const task = await getTaskThroughMcp(t.context, issued.token, {
    taskId: String(delegated.taskId),
    waitMs: 0,
  });
  t.like(task, {
    status: 'completed',
    result: {
      kind: 'tool_agent',
      summary: 'Created Finance note from finance-note.txt.',
    },
  });
  t.like(task.artifacts[0], {
    kind: 'document',
    relation: 'created',
    reference: {
      type: 'localmind_document',
      documentId: createdDocumentId,
    },
  });
  await t.throwsAsync(
    db.aiMcpAttachment.update({
      where: { id: attachmentId },
      data: { fileName: 'rewritten.txt' },
    }),
    { message: /ai_mcp_attachment_update_restrict_check/ }
  );
});

test('Qwen3.6 tool task rejects a claimed write without tool evidence', async t => {
  const { credentials, db, models, owner, runtime, worker } = t.context;
  const workspace = await models.workspace.create(owner.id);
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'Qwen completion evidence gate',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  Sinon.stub(runtime, 'resolveStructuredRoute').resolves(route);
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        summary: 'Create the requested document',
      }),
    },
    route,
  } as any);
  Sinon.stub(runtime, 'streamObject').callsFake((() => {
    return (async function* () {
      yield {
        type: 'text-delta',
        textDelta: 'The requested document was created.',
      };
    })();
  }) as any);

  const delegated = await delegate(t.context, issued.token, {
    request: 'Create a workspace document titled Evidence Required.',
    documentIds: [],
    idempotencyKey: 'qwen-reject-write-without-evidence',
  });
  await worker.runStandaloneAgentRuntime({
    workspaceId: workspace.id,
    runId: String(delegated.agentRunId),
  });

  const failed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(failed.status, 'failed');
  t.like(failed.result as object, {
    code: 'completion_evidence_rejected',
    verificationCode: 'missing_tool_evidence',
    modelAdapter: {
      id: 'qwen36-35b-a3b',
      version: QWEN36_MODEL_ADAPTER_VERSION,
      mode: 'evaluation',
    },
  });
});

test('Qwen3.6 tool task repairs an empty strict answer from doc_read evidence', async t => {
  const { credentials, db, owner, runtime, worker } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Marker: CURRENT-MARKER-1'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Qwen doc read evidence repair',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  Sinon.stub(runtime, 'resolveStructuredRoute').resolves(route);
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        summary: 'Search and read the current document marker',
      }),
    },
    route,
  } as any);
  Sinon.stub(runtime, 'streamObject').callsFake((() => {
    return (async function* () {
      yield {
        type: 'tool-result',
        toolCallId: 'search-call',
        toolName: 'doc_semantic_search',
        args: { query: 'HISTORICAL-MARKER' },
        result: {
          results: [{ docId, markdown: 'Marker: HISTORICAL-MARKER' }],
        },
      };
      yield {
        type: 'tool-result',
        toolCallId: 'read-call',
        toolName: 'doc_read',
        args: { doc_id: docId },
        result: {
          docId,
          title: 'Current marker document',
          markdown: 'Marker: CURRENT-MARKER-1',
        },
      };
    })();
  }) as any);
  const renderer = Sinon.stub(runtime, 'text').resolves('CURRENT-MARKER-1');

  const delegated = await delegate(t.context, issued.token, {
    request:
      '搜索工作区并读取命中的文档，只返回当前Marker完整值，不要其他文字。',
    documentIds: [],
    idempotencyKey: 'qwen-repair-empty-answer-from-doc-read',
  });
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });

  const completed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(completed.status, 'completed');
  t.like(completed.result as object, {
    answer: 'CURRENT-MARKER-1',
  });
  t.false(renderer.called);
});

test('Qwen3.6 tool answer repair keeps its draft when a 6000-token repair is empty', async t => {
  const { credentials, db, models, owner, runtime, worker } = t.context;
  const workspace = await models.workspace.create(owner.id);
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'Qwen empty final answer repair',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  Sinon.stub(runtime, 'resolveStructuredRoute').resolves(route);
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        summary: 'Search for the requested document',
      }),
    },
    route,
  } as any);
  Sinon.stub(runtime, 'streamObject').callsFake((() => {
    return (async function* () {
      yield {
        type: 'tool-result',
        toolCallId: 'search-call',
        toolName: 'doc_keyword_search',
        args: { query: 'Project Atlas' },
        result: {
          results: [{ docId: 'doc-atlas', title: 'Project Atlas' }],
        },
      };
      yield { type: 'text-delta', textDelta: '1' };
    })();
  }) as any);
  const renderer = Sinon.stub(runtime, 'text').resolves('');

  const delegated = await delegate(t.context, issued.token, {
    request:
      '搜索工作区中标题为“Project Atlas”的文档，只返回匹配数量，不要其他文字。',
    documentIds: [],
    idempotencyKey: 'qwen-preserve-draft-after-empty-repair',
  });
  await worker.runStandaloneAgentRuntime({
    workspaceId: workspace.id,
    runId: String(delegated.agentRunId),
  });

  const completed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(completed.status, 'completed');
  t.is((completed.result as any).answer, '1');
  t.true(renderer.calledOnce);
  t.like(renderer.firstCall.args[2], {
    maxTokens: QWEN36_FINAL_ANSWER_REPAIR_MAX_TOKENS,
    temperature: 0,
  });
});

test('Qwen3.6 host read recovery keeps a unique match from an earlier search', async t => {
  const { credentials, db, owner, runtime, worker } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Marker: RECOVERED-FROM-EARLY-SEARCH'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Qwen accumulated search evidence',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  Sinon.stub(runtime, 'resolveStructuredRoute').resolves(route);
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        summary: 'Search and read the unique document',
      }),
    },
    route,
  } as any);
  Sinon.stub(runtime, 'streamObject').callsFake((() => {
    return (async function* () {
      yield {
        type: 'tool-result',
        toolCallId: 'first-search-call',
        toolName: 'doc_semantic_search',
        args: { query: 'EARLY-UNIQUE-TARGET' },
        result: {
          results: [{ docId, title: 'EARLY-UNIQUE-TARGET' }],
        },
      };
      yield {
        type: 'tool-result',
        toolCallId: 'last-search-call',
        toolName: 'doc_keyword_search',
        args: { query: 'irrelevant retry' },
        result: { results: [] },
      };
    })();
  }) as any);
  const renderer = Sinon.stub(runtime, 'text');

  const delegated = await delegate(t.context, issued.token, {
    request:
      '搜索标题为“EARLY-UNIQUE-TARGET”的文档并读取，只返回当前Marker完整值，不要其他文字。',
    documentIds: [],
    idempotencyKey: 'qwen-recover-read-from-earlier-search',
  });
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });

  const completed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(completed.status, 'completed');
  t.is((completed.result as any).answer, 'RECOVERED-FROM-EARLY-SEARCH');
  t.true(
    (completed.result as any).toolExecutions.some(
      (execution: any) =>
        execution.toolName === 'doc_read' && execution.documentId === docId
    )
  );
  t.false(renderer.called);
});

test('Qwen3.6 tool task rejects persisted execution snapshot tampering before model execution', async t => {
  const { credentials, db, models, owner, runtime, worker } = t.context;
  const workspace = await models.workspace.create(owner.id);
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'Qwen persisted snapshot integrity gate',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        summary: 'Create the requested document',
      }),
    },
    route,
  } as any);
  const toolLoop = Sinon.stub(runtime, 'streamObject').callsFake((() => {
    return (async function* () {
      yield {
        type: 'text-delta',
        textDelta: 'This model execution must never start.',
      };
    })();
  }) as any);
  const alternateRoute = createModelRouteLock({
    providerId: 'tampered-local-qwen',
    providerProfileId: 'tampered-local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  const alternateContract = createQwen36CompletionContract(
    'Create a workspace folder named Tampered Folder.'
  );
  t.truthy(alternateContract);

  const cases: Array<{
    name: string;
    tamper: (request: Record<string, any>) => void;
  }> = [
    {
      name: 'model-route',
      tamper: request => {
        request.modelRouteLock = alternateRoute;
      },
    },
    {
      name: 'adapter-version',
      tamper: request => {
        request.modelAdapter = {
          ...(request.modelAdapter as object),
          version: 'tampered-version',
        };
      },
    },
    {
      name: 'completion-contract',
      tamper: request => {
        request.completionContract = alternateContract;
      },
    },
    {
      name: 'request-fingerprint',
      tamper: request => {
        request.requestFingerprint = 'a'.repeat(64);
      },
    },
  ];

  for (const testCase of cases) {
    const delegated = await delegate(t.context, issued.token, {
      request: 'Create a workspace document titled Snapshot Integrity.',
      documentIds: [],
      idempotencyKey: `qwen-snapshot-tamper-${testCase.name}`,
    });
    const queuedRun = await models.copilotAgentRuntime.get(
      workspace.id,
      String(delegated.agentRunId)
    );
    const outputSummary = structuredClone(
      queuedRun?.steps[0].outputSummary ?? {}
    ) as Record<string, any>;
    const persistedRequest = outputSummary.localMindToolAgentRequest as Record<
      string,
      any
    >;
    testCase.tamper(persistedRequest);
    await db.$executeRaw`
      UPDATE ai_agent_steps
      SET output_summary = ${JSON.stringify(outputSummary)}::jsonb
      WHERE run_id = ${String(delegated.agentRunId)}
    `;

    await worker.runStandaloneAgentRuntime({
      workspaceId: workspace.id,
      runId: String(delegated.agentRunId),
    });

    const [failedDelegation, failedRun] = await Promise.all([
      db.aiMcpDelegationRequest.findUniqueOrThrow({
        where: { id: delegated.requestId },
      }),
      models.copilotAgentRuntime.get(
        workspace.id,
        String(delegated.agentRunId)
      ),
    ]);
    t.is(failedDelegation.status, 'failed', testCase.name);
    t.like(
      failedDelegation.result as object,
      { code: 'agent_runtime_adapter_execution_failed' },
      testCase.name
    );
    t.is(failedRun?.status, 'failed', testCase.name);
  }
  t.is(toolLoop.callCount, 0);
});

test('planner renders an answer again when branch fields contain answer text', async t => {
  const { credentials, models, owner, runtime } = t.context;
  const workspace = await models.workspace.create(owner.id);
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'LocalMind answer field repair',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'answer',
        answer: 'Short conclusion.',
        content: '| Risk | Evidence |',
        summary: '- [Owner] Action',
      }),
    },
    route,
  } as any);
  const renderer = Sinon.stub(runtime, 'text').resolves(
    'Complete conclusion.\n\n| Risk | Evidence |\n| --- | --- |\n| A | B |\n\n- [Owner] Action'
  );

  const delegated = await delegate(t.context, issued.token, {
    request: 'Return a conclusion, a Markdown table, and one action.',
    documentIds: [],
    idempotencyKey: 'repair-answer-branch-fields',
  });

  t.like(delegated, {
    status: 'completed',
    kind: 'answer',
    answer:
      'Complete conclusion.\n\n| Risk | Evidence |\n| --- | --- |\n| A | B |\n\n- [Owner] Action',
  });
  t.true(renderer.calledOnce);
  t.deepEqual(renderer.firstCall.args[0], {
    modelId: 'local-qwen/qwen3.6-35b-a3b',
  });
  t.regex(renderer.firstCall.args[1][0].content, /final answer generator/);
  t.regex(
    renderer.firstCall.args[1][0].content,
    /literal newline characters between sections, Markdown table rows, and list items/
  );
  t.regex(
    renderer.firstCall.args[1][0].content,
    /Never compress Markdown into one line/
  );
  t.regex(
    renderer.firstCall.args[1][0].content,
    /every requested output component is present/
  );
  t.like(renderer.firstCall.args[2], {
    maxTokens: 6_000,
    temperature: 0,
  });
});

test('planner renders document content again when update fields are empty', async t => {
  const { credentials, owner, runtime, worker } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Original Qwen-compatible body.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'LocalMind update field repair',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({ kind: 'document_update' }),
    },
    route,
  } as any);
  const renderer = Sinon.stub(runtime, 'text').resolves(
    '# Repaired\n\nComplete replacement body.'
  );

  const delegated = await delegate(t.context, issued.token, {
    request: 'Replace the document with the supplied Markdown.',
    documentIds: [docId],
    idempotencyKey: 'repair-document-update-fields',
  });

  t.like(delegated, {
    status: 'queued',
    kind: 'document_update',
    execution: 'queued',
  });
  t.true(renderer.calledOnce);
  t.deepEqual(renderer.firstCall.args[0], {
    modelId: 'local-qwen/qwen3.6-35b-a3b',
  });
  t.regex(renderer.firstCall.args[1][0].content, /replacement renderer/);
  const queuedRun = await t.context.models.copilotAgentRuntime.get(
    workspaceId,
    String(delegated.agentRunId)
  );
  t.like(queuedRun?.steps[0].outputSummary.docUpdateRequest as object, {
    version: 'agent-runtime-doc-update-request/v2',
    modelRouteLock: {
      providerId: 'local-qwen',
      lockedModelId: 'local-qwen/qwen3.6-35b-a3b',
    },
    modelAdapter: {
      id: 'qwen36-35b-a3b',
      version: QWEN36_MODEL_ADAPTER_VERSION,
      mode: 'evaluation',
    },
  });
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });
  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, docId, true);
  t.true(markdown?.markdown.includes('Complete replacement body.'));
});

test('Qwen document update worker rejects a tampered persisted route before writing', async t => {
  const { credentials, db, models, owner, runtime, worker } = t.context;
  const originalBody = 'Original body must remain unchanged.';
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    originalBody
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Qwen document route integrity',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: 'This tampered task must never be written.',
        summary: 'Update the document',
      }),
    },
    route,
  } as any);

  const delegated = await delegate(t.context, issued.token, {
    request: 'Update this document body.',
    documentIds: [docId],
    idempotencyKey: 'qwen-document-route-tamper',
  });
  const queuedRun = await models.copilotAgentRuntime.get(
    workspaceId,
    String(delegated.agentRunId)
  );
  const outputSummary = structuredClone(
    queuedRun?.steps[0].outputSummary ?? {}
  ) as Record<string, any>;
  const request = outputSummary.docUpdateRequest as Record<string, any>;
  request.modelRouteLock = createModelRouteLock({
    providerId: 'tampered-local-qwen',
    providerProfileId: 'tampered-local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });
  await db.$executeRaw`
    UPDATE ai_agent_steps
    SET output_summary = ${JSON.stringify(outputSummary)}::jsonb
    WHERE run_id = ${String(delegated.agentRunId)}
  `;

  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });

  const [failedDelegation, failedRun, markdown] = await Promise.all([
    db.aiMcpDelegationRequest.findUniqueOrThrow({
      where: { id: delegated.requestId },
    }),
    models.copilotAgentRuntime.get(workspaceId, String(delegated.agentRunId)),
    t.context.app!.get(DocReader).getDocMarkdown(workspaceId, docId, true),
  ]);
  t.is(failedDelegation.status, 'failed');
  t.like(failedDelegation.result as object, {
    code: 'agent_runtime_adapter_execution_failed',
  });
  t.is(failedRun?.status, 'failed');
  t.true(markdown?.markdown.includes(originalBody));
  t.false(markdown?.markdown.includes('tampered task'));
});

test('planner repairs a formatted answer when the answer field omits sections', async t => {
  const { credentials, models, owner, runtime } = t.context;
  const workspace = await models.workspace.create(owner.id);
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'LocalMind formatted answer repair',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: {
        kind: 'answer',
        answer: 'Conclusion only.',
        extraSection: 'Qwen emitted an undeclared field.',
      },
    },
  } as any);
  const renderer = Sinon.stub(runtime, 'text');
  renderer
    .onFirstCall()
    .resolves(
      'Conclusion.\n\n| Risk ｜ Evidence |\n| A ｜ B |\n\n- [Owner] Action'
    );
  renderer
    .onSecondCall()
    .resolves(
      'Conclusion.\n\n| Risk ｜ Evidence |\n| A ｜ B |\n\n- Owner｜Date Action'
    );

  const delegated = await delegate(t.context, issued.token, {
    request:
      'Strict output:\n1. A conclusion.\n2. A Markdown table.\n3. One action item in "- [Owner｜Date] Action" format.',
    documentIds: [],
    idempotencyKey: 'repair-formatted-answer-sections',
  });

  t.like(delegated, {
    status: 'completed',
    kind: 'answer',
    answer:
      'Conclusion.\n\n| Risk | Evidence |\n| --- | --- |\n| A | B |\n\n- [Owner｜Date] Action',
  });
  t.true(renderer.calledTwice);
  t.regex(renderer.secondCall.args[1][0].content, /format repairer/);
});

test('planner repairs an unsupported result as a read-only answer', async t => {
  const { credentials, models, owner, runtime } = t.context;
  const workspace = await models.workspace.create(owner.id);
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'LocalMind read-only unsupported repair',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'unsupported_task',
        reason: 'UPDATED-MARKER',
      }),
    },
  } as any);
  const renderer = Sinon.stub(runtime, 'text').resolves('UPDATED-MARKER');

  const delegated = await delegate(t.context, issued.token, {
    request: 'Return only the Marker value from the supplied snapshot.',
    documentIds: [],
    idempotencyKey: 'repair-read-only-unsupported',
  });

  t.like(delegated, {
    status: 'completed',
    kind: 'answer',
    answer: 'UPDATED-MARKER',
  });
  t.true(renderer.calledOnce);
});

test('planner repairs a tool-agent result when provided snapshots answer the request', async t => {
  const { credentials, owner, runtime } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Marker: SNAPSHOT-MARKER'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'LocalMind snapshot answer repair',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        summary: 'Read the provided snapshot with a tool',
      }),
    },
  } as any);
  const renderer = Sinon.stub(runtime, 'text').resolves('SNAPSHOT-MARKER');

  const delegated = await delegate(t.context, issued.token, {
    request: 'Return only the Marker value from the provided snapshot.',
    documentIds: [docId],
    idempotencyKey: 'repair-snapshot-tool-agent',
  });

  t.like(delegated, {
    status: 'completed',
    kind: 'answer',
    answer: 'SNAPSHOT-MARKER',
  });
  t.true(renderer.calledOnce);
});

test('planner renders document content again when literal Markdown differs', async t => {
  const { credentials, owner, runtime, worker } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Original literal replacement body.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'LocalMind literal update repair',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: '# Incomplete',
        summary: 'Replace the document',
      }),
    },
  } as any);
  const renderer = Sinon.stub(runtime, 'text').resolves(
    '# Complete\n\nMarker: UPDATED-MARKER'
  );

  const delegated = await delegate(t.context, issued.token, {
    request:
      'Replace the document with exactly this Markdown:\n\n# Complete\n\nMarker: UPDATED-MARKER',
    documentIds: [docId],
    idempotencyKey: 'repair-literal-document-update',
  });

  t.like(delegated, {
    status: 'queued',
    kind: 'document_update',
  });
  t.true(renderer.calledOnce);
  t.regex(
    renderer.firstCall.args[1][0].content,
    /no requested content is missing, added, repeated, or rewritten/
  );
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });
  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, docId, true);
  t.true(markdown?.markdown.includes('Marker: UPDATED-MARKER'));
});

test('literal one-document replacement overrides an answer plan', async t => {
  const { credentials, owner, runtime } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Original tool-agent override body.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'LocalMind update kind override',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'answer',
        answer: 'The replacement is ready.',
        content: '# Incorrect replacement',
      }),
    },
  } as any);
  const renderer = Sinon.stub(runtime, 'text').resolves(
    '# Complete\n\nMarker: OVERRIDDEN-KIND'
  );

  const delegated = await delegate(t.context, issued.token, {
    request:
      'Replace the document with exactly this Markdown:\n\n# Complete\n\nMarker: OVERRIDDEN-KIND',
    documentIds: [docId],
    idempotencyKey: 'override-tool-agent-document-update',
  });

  t.like(delegated, {
    status: 'queued',
    kind: 'document_update',
    operation: { kind: 'document_update', documentId: docId },
  });
  t.true(renderer.calledOnce);
});

test('LocalMind tool agent accepts a summary emitted in the reason field', async t => {
  const { credentials, models, owner, runtime } = t.context;
  const workspace = await models.workspace.create(owner.id);
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'LocalMind planner field normalization',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        reason: 'Create the requested workspace document',
      }),
    },
  } as any);

  const delegated = await delegate(t.context, issued.token, {
    request: 'Create one workspace document.',
    documentIds: [],
    idempotencyKey: 'normalize-tool-agent-reason',
  });

  t.like(delegated, {
    status: 'queued',
    kind: 'tool_agent',
    execution: 'queued',
  });
  const queued = await getTask(t.context, issued.token, {
    taskId: String(delegated.taskId),
    waitMs: 0,
  });
  t.like(queued, {
    plan: {
      kind: 'tool_agent',
      summary: 'Create the requested workspace document',
    },
  });
});

test('enterprise data requests use the tool agent when the planner returns an answer', async t => {
  const { credentials, models, owner, runtime } = t.context;
  const workspace = await models.workspace.create(owner.id);
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'Enterprise tool routing',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'answer',
        answer: 'No DingTalk tools are available.',
      }),
    },
  } as any);

  const delegated = await delegate(t.context, issued.token, {
    request: '查询我今天的钉钉日程，并只返回结果条数。',
    documentIds: [],
    idempotencyKey: 'route-dingtalk-query-to-tool-agent',
  });

  t.like(delegated, {
    status: 'queued',
    kind: 'tool_agent',
    execution: 'queued',
  });
  const queued = await getTask(t.context, issued.token, {
    taskId: String(delegated.taskId),
    waitMs: 0,
  });
  t.like(queued, {
    plan: {
      kind: 'tool_agent',
      summary: 'Use the connected enterprise tools to complete the task.',
    },
  });
});

test('LocalMind tool agent rechecks credential activity before starting its tool loop', async t => {
  const { credentials, db, owner, runtime, worker } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Tool agent credential recheck source.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Tool agent credential recheck',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        summary: 'Use LocalMind tools after the queue',
      }),
    },
  } as any);
  const toolLoop = Sinon.stub(runtime, 'streamObject');

  const delegated = await delegate(t.context, issued.token, {
    request: 'Read this document and create a summary document.',
    documentIds: [docId],
    idempotencyKey: 'tool-agent-credential-recheck',
  });
  await credentials.revoke(issued.credential.id, owner.id, workspaceId);
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });

  t.false(toolLoop.called);
  const failed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(failed.status, 'failed');
  t.is((failed.result as any).code, 'credential_inactive');
});

test('task control immediately cancels queued work and sends a cancellation notification', async t => {
  const { callbacks, credentials, db, delegation, owner, runtime } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Body that must remain unchanged.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Task cancellation',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: 'This replacement must never be written.',
        summary: 'Replace the document',
      }),
    },
  } as any);

  const delegated = await delegate(t.context, issued.token, {
    request: 'Replace this document.',
    documentIds: [docId],
    idempotencyKey: 'cancel-queued-task',
  });
  const queued = await getTask(t.context, issued.token, {
    taskId: String(delegated.taskId),
    waitMs: 0,
  });
  t.is(queued.status, 'queued');
  t.deepEqual(queued.availableControls, ['cancel']);

  const otherFamily = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Unrelated control family',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [MCP_TASK_CONTROL_CAPABILITY],
    expirationDays: 30,
  });
  t.deepEqual(
    await controlTaskThroughMcp(t.context, otherFamily.token, {
      taskId: String(delegated.taskId),
      action: 'cancel',
      idempotencyKey: 'foreign-family-cancel',
    }),
    { code: 'task_not_found' }
  );

  const cancelled = await controlTaskThroughMcp(t.context, issued.token, {
    taskId: String(delegated.taskId),
    action: 'cancel',
    idempotencyKey: 'cancel-control-1',
    reason: 'The caller no longer needs this task.',
  });
  t.like(cancelled, {
    protocolVersion: 'localmind.task-control.v1',
    taskId: delegated.taskId,
    action: 'cancel',
    outcome: 'cancelled',
    taskStatus: 'cancelled',
    terminal: true,
    idempotentReplay: false,
  });

  const replay = await controlTaskThroughMcp(t.context, issued.token, {
    taskId: String(delegated.taskId),
    action: 'cancel',
    idempotencyKey: 'cancel-control-1',
    reason: 'The caller no longer needs this task.',
  });
  t.like(replay, {
    controlId: cancelled.controlId,
    outcome: 'cancelled',
    idempotentReplay: true,
  });
  t.deepEqual(
    await controlTaskThroughMcp(t.context, issued.token, {
      taskId: String(delegated.taskId),
      action: 'cancel',
      idempotencyKey: 'cancel-control-1',
      reason: 'Different evidence for the same key.',
    }),
    { code: 'idempotency_conflict' }
  );

  const [request, run, controls, approvalDeliveryCount, cancelDelivery] =
    await Promise.all([
      db.aiMcpDelegationRequest.findUniqueOrThrow({
        where: { id: String(delegated.taskId) },
      }),
      db.aiAgentRun.findUniqueOrThrow({
        where: { id: String(delegated.agentRunId) },
      }),
      db.aiMcpDelegationControl.findMany({
        where: { requestId: String(delegated.taskId) },
      }),
      db.aiMcpDelegationCallbackDelivery.count({
        where: {
          requestId: String(delegated.taskId),
          eventType: 'approval_required',
        },
      }),
      db.aiMcpDelegationCallbackDelivery.findUniqueOrThrow({
        where: {
          requestId_eventType: {
            requestId: String(delegated.taskId),
            eventType: 'task_cancelled',
          },
        },
      }),
    ]);
  t.is(request.status, 'cancelled');
  t.like(request.result as any, {
    code: 'task_cancelled',
    controlId: cancelled.controlId,
    cancellationMode: 'immediate',
  });
  t.is(run.status, 'cancelled');
  t.is(controls.length, 1);
  t.is(controls[0].status, 'completed');
  t.regex(String(controls[0].outcomeFingerprint), /^[0-9a-f]{64}$/);
  await t.throwsAsync(
    db.aiMcpDelegationControl.update({
      where: { id: controls[0].id },
      data: { outcome: { tampered: true } },
    }),
    { message: /ai_mcp_delegation_control_update_restrict_check/ }
  );
  t.is(approvalDeliveryCount, 0);
  t.is(cancelDelivery.status, 'queued');

  const task = await getTask(t.context, issued.token, {
    taskId: String(delegated.taskId),
    knownStateVersion: String(queued.stateVersion),
    waitMs: 0,
  });
  t.like(task, {
    status: 'cancelled',
    terminal: true,
    phase: 'terminal',
    changed: true,
    approval: null,
    error: { code: 'task_cancelled', retryable: false },
  });
  t.deepEqual(task.availableControls, []);

  await delegation.deliverCallback({ requestId: String(delegated.taskId) });
  await waitForCallbackCount(callbacks, 1);
  const payload = JSON.parse(callbacks[0].body) as any;
  t.like(payload, {
    event: 'task_cancelled',
    requestId: delegated.taskId,
    status: 'cancelled',
    result: { code: 'task_cancelled' },
  });
  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, docId, true);
  t.true(markdown?.markdown.includes('Body that must remain unchanged.'));
  t.false(markdown?.markdown.includes('must never be written'));
});

test('running task cancellation is cooperative and reconciles to terminal state', async t => {
  const { credentials, delegation, models, owner, runtime, taskControl } =
    t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Original cooperative cancellation body.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Cooperative task cancellation',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: 'Cooperative replacement that must not be written.',
        summary: 'Replace after cooperative cancellation test',
      }),
    },
  } as any);

  const delegated = await delegate(t.context, issued.token, {
    request: 'Replace this document.',
    documentIds: [docId],
    idempotencyKey: 'cooperative-cancel-task',
  });
  const workerLeaseId = `cooperative-cancel-${randomUUID()}`;
  const leased = await models.copilotAgentRuntime.acquireStandaloneWorkerLease({
    workspaceId,
    id: String(delegated.agentRunId),
    workerId: workerLeaseId,
    leaseMs: 60_000,
  });
  t.is(leased?.status, 'running');

  const requested = await controlTaskThroughMcp(t.context, issued.token, {
    taskId: String(delegated.taskId),
    action: 'cancel',
    idempotencyKey: 'cooperative-cancel-control',
  });
  t.like(requested, {
    outcome: 'cancellation_requested',
    taskStatus: 'cancelling',
    terminal: false,
    pollAfterMs: 1_000,
  });
  const cancelling = await getTask(t.context, issued.token, {
    taskId: String(delegated.taskId),
    waitMs: 0,
  });
  t.is(cancelling.status, 'cancelling');
  t.is(cancelling.phase, 'execution');
  t.deepEqual(cancelling.availableControls, []);

  const cancelledRun =
    await models.copilotAgentRuntime.cancelLeasedStandaloneRunIfCancellationRequested(
      {
        workspaceId,
        id: String(delegated.agentRunId),
        workerLeaseId,
        workerAttempt: leased!.workerAttempt,
      }
    );
  t.is(cancelledRun?.status, 'cancelled');
  t.true(await taskControl.reconcileCancelledAgentRun(cancelledRun!));

  const cancelled = await getTask(t.context, issued.token, {
    taskId: String(delegated.taskId),
    knownStateVersion: String(cancelling.stateVersion),
    waitMs: 0,
  });
  t.is(cancelled.status, 'cancelled');
  t.true(cancelled.terminal);
  t.is(cancelled.error.code, 'task_cancelled');
  t.is(cancelled.approval, null);

  await delegation.deliverCallback({ requestId: String(delegated.taskId) });
  await waitForCallbackCount(t.context.callbacks, 1);
  t.is(JSON.parse(t.context.callbacks[0].body).event, 'task_cancelled');
  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, docId, true);
  t.true(
    markdown?.markdown.includes('Original cooperative cancellation body.')
  );
});

test('worker rechecks credential activity before executing an authorized task', async t => {
  const { auth, credentials, db, owner, runtime, worker } = t.context;
  const member = await auth.signUp(
    `mcp-credential-member-${randomUUID()}@affine.pro`,
    '123456'
  );
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Original member document.',
    member.id
  );
  const issued = await credentials.create({
    userId: member.id,
    workspaceId,
    name: 'Credential activity recheck',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: 'Revoked credential replacement.',
        summary: 'Update the member document',
      }),
    },
  } as any);
  const delegated = await delegate(t.context, issued.token, {
    request: 'Update this document.',
    documentIds: [docId],
    idempotencyKey: 'credential-recheck-flow',
  });
  t.is(delegated.status, 'queued');
  await credentials.revoke(issued.credential.id, member.id, workspaceId);
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });

  const failed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(failed.status, 'failed');
  t.is((failed.result as any).code, 'credential_inactive');
  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, docId, true);
  t.true(markdown?.markdown.includes('Original member document.'));
  t.false(markdown?.markdown.includes('Revoked credential replacement.'));
});

test('worker rechecks live ACL before applying the credential-authorized update', async t => {
  const { auth, credentials, db, models, owner, runtime, worker } = t.context;
  const member = await auth.signUp(
    `mcp-worker-acl-${randomUUID()}@affine.pro`,
    '123456'
  );
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Worker ACL original body.',
    member.id
  );
  const issued = await credentials.create({
    userId: member.id,
    workspaceId,
    name: 'Worker ACL recheck',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: 'Worker must not write this body.',
        summary: 'Update with credential authorization',
      }),
    },
  } as any);
  const delegated = await delegate(t.context, issued.token, {
    request: 'Update this document.',
    documentIds: [docId],
    idempotencyKey: 'worker-acl-recheck-flow',
  });
  await models.workspaceUser.set(
    workspaceId,
    member.id,
    WorkspaceRole.External
  );
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });

  const failed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(failed.status, 'permission_denied');
  t.is((failed.result as any).code, 'permission_denied');
  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, docId, true);
  t.true(markdown?.markdown.includes('Worker ACL original body.'));
  t.false(markdown?.markdown.includes('Worker must not write this body.'));
});

test('worker rechecks document version before applying the credential-authorized update', async t => {
  const { credentials, db, owner, runtime, worker } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Worker version original body.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Worker version recheck',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: 'Worker must not overwrite the concurrent edit.',
        summary: 'Update with credential authorization',
      }),
    },
  } as any);
  const delegated = await delegate(t.context, issued.token, {
    request: 'Update this document.',
    documentIds: [docId],
    idempotencyKey: 'worker-version-recheck-flow',
  });
  await t.context
    .app!.get(DocWriter)
    .updateDoc(
      workspaceId,
      docId,
      'Concurrent edit before execution.',
      owner.id
    );
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });

  const failed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(failed.status, 'failed');
  t.is((failed.result as any).code, 'resource_version_conflict');
  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, docId, true);
  t.true(markdown?.markdown.includes('Concurrent edit before execution.'));
  t.false(
    markdown?.markdown.includes(
      'Worker must not overwrite the concurrent edit.'
    )
  );
});

test('worker failures send a terminal failure notification', async t => {
  const { callbacks, credentials, db, delegation, owner, runtime, worker } =
    t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'Worker failure original body.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'Worker failure notification',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
    callbackUrl: `${t.context.callbackOrigin}/localmind/results`,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: 'Worker failure replacement.',
        summary: 'Exercise the worker failure path',
      }),
    },
  } as any);
  Sinon.stub(t.context.app!.get(DocWriter), 'updateDoc').rejects(
    new Error('Simulated document write failure')
  );

  const delegated = await delegate(t.context, issued.token, {
    request: 'Update this document.',
    documentIds: [docId],
    idempotencyKey: 'worker-failure-notification',
  });
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(delegated.agentRunId),
  });

  const failed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: delegated.requestId },
  });
  t.is(failed.status, 'failed');
  t.is((failed.result as any).code, 'agent_runtime_adapter_execution_failed');
  await delegation.deliverCallback({ requestId: delegated.requestId });
  await waitForCallbackCount(callbacks, 1);
  t.like(JSON.parse(callbacks[0].body), {
    event: 'task_failed',
    requestId: delegated.requestId,
    status: 'failed',
    result: { code: 'agent_runtime_adapter_execution_failed' },
  });
});

test('document side effects run without a result notification callback', async t => {
  const { credentials, db, owner, runtime, worker } = t.context;
  const { docId, workspaceId } = await createDocument(
    t.context,
    owner.id,
    'No callback original body.'
  );
  const issued = await credentials.create({
    userId: owner.id,
    workspaceId,
    name: 'No callback',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'document_update',
        docId,
        content: 'This update runs without a callback.',
        summary: 'Update without result notification',
      }),
    },
  } as any);

  const result = await delegate(t.context, issued.token, {
    request: 'Update the document.',
    documentIds: [docId],
    idempotencyKey: 'no-callback-flow',
  });

  t.is(result.status, 'queued');
  t.is(result.execution, 'queued');
  t.is(result.resultNotification, 'not_configured');
  await worker.runStandaloneAgentRuntime({
    workspaceId,
    runId: String(result.agentRunId),
  });
  const completed = await db.aiMcpDelegationRequest.findUniqueOrThrow({
    where: { id: result.requestId },
  });
  t.is(completed.status, 'completed');
  t.is(await db.aiMcpDelegationCallbackDelivery.count(), 0);
  const markdown = await t.context
    .app!.get(DocReader)
    .getDocMarkdown(workspaceId, docId, true);
  t.true(markdown?.markdown.includes('This update runs without a callback.'));
});

async function createDocument(
  context: Context,
  ownerId: string,
  content: string,
  memberId?: string
) {
  const workspace = await context.models.workspace.create(ownerId);
  if (memberId) {
    await context.models.workspaceUser.set(
      workspace.id,
      memberId,
      WorkspaceRole.Collaborator,
      { status: WorkspaceMemberStatus.Accepted }
    );
  }
  await context.models.doc.upsert({
    spaceId: workspace.id,
    docId: workspace.id,
    blob: Buffer.from([0, 0]),
    timestamp: Date.now(),
    editorId: ownerId,
  });
  const document = await context
    .app!.get(DocWriter)
    .createDoc(workspace.id, 'MCP delegated document', content, ownerId);
  return { workspaceId: workspace.id, docId: document.docId };
}

async function delegate(
  context: Context,
  token: string,
  input: {
    request: string;
    documentIds: string[];
    attachmentIds?: string[];
    idempotencyKey: string;
  }
) {
  const workspaceId = await tokenWorkspaceId(context, token);
  const credential = await context.credentials.authenticate(token, workspaceId);
  return await context.delegation.delegate(
    credential,
    context.credentials.capabilities(
      credential.capabilities,
      credential.accessMode
    ),
    { ...input, attachmentIds: input.attachmentIds ?? [] },
    new AbortController().signal
  );
}

async function uploadAttachmentThroughMcp(
  context: Context,
  token: string,
  input: {
    fileName: string;
    mimeType: string;
    base64: string;
    idempotencyKey: string;
  }
) {
  const workspaceId = await tokenWorkspaceId(context, token);
  const response = await context
    .app!.POST(`/api/workspaces/${workspaceId}/mcp`)
    .set('Authorization', `Bearer ${token}`)
    .set('MCP-Protocol-Version', '2025-06-18')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'upload_localmind_attachment', arguments: input },
    })
    .expect(200);
  return response.body.result.structuredContent.result as any;
}

async function getTask(
  context: Context,
  token: string,
  input: {
    taskId: string;
    knownStateVersion?: string;
    waitMs: number;
  }
) {
  const workspaceId = await tokenWorkspaceId(context, token);
  const credential = await context.credentials.authenticate(token, workspaceId);
  return (await context.taskQuery.getTask(
    credential,
    input,
    new AbortController().signal
  )) as any;
}

async function getTaskThroughMcp(
  context: Context,
  token: string,
  input: {
    taskId: string;
    knownStateVersion?: string;
    waitMs: number;
  }
) {
  const workspaceId = await tokenWorkspaceId(context, token);
  const response = await context
    .app!.POST(`/api/workspaces/${workspaceId}/mcp`)
    .set('Authorization', `Bearer ${token}`)
    .set('MCP-Protocol-Version', '2025-06-18')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_localmind_task', arguments: input },
    })
    .expect(200);
  return response.body.result.structuredContent.result as any;
}

async function controlTaskThroughMcp(
  context: Context,
  token: string,
  input: {
    taskId: string;
    action: 'cancel';
    idempotencyKey: string;
    reason?: string;
  }
) {
  const workspaceId = await tokenWorkspaceId(context, token);
  const response = await context
    .app!.POST(`/api/workspaces/${workspaceId}/mcp`)
    .set('Authorization', `Bearer ${token}`)
    .set('MCP-Protocol-Version', '2025-06-18')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'control_localmind_task', arguments: input },
    })
    .expect(200);
  return response.body.result.structuredContent.result as any;
}

async function tokenWorkspaceId(context: Context, token: string) {
  const credentialId = token.split('.')[1];
  const credential = await context.db.mcpCredential.findUnique({
    where: { id: credentialId },
    select: { workspaceId: true },
  });
  if (!credential) throw new Error('Test MCP credential not found');
  return credential.workspaceId;
}

function verifySignature(
  secret: string,
  timestamp: string,
  signature: string,
  body: string
) {
  return (
    signature ===
    `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')}`
  );
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Callback test server did not bind a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function waitForCallbackCount(
  callbacks: CapturedCallback[],
  expectedCount: number
) {
  const deadline = Date.now() + 10_000;
  while (callbacks.length < expectedCount && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (callbacks.length < expectedCount) {
    throw new Error(
      `Expected ${expectedCount} callbacks, received ${callbacks.length}`
    );
  }
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
