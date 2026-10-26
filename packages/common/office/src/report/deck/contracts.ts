import { z } from 'zod';

import type { DeckQuality, DeckSubphase } from './design';

/**
 * Wire contracts shared by the server (`core/report-deck`) and the web client
 * (`modules/report-decks`). GraphQL transports these as JSON objects.
 */

const id = z.string().trim().min(1).max(256);

export const DECK_SOURCE_LIMIT = 200;

export const DeckScopeKindSchema = z.enum(['workspace', 'project']);
export type DeckScopeKind = z.infer<typeof DeckScopeKindSchema>;

export const DeckScopeSchema = z
  .object({ scopeKind: DeckScopeKindSchema, scopeId: id })
  .strict();
export type DeckScope = z.infer<typeof DeckScopeSchema>;

/**
 * - workspace: `doc` (page), `file` (native file), `folder` (native folder)
 * - project: `project_all` (no resourceId), `doc`/`file` (project resource),
 *   `folder` (project folder resource)
 */
export const DeckSourceRefSchema = z
  .object({
    scopeKind: DeckScopeKindSchema,
    scopeId: id,
    kind: z.enum(['project_all', 'doc', 'file', 'folder']),
    resourceId: id.optional(),
    title: z.string().max(512).optional(),
  })
  .strict()
  .superRefine((source, ctx) => {
    if (source.kind === 'project_all') {
      if (source.scopeKind !== 'project')
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'project_all requires a project scope',
        });
      if (source.resourceId)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'project_all has no resourceId',
        });
    } else if (!source.resourceId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'resourceId is required',
      });
  });
export type DeckSourceRef = z.infer<typeof DeckSourceRefSchema>;

export const DeckSourceStatusSchema = z.enum([
  'pending',
  'included',
  'excluded',
  'truncated',
]);
export const DeckSourceReasonSchema = z.enum([
  'no_permission',
  'not_found',
  'empty',
  'unsupported',
  'over_budget',
  'duplicate',
]);
export type DeckSourceReason = z.infer<typeof DeckSourceReasonSchema>;

export const DeckModeSchema = z.enum(['template', 'custom']);
export type DeckMode = z.infer<typeof DeckModeSchema>;

export const DeckAiChoiceSchema = z
  .object({
    scopeKind: DeckScopeKindSchema,
    scopeId: id,
    modelId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
export type DeckAiChoice = z.infer<typeof DeckAiChoiceSchema>;

export const DeckDesignModeSchema = z.enum(['fast', 'refine']);
export type DeckDesignMode = z.infer<typeof DeckDesignModeSchema>;

export const DeckConfigSchema = z
  .object({
    mode: DeckModeSchema,
    designMode: DeckDesignModeSchema.optional(),
    templateKey: z.string().trim().min(1).max(64).optional(),
    customStyle: z.string().max(500).optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    purpose: z
      .enum([
        'periodic',
        'progress',
        'customer',
        'decision',
        'retrospective',
        'training',
        'other',
      ])
      .default('progress'),
    audience: z
      .enum(['team', 'management', 'customer', 'public'])
      .default('team'),
    length: z.enum(['short', 'standard', 'long']).default('standard'),
    language: z.enum(['zh-CN', 'en']).default('zh-CN'),
    tone: z.enum(['formal', 'concise', 'vivid']).default('formal'),
    preferences: z
      .object({
        charts: z.boolean().default(true),
        citations: z.boolean().default(false),
        conclusionFirst: z.boolean().default(true),
      })
      .strict()
      .default({}),
    instructions: z.string().max(2000).default(''),
    title: z.string().trim().max(120).optional(),
    ai: DeckAiChoiceSchema.optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.mode !== 'custom' && config.designMode !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['designMode'],
        message: 'Design mode is only available for custom reports',
      });
    if (config.mode === 'template' && !config.templateKey)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateKey'],
        message: 'Template mode requires a template',
      });
  });
export type DeckConfig = z.infer<typeof DeckConfigSchema>;
export type DeckConfigInput = z.input<typeof DeckConfigSchema>;

/** Chapter budget by content depth; historical wire field names remain stable. */
export const DECK_LENGTH_SLIDES: Record<
  DeckConfig['length'],
  [min: number, max: number]
> = {
  short: [3, 6],
  standard: [5, 9],
  long: [8, 14],
};

export const DeckStatusSchema = z.enum([
  'queued',
  'generating',
  'ready',
  'failed',
  'cancelled',
]);
export type DeckStatus = z.infer<typeof DeckStatusSchema>;

export const DeckErrorCodeSchema = z.enum([
  'no_sources',
  'provider_unavailable',
  'model_invalid_output',
  'budget_exceeded',
  'timeout',
  'cancelled',
  'internal',
  'render_failed',
  'quality_failed',
]);
export type DeckErrorCode = z.infer<typeof DeckErrorCodeSchema>;

export const DeckPhaseSchema = z.enum([
  'queued',
  'sources',
  'extract',
  'compose',
  'render',
  'done',
]);
export type DeckPhase = z.infer<typeof DeckPhaseSchema>;

export type DeckProgress = {
  phase: DeckPhase;
  done: number;
  total: number;
  subphase?: DeckSubphase;
};

export type DeckSourceView = {
  scopeKind: DeckScopeKind;
  scopeId: string;
  scopeLabel: string;
  kind: DeckSourceRef['kind'];
  resourceId: string | null;
  title: string;
  status: z.infer<typeof DeckSourceStatusSchema>;
  reason: DeckSourceReason | null;
  chars: number | null;
};

export type DeckShareView = {
  id: string;
  url: string | null;
  hasPassword: boolean;
  allowDownload: boolean;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type DeckSummary = {
  id: string;
  title: string;
  status: DeckStatus;
  mode: DeckMode;
  /** Absent on historical reports without a recorded selection. */
  designMode?: DeckDesignMode;
  templateKey: string | null;
  slideCount: number | null;
  sourceCount: number;
  excludedCount: number;
  progress: DeckProgress;
  errorCode: DeckErrorCode | null;
  createdAt: string;
  completedAt: string | null;
};

export type DeckDetail = DeckSummary & {
  quality?: DeckQuality | null;
  config: DeckConfig;
  ai: { scopeKind: DeckScopeKind; scopeId: string; scopeLabel: string };
  modelId: string | null;
  htmlBytes: number | null;
  sources: DeckSourceView[];
  shares: DeckShareView[];
};

export type DeckListResult = {
  items: DeckSummary[];
  nextCursor: string | null;
};

export type DeckAiOption = {
  scopeKind: DeckScopeKind;
  scopeId: string;
  label: string;
  /** Whether the scope appears in the source list (shown in the first group). */
  fromSources: boolean;
  available: boolean;
  reason:
    | 'no_permission'
    | 'not_configured'
    | 'local_keys_only'
    | 'blocked_by_policy'
    | null;
  providerName: string | null;
  models: { id: string; name: string; vision?: 'declared' | 'unknown' }[];
  defaultModelId: string | null;
  /** Project AI is one instance-wide configuration; the model cannot change. */
  modelLocked: boolean;
};

export type DeckAiOptionsResult = {
  options: DeckAiOption[];
  /** The scope used when the user does not choose: the first source's scope, or the next available one. */
  defaultChoice: DeckAiChoice | null;
  /** Set when the default had to move past the first source's scope. */
  defaultFallbackFrom: DeckScope | null;
};

export type DeckPreflightResult = {
  sources: DeckSourceView[];
  totalChars: number;
  includedCount: number;
  excludedCount: number;
  estimatedMinutes: number;
};

export const DeckPreflightInputSchema = z
  .object({
    sources: z.array(DeckSourceRefSchema).min(1).max(DECK_SOURCE_LIMIT),
  })
  .strict();

export const DeckAiOptionsInputSchema = z
  .object({
    sources: z.array(DeckSourceRefSchema).max(DECK_SOURCE_LIMIT),
  })
  .strict();

export const DeckCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('create'),
      requestKey: z.string().min(8).max(128),
      sources: z.array(DeckSourceRefSchema).min(1).max(DECK_SOURCE_LIMIT),
      config: DeckConfigSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('regenerate'),
      requestKey: z.string().min(8).max(128),
      deckId: id,
    })
    .strict(),
  z.object({ operation: z.literal('retry'), deckId: id }).strict(),
  z.object({ operation: z.literal('cancel'), deckId: id }).strict(),
  z.object({ operation: z.literal('delete'), deckId: id }).strict(),
  z
    .object({
      operation: z.literal('share.create'),
      deckId: id,
      expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
      password: z.string().min(4).max(128).optional(),
      allowDownload: z.boolean().default(false),
    })
    .strict(),
  z.object({ operation: z.literal('share.revoke'), shareId: id }).strict(),
]);
export type DeckCommand = z.infer<typeof DeckCommandSchema>;
export type DeckCommandInput = z.input<typeof DeckCommandSchema>;

export type DeckCommandResult =
  | { deck: DeckDetail }
  | { share: DeckShareView; deck: DeckDetail }
  | { deleted: true };

/** Realtime event name published to the owner's user room. */
export const DECK_REALTIME_EVENT = 'report.deck.changed';
