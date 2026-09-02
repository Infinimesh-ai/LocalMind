import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.LOCALMIND_CONTAINER || 'localmind_affine_server';
const localUrl = process.env.LOCALMIND_URL || 'http://localhost:3011';
const target = process.argv[2] || 'backend';

if (!['backend', 'web', 'all'].includes(target)) {
  console.error('Usage: node tools/localmind-dev-sync.mjs [backend|web|all]');
  process.exit(2);
}

async function run(command, args) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', rejectRun);
    child.on('exit', code => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${command} exited with code ${code ?? 1}`));
      }
    });
  });
}

async function assertContainerIsRunning() {
  await run('docker', ['inspect', '--format', '{{.State.Running}}', container]);
}

async function syncBackend() {
  await run('yarn', ['affine', 'bundle', '-p', '@affine/server']);

  // Copy only the JavaScript bundle. The container keeps its Linux native addon.
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
