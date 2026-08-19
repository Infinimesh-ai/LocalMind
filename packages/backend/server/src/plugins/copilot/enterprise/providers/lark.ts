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
    return tools;
  }

  async execute(profileKey: string, call: EnterpriseToolCall) {
    requireExecutableCall(call.tool, call.arguments, call.confirmed);
    const input = { ...call.arguments };
    delete input.yes;
    const args = [
      ...call.tool.command,
      ...this.argumentsToFlags(input),
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

  private argumentsToFlags(input: Record<string, unknown>) {
    const file = input.file;
    delete input.file;
    const args = objectToFlags(input);
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
