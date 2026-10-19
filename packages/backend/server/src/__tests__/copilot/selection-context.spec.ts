import test from 'ava';

import {
  chatMessageFromTurn,
  promptMessageFromTurn,
  type Turn,
  turnFromChatMessage,
} from '../../plugins/copilot/core';
import { renderBuiltInPromptSessionNative } from '../../plugins/copilot/prompt/native-contract';
import { ConversationHost } from '../../plugins/copilot/runtime/hosts/conversation-host';

const selection = '沙箱是操作系统对进程设置的一系列权限限制。';
const question = '为什么我按tab';

function userTurn(content = question, selectionContext: unknown = selection) {
  return turnFromChatMessage(
    {
      role: 'user',
      content,
      params: { selectionContext },
      createdAt: new Date('2026-10-14T00:00:00Z'),
    },
    'session-selection'
  );
}

function render(turns: Turn[]) {
  const host = Object.create(ConversationHost.prototype) as ConversationHost;
  return renderBuiltInPromptSessionNative({
    name: 'Chat With LocalMind AI',
    turns: turns.map(promptMessageFromTurn),
    renderParams: host.buildLatestTurnPromptParams(turns.at(-1)),
    maxTokenSize: 128 * 1024,
  }).messages;
}

test('selection context stays separate through storage and history projection', t => {
  const turn = userTurn();
  const stored = chatMessageFromTurn(turn);
  t.is(stored.content, question);
  t.deepEqual(stored.params, { selectionContext: selection });

  const restored = turnFromChatMessage(
    JSON.parse(JSON.stringify(stored)),
    turn.conversationId
  );
  t.deepEqual(chatMessageFromTurn(restored), stored);
  t.is(promptMessageFromTurn(restored).content, `${selection}\n${question}`);
  t.is(chatMessageFromTurn(restored).content, question);
  t.is(turn.content, question);
});

test('the first model request and its retry receive the selection and question', t => {
  const turn = userTurn();
  const messages = render([turn]);
  t.true(
    messages.some(message =>
      message.content.includes(`${selection}\n${question}`)
    )
  );
  t.false(
    messages.some(
      message =>
        message.role === 'system' && message.content.includes(selection)
    )
  );
  t.deepEqual(render([turn]), messages);
  t.is(chatMessageFromTurn(turn).content, question);
});

test('later turns retain earlier selections and attach new selections to their own questions', t => {
  const previous = userTurn();
  const reply: Turn = {
    ...previous,
    role: 'assistant',
    content: '上一轮回答',
    metadata: {},
  };
  const nextSelection = '第二段选区上下文';
  const next = userTurn('这一段呢？', nextSelection);
  const messages = render([previous, reply, next]);
  const contents = new Set(messages.map(message => message.content));
  t.true(contents.has(`${selection}\n${question}`));
  t.true(contents.has(`${nextSelection}\n这一段呢？`));

  const followup = render([previous, reply, userTurn('继续', null)]);
  t.true(
    followup.some(message => message.content === `${selection}\n${question}`)
  );
  t.is(previous.content, question);
  t.is(next.content, '这一段呢？');
});

test('ordinary, legacy and malformed messages keep their content', t => {
  for (const selectionContext of [
    undefined,
    null,
    '',
    false,
    { text: selection },
  ]) {
    const turn = userTurn(question, selectionContext);
    // Explicitly override undefined, which otherwise uses the fixture default.
    turn.metadata.selectionContext = selectionContext;
    t.is(promptMessageFromTurn(turn).content, question);
  }
  const legacy = userTurn(`${selection}\n${question}`);
  legacy.metadata = {};
  t.is(promptMessageFromTurn(legacy).content, legacy.content);
  const assistant: Turn = { ...userTurn(), role: 'assistant' };
  t.is(promptMessageFromTurn(assistant).content, question);
});

test('whitespace and literal entities survive backend storage projection and native model rendering unchanged', t => {
  const context =
    '第一段\n\n\n  \n\t第二段\n&#x20;\n```javascript\n\tconst text = "&#x20;";\n\n    return text;\n```\n';
  const stored = chatMessageFromTurn(userTurn(question, context));
  const restored = turnFromChatMessage(
    JSON.parse(JSON.stringify(stored)),
    'session-selection'
  );
  t.is(stored.params?.selectionContext, context);
  t.is(stored.content, question);
  t.is(promptMessageFromTurn(restored).content, `${context}\n${question}`);
  const messages = render([restored]);
  t.true(
    messages.some(message =>
      message.content.includes(`${context}\n${question}`)
    )
  );
  t.deepEqual(render([restored]), messages);
});
