import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import type { ZodIssue } from 'zod';

import { CopilotPromptInvalid } from '../base';
import type {
  Prompt,
  PromptRegistryDiagnostic,
  PromptRegistryValidationIssue,
  PromptRegistryValidationPublishStatus,
  PromptRegistryValidationReason,
  PromptRegistryValidationRemediation,
} from '../plugins/copilot/prompt/spec';
import {
  PromptConfigStrictSchema,
  type PromptMessage,
  PromptMessageSchema,
} from '../plugins/copilot/providers/types';
import { BaseModel } from './base';

const PROMPT_REGISTRY_SELECT = {
  action: true,
  config: true,
  id: true,
  model: true,
  modified: true,
  name: true,
  optionalModels: true,
  updatedAt: true,
  messages: {
    select: {
      attachments: true,
      content: true,
      idx: true,
      params: true,
      role: true,
    },
    orderBy: { idx: 'asc' },
  },
} satisfies Prisma.AiPromptSelect;

type PromptRegistryRecord = Prisma.AiPromptGetPayload<{
  select: typeof PROMPT_REGISTRY_SELECT;
}>;

type PromptRegistryValidationResult = {
  detail: string;
  registryFingerprint: string;
  issues: PromptRegistryValidationIssue[];
  reason: PromptRegistryValidationReason;
  remediations: PromptRegistryValidationRemediation[];
};

const PROMPT_REGISTRY_RUNTIME_TEMPLATE_PARAMS = new Set([
  'attachments',
  'chunkSize',
  'content',
  'contextFiles',
  'createDate',
  'currentDocId',
  'docContent',
  'docId',
  'docs',
  'docTitle',
  'document',
  'focus',
  'html',
  'id',
  'instructions',
  'language',
  'length',
  'links',
  'messages',
  'mimeType',
  'mindmap',
  'name',
  'node',
  'quality',
  'role',
  'selectedMarkdown',
  'selectedSnapshot',
  'seed',
  'tags',
  'timezone',
  'updatedDate',
]);

export type PromptRegistryPublishGateExpectedVersion = {
  registryFingerprint?: string;
  registryId?: number;
  registryUpdatedAt?: string;
};

export type PromptRegistryPublishGateVerdict = {
  allowed: boolean;
  blockingCount: number;
  errorCount: number;
  issueCount: number;
  issues: PromptRegistryValidationIssue[];
  name: string;
  publishStatus: PromptRegistryValidationPublishStatus;
  reason: PromptRegistryValidationReason;
  registryFingerprint: string;
  registryId: number;
  registryUpdatedAt: Date;
  remediations: PromptRegistryValidationRemediation[];
  stale: boolean;
  staleReasons: string[];
  status: 'ready' | 'ignored' | 'stale';
};

export type PromptRegistryPublishGateRejectionCode =
  | 'prompt_registry_not_found'
  | 'prompt_registry_validation_blocked'
  | 'prompt_registry_version_stale';

export class PromptRegistryPublishGateError extends CopilotPromptInvalid {
  readonly gateCode: PromptRegistryPublishGateRejectionCode;
  readonly promptName: string;
  readonly verdict: PromptRegistryPublishGateVerdict | null;

  constructor(input: {
    gateCode: PromptRegistryPublishGateRejectionCode;
    promptName: string;
    verdict: PromptRegistryPublishGateVerdict | null;
  }) {
    super(formatPromptRegistryPublishGateErrorMessage(input));
    this.gateCode = input.gateCode;
    this.promptName = input.promptName;
    this.verdict = input.verdict;
    this.data = {
      blockingCount: input.verdict?.blockingCount ?? 0,
      errorCount: input.verdict?.errorCount ?? 0,
      gateCode: input.gateCode,
      issueCount: input.verdict?.issueCount ?? 0,
      promptName: input.promptName,
      publishStatus: input.verdict?.publishStatus ?? null,
      registryFingerprint: input.verdict?.registryFingerprint ?? null,
      registryId: input.verdict?.registryId ?? null,
      registryUpdatedAt: input.verdict?.registryUpdatedAt.toISOString() ?? null,
      stale: input.verdict?.stale ?? false,
      staleReasons: input.verdict?.staleReasons ?? [],
      status: input.verdict?.status ?? 'missing',
    };
  }
}

function formatPromptRegistryPublishGateErrorMessage(input: {
  gateCode: PromptRegistryPublishGateRejectionCode;
  promptName: string;
  verdict: PromptRegistryPublishGateVerdict | null;
}) {
  if (!input.verdict) {
    return `Prompt registry publish gate rejected ${input.promptName}: registry row not found`;
  }

  if (input.gateCode === 'prompt_registry_version_stale') {
    return `Prompt registry publish gate rejected ${input.promptName}: stale registry version`;
  }

  return `Prompt registry publish gate rejected ${input.promptName}: ${input.verdict.reason}`;
}

@Injectable()
export class CopilotPromptModel extends BaseModel {
  async getRegistryPrompt(name: string): Promise<Prompt | null> {
    const row = await this.db.aiPrompt.findUnique({
      where: { name },
      select: PROMPT_REGISTRY_SELECT,
    });

    return row ? this.toRegistryPrompt(row) : null;
  }

  async getRegistryDiagnostic(
    name: string
  ): Promise<PromptRegistryDiagnostic | null> {
    const row = await this.db.aiPrompt.findUnique({
      where: { name },
      select: PROMPT_REGISTRY_SELECT,
    });

    return row ? this.toRegistryDiagnostic(row) : null;
  }

  async listRegistryPrompts(): Promise<Prompt[]> {
    const rows = await this.db.aiPrompt.findMany({
      select: PROMPT_REGISTRY_SELECT,
      orderBy: { name: 'asc' },
    });

    return rows
      .map(row => this.toRegistryPrompt(row))
      .filter((prompt): prompt is Prompt => !!prompt);
  }

  async listRegistryDiagnostics(): Promise<PromptRegistryDiagnostic[]> {
    const rows = await this.db.aiPrompt.findMany({
      select: PROMPT_REGISTRY_SELECT,
      orderBy: { name: 'asc' },
    });

    return rows.map(row => this.toRegistryDiagnostic(row));
  }

  async getRegistryPublishGateVerdict(
    name: string,
    expectedVersion: PromptRegistryPublishGateExpectedVersion = {}
  ): Promise<PromptRegistryPublishGateVerdict | null> {
    const row = await this.db.aiPrompt.findUnique({
      where: { name },
      select: PROMPT_REGISTRY_SELECT,
    });

    return row ? this.toRegistryPublishGateVerdict(row, expectedVersion) : null;
  }

  async assertRegistryPublishGateAllowed(
    name: string,
    expectedVersion: PromptRegistryPublishGateExpectedVersion = {}
  ): Promise<PromptRegistryPublishGateVerdict> {
    const verdict = await this.getRegistryPublishGateVerdict(
      name,
      expectedVersion
    );

    if (!verdict) {
      throw new PromptRegistryPublishGateError({
        gateCode: 'prompt_registry_not_found',
        promptName: name,
        verdict,
      });
    }
    if (!verdict.allowed) {
      throw new PromptRegistryPublishGateError({
        gateCode: this.resolveRegistryPublishGateRejectionCode(verdict),
        promptName: name,
        verdict,
      });
    }

    return verdict;
  }

  private toRegistryPrompt(row: PromptRegistryRecord): Prompt | null {
    const validation = this.resolveRegistryValidation(row);
    if (validation.reason !== 'ready') {
      return null;
    }

    const config = this.parseConfig(row);
    if (config === null || config.reason !== 'ready') {
      return null;
    }

    const messages: PromptMessage[] = [];
    for (const message of row.messages) {
      const parsedMessage = PromptMessageSchema.safeParse({
        attachments: message.attachments ?? undefined,
        content: message.content,
        params: message.params ?? undefined,
        role: message.role,
      });
      if (!parsedMessage.success) {
        return null;
      }
      messages.push(parsedMessage.data);
    }

    return {
      action: row.action ?? undefined,
      config: config.config,
      messages,
      model: row.model,
      name: row.name,
      optionalModels: [...row.optionalModels],
      registryFingerprint: validation.registryFingerprint,
      registryId: row.id,
      registryMessageCount: row.messages.length,
      registryModified: row.modified,
      registryUpdatedAt: row.updatedAt,
      registryValidationBlockingCount: this.countRegistryValidationBlocking(
        validation.issues
      ),
      registryValidationDetail: validation.detail,
      registryValidationErrorCount: this.countRegistryValidationErrors(
        validation.issues
      ),
      registryValidationIssueCount: validation.issues.length,
      registryValidationIssues: validation.issues,
      registryValidationPublishStatus:
        this.resolveRegistryValidationPublishStatus(validation.issues),
      registryValidationRemediations: validation.remediations,
      registryValidationReason: 'ready',
      registryValidationStatus: 'ready',
      source: 'registry',
    };
  }

  private toRegistryDiagnostic(
    row: PromptRegistryRecord
  ): PromptRegistryDiagnostic {
    const validation = this.resolveRegistryValidation(row);

    return {
      action: row.action ?? undefined,
      model: row.model,
      name: row.name,
      optionalModels: [...row.optionalModels],
      registryFingerprint: validation.registryFingerprint,
      registryId: row.id,
      registryMessageCount: row.messages.length,
      registryModified: row.modified,
      registryUpdatedAt: row.updatedAt,
      registryValidationBlockingCount: this.countRegistryValidationBlocking(
        validation.issues
      ),
      registryValidationDetail: validation.detail,
      registryValidationErrorCount: this.countRegistryValidationErrors(
        validation.issues
      ),
      registryValidationIssueCount: validation.issues.length,
      registryValidationIssues: validation.issues,
      registryValidationPublishStatus:
        this.resolveRegistryValidationPublishStatus(validation.issues),
      registryValidationRemediations: validation.remediations,
      registryValidationReason: validation.reason,
      registryValidationStatus:
        validation.reason === 'ready' ? 'ready' : 'ignored',
      source: 'registry',
    };
  }

  private toRegistryPublishGateVerdict(
    row: PromptRegistryRecord,
    expectedVersion: PromptRegistryPublishGateExpectedVersion
  ): PromptRegistryPublishGateVerdict {
    const validation = this.resolveRegistryValidation(row);
    const registryUpdatedAt = row.updatedAt.toISOString();
    const staleReasons = this.resolveRegistryPublishGateStaleReasons({
      expectedVersion,
      registryFingerprint: validation.registryFingerprint,
      registryId: row.id,
      registryUpdatedAt,
    });
    const publishStatus = this.resolveRegistryValidationPublishStatus(
      validation.issues
    );
    const stale = staleReasons.length > 0;

    return {
      allowed: publishStatus === 'allowed' && !stale,
      blockingCount: this.countRegistryValidationBlocking(validation.issues),
      errorCount: this.countRegistryValidationErrors(validation.issues),
      issueCount: validation.issues.length,
      issues: validation.issues,
      name: row.name,
      publishStatus,
      reason: validation.reason,
      registryFingerprint: validation.registryFingerprint,
      registryId: row.id,
      registryUpdatedAt: row.updatedAt,
      remediations: validation.remediations,
      stale,
      staleReasons,
      status: stale
        ? 'stale'
        : validation.reason === 'ready'
          ? 'ready'
          : 'ignored',
    };
  }

  private resolveRegistryValidation(
    row: PromptRegistryRecord
  ): PromptRegistryValidationResult {
    const issues: PromptRegistryValidationIssue[] = [];
    const remediations: PromptRegistryValidationRemediation[] = [];
    const registryFingerprint = this.buildRegistryFingerprint(row);

    if (!row.messages.length) {
      issues.push({
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
          registryId: row.id,
          registryUpdatedAt: row.updatedAt.toISOString(),
          table: 'ai_prompts_messages',
        },
      });
      remediations.push({
        detail:
          'Create at least one valid prompt message for this registry seed.',
        kind: 'add_messages',
        label: 'Add prompt messages',
        target: 'ai_prompts_messages',
        targetLocator: this.resolveRegistryValidationSourceLocator(
          'messages',
          undefined,
          row.id,
          registryFingerprint,
          row.updatedAt
        ),
      });
    }

    const config = this.parseConfig(row);
    if (config.reason !== 'ready') {
      issues.push(...config.issues);
      remediations.push({
        detail:
          'Update ai_prompts_metadata.config to match the prompt config schema.',
        kind: 'fix_config',
        label: 'Fix prompt config',
        target: 'ai_prompts_metadata.config',
        targetLocator: this.resolveRegistryValidationSourceLocator(
          'config',
          undefined,
          row.id,
          registryFingerprint,
          row.updatedAt
        ),
      });
    }

    for (const message of row.messages) {
      const parsedMessage = PromptMessageSchema.safeParse({
        attachments: message.attachments ?? undefined,
        content: message.content,
        params: message.params ?? undefined,
        role: message.role,
      });
      if (!parsedMessage.success) {
        const messageIssues = this.toRegistryValidationIssues(
          'invalid_message',
          parsedMessage.error.issues,
          `message[${message.idx}]`,
          message.idx,
          row.id,
          registryFingerprint,
          row.updatedAt
        );

        issues.push(...messageIssues);
        remediations.push({
          detail: `Update prompt message ${message.idx} to match the prompt message schema.`,
          kind: 'fix_message',
          label: 'Fix prompt message',
          target: `ai_prompts_messages[${message.idx}]`,
          targetLocator: this.resolveRegistryValidationSourceLocator(
            `message[${message.idx}]`,
            message.idx,
            row.id,
            registryFingerprint,
            row.updatedAt
          ),
        });
      }
    }
    const templateParamIssues =
      this.resolveRegistryTemplateParamValidationIssues(
        row,
        registryFingerprint
      );
    if (templateParamIssues.length) {
      issues.push(...templateParamIssues);
      remediations.push({
        detail:
          'Declare default values for every prompt template variable in ai_prompts_messages.params.',
        kind: 'declare_template_param',
        label: 'Declare template params',
        target: 'ai_prompts_messages.params',
        targetLocator: this.resolveRegistryValidationSourceLocator(
          'messages.params',
          undefined,
          row.id,
          registryFingerprint,
          row.updatedAt
        ),
      });
    }

    if (issues.length) {
      return {
        detail: issues[0].detail,
        registryFingerprint,
        issues,
        reason: issues[0].reason,
        remediations,
      };
    }

    return {
      detail: 'ready',
      registryFingerprint,
      issues: [],
      reason: 'ready',
      remediations: [],
    };
  }

  private resolveRegistryTemplateParamValidationIssues(
    row: PromptRegistryRecord,
    registryFingerprint: string
  ): PromptRegistryValidationIssue[] {
    const declaredParams = new Set<string>();
    for (const message of row.messages) {
      if (!message.params || typeof message.params !== 'object') {
        continue;
      }
      if (Array.isArray(message.params)) {
        continue;
      }
      for (const key of Object.keys(message.params)) {
        declaredParams.add(key);
      }
    }

    const issues: PromptRegistryValidationIssue[] = [];
    const seenMissingParams = new Set<string>();
    for (const message of row.messages) {
      if (typeof message.content !== 'string') {
        continue;
      }
      for (const key of this.collectRegistryTemplateParamKeys(
        message.content
      )) {
        if (
          declaredParams.has(key) ||
          seenMissingParams.has(key) ||
          this.isRegistryRuntimeTemplateParam(key)
        ) {
          continue;
        }
        seenMissingParams.add(key);
        issues.push({
          code: 'missing',
          detail: `template.${key}:missing_param`,
          fieldLabel: 'Template Param',
          message: `Prompt template variable "${key}" is not declared in ai_prompts_messages.params.`,
          messageIndex: message.idx,
          path: `message[${message.idx}].params.${key}`,
          publishBlocking: true,
          reason: 'missing_template_param',
          severity: 'error',
          source: `ai_prompts_messages[${message.idx}].params.${key}`,
          sourceLocator: this.resolveRegistryValidationSourceLocator(
            `message[${message.idx}].params.${key}`,
            message.idx,
            row.id,
            registryFingerprint,
            row.updatedAt
          ),
        });
      }
    }

    return issues;
  }

  private collectRegistryTemplateParamKeys(content: string) {
    const keys: string[] = [];
    const sectionStack: string[] = [];
    const tokenPattern = /\{\{([#/^!]?)\s*([^{}\s]+)\s*\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = tokenPattern.exec(content))) {
      const marker = match[1] ?? '';
      const key = match[2]?.trim();
      if (!key || key === '.' || key.startsWith('>') || key.startsWith('&')) {
        continue;
      }
      if (marker === '!') {
        continue;
      }
      if (marker === '/') {
        sectionStack.pop();
        continue;
      }
      if (this.isRegistryBuiltinTemplateParam(key)) {
        if (marker === '#' || marker === '^') {
          sectionStack.push(key);
        }
        continue;
      }
      if (marker === '#' || marker === '^') {
        keys.push(key);
        sectionStack.push(key);
        continue;
      }
      if (sectionStack.length && !key.includes('.')) {
        continue;
      }
      keys.push(key);
    }

    return [...new Set(keys)];
  }

  private isRegistryBuiltinTemplateParam(key: string) {
    return key.startsWith('affine::');
  }

  private isRegistryRuntimeTemplateParam(key: string) {
    return PROMPT_REGISTRY_RUNTIME_TEMPLATE_PARAMS.has(key);
  }

  private parseConfig(row: PromptRegistryRecord): {
    config?: Prompt['config'];
    detail: string;
    issues: PromptRegistryValidationIssue[];
    reason: 'ready' | 'invalid_config';
  } {
    const parsed = PromptConfigStrictSchema.nullable()
      .optional()
      .safeParse(row.config ?? undefined);

    if (!parsed.success) {
      this.logger.warn(
        `Ignoring prompt registry row ${row.name}: invalid config payload`
      );
      const issues = this.toRegistryValidationIssues(
        'invalid_config',
        parsed.error.issues,
        'config',
        undefined,
        row.id,
        this.buildRegistryFingerprint(row),
        row.updatedAt
      );
      return {
        detail: issues[0].detail,
        issues,
        reason: 'invalid_config',
      };
    }

    return {
      config: parsed.data ?? undefined,
      detail: 'ready',
      issues: [],
      reason: 'ready',
    };
  }

  private toRegistryValidationIssue(
    reason: PromptRegistryValidationReason,
    issue: ZodIssue | undefined,
    rootPath: string,
    messageIndex: number | undefined,
    registryId: number,
    registryFingerprint: string,
    registryUpdatedAt: Date
  ): PromptRegistryValidationIssue {
    const path = this.formatZodIssuePath(issue, rootPath);
    const code = issue?.code ?? 'invalid';

    return {
      code,
      detail: `${path}:${code}`,
      fieldLabel: this.formatRegistryValidationFieldLabel(path),
      ...(issue?.message ? { message: issue.message } : {}),
      ...(messageIndex !== undefined ? { messageIndex } : {}),
      path,
      publishBlocking: true,
      reason,
      severity: 'error',
      source: this.formatRegistryValidationSource(path),
      sourceLocator: this.resolveRegistryValidationSourceLocator(
        path,
        messageIndex,
        registryId,
        registryFingerprint,
        registryUpdatedAt
      ),
    };
  }

  private toRegistryValidationIssues(
    reason: PromptRegistryValidationReason,
    issues: ZodIssue[],
    rootPath: string,
    messageIndex: number | undefined,
    registryId: number,
    registryFingerprint: string,
    registryUpdatedAt: Date
  ): PromptRegistryValidationIssue[] {
    const zodIssues = issues.length ? issues : [undefined];

    return zodIssues.map(issue =>
      this.toRegistryValidationIssue(
        reason,
        issue,
        rootPath,
        messageIndex,
        registryId,
        registryFingerprint,
        registryUpdatedAt
      )
    );
  }

  private formatZodIssuePath(issue: ZodIssue | undefined, rootPath: string) {
    if (!issue) {
      return rootPath;
    }

    return [rootPath, ...issue.path.map(segment => segment.toString())].join(
      '.'
    );
  }

  private formatRegistryValidationFieldLabel(path: string) {
    const label = path
      .replace(/^config\.?/, '')
      .replace(/^message\[(\d+)\]\.?/, 'Message $1 ')
      .replace(/\./g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();

    return label
      ? label.replace(/\b\w/g, character => character.toUpperCase())
      : path;
  }

  private formatRegistryValidationSource(path: string) {
    if (path === 'messages') {
      return 'ai_prompts_messages';
    }

    if (path.startsWith('message[')) {
      return path.replace(/^message\[/, 'ai_prompts_messages[');
    }

    if (path === 'config' || path.startsWith('config.')) {
      return `ai_prompts_metadata.${path}`;
    }

    return `ai_prompts_metadata.${path}`;
  }

  private resolveRegistryValidationSourceLocator(
    path: string,
    messageIndex: number | undefined,
    registryId: number,
    registryFingerprint: string,
    registryUpdatedAt: Date
  ): PromptRegistryValidationIssue['sourceLocator'] {
    const registryUpdatedAtIso = registryUpdatedAt.toISOString();

    if (path === 'messages') {
      return {
        field: 'messages',
        path,
        registryFingerprint,
        registryId,
        registryUpdatedAt: registryUpdatedAtIso,
        table: 'ai_prompts_messages',
      };
    }

    if (path.startsWith('messages.')) {
      return {
        field: path.replace(/^messages\.?/, '') || 'messages',
        path,
        registryFingerprint,
        registryId,
        registryUpdatedAt: registryUpdatedAtIso,
        table: 'ai_prompts_messages',
      };
    }

    if (path.startsWith('message[')) {
      const field = path.replace(/^message\[\d+\]\.?/, '') || 'message';

      return {
        field,
        ...(messageIndex !== undefined ? { messageIndex } : {}),
        path,
        registryFingerprint,
        registryId,
        registryUpdatedAt: registryUpdatedAtIso,
        table: 'ai_prompts_messages',
      };
    }

    if (path === 'config' || path.startsWith('config.')) {
      return {
        field: path.replace(/^config\.?/, '') || 'config',
        path,
        registryFingerprint,
        registryId,
        registryUpdatedAt: registryUpdatedAtIso,
        table: 'ai_prompts_metadata',
      };
    }

    return {
      field: path,
      path,
      registryFingerprint,
      registryId,
      registryUpdatedAt: registryUpdatedAtIso,
      table: 'ai_prompts_metadata',
    };
  }

  private buildRegistryFingerprint(row: PromptRegistryRecord) {
    return createHash('sha256')
      .update(
        this.stableStringify({
          action: row.action ?? null,
          config: row.config ?? null,
          id: row.id,
          messages: row.messages.map(message => ({
            attachments: message.attachments ?? null,
            content: message.content ?? null,
            idx: message.idx,
            params: message.params ?? null,
            role: message.role,
          })),
          model: row.model,
          modified: row.modified,
          name: row.name,
          optionalModels: row.optionalModels,
          updatedAt: row.updatedAt.toISOString(),
        })
      )
      .digest('hex')
      .slice(0, 16);
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map(item => this.stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, item]) =>
            `${JSON.stringify(key)}:${this.stableStringify(item)}`
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private countRegistryValidationErrors(
    issues: PromptRegistryValidationIssue[]
  ) {
    return issues.filter(issue => issue.severity === 'error').length;
  }

  private countRegistryValidationBlocking(
    issues: PromptRegistryValidationIssue[]
  ) {
    return issues.filter(issue => issue.publishBlocking).length;
  }

  private resolveRegistryValidationPublishStatus(
    issues: PromptRegistryValidationIssue[]
  ) {
    return this.countRegistryValidationBlocking(issues) > 0
      ? 'blocked'
      : 'allowed';
  }

  private resolveRegistryPublishGateStaleReasons(input: {
    expectedVersion: PromptRegistryPublishGateExpectedVersion;
    registryFingerprint: string;
    registryId: number;
    registryUpdatedAt: string;
  }) {
    const reasons: string[] = [];
    const { expectedVersion } = input;

    if (
      expectedVersion.registryId !== undefined &&
      expectedVersion.registryId !== input.registryId
    ) {
      reasons.push('registry_id_mismatch');
    }
    if (
      expectedVersion.registryUpdatedAt !== undefined &&
      expectedVersion.registryUpdatedAt !== input.registryUpdatedAt
    ) {
      reasons.push('registry_updated_at_mismatch');
    }
    if (
      expectedVersion.registryFingerprint !== undefined &&
      expectedVersion.registryFingerprint !== input.registryFingerprint
    ) {
      reasons.push('registry_fingerprint_mismatch');
    }

    return reasons;
  }

  private resolveRegistryPublishGateRejectionCode(
    verdict: PromptRegistryPublishGateVerdict
  ): PromptRegistryPublishGateRejectionCode {
    if (verdict.stale) {
      return 'prompt_registry_version_stale';
    }

    return 'prompt_registry_validation_blocked';
  }
}
