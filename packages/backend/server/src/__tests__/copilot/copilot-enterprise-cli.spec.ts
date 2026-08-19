import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  EnterpriseAuthorizationStatus,
  EnterpriseConnectionStatus,
  EnterpriseConnectionTransport,
  EnterpriseProvider,
} from '@prisma/client';
import test from 'ava';
import Sinon from 'sinon';

import { EnterpriseAuthorizationWorker } from '../../plugins/copilot/enterprise/authorization-worker';
import {
  EnterpriseCliRuntime,
  EnterpriseCliRuntimeError,
} from '../../plugins/copilot/enterprise/cli/runtime';
import { DingTalkCliDriver } from '../../plugins/copilot/enterprise/providers/dingtalk';
import { LarkCliDriver } from '../../plugins/copilot/enterprise/providers/lark';
import { WeComCliDriver } from '../../plugins/copilot/enterprise/providers/wecom';
import { EnterpriseConnectionResolver } from '../../plugins/copilot/enterprise/resolver';
import { EnterpriseConnectionService } from '../../plugins/copilot/enterprise/service';
import { EnterpriseToolRegistry } from '../../plugins/copilot/enterprise/tool-registry';

function runtimeConfig(rootDir: string) {
  return {
    copilot: {
      enterpriseCli: {
        enabled: true,
        rootDir,
        binaries: {
          wecom: process.execPath,
          lark: process.execPath,
          dingtalk: process.execPath,
        },
      },
    },
  } as any;
}

test('EnterpriseCliRuntime uses argv execution and an isolated provider profile', async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'localmind-cli-runtime-'));
  const runtime = new EnterpriseCliRuntime(runtimeConfig(rootDir));
  try {
    const result = await runtime.execute({
      provider: EnterpriseProvider.WECOM,
      profileKey: 'profile-safe_1',
      args: [
        '-e',
        'console.log(JSON.stringify({value:process.argv[1],profile:process.env.WECOM_CLI_CONFIG_DIR}))',
        '$(echo should-not-run)',
      ],
    });
    t.deepEqual(result.data, {
      value: '$(echo should-not-run)',
      profile: path.join(rootDir, 'wecom', 'profile-safe_1'),
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('EnterpriseCliRuntime isolates provider credential data and preserves failed output', async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'localmind-cli-env-'));
  const runtime = new EnterpriseCliRuntime(runtimeConfig(rootDir));
  try {
    const lark = await runtime.execute({
      provider: EnterpriseProvider.LARK,
      profileKey: 'lark-profile',
      args: [
        '-e',
        'console.log(JSON.stringify({config:process.env.LARKSUITE_CLI_CONFIG_DIR,data:process.env.LARKSUITE_CLI_DATA_DIR}))',
      ],
    });
    t.deepEqual(lark.data, {
      config: path.join(rootDir, 'lark', 'lark-profile'),
      data: path.join(rootDir, 'lark', 'lark-profile', 'data'),
    });

    const dingtalk = await runtime.execute({
      provider: EnterpriseProvider.DINGTALK,
      profileKey: 'dingtalk-profile',
      dingtalkAutoApplyCliAccess: true,
      args: [
        '-e',
        'console.log(JSON.stringify({config:process.env.DWS_CONFIG_DIR,keychain:process.env.DWS_KEYCHAIN_DIR,disabled:process.env.DWS_DISABLE_KEYCHAIN ?? null,autoApply:process.env.DWS_CLI_AUTH_AUTO_APPLY ?? null}))',
      ],
    });
    t.deepEqual(dingtalk.data, {
      config: path.join(rootDir, 'dingtalk', 'dingtalk-profile'),
      keychain: path.join(rootDir, 'dingtalk', 'dingtalk-profile', 'keychain'),
      disabled: null,
      autoApply: '1',
    });

    const failed = await runtime.execute({
      provider: EnterpriseProvider.LARK,
      profileKey: 'failed-profile',
      args: ['-e', 'process.stdout.write("plain failure");process.exit(2)'],
    });
    t.is(failed.exitCode, 2);
    t.is(failed.stdout, 'plain failure');
    t.is(failed.data, null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('EnterpriseCliRuntime rejects unsafe profiles and oversized output', async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'localmind-cli-limits-'));
  const runtime = new EnterpriseCliRuntime(runtimeConfig(rootDir));
  try {
    const profileError = await t.throwsAsync(
      runtime.execute({
        provider: EnterpriseProvider.WECOM,
        profileKey: '../escape',
        args: ['-e', 'console.log("{}")'],
      }),
      { instanceOf: EnterpriseCliRuntimeError }
    );
    t.is(profileError.code, 'enterprise_cli_invalid_profile');

    const outputError = await t.throwsAsync(
      runtime.execute({
        provider: EnterpriseProvider.WECOM,
        profileKey: 'bounded',
        args: ['-e', 'console.log("x".repeat(2048))'],
        maxOutputBytes: 1024,
      }),
      { instanceOf: EnterpriseCliRuntimeError }
    );
    t.is(outputError.code, 'enterprise_cli_output_too_large');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('EnterpriseCliRuntime removes only the selected provider profile', async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'localmind-cli-remove-'));
  const runtime = new EnterpriseCliRuntime(runtimeConfig(rootDir));
  const selected = runtime.profileDirectory(
    EnterpriseProvider.LARK,
    'selected-profile'
  );
  const retained = runtime.profileDirectory(
    EnterpriseProvider.LARK,
    'retained-profile'
  );
  try {
    await mkdir(selected, { recursive: true });
    await mkdir(retained, { recursive: true });

    await runtime.removeProfile(EnterpriseProvider.LARK, 'selected-profile');

    await t.throwsAsync(access(selected));
    await t.notThrowsAsync(access(retained));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('EnterpriseCliRuntime streams authorization output and restricts profile files', async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'localmind-cli-auth-'));
  const runtime = new EnterpriseCliRuntime(runtimeConfig(rootDir));
  const chunks: string[] = [];
  try {
    const result = await runtime.executeAuthorization({
      provider: EnterpriseProvider.WECOM,
      profileKey: 'auth-profile',
      args: [
        '-e',
        'process.stdout.write("challenge:");setTimeout(()=>process.stdout.write("ready"),10)',
      ],
      outputMode: 'text',
      onStdout: chunk => chunks.push(chunk),
    });
    t.is(result.stdout, 'challenge:ready');
    t.is(chunks.join(''), 'challenge:ready');

    const profileDir = runtime.profileDirectory(
      EnterpriseProvider.WECOM,
      'auth-profile'
    );
    await writeFile(path.join(profileDir, 'authorization.png'), 'png-data');
    t.is(
      String(
        await runtime.readProfileFile(
          EnterpriseProvider.WECOM,
          'auth-profile',
          'authorization.png'
        )
      ),
      'png-data'
    );
    await t.throwsAsync(
      runtime.readProfileFile(
        EnterpriseProvider.WECOM,
        'auth-profile',
        '../authorization.png'
      ),
      { instanceOf: EnterpriseCliRuntimeError }
    );
    await t.throwsAsync(
      runtime.readProfileFile(
        EnterpriseProvider.WECOM,
        'auth-profile',
        'authorization.png',
        4
      ),
      { instanceOf: EnterpriseCliRuntimeError }
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('WeCom authorization emits the official URL and server QR file', async t => {
  const executeAuthorization = Sinon.stub().callsFake(async input => {
    input.onStdout?.(
      '请访问 https://work.weixin.qq.com/wework_admin/frame#apps\n二维码已保存到 authorization.png'
    );
    return {
      exitCode: 0,
      stdout: 'authorized',
      stderr: '',
      durationMs: 1,
      data: 'authorized',
    };
  });
  const execute = Sinon.stub().resolves({
    exitCode: 0,
    stdout: 'authorized',
    stderr: '',
    durationMs: 1,
    data: 'authorized',
  });
  const challenges: unknown[] = [];
  const driver = new WeComCliDriver({
    executeAuthorization,
    execute,
    removeProfileFile: Sinon.stub().resolves(),
  } as any);

  const auth = await driver.authorize('profile-wecom', {
    signal: new AbortController().signal,
    qrCodePath: 'authorization-test.png',
    onChallenge: async challenge => {
      challenges.push(challenge);
    },
  });

  t.true(auth.authorized);
  t.deepEqual(executeAuthorization.firstCall.args[0].args, [
    'auth',
    'init',
    '--noninteractive',
    '--no-browser',
    '--output-qrcode',
    'authorization-test.png',
  ]);
  t.like(challenges.at(-1) as object, {
    authorizationUrl: 'https://work.weixin.qq.com/wework_admin/frame#apps',
    qrCodePath: 'authorization-test.png',
  });
});

test('Lark authorization keeps device code inside the cloud driver', async t => {
  const execute = Sinon.stub();
  execute.onFirstCall().resolves({
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1,
    data: {
      verification_url: 'https://accounts.feishu.cn/device',
      device_code: 'server-only-device-code',
      expires_in: 600,
    },
  });
  execute.onSecondCall().resolves({
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1,
    data: { identity: 'user', verified: true },
  });
  const executeAuthorization = Sinon.stub().resolves({
    exitCode: 0,
    stdout: '{}',
    stderr: '',
    durationMs: 1,
    data: {},
  });
  const challenges: unknown[] = [];
  const driver = new LarkCliDriver({ execute, executeAuthorization } as any);

  const auth = await driver.authorize('profile-lark', {
    signal: new AbortController().signal,
    onChallenge: async challenge => {
      challenges.push(challenge);
    },
  });

  t.true(auth.authorized);
  t.deepEqual(
    challenges.map(challenge => Object.keys(challenge as object)),
    [['authorizationUrl', 'expiresAt']]
  );
  t.deepEqual(executeAuthorization.firstCall.args[0].args, [
    'auth',
    'login',
    '--device-code',
    'server-only-device-code',
    '--json',
  ]);
});

test('Lark authorization initializes an app before first user login', async t => {
  const execute = Sinon.stub();
  execute.onFirstCall().resolves({
    exitCode: 3,
    stdout: JSON.stringify({
      ok: false,
      error: { type: 'config', subtype: 'not_configured' },
    }),
    stderr: '',
    durationMs: 1,
    data: null,
  });
  execute.onSecondCall().resolves({
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1,
    data: {
      verification_uri_complete: 'https://accounts.feishu.cn/device?code=1',
      device_code: 'server-only-device-code',
      expires_in: 600,
    },
  });
  execute.onThirdCall().resolves({
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1,
    data: { identity: 'user', verified: true },
  });
  const executeAuthorization = Sinon.stub();
  executeAuthorization.onFirstCall().callsFake(async input => {
    input.onStderr?.(
      'Open this link:\n  https://open.feishu.cn/page/cli?user_code=APP-42&from=cli\n'
    );
    return {
      exitCode: 0,
      stdout: '{"appId":"cli_test","appSecret":"****"}',
      stderr: '',
      durationMs: 1,
      data: { appId: 'cli_test', appSecret: '****' },
    };
  });
  executeAuthorization.onSecondCall().resolves({
    exitCode: 0,
    stdout: '{}',
    stderr: '',
    durationMs: 1,
    data: {},
  });
  const challenges: Array<{ authorizationUrl?: string }> = [];
  const driver = new LarkCliDriver({ execute, executeAuthorization } as any);

  const auth = await driver.authorize('profile-lark-new', {
    signal: new AbortController().signal,
    onChallenge: async challenge => {
      challenges.push(challenge);
    },
  });

  t.true(auth.authorized);
  t.deepEqual(executeAuthorization.firstCall.args[0].args, [
    'config',
    'init',
    '--new',
    '--brand',
    'feishu',
  ]);
  t.deepEqual(
    challenges.map(challenge => challenge.authorizationUrl),
    [
      'https://open.feishu.cn/page/cli?user_code=APP-42&from=cli',
      'https://accounts.feishu.cn/device?code=1',
    ]
  );
});

test('DingTalk authorization parses ANSI output and user code', async t => {
  const patUrl =
    'https://open-dev.dingtalk.com/fe/old?hash=%23%2FpersonalAuthorization%3FflowId%3Dflow-42%26userCode%3DPAT-42#/personalAuthorization?flowId=flow-42&userCode=PAT-42';
  const executeAuthorization = Sinon.stub().callsFake(async input => {
    input.onStderr?.(
      '\u001b[32m请打开 https://login.dingtalk.com/oauth/device 授权码: DT-42\u001b[0m'
    );
    input.onStderr?.('\nLOCALMIND_DINGTALK_ADMIN_APPROVAL_PENDING\n');
    input.onStderr?.(`\n需要 PAT 授权\n授权链接: ${patUrl}\n`);
    return {
      exitCode: 0,
      stdout: '{"success":true}',
      stderr: '',
      durationMs: 1,
      data: { success: true },
    };
  });
  const execute = Sinon.stub().resolves({
    exitCode: 0,
    stdout: '{}',
    stderr: '',
    durationMs: 1,
    data: { authenticated: true },
  });
  const challenges: unknown[] = [];
  const driver = new DingTalkCliDriver({
    execute,
    executeAuthorization,
  } as any);

  const auth = await driver.authorize('profile-dingtalk', {
    signal: new AbortController().signal,
    onChallenge: async challenge => {
      challenges.push(challenge);
    },
  });

  t.true(auth.authorized);
  t.like(challenges[0] as object, {
    authorizationUrl: 'https://login.dingtalk.com/oauth/device',
    userCode: 'DT-42',
  });
  t.deepEqual(challenges[1], { clearPrevious: true });
  t.like(challenges[2] as object, {
    authorizationUrl: patUrl,
    userCode: 'PAT-42',
  });
  t.deepEqual(executeAuthorization.firstCall.args[0].args, [
    'auth',
    'login',
    '--device',
    '--no-browser',
    '--recommend',
    '--format',
    'json',
  ]);
  t.true(executeAuthorization.firstCall.args[0].dingtalkAutoApplyCliAccess);
});

test('DingTalk authorization publishes the latest rotated device code', async t => {
  const executeAuthorization = Sinon.stub().callsFake(async input => {
    input.onStderr?.(
      '\u001b[32m链接: https://login.dingtalk.com/oauth2/device/verify.htm?user_code=OLD1-CODE 授权码: OLD1-CODE 授权码将在 900 秒后过期。\u001b[0m'
    );
    input.onStderr?.(
      '\n授权码已过期。\n链接: https://login.dingtalk.com/oauth2/device/verify.htm?user_code=NEW2-CODE 授权码: NEW2-CODE'
    );
    input.onStderr?.(
      '\n管理应用: https://open-dev.dingtalk.com/fe/old#/developerSettings'
    );
    return {
      exitCode: 0,
      stdout: '{"success":true}',
      stderr: '',
      durationMs: 1,
      data: { success: true },
    };
  });
  const execute = Sinon.stub().resolves({
    exitCode: 0,
    stdout: '{}',
    stderr: '',
    durationMs: 1,
    data: { authenticated: true },
  });
  const challenges: Array<{
    authorizationUrl?: string;
    userCode?: string;
    expiresAt?: Date;
  }> = [];
  const driver = new DingTalkCliDriver({
    execute,
    executeAuthorization,
  } as any);
  const startedAt = Date.now();

  await driver.authorize('profile-dingtalk-rotated', {
    signal: new AbortController().signal,
    onChallenge: async challenge => {
      challenges.push(challenge);
    },
  });

  const latest = challenges.at(-1);
  t.like(latest, {
    authorizationUrl:
      'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=NEW2-CODE',
    userCode: 'NEW2-CODE',
  });
  t.true((latest?.expiresAt?.getTime() ?? 0) >= startedAt + 599_000);
  t.true((latest?.expiresAt?.getTime() ?? Infinity) <= Date.now() + 600_000);
});

test('WeCom driver projects schema summaries into guarded payload tools', async t => {
  const execute = Sinon.stub().resolves({
    exitCode: 0,
    stdout: '[]',
    stderr: '',
    durationMs: 1,
    data: [
      {
        name: 'doc',
        methods: [
          { name: 'doc.search', description: 'Search WeCom documents' },
          { name: 'doc.delete', description: 'Delete a WeCom document' },
        ],
      },
    ],
  });
  const driver = new WeComCliDriver({ execute } as any);

  const tools = await driver.discoverTools('profile-1');

  t.deepEqual(
    tools.map(tool => ({ name: tool.name, risk: tool.risk })),
    [
      { name: 'wecom_doc_search', risk: 'read' },
      { name: 'wecom_doc_delete', risk: 'high' },
    ]
  );
  t.deepEqual(tools[0].inputSchema, {
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
  });
});

test('Lark driver preserves official input schema and risk metadata', async t => {
  const execute = Sinon.stub().resolves({
    exitCode: 0,
    stdout: '[]',
    stderr: '',
    durationMs: 1,
    data: [
      {
        name: 'calendar events list',
        description: 'List calendar events',
        inputSchema: {
          type: 'object',
          properties: { params: { type: 'object' } },
        },
        _meta: { risk: 'read' },
      },
      {
        name: 'im messages delete',
        description: 'Delete a message',
        inputSchema: {
          type: 'object',
          properties: { params: { type: 'object' }, yes: { type: 'boolean' } },
        },
        _meta: { risk: 'high-risk-write' },
      },
    ],
  });
  const driver = new LarkCliDriver({ execute } as any);

  const tools = await driver.discoverTools('profile-1');

  t.deepEqual(
    tools.map(tool => ({
      name: tool.name,
      risk: tool.risk,
      requiresConfirmation: tool.requiresConfirmation,
    })),
    [
      {
        name: 'lark_calendar_events_list',
        risk: 'read',
        requiresConfirmation: false,
      },
      {
        name: 'lark_im_messages_delete',
        risk: 'high',
        requiresConfirmation: true,
      },
    ]
  );
});

test('Lark driver discovers shortcut commands from Cobra help', async t => {
  const execute = Sinon.stub().callsFake(
    async ({ args }: { args: string[] }) => {
      let output: unknown = '';
      if (args[0] === 'schema') output = [];
      if (args[0] === '__complete' && args[1] === '') {
        output = 'docs\tDocument operations\n:4';
      }
      if (args[0] === '__complete' && args[1] === 'docs') {
        output = '+create\tCreate a Lark document\n:4';
      }
      if (args[0] === 'docs' && args[1] === '+create') {
        output = `Create a Lark document

Risk: write

Flags:
      --content string        document body (required)
      --dry-run               print request without executing
      --format string         output format
  -h, --help                  help for +create
      --parent-id string      (required, mutually exclusive with --space-id) parent
      --record-id stringArray   record ID (repeatable)
      --retry-count int       retry count
      --yes                   confirm high-risk operation`;
      }
      return {
        exitCode: 0,
        stdout: typeof output === 'string' ? output : JSON.stringify(output),
        stderr: '',
        durationMs: 1,
        data: output,
      };
    }
  );
  const driver = new LarkCliDriver({ execute } as any);

  const tools = await driver.discoverTools('profile-shortcuts');

  t.is(tools.length, 1);
  t.like(tools[0], {
    name: 'lark_docs__create',
    command: ['docs', '+create'],
    description: 'Create a Lark document',
    risk: 'write',
    requiresConfirmation: true,
    supportsDryRun: true,
  });
  t.deepEqual(tools[0].inputSchema, {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'document body (required)' },
      dryRun: {
        type: 'boolean',
        description: 'print request without executing',
      },
      parentId: {
        type: 'string',
        description: '(required, mutually exclusive with --space-id) parent',
      },
      recordId: {
        type: 'array',
        items: { type: 'string' },
        description: 'record ID (repeatable)',
      },
      retryCount: { type: 'integer', description: 'retry count' },
    },
    required: ['content'],
    additionalProperties: false,
  });
});

test('Lark driver repeats shortcut array flags', async t => {
  const execute = Sinon.stub().resolves({
    exitCode: 0,
    stdout: '{}',
    stderr: '',
    durationMs: 1,
    data: {},
  });
  const driver = new LarkCliDriver({ execute } as any);

  await driver.execute('profile-shortcut-array', {
    tool: {
      name: 'lark_base__record_delete',
      command: ['base', '+record-delete'],
      description: 'Delete records',
      inputSchema: {
        type: 'object',
        properties: {
          recordId: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      risk: 'high',
      requiresConfirmation: true,
      supportsDryRun: true,
    },
    arguments: { recordId: ['rec-one', 'rec-two'] },
    idempotencyKey: 'call-shortcut-array',
    confirmed: true,
  });

  t.deepEqual(execute.firstCall.args[0].args, [
    'base',
    '+record-delete',
    '--record-id',
    'rec-one',
    '--record-id',
    'rec-two',
    '--format',
    'json',
    '--yes',
  ]);
});

test('Lark driver maps schema input buckets to CLI carriers', async t => {
  const execute = Sinon.stub();
  execute.onFirstCall().resolves({
    exitCode: 0,
    stdout: '{}',
    stderr: '',
    durationMs: 1,
    data: {},
  });
  const driver = new LarkCliDriver({ execute } as any);
  await driver.execute('profile-1', {
    tool: {
      name: 'lark_im_images_create',
      command: ['im', 'images', 'create'],
      description: 'Upload an image',
      inputSchema: {
        type: 'object',
        properties: {
          params: { type: 'object' },
          data: { type: 'object', carrier: '--data' },
          file: { type: 'object', carrier: '--file' },
        },
      },
      risk: 'write',
      requiresConfirmation: false,
      supportsDryRun: true,
    },
    arguments: {
      params: { image_type: 'message' },
      data: { checksum: 'abc' },
      file: { image: './upload.png', thumbnail: ['./one.png', './two.png'] },
    },
    idempotencyKey: 'call-lark-1',
    confirmed: false,
  });

  t.deepEqual(execute.firstCall.args[0].args, [
    'im',
    'images',
    'create',
    '--params',
    '{"image_type":"message"}',
    '--data',
    '{"checksum":"abc"}',
    '--file',
    'image=./upload.png',
    '--file',
    'thumbnail=./one.png',
    '--file',
    'thumbnail=./two.png',
    '--format',
    'json',
  ]);
});

test('DingTalk driver builds JSON schema and only confirms through LocalMind', async t => {
  const execute = Sinon.stub();
  execute.onFirstCall().resolves({
    exitCode: 0,
    stdout: '{}',
    stderr: '',
    durationMs: 1,
    data: {
      products: [
        {
          tools: [
            {
              cli_path: 'calendar event list',
              agent_summary: 'List DingTalk calendar events',
              effect: 'write',
              risk: 'low',
              confirmation: 'user_required',
              parameters: {
                startTime: {
                  type: 'string',
                  description: 'Start time',
                  required: true,
                },
              },
            },
          ],
        },
      ],
    },
  });
  execute.onSecondCall().resolves({
    exitCode: 0,
    stdout: '{"result":[]}',
    stderr: '',
    durationMs: 7,
    data: { result: [] },
  });
  const driver = new DingTalkCliDriver({ execute } as any);
  const [tool] = await driver.discoverTools('profile-1');

  t.deepEqual(tool.inputSchema, {
    type: 'object',
    properties: {
      startTime: {
        type: 'string',
        description: 'Start time',
      },
    },
    required: ['startTime'],
    additionalProperties: false,
  });
  t.is(tool.risk, 'write');
  t.true(tool.requiresConfirmation);
  await t.throwsAsync(
    driver.execute('profile-1', {
      tool,
      arguments: { startTime: '2026-08-18T09:00:00Z' },
      idempotencyKey: 'call-unconfirmed',
      confirmed: false,
    }),
    { message: /requires confirmation/ }
  );
  await driver.execute('profile-1', {
    tool,
    arguments: { startTime: '2026-08-18T09:00:00Z' },
    idempotencyKey: 'call-1',
    confirmed: true,
  });
  t.deepEqual(execute.secondCall.args[0].args, [
    'calendar',
    'event',
    'list',
    '--start-time',
    '2026-08-18T09:00:00Z',
    '--format',
    'json',
    '--yes',
  ]);
});

test('EnterpriseConnectionService rechecks connection state before execution', async t => {
  const staleConnection = {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: EnterpriseProvider.LARK,
    transport: EnterpriseConnectionTransport.CLI,
    status: EnterpriseConnectionStatus.ACTIVE,
    enabledToolNames: ['lark_docs_search'],
  };
  const getDriver = Sinon.stub();
  const service = new EnterpriseConnectionService(
    {
      copilotEnterpriseAuthorization: {
        active: Sinon.stub().resolves(null),
      },
      copilotEnterpriseConnection: {
        get: Sinon.stub().resolves({
          ...staleConnection,
          status: EnterpriseConnectionStatus.DISABLED,
        }),
      },
    } as any,
    { get: getDriver } as any,
    {} as any
  );

  await t.throwsAsync(
    service.execute({
      connection: staleConnection as any,
      actorId: 'user-1',
      toolName: 'lark_docs_search',
      arguments: {},
      confirmed: false,
    }),
    { message: 'Enterprise tool is not enabled' }
  );
  t.false(getDriver.called);
});

test('EnterpriseConnectionService keeps an authorized connection active after a tool failure', async t => {
  const tool = {
    name: 'lark_calendar_calendars_primary',
    command: ['calendar', 'calendars', 'primary'],
    description: 'Get the primary calendar',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    requiresConfirmation: false,
    supportsDryRun: true,
  };
  const connection = {
    id: 'connection-tool-failed',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: EnterpriseProvider.LARK,
    transport: EnterpriseConnectionTransport.CLI,
    profileKey: 'profile-tool-failed',
    status: EnterpriseConnectionStatus.ACTIVE,
    activeAuthorizationSessionId: null,
    enabledToolNames: [tool.name],
    toolCatalog: [tool],
  };
  const recordFailure = Sinon.stub().resolves();
  const driver = {
    execute: Sinon.stub().rejects(new Error('missing calendar scope')),
    authStatus: Sinon.stub().resolves({ authorized: true, status: 'active' }),
  };
  const service = new EnterpriseConnectionService(
    {
      copilotEnterpriseConnection: {
        get: Sinon.stub().resolves(connection),
        recordFailure,
        addAudit: Sinon.stub().resolves(),
      },
    } as any,
    { get: Sinon.stub().returns(driver) } as any,
    {} as any
  );

  await t.throwsAsync(
    service.execute({
      connection: connection as any,
      actorId: connection.userId,
      toolName: tool.name,
      arguments: {},
      confirmed: false,
    }),
    { message: 'missing calendar scope' }
  );
  t.true(driver.authStatus.calledOnceWith(connection.profileKey));
  t.true(
    recordFailure.calledOnceWith(
      connection.id,
      EnterpriseConnectionStatus.ACTIVE,
      'enterprise_cli_tool_failed',
      'missing calendar scope'
    )
  );
});

test('EnterpriseConnectionService requires reauthorization when a failed tool has lost authorization', async t => {
  const tool = {
    name: 'wecom_doc_search',
    command: ['doc', 'search'],
    description: 'Search documents',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    requiresConfirmation: false,
    supportsDryRun: true,
  };
  const connection = {
    id: 'connection-reauth',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: EnterpriseProvider.WECOM,
    transport: EnterpriseConnectionTransport.CLI,
    profileKey: 'profile-reauth',
    status: EnterpriseConnectionStatus.ACTIVE,
    activeAuthorizationSessionId: null,
    enabledToolNames: [tool.name],
    toolCatalog: [tool],
  };
  const recordFailure = Sinon.stub().resolves();
  const driver = {
    execute: Sinon.stub().rejects(new Error('token expired')),
    authStatus: Sinon.stub().resolves({
      authorized: false,
      status: 'reauth_required',
    }),
  };
  const service = new EnterpriseConnectionService(
    {
      copilotEnterpriseConnection: {
        get: Sinon.stub().resolves(connection),
        recordFailure,
        addAudit: Sinon.stub().resolves(),
      },
    } as any,
    { get: Sinon.stub().returns(driver) } as any,
    {} as any
  );

  await t.throwsAsync(
    service.execute({
      connection: connection as any,
      actorId: connection.userId,
      toolName: tool.name,
      arguments: {},
      confirmed: false,
    })
  );
  t.true(
    recordFailure.calledOnceWith(
      connection.id,
      EnterpriseConnectionStatus.REAUTH_REQUIRED,
      'enterprise_cli_reauth_required',
      'token expired'
    )
  );
});

test('EnterpriseConnectionService degrades on CLI infrastructure failure', async t => {
  const tool = {
    name: 'dingtalk_calendar_event_list',
    command: ['calendar', 'event', 'list'],
    description: 'List events',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    requiresConfirmation: false,
    supportsDryRun: true,
  };
  const connection = {
    id: 'connection-runtime-failed',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: EnterpriseProvider.DINGTALK,
    transport: EnterpriseConnectionTransport.CLI,
    profileKey: 'profile-runtime-failed',
    status: EnterpriseConnectionStatus.ACTIVE,
    activeAuthorizationSessionId: null,
    enabledToolNames: [tool.name],
    toolCatalog: [tool],
  };
  const recordFailure = Sinon.stub().resolves();
  const driver = {
    execute: Sinon.stub().rejects(
      new EnterpriseCliRuntimeError(
        'enterprise_cli_timeout',
        'Enterprise CLI execution timed out'
      )
    ),
    authStatus: Sinon.stub(),
  };
  const service = new EnterpriseConnectionService(
    {
      copilotEnterpriseConnection: {
        get: Sinon.stub().resolves(connection),
        recordFailure,
        addAudit: Sinon.stub().resolves(),
      },
    } as any,
    { get: Sinon.stub().returns(driver) } as any,
    {} as any
  );

  await t.throwsAsync(
    service.execute({
      connection: connection as any,
      actorId: connection.userId,
      toolName: tool.name,
      arguments: {},
      confirmed: false,
    })
  );
  t.false(driver.authStatus.called);
  t.true(
    recordFailure.calledOnceWith(
      connection.id,
      EnterpriseConnectionStatus.DEGRADED,
      'enterprise_cli_execution_failed',
      'Enterprise CLI execution timed out'
    )
  );
});

test('EnterpriseConnectionService rejects a superseded authorization refresh', async t => {
  const getDriver = Sinon.stub();
  const service = new EnterpriseConnectionService(
    {
      copilotEnterpriseConnection: {
        get: Sinon.stub().resolves({
          id: 'connection-superseded',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          provider: EnterpriseProvider.LARK,
          transport: EnterpriseConnectionTransport.CLI,
          status: EnterpriseConnectionStatus.CONNECTING,
          activeAuthorizationSessionId: 'authorization-new',
        }),
      },
    } as any,
    { get: getDriver } as any,
    {} as any
  );

  const error = await t.throwsAsync(
    service.refresh({
      connectionId: 'connection-superseded',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      authorizationSessionId: 'authorization-old',
    }),
    { instanceOf: EnterpriseCliRuntimeError }
  );
  t.is(error.code, 'enterprise_cli_aborted');
  t.false(getDriver.called);
});

test('EnterpriseConnectionService disables before deleting profile credentials', async t => {
  const connection = {
    id: 'connection-delete',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: EnterpriseProvider.DINGTALK,
    transport: EnterpriseConnectionTransport.CLI,
    profileKey: 'profile-delete',
  };
  const disable = Sinon.stub().resolves(connection);
  const removeProfile = Sinon.stub().resolves();
  const addAudit = Sinon.stub().resolves();
  const softDelete = Sinon.stub().resolves();
  const service = new EnterpriseConnectionService(
    {
      copilotEnterpriseAuthorization: {
        active: Sinon.stub().resolves(null),
      },
      copilotEnterpriseConnection: {
        get: Sinon.stub().resolves(connection),
        disable,
        addAudit,
        softDelete,
      },
    } as any,
    {} as any,
    { removeProfile } as any
  );

  t.true(
    await service.delete({
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      userId: connection.userId,
    })
  );
  t.true(disable.calledBefore(removeProfile));
  t.true(removeProfile.calledBefore(softDelete));
  t.true(
    removeProfile.calledOnceWith(EnterpriseProvider.DINGTALK, 'profile-delete')
  );
  t.true(
    addAudit.calledWith(
      Sinon.match({ eventType: 'deleted', status: 'DISABLED' })
    )
  );
});

test('EnterpriseConnectionService keeps cleanup failures retryable', async t => {
  const connection = {
    id: 'connection-delete-failed',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: EnterpriseProvider.WECOM,
    transport: EnterpriseConnectionTransport.CLI,
    profileKey: 'profile-delete-failed',
  };
  const softDelete = Sinon.stub();
  const addAudit = Sinon.stub().resolves();
  const service = new EnterpriseConnectionService(
    {
      copilotEnterpriseAuthorization: {
        active: Sinon.stub().resolves(null),
      },
      copilotEnterpriseConnection: {
        get: Sinon.stub().resolves(connection),
        disable: Sinon.stub().resolves(connection),
        addAudit,
        softDelete,
      },
    } as any,
    {} as any,
    {
      removeProfile: Sinon.stub().rejects(new Error('disk unavailable')),
    } as any
  );

  await t.throwsAsync(
    service.delete({
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      userId: connection.userId,
    }),
    { message: 'disk unavailable' }
  );
  t.false(softDelete.called);
  t.true(
    addAudit.calledWith(
      Sinon.match({ eventType: 'credential_cleanup_failed', status: 'FAILED' })
    )
  );
});

test('EnterpriseToolRegistry searches the full catalog and gates writes on the user request', async t => {
  const connection = {
    id: 'connection-123',
    name: 'My Lark',
    provider: EnterpriseProvider.LARK,
    enabledToolNames: ['lark_docs_search', 'lark_docs_delete'],
  };
  const readTool = {
    name: 'lark_docs_search',
    command: ['docs', 'search'],
    description: 'Search documents',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    requiresConfirmation: false,
    supportsDryRun: true,
  };
  const writeTool = {
    ...readTool,
    name: 'lark_docs_delete',
    command: ['docs', 'delete'],
    risk: 'high',
    requiresConfirmation: true,
  };
  const execute = Sinon.stub().resolves({ ok: true });
  const registry = new EnterpriseToolRegistry({
    activeConnections: Sinon.stub().resolves([connection]),
    catalog: Sinon.stub().returns([readTool, writeTool]),
    execute,
  } as any);

  const tools = await registry.getTools({
    workspaceId: 'workspace-1',
    userId: 'user-1',
  });

  t.deepEqual(Object.keys(tools), [
    'enterprise_cli_search',
    'enterprise_cli_execute',
  ]);
  const search = (await tools.enterprise_cli_search.execute?.(
    { query: 'Lark documents', limit: 10 },
    {}
  )) as any;
  t.deepEqual(
    search.matches.map((match: any) => [match.toolName, match.risk]),
    [
      ['lark_docs_delete', 'high'],
      ['lark_docs_search', 'read'],
    ]
  );

  await tools.enterprise_cli_execute.execute?.(
    {
      connectionId: connection.id,
      toolName: readTool.name,
      arguments: {},
    },
    {}
  );
  t.is(execute.callCount, 1);
  t.like(execute.firstCall.args[0], {
    connection,
    actorId: 'user-1',
    toolName: 'lark_docs_search',
    confirmed: false,
  });

  await t.throwsAsync(
    async () =>
      await tools.enterprise_cli_execute.execute?.(
        {
          connectionId: connection.id,
          toolName: writeTool.name,
          arguments: {},
        },
        {
          messages: [
            {
              role: 'user',
              content:
                'Search only: list Lark document delete tools, but do not execute or delete anything.',
            },
          ],
        }
      ),
    { message: /requires a direct user request/ }
  );
  await tools.enterprise_cli_execute.execute?.(
    {
      connectionId: connection.id,
      toolName: writeTool.name,
      arguments: {},
    },
    {
      messages: [
        {
          role: 'user',
          content: 'Delete the selected Lark document.',
        },
      ],
    }
  );
  t.is(execute.callCount, 2);
  t.like(execute.secondCall.args[0], {
    connection,
    actorId: 'user-1',
    toolName: 'lark_docs_delete',
    confirmed: true,
  });
});

test('EnterpriseAuthorizationWorker rejects unofficial authorization URLs', async t => {
  const session = {
    id: 'authorization-url-rejected',
    connectionId: 'connection-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: EnterpriseProvider.LARK,
    status: EnterpriseAuthorizationStatus.PENDING,
    expiresAt: new Date(Date.now() + 60_000),
    qrCodePath: null,
    connection: {
      id: 'connection-1',
      profileKey: 'profile-1',
      deletedAt: null,
    },
  };
  const markWaiting = Sinon.stub();
  const markFailed = Sinon.stub().resolves({ count: 1 });
  const refresh = Sinon.stub();
  const worker = new EnterpriseAuthorizationWorker(
    {
      copilotEnterpriseAuthorization: {
        getWithConnection: Sinon.stub().resolves(session),
        markStarting: Sinon.stub().resolves({ count: 1 }),
        markWaiting,
        markFailed,
      },
      copilotEnterpriseConnection: {
        addAudit: Sinon.stub().resolves(),
        recordFailure: Sinon.stub().resolves(),
      },
    } as any,
    {
      isActive: (status: EnterpriseAuthorizationStatus) =>
        new Set<EnterpriseAuthorizationStatus>([
          EnterpriseAuthorizationStatus.PENDING,
          EnterpriseAuthorizationStatus.STARTING,
          EnterpriseAuthorizationStatus.WAITING,
        ]).has(status),
    } as any,
    { refresh } as any,
    {
      get: Sinon.stub().returns({
        authorize: async (_profileKey: string, request: any) => {
          await request.onChallenge({
            authorizationUrl: 'https://accounts.feishu.cn.evil.example/device',
          });
          return { authorized: true };
        },
      }),
    } as any,
    { removeProfileFile: Sinon.stub().resolves() } as any
  );

  await worker.run({ sessionId: session.id });

  t.false(markWaiting.called);
  t.true(
    markFailed.calledOnceWith(
      session.id,
      session.connectionId,
      'enterprise_authorization_url_rejected',
      'Enterprise CLI returned an unofficial authorization URL'
    )
  );
  t.false(refresh.called);
});

test('EnterpriseAuthorizationWorker exposes the DingTalk admin prerequisite', async t => {
  const session = {
    id: 'authorization-dingtalk-admin-required',
    connectionId: 'connection-dingtalk-admin-required',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: EnterpriseProvider.DINGTALK,
    status: EnterpriseAuthorizationStatus.PENDING,
    expiresAt: new Date(Date.now() + 60_000),
    qrCodePath: null,
    connection: {
      id: 'connection-dingtalk-admin-required',
      profileKey: 'profile-dingtalk-admin-required',
      deletedAt: null,
    },
  };
  const markFailed = Sinon.stub().resolves({ count: 1 });
  const worker = new EnterpriseAuthorizationWorker(
    {
      copilotEnterpriseAuthorization: {
        getWithConnection: Sinon.stub().resolves(session),
        markStarting: Sinon.stub().resolves({ count: 1 }),
        markFailed,
      },
      copilotEnterpriseConnection: { addAudit: Sinon.stub().resolves() },
    } as any,
    { isActive: Sinon.stub().returns(true) } as any,
    { refresh: Sinon.stub() } as any,
    {
      get: Sinon.stub().returns({
        authorize: Sinon.stub().rejects(
          new Error(
            'device authorization failed: CLI data access is not enabled for this organization'
          )
        ),
      }),
    } as any,
    { removeProfileFile: Sinon.stub().resolves() } as any
  );

  await worker.run({ sessionId: session.id });

  t.true(
    markFailed.calledOnceWith(
      session.id,
      session.connectionId,
      'enterprise_cli_org_access_disabled',
      'A DingTalk organization super admin must enable CLI data access before authorization can complete'
    )
  );
});

test('EnterpriseAuthorizationWorker refreshes tools after official authorization', async t => {
  const session = {
    id: 'authorization-success',
    connectionId: 'connection-2',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: EnterpriseProvider.DINGTALK,
    status: EnterpriseAuthorizationStatus.PENDING,
    expiresAt: new Date(Date.now() + 60_000),
    qrCodePath: null,
    connection: {
      id: 'connection-2',
      profileKey: 'profile-2',
      deletedAt: null,
    },
  };
  const markWaiting = Sinon.stub().resolves({ count: 1 });
  const markAuthorized = Sinon.stub().resolves({ count: 1 });
  const refresh = Sinon.stub().resolves();
  const worker = new EnterpriseAuthorizationWorker(
    {
      copilotEnterpriseAuthorization: {
        getWithConnection: Sinon.stub().resolves(session),
        markStarting: Sinon.stub().resolves({ count: 1 }),
        markWaiting,
        markAuthorized,
      },
      copilotEnterpriseConnection: { addAudit: Sinon.stub().resolves() },
    } as any,
    { isActive: Sinon.stub().returns(true) } as any,
    { refresh } as any,
    {
      get: Sinon.stub().returns({
        authorize: async (_profileKey: string, request: any) => {
          await request.onChallenge({
            authorizationUrl: 'https://login.dingtalk.com/oauth/device',
            userCode: 'DT-99',
          });
          await request.onChallenge({ clearPrevious: true });
          return { authorized: true };
        },
      }),
    } as any,
    { removeProfileFile: Sinon.stub().resolves() } as any
  );

  await worker.run({ sessionId: session.id });

  t.true(
    markWaiting.firstCall.calledWith(
      session.id,
      Sinon.match({
        authorizationUrl: 'https://login.dingtalk.com/oauth/device',
        userCode: 'DT-99',
      })
    )
  );
  t.true(
    markWaiting.secondCall.calledWith(session.id, {
      authorizationUrl: null,
      userCode: null,
      qrCodePath: null,
      expiresAt: undefined,
    })
  );
  t.true(
    refresh.calledOnceWith(
      Sinon.match({
        connectionId: session.connectionId,
        workspaceId: session.workspaceId,
        userId: session.userId,
        authorizationSessionId: session.id,
        signal: Sinon.match.instanceOf(AbortSignal),
      })
    )
  );
  t.true(markAuthorized.calledOnceWith(session.id, session.connectionId));
});

test.serial(
  'EnterpriseAuthorizationWorker aborts a cloud CLI when the database session is cancelled',
  async t => {
    const clock = Sinon.useFakeTimers();
    const active = {
      id: 'authorization-cancelled',
      connectionId: 'connection-3',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      provider: EnterpriseProvider.WECOM,
      status: EnterpriseAuthorizationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      qrCodePath: null,
      connection: {
        id: 'connection-3',
        profileKey: 'profile-3',
        deletedAt: null,
      },
    };
    const cancelled = {
      ...active,
      status: EnterpriseAuthorizationStatus.CANCELLED,
    };
    const getWithConnection = Sinon.stub();
    getWithConnection.onFirstCall().resolves(active);
    getWithConnection.onSecondCall().resolves(cancelled);
    getWithConnection.resolves(cancelled);
    const markFailed = Sinon.stub();
    let signalAborted = false;
    const worker = new EnterpriseAuthorizationWorker(
      {
        copilotEnterpriseAuthorization: {
          getWithConnection,
          markStarting: Sinon.stub().resolves({ count: 1 }),
          markFailed,
        },
        copilotEnterpriseConnection: { addAudit: Sinon.stub().resolves() },
      } as any,
      {
        isActive: (status: EnterpriseAuthorizationStatus) =>
          status !== EnterpriseAuthorizationStatus.CANCELLED,
      } as any,
      { refresh: Sinon.stub() } as any,
      {
        get: Sinon.stub().returns({
          authorize: async (_profileKey: string, request: any) =>
            await new Promise((_resolve, reject) => {
              request.signal.addEventListener(
                'abort',
                () => {
                  signalAborted = true;
                  reject(
                    new EnterpriseCliRuntimeError(
                      'enterprise_cli_aborted',
                      'Enterprise CLI execution was cancelled'
                    )
                  );
                },
                { once: true }
              );
            }),
        }),
      } as any,
      { removeProfileFile: Sinon.stub().resolves() } as any
    );

    try {
      const running = worker.run({ sessionId: active.id });
      await clock.tickAsync(1_001);
      await running;
      t.true(signalAborted);
      t.false(markFailed.called);
    } finally {
      clock.restore();
    }
  }
);

test('EnterpriseAuthorizationWorker serves only a waiting user PNG challenge', async t => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const getForUser = Sinon.stub().resolves({
    id: 'authorization-qrcode',
    provider: EnterpriseProvider.WECOM,
    status: EnterpriseAuthorizationStatus.WAITING,
    expiresAt: new Date(Date.now() + 60_000),
    qrCodePath: 'authorization-authorization-qrcode.png',
    connection: { profileKey: 'profile-qrcode' },
  });
  const readProfileFile = Sinon.stub().resolves(png);
  const worker = new EnterpriseAuthorizationWorker(
    {
      copilotEnterpriseAuthorization: { getForUser },
    } as any,
    {} as any,
    {} as any,
    {} as any,
    { readProfileFile } as any
  );

  t.deepEqual(await worker.readQrCode('authorization-qrcode', 'user-1'), png);
  t.true(getForUser.calledOnceWith('authorization-qrcode', 'user-1'));
  t.true(
    readProfileFile.calledOnceWith(
      EnterpriseProvider.WECOM,
      'profile-qrcode',
      'authorization-authorization-qrcode.png'
    )
  );
});

test('EnterpriseConnectionResolver scopes authorization sessions to the current user', async t => {
  const get = Sinon.stub().resolves({
    id: 'authorization-user-scope',
    workspaceId: 'workspace-1',
    userId: 'user-a',
    provider: EnterpriseProvider.LARK,
    status: EnterpriseAuthorizationStatus.WAITING,
    qrCodePath: null,
  });
  const assert = Sinon.stub().resolves();
  const resolver = new EnterpriseConnectionResolver(
    {} as any,
    { get } as any,
    {
      user: Sinon.stub().returns({
        workspace: Sinon.stub().returns({
          allowLocal: Sinon.stub().returns({ assert }),
        }),
      }),
    } as any
  );

  await resolver.enterpriseAuthorizationSession(
    { id: 'user-a' } as any,
    'workspace-1',
    'authorization-user-scope'
  );

  t.true(assert.calledOnceWith('Workspace.Read'));
  t.true(
    get.calledOnceWith({
      id: 'authorization-user-scope',
      workspaceId: 'workspace-1',
      userId: 'user-a',
    })
  );
});
