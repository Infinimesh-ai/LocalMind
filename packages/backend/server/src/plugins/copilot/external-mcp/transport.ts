import { Injectable } from '@nestjs/common';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const TOOL_CALL_TIMEOUT_MS = 25_000;
const EXPECTED_SERVER_NAME = 'sparkclaw-conversation-mcp';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
};

export class ExternalMcpTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number
  ) {
    super(message);
  }

  get requiresReauthentication() {
    return (
      this.status === 401 ||
      this.code === 'mcp_session_invalid' ||
      this.code === 'mcp_session_decrypt_failed'
    );
  }
}

@Injectable()
export class ExternalMcpTransport {
  async initialize(input: {
    endpoint: string;
    ticket: string;
    protocolVersion: string;
  }) {
    const response = await this.request(
      input.endpoint,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: input.protocolVersion,
          capabilities: {},
          clientInfo: { name: 'localmind', version: '1.0.0' },
        },
      },
      { authorization: `Bearer ${input.ticket}` }
    );
    if (!response.sessionId || response.sessionId.length > 4096) {
      throw new ExternalMcpTransportError(
        'mcp_session_missing',
        'SparkClaw did not issue an MCP session'
      );
    }
    const result = this.asObject(response.result);
    if (
      !result ||
      result.protocolVersion !== input.protocolVersion ||
      !this.asObject(result.serverInfo)
    ) {
      throw new ExternalMcpTransportError(
        'mcp_initialize_mismatch',
        'SparkClaw did not accept MCP protocol 2025-06-18'
      );
    }
    const serverInfo = this.parseServerInfo(result.serverInfo);
    if (serverInfo.name !== EXPECTED_SERVER_NAME) {
      throw new ExternalMcpTransportError(
        'mcp_server_mismatch',
        'The MCP endpoint did not identify itself as SparkClaw'
      );
    }
    return {
      sessionId: response.sessionId,
      protocolVersion: input.protocolVersion,
      serverInfo,
    };
  }

  async initialized(input: {
    endpoint: string;
    sessionId: string;
    protocolVersion: string;
  }) {
    const response = await this.request(
      input.endpoint,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { sessionId: input.sessionId, protocolVersion: input.protocolVersion }
    );
    return response.sessionId ?? input.sessionId;
  }

  async listTools(input: {
    endpoint: string;
    sessionId: string;
    protocolVersion: string;
  }) {
    const response = await this.request(
      input.endpoint,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { sessionId: input.sessionId, protocolVersion: input.protocolVersion }
    );
    const result = this.asObject(response.result);
    if (!Array.isArray(result?.tools)) {
      throw new ExternalMcpTransportError(
        'mcp_invalid_tool_catalog',
        'SparkClaw returned an invalid tool catalog'
      );
    }
    return {
      tools: result.tools,
      sessionId: response.sessionId ?? input.sessionId,
    };
  }

  async callTool(input: {
    endpoint: string;
    sessionId: string;
    protocolVersion: string;
    name: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
    requestId?: number;
    signal?: AbortSignal;
  }) {
    const response = await this.request(
      input.endpoint,
      {
        jsonrpc: '2.0',
        id: input.requestId ?? 3,
        method: 'tools/call',
        params: { name: input.name, arguments: input.arguments },
      },
      {
        sessionId: input.sessionId,
        protocolVersion: input.protocolVersion,
        idempotencyKey: input.idempotencyKey,
        timeoutMs: TOOL_CALL_TIMEOUT_MS,
        signal: input.signal,
      }
    );
    return {
      result: response.result,
      sessionId: response.sessionId ?? input.sessionId,
    };
  }

  private async request(
    endpoint: string,
    payload: JsonRpcRequest,
    options: {
      authorization?: string;
      sessionId?: string;
      protocolVersion?: string;
      idempotencyKey?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
    }
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': options.protocolVersion ?? '2025-06-18',
    };
    if (options.authorization) headers.Authorization = options.authorization;
    if (options.sessionId) headers['Mcp-Session-Id'] = options.sessionId;
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    let response: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(
        options.timeoutMs ?? REQUEST_TIMEOUT_MS
      );
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: options.signal
          ? AbortSignal.any([options.signal, timeoutSignal])
          : timeoutSignal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new ExternalMcpTransportError(
          'mcp_request_cancelled',
          'SparkClaw MCP request was cancelled'
        );
      }
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new ExternalMcpTransportError(
        timedOut ? 'mcp_request_timeout' : 'mcp_network_error',
        timedOut
          ? 'SparkClaw MCP request timed out'
          : 'SparkClaw MCP endpoint is unreachable'
      );
    }

    const sessionId = response.headers.get('Mcp-Session-Id')?.trim() || null;
    if (sessionId && sessionId.length > 4096) {
      throw new ExternalMcpTransportError(
        'mcp_session_invalid',
        'SparkClaw returned an invalid MCP session'
      );
    }
    if (response.status === 202) {
      return { result: null, sessionId };
    }

    const rawBody = await this.readBoundedBody(response);
    if (!response.ok) {
      throw new ExternalMcpTransportError(
        response.status === 401 ? 'mcp_session_invalid' : 'mcp_http_error',
        response.status === 401
          ? 'SparkClaw MCP session is invalid or expired'
          : `SparkClaw MCP returned HTTP ${response.status}`,
        response.status
      );
    }

    const contentType =
      response.headers.get('content-type')?.toLowerCase() ?? '';
    const body = contentType.includes('text/event-stream')
      ? this.parseEventStream(rawBody)
      : this.parseJson(rawBody);
    if (body.error) {
      const code =
        typeof body.error.code === 'number' ||
        typeof body.error.code === 'string'
          ? String(body.error.code).slice(0, 64)
          : 'unknown';
      throw new ExternalMcpTransportError(
        `mcp_rpc_${code}`,
        `SparkClaw returned an MCP protocol error (${code})`
      );
    }
    return { result: body.result, sessionId };
  }

  private async readBoundedBody(response: Response) {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ExternalMcpTransportError(
          'mcp_response_too_large',
          'SparkClaw MCP response exceeded the size limit'
        );
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
  }

  private parseEventStream(raw: string) {
    const events = raw.split(/\r?\n\r?\n/);
    const payloads = events
      .map(event =>
        event
          .split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n')
          .trim()
      )
      .filter(payload => payload && payload !== '[DONE]');
    if (!payloads.length) {
      throw new ExternalMcpTransportError(
        'mcp_invalid_response',
        'SparkClaw returned an empty event stream'
      );
    }
    return this.parseJson(payloads.at(-1) ?? '');
  }

  private parseJson(raw: string): JsonRpcResponse {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const value = this.asObject(parsed);
      if (!value) throw new Error('not an object');
      return value as JsonRpcResponse;
    } catch {
      throw new ExternalMcpTransportError(
        'mcp_invalid_response',
        'SparkClaw returned an invalid MCP response'
      );
    }
  }

  private parseServerInfo(value: unknown) {
    const serverInfo = this.asObject(value);
    return {
      name:
        typeof serverInfo?.name === 'string'
          ? serverInfo.name.trim().slice(0, 128)
          : null,
      version:
        typeof serverInfo?.version === 'string'
          ? serverInfo.version.trim().slice(0, 64)
          : null,
    };
  }

  private asObject(value: unknown): Record<string, any> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : null;
  }
}
