import test from 'ava';

import type { CopilotProviderRegistryService } from '../../plugins/copilot/providers/registry-service';
import { ModelSelectionPolicy } from '../../plugins/copilot/runtime/model-selection-policy';

const policy = new ModelSelectionPolicy({} as CopilotProviderRegistryService);
const scope = {
  defaultModel: '',
  extraModels: ['byok-workspace/gpt-6.1-sol'],
  providerIds: ['byok-workspace'],
};

test('an explicitly selected authorized model works without a prompt default', t => {
  t.deepEqual(
    policy.resolveRequestedModel({
      ...scope,
      requestedModelId: 'byok-workspace/gpt-6.1-sol',
    }),
    {
      selectedModel: 'byok-workspace/gpt-6.1-sol',
      matchedOptionalModel: true,
    }
  );
});

test('a missing default does not authorize another provider or an unknown model', t => {
  for (const requestedModelId of [
    undefined,
    'another-provider/gpt-6.1-sol',
    'byok-workspace/unknown-model',
  ]) {
    t.throws(() =>
      policy.resolveRequestedModel({ ...scope, requestedModelId })
    );
  }
  t.throws(() =>
    policy.resolveRequestedModel({
      defaultModel: '',
      optionalModels: [],
      extraModels: [],
      providerIds: [],
      requestedModelId: 'byok-workspace/gpt-6.1-sol',
    })
  );
});

test('existing prompt defaults still handle unsupported requests', t => {
  t.deepEqual(
    policy.resolveRequestedModel({
      ...scope,
      defaultModel: 'default-model',
      requestedModelId: 'unapproved-model',
    }),
    { selectedModel: 'default-model', matchedOptionalModel: false }
  );
});
