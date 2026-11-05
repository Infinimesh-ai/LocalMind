import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Run only on disposable GitHub runners: the packaged app owns its normal
// profile path, and this test must never edit a developer's existing documents.
assert.equal(process.env.GITHUB_ACTIONS, 'true');
const [appDir, outputDir, version, channel, arch] = process.argv.slice(2);
assert.ok(appDir && outputDir && version && channel && arch);
assert.equal(process.arch, arch, 'A native runner is required');
assert.ok(['win32', 'linux'].includes(process.platform));
const product = channel === 'stable' ? 'LocalMind' : `LocalMind-${channel}`;
const appData =
  process.platform === 'win32'
    ? process.env.APPDATA
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
assert.ok(appData);
for (const name of [product, product.replace('LocalMind', 'AFFiNE')]) {
  assert.ok(!fs.existsSync(path.join(appData, name)), 'Existing profile found');
}
const executableName = fs
  .readdirSync(appDir)
  .find(name =>
    new RegExp(
      `^${product}${process.platform === 'win32' ? '\\.exe' : ''}$`,
      'i'
    ).test(name)
  );
assert.ok(executableName, 'Packaged executable is missing');
const executable = path.resolve(appDir, executableName);
fs.mkdirSync(outputDir, { recursive: true });

const title = `LocalMind release ${version} ${arch}`;
const body = `Persistence check ${Date.now()} — 正式版保存验证`;
const result = {
  version,
  channel,
  arch,
  platform: process.platform,
  checks: [],
};
const clients = new Set();
let child;
let childExit;

class Page {
  pending = new Map();
  sequence = 0;
  exceptions = [];

  async connect(url) {
    this.socket = new WebSocket(url);
    clients.add(this);
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (request) {
          clearTimeout(request.timer);
          this.pending.delete(message.id);
          if (message.error)
            request.reject(new Error(JSON.stringify(message.error)));
          else request.resolve(message.result);
        }
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params.exceptionDetails);
      }
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    await this.send('Runtime.enable');
    return this;
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.ok(
      !response.exceptionDetails,
      JSON.stringify(response.exceptionDetails)
    );
    return response.result.value;
  }

  async screenshot(name) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(outputDir, name),
      Buffer.from(shot.data, 'base64')
    );
  }

  close() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('CDP connection closed'));
    }
    this.pending.clear();
    this.socket.close();
    clients.delete(this);
  }
}

const queryHelper = `
  window.releaseQuery = selector => {
    function search(root) {
      const found = root.querySelector(selector);
      if (found) return found;
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) {
          const nested = search(element.shadowRoot);
          if (nested) return nested;
        }
      }
      return null;
    }
    return search(document);
  };
  window.releaseText = () => {
    function text(root) {
      let value = root.textContent || '';
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) value += text(element.shadowRoot);
      }
      return value;
    }
    return text(document.body);
  };
`;

async function until(check, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(
        `App exited while waiting for ${label}: ${child.exitCode}`
      );
    }
    const value = await check();
    if (value) return value;
    await delay(500);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function launch(iteration) {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const env = {
    ...process.env,
    SKIP_ONBOARDING: '1',
    LOCALMIND_EXTERNAL_TELEMETRY: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  child = spawn(
    executable,
    [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const log = fs.createWriteStream(
    path.join(outputDir, `launch-${iteration}.log`)
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  childExit = new Promise(resolve => {
    child.once('error', error => resolve({ error: error.message }));
    child.once('close', (code, signal) => {
      log.end();
      resolve({ code, signal });
    });
  });
  const pages = new Map();
  const page = await until(async () => {
    let targets;
    try {
      targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(2000),
        })
      ).json();
    } catch {
      return false;
    }
    for (const target of targets.filter(
      item => item.type === 'page' && item.url.startsWith('assets://')
    )) {
      let candidate = pages.get(target.id);
      if (!candidate) {
        candidate = await new Page().connect(target.webSocketDebuggerUrl);
        pages.set(target.id, candidate);
      }
      await candidate.evaluate(queryHelper);
      if (
        await candidate.evaluate(`!!releaseQuery('doc-title .inline-editor')`)
      )
        return candidate;
    }
    return false;
  }, 'packaged document editor');
  await page.evaluate(
    `window.__apis.updater.setConfig({ autoCheckUpdate: false, autoDownloadUpdate: false })`
  );
  assert.equal(
    await page.evaluate('window.__apis.updater.currentVersion()'),
    version
  );
  assert.equal(
    await page.evaluate('window.__appInfo.scheme'),
    channel === 'stable' ? 'localmind' : `localmind-${channel}`
  );
  return page;
}

async function quit(page) {
  // Schedule quit after the CDP response so a closed connection cannot mask a
  // failed shutdown. The packaged app's own close handler flushes native data.
  await page.evaluate(
    'setTimeout(() => window.__apis.ui.handleCloseApp(), 100); true'
  );
  for (const client of clients) client.close();
  const exit = await Promise.race([
    childExit,
    delay(30000).then(() => ({ timeout: true })),
  ]);
  assert.deepEqual(exit, { code: 0, signal: null }, 'App must exit normally');
  child = undefined;
}

try {
  const page = await launch(1);
  result.checks.push('packaged-editor-started', 'version-and-channel');
  await page.evaluate(`(() => {
    const editor = releaseQuery('doc-title .inline-editor');
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  })()`);
  await page.send('Input.insertText', { text: title });
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  await page.send('Input.insertText', { text: body });
  const containsEdit = `releaseQuery('doc-title .inline-editor')?.textContent.includes(${JSON.stringify(title)}) && releaseText().includes(${JSON.stringify(body)})`;
  await until(() => page.evaluate(containsEdit), 'document edit');
  await delay(3000);
  await page.screenshot('edited.png');
  assert.deepEqual(
    page.exceptions,
    [],
    'Renderer raised an uncaught exception'
  );
  await quit(page);
  result.checks.push('document-edited', 'normal-shutdown');
  const reopened = await launch(2);
  await until(
    () => reopened.evaluate(containsEdit),
    'persisted document after restart'
  );
  await reopened.screenshot('restored.png');
  assert.deepEqual(
    reopened.exceptions,
    [],
    'Renderer raised an uncaught exception'
  );
  await quit(reopened);
  result.checks.push('document-restored-after-restart');
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  for (const client of clients) client.close();
  if (child && child.exitCode === null) child.kill();
  fs.writeFileSync(
    path.join(outputDir, 'result.json'),
    JSON.stringify(result, null, 2)
  );
}
