import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { ExternalMcpConnectionStatus } from '@prisma/client';
import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';

import { ExternalMcpConnectionService } from '../../plugins/copilot/external-mcp/service';
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
            serverInfo: { name: 'sparkclaw-route-mcp', version: '1.2.3' },
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
            tools: [
              {
                name: 'sparkclaw.route.conversation.answer',
                inputSchema: { type: 'object' },
              },
            ],
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
      name: 'sparkclaw-route-mcp',
      version: '1.2.3',
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
    t.is(listed.tools.length, 1);
    t.is(listed.sessionId, 'session-secret');
    const called = await transport.callTool({
      endpoint,
      sessionId: initialized.sessionId,
      protocolVersion: initialized.protocolVersion,
      name: 'sparkclaw.route.conversation.answer',
      arguments: { query: 'hello' },
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
      serverInfo: { name: 'sparkclaw-route-mcp', version: '1.0.0' },
    }),
    initialized: Sinon.stub().resolves('session-secret'),
    listTools: Sinon.stub().resolves({
      sessionId: 'session-secret',
      tools: [
        {
          name: 'sparkclaw.route.conversation.answer',
          description: 'Answer a conversation query',
          inputSchema: { type: 'object' },
        },
      ],
    }),
  };
  const baseConnection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    name: 'SparkClaw MCP',
    endpoint: 'http://192.168.20.252:18791/mcp',
    protocolVersion: '2025-06-18',
    status: ExternalMcpConnectionStatus.CONNECTING,
    encryptedSessionId: 'encrypted:session-secret',
    sessionFingerprint: 'fingerprint',
    serverName: 'sparkclaw-route-mcp',
    serverVersion: '1.0.0',
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
          endpoint: 'http://192.168.20.252:18791/mcp',
        },
      },
    } as any,
    {
      encrypt: (value: string) => `encrypted:${value}`,
      decrypt: (value: string) => value.replace('encrypted:', ''),
      sha256: (value: string) => createHash('sha256').update(value).digest(),
    } as any,
    { copilotExternalMcp: model } as any,
    transport as any
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
  t.deepEqual(connected.enabledToolNames, [
    'sparkclaw.route.conversation.answer',
  ]);
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
    endpoint: 'http://192.168.20.252:18791/mcp',
    protocolVersion: '2025-06-18',
    status: ExternalMcpConnectionStatus.ACTIVE,
    encryptedSessionId: 'encrypted:session-secret',
    sessionFingerprint: 'fingerprint',
    serverName: 'sparkclaw-route-mcp',
    serverVersion: '1.0.0',
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
          endpoint: 'http://192.168.20.252:18791/mcp',
        },
      },
    } as any,
    {
      decrypt: () => 'session-secret',
      sha256: (value: string) => createHash('sha256').update(value).digest(),
    } as any,
    {
      copilotExternalMcp: {
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
    } as any
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
    endpoint: 'http://192.168.20.252:18791/mcp',
    protocolVersion: '2025-06-18',
    status: ExternalMcpConnectionStatus.REAUTH_REQUIRED,
    encryptedSessionId: 'encrypted:old-session',
    sessionFingerprint: 'fingerprint',
    serverName: 'sparkclaw-route-mcp',
    serverVersion: '1.0.0',
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
        externalMcp: { endpoint: 'http://192.168.20.252:18791/mcp' },
      },
    } as any,
    {} as any,
    {} as any,
    { listTools } as any
  );

  await t.throwsAsync(service.refresh(connection, 'user-1'), {
    message: /requires reauthentication/,
  });
  t.false(listTools.called);
});

test('connection service ignores persisted transport settings when refreshing tools', async t => {
  const configuredEndpoint = 'http://192.168.20.252:18791/mcp';
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
    serverName: 'sparkclaw-route-mcp',
    serverVersion: '1.0.0',
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
    tools: [],
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
    { listTools } as any
  );

  await service.refresh(connection, 'user-1');

  t.is(listTools.callCount, 1);
  t.is(listTools.firstCall.args[0].endpoint, configuredEndpoint);
  t.is(listTools.firstCall.args[0].protocolVersion, '2025-06-18');
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
