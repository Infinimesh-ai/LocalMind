// node tests/responses-tool-arguments-smoke.cjs /absolute/path/server-native.node
// Synthetic local SSE only; no model credentials or real document mutations.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const native = require(path.resolve(process.argv[2]));
const frame = value => `data: ${JSON.stringify(value)}\n\n`;

const content =
  '# 周报\n\n| 项目 | 状态 |\n| --- | --- |\n| AI | 已完成 |\n\n```js\n    ok();\n```\n全角　空格  end';
const args = { doc_id: 'synthetic-doc', content };
const encoded = JSON.stringify(args, null, 2);

async function exercise(mode, conflict) {
  let requests = 0;
  let writes = 0;
  let toolError;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests++;
    res.setHeader('Content-Type', 'text/event-stream');
    if (requests === 1) {
      const item = {
        type: 'function_call',
        id: 'item-a',
        call_id: 'call-a',
        name: 'workspace_doc_update',
        arguments: '',
      };
      res.write(
        frame({ type: 'response.output_item.added', output_index: 0, item })
      );
      // One Unicode character per delta includes both JSON and content whitespace,
      // plus escaped newline/tab sequences split across deltas.
      for (const delta of encoded) {
        res.write(
          frame({
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            item_id: item.id,
            delta,
          })
        );
      }
      const finalArgs = conflict
        ? JSON.stringify({ ...args, content: 'changed' })
        : encoded;
      for (let i = 0; i < 2; i++) {
        res.write(
          frame({
            type: 'response.function_call_arguments.done',
            item_id: item.id,
            arguments: finalArgs,
          })
        );
      }
      res.write(
        frame({
          type: 'response.output_item.done',
          output_index: 0,
          item: { ...item, arguments: finalArgs },
        })
      );
    } else {
      try {
        assert.equal(requests, 2, 'must not replay the completed tool round');
        assert.equal(
          body.input.filter(item => item.type === 'function_call_output')
            .length,
          1
        );
      } catch (error) {
        toolError = error;
      }
      res.write(frame({ type: 'response.output_text.delta', delta: '已完成' }));
    }
    res.end(
      frame({ type: 'response.completed', response: { status: 'completed' } })
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const events = [];
  const config = {
    base_url: `http://127.0.0.1:${server.address().port}`,
    auth_token: 'synthetic',
    timeout_ms: 3000,
    request_layer: 'responses',
  };
  const request = {
    model: 'synthetic',
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Update synthetic document' }],
      },
    ],
    tools: [
      {
        name: 'workspace_doc_update',
        parameters: {
          type: 'object',
          properties: {
            doc_id: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['doc_id', 'content'],
          additionalProperties: false,
        },
      },
    ],
  };
  const route = {
    provider_id: 'synthetic',
    protocol: 'openai_responses',
    model: 'synthetic',
    config,
  };
  try {
    await new Promise((resolve, reject) => {
      let handle;
      const timer = setTimeout(() => {
        handle?.abort();
        reject(new Error('Native regression timed out'));
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
      const execute = async (error, raw) => {
        if (error) throw error;
        const call = JSON.parse(raw);
        writes++;
        try {
          assert.equal(call.callId, 'call-a');
          assert.deepEqual(
            call.args,
            args,
            'document text must be preserved exactly'
          );
        } catch (error) {
          toolError = error;
        }
        return JSON.stringify({ ...call, output: { updated: true } });
      };
      if (mode === 'prepared') {
        handle = native.llmDispatchToolLoopStreamPrepared(
          JSON.stringify([{ ...route, request }]),
          3,
          callback,
          execute
        );
      } else if (mode === 'routed') {
        handle = native.llmDispatchToolLoopStreamRouted(
          JSON.stringify([route]),
          JSON.stringify(request),
          3,
          callback,
          execute
        );
      } else {
        handle = native.llmDispatchToolLoopStream(
          route.protocol,
          JSON.stringify(config),
          JSON.stringify(request),
          3,
          callback,
          execute
        );
      }
    });
    if (toolError) throw toolError;
    assert.equal(writes, conflict ? 0 : 1);
    assert.equal(requests, conflict ? 1 : 2);
    const errors = events.filter(event => event.type === 'error');
    if (conflict) {
      assert.equal(errors.length, 1);
      assert.equal(errors[0].code, 'conflicting_tool_arguments');
      assert.equal(events.filter(event => event.type === 'done').length, 0);
    } else {
      assert.deepEqual(errors, []);
      assert.equal(events.filter(event => event.type === 'done').length, 1);
      assert.equal(
        events
          .filter(event => event.type === 'text_delta')
          .map(event => event.text)
          .join(''),
        '已完成'
      );
    }
    console.log(
      `${mode}: ${conflict ? 'conflict rejected before write' : 'fragmented document written exactly once'}`
    );
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  for (const mode of ['plain', 'routed', 'prepared']) {
    await exercise(mode, false);
    await exercise(mode, true);
  }
  console.log('Responses tool arguments smoke: 6 scenarios passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
