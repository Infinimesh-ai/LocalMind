import type {
  PromptConfig,
  PromptMessage,
  PromptParams,
} from '../providers/types';

export type Prompt = {
  name: string;
  model: string;
  optionalModels?: string[];
  action?: string;
  messages: PromptMessage[];
  config?: PromptConfig;
  source?: 'compat' | 'registry';
  registryFingerprint?: string;
  registryId?: number;
  registryMessageCount?: number;
  registryModified?: boolean;
  registryUpdatedAt?: Date;
  registryValidationBlockingCount?: number;
  registryValidationDetail?: string;
  registryValidationErrorCount?: number;
  registryValidationIssueCount?: number;
  registryValidationIssues?: PromptRegistryValidationIssue[];
  registryValidationPublishStatus?: PromptRegistryValidationPublishStatus;
  registryValidationRemediations?: PromptRegistryValidationRemediation[];
  registryValidationReason?: PromptRegistryValidationReason;
  registryValidationStatus?: PromptRegistryValidationStatus;
};

export type PromptRegistryValidationStatus = 'ready' | 'ignored';

export type PromptRegistryValidationPublishStatus = 'allowed' | 'blocked';

export type PromptRegistryValidationReason =
  | 'ready'
  | 'missing_messages'
  | 'invalid_config'
  | 'invalid_message'
  | 'missing_template_param'
  | 'model_route_unavailable';

export type PromptRegistryValidationIssue = {
  code: string;
  detail: string;
  fieldLabel: string;
  message?: string;
  messageIndex?: number;
  path: string;
  publishBlocking: boolean;
  reason: PromptRegistryValidationReason;
  severity: PromptRegistryValidationIssueSeverity;
  source: string;
  sourceLocator: PromptRegistryValidationSourceLocator;
};

export type PromptRegistryValidationIssueSeverity =
  | 'error'
  | 'warning'
  | 'info';

export type PromptRegistryValidationSourceLocator = {
  field: string;
  messageIndex?: number;
  path: string;
  registryFingerprint: string;
  registryId: number;
  registryUpdatedAt: string;
  table: 'ai_prompts_metadata' | 'ai_prompts_messages';
};

export type PromptRegistryValidationRemediationKind =
  | 'add_messages'
  | 'configure_model_route'
  | 'declare_template_param'
  | 'fix_config'
  | 'fix_message';

export type PromptRegistryValidationRemediation = {
  detail: string;
  kind: PromptRegistryValidationRemediationKind;
  label: string;
  target: string;
  targetLocator: PromptRegistryValidationSourceLocator;
};

export type PromptRegistryDiagnostic = {
  name: string;
  model: string;
  optionalModels: string[];
  action?: string;
  source: 'registry';
  registryFingerprint: string;
  registryId: number;
  registryMessageCount: number;
  registryModified: boolean;
  registryUpdatedAt: Date;
  registryValidationBlockingCount: number;
  registryValidationDetail: string;
  registryValidationErrorCount: number;
  registryValidationIssueCount: number;
  registryValidationIssues: PromptRegistryValidationIssue[];
  registryValidationPublishStatus: PromptRegistryValidationPublishStatus;
  registryValidationRemediations: PromptRegistryValidationRemediation[];
  registryValidationReason: PromptRegistryValidationReason;
  registryValidationStatus: PromptRegistryValidationStatus;
};

export type PromptModelProvenanceSource =
  | 'built_in'
  | 'compat'
  | 'registry'
  | 'default_policy'
  | 'override';

export type ResolvedPrompt = {
  name: string;
  model: string;
  modelConfigPath?: string;
  modelSource: PromptModelProvenanceSource;
  optionalModels: string[];
  optionalModelsConfigPath?: string;
  optionalModelsSource: PromptModelProvenanceSource;
  action?: string;
  config?: PromptConfig;
  proModelsConfigPath?: string;
  proModelsSource: PromptModelProvenanceSource;
  paramKeys: string[];
  params: PromptParams;
  source: 'built_in' | 'compat' | 'registry';
  category: 'image' | 'transcript' | 'text';
  defaultPolicy?: 'image' | 'transcript' | 'structured' | 'text';
  overrideApplied: boolean;
  messages?: PromptMessage[];
  registryFingerprint?: string;
  registryId?: number;
  registryMessageCount?: number;
  registryModified?: boolean;
  registryUpdatedAt?: Date;
  registryValidationBlockingCount?: number;
  registryValidationDetail?: string;
  registryValidationErrorCount?: number;
  registryValidationIssueCount?: number;
  registryValidationIssues?: PromptRegistryValidationIssue[];
  registryValidationPublishStatus?: PromptRegistryValidationPublishStatus;
  registryValidationRemediations?: PromptRegistryValidationRemediation[];
  registryValidationReason?: PromptRegistryValidationReason;
  registryValidationStatus?: PromptRegistryValidationStatus;
};

export type PromptCatalogItem = Omit<
  ResolvedPrompt,
  'config' | 'messages' | 'params'
> & {
  fingerprint: string;
  modelStrategyFingerprint: string;
  optionalModelCount: number;
  paramCount: number;
  proModelCount: number;
  revision: string;
  templateFingerprint: string;
  versionEvidence: PromptCatalogVersionEvidence;
};

export type PromptCatalogVersionEvidence = {
  defaultPolicy?: ResolvedPrompt['defaultPolicy'];
  fingerprint: string;
  modelConfigPath?: string;
  modelStrategyFingerprint: string;
  optionalModelsConfigPath?: string;
  overrideApplied: boolean;
  proModelsConfigPath?: string;
  registryFingerprint?: string;
  registryId?: number;
  registryMessageCount?: number;
  registryModified?: boolean;
  registryUpdatedAt?: Date;
  registryValidationBlockingCount?: number;
  registryValidationDetail?: string;
  registryValidationErrorCount?: number;
  registryValidationIssueCount?: number;
  registryValidationIssues?: PromptRegistryValidationIssue[];
  registryValidationPublishStatus?: PromptRegistryValidationPublishStatus;
  registryValidationRemediations?: PromptRegistryValidationRemediation[];
  registryValidationReason?: PromptRegistryValidationReason;
  registryValidationStatus?: PromptRegistryValidationStatus;
  revision: string;
  templateFingerprint: string;
};

type PromptParamSpec = {
  default?: string;
  enum?: string[];
};

type PromptSpecMessage = {
  role: 'system' | 'assistant' | 'user';
  template: string;
};

export type PromptSpec = {
  name: string;
  action?: string;
  model: string;
  optionalModels?: string[];
  config?: PromptConfig;
  params?: Record<string, PromptParamSpec>;
  messages: PromptSpecMessage[];
};
