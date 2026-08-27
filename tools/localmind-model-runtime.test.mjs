import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildVllmArgs,
  inferProfile,
  mergeLocalMindConfig,
  parseCli,
  validateModelSnapshot,
} from './localmind-model-runtime.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(repoRoot, 'tools/localmind-model-runtime.mjs');
const helperPath = join(
  repoRoot,
  'tools/localmind-model-runtime/modelscope.py'
);

async function modelFixture(name = 'Qwen3.6-35B-A3B') {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-model-'));
  const modelDir = join(directory, name);
  await mkdir(modelDir);
  await writeFile(
    join(modelDir, 'config.json'),
    JSON.stringify({ model_type: 'qwen3_moe' })
  );
  await writeFile(join(modelDir, 'tokenizer_config.json'), '{}');
  await writeFile(
    join(modelDir, 'model-00001-of-00002.safetensors'),
    'fixture'
  );
  return { directory, modelDir };
}

test('parseCli accepts explicit safe runtime sizing without inventing defaults', () => {
  const parsed = parseCli([
    'up',
    '--model-dir',
    '/models/qwen',
    '--max-model-len',
    '65536',
    '--gpu-memory-utilization',
    '0.8',
    '--vllm-arg',
    '--kv-cache-dtype',
    '--vllm-arg',
    'auto',
    '--no-build',
  ]);

  assert.equal(parsed.maxModelLen, 65536);
  assert.equal(parsed.gpuMemoryUtilization, 0.8);
  assert.deepEqual(parsed.vllmArgs, ['--kv-cache-dtype', 'auto']);
  assert.equal(parsed.build, false);
  assert.equal(parsed.makeDefault, true);
});

test('Qwen profiles include tool parsing but no aggressive GX10 memory defaults', () => {
  const options = parseCli(['up', '--model-dir', '/models/Qwen3.6-35B-A3B']);
  const profile = inferProfile(options, options.modelDir);
  const args = buildVllmArgs(
    options,
    options.modelDir,
    profile,
    'qwen3.6-35b-a3b'
  );

  assert.equal(profile, 'qwen36');
  assert.ok(args.includes('qwen3_xml'));
  assert.ok(args.includes('--max-num-seqs'));
  assert.equal(args.includes('--max-model-len'), false);
  assert.equal(args.includes('--gpu-memory-utilization'), false);
});

test('vLLM identity and secret flags cannot bypass script ownership', () => {
  const identityOverride = parseCli([
    'up',
    '--model-dir',
    '/models/qwen',
    '--vllm-arg',
    '--port=9000',
  ]);
  assert.throws(
    () =>
      buildVllmArgs(
        identityOverride,
        identityOverride.modelDir,
        'generic',
        'model'
      ),
    /runtime identity flags are managed/
  );

  const secretOverride = parseCli([
    'up',
    '--model-dir',
    '/models/qwen',
    '--vllm-arg',
    '--api-key',
  ]);
  assert.throws(
    () =>
      buildVllmArgs(
        secretOverride,
        secretOverride.modelDir,
        'generic',
        'model'
      ),
    /authentication and runtime identity flags are managed/
  );
});

test('mergeLocalMindConfig preserves non-chat routes and unrelated providers', () => {
  const original = {
    copilot: {
      providers: {
        defaults: {
          embedding: 'embedding-lan',
          fallback: 'gpt-cloud',
          image: 'image-cloud',
          rerank: 'rerank-lan',
          text: 'gpt-cloud',
        },
        profiles: [
          {
            config: { apiKey: 'keep-secret' },
            id: 'gpt-cloud',
            type: 'openai',
          },
        ],
      },
      prompts: {
        defaults: {
          text: {
            optionalModels: ['gpt-cloud/gpt-5.6-sol'],
            proModels: ['gpt-cloud/gpt-5.6-sol'],
          },
        },
      },
      tasks: {
        models: {
          embedding: 'embedding-lan/bge-m3',
          rerank: 'rerank-lan/bge-reranker',
          workspaceIndexing: 'embedding-lan/bge-m3',
        },
      },
    },
  };

  const merged = mergeLocalMindConfig(original, {
    endpoint: 'http://host.docker.internal:8000/v1',
    makeDefault: true,
    profile: 'qwen36',
    providerId: 'qwen-lan',
    servedModelName: 'qwen3.6-35b-a3b',
  });

  assert.deepEqual(merged.copilot.tasks, original.copilot.tasks);
  assert.equal(merged.copilot.providers.defaults.embedding, 'embedding-lan');
  assert.equal(merged.copilot.providers.defaults.fallback, 'gpt-cloud');
  assert.equal(merged.copilot.providers.defaults.rerank, 'rerank-lan');
  assert.equal(merged.copilot.providers.defaults.image, 'image-cloud');
  assert.equal(merged.copilot.providers.defaults.text, 'qwen-lan');
  assert.equal(merged.copilot.providers.defaults.structured, 'qwen-lan');
  assert.equal(merged.copilot.providers.profiles[0].id, 'gpt-cloud');
  assert.equal(merged.copilot.providers.profiles[1].privacy, 'local');
  assert.deepEqual(merged.copilot.prompts.defaults.text.optionalModels, [
    'gpt-cloud/gpt-5.6-sol',
    'qwen-lan/qwen3.6-35b-a3b',
  ]);
  assert.deepEqual(merged.copilot.prompts.defaults.text.proModels, [
    'gpt-cloud/gpt-5.6-sol',
  ]);
});

test('mergeLocalMindConfig can register a model without changing defaults', () => {
  const merged = mergeLocalMindConfig(
    {
      copilot: {
        providers: { defaults: { text: 'existing' }, profiles: [] },
      },
    },
    {
      endpoint: 'http://host.docker.internal:9000/v1',
      makeDefault: false,
      profile: 'generic',
      providerId: 'local-vllm',
      servedModelName: 'custom-model',
    }
  );

  assert.deepEqual(merged.copilot.providers.defaults, { text: 'existing' });
  assert.equal(merged.copilot.prompts, undefined);
  assert.equal(merged.copilot.providers.profiles[0].models[0], 'custom-model');
});

test('mergeLocalMindConfig rejects malformed owned configuration paths', () => {
  assert.throws(
    () =>
      mergeLocalMindConfig(
        { copilot: { providers: { profiles: 'not-an-array' } } },
        {
          endpoint: 'http://host.docker.internal:8000/v1',
          makeDefault: true,
          profile: 'generic',
          providerId: 'local-vllm',
          servedModelName: 'model',
        }
      ),
    /copilot\.providers\.profiles must be an array/
  );
});

test('validateModelSnapshot and discover accept a complete explicit snapshot', async t => {
  const fixture = await modelFixture();
  t.after(
    async () => await rm(fixture.directory, { force: true, recursive: true })
  );

  const snapshot = await validateModelSnapshot(fixture.modelDir);
  assert.equal(snapshot.modelType, 'qwen3_moe');
  assert.equal(snapshot.weightFiles.length, 1);

  const output = execFileSync(
    process.execPath,
    [cliPath, 'discover', '--model-dir', fixture.modelDir, '--json'],
    { encoding: 'utf8' }
  );
  const discovered = JSON.parse(output);
  assert.equal(discovered.path, snapshot.path);
  assert.equal(discovered.source, 'explicit');
});

test('up dry-run keeps stdout as one JSON document and does not need real services', async t => {
  const fixture = await modelFixture();
  const binDir = join(fixture.directory, 'bin');
  await mkdir(binDir);
  for (const command of ['docker', 'nvidia-smi', 'vllm']) {
    const executable = join(binDir, command);
    await writeFile(executable, '#!/bin/sh\necho fake-runtime\n');
    await chmod(executable, 0o755);
  }
  t.after(
    async () => await rm(fixture.directory, { force: true, recursive: true })
  );

  const stdout = execFileSync(
    process.execPath,
    [cliPath, 'up', '--model-dir', fixture.modelDir, '--dry-run', '--json'],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const plan = JSON.parse(stdout);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.identity.profile, 'qwen36');
  assert.equal(plan.vllm.args.includes('--max-model-len'), false);
});

test('validateModelSnapshot rejects a partial model directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-partial-model-'));
  t.after(async () => await rm(directory, { force: true, recursive: true }));
  await writeFile(join(directory, 'config.json'), '{}');
  await writeFile(join(directory, 'tokenizer.json'), '{}');

  await assert.rejects(
    validateModelSnapshot(directory),
    /No supported model weights/
  );
});

test('ModelScope helper keeps SDK output off its JSON stdout contract', async t => {
  const fixture = await modelFixture('fake-snapshot');
  const pythonRoot = join(fixture.directory, 'python');
  const moduleDir = join(pythonRoot, 'modelscope');
  await mkdir(moduleDir, { recursive: true });
  await writeFile(
    join(moduleDir, '__init__.py'),
    [
      "__version__ = 'test'",
      'import os',
      'def snapshot_download(*args, **kwargs):',
      "    print('noisy sdk progress')",
      "    return os.environ['FAKE_MODELSCOPE_SNAPSHOT']",
      '',
    ].join('\n')
  );
  t.after(
    async () => await rm(fixture.directory, { force: true, recursive: true })
  );

  const stdout = execFileSync(
    'python3',
    [helperPath, '--model', 'fake/model', '--revision', 'fixed'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_MODELSCOPE_SNAPSHOT: fixture.modelDir,
        PYTHONPATH: pythonRoot,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  assert.deepEqual(JSON.parse(stdout), {
    model: 'fake/model',
    path: await realpath(fixture.modelDir),
    revision: 'fixed',
    status: 'found',
  });
});

test('ModelScope helper distinguishes cache absence from other SDK errors', async t => {
  const directory = await mkdtemp(
    join(tmpdir(), 'localmind-modelscope-errors-')
  );
  const pythonRoot = join(directory, 'python');
  const moduleDir = join(pythonRoot, 'modelscope');
  await mkdir(moduleDir, { recursive: true });
  t.after(async () => await rm(directory, { force: true, recursive: true }));

  await writeFile(
    join(moduleDir, '__init__.py'),
    [
      'def snapshot_download(*args, **kwargs):',
      "    raise ValueError('Cannot find an appropriate cached snapshot folder while local_files_only is enabled')",
      '',
    ].join('\n')
  );
  const missing = execFileSync(
    'python3',
    [helperPath, '--model', 'fake/model', '--revision', 'fixed'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: pythonRoot,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  assert.equal(JSON.parse(missing).status, 'missing');

  await writeFile(
    join(moduleDir, '__init__.py'),
    [
      'def snapshot_download(*args, **kwargs):',
      "    raise PermissionError('authentication failed')",
      '',
    ].join('\n')
  );
  const failed = spawnSync(
    'python3',
    [helperPath, '--model', 'fake/model', '--revision', 'fixed'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: pythonRoot,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    }
  );
  assert.equal(failed.status, 4);
  assert.equal(JSON.parse(failed.stdout).kind, 'cache_probe_failed');
});
