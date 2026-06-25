import type {
  PromptConfig,
  PromptMessage,
  PromptParams,
} from '../providers/types';
import type {
  RegistryRevisionPublishEventHistory,
  RegistryRevisionPublishEventRecord,
} from '../../../models/copilot-registry-revision-publish-event';

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

export type PromptRegistryRecordSource =
  | 'db_revision'
  | 'legacy_registry'
  | 'config_fallback';

export type PromptRegistrySourceChainEntry = {
  source: string;
  scope: string;
  status: string;
  actorId?: string;
  configPath?: string;
  fingerprint?: string;
  registryId?: number;
  revision?: string;
  updatedAt?: string;
  workspaceId?: string;
};

export type PromptRegistryRevision = {
  id: string;
  promptName: string;
  scopeType: 'global' | 'workspace';
  workspaceId?: string;
  actorId?: string;
  revision: string;
  status: 'active' | 'archived' | 'disabled';
  fingerprint: string;
  fallbackSourceChain: PromptRegistrySourceChainEntry[];
  createdAt: Date;
  updatedAt: Date;
};

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
  registryRecordSource?: PromptRegistryRecordSource;
  registryRevision?: string;
  registryRevisionActorId?: string;
  registryRevisionFingerprint?: string;
  registryRevisionId?: string;
  registryRevisionPublishEventCount?: number;
  registryRevisionPublishEvents?: RegistryRevisionPublishEventRecord[];
  registryRevisionScope?: PromptRegistryRevision['scopeType'];
  registryRevisionStatus?: PromptRegistryRevision['status'];
  registryRevisionWorkspaceId?: string;
  registrySourceChain?: PromptRegistrySourceChainEntry[];
  registrySourceChainFingerprint?: string;
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

export type PromptRegistryRevisionWithPublishEvents =
  PromptRegistryRevision & RegistryRevisionPublishEventHistory;

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
  registryRecordSource?: PromptRegistryRecordSource;
  registryRevision?: string;
  registryRevisionActorId?: string;
  registryRevisionFingerprint?: string;
  registryRevisionId?: string;
  registryRevisionPublishEventCount?: number;
  registryRevisionPublishEvents?: RegistryRevisionPublishEventRecord[];
  registryRevisionScope?: PromptRegistryRevision['scopeType'];
  registryRevisionStatus?: PromptRegistryRevision['status'];
  registryRevisionWorkspaceId?: string;
  registrySourceChain?: PromptRegistrySourceChainEntry[];
  registrySourceChainFingerprint?: string;
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
