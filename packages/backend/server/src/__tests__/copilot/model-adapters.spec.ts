import test from 'ava';
import { z } from 'zod';

import { deduplicateLocalMindToolExecutions } from '../../plugins/copilot/agent-runtime-localmind-tool-agent-adapter';
import {
  applyQwen36PlannerPolicy,
  createModelRouteLock,
  createQwen36CompletionContract,
  modelAdapterCapabilityReleased,
  modelAdapterReleaseGatePassed,
  normalizeQwen36ExplicitAnswerFormat,
  normalizeQwen36ToolArguments,
  parseModelRouteLock,
  parseQwen36CompletionContract,
  preflightQwen36PlannerPolicy,
  QWEN36_FINAL_ANSWER_REPAIR_MAX_TOKENS,
  QWEN36_MODEL_ADAPTER_VERSION,
  qwen36CertificationChecklist,
  qwen36DeterministicSnapshotAnswer,
  qwen36DocumentReadEvidence,
  qwen36NeedsExplicitLineRepair,
  qwen36NeedsToolAnswerRepair,
  qwen36ProductionAttachmentRejection,
  qwen36ReadToolEvidence,
  qwen36SearchResultDocumentId,
  resolveModelAdapter,
  shouldUseQwen36DirectAnswer,
  verifyQwen36ToolCompletion,
} from '../../plugins/copilot/model-adapters';
import { createToolExecutionCallback } from '../../plugins/copilot/runtime/tool/bridge';
import { defineTool } from '../../plugins/copilot/tools/tool';

function toolRequest(callId: string, name: string) {
  return {
    callId,
    name,
    args: { docId: 'doc-1' },
  };
}

test('Qwen3.6 35B-A3B route resolves its dedicated adapter', t => {
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'local-qwen',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
  });

  const adapter = resolveModelAdapter(route);

  t.is(adapter.id, 'qwen36-35b-a3b');
  t.is(adapter.profile.contextWindow, 131_072);
  t.deepEqual(adapter.profile.evaluationToolCategories, [
    'docRead',
    'docCreate',
    'docUpdate',
    'docUpdateMeta',
    'docKeywordSearch',
    'docSemanticSearch',
    'workspaceOrganization',
  ]);
  t.deepEqual(adapter.profile.productionToolCategories, []);
  t.false(
    adapter.profile.capabilities.some(
      capability => capability.status === 'enabled'
    )
  );
  t.true(
    qwen36CertificationChecklist(adapter.profile.capabilities).every(
      item => !item.productionReleased
    )
  );
  t.false(modelAdapterCapabilityReleased(adapter, 'document.create'));
  t.like(
    adapter.profile.capabilities.find(
      capability => capability.id === 'attachment'
    ),
    {
      status: 'testing',
      releaseGate: { adapterVersion: QWEN36_MODEL_ADAPTER_VERSION },
    }
  );
});

test('LocalMind tool evidence keeps distinct calls when a provider reuses invocation IDs', t => {
  const executions = [
    {
      invocationId: 'call_0',
      toolName: 'workspace_folder_create',
      argsFingerprint: 'parent',
    },
    {
      invocationId: 'call_0',
      toolName: 'workspace_folder_create',
      argsFingerprint: 'child',
    },
    {
      invocationId: 'call_0',
      toolName: 'workspace_folder_create',
      argsFingerprint: 'child',
    },
  ];

  t.deepEqual(deduplicateLocalMindToolExecutions(executions), [
    executions[0],
    executions[1],
  ]);
});

test('model adapter production gate requires 20 flawless same-version runs', t => {
  const gate = {
    adapterVersion: QWEN36_MODEL_ADAPTER_VERSION,
    minimumRuns: 20,
    totalRuns: 20,
    successfulRuns: 20,
    falseSuccesses: 0,
    duplicateSideEffects: 0,
    crossModelFallbacks: 0,
  };

  t.true(modelAdapterReleaseGatePassed(gate, QWEN36_MODEL_ADAPTER_VERSION));
  t.false(
    modelAdapterReleaseGatePassed(
      { ...gate, totalRuns: 19 },
      QWEN36_MODEL_ADAPTER_VERSION
    )
  );
  t.false(
    modelAdapterReleaseGatePassed(
      { ...gate, successfulRuns: 19 },
      QWEN36_MODEL_ADAPTER_VERSION
    )
  );
  t.false(
    modelAdapterReleaseGatePassed(
      { ...gate, falseSuccesses: 1 },
      QWEN36_MODEL_ADAPTER_VERSION
    )
  );
  t.false(
    modelAdapterReleaseGatePassed({ ...gate, duplicateSideEffects: 1 }, '2')
  );
  t.false(
    modelAdapterReleaseGatePassed({ ...gate, crossModelFallbacks: 1 }, '2')
  );
  t.false(modelAdapterReleaseGatePassed(gate, '3'));
});

test('Qwen3.6 production attachments are limited to complete extracted text/plain', t => {
  t.is(
    qwen36ProductionAttachmentRejection([
      {
        attachmentId: 'attachment-1',
        mimeType: 'text/plain',
        extractedText: 'certified text',
      },
    ]),
    undefined
  );
  t.like(
    qwen36ProductionAttachmentRejection([
      {
        attachmentId: 'attachment-2',
        mimeType: 'application/pdf',
        extractedText: 'parsed text',
      },
    ]),
    { reason: 'mime_not_certified' }
  );
  t.like(
    qwen36ProductionAttachmentRejection([
      {
        attachmentId: 'attachment-3',
        mimeType: 'text/plain',
        suppliedToModel: true,
      },
    ]),
    { reason: 'provider_native_bytes_not_certified' }
  );
  t.like(
    qwen36ProductionAttachmentRejection([
      {
        attachmentId: 'attachment-4',
        mimeType: 'text/plain',
        extractedText: 'partial text',
        extractedTextTruncated: true,
      },
    ]),
    { reason: 'extracted_text_truncated' }
  );
});

for (const modelId of [
  'qwen3.5-35b-a3b',
  'qwen3.8-27b',
  'gpt-5.6-sol',
  'deepseek-v4',
]) {
  test(`model adapter registry leaves ${modelId} on passthrough`, t => {
    const adapter = resolveModelAdapter(
      createModelRouteLock({ providerId: 'provider-main', modelId })
    );

    t.is(adapter.id, 'passthrough');
  });
}

test('model route lock rejects persisted fingerprint tampering', t => {
  const route = createModelRouteLock({
    providerId: 'local-qwen',
    providerProfileId: 'qwen-profile',
    providerSource: 'configured',
    providerType: 'openaiCompatible',
    modelId: 'qwen3.6-35b-a3b',
    responseModelId: 'qwen3.6-35b-a3b-fp8',
    requestedModelId: 'qwen-action',
  });

  t.is(route.lockedModelId, 'local-qwen/qwen3.6-35b-a3b');
  t.deepEqual(parseModelRouteLock(route), route);
  for (const [field, value] of Object.entries({
    providerId: 'alternate-provider',
    providerProfileId: 'alternate-profile',
    providerSource: 'builtin',
    providerType: 'openai',
    modelId: 'gpt-5.6-sol',
    responseModelId: 'alternate-response-model',
    requestedModelId: 'alternate-requested-model',
    lockedModelId: 'local-qwen/alternate-model',
  })) {
    t.throws(() => parseModelRouteLock({ ...route, [field]: value }), {
      message: 'Persisted model route lock integrity check failed',
    });
  }
});

test('Qwen3.6 planner policy repairs supported workspace misclassification', t => {
  t.deepEqual(
    applyQwen36PlannerPolicy({
      request: 'Create a workspace document titled Weekly Plan.',
      requestedDocumentIds: [],
      plan: { kind: 'answer', answer: 'Created it.' },
    }),
    {
      kind: 'tool_agent',
      summary:
        'Use the available LocalMind document and workspace tools to complete the request.',
    }
  );
  t.deepEqual(
    applyQwen36PlannerPolicy({
      request: 'Create a document titled Weekly Plan.',
      requestedDocumentIds: [],
      plan: {
        kind: 'document_update',
        docId: 'Weekly Plan',
        content: '# Weekly Plan',
        summary: 'Create the plan',
      },
    }),
    {
      kind: 'tool_agent',
      summary:
        'Resolve the requested document or workspace target with tools, then perform the requested operation.',
    }
  );
  t.deepEqual(
    applyQwen36PlannerPolicy({
      request: 'Do not create a document. Explain what a document is.',
      requestedDocumentIds: [],
      plan: { kind: 'answer', answer: 'A document stores content.' },
    }),
    { kind: 'answer', answer: 'A document stores content.' }
  );
});

test('Qwen3.6 planner policy closes unavailable capabilities without false success', t => {
  const plan = applyQwen36PlannerPolicy({
    request: 'Create a whiteboard and add three shapes.',
    requestedDocumentIds: [],
    plan: { kind: 'answer', answer: 'Done.' },
  });

  t.is(plan.kind, 'unsupported_task');
  if (plan.kind === 'unsupported_task') {
    t.regex(plan.reason, /not bridged/i);
  }
  t.deepEqual(
    applyQwen36PlannerPolicy({
      request: 'Do not create a whiteboard. Explain what a whiteboard is.',
      requestedDocumentIds: [],
      plan: {
        kind: 'answer',
        answer: 'A whiteboard is a free-form visual canvas.',
      },
    }),
    {
      kind: 'answer',
      answer: 'A whiteboard is a free-form visual canvas.',
    }
  );
});

test('Qwen3.6 planner preflight routes verifiable work without a model plan', t => {
  const unavailable = preflightQwen36PlannerPolicy(
    '在白板中添加一个矩形，然后读取白板验证。'
  );

  t.is(unavailable?.kind, 'unsupported_task');
  if (unavailable?.kind === 'unsupported_task') {
    t.regex(unavailable.reason, /not bridged/i);
  }
  t.deepEqual(
    preflightQwen36PlannerPolicy('Create a workspace document titled Plan.'),
    {
      kind: 'tool_agent',
      summary:
        'Use the available LocalMind document and workspace tools to complete the request.',
    }
  );
  t.deepEqual(
    preflightQwen36PlannerPolicy(
      '在工作区搜索标题为不存在的文档，如果没有就只输出“未找到”。'
    ),
    {
      kind: 'tool_agent',
      summary:
        'Use the available LocalMind document and workspace tools to complete the request.',
    }
  );
  t.is(
    preflightQwen36PlannerPolicy(
      'Read the supplied attachment and return only its marker.'
    ),
    undefined
  );
});

test('Qwen3.6 planner policy closes workspace tasks beyond its tool budget', t => {
  const plan = applyQwen36PlannerPolicy({
    request: 'Create 17 workspace folders.',
    requestedDocumentIds: [],
    plan: { kind: 'answer', answer: 'Created all folders.' },
  });

  t.is(plan.kind, 'unsupported_task');
  if (plan.kind === 'unsupported_task') {
    t.regex(plan.reason, /tool execution limit/i);
  }
});

test('Qwen3.6 completion verifier requires tool and side-effect evidence', t => {
  const contract = createQwen36CompletionContract('Create a document.')!;
  t.deepEqual(
    verifyQwen36ToolCompletion({
      answer: 'Created.',
      contract,
      executions: [],
    }),
    {
      ok: false,
      code: 'missing_tool_evidence',
      reason: 'The tool task ended without executing any tool.',
    }
  );
  t.deepEqual(
    verifyQwen36ToolCompletion({
      answer: 'Created.',
      contract,
      executions: [
        {
          toolName: 'workspace_folder_create',
          status: 'completed',
          effectSatisfied: true,
          workspaceEffect: { operation: 'create_folder' },
        },
      ],
    }),
    {
      ok: false,
      code: 'missing_required_tool_evidence',
      reason:
        'Expected 1 distinct successful document.create tool execution(s), but only 0 were proven.',
    }
  );
  t.deepEqual(
    verifyQwen36ToolCompletion({
      answer: 'Created.',
      contract,
      executions: [
        {
          toolName: 'doc_create',
          status: 'completed',
          relation: 'created',
        },
      ],
    }),
    {
      ok: false,
      code: 'missing_required_effect_evidence',
      reason:
        'The document.create tool did not prove 1 distinct requested state effect(s).',
    }
  );
  t.deepEqual(
    verifyQwen36ToolCompletion({
      answer: 'The document already existed with the requested content.',
      contract,
      executions: [
        {
          toolName: 'doc_create',
          status: 'completed',
          effectSatisfied: true,
          relation: 'created',
        },
      ],
    }),
    { ok: true }
  );
});

test('Qwen3.6 completion contracts map supported actions to exact tools', t => {
  const cases: Array<[string, string[]]> = [
    ['Read the document.', ['document.read']],
    ['Create a document titled Plan.', ['document.create']],
    ['Update the document body.', ['document.update']],
    ['Rename the document title.', ['document.update_meta']],
    ['Search documents for launch notes.', ['document.search']],
    ['List workspace folders.', ['workspace.folder.list']],
    ['Create a folder named Projects.', ['workspace.folder.create']],
    ['Rename the folder to Archive.', ['workspace.folder.rename']],
    ['Move the folder into Projects.', ['workspace.folder.move']],
    ['Delete the folder Archive.', ['workspace.folder.delete']],
    [
      'Add the document to the Projects folder.',
      ['workspace.folder.add_document'],
    ],
    [
      'Move the document to the Projects folder.',
      ['workspace.folder.move_document'],
    ],
    [
      'Remove the document from all folders.',
      ['workspace.folder.remove_document'],
    ],
    ['移除文档的所有文件夹放置位置。', ['workspace.folder.remove_document']],
    [
      '新建文件夹项目，然后把文档移到该文件夹。',
      ['workspace.folder.create', 'workspace.folder.move_document'],
    ],
    [
      'Search and read the document. Do not create a document.',
      ['document.read', 'document.search'],
    ],
    [
      '先列出文件夹，再移动目标文件夹。不要创建新文件夹。',
      ['workspace.folder.list', 'workspace.folder.move'],
    ],
    ['Read the document without creating anything.', ['document.read']],
    ['Create a document but do not create a folder.', ['document.create']],
  ];

  for (const [request, expected] of cases) {
    const contract = createQwen36CompletionContract(request);
    t.deepEqual(
      contract?.requirements.map(requirement => requirement.id).sort(),
      [...expected].sort(),
      request
    );
  }
});

test('Qwen3.6 direct answers bypass structured planning only for read-only work', t => {
  t.true(
    shouldUseQwen36DirectAnswer('只输出单个数字：字符串AaAaa中大写A出现几次？')
  );
  t.true(
    shouldUseQwen36DirectAnswer(
      '将“P0:支付失败；P2:颜色偏差”输出为Markdown表格。'
    )
  );
  t.false(shouldUseQwen36DirectAnswer('搜索工作区并输出匹配文档。'));
  t.false(shouldUseQwen36DirectAnswer('创建文档并输出文档ID。'));
  t.false(
    shouldUseQwen36DirectAnswer(
      '不提供文档快照；直接使用文档读取工具读取ID为“doc-1”的文档，只返回Marker。'
    )
  );
  t.false(shouldUseQwen36DirectAnswer('列出工作区文件夹，只输出两行名称。'));
  t.true(
    qwen36NeedsToolAnswerRepair(
      '只返回Marker完整值，不要其他文字。',
      'Marker is VALUE-1.'
    )
  );
  t.true(qwen36NeedsToolAnswerRepair('只返回Marker完整值，不要其他文字。', ''));
});

test('Qwen3.6 answer adapter preserves explicit lines and metadata titles', t => {
  t.is(QWEN36_FINAL_ANSWER_REPAIR_MAX_TOKENS, 6_000);
  const request =
    '严格输出三行，依次是alpha、beta、gamma，不要空行或项目符号。';
  t.true(qwen36NeedsExplicitLineRepair(request, 'alpha beta gamma'));
  t.is(
    normalizeQwen36ExplicitAnswerFormat(request, 'alpha beta gamma'),
    'alpha\nbeta\ngamma'
  );
  t.is(
    qwen36DeterministicSnapshotAnswer(
      '只根据唯一提供的文档快照，输出文档标题，不要其他文字。',
      [{ title: 'Authoritative title' }]
    ),
    'Authoritative title'
  );
  t.is(
    qwen36DeterministicSnapshotAnswer('总结文档。', [
      { title: 'Authoritative title' },
    ]),
    undefined
  );
  t.deepEqual(
    qwen36DocumentReadEvidence({
      docId: 'doc-1',
      title: 'Current title',
      markdown: 'Marker: CURRENT-1',
      createdByUser: { id: 'private-user-id' },
    }),
    {
      docId: 'doc-1',
      title: 'Current title',
      markdown: 'Marker: CURRENT-1',
    }
  );
  t.is(qwen36DocumentReadEvidence({ docId: 'doc-1' }), undefined);
  t.deepEqual(qwen36ReadToolEvidence('workspace_folder_list', [{ id: 'f1' }]), {
    toolName: 'workspace_folder_list',
    result: '[{"id":"f1"}]',
  });
  t.is(qwen36ReadToolEvidence('doc_update', { success: true }), undefined);
});

test('Qwen3.6 search recovery uses all searches only when one document is proven', t => {
  const request = '搜索标题为“Unique target”的文档并读取。';
  t.is(
    qwen36SearchResultDocumentId(request, [
      { results: [{ docId: 'doc-1', title: 'Unique target' }] },
      { results: [] },
    ]),
    'doc-1'
  );
  t.is(
    qwen36SearchResultDocumentId(request, [
      { results: [{ doc_id: 'doc-1', title: 'Unique target' }] },
      { documents: [{ documentId: 'doc-2', title: 'Unique target' }] },
    ]),
    undefined
  );
  t.is(
    qwen36SearchResultDocumentId('搜索标题为 Unique target 的文档。', [
      { results: [{ docId: 'doc-1', title: 'Unique target' }] },
    ]),
    undefined
  );
});

test('Qwen3.6 completion contract captures every verifiable compound action', t => {
  const contract = createQwen36CompletionContract(
    'Summarize the supplied document, create 8.16 log, and write the summary into it.'
  );

  t.deepEqual(
    contract?.requirements.map(requirement => requirement.id),
    ['document.create', 'document.read']
  );
  t.deepEqual(
    createQwen36CompletionContract(
      'Summarize the attachment and create a LocalMind document.'
    )?.requirements.map(requirement => requirement.id),
    ['document.create']
  );
  t.is(
    createQwen36CompletionContract('Delete the document permanently.'),
    undefined
  );
  t.deepEqual(
    createQwen36CompletionContract(
      '搜索初始标识并读取命中的文档，再把其正文完整替换为新内容。'
    )?.requirements.map(requirement => requirement.id),
    ['document.read', 'document.search', 'document.update']
  );
  t.deepEqual(
    createQwen36CompletionContract(
      '先列出文件夹，移除文档ID“KW7gimozim6UHdUgmzl7m”的所有文件夹放置位置，但绝对不要删除文档本身或修改正文。'
    )?.requirements.map(requirement => requirement.id),
    ['workspace.folder.list', 'workspace.folder.remove_document']
  );
});

test('Qwen3.6 tool arguments normalize root folder sentinels', t => {
  t.deepEqual(
    normalizeQwen36ToolArguments('workspace_folder_create', {
      name: 'Projects',
      parent_folder_id: 'None',
    }),
    { name: 'Projects', parent_folder_id: null }
  );
  t.deepEqual(
    normalizeQwen36ToolArguments('workspace_folder_move', {
      folder_id: 'folder-1',
      parent_folder_id: 'root',
    }),
    { folder_id: 'folder-1', parent_folder_id: null }
  );
  t.deepEqual(
    normalizeQwen36ToolArguments('workspace_folder_create', {
      name: 'Projects',
      parent_folder_id: 'folder-1',
    }),
    { name: 'Projects', parent_folder_id: 'folder-1' }
  );
});

test('Qwen3.6 completion contract counts repeated and quantified actions', t => {
  const contract = createQwen36CompletionContract(
    'Create two folders, then create a document and create another document.'
  );

  t.deepEqual(
    contract?.requirements.map(requirement => [
      requirement.id,
      requirement.minimumExecutions,
    ]),
    [
      ['document.create', 2],
      ['workspace.folder.create', 2],
    ]
  );
  t.deepEqual(
    createQwen36CompletionContract('新建三个文件夹。')?.requirements.map(
      requirement => [requirement.id, requirement.minimumExecutions]
    ),
    [['workspace.folder.create', 3]]
  );
  t.deepEqual(
    createQwen36CompletionContract(
      'Add two documents to the Projects folder, then search for two documents.'
    )?.requirements.map(requirement => [
      requirement.id,
      requirement.minimumExecutions,
    ]),
    [
      ['document.search', 1],
      ['workspace.folder.add_document', 2],
    ]
  );
  t.is(createQwen36CompletionContract('Create 17 folders.'), undefined);
});

test('Qwen3.6 completion contract does not count enforcement wording twice', t => {
  const folder = createQwen36CompletionContract(
    '在工作区根目录创建文件夹“PARENT”，并在其中创建子文件夹“CHILD”。必须实际使用文件夹工具且只创建这两个文件夹。'
  );
  const search = createQwen36CompletionContract(
    '在工作区搜索标题精确为“ABSENT”的文档。必须实际搜索；如果不存在就只输出“未找到”。'
  );
  const oneDocument = createQwen36CompletionContract(
    '创建且只创建一个文档，标题精确为“PLAN”。'
  );

  t.deepEqual(
    folder?.requirements.map(requirement => [
      requirement.id,
      requirement.minimumExecutions,
    ]),
    [['workspace.folder.create', 2]]
  );
  t.deepEqual(
    search?.requirements.map(requirement => [
      requirement.id,
      requirement.minimumExecutions,
    ]),
    [['document.search', 1]]
  );
  t.deepEqual(
    oneDocument?.requirements.map(requirement => [
      requirement.id,
      requirement.minimumExecutions,
    ]),
    [['document.create', 1]]
  );
});

test('Qwen3.6 completion verifier requires distinct evidence for action counts', t => {
  const contract = createQwen36CompletionContract('Create two folders.')!;
  const execution = {
    argsFingerprint: 'same-folder-arguments',
    toolName: 'workspace_folder_create',
    status: 'completed' as const,
    effectSatisfied: true,
    workspaceEffect: { operation: 'create_folder' as const },
  };

  t.like(
    verifyQwen36ToolCompletion({
      answer: 'Created two folders.',
      contract,
      executions: [execution, execution],
    }),
    {
      ok: false,
      code: 'missing_required_tool_evidence',
    }
  );
  t.deepEqual(
    verifyQwen36ToolCompletion({
      answer: 'Created two folders.',
      contract,
      executions: [
        execution,
        { ...execution, argsFingerprint: 'other-folder-arguments' },
      ],
    }),
    { ok: true }
  );
});

test('Qwen3.6 completion contract rejects persisted tampering', t => {
  const contract = createQwen36CompletionContract('Create a document.')!;

  t.deepEqual(parseQwen36CompletionContract(contract), contract);
  t.throws(
    () =>
      parseQwen36CompletionContract({
        ...contract,
        requirements: [
          {
            ...contract.requirements[0],
            toolNames: ['workspace_folder_create'],
          },
        ],
      }),
    {
      message: 'Persisted Qwen3.6 completion contract integrity check failed',
    }
  );
});

test('Qwen3.6 tool governor reuses successes and fuses repeated failures', async t => {
  let successfulExecutions = 0;
  let failedExecutions = 0;
  const tools = {
    doc_read: defineTool({
      inputSchema: z.object({ docId: z.string() }),
      execute: () => {
        successfulExecutions += 1;
        return { success: true, content: 'body' };
      },
    }),
    doc_update: defineTool({
      inputSchema: z.object({ docId: z.string() }),
      execute: () => {
        failedExecutions += 1;
        throw new Error('update failed');
      },
    }),
  };
  const policy = resolveModelAdapter(
    createModelRouteLock({
      providerId: 'local-qwen',
      modelId: 'qwen3.6-35b-a3b',
    })
  ).toolPolicy!;
  const execute = createToolExecutionCallback(tools, {}, policy);

  const first = await execute(toolRequest('read-1', 'doc_read'));
  const replay = await execute(toolRequest('read-2', 'doc_read'));
  t.false(first.isError ?? false);
  t.false(replay.isError ?? false);
  t.true((replay.output as any).governorReplay);
  t.is(successfulExecutions, 1);

  await execute(toolRequest('update-1', 'doc_update'));
  await execute(toolRequest('update-2', 'doc_update'));
  const fused = await execute(toolRequest('update-3', 'doc_update'));
  t.true(fused.isError ?? false);
  t.regex(String((fused.output as any).message), /failed repeatedly/i);
  t.is(failedExecutions, 2);
});

test('Qwen3.6 tool governor invalidates cached reads after a write', async t => {
  let reads = 0;
  let writes = 0;
  const tools = {
    doc_read: defineTool({
      inputSchema: z.object({ docId: z.string() }),
      execute: () => ({ success: true, revision: ++reads }),
    }),
    doc_update: defineTool({
      inputSchema: z.object({ docId: z.string() }),
      execute: () => ({ success: true, revision: ++writes }),
    }),
  };
  const policy = resolveModelAdapter(
    createModelRouteLock({
      providerId: 'local-qwen',
      modelId: 'qwen3.6-35b-a3b',
    })
  ).toolPolicy!;
  const execute = createToolExecutionCallback(tools, {}, policy);

  await execute(toolRequest('read-1', 'doc_read'));
  await execute(toolRequest('read-2', 'doc_read'));
  await execute(toolRequest('write-1', 'doc_update'));
  const writeReplay = await execute(toolRequest('write-2', 'doc_update'));
  await execute(toolRequest('read-3', 'doc_read'));

  t.like(writeReplay.output as object, {
    governorReplay: true,
    idempotentReplay: true,
  });
  t.is(reads, 2);
  t.is(writes, 1);
});

test('Qwen3.6 tool governor requires reading the same document before update', async t => {
  let reads = 0;
  let writes = 0;
  const tools = {
    doc_read: defineTool({
      inputSchema: z.object({ doc_id: z.string() }),
      execute: () => ({ success: true, revision: ++reads }),
    }),
    doc_update: defineTool({
      inputSchema: z.object({ doc_id: z.string() }),
      execute: () => ({ success: true, revision: ++writes }),
    }),
  };
  const policy = resolveModelAdapter(
    createModelRouteLock({
      providerId: 'local-qwen',
      modelId: 'qwen3.6-35b-a3b',
    })
  ).toolPolicy!;
  const execute = createToolExecutionCallback(tools, {}, policy);
  const request = (callId: string, name: string, docId: string) => ({
    callId,
    name,
    args: { doc_id: docId },
  });

  const beforeRead = await execute(request('update-1', 'doc_update', 'doc-1'));
  await execute(request('read-other', 'doc_read', 'doc-2'));
  const wrongRead = await execute(request('update-2', 'doc_update', 'doc-1'));
  await execute(request('read-target', 'doc_read', 'doc-1'));
  const afterRead = await execute(request('update-3', 'doc_update', 'doc-1'));

  t.true(beforeRead.isError ?? false);
  t.true(wrongRead.isError ?? false);
  t.regex(String((beforeRead.output as any).message), /doc_read/i);
  t.false(afterRead.isError ?? false);
  t.is(reads, 2);
  t.is(writes, 1);
});

test('Qwen3.6 tool governor keeps mutation deduplication across other writes', async t => {
  let writes = 0;
  const tools = {
    doc_read: defineTool({
      inputSchema: z.object({ docId: z.string() }),
      execute: () => ({ success: true }),
    }),
    doc_update: defineTool({
      inputSchema: z.object({ docId: z.string() }),
      execute: () => ({ success: true, revision: ++writes }),
    }),
  };
  const policy = resolveModelAdapter(
    createModelRouteLock({
      providerId: 'local-qwen',
      modelId: 'qwen3.6-35b-a3b',
    })
  ).toolPolicy!;
  const execute = createToolExecutionCallback(tools, {}, policy);
  const request = (callId: string, docId: string) => ({
    callId,
    name: 'doc_update',
    args: { docId },
  });

  await execute({
    callId: 'read-a',
    name: 'doc_read',
    args: { docId: 'doc-a' },
  });
  await execute(request('update-a-1', 'doc-a'));
  await execute({
    callId: 'read-b',
    name: 'doc_read',
    args: { docId: 'doc-b' },
  });
  await execute(request('update-b-1', 'doc-b'));
  const replayA = await execute(request('update-a-2', 'doc-a'));

  t.like(replayA.output as object, {
    governorReplay: true,
    idempotentReplay: true,
  });
  t.is(writes, 2);
});

test('Qwen3.6 tool governor treats returned tool errors as failures', async t => {
  let executions = 0;
  const tools = {
    doc_read: defineTool({
      inputSchema: z.object({ docId: z.string() }),
      execute: () => {
        executions += 1;
        return {
          type: 'error' as const,
          name: 'Doc Read Failed',
          message: 'Document is unavailable',
        };
      },
    }),
  };
  const policy = resolveModelAdapter(
    createModelRouteLock({
      providerId: 'local-qwen',
      modelId: 'qwen3.6-35b-a3b',
    })
  ).toolPolicy!;
  const execute = createToolExecutionCallback(tools, {}, policy);
  const request = (callId: string) => ({
    callId,
    name: 'doc_read',
    args: { docId: 'missing-doc' },
  });

  const first = await execute(request('read-1'));
  const second = await execute(request('read-2'));
  const fused = await execute(request('read-3'));

  t.true(first.isError ?? false);
  t.true(second.isError ?? false);
  t.true(fused.isError ?? false);
  t.regex(String((fused.output as any).message), /failed repeatedly/i);
  t.is(executions, 2);
});
