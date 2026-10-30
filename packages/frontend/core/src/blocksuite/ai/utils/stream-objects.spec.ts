import { describe, expect, test } from 'vitest';

import { joinAdjacentTextChunks } from './stream-objects';

describe('joinAdjacentTextChunks', () => {
  test('joins Markdown split across chunks without crossing tool boundaries', () => {
    const tool = {
      type: 'tool-call' as const,
      toolCallId: '1',
      toolName: 'example',
      args: {},
    };
    expect(
      joinAdjacentTextChunks([
        { type: 'text-delta', textDelta: '**重' },
        { type: 'text-delta', textDelta: '要**' },
        tool,
        { type: 'text-delta', textDelta: '后续' },
        { type: 'reasoning', textDelta: '*思' },
        { type: 'reasoning', textDelta: '考*' },
      ])
    ).toEqual([
      { type: 'text-delta', textDelta: '**重要**' },
      tool,
      { type: 'text-delta', textDelta: '后续' },
      { type: 'reasoning', textDelta: '*思考*' },
    ]);
  });
});
