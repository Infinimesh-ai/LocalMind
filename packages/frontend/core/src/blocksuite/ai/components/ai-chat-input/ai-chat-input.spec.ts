/**
 * @vitest-environment happy-dom
 */
import { signal } from '@preact/signals-core';
import { describe, expect, test, vi } from 'vitest';

import type { AIChatAction, AIChatRuntime } from '../../runtime/chat';
import { AIChatInput } from './ai-chat-input';

vi.unstubAllGlobals();
customElements.define('test-ai-chat-input', AIChatInput);

const selection = '沙箱是操作系统对进程设置的一系列权限限制。';
const question = '为什么我按tab';

function createInput(detailedObjects: boolean) {
  const input = document.createElement('test-ai-chat-input') as AIChatInput;
  const dispatch = vi.fn(async (_action: AIChatAction) => {});
  input.runtime = { dispatch } as unknown as AIChatRuntime;
  input.chatContextValue = {
    messages: [],
    status: 'idle',
    error: null,
    abortController: null,
    images: [],
    attachments: [],
    docs: [],
    markdown: selection,
    quote: selection,
    snapshot: '{"blocks":[]}',
    combinedElementsMarkdown: 'Canvas note',
    html: null,
  };
  input.updateContext = vi.fn(context => {
    input.chatContextValue = { ...input.chatContextValue, ...context };
  });
  input.reasoningConfig = { enabled: signal(false), setEnabled: vi.fn() };
  input.aiToolsConfigService = {
    config: signal({}),
  } as unknown as AIChatInput['aiToolsConfigService'];
  input.aiModelService = {
    modelId: signal('model-1'),
  } as unknown as AIChatInput['aiModelService'];
  input.affineFeatureFlagService = {
    flags: {
      enable_send_detailed_object_to_ai: { value: detailedObjects },
    },
  } as AIChatInput['affineFeatureFlagService'];
  return { input, dispatch };
}

describe('AIChatInput selection context', () => {
  test.each([false, true])(
    'sends only typed text as content while preserving selection (detailed objects: %s)',
    async detailedObjects => {
      const { input, dispatch } = createInput(detailedObjects);

      await input.send(question);

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'send',
          input: question,
          contexts: expect.objectContaining({
            selectionContext: selection,
            selectedSnapshot: detailedObjects ? '{"blocks":[]}' : undefined,
            selectedMarkdown: detailedObjects ? 'Canvas note' : undefined,
          }),
        })
      );
      expect(input.chatContextValue.markdown).toBe('');
      expect(input.chatContextValue.quote).toBe('');

      await input.send('继续');

      expect(dispatch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: '继续',
          contexts: expect.objectContaining({ selectionContext: undefined }),
        })
      );
    }
  );

  test('keeps ordinary messages intact without a selection', async () => {
    const { input, dispatch } = createInput(false);
    input.chatContextValue.markdown = '';

    await input.send(question);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: question,
        contexts: expect.objectContaining({ selectionContext: undefined }),
      })
    );
  });
});
