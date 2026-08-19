import { createHash } from 'node:crypto';

import { BadGatewayException, BadRequestException } from '@nestjs/common';

import type { EnterpriseCliProcessResult } from '../cli/runtime';
import type {
  EnterpriseResourceRef,
  EnterpriseToolDefinition,
  EnterpriseToolRisk,
} from '../types';

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function toolName(provider: string, command: string[]) {
  const base = `${provider}_${command.join('_')}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base.length <= 56) return base;
  const suffix = createHash('sha256')
    .update(command.join('\0'))
    .digest('hex')
    .slice(0, 8);
  return `${base.slice(0, 47)}_${suffix}`;
}

export function classifyCommandRisk(
  command: string[],
  declared?: string
): EnterpriseToolRisk {
  const normalized = declared?.toLowerCase();
  if (normalized?.includes('high') || normalized?.includes('danger')) {
    return 'high';
  }
  if (normalized?.includes('write')) return 'write';
  if (normalized === 'read' || normalized === 'readonly') return 'read';

  const words = new Set(
    command.flatMap(part => part.toLowerCase().split(/[^a-z0-9]+/))
  );
  if (
    [
      'delete',
      'remove',
      'recall',
      'approve',
      'reject',
      'send',
      'revoke',
      'transfer',
    ].some(word => words.has(word)) ||
    (words.has('permission') &&
      ['add', 'create', 'update', 'set', 'write'].some(word => words.has(word)))
  ) {
    return 'high';
  }
  if (
    [
      'add',
      'append',
      'archive',
      'cancel',
      'complete',
      'copy',
      'create',
      'finish',
      'import',
      'invite',
      'move',
      'patch',
      'publish',
      'rename',
      'reply',
      'restore',
      'set',
      'subscribe',
      'update',
      'upload',
      'write',
    ].some(word => words.has(word))
  ) {
    return 'write';
  }
  return 'read';
}

export function requireExecutableCall(
  tool: EnterpriseToolDefinition,
  args: Record<string, unknown>,
  confirmed: boolean
) {
  if (tool.requiresConfirmation && !confirmed) {
    throw new BadRequestException(
      `Enterprise tool ${tool.name} requires confirmation in LocalMind`
    );
  }
  const properties = asRecord(tool.inputSchema.properties) ?? {};
  if (tool.inputSchema.additionalProperties !== true) {
    const unknown = Object.keys(args).find(key => !(key in properties));
    if (unknown) {
      throw new BadRequestException(
        `Enterprise tool argument is not declared by its schema: ${unknown}`
      );
    }
  }
}

export function objectToFlags(input: Record<string, unknown>) {
  const args: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const flag = `--${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`).replace(/_/g, '-')}`;
    if (typeof value === 'boolean') {
      args.push(value ? flag : `${flag}=false`);
    } else if (typeof value === 'string' || typeof value === 'number') {
      args.push(flag, String(value));
    } else {
      args.push(flag, JSON.stringify(value));
    }
  }
  return args;
}

export function extractResourceRefs(
  provider: EnterpriseResourceRef['provider'],
  data: unknown
): EnterpriseResourceRef[] {
  const refs: EnterpriseResourceRef[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || refs.length >= 50) return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const url =
      asString(record.url) ??
      asString(record.link) ??
      asString(record.web_url) ??
      asString(record.webUrl);
    const externalId =
      asString(record.id) ??
      asString(record.document_id) ??
      asString(record.documentId) ??
      asString(record.token);
    if (url || externalId) {
      const key = `${url ?? ''}\0${externalId ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({
          provider,
          resourceType:
            asString(record.type) ?? asString(record.resource_type) ?? 'item',
          externalId,
          url,
        });
      }
    }
    Object.values(record).forEach(item => visit(item, depth + 1));
  };
  visit(data, 0);
  return refs;
}

export function processErrorMessage(stderr: string, stdout: string) {
  for (const raw of [stderr, stdout]) {
    if (!raw) continue;
    try {
      const parsed = asRecord(JSON.parse(raw));
      const error = asRecord(parsed?.error);
      const message = asString(error?.message) ?? asString(parsed?.message);
      if (message) return message.slice(0, 1000);
    } catch {
      // Fall through to the bounded plain-text message.
    }
  }
  return (stderr || stdout || 'Enterprise CLI command failed').slice(-1000);
}

export function requireProcessSuccess(result: EnterpriseCliProcessResult) {
  if (result.exitCode !== 0) {
    throw new BadGatewayException(
      processErrorMessage(result.stderr, result.stdout)
    );
  }
}
