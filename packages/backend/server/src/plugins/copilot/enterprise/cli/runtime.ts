import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { Injectable } from '@nestjs/common';
import { EnterpriseProvider } from '@prisma/client';

import { Config } from '../../../../base';

const PROFILE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const TERMINATION_GRACE_MS = 1_000;
const MAX_AUTHORIZATION_TIMEOUT_MS = 30 * 60 * 1000;
const PROFILE_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export type EnterpriseCliOutputMode = 'json' | 'ndjson' | 'text';

export type EnterpriseCliProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  data: unknown;
  durationMs: number;
};

type EnterpriseCliExecuteInput = {
  provider: EnterpriseProvider;
  profileKey: string;
  args: string[];
  outputMode?: EnterpriseCliOutputMode;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  dingtalkAutoApplyCliAccess?: boolean;
};

export class EnterpriseCliRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

@Injectable()
export class EnterpriseCliRuntime {
  constructor(private readonly config: Config) {}

  execute(input: EnterpriseCliExecuteInput) {
    return this.executeProcess(input, 120_000);
  }

  executeAuthorization(input: EnterpriseCliExecuteInput) {
    return this.executeProcess(input, MAX_AUTHORIZATION_TIMEOUT_MS);
  }

  private async executeProcess(
    input: EnterpriseCliExecuteInput,
    maximumTimeoutMs: number
  ): Promise<EnterpriseCliProcessResult> {
    if (!this.config.copilot.enterpriseCli.enabled) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_disabled',
        'Enterprise CLI integrations are disabled'
      );
    }
    this.assertProfileKey(input.profileKey);
    this.assertArgs(input.args);
    if (
      input.dingtalkAutoApplyCliAccess &&
      input.provider !== EnterpriseProvider.DINGTALK
    ) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_invalid_environment',
        'DingTalk CLI authorization options require the DingTalk provider'
      );
    }
    if (input.signal?.aborted) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_aborted',
        'Enterprise CLI execution was cancelled'
      );
    }

    const binary = this.binaryFor(input.provider);
    const profileDir = this.profileDirectory(input.provider, input.profileKey);
    const tempDir = path.join(profileDir, 'tmp');
    await mkdir(tempDir, { recursive: true, mode: 0o700 });

    const startedAt = Date.now();
    const timeoutMs = this.boundedPositiveInteger(
      input.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      1_000,
      maximumTimeoutMs
    );
    const maxOutputBytes = this.boundedPositiveInteger(
      input.maxOutputBytes,
      DEFAULT_MAX_OUTPUT_BYTES,
      1024,
      4 * 1024 * 1024
    );
    const processResult = await this.spawnBounded({
      binary,
      args: input.args,
      cwd: profileDir,
      env: this.childEnvironment(
        input.provider,
        profileDir,
        tempDir,
        input.dingtalkAutoApplyCliAccess
      ),
      timeoutMs,
      maxOutputBytes,
      signal: input.signal,
      onStdout: input.onStdout,
      onStderr: input.onStderr,
    });
    const outputMode = input.outputMode ?? 'json';
    const data =
      processResult.exitCode === 0
        ? this.parseOutput(processResult.stdout, outputMode)
        : this.parseFailedOutput(processResult.stdout, outputMode);
    return {
      ...processResult,
      data,
      durationMs: Date.now() - startedAt,
    };
  }

  profileDirectory(provider: EnterpriseProvider, profileKey: string) {
    this.assertProfileKey(profileKey);
    const root = path.resolve(this.config.copilot.enterpriseCli.rootDir);
    return path.join(root, provider.toLowerCase(), profileKey);
  }

  async removeProfile(provider: EnterpriseProvider, profileKey: string) {
    await rm(this.profileDirectory(provider, profileKey), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }

  async readProfileFile(
    provider: EnterpriseProvider,
    profileKey: string,
    fileName: string,
    maxBytes = 512 * 1024
  ) {
    this.assertProfileFileName(fileName);
    const data = await readFile(
      path.join(this.profileDirectory(provider, profileKey), fileName)
    );
    if (data.byteLength > maxBytes) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_profile_file_too_large',
        'Enterprise CLI profile file exceeded the configured limit'
      );
    }
    return data;
  }

  async removeProfileFile(
    provider: EnterpriseProvider,
    profileKey: string,
    fileName: string
  ) {
    this.assertProfileFileName(fileName);
    await rm(path.join(this.profileDirectory(provider, profileKey), fileName), {
      force: true,
    });
  }

  private binaryFor(provider: EnterpriseProvider) {
    const binaries = this.config.copilot.enterpriseCli.binaries;
    switch (provider) {
      case EnterpriseProvider.WECOM:
        return binaries.wecom;
      case EnterpriseProvider.LARK:
        return binaries.lark;
      case EnterpriseProvider.DINGTALK:
        return binaries.dingtalk;
    }
  }

  private childEnvironment(
    provider: EnterpriseProvider,
    profileDir: string,
    tempDir: string,
    dingtalkAutoApplyCliAccess = false
  ) {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      LANG: process.env.LANG ?? 'C.UTF-8',
      LC_ALL: process.env.LC_ALL,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      SSL_CERT_DIR: process.env.SSL_CERT_DIR,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      HTTP_PROXY: process.env.HTTP_PROXY,
      NO_PROXY: process.env.NO_PROXY,
      TMPDIR: tempDir,
    };
    switch (provider) {
      case EnterpriseProvider.WECOM:
        env.WECOM_CLI_CONFIG_DIR = profileDir;
        env.WECOM_CLI_TMP_DIR = tempDir;
        break;
      case EnterpriseProvider.LARK:
        env.LARKSUITE_CLI_CONFIG_DIR = profileDir;
        env.LARKSUITE_CLI_DATA_DIR = path.join(profileDir, 'data');
        break;
      case EnterpriseProvider.DINGTALK:
        env.DWS_CONFIG_DIR = profileDir;
        env.DWS_KEYCHAIN_DIR = path.join(profileDir, 'keychain');
        if (dingtalkAutoApplyCliAccess) {
          env.DWS_CLI_AUTH_AUTO_APPLY = '1';
        }
        break;
    }
    return env;
  }

  private spawnBounded(input: {
    binary: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxOutputBytes: number;
    signal?: AbortSignal;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  }): Promise<Omit<EnterpriseCliProcessResult, 'data' | 'durationMs'>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let terminalError: EnterpriseCliRuntimeError | null = null;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let totalBytes = 0;
      const child = spawn(input.binary, input.args, {
        cwd: input.cwd,
        env: input.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const terminate = (error: EnterpriseCliRuntimeError) => {
        if (terminalError) return;
        terminalError = error;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), TERMINATION_GRACE_MS).unref();
      };
      const append = (target: Buffer[], chunk: Buffer) => {
        totalBytes += chunk.byteLength;
        if (totalBytes > input.maxOutputBytes) {
          terminate(
            new EnterpriseCliRuntimeError(
              'enterprise_cli_output_too_large',
              'Enterprise CLI output exceeded the configured limit'
            )
          );
          return;
        }
        target.push(chunk);
      };
      child.stdout.on('data', chunk => {
        const buffer = Buffer.from(chunk);
        append(stdout, buffer);
        input.onStdout?.(buffer.toString('utf8'));
      });
      child.stderr.on('data', chunk => {
        const buffer = Buffer.from(chunk);
        append(stderr, buffer);
        input.onStderr?.(buffer.toString('utf8'));
      });

      const timeout = setTimeout(
        () =>
          terminate(
            new EnterpriseCliRuntimeError(
              'enterprise_cli_timeout',
              'Enterprise CLI execution timed out'
            )
          ),
        input.timeoutMs
      );
      timeout.unref();
      const onAbort = () =>
        terminate(
          new EnterpriseCliRuntimeError(
            'enterprise_cli_aborted',
            'Enterprise CLI execution was cancelled'
          )
        );
      input.signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        clearTimeout(timeout);
        input.signal?.removeEventListener('abort', onAbort);
      };
      child.once('error', error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new EnterpriseCliRuntimeError(
            (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? 'enterprise_cli_not_found'
              : 'enterprise_cli_spawn_failed',
            (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? 'Enterprise CLI binary is not installed'
              : 'Enterprise CLI process could not be started'
          )
        );
      });
      child.once('close', code => {
        if (settled) return;
        settled = true;
        cleanup();
        if (terminalError) {
          reject(terminalError);
          return;
        }
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8').trim(),
          stderr: Buffer.concat(stderr).toString('utf8').trim(),
        });
      });
    });
  }

  private parseOutput(raw: string, mode: EnterpriseCliOutputMode) {
    if (mode === 'text') return raw;
    if (!raw) return null;
    try {
      if (mode === 'ndjson') {
        return raw
          .split(/\r?\n/)
          .filter(Boolean)
          .map(line => JSON.parse(line));
      }
      return JSON.parse(raw);
    } catch {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_invalid_json',
        'Enterprise CLI returned invalid structured output'
      );
    }
  }

  private parseFailedOutput(raw: string, mode: EnterpriseCliOutputMode) {
    if (mode === 'text' || !raw) return raw || null;
    try {
      return this.parseOutput(raw, mode);
    } catch {
      // The driver still needs the original stdout/stderr to report CLI failures.
      return null;
    }
  }

  private assertProfileKey(profileKey: string) {
    if (!PROFILE_KEY_PATTERN.test(profileKey)) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_invalid_profile',
        'Enterprise CLI profile key is invalid'
      );
    }
  }

  private assertArgs(args: string[]) {
    if (
      !args.length ||
      args.length > 256 ||
      args.some(
        arg =>
          typeof arg !== 'string' ||
          arg.includes('\0') ||
          Buffer.byteLength(arg) > 256 * 1024
      )
    ) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_invalid_arguments',
        'Enterprise CLI arguments are invalid'
      );
    }
  }

  private assertProfileFileName(fileName: string) {
    if (!PROFILE_FILE_PATTERN.test(fileName)) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_invalid_profile_file',
        'Enterprise CLI profile file name is invalid'
      );
    }
  }

  private boundedPositiveInteger(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number
  ) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_invalid_limit',
        'Enterprise CLI execution limit is invalid'
      );
    }
    return value;
  }
}
