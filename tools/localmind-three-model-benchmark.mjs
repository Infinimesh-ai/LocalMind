import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const workspaceId = 'd2ae4ead-9686-4c24-ba35-1d7568dea1f7';
const userId = '0649e9cf-e242-434a-8b68-94276b655be6';
const endpoint = `http://localhost:3011/api/workspaces/${workspaceId}/mcp/`;
const configPath = '.docker/selfhost/data/localmind/config/config.json';
const outputPath =
  process.argv[2] ?? `/tmp/localmind-model-benchmark-${Date.now()}.json`;
const requestedModelKeys = new Set(
  (process.argv[3] ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const fallbackDocumentId =
  process.env.LOCALMIND_BENCH_FALLBACK_DOCUMENT_ID?.trim() || null;
const skipCreateAndSearch =
  process.env.LOCALMIND_BENCH_SKIP_CREATE_SEARCH === '1';
const containerName = 'localmind_affine_server';
const runId = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(0, 14);
const byokRouteIds = {
  gpt: '1ca6432a-56e2-486a-86c9-ebf11bc4099c',
  qwen: 'd6837633-8e6e-49ff-b53d-556f4ca96083',
  qwen35: 'd6837633-8e6e-49ff-b53d-556f4ca96083',
  qwen36: 'd6837633-8e6e-49ff-b53d-556f4ca96083',
  deepseek: 'aaff9a12-d09d-433b-ad32-b3c4b5e2e222',
};

const models = [
  {
    key: 'gpt',
    label: 'GPT-5.6 Sol',
    profile: 'lapi-gpt',
    model: 'gpt-5.6-sol',
  },
  {
    key: 'qwen',
    label: 'Qwen3.8 27B',
    profile: 'qwen-lan',
    model: 'qwen3.8-27b',
  },
  {
    key: 'qwen35',
    label: 'Qwen3.5 35B-A3B FP8',
    profile: 'qwen-lan',
    model: 'qwen3.5-35b-a3b',
  },
  {
    key: 'qwen36',
    label: 'Qwen3.6 35B-A3B FP8',
    profile: 'qwen-lan',
    model: 'qwen3.6-35b-a3b',
  },
  {
    key: 'deepseek',
    label: 'DeepSeek V4 Pro',
    profile: 'deepseek-api',
    model: 'deepseek-v4-pro',
  },
];
const modelsToRun = requestedModelKeys.size
  ? models.filter(candidate => requestedModelKeys.has(candidate.key))
  : models;

if (!modelsToRun.length) {
  throw new Error(
    `No matching models. Choose from: ${models.map(model => model.key).join(', ')}`
  );
}

const atlasPrompt = `请只根据下面的虚构记录作答，不要搜索工作区，也不要补充记录外事实。
项目“Atlas”状态：
- 8月12日支付模块压测通过，峰值980 TPS，目标1000 TPS。
- 8月13日安全评审发现退款接口缺少幂等键，负责人陈，计划8月19日修复。
- 8月14日法务说数据保留条款尚未签字；是否影响8月22日发布未确认。
- 客户试用反馈：7人中5人认为导入流程复杂，2人未完成导入。
严格输出：
1. 一句不超过55个汉字的结论；
2. Markdown表格，列为“风险｜证据｜优先级｜下一步”，仅3行；
3. 三个行动项，格式“- [负责人｜截止日] 动作”，未知信息写“待确认”。
不要写开场白或结尾。`;

const originalConfigText = readFileSync(configPath, 'utf8');
const baseConfig = JSON.parse(originalConfigText);
const credentialId = randomUUID();
const credentialSecret = randomBytes(32).toString('base64url');
const secretHash = createHash('sha256').update(credentialSecret).digest('hex');
const token = `aff_mcp_v1.${credentialId}.${credentialSecret}`;
let rpcId = 0;
let originalByokRouteState = [];

const results = {
  benchmark: 'localmind-model-delegate-v2',
  runId,
  startedAt: new Date().toISOString(),
  workspaceId,
  models: [],
};

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function psql(sql, { quiet = false } = {}) {
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
      '-F',
      '\t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : undefined }
  ).trim();
}

function issueCredential() {
  psql(
    `insert into mcp_credentials
      (id, family_id, generation, name, secret_hash, fingerprint, user_id,
       workspace_id, access_mode, expires_at, capabilities)
     values
      ('${credentialId}', '${credentialId}', 0,
       'Codex model benchmark ${runId}', '${secretHash}',
       '${secretHash.slice(0, 12)}', '${userId}', '${workspaceId}',
       'READ_WRITE', now() + interval '1 day',
       array['delegate_to_localmind','get_localmind_task','control_localmind_task']);`,
    { quiet: true }
  );
}

function revokeCredential() {
  psql(
    `update mcp_credentials set revoked_at = coalesce(revoked_at, now())
     where id = '${credentialId}';`,
    { quiet: true }
  );
}

function snapshotByokRoutes() {
  const ids = Object.values(byokRouteIds)
    .map(id => `'${id}'`)
    .join(',');
  const rows = psql(
    `select id, enabled, sort_order, coalesce(model_id, '')
       from ai_workspace_byok_configs
      where workspace_id = '${workspaceId}' and id in (${ids}) order by id;`,
    { quiet: true }
  );
  return rows
    .split('\n')
    .filter(Boolean)
    .map(row => {
      const [id, enabled, sortOrder, modelId] = row.split('\t');
      return {
        id,
        enabled: enabled === 't',
        sortOrder: Number(sortOrder),
        modelId: modelId || null,
      };
    });
}

function selectByokRoute(candidate) {
  const targetId = byokRouteIds[candidate.key];
  const ids = Object.values(byokRouteIds)
    .map(id => `'${id}'`)
    .join(',');
  psql(
    `update ai_workspace_byok_configs
        set enabled = (id = '${targetId}'),
            sort_order = case when id = '${targetId}' then 0 else sort_order + 10 end,
            model_id = case when id = '${targetId}' then '${candidate.model}' else model_id end,
            updated_at = now()
      where workspace_id = '${workspaceId}' and id in (${ids});`,
    { quiet: true }
  );
}

function restoreByokRoutes() {
  for (const row of originalByokRouteState) {
    psql(
      `update ai_workspace_byok_configs
          set enabled = ${row.enabled ? 'true' : 'false'},
              sort_order = ${row.sortOrder},
              model_id = ${row.modelId ? `'${row.modelId}'` : 'null'},
              updated_at = now()
        where workspace_id = '${workspaceId}' and id = '${row.id}';`,
      { quiet: true }
    );
  }
}

async function waitForDocumentEmbedding(documentId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = Number(
      psql(
        `select count(*) from ai_workspace_embeddings
          where workspace_id = '${workspaceId}' and doc_id = '${documentId}';`,
        { quiet: true }
      )
    );
    if (count > 0) return { indexed: true, chunks: count };
    await sleep(500);
  }
  return { indexed: false, chunks: 0 };
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://localhost:3011/');
      if (response.ok || response.status === 302) {
        await sleep(750);
        return;
      }
    } catch {}
    await sleep(750);
  }
  throw new Error('LocalMind did not become ready within 60 seconds');
}

async function activateModel(candidate) {
  selectByokRoute(candidate);
  const config = structuredClone(baseConfig);
  const profile = config.copilot.providers.profiles.find(
    item => item.id === candidate.profile
  );
  if (!profile) {
    throw new Error(`Provider profile not found: ${candidate.profile}`);
  }
  profile.displayName = candidate.label;
  profile.models = [candidate.model];
  profile.modelDefinitions = profile.modelDefinitions.map(
    (definition, index) =>
      index === 0
        ? {
            ...definition,
            id: candidate.model,
            rawModelId: candidate.model,
            displayName: candidate.label,
          }
        : definition
  );
  config.copilot.providers.defaults.text = candidate.profile;
  config.copilot.providers.defaults.structured = candidate.profile;
  config.copilot.providers.defaults.fallback = candidate.profile;
  config.copilot.prompts.defaults.text.model = `${candidate.profile}/${candidate.model}`;
  config.copilot.prompts.defaults.text.optionalModels = [
    ...config.copilot.prompts.defaults.text.optionalModels.filter(
      model => !model.startsWith(`${candidate.profile}/`)
    ),
    `${candidate.profile}/${candidate.model}`,
  ];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  execFileSync('docker', ['restart', containerName], { stdio: 'ignore' });
  await waitForServer();
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

async function mcpCall(name, args, timeoutMs = 180_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
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
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `MCP HTTP ${response.status}: ${responseText.slice(0, 300)}`
      );
    }
    return {
      value: extractToolValue(JSON.parse(responseText)),
      elapsedMs: roundMs(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function retryMcpCall(name, args, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await mcpCall(name, args);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError;
}

function compactView(view) {
  return {
    status: view.status,
    terminal: view.terminal,
    phase: view.phase,
    stateVersion: view.stateVersion,
    plan: view.plan,
    steps: view.steps,
    result: view.result,
    error: view.error,
    artifacts: view.artifacts,
    availableControls: view.availableControls,
  };
}

async function queryUntilTerminal(taskId, submittedAt) {
  const history = [];
  let query = await mcpCall('get_localmind_task', { taskId, waitMs: 0 });
  let view = query.value;
  history.push({
    atMs: roundMs(performance.now() - submittedAt),
    callMs: query.elapsedMs,
    status: view.status,
    changed: view.changed,
  });
  const deadline = Date.now() + 180_000;
  while (!view.terminal && Date.now() < deadline) {
    query = await mcpCall('get_localmind_task', {
      taskId,
      knownStateVersion: view.stateVersion,
      waitMs: 10_000,
    });
    view = query.value;
    history.push({
      atMs: roundMs(performance.now() - submittedAt),
      callMs: query.elapsedMs,
      status: view.status,
      changed: view.changed,
    });
  }
  if (!view.terminal) throw new Error(`Task ${taskId} did not finish`);
  return { view, history };
}

async function delegateCase(modelKey, name, request, documentIds = []) {
  const candidate = models.find(model => model.key === modelKey);
  if (!candidate) throw new Error(`Unknown benchmark model: ${modelKey}`);
  // Provider failures disable a server-BYOK row. Re-enable the intended route
  // before every independent case so one failure cannot change later coverage.
  selectByokRoute(candidate);
  const submittedAt = performance.now();
  const idempotencyKey = `${runId}-${modelKey}-${name}`;
  const submission = await mcpCall('delegate_to_localmind', {
    request,
    documentIds,
    idempotencyKey,
  });
  const terminal = await queryUntilTerminal(
    submission.value.taskId,
    submittedAt
  );
  return {
    name,
    idempotencyKey,
    taskId: submission.value.taskId,
    submitMs: submission.elapsedMs,
    totalMs: roundMs(performance.now() - submittedAt),
    submission: submission.value,
    task: compactView(terminal.view),
    queryHistory: terminal.history,
  };
}

function artifactDocumentId(testCase) {
  return testCase.task.artifacts?.find(artifact => artifact.kind === 'document')
    ?.reference?.documentId;
}

function atlasScore(answer) {
  if (typeof answer !== 'string') return { score: 0, max: 10 };
  const lines = answer
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const conclusion = lines[0] ?? '';
  const tableLines = lines.filter(line => line.startsWith('|'));
  const dataRows = tableLines.filter(
    line => !/^\|?\s*:?-+/.test(line) && !/风险\s*\|\s*证据/.test(line)
  );
  const actionLines = lines.filter(line =>
    /^- \[[^|｜]+[|｜][^\]]+\] .+/.test(line)
  );
  const evidenceTerms = ['980', '1000', '幂等', '8月19', '未签', '5人', '2人'];
  const evidenceHits = evidenceTerms.filter(term =>
    answer.includes(term)
  ).length;
  let score = 0;
  if (conclusion.length > 0 && conclusion.length <= 55) score += 1;
  if (/风险\s*[|｜]\s*证据\s*[|｜]\s*优先级\s*[|｜]\s*下一步/.test(answer))
    score += 1;
  if (dataRows.length === 3) score += 2;
  if (actionLines.length === 3) score += 2;
  score += Math.min(3, Math.floor((evidenceHits * 3) / evidenceTerms.length));
  if (!/^(以下|根据|结论[:：])/.test(conclusion)) score += 1;
  return {
    score,
    max: 10,
    checks: {
      conclusionChars: conclusion.length,
      tableDataRows: dataRows.length,
      actionLines: actionLines.length,
      evidenceHits,
    },
  };
}

function integrationScore(modelResult) {
  const creation = modelResult.cases.create_document;
  const search = modelResult.cases.search_document;
  const update = modelResult.cases.update_document;
  const verify = modelResult.cases.verify_update;
  const cancellation = modelResult.cases.cancel_task;
  const marker = modelResult.marker;
  const createTools = creation?.task?.result?.toolExecutions ?? [];
  const searchTools = search?.task?.result?.toolExecutions ?? [];
  const searchSummary = (search?.task?.result?.summary ?? '').trim();
  const searchedAndRead =
    search?.task?.status === 'completed' &&
    searchTools.some(
      tool => tool.toolName === 'doc_read' && tool.status === 'completed'
    ) &&
    searchSummary.includes(marker);
  const checks = {
    created:
      creation?.task?.status === 'completed' &&
      createTools.some(
        tool => tool.toolName === 'doc_create' && tool.status === 'completed'
      ) &&
      Boolean(artifactDocumentId(creation)),
    searchedAndRead,
    updatedAndVerified:
      update?.task?.status === 'completed' &&
      update?.task?.plan?.kind === 'document_update' &&
      (verify?.task?.result?.answer ?? '').includes(`UPDATED-${marker}`),
    cancelled:
      cancellation?.task?.status === 'cancelled' &&
      cancellation?.control?.value?.outcome !== 'not_cancellable' &&
      cancellation?.controlReplay?.value?.idempotentReplay === true,
  };
  const strictChecks = {
    ...checks,
    searchedAndRead: searchedAndRead && searchSummary === marker,
  };
  return {
    score: Object.values(checks).filter(Boolean).length * 2,
    strictScore: Object.values(strictChecks).filter(Boolean).length * 2,
    max: 8,
    checks,
    strictChecks,
  };
}

function usageSince(isoTimestamp) {
  const rows = psql(
    `select provider, provider_source, coalesce(model, ''), feature_kind,
            count(*), sum(prompt_tokens), sum(completion_tokens), sum(total_tokens)
       from ai_usage_events
      where workspace_id = '${workspaceId}'
        and user_id = '${userId}'
        and created_at >= '${isoTimestamp}'::timestamptz
      group by provider, provider_source, model, feature_kind
      order by model, feature_kind;`,
    { quiet: true }
  );
  if (!rows) return [];
  return rows.split('\n').map(row => {
    const [
      provider,
      providerSource,
      model,
      featureKind,
      count,
      prompt,
      completion,
      total,
    ] = row.split('\t');
    return {
      provider,
      providerSource,
      model,
      featureKind,
      count: Number(count),
      promptTokens: Number(prompt),
      completionTokens: Number(completion),
      totalTokens: Number(total),
    };
  });
}

function byokAttemptState(candidate) {
  const row = psql(
    `select enabled, coalesce(last_error_at::text, ''),
            coalesce(last_error, ''), coalesce(last_used_at::text, '')
       from ai_workspace_byok_configs
      where workspace_id = '${workspaceId}' and id = '${byokRouteIds[candidate.key]}';`,
    { quiet: true }
  );
  const [enabled, lastErrorAt, lastError, lastUsedAt] = row.split('\t');
  return {
    enabled: enabled === 't',
    lastErrorAt: lastErrorAt || null,
    lastError: lastError || null,
    lastUsedAt: lastUsedAt || null,
  };
}

async function runModel(candidate) {
  process.stdout.write(`\n[${candidate.label}] activating model...\n`);
  await activateModel(candidate);
  const modelStartedAt = new Date().toISOString();
  const marker = `${candidate.key.toUpperCase()}-${runId}`;
  const title = `LM-BENCH-${candidate.key.toUpperCase()}-${runId}`;
  const modelResult = {
    ...candidate,
    startedAt: modelStartedAt,
    marker,
    syntheticDocumentTitle: title,
    cases: {},
  };

  process.stdout.write(`[${candidate.label}] answer + idempotency...\n`);
  const answer = await delegateCase(candidate.key, 'answer_atlas', atlasPrompt);
  const replayStarted = performance.now();
  const replay = await mcpCall('delegate_to_localmind', {
    request: atlasPrompt,
    documentIds: [],
    idempotencyKey: answer.idempotencyKey,
  });
  answer.idempotentReplay = {
    elapsedMs: roundMs(performance.now() - replayStarted),
    sameTaskId: replay.value.taskId === answer.taskId,
    value: replay.value,
  };
  modelResult.cases.answer_atlas = answer;
  modelResult.routeEvidence = usageSince(modelStartedAt);
  const actualModels = [
    ...new Set(modelResult.routeEvidence.map(event => event.model)),
  ];
  modelResult.byokAttempt = byokAttemptState(candidate);
  const successfulTargetRoute =
    actualModels.length === 1 && actualModels[0] === candidate.model;
  const failedTargetRoute =
    answer.task.status === 'failed' &&
    modelResult.byokAttempt.lastErrorAt &&
    new Date(modelResult.byokAttempt.lastErrorAt) >= new Date(modelStartedAt);
  modelResult.routeVerified = Boolean(
    successfulTargetRoute || failedTargetRoute
  );
  modelResult.routeOutcome = successfulTargetRoute
    ? 'success'
    : failedTargetRoute
      ? 'provider_failure'
      : 'unverified';
  if (!modelResult.routeVerified) {
    throw new Error(
      `Route verification failed for ${candidate.label}: ${actualModels.join(', ') || 'no usage event'}`
    );
  }

  let documentId = fallbackDocumentId;
  if (skipCreateAndSearch) {
    modelResult.cases.create_document = {
      skipped: 'LOCALMIND_BENCH_SKIP_CREATE_SEARCH=1',
    };
    modelResult.cases.search_document = {
      skipped: 'LOCALMIND_BENCH_SKIP_CREATE_SEARCH=1',
    };
    modelResult.fallbackDocumentIdUsed = fallbackDocumentId;
  } else {
    process.stdout.write(`[${candidate.label}] document create...\n`);
    const creation = await delegateCase(
      candidate.key,
      'create_document',
      `在当前 LocalMind 工作区创建且只创建一个文档，标题必须是“${title}”。` +
        `正文必须完整写成以下 Markdown，不得增删或改写：\n\n# ${title}\n\nMarker: ${marker}\n\n状态：初始。`
    );
    modelResult.cases.create_document = creation;
    documentId = artifactDocumentId(creation) ?? fallbackDocumentId;

    if (documentId) {
      process.stdout.write(
        `[${candidate.label}] waiting for document embedding...\n`
      );
      modelResult.documentIndex = await waitForDocumentEmbedding(documentId);
    }

    if (!documentId || modelResult.documentIndex?.indexed !== false) {
      process.stdout.write(`[${candidate.label}] document search/read...\n`);
      modelResult.cases.search_document = await delegateCase(
        candidate.key,
        'search_document',
        `在当前工作区查找标题精确为“${title}”的文档并读取正文。` +
          `只返回其中 Marker 的完整值；必须实际使用工作区搜索/读取工具，不要猜测。`
      );
    } else {
      modelResult.cases.search_document = {
        skipped: 'document embedding did not finish within 120 seconds',
      };
    }
  }

  if (documentId) {
    process.stdout.write(`[${candidate.label}] document update + verify...\n`);
    modelResult.cases.update_document = await delegateCase(
      candidate.key,
      'update_document',
      `把唯一提供的文档完整替换为以下 Markdown，不得增删或改写：\n\n` +
        `# ${title}\n\nMarker: UPDATED-${marker}\n\n状态：已更新。`,
      [documentId]
    );
    modelResult.cases.verify_update = await delegateCase(
      candidate.key,
      'verify_update',
      '只根据唯一提供的文档快照，返回 Marker 的完整值，不要写其他文字。',
      [documentId]
    );
  } else {
    modelResult.cases.update_document = {
      skipped: 'create_document did not return an artifact',
    };
    modelResult.cases.verify_update = {
      skipped: 'create_document did not return an artifact',
    };
  }

  process.stdout.write(
    `[${candidate.label}] cancellation + control replay...\n`
  );
  selectByokRoute(candidate);
  const cancelSubmittedAt = performance.now();
  const cancelSubmission = await mcpCall('delegate_to_localmind', {
    request:
      `创建六个独立文档，标题依次为“${title}-CANCEL-1”到“${title}-CANCEL-6”，` +
      '每个文档写入至少500字的编号测试内容。必须逐个调用创建工具完成。',
    documentIds: [],
    idempotencyKey: `${runId}-${candidate.key}-cancel_task`,
  });
  const cancelArgs = {
    taskId: cancelSubmission.value.taskId,
    action: 'cancel',
    idempotencyKey: `${runId}-${candidate.key}-cancel-control`,
    reason: 'LocalMind model benchmark cancellation case',
  };
  const initialCancelView = await mcpCall('get_localmind_task', {
    taskId: cancelSubmission.value.taskId,
    waitMs: 0,
  });
  let control = null;
  let controlReplay = null;
  let controlError = null;
  try {
    control = await retryMcpCall('control_localmind_task', cancelArgs);
    controlReplay = await retryMcpCall('control_localmind_task', cancelArgs);
  } catch (error) {
    controlError = error instanceof Error ? error.message : String(error);
  }
  const cancelled = await queryUntilTerminal(
    cancelSubmission.value.taskId,
    cancelSubmittedAt
  );
  modelResult.cases.cancel_task = {
    name: 'cancel_task',
    taskId: cancelSubmission.value.taskId,
    submitMs: cancelSubmission.elapsedMs,
    initialTask: compactView(initialCancelView.value),
    control,
    controlReplay,
    controlError,
    totalMs: roundMs(performance.now() - cancelSubmittedAt),
    submission: cancelSubmission.value,
    task: compactView(cancelled.view),
    queryHistory: cancelled.history,
  };

  modelResult.quality = {
    atlas: atlasScore(answer.task.result?.answer),
    integration: integrationScore(modelResult),
  };
  modelResult.usage = usageSince(modelStartedAt);
  modelResult.finishedAt = new Date().toISOString();
  process.stdout.write(`[${candidate.label}] complete.\n`);
  return modelResult;
}

let credentialIssued = false;
try {
  originalByokRouteState = snapshotByokRoutes();
  issueCredential();
  credentialIssued = true;
  for (const candidate of modelsToRun) {
    try {
      results.models.push(await runModel(candidate));
    } catch (error) {
      results.models.push({
        ...candidate,
        failed: true,
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
      process.stderr.write(`[${candidate.label}] failed: ${error}\n`);
    }
    writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
  }
} finally {
  results.finishedAt = new Date().toISOString();
  try {
    restoreByokRoutes();
  } catch (error) {
    results.byokRestoreError =
      error instanceof Error ? error.message : String(error);
  }
  writeFileSync(configPath, originalConfigText);
  try {
    execFileSync('docker', ['restart', containerName], { stdio: 'ignore' });
    await waitForServer();
  } catch (error) {
    results.restoreError =
      error instanceof Error ? error.message : String(error);
  }
  if (credentialIssued) {
    try {
      revokeCredential();
    } catch (error) {
      results.credentialRevokeError =
        error instanceof Error ? error.message : String(error);
    }
  }
  writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
}

process.stdout.write(`\nBenchmark results: ${outputPath}\n`);
