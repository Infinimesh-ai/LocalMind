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
import { LOCALMIND_DELEGATION_AI_TOOLS } from '../../plugins/copilot/agent-runtime-localmind-tool-agent-adapter';
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
  t.like(planner.firstCall.args[3], {
    responseSchemaJson: {
      type: 'object',
      required: ['result'],
      additionalProperties: false,
    },
  });
  t.regex(
    planner.firstCall.args[1][0].content,
    /ordinary read-only questions, summaries, explanations, or confirmations/
  );
  t.regex(
    planner.firstCall.args[1][0].content,
    /Missing document context is not an unsupported operation/
  );
  const plannerSchema = JSON.stringify(
    planner.firstCall.args[3]!.responseSchemaJson
  );
  t.regex(plannerSchema, /Use answer for every read-only question/);
  t.regex(
    plannerSchema,
    /Never use unsupported_task for a read-only response or missing document context/
  );
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
  Sinon.stub(runtime, 'generateStructuredValue').resolves({
    value: {
      result: plannerResult({
        kind: 'tool_agent',
        summary: 'Summarize the source and create a new document',
      }),
    },
  } as any);

  let createdDocumentId = '';
  const toolLoop = Sinon.stub(runtime, 'streamObject').callsFake(((
    _conditions: unknown,
    _messages: unknown,
    options: any
  ) => {
    return (async function* () {
      t.is(options.user, owner.id);
      t.is(options.workspace, workspaceId);
      t.truthy(options.signal);
      t.deepEqual(options.tools, [...LOCALMIND_DELEGATION_AI_TOOLS]);
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
        toolCallId: 'failed-web-call',
        toolName: 'web_crawl_exa',
        args: { url: 'https://example.com' },
        result: { message: 'Simulated crawl failure' },
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
    toolName: 'doc_create',
    status: 'completed',
    documentId: createdDocumentId,
    relation: 'created',
  });
  t.like(task.result.toolExecutions[1], {
    toolName: 'workspace_folder_add_document',
    status: 'completed',
    documentId: placedDocument.docId,
    workspaceEffect: {
      kind: 'workspace_organization',
      operation: 'add_document',
      folderId: 'folder-1',
    },
  });
  t.like(task.result.toolExecutions[2], {
    toolName: 'web_crawl_exa',
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
    input,
    new AbortController().signal
  );
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
