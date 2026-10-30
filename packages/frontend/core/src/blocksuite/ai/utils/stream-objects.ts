import type { StreamObject } from '../components/ai-chat-messages';

export function joinAdjacentTextChunks(chunks: StreamObject[]): StreamObject[] {
  return chunks.reduce<StreamObject[]>((result, chunk) => {
    const previous = result.at(-1);
    if (
      (chunk.type === 'text-delta' || chunk.type === 'reasoning') &&
      previous?.type === chunk.type &&
      'textDelta' in previous
    ) {
      result[result.length - 1] = {
        ...chunk,
        textDelta: previous.textDelta + chunk.textDelta,
      };
    } else {
      result.push(chunk);
    }
    return result;
  }, []);
}

export function mergeStreamObjects(chunks: StreamObject[] = []) {
  return chunks.reduce((acc, curr) => {
    const prev = acc.at(-1);
    switch (curr.type) {
      case 'reasoning':
      case 'text-delta': {
        if (prev && prev.type === curr.type) {
          acc[acc.length - 1] = {
            ...prev,
            textDelta: prev.textDelta + curr.textDelta,
          };
        } else {
          acc.push(curr);
        }
        break;
      }
      case 'tool-result': {
        const index = acc.findIndex(
          item =>
            item.type === 'tool-call' &&
            item.toolCallId === curr.toolCallId &&
            item.toolName === curr.toolName
        );
        if (index !== -1) {
          acc[index] = curr;
        } else {
          acc.push(curr);
        }
        break;
      }
      default: {
        acc.push(curr);
        break;
      }
    }
    return acc;
  }, [] as StreamObject[]);
}

export function mergeStreamContent(chunks: StreamObject[]): string {
  return chunks.reduce((acc, curr) => {
    if (curr.type === 'text-delta') {
      acc += curr.textDelta;
    }
    return acc;
  }, '');
}
