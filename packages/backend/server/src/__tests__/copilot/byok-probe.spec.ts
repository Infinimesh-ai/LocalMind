import test from 'ava';
import Sinon from 'sinon';

import type { safeFetch } from '../../base';
import {
  PROVIDER_PROBE_MAX_BYTES,
  runProviderProbe,
} from '../../plugins/copilot/byok/probe';
import { ByokProvider } from '../../plugins/copilot/byok/types';

test('provider probe allows model responses and explicitly configured private targets', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(
    new Response('{"data":[{"id":"private-model"}]}', { status: 200 })
  );

  await runProviderProbe(
    fetch,
    ByokProvider.openai,
    'secret',
    'http://provider.internal/v1',
    true
  );

  t.is(fetch.firstCall.args[0], 'http://provider.internal/v1/models');
  t.deepEqual(fetch.firstCall.args[2], {
    timeoutMs: 10_000,
    maxRedirects: 3,
    maxBytes: PROVIDER_PROBE_MAX_BYTES,
    allowedHeaders: ['Authorization'],
    allowHttp: true,
    allowPrivateTargetOrigin: true,
  });
  t.true(PROVIDER_PROBE_MAX_BYTES >= 64 * 1024);
});

test('provider probe keeps private targets blocked by default', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(
    new Response('{"models":[{"name":"models/gemini-test"}]}', {
      status: 200,
    })
  );

  await runProviderProbe(
    fetch,
    ByokProvider.gemini,
    'secret',
    'https://provider.example/v1beta',
    false
  );

  t.false(fetch.firstCall.args[2]?.allowHttp);
  t.false(fetch.firstCall.args[2]?.allowPrivateTargetOrigin);
});

test('provider probe rejects HTTP 200 responses without a usable model catalog', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(new Response('{}', { status: 200 }));

  const error = await t.throwsAsync(
    runProviderProbe(fetch, ByokProvider.openai, 'secret', null, false)
  );

  t.is(error?.message, 'Provider returned an invalid model catalog.');
});

test('provider probe rejects malformed successful responses without exposing them', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(
    new Response('<html>secret upstream response</html>', { status: 200 })
  );

  const error = await t.throwsAsync(
    runProviderProbe(fetch, ByokProvider.openai, 'secret', null, false)
  );

  t.is(error?.message, 'Provider returned malformed JSON.');
  t.false(error?.message.includes('secret upstream response') ?? true);
});

test('provider probe verifies non-empty OpenAI Responses output', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(
    new Response(
      JSON.stringify({
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'OK' }] },
        ],
      }),
      { status: 200 }
    )
  );

  const result = await runProviderProbe(
    fetch,
    ByokProvider.openai,
    'secret',
    null,
    false,
    'gpt-test'
  );

  t.deepEqual(result, {
    provider: ByokProvider.openai,
    operation: 'chat',
    modelId: 'gpt-test',
    modelIds: ['gpt-test'],
  });
});

test('provider probe rejects empty OpenAI Responses output', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(
    new Response('{"output":[{"type":"message","content":[]}]}', {
      status: 200,
    })
  );

  const error = await t.throwsAsync(
    runProviderProbe(
      fetch,
      ByokProvider.openai,
      'secret',
      null,
      false,
      'gpt-test'
    )
  );

  t.is(error?.message, 'Provider returned an invalid chat response.');
});

test('provider probe calls and verifies an exact Anthropic model', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(
    new Response('{"content":[{"type":"text","text":"OK"}]}', {
      status: 200,
    })
  );

  await runProviderProbe(
    fetch,
    ByokProvider.anthropic,
    'secret',
    null,
    false,
    'claude-test'
  );

  t.is(fetch.firstCall.args[0], 'https://api.anthropic.com/v1/messages');
  t.deepEqual(JSON.parse(fetch.firstCall.args[1]?.body as string), {
    model: 'claude-test',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
  });
});

test('provider probe calls and verifies an exact Gemini model', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(
    new Response('{"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}', {
      status: 200,
    })
  );

  await runProviderProbe(
    fetch,
    ByokProvider.gemini,
    'secret',
    null,
    false,
    'models/gemini-test'
  );

  t.is(
    fetch.firstCall.args[0],
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent'
  );
  t.deepEqual(JSON.parse(fetch.firstCall.args[1]?.body as string), {
    contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
    generationConfig: { maxOutputTokens: 64 },
  });
});

test('provider probe accepts FAL catalog wrapper variants but not empty lists', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >();
  fetch.onFirstCall().resolves(
    new Response('{"items":[{"model_id":"fal-ai/test"}]}', {
      status: 200,
    })
  );
  fetch.onSecondCall().resolves(new Response('{"items":[]}', { status: 200 }));

  const result = await runProviderProbe(
    fetch,
    ByokProvider.fal,
    'secret',
    null,
    false
  );

  t.deepEqual(result.modelIds, ['fal-ai/test']);
  const error = await t.throwsAsync(
    runProviderProbe(fetch, ByokProvider.fal, 'secret', null, false)
  );

  t.is(result.operation, 'model_catalog');
  t.is(error?.message, 'Provider returned an invalid model catalog.');
});

test('explicit Chat protocol probes the configured model with Chat messages', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(
    new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
  );
  await runProviderProbe(
    fetch,
    ByokProvider.openai,
    'secret',
    'https://provider.example/v1',
    false,
    'qwen3.8-flash',
    'chat_completions'
  );
  t.is(fetch.firstCall.args[0], 'https://provider.example/v1/chat/completions');
  const body = JSON.parse(String(fetch.firstCall.args[1]?.body));
  t.is(body.model, 'qwen3.8-flash');
  t.deepEqual(body.messages, [{ role: 'user', content: 'Reply with OK.' }]);
  t.false('input' in body);
});

test('invalid protocol values and provider combinations never dispatch', async t => {
  for (const [provider, apiStyle] of [
    [ByokProvider.openai, 'auto'],
    [ByokProvider.gemini, 'chat_completions'],
  ] as const) {
    const fetch = Sinon.stub<
      Parameters<typeof safeFetch>,
      ReturnType<typeof safeFetch>
    >();
    await t.throwsAsync(
      runProviderProbe(
        fetch,
        provider,
        'secret',
        null,
        false,
        'model',
        apiStyle
      )
    );
    t.false(fetch.called);
  }
});
