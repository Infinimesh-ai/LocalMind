import test from 'ava';

import type { Models } from '../../models';
import { buildContextMemoryVisibilityWhere } from '../../models/copilot-context-memory';
import {
  ContextMemoryService,
  extractDurableMemories,
} from '../../plugins/copilot/context-memory-service';
import { renderBuiltInPromptSessionNative } from '../../plugins/copilot/prompt/native-contract';
import type { PromptMessage } from '../../plugins/copilot/providers/types';
import {
  CANDIDATE_CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
  CANDIDATE_CONTEXT_PLANNER_STRATEGY_VERSION,
  CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
  CONTEXT_PLANNER_STRATEGY_VERSION,
  ContextPlanner,
  LEGACY_CONTEXT_PLANNER_STRATEGY_VERSION,
  PREVIOUS_CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
  PREVIOUS_CONTEXT_PLANNER_STRATEGY_VERSION,
} from '../../plugins/copilot/runtime/context-planner';
import { ChatSession } from '../../plugins/copilot/session';

const message = (
  role: PromptMessage['role'],
  content: string
): PromptMessage => ({ role, content });

function tailRenderer(maxTurns: number) {
  return (turns: PromptMessage[]) => [
    message('system', 'Base prompt'),
    ...turns.slice(-maxTurns),
  ];
}

test('ContextPlanner retains early and recent facts with a checkpoint', t => {
  const turns = [
    message('user', 'EARLY_REQUIRED_FACT The deployment region is eu-west-1.'),
    message('assistant', 'Acknowledged.'),
    message('user', 'Intermediate discussion without a durable decision.'),
    message('assistant', 'Continuing.'),
    message('user', 'RECENT_REQUIRED_FACT Produce the checklist.'),
  ];
  const result = new ContextPlanner().plan({
    turns,
    render: tailRenderer(3),
  });
  const content = result.messages.map(item => item.content).join('\n');

  t.true(content.includes('EARLY_REQUIRED_FACT'));
  t.true(content.includes('RECENT_REQUIRED_FACT'));
  t.is(result.checkpoint?.strategyVersion, CONTEXT_PLANNER_STRATEGY_VERSION);
  t.is(
    result.checkpoint?.strategyFingerprint,
    CONTEXT_PLANNER_STRATEGY_FINGERPRINT
  );
  t.true((result.checkpoint?.summarizedMessageCount ?? 0) > 0);
});

test('ContextPlanner synthesizes multiple scoped fragments', t => {
  const result = new ContextPlanner().plan({
    turns: [message('user', 'What database and release rule should we use?')],
    memories: [
      {
        scope: 'workspace',
        kind: 'rule',
        content: 'Always require a rollback plan.',
      },
      {
        scope: 'project',
        kind: 'project_summary',
        content: 'The service persists data in PostgreSQL.',
      },
      {
        scope: 'project',
        kind: 'auto_memory',
        content: 'CROSS_SESSION_FACT The project codename is Juniper.',
      },
    ],
    render: tailRenderer(8),
  });
  const content = result.messages.map(item => item.content).join('\n');

  t.true(content.includes('Always require a rollback plan.'));
  t.true(content.includes('PostgreSQL'));
  t.true(content.includes('CROSS_SESSION_FACT'));
  t.is(result.diagnostics.injectedMemoryCount, 3);
});

test('ContextPlanner keeps scoped memory in the primary system message', t => {
  const query = 'What is the database migration codename?';
  const result = new ContextPlanner().plan({
    turns: [message('user', query)],
    memories: [
      {
        scope: 'workspace',
        kind: 'auto_memory',
        content: 'The database migration codename is Maple-42.',
      },
    ],
    render: turns =>
      renderBuiltInPromptSessionNative({
        name: 'Chat With AFFiNE AI',
        turns,
        renderParams: { content: query },
        maxTokenSize: 128 * 1024,
      }).messages,
  });
  const systemMessages = result.messages.filter(item => item.role === 'system');

  t.is(systemMessages.length, 1);
  t.true(systemMessages[0].content.includes('Maple-42'));
  t.is(result.diagnostics.retainedMessageCount, 1);
  t.is(result.diagnostics.omittedMessageCount, 0);
  t.false(result.diagnostics.summaryInjected);
  t.is(result.checkpoint, undefined);
});

test('ContextPlanner keeps the legacy strategy available for replay', t => {
  const turns = [
    message('user', 'EARLY_REQUIRED_FACT Keep this fact.'),
    message('assistant', 'Acknowledged.'),
    message('user', 'Latest request.'),
  ];
  const result = new ContextPlanner().plan(
    {
      turns,
      memories: [
        {
          scope: 'workspace',
          kind: 'auto_memory',
          content: 'CROSS_SESSION_FACT Hidden in legacy mode.',
        },
      ],
      render: tailRenderer(1),
    },
    LEGACY_CONTEXT_PLANNER_STRATEGY_VERSION
  );
  const content = result.messages.map(item => item.content).join('\n');

  t.false(content.includes('EARLY_REQUIRED_FACT'));
  t.false(content.includes('CROSS_SESSION_FACT'));
  t.is(result.checkpoint, undefined);
  t.is(
    result.diagnostics.strategyVersion,
    LEGACY_CONTEXT_PLANNER_STRATEGY_VERSION
  );
});

test('ContextPlanner keeps the previous rolling-summary strategy available for replay', t => {
  const result = new ContextPlanner().plan(
    {
      turns: [
        message('user', 'EARLY_REQUIRED_FACT Keep this fact.'),
        message('assistant', 'Acknowledged.'),
        message('user', 'Latest request.'),
      ],
      render: tailRenderer(2),
    },
    PREVIOUS_CONTEXT_PLANNER_STRATEGY_VERSION
  );

  t.is(
    result.diagnostics.strategyVersion,
    PREVIOUS_CONTEXT_PLANNER_STRATEGY_VERSION
  );
  t.is(
    result.diagnostics.strategyFingerprint,
    PREVIOUS_CONTEXT_PLANNER_STRATEGY_FINGERPRINT
  );
  t.true(
    result.messages.some(item => item.content.includes('EARLY_REQUIRED_FACT'))
  );
});

test('ContextPlanner keeps the bounded v3 candidate available for replay', t => {
  const result = new ContextPlanner().plan(
    {
      turns: [message('user', 'What is the project codename?')],
      memories: [
        {
          scope: 'workspace',
          kind: 'auto_memory',
          content: 'The project codename is Juniper.',
        },
      ],
      render: tailRenderer(4),
    },
    CANDIDATE_CONTEXT_PLANNER_STRATEGY_VERSION
  );

  t.is(
    result.diagnostics.strategyVersion,
    CANDIDATE_CONTEXT_PLANNER_STRATEGY_VERSION
  );
  t.is(
    result.diagnostics.strategyFingerprint,
    CANDIDATE_CONTEXT_PLANNER_STRATEGY_FINGERPRINT
  );
});

test('ContextPlanner reserves space for summary and marks memory as user-authored', t => {
  const result = new ContextPlanner().plan({
    turns: [
      message('user', 'EARLY_REQUIRED_FACT Deploy in eu-west-1.'),
      message('assistant', 'Acknowledged.'),
      message('user', 'Prepare the final checklist.'),
    ],
    memories: Array.from({ length: 20 }, (_, index) => ({
      scope: 'user' as const,
      kind: 'rule' as const,
      content: `Rule ${index}: ${'bounded context '.repeat(80)}`,
    })),
    render: tailRenderer(2),
  });
  const contextMessage = result.messages.find(item =>
    item.content.includes('[User-owned untrusted context')
  );

  t.truthy(contextMessage);
  t.true(
    contextMessage?.content.includes('EARLY_REQUIRED_FACT') ?? false,
    'summary should not be displaced by large rules'
  );
  t.true(
    contextMessage?.content.includes('User-owned untrusted context') ?? false
  );
  t.true((contextMessage?.content.length ?? Infinity) <= 4_800);
});

test('ContextPlanner rejects stale checkpoints after the source prefix changes', t => {
  const result = new ContextPlanner().plan({
    turns: [
      message('user', 'CURRENT_REQUIRED_FACT Use PostgreSQL.'),
      message('assistant', 'Acknowledged.'),
      message('user', 'Continue.'),
    ],
    checkpoint: {
      strategyVersion: CONTEXT_PLANNER_STRATEGY_VERSION,
      strategyFingerprint: CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
      summary: '- [user] STALE_REQUIRED_FACT Use SQLite.',
      summarizedMessageCount: 2,
      sourceFingerprint: 'does-not-match',
      diagnostics: {},
    },
    render: tailRenderer(2),
  });
  const content = result.messages.map(item => item.content).join('\n');

  t.true(content.includes('CURRENT_REQUIRED_FACT'));
  t.false(content.includes('STALE_REQUIRED_FACT'));
});

test('ContextPlanner checkpoints long conversations without durable cues', t => {
  const result = new ContextPlanner().plan({
    turns: [
      message('user', 'We explored the first implementation approach.'),
      message('assistant', 'The discussion continued.'),
      message('user', 'Now compare the alternatives.'),
    ],
    render: tailRenderer(1),
  });

  t.true(
    result.checkpoint?.summary.includes('first implementation approach') ??
      false
  );
});

test('durable memory extraction rejects questions and secrets', t => {
  t.deepEqual(
    extractDurableMemories(
      'Remember that the codename is Juniper. What is the status? api_key=secret-value. Remember my password is hidden.'
    ),
    ['Remember that the codename is Juniper.']
  );
  t.deepEqual(
    extractDurableMemories(
      '我之前让你记住的数据库迁移代号是什么？请只回答代号。'
    ),
    []
  );
  t.deepEqual(
    extractDurableMemories(
      'What is the deployment codename? Reply with only the codename.'
    ),
    []
  );
  t.deepEqual(
    extractDurableMemories('The deployment codename is ORCHID_FACT.'),
    ['The deployment codename is ORCHID_FACT.']
  );
  t.deepEqual(extractDurableMemories('请记住：以后始终用中文回答。'), [
    '请记住：以后始终用中文回答。',
  ]);
});

test('automatic memory follows its owner into the active project', async t => {
  const stored: Array<Record<string, unknown>> = [];
  const service = new ContextMemoryService({
    copilotContextMemory: {
      getPreference: async () => null,
      listProjectIdsForDoc: async () => ['project-a'],
      put: async (input: Record<string, unknown>) => {
        stored.push(input);
        return input;
      },
    },
  } as unknown as Models);

  await service.captureDurableTurn({
    userId: 'user-a',
    workspaceId: 'workspace-a',
    docId: 'doc-a',
    sessionId: 'session-a',
    turn: {
      role: 'user',
      content: 'Remember that the project codename is Juniper.',
    } as never,
  });

  t.is(stored.length, 1);
  t.like(stored[0], {
    ownerUserId: 'user-a',
    workspaceId: 'workspace-a',
    docId: null,
    projectId: 'project-a',
    scope: 'project',
    kind: 'auto_memory',
    visibility: 'private',
  });
});

test('memory visibility query is isolated by owner, workspace, and project', t => {
  const where = buildContextMemoryVisibilityWhere({
    userId: 'user-a',
    workspaceId: 'workspace-a',
    docId: 'doc-a',
    projectIds: ['project-a'],
  });
  const alternatives = where.OR as Array<Record<string, unknown>>;

  t.is(where.status, 'active');
  t.is(where.visibility, 'private');
  t.true(alternatives.length >= 4);
  t.false(
    alternatives.some(
      alternative =>
        alternative.workspaceId === 'workspace-b' ||
        alternative.docId === 'doc-b' ||
        alternative.ownerUserId !== 'user-a'
    )
  );
  t.true(
    alternatives.some(
      alternative =>
        alternative.ownerUserId === 'user-a' &&
        alternative.workspaceId === 'workspace-a' &&
        alternative.scope === 'document' &&
        alternative.docId === 'doc-a'
    )
  );
  t.true(
    alternatives.some(
      alternative =>
        alternative.ownerUserId === 'user-a' &&
        alternative.workspaceId === 'workspace-a' &&
        alternative.scope === 'project'
    )
  );
});

test('ChatSession persists the planner checkpoint on save', async t => {
  const checkpoints: string[] = [];
  const session = new ChatSession(
    {
      userId: 'user-a',
      sessionId: 'session-a',
      workspaceId: 'workspace-a',
      docId: 'doc-a',
      prompt: {
        name: 'test',
        model: 'test',
        modelSource: 'built_in',
        optionalModels: [],
        optionalModelsSource: 'built_in',
        proModelsSource: 'built_in',
        paramKeys: [],
        params: {},
        source: 'built_in',
        category: 'text',
        overrideApplied: false,
      },
      turns: [
        {
          conversationId: 'session-a',
          role: 'user',
          content: 'EARLY_REQUIRED_FACT Use eu-west-1.',
          attachments: [],
          metadata: {},
          renderTrace: [],
          toolEvents: [],
          createdAt: new Date(),
        },
        {
          conversationId: 'session-a',
          role: 'assistant',
          content: 'Acknowledged.',
          attachments: [],
          metadata: {},
          renderTrace: [],
          toolEvents: [],
          createdAt: new Date(),
        },
        {
          conversationId: 'session-a',
          role: 'user',
          content: 'Continue.',
          attachments: [],
          metadata: {},
          renderTrace: [],
          toolEvents: [],
          createdAt: new Date(),
        },
      ],
    },
    (_prompt, turns) => tailRenderer(2)(turns),
    undefined,
    undefined,
    {
      planner: new ContextPlanner(),
      memories: [],
      checkpoint: null,
      saveCheckpoint: async checkpoint => {
        checkpoints.push(checkpoint.summary);
      },
    }
  );

  session.finish({});
  await session.save();

  t.is(checkpoints.length, 1);
  t.true(checkpoints[0].includes('EARLY_REQUIRED_FACT'));
});
