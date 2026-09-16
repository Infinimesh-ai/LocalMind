// Run with a freshly built Linux N-API addon, never with production credentials:
// node tests/qwen-runtime-smoke.cjs /absolute/path/server-native.node
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const native = require(path.resolve(process.argv[2]));
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const chat = (delta, finish_reason = null) => ({
  choices: [{ index: 0, delta, finish_reason }],
});
const messages = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Echo the marker and answer OK.' }],
  },
];

async function exercise(protocol, failed = false) {
  let requests = 0;
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts).toString());
    requests++;
    res.setHeader('Content-Type', 'text/event-stream');
    if (protocol === 'openai_chat') {
      assert.equal(req.url, '/v1/chat/completions');
      if (requests === 1) {
        res.write(
          frame(
            chat({
              tool_calls: [
                {
                  index: 0,
                  id: 'real-call',
                  function: { name: 'echo', arguments: '{"marker":' },
                },
              ],
            })
          )
        );
        res.write(
          frame(
            chat({
              tool_calls: [
                {
                  index: 0,
                  id: '',
                  function: { name: '', arguments: '"中文"}' },
                },
              ],
            })
          )
        );
        res.write(frame(chat({}, failed ? 'length' : 'tool_calls')));
      } else {
        assert.equal(
          body.messages.filter(message => message.role === 'tool').length,
          1
        );
        res.write(frame(chat({ content: 'OK' })));
        res.write(frame(chat({}, 'stop')));
      }
      res.end('data: [DONE]\n\n');
    } else {
      assert.equal(req.url, '/v1/responses');
      if (requests === 1) {
        res.write(
          frame({
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'function_call',
              id: 'item-1',
              call_id: 'real-call',
              name: 'echo',
              arguments: '',
            },
          })
        );
        res.write(
          frame({
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            item_id: 'item-1',
            delta: '{"marker":"中文"}',
          })
        );
        res.write(
          frame({
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'function_call',
              id: 'item-1',
              call_id: 'real-call',
              name: 'echo',
              arguments: '{"marker":"中文"}',
            },
          })
        );
      } else {
        assert.equal(
          body.input.filter(item => item.type === 'function_call_output')
            .length,
          1
        );
        res.write(frame({ type: 'response.output_text.delta', delta: 'OK' }));
      }
      res.end(
        frame({
          type: failed ? 'response.failed' : 'response.completed',
          response: {
            status: failed ? 'failed' : 'completed',
            usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
          },
        })
      );
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const events = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Native smoke timed out')),
        10_000
      );
      native.llmDispatchToolLoopStream(
        protocol,
        JSON.stringify({
          base_url: `http://127.0.0.1:${server.address().port}`,
          auth_token: 'synthetic',
          timeout_ms: 3000,
        }),
        JSON.stringify({
          model: 'synthetic-qwen',
          messages,
          max_tokens: 256,
          tools: [
            {
              name: 'echo',
              parameters: {
                type: 'object',
                properties: { marker: { type: 'string' } },
                required: ['marker'],
                additionalProperties: false,
              },
            },
          ],
        }),
        2,
        (error, data) => {
          if (error) {
            clearTimeout(timer);
            reject(error);
            return;
          }
          if (data === '__AFFINE_LLM_STREAM_END__') {
            clearTimeout(timer);
            resolve();
            return;
          }
          events.push(JSON.parse(data));
        },
        async (error, data) => {
          if (error) throw error;
          const call = JSON.parse(data);
          calls++;
          assert.equal(call.callId, 'real-call');
          assert.deepEqual(call.args, { marker: '中文' });
          return JSON.stringify({
            ...call,
            output: { marker: call.args.marker },
          });
        }
      );
    });
    assert.equal(calls, failed ? 0 : 1);
    assert.equal(requests, failed ? 1 : 2);
    assert.equal(
      events.some(event => event.type === 'error'),
      failed
    );
    if (!failed)
      assert.equal(
        events
          .filter(event => event.type === 'text_delta')
          .map(event => event.text)
          .join(''),
        'OK'
      );
    if (protocol === 'openai_responses' && !failed) {
      const usages = events.filter(event => event.type === 'usage');
      assert.equal(usages.length, 2);
      assert.equal(
        usages.reduce((sum, event) => sum + event.usage.total_tokens, 0),
        10
      );
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  for (const protocol of ['openai_chat', 'openai_responses']) {
    await exercise(protocol);
    await exercise(protocol, true);
  }
  console.log('Native Qwen SSE smoke: 4 scenarios passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
