import '../../plugins/copilot/config';

import { Test } from '@nestjs/testing';
import test from 'ava';

import { Config, ConfigModule } from '../../base/config';
import {
  CopilotPromptModel,
  PromptRegistryPublishGateError,
} from '../../models/copilot-prompt';
import { PromptService } from '../../plugins/copilot/prompt';
import type {
  Prompt,
  PromptRegistryDiagnostic,
} from '../../plugins/copilot/prompt/spec';

class TestingCompatPromptService extends PromptService {
  constructor(
    config: ConstructorParameters<typeof PromptService>[0],
    private readonly prompt: Prompt
  ) {
    super(config);
  }

  protected override lookupCompatPrompt(name: string) {
    return name === this.prompt.name ? this.prompt : null;
  }

  protected override listCompatPrompts() {
    return [this.prompt];
  }

  protected override listBuiltInPromptSpecs() {
    return [];
  }
}

class TestingRegistryPromptService extends PromptService {
  constructor(
    config: ConstructorParameters<typeof PromptService>[0],
    registryPrompts: Prompt[],
    registryDiagnostics: PromptRegistryDiagnostic[] = registryPrompts.map(
      prompt => ({
        action: prompt.action,
        model: prompt.model,
        name: prompt.name,
        optionalModels: prompt.optionalModels ?? [],
        registryFingerprint: prompt.registryFingerprint ?? '0000000000000000',
        registryId: prompt.registryId ?? 0,
        registryMessageCount: prompt.messages.length,
        registryModified: prompt.registryModified ?? false,
        registryUpdatedAt: prompt.registryUpdatedAt ?? new Date(0),
        registryValidationBlockingCount:
          prompt.registryValidationBlockingCount ?? 0,
        registryValidationDetail: prompt.registryValidationDetail ?? 'ready',
        registryValidationErrorCount: prompt.registryValidationErrorCount ?? 0,
        registryValidationIssueCount: prompt.registryValidationIssueCount ?? 0,
        registryValidationIssues: prompt.registryValidationIssues ?? [],
        registryValidationPublishStatus:
          prompt.registryValidationPublishStatus ?? 'allowed',
        registryValidationRemediations:
          prompt.registryValidationRemediations ?? [],
        registryValidationReason: prompt.registryValidationReason ?? 'ready',
        registryValidationStatus: prompt.registryValidationStatus ?? 'ready',
        source: 'registry',
      })
    )
  ) {
    super(config, {
      copilotPrompt: {
        getRegistryPrompt: async (name: string) =>
          registryPrompts.find(prompt => prompt.name === name) ?? null,
        getRegistryDiagnostic: async (name: string) =>
          registryDiagnostics.find(prompt => prompt.name === name) ?? null,
        listRegistryDiagnostics: async () => registryDiagnostics,
        listRegistryPrompts: async () => registryPrompts,
      },
    } as ConstructorParameters<typeof PromptService>[1]);
  }
}

class TestingCopilotPromptModel extends CopilotPromptModel {
  constructor(private readonly row: unknown) {
    super();
  }

  protected override get db(): any {
    return {
      aiPrompt: {
        findMany: async () => [this.row],
        findUnique: async () => this.row,
      },
    };
  }
}

test('CopilotPromptModel should collect multiple registry config validation issues', async t => {
  const registryUpdatedAt = new Date('2026-06-17T06:07:08.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {
      maxTokens: 'many',
      temperature: 'hot',
    },
    id: 126,
    messages: [
      {
        attachments: null,
        content: 'Answer with a registry prompt.',
        idx: 0,
        params: null,
        role: 'system',
      },
    ],
    model: 'registry/broken-config',
    modified: true,
    name: 'Broken config registry prompt',
    optionalModels: [],
    updatedAt: registryUpdatedAt,
  });
  const diagnostic = await model.getRegistryDiagnostic(
    'Broken config registry prompt'
  );

  t.truthy(diagnostic);
  t.is(diagnostic?.registryValidationStatus, 'ignored');
  t.is(diagnostic?.registryValidationReason, 'invalid_config');
  t.true(
    [
      'config.maxTokens:invalid_type',
      'config.temperature:invalid_type',
    ].includes(diagnostic?.registryValidationDetail ?? '')
  );
  t.is(diagnostic?.registryValidationIssueCount, 2);
  t.is(diagnostic?.registryValidationErrorCount, 2);
  t.is(diagnostic?.registryValidationBlockingCount, 2);
  t.is(diagnostic?.registryValidationPublishStatus, 'blocked');
  const registryFingerprint =
    diagnostic?.registryValidationIssues[0]?.sourceLocator
      .registryFingerprint ?? '';
  t.regex(registryFingerprint, /^[a-f0-9]{16}$/);
  t.true(
    diagnostic?.registryValidationIssues.every(
      issue => issue.sourceLocator.registryFingerprint === registryFingerprint
    ) ?? false
  );
  t.deepEqual(
    diagnostic?.registryValidationIssues
      .map(issue => ({
        code: issue.code,
        detail: issue.detail,
        fieldLabel: issue.fieldLabel,
        path: issue.path,
        publishBlocking: issue.publishBlocking,
        reason: issue.reason,
        severity: issue.severity,
        source: issue.source,
        sourceLocator: issue.sourceLocator,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    [
      {
        code: 'invalid_type',
        detail: 'config.maxTokens:invalid_type',
        fieldLabel: 'Max Tokens',
        path: 'config.maxTokens',
        publishBlocking: true,
        reason: 'invalid_config',
        severity: 'error',
        source: 'ai_prompts_metadata.config.maxTokens',
        sourceLocator: {
          field: 'maxTokens',
          path: 'config.maxTokens',
          registryFingerprint,
          registryId: 126,
          registryUpdatedAt: registryUpdatedAt.toISOString(),
          table: 'ai_prompts_metadata',
        },
      },
      {
        code: 'invalid_type',
        detail: 'config.temperature:invalid_type',
        fieldLabel: 'Temperature',
        path: 'config.temperature',
        publishBlocking: true,
        reason: 'invalid_config',
        severity: 'error',
        source: 'ai_prompts_metadata.config.temperature',
        sourceLocator: {
          field: 'temperature',
          path: 'config.temperature',
          registryFingerprint,
          registryId: 126,
          registryUpdatedAt: registryUpdatedAt.toISOString(),
          table: 'ai_prompts_metadata',
        },
      },
    ]
  );
  t.deepEqual(diagnostic?.registryValidationRemediations, [
    {
      detail:
        'Update ai_prompts_metadata.config to match the prompt config schema.',
      kind: 'fix_config',
      label: 'Fix prompt config',
      target: 'ai_prompts_metadata.config',
      targetLocator: {
        field: 'config',
        path: 'config',
        registryFingerprint,
        registryId: 126,
        registryUpdatedAt: registryUpdatedAt.toISOString(),
        table: 'ai_prompts_metadata',
      },
    },
  ]);
});

test('CopilotPromptModel should aggregate registry config and message validation issues', async t => {
  const registryUpdatedAt = new Date('2026-06-17T06:17:08.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {
      maxTokens: 'many',
      temperature: 'hot',
    },
    id: 127,
    messages: [
      {
        attachments: null,
        content: null,
        idx: 0,
        params: null,
        role: 'system',
      },
    ],
    model: 'registry/broken-config-and-message',
    modified: true,
    name: 'Broken config and message registry prompt',
    optionalModels: [],
    updatedAt: registryUpdatedAt,
  });
  const diagnostic = await model.getRegistryDiagnostic(
    'Broken config and message registry prompt'
  );
  const executablePrompt = await model.getRegistryPrompt(
    'Broken config and message registry prompt'
  );

  t.is(executablePrompt, null);
  t.truthy(diagnostic);
  t.is(diagnostic?.registryValidationStatus, 'ignored');
  t.is(diagnostic?.registryValidationReason, 'invalid_config');
  t.true(
    [
      'config.maxTokens:invalid_type',
      'config.temperature:invalid_type',
    ].includes(diagnostic?.registryValidationDetail ?? '')
  );
  t.is(diagnostic?.registryValidationIssueCount, 3);
  t.is(diagnostic?.registryValidationErrorCount, 3);
  t.is(diagnostic?.registryValidationBlockingCount, 3);
  t.is(diagnostic?.registryValidationPublishStatus, 'blocked');
  const registryFingerprint =
    diagnostic?.registryValidationIssues[0]?.sourceLocator
      .registryFingerprint ?? '';
  t.regex(registryFingerprint, /^[a-f0-9]{16}$/);
  t.true(
    diagnostic?.registryValidationIssues.every(
      issue => issue.sourceLocator.registryFingerprint === registryFingerprint
    ) ?? false
  );
  t.deepEqual(
    diagnostic?.registryValidationIssues
      .map(issue => ({
        code: issue.code,
        detail: issue.detail,
        fieldLabel: issue.fieldLabel,
        messageIndex: issue.messageIndex,
        path: issue.path,
        publishBlocking: issue.publishBlocking,
        reason: issue.reason,
        severity: issue.severity,
        source: issue.source,
        sourceLocator: issue.sourceLocator,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    [
      {
        code: 'invalid_type',
        detail: 'config.maxTokens:invalid_type',
        fieldLabel: 'Max Tokens',
        messageIndex: undefined,
        path: 'config.maxTokens',
        publishBlocking: true,
        reason: 'invalid_config',
        severity: 'error',
        source: 'ai_prompts_metadata.config.maxTokens',
        sourceLocator: {
          field: 'maxTokens',
          path: 'config.maxTokens',
          registryFingerprint,
          registryId: 127,
          registryUpdatedAt: registryUpdatedAt.toISOString(),
          table: 'ai_prompts_metadata',
        },
      },
      {
        code: 'invalid_type',
        detail: 'config.temperature:invalid_type',
        fieldLabel: 'Temperature',
        messageIndex: undefined,
        path: 'config.temperature',
        publishBlocking: true,
        reason: 'invalid_config',
        severity: 'error',
        source: 'ai_prompts_metadata.config.temperature',
        sourceLocator: {
          field: 'temperature',
          path: 'config.temperature',
          registryFingerprint,
          registryId: 127,
          registryUpdatedAt: registryUpdatedAt.toISOString(),
          table: 'ai_prompts_metadata',
        },
      },
      {
        code: 'invalid_type',
        detail: 'message[0].content:invalid_type',
        fieldLabel: 'Message 0 Content',
        messageIndex: 0,
        path: 'message[0].content',
        publishBlocking: true,
        reason: 'invalid_message',
        severity: 'error',
        source: 'ai_prompts_messages[0].content',
        sourceLocator: {
          field: 'content',
          messageIndex: 0,
          path: 'message[0].content',
          registryFingerprint,
          registryId: 127,
          registryUpdatedAt: registryUpdatedAt.toISOString(),
          table: 'ai_prompts_messages',
        },
      },
    ]
  );
  t.deepEqual(diagnostic?.registryValidationRemediations, [
    {
      detail:
        'Update ai_prompts_metadata.config to match the prompt config schema.',
      kind: 'fix_config',
      label: 'Fix prompt config',
      target: 'ai_prompts_metadata.config',
      targetLocator: {
        field: 'config',
        path: 'config',
        registryFingerprint,
        registryId: 127,
        registryUpdatedAt: registryUpdatedAt.toISOString(),
        table: 'ai_prompts_metadata',
      },
    },
    {
      detail: 'Update prompt message 0 to match the prompt message schema.',
      kind: 'fix_message',
      label: 'Fix prompt message',
      target: 'ai_prompts_messages[0]',
      targetLocator: {
        field: 'message',
        messageIndex: 0,
        path: 'message[0]',
        registryFingerprint,
        registryId: 127,
        registryUpdatedAt: registryUpdatedAt.toISOString(),
        table: 'ai_prompts_messages',
      },
    },
  ]);
});

test('CopilotPromptModel should block registry prompts with undeclared template params', async t => {
  const registryUpdatedAt = new Date('2026-06-17T06:27:08.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {
      temperature: 0.2,
    },
    id: 128,
    messages: [
      {
        attachments: null,
        content: 'Answer in {{tone}} about {{topic}}.',
        idx: 0,
        params: {
          tone: 'brief',
        },
        role: 'system',
      },
    ],
    model: 'registry/missing-template-param',
    modified: true,
    name: 'Missing template param registry prompt',
    optionalModels: [],
    updatedAt: registryUpdatedAt,
  });
  const diagnostic = await model.getRegistryDiagnostic(
    'Missing template param registry prompt'
  );
  const executablePrompt = await model.getRegistryPrompt(
    'Missing template param registry prompt'
  );
  const verdict = await model.getRegistryPublishGateVerdict(
    'Missing template param registry prompt'
  );

  t.is(executablePrompt, null);
  t.truthy(diagnostic);
  t.is(diagnostic?.registryValidationStatus, 'ignored');
  t.is(diagnostic?.registryValidationReason, 'missing_template_param');
  t.is(diagnostic?.registryValidationDetail, 'template.topic:missing_param');
  t.is(diagnostic?.registryValidationIssueCount, 1);
  t.is(diagnostic?.registryValidationErrorCount, 1);
  t.is(diagnostic?.registryValidationBlockingCount, 1);
  t.is(diagnostic?.registryValidationPublishStatus, 'blocked');
  const registryFingerprint =
    diagnostic?.registryValidationIssues[0]?.sourceLocator
      .registryFingerprint ?? '';
  t.regex(registryFingerprint, /^[a-f0-9]{16}$/);
  t.deepEqual(diagnostic?.registryValidationIssues, [
    {
      code: 'missing',
      detail: 'template.topic:missing_param',
      fieldLabel: 'Template Param',
      message:
        'Prompt template variable "topic" is not declared in ai_prompts_messages.params.',
      messageIndex: 0,
      path: 'message[0].params.topic',
      publishBlocking: true,
      reason: 'missing_template_param',
      severity: 'error',
      source: 'ai_prompts_messages[0].params.topic',
      sourceLocator: {
        field: 'params.topic',
        messageIndex: 0,
        path: 'message[0].params.topic',
        registryFingerprint,
        registryId: 128,
        registryUpdatedAt: registryUpdatedAt.toISOString(),
        table: 'ai_prompts_messages',
      },
    },
  ]);
  t.deepEqual(diagnostic?.registryValidationRemediations, [
    {
      detail:
        'Declare default values for every prompt template variable in ai_prompts_messages.params.',
      kind: 'declare_template_param',
      label: 'Declare template params',
      target: 'ai_prompts_messages.params',
      targetLocator: {
        field: 'params',
        path: 'messages.params',
        registryFingerprint,
        registryId: 128,
        registryUpdatedAt: registryUpdatedAt.toISOString(),
        table: 'ai_prompts_messages',
      },
    },
  ]);
  t.truthy(verdict);
  t.false(verdict?.allowed);
  t.is(verdict?.blockingCount, 1);
  t.is(verdict?.errorCount, 1);
  t.is(verdict?.issueCount, 1);
  t.is(verdict?.publishStatus, 'blocked');
  t.is(verdict?.reason, 'missing_template_param');
  t.is(verdict?.registryFingerprint, registryFingerprint);
  t.is(verdict?.registryId, 128);
  t.is(verdict?.remediations[0]?.kind, 'declare_template_param');
  t.false(verdict?.stale);
  t.is(verdict?.status, 'ignored');
});

test('CopilotPromptModel should allow runtime template params without registry declarations', async t => {
  const registryUpdatedAt = new Date('2026-06-17T06:37:08.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {},
    id: 129,
    messages: [
      {
        attachments: null,
        content:
          '{{content}}\n{{#docs}}{{docId}} {{docTitle}} {{tags}} {{createDate}} {{updatedDate}} {{docContent}}{{/docs}}\n{{#contextFiles}}{{id}} {{name}} {{mimeType}} {{chunkSize}}{{/contextFiles}}\n{{#links}}{{.}}{{/links}}\n{{affine::language}} {{affine::timezone}}\n{{#affine::hasCurrentDoc}}{{currentDocId}}{{/affine::hasCurrentDoc}}\n{{#affine::hasSelected}}{{selectedSnapshot}} {{selectedMarkdown}} {{html}}{{/affine::hasSelected}}\n{{focus}} {{length}} {{#messages}}{{role}}{{/messages}} {{attachments}} {{quality}} {{seed}}',
        idx: 0,
        params: null,
        role: 'system',
      },
    ],
    model: 'registry/runtime-template-params',
    modified: false,
    name: 'Runtime template params registry prompt',
    optionalModels: ['registry/runtime-template-params'],
    updatedAt: registryUpdatedAt,
  });
  const diagnostic = await model.getRegistryDiagnostic(
    'Runtime template params registry prompt'
  );
  const prompt = await model.getRegistryPrompt(
    'Runtime template params registry prompt'
  );
  const verdict = await model.getRegistryPublishGateVerdict(
    'Runtime template params registry prompt'
  );

  t.truthy(prompt);
  t.is(prompt?.registryValidationStatus, 'ready');
  t.is(prompt?.registryValidationReason, 'ready');
  t.is(prompt?.registryValidationPublishStatus, 'allowed');
  t.deepEqual(prompt?.registryValidationIssues, []);
  t.truthy(diagnostic);
  t.is(diagnostic?.registryValidationStatus, 'ready');
  t.is(diagnostic?.registryValidationReason, 'ready');
  t.is(diagnostic?.registryValidationPublishStatus, 'allowed');
  t.deepEqual(diagnostic?.registryValidationIssues, []);
  t.truthy(verdict);
  t.true(verdict?.allowed);
  t.is(verdict?.blockingCount, 0);
  t.is(verdict?.errorCount, 0);
  t.is(verdict?.issueCount, 0);
  t.is(verdict?.publishStatus, 'allowed');
  t.is(verdict?.status, 'ready');
});

test('CopilotPromptModel should allow ready registry publish gate verdicts', async t => {
  const registryUpdatedAt = new Date('2026-06-17T07:01:02.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {
      temperature: 0.2,
    },
    id: 201,
    messages: [
      {
        attachments: null,
        content: 'Answer with a registry prompt.',
        idx: 0,
        params: null,
        role: 'system',
      },
    ],
    model: 'registry/ready-publish-gate',
    modified: true,
    name: 'Ready publish gate registry prompt',
    optionalModels: ['registry/ready-publish-gate'],
    updatedAt: registryUpdatedAt,
  });
  const verdict = await model.getRegistryPublishGateVerdict(
    'Ready publish gate registry prompt'
  );

  t.truthy(verdict);
  t.true(verdict?.allowed);
  t.is(verdict?.blockingCount, 0);
  t.is(verdict?.errorCount, 0);
  t.is(verdict?.issueCount, 0);
  t.deepEqual(verdict?.issues, []);
  t.is(verdict?.name, 'Ready publish gate registry prompt');
  t.is(verdict?.publishStatus, 'allowed');
  t.is(verdict?.reason, 'ready');
  t.regex(verdict?.registryFingerprint ?? '', /^[a-f0-9]{16}$/);
  t.is(verdict?.registryId, 201);
  t.is(
    verdict?.registryUpdatedAt.toISOString(),
    registryUpdatedAt.toISOString()
  );
  t.deepEqual(verdict?.remediations, []);
  t.false(verdict?.stale);
  t.deepEqual(verdict?.staleReasons, []);
  t.is(verdict?.status, 'ready');
});

test('CopilotPromptModel should block ignored registry publish gate verdicts', async t => {
  const registryUpdatedAt = new Date('2026-06-17T07:11:12.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {},
    id: 202,
    messages: [],
    model: 'registry/blocked-publish-gate',
    modified: true,
    name: 'Blocked publish gate registry prompt',
    optionalModels: ['registry/blocked-publish-gate'],
    updatedAt: registryUpdatedAt,
  });
  const verdict = await model.getRegistryPublishGateVerdict(
    'Blocked publish gate registry prompt'
  );

  t.truthy(verdict);
  t.false(verdict?.allowed);
  t.is(verdict?.blockingCount, 1);
  t.is(verdict?.errorCount, 1);
  t.is(verdict?.issueCount, 1);
  t.is(verdict?.issues[0]?.publishBlocking, true);
  t.is(verdict?.issues[0]?.reason, 'missing_messages');
  t.is(verdict?.issues[0]?.sourceLocator.registryId, 202);
  t.regex(
    verdict?.issues[0]?.sourceLocator.registryFingerprint ?? '',
    /^[a-f0-9]{16}$/
  );
  t.is(verdict?.name, 'Blocked publish gate registry prompt');
  t.is(verdict?.publishStatus, 'blocked');
  t.is(verdict?.reason, 'missing_messages');
  t.is(verdict?.registryId, 202);
  t.is(
    verdict?.registryUpdatedAt.toISOString(),
    registryUpdatedAt.toISOString()
  );
  t.is(verdict?.remediations[0]?.kind, 'add_messages');
  t.is(verdict?.remediations[0]?.targetLocator.registryId, 202);
  t.false(verdict?.stale);
  t.deepEqual(verdict?.staleReasons, []);
  t.is(verdict?.status, 'ignored');
});

test('CopilotPromptModel should reject stale registry publish gate verdicts', async t => {
  const registryUpdatedAt = new Date('2026-06-17T07:21:22.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {
      temperature: 0.3,
    },
    id: 204,
    messages: [
      {
        attachments: null,
        content: 'Answer with a fresh registry prompt.',
        idx: 0,
        params: null,
        role: 'system',
      },
    ],
    model: 'registry/stale-publish-gate',
    modified: true,
    name: 'Stale publish gate registry prompt',
    optionalModels: ['registry/stale-publish-gate'],
    updatedAt: registryUpdatedAt,
  });
  const verdict = await model.getRegistryPublishGateVerdict(
    'Stale publish gate registry prompt',
    {
      registryFingerprint: 'deadbeefdeadbeef',
      registryId: 203,
      registryUpdatedAt: '2026-06-17T00:00:00.000Z',
    }
  );

  t.truthy(verdict);
  t.false(verdict?.allowed);
  t.is(verdict?.blockingCount, 0);
  t.is(verdict?.errorCount, 0);
  t.is(verdict?.issueCount, 0);
  t.is(verdict?.publishStatus, 'allowed');
  t.is(verdict?.reason, 'ready');
  t.is(verdict?.registryId, 204);
  t.true(verdict?.stale);
  t.deepEqual(verdict?.staleReasons, [
    'registry_id_mismatch',
    'registry_updated_at_mismatch',
    'registry_fingerprint_mismatch',
  ]);
  t.is(verdict?.status, 'stale');
});

test('CopilotPromptModel should return verdicts from allowed registry publish gate assertions', async t => {
  const registryUpdatedAt = new Date('2026-06-17T07:31:32.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {
      temperature: 0.4,
    },
    id: 205,
    messages: [
      {
        attachments: null,
        content: 'Answer with an allowed registry prompt.',
        idx: 0,
        params: null,
        role: 'system',
      },
    ],
    model: 'registry/assert-allowed-publish-gate',
    modified: true,
    name: 'Assert allowed publish gate registry prompt',
    optionalModels: ['registry/assert-allowed-publish-gate'],
    updatedAt: registryUpdatedAt,
  });
  const current = await model.getRegistryPublishGateVerdict(
    'Assert allowed publish gate registry prompt'
  );

  t.truthy(current);
  const verdict = await model.assertRegistryPublishGateAllowed(
    'Assert allowed publish gate registry prompt',
    {
      registryFingerprint: current?.registryFingerprint,
      registryId: current?.registryId,
      registryUpdatedAt: current?.registryUpdatedAt.toISOString(),
    }
  );

  t.true(verdict.allowed);
  t.is(verdict.publishStatus, 'allowed');
  t.is(verdict.status, 'ready');
  t.false(verdict.stale);
  t.is(verdict.registryId, 205);
});

test('CopilotPromptModel should reject blocked registry publish gate assertions', async t => {
  const registryUpdatedAt = new Date('2026-06-17T07:41:42.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {},
    id: 206,
    messages: [],
    model: 'registry/assert-blocked-publish-gate',
    modified: true,
    name: 'Assert blocked publish gate registry prompt',
    optionalModels: ['registry/assert-blocked-publish-gate'],
    updatedAt: registryUpdatedAt,
  });

  const error = await t.throwsAsync(
    model.assertRegistryPublishGateAllowed(
      'Assert blocked publish gate registry prompt'
    )
  );

  t.true(error instanceof PromptRegistryPublishGateError);
  const gateError = error as PromptRegistryPublishGateError;
  t.is(gateError.gateCode, 'prompt_registry_validation_blocked');
  t.is(gateError.promptName, 'Assert blocked publish gate registry prompt');
  t.is(gateError.verdict?.allowed, false);
  t.is(gateError.verdict?.publishStatus, 'blocked');
  t.is(gateError.verdict?.status, 'ignored');
  t.like(gateError.data, {
    blockingCount: 1,
    gateCode: 'prompt_registry_validation_blocked',
    promptName: 'Assert blocked publish gate registry prompt',
    publishStatus: 'blocked',
    stale: false,
    status: 'ignored',
  });
});

test('CopilotPromptModel should reject stale registry publish gate assertions', async t => {
  const registryUpdatedAt = new Date('2026-06-17T07:51:52.000Z');
  const model = new TestingCopilotPromptModel({
    action: 'chat',
    config: {},
    id: 208,
    messages: [
      {
        attachments: null,
        content: 'Answer with an updated registry prompt.',
        idx: 0,
        params: null,
        role: 'system',
      },
    ],
    model: 'registry/assert-stale-publish-gate',
    modified: true,
    name: 'Assert stale publish gate registry prompt',
    optionalModels: ['registry/assert-stale-publish-gate'],
    updatedAt: registryUpdatedAt,
  });

  const error = await t.throwsAsync(
    model.assertRegistryPublishGateAllowed(
      'Assert stale publish gate registry prompt',
      {
        registryFingerprint: 'deadbeefdeadbeef',
        registryId: 207,
        registryUpdatedAt: '2026-06-17T00:00:00.000Z',
      }
    )
  );

  t.true(error instanceof PromptRegistryPublishGateError);
  const gateError = error as PromptRegistryPublishGateError;
  t.is(gateError.gateCode, 'prompt_registry_version_stale');
  t.is(gateError.verdict?.allowed, false);
  t.is(gateError.verdict?.publishStatus, 'allowed');
  t.is(gateError.verdict?.status, 'stale');
  t.deepEqual(gateError.verdict?.staleReasons, [
    'registry_id_mismatch',
    'registry_updated_at_mismatch',
    'registry_fingerprint_mismatch',
  ]);
  t.like(gateError.data, {
    gateCode: 'prompt_registry_version_stale',
    promptName: 'Assert stale publish gate registry prompt',
    publishStatus: 'allowed',
    stale: true,
    status: 'stale',
  });
});

test('CopilotPromptModel should reject missing registry publish gate assertions', async t => {
  const model = new TestingCopilotPromptModel(null);

  const error = await t.throwsAsync(
    model.assertRegistryPublishGateAllowed('Missing registry prompt')
  );

  t.true(error instanceof PromptRegistryPublishGateError);
  const gateError = error as PromptRegistryPublishGateError;
  t.is(gateError.gateCode, 'prompt_registry_not_found');
  t.is(gateError.promptName, 'Missing registry prompt');
  t.is(gateError.verdict, null);
  t.like(gateError.data, {
    gateCode: 'prompt_registry_not_found',
    promptName: 'Missing registry prompt',
    publishStatus: null,
    registryFingerprint: null,
    registryId: null,
    stale: false,
    status: 'missing',
  });
});

test('PromptService should apply config-driven metadata overrides to built-in prompts', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            overrides: [
              {
                name: 'Chat With AFFiNE AI',
                model: 'openai-default/gpt-5-mini',
                optionalModels: [
                  'openai-default/gpt-5-mini',
                  'openai-default/gpt-5',
                ],
                config: {
                  proModels: ['openai-default/gpt-5'],
                  temperature: 0.2,
                },
              },
            ],
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const prompt = await prompts.get('Chat With AFFiNE AI');

    t.truthy(prompt);
    t.is(prompt?.source, 'built_in');
    t.is(prompt?.category, 'text');
    t.is(prompt?.defaultPolicy, undefined);
    t.true(prompt?.overrideApplied);
    t.is(prompt?.model, 'openai-default/gpt-5-mini');
    t.is(prompt?.modelSource, 'override');
    t.is(prompt?.modelConfigPath, 'copilot.prompts.overrides[].model');
    t.deepEqual(prompt?.optionalModels, [
      'openai-default/gpt-5-mini',
      'openai-default/gpt-5',
    ]);
    t.is(prompt?.optionalModelsSource, 'override');
    t.is(
      prompt?.optionalModelsConfigPath,
      'copilot.prompts.overrides[].optionalModels'
    );
    t.deepEqual(prompt?.config?.proModels, ['openai-default/gpt-5']);
    t.is(prompt?.proModelsSource, 'override');
    t.is(
      prompt?.proModelsConfigPath,
      'copilot.prompts.overrides[].config.proModels'
    );
    t.is(prompt?.config?.temperature, 0.2);
    t.true(prompt?.config?.tools?.includes('docRead') ?? false);

    const messages = prompts.finish(prompt!, {});
    t.true(messages.some(message => message.content.includes('AFFiNE AI')));
  } finally {
    await module.close();
  }
});

test('PromptService should apply global text model defaults before prompt overrides', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              text: {
                model: 'ollama-main/office-chat-fast',
                optionalModels: [
                  'ollama-main/office-chat-fast',
                  'ollama-main/office-chat-strong',
                ],
                proModels: ['ollama-main/office-chat-strong'],
              },
            },
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const prompt = await prompts.get('Chat With AFFiNE AI');

    t.truthy(prompt);
    t.is(prompt?.category, 'text');
    t.is(prompt?.defaultPolicy, 'text');
    t.false(prompt?.overrideApplied);
    t.is(prompt?.model, 'ollama-main/office-chat-fast');
    t.is(prompt?.modelSource, 'default_policy');
    t.is(prompt?.modelConfigPath, 'copilot.prompts.defaults.text.model');
    t.deepEqual(prompt?.optionalModels, [
      'ollama-main/office-chat-fast',
      'ollama-main/office-chat-strong',
    ]);
    t.is(prompt?.optionalModelsSource, 'default_policy');
    t.is(
      prompt?.optionalModelsConfigPath,
      'copilot.prompts.defaults.text.optionalModels'
    );
    t.deepEqual(prompt?.config?.proModels, ['ollama-main/office-chat-strong']);
    t.is(prompt?.proModelsSource, 'default_policy');
    t.is(
      prompt?.proModelsConfigPath,
      'copilot.prompts.defaults.text.proModels'
    );
    t.true(prompt?.config?.tools?.includes('docRead') ?? false);
  } finally {
    await module.close();
  }
});

test('PromptService should let prompt overrides win over global text defaults', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              text: {
                model: 'ollama-main/office-chat-fast',
                optionalModels: ['ollama-main/office-chat-fast'],
                proModels: ['ollama-main/office-chat-strong'],
              },
            },
            overrides: [
              {
                name: 'Chat With AFFiNE AI',
                model: 'openai-default/gpt-5-mini',
                optionalModels: ['openai-default/gpt-5-mini'],
                config: {
                  proModels: ['openai-default/gpt-5'],
                },
              },
            ],
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const prompt = await prompts.get('Chat With AFFiNE AI');

    t.truthy(prompt);
    t.is(prompt?.defaultPolicy, 'text');
    t.true(prompt?.overrideApplied);
    t.is(prompt?.model, 'openai-default/gpt-5-mini');
    t.is(prompt?.modelSource, 'override');
    t.is(prompt?.modelConfigPath, 'copilot.prompts.overrides[].model');
    t.deepEqual(prompt?.optionalModels, ['openai-default/gpt-5-mini']);
    t.is(prompt?.optionalModelsSource, 'override');
    t.is(
      prompt?.optionalModelsConfigPath,
      'copilot.prompts.overrides[].optionalModels'
    );
    t.deepEqual(prompt?.config?.proModels, ['openai-default/gpt-5']);
    t.is(prompt?.proModelsSource, 'override');
    t.is(
      prompt?.proModelsConfigPath,
      'copilot.prompts.overrides[].config.proModels'
    );
  } finally {
    await module.close();
  }
});

test('PromptService should apply explicit structured defaults before text defaults', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              text: {
                model: 'ollama-main/office-chat-fast',
                optionalModels: ['ollama-main/office-chat-fast'],
              },
              structured: {
                model: 'ollama-main/office-structured',
                optionalModels: ['ollama-main/office-structured'],
                includeNames: ['Summarize the meeting structured'],
              },
            },
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const structured = await prompts.get('Summarize the meeting structured');
    const chat = await prompts.get('Chat With AFFiNE AI');

    t.truthy(structured);
    t.is(structured?.category, 'text');
    t.is(structured?.defaultPolicy, 'structured');
    t.is(structured?.model, 'ollama-main/office-structured');
    t.deepEqual(structured?.optionalModels, ['ollama-main/office-structured']);

    t.truthy(chat);
    t.is(chat?.model, 'ollama-main/office-chat-fast');
    t.deepEqual(chat?.optionalModels, ['ollama-main/office-chat-fast']);
  } finally {
    await module.close();
  }
});

test('PromptService should require explicit structured default scope', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              structured: {
                model: 'ollama-main/office-structured',
                optionalModels: ['ollama-main/office-structured'],
              },
            },
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const structured = await prompts.get('Summarize the meeting structured');

    t.truthy(structured);
    t.not(structured?.model, 'ollama-main/office-structured');
  } finally {
    await module.close();
  }
});

test('PromptService should apply image defaults to image prompt categories', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              text: {
                model: 'ollama-main/office-chat-fast',
                optionalModels: ['ollama-main/office-chat-fast'],
              },
              image: {
                model: 'local-image/office-image',
                optionalModels: ['local-image/office-image'],
              },
            },
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const image = await prompts.get('Generate image');
    const imageWorkflow = await prompts.get('workflow:image-sketch');
    const chat = await prompts.get('Chat With AFFiNE AI');

    t.truthy(image);
    t.is(image?.category, 'image');
    t.is(image?.defaultPolicy, 'image');
    t.is(image?.model, 'local-image/office-image');
    t.deepEqual(image?.optionalModels, ['local-image/office-image']);

    t.truthy(imageWorkflow);
    t.is(imageWorkflow?.model, 'local-image/office-image');

    t.truthy(chat);
    t.is(chat?.model, 'ollama-main/office-chat-fast');
  } finally {
    await module.close();
  }
});

test('PromptService should apply transcript defaults before text defaults', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              text: {
                model: 'ollama-main/office-chat-fast',
                optionalModels: ['ollama-main/office-chat-fast'],
              },
              transcript: {
                model: 'local-audio/office-transcript',
                optionalModels: ['local-audio/office-transcript'],
              },
            },
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const transcript = await prompts.get('Transcript audio');
    const transcriptStructured = await prompts.get(
      'Transcript audio structured'
    );
    const chat = await prompts.get('Chat With AFFiNE AI');

    t.truthy(transcript);
    t.is(transcript?.category, 'transcript');
    t.is(transcript?.defaultPolicy, 'transcript');
    t.is(transcript?.model, 'local-audio/office-transcript');
    t.deepEqual(transcript?.optionalModels, ['local-audio/office-transcript']);

    t.truthy(transcriptStructured);
    t.is(transcriptStructured?.model, 'local-audio/office-transcript');

    t.truthy(chat);
    t.is(chat?.model, 'ollama-main/office-chat-fast');
  } finally {
    await module.close();
  }
});

test('PromptService should let prompt overrides win over category defaults', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              image: {
                model: 'local-image/office-image',
                optionalModels: ['local-image/office-image'],
              },
            },
            overrides: [
              {
                name: 'Generate image',
                model: 'openai-default/gpt-image-1',
                optionalModels: ['openai-default/gpt-image-1'],
              },
            ],
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const image = await prompts.get('Generate image');

    t.truthy(image);
    t.is(image?.model, 'openai-default/gpt-image-1');
    t.deepEqual(image?.optionalModels, ['openai-default/gpt-image-1']);
  } finally {
    await module.close();
  }
});

test('PromptService should not apply global text defaults to attachment or image prompts', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              text: {
                model: 'ollama-main/office-chat-fast',
                optionalModels: ['ollama-main/office-chat-fast'],
              },
            },
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const transcript = await prompts.get('Transcript audio');
    const image = await prompts.get('Generate image');

    t.truthy(transcript);
    t.truthy(image);
    t.is(transcript?.model, 'gemini-2.5-flash');
    t.deepEqual(transcript?.optionalModels, [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-3.1-pro-preview',
    ]);
    t.is(image?.model, 'gpt-image-1');
  } finally {
    await module.close();
  }
});

test('PromptService should ignore disabled prompt overrides', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            overrides: [
              {
                name: 'Chat With AFFiNE AI',
                enabled: false,
                model: 'openai-default/gpt-5-mini',
              },
            ],
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const prompt = await prompts.get('Chat With AFFiNE AI');

    t.truthy(prompt);
    t.is(prompt?.model, 'gemini-2.5-flash');
  } finally {
    await module.close();
  }
});

test('PromptService should list safe prompt catalog metadata with defaults and overrides applied', async t => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ConfigModule.override({
        copilot: {
          prompts: {
            defaults: {
              text: {
                model: 'ollama-main/office-chat-fast',
                optionalModels: [
                  'ollama-main/office-chat-fast',
                  'ollama-main/office-chat-strong',
                ],
              },
            },
            overrides: [
              {
                name: 'Chat With AFFiNE AI',
                model: 'openai-default/gpt-5-mini',
                optionalModels: ['openai-default/gpt-5-mini'],
                config: {
                  proModels: ['openai-default/gpt-5'],
                },
              },
            ],
          },
        },
      }),
    ],
    providers: [PromptService],
  }).compile();

  try {
    const prompts = module.get(PromptService);
    const catalog = await prompts.listCatalog();
    const chat = catalog.find(prompt => prompt.name === 'Chat With AFFiNE AI');
    const transcript = catalog.find(
      prompt => prompt.name === 'Transcript audio'
    );

    t.true(catalog.length > 0);
    t.deepEqual(
      catalog.map(prompt => prompt.name),
      catalog.map(prompt => prompt.name).sort((a, b) => a.localeCompare(b))
    );
    t.truthy(chat);
    t.is(chat?.source, 'built_in');
    t.is(chat?.category, 'text');
    t.is(chat?.defaultPolicy, 'text');
    t.true(chat?.overrideApplied);
    t.is(chat?.model, 'openai-default/gpt-5-mini');
    t.is(chat?.modelSource, 'override');
    t.is(chat?.modelConfigPath, 'copilot.prompts.overrides[].model');
    t.deepEqual(chat?.optionalModels, ['openai-default/gpt-5-mini']);
    t.is(chat?.optionalModelsSource, 'override');
    t.is(
      chat?.optionalModelsConfigPath,
      'copilot.prompts.overrides[].optionalModels'
    );
    t.is(chat?.optionalModelCount, 1);
    t.is(chat?.proModelCount, 1);
    t.is(chat?.proModelsSource, 'override');
    t.is(
      chat?.proModelsConfigPath,
      'copilot.prompts.overrides[].config.proModels'
    );
    t.regex(chat?.fingerprint ?? '', /^[a-f0-9]{16}$/);
    t.regex(chat?.modelStrategyFingerprint ?? '', /^[a-f0-9]{16}$/);
    t.regex(chat?.templateFingerprint ?? '', /^[a-f0-9]{16}$/);
    t.is(chat?.revision, `built_in:text:override:${chat?.fingerprint ?? ''}`);
    const chatVersionEvidence = chat!.versionEvidence;
    t.deepEqual(chatVersionEvidence, {
      defaultPolicy: 'text',
      fingerprint: chat?.fingerprint,
      modelConfigPath: 'copilot.prompts.overrides[].model',
      modelStrategyFingerprint: chat?.modelStrategyFingerprint,
      optionalModelsConfigPath: 'copilot.prompts.overrides[].optionalModels',
      overrideApplied: true,
      proModelsConfigPath: 'copilot.prompts.overrides[].config.proModels',
      revision: chat?.revision,
      templateFingerprint: chat?.templateFingerprint,
    });
    t.true(Array.isArray(chat?.paramKeys));
    t.is(chat?.paramCount, chat?.paramKeys.length);
    t.false('messages' in (chat as object));
    t.false('config' in (chat as object));
    t.false('params' in (chat as object));
    t.false('messages' in chatVersionEvidence);
    t.false('config' in chatVersionEvidence);
    t.false('params' in chatVersionEvidence);

    t.truthy(transcript);
    t.is(transcript?.category, 'transcript');
    t.not(transcript?.defaultPolicy, 'text');
  } finally {
    await module.close();
  }
});

test('PromptService should produce stable prompt catalog revisions for model strategy audits', async t => {
  const createModule = (model: string) =>
    Test.createTestingModule({
      imports: [
        ConfigModule,
        ConfigModule.override({
          copilot: {
            prompts: {
              defaults: {
                text: {
                  model,
                  optionalModels: [model],
                },
              },
            },
          },
        }),
      ],
      providers: [PromptService],
    }).compile();
  const module = await createModule('ollama-main/office-chat-fast');
  const changedModule = await createModule('ollama-main/office-chat-strong');

  try {
    const prompts = module.get(PromptService);
    const changedPrompts = changedModule.get(PromptService);
    const catalog = await prompts.listCatalog();
    const nextCatalog = await prompts.listCatalog();
    const changedCatalog = await changedPrompts.listCatalog();
    const chat = catalog.find(prompt => prompt.name === 'Chat With AFFiNE AI');
    const nextChat = nextCatalog.find(
      prompt => prompt.name === 'Chat With AFFiNE AI'
    );
    const changedChat = changedCatalog.find(
      prompt => prompt.name === 'Chat With AFFiNE AI'
    );

    t.truthy(chat);
    t.truthy(nextChat);
    t.truthy(changedChat);
    t.is(chat?.fingerprint, nextChat?.fingerprint);
    t.is(chat?.revision, nextChat?.revision);
    t.is(chat?.modelStrategyFingerprint, nextChat?.modelStrategyFingerprint);
    t.deepEqual(chat?.versionEvidence, nextChat?.versionEvidence);
    t.not(chat?.fingerprint, changedChat?.fingerprint);
    t.not(chat?.revision, changedChat?.revision);
    t.not(
      chat?.modelStrategyFingerprint,
      changedChat?.modelStrategyFingerprint
    );
    t.is(chat?.templateFingerprint, changedChat?.templateFingerprint);
    t.not(chat?.versionEvidence, changedChat?.versionEvidence);
    t.is(
      chat?.versionEvidence.templateFingerprint,
      changedChat?.versionEvidence.templateFingerprint
    );
    t.regex(chat?.modelStrategyFingerprint ?? '', /^[a-f0-9]{16}$/);
    t.regex(chat?.templateFingerprint ?? '', /^[a-f0-9]{16}$/);
    t.regex(changedChat?.fingerprint ?? '', /^[a-f0-9]{16}$/);
    t.is(
      changedChat?.revision,
      `built_in:text:base:${changedChat?.fingerprint ?? ''}`
    );
  } finally {
    await module.close();
    await changedModule.close();
  }
});

test('PromptService should include prompt template changes in catalog revisions', async t => {
  const module = await Test.createTestingModule({
    imports: [ConfigModule],
  }).compile();

  try {
    const config = module.get(Config);
    const createService = (content: string) =>
      new TestingCompatPromptService(config, {
        name: 'Compat prompt',
        model: 'compat-model',
        messages: [
          {
            role: 'system',
            content,
          },
        ],
      });
    const prompts = createService('Draft a concise response.');
    const changedPrompts = createService('Draft a detailed response.');
    const prompt = (await prompts.listCatalog()).find(
      item => item.name === 'Compat prompt'
    );
    const nextPrompt = (await prompts.listCatalog()).find(
      item => item.name === 'Compat prompt'
    );
    const changedPrompt = (await changedPrompts.listCatalog()).find(
      item => item.name === 'Compat prompt'
    );

    t.truthy(prompt);
    t.truthy(nextPrompt);
    t.truthy(changedPrompt);
    t.is(prompt?.source, 'compat');
    t.regex(prompt?.modelStrategyFingerprint ?? '', /^[a-f0-9]{16}$/);
    t.regex(prompt?.templateFingerprint ?? '', /^[a-f0-9]{16}$/);
    t.is(
      prompt?.modelStrategyFingerprint,
      nextPrompt?.modelStrategyFingerprint
    );
    t.is(
      prompt?.modelStrategyFingerprint,
      changedPrompt?.modelStrategyFingerprint
    );
    t.is(
      prompt?.versionEvidence.modelStrategyFingerprint,
      changedPrompt?.versionEvidence.modelStrategyFingerprint
    );
    t.is(prompt?.templateFingerprint, nextPrompt?.templateFingerprint);
    t.is(prompt?.fingerprint, nextPrompt?.fingerprint);
    t.is(prompt?.revision, nextPrompt?.revision);
    t.deepEqual(prompt?.versionEvidence, nextPrompt?.versionEvidence);
    t.not(prompt?.templateFingerprint, changedPrompt?.templateFingerprint);
    t.not(prompt?.fingerprint, changedPrompt?.fingerprint);
    t.not(prompt?.revision, changedPrompt?.revision);
    t.not(prompt?.versionEvidence, changedPrompt?.versionEvidence);
    t.false('messages' in (prompt as object));
    t.false('messages' in prompt!.versionEvidence);
  } finally {
    await module.close();
  }
});

test('PromptService should use DB registry prompts as compat catalog seeds', async t => {
  const module = await Test.createTestingModule({
    imports: [ConfigModule],
  }).compile();

  try {
    const config = module.get(Config);
    const registryUpdatedAt = new Date('2026-06-17T04:05:06.000Z');
    const registryFingerprint = 'facefeedcafebeef';
    const prompts = new TestingRegistryPromptService(config, [
      {
        name: 'Chat With AFFiNE AI',
        model: 'registry/office-chat',
        optionalModels: ['registry/office-chat', 'registry/office-chat-pro'],
        registryFingerprint,
        config: {
          proModels: ['registry/office-chat-pro'],
          temperature: 0.1,
        },
        messages: [
          {
            role: 'system',
            content: 'Answer with the registry prompt.',
          },
          {
            role: 'user',
            content: '{{query}}',
            params: {
              query: '',
            },
          },
        ],
        registryId: 42,
        registryMessageCount: 2,
        registryModified: true,
        registryUpdatedAt,
        registryValidationBlockingCount: 0,
        registryValidationDetail: 'ready',
        registryValidationErrorCount: 0,
        registryValidationIssueCount: 0,
        registryValidationIssues: [],
        registryValidationPublishStatus: 'allowed',
        registryValidationRemediations: [],
        registryValidationReason: 'ready',
        registryValidationStatus: 'ready',
        source: 'registry',
      },
    ]);
    const prompt = await prompts.get('Chat With AFFiNE AI');
    const catalog = await prompts.listCatalog();
    const catalogPrompt = catalog.find(
      item => item.name === 'Chat With AFFiNE AI'
    );

    t.truthy(prompt);
    t.is(prompt?.source, 'registry');
    t.is(prompt?.modelSource, 'registry');
    t.is(prompt?.modelConfigPath, 'ai_prompts_metadata.model');
    t.is(prompt?.optionalModelsSource, 'registry');
    t.is(
      prompt?.optionalModelsConfigPath,
      'ai_prompts_metadata.optional_models'
    );
    t.is(prompt?.proModelsSource, 'registry');
    t.is(prompt?.proModelsConfigPath, 'ai_prompts_metadata.config.proModels');
    t.is(prompt?.registryFingerprint, registryFingerprint);
    t.is(prompt?.registryId, 42);
    t.is(prompt?.registryMessageCount, 2);
    t.true(prompt?.registryModified);
    t.is(
      prompt?.registryUpdatedAt?.toISOString(),
      registryUpdatedAt.toISOString()
    );
    t.is(prompt?.registryValidationDetail, 'ready');
    t.is(prompt?.registryValidationBlockingCount, 0);
    t.is(prompt?.registryValidationErrorCount, 0);
    t.is(prompt?.registryValidationIssueCount, 0);
    t.deepEqual(prompt?.registryValidationIssues, []);
    t.is(prompt?.registryValidationPublishStatus, 'allowed');
    t.deepEqual(prompt?.registryValidationRemediations, []);
    t.is(prompt?.registryValidationReason, 'ready');
    t.is(prompt?.registryValidationStatus, 'ready');
    t.deepEqual(prompt?.paramKeys, ['query']);

    const messages = prompts.finish(prompt!, { query: 'hello' });
    t.true(
      messages.some(message =>
        message.content.includes('Answer with the registry prompt.')
      )
    );
    t.true(messages.some(message => message.content.includes('hello')));

    t.truthy(catalogPrompt);
    t.is(catalogPrompt?.source, 'registry');
    t.is(catalogPrompt?.model, 'registry/office-chat');
    t.is(catalogPrompt?.registryFingerprint, registryFingerprint);
    t.is(catalogPrompt?.registryId, 42);
    t.is(catalogPrompt?.registryMessageCount, 2);
    t.true(catalogPrompt?.registryModified);
    t.is(
      catalogPrompt?.registryUpdatedAt?.toISOString(),
      registryUpdatedAt.toISOString()
    );
    t.is(catalogPrompt?.registryValidationDetail, 'ready');
    t.is(catalogPrompt?.registryValidationBlockingCount, 0);
    t.is(catalogPrompt?.registryValidationErrorCount, 0);
    t.is(catalogPrompt?.registryValidationIssueCount, 0);
    t.deepEqual(catalogPrompt?.registryValidationIssues, []);
    t.is(catalogPrompt?.registryValidationPublishStatus, 'allowed');
    t.deepEqual(catalogPrompt?.registryValidationRemediations, []);
    t.is(catalogPrompt?.registryValidationReason, 'ready');
    t.is(catalogPrompt?.registryValidationStatus, 'ready');
    t.is(
      catalogPrompt?.revision,
      `registry:no-policy:base:${catalogPrompt?.fingerprint ?? ''}`
    );
    t.regex(catalogPrompt?.templateFingerprint ?? '', /^[a-f0-9]{16}$/);
    t.deepEqual(catalogPrompt?.versionEvidence, {
      fingerprint: catalogPrompt?.fingerprint,
      modelConfigPath: 'ai_prompts_metadata.model',
      modelStrategyFingerprint: catalogPrompt?.modelStrategyFingerprint,
      optionalModelsConfigPath: 'ai_prompts_metadata.optional_models',
      overrideApplied: false,
      proModelsConfigPath: 'ai_prompts_metadata.config.proModels',
      registryFingerprint,
      registryId: 42,
      registryMessageCount: 2,
      registryModified: true,
      registryUpdatedAt,
      registryValidationBlockingCount: 0,
      registryValidationDetail: 'ready',
      registryValidationErrorCount: 0,
      registryValidationIssueCount: 0,
      registryValidationIssues: [],
      registryValidationPublishStatus: 'allowed',
      registryValidationRemediations: [],
      registryValidationReason: 'ready',
      registryValidationStatus: 'ready',
      revision: catalogPrompt?.revision,
      templateFingerprint: catalogPrompt?.templateFingerprint,
    });
    t.false('messages' in (catalogPrompt as object));
    t.false('config' in (catalogPrompt as object));
    t.false('params' in (catalogPrompt as object));
  } finally {
    await module.close();
  }
});

test('PromptService should expose ignored DB registry seed diagnostics in catalog', async t => {
  const module = await Test.createTestingModule({
    imports: [ConfigModule],
  }).compile();

  try {
    const config = module.get(Config);
    const registryFingerprint = 'feedfacecafebeef';
    const registryUpdatedAt = new Date('2026-06-17T05:06:07.000Z');
    const prompts = new TestingRegistryPromptService(
      config,
      [],
      [
        {
          action: 'chat',
          model: 'registry/empty-chat',
          name: 'Chat With AFFiNE AI',
          optionalModels: ['registry/empty-chat'],
          registryFingerprint,
          registryId: 84,
          registryMessageCount: 0,
          registryModified: false,
          registryUpdatedAt,
          registryValidationBlockingCount: 1,
          registryValidationDetail: 'messages:empty',
          registryValidationErrorCount: 1,
          registryValidationIssueCount: 1,
          registryValidationIssues: [
            {
              code: 'empty',
              detail: 'messages:empty',
              fieldLabel: 'Messages',
              message: 'Prompt registry seed has no messages.',
              path: 'messages',
              publishBlocking: true,
              reason: 'missing_messages',
              severity: 'error',
              source: 'ai_prompts_messages',
              sourceLocator: {
                field: 'messages',
                path: 'messages',
                registryFingerprint,
                registryId: 84,
                registryUpdatedAt: registryUpdatedAt.toISOString(),
                table: 'ai_prompts_messages',
              },
            },
          ],
          registryValidationPublishStatus: 'blocked',
          registryValidationRemediations: [
            {
              detail:
                'Create at least one valid prompt message for this registry seed.',
              kind: 'add_messages',
              label: 'Add prompt messages',
              target: 'ai_prompts_messages',
              targetLocator: {
                field: 'messages',
                path: 'messages',
                registryFingerprint,
                registryId: 84,
                registryUpdatedAt: registryUpdatedAt.toISOString(),
                table: 'ai_prompts_messages',
              },
            },
          ],
          registryValidationReason: 'missing_messages',
          registryValidationStatus: 'ignored',
          source: 'registry',
        },
      ]
    );
    const prompt = await prompts.get('Chat With AFFiNE AI');
    const catalogPrompt = (await prompts.listCatalog()).find(
      item => item.name === 'Chat With AFFiNE AI'
    );

    t.truthy(prompt);
    t.is(prompt?.source, 'built_in');
    t.truthy(catalogPrompt);
    t.is(catalogPrompt?.source, 'built_in');
    t.is(catalogPrompt?.registryFingerprint, registryFingerprint);
    t.is(catalogPrompt?.registryId, 84);
    t.is(catalogPrompt?.registryMessageCount, 0);
    t.false(catalogPrompt?.registryModified);
    t.is(
      catalogPrompt?.registryUpdatedAt?.toISOString(),
      registryUpdatedAt.toISOString()
    );
    t.is(catalogPrompt?.registryValidationDetail, 'messages:empty');
    t.is(catalogPrompt?.registryValidationBlockingCount, 1);
    t.is(catalogPrompt?.registryValidationErrorCount, 1);
    t.is(catalogPrompt?.registryValidationIssueCount, 1);
    t.deepEqual(catalogPrompt?.registryValidationIssues, [
      {
        code: 'empty',
        detail: 'messages:empty',
        fieldLabel: 'Messages',
        message: 'Prompt registry seed has no messages.',
        path: 'messages',
        publishBlocking: true,
        reason: 'missing_messages',
        severity: 'error',
        source: 'ai_prompts_messages',
        sourceLocator: {
          field: 'messages',
          path: 'messages',
          registryFingerprint,
          registryId: 84,
          registryUpdatedAt: registryUpdatedAt.toISOString(),
          table: 'ai_prompts_messages',
        },
      },
    ]);
    t.is(catalogPrompt?.registryValidationPublishStatus, 'blocked');
    t.deepEqual(catalogPrompt?.registryValidationRemediations, [
      {
        detail:
          'Create at least one valid prompt message for this registry seed.',
        kind: 'add_messages',
        label: 'Add prompt messages',
        target: 'ai_prompts_messages',
        targetLocator: {
          field: 'messages',
          path: 'messages',
          registryFingerprint,
          registryId: 84,
          registryUpdatedAt: registryUpdatedAt.toISOString(),
          table: 'ai_prompts_messages',
        },
      },
    ]);
    t.is(catalogPrompt?.registryValidationReason, 'missing_messages');
    t.is(catalogPrompt?.registryValidationStatus, 'ignored');
    t.is(
      catalogPrompt?.versionEvidence.registryFingerprint,
      registryFingerprint
    );
    t.deepEqual(catalogPrompt?.versionEvidence.registryId, 84);
    t.is(catalogPrompt?.versionEvidence.registryMessageCount, 0);
    t.false(catalogPrompt?.versionEvidence.registryModified);
    t.is(
      catalogPrompt?.versionEvidence.registryUpdatedAt?.toISOString(),
      registryUpdatedAt.toISOString()
    );
    t.is(
      catalogPrompt?.versionEvidence.registryValidationDetail,
      'messages:empty'
    );
    t.is(catalogPrompt?.versionEvidence.registryValidationBlockingCount, 1);
    t.is(catalogPrompt?.versionEvidence.registryValidationErrorCount, 1);
    t.is(catalogPrompt?.versionEvidence.registryValidationIssueCount, 1);
    t.deepEqual(catalogPrompt?.versionEvidence.registryValidationIssues, [
      {
        code: 'empty',
        detail: 'messages:empty',
        fieldLabel: 'Messages',
        message: 'Prompt registry seed has no messages.',
        path: 'messages',
        publishBlocking: true,
        reason: 'missing_messages',
        severity: 'error',
        source: 'ai_prompts_messages',
        sourceLocator: {
          field: 'messages',
          path: 'messages',
          registryFingerprint,
          registryId: 84,
          registryUpdatedAt: registryUpdatedAt.toISOString(),
          table: 'ai_prompts_messages',
        },
      },
    ]);
    t.is(
      catalogPrompt?.versionEvidence.registryValidationPublishStatus,
      'blocked'
    );
    t.deepEqual(catalogPrompt?.versionEvidence.registryValidationRemediations, [
      {
        detail:
          'Create at least one valid prompt message for this registry seed.',
        kind: 'add_messages',
        label: 'Add prompt messages',
        target: 'ai_prompts_messages',
        targetLocator: {
          field: 'messages',
          path: 'messages',
          registryFingerprint,
          registryId: 84,
          registryUpdatedAt: registryUpdatedAt.toISOString(),
          table: 'ai_prompts_messages',
        },
      },
    ]);
    t.is(
      catalogPrompt?.versionEvidence.registryValidationReason,
      'missing_messages'
    );
    t.is(catalogPrompt?.versionEvidence.registryValidationStatus, 'ignored');
  } finally {
    await module.close();
  }
});
