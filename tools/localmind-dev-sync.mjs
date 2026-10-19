import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.LOCALMIND_CONTAINER || 'localmind_affine_server';
const localUrl = process.env.LOCALMIND_URL || 'http://localhost:3011';
const target = process.argv[2] || 'backend';
const runtimeSource = process.env.LOCALMIND_RUNTIME_SOURCE_CONTAINER;
const backupPath = process.env.LOCALMIND_DATABASE_BACKUP;
const runtimeStatePath = '/app/localmind-dev-sync-state.json';
const runtimeMode = process.env.LOCALMIND_RUNTIME_MODE || 'bundled';
const migrationContainer = process.env.LOCALMIND_RUNTIME_MIGRATION_CONTAINER;

if (!['backend', 'web', 'all'].includes(target)) {
  console.error('Usage: node tools/localmind-dev-sync.mjs [backend|web|all]');
  process.exit(2);
}
if (!['bundled', 'source'].includes(runtimeMode))
  throw new Error('LOCALMIND_RUNTIME_MODE must be bundled or source');
if (runtimeMode === 'source' && target !== 'backend')
  throw new Error('Source runtime synchronization only supports backend');

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
        !path.startsWith('.codex-artifacts/') &&
        !path.startsWith('backups/') &&
        !path.startsWith('.docker/')
    )
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
    // Prisma also moves fields placed after block attributes when generating
    // its embedded schema. Canonicalize a temporary source copy with the pinned
    // formatter, preserving quoted values instead of treating that as drift.
    const schemaTokens = value =>
      value
        .toString()
        .match(/"(?:\\.|[^"\\])*"|[^\s]/g)
        ?.join('');
    const sourceSchema = await readFile(
      resolve(repoRoot, 'packages/backend/server/schema.prisma')
    );
    const canonicalSchemaPath = `${temporary}/source.prisma`;
    await writeFile(canonicalSchemaPath, sourceSchema);
    await run(process.execPath, [
      resolve(repoRoot, 'node_modules/prisma/build/index.js'),
      'format',
      '--schema',
      canonicalSchemaPath,
    ]);
    if (
      schemaTokens(generatedSchema) !==
      schemaTokens(await readFile(canonicalSchemaPath))
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

async function syncSourceBackend() {
  if (
    !runtimeSource ||
    !backupPath ||
    !migrationContainer ||
    migrationContainer === container
  )
    throw new Error(
      'Source runtime synchronization requires a validated Linux source, database backup and separate migration container'
    );
  const inspected = JSON.parse(
    await run('docker', ['inspect', container], true)
  )[0];
  const composeFiles =
    inspected.Config.Labels?.['com.docker.compose.project.config_files']?.split(
      ','
    );
  const composeService =
    inspected.Config.Labels?.['com.docker.compose.service'];
  const composeProject =
    inspected.Config.Labels?.['com.docker.compose.project'];
  if (!composeFiles?.length || !composeService || !composeProject)
    throw new Error(
      'Source runtime synchronization requires a Compose-managed service'
    );
  for (const file of composeFiles) {
    const path = relative(repoRoot, file);
    if (
      !path ||
      path.startsWith('..') ||
      path.startsWith('/') ||
      !(await stat(file)).isFile()
    )
      throw new Error(
        'Source runtime Compose files must belong to this repository'
      );
  }
  const nativeMount = inspected.Mounts.find(
    mount =>
      mount.Type === 'bind' &&
      mount.Destination ===
        '/workspace/packages/backend/native/server-native.node'
  );
  const nativePath = nativeMount?.Source;
  const nativeRelative = nativePath && relative(repoRoot, nativePath);
  if (
    !nativePath ||
    !nativeRelative ||
    nativeRelative.startsWith('..') ||
    nativeRelative.startsWith('/')
  )
    throw new Error(
      'Source runtime native addon must be bound from this repository'
    );
  const databaseEnvironment = inspected.Config.Env.find(value =>
    value.startsWith('DATABASE_URL=')
  );
  if (!databaseEnvironment)
    throw new Error('Source runtime database configuration is unavailable');
  const migrationInfo = JSON.parse(
    await run('docker', ['inspect', migrationContainer], true)
  )[0];
  if (
    !Object.keys(inspected.NetworkSettings.Networks).some(
      network => network in migrationInfo.NetworkSettings.Networks
    )
  )
    throw new Error(
      'Migration container must share the runtime database network'
    );
  const databaseIdentity = `const {PrismaClient}=require('/workspace/node_modules/@prisma/client'); const db=new PrismaClient(); db.$queryRawUnsafe('SELECT current_database() AS database, pg_postmaster_start_time() AS started_at').then(rows=>console.log(JSON.stringify(rows))).finally(()=>db.$disconnect());`;
  const currentDatabase = await run(
    'docker',
    ['exec', container, 'node', '-e', databaseIdentity],
    true
  );
  const migrationDatabase = await run(
    'docker',
    [
      'exec',
      '-e',
      databaseEnvironment,
      migrationContainer,
      'node',
      '-e',
      databaseIdentity,
    ],
    true
  );
  if (currentDatabase !== migrationDatabase)
    throw new Error('Migration container resolved a different database');
  const currentSchemaHash = createHash('sha256')
    .update(
      await readFile(resolve(repoRoot, 'packages/backend/server/schema.prisma'))
    )
    .digest('hex');
  const migrationSchemaHash = await run(
    'docker',
    [
      'exec',
      migrationContainer,
      'node',
      '-e',
      `console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('/workspace/packages/backend/server/schema.prisma')).digest('hex'))`,
    ],
    true
  );
  if (currentSchemaHash !== migrationSchemaHash)
    throw new Error('Migration container source schema differs');
  const runtime = await prepareRuntimeSync();
  if (!runtime)
    throw new Error('Validated source runtime artifacts are unavailable');
  let stopped = false;
  try {
    // Quiesce every worker before changing schema/client/native together.
    await run('docker', ['stop', container]);
    stopped = true;
    // Credentials stay in this process and the short-lived migration process;
    // they are never written to files, logs or the source container configuration.
    await run('docker', [
      'exec',
      '-w',
      '/workspace/packages/backend/server',
      '-e',
      databaseEnvironment,
      migrationContainer,
      '/workspace/node_modules/.bin/prisma',
      'migrate',
      'deploy',
    ]);
    await run('docker', [
      'cp',
      `${runtime}/client/.`,
      `${container}:/workspace/node_modules/.prisma/client`,
    ]);
    // Replace on the host while the container is stopped. A file bind mount must
    // be rebound at startup; renaming its mounted destination would fail EBUSY.
    const nextNative = `${nativePath}.next`;
    await copyFile(`${runtime}/server-native.node`, nextNative);
    await rename(nextNative, nativePath);
    await copyFile(
      `${runtime}/state.json`,
      resolve(dirname(nativePath), 'localmind-dev-sync-state.json')
    );
    await run('docker', [
      'compose',
      ...composeFiles.flatMap(file => ['-f', file]),
      '-p',
      composeProject,
      'up',
      '-d',
      '--no-deps',
      '--no-build',
      '--force-recreate',
      composeService,
    ]);
    stopped = false;
  } catch (error) {
    if (stopped)
      console.error(
        'Source runtime remains stopped after an incomplete synchronization; preserve the backup and retry.'
      );
    throw error;
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
}

async function syncWeb() {
  process.env.LOCALMIND_WORKER_BUILD_ID = Date.now().toString(36);
  await run('yarn', ['affine', 'bundle', '-p', '@affine/web']);
  // The server serves mobile assets before web assets at the same URL prefix.
  // Keep their shared worker filenames in sync with the current source.
  await run('yarn', ['affine', 'bundle', '-p', '@affine/mobile']);
  await run('yarn', ['affine', 'bundle', '-p', '@affine/admin']);
  await run('docker', [
    'cp',
    'packages/frontend/apps/web/dist/.',
    `${container}:/app/static`,
  ]);
  await run('docker', [
    'cp',
    'packages/frontend/apps/mobile/dist/.',
    `${container}:/app/static/mobile`,
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
        const api = await fetch(`${localUrl}/graphql`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' }),
          signal: AbortSignal.timeout(2_000),
        });
        if (api.ok && (await api.json()).data?.__typename === 'Query') return;
      }
    } catch {
      // The server is still restarting.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`LocalMind did not become ready at ${localUrl}`);
}

async function verifyWebEntrypoint() {
  // Hashed assets are not usable while the HTML entrypoint points to an older
  // build. Refresh both HTML variants after restart and check the served page.
  for (const name of ['index.html', 'selfhost.html']) {
    await run('docker', [
      'cp',
      `packages/frontend/apps/web/dist/${name}`,
      `${container}:/app/static/${name}`,
    ]);
  }

  const html = await readFile(
    resolve(repoRoot, 'packages/frontend/apps/web/dist/selfhost.html'),
    'utf8'
  );
  const entryScript = html.match(/\/js\/index\.[a-f0-9]+\.js/)?.[0];
  if (!entryScript) throw new Error('Built web entry script was not found');

  const response = await fetch(localUrl, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || !(await response.text()).includes(entryScript)) {
    throw new Error(
      `LocalMind is still serving an older web entrypoint than ${entryScript}`
    );
  }
}

await assertContainerIsRunning();

if (target === 'backend' || target === 'all') {
  if (runtimeMode === 'source') await syncSourceBackend();
  else await syncBackend();
}
if (target === 'web' || target === 'all') {
  await syncWeb();
}

if (runtimeMode !== 'source') await run('docker', ['restart', container]);
await waitUntilReady();
if (target === 'web' || target === 'all') {
  await verifyWebEntrypoint();
}
console.log(
  `LocalMind ${target} synced without rebuilding the image: ${localUrl}`
);
