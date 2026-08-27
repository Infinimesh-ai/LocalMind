import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bootstrap = join(repoRoot, 'scripts/localmind-qwen36-bootstrap.sh');
const provisioner = join(
  repoRoot,
  'tools/localmind-model-runtime/provision-host.sh'
);

async function writeExecutable(path, contents) {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

void test('bootstrap clones the fixed branch and forwards the fixed Qwen3.6 runtime', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-bootstrap-'));
  const binDir = join(directory, 'bin');
  const installDir = join(directory, 'empty', 'LocalMind');
  const modelRoot = join(directory, 'models with spaces');
  const runtimeRoot = join(directory, 'managed runtime');
  const traceDir = join(directory, 'trace');
  const fakeProvisioner = join(directory, 'fake-provisioner.sh');
  await mkdir(binDir);
  await mkdir(dirname(installDir));
  await mkdir(traceDir);
  t.after(async () => await rm(directory, { force: true, recursive: true }));

  await writeExecutable(
    fakeProvisioner,
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$@" > "$TRACE_DIR/provision-args"',
      'mkdir -p "$LOCALMIND_RUNTIME_ROOT/venv/bin"',
      'for executable in python vllm; do',
      '  path="$LOCALMIND_RUNTIME_ROOT/venv/bin/$executable"',
      '  printf \'#!/bin/sh\\nexit 0\\n\' > "$path"',
      '  chmod +x "$path"',
      'done',
      '',
    ].join('\n')
  );
  await writeExecutable(
    join(binDir, 'git'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$@" > "$TRACE_DIR/git-args"',
      'for target do :; done',
      'mkdir -p "$target/tools/localmind-model-runtime"',
      ': > "$target/tools/localmind-model-runtime.mjs"',
      'cp "$FAKE_PROVISIONER" "$target/tools/localmind-model-runtime/provision-host.sh"',
      '',
    ].join('\n')
  );
  await writeExecutable(
    join(binDir, 'node'),
    [
      '#!/bin/sh',
      'if [ "${1:-}" = -e ]; then exit 0; fi',
      'printf \'%s\\n\' "$@" > "$TRACE_DIR/node-args"',
      '',
    ].join('\n')
  );

  const result = spawnSync('sh', [bootstrap, '--model-root', modelRoot], {
    cwd: join(directory, 'empty'),
    encoding: 'utf8',
    env: {
      ...process.env,
      LOCALMIND_GPU_MEMORY_UTILIZATION: '0.8',
      LOCALMIND_INSTALL_DIR: installDir,
      LOCALMIND_MAX_MODEL_LEN: '65536',
      LOCALMIND_MODEL_PORT: '8123',
      LOCALMIND_REPOSITORY_URL: 'https://example.invalid/LocalMind.git',
      LOCALMIND_RUNTIME_ROOT: runtimeRoot,
      LOCALMIND_TENSOR_PARALLEL_SIZE: '2',
      FAKE_PROVISIONER: fakeProvisioner,
      PATH: `${binDir}:${process.env.PATH}`,
      TRACE_DIR: traceDir,
    },
  });

  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const gitArgs = (await readFile(join(traceDir, 'git-args'), 'utf8'))
    .trim()
    .split('\n');
  assert.deepEqual(gitArgs, [
    'clone',
    '--branch',
    'codex/local-model-runtime',
    '--single-branch',
    '--filter=blob:none',
    'https://example.invalid/LocalMind.git',
    installDir,
  ]);
  assert.equal(await readFile(join(traceDir, 'provision-args'), 'utf8'), '\n');

  const nodeArgs = (await readFile(join(traceDir, 'node-args'), 'utf8'))
    .trim()
    .split('\n');
  assert.deepEqual(nodeArgs, [
    join(installDir, 'tools/localmind-model-runtime.mjs'),
    'up',
    '--model',
    'Qwen/Qwen3.6-35B-A3B-FP8',
    '--revision',
    '62836cf634afbb2a90f3e0558ded9112afbf4660',
    '--model-root',
    modelRoot,
    '--profile',
    'qwen36',
    '--served-model-name',
    'qwen3.6-35b-a3b',
    '--port',
    '8123',
    '--timeout',
    '900',
    '--python-bin',
    join(runtimeRoot, 'venv/bin/python'),
    '--vllm-bin',
    join(runtimeRoot, 'venv/bin/vllm'),
    '--build',
    '--max-model-len',
    '65536',
    '--gpu-memory-utilization',
    '0.8',
    '--tensor-parallel-size',
    '2',
  ]);
});

void test('bootstrap accepts a user-selected local model snapshot and skips ModelScope selection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-local-model-'));
  const binDir = join(directory, 'bin');
  const installDir = join(directory, 'LocalMind');
  const modelDir = join(directory, 'Qwen snapshot with spaces');
  const runtimeRoot = join(directory, 'runtime');
  const traceDir = join(directory, 'trace');
  await mkdir(binDir);
  await mkdir(join(installDir, '.git'), { recursive: true });
  await mkdir(join(installDir, 'tools/localmind-model-runtime'), {
    recursive: true,
  });
  await mkdir(modelDir);
  await mkdir(traceDir);
  await writeFile(join(installDir, 'tools/localmind-model-runtime.mjs'), '');
  t.after(async () => await rm(directory, { force: true, recursive: true }));

  await writeExecutable(
    join(binDir, 'git'),
    [
      '#!/bin/sh',
      'if [ "${1:-}" = -C ]; then',
      "  printf 'codex/local-model-runtime\\n'",
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n')
  );
  await writeExecutable(
    join(installDir, 'tools/localmind-model-runtime/provision-host.sh'),
    [
      '#!/bin/sh',
      'mkdir -p "$LOCALMIND_RUNTIME_ROOT/venv/bin"',
      'for executable in python vllm; do',
      '  path="$LOCALMIND_RUNTIME_ROOT/venv/bin/$executable"',
      '  printf \'#!/bin/sh\\nexit 0\\n\' > "$path"',
      '  chmod +x "$path"',
      'done',
      '',
    ].join('\n')
  );
  await writeExecutable(
    join(binDir, 'node'),
    ['#!/bin/sh', 'printf \'%s\\n\' "$@" > "$TRACE_DIR/node-args"', ''].join(
      '\n'
    )
  );

  const result = spawnSync('sh', [bootstrap, '--model-dir', modelDir], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOCALMIND_INSTALL_DIR: installDir,
      LOCALMIND_RUNTIME_ROOT: runtimeRoot,
      PATH: `${binDir}:${process.env.PATH}`,
      TRACE_DIR: traceDir,
    },
  });

  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.match(result.stdout, /Reusing existing codex\/local-model-runtime/);
  const resolvedModelDir = await realpath(modelDir);
  const nodeArgs = (await readFile(join(traceDir, 'node-args'), 'utf8'))
    .trim()
    .split('\n');
  assert.deepEqual(nodeArgs, [
    join(installDir, 'tools/localmind-model-runtime.mjs'),
    'up',
    '--model-dir',
    resolvedModelDir,
    '--profile',
    'qwen36',
    '--served-model-name',
    'qwen3.6-35b-a3b',
    '--port',
    '8000',
    '--timeout',
    '900',
    '--python-bin',
    join(runtimeRoot, 'venv/bin/python'),
    '--vllm-bin',
    join(runtimeRoot, 'venv/bin/vllm'),
    '--build',
  ]);
  assert.equal(nodeArgs.includes('--model'), false);
  assert.equal(nodeArgs.includes('--revision'), false);
  assert.equal(nodeArgs.includes('--model-root'), false);
});

void test('bootstrap downloads the fixed model into a user-selected final directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-download-model-'));
  const binDir = join(directory, 'bin');
  const downloadDir = join(directory, 'downloaded model with spaces');
  const installDir = join(directory, 'LocalMind');
  const runtimeRoot = join(directory, 'runtime');
  const traceDir = join(directory, 'trace');
  await mkdir(binDir);
  await mkdir(join(installDir, '.git'), { recursive: true });
  await mkdir(join(installDir, 'tools/localmind-model-runtime'), {
    recursive: true,
  });
  await mkdir(traceDir);
  await writeFile(join(installDir, 'tools/localmind-model-runtime.mjs'), '');
  t.after(async () => await rm(directory, { force: true, recursive: true }));

  await writeExecutable(
    join(binDir, 'git'),
    [
      '#!/bin/sh',
      'if [ "${1:-}" = -C ]; then',
      "  printf 'codex/local-model-runtime\\n'",
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n')
  );
  await writeExecutable(
    join(installDir, 'tools/localmind-model-runtime/provision-host.sh'),
    [
      '#!/bin/sh',
      'mkdir -p "$LOCALMIND_RUNTIME_ROOT/venv/bin"',
      'for executable in python vllm; do',
      '  path="$LOCALMIND_RUNTIME_ROOT/venv/bin/$executable"',
      '  printf \'#!/bin/sh\\nexit 0\\n\' > "$path"',
      '  chmod +x "$path"',
      'done',
      '',
    ].join('\n')
  );
  await writeExecutable(
    join(binDir, 'node'),
    ['#!/bin/sh', 'printf \'%s\\n\' "$@" > "$TRACE_DIR/node-args"', ''].join(
      '\n'
    )
  );

  const result = spawnSync('sh', [bootstrap, '--download-dir', downloadDir], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOCALMIND_INSTALL_DIR: installDir,
      LOCALMIND_RUNTIME_ROOT: runtimeRoot,
      PATH: `${binDir}:${process.env.PATH}`,
      TRACE_DIR: traceDir,
    },
  });

  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const nodeArgs = (await readFile(join(traceDir, 'node-args'), 'utf8'))
    .trim()
    .split('\n');
  assert.deepEqual(nodeArgs, [
    join(installDir, 'tools/localmind-model-runtime.mjs'),
    'up',
    '--model',
    'Qwen/Qwen3.6-35B-A3B-FP8',
    '--revision',
    '62836cf634afbb2a90f3e0558ded9112afbf4660',
    '--download-dir',
    downloadDir,
    '--profile',
    'qwen36',
    '--served-model-name',
    'qwen3.6-35b-a3b',
    '--port',
    '8000',
    '--timeout',
    '900',
    '--python-bin',
    join(runtimeRoot, 'venv/bin/python'),
    '--vllm-bin',
    join(runtimeRoot, 'venv/bin/vllm'),
    '--build',
  ]);
  assert.equal(nodeArgs.includes('--model-root'), false);
  assert.equal(nodeArgs.includes('--model-dir'), false);
});

void test('bootstrap refuses to overwrite an existing non-Git install path', async t => {
  const directory = await mkdtemp(
    join(tmpdir(), 'localmind-bootstrap-existing-')
  );
  const installDir = join(directory, 'LocalMind');
  await mkdir(installDir);
  t.after(async () => await rm(directory, { force: true, recursive: true }));

  const result = spawnSync('sh', [bootstrap], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, LOCALMIND_INSTALL_DIR: installDir },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /exists but is not a Git checkout/);
});

void test('host provisioner installs pinned Python packages into its managed environment', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-provisioner-'));
  const binDir = join(directory, 'bin');
  const runtimeRoot = join(directory, 'runtime');
  const venvBin = join(runtimeRoot, 'venv/bin');
  const packagesReady = join(directory, 'packages-ready');
  const uvArgs = join(directory, 'uv-args');
  const osRelease = join(directory, 'os-release');
  await mkdir(binDir);
  await mkdir(venvBin, { recursive: true });
  await writeFile(
    osRelease,
    ['ID=ubuntu', 'VERSION_ID=24.04', 'VERSION_CODENAME=noble', ''].join('\n')
  );
  t.after(async () => await rm(directory, { force: true, recursive: true }));

  await writeExecutable(
    join(binDir, 'uname'),
    [
      '#!/bin/sh',
      'case "${1:-}" in',
      "  -s) printf 'Linux\\n' ;;",
      "  -m) printf 'aarch64\\n' ;;",
      "  -r) printf '6.8.0-test\\n' ;;",
      "  *) printf 'Linux\\n' ;;",
      'esac',
      '',
    ].join('\n')
  );
  await writeExecutable(join(binDir, 'node'), '#!/bin/sh\nexit 0\n');
  for (const command of ['curl', 'gpg']) {
    await writeExecutable(join(binDir, command), '#!/bin/sh\nexit 0\n');
  }
  await writeExecutable(join(binDir, 'docker'), '#!/bin/sh\nexit 0\n');
  await writeExecutable(
    join(binDir, 'nvidia-smi'),
    [
      '#!/bin/sh',
      'case "$*" in',
      "  *--query-gpu=*) printf 'NVIDIA GB10, 580.1, 128000 MiB\\n' ;;",
      'esac',
      'exit 0',
      '',
    ].join('\n')
  );
  await writeExecutable(join(binDir, 'python3'), '#!/bin/sh\nexit 0\n');
  await writeExecutable(
    join(venvBin, 'python'),
    ['#!/bin/sh', '[ -f "$PACKAGES_READY" ]', ''].join('\n')
  );
  await writeExecutable(
    join(venvBin, 'uv'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$@" > "$UV_ARGS"',
      ': > "$PACKAGES_READY"',
      '',
    ].join('\n')
  );
  await writeExecutable(join(venvBin, 'vllm'), '#!/bin/sh\nexit 0\n');

  const result = spawnSync('sh', [provisioner], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOCALMIND_OS_RELEASE_FILE: osRelease,
      LOCALMIND_RUNTIME_ROOT: runtimeRoot,
      PACKAGES_READY: packagesReady,
      PATH: `${binDir}:${process.env.PATH}`,
      UV_ARGS: uvArgs,
    },
  });

  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.match(result.stdout, /Host environment is ready/);
  assert.deepEqual((await readFile(uvArgs, 'utf8')).trim().split('\n'), [
    'pip',
    'install',
    '--python',
    join(venvBin, 'python'),
    '--torch-backend=auto',
    'modelscope==1.39.1',
    'vllm==0.28.0',
  ]);
});
