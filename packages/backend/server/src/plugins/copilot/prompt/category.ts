import type { PromptConfig } from '../providers/types';

export type PromptCategoryLike = {
  name: string;
  action?: string;
  model?: string;
  config?: PromptConfig;
};

function promptLabels(prompt: PromptCategoryLike) {
  return [prompt.action, prompt.name].filter(
    (value): value is string => !!value
  );
}

export function isImagePromptCategory(prompt: PromptCategoryLike) {
  const model = prompt.model ?? '';
  return !!(
    promptLabels(prompt).some(
      label =>
        label === 'image' ||
        label.startsWith('image.') ||
        label.startsWith('workflow:image') ||
        label.startsWith('fal-')
    ) ||
    model === 'gpt-image-1' ||
    model.startsWith('lora/') ||
    model.includes('/image-to-image') ||
    prompt.config?.modelName ||
    prompt.config?.loras?.length
  );
}

export function isTranscriptPromptCategory(prompt: PromptCategoryLike) {
  return promptLabels(prompt).some(label => {
    const normalized = label.toLowerCase();
    return (
      normalized.includes('transcript') || normalized.includes('transcrib')
    );
  });
}
