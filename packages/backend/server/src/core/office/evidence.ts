import { createHash } from 'node:crypto';

export function officeFingerprint(bytes: Uint8Array) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function officeJsonFingerprint(value: Record<string, unknown>) {
  return officeFingerprint(Buffer.from(JSON.stringify(value), 'utf8'));
}
