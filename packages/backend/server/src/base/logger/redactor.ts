import { createHash } from 'node:crypto';

const SECRET =
  /(?:api[_-]?key|token|secret|password|cookie|authorization|credential|prompt|content|body|attachment|request|response)/i;
const MAX_STRING = 2048;
const MAX_KEYS = 64;
const SECRET_VALUE =
  /(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+)/i;

export function hashActor(value: string | undefined | null) {
  return value
    ? createHash('sha256').update(value).digest('hex').slice(0, 32)
    : undefined;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string')
    return SECRET_VALUE.test(value)
      ? '[redacted]'
      : value.length > MAX_STRING
        ? `${value.slice(0, MAX_STRING)}…`
        : value;
  if (value instanceof Error)
    return {
      name: value.name,
      message: SECRET.test(value.message)
        ? '[redacted]'
        : redact(value.message),
      stack:
        value.stack && SECRET.test(value.stack)
          ? '[redacted]'
          : redact(value.stack),
    };
  if (Array.isArray(value))
    return value.slice(0, MAX_KEYS).map(item => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS))
      result[key] = SECRET.test(key) ? '[redacted]' : redact(item, depth + 1);
    return result;
  }
  return value;
}
