#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants as fsConstants, existsSync } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultComposeFile = join(
  repoRoot,
  '.docker/selfhost/compose.localmind.yml'
);
const modelScopeHelper = join(
  repoRoot,
  'tools/localmind-model-runtime/modelscope.py'
);
const supportedCommands = new Set([
  'preflight',
  'discover',
  'up',
  'status',
  'stop',
]);

const profileDefinitions = {
  qwen36: {
    displayName: 'Qwen3.6 local vLLM',
    providerId: 'qwen-lan',
    servedModelName: 'qwen3.6-35b-a3b',
    vllmArgs: [
      '--max-num-seqs',
      '1',
      '--language-model-only',
      '--enable-auto-tool-choice',
      '--tool-call-parser',
      'qwen3_xml',
      '--default-chat-template-kwargs',
      '{"enable_thinking":false}',
    ],
  },
  qwen35: {
    displayName: 'Qwen3.5 local vLLM',
    providerId: 'qwen-lan',
    servedModelName: 'qwen3.5-35b-a3b',
    vllmArgs: [
      '--max-num-seqs',
      '1',
      '--language-model-only',
      '--enable-auto-tool-choice',
      '--tool-call-parser',
      'qwen3_coder',
      '--default-chat-template-kwargs',
      '{"enable_thinking":false}',
    ],
  },
  generic: {
    displayName: 'Local vLLM',
    providerId: 'local-vllm',
    vllmArgs: [],
  },
};

class CliError extends Error {
  constructor(message, exitCode = 1, details) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.details = details;
  }
}

function usage() {
  return `LocalMind local model runtime

Usage:
  yarn localmind:model preflight [options]
  yarn localmind:model discover --model <modelscope-id> --revision <revision>
  yarn localmind:model up (--model <modelscope-id> --revision <revision> | --model-dir <path>) [options]
  yarn localmind:model status [options]
  yarn localmind:model stop [options]

Model options:
  --model <id>                 ModelScope model id
  --revision <revision>        Required ModelScope revision
  --model-root <path>          Optional ModelScope cache_dir override
  --model-dir <path>           Existing local snapshot; skips ModelScope
  --served-model-name <id>     Stable vLLM model id (must not contain /)
  --profile <auto|qwen36|qwen35|generic>
  --provider-id <id>           LocalMind provider profile id

Runtime options:
  --port <port>                vLLM port (default: 8000)
  --vllm-bin <path>            vLLM executable (default: vllm)
  --python-bin <path>          Python executable (default: python3)
  --max-model-len <tokens>     Optional vLLM limit; no large default is assumed
  --gpu-memory-utilization <n> Optional vLLM GPU memory fraction
  --tensor-parallel-size <n>   Optional vLLM tensor parallel size
  --vllm-arg <arg>             Extra vLLM argument; may be repeated
  --timeout <seconds>          Readiness timeout (default: 900)

LocalMind options:
  --config-path <path>         Override LocalMind config.json
  --compose-file <path>        Override Compose file
  --localmind-url <url>        Host-side readiness URL
  --build | --no-build         Force or disable image build (default: auto)
  --make-default | --no-make-default
  --dry-run                    Print the plan without downloads or writes
  --json                       Emit a machine-readable final result
  --help

All commands operate on the current checkout. They never clone, pull, switch,
merge, commit, or push Git branches.`;
}

function positiveInteger(name, value, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new CliError(
      `${name} must be an integer between 1 and ${maximum}`,
      2
    );
  }
  return parsed;
}

function fraction(name, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new CliError(`${name} must be greater than 0 and at most 1`, 2);
  }
  return parsed;
}

export function parseCli(argv) {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    return { command: 'help' };
  }
  if (!supportedCommands.has(command)) {
    throw new CliError(`Unknown command: ${command}`, 2);
  }

  const options = {
    build: null,
    command,
    composeFile: defaultComposeFile,
    dryRun: false,
    json: false,
    makeDefault: true,
    port: Number(process.env.LOCALMIND_MODEL_PORT ?? 8000),
    profile: 'auto',
    pythonBin: process.env.LOCALMIND_PYTHON_BIN || 'python3',
    timeoutMs: 900_000,
    vllmArgs: [],
    vllmBin: process.env.LOCALMIND_VLLM_BIN || 'vllm',
  };
  const valueOptions = new Map([
    ['--model', 'model'],
    ['--revision', 'revision'],
    ['--model-root', 'modelRoot'],
    ['--model-dir', 'modelDir'],
    ['--served-model-name', 'servedModelName'],
    ['--profile', 'profile'],
    ['--provider-id', 'providerId'],
    ['--port', 'port'],
    ['--vllm-bin', 'vllmBin'],
    ['--python-bin', 'pythonBin'],
    ['--timeout', 'timeout'],
    ['--config-path', 'configPath'],
    ['--compose-file', 'composeFile'],
    ['--localmind-url', 'localmindUrl'],
    ['--max-model-len', 'maxModelLen'],
    ['--gpu-memory-utilization', 'gpuMemoryUtilization'],
    ['--tensor-parallel-size', 'tensorParallelSize'],
    ['--vllm-arg', 'vllmArg'],
  ]);

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      options.vllmArgs.push(...argv.slice(index + 1));
      break;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--build') {
      options.build = true;
      continue;
    }
    if (argument === '--no-build') {
      options.build = false;
      continue;
    }
    if (argument === '--make-default') {
      options.makeDefault = true;
      continue;
    }
    if (argument === '--no-make-default') {
      options.makeDefault = false;
      continue;
    }

    const key = valueOptions.get(argument);
    if (!key) throw new CliError(`Unknown option: ${argument}`, 2);
    if (index + 1 >= argv.length) {
      throw new CliError(`Missing value for ${argument}`, 2);
    }
    const value = argv[++index];
    if (key === 'vllmArg') options.vllmArgs.push(value);
    else options[key] = value;
  }

  options.port = positiveInteger('--port', options.port, 65_535);
  options.timeoutMs =
    positiveInteger(
      '--timeout',
      options.timeout ?? options.timeoutMs / 1000,
      86_400
    ) * 1000;
  if (options.maxModelLen !== undefined) {
    options.maxModelLen = positiveInteger(
      '--max-model-len',
      options.maxModelLen
    );
  }
  if (options.tensorParallelSize !== undefined) {
    options.tensorParallelSize = positiveInteger(
      '--tensor-parallel-size',
      options.tensorParallelSize
    );
  }
  if (options.gpuMemoryUtilization !== undefined) {
    options.gpuMemoryUtilization = fraction(
      '--gpu-memory-utilization',
      options.gpuMemoryUtilization
    );
  }
  if (!['auto', ...Object.keys(profileDefinitions)].includes(options.profile)) {
    throw new CliError(`Unsupported profile: ${options.profile}`, 2);
  }
  options.composeFile = resolve(options.composeFile);
  if (options.vllmBin.includes('/')) options.vllmBin = resolve(options.vllmBin);
  if (options.pythonBin.includes('/')) {
    options.pythonBin = resolve(options.pythonBin);
  }
  return options;
}

function createLogger(json) {
  const stream = json ? process.stderr : process.stdout;
  return {
    info(message) {
      stream.write(`${message}\n`);
    },
    warn(message) {
      process.stderr.write(`WARNING: ${message}\n`);
    },
  };
}

async function runCaptured(
  command,
  args,
  {
    cwd = repoRoot,
    env,
    forwardStderr = false,
    maxCaptureBytes = 2_000_000,
  } = {}
) {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const append = (current, chunk) =>
      Buffer.concat([current, chunk]).subarray(-maxCaptureBytes);
    child.stdout.on('data', chunk => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      if (forwardStderr) {
        process.stderr.write(chunk);
        stderr = Buffer.from(chunk).subarray(-maxCaptureBytes);
      } else {
        stderr = append(stderr, chunk);
      }
    });
    child.on('error', rejectRun);
    child.on('close', code => {
      resolveRun({
        code: code ?? 1,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
      });
    });
  });
}

async function run(command, args, { cwd = repoRoot, env, quiet = false } = {}) {
  const result = await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      stdio: quiet ? ['ignore', 'ignore', 'pipe'] : ['ignore', 2, 2],
    });
    const stderr = [];
    if (quiet) child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', rejectRun);
    child.on('close', code => {
      resolveRun({
        code: code ?? 1,
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim();
    throw new CliError(
      `${command} exited with code ${result.code}${detail ? `: ${detail.slice(0, 1000)}` : ''}`
    );
  }
}

async function executableExists(command) {
  const candidates = command.includes('/')
    ? [resolve(command)]
    : String(process.env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map(directory => join(directory, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

function nodeVersionSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major === 22 && minor >= 12;
}

async function checkCommand(name, command, args) {
  try {
    const result = await runCaptured(command, args);
    const output = (result.stdout || result.stderr)
      .trim()
      .split('\n')
      .filter(Boolean);
    return {
      name,
      ok: result.code === 0,
      detail: (result.code === 0 ? output[0] : output.at(-1)) || undefined,
    };
  } catch (error) {
    return { name, ok: false, detail: error.message };
  }
}

async function preflight(
  options,
  logger,
  { strict = true, vllmRequired = true } = {}
) {
  const packagePath = join(repoRoot, 'package.json');
  if (!existsSync(packagePath) || !existsSync(options.composeFile)) {
    throw new CliError(
      'Run this command from the LocalMind repository checkout'
    );
  }

  const checks = [
    {
      name: 'node',
      ok: nodeVersionSupported(),
      detail: `${process.version}; LocalMind requires >=22.12.0 <23`,
      warning: true,
    },
    await checkCommand('docker', 'docker', [
      'version',
      '--format',
      '{{.Server.Version}}',
    ]),
    await checkCommand('docker-compose', 'docker', [
      'compose',
      'version',
      '--short',
    ]),
  ];

  if (!options.modelDir) {
    checks.push(
      await checkCommand('modelscope', options.pythonBin, [
        '-c',
        'import modelscope; print("available")',
      ])
    );
  }

  const vllmPath = await executableExists(options.vllmBin);
  checks.push({
    name: 'vllm',
    ok: Boolean(vllmPath),
    detail: vllmPath ?? `${options.vllmBin} not found in PATH`,
    warning: !vllmRequired,
  });
  const gpu = await checkCommand('nvidia-gpu', 'nvidia-smi', [
    '--query-gpu=name,memory.total',
    '--format=csv,noheader',
  ]);
  checks.push({ ...gpu, warning: !vllmRequired && !gpu.ok });

  for (const check of checks) {
    const prefix = check.ok ? 'ok' : check.warning ? 'warning' : 'missing';
    logger.info(
      `[${prefix}] ${check.name}${check.detail ? `: ${check.detail}` : ''}`
    );
  }
  const failed = checks.filter(check => !check.ok && !check.warning);
  if (strict && failed.length) {
    throw new CliError(
      `Preflight failed: ${failed.map(check => check.name).join(', ')}`
    );
  }
  return { checks, ok: failed.length === 0 };
}

async function collectSnapshotFiles(root, depth = 1) {
  const files = [];
  async function visit(directory, remainingDepth) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && remainingDepth > 0) {
        await visit(path, remainingDepth - 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(path);
      }
    }
  }
  await visit(root, depth);
  return files;
}

function isWeightFile(name) {
  return (
    /\.(?:safetensors|bin|gguf|pt|pth)$/.test(name) ||
    /\.(?:safetensors|bin)\.index\.json$/.test(name)
  );
}

export async function validateModelSnapshot(modelDir) {
  const snapshotPath = await realpath(resolve(modelDir)).catch(() => null);
  if (!snapshotPath)
    throw new CliError(`Model directory does not exist: ${modelDir}`);
  const snapshotStat = await stat(snapshotPath);
  if (!snapshotStat.isDirectory()) {
    throw new CliError(`Model path is not a directory: ${snapshotPath}`);
  }

  const configPath = join(snapshotPath, 'config.json');
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw new CliError(
      `Invalid or missing model config.json: ${error.message}`
    );
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new CliError('Model config.json must contain an object');
  }

  const files = await collectSnapshotFiles(snapshotPath);
  const names = files.map(path => basename(path).toLowerCase());
  const hasWeights = names.some(isWeightFile);
  const hasTokenizer = names.some(name =>
    /^(?:tokenizer(?:_config)?\.json|tokenizer\.model|vocab\.json|vocab\.txt|merges\.txt|spiece\.model)$/.test(
      name
    )
  );
  if (!hasWeights) {
    throw new CliError(
      `No supported model weights found under ${snapshotPath}`
    );
  }
  if (!hasTokenizer) {
    throw new CliError(`No tokenizer files found under ${snapshotPath}`);
  }
  return {
    configPath,
    modelType: config.model_type,
    path: snapshotPath,
    tokenizerFiles: names.filter(name => name.includes('tokenizer')),
    weightFiles: names.filter(isWeightFile),
  };
}

function parseHelperResult(stdout) {
  const lines = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {}
  }
  throw new CliError('ModelScope helper did not return JSON');
}

async function callModelScope(options, download) {
  const args = [
    modelScopeHelper,
    '--model',
    options.model,
    '--revision',
    options.revision,
  ];
  if (options.modelRoot) args.push('--cache-dir', resolve(options.modelRoot));
  if (download) args.push('--download');
  const result = await runCaptured(options.pythonBin, args, {
    forwardStderr: download,
  });
  const payload = parseHelperResult(result.stdout);
  if (result.code !== 0 || payload.status === 'error') {
    throw new CliError(
      `ModelScope ${payload.kind ?? 'operation'} failed: ${payload.message ?? result.stderr.trim()}`,
      1,
      payload
    );
  }
  return payload;
}

async function resolveModel(options, logger, { allowDownload }) {
  if (options.modelDir) {
    const snapshot = await validateModelSnapshot(options.modelDir);
    return { ...snapshot, source: 'explicit' };
  }
  if (!options.model || !options.revision) {
    throw new CliError(
      'Provide --model and --revision, or provide an existing --model-dir',
      2
    );
  }

  logger.info(
    `Checking ModelScope cache for ${options.model}@${options.revision}`
  );
  const cached = await callModelScope(options, false);
  if (cached.status === 'found') {
    return {
      ...(await validateModelSnapshot(cached.path)),
      revision: options.revision,
      source: 'modelscope-cache',
    };
  }
  if (cached.status !== 'missing') {
    throw new CliError(`Unexpected ModelScope status: ${cached.status}`);
  }
  if (!allowDownload) {
    return {
      missing: true,
      model: options.model,
      revision: options.revision,
      source: 'modelscope-cache',
    };
  }

  logger.info(
    `Model is not cached; downloading ${options.model}@${options.revision}`
  );
  const downloaded = await callModelScope(options, true);
  if (downloaded.status !== 'downloaded' || !downloaded.path) {
    throw new CliError(
      `Unexpected ModelScope download status: ${downloaded.status}`
    );
  }
  return {
    ...(await validateModelSnapshot(downloaded.path)),
    revision: options.revision,
    source: 'modelscope-download',
  };
}

export function inferProfile(options, modelPath) {
  if (options.profile !== 'auto') return options.profile;
  const identity = `${options.model ?? ''} ${modelPath ?? ''}`.toLowerCase();
  if (identity.includes('qwen3.6')) return 'qwen36';
  if (identity.includes('qwen3.5')) return 'qwen35';
  return 'generic';
}

function defaultServedModelName(options, profile, modelPath) {
  if (options.servedModelName) return options.servedModelName;
  if (profileDefinitions[profile].servedModelName) {
    if (
      profile === 'qwen36' &&
      /fp8/i.test(`${options.model ?? ''} ${modelPath}`)
    ) {
      return 'qwen3.6-35b-a3b-fp8';
    }
    return profileDefinitions[profile].servedModelName;
  }
  const source = options.model?.split('/').at(-1) || basename(modelPath);
  return source
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateRuntimeIds(providerId, servedModelName) {
  if (!/^[a-zA-Z0-9-_]+$/.test(providerId)) {
    throw new CliError(`Invalid provider id: ${providerId}`, 2);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(servedModelName)) {
    throw new CliError(
      `Invalid served model name: ${servedModelName}; use a stable id without /`,
      2
    );
  }
}

export function buildVllmArgs(options, modelPath, profile, servedModelName) {
  const forbiddenExtraArgument = options.vllmArgs.find(
    argument =>
      /^(?:--served-model-name|--host|--port)(?:=|$)/.test(argument) ||
      (argument.startsWith('--') && /(?:key|secret|token)/i.test(argument))
  );
  if (forbiddenExtraArgument) {
    throw new CliError(
      `Do not pass ${forbiddenExtraArgument} through --vllm-arg; authentication and runtime identity flags are managed by this script`,
      2
    );
  }
  const args = [
    'serve',
    modelPath,
    '--served-model-name',
    servedModelName,
    '--host',
    '0.0.0.0',
    '--port',
    String(options.port),
    ...profileDefinitions[profile].vllmArgs,
  ];
  if (options.maxModelLen) {
    args.push('--max-model-len', String(options.maxModelLen));
  }
  if (options.gpuMemoryUtilization) {
    args.push('--gpu-memory-utilization', String(options.gpuMemoryUtilization));
  }
  if (options.tensorParallelSize) {
    args.push('--tensor-parallel-size', String(options.tensorParallelSize));
  }
  args.push(...options.vllmArgs);
  return args;
}

function redactCommandArgs(args) {
  let redactNext = false;
  return args.map(argument => {
    if (redactNext) {
      redactNext = false;
      return '<redacted>';
    }
    if (!/(?:key|secret|token)/i.test(argument)) return argument;
    const separator = argument.indexOf('=');
    if (separator >= 0) return `${argument.slice(0, separator + 1)}<redacted>`;
    redactNext = true;
    return argument;
  });
}

function fetchWithTimeout(url, init = {}, timeoutMs = 5_000) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function isPortOpen(port) {
  return await new Promise(resolveCheck => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => {
      socket.destroy();
      resolveCheck(value);
    };
    socket.setTimeout(750);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function fetchVllmModels(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}/models`);
  const text = await response.text();
  if (!response.ok) {
    throw new CliError(
      `vLLM /models returned HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }
  const body = JSON.parse(text);
  return Array.isArray(body.data)
    ? body.data.map(model => model?.id).filter(Boolean)
    : [];
}

async function probeVllmChat(baseUrl, servedModelName) {
  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        model: servedModelName,
        temperature: 0,
      }),
    },
    120_000
  );
  const text = await response.text();
  if (!response.ok) {
    throw new CliError(
      `vLLM chat probe returned HTTP ${response.status}: ${text.slice(0, 500)}`
    );
  }
  const body = JSON.parse(text);
  if (!Array.isArray(body.choices) || body.choices.length === 0) {
    throw new CliError('vLLM chat probe returned no choices');
  }
}

async function waitForVllm({ baseUrl, pid, servedModelName, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (pid && !processIsAlive(pid)) {
      throw new CliError(`vLLM process ${pid} exited before becoming ready`);
    }
    try {
      const models = await fetchVllmModels(baseUrl);
      if (models.includes(servedModelName)) return models;
      lastError = new Error(
        `served model ${servedModelName} not in [${models.join(', ')}]`
      );
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
  }
  throw new CliError(
    `vLLM did not become ready within ${Math.round(timeoutMs / 1000)}s: ${lastError?.message ?? 'unknown error'}`
  );
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    process.kill(pid, signal);
  }
}

async function writeAtomicText(path, text, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    await writeFile(temporary, text, { mode });
    await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function writeJson(path, value) {
  await writeAtomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new CliError(`Cannot read ${path}: ${error.message}`);
  }
}

function runtimePaths(composeFile) {
  const runtimeDir = join(dirname(composeFile), 'data/localmind/runtime');
  return {
    log: join(runtimeDir, 'vllm.log'),
    runtimeDir,
    state: join(runtimeDir, 'vllm.json'),
  };
}

async function startVllm(
  options,
  model,
  profile,
  servedModelName,
  providerId,
  logger
) {
  const paths = runtimePaths(options.composeFile);
  await mkdir(paths.runtimeDir, { recursive: true });
  const args = buildVllmArgs(options, model.path, profile, servedModelName);
  const log = await open(paths.log, 'a', 0o600);
  let child;
  try {
    await chmod(paths.log, 0o600);
    child = spawn(options.vllmBin, args, {
      cwd: repoRoot,
      detached: true,
      env: process.env,
      stdio: ['ignore', log.fd, log.fd],
    });
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn);
      child.once('error', rejectSpawn);
    });
  } finally {
    await log.close();
  }
  child.unref();
  const state = {
    args: redactCommandArgs(args),
    command: options.vllmBin,
    logPath: paths.log,
    managed: true,
    modelDir: model.path,
    modelSource: model.source,
    pid: child.pid,
    port: options.port,
    profile,
    providerId,
    servedModelName,
    startedAt: new Date().toISOString(),
    vllmBaseUrl: `http://127.0.0.1:${options.port}/v1`,
  };
  await writeJson(paths.state, state);
  logger.info(`Started vLLM pid ${child.pid}; log: ${paths.log}`);
  return state;
}

async function ensureVllm(
  options,
  model,
  profile,
  servedModelName,
  providerId,
  logger
) {
  const baseUrl = `http://127.0.0.1:${options.port}/v1`;
  if (await isPortOpen(options.port)) {
    let models;
    try {
      models = await fetchVllmModels(baseUrl);
    } catch (error) {
      throw new CliError(
        `Port ${options.port} is occupied, but it is not a usable vLLM endpoint: ${error.message}`
      );
    }
    if (!models.includes(servedModelName)) {
      throw new CliError(
        `Port ${options.port} serves [${models.join(', ')}], not ${servedModelName}`
      );
    }
    logger.info(`Reusing vLLM on port ${options.port}`);
    await probeVllmChat(baseUrl, servedModelName);
    const paths = runtimePaths(options.composeFile);
    const previous = await readJson(paths.state);
    const managed = Boolean(
      previous?.managed &&
      previous.port === options.port &&
      previous.servedModelName === servedModelName &&
      processIsAlive(previous.pid) &&
      (await processMatchesState(previous))
    );
    const state = {
      ...(managed ? previous : {}),
      managed,
      modelDir: model.path,
      modelSource: model.source,
      models,
      port: options.port,
      profile,
      providerId,
      reused: true,
      servedModelName,
      vllmBaseUrl: baseUrl,
    };
    await writeJson(paths.state, state);
    return state;
  }

  const state = await startVllm(
    options,
    model,
    profile,
    servedModelName,
    providerId,
    logger
  );
  try {
    const models = await waitForVllm({
      baseUrl,
      pid: state.pid,
      servedModelName,
      timeoutMs: options.timeoutMs,
    });
    await probeVllmChat(baseUrl, servedModelName);
    return { ...state, models, reused: false };
  } catch (error) {
    if (processIsAlive(state.pid)) {
      signalProcessGroup(state.pid, 'SIGTERM');
    }
    throw error;
  }
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function ensureEnvironment(composeFile, logger) {
  const composeDir = dirname(composeFile);
  const envPath = join(composeDir, '.env');
  let created = false;
  if (!existsSync(envPath)) {
    const examplePath = join(composeDir, '.env.example');
    let text = await readFile(examplePath, 'utf8');
    const password = randomBytes(32).toString('base64url');
    text = text.replace(/^DB_PASSWORD=.*$/m, `DB_PASSWORD=${password}`);
    await writeAtomicText(envPath, text);
    logger.info(`Created ${envPath} with a generated DB password`);
    created = true;
  }
  const text = await readFile(envPath, 'utf8');
  const env = parseEnv(text);
  if (!env.DB_PASSWORD || env.DB_PASSWORD === 'CHANGE_ME_BEFORE_DEPLOYMENT') {
    throw new CliError(
      `${envPath} contains an unsafe DB_PASSWORD; set it before starting LocalMind`
    );
  }
  return { created, env, envPath };
}

function resolveDeploymentPath(composeFile, value) {
  if (!value) return null;
  if (value.includes('${')) {
    throw new CliError(`Unresolved variable in deployment path: ${value}`);
  }
  return isAbsolute(value) ? value : resolve(dirname(composeFile), value);
}

async function resolveConfigPath(options, deploymentEnv) {
  if (options.configPath) return resolve(options.configPath);
  const configDir = resolveDeploymentPath(
    options.composeFile,
    deploymentEnv.CONFIG_LOCATION ?? './data/localmind/config'
  );
  return join(configDir, 'config.json');
}

export function mergeLocalMindConfig(
  original,
  { endpoint, makeDefault, profile, providerId, servedModelName }
) {
  const config = structuredClone(original ?? {});
  if (!isPlainObject(config)) {
    throw new CliError('LocalMind config root must be a JSON object');
  }
  config.copilot = configObject(config.copilot, 'copilot');
  config.copilot.enabled = true;
  config.copilot.providers = configObject(
    config.copilot.providers,
    'copilot.providers'
  );
  const configuredProfiles = config.copilot.providers.profiles;
  if (configuredProfiles !== undefined && !Array.isArray(configuredProfiles)) {
    throw new CliError('copilot.providers.profiles must be an array');
  }
  const profiles = [...(configuredProfiles ?? [])];
  const existingIndex = profiles.findIndex(item => item?.id === providerId);
  const existing = existingIndex >= 0 ? profiles[existingIndex] : null;
  if (existing && existing.type !== 'openaiCompatible') {
    throw new CliError(
      `Provider ${providerId} already exists with incompatible type ${existing.type}`
    );
  }
  const { health: _staleHealth, ...existingBase } = existing ?? {};
  const provider = {
    ...existingBase,
    config: {
      apiStyle: 'chat_completions',
      baseURL: endpoint,
    },
    displayName: `${profileDefinitions[profile].displayName} (${servedModelName})`,
    enabled: true,
    id: providerId,
    modelDefinitions: [
      {
        backendKind: 'openai_chat',
        capabilities: [
          {
            defaultForOutputType: true,
            input: ['text'],
            output: ['text', 'object', 'structured'],
          },
        ],
        displayName: servedModelName,
        enabled: true,
        id: servedModelName,
        protocol: 'openai_chat',
        rawModelId: servedModelName,
        requestLayer: 'chat_completions',
      },
    ],
    models: [servedModelName],
    priority: existing?.priority ?? 100,
    privacy: 'local',
    source: 'configured',
    type: 'openaiCompatible',
  };
  if (existingIndex >= 0) profiles[existingIndex] = provider;
  else profiles.push(provider);
  config.copilot.providers.profiles = profiles;

  if (makeDefault) {
    const defaults = configObject(
      config.copilot.providers.defaults,
      'copilot.providers.defaults'
    );
    config.copilot.providers.defaults = {
      ...defaults,
      object: providerId,
      structured: providerId,
      text: providerId,
    };
    config.copilot.prompts = configObject(
      config.copilot.prompts,
      'copilot.prompts'
    );
    config.copilot.prompts.defaults = configObject(
      config.copilot.prompts.defaults,
      'copilot.prompts.defaults'
    );
    const textDefaults = configObject(
      config.copilot.prompts.defaults.text,
      'copilot.prompts.defaults.text'
    );
    const target = `${providerId}/${servedModelName}`;
    config.copilot.prompts.defaults.text = {
      ...textDefaults,
      model: target,
      optionalModels: [
        ...(textDefaults.optionalModels ?? []).filter(
          model => !model.startsWith(`${providerId}/`)
        ),
        target,
      ],
    };
  }
  return config;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configObject(value, path) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value))
    throw new CliError(`${path} must be a JSON object`);
  return value;
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function configureLocalMind(
  options,
  deploymentEnv,
  { profile, providerId, servedModelName },
  logger
) {
  const configPath = await resolveConfigPath(options, deploymentEnv);
  let original;
  let existed = true;
  try {
    original = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new CliError(`Cannot parse ${configPath}: ${error.message}`);
    }
    existed = false;
    const templatePath = join(
      dirname(options.composeFile),
      'config.json.example'
    );
    original = JSON.parse(await readFile(templatePath, 'utf8'));
  }
  const endpoint = `http://host.docker.internal:${options.port}/v1`;
  const merged = mergeLocalMindConfig(original, {
    endpoint,
    makeDefault: options.makeDefault,
    profile,
    providerId,
    servedModelName,
  });
  const serialized = `${JSON.stringify(merged, null, 2)}\n`;
  const previous = existed ? await readFile(configPath, 'utf8') : null;
  let backupPath = null;
  if (previous !== serialized) {
    await mkdir(dirname(configPath), { recursive: true });
    if (existed) {
      backupPath = `${configPath}.bak.${timestampForPath()}`;
      await copyFile(configPath, backupPath);
      await chmod(backupPath, 0o600);
    }
    await writeAtomicText(configPath, serialized);
    logger.info(
      `Configured LocalMind provider ${providerId}/${servedModelName}${backupPath ? `; backup: ${backupPath}` : ''}`
    );
  } else {
    logger.info('LocalMind model configuration is already current');
  }
  return { backupPath, config: merged, configPath, endpoint };
}

function composePrefix(options, envPath) {
  const args = ['compose', '-f', options.composeFile];
  if (envPath && existsSync(envPath)) args.push('--env-file', envPath);
  return args;
}

async function imageExists(image) {
  const result = await runCaptured('docker', ['image', 'inspect', image]);
  return result.code === 0;
}

async function startCompose(options, environment, logger) {
  const prefix = composePrefix(options, environment.envPath);
  await run('docker', [...prefix, 'config', '--quiet']);
  const image =
    environment.env.LOCALMIND_AFFINE_IMAGE || 'localmind-affine:local';
  if (image !== 'localmind-affine:local') {
    throw new CliError(
      `LOCALMIND_AFFINE_IMAGE must use the fixed runtime role localmind-affine:local, got ${image}`
    );
  }
  const build = options.build ?? !(await imageExists(image));
  if (build) {
    logger.info('Docker disk usage before LocalMind runtime build:');
    await run('docker', ['system', 'df']);
  }
  logger.info(
    `Starting LocalMind Compose (${build ? 'building localmind-affine:local' : 'reusing existing image'})`
  );
  await run('docker', [
    ...prefix,
    'up',
    '-d',
    ...(build ? ['--build'] : ['--no-build']),
  ]);
  return { build, image, prefix };
}

async function waitForLocalMind(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(
        url,
        { redirect: 'manual' },
        3_000
      );
      if (response.status < 500) return response.status;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
  }
  throw new CliError(
    `LocalMind did not become ready at ${url}: ${lastError?.message ?? 'unknown error'}`
  );
}

function localMindUrl(options, env) {
  if (options.localmindUrl) return options.localmindUrl.replace(/\/$/, '');
  const port = env.PORT || '3011';
  return `http://127.0.0.1:${port}`;
}

async function verifyContainerVllm(compose, servedModelName) {
  const endpoint = `http://host.docker.internal:${compose.modelPort}/v1/models`;
  const source = `
const model = ${JSON.stringify(servedModelName)};
const response = await fetch(${JSON.stringify(endpoint)});
if (!response.ok) throw new Error('HTTP ' + response.status);
const body = await response.json();
if (!body.data?.some(item => item.id === model)) throw new Error('model not found');
console.log(model);
`;
  await run('docker', [
    ...compose.prefix,
    'exec',
    '-T',
    'affine',
    'node',
    '--input-type=module',
    '-e',
    source,
  ]);
}

function assertEffectiveConfig(
  config,
  providerId,
  servedModelName,
  makeDefault
) {
  const profile = config.copilot?.providers?.profiles?.find(
    candidate => candidate.id === providerId
  );
  if (!profile || !profile.models?.includes(servedModelName)) {
    throw new CliError(
      `Effective file configuration is missing ${providerId}/${servedModelName}`
    );
  }
  if (
    makeDefault &&
    (config.copilot?.providers?.defaults?.text !== providerId ||
      config.copilot?.prompts?.defaults?.text?.model !==
        `${providerId}/${servedModelName}`)
  ) {
    throw new CliError(
      'Effective file configuration did not select the local model'
    );
  }
}

async function verifyDeployment(
  options,
  environment,
  compose,
  configuration,
  { providerId, servedModelName },
  logger
) {
  const url = localMindUrl(options, environment.env);
  let status;
  try {
    status = await waitForLocalMind(url, Math.min(options.timeoutMs, 300_000));
    assertEffectiveConfig(
      configuration.config,
      providerId,
      servedModelName,
      options.makeDefault
    );
    await verifyContainerVllm(
      { ...compose, modelPort: options.port },
      servedModelName
    );
  } catch (error) {
    const logs = await runCaptured('docker', [
      ...compose.prefix,
      'logs',
      '--tail',
      '120',
      'affine',
      'affine_migration',
    ]);
    const diagnostics = redactDiagnostics(
      `${logs.stdout}\n${logs.stderr}`.trim()
    );
    if (diagnostics) process.stderr.write(`${diagnostics}\n`);
    throw error;
  }
  logger.info(`LocalMind ready at ${url} (HTTP ${status})`);
  return {
    containerCanReachVllm: true,
    fileConfigContainsModel: true,
    httpStatus: status,
    url,
  };
}

function redactDiagnostics(value) {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+(@)/gi, '$1<redacted>$2')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1<redacted>')
    .replace(
      /((?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
      '$1<redacted>'
    );
}

async function readRuntimeContext(options) {
  const paths = runtimePaths(options.composeFile);
  const state = await readJson(paths.state);
  let environment = null;
  const envPath = join(dirname(options.composeFile), '.env');
  if (existsSync(envPath)) {
    environment = { env: parseEnv(await readFile(envPath, 'utf8')), envPath };
  }
  return { environment, paths, state };
}

async function statusCommand(options) {
  const context = await readRuntimeContext(options);
  let vllm = { healthy: false, processAlive: false };
  if (context.state) {
    vllm.processAlive = processIsAlive(context.state.pid);
    try {
      const models = await fetchVllmModels(context.state.vllmBaseUrl);
      vllm = {
        ...vllm,
        healthy: models.includes(context.state.servedModelName),
        models,
      };
    } catch (error) {
      vllm.error = error.message;
    }
  }
  let compose = { available: false };
  let configuration = { available: false };
  if (context.environment) {
    const result = await runCaptured('docker', [
      ...composePrefix(options, context.environment.envPath),
      'ps',
      '--format',
      'json',
    ]);
    compose = {
      available: result.code === 0,
      output: result.stdout.trim(),
      ...(result.code === 0
        ? {}
        : { error: redactDiagnostics(result.stderr.trim()) }),
    };
    const configPath = await resolveConfigPath(
      options,
      context.environment.env
    );
    try {
      const config = await readJson(configPath);
      const providerId = options.providerId || context.state?.providerId;
      const provider = providerId
        ? config?.copilot?.providers?.profiles?.find(
            candidate => candidate.id === providerId
          )
        : null;
      configuration = {
        available: Boolean(config),
        defaults: config?.copilot?.providers?.defaults ?? {},
        path: configPath,
        provider: provider
          ? {
              baseURL: provider.config?.baseURL,
              enabled: provider.enabled !== false,
              id: provider.id,
              models: provider.models ?? [],
              type: provider.type,
            }
          : null,
      };
    } catch (error) {
      configuration = {
        available: false,
        error: error.message,
        path: configPath,
      };
    }
  }
  return { compose, configuration, state: context.state, vllm };
}

async function processMatchesState(state) {
  if (!state?.managed || !processIsAlive(state.pid)) return false;
  let commandLine;
  try {
    commandLine = (
      await readFile(`/proc/${state.pid}/cmdline`, 'utf8')
    ).replaceAll('\0', ' ');
  } catch {
    const result = await runCaptured('ps', [
      '-p',
      String(state.pid),
      '-o',
      'command=',
    ]).catch(() => null);
    commandLine = result?.code === 0 ? result.stdout : '';
  }
  return (
    commandLine.includes(state.servedModelName) &&
    commandLine.includes(String(state.port))
  );
}

async function stopManagedVllm(state, paths, logger) {
  if (!state) {
    logger.info('No managed vLLM state found');
    return false;
  }
  if (!state.managed) {
    logger.info(
      'The detected vLLM was not started by this script; leaving it running'
    );
    return false;
  }
  if (!processIsAlive(state.pid)) {
    await unlink(paths.state).catch(() => {});
    logger.info('Removed stale vLLM state');
    return false;
  }
  if (!(await processMatchesState(state))) {
    throw new CliError(
      `Refusing to stop pid ${state.pid}: it no longer matches the managed vLLM state`
    );
  }
  signalProcessGroup(state.pid, 'SIGTERM');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && processIsAlive(state.pid)) {
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  if (processIsAlive(state.pid)) {
    signalProcessGroup(state.pid, 'SIGKILL');
  }
  await unlink(paths.state).catch(() => {});
  logger.info(`Stopped managed vLLM pid ${state.pid}`);
  return true;
}

async function stopCommand(options, logger) {
  const context = await readRuntimeContext(options);
  let localmindStopped = false;
  if (context.environment) {
    const result = await runCaptured('docker', [
      ...composePrefix(options, context.environment.envPath),
      'stop',
    ]);
    if (result.code !== 0) {
      logger.warn(
        `Could not stop LocalMind Compose: ${redactDiagnostics(result.stderr.trim())}`
      );
    } else {
      localmindStopped = true;
      logger.info(
        'Stopped LocalMind Compose services without deleting volumes'
      );
    }
  }
  const vllmStopped = await stopManagedVllm(
    context.state,
    context.paths,
    logger
  );
  return { localmindStopped, vllmStopped };
}

function runtimeIdentity(options, model) {
  const profile = inferProfile(options, model.path);
  const servedModelName = defaultServedModelName(options, profile, model.path);
  const providerId =
    options.providerId || profileDefinitions[profile].providerId;
  validateRuntimeIds(providerId, servedModelName);
  return { profile, providerId, servedModelName };
}

async function upCommand(options, logger) {
  await preflight(options, logger, {
    vllmRequired: !(await isPortOpen(options.port)),
  });
  const model = await resolveModel(options, logger, {
    allowDownload: !options.dryRun,
  });
  if (model.missing) {
    return {
      dryRun: true,
      model,
      next: 'The model would be downloaded, then vLLM and LocalMind would start.',
    };
  }
  logger.info(`Using model snapshot: ${model.path}`);
  const identity = runtimeIdentity(options, model);
  const vllmArgs = buildVllmArgs(
    options,
    model.path,
    identity.profile,
    identity.servedModelName
  );
  if (options.dryRun) {
    return {
      dryRun: true,
      identity,
      model,
      vllm: { args: vllmArgs, command: options.vllmBin },
    };
  }

  const vllm = await ensureVllm(
    options,
    model,
    identity.profile,
    identity.servedModelName,
    identity.providerId,
    logger
  );
  const environment = await ensureEnvironment(options.composeFile, logger);
  const configuration = await configureLocalMind(
    options,
    environment.env,
    identity,
    logger
  );
  logger.warn(
    'Admin-published DB-backed provider or task-route revisions can override this file configuration'
  );
  const compose = await startCompose(options, environment, logger);
  const verification = await verifyDeployment(
    options,
    environment,
    compose,
    configuration,
    identity,
    logger
  );
  return {
    compose: { build: compose.build, image: compose.image },
    configuration: {
      backupPath: configuration.backupPath,
      configPath: configuration.configPath,
      endpoint: configuration.endpoint,
      makeDefault: options.makeDefault,
    },
    identity,
    model: {
      modelType: model.modelType,
      path: model.path,
      revision: model.revision,
      source: model.source,
    },
    verification,
    vllm: {
      logPath: vllm.logPath,
      managed: vllm.managed,
      pid: vllm.pid,
      port: vllm.port,
      reused: vllm.reused,
    },
  };
}

async function execute(options, logger) {
  if (options.command === 'preflight') {
    return await preflight(options, logger, { strict: false });
  }
  if (options.command === 'discover') {
    return await resolveModel(options, logger, { allowDownload: false });
  }
  if (options.command === 'up') return await upCommand(options, logger);
  if (options.command === 'status') return await statusCommand(options);
  if (options.command === 'stop') return await stopCommand(options, logger);
  throw new CliError(`Unsupported command: ${options.command}`, 2);
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCli(argv);
    if (options.command === 'help' || options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const logger = createLogger(options.json);
    const result = await execute(options, logger);
    if (options.json)
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (
      options.dryRun ||
      ['discover', 'status'].includes(options.command)
    ) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      logger.info(`${options.command} completed`);
    }
    return result?.ok === false && options.command === 'preflight' ? 1 : 0;
  } catch (error) {
    const exitCode = error instanceof CliError ? error.exitCode : 1;
    if (options?.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            error: {
              details: error.details,
              message: error.message,
              type: error.name,
            },
            ok: false,
          },
          null,
          2
        )}\n`
      );
    } else {
      process.stderr.write(`ERROR: ${error.message}\n`);
    }
    return exitCode;
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) process.exitCode = await main();
