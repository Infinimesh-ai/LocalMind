import test from 'ava';
import Sinon from 'sinon';

import type { safeFetch } from '../../base';
import { mapAnyError } from '../../base/nestjs/exception';
import {
  PROVIDER_PROBE_MAX_BYTES,
  ProviderProbeError,
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

test('provider HTTP errors expose only locally defined diagnostics', async t => {
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >().resolves(new Response('private response: secret-key', { status: 404 }));
  const error = await t.throwsAsync(
    runProviderProbe(
      fetch,
      ByokProvider.anthropic,
      'secret-key',
      'https://example.com',
      false,
      'model'
    )
  );
  t.true(error instanceof ProviderProbeError);
  t.is(error?.message, 'Provider probe endpoint was not found.');
  t.false(error?.message.includes('secret-key'));
});

test('known DeepSeek protocol mismatches fail before catalog or model requests', async t => {
  for (const model of ['', 'deepseek-flash']) {
    for (const endpoint of [
      'https://api.deepseek.com',
      'https://api.deepseek.com/v1/',
    ]) {
      const fetch = Sinon.stub<
        Parameters<typeof safeFetch>,
        ReturnType<typeof safeFetch>
      >();
      const error = await t.throwsAsync(
        runProviderProbe(
          fetch,
          ByokProvider.anthropic,
          'secret',
          endpoint,
          false,
          model
        )
      );
      t.is(
        error?.message,
        'DeepSeek OpenAI endpoint requires the OpenAI provider.'
      );
      t.false(fetch.called);
      // The save mutation must preserve this diagnostic through the same
      // exception mapping as GraphQL, instead of becoming INTERNAL_SERVER_ERROR.
      t.is(mapAnyError(error).message, error?.message);
      t.is(mapAnyError(error).status, 400);
    }
  }
});

test('DeepSeek protocol checks preserve valid and custom gateway routes', async t => {
  for (const [provider, endpoint] of [
    [ByokProvider.openai, 'https://api.deepseek.com/v1'],
    [ByokProvider.anthropic, 'https://api.deepseek.com/anthropic'],
    [ByokProvider.anthropic, 'https://gateway.example/v1'],
    [ByokProvider.anthropic, 'https://api.deepseek.com.example/v1'],
  ] as const) {
    const fetch = Sinon.stub<
      Parameters<typeof safeFetch>,
      ReturnType<typeof safeFetch>
    >().resolves(Response.json({ data: [{ id: 'model' }] }));
    await runProviderProbe(fetch, provider, 'secret', endpoint, false);
    t.true(fetch.calledOnce);
  }
  const fetch = Sinon.stub<
    Parameters<typeof safeFetch>,
    ReturnType<typeof safeFetch>
  >();
  await t.throwsAsync(
    runProviderProbe(
      fetch,
      ByokProvider.openai,
      'secret',
      'https://api.deepseek.com/anthropic',
      false
    ),
    { message: 'DeepSeek Anthropic endpoint requires the Anthropic provider.' }
  );
  t.false(fetch.called);
});

test('probe classifies explicit model, quota, authentication and service failures without forwarding upstream text', async t => {
  for (const [status, code, expected] of [
    [
      404,
      'model_not_found',
      'Provider model was not found or is not accessible.',
    ],
    [
      403,
      'model_not_found',
      'Provider model was not found or is not accessible.',
    ],
    [429, 'insufficient_quota', 'Provider account has insufficient quota.'],
    [402, '', 'Provider account has insufficient quota.'],
    [401, 'model_not_found', 'Provider rejected the BYOK key.'],
    [403, '', 'Provider rejected the BYOK key permissions.'],
    [404, 'unrecognized-secret-code', 'Provider probe endpoint was not found.'],
    [400, '', 'Provider rejected the request format.'],
    [429, '', 'Provider rate limit exceeded while testing the key.'],
    [503, 'model_not_found', 'Provider service is unavailable.'],
    [504, '', 'Provider request timed out.'],
  ] as const) {
    const fetch = Sinon.stub<
      Parameters<typeof safeFetch>,
      ReturnType<typeof safeFetch>
    >().resolves(
      Response.json(
        { error: { code, message: 'Authorization: secret-key; private body' } },
        { status }
      )
    );
    const error = await t.throwsAsync(
      runProviderProbe(
        fetch,
        ByokProvider.openai,
        'secret-key',
        null,
        false,
        'model'
      )
    );
    t.is(error?.message, expected);
    t.is(mapAnyError(error).message, expected);
    t.false(JSON.stringify(mapAnyError(error).toJSON()).includes('secret-key'));
  }
});

test('transport failures are safe and distinguish explicit timeouts', async t => {
  for (const [failure, expected] of [
    [
      new DOMException('secret-key', 'TimeoutError'),
      'Provider request timed out.',
    ],
    [new Error('secret-key; internal URL'), 'Provider connection failed.'],
  ] as const) {
    const fetch = Sinon.stub<
      Parameters<typeof safeFetch>,
      ReturnType<typeof safeFetch>
    >().rejects(failure);
    await t.throwsAsync(
      runProviderProbe(fetch, ByokProvider.openai, 'secret-key', null, false),
      { message: expected }
    );
  }
});
