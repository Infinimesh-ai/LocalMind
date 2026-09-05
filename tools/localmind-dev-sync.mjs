import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.LOCALMIND_CONTAINER || 'localmind_affine_server';
const localUrl = process.env.LOCALMIND_URL || 'http://localhost:3011';
const target = process.argv[2] || 'backend';
const runtimeSource = process.env.LOCALMIND_RUNTIME_SOURCE_CONTAINER;
const backupPath = process.env.LOCALMIND_DATABASE_BACKUP;
const runtimeStatePath = '/app/localmind-dev-sync-state.json';

if (!['backend', 'web', 'all'].includes(target)) {
  console.error('Usage: node tools/localmind-dev-sync.mjs [backend|web|all]');
  process.exit(2);
}

async function run(command, args, capture = false) {
  return await new Promise((resolveRun, rejectRun) => {
    let output = '';
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    child.stdout?.on('data', chunk => {
      output += chunk;
    });
    child.on('error', rejectRun);
    child.on('exit', code => {
      if (code === 0) {
        resolveRun(output.trim());
      } else {
        rejectRun(new Error(`${command} exited with code ${code ?? 1}`));
      }
    });
  });
}

async function assertContainerIsRunning() {
  const running = await run(
    'docker',
    ['inspect', '--format', '{{.State.Running}}', container],
    true
  );
  if (running !== 'true')
    throw new Error(`Container ${container} is not running`);
}

async function runtimeInputs() {
  const paths = (
    await run('git', ['ls-files', '-c', '-o', '--exclude-standard'], true)
  )
    .split('\n')
    .filter(
      path =>
        path.endsWith('.rs') ||
        /(^|\/)Cargo\.(toml|lock)$/.test(path) ||
        path.startsWith('packages/backend/native/src/') ||
        path.startsWith('rust-toolchain')
    );
  paths.push('packages/backend/server/schema.prisma');
  for (const name of await readdir(
    resolve(repoRoot, 'packages/backend/server/migrations')
  )) {
    if (name !== 'migration_lock.toml')
      paths.push(`packages/backend/server/migrations/${name}/migration.sql`);
  }
  const hashes = {};
  for (const path of [...new Set(paths)].sort()) {
    hashes[path] = createHash('sha256')
      .update(await readFile(resolve(repoRoot, path)))
      .digest('hex');
  }
  return hashes;
}

async function prepareRuntimeSync() {
  const inputs = await runtimeInputs();
  if (!runtimeSource) {
    const previous = JSON.parse(
      await run(
        'docker',
        [
          'exec',
          container,
          'node',
          '-e',
          `const fs = require('node:fs'); console.log(fs.existsSync(${JSON.stringify(runtimeStatePath)}) ? fs.readFileSync(${JSON.stringify(runtimeStatePath)}, 'utf8') : 'null');`,
        ],
        true
      )
    );
    if (JSON.stringify(previous?.inputs) !== JSON.stringify(inputs)) {
      throw new Error(
        'Runtime schema/native provenance is missing or changed. Validate a Linux test container, then set LOCALMIND_RUNTIME_SOURCE_CONTAINER and LOCALMIND_DATABASE_BACKUP to sync migrations, Prisma Client and native code together.'
      );
    }
    await run('docker', [
      'exec',
      container,
      'node',
      'node_modules/prisma/build/index.js',
      'migrate',
      'status',
    ]);
    return null;
  }
  if (runtimeSource === container)
    throw new Error(
      'Runtime source must be a separate validated Linux container'
    );
  if (
    !backupPath ||
    !(await stat(backupPath)).isFile() ||
    !(await stat(backupPath)).size
  ) {
    throw new Error(
      'A nonempty database backup is required in LOCALMIND_DATABASE_BACKUP before runtime synchronization'
    );
  }
  const verify = `const fs=require('node:fs'),crypto=require('node:crypto'); const inputs=JSON.parse(process.argv[1]); for(const [path, hash] of Object.entries(inputs)){if(crypto.createHash('sha256').update(fs.readFileSync('/workspace/'+path)).digest('hex')!==hash) throw new Error('Validated container source differs: '+path);} const addon=require('/workspace/packages/backend/native/server-native.node'); console.log(process.platform+':'+process.arch);`;
  const platform = await run(
    'docker',
    ['exec', runtimeSource, 'node', '-e', verify, JSON.stringify(inputs)],
    true
  );
  const destinationPlatform = await run(
    'docker',
    [
      'exec',
      container,
      'node',
      '-e',
      'console.log(process.platform+":"+process.arch)',
    ],
    true
  );
  if (!platform.startsWith('linux:') || platform !== destinationPlatform)
    throw new Error('Native source and destination platforms must match');
  const temporary = await mkdtemp(resolve(tmpdir(), 'localmind-runtime-sync-'));
  try {
    await run('docker', [
      'cp',
      `${runtimeSource}:/workspace/node_modules/.prisma/client`,
      `${temporary}/client`,
    ]);
    const generatedSchema = await readFile(`${temporary}/client/schema.prisma`);
    if (
      createHash('sha256').update(generatedSchema).digest('hex') !==
      inputs['packages/backend/server/schema.prisma']
    )
      throw new Error('Validated Prisma Client is stale');
    await run('docker', [
      'cp',
      `${runtimeSource}:/workspace/packages/backend/native/server-native.node`,
      `${temporary}/server-native.node`,
    ]);
    await writeFile(
      `${temporary}/state.json`,
      JSON.stringify({
        inputs,
        source: runtimeSource,
        syncedAt: new Date().toISOString(),
      })
    );
    return temporary;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function syncBackend() {
  // Fail before copying JavaScript when database/native state cannot support it.
  const runtime = await prepareRuntimeSync();
  try {
    await run('yarn', ['affine', 'bundle', '-p', '@affine/server']);

    if (runtime) {
      await run('docker', [
        'cp',
        'packages/backend/server/migrations/.',
        `${container}:/app/migrations`,
      ]);
      await run('docker', [
        'cp',
        'packages/backend/server/schema.prisma',
        `${container}:/app/schema.prisma`,
      ]);
      await run('docker', [
        'exec',
        container,
        'node',
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
      ]);
      await run('docker', [
        'cp',
        `${runtime}/client/.`,
        `${container}:/app/node_modules/.prisma/client`,
      ]);
      for (const name of [
        'server-native.node',
        'server-native.arm64.node',
        'server-native.x64.node',
        'server-native.armv7.node',
      ]) {
        await run('docker', [
          'cp',
          `${runtime}/server-native.node`,
          `${container}:/app/dist/${name}.next`,
        ]);
        // Do not truncate an addon that the running process has memory-mapped.
        await run('docker', [
          'exec',
          container,
          'node',
          '-e',
          `require('node:fs').renameSync('/app/dist/${name}.next', '/app/dist/${name}');`,
        ]);
      }
    }
    await run('docker', [
      'cp',
      'packages/backend/server/dist/main.js',
      `${container}:/app/dist/main.js`,
    ]);
    await run('docker', [
      'cp',
      'packages/backend/server/dist/main.js.map',
      `${container}:/app/dist/main.js.map`,
    ]);
    if (runtime)
      await run('docker', [
        'cp',
        `${runtime}/state.json`,
        `${container}:${runtimeStatePath}`,
      ]);
  } finally {
    if (runtime) await rm(runtime, { recursive: true, force: true });
  }
}

async function syncWeb() {
  await run('yarn', ['affine', 'bundle', '-p', '@affine/web']);
  await run('yarn', ['affine', 'bundle', '-p', '@affine/admin']);
  await run('docker', [
    'cp',
    'packages/frontend/apps/web/dist/.',
    `${container}:/app/static`,
  ]);
  await run('docker', [
    'cp',
    'packages/frontend/admin/dist/.',
    `${container}:/app/static/admin`,
  ]);
}

async function waitUntilReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(localUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status < 500) {
        return;
      }
    } catch {
      // The server is still restarting.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`LocalMind did not become ready at ${localUrl}`);
}

await assertContainerIsRunning();

if (target === 'backend' || target === 'all') {
  await syncBackend();
}
if (target === 'web' || target === 'all') {
  await syncWeb();
}

await run('docker', ['restart', container]);
await waitUntilReady();
console.log(
  `LocalMind ${target} synced without rebuilding the image: ${localUrl}`
);
