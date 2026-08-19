import { Injectable } from '@nestjs/common';
import { EnterpriseProvider } from '@prisma/client';

import { EnterpriseCliRuntime } from '../cli/runtime';
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
  requireExecutableCall,
  requireProcessSuccess,
  toolName,
} from './shared';

@Injectable()
export class WeComCliDriver implements EnterpriseCliDriver {
  readonly provider = EnterpriseProvider.WECOM;

  constructor(private readonly runtime: EnterpriseCliRuntime) {}

  async authorize(profileKey: string, request: EnterpriseAuthorizationRequest) {
    const authorizationQrCode = request.qrCodePath ?? 'authorization.png';
    await this.runtime.removeProfileFile(
      this.provider,
      profileKey,
      authorizationQrCode
    );
    let output = '';
    let authorizationUrl: string | undefined;
    let urlReported = false;
    let qrReported = false;
    let updates = Promise.resolve();
    const observe = (chunk: string) => {
      output = `${output}${chunk}`.slice(-64 * 1024);
      authorizationUrl =
        authorizationUrl ??
        output
          .match(/https:\/\/work\.weixin\.qq\.com\/[^\s]+/)?.[0]
          ?.replace(/[),.;，。]+$/, '');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      if (authorizationUrl && !urlReported) {
        urlReported = true;
        updates = updates.then(() =>
          request.onChallenge({ authorizationUrl, expiresAt })
        );
      }
      if (
        authorizationUrl &&
        !qrReported &&
        output.includes('二维码已保存到')
      ) {
        qrReported = true;
        updates = updates.then(() =>
          request.onChallenge({
            authorizationUrl,
            qrCodePath: authorizationQrCode,
            expiresAt,
          })
        );
      }
    };
    const result = await this.runtime.executeAuthorization({
      provider: this.provider,
      profileKey,
      args: [
        'auth',
        'init',
        '--noninteractive',
        '--no-browser',
        '--output-qrcode',
        authorizationQrCode,
      ],
      outputMode: 'text',
      timeoutMs: 6 * 60 * 1000,
      maxOutputBytes: 1024 * 1024,
      signal: request.signal,
      onStdout: observe,
      onStderr: observe,
    });
    await updates;
    requireProcessSuccess(result);
    return await this.authStatus(profileKey, request.signal);
  }

  async authStatus(
    profileKey: string,
    signal?: AbortSignal
  ): Promise<EnterpriseAuthStatus> {
    const result = await this.runtime.execute({
      provider: this.provider,
      profileKey,
      args: ['auth', 'show', '--status'],
      outputMode: 'text',
      timeoutMs: 10_000,
      maxOutputBytes: 16 * 1024,
      signal,
    });
    const authorized = result.exitCode === 0 && result.stdout === 'authorized';
    return {
      authorized,
      status: authorized ? 'active' : 'reauth_required',
    };
  }

  async discoverTools(profileKey: string, signal?: AbortSignal) {
    const result = await this.runtime.execute({
      provider: this.provider,
      profileKey,
      args: ['schema', 'list'],
      maxOutputBytes: 4 * 1024 * 1024,
      timeoutMs: 60_000,
      signal,
    });
    requireProcessSuccess(result);
    const tools: EnterpriseToolDefinition[] = [];
    for (const serviceValue of asArray(result.data)) {
      const service = asRecord(serviceValue);
      const serviceName = asString(service?.name);
      if (!serviceName) continue;
      for (const methodValue of asArray(service?.methods)) {
        const method = asRecord(methodValue);
        const methodName = asString(method?.name);
        if (!methodName) continue;
        const command = methodName.split('.').filter(Boolean);
        if (command[0] !== serviceName) command.unshift(serviceName);
        const risk = this.classifyRisk(command);
        tools.push({
          name: toolName('wecom', command),
          command,
          description:
            asString(method?.description) ??
            `Run the WeCom ${command.join(' ')} command`,
          inputSchema: {
            type: 'object',
            properties: {
              payload: {
                type: 'object',
                description: 'Request body accepted by the WeCom command',
                additionalProperties: true,
              },
              pageCount: {
                type: 'integer',
                minimum: 1,
                maximum: 20,
                description: 'Optional cursor page limit',
              },
            },
            additionalProperties: false,
          },
          risk,
          requiresConfirmation: risk !== 'read',
          supportsDryRun: true,
        });
      }
    }
    return tools;
  }

  async execute(profileKey: string, call: EnterpriseToolCall) {
    requireExecutableCall(call.tool, call.arguments, call.confirmed);
    const payload = asRecord(call.arguments.payload) ?? {};
    const args = [...call.tool.command, '--json', JSON.stringify(payload)];
    const pageCount = call.arguments.pageCount;
    if (
      typeof pageCount === 'number' &&
      Number.isSafeInteger(pageCount) &&
      pageCount >= 1 &&
      pageCount <= 20
    ) {
      args.push('--page-count', String(pageCount));
    }
    const result = await this.runtime.execute({
      provider: this.provider,
      profileKey,
      args,
      outputMode: pageCount ? 'ndjson' : 'json',
      signal: call.signal,
      timeoutMs: 60_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    requireProcessSuccess(result);
    return {
      provider: this.provider,
      toolName: call.tool.name,
      data: result.data,
      resources: extractResourceRefs('wecom', result.data),
      meta: {
        durationMs: result.durationMs,
        idempotencyKey: call.idempotencyKey,
      },
    };
  }

  private classifyRisk(command: string[]) {
    const leaf = command.at(-1)?.toLowerCase();
    const readLeaves = new Set([
      'detail',
      'download',
      'get',
      'info',
      'list',
      'query',
      'read',
      'search',
      'show',
      'status',
    ]);
    if (leaf && readLeaves.has(leaf))
      return classifyCommandRisk(command, 'read');
    const classified = classifyCommandRisk(command);
    return classified === 'read' ? ('write' as const) : classified;
  }
}
