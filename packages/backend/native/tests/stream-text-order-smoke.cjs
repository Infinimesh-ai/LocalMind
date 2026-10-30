// node tests/stream-text-order-smoke.cjs /absolute/path/server-native.node
// Synthetic local SSE only; no model credentials or persisted conversation.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const native = require(path.resolve(process.argv[2]));
const frame = value => `data: ${JSON.stringify(value)}\n\n`;

const fixtures = [
  '# Markdown 演示\n\n这是**中文加粗**，这是*斜体文字*。\n\n1. 编号项目一\n2. 编号项目二\n\n- 无序项目甲\n- 无序项目乙\n\n| 名称 | 说明 |\n| --- | --- |\n| Markdown | 轻量标记语言 |\n| Python | 编程语言 |\n\n行内代码：`print("你好")`\n\n```python\n# 输出中文问候\nprint("你好，世界！")\n```\n\n链接：[访问 Python 官网](https://www.python.org/)',
  '正文：**[访问 Python 官网](https://www.python.org/)**',
  '行内代码：`array[longVariableName]`',
  '正文：[未完成',
  '🧪1234567890123456[尾部中文',
];

async function exercise(mode, protocol, text, chunkSize, terminal = true) {
  let requests = 0;
  let toolCalls = 0;
  const responses = protocol === 'openai_responses';
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    requests++;
    res.setHeader('Content-Type', 'text/event-stream');
    const chars = [...text];
    for (let index = 0; index < chars.length; index += chunkSize) {
      const delta = chars.slice(index, index + chunkSize).join('');
      res.write(
        frame(
          responses
            ? { type: 'response.output_text.delta', delta }
            : { choices: [{ index: 0, delta: { content: delta } }] }
        )
      );
    }
    if (!terminal) {
      res.end();
      return;
    }
    res.end(
      responses
        ? frame({
            type: 'response.completed',
            response: { status: 'completed' },
          })
        : frame({
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }) + 'data: [DONE]\n\n'
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = {
    base_url: `http://127.0.0.1:${server.address().port}`,
    auth_token: 'synthetic',
    timeout_ms: 3000,
    request_layer: responses ? 'responses' : 'chat_completions',
  };
  const request = {
    model: 'synthetic',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Stream fixture' }] },
    ],
  };
  const route = {
    provider_id: 'synthetic',
    protocol,
    model: 'synthetic',
    config,
  };
  const events = [];
  try {
    await new Promise((resolve, reject) => {
      let handle;
      const timer = setTimeout(() => {
        handle?.abort();
        reject(new Error('Native stream regression timed out'));
      }, 10000);
      const callback = (error, raw) => {
        if (error || raw === '__AFFINE_LLM_STREAM_END__') {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        } else {
          events.push(JSON.parse(raw));
        }
      };
      const execute = async () => {
        toolCalls++;
        throw new Error('Unexpected tool call in text fixture');
      };
      try {
        if (mode === 'plain') {
          handle = native.llmDispatchPreparedStream(
            JSON.stringify([{ ...route, request }]),
            callback
          );
        } else if (mode === 'prepared') {
          handle = native.llmDispatchToolLoopStreamPrepared(
            JSON.stringify([{ ...route, request }]),
            1,
            callback,
            execute
          );
        } else if (mode === 'routed') {
          handle = native.llmDispatchToolLoopStreamRouted(
            JSON.stringify([route]),
            JSON.stringify(request),
            1,
            callback,
            execute
          );
        } else {
          handle = native.llmDispatchToolLoopStream(
            protocol,
            JSON.stringify(config),
            JSON.stringify(request),
            1,
            callback,
            execute
          );
        }
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
    const label = `${mode}/${protocol}/chunk=${chunkSize}`;
    assert.equal(requests, 1, label);
    assert.equal(toolCalls, 0, label);
    if (!terminal) {
      assert.ok(
        events.some(event => event.type === 'error'),
        label
      );
      assert.equal(
        events.some(event => event.type === 'done'),
        false,
        label
      );
      return;
    }
    assert.deepEqual(
      events.filter(event => event.type === 'error'),
      [],
      label
    );
    assert.equal(
      events
        .filter(event => event.type === 'text_delta')
        .map(event => event.text)
        .join(''),
      text,
      label
    );
    assert.equal(
      events.filter(event => event.type === 'done').length,
      1,
      label
    );
    const doneIndex = events.findIndex(event => event.type === 'done');
    assert.equal(
      events.slice(doneIndex + 1).some(event => event.type === 'text_delta'),
      false,
      `${label}: all text must precede Done`
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  let passed = 0;
  for (const mode of ['plain', 'prepared', 'routed', 'legacy']) {
    for (const protocol of ['openai_responses', 'openai_chat_completions']) {
      for (const text of fixtures) {
        for (const size of [1, 17, [...text].length]) {
          await exercise(mode, protocol, text, size);
          passed++;
        }
      }
      await exercise(mode, protocol, '正文：[未完成', 1, false);
      passed++;
    }
  }
  console.log(
    `${passed} native stream text-order/tail-preservation cases passed`
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
