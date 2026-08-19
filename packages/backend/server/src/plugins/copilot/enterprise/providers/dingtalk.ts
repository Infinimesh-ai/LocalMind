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
  objectToFlags,
  requireExecutableCall,
  requireProcessSuccess,
  toolName,
} from './shared';

@Injectable()
export class DingTalkCliDriver implements EnterpriseCliDriver {
  readonly provider = EnterpriseProvider.DINGTALK;

  private static readonly DEVICE_CODE_TTL_SECONDS = 10 * 60;
  private static readonly AUTHORIZATION_TIMEOUT_MS = 25 * 60 * 1000;
  private static readonly ADMIN_APPROVAL_PENDING_MARKER =
    'LOCALMIND_DINGTALK_ADMIN_APPROVAL_PENDING';
  private static readonly ANSI_ESCAPE_PATTERN = new RegExp(
    `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
    'g'
  );

  constructor(private readonly runtime: EnterpriseCliRuntime) {}

  async authorize(profileKey: string, request: EnterpriseAuthorizationRequest) {
    let output = '';
    let reportedUrl: string | undefined;
    let reportedCode: string | undefined;
    let reportedExpiresIn: number | undefined;
    let approvalPendingReported = false;
    let updates = Promise.resolve();
    const authorizationDeadline =
      Date.now() + DingTalkCliDriver.AUTHORIZATION_TIMEOUT_MS;
    const observe = (chunk: string) => {
      output = this.stripAnsi(`${output}${chunk}`).slice(-64 * 1024);
      const authorizationUrl = this.latestAuthorizationUrl(output);
      const userCode =
        this.userCodeFromUrl(authorizationUrl) ??
        this.latestMatch(
          output,
          /(?:授权码|authorization\s+code|verification\s+code|user\s+code)\s*:\s*([A-Z0-9-]+)/gi
        );
      const expiresIn = Math.min(
        this.latestPositiveInteger(
          output,
          /(?:授权码将在\s*|authorization\s+code\s+will\s+expire\s+in\s*)(\d+)\s*(?:秒后过期|seconds?)/gi
        ) ?? DingTalkCliDriver.DEVICE_CODE_TTL_SECONDS,
        DingTalkCliDriver.DEVICE_CODE_TTL_SECONDS
      );
      if (
        authorizationUrl &&
        (authorizationUrl !== reportedUrl ||
          userCode !== reportedCode ||
          expiresIn !== reportedExpiresIn)
      ) {
        reportedUrl = authorizationUrl;
        reportedCode = userCode;
        reportedExpiresIn = expiresIn;
        updates = updates.then(() =>
          request.onChallenge({
            authorizationUrl,
            userCode,
            expiresAt: new Date(
              Math.min(Date.now() + expiresIn * 1000, authorizationDeadline)
            ),
          })
        );
      }
      if (
        !approvalPendingReported &&
        output.includes(DingTalkCliDriver.ADMIN_APPROVAL_PENDING_MARKER)
      ) {
        approvalPendingReported = true;
        updates = updates.then(() =>
          request.onChallenge({ clearPrevious: true })
        );
      }
    };
    const result = await this.runtime.executeAuthorization({
      provider: this.provider,
      profileKey,
      args: [
        'auth',
        'login',
        '--device',
        '--no-browser',
        '--recommend',
        '--format',
        'json',
      ],
      timeoutMs: DingTalkCliDriver.AUTHORIZATION_TIMEOUT_MS,
      maxOutputBytes: 1024 * 1024,
      dingtalkAutoApplyCliAccess: true,
      signal: request.signal,
      onStdout: observe,
      onStderr: observe,
    });
    await updates;
    requireProcessSuccess(result);
    const root = asRecord(result.data);
    if (root?.success !== true) {
      throw new Error('DingTalk CLI authorization did not complete');
    }
    return await this.authStatus(profileKey, request.signal);
  }

  async authStatus(
    profileKey: string,
    signal?: AbortSignal
  ): Promise<EnterpriseAuthStatus> {
    const result = await this.runtime.execute({
      provider: this.provider,
      profileKey,
      args: ['auth', 'status', '--format', 'json'],
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
      signal,
    });
    const root = asRecord(result.data);
    const authorized =
      result.exitCode === 0 &&
      (root?.authenticated === true ||
        root?.authorized === true ||
        root?.status === 'authenticated');
    return {
      authorized,
      status: authorized ? 'active' : 'reauth_required',
      externalTenantId: asString(root?.corpId) ?? asString(root?.corp_id),
      externalUserId: asString(root?.userId) ?? asString(root?.user_id),
    };
  }

  async discoverTools(profileKey: string, signal?: AbortSignal) {
    const result = await this.runtime.execute({
      provider: this.provider,
      profileKey,
      args: ['schema', '--all', '--compact', '--format', 'json'],
      maxOutputBytes: 4 * 1024 * 1024,
      timeoutMs: 60_000,
      signal,
    });
    requireProcessSuccess(result);
    const root = asRecord(result.data);
    const tools: EnterpriseToolDefinition[] = [];
    for (const productValue of asArray(root?.products)) {
      const product = asRecord(productValue);
      for (const toolValue of asArray(product?.tools)) {
        const item = asRecord(toolValue);
        const cliPath = asString(item?.cli_path);
        if (!cliPath || item?.availability === 'unavailable') continue;
        const command = cliPath.split(/\s+/).filter(Boolean);
        const declaredRisk = asString(item?.risk);
        const effect = asString(item?.effect);
        let risk = classifyCommandRisk(command, declaredRisk);
        if (risk === 'read' && effect && effect !== 'read') {
          risk = classifyCommandRisk(command, effect);
        }
        const confirmation = asString(item?.confirmation);
        const parameters = asRecord(item?.parameters) ?? {};
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [name, parameterValue] of Object.entries(parameters)) {
          const parameter = asRecord(parameterValue) ?? {};
          properties[name] = this.parameterSchema(parameter);
          if (parameter.required === true || parameter.cli_required === true) {
            required.push(name);
          }
        }
        tools.push({
          name: toolName('dingtalk', command),
          command,
          description:
            asString(item?.agent_summary) ??
            asString(item?.description) ??
            `Run the DingTalk ${cliPath} command`,
          inputSchema: {
            type: 'object',
            properties,
            ...(required.length ? { required } : {}),
            additionalProperties: false,
          },
          risk,
          requiresConfirmation:
            risk !== 'read' ||
            confirmation === 'required' ||
            confirmation === 'user_required',
          supportsDryRun:
            item?.dry_run === true || asRecord(item?.dry_run) !== null,
        });
      }
    }
    return tools;
  }

  async execute(profileKey: string, call: EnterpriseToolCall) {
    requireExecutableCall(call.tool, call.arguments, call.confirmed);
    const args = [
      ...call.tool.command,
      ...objectToFlags(call.arguments),
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
    return {
      provider: this.provider,
      toolName: call.tool.name,
      data: result.data,
      resources: extractResourceRefs('dingtalk', result.data),
      meta: {
        durationMs: result.durationMs,
        idempotencyKey: call.idempotencyKey,
      },
    };
  }

  private parameterSchema(parameter: Record<string, unknown>) {
    const type = asString(parameter.type) ?? 'string';
    return {
      type: [
        'string',
        'number',
        'integer',
        'boolean',
        'array',
        'object',
      ].includes(type)
        ? type
        : 'string',
      ...(asString(parameter.description)
        ? { description: asString(parameter.description) }
        : {}),
      ...(Array.isArray(parameter.enum) ? { enum: parameter.enum } : {}),
      ...(parameter.default !== undefined
        ? { default: parameter.default }
        : {}),
    };
  }

  private stripAnsi(value: string) {
    return value.replace(DingTalkCliDriver.ANSI_ESCAPE_PATTERN, '');
  }

  private latestMatch(value: string, pattern: RegExp) {
    return [...value.matchAll(pattern)].at(-1)?.[1];
  }

  private latestPositiveInteger(value: string, pattern: RegExp) {
    const parsed = Number(this.latestMatch(value, pattern));
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  private latestAuthorizationUrl(value: string) {
    const urls = value.match(/https:\/\/[^\s│┃┌┐└┘]+/g) ?? [];
    for (const raw of urls.reverse()) {
      try {
        const url = new URL(raw.replace(/[),.;]+$/, ''));
        if (
          url.hostname === 'login.dingtalk.com' &&
          (url.pathname === '/oauth2/device/verify.htm' ||
            url.pathname === '/oauth/device')
        ) {
          return url.toString();
        }
        if (
          url.hostname === 'open-dev.dingtalk.com' &&
          url.pathname === '/fe/old' &&
          this.isPersonalAuthorizationUrl(url)
        ) {
          return url.toString();
        }
      } catch {
        // Continue scanning earlier CLI output for an authorization URL.
      }
    }
    return undefined;
  }

  private userCodeFromUrl(value?: string) {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      const direct =
        url.searchParams.get('user_code') ?? url.searchParams.get('userCode');
      if (direct) return direct;
      for (const rawRoute of [url.hash, url.searchParams.get('hash') ?? '']) {
        let route = rawRoute;
        for (let index = 0; index < 2; index++) {
          try {
            route = decodeURIComponent(route);
          } catch {
            break;
          }
        }
        const queryIndex = route.indexOf('?');
        if (queryIndex < 0) continue;
        const code = new URLSearchParams(route.slice(queryIndex + 1)).get(
          'userCode'
        );
        if (code) return code;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private isPersonalAuthorizationUrl(url: URL) {
    for (const rawRoute of [url.hash, url.searchParams.get('hash') ?? '']) {
      let route = rawRoute;
      try {
        route = decodeURIComponent(route);
      } catch {
        // The fragment can already be decoded.
      }
      if (route.includes('personalAuthorization')) return true;
    }
    return false;
  }
}
