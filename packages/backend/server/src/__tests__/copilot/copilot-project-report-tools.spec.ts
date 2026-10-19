import { createHash } from 'node:crypto';

import { parseProjectReportAiContext } from '@localmind/office';
import test from 'ava';
import Sinon from 'sinon';

import { LOCALMIND_DELEGATION_AI_TOOLS } from '../../plugins/copilot/agent-runtime-localmind-tool-agent-adapter';
import { COPILOT_CHAT_TOOL_CATEGORIES } from '../../plugins/copilot/providers/types';
import { CapabilityPolicyHost } from '../../plugins/copilot/runtime/hosts/capability-policy-host';
import { toolSideEffectType } from '../../plugins/copilot/runtime/tool-capability-snapshot';
import { canExposeInProjectSession } from '../../plugins/copilot/runtime/tool-runtime';
import { TurnOrchestrator } from '../../plugins/copilot/runtime/turn-orchestrator';
import {
  createProjectReportTools,
  projectReportPolicy,
  type ProjectReportToolBackend,
} from '../../plugins/copilot/tools/project-report';

const reportContext = parseProjectReportAiContext({
  version: 'localmind-project-report-ai-context/v1',
  projectId: 'project-1',
  reportId: 'report-1',
  revisionId: 'revision-1',
  reportVersion: 3,
  chapterIds: ['chapter-1'],
  nodeIds: [],
});

const document = {
  period: {
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-30T00:00:00.000Z',
    timeZone: 'Asia/Shanghai',
    weekStartsOn: 1,
  },
  audience: 'management',
  language: 'zh-Hans',
  cutoffAt: '2026-10-01T00:00:00.000Z',
  issues: [],
  sources: [
    { kind: 'document', status: 'parsed' },
    { kind: 'work_order', status: 'read' },
    { kind: 'document', status: 'failed' },
  ],
  chapters: [
    {
      id: 'chapter-1',
      title: '进展',
      hidden: false,
      locked: false,
      nodes: [{ id: 'node-1', type: 'paragraph', text: '完成'.repeat(200) }],
    },
    {
      id: 'chapter-2',
      title: '封面',
      hidden: true,
      locked: true,
      nodes: [{ id: 'node-2', type: 'heading', text: '标题', level: '1' }],
    },
  ],
};

function setup(context = reportContext) {
  const getMeta = Sinon.stub().resolves({
    userId: 'user-1',
    workspaceId: null,
    docId: null,
    selectedContextProjectId: 'project-1',
  });
  const assertMember = Sinon.stub().resolves();
  const backend = {
    enabled: () => true,
    list: Sinon.stub().resolves({
      items: [
        {
          id: 'report-1',
          title: '九月汇报',
          lifecycle: 'active',
          version: 3,
          updatedAt: new Date('2026-10-01T00:00:00.000Z'),
          latestFinalRevisionId: null,
        },
      ],
    }),
    read: Sinon.stub().resolves({
      report: {
        id: 'report-1',
        title: '九月汇报',
        lifecycle: 'active',
        version: 3,
      },
      revision: { id: 'revision-1', sequence: 2, kind: 'draft' },
      document,
    }),
    task: Sinon.stub().resolves({
      runId: 'run-0',
      status: 'completed',
      candidateRevisionId: 'candidate-1',
      phases: [],
    }),
    generate: Sinon.stub().resolves({
      reportId: 'report-1',
      runId: 'run-1',
      status: 'pending',
    }),
  };
  const tools = createProjectReportTools(
    {
      copilotSession: { getMeta },
      projectResource: { assertMember },
    } as never,
    backend as unknown as ProjectReportToolBackend,
    { user: 'user-1', session: 'session-1', billingUnitId: 'turn-1' },
    'project-1',
    context
  );
  return { tools, backend, getMeta, assertMember };
}

test('report tool category stays out of Workspace delegation snapshots', t => {
  t.true(COPILOT_CHAT_TOOL_CATEGORIES.includes('report'));
  t.false(
    (LOCALMIND_DELEGATION_AI_TOOLS as readonly string[]).includes('report')
  );
  t.deepEqual(
    [...LOCALMIND_DELEGATION_AI_TOOLS],
    COPILOT_CHAT_TOOL_CATEGORIES.filter(tool => tool !== 'report')
  );
});

test('report tools are native Project tools with classified side effects', t => {
  for (const name of ['project_report_list', 'project_report_read']) {
    t.true(canExposeInProjectSession(name, true));
    t.false(canExposeInProjectSession(name, false));
    t.is(toolSideEffectType(name), 'read');
  }
  for (const name of ['project_report_rewrite', 'project_report_refresh']) {
    t.true(canExposeInProjectSession(name, true));
    t.is(toolSideEffectType(name), 'project_write');
  }
});

test('project sessions merge report tools and pass a matching report context', async t => {
  const host = new CapabilityPolicyHost(
    { features: [] } as never,
    {} as never,
    {} as never,
    {
      getEffectiveModelSelectionScope: Sinon.stub().resolves({
        projectModelId: 'byok/model',
      }),
      resolveModelContextWindow: Sinon.stub().resolves(32_000),
    } as never
  );
  const session = {
    config: {
      sessionId: 'session-1',
      userId: 'user-1',
      workspaceId: null,
      selectedContextProjectId: 'project-1',
      promptConfig: { tools: ['webSearch'] },
    },
    model: 'byok/model',
  };
  const selected = await host.selectChat(session as never, {
    responseMode: 'text',
    reportContext,
  });
  t.deepEqual(selected.providerOptions.tools, [
    'webSearch',
    'blocker',
    'report',
  ]);
  t.deepEqual(selected.providerOptions.reportContext, reportContext);

  const otherProject = await host.selectChat(session as never, {
    responseMode: 'text',
    reportContext: { ...reportContext, projectId: 'project-2' },
  });
  t.false('reportContext' in otherProject.providerOptions);

  const workspace = await host.selectChat(
    {
      ...session,
      config: { ...session.config, workspaceId: 'workspace-1' },
    } as never,
    { responseMode: 'text', reportContext }
  );
  t.deepEqual(workspace.providerOptions.tools, ['webSearch']);
  t.false('reportContext' in workspace.providerOptions);
});

test('read tools return a bounded outline after re-authorizing the conversation', async t => {
  const { tools, backend, getMeta, assertMember } = setup();
  t.deepEqual(Object.keys(tools).sort(), [
    'project_report_list',
    'project_report_read',
    'project_report_refresh',
    'project_report_rewrite',
  ]);
  const listed = (await tools.project_report_list.execute?.({}, {})) as {
    reports: { reportId: string; open: boolean; updatedAt: string }[];
  };
  t.deepEqual(listed.reports[0], {
    reportId: 'report-1',
    title: '九月汇报',
    status: 'active',
    version: 3,
    updatedAt: '2026-10-01T00:00:00.000Z',
    periodStart: undefined,
    periodEnd: undefined,
    hasFinalRevision: false,
    open: true,
  });
  Sinon.assert.calledWithMatch(backend.list, {
    projectId: 'project-1',
    actorId: 'user-1',
    limit: 20,
  });

  const read = (await tools.project_report_read.execute?.({}, {})) as any;
  t.is(read.reportId, 'report-1');
  t.is(read.chapterCount, 2);
  t.deepEqual(
    read.chapters.map((chapter: any) => [
      chapter.id,
      chapter.hidden,
      chapter.locked,
    ]),
    [
      ['chapter-1', false, false],
      ['chapter-2', true, true],
    ]
  );
  t.true(read.chapters[0].nodes[0].text.length <= 160);
  t.deepEqual(read.sources, {
    count: 3,
    kinds: { document: 2, work_order: 1 },
    statuses: { parsed: 1, read: 1, failed: 1 },
    cutoffAt: document.cutoffAt,
  });
  t.deepEqual(read.revision, { id: 'revision-1', sequence: 2, kind: 'draft' });
  t.is(read.generation.candidateReady, true);
  t.deepEqual(read.selection, {
    chapterIds: ['chapter-1'],
    nodeIds: [],
    staleRevision: false,
  });
  t.is(getMeta.callCount, 2);
  t.is(assertMember.callCount, 2);

  getMeta.resolves({
    userId: 'user-1',
    workspaceId: null,
    docId: null,
    selectedContextProjectId: 'project-2',
  });
  await t.throwsAsync(
    tools.project_report_read.execute?.({}, {}) as Promise<unknown>,
    {
      message: /authorization changed/,
    }
  );
});

test('rewrite queues a scoped generate command with a stable request key and never claims application', async t => {
  const { tools, backend } = setup();
  const result = (await tools.project_report_rewrite.execute?.(
    { instruction: '更精炼' },
    { toolCallId: 'call-1' }
  )) as any;
  const requestKey = createHash('sha256')
    .update(JSON.stringify(['session-1', 'turn-1', 'call-1']))
    .digest('hex');
  Sinon.assert.calledOnceWithExactly(backend.generate, {
    projectId: 'project-1',
    actorId: 'user-1',
    reportId: 'report-1',
    requestKey,
    expectedVersion: 3,
    command: {
      operation: 'generate',
      mode: 'rewrite',
      revisionId: 'revision-1',
      instructions: '更精炼',
      chapterIds: ['chapter-1'],
      nodeIds: [],
    },
  });
  t.is(result.status, 'queued');
  t.false(result.applied);
  t.is(result.runId, 'run-1');
  t.deepEqual(result.scope.chapterTitles, ['进展']);

  await t.throwsAsync(
    tools.project_report_rewrite.execute?.(
      { chapter_ids: ['chapter-2'], instruction: 'x' },
      { toolCallId: 'call-2' }
    ) as Promise<unknown>,
    { message: /Locked chapters/ }
  );
  await t.throwsAsync(
    tools.project_report_rewrite.execute?.(
      { node_ids: ['missing'], instruction: 'x' },
      { toolCallId: 'call-3' }
    ) as Promise<unknown>,
    { message: /unavailable/ }
  );
  await t.throwsAsync(
    tools.project_report_rewrite.execute?.(
      { report_id: 'report-2', instruction: 'x' },
      { toolCallId: 'call-4' }
    ) as Promise<unknown>,
    { message: /open in the editor/ }
  );
  await t.throwsAsync(
    tools.project_report_rewrite.execute?.(
      { instruction: 'x' },
      {}
    ) as Promise<unknown>,
    { message: /stable tool call ID/ }
  );
  t.is(backend.generate.callCount, 1);
});

test('refresh queues a whole-report run and rewrite requires a selection', async t => {
  const { tools, backend } = setup({ ...reportContext, chapterIds: [] });
  await t.throwsAsync(
    tools.project_report_rewrite.execute?.(
      { instruction: 'x' },
      { toolCallId: 'call-1' }
    ) as Promise<unknown>,
    { message: /project_report_refresh/ }
  );
  const refreshed = (await tools.project_report_refresh.execute?.(
    { instruction: '' },
    { toolCallId: 'call-2' }
  )) as any;
  t.deepEqual(refreshed.scope, { wholeReport: true });
  t.deepEqual(backend.generate.firstCall.args[0].command, {
    operation: 'generate',
    mode: 'refresh',
    revisionId: 'revision-1',
    instructions: '',
  });
});

test('without a report context only read tools are exposed', t => {
  const tools = createProjectReportTools(
    {} as never,
    {} as never,
    { user: 'user-1', session: 'session-1' },
    'project-1'
  );
  t.deepEqual(Object.keys(tools).sort(), [
    'project_report_list',
    'project_report_read',
  ]);
  t.throws(
    () =>
      createProjectReportTools(
        {} as never,
        {} as never,
        { user: 'user-1', session: 'session-1', workspace: 'workspace-1' },
        'project-1'
      ),
    { message: /owned Project conversation/ }
  );
  t.throws(
    () =>
      createProjectReportTools(
        {} as never,
        {} as never,
        { user: 'user-1', session: 'session-1' },
        'project-2',
        reportContext
      ),
    { message: /another Project/ }
  );
});

test('report policy tells the model to read first and never claim application', t => {
  const policy = projectReportPolicy({
    context: reportContext,
    title: '九月汇报',
    revisionSequence: 2,
  });
  t.regex(policy, /project_report_read first/);
  t.regex(policy, /project_report_rewrite/);
  t.regex(policy, /Never claim the report was changed/);
  t.regex(policy, /不得编造数字/);
  t.regex(policy, /chapter-1/);
});

function orchestratorFor(
  metadata: Record<string, unknown>,
  projectId = 'project-1'
) {
  const session = {
    config: {
      sessionId: 'session-1',
      userId: 'user-1',
      workspaceId: null,
      selectedContextProjectId: projectId,
      scopeType: 'project',
    },
    finishAsync: Sinon.stub().resolves([
      { role: 'system', content: 'Base policy' },
      { role: 'user', content: '改写进展章节' },
    ]),
  };
  const selectChat = Sinon.stub().resolves({
    model: 'byok/model',
    contextWindow: 32_000,
    providerOptions: { tools: ['blocker', 'report'] },
  });
  const get = Sinon.stub().resolves({ id: 'report-1', title: '九月汇报' });
  const revision = Sinon.stub().resolves({ id: 'revision-1', sequence: 2 });
  const orchestrator = new TurnOrchestrator(
    {
      prepareTurn: Sinon.stub().resolves({
        latestTurn: {
          id: 'turn-1',
          conversationId: 'session-1',
          role: 'user',
          content: '改写进展章节',
          attachments: [],
          metadata,
          createdAt: new Date(),
        },
        session,
        params: {},
        messageId: 'message-1',
        quotaBackedRoutesAllowed: true,
      }),
      buildLatestTurnPromptParams: Sinon.stub().returns({}),
    } as never,
    { getOwnedBySessionId: Sinon.stub().resolves(null) } as never,
    {} as never,
    { selectChat } as never,
    {
      streamText: Sinon.stub().callsFake(async function* () {
        yield 'ok';
      }),
    } as never,
    {} as never,
    { persistTextResult: Sinon.stub().resolves() } as never,
    {} as never,
    { projectReport: { get, revision } } as never
  );
  return { orchestrator, selectChat, get, revision };
}

test('turns revalidate the report context and append the report policy', async t => {
  const { orchestrator, selectChat, get, revision } = orchestratorFor({
    reportContext,
  });
  const result = await orchestrator.streamText('user-1', 'session-1', {});
  for await (const _ of result.stream);
  Sinon.assert.calledOnceWithExactly(get, {
    projectId: 'project-1',
    actorId: 'user-1',
    reportId: 'report-1',
  });
  Sinon.assert.calledOnceWithExactly(revision, {
    projectId: 'project-1',
    actorId: 'user-1',
    reportId: 'report-1',
    revisionId: 'revision-1',
  });
  Sinon.assert.calledOnceWithMatch(selectChat, Sinon.match.any, {
    reportContext,
  });
  const system = result.finalMessage
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n');
  t.regex(system, /九月汇报/);
  t.regex(system, /project_report_read first/);
});

test('turns reject report contexts from another Project or malformed payloads', async t => {
  await t.throwsAsync(
    orchestratorFor({
      reportContext: { ...reportContext, projectId: 'project-2' },
    }).orchestrator.streamText('user-1', 'session-1', {}),
    { message: /another Project/ }
  );
  await t.throwsAsync(
    orchestratorFor({
      reportContext: { ...reportContext, extra: true },
    }).orchestrator.streamText('user-1', 'session-1', {}),
    { message: /Report context is invalid/ }
  );
});
