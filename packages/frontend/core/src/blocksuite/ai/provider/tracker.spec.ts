/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import type { AIRequestActionEvent } from '../runtime/request';
import { toTrackedOptions } from './tracker';

describe('AI action tracker', () => {
  test('omits model selection metadata from analytics payload', () => {
    const event = {
      action: 'summary',
      event: 'started',
      modelSelection: {
        modelId: 'local-provider/qwen3:32b',
        promptName: 'Summary',
        source: 'prompt_preference',
      },
      promptName: 'Summary',
      options: {
        input: 'summarize',
        modelId: 'local-provider/qwen3:32b',
        modelSelection: {
          modelId: 'local-provider/qwen3:32b',
          promptName: 'Summary',
          source: 'prompt_preference',
        },
        tone: 'formal',
        workspaceId: 'workspace-1',
      },
    } satisfies AIRequestActionEvent;

    expect(toTrackedOptions(event)?.properties.other).toEqual({
      tone: 'formal',
    });
  });
});
