import { BadRequest } from '../base';

export type ByokApiStyle = 'chat_completions' | 'responses';

export function resolveByokApiStyle(
  provider: string,
  value?: string | null
): ByokApiStyle | null {
  if (value == null) return provider === 'openai' ? 'responses' : null;
  if (
    provider !== 'openai' ||
    (value !== 'chat_completions' && value !== 'responses')
  ) {
    throw new BadRequest('Invalid BYOK API protocol for this provider.');
  }
  return value;
}
