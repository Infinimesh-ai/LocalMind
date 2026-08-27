import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { ExternalMcpConnectionStatus } from '@prisma/client';
import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';

import { ExternalMcpConnectionService } from '../../plugins/copilot/external-mcp/service';
import { ExternalMcpToolRegistry } from '../../plugins/copilot/external-mcp/tool-registry';
import {
  ExternalMcpTransport,
  ExternalMcpTransportError,
} from '../../plugins/copilot/external-mcp/transport';

type CapturedRequest = {
  method: string;
  authorization?: string;
  sessionId?: string;
  protocolVersion?: string;
  idempotencyKey?: string;
};

const test = ava.serial as TestFn;
const endpoint = 'http://192.168.20.252:18790/mcp';
const conversationToolName = 'sparkclaw.conversation.send';

const conversationV2Tools = () => [
  {
    name: conversationToolName,
    description: 'Send a SparkClaw conversation message',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        media: { type: 'array' },
      },
      anyOf: [{ required: ['text'] }, { required: ['media'] }],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  ...['get', 'result', 'cancel'].map(action => ({
    name: `sparkclaw.operation.${action}`,
    inputSchema: {
      type: 'object',
      properties: { operation_id: { type: 'string' } },
      required: ['operation_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: action !== 'cancel' },
  })),
];

const allowedAccess = () => {
  const access = {
    user: Sinon.stub(),
    workspace: Sinon.stub(),
    allowLocal: Sinon.stub(),
    can: Sinon.stub().resolves(true),
    assert: Sinon.stub().resolves(),
  };
  access.user.returns(access);
  access.workspace.returns(access);
  access.allowLocal.returns(access);
  return access;
};

const availableMutex = () => ({
  acquire: Sinon.stub().resolves({
    [Symbol.asyncDispose]: Sinon.stub().resolves(),
  }),
});

test('Streamable HTTP transport exchanges a one-time ticket for a session', async t => {
  const captured: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const body = await readRequest(request);
    const payload = JSON.parse(body) as { method: string };
    captured.push({
      method: payload.method,
      authorization: request.headers.authorization,
      sessionId: request.headers['mcp-session-id'] as string | undefined,
      protocolVersion: request.headers['mcp-protocol-version'] as
        | string
        | undefined,
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
    });

    if (payload.method === 'initialize') {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Mcp-Session-Id', 'session-secret');
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2025-06-18',
            serverInfo: {
              name: 'sparkclaw-conversation-mcp',
              version: '2',
            },
          },
        })
      );
      return;
    }
    if (payload.method === 'notifications/initialized') {
      response.statusCode = 202;
      response.end();
      return;
    }
    if (payload.method === 'tools/list') {
      response.setHeader('Content-Type', 'text/event-stream');
      response.end(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            tools: conversationV2Tools(),
          },
        })}\n\n`
      );
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: 'ok' } })
    );
  });
  const endpoint = await listen(server);
  const transport = new ExternalMcpTransport();

  try {
    const initialized = await transport.initialize({
      endpoint,
      ticket: 'ticket-once',
      protocolVersion: '2025-06-18',
    });
    t.is(initialized.sessionId, 'session-secret');
    t.deepEqual(initialized.serverInfo, {
      name: 'sparkclaw-conversation-mcp',
      version: '2',
    });

    await transport.initialized({
      endpoint,
      sessionId: initialized.sessionId,
      protocolVersion: initialized.protocolVersion,
    });
    const listed = await transport.listTools({
      endpoint,
      sessionId: initialized.sessionId,
      protocolVersion: initialized.protocolVersion,
    });
    t.is(listed.tools.length, 4);
    t.is(listed.sessionId, 'session-secret');
    const called = await transport.callTool({
      endpoint,
      sessionId: initialized.sessionId,
      protocolVersion: initialized.protocolVersion,
      name: conversationToolName,
      arguments: { text: 'hello' },
      idempotencyKey: 'business-request-1',
    });
    t.deepEqual(called.result, { content: 'ok' });
    t.is(called.sessionId, 'session-secret');

    t.deepEqual(captured, [
      {
        method: 'initialize',
        authorization: 'Bearer ticket-once',
        sessionId: undefined,
        protocolVersion: '2025-06-18',
        idempotencyKey: undefined,
      },
      {
        method: 'notifications/initialized',
        authorization: undefined,
        sessionId: 'session-secret',
        protocolVersion: '2025-06-18',
        idempotencyKey: undefined,
      },
      {
        method: 'tools/list',
        authorization: undefined,
        sessionId: 'session-secret',
        protocolVersion: '2025-06-18',
        idempotencyKey: undefined,
      },
      {
        method: 'tools/call',
        authorization: undefined,
        sessionId: 'session-secret',
        protocolVersion: '2025-06-18',
        idempotencyKey: 'business-request-1',
      },
    ]);
  } finally {
    await close(server);
  }
});

test('connection service encrypts the session and never persists the ticket', async t => {
  const savedInitialized: Record<string, unknown>[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const transport = {
    initialize: Sinon.stub().resolves({
      sessionId: 'session-secret',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'sparkclaw-conversation-mcp', version: '2' },
    }),
    initialized: Sinon.stub().resolves('session-secret'),
    listTools: Sinon.stub().resolves({
      sessionId: 'session-secret',
      tools: conversationV2Tools(),
    }),
  };
  const baseConnection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    name: 'SparkClaw MCP',
    endpoint,
    protocolVersion: '2025-06-18',
    status: ExternalMcpConnectionStatus.CONNECTING,
    encryptedSessionId: 'encrypted:session-secret',
    sessionFingerprint: 'fingerprint',
    serverName: 'sparkclaw-conversation-mcp',
    serverVersion: '2',
    toolCatalog: [],
    toolCatalogFingerprint: null,
    enabledToolNames: [],
    lastConnectedAt: new Date(),
    lastCheckedAt: new Date(),
    lastUsedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const model = {
    saveInitialized: Sinon.stub().callsFake(async input => {
      savedInitialized.push(input);
      return baseConnection;
    }),
    saveCatalog: Sinon.stub().callsFake(async input => ({
      ...baseConnection,
      status: ExternalMcpConnectionStatus.ACTIVE,
      toolCatalog: input.toolCatalog,
      toolCatalogFingerprint: input.toolCatalogFingerprint,
      enabledToolNames: input.enabledToolNames,
    })),
    addAudit: Sinon.stub().callsFake(async input => {
      audits.push(input);
      return input;
    }),
  };
  const service = new ExternalMcpConnectionService(
    {
      copilot: {
        externalMcp: {
          endpoint,
        },
      },
    } as any,
    {
      encrypt: (value: string) => `encrypted:${value}`,
      decrypt: (value: string) => value.replace('encrypted:', ''),
      sha256: (value: string) => createHash('sha256').update(value).digest(),
    } as any,
    { copilotExternalMcp: model } as any,
    transport as any,
    allowedAccess() as any,
    availableMutex() as any
  );

  const connected = await service.connect({
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    name: 'SparkClaw MCP',
    ticket: 'ticket-must-not-persist',
  });

  t.is(connected.status, ExternalMcpConnectionStatus.ACTIVE);
  t.is(savedInitialized.length, 1);
  t.is(savedInitialized[0].encryptedSessionId, 'encrypted:session-secret');
  t.false(Object.hasOwn(savedInitialized[0], 'ticket'));
  t.false(JSON.stringify(savedInitialized).includes('ticket-must-not-persist'));
  t.false(JSON.stringify(audits).includes('ticket-must-not-persist'));
  t.deepEqual(connected.enabledToolNames, [conversationToolName]);
  t.is(
    Array.isArray(connected.toolCatalog) ? connected.toolCatalog.length : 0,
    4
  );
});

test('connection service rechecks settings permission before admin operations', async t => {
  const connection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    enabledToolNames: [conversationToolName],
  } as any;
  const access = allowedAccess();
  access.assert.rejects(new Error('permission denied'));
  const model = {
    getByWorkspace: Sinon.stub().resolves(connection),
    saveInitialized: Sinon.stub(),
    saveCatalog: Sinon.stub(),
    updateEnabledTools: Sinon.stub(),
    disable: Sinon.stub(),
    softDelete: Sinon.stub(),
  };
  const transport = {
    initialize: Sinon.stub(),
    listTools: Sinon.stub(),
    callTool: Sinon.stub(),
  };
  const service = new ExternalMcpConnectionService(
    {
      copilot: {
        externalMcp: { endpoint },
      },
    } as any,
    {} as any,
    { copilotExternalMcp: model } as any,
    transport as any,
    access as any,
    availableMutex() as any
  );

  const operations = [
    () =>
      service.connect({
        workspaceId: connection.workspaceId,
        actorId: 'user-1',
        name: 'SparkClaw MCP',
        ticket: 'one-time-ticket',
      }),
    () => service.refresh(connection, 'user-1'),
    () => service.updateEnabledTools(connection, 'user-1', []),
    () => service.testConversation(connection, 'user-1', 'hello'),
    () => service.disable(connection, 'user-1'),
    () => service.delete(connection, 'user-1'),
  ];
  for (const operation of operations) {
    await t.throwsAsync(operation, { message: 'permission denied' });
  }

  t.is(access.assert.callCount, operations.length);
  t.true(
    access.assert.alwaysCalledWithExactly('Workspace.Settings.Update'),
    'every admin operation must recheck settings permission'
  );
  t.false(model.getByWorkspace.called);
  t.false(model.saveInitialized.called);
  t.false(model.saveCatalog.called);
  t.false(model.updateEnabledTools.called);
  t.false(model.disable.called);
  t.false(model.softDelete.called);
  t.false(transport.initialize.called);
  t.false(transport.listTools.called);
  t.false(transport.callTool.called);
});

test('initialize rejects an MCP server with an unexpected identity', async t => {
  const server = createServer(async (request, response) => {
    await readRequest(request);
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Mcp-Session-Id', 'unexpected-session');
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          serverInfo: { name: 'not-sparkclaw', version: '1.0.0' },
        },
      })
    );
  });
  const endpoint = await listen(server);

  try {
    await t.throwsAsync(
      new ExternalMcpTransport().initialize({
        endpoint,
        ticket: 'ticket-once',
        protocolVersion: '2025-06-18',
      }),
      { message: /did not identify itself as SparkClaw/ }
    );
  } finally {
    await close(server);
  }
});

test('invalid remote session marks a connection as requiring reauthentication', async t => {
  const connection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    name: 'SparkClaw MCP',
    endpoint,
    protocolVersion: '2025-06-18',
    status: ExternalMcpConnectionStatus.ACTIVE,
    encryptedSessionId: 'encrypted:session-secret',
    sessionFingerprint: 'fingerprint',
    serverName: 'sparkclaw-conversation-mcp',
    serverVersion: '2',
    toolCatalog: [],
    toolCatalogFingerprint: null,
    enabledToolNames: [],
    lastConnectedAt: new Date(),
    lastCheckedAt: new Date(),
    lastUsedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const recordFailure = Sinon.stub().callsFake(async (_id, status) => ({
    ...connection,
    status,
  }));
  const service = new ExternalMcpConnectionService(
    {
      copilot: {
        externalMcp: {
          endpoint,
        },
      },
    } as any,
    {
      decrypt: () => 'session-secret',
      sha256: (value: string) => createHash('sha256').update(value).digest(),
    } as any,
    {
      copilotExternalMcp: {
        getByWorkspace: Sinon.stub().resolves(connection),
        recordFailure,
        addAudit: Sinon.stub().resolves(),
      },
    } as any,
    {
      listTools: Sinon.stub().rejects(
        new ExternalMcpTransportError(
          'mcp_session_invalid',
          'SparkClaw MCP session is invalid or expired',
          401
        )
      ),
    } as any,
    allowedAccess() as any,
    availableMutex() as any
  );

  await t.throwsAsync(service.refresh(connection, 'user-1'), {
    message: /invalid or expired/,
  });
  t.is(
    recordFailure.firstCall.args[1],
    ExternalMcpConnectionStatus.REAUTH_REQUIRED
  );
});

test('a connection requiring reauthentication does not reuse its old session', async t => {
  const connection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    name: 'SparkClaw MCP',
    endpoint,
    protocolVersion: '2025-06-18',
    status: ExternalMcpConnectionStatus.REAUTH_REQUIRED,
    encryptedSessionId: 'encrypted:old-session',
    sessionFingerprint: 'fingerprint',
    serverName: 'sparkclaw-conversation-mcp',
    serverVersion: '2',
    toolCatalog: [],
    toolCatalogFingerprint: null,
    enabledToolNames: [],
    lastConnectedAt: new Date(),
    lastCheckedAt: new Date(),
    lastUsedAt: null,
    lastErrorCode: 'mcp_session_invalid',
    lastErrorMessage: 'Session expired',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const listTools = Sinon.stub();
  const service = new ExternalMcpConnectionService(
    {
      copilot: {
        externalMcp: { endpoint },
      },
    } as any,
    {} as any,
    {
      copilotExternalMcp: {
        getByWorkspace: Sinon.stub().resolves(connection),
      },
    } as any,
    { listTools } as any,
    allowedAccess() as any,
    availableMutex() as any
  );

  await t.throwsAsync(service.refresh(connection, 'user-1'), {
    message: /requires reauthentication/,
  });
  t.false(listTools.called);
});

test('connection service ignores persisted transport settings when refreshing tools', async t => {
  const configuredEndpoint = endpoint;
  const connection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    name: 'SparkClaw MCP',
    endpoint: 'http://database-drift.invalid/mcp',
    protocolVersion: 'database-drift',
    status: ExternalMcpConnectionStatus.ACTIVE,
    encryptedSessionId: 'encrypted:session-secret',
    sessionFingerprint: 'fingerprint',
    serverName: 'sparkclaw-conversation-mcp',
    serverVersion: '2',
    toolCatalog: [],
    toolCatalogFingerprint: null,
    enabledToolNames: [],
    lastConnectedAt: new Date(),
    lastCheckedAt: new Date(),
    lastUsedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const listTools = Sinon.stub().resolves({
    sessionId: 'session-secret',
    tools: conversationV2Tools(),
  });
  const service = new ExternalMcpConnectionService(
    {
      copilot: { externalMcp: { endpoint: configuredEndpoint } },
    } as any,
    {
      decrypt: () => 'session-secret',
      sha256: (value: string) => createHash('sha256').update(value).digest(),
    } as any,
    {
      copilotExternalMcp: {
        getByWorkspace: Sinon.stub().resolves(connection),
        saveCatalog: Sinon.stub().callsFake(async input => ({
          ...connection,
          status: ExternalMcpConnectionStatus.ACTIVE,
          toolCatalog: input.toolCatalog,
          toolCatalogFingerprint: input.toolCatalogFingerprint,
          enabledToolNames: input.enabledToolNames,
        })),
        addAudit: Sinon.stub().resolves(),
      },
    } as any,
    { listTools } as any,
    allowedAccess() as any,
    availableMutex() as any
  );

  await service.refresh(connection, 'user-1');

  t.is(listTools.callCount, 1);
  t.is(listTools.firstCall.args[0].endpoint, configuredEndpoint);
  t.is(listTools.firstCall.args[0].protocolVersion, '2025-06-18');
});

test('connection service executes an allowlisted tool through an encrypted durable ledger', async t => {
  const connection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    name: 'SparkClaw MCP',
    endpoint: 'http://database-drift.invalid/mcp',
    protocolVersion: 'database-drift',
    status: ExternalMcpConnectionStatus.ACTIVE,
    encryptedSessionId: 'encrypted:session-secret',
    sessionFingerprint: 'fingerprint',
    serverName: 'sparkclaw-conversation-mcp',
    serverVersion: '2',
    toolCatalog: [
      {
        ...conversationV2Tools()[0],
        risk: 'write',
        requiresExplicitUserRequest: true,
      },
    ],
    toolCatalogFingerprint: 'catalog-fingerprint',
    enabledToolNames: [conversationToolName],
    lastConnectedAt: new Date(),
    lastCheckedAt: new Date(),
    lastUsedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const audits: Record<string, unknown>[] = [];
  const finalizeToolExecutionSuccess = Sinon.stub().callsFake(async input => {
    audits.push(input.metadata);
  });
  const model = {
    getByWorkspace: Sinon.stub().resolves(connection),
    claimToolExecution: Sinon.stub().resolves({
      state: 'claimed',
      execution: {
        id: 'execution-1',
        leaseId: 'lease-1',
        attemptCount: 1,
      },
    }),
    finalizeToolExecutionSuccess,
    addAudit: Sinon.stub().callsFake(async input => {
      audits.push(input);
      return input;
    }),
  };
  const callTool = Sinon.stub().resolves({
    sessionId: 'session-secret',
    result: {
      content: [
        { type: 'text', text: 'SparkClaw answer' },
        { type: 'image', data: 'base64-image-secret', mimeType: 'image/png' },
        {
          type: 'resource',
          resource: {
            uri: 'sparkclaw://mcp-operation/operation-1/part/2',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            blob: 'base64-file-secret',
          },
        },
      ],
      structuredContent: {
        operation_id: 'operation-1',
        state: 'succeeded',
        parts: [{ kind: 'image', bytes: 128, sha256: 'image-digest' }],
      },
    },
  });
  const service = new ExternalMcpConnectionService(
    {
      copilot: {
        externalMcp: { endpoint },
      },
    } as any,
    {
      encrypt: (value: string) => `encrypted:${value}`,
      decrypt: (value: string) => value.replace('encrypted:', ''),
      sha256: (value: string) => createHash('sha256').update(value).digest(),
    } as any,
    { copilotExternalMcp: model } as any,
    { callTool } as any,
    allowedAccess() as any,
    availableMutex() as any
  );

  const result = await service.executeTool({
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    toolName: conversationToolName,
    arguments: { text: 'What is queued?' },
    idempotencyKey: 'delegation-1-conversation',
    confirmed: true,
  });

  t.deepEqual(result, {
    toolName: conversationToolName,
    risk: 'write',
    result: {
      content: [
        { type: 'text', text: 'SparkClaw answer' },
        { type: 'image', mimeType: 'image/png', binaryOmitted: true },
        {
          type: 'resource',
          resource: {
            uri: 'sparkclaw://mcp-operation/operation-1/part/2',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            binaryOmitted: true,
          },
        },
      ],
      structuredContent: {
        operation_id: 'operation-1',
        state: 'succeeded',
        parts: [{ kind: 'image', bytes: 128, sha256: 'image-digest' }],
      },
    },
    idempotentReplay: false,
    sideEffectApplied: true,
  });
  Sinon.assert.calledOnce(callTool);
  Sinon.assert.calledWithMatch(callTool, {
    endpoint,
    name: conversationToolName,
    idempotencyKey: 'delegation-1-conversation',
  });
  Sinon.assert.calledOnce(finalizeToolExecutionSuccess);
  Sinon.assert.calledWithMatch(finalizeToolExecutionSuccess, {
    id: 'execution-1',
    leaseId: 'lease-1',
    remoteOperationId: 'operation-1',
    encryptedResult: Sinon.match(/^encrypted:/),
  });
  t.false(
    finalizeToolExecutionSuccess.firstCall.args[0].encryptedResult.includes(
      'base64-'
    )
  );
  const serializedAudits = JSON.stringify(audits);
  t.false(serializedAudits.includes('What is queued?'));
  t.false(serializedAudits.includes('SparkClaw answer'));
  t.true(serializedAudits.includes('argumentsFingerprint'));
  t.true(serializedAudits.includes('resultFingerprint'));
});

test('connection service persists a pending SparkClaw operation for polling', async t => {
  const connection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    status: ExternalMcpConnectionStatus.ACTIVE,
    encryptedSessionId: 'encrypted:session-secret',
    enabledToolNames: [conversationToolName],
    toolCatalog: [
      {
        ...conversationV2Tools()[0],
        risk: 'write',
        requiresExplicitUserRequest: true,
      },
    ],
    deletedAt: null,
  } as any;
  const finalizeToolExecutionPending = Sinon.stub().resolves();
  const service = new ExternalMcpConnectionService(
    { copilot: { externalMcp: { endpoint } } } as any,
    {
      encrypt: (value: string) => `encrypted:${value}`,
      decrypt: (value: string) => value.replace('encrypted:', ''),
      sha256: (value: string) => createHash('sha256').update(value).digest(),
    } as any,
    {
      copilotExternalMcp: {
        getByWorkspace: Sinon.stub().resolves(connection),
        claimToolExecution: Sinon.stub().resolves({
          state: 'claimed',
          execution: {
            id: 'execution-1',
            leaseId: 'lease-1',
            attemptCount: 1,
          },
        }),
        finalizeToolExecutionPending,
        finalizeToolExecutionFailure: Sinon.stub(),
        addAudit: Sinon.stub().resolves(),
      },
    } as any,
    {
      callTool: Sinon.stub().resolves({
        sessionId: 'session-secret',
        result: {
          content: [{ type: 'text', text: '{"state":"running"}' }],
          structuredContent: {
            operation: {
              id: 'operation-1',
              state: 'running',
              invocation: { deadline: '2026-08-27T12:15:00.000Z' },
            },
          },
        },
      }),
    } as any,
    allowedAccess() as any,
    availableMutex() as any
  );

  const result = await service.executeTool({
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    toolName: conversationToolName,
    arguments: { text: 'hello' },
    idempotencyKey: 'pending-conversation-1',
    confirmed: true,
  });

  t.is(result.remoteOperationId, 'operation-1');
  t.is(result.remoteState, 'running');
  t.deepEqual(result.result, {
    content: [
      { type: 'text', text: 'SparkClaw is still processing this request.' },
    ],
    structuredContent: {
      operation_id: 'operation-1',
      state: 'running',
      ready: false,
    },
  });
  Sinon.assert.calledWithMatch(finalizeToolExecutionPending, {
    id: 'execution-1',
    leaseId: 'lease-1',
    remoteOperationId: 'operation-1',
    remoteState: 'running',
    remoteDeadlineAt: new Date('2026-08-27T12:15:00.000Z'),
  });
});

test('pending operation polling rechecks ACL and strips remote binary payloads', async t => {
  const connection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    status: ExternalMcpConnectionStatus.ACTIVE,
    encryptedSessionId: 'encrypted:session-secret',
    deletedAt: null,
  } as any;
  const execution = {
    id: 'execution-1',
    connectionId: connection.id,
    workspaceId: connection.workspaceId,
    actorId: 'user-1',
    toolName: conversationToolName,
    risk: 'write',
    idempotencyKey: 'pending-conversation-1',
    argumentsFingerprint: 'arguments-fingerprint',
    status: 'RUNNING',
    remoteOperationId: 'operation-1',
    remoteState: 'running',
    remoteDeadlineAt: new Date(Date.now() + 60_000),
    pollAttemptCount: 1,
    leaseId: 'poll-lease-1',
    leaseExpiresAt: new Date(Date.now() + 30_000),
    connection,
  } as any;
  const finalizeToolExecutionSuccess = Sinon.stub().resolves();
  const callTool = Sinon.stub().resolves({
    sessionId: 'session-secret',
    result: {
      content: [
        { type: 'text', text: 'done' },
        { type: 'audio', data: 'base64-audio-secret', mimeType: 'audio/wav' },
      ],
      structuredContent: {
        operation_id: 'operation-1',
        state: 'succeeded',
        parts: [{ kind: 'audio', bytes: 64, sha256: 'audio-digest' }],
      },
    },
  });
  const service = new ExternalMcpConnectionService(
    { copilot: { externalMcp: { endpoint } } } as any,
    {
      encrypt: (value: string) => `encrypted:${value}`,
      decrypt: (value: string) => value.replace('encrypted:', ''),
      sha256: (value: string) => createHash('sha256').update(value).digest(),
    } as any,
    {
      copilotExternalMcp: {
        listDueRemoteOperations: Sinon.stub().resolves([execution]),
        claimRemoteOperationPoll: Sinon.stub().resolves(execution),
        finalizeToolExecutionSuccess,
      },
    } as any,
    { callTool } as any,
    allowedAccess() as any,
    availableMutex() as any
  );

  const result = await service.processPendingOperations();

  t.deepEqual(result, {
    selectedCount: 1,
    processedCount: 1,
    completedCount: 1,
    rescheduledCount: 0,
    failedCount: 0,
    cancelledCount: 0,
  });
  Sinon.assert.calledWithMatch(callTool, {
    name: 'sparkclaw.operation.result',
    arguments: { operation_id: 'operation-1' },
  });
  const encryptedResult =
    finalizeToolExecutionSuccess.firstCall.args[0].encryptedResult;
  t.false(encryptedResult.includes('base64-audio-secret'));
  t.true(encryptedResult.includes('binaryOmitted'));
});

test('pending operation cancellation is sent when delegated ACL is revoked', async t => {
  const access = allowedAccess();
  access.can.resolves(false);
  const connection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    status: ExternalMcpConnectionStatus.ACTIVE,
    encryptedSessionId: 'encrypted:session-secret',
    deletedAt: null,
  } as any;
  const execution = {
    id: 'execution-1',
    workspaceId: connection.workspaceId,
    actorId: 'user-1',
    toolName: conversationToolName,
    risk: 'write',
    remoteOperationId: 'operation-1',
    remoteState: 'running',
    remoteDeadlineAt: new Date(Date.now() + 60_000),
    pollAttemptCount: 1,
    leaseId: 'poll-lease-1',
    connection,
  } as any;
  const finalizeToolExecutionFailure = Sinon.stub().resolves();
  const callTool = Sinon.stub().resolves({
    sessionId: 'session-secret',
    result: { structuredContent: { operation: { id: 'operation-1' } } },
  });
  const service = new ExternalMcpConnectionService(
    { copilot: { externalMcp: { endpoint } } } as any,
    {
      decrypt: (value: string) => value.replace('encrypted:', ''),
      sha256: (value: string) => createHash('sha256').update(value).digest(),
    } as any,
    {
      copilotExternalMcp: {
        listDueRemoteOperations: Sinon.stub().resolves([execution]),
        claimRemoteOperationPoll: Sinon.stub().resolves(execution),
        finalizeToolExecutionFailure,
      },
    } as any,
    { callTool } as any,
    access as any,
    availableMutex() as any
  );

  const result = await service.processPendingOperations();

  t.is(result.cancelledCount, 1);
  Sinon.assert.calledWithMatch(callTool, {
    name: 'sparkclaw.operation.cancel',
    arguments: { operation_id: 'operation-1' },
  });
  Sinon.assert.calledWithMatch(finalizeToolExecutionFailure, {
    status: 'CANCELLED',
    errorCode: 'mcp_delegated_acl_revoked',
    remoteState: 'cancelled',
  });
});

test('SparkClaw tool registry requires owner-authored conversation arguments', async t => {
  const executeTool = Sinon.stub().resolves({
    toolName: conversationToolName,
    risk: 'write',
    result: { content: [{ type: 'text', text: 'answer' }] },
    idempotentReplay: false,
    sideEffectApplied: true,
  });
  const registry = new ExternalMcpToolRegistry({
    enabledTools: Sinon.stub().resolves([
      {
        name: conversationToolName,
        description: 'Send a SparkClaw conversation message',
        inputSchema: { type: 'object' },
        risk: 'write',
        requiresExplicitUserRequest: true,
      },
    ]),
    executeTool,
  } as any);
  const tools = await registry.getTools({
    workspaceId: 'workspace-1',
    userId: 'user-1',
    invocationId: 'delegation-conversation-1',
  });

  const search = (await tools.sparkclaw_mcp_search.execute?.(
    { query: 'conversation', limit: 8 },
    {}
  )) as { matches: Array<{ toolName: string; risk: string }> };
  t.deepEqual(search.matches, [
    { ...search.matches[0], toolName: conversationToolName, risk: 'write' },
  ]);
  await t.throwsAsync(
    async () =>
      await tools.sparkclaw_mcp_execute.execute?.(
        { toolName: conversationToolName, arguments: { text: 'hello' } },
        { messages: [{ role: 'user', content: 'Please answer hello.' }] }
      ),
    { message: /requires a direct user request/ }
  );
  await t.throwsAsync(
    async () =>
      await tools.sparkclaw_mcp_execute.execute?.(
        { toolName: conversationToolName, arguments: { text: 'hello' } },
        {
          messages: [
            { role: 'user', content: '不要调用 SparkClaw 回答 hello。' },
          ],
        }
      ),
    { message: /requires a direct user request/ }
  );
  await t.throwsAsync(
    async () =>
      await tools.sparkclaw_mcp_execute.execute?.(
        {
          toolName: conversationToolName,
          arguments: { text: 'model-generated expansion' },
        },
        {
          messages: [
            {
              role: 'user',
              content: '请让 SparkClaw 回答队列状态。',
            },
          ],
        }
      ),
    { message: /requires a direct user request/ }
  );

  const messages = [
    {
      role: 'user' as const,
      content: '请让 SparkClaw 回答 What is queued?，并使用 report.png。',
    },
  ];
  await tools.sparkclaw_mcp_execute.execute?.(
    {
      toolName: conversationToolName,
      arguments: {
        text: 'What is queued?',
        media: [{ name: 'report.png' }],
      },
    },
    { messages }
  );
  await tools.sparkclaw_mcp_execute.execute?.(
    {
      toolName: conversationToolName,
      arguments: {
        media: [{ name: 'report.png' }],
        text: 'What is queued?',
      },
    },
    { messages }
  );

  t.is(executeTool.callCount, 2);
  t.is(
    executeTool.firstCall.args[0].idempotencyKey,
    executeTool.secondCall.args[0].idempotencyKey
  );
  t.true(executeTool.firstCall.args[0].confirmed);

  const frozenTools = await registry.getTools({
    workspaceId: 'workspace-1',
    userId: 'user-1',
    invocationId: 'delegation-control-tool-not-exposed',
    allowedToolNames: ['sparkclaw.operation.result'],
  });
  t.deepEqual(frozenTools, {});
});

function readRequest(request: NodeJS.ReadableStream) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing address');
  return `http://127.0.0.1:${address.port}/mcp`;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
}
