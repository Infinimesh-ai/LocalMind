/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test, vi } from 'vitest';

import { applyActionModelId } from './action-model';

vi.mock('../utils/ai-widgets', () => ({
  getAIPanelWidget: vi.fn((host: { panel: unknown }) => host.panel),
}));

describe('applyActionModelId', () => {
  test('passes resolved action prompt scope to panel model resolver', async () => {
    const resolveActionModelId = vi.fn().mockResolvedValue('image-model');
    const host = {
      panel: {
        config: {
          resolveActionModelId,
        },
      },
    };
    const options = {
      workspaceId: 'workspace-1',
      docId: 'doc-1',
      input: 'convert',
      style: 'Sketch style',
    } as BlockSuitePresets.AITextActionOptions & Record<string, unknown>;

    const result = await applyActionModelId(
      host as never,
      'filterImage',
      options
    );

    expect(result.modelId).toBe('image-model');
    expect(result.modelSelection).toEqual({
      modelId: 'image-model',
      promptName: 'image.filter.sketch',
      source: 'prompt_preference',
    });
    expect(resolveActionModelId).toHaveBeenCalledWith({
      actionId: 'filterImage',
      promptName: 'image.filter.sketch',
      workspaceId: 'workspace-1',
      docId: 'doc-1',
      options,
    });
  });

  test('does not add modelId when resolver has no selected model', async () => {
    const host = {
      panel: {
        config: {
          resolveActionModelId: vi.fn().mockReturnValue(undefined),
        },
      },
    };
    const options = {
      workspaceId: 'workspace-1',
      input: 'summarize',
    } as BlockSuitePresets.AITextActionOptions & Record<string, unknown>;

    const result = await applyActionModelId(host as never, 'summary', options);

    expect(result.modelId).toBeUndefined();
    expect(result.modelSelection).toEqual({
      promptName: 'Summary',
      source: 'unresolved',
    });
  });

  test('keeps explicit action modelId without consulting panel preference', async () => {
    const resolveActionModelId = vi.fn().mockReturnValue('preference-model');
    const host = {
      panel: {
        config: {
          resolveActionModelId,
        },
      },
    };
    const options = {
      workspaceId: 'workspace-1',
      input: 'summarize',
      modelId: 'explicit-model',
    } as BlockSuitePresets.AITextActionOptions & Record<string, unknown>;

    const result = await applyActionModelId(host as never, 'summary', options);

    expect(result.modelId).toBe('explicit-model');
    expect(result.modelSelection).toEqual({
      modelId: 'explicit-model',
      promptName: 'Summary',
      source: 'explicit',
    });
    expect(resolveActionModelId).not.toHaveBeenCalled();
  });
});
