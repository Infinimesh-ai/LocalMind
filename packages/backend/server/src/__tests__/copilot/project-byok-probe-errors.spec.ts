import test from 'ava';

import { ByokService } from '../../plugins/copilot/byok/service';
import { ByokProvider } from '../../plugins/copilot/byok/types';

function serviceWithProbe(probeFetch: () => Promise<Response>): ByokService {
  const service = Object.assign(Object.create(ByokService.prototype), {
    probeFetch,
    crypto: { decrypt: () => 'synthetic-secret', encrypt: () => 'encrypted' },
    entitlement: { assertInstanceManagementAccess: async () => {} },
    assertProvider: () => {},
    models: { copilotProjectByok: { get: async () => null } },
  });
  Object.defineProperty(service, 'privateEndpointSupported', { value: false });
  return service;
}

const input = {
  expectedRevision: 0,
  provider: ByokProvider.anthropic,
  modelId: 'model',
  apiKey: 'synthetic-secret',
};

test('project tests preserve safe HTTP diagnostics without exposing provider bodies', async t => {
  const service = serviceWithProbe(
    async () => new Response('synthetic-secret', { status: 401 })
  );
  t.deepEqual(await service.testProjectConfig(input, 'admin'), {
    ok: false,
    models: [],
    modelListError: null,
    message: 'Provider rejected the BYOK key.',
  });
  await t.throwsAsync(service.saveProjectConfig(input, 'admin'), {
    message: 'Provider rejected the BYOK key.',
  });
});

test('project tests redact arbitrary transport error messages', async t => {
  const service = serviceWithProbe(async () => {
    throw new Error('Authorization: synthetic-secret');
  });
  t.deepEqual(await service.testProjectConfig(input, 'admin'), {
    ok: false,
    models: [],
    modelListError: null,
    message:
      'Project provider test failed. Check the endpoint, model and API key.',
  });
});

test('connection discovery without a model returns deduplicated API model IDs', async t => {
  const service = serviceWithProbe(async () =>
    Response.json({
      data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-a' }],
    })
  );
  t.deepEqual(
    await service.testProjectConfig({ ...input, modelId: '' }, 'admin'),
    {
      ok: true,
      message: null,
      models: ['model-a', 'model-b'],
      modelListError: null,
    }
  );
});

test('successful model test loads the API catalog rather than only echoing the tested model', async t => {
  let calls = 0;
  const service = serviceWithProbe(async () =>
    ++calls === 1
      ? Response.json({ content: [{ text: 'OK' }] })
      : Response.json({ data: [{ id: 'model' }, { id: 'another-model' }] })
  );
  const result = await service.testProjectConfig(input, 'admin');
  t.true(result.ok);
  t.deepEqual(result.models, ['model', 'another-model']);
  t.is(calls, 2);
});

test('catalog failure does not turn a successful model probe into a connection failure', async t => {
  let calls = 0;
  const service = serviceWithProbe(async () =>
    ++calls === 1
      ? Response.json({ content: [{ text: 'OK' }] })
      : new Response('private upstream body', { status: 404 })
  );
  t.deepEqual(await service.testProjectConfig(input, 'admin'), {
    ok: true,
    message: null,
    models: [],
    modelListError: 'model_catalog_unavailable',
  });
});

test('saving still rejects a blank model even though discovery allows it', async t => {
  let calls = 0;
  const service = serviceWithProbe(async () => {
    calls++;
    return Response.json({ data: [{ id: 'model' }] });
  });
  await t.throwsAsync(
    service.saveProjectConfig({ ...input, modelId: '' }, 'admin'),
    { message: 'BYOK model ID must not be blank.' }
  );
  t.is(calls, 0);
});
