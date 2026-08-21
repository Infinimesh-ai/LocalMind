import { passthroughModelAdapter } from './passthrough';
import { qwen36ModelAdapter } from './qwen36/adapter';
import type { LocalModelAdapter, ModelRouteLock } from './types';

const modelAdapters: readonly LocalModelAdapter[] = [qwen36ModelAdapter];

export function resolveModelAdapter(route: ModelRouteLock): LocalModelAdapter {
  return (
    modelAdapters.find(adapter => adapter.matches(route)) ??
    passthroughModelAdapter
  );
}

export function getModelAdapter(id: string): LocalModelAdapter | undefined {
  if (id === passthroughModelAdapter.id) {
    return passthroughModelAdapter;
  }
  return modelAdapters.find(adapter => adapter.id === id);
}
