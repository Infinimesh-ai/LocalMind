import { Injectable } from '@nestjs/common';
import { EnterpriseProvider } from '@prisma/client';

import {
  type EnterpriseCliProcessResult,
  EnterpriseCliRuntime,
} from '../cli/runtime';
import type {
  EnterpriseAuthorizationRequest,
  EnterpriseAuthStatus,
  EnterpriseCliDriver,
  EnterpriseToolCall,
  EnterpriseToolDefinition,
} from '../types';
import {
  asArray,
  asRecord,
  asString,
  classifyCommandRisk,
  extractResourceRefs,
  objectToFlags,
  requireExecutableCall,
  requireProcessSuccess,
  toolName,
} from './shared';

const SHORTCUT_DISCOVERY_CONCURRENCY = 8;
const SHORTCUT_FLAG_EXCLUSIONS = new Set(['format', 'help', 'jq', 'yes']);

type LarkCompletionEntry = {
  value: string;
  description?: string;
};

@Injectable()
export class LarkCliDriver implements EnterpriseCliDriver {
  readonly provider = EnterpriseProvider.LARK;

  constructor(private readonly runtime: EnterpriseCliRuntime) {}

  async authorize(profileKey: string, request: EnterpriseAuthorizationRequest) {
    let initiated = await this.beginUserAuthorization(
      profileKey,
      request.signal
    );
    if (this.isNotConfigured(initiated)) {
      await this.initializeApp(profileKey, request);
      initiated = await this.beginUserAuthorization(profileKey, request.signal);
    }
    requireProcessSuccess(initiated);
    const root = asRecord(initiated.data);
    const authorizationUrl =
      asString(root?.verification_uri_complete) ??
      asString(root?.verification_url) ??
      asString(root?.verification_uri);
    const deviceCode = asString(root?.device_code);
    const expiresIn =
      Number.isSafeInteger(Number(root?.expires_in)) &&
      Number(root?.expires_in) > 0
        ? Math.min(Number(root?.expires_in), 20 * 60)
        : 15 * 60;
    if (!authorizationUrl || !deviceCode) {
      throw new Error('Lark CLI did not return a device authorization URL');
    }
    await request.onChallenge({
      authorizationUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    });

    const completed = await this.runtime.executeAuthorization({
      provider: this.provider,
      profileKey,
      args: ['auth', 'login', '--device-code', deviceCode, '--json'],
      timeoutMs: Math.min((expiresIn + 30) * 1000, 20 * 60 * 1000),
      maxOutputBytes: 256 * 1024,
      signal: request.signal,
    });
    requireProcessSuccess(completed);
    return await this.authStatus(profileKey, request.signal);
  }

  private beginUserAuthorization(profileKey: string, signal?: AbortSignal) {
    return this.runtime.execute({
      provider: this.provider,
      profileKey,
      args: ['auth', 'login', '--recommend', '--no-wait', '--json'],
      timeoutMs: 60_000,
      maxOutputBytes: 64 * 1024,
      signal,
    });
  }

  private async initializeApp(
    profileKey: string,
    request: EnterpriseAuthorizationRequest
  ) {
    let output = '';
    let reportedUrl: string | undefined;
    let updates = Promise.resolve();
    const observe = (chunk: string) => {
      output = `${output}${chunk}`.slice(-64 * 1024);
      const urls = output.match(/https:\/\/[^\s\u2500-\u257f]+/g) ?? [];
      const authorizationUrl = urls.at(-1)?.replace(/[),.;]+$/, '');
      if (authorizationUrl && authorizationUrl !== reportedUrl) {
        reportedUrl = authorizationUrl;
        updates = updates.then(() => request.onChallenge({ authorizationUrl }));
      }
    };
    const initialized = await this.runtime.executeAuthorization({
      provider: this.provider,
      profileKey,
      args: ['config', 'init', '--new', '--brand', 'feishu'],
      outputMode: 'json',
      timeoutMs: 11 * 60 * 1000,
      maxOutputBytes: 1024 * 1024,
      signal: request.signal,
      onStdout: observe,
      onStderr: observe,
    });
    await updates;
    requireProcessSuccess(initialized);
    if (!reportedUrl) {
      throw new Error('Lark CLI did not return an app registration URL');
    }
  }

  private isNotConfigured(result: EnterpriseCliProcessResult) {
    for (const candidate of [result.data, result.stdout, result.stderr]) {
      let value = candidate;
      if (typeof candidate === 'string') {
        try {
          value = JSON.parse(candidate);
        } catch {
          continue;
        }
      }
      const root = asRecord(value);
      const error = asRecord(root?.error);
      if (error?.type === 'config' && error?.subtype === 'not_configured') {
        return true;
      }
    }
    return false;
  }

  async authStatus(
    profileKey: string,
    signal?: AbortSignal
  ): Promise<EnterpriseAuthStatus> {
    const result = await this.runtime.execute({
      provider: this.provider,
      profileKey,
      args: ['auth', 'status', '--json'],
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
      signal,
    });
    const root = asRecord(result.data);
    const identity = asString(root?.identity);
    const authorized =
      result.exitCode === 0 &&
      (identity === 'user' || identity === 'bot') &&
      root?.verified !== false;
    return {
      authorized,
      status: authorized ? 'active' : 'reauth_required',
      identityType: identity,
    };
  }

  async discoverTools(profileKey: string, signal?: AbortSignal) {
    const result = await this.runtime.execute({
      provider: this.provider,
      profileKey,
      args: ['schema'],
      maxOutputBytes: 4 * 1024 * 1024,
      timeoutMs: 60_000,
      signal,
    });
    requireProcessSuccess(result);
    const tools: EnterpriseToolDefinition[] = [];
    for (const envelopeValue of asArray(result.data)) {
      const envelope = asRecord(envelopeValue);
      const commandName = asString(envelope?.name);
      const inputSchema = asRecord(envelope?.inputSchema);
      if (!commandName || !inputSchema) continue;
      const command = commandName.split(/\s+/).filter(Boolean);
      const metadata = asRecord(envelope?._meta);
      const risk = classifyCommandRisk(command, asString(metadata?.risk));
      tools.push({
        name: toolName('lark', command),
        command,
        description:
          asString(envelope?.description) ??
          `Run the Lark ${command.join(' ')} command`,
        inputSchema,
        risk,
        requiresConfirmation: risk !== 'read',
        supportsDryRun: true,
      });
    }
    const shortcuts = await this.discoverShortcutTools(profileKey, signal);
    const merged = new Map(tools.map(tool => [tool.name, tool]));
    for (const shortcut of shortcuts) merged.set(shortcut.name, shortcut);
    return [...merged.values()];
  }

  async execute(profileKey: string, call: EnterpriseToolCall) {
    requireExecutableCall(call.tool, call.arguments, call.confirmed);
    const input = { ...call.arguments };
    delete input.yes;
    const args = [
      ...call.tool.command,
      ...this.argumentsToFlags(input, call.tool.inputSchema),
      '--format',
      'json',
    ];
    if (call.confirmed && call.tool.requiresConfirmation) args.push('--yes');
    const result = await this.runtime.execute({
      provider: this.provider,
      profileKey,
      args,
      signal: call.signal,
      timeoutMs: 60_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    requireProcessSuccess(result);
    const root = asRecord(result.data);
    if (root?.ok === false) requireProcessSuccess({ ...result, exitCode: 1 });
    const data = root?.ok === true && 'data' in root ? root.data : result.data;
    return {
      provider: this.provider,
      toolName: call.tool.name,
      data,
      resources: extractResourceRefs('lark', data),
      meta: {
        durationMs: result.durationMs,
        idempotencyKey: call.idempotencyKey,
      },
    };
  }

  private async discoverShortcutTools(
    profileKey: string,
    signal?: AbortSignal
  ): Promise<EnterpriseToolDefinition[]> {
    const root = await this.complete(profileKey, [], signal);
    const domains = root.filter(entry => !entry.value.startsWith('+'));
    const shortcutGroups = await this.mapConcurrent(
      domains,
      SHORTCUT_DISCOVERY_CONCURRENCY,
      async domain => {
        const entries = await this.complete(profileKey, [domain.value], signal);
        return entries
          .filter(entry => entry.value.startsWith('+'))
          .map(entry => ({ domain: domain.value, ...entry }));
      }
    );
    const shortcuts = shortcutGroups.flat();
    const definitions = await this.mapConcurrent(
      shortcuts,
      SHORTCUT_DISCOVERY_CONCURRENCY,
      async shortcut => {
        const command = [shortcut.domain, shortcut.value];
        const result = await this.runtime.execute({
          provider: this.provider,
          profileKey,
          args: [...command, '--help'],
          outputMode: 'text',
          timeoutMs: 15_000,
          maxOutputBytes: 256 * 1024,
          signal,
        });
        if (result.exitCode !== 0) return null;
        const help = this.textOutput(result);
        const inputSchema = this.shortcutInputSchema(help);
        const declaredRisk = help.match(/^Risk:\s*([^\r\n]+)/im)?.[1];
        const risk = classifyCommandRisk(command, declaredRisk);
        return {
          name: toolName('lark', command),
          command,
          description:
            this.helpSummary(help) ??
            shortcut.description ??
            `Run the Lark ${command.join(' ')} command`,
          inputSchema,
          risk,
          requiresConfirmation: risk !== 'read',
          supportsDryRun: 'dryRun' in (asRecord(inputSchema.properties) ?? {}),
        } satisfies EnterpriseToolDefinition;
      }
    );
    return definitions.filter(
      (tool): tool is Exclude<(typeof definitions)[number], null> =>
        tool !== null
    );
  }

  private async complete(
    profileKey: string,
    command: string[],
    signal?: AbortSignal
  ): Promise<LarkCompletionEntry[]> {
    const result = await this.runtime.execute({
      provider: this.provider,
      profileKey,
      args: ['__complete', ...command, ''],
      outputMode: 'text',
      timeoutMs: 15_000,
      maxOutputBytes: 256 * 1024,
      signal,
    });
    if (result.exitCode !== 0) return [];
    return this.textOutput(result)
      .split(/\r?\n/)
      .map(line => {
        const [value, description] = line.split('\t', 2);
        return { value: value?.trim(), description: asString(description) };
      })
      .filter(
        (entry): entry is { value: string; description: string | undefined } =>
          Boolean(entry.value) &&
          /^[+a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(entry.value)
      );
  }

  private shortcutInputSchema(help: string): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const line of help.split(/\r?\n/)) {
      const match = line
        .trim()
        .match(
          /^(?:-\S+,\s+)?--([a-z0-9][a-z0-9-]*)(?:[ =]([^\s]+))?\s{2,}(.+)$/i
        );
      if (!match) continue;
      const [, flag, cliType, rawDescription] = match;
      if (
        SHORTCUT_FLAG_EXCLUSIONS.has(flag) ||
        (flag === 'json' &&
          !cliType &&
          /shorthand for --format json/i.test(rawDescription))
      ) {
        continue;
      }
      const name = flag.replace(/-([a-z0-9])/g, (_, value: string) =>
        value.toUpperCase()
      );
      properties[name] = {
        ...this.shortcutFlagSchema(cliType),
        description: rawDescription.trim(),
      };
      if (
        /\(required\)/i.test(rawDescription) &&
        !/(mutually exclusive|one of|when using|required when)/i.test(
          rawDescription
        )
      ) {
        required.push(name);
      }
    }
    return {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }

  private shortcutFlagSchema(cliType?: string): Record<string, unknown> {
    const normalized = cliType?.toLowerCase();
    if (!normalized) return { type: 'boolean' };
    if (normalized.includes('array') || normalized.includes('slice')) {
      return { type: 'array', items: { type: 'string' } };
    }
    if (/^(u?int)(8|16|32|64)?$/.test(normalized)) {
      return { type: 'integer' };
    }
    if (/^(float)(32|64)?$/.test(normalized)) return { type: 'number' };
    return { type: 'string' };
  }

  private helpSummary(help: string) {
    return asString(
      help
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean)
    );
  }

  private textOutput(result: EnterpriseCliProcessResult) {
    return typeof result.data === 'string' ? result.data : result.stdout;
  }

  private async mapConcurrent<T, R>(
    values: T[],
    concurrency: number,
    callback: (value: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];
    results.length = values.length;
    let next = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, values.length) },
      async () => {
        while (next < values.length) {
          const index = next++;
          results[index] = await callback(values[index]);
        }
      }
    );
    await Promise.all(workers);
    return results;
  }

  private argumentsToFlags(
    input: Record<string, unknown>,
    inputSchema: Record<string, unknown>
  ) {
    const file = input.file;
    delete input.file;
    const properties = asRecord(inputSchema.properties) ?? {};
    const repeated: string[] = [];
    const regular: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const property = asRecord(properties[key]);
      if (property?.type === 'array' && Array.isArray(value)) {
        for (const item of value) {
          repeated.push(
            ...objectToFlags({ [key]: item as string | number | boolean })
          );
        }
      } else {
        regular[key] = value;
      }
    }
    const args = [...objectToFlags(regular), ...repeated];
    const files = asRecord(file);
    if (files) {
      for (const [field, value] of Object.entries(files)) {
        const paths = Array.isArray(value) ? value : [value];
        for (const filePath of paths) {
          if (typeof filePath === 'string' && filePath) {
            args.push('--file', `${field}=${filePath}`);
          }
        }
      }
    } else if (typeof file === 'string' && file) {
      args.push('--file', file);
    }
    return args;
  }
}
