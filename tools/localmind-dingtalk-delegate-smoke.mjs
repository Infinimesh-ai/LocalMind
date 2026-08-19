import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const workspaceId =
  process.env.LOCALMIND_WORKSPACE_ID ?? 'd2ae4ead-9686-4c24-ba35-1d7568dea1f7';
const userId =
  process.env.LOCALMIND_USER_ID ?? '0649e9cf-e242-434a-8b68-94276b655be6';
const provider = (
  process.env.LOCALMIND_ENTERPRISE_PROVIDER ?? 'dingtalk'
).toLowerCase();
const connectionId =
  process.env.LOCALMIND_ENTERPRISE_CONNECTION_ID ??
  process.env.LOCALMIND_DINGTALK_CONNECTION_ID ??
  '4e49b773-c495-47ee-b670-99ff3e596140';
const endpoint =
  process.env.LOCALMIND_MCP_ENDPOINT ??
  `http://localhost:3011/api/workspaces/${workspaceId}/mcp/`;
const request =
  process.env.LOCALMIND_DINGTALK_REQUEST ??
  '请通过已连接的钉钉查询我今天的日程。必须调用钉钉工具获取实时结果，不要根据常识猜测。';
const expectProviderExecution =
  (process.env.LOCALMIND_ENTERPRISE_EXPECT_EXECUTION ??
    process.env.LOCALMIND_DINGTALK_EXPECT_EXECUTION) !== '0';
const credentialId = randomUUID();
const credentialSecret = randomBytes(32).toString('base64url');
const secretHash = createHash('sha256').update(credentialSecret).digest('hex');
const token = `aff_mcp_v1.${credentialId}.${credentialSecret}`;
const idempotencyKey = `${provider}-smoke-${randomUUID()}`;
const startedAt = new Date();
let rpcId = 0;

function psql(sql) {
  return execFileSync(
    'docker',
    [
      'exec',
      'localmind_affine_postgres',
      'psql',
      '-U',
      'affine',
      '-d',
      'affine',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
}

function issueCredential() {
  psql(`insert into mcp_credentials
    (id, family_id, generation, name, secret_hash, fingerprint, user_id,
     workspace_id, access_mode, expires_at, capabilities)
   values
    ('${credentialId}', '${credentialId}', 0, '${provider} delegate smoke test',
     '${secretHash}', '${secretHash.slice(0, 12)}', '${userId}',
     '${workspaceId}', 'READ_WRITE', now() + interval '1 day',
     array['delegate_to_localmind','get_localmind_task']);`);
}

function revokeCredential() {
  psql(`update mcp_credentials
    set revoked_at = coalesce(revoked_at, now())
    where id = '${credentialId}';`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractToolValue(body) {
  if (body.error) {
    throw new Error(`MCP ${body.error.code}: ${body.error.message}`);
  }
  const structured = body.result?.structuredContent?.result;
  if (structured && typeof structured === 'object') return structured;
  const text = body.result?.content?.find(item => item.type === 'text')?.text;
  if (!text) throw new Error('MCP response did not contain a result');
  return JSON.parse(text);
}

async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method,
      ...(params ? { params } : {}),
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  return JSON.parse(raw);
}

async function callTool(name, args) {
  return extractToolValue(await rpc('tools/call', { name, arguments: args }));
}

async function waitForTerminal(taskId) {
  const deadline = Date.now() + 6 * 60 * 1000;
  let task = await callTool('get_localmind_task', { taskId, waitMs: 0 });
  while (!task.terminal && Date.now() < deadline) {
    task = await callTool('get_localmind_task', {
      taskId,
      knownStateVersion: task.stateVersion,
      waitMs: 10_000,
    });
  }
  if (!task.terminal) throw new Error(`Task ${taskId} did not finish`);
  return task;
}

function auditEvents() {
  const raw = psql(`select coalesce(json_agg(row_to_json(events)), '[]'::json)
    from (
      select event_type as "eventType", status, tool_name as "toolName",
             created_at as "createdAt"
      from ai_enterprise_audit_events
      where connection_id = '${connectionId}'
        and actor_id = '${userId}'
        and created_at >= '${startedAt.toISOString()}'
      order by created_at
    ) events;`);
  return JSON.parse(raw || '[]');
}

issueCredential();
try {
  const initialized = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: {
      name: `localmind-${provider}-smoke`,
      version: '1.0.0',
    },
  });
  const tools = await rpc('tools/list');
  const submission = await callTool('delegate_to_localmind', {
    request,
    documentIds: [],
    idempotencyKey,
  });
  const task = await waitForTerminal(submission.taskId);
  await sleep(500);
  const audit = auditEvents();
  const providerSucceeded = audit.some(
    event =>
      event.eventType === 'tool_succeeded' &&
      event.toolName?.startsWith(`${provider}_`)
  );
  const report = {
    endpoint,
    initializedServer: initialized.result?.serverInfo,
    exposedTools: tools.result?.tools?.map(tool => tool.name) ?? [],
    taskId: submission.taskId,
    taskStatus: task.status,
    taskResult: task.result,
    provider,
    enterpriseAudit: audit,
    passed:
      task.status === 'completed' &&
      (expectProviderExecution
        ? providerSucceeded
        : task.result?.toolExecutions?.some(
            execution =>
              execution.toolName === 'enterprise_cli_search' &&
              execution.status === 'completed'
          )),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  revokeCredential();
}
