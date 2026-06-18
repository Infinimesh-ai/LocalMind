import { Badge } from '@affine/admin/components/ui/badge';
import { Button } from '@affine/admin/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@affine/admin/components/ui/card';
import { Input } from '@affine/admin/components/ui/input';
import { ScrollArea } from '@affine/admin/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@affine/admin/components/ui/select';
import { Skeleton } from '@affine/admin/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@affine/admin/components/ui/table';
import { useMutation } from '@affine/admin/use-mutation';
import { useQuery } from '@affine/admin/use-query';
import { cn } from '@affine/admin/utils';
import {
  type AIModel,
  type AIModelPreparedTaskRoute,
  type AIModelTaskRoute,
  type AIModelTaskRouteCandidateTraceRow,
  type AIModelTaskRouteDiagnosticsSummary,
  type AIModelTaskRoutePhaseTraceRow,
  type AIModelTaskRoutePolicyCandidateTraceRow,
  type AIModelTaskRouteReadinessStatus,
  type AIModelTaskRouteReasonRemediationActionKind,
  type AIModelTaskRouteReasonSeverity,
  buildAIModels,
  formatAIModelCapabilityLabel,
  formatAIModelCostLabel,
  formatAIModelDefinitionLabel,
  formatAIModelDiagnosticsLabel,
  formatAIModelFallbackLabel,
  formatAIModelLimitsLabel,
  formatAIModelPromptSourcesLabel,
  formatAIModelProviderLabel,
  formatAIModelProviderProfileLabel,
  formatAIModelRouteLabel,
  formatAIModelSourcesLabel,
  formatAIModelTaskModelSourceLabel,
  getAIModelPromptDefaultDiagnostics,
  getAIModelTaskRouteRemediationTarget,
  getAIModelTaskRoutesDiagnostics,
} from '@affine/core/modules/ai-button/services/models';
import {
  getCopilotActionRunPreparedRouteTraceQuery,
  getCopilotActionRunsQuery,
  getCopilotPromptRegistryPublishGateQuery,
  getCopilotPromptRegistryRepairPreflightQuery,
  getCopilotPromptsQuery,
  getPromptModelsQuery,
  getWorkspacesQuery,
  type QueryResponse,
  requestCopilotPromptRegistryRepairExecutionMutation,
} from '@affine/graphql';
import { AlertCircleIcon, CheckCircle2Icon, RefreshCwIcon } from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  Suspense,
  useMemo,
  useState,
} from 'react';

import { Header } from '../header';

const ADMIN_AI_DEFAULT_PROMPT_NAME = 'Chat With AFFiNE AI';
const PROMPT_CATALOG_ALL_CATEGORIES = '__all__';
const WORKSPACE_SCOPE_GLOBAL = '__global__';
const WORKSPACE_SCOPE_MANUAL = '__manual__';

type PromptCatalogItem = NonNullable<
  NonNullable<
    QueryResponse<typeof getCopilotPromptsQuery>['currentUser']
  >['copilot']
>['prompts'][number];
type PromptRegistryPublishGateVerdict = NonNullable<
  NonNullable<
    NonNullable<
      QueryResponse<
        typeof getCopilotPromptRegistryPublishGateQuery
      >['currentUser']
    >['copilot']
  >['promptRegistryPublishGate']
>;
type PromptRegistryPublishGateModelRoute =
  PromptRegistryPublishGateVerdict['modelRoutes'][number];
type PromptRegistryPublishGateRouteCandidate =
  PromptRegistryPublishGateModelRoute['routeCandidates'][number];
type PromptRegistryPublishGatePolicyCandidate =
  PromptRegistryPublishGateModelRoute['policyCandidates'][number];
type PromptRegistryPublishGateRouteTracePhase =
  PromptRegistryPublishGateModelRoute['routeTrace'][number];
type PromptRegistryPublishGateTaskRoute =
  PromptRegistryPublishGateVerdict['taskRoutes'][number];
type PromptRegistryRepairPreflight = NonNullable<
  NonNullable<
    NonNullable<
      QueryResponse<
        typeof getCopilotPromptRegistryRepairPreflightQuery
      >['currentUser']
    >['copilot']
  >['promptRegistryRepairPreflight']
>;
type PromptRegistryRepairExecutionRequest = NonNullable<
  QueryResponse<
    typeof requestCopilotPromptRegistryRepairExecutionMutation
  >['requestCopilotPromptRegistryRepairExecution']
>;
type PromptRegistryPublishGateActionRouteDryRun = NonNullable<
  PromptRegistryPublishGateVerdict['actionRouteDryRun']
>;
type PromptRegistryPublishGateExpectedVersion = {
  registryFingerprint?: string;
  registryId?: number;
  registryUpdatedAt?: string;
};
type PromptRegistryRepairSubmissionContract =
  PromptRegistryPublishGateVerdict['repairActionPreview']['submissionContract'];
type PromptRegistryValidationSourceLocatorLike = {
  field: string;
  messageIndex?: number | null;
  path: string;
  registryFingerprint: string;
  registryId: number;
  registryUpdatedAt: string;
  table: string;
};
type PromptRegistryValidationIssueLike = {
  code: string;
  detail: string;
  fieldLabel: string;
  message?: string | null;
  messageIndex?: number | null;
  path: string;
  publishBlocking: boolean;
  reason: string;
  severity: string;
  source: string;
  sourceLocator: PromptRegistryValidationSourceLocatorLike;
};
type PromptRegistryValidationRemediationLike = {
  detail: string;
  kind: string;
  label: string;
  target: string;
  targetLocator: PromptRegistryValidationSourceLocatorLike;
};
type PromptRegistryPublishGateRepairTargetLocatorLike = NonNullable<
  PromptRegistryPublishGateVerdict['repairRecommendations'][number]['targetLocator']
>;
type WorkspaceScopeItem = QueryResponse<
  typeof getWorkspacesQuery
>['workspaces'][number];
type ActionRunPreparedRouteTrace = NonNullable<
  NonNullable<
    NonNullable<
      QueryResponse<
        typeof getCopilotActionRunPreparedRouteTraceQuery
      >['currentUser']
    >['copilot']
  >['actionRunPreparedRouteTrace']
>;
type ActionRunDiagnosticsItem = NonNullable<
  NonNullable<
    QueryResponse<typeof getCopilotActionRunsQuery>['currentUser']
  >['copilot']
>['actionRuns'][number];

const EMPTY_PROMPT_CATALOG: PromptCatalogItem[] = [];
const EMPTY_WORKSPACE_SCOPES: WorkspaceScopeItem[] = [];
const EMPTY_ACTION_RUNS: ActionRunDiagnosticsItem[] = [];

const STATUS_LABELS: Record<AIModelTaskRouteReadinessStatus, string> = {
  blocked: 'Blocked',
  ready: 'Ready',
  unconfigured: 'Unconfigured',
  warning: 'Warning',
};

const FEATURE_LABELS: Record<string, string> = {
  rerank: 'Rerank',
  unknown: 'Unknown',
  workspace_indexing: 'Workspace indexing',
};

const STATUS_STYLES: Record<AIModelTaskRouteReadinessStatus, string> = {
  blocked: 'border-destructive/30 bg-destructive/10 text-destructive',
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  unconfigured: 'border-border bg-muted text-muted-foreground',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
};

const SEVERITY_STYLES: Record<AIModelTaskRouteReasonSeverity, string> = {
  error: 'text-destructive',
  info: 'text-muted-foreground',
  warning: 'text-amber-700',
};

const POLICY_CANDIDATE_STATUS_STYLES = {
  allowed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  blocked: 'border-destructive/30 bg-destructive/10 text-destructive',
  unavailable: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
} satisfies Record<string, string>;

const PROVIDER_PRIVACY_LABELS: Record<string, string> = {
  cloud: 'Cloud',
  local: 'Local',
  private_cloud: 'Private cloud',
};

const PROVIDER_HEALTH_LABELS: Record<string, string> = {
  degraded: 'Degraded',
  down: 'Down',
  healthy: 'Healthy',
  unknown: 'Unknown',
};

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  anthropicVertex: 'Anthropic Vertex',
  cloudflareWorkersAi: 'Cloudflare Workers AI',
  fal: 'FAL',
  gemini: 'Gemini',
  geminiVertex: 'Gemini Vertex',
  openai: 'OpenAI',
  openaiCompatible: 'OpenAI-compatible',
};

const PROVIDER_SOURCE_LABELS: Record<string, string> = {
  byok_local: 'BYOK local',
  byok_server: 'BYOK server',
  configured: 'Configured',
  legacy: 'Legacy config',
};

function formatFeatureKind(featureKind: string) {
  return (
    FEATURE_LABELS[featureKind] ??
    featureKind
      .split('_')
      .filter(Boolean)
      .map(part => part[0].toUpperCase() + part.slice(1))
      .join(' ')
  );
}

function formatProviderMetadata(value: string, labels: Record<string, string>) {
  return labels[value] ?? formatFeatureKind(value);
}

function formatProviderIdentity(
  row:
    | AIModelTaskRoutePolicyCandidateTraceRow
    | AIModelTaskRouteCandidateTraceRow
    | PromptRegistryPublishGatePolicyCandidate
    | PromptRegistryPublishGateRouteCandidate
) {
  return row.providerName && row.providerName !== row.providerId
    ? `${row.providerName} / ${row.providerId}`
    : row.providerId;
}

function formatActionKind(kind: AIModelTaskRouteReasonRemediationActionKind) {
  return kind
    .split('_')
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function compactList(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).join(' / ');
}

function buildPromptCatalogVersionEvidence(prompt: PromptCatalogItem) {
  const evidence = prompt.versionEvidence;

  return compactList([
    `revision ${evidence.revision}`,
    `fingerprint ${evidence.fingerprint}`,
    `model ${evidence.modelStrategyFingerprint}`,
    `template ${evidence.templateFingerprint}`,
    evidence.defaultPolicy
      ? `policy ${formatFeatureKind(evidence.defaultPolicy)}`
      : 'policy none',
    evidence.overrideApplied ? 'override yes' : 'override no',
    evidence.modelConfigPath
      ? `model config ${evidence.modelConfigPath}`
      : null,
    evidence.optionalModelsConfigPath
      ? `optional config ${evidence.optionalModelsConfigPath}`
      : null,
    evidence.proModelsConfigPath
      ? `pro config ${evidence.proModelsConfigPath}`
      : null,
    evidence.registryFingerprint
      ? `registry fingerprint ${evidence.registryFingerprint}`
      : null,
    evidence.registryId != null ? `registry id ${evidence.registryId}` : null,
    evidence.registryMessageCount != null
      ? `registry messages ${evidence.registryMessageCount}`
      : null,
    evidence.registryModified != null
      ? `registry modified ${evidence.registryModified ? 'yes' : 'no'}`
      : null,
    evidence.registryUpdatedAt
      ? `registry updated ${evidence.registryUpdatedAt}`
      : null,
    evidence.registryValidationStatus
      ? `registry status ${formatFeatureKind(evidence.registryValidationStatus)}`
      : null,
    evidence.registryValidationReason
      ? `registry reason ${formatFeatureKind(evidence.registryValidationReason)}`
      : null,
    evidence.registryValidationDetail
      ? `registry detail ${evidence.registryValidationDetail}`
      : null,
    evidence.registryValidationPublishStatus
      ? `registry publish ${formatFeatureKind(evidence.registryValidationPublishStatus)}`
      : null,
    evidence.registryValidationBlockingCount != null
      ? `registry blocking ${evidence.registryValidationBlockingCount}`
      : null,
    evidence.registryValidationIssueCount != null
      ? `registry issues ${evidence.registryValidationIssueCount}`
      : null,
    evidence.registryValidationErrorCount != null
      ? `registry errors ${evidence.registryValidationErrorCount}`
      : null,
    ...(evidence.registryValidationIssues ?? []).map(
      issue => `registry issue ${formatPromptRegistryValidationIssue(issue)}`
    ),
    ...(evidence.registryValidationRemediations ?? []).map(
      remediation =>
        `registry remediation ${formatPromptRegistryValidationRemediation(remediation)}`
    ),
  ]);
}

function buildPromptRegistryPublishGateExpectedVersion(
  prompt: PromptCatalogItem
): PromptRegistryPublishGateExpectedVersion | undefined {
  const registryFingerprint =
    prompt.versionEvidence.registryFingerprint ??
    prompt.registryFingerprint ??
    prompt.registryValidationIssues?.[0]?.sourceLocator.registryFingerprint ??
    prompt.registryValidationRemediations?.[0]?.targetLocator
      .registryFingerprint;

  if (prompt.registryId == null || !prompt.registryUpdatedAt) {
    return undefined;
  }

  return {
    ...(registryFingerprint ? { registryFingerprint } : {}),
    registryId: prompt.registryId,
    registryUpdatedAt: prompt.registryUpdatedAt,
  };
}

function buildPromptRegistryRepairSubmissionInput(
  submissionContract: PromptRegistryRepairSubmissionContract
) {
  return {
    approvalPolicyFingerprint: submissionContract.approvalPolicyFingerprint,
    authorizationFingerprint: submissionContract.authorizationFingerprint,
    candidateEvidenceSetFingerprint:
      submissionContract.candidateEvidenceSetFingerprint,
    preparedRouteOrderEvidenceSetFingerprint:
      submissionContract.preparedRouteOrderEvidenceSetFingerprint,
    catalogFingerprint: submissionContract.catalogFingerprint,
    contractVersion: submissionContract.contractVersion,
    expectedRegistryFingerprint: submissionContract.expectedRegistryFingerprint,
    expectedRegistryId: submissionContract.expectedRegistryId,
    expectedRegistryUpdatedAt: submissionContract.expectedRegistryUpdatedAt,
    guardFingerprint: submissionContract.guardFingerprint,
    idempotencyKey: submissionContract.idempotencyKey,
    operationSetFingerprint: submissionContract.operationSetFingerprint,
    previewFingerprint: submissionContract.previewFingerprint,
    requiredInputs: submissionContract.requiredInputs,
    submissionFingerprint: submissionContract.submissionFingerprint,
    targetLocatorFingerprint: submissionContract.targetLocatorFingerprint,
  };
}

function buildPromptRegistryRepairExecutionRequestInput({
  expectedVersion,
  promptName,
  repairPreflight,
  submissionContract,
  workspaceId,
}: {
  expectedVersion: PromptRegistryPublishGateExpectedVersion | undefined;
  promptName: string;
  repairPreflight: PromptRegistryRepairPreflight;
  submissionContract: PromptRegistryRepairSubmissionContract;
  workspaceId: string | undefined;
}) {
  return {
    expectedApprovalRecordFingerprint:
      repairPreflight.approvalRecordFingerprint,
    expectedApprovalRequestFingerprint:
      repairPreflight.approvalRequestFingerprint,
    expectedAuditEventFingerprint: repairPreflight.auditEventFingerprint,
    expectedCandidateEvidenceSetFingerprint:
      repairPreflight.candidateEvidenceSetFingerprint,
    expectedPreparedRouteOrderEvidenceSetFingerprint:
      repairPreflight.preparedRouteOrderEvidenceSetFingerprint,
    expectedTargetLocatorFingerprint: repairPreflight.targetLocatorFingerprint,
    expectedExecutionGateFingerprint: repairPreflight.executionGateFingerprint,
    expectedExecutionGateStatus: repairPreflight.executionGateStatus,
    expectedExecutionStateFingerprint:
      repairPreflight.executionStateFingerprint,
    expectedIdempotencyFingerprint: repairPreflight.idempotencyFingerprint,
    expectedPolicyBindingFingerprint: repairPreflight.policyBindingFingerprint,
    expectedPreflightStatus: repairPreflight.status,
    expectedRepairJobFingerprint: repairPreflight.repairJobFingerprint,
    expectedReviewBindingFingerprint: repairPreflight.reviewBindingFingerprint,
    expectedRollbackPlanFingerprint: repairPreflight.rollbackPlanFingerprint,
    expectedVersion,
    name: promptName,
    submission: buildPromptRegistryRepairSubmissionInput(submissionContract),
    workspaceId: workspaceId ?? '',
  };
}

function formatPromptRegistryValidationIssue(
  issue: PromptRegistryValidationIssueLike
) {
  return compactList([
    issue.severity,
    issue.reason,
    issue.fieldLabel,
    issue.path,
    issue.code,
    issue.source,
    formatPromptRegistryValidationSourceLocator(issue.sourceLocator),
    issue.messageIndex != null ? `message ${issue.messageIndex}` : null,
    issue.publishBlocking ? 'blocking yes' : 'blocking no',
    issue.detail,
  ]);
}

function formatPromptRegistryValidationSourceLocator(
  locator: PromptRegistryValidationSourceLocatorLike
) {
  return compactList([
    `registry ${locator.registryId}`,
    `fingerprint ${locator.registryFingerprint}`,
    `updated ${locator.registryUpdatedAt}`,
    locator.table,
    locator.field,
    locator.path,
  ]);
}

function formatPromptRegistryValidationRemediation(
  remediation: PromptRegistryValidationRemediationLike
) {
  return compactList([
    remediation.kind,
    remediation.label,
    remediation.target,
    formatPromptRegistryValidationSourceLocator(remediation.targetLocator),
    remediation.detail,
  ]);
}

function matchesPromptCatalogSearch(prompt: PromptCatalogItem, search: string) {
  if (!search) {
    return true;
  }

  return [
    prompt.action,
    prompt.category,
    prompt.defaultPolicy,
    prompt.fingerprint,
    buildPromptCatalogVersionEvidence(prompt),
    prompt.model,
    prompt.modelConfigPath,
    prompt.modelSource,
    prompt.modelStrategyFingerprint,
    prompt.name,
    prompt.optionalModelsConfigPath,
    prompt.optionalModelsSource,
    prompt.proModelsConfigPath,
    prompt.proModelsSource,
    prompt.registryFingerprint,
    prompt.registryFingerprint
      ? `registry fingerprint ${prompt.registryFingerprint}`
      : null,
    prompt.versionEvidence.registryFingerprint,
    prompt.versionEvidence.registryFingerprint
      ? `registry fingerprint ${prompt.versionEvidence.registryFingerprint}`
      : null,
    prompt.registryId?.toString(),
    prompt.registryMessageCount?.toString(),
    prompt.registryModified == null
      ? null
      : prompt.registryModified
        ? 'registry modified yes'
        : 'registry modified no',
    prompt.registryUpdatedAt,
    prompt.registryValidationDetail,
    prompt.registryValidationPublishStatus,
    prompt.registryValidationPublishStatus
      ? `registry publish ${formatFeatureKind(prompt.registryValidationPublishStatus)}`
      : null,
    prompt.registryValidationBlockingCount?.toString(),
    prompt.registryValidationBlockingCount != null
      ? `registry blocking ${prompt.registryValidationBlockingCount}`
      : null,
    prompt.registryValidationIssueCount?.toString(),
    prompt.registryValidationIssueCount != null
      ? `registry issues ${prompt.registryValidationIssueCount}`
      : null,
    prompt.registryValidationErrorCount?.toString(),
    prompt.registryValidationErrorCount != null
      ? `registry errors ${prompt.registryValidationErrorCount}`
      : null,
    ...(prompt.registryValidationIssues ?? []).flatMap(issue => [
      issue.path,
      issue.fieldLabel,
      issue.code,
      issue.message ?? null,
      issue.messageIndex?.toString(),
      issue.publishBlocking ? 'blocking yes' : 'blocking no',
      issue.reason,
      issue.severity,
      issue.source,
      issue.sourceLocator.table,
      issue.sourceLocator.field,
      issue.sourceLocator.path,
      issue.sourceLocator.registryId.toString(),
      `registry ${issue.sourceLocator.registryId}`,
      issue.sourceLocator.registryFingerprint,
      `fingerprint ${issue.sourceLocator.registryFingerprint}`,
      issue.sourceLocator.registryUpdatedAt,
      `updated ${issue.sourceLocator.registryUpdatedAt}`,
      issue.sourceLocator.messageIndex?.toString(),
      formatPromptRegistryValidationSourceLocator(issue.sourceLocator),
      issue.detail,
      formatPromptRegistryValidationIssue(issue),
    ]),
    ...(prompt.registryValidationRemediations ?? []).flatMap(remediation => [
      remediation.kind,
      remediation.label,
      remediation.target,
      remediation.targetLocator.table,
      remediation.targetLocator.field,
      remediation.targetLocator.path,
      remediation.targetLocator.registryId.toString(),
      `registry ${remediation.targetLocator.registryId}`,
      remediation.targetLocator.registryFingerprint,
      `fingerprint ${remediation.targetLocator.registryFingerprint}`,
      remediation.targetLocator.registryUpdatedAt,
      `updated ${remediation.targetLocator.registryUpdatedAt}`,
      remediation.targetLocator.messageIndex?.toString(),
      formatPromptRegistryValidationSourceLocator(remediation.targetLocator),
      remediation.detail,
      formatPromptRegistryValidationRemediation(remediation),
    ]),
    prompt.registryValidationReason,
    prompt.registryValidationStatus,
    prompt.revision,
    prompt.source,
    prompt.templateFingerprint,
    ...prompt.optionalModels,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase()
    .includes(search);
}

function formatWorkspaceScopeLabel(workspace: WorkspaceScopeItem) {
  return compactList([
    workspace.id,
    workspace.team ? 'Team' : 'Personal',
    workspace.initialized ? 'Initialized' : 'Not initialized',
    workspace.enableAi ? 'AI enabled' : 'AI disabled',
    workspace.enableDocEmbedding ? 'Embedding enabled' : 'Embedding disabled',
  ]);
}

function usePromptCatalogData(workspaceId: string | undefined) {
  const { data } = useQuery({
    query: getCopilotPromptsQuery,
    variables: {
      workspaceId,
    },
  });
  return data;
}

function useWorkspaceScopeData() {
  const { data } = useQuery({
    query: getWorkspacesQuery,
  });
  return data;
}

function StatusBadge({ status }: { status: AIModelTaskRouteReadinessStatus }) {
  return (
    <Badge
      className={cn('border text-xs', STATUS_STYLES[status])}
      variant="outline"
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function SeverityText({
  severity,
  children,
}: {
  severity: AIModelTaskRouteReasonSeverity;
  children: ReactNode;
}) {
  return <span className={cn(SEVERITY_STYLES[severity])}>{children}</span>;
}

function RecommendedChecks({
  actions,
}: {
  actions: AIModelTaskRouteReasonRemediationActionKind[];
}) {
  if (!actions.length) {
    return <span className="text-muted-foreground">No action required</span>;
  }

  return (
    <div className="space-y-2">
      {actions.map(action => {
        const target = getAIModelTaskRouteRemediationTarget(action);

        return (
          <div
            key={action}
            className="rounded-md border border-border/70 bg-muted/30 px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-normal">
                {formatActionKind(action)}
              </Badge>
              <span className="text-xs text-muted-foreground">Target</span>
              <Badge
                variant="outline"
                className="border-border/70 bg-muted/40 font-normal"
                title={target.description}
              >
                {target.label}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {target.description}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ReasonSummary({
  route,
}: {
  route: AIModelTaskRouteDiagnosticsSummary;
}) {
  if (!route.reasonSummary.reasons.length) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium">Route reasons</div>
        <EmptyState>No route reason diagnostics returned.</EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Route reasons</div>
      <div className="flex flex-wrap gap-2">
        {route.reasonSummary.reasons.map(reason => (
          <Badge
            key={reason.code}
            variant="outline"
            className={cn('font-normal', SEVERITY_STYLES[reason.severity])}
            title={reason.description}
          >
            {reason.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function PolicyValueBadges({
  formatValue = formatFeatureKind,
  values,
}: {
  formatValue?: (value: string) => string;
  values: string[];
}) {
  if (!values.length) {
    return <span className="text-muted-foreground">Any</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map(value => (
        <Badge key={value} variant="outline" className="font-normal">
          {formatValue(value)}
        </Badge>
      ))}
    </div>
  );
}

function RoutePolicySummary({
  route,
}: {
  route: AIModelTaskRouteDiagnosticsSummary;
}) {
  const { policy } = route;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium">Route policy</div>
        <Badge variant="outline" className="font-normal">
          {policy.enabled == null
            ? 'Unknown'
            : policy.enabled
              ? 'Enabled'
              : 'Disabled'}
        </Badge>
        <Badge variant="outline" className="font-normal">
          {formatFeatureKind(policy.featureKind)}
        </Badge>
        <Badge variant="outline" className="font-normal">
          {policy.workspaceId ? `Workspace ${policy.workspaceId}` : 'Global'}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">Allowed privacy</div>
          <div className="mt-1">
            <PolicyValueBadges values={policy.allowedPrivacy} />
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Preferred privacy</div>
          <div className="mt-1">
            <PolicyValueBadges values={policy.preferredPrivacy} />
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Allowed providers</div>
          <div className="mt-1">
            <PolicyValueBadges
              values={policy.allowedProviderIds}
              formatValue={value => value}
            />
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Blocked providers</div>
          <div className="mt-1">
            <PolicyValueBadges
              values={policy.blockedProviderIds}
              formatValue={value => value}
            />
          </div>
        </div>
      </div>
      {policy.label ? (
        <div className="break-words text-xs text-muted-foreground">
          {policy.label}
        </div>
      ) : null}
    </div>
  );
}

function PreparedRoutesSummary({
  routes,
}: {
  routes: AIModelPreparedTaskRoute[];
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Prepared routes</div>
      {routes.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Runtime metadata</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route, index) => {
              const providerProfileLabel = formatAIModelProviderProfileLabel({
                providerConfiguredModelCount:
                  route.providerConfiguredModelCount,
                providerConfiguredModelIds: route.providerConfiguredModelIds,
                providerProfileConfigPath: route.providerProfileConfigPath,
                providerProfileId: route.providerProfileId,
                providerProfileSource: route.providerProfileSource,
              });

              return (
                <TableRow key={`${route.providerId}:${route.modelId}:${index}`}>
                  <TableCell className="break-words">
                    <div className="font-medium">{route.providerId}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {compactList([
                        route.providerType
                          ? formatProviderMetadata(
                              route.providerType,
                              PROVIDER_TYPE_LABELS
                            )
                          : null,
                        route.providerSource
                          ? formatProviderMetadata(
                              route.providerSource,
                              PROVIDER_SOURCE_LABELS
                            )
                          : null,
                        route.providerPriority != null
                          ? `Priority ${route.providerPriority}`
                          : null,
                      ]) || 'Provider metadata unavailable'}
                    </div>
                    {providerProfileLabel ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {providerProfileLabel}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="break-words font-medium">
                    {route.modelId}
                  </TableCell>
                  <TableCell className="break-words text-muted-foreground">
                    {compactList([
                      route.routeIndex != null
                        ? `Route #${route.routeIndex + 1}`
                        : null,
                      route.fallbackOrderIndex != null
                        ? `Fallback #${route.fallbackOrderIndex + 1}`
                        : null,
                      route.protocol ? `Protocol ${route.protocol}` : null,
                      route.requestLayer ? `Layer ${route.requestLayer}` : null,
                      route.modelBackendKind
                        ? `Backend ${route.modelBackendKind}`
                        : null,
                      route.canonicalModelKey
                        ? `Canonical ${route.canonicalModelKey}`
                        : null,
                      route.behaviorFlags?.length
                        ? `Flags ${route.behaviorFlags.join(', ')}`
                        : null,
                      route.requestedDimensions != null
                        ? `Requested ${route.requestedDimensions}d`
                        : null,
                      route.modelEmbeddingDimensions != null
                        ? `Model ${route.modelEmbeddingDimensions}d`
                        : null,
                      route.dimensionMismatch ? 'Dimension mismatch' : null,
                    ]) || 'No runtime metadata'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <EmptyState>No prepared routes returned.</EmptyState>
      )}
    </div>
  );
}

function formatReasonSummaryText(
  summary: AIModelTaskRouteDiagnosticsSummary['reasonSummary']
) {
  return summary.reasons.length
    ? summary.reasons
        .map(reason => `${reason.label} (${reason.severity})`)
        .join(', ')
    : 'none';
}

function formatRoutePolicyText(
  policy: AIModelTaskRouteDiagnosticsSummary['policy']
) {
  return compactList([
    `Policy ${
      policy.enabled == null
        ? 'Unknown'
        : policy.enabled
          ? 'Enabled'
          : 'Disabled'
    }`,
    `Feature ${formatFeatureKind(policy.featureKind)}`,
    policy.workspaceId ? `Workspace ${policy.workspaceId}` : 'Workspace Global',
    policy.allowedPrivacy.length
      ? `Allowed privacy ${policy.allowedPrivacy
          .map(value => formatProviderMetadata(value, PROVIDER_PRIVACY_LABELS))
          .join(', ')}`
      : 'Allowed privacy Any',
    policy.preferredPrivacy.length
      ? `Preferred privacy ${policy.preferredPrivacy
          .map(value => formatProviderMetadata(value, PROVIDER_PRIVACY_LABELS))
          .join(', ')}`
      : 'Preferred privacy Any',
    policy.allowedProviderIds.length
      ? `Allowed providers ${policy.allowedProviderIds.join(', ')}`
      : 'Allowed providers Any',
    policy.blockedProviderIds.length
      ? `Blocked providers ${policy.blockedProviderIds.join(', ')}`
      : 'Blocked providers None',
  ]);
}

function formatDimensionEvidenceLabel(
  route: {
    dimensionMismatch?: boolean | null;
    modelEmbeddingDimensions?: number | null;
    requestedDimensions?: number | null;
  },
  options: { includeNegativeMismatch?: boolean } = {}
) {
  return compactList([
    route.requestedDimensions != null
      ? `requested ${route.requestedDimensions}d`
      : null,
    route.modelEmbeddingDimensions != null
      ? `model ${route.modelEmbeddingDimensions}d`
      : null,
    route.dimensionMismatch || options.includeNegativeMismatch
      ? `dimension mismatch ${route.dimensionMismatch ? 'yes' : 'no'}`
      : null,
  ]);
}

function formatTaskRoutePreparedRouteText(route: AIModelPreparedTaskRoute) {
  const providerProfileLabel = formatAIModelProviderProfileLabel({
    providerConfiguredModelCount: route.providerConfiguredModelCount,
    providerConfiguredModelIds: route.providerConfiguredModelIds,
    providerProfileConfigPath: route.providerProfileConfigPath,
    providerProfileId: route.providerProfileId,
    providerProfileSource: route.providerProfileSource,
  });

  return compactList([
    `${route.providerId}/${route.modelId}`,
    route.routeIndex != null ? `route #${route.routeIndex + 1}` : null,
    route.fallbackOrderIndex != null
      ? `fallback #${route.fallbackOrderIndex + 1}`
      : null,
    route.protocol ? `protocol ${route.protocol}` : null,
    route.requestLayer ? `layer ${route.requestLayer}` : null,
    route.modelBackendKind ? `backend ${route.modelBackendKind}` : null,
    route.canonicalModelKey ? `canonical ${route.canonicalModelKey}` : null,
    route.behaviorFlags?.length
      ? `flags ${route.behaviorFlags.join(', ')}`
      : null,
    route.providerType
      ? `type ${formatProviderMetadata(route.providerType, PROVIDER_TYPE_LABELS)}`
      : null,
    route.providerSource
      ? `source ${formatProviderMetadata(
          route.providerSource,
          PROVIDER_SOURCE_LABELS
        )}`
      : null,
    route.providerPriority != null
      ? `priority ${route.providerPriority}`
      : null,
    providerProfileLabel ? `profile ${providerProfileLabel}` : null,
    formatDimensionEvidenceLabel(route).replace(
      'dimension mismatch yes',
      'dimension mismatch'
    ),
  ]);
}

function formatTaskRouteDiagnosticsErrorText(
  error: PromptRegistryPublishGateTaskRoute['diagnosticsErrors'][number]
) {
  return compactList([
    `stage ${formatFeatureKind(error.stage)}`,
    `code ${formatFeatureKind(error.code)}`,
    error.message ? `message ${error.message}` : null,
  ]);
}

function formatTaskRoutePolicyCandidateText(
  row: AIModelTaskRoutePolicyCandidateTraceRow
) {
  const providerProfileLabel = formatAIModelProviderProfileLabel({
    providerConfiguredModelCount: row.providerConfiguredModelCount,
    providerConfiguredModelIds: row.providerConfiguredModelIds,
    providerProfileConfigPath: row.providerProfileConfigPath,
    providerProfileId: row.providerProfileId,
    providerProfileSource: row.providerProfileSource,
  });

  return compactList([
    row.candidateFingerprint ? `fingerprint ${row.candidateFingerprint}` : null,
    row.candidateKey,
    formatProviderIdentity(row),
    row.providerType
      ? `type ${formatProviderMetadata(row.providerType, PROVIDER_TYPE_LABELS)}`
      : null,
    row.providerSource
      ? `source ${formatProviderMetadata(
          row.providerSource,
          PROVIDER_SOURCE_LABELS
        )}`
      : null,
    row.providerPriority != null ? `priority ${row.providerPriority}` : null,
    formatProviderMetadata(row.privacy, PROVIDER_PRIVACY_LABELS),
    formatProviderMetadata(row.health, PROVIDER_HEALTH_LABELS),
    row.healthCheckedAt ? `checked ${row.healthCheckedAt}` : null,
    providerProfileLabel ? `profile ${providerProfileLabel}` : null,
    `status ${formatFeatureKind(row.status)}`,
    `reasons ${formatReasonSummaryText(row.reasonSummary)}`,
  ]);
}

function formatPromptRegistryPublishGatePolicyCandidate(
  row: PromptRegistryPublishGatePolicyCandidate
) {
  const providerProfileLabel = formatAIModelProviderProfileLabel({
    providerConfiguredModelCount: row.providerConfiguredModelCount,
    providerConfiguredModelIds: row.providerConfiguredModelIds,
    providerProfileConfigPath: row.providerProfileConfigPath,
    providerProfileId: row.providerProfileId,
    providerProfileSource: row.providerProfileSource,
  });

  return compactList([
    formatProviderIdentity(row),
    row.providerType
      ? `type ${formatProviderMetadata(row.providerType, PROVIDER_TYPE_LABELS)}`
      : null,
    row.providerSource
      ? `source ${formatProviderMetadata(
          row.providerSource,
          PROVIDER_SOURCE_LABELS
        )}`
      : null,
    row.providerPriority != null ? `priority ${row.providerPriority}` : null,
    `privacy ${formatProviderMetadata(row.privacy, PROVIDER_PRIVACY_LABELS)}`,
    `health ${formatProviderMetadata(row.health, PROVIDER_HEALTH_LABELS)}`,
    row.healthCheckedAt ? `checked ${row.healthCheckedAt}` : null,
    providerProfileLabel ? `profile ${providerProfileLabel}` : null,
    `available ${row.available ? 'yes' : 'no'}`,
    `allowed ${row.allowed ? 'yes' : 'no'}`,
    row.reasons.length
      ? `reasons ${row.reasons.map(formatFeatureKind).join(', ')}`
      : 'reasons none',
  ]);
}

function formatTaskRoutePhaseText(row: AIModelTaskRoutePhaseTraceRow) {
  return compactList([
    row.phase,
    `candidates ${row.candidateCount}`,
    row.availableCount != null ? `available ${row.availableCount}` : null,
    row.blockedCount != null ? `blocked ${row.blockedCount}` : null,
    row.matchedCount != null ? `matched ${row.matchedCount}` : null,
    row.selectedCount != null ? `selected ${row.selectedCount}` : null,
    row.preparedCount != null ? `prepared ${row.preparedCount}` : null,
    `severity ${row.severity}`,
    `reasons ${formatReasonSummaryText(row.reasonSummary)}`,
  ]);
}

function formatPromptRegistryPublishGateRoutePhaseText(
  row: PromptRegistryPublishGateRouteTracePhase
) {
  return compactList([
    row.phase,
    `candidates ${row.candidateCount}`,
    row.availableCount != null ? `available ${row.availableCount}` : null,
    row.blockedCount != null ? `blocked ${row.blockedCount}` : null,
    row.matchedCount != null ? `matched ${row.matchedCount}` : null,
    row.selectedCount != null ? `selected ${row.selectedCount}` : null,
    row.preparedCount != null ? `prepared ${row.preparedCount}` : null,
    row.reasons.length
      ? `reasons ${row.reasons.map(formatFeatureKind).join(', ')}`
      : 'reasons none',
  ]);
}

function formatTaskRouteCandidateText(row: AIModelTaskRouteCandidateTraceRow) {
  const providerProfileLabel = formatAIModelProviderProfileLabel(row);
  const modelDefinitionLabel = formatAIModelDefinitionLabel({
    routeBackendKind: null,
    routeBehaviorFlags: null,
    routeCanonicalModelKey: null,
    routeModelAliasMatched: row.routeModelAliasMatched,
    routeModelDefinitionAliases: row.routeModelDefinitionAliases,
    routeModelDefinitionId: row.routeModelDefinitionId,
    routeModelDefinitionSource: row.routeModelDefinitionSource,
    routeProtocol: null,
    routeRawModelId: row.routeRawModelId,
    routeRequestLayer: null,
  });
  const capabilityLabel = compactList([
    row.routeInputTypes?.length
      ? `input ${row.routeInputTypes.join(', ')}`
      : null,
    row.routeOutputTypes?.length
      ? `output ${row.routeOutputTypes.join(', ')}`
      : null,
    row.routeAttachmentKinds?.length
      ? `attachments ${row.routeAttachmentKinds.join(', ')}`
      : null,
    row.routeAttachmentSourceKinds?.length
      ? `attachment sources ${row.routeAttachmentSourceKinds.join(', ')}`
      : null,
    row.routeAttachmentAllowRemoteUrls != null
      ? `remote attachments ${row.routeAttachmentAllowRemoteUrls ? 'yes' : 'no'}`
      : null,
    row.routeStructuredAttachmentKinds?.length
      ? `structured attachments ${row.routeStructuredAttachmentKinds.join(', ')}`
      : null,
    row.routeStructuredAttachmentSourceKinds?.length
      ? `structured attachment sources ${row.routeStructuredAttachmentSourceKinds.join(', ')}`
      : null,
    row.routeStructuredAttachmentAllowRemoteUrls != null
      ? `structured remote attachments ${row.routeStructuredAttachmentAllowRemoteUrls ? 'yes' : 'no'}`
      : null,
  ]);
  const limitLabel = compactList([
    row.routeContextWindow != null ? `context ${row.routeContextWindow}` : null,
    row.routeMaxOutputTokens != null
      ? `output ${row.routeMaxOutputTokens}`
      : null,
    row.routeEmbeddingDimensions != null
      ? `embedding ${row.routeEmbeddingDimensions}`
      : null,
  ]);

  return compactList([
    row.candidateKey ?? null,
    formatProviderIdentity(row),
    row.modelId ? `model ${row.modelId}` : null,
    row.preparedModelId ? `prepared ${row.preparedModelId}` : null,
    row.requestedModelId ? `requested ${row.requestedModelId}` : null,
    row.providerType
      ? `type ${formatProviderMetadata(row.providerType, PROVIDER_TYPE_LABELS)}`
      : null,
    row.providerSource
      ? `source ${formatProviderMetadata(
          row.providerSource,
          PROVIDER_SOURCE_LABELS
        )}`
      : null,
    row.providerPriority != null ? `priority ${row.providerPriority}` : null,
    row.privacy
      ? `privacy ${formatProviderMetadata(row.privacy, PROVIDER_PRIVACY_LABELS)}`
      : null,
    row.health
      ? `health ${formatProviderMetadata(row.health, PROVIDER_HEALTH_LABELS)}`
      : null,
    row.healthCheckedAt ? `checked ${row.healthCheckedAt}` : null,
    providerProfileLabel ? `profile ${providerProfileLabel}` : null,
    modelDefinitionLabel ? `definition ${modelDefinitionLabel}` : null,
    capabilityLabel ? `capability ${capabilityLabel}` : null,
    limitLabel ? `limits ${limitLabel}` : null,
    row.candidateModelIds?.length
      ? `profile models ${row.candidateModelIds.join(', ')}`
      : null,
    row.registryKind ? `registry ${row.registryKind}` : null,
    row.registrySelected ? 'registry selected' : null,
    row.registryAvailable === false ? 'registry unavailable' : null,
    row.errorCode ? `code ${row.errorCode}` : null,
    row.errorCategory
      ? `category ${formatFeatureKind(row.errorCategory)}`
      : null,
    `status ${formatFeatureKind(row.status)}`,
    `severity ${row.severity}`,
    `reasons ${formatReasonSummaryText(row.reasonSummary)}`,
  ]);
}

function formatPromptRegistryPublishGateTaskRoute(route: {
  diagnostics: AIModelTaskRouteDiagnosticsSummary;
  raw: PromptRegistryPublishGateTaskRoute;
}) {
  const { readiness } = route.diagnostics;
  const requestedModelSource =
    readiness.requestedModelSource ?? route.raw.requestedModelSource;
  const requestedModelConfigPath =
    readiness.requestedModelConfigPath ?? route.raw.requestedModelConfigPath;
  const preparedRouteTargets = route.raw.preparedRouteTargets ?? [];
  const preparedRouteTargetFingerprint =
    route.raw.preparedRouteTargetFingerprint;
  const providerProfileLabel = formatAIModelProviderProfileLabel({
    providerConfiguredModelCount: route.raw.providerConfiguredModelCount,
    providerConfiguredModelIds: route.raw.providerConfiguredModelIds,
    providerProfileConfigPath: route.raw.providerProfileConfigPath,
    providerProfileId: route.raw.providerProfileId,
    providerProfileSource: route.raw.providerProfileSource,
  });
  return compactList([
    formatFeatureKind(readiness.featureKind),
    `status ${STATUS_LABELS[readiness.status]}`,
    `configured ${readiness.configured ? 'yes' : 'no'}`,
    readiness.providerId ? `provider ${readiness.providerId}` : null,
    readiness.modelId ? `model ${readiness.modelId}` : null,
    providerProfileLabel ? `profile ${providerProfileLabel}` : null,
    (readiness.requestedModelId ?? route.raw.requestedModelId)
      ? `requested ${readiness.requestedModelId ?? route.raw.requestedModelId}`
      : null,
    requestedModelSource
      ? `source ${formatAIModelTaskModelSourceLabel(requestedModelSource)}`
      : null,
    requestedModelConfigPath ? `config ${requestedModelConfigPath}` : null,
    `prepared providers ${readiness.preparedProviderCount}`,
    preparedRouteTargets.length
      ? `targets ${preparedRouteTargets.join(' -> ')}`
      : null,
    preparedRouteTargetFingerprint
      ? `target fingerprint ${preparedRouteTargetFingerprint}`
      : null,
    readiness.errorCode ? `code ${readiness.errorCode}` : null,
    route.diagnostics.reasonSummary.reasons.length
      ? `reasons ${formatReasonSummaryText(route.diagnostics.reasonSummary)}`
      : 'reasons none',
  ]);
}

function formatPromptRegistryPublishGateRouteCandidate(
  row: PromptRegistryPublishGateRouteCandidate
) {
  const providerProfileLabel = formatAIModelProviderProfileLabel(row);
  const modelDefinitionLabel = formatAIModelDefinitionLabel({
    routeBackendKind: null,
    routeBehaviorFlags: null,
    routeCanonicalModelKey: null,
    routeModelAliasMatched: row.routeModelAliasMatched,
    routeModelDefinitionAliases: row.routeModelDefinitionAliases,
    routeModelDefinitionId: row.routeModelDefinitionId,
    routeModelDefinitionSource: row.routeModelDefinitionSource,
    routeProtocol: null,
    routeRawModelId: row.routeRawModelId,
    routeRequestLayer: null,
  });

  return compactList([
    formatProviderIdentity(row),
    row.modelId ? `model ${row.modelId}` : null,
    row.requestedModelId ? `requested ${row.requestedModelId}` : null,
    row.providerType
      ? `type ${formatProviderMetadata(row.providerType, PROVIDER_TYPE_LABELS)}`
      : null,
    row.providerSource
      ? `source ${formatProviderMetadata(
          row.providerSource,
          PROVIDER_SOURCE_LABELS
        )}`
      : null,
    row.providerPriority != null ? `priority ${row.providerPriority}` : null,
    row.privacy
      ? `privacy ${formatProviderMetadata(row.privacy, PROVIDER_PRIVACY_LABELS)}`
      : null,
    row.health
      ? `health ${formatProviderMetadata(row.health, PROVIDER_HEALTH_LABELS)}`
      : null,
    row.healthCheckedAt ? `checked ${row.healthCheckedAt}` : null,
    providerProfileLabel ? `profile ${providerProfileLabel}` : null,
    modelDefinitionLabel ? `definition ${modelDefinitionLabel}` : null,
    row.candidateModelIds?.length
      ? `candidate models ${row.candidateModelIds.join(', ')}`
      : null,
    row.providerConfiguredModelIds?.length
      ? `profile models ${row.providerConfiguredModelIds.join(', ')}`
      : null,
    row.providerConfiguredModelCount != null
      ? `profile model count ${row.providerConfiguredModelCount}`
      : null,
    row.registryKind ? `registry ${row.registryKind}` : null,
    row.registrySelected ? 'registry selected' : null,
    row.registryAvailable === false ? 'registry unavailable' : null,
    `status ${row.matched ? 'Matched' : 'Unmatched'}`,
    row.reasons.length
      ? `reasons ${row.reasons.map(formatFeatureKind).join(', ')}`
      : 'reasons none',
  ]);
}

function buildTaskRouteDiagnosticsText({
  label,
  rawRoute,
  route,
}: {
  label: string;
  rawRoute?: AIModelTaskRoute | null;
  route: AIModelTaskRouteDiagnosticsSummary;
}) {
  const { readiness } = route;
  const routeIdentity = compactList([readiness.providerId, readiness.modelId]);
  const requestedModelId =
    readiness.requestedModelId ?? rawRoute?.requestedModelId;
  const requestedModelSource =
    readiness.requestedModelSource ?? rawRoute?.requestedModelSource;
  const requestedModelConfigPath =
    readiness.requestedModelConfigPath ?? rawRoute?.requestedModelConfigPath;
  const preparedRoutes = rawRoute?.preparedRoutes ?? [];
  const preparedRouteTargets = rawRoute?.preparedRouteTargets ?? [];
  const preparedRouteTargetFingerprint =
    rawRoute?.preparedRouteTargetFingerprint;

  return [
    `Task route ${label}`,
    `Feature ${formatFeatureKind(readiness.featureKind)}`,
    `Status ${STATUS_LABELS[readiness.status]}`,
    `Severity ${readiness.severity}`,
    `Configured ${readiness.configured ? 'yes' : 'no'}`,
    `Route ${routeIdentity || 'not configured'}`,
    requestedModelId ? `Requested ${requestedModelId}` : null,
    requestedModelSource
      ? `Requested source ${formatAIModelTaskModelSourceLabel(
          requestedModelSource
        )}`
      : null,
    requestedModelConfigPath
      ? `Requested config ${requestedModelConfigPath}`
      : null,
    `Prepared providers ${readiness.preparedProviderCount}`,
    preparedRouteTargets.length
      ? `Prepared targets ${preparedRouteTargets.join(' -> ')}`
      : null,
    preparedRouteTargetFingerprint
      ? `Prepared target fingerprint ${preparedRouteTargetFingerprint}`
      : null,
    readiness.errorCode ? `Error code ${readiness.errorCode}` : null,
    readiness.errorMessage ? `Error ${readiness.errorMessage}` : null,
    `Diagnostics errors ${rawRoute?.diagnosticsErrors?.length ?? 0}`,
    ...(rawRoute?.diagnosticsErrors ?? []).map(
      error => `Diagnostics error ${formatTaskRouteDiagnosticsErrorText(error)}`
    ),
    `Reasons ${formatReasonSummaryText(route.reasonSummary)}`,
    route.actionKinds.length
      ? `Recommended ${route.actionKinds
          .map(action => {
            const target = getAIModelTaskRouteRemediationTarget(action);
            return `${formatActionKind(action)} -> ${target.label}`;
          })
          .join(', ')}`
      : 'Recommended none',
    formatRoutePolicyText(route.policy),
    `Prepared routes ${preparedRoutes.length}`,
    ...preparedRoutes.map(
      preparedRoute =>
        `Prepared route ${formatTaskRoutePreparedRouteText(preparedRoute)}`
    ),
    `Policy candidates ${route.policyCandidateTrace.rows.length}`,
    ...route.policyCandidateTrace.rows.map(
      row => `Policy candidate ${formatTaskRoutePolicyCandidateText(row)}`
    ),
    `Phase trace ${route.phaseTrace.phases.length}`,
    ...route.phaseTrace.phases.map(
      row => `Phase ${formatTaskRoutePhaseText(row)}`
    ),
    `Candidate trace ${route.candidateTrace.rows.length}`,
    ...route.candidateTrace.rows.map(
      row => `Candidate ${formatTaskRouteCandidateText(row)}`
    ),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function RouteSummaryCard({
  label,
  rawRoute,
  route,
}: {
  label: string;
  rawRoute?: AIModelTaskRoute | null;
  route: AIModelTaskRouteDiagnosticsSummary;
}) {
  const { readiness } = route;
  const identity = compactList([readiness.providerId, readiness.modelId]);
  const requestedModelId =
    readiness.requestedModelId ?? rawRoute?.requestedModelId;
  const requestedModelSource =
    readiness.requestedModelSource ?? rawRoute?.requestedModelSource;
  const requestedModelConfigPath =
    readiness.requestedModelConfigPath ?? rawRoute?.requestedModelConfigPath;
  const preparedRoutes = rawRoute?.preparedRoutes ?? [];
  const preparedRouteTargets = rawRoute?.preparedRouteTargets ?? [];
  const preparedRouteTargetFingerprint =
    rawRoute?.preparedRouteTargetFingerprint;
  const diagnosticsText = buildTaskRouteDiagnosticsText({
    label,
    rawRoute,
    route,
  });

  return (
    <Card className="border-border/60 bg-card shadow-1">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{label}</CardTitle>
            <CardDescription>
              {formatFeatureKind(readiness.featureKind)}
            </CardDescription>
          </div>
          <StatusBadge status={readiness.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border border-border/70 bg-muted/30 p-3">
          <div className="text-sm font-medium">Task route diagnostics</div>
          <pre
            className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground"
            data-testid={`task-route-diagnostics-${readiness.featureKind.replaceAll(
              '_',
              '-'
            )}`}
          >
            {diagnosticsText}
          </pre>
        </div>

        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Route</div>
            <div className="mt-1 break-words font-medium">
              {identity || 'Not configured'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Requested model</div>
            <div className="mt-1 break-words font-medium">
              {requestedModelId || 'Auto provider default'}
            </div>
            {requestedModelSource ? (
              <div className="mt-1 text-xs text-muted-foreground">
                Source {formatAIModelTaskModelSourceLabel(requestedModelSource)}
              </div>
            ) : null}
            {requestedModelConfigPath ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Config {requestedModelConfigPath}
              </div>
            ) : null}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Prepared providers
            </div>
            <div className="mt-1 font-medium">
              {readiness.preparedProviderCount}
            </div>
            {preparedRouteTargets.length ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                {preparedRouteTargets.join(' -> ')}
              </div>
            ) : null}
            {preparedRouteTargetFingerprint ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Target fingerprint {preparedRouteTargetFingerprint}
              </div>
            ) : null}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Checks</div>
            <div className="mt-1">
              <SeverityText severity={readiness.severity}>
                {route.reasonSummary.reasons.length} reason
                {route.reasonSummary.reasons.length === 1 ? '' : 's'}
              </SeverityText>
            </div>
          </div>
        </div>

        {readiness.errorCode ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">{readiness.errorCode}</div>
              {readiness.errorMessage ? (
                <div className="mt-1 break-words text-destructive/80">
                  {readiness.errorMessage}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="text-sm font-medium">Recommended checks</div>
          <RecommendedChecks actions={route.actionKinds} />
        </div>

        <ReasonSummary route={route} />
        <RoutePolicySummary route={route} />
        <PreparedRoutesSummary routes={preparedRoutes} />
        <PolicyCandidateTrace rows={route.policyCandidateTrace.rows} />
        <PhaseTrace phases={route.phaseTrace.phases} />
        <CandidateTrace rows={route.candidateTrace.rows} />
      </CardContent>
    </Card>
  );
}

function PolicyCandidateTrace({
  rows,
}: {
  rows: AIModelTaskRoutePolicyCandidateTraceRow[];
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Policy candidates</div>
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Privacy</TableHead>
              <TableHead>Health</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead>Reasons</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.providerId}>
                <TableCell className="break-words">
                  <div className="font-medium">
                    {formatProviderIdentity(row)}
                  </div>
                  {row.providerType ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatProviderMetadata(
                        row.providerType,
                        PROVIDER_TYPE_LABELS
                      )}
                    </div>
                  ) : null}
                  {row.providerSource ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatProviderMetadata(
                        row.providerSource,
                        PROVIDER_SOURCE_LABELS
                      )}
                    </div>
                  ) : null}
                  {row.providerPriority != null ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Priority {row.providerPriority}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  {formatProviderMetadata(row.privacy, PROVIDER_PRIVACY_LABELS)}
                </TableCell>
                <TableCell>
                  <div>
                    {formatProviderMetadata(row.health, PROVIDER_HEALTH_LABELS)}
                  </div>
                  {row.healthCheckedAt ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Checked {row.healthCheckedAt}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      'border font-normal',
                      POLICY_CANDIDATE_STATUS_STYLES[row.status]
                    )}
                  >
                    {formatFeatureKind(row.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <SeverityText severity={row.severity}>
                    {row.reasonSummary.reasons
                      .map(reason => reason.label)
                      .join(', ') || 'No issues'}
                  </SeverityText>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState>No policy candidate diagnostics returned.</EmptyState>
      )}
    </div>
  );
}

function PhaseTrace({ phases }: { phases: AIModelTaskRoutePhaseTraceRow[] }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Phase trace</div>
      {phases.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phase</TableHead>
              <TableHead className="w-[120px]">Candidates</TableHead>
              <TableHead className="w-[120px]">Selected</TableHead>
              <TableHead>Reasons</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {phases.map(phase => (
              <TableRow key={phase.phase}>
                <TableCell className="font-medium">{phase.phase}</TableCell>
                <TableCell>{phase.candidateCount}</TableCell>
                <TableCell>
                  {phase.selectedCount ?? phase.preparedCount ?? 0}
                </TableCell>
                <TableCell>
                  <SeverityText severity={phase.severity}>
                    {phase.reasonSummary.reasons
                      .map(reason => reason.label)
                      .join(', ') || 'No issues'}
                  </SeverityText>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState>No phase diagnostics returned.</EmptyState>
      )}
    </div>
  );
}

function CandidateTrace({
  rows,
}: {
  rows: AIModelTaskRouteCandidateTraceRow[];
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Candidate trace</div>
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead>Reasons</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const providerProfileLabel =
                formatAIModelProviderProfileLabel(row);
              const modelDefinitionLabel = formatAIModelDefinitionLabel({
                routeBackendKind: null,
                routeBehaviorFlags: null,
                routeCanonicalModelKey: null,
                routeModelAliasMatched: row.routeModelAliasMatched,
                routeModelDefinitionAliases: row.routeModelDefinitionAliases,
                routeModelDefinitionId: row.routeModelDefinitionId,
                routeModelDefinitionSource: row.routeModelDefinitionSource,
                routeProtocol: null,
                routeRawModelId: row.routeRawModelId,
                routeRequestLayer: null,
              });

              return (
                <TableRow
                  key={row.candidateKey || `${row.providerId}-${index}`}
                >
                  <TableCell className="break-words">
                    <div className="font-medium">
                      {formatProviderIdentity(row)}
                    </div>
                    {row.providerType ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatProviderMetadata(
                          row.providerType,
                          PROVIDER_TYPE_LABELS
                        )}
                      </div>
                    ) : null}
                    {row.providerSource ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatProviderMetadata(
                          row.providerSource,
                          PROVIDER_SOURCE_LABELS
                        )}
                      </div>
                    ) : null}
                    {row.providerPriority != null ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Priority {row.providerPriority}
                      </div>
                    ) : null}
                    {providerProfileLabel ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {providerProfileLabel}
                      </div>
                    ) : null}
                    {row.privacy ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatProviderMetadata(
                          row.privacy,
                          PROVIDER_PRIVACY_LABELS
                        )}
                      </div>
                    ) : null}
                    {row.health ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatProviderMetadata(
                          row.health,
                          PROVIDER_HEALTH_LABELS
                        )}
                      </div>
                    ) : null}
                    {row.healthCheckedAt ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Checked {row.healthCheckedAt}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="break-words">
                    {compactList([
                      row.modelId,
                      row.preparedModelId
                        ? `prepared ${row.preparedModelId}`
                        : null,
                      row.requestedModelId
                        ? `requested ${row.requestedModelId}`
                        : null,
                    ]) || 'Not selected'}
                    {modelDefinitionLabel ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {modelDefinitionLabel}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatFeatureKind(row.status)}</TableCell>
                  <TableCell>
                    <SeverityText severity={row.severity}>
                      {row.reasonSummary.reasons
                        .map(reason => reason.label)
                        .join(', ') || 'No issues'}
                    </SeverityText>
                    {row.errorCode || row.errorCategory ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {compactList([
                          row.errorCode ? `Code ${row.errorCode}` : null,
                          row.errorCategory
                            ? `Category ${formatFeatureKind(row.errorCategory)}`
                            : null,
                        ])}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <EmptyState>No candidate diagnostics returned.</EmptyState>
      )}
    </div>
  );
}

function ModelDefaultBadges({ model }: { model: AIModel }) {
  const isPromptDefault = model.promptDefaultModel === model.id;
  const isFallbackDefault =
    model.isDefault &&
    !!model.promptDefaultModel &&
    model.promptDefaultModel !== model.id;

  if (!model.isDefault && !isPromptDefault) {
    return <span className="text-muted-foreground">No</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {model.isDefault ? (
        <Badge
          variant="outline"
          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
        >
          Active default
        </Badge>
      ) : null}
      {isPromptDefault ? (
        <Badge variant="outline" className="font-normal">
          Prompt default
        </Badge>
      ) : null}
      {isFallbackDefault ? (
        <Badge
          variant="outline"
          className="border-amber-500/30 bg-amber-500/10 font-normal text-amber-700"
          title={
            model.defaultModelFallbackReason
              ? formatFeatureKind(model.defaultModelFallbackReason)
              : undefined
          }
        >
          Prompt fallback
        </Badge>
      ) : null}
    </div>
  );
}

function ModelTable({
  models,
  promptName,
}: {
  models: AIModel[];
  promptName: string;
}) {
  const candidateDiagnosticsText = buildModelCandidateDiagnosticsText(
    models,
    promptName
  );

  return (
    <Card className="border-border/60 bg-card shadow-1">
      <CardHeader>
        <CardTitle className="text-base">Prompt model candidates</CardTitle>
        <CardDescription>Models returned for {promptName}</CardDescription>
      </CardHeader>
      <CardContent>
        {models.length ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium">
                Model candidates diagnostics
              </div>
              <pre
                className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground"
                data-testid="model-candidates-diagnostics"
              >
                {candidateDiagnosticsText}
              </pre>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Fallback</TableHead>
                  <TableHead>Definition</TableHead>
                  <TableHead className="w-[160px]">Source</TableHead>
                  <TableHead>Capabilities</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead className="w-[120px]">Default</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map(model => {
                  const providerProfileLabel =
                    formatAIModelProviderProfileLabel(model);
                  const modelDiagnosticsText =
                    formatAIModelDiagnosticsLabel(model);

                  return (
                    <TableRow key={model.id}>
                      <TableCell>
                        <div className="break-words font-medium">
                          {model.name}
                        </div>
                        <div className="mt-1 break-words text-xs text-muted-foreground">
                          {model.id}
                        </div>
                      </TableCell>
                      <TableCell className="break-words">
                        <div>
                          {formatAIModelProviderLabel(model) ||
                            'Unknown provider'}
                        </div>
                        {providerProfileLabel ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {providerProfileLabel}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="break-words">
                        {formatAIModelRouteLabel(model) || 'Unknown'}
                      </TableCell>
                      <TableCell className="break-words">
                        {formatAIModelFallbackLabel(model) || 'None'}
                      </TableCell>
                      <TableCell className="break-words">
                        {formatAIModelDefinitionLabel(model) || 'Unknown'}
                      </TableCell>
                      <TableCell className="break-words">
                        <div>
                          {formatAIModelSourcesLabel(model) || 'Prompt'}
                        </div>
                        {model.promptModelSource ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Model source{' '}
                            {formatFeatureKind(model.promptModelSource)}
                          </div>
                        ) : null}
                        {model.promptModelConfigPath ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Config {model.promptModelConfigPath}
                          </div>
                        ) : null}
                        {model.promptModelSources?.length ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Source chain{' '}
                            {formatAIModelPromptSourcesLabel(model)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="break-words">
                        {formatAIModelCapabilityLabel(model) || 'Unknown'}
                      </TableCell>
                      <TableCell className="break-words">
                        {formatAIModelLimitsLabel(model) || 'Unknown'}
                      </TableCell>
                      <TableCell className="break-words">
                        {formatAIModelCostLabel(model) || 'Unknown'}
                      </TableCell>
                      <TableCell>
                        <ModelDefaultBadges model={model} />
                        <pre
                          className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/30 p-2 text-xs text-muted-foreground"
                          data-testid={`model-candidate-diagnostics-${model.id}`}
                        >
                          {modelDiagnosticsText}
                        </pre>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState>No model candidates returned for this prompt.</EmptyState>
        )}
      </CardContent>
    </Card>
  );
}

function buildModelCandidateDiagnosticsText(
  models: AIModel[],
  promptName: string
) {
  return [
    `Prompt ${promptName}`,
    `Candidate count ${models.length}`,
    '',
    ...models.flatMap((model, index) => [
      index ? '---' : null,
      formatAIModelDiagnosticsLabel(model),
    ]),
  ]
    .filter((part): part is string => part != null)
    .join('\n');
}

function PromptCatalogSummary({
  prompt,
  workspaceId,
}: {
  prompt: PromptCatalogItem | undefined;
  workspaceId: string | undefined;
}) {
  if (!prompt) {
    return (
      <div className="rounded-md border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
        Prompt metadata is not available for the submitted prompt name.
      </div>
    );
  }

  const diagnosticsText = buildPromptCatalogDiagnosticsText(prompt);
  const versionEvidence = buildPromptCatalogVersionEvidence(prompt);

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3 text-sm">
      <div>
        <div className="text-sm font-medium">Prompt catalog diagnostics</div>
        <pre
          className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground"
          data-testid={`prompt-catalog-diagnostics-${prompt.name}`}
        >
          {diagnosticsText}
        </pre>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Version evidence</div>
        <div
          className="mt-1 break-words font-medium"
          data-testid={`prompt-catalog-version-evidence-${prompt.name}`}
        >
          {versionEvidence}
        </div>
      </div>
      <PromptRegistryPublishGatePanel
        prompt={prompt}
        workspaceId={workspaceId}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Catalog category</div>
          <div className="mt-1 font-medium">
            {formatFeatureKind(prompt.category)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Catalog source</div>
          <div className="mt-1 font-medium">
            {formatFeatureKind(prompt.source)}
          </div>
          <div className="mt-1 break-words text-xs text-muted-foreground">
            Revision {prompt.revision}
          </div>
          <div className="mt-1 break-words text-xs text-muted-foreground">
            Fingerprint {prompt.fingerprint}
          </div>
          <div className="mt-1 break-words text-xs text-muted-foreground">
            Model strategy {prompt.modelStrategyFingerprint}
          </div>
          <div className="mt-1 break-words text-xs text-muted-foreground">
            Template {prompt.templateFingerprint}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Default model</div>
          <div className="mt-1 break-words font-medium">{prompt.model}</div>
          <PromptCatalogSourceSummary
            configPath={prompt.modelConfigPath}
            source={prompt.modelSource}
          />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Prompt policy</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {prompt.defaultPolicy ? (
              <Badge variant="outline" className="font-normal">
                {formatFeatureKind(prompt.defaultPolicy)}
              </Badge>
            ) : null}
            {prompt.overrideApplied ? (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 font-normal text-amber-700"
              >
                Override
              </Badge>
            ) : null}
            {!prompt.defaultPolicy && !prompt.overrideApplied ? (
              <span className="text-muted-foreground">Built-in default</span>
            ) : null}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Optional models</div>
          <div className="mt-1 font-medium">{prompt.optionalModelCount}</div>
          <PromptCatalogSourceSummary
            configPath={prompt.optionalModelsConfigPath}
            source={prompt.optionalModelsSource}
          />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Pro models</div>
          <div className="mt-1 font-medium">{prompt.proModelCount}</div>
          <PromptCatalogSourceSummary
            configPath={prompt.proModelsConfigPath}
            source={prompt.proModelsSource}
          />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Params</div>
          <div className="mt-1 font-medium">{prompt.paramCount}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Action</div>
          <div className="mt-1 break-words font-medium">
            {prompt.action || 'None'}
          </div>
        </div>
        {prompt.registryId != null ? (
          <div>
            <div className="text-xs text-muted-foreground">Registry record</div>
            <div className="mt-1 break-words font-medium">
              {prompt.registryId}
            </div>
            <div className="mt-1 break-words text-xs text-muted-foreground">
              Status{' '}
              {prompt.registryValidationStatus
                ? formatFeatureKind(prompt.registryValidationStatus)
                : 'Unknown'}
            </div>
            {prompt.registryValidationReason ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Reason {formatFeatureKind(prompt.registryValidationReason)}
              </div>
            ) : null}
            {prompt.registryValidationDetail ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Detail {prompt.registryValidationDetail}
              </div>
            ) : null}
            {prompt.registryValidationPublishStatus ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Publish{' '}
                {formatFeatureKind(prompt.registryValidationPublishStatus)}
              </div>
            ) : null}
            {prompt.registryValidationBlockingCount != null ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Blocking {prompt.registryValidationBlockingCount}
              </div>
            ) : null}
            {prompt.registryValidationIssueCount != null ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Issues {prompt.registryValidationIssueCount}
              </div>
            ) : null}
            {prompt.registryValidationErrorCount != null ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Errors {prompt.registryValidationErrorCount}
              </div>
            ) : null}
            {(prompt.registryValidationIssues ?? []).map(issue => (
              <div
                className="mt-1 break-words text-xs text-muted-foreground"
                key={`${issue.path}:${issue.code}:${issue.detail}`}
              >
                Issue {formatPromptRegistryValidationIssue(issue)}
              </div>
            ))}
            {(prompt.registryValidationRemediations ?? []).map(remediation => (
              <div
                className="mt-1 break-words text-xs text-muted-foreground"
                key={`${remediation.kind}:${remediation.target}`}
              >
                Remediation{' '}
                {formatPromptRegistryValidationRemediation(remediation)}
              </div>
            ))}
            <div className="mt-1 break-words text-xs text-muted-foreground">
              Messages {prompt.registryMessageCount ?? 0}
            </div>
            <div className="mt-1 break-words text-xs text-muted-foreground">
              Modified {prompt.registryModified ? 'yes' : 'no'}
            </div>
            {prompt.registryUpdatedAt ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Updated {prompt.registryUpdatedAt}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PromptRegistryPublishGatePanel({
  prompt,
  workspaceId,
}: {
  prompt: PromptCatalogItem;
  workspaceId: string | undefined;
}) {
  if (prompt.registryId == null) {
    return (
      <div className="rounded-md border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
        Prompt registry publish gate is not available for non-registry prompts.
      </div>
    );
  }

  const expectedVersion = buildPromptRegistryPublishGateExpectedVersion(prompt);

  return (
    <PromptRegistryPublishGateQueryResult
      key={`${prompt.name}:${workspaceId ?? 'global'}:${expectedVersion?.registryId ?? 'no-registry'}:${expectedVersion?.registryFingerprint ?? 'no-fingerprint'}`}
      expectedVersion={expectedVersion}
      promptName={prompt.name}
      workspaceId={workspaceId}
    />
  );
}

function PromptRegistryPublishGateQueryResult({
  expectedVersion,
  promptName,
  workspaceId,
}: {
  expectedVersion: PromptRegistryPublishGateExpectedVersion | undefined;
  promptName: string;
  workspaceId: string | undefined;
}) {
  const { data, isValidating } = useQuery({
    query: getCopilotPromptRegistryPublishGateQuery,
    variables: {
      expectedVersion,
      name: promptName,
      workspaceId,
    },
  });
  const verdict = data.currentUser?.copilot?.promptRegistryPublishGate ?? null;
  const submissionContract = verdict?.repairActionPreview.submissionContract;
  const { data: preflightData } = useQuery({
    query: getCopilotPromptRegistryRepairPreflightQuery,
    variables: {
      expectedVersion,
      name: promptName,
      submission: submissionContract
        ? buildPromptRegistryRepairSubmissionInput(submissionContract)
        : {
            approvalPolicyFingerprint: '',
            authorizationFingerprint: '',
            candidateEvidenceSetFingerprint: '',
            preparedRouteOrderEvidenceSetFingerprint: '',
            catalogFingerprint: '',
            contractVersion: '',
            expectedRegistryFingerprint: '',
            expectedRegistryId: 0,
            expectedRegistryUpdatedAt: '',
            guardFingerprint: '',
            idempotencyKey: '',
            operationSetFingerprint: '',
            previewFingerprint: '',
            requiredInputs: [],
            submissionFingerprint: '',
          },
      workspaceId,
    },
  });
  const repairPreflight =
    preflightData.currentUser?.copilot?.promptRegistryRepairPreflight ?? null;
  const [repairExecutionRequest, setRepairExecutionRequest] =
    useState<PromptRegistryRepairExecutionRequest | null>(null);
  const [repairExecutionRequestError, setRepairExecutionRequestError] =
    useState<string | null>(null);
  const {
    trigger: requestRepairExecution,
    isMutating: isRequestingRepairExecution,
  } = useMutation({
    mutation: requestCopilotPromptRegistryRepairExecutionMutation,
  });
  const canCheckRepairExecutionRequest = Boolean(
    submissionContract && repairPreflight
  );

  const checkRepairExecutionRequest = () => {
    if (!submissionContract || !repairPreflight) {
      return;
    }

    setRepairExecutionRequest(null);
    setRepairExecutionRequestError(null);
    requestRepairExecution({
      input: buildPromptRegistryRepairExecutionRequestInput({
        expectedVersion,
        promptName,
        repairPreflight,
        submissionContract,
        workspaceId,
      }),
    })
      .then(data => {
        setRepairExecutionRequest(
          data.requestCopilotPromptRegistryRepairExecution
        );
      })
      .catch(error => {
        console.error(error);
        setRepairExecutionRequestError(
          error instanceof Error ? error.message : String(error)
        );
      });
  };

  return (
    <PromptRegistryPublishGateResult
      canCheckRepairExecutionRequest={canCheckRepairExecutionRequest}
      checkRepairExecutionRequest={checkRepairExecutionRequest}
      expectedVersion={expectedVersion}
      isValidating={isValidating}
      isRequestingRepairExecution={isRequestingRepairExecution}
      promptName={promptName}
      repairExecutionRequest={repairExecutionRequest}
      repairExecutionRequestError={repairExecutionRequestError}
      repairPreflight={repairPreflight}
      verdict={verdict}
    />
  );
}

function PromptRegistryPublishGateResult({
  canCheckRepairExecutionRequest,
  checkRepairExecutionRequest,
  expectedVersion,
  isValidating,
  isRequestingRepairExecution,
  promptName,
  repairExecutionRequest,
  repairExecutionRequestError,
  repairPreflight,
  verdict,
}: {
  canCheckRepairExecutionRequest: boolean;
  checkRepairExecutionRequest: () => void;
  expectedVersion: PromptRegistryPublishGateExpectedVersion | undefined;
  isValidating: boolean | undefined;
  isRequestingRepairExecution: boolean | undefined;
  promptName: string;
  repairExecutionRequest: PromptRegistryRepairExecutionRequest | null;
  repairExecutionRequestError: string | null;
  repairPreflight: PromptRegistryRepairPreflight | null;
  verdict: PromptRegistryPublishGateVerdict | null;
}) {
  if (!verdict) {
    return (
      <div className="rounded-md border border-border/60 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium">Prompt registry publish gate</div>
          {isValidating ? (
            <Badge variant="outline" className="font-normal">
              Refreshing
            </Badge>
          ) : null}
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          No publish gate verdict returned for {promptName}.
        </div>
      </div>
    );
  }

  const diagnosticsText = buildPromptRegistryPublishGateDiagnosticsText(
    verdict,
    expectedVersion,
    repairExecutionRequest,
    repairPreflight
  );
  const modelRoutes = resolvePromptRegistryPublishGateModelRoutes(verdict);
  const taskRouteDiagnostics = getAIModelTaskRoutesDiagnostics({
    embeddingRoute: verdict.taskRoutes.find(
      route => route.featureKind === 'workspace_indexing'
    ),
    rerankRoute: verdict.taskRoutes.find(
      route => route.featureKind === 'rerank'
    ),
  });
  const taskRouteDiagnosticsByFeatureKind = new Map(
    taskRouteDiagnostics.routes.map(route => [
      route.readiness.featureKind,
      route,
    ])
  );
  const taskRoutes = verdict.taskRoutes
    .map(route => {
      const diagnostics = taskRouteDiagnosticsByFeatureKind.get(
        route.featureKind
      );
      return diagnostics ? { diagnostics, raw: route } : null;
    })
    .filter(
      (
        route
      ): route is {
        diagnostics: AIModelTaskRouteDiagnosticsSummary;
        raw: PromptRegistryPublishGateTaskRoute;
      } => !!route
    );

  return (
    <div className="rounded-md border border-border/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">Prompt registry publish gate</div>
        <Badge
          variant="outline"
          className={cn(
            'font-normal',
            verdict.allowed
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          )}
        >
          {verdict.allowed ? 'Allowed' : 'Blocked'}
        </Badge>
        <Badge variant="outline" className="font-normal">
          {formatFeatureKind(verdict.status)}
        </Badge>
        <Badge variant="outline" className="font-normal">
          Publish {formatFeatureKind(verdict.publishStatus)}
        </Badge>
        {isValidating ? (
          <Badge variant="outline" className="font-normal">
            Refreshing
          </Badge>
        ) : null}
        <Button
          disabled={
            !canCheckRepairExecutionRequest || isRequestingRepairExecution
          }
          onClick={checkRepairExecutionRequest}
          size="sm"
          type="button"
          variant="outline"
        >
          {isRequestingRepairExecution
            ? 'Checking request gate'
            : 'Check request gate'}
        </Button>
      </div>
      <pre
        className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground"
        data-testid={`prompt-registry-publish-gate-${promptName}`}
      >
        {diagnosticsText}
      </pre>
      {repairExecutionRequest ? (
        <div className="mt-2 break-words text-xs text-muted-foreground">
          Repair execution request{' '}
          {formatPromptRegistryRepairExecutionRequest(repairExecutionRequest)}
        </div>
      ) : null}
      {repairExecutionRequestError ? (
        <div className="mt-2 break-words text-xs text-destructive">
          Repair execution request error {repairExecutionRequestError}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Registry row</div>
          <div className="mt-1 break-words font-medium">
            {verdict.registryId}
          </div>
          <div className="mt-1 break-words text-xs text-muted-foreground">
            Fingerprint {verdict.registryFingerprint}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Updated</div>
          <div className="mt-1 break-words font-medium">
            {verdict.registryUpdatedAt}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Issues</div>
          <div className="mt-1 break-words font-medium">
            {verdict.issueCount} total / {verdict.errorCount} error
            {verdict.errorCount === 1 ? '' : 's'} / {verdict.blockingCount}{' '}
            blocking
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Stale check</div>
          <div className="mt-1 break-words font-medium">
            {verdict.stale ? 'Stale' : 'Current'}
          </div>
          {verdict.staleReasons.length ? (
            <div className="mt-1 break-words text-xs text-muted-foreground">
              {verdict.staleReasons.map(formatFeatureKind).join(', ')}
            </div>
          ) : null}
        </div>
        {verdict.modelRoute ? (
          <div>
            <div className="text-xs text-muted-foreground">
              Default model route
            </div>
            <div className="mt-1 break-words font-medium">
              {verdict.modelRoute.available ? 'Available' : 'Unavailable'}
            </div>
            <div className="mt-1 break-words text-xs text-muted-foreground">
              {compactList([
                verdict.modelRoute.providerId,
                verdict.modelRoute.modelId,
                verdict.modelRoute.providerProfileId
                  ? `profile ${verdict.modelRoute.providerProfileId}`
                  : null,
                verdict.modelRoute.requestedModelId
                  ? `requested ${verdict.modelRoute.requestedModelId}`
                  : null,
              ]) || 'No route'}
            </div>
            {verdict.modelRoute.providerProfileConfigPath ? (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                Config {verdict.modelRoute.providerProfileConfigPath}
              </div>
            ) : null}
            <div className="mt-1 break-words text-xs text-muted-foreground">
              Reasons{' '}
              {verdict.modelRoute.reasons.map(formatFeatureKind).join(', ') ||
                'none'}
            </div>
          </div>
        ) : null}
        {modelRoutes.length ? (
          <div className="md:col-span-3">
            <div className="text-xs text-muted-foreground">
              Model route candidates
            </div>
            <div className="mt-1 space-y-1">
              {modelRoutes.map(route => (
                <div
                  className="break-words text-xs text-muted-foreground"
                  key={`${route.candidateKind}:${route.candidateIndex}:${route.requestedModelId ?? route.modelId ?? 'unconfigured'}`}
                >
                  {formatPromptRegistryPublishGateModelRoute(route)}
                  {route.policyCandidates?.length ? (
                    <div className="mt-1 space-y-1 pl-3">
                      {route.policyCandidates.map((candidate, index) => (
                        <div key={`${candidate.providerId}:policy:${index}`}>
                          Policy candidate{' '}
                          {formatPromptRegistryPublishGatePolicyCandidate(
                            candidate
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {route.routeTrace?.length ? (
                    <div className="mt-1 space-y-1 pl-3">
                      {route.routeTrace.map((phase, index) => (
                        <div
                          key={`${route.candidateKind}:${route.candidateIndex}:phase:${phase.phase}:${index}`}
                        >
                          Phase{' '}
                          {formatPromptRegistryPublishGateRoutePhaseText(phase)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {route.routeCandidates?.length ? (
                    <div className="mt-1 space-y-1 pl-3">
                      {route.routeCandidates.map((candidate, index) => (
                        <div key={`${candidate.providerId}:${index}`}>
                          Candidate{' '}
                          {formatPromptRegistryPublishGateRouteCandidate(
                            candidate
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {taskRoutes.length ? (
          <div className="md:col-span-4">
            <div className="text-xs text-muted-foreground">
              Task route evidence
            </div>
            <div className="mt-1 space-y-1">
              {taskRoutes.map(({ diagnostics, raw }) => (
                <div
                  className="break-words text-xs text-muted-foreground"
                  key={raw.featureKind}
                >
                  Task route{' '}
                  {formatPromptRegistryPublishGateTaskRoute({
                    diagnostics,
                    raw,
                  })}
                  {diagnostics.phaseTrace.phases.length ? (
                    <div className="mt-1 space-y-1 pl-3">
                      {diagnostics.phaseTrace.phases.map((phase, index) => (
                        <div key={`${raw.featureKind}:phase:${index}`}>
                          Phase {formatTaskRoutePhaseText(phase)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {diagnostics.candidateTrace.rows.length ? (
                    <div className="mt-1 space-y-1 pl-3">
                      {diagnostics.candidateTrace.rows.map(
                        (candidate, index) => (
                          <div
                            key={`${raw.featureKind}:candidate:${candidate.providerId}:${index}`}
                          >
                            Candidate {formatTaskRouteCandidateText(candidate)}
                          </div>
                        )
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {verdict.actionRouteDryRun ? (
          <div className="md:col-span-4">
            <div className="text-xs text-muted-foreground">
              Action route dry-run evidence
            </div>
            <div className="mt-1 break-words text-xs text-muted-foreground">
              {formatPromptRegistryPublishGateActionRouteDryRun(
                verdict.actionRouteDryRun
              )}
            </div>
            {verdict.actionRouteDryRun.steps.length ? (
              <div className="mt-1 space-y-1">
                {verdict.actionRouteDryRun.steps.map(step => (
                  <div
                    className="break-words text-xs text-muted-foreground"
                    key={`${step.stepId}:${step.kind}`}
                  >
                    Step{' '}
                    {formatPromptRegistryPublishGateActionRouteDryRunStep(step)}
                    {step.routes.length ? (
                      <div className="mt-1 space-y-1 pl-3">
                        {step.routes.map(route => (
                          <div
                            key={`${step.stepId}:${route.routeIndex}:${route.providerId}:${route.modelId}`}
                          >
                            Route{' '}
                            {formatPromptRegistryPublishGateActionRouteDryRunRoute(
                              route
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {verdict.issues.length ? (
        <div className="mt-3 space-y-1">
          <div className="text-xs text-muted-foreground">Gate issues</div>
          {verdict.issues.map(issue => (
            <div
              className="break-words text-xs text-muted-foreground"
              key={`${issue.path}:${issue.code}:${issue.detail}`}
            >
              Issue {formatPromptRegistryValidationIssue(issue)}
            </div>
          ))}
        </div>
      ) : null}
      {verdict.remediations.length ? (
        <div className="mt-3 space-y-1">
          <div className="text-xs text-muted-foreground">Gate remediations</div>
          {verdict.remediations.map(remediation => (
            <div
              className="break-words text-xs text-muted-foreground"
              key={`${remediation.kind}:${remediation.target}`}
            >
              Remediation{' '}
              {formatPromptRegistryValidationRemediation(remediation)}
            </div>
          ))}
        </div>
      ) : null}
      {verdict.repairRecommendations.length ? (
        <div className="mt-3 space-y-1">
          <div className="text-xs text-muted-foreground">
            Repair recommendations
          </div>
          {verdict.repairRecommendations.map(recommendation => (
            <div
              className="break-words text-xs text-muted-foreground"
              key={`${recommendation.category}:${recommendation.code}:${recommendation.target}:${recommendation.instanceKey ?? ''}`}
            >
              Recommendation{' '}
              {formatPromptRegistryPublishGateRepairRecommendation(
                recommendation
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildPromptRegistryPublishGateDiagnosticsText(
  verdict: PromptRegistryPublishGateVerdict,
  expectedVersion: PromptRegistryPublishGateExpectedVersion | undefined,
  repairExecutionRequest: PromptRegistryRepairExecutionRequest | null,
  repairPreflight: PromptRegistryRepairPreflight | null
) {
  const modelRoutes = resolvePromptRegistryPublishGateModelRoutes(verdict);
  const taskRouteDiagnostics = getAIModelTaskRoutesDiagnostics({
    embeddingRoute: verdict.taskRoutes.find(
      route => route.featureKind === 'workspace_indexing'
    ),
    rerankRoute: verdict.taskRoutes.find(
      route => route.featureKind === 'rerank'
    ),
  });
  const taskRouteDiagnosticsByFeatureKind = new Map(
    taskRouteDiagnostics.routes.map(route => [
      route.readiness.featureKind,
      route,
    ])
  );
  const taskRoutes = verdict.taskRoutes
    .map(route => {
      const diagnostics = taskRouteDiagnosticsByFeatureKind.get(
        route.featureKind
      );
      return diagnostics ? { diagnostics, raw: route } : null;
    })
    .filter(
      (
        route
      ): route is {
        diagnostics: AIModelTaskRouteDiagnosticsSummary;
        raw: PromptRegistryPublishGateTaskRoute;
      } => !!route
    );

  return [
    `Prompt ${verdict.name}`,
    `Gate ${verdict.allowed ? 'Allowed' : 'Blocked'}`,
    `Status ${formatFeatureKind(verdict.status)}`,
    `Publish ${formatFeatureKind(verdict.publishStatus)}`,
    `Reason ${formatFeatureKind(verdict.reason)}`,
    `Registry id ${verdict.registryId}`,
    `Registry updated ${verdict.registryUpdatedAt}`,
    `Registry fingerprint ${verdict.registryFingerprint}`,
    expectedVersion?.registryId != null
      ? `Expected registry id ${expectedVersion.registryId}`
      : null,
    expectedVersion?.registryUpdatedAt
      ? `Expected registry updated ${expectedVersion.registryUpdatedAt}`
      : null,
    expectedVersion?.registryFingerprint
      ? `Expected registry fingerprint ${expectedVersion.registryFingerprint}`
      : null,
    `Stale ${verdict.stale ? 'yes' : 'no'}`,
    verdict.staleReasons.length
      ? `Stale reasons ${verdict.staleReasons.map(formatFeatureKind).join(', ')}`
      : 'Stale reasons none',
    `Issues ${verdict.issueCount}`,
    `Errors ${verdict.errorCount}`,
    `Blocking ${verdict.blockingCount}`,
    verdict.modelRoute
      ? `Model route ${formatPromptRegistryPublishGateModelRoute(verdict.modelRoute)}`
      : 'Model route not checked',
    modelRoutes.length
      ? `Model routes ${modelRoutes
          .map(formatPromptRegistryPublishGateModelRoute)
          .join(' | ')}`
      : null,
    ...modelRoutes.flatMap(route => [
      `Model route policy candidates ${formatFeatureKind(route.candidateKind)}#${route.candidateIndex} ${route.policyCandidates?.length ?? 0}`,
      ...(route.policyCandidates ?? []).map(
        candidate =>
          `Model route policy candidate ${formatPromptRegistryPublishGatePolicyCandidate(candidate)}`
      ),
      `Model route phase trace ${formatFeatureKind(route.candidateKind)}#${route.candidateIndex} ${route.routeTrace?.length ?? 0}`,
      ...(route.routeTrace ?? []).map(
        phase =>
          `Model route phase ${formatPromptRegistryPublishGateRoutePhaseText(phase)}`
      ),
      `Model route candidate trace ${formatFeatureKind(route.candidateKind)}#${route.candidateIndex} ${route.routeCandidates?.length ?? 0}`,
      ...(route.routeCandidates ?? []).map(
        candidate =>
          `Model route provider candidate ${formatPromptRegistryPublishGateRouteCandidate(candidate)}`
      ),
    ]),
    taskRoutes.length ? `Task routes ${taskRoutes.length}` : 'Task routes 0',
    ...taskRoutes.flatMap(({ diagnostics, raw }) => [
      `Task route ${formatPromptRegistryPublishGateTaskRoute({
        diagnostics,
        raw,
      })}`,
      `Task route phase trace ${formatFeatureKind(raw.featureKind)} ${diagnostics.phaseTrace.phases.length}`,
      ...diagnostics.phaseTrace.phases.map(
        phase => `Task route phase ${formatTaskRoutePhaseText(phase)}`
      ),
      `Task route candidate trace ${formatFeatureKind(raw.featureKind)} ${diagnostics.candidateTrace.rows.length}`,
      ...diagnostics.candidateTrace.rows.map(
        candidate =>
          `Task route candidate ${formatTaskRouteCandidateText(candidate)}`
      ),
      `Task route prepare candidates ${formatFeatureKind(raw.featureKind)} ${raw.prepareCandidates?.length ?? 0}`,
      `Task route diagnostics errors ${formatFeatureKind(raw.featureKind)} ${raw.diagnosticsErrors?.length ?? 0}`,
      ...(raw.diagnosticsErrors ?? []).map(
        error =>
          `Task route diagnostics error ${formatTaskRouteDiagnosticsErrorText(
            error
          )}`
      ),
    ]),
    verdict.actionRouteDryRun
      ? `Action route dry-run ${formatPromptRegistryPublishGateActionRouteDryRun(
          verdict.actionRouteDryRun
        )}`
      : 'Action route dry-run not checked',
    ...(verdict.actionRouteDryRun?.steps ?? []).flatMap(step => [
      `Action route dry-run step ${formatPromptRegistryPublishGateActionRouteDryRunStep(
        step
      )}`,
      ...step.routes.map(
        route =>
          `Action route dry-run route ${formatPromptRegistryPublishGateActionRouteDryRunRoute(
            route
          )}`
      ),
    ]),
    verdict.repairActionCatalog.length
      ? `Repair action catalog ${verdict.repairActionCatalog.length}`
      : 'Repair action catalog 0',
    verdict.repairActionCatalogFingerprint
      ? `Repair action catalog fingerprint ${verdict.repairActionCatalogFingerprint}`
      : null,
    `Repair action mutation guard ${formatPromptRegistryPublishGateRepairActionMutationGuard(
      verdict.repairActionMutationGuard
    )}`,
    `Repair action preview ${formatPromptRegistryPublishGateRepairActionPreview(
      verdict.repairActionPreview
    )}`,
    repairPreflight
      ? `Repair action preflight ${formatPromptRegistryRepairPreflight(repairPreflight)}`
      : 'Repair action preflight not checked',
    repairExecutionRequest
      ? `Repair execution request ${formatPromptRegistryRepairExecutionRequest(
          repairExecutionRequest
        )}`
      : 'Repair execution request not checked',
    ...verdict.repairActionPreview.operations.map(
      operation =>
        `Repair action preview operation ${formatPromptRegistryPublishGateRepairActionPreviewOperation(
          operation
        )}`
    ),
    ...verdict.repairActionCatalog.map(
      entry =>
        `Repair action catalog entry ${formatPromptRegistryPublishGateRepairActionCatalogEntry(
          entry
        )}`
    ),
    verdict.repairRecommendations.length
      ? `Repair recommendations ${verdict.repairRecommendations.length}`
      : 'Repair recommendations 0',
    ...verdict.repairRecommendations.map(
      recommendation =>
        `Repair recommendation ${formatPromptRegistryPublishGateRepairRecommendation(
          recommendation
        )}`
    ),
    ...(verdict.issues ?? []).map(
      issue => `Issue ${formatPromptRegistryValidationIssue(issue)}`
    ),
    ...(verdict.remediations ?? []).map(
      remediation =>
        `Remediation ${formatPromptRegistryValidationRemediation(remediation)}`
    ),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function resolvePromptRegistryPublishGateModelRoutes(
  verdict: PromptRegistryPublishGateVerdict
): PromptRegistryPublishGateModelRoute[] {
  if (verdict.modelRoutes?.length) {
    return verdict.modelRoutes;
  }

  return verdict.modelRoute ? [verdict.modelRoute] : [];
}

function formatPromptRegistryPublishGateActionRouteDryRun(
  dryRun: PromptRegistryPublishGateActionRouteDryRun
) {
  return compactList([
    `status ${formatFeatureKind(dryRun.status)}`,
    `feature ${formatFeatureKind(dryRun.featureKind)}`,
    dryRun.actionId ? `action ${dryRun.actionId}` : null,
    `steps ${dryRun.steps.length}`,
    `routes ${dryRun.actualRouteCount}/${dryRun.expectedRouteCount}`,
    dryRun.missingRouteCount
      ? `missing routes ${dryRun.missingRouteCount}`
      : null,
    dryRun.routeCountMismatch ? 'route count mismatch' : null,
    dryRun.routeCountMismatchStepIds.length
      ? `mismatch steps ${dryRun.routeCountMismatchStepIds.join(', ')}`
      : null,
    dryRun.diagnosticsErrorStage
      ? `diagnostics stage ${formatFeatureKind(dryRun.diagnosticsErrorStage)}`
      : null,
    dryRun.diagnosticsErrorCode
      ? `diagnostics code ${formatFeatureKind(dryRun.diagnosticsErrorCode)}`
      : null,
    dryRun.diagnosticsErrorMessage
      ? `diagnostics message ${dryRun.diagnosticsErrorMessage}`
      : null,
    dryRun.errorCode ? `error ${formatFeatureKind(dryRun.errorCode)}` : null,
    dryRun.errorMessage ? `message ${dryRun.errorMessage}` : null,
  ]);
}

function formatPromptRegistryPublishGateActionRouteDryRunStep(
  step: PromptRegistryPublishGateActionRouteDryRun['steps'][number]
) {
  return compactList([
    step.stepId,
    `kind ${formatFeatureKind(step.kind)}`,
    `routes ${step.actualRouteCount}/${step.routeCount}`,
    step.routeCountMismatch ? 'route count mismatch' : null,
    step.requestedModelId ? `requested ${step.requestedModelId}` : null,
    step.requestedModelSource
      ? `source ${formatFeatureKind(step.requestedModelSource)}`
      : null,
    step.fallbackProviderIds.length
      ? `fallback ${step.fallbackProviderIds.join(' -> ')}`
      : 'fallback none',
  ]);
}

function formatPromptRegistryPublishGateActionRouteDryRunRoute(
  route: PromptRegistryPublishGateActionRouteDryRun['steps'][number]['routes'][number]
) {
  return formatPreparedRouteTraceRoute(route);
}

function formatPromptRegistryPublishGateRepairRecommendation(
  recommendation: PromptRegistryPublishGateVerdict['repairRecommendations'][number]
) {
  const candidateEvidence = recommendation.candidateEvidence ?? [];
  return compactList([
    formatFeatureKind(recommendation.severity),
    formatFeatureKind(recommendation.category),
    recommendation.code,
    recommendation.title,
    recommendation.target,
    recommendation.instanceKey
      ? `instance ${recommendation.instanceKey}`
      : null,
    recommendation.diagnosticsFingerprint
      ? `fingerprint ${recommendation.diagnosticsFingerprint}`
      : null,
    recommendation.suggestedActionCatalogVersion
      ? `action catalog ${recommendation.suggestedActionCatalogVersion}`
      : null,
    `input schema ${formatRepairRecommendationInputSchema(
      recommendation.suggestedActionInputSchema
    )}`,
    recommendation.suggestedActionKind
      ? `action kind ${formatFeatureKind(recommendation.suggestedActionKind)}`
      : null,
    recommendation.suggestedActionSafety
      ? `action safety ${formatFeatureKind(
          recommendation.suggestedActionSafety
        )}`
      : null,
    recommendation.suggestedActionRequiredCapabilities.length
      ? `required capabilities ${recommendation.suggestedActionRequiredCapabilities.join(', ')}`
      : null,
    recommendation.targetLocator
      ? `locator ${formatPromptRegistryPublishGateRepairTargetLocator(
          recommendation.targetLocator
        )}`
      : null,
    recommendation.evidence.length
      ? `evidence ${recommendation.evidence.join(', ')}`
      : null,
    candidateEvidence.length
      ? `candidate evidence ${candidateEvidence.map(formatPromptRegistryPublishGateRepairCandidateEvidence).join(' | ')}`
      : null,
    recommendation.suggestedAction,
  ]);
}

function formatPromptRegistryPublishGateRepairCandidateEvidence(
  evidence: NonNullable<
    PromptRegistryPublishGateVerdict['repairRecommendations'][number]['candidateEvidence']
  >[number]
) {
  return compactList([
    `${formatPromptRegistryPublishGateRepairCandidateEvidenceScope(
      evidence.scope
    )} #${evidence.candidateIndex}`,
    `fingerprint ${evidence.candidateFingerprint}`,
    evidence.candidateKey ? `key ${evidence.candidateKey}` : null,
    `provider ${evidence.providerId}`,
    evidence.allowed != null
      ? `allowed ${evidence.allowed ? 'yes' : 'no'}`
      : null,
    evidence.available != null
      ? `available ${evidence.available ? 'yes' : 'no'}`
      : null,
    evidence.matched != null
      ? `matched ${evidence.matched ? 'yes' : 'no'}`
      : null,
    evidence.prepared != null
      ? `prepared ${evidence.prepared ? 'yes' : 'no'}`
      : null,
    evidence.providerName ? `name ${evidence.providerName}` : null,
    evidence.providerSource
      ? `source ${formatFeatureKind(evidence.providerSource)}`
      : null,
    evidence.providerType
      ? `type ${formatFeatureKind(evidence.providerType)}`
      : null,
    evidence.providerPriority != null
      ? `priority ${evidence.providerPriority}`
      : null,
    evidence.providerProfileId ? `profile ${evidence.providerProfileId}` : null,
    evidence.providerProfileSource
      ? `profile source ${formatFeatureKind(evidence.providerProfileSource)}`
      : null,
    evidence.providerProfileConfigPath
      ? `profile path ${evidence.providerProfileConfigPath}`
      : null,
    evidence.providerConfiguredModelCount != null
      ? `configured models ${evidence.providerConfiguredModelCount}`
      : null,
    evidence.providerConfiguredModelIds?.length
      ? `configured model ids ${evidence.providerConfiguredModelIds.join(', ')}`
      : null,
    evidence.requestedModelId ? `requested ${evidence.requestedModelId}` : null,
    evidence.requestedModelSource
      ? `requested source ${formatAIModelTaskModelSourceLabel(evidence.requestedModelSource)}`
      : null,
    evidence.requestedModelConfigKey
      ? `requested config key ${evidence.requestedModelConfigKey}`
      : null,
    evidence.requestedModelConfigPath
      ? `requested config path ${evidence.requestedModelConfigPath}`
      : null,
    evidence.requestedDimensions != null
      ? `requested ${evidence.requestedDimensions}d`
      : null,
    evidence.modelEmbeddingDimensions != null
      ? `model dimensions ${evidence.modelEmbeddingDimensions}d`
      : null,
    evidence.dimensionMismatch != null
      ? `dimension mismatch ${evidence.dimensionMismatch ? 'yes' : 'no'}`
      : null,
    evidence.routeInputTypes?.length
      ? `input ${evidence.routeInputTypes.join(', ')}`
      : null,
    evidence.routeOutputTypes?.length
      ? `output ${evidence.routeOutputTypes.join(', ')}`
      : null,
    evidence.routeAttachmentKinds?.length
      ? `attachments ${evidence.routeAttachmentKinds.join(', ')}`
      : null,
    evidence.routeAttachmentSourceKinds?.length
      ? `attachment sources ${evidence.routeAttachmentSourceKinds.join(', ')}`
      : null,
    evidence.routeAttachmentAllowRemoteUrls != null
      ? `remote attachments ${evidence.routeAttachmentAllowRemoteUrls ? 'yes' : 'no'}`
      : null,
    evidence.routeStructuredAttachmentKinds?.length
      ? `structured attachments ${evidence.routeStructuredAttachmentKinds.join(
          ', '
        )}`
      : null,
    evidence.routeStructuredAttachmentSourceKinds?.length
      ? `structured attachment sources ${evidence.routeStructuredAttachmentSourceKinds.join(
          ', '
        )}`
      : null,
    evidence.routeStructuredAttachmentAllowRemoteUrls != null
      ? `structured remote attachments ${
          evidence.routeStructuredAttachmentAllowRemoteUrls ? 'yes' : 'no'
        }`
      : null,
    evidence.routeContextWindow != null
      ? `context ${evidence.routeContextWindow}`
      : null,
    evidence.routeMaxOutputTokens != null
      ? `max output ${evidence.routeMaxOutputTokens}`
      : null,
    evidence.routeEmbeddingDimensions != null
      ? `embedding ${evidence.routeEmbeddingDimensions}`
      : null,
    evidence.costInputPer1M != null
      ? `input cost ${evidence.costInputPer1M}/1M`
      : null,
    evidence.costOutputPer1M != null
      ? `output cost ${evidence.costOutputPer1M}/1M`
      : null,
    evidence.modelId ? `model ${evidence.modelId}` : null,
    evidence.preparedModelId ? `prepared ${evidence.preparedModelId}` : null,
    evidence.privacy
      ? `privacy ${formatProviderMetadata(evidence.privacy, PROVIDER_PRIVACY_LABELS)}`
      : null,
    evidence.health
      ? `health ${formatProviderMetadata(evidence.health, PROVIDER_HEALTH_LABELS)}`
      : null,
    evidence.healthCheckedAt ? `checked ${evidence.healthCheckedAt}` : null,
    evidence.errorCode ? `code ${evidence.errorCode}` : null,
    evidence.errorCategory
      ? `category ${formatFeatureKind(evidence.errorCategory)}`
      : null,
    evidence.registryKind ? `registry ${evidence.registryKind}` : null,
    evidence.registryAvailable != null
      ? `registry available ${evidence.registryAvailable ? 'yes' : 'no'}`
      : null,
    evidence.registrySelected != null
      ? `registry selected ${evidence.registrySelected ? 'yes' : 'no'}`
      : null,
    evidence.prepareCandidateSnapshotFingerprint
      ? `prepare snapshot fingerprint ${evidence.prepareCandidateSnapshotFingerprint}`
      : null,
    evidence.preparedRouteOrderFingerprint
      ? `prepared route order fingerprint ${evidence.preparedRouteOrderFingerprint}`
      : null,
    evidence.preparedRouteSnapshotFingerprint
      ? `prepared route snapshot fingerprint ${evidence.preparedRouteSnapshotFingerprint}`
      : null,
    evidence.preparedRoutes
      ? `prepared routes ${evidence.preparedRoutes.length}`
      : null,
    ...(evidence.preparedRoutes?.map(
      preparedRoute =>
        `prepared route ${formatTaskRoutePreparedRouteText(preparedRoute)}`
    ) ?? []),
    evidence.providerCapabilitySnapshotFingerprint
      ? `provider capability snapshot fingerprint ${evidence.providerCapabilitySnapshotFingerprint}`
      : null,
    evidence.providerCostSnapshotFingerprint
      ? `provider cost snapshot fingerprint ${evidence.providerCostSnapshotFingerprint}`
      : null,
    evidence.providerHealthSnapshotFingerprint
      ? `provider health snapshot fingerprint ${evidence.providerHealthSnapshotFingerprint}`
      : null,
    evidence.providerLimitSnapshotFingerprint
      ? `provider limit snapshot fingerprint ${evidence.providerLimitSnapshotFingerprint}`
      : null,
    evidence.taskRouteDimensionSnapshotFingerprint
      ? `task route dimension snapshot fingerprint ${evidence.taskRouteDimensionSnapshotFingerprint}`
      : null,
    evidence.taskRouteModelSourceSnapshotFingerprint
      ? `task route model source snapshot fingerprint ${evidence.taskRouteModelSourceSnapshotFingerprint}`
      : null,
    evidence.preparedRouteTargets?.length
      ? `targets ${evidence.preparedRouteTargets.join(', ')}`
      : null,
    evidence.preparedRouteTargetFingerprint
      ? `target fingerprint ${evidence.preparedRouteTargetFingerprint}`
      : null,
    evidence.routeModelDefinitionSource
      ? `definition source ${formatFeatureKind(evidence.routeModelDefinitionSource)}`
      : null,
    evidence.routeModelDefinitionId
      ? `definition ${evidence.routeModelDefinitionId}`
      : null,
    evidence.routeModelDefinitionAliases?.length
      ? `definition aliases ${evidence.routeModelDefinitionAliases.join(', ')}`
      : null,
    evidence.routeModelAliasMatched != null
      ? `alias matched ${evidence.routeModelAliasMatched ? 'yes' : 'no'}`
      : null,
    evidence.routeRawModelId ? `raw model ${evidence.routeRawModelId}` : null,
    evidence.candidateModelIds?.length
      ? `candidate models ${evidence.candidateModelIds.join(', ')}`
      : null,
    evidence.diagnosticsErrorSnapshotFingerprint
      ? `diagnostics error snapshot fingerprint ${evidence.diagnosticsErrorSnapshotFingerprint}`
      : null,
    evidence.diagnosticsErrors?.length
      ? `diagnostics errors ${evidence.diagnosticsErrors
          .map(formatTaskRouteDiagnosticsErrorText)
          .join(' | ')}`
      : null,
    evidence.fallbackProviderIds?.length
      ? `fallback ${evidence.fallbackProviderIds.join(' -> ')}`
      : null,
    evidence.routeTracePhases?.length
      ? `route phases ${evidence.routeTracePhases.join(' -> ')}`
      : null,
    evidence.routeTraceSnapshotFingerprint
      ? `route trace snapshot fingerprint ${evidence.routeTraceSnapshotFingerprint}`
      : null,
    evidence.routeTrace?.length
      ? `route trace ${evidence.routeTrace
          .map(formatPromptRegistryPublishGateRoutePhaseText)
          .join(' | ')}`
      : null,
    evidence.policyCandidateSnapshotFingerprint
      ? `policy snapshot fingerprint ${evidence.policyCandidateSnapshotFingerprint}`
      : null,
    evidence.policyCandidates?.length
      ? `policy candidates ${evidence.policyCandidates
          .map(formatPromptRegistryPublishGatePolicyCandidate)
          .join(' | ')}`
      : null,
    evidence.routeCandidateSnapshotFingerprint
      ? `route snapshot fingerprint ${evidence.routeCandidateSnapshotFingerprint}`
      : null,
    evidence.reasons.length ? `reasons ${evidence.reasons.join(', ')}` : null,
  ]);
}

function formatPromptRegistryPublishGateRepairCandidateEvidenceScope(
  scope: string
) {
  return (
    {
      policyCandidate: 'Policy Candidate',
      prepareCandidate: 'Prepare Candidate',
      routeCandidate: 'Route Candidate',
    }[scope] ?? formatFeatureKind(scope)
  );
}

function formatPromptRegistryPublishGateRepairActionCatalogEntry(
  entry: PromptRegistryPublishGateVerdict['repairActionCatalog'][number]
) {
  return compactList([
    `action catalog ${entry.catalogVersion}`,
    `action kind ${formatFeatureKind(entry.actionKind)}`,
    `safety ${formatFeatureKind(entry.safety)}`,
    `recommendations ${entry.recommendationCount}`,
    entry.requiredCapabilities.length
      ? `required capabilities ${entry.requiredCapabilities.join(', ')}`
      : null,
    `input schema ${formatRepairRecommendationInputSchema(entry.inputSchema)}`,
  ]);
}

function formatPromptRegistryPublishGateRepairActionMutationGuard(
  guard: PromptRegistryPublishGateVerdict['repairActionMutationGuard']
) {
  return compactList([
    guard.required ? 'required yes' : 'required no',
    `fingerprint ${guard.guardFingerprint}`,
    `audit fingerprint ${guard.auditSummaryFingerprint}`,
    `audit summary ${guard.auditSummary}`,
    `catalog ${guard.catalogVersion}`,
    `catalog fingerprint ${guard.catalogFingerprint}`,
    `intent fingerprint ${guard.intentFingerprint}`,
    `input schema fingerprint ${guard.inputSchemaFingerprint}`,
    `target locator fingerprint ${guard.targetLocatorFingerprint}`,
    `target locators ${guard.targetLocatorCount}`,
    guard.targetLocatorKinds.length
      ? `target locator kinds ${guard.targetLocatorKinds.map(formatFeatureKind).join(', ')}`
      : 'target locator kinds none',
    `expected registry ${guard.expectedRegistryId}`,
    `expected fingerprint ${guard.expectedRegistryFingerprint}`,
    `expected updated ${guard.expectedRegistryUpdatedAt}`,
    `recommendations ${guard.recommendationCount}`,
    guard.recommendationCategories.length
      ? `recommendation categories ${guard.recommendationCategories.map(formatFeatureKind).join(', ')}`
      : 'recommendation categories none',
    guard.recommendationCodes.length
      ? `recommendation codes ${guard.recommendationCodes.join(', ')}`
      : 'recommendation codes none',
    guard.suggestedActionKinds.length
      ? `suggested actions ${guard.suggestedActionKinds.map(formatFeatureKind).join(', ')}`
      : 'suggested actions none',
    guard.requiredCapabilities.length
      ? `required capabilities ${guard.requiredCapabilities.join(', ')}`
      : 'required capabilities none',
    guard.requiredReviewModes.length
      ? `review modes ${guard.requiredReviewModes.map(formatFeatureKind).join(', ')}`
      : 'review modes none',
    guard.safetyLevels.length
      ? `safety levels ${guard.safetyLevels.map(formatFeatureKind).join(', ')}`
      : 'safety levels none',
    guard.recommendationFingerprints.length
      ? `recommendation fingerprints ${guard.recommendationFingerprints.join(', ')}`
      : 'recommendation fingerprints none',
  ]);
}

function formatPromptRegistryPublishGateRepairActionPreview(
  preview: PromptRegistryPublishGateVerdict['repairActionPreview']
) {
  const submission = preview.submissionContract;

  return compactList([
    `status ${formatFeatureKind(preview.status)}`,
    preview.readOnly ? 'read-only yes' : 'read-only no',
    `fingerprint ${preview.previewFingerprint}`,
    `guard fingerprint ${preview.guardFingerprint}`,
    `audit fingerprint ${preview.auditSummaryFingerprint}`,
    `authorization ${formatFeatureKind(preview.authorizationStatus)}`,
    `authorization fingerprint ${preview.authorizationFingerprint}`,
    `candidate evidence set fingerprint ${preview.candidateEvidenceSetFingerprint}`,
    `prepared route order evidence set fingerprint ${preview.preparedRouteOrderEvidenceSetFingerprint}`,
    `approval policy ${preview.approvalPolicyVersion}`,
    `approval policy fingerprint ${preview.approvalPolicyFingerprint}`,
    preview.approvalRequired ? 'approval required yes' : 'approval required no',
    preview.approvalModes.length
      ? `approval modes ${preview.approvalModes.map(formatFeatureKind).join(', ')}`
      : 'approval modes none',
    preview.approvalCheckpoints.length
      ? `approval checkpoints ${preview.approvalCheckpoints.map(formatFeatureKind).join(', ')}`
      : 'approval checkpoints none',
    preview.requiredCapabilities.length
      ? `required capabilities ${preview.requiredCapabilities.join(', ')}`
      : 'required capabilities none',
    `catalog ${preview.catalogVersion}`,
    `catalog fingerprint ${preview.catalogFingerprint}`,
    `operation set fingerprint ${preview.operationSetFingerprint}`,
    preview.operationFingerprints.length
      ? `operation fingerprints ${preview.operationFingerprints.join(', ')}`
      : 'operation fingerprints none',
    `target locator fingerprint ${submission.targetLocatorFingerprint}`,
    `submission contract ${submission.contractVersion}`,
    `submission fingerprint ${submission.submissionFingerprint}`,
    `submission candidate evidence set fingerprint ${submission.candidateEvidenceSetFingerprint}`,
    `submission prepared route order evidence set fingerprint ${submission.preparedRouteOrderEvidenceSetFingerprint}`,
    `submission status ${formatFeatureKind(submission.status)}`,
    submission.readOnly
      ? 'submission read-only yes'
      : 'submission read-only no',
    submission.mutationAvailable
      ? 'mutation available yes'
      : 'mutation available no',
    `idempotency key ${submission.idempotencyKey}`,
    `submission expected registry ${submission.expectedRegistryId}`,
    `submission expected fingerprint ${submission.expectedRegistryFingerprint}`,
    `submission expected updated ${submission.expectedRegistryUpdatedAt}`,
    submission.requiredInputs.length
      ? `submission required inputs ${submission.requiredInputs.join(', ')}`
      : 'submission required inputs none',
    `candidates ${preview.candidateCount}`,
    `operations ${preview.operations.length}`,
  ]);
}

function formatPromptRegistryRepairPreflight(
  preflight: PromptRegistryRepairPreflight
) {
  return compactList([
    `status ${formatFeatureKind(preflight.status)}`,
    preflight.readOnly ? 'read-only yes' : 'read-only no',
    preflight.mutationAvailable
      ? 'mutation available yes'
      : 'mutation available no',
    preflight.accepted ? 'accepted yes' : 'accepted no',
    `execution gate ${preflight.executionGateVersion}`,
    `execution gate status ${formatFeatureKind(preflight.executionGateStatus)}`,
    `execution gate fingerprint ${preflight.executionGateFingerprint}`,
    preflight.executionGateInputs.length
      ? `execution gate inputs ${preflight.executionGateInputs.join(', ')}`
      : 'execution gate inputs none',
    `approval request ${preflight.approvalRequestVersion}`,
    `approval request status ${formatFeatureKind(preflight.approvalRequestStatus)}`,
    preflight.approvalRequired
      ? 'approval required yes'
      : 'approval required no',
    `authorization status ${formatFeatureKind(preflight.authorizationStatus)}`,
    `candidate evidence set fingerprint ${preflight.candidateEvidenceSetFingerprint}`,
    `prepared route order evidence set fingerprint ${preflight.preparedRouteOrderEvidenceSetFingerprint}`,
    `expected candidate evidence set fingerprint ${preflight.expectedCandidateEvidenceSetFingerprint}`,
    `expected prepared route order evidence set fingerprint ${preflight.expectedPreparedRouteOrderEvidenceSetFingerprint}`,
    `target locator fingerprint ${preflight.targetLocatorFingerprint}`,
    `expected target locator fingerprint ${preflight.expectedTargetLocatorFingerprint}`,
    `approval request fingerprint ${preflight.approvalRequestFingerprint}`,
    preflight.approvalModes.length
      ? `approval modes ${preflight.approvalModes.map(formatFeatureKind).join(', ')}`
      : 'approval modes none',
    preflight.approvalCheckpoints.length
      ? `approval checkpoints ${preflight.approvalCheckpoints.map(formatFeatureKind).join(', ')}`
      : 'approval checkpoints none',
    preflight.approvalRequestInputs.length
      ? `approval request inputs ${preflight.approvalRequestInputs.join(', ')}`
      : 'approval request inputs none',
    `approval record ${preflight.approvalRecordVersion}`,
    `approval record status ${formatFeatureKind(preflight.approvalRecordStatus)}`,
    preflight.approvalRecordCreated
      ? 'approval record created yes'
      : 'approval record created no',
    `approval record fingerprint ${preflight.approvalRecordFingerprint}`,
    preflight.approvalRecordInputs.length
      ? `approval record inputs ${preflight.approvalRecordInputs.join(', ')}`
      : 'approval record inputs none',
    `actor ${preflight.actorSnapshotVersion}`,
    `actor status ${formatFeatureKind(preflight.actorSnapshotStatus)}`,
    `actor type ${formatFeatureKind(preflight.actorType)}`,
    `actor fingerprint ${preflight.actorFingerprint}`,
    preflight.actorSnapshotInputs.length
      ? `actor inputs ${preflight.actorSnapshotInputs.join(', ')}`
      : 'actor inputs none',
    `audit binding ${preflight.auditBindingVersion}`,
    `audit binding status ${formatFeatureKind(preflight.auditBindingStatus)}`,
    `audit binding fingerprint ${preflight.auditBindingFingerprint}`,
    preflight.auditBindingInputs.length
      ? `audit binding inputs ${preflight.auditBindingInputs.join(', ')}`
      : 'audit binding inputs none',
    `audit event ${preflight.auditEventVersion}`,
    `audit event status ${formatFeatureKind(preflight.auditEventStatus)}`,
    preflight.auditEventCreated
      ? 'audit event created yes'
      : 'audit event created no',
    `audit event fingerprint ${preflight.auditEventFingerprint}`,
    preflight.auditEventInputs.length
      ? `audit event inputs ${preflight.auditEventInputs.join(', ')}`
      : 'audit event inputs none',
    `execution state ${preflight.executionStateVersion}`,
    `execution state status ${formatFeatureKind(preflight.executionStateStatus)}`,
    preflight.executionStateCreated
      ? 'execution state created yes'
      : 'execution state created no',
    `execution state fingerprint ${preflight.executionStateFingerprint}`,
    preflight.executionStateInputs.length
      ? `execution state inputs ${preflight.executionStateInputs.join(', ')}`
      : 'execution state inputs none',
    `rollback plan ${preflight.rollbackPlanVersion}`,
    `rollback plan status ${formatFeatureKind(preflight.rollbackPlanStatus)}`,
    preflight.rollbackPlanCreated
      ? 'rollback plan created yes'
      : 'rollback plan created no',
    `rollback plan fingerprint ${preflight.rollbackPlanFingerprint}`,
    preflight.rollbackPlanInputs.length
      ? `rollback plan inputs ${preflight.rollbackPlanInputs.join(', ')}`
      : 'rollback plan inputs none',
    `policy binding ${preflight.policyBindingVersion}`,
    `policy binding status ${formatFeatureKind(preflight.policyBindingStatus)}`,
    `policy source ${formatFeatureKind(preflight.policySource)}`,
    `policy binding fingerprint ${preflight.policyBindingFingerprint}`,
    preflight.policyBindingInputs.length
      ? `policy binding inputs ${preflight.policyBindingInputs.join(', ')}`
      : 'policy binding inputs none',
    `permission ${formatFeatureKind(preflight.permissionStatus)}`,
    preflight.permissionChecked
      ? 'permission checked yes'
      : 'permission checked no',
    `permission mode ${formatFeatureKind(preflight.permissionCheckMode)}`,
    `permission scope ${formatFeatureKind(preflight.permissionScope)}`,
    preflight.workspaceId
      ? `permission workspace ${preflight.workspaceId}`
      : 'permission workspace none',
    `required permission ${preflight.requiredPermission}`,
    `permission fingerprint ${preflight.permissionFingerprint}`,
    `capability ${formatFeatureKind(preflight.capabilityStatus)}`,
    `capability mode ${formatFeatureKind(preflight.capabilityCheckMode)}`,
    `capability source ${formatFeatureKind(preflight.capabilitySource)}`,
    `capability fingerprint ${preflight.capabilityFingerprint}`,
    `required capabilities ${preflight.requiredCapabilityCount}`,
    preflight.requiredCapabilities.length
      ? `capability set ${preflight.requiredCapabilities.join(', ')}`
      : 'capability set none',
    `review binding ${preflight.reviewBindingVersion}`,
    `review binding status ${formatFeatureKind(preflight.reviewBindingStatus)}`,
    `review binding fingerprint ${preflight.reviewBindingFingerprint}`,
    preflight.reviewBindingInputs.length
      ? `review binding inputs ${preflight.reviewBindingInputs.join(', ')}`
      : 'review binding inputs none',
    `idempotency ${preflight.idempotencyVersion}`,
    `idempotency status ${formatFeatureKind(preflight.idempotencyStatus)}`,
    `idempotency scope ${formatFeatureKind(preflight.idempotencyScope)}`,
    preflight.idempotencyLockAcquired
      ? 'idempotency lock acquired yes'
      : 'idempotency lock acquired no',
    `idempotency key ${preflight.idempotencyKey}`,
    `idempotency fingerprint ${preflight.idempotencyFingerprint}`,
    `repair job ${preflight.repairJobVersion}`,
    `repair job status ${formatFeatureKind(preflight.repairJobStatus)}`,
    preflight.repairJobCreated
      ? 'repair job created yes'
      : 'repair job created no',
    `repair job fingerprint ${preflight.repairJobFingerprint}`,
    preflight.repairJobInputs.length
      ? `repair job inputs ${preflight.repairJobInputs.join(', ')}`
      : 'repair job inputs none',
    `contract ${preflight.contractVersion}`,
    `current submission ${preflight.currentSubmissionFingerprint}`,
    `expected submission ${preflight.expectedSubmissionFingerprint}`,
    preflight.matchedFields.length
      ? `matched fields ${preflight.matchedFields.join(', ')}`
      : 'matched fields none',
    preflight.mismatchedFields.length
      ? `mismatched fields ${preflight.mismatchedFields.join(', ')}`
      : 'mismatched fields none',
  ]);
}

function formatPromptRegistryRepairExecutionRequest(
  request: PromptRegistryRepairExecutionRequest
) {
  return compactList([
    `version ${request.requestVersion}`,
    `status ${formatFeatureKind(request.requestStatus)}`,
    request.readOnly ? 'read-only yes' : 'read-only no',
    request.mutationAvailable
      ? 'mutation available yes'
      : 'mutation available no',
    request.accepted ? 'accepted yes' : 'accepted no',
    request.executionRequested
      ? 'execution requested yes'
      : 'execution requested no',
    `expected candidate evidence set fingerprint ${request.expectedCandidateEvidenceSetFingerprint}`,
    `expected prepared route order evidence set fingerprint ${request.expectedPreparedRouteOrderEvidenceSetFingerprint}`,
    `expected target locator fingerprint ${request.expectedTargetLocatorFingerprint}`,
    `approval record request ${request.approvalRecordRequestVersion}`,
    `approval record request status ${formatFeatureKind(
      request.approvalRecordRequestStatus
    )}`,
    request.approvalRecordRequestCreated
      ? 'approval record request created yes'
      : 'approval record request created no',
    `approval record request fingerprint ${request.approvalRecordRequestFingerprint}`,
    request.approvalRecordRequestInputs.length
      ? `approval record request inputs ${request.approvalRecordRequestInputs.join(
          ', '
        )}`
      : 'approval record request inputs none',
    `audit event request ${request.auditEventRequestVersion}`,
    `audit event request status ${formatFeatureKind(
      request.auditEventRequestStatus
    )}`,
    request.auditEventRequestCreated
      ? 'audit event request created yes'
      : 'audit event request created no',
    `audit event request fingerprint ${request.auditEventRequestFingerprint}`,
    request.auditEventRequestInputs.length
      ? `audit event request inputs ${request.auditEventRequestInputs.join(
          ', '
        )}`
      : 'audit event request inputs none',
    `execution completion event request ${request.executionCompletionEventRequestVersion}`,
    `execution completion event request status ${formatFeatureKind(
      request.executionCompletionEventRequestStatus
    )}`,
    request.executionCompletionEventRequestCreated
      ? 'execution completion event request created yes'
      : 'execution completion event request created no',
    `execution completion event request fingerprint ${request.executionCompletionEventRequestFingerprint}`,
    request.executionCompletionEventRequestInputs.length
      ? `execution completion event request inputs ${request.executionCompletionEventRequestInputs.join(
          ', '
        )}`
      : 'execution completion event request inputs none',
    `execution completion request ${request.executionCompletionRequestVersion}`,
    `execution completion request status ${formatFeatureKind(
      request.executionCompletionRequestStatus
    )}`,
    request.executionCompletionRequestCreated
      ? 'execution completion request created yes'
      : 'execution completion request created no',
    `execution completion request fingerprint ${request.executionCompletionRequestFingerprint}`,
    request.executionCompletionRequestInputs.length
      ? `execution completion request inputs ${request.executionCompletionRequestInputs.join(
          ', '
        )}`
      : 'execution completion request inputs none',
    `execution finalization event request ${request.executionFinalizationEventRequestVersion}`,
    `execution finalization event request status ${formatFeatureKind(
      request.executionFinalizationEventRequestStatus
    )}`,
    request.executionFinalizationEventRequestCreated
      ? 'execution finalization event request created yes'
      : 'execution finalization event request created no',
    `execution finalization event request fingerprint ${request.executionFinalizationEventRequestFingerprint}`,
    request.executionFinalizationEventRequestInputs.length
      ? `execution finalization event request inputs ${request.executionFinalizationEventRequestInputs.join(
          ', '
        )}`
      : 'execution finalization event request inputs none',
    `execution finalization request ${request.executionFinalizationRequestVersion}`,
    `execution finalization request status ${formatFeatureKind(
      request.executionFinalizationRequestStatus
    )}`,
    request.executionFinalizationRequestCreated
      ? 'execution finalization request created yes'
      : 'execution finalization request created no',
    `execution finalization request fingerprint ${request.executionFinalizationRequestFingerprint}`,
    request.executionFinalizationRequestInputs.length
      ? `execution finalization request inputs ${request.executionFinalizationRequestInputs.join(
          ', '
        )}`
      : 'execution finalization request inputs none',
    `execution status poll request ${request.executionStatusPollRequestVersion}`,
    `execution status poll request status ${formatFeatureKind(
      request.executionStatusPollRequestStatus
    )}`,
    request.executionStatusPollRequestCreated
      ? 'execution status poll request created yes'
      : 'execution status poll request created no',
    `execution status poll request fingerprint ${request.executionStatusPollRequestFingerprint}`,
    request.executionStatusPollRequestInputs.length
      ? `execution status poll request inputs ${request.executionStatusPollRequestInputs.join(
          ', '
        )}`
      : 'execution status poll request inputs none',
    `execution operation entry request ${request.executionOperationEntryRequestVersion}`,
    `execution operation entry request status ${formatFeatureKind(
      request.executionOperationEntryRequestStatus
    )}`,
    request.executionOperationEntryRequestCreated
      ? 'execution operation entry request created yes'
      : 'execution operation entry request created no',
    `execution operation entry request fingerprint ${request.executionOperationEntryRequestFingerprint}`,
    request.executionOperationEntryRequestInputs.length
      ? `execution operation entry request inputs ${request.executionOperationEntryRequestInputs.join(
          ', '
        )}`
      : 'execution operation entry request inputs none',
    `execution approval UI request ${request.executionApprovalUiRequestVersion}`,
    `execution approval UI request status ${formatFeatureKind(
      request.executionApprovalUiRequestStatus
    )}`,
    request.executionApprovalUiRequestCreated
      ? 'execution approval UI request created yes'
      : 'execution approval UI request created no',
    `execution approval UI request fingerprint ${request.executionApprovalUiRequestFingerprint}`,
    request.executionApprovalUiRequestInputs.length
      ? `execution approval UI request inputs ${request.executionApprovalUiRequestInputs.join(
          ', '
        )}`
      : 'execution approval UI request inputs none',
    `execution diff preview request ${request.executionDiffPreviewRequestVersion}`,
    `execution diff preview request status ${formatFeatureKind(
      request.executionDiffPreviewRequestStatus
    )}`,
    request.executionDiffPreviewRequestCreated
      ? 'execution diff preview request created yes'
      : 'execution diff preview request created no',
    `execution diff preview request fingerprint ${request.executionDiffPreviewRequestFingerprint}`,
    request.executionDiffPreviewRequestInputs.length
      ? `execution diff preview request inputs ${request.executionDiffPreviewRequestInputs.join(
          ', '
        )}`
      : 'execution diff preview request inputs none',
    `execution approval decision request ${request.executionApprovalDecisionRequestVersion}`,
    `execution approval decision request status ${formatFeatureKind(
      request.executionApprovalDecisionRequestStatus
    )}`,
    request.executionApprovalDecisionRequestCreated
      ? 'execution approval decision request created yes'
      : 'execution approval decision request created no',
    `execution approval decision request fingerprint ${request.executionApprovalDecisionRequestFingerprint}`,
    request.executionApprovalDecisionRequestInputs.length
      ? `execution approval decision request inputs ${request.executionApprovalDecisionRequestInputs.join(
          ', '
        )}`
      : 'execution approval decision request inputs none',
    `execution start request ${request.executionStartRequestVersion}`,
    `execution start request status ${formatFeatureKind(
      request.executionStartRequestStatus
    )}`,
    request.executionStartRequestCreated
      ? 'execution start request created yes'
      : 'execution start request created no',
    `execution start request fingerprint ${request.executionStartRequestFingerprint}`,
    request.executionStartRequestInputs.length
      ? `execution start request inputs ${request.executionStartRequestInputs.join(
          ', '
        )}`
      : 'execution start request inputs none',
    `execution queue request ${request.executionQueueRequestVersion}`,
    `execution queue request status ${formatFeatureKind(
      request.executionQueueRequestStatus
    )}`,
    request.executionQueueRequestCreated
      ? 'execution queue request created yes'
      : 'execution queue request created no',
    `execution queue request fingerprint ${request.executionQueueRequestFingerprint}`,
    request.executionQueueRequestInputs.length
      ? `execution queue request inputs ${request.executionQueueRequestInputs.join(
          ', '
        )}`
      : 'execution queue request inputs none',
    `execution worker lease request ${request.executionWorkerLeaseRequestVersion}`,
    `execution worker lease request status ${formatFeatureKind(
      request.executionWorkerLeaseRequestStatus
    )}`,
    request.executionWorkerLeaseRequestCreated
      ? 'execution worker lease request created yes'
      : 'execution worker lease request created no',
    `execution worker lease request fingerprint ${request.executionWorkerLeaseRequestFingerprint}`,
    request.executionWorkerLeaseRequestInputs.length
      ? `execution worker lease request inputs ${request.executionWorkerLeaseRequestInputs.join(
          ', '
        )}`
      : 'execution worker lease request inputs none',
    `execution job run request ${request.executionJobRunRequestVersion}`,
    `execution job run request status ${formatFeatureKind(
      request.executionJobRunRequestStatus
    )}`,
    request.executionJobRunRequestCreated
      ? 'execution job run request created yes'
      : 'execution job run request created no',
    `execution job run request fingerprint ${request.executionJobRunRequestFingerprint}`,
    request.executionJobRunRequestInputs.length
      ? `execution job run request inputs ${request.executionJobRunRequestInputs.join(
          ', '
        )}`
      : 'execution job run request inputs none',
    `execution run step request ${request.executionRunStepRequestVersion}`,
    `execution run step request status ${formatFeatureKind(
      request.executionRunStepRequestStatus
    )}`,
    request.executionRunStepRequestCreated
      ? 'execution run step request created yes'
      : 'execution run step request created no',
    `execution run step request fingerprint ${request.executionRunStepRequestFingerprint}`,
    request.executionRunStepRequestInputs.length
      ? `execution run step request inputs ${request.executionRunStepRequestInputs.join(
          ', '
        )}`
      : 'execution run step request inputs none',
    `execution run step trace request ${request.executionRunStepTraceRequestVersion}`,
    `execution run step trace request status ${formatFeatureKind(
      request.executionRunStepTraceRequestStatus
    )}`,
    request.executionRunStepTraceRequestCreated
      ? 'execution run step trace request created yes'
      : 'execution run step trace request created no',
    `execution run step trace request fingerprint ${request.executionRunStepTraceRequestFingerprint}`,
    request.executionRunStepTraceRequestInputs.length
      ? `execution run step trace request inputs ${request.executionRunStepTraceRequestInputs.join(
          ', '
        )}`
      : 'execution run step trace request inputs none',
    `execution run step result request ${request.executionRunStepResultRequestVersion}`,
    `execution run step result request status ${formatFeatureKind(
      request.executionRunStepResultRequestStatus
    )}`,
    request.executionRunStepResultRequestCreated
      ? 'execution run step result request created yes'
      : 'execution run step result request created no',
    `execution run step result request fingerprint ${request.executionRunStepResultRequestFingerprint}`,
    request.executionRunStepResultRequestInputs.length
      ? `execution run step result request inputs ${request.executionRunStepResultRequestInputs.join(
          ', '
        )}`
      : 'execution run step result request inputs none',
    `execution run step completion request ${request.executionRunStepCompletionRequestVersion}`,
    `execution run step completion request status ${formatFeatureKind(
      request.executionRunStepCompletionRequestStatus
    )}`,
    request.executionRunStepCompletionRequestCreated
      ? 'execution run step completion request created yes'
      : 'execution run step completion request created no',
    `execution run step completion request fingerprint ${request.executionRunStepCompletionRequestFingerprint}`,
    request.executionRunStepCompletionRequestInputs.length
      ? `execution run step completion request inputs ${request.executionRunStepCompletionRequestInputs.join(
          ', '
        )}`
      : 'execution run step completion request inputs none',
    `execution run step status event request ${request.executionRunStepStatusEventRequestVersion}`,
    `execution run step status event request status ${formatFeatureKind(
      request.executionRunStepStatusEventRequestStatus
    )}`,
    request.executionRunStepStatusEventRequestCreated
      ? 'execution run step status event request created yes'
      : 'execution run step status event request created no',
    `execution run step status event request fingerprint ${request.executionRunStepStatusEventRequestFingerprint}`,
    request.executionRunStepStatusEventRequestInputs.length
      ? `execution run step status event request inputs ${request.executionRunStepStatusEventRequestInputs.join(
          ', '
        )}`
      : 'execution run step status event request inputs none',
    `execution run step retry request ${request.executionRunStepRetryRequestVersion}`,
    `execution run step retry request status ${formatFeatureKind(
      request.executionRunStepRetryRequestStatus
    )}`,
    request.executionRunStepRetryRequestCreated
      ? 'execution run step retry request created yes'
      : 'execution run step retry request created no',
    `execution run step retry request fingerprint ${request.executionRunStepRetryRequestFingerprint}`,
    request.executionRunStepRetryRequestInputs.length
      ? `execution run step retry request inputs ${request.executionRunStepRetryRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry request inputs none',
    `execution run step retry attempt request ${request.executionRunStepRetryAttemptRequestVersion}`,
    `execution run step retry attempt request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptRequestStatus
    )}`,
    request.executionRunStepRetryAttemptRequestCreated
      ? 'execution run step retry attempt request created yes'
      : 'execution run step retry attempt request created no',
    `execution run step retry attempt request fingerprint ${request.executionRunStepRetryAttemptRequestFingerprint}`,
    request.executionRunStepRetryAttemptRequestInputs.length
      ? `execution run step retry attempt request inputs ${request.executionRunStepRetryAttemptRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt request inputs none',
    `execution run step retry attempt status event request ${request.executionRunStepRetryAttemptStatusEventRequestVersion}`,
    `execution run step retry attempt status event request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptStatusEventRequestStatus
    )}`,
    request.executionRunStepRetryAttemptStatusEventRequestCreated
      ? 'execution run step retry attempt status event request created yes'
      : 'execution run step retry attempt status event request created no',
    `execution run step retry attempt status event request fingerprint ${request.executionRunStepRetryAttemptStatusEventRequestFingerprint}`,
    request.executionRunStepRetryAttemptStatusEventRequestInputs.length
      ? `execution run step retry attempt status event request inputs ${request.executionRunStepRetryAttemptStatusEventRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt status event request inputs none',
    `execution run step retry attempt trace request ${request.executionRunStepRetryAttemptTraceRequestVersion}`,
    `execution run step retry attempt trace request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptTraceRequestStatus
    )}`,
    request.executionRunStepRetryAttemptTraceRequestCreated
      ? 'execution run step retry attempt trace request created yes'
      : 'execution run step retry attempt trace request created no',
    `execution run step retry attempt trace request fingerprint ${request.executionRunStepRetryAttemptTraceRequestFingerprint}`,
    request.executionRunStepRetryAttemptTraceRequestInputs.length
      ? `execution run step retry attempt trace request inputs ${request.executionRunStepRetryAttemptTraceRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt trace request inputs none',
    `execution run step retry attempt result request ${request.executionRunStepRetryAttemptResultRequestVersion}`,
    `execution run step retry attempt result request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptResultRequestStatus
    )}`,
    request.executionRunStepRetryAttemptResultRequestCreated
      ? 'execution run step retry attempt result request created yes'
      : 'execution run step retry attempt result request created no',
    `execution run step retry attempt result request fingerprint ${request.executionRunStepRetryAttemptResultRequestFingerprint}`,
    request.executionRunStepRetryAttemptResultRequestInputs.length
      ? `execution run step retry attempt result request inputs ${request.executionRunStepRetryAttemptResultRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt result request inputs none',
    `execution run step retry attempt completion request ${request.executionRunStepRetryAttemptCompletionRequestVersion}`,
    `execution run step retry attempt completion request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptCompletionRequestStatus
    )}`,
    request.executionRunStepRetryAttemptCompletionRequestCreated
      ? 'execution run step retry attempt completion request created yes'
      : 'execution run step retry attempt completion request created no',
    `execution run step retry attempt completion request fingerprint ${request.executionRunStepRetryAttemptCompletionRequestFingerprint}`,
    request.executionRunStepRetryAttemptCompletionRequestInputs.length
      ? `execution run step retry attempt completion request inputs ${request.executionRunStepRetryAttemptCompletionRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt completion request inputs none',
    `execution run step retry attempt completion status event request ${request.executionRunStepRetryAttemptCompletionStatusEventRequestVersion}`,
    `execution run step retry attempt completion status event request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptCompletionStatusEventRequestStatus
    )}`,
    request.executionRunStepRetryAttemptCompletionStatusEventRequestCreated
      ? 'execution run step retry attempt completion status event request created yes'
      : 'execution run step retry attempt completion status event request created no',
    `execution run step retry attempt completion status event request fingerprint ${request.executionRunStepRetryAttemptCompletionStatusEventRequestFingerprint}`,
    request.executionRunStepRetryAttemptCompletionStatusEventRequestInputs
      .length
      ? `execution run step retry attempt completion status event request inputs ${request.executionRunStepRetryAttemptCompletionStatusEventRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt completion status event request inputs none',
    `execution run step retry attempt finalization request ${request.executionRunStepRetryAttemptFinalizationRequestVersion}`,
    `execution run step retry attempt finalization request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptFinalizationRequestStatus
    )}`,
    request.executionRunStepRetryAttemptFinalizationRequestCreated
      ? 'execution run step retry attempt finalization request created yes'
      : 'execution run step retry attempt finalization request created no',
    `execution run step retry attempt finalization request fingerprint ${request.executionRunStepRetryAttemptFinalizationRequestFingerprint}`,
    request.executionRunStepRetryAttemptFinalizationRequestInputs.length
      ? `execution run step retry attempt finalization request inputs ${request.executionRunStepRetryAttemptFinalizationRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt finalization request inputs none',
    `execution run step retry attempt finalization status event request ${request.executionRunStepRetryAttemptFinalizationStatusEventRequestVersion}`,
    `execution run step retry attempt finalization status event request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptFinalizationStatusEventRequestStatus
    )}`,
    request.executionRunStepRetryAttemptFinalizationStatusEventRequestCreated
      ? 'execution run step retry attempt finalization status event request created yes'
      : 'execution run step retry attempt finalization status event request created no',
    `execution run step retry attempt finalization status event request fingerprint ${request.executionRunStepRetryAttemptFinalizationStatusEventRequestFingerprint}`,
    request.executionRunStepRetryAttemptFinalizationStatusEventRequestInputs
      .length
      ? `execution run step retry attempt finalization status event request inputs ${request.executionRunStepRetryAttemptFinalizationStatusEventRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt finalization status event request inputs none',
    `execution run step retry attempt close request ${request.executionRunStepRetryAttemptCloseRequestVersion}`,
    `execution run step retry attempt close request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptCloseRequestStatus
    )}`,
    request.executionRunStepRetryAttemptCloseRequestCreated
      ? 'execution run step retry attempt close request created yes'
      : 'execution run step retry attempt close request created no',
    `execution run step retry attempt close request fingerprint ${request.executionRunStepRetryAttemptCloseRequestFingerprint}`,
    request.executionRunStepRetryAttemptCloseRequestInputs.length
      ? `execution run step retry attempt close request inputs ${request.executionRunStepRetryAttemptCloseRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt close request inputs none',
    `execution run step retry attempt close status event request ${request.executionRunStepRetryAttemptCloseStatusEventRequestVersion}`,
    `execution run step retry attempt close status event request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptCloseStatusEventRequestStatus
    )}`,
    request.executionRunStepRetryAttemptCloseStatusEventRequestCreated
      ? 'execution run step retry attempt close status event request created yes'
      : 'execution run step retry attempt close status event request created no',
    `execution run step retry attempt close status event request fingerprint ${request.executionRunStepRetryAttemptCloseStatusEventRequestFingerprint}`,
    request.executionRunStepRetryAttemptCloseStatusEventRequestInputs.length
      ? `execution run step retry attempt close status event request inputs ${request.executionRunStepRetryAttemptCloseStatusEventRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt close status event request inputs none',
    `execution run step retry attempt retention policy request ${request.executionRunStepRetryAttemptRetentionPolicyRequestVersion}`,
    `execution run step retry attempt retention policy request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptRetentionPolicyRequestStatus
    )}`,
    request.executionRunStepRetryAttemptRetentionPolicyRequestCreated
      ? 'execution run step retry attempt retention policy request created yes'
      : 'execution run step retry attempt retention policy request created no',
    `execution run step retry attempt retention policy request fingerprint ${request.executionRunStepRetryAttemptRetentionPolicyRequestFingerprint}`,
    request.executionRunStepRetryAttemptRetentionPolicyRequestInputs.length
      ? `execution run step retry attempt retention policy request inputs ${request.executionRunStepRetryAttemptRetentionPolicyRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt retention policy request inputs none',
    `execution run step retry attempt retention policy rule request ${request.executionRunStepRetryAttemptRetentionPolicyRuleRequestVersion}`,
    `execution run step retry attempt retention policy rule request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptRetentionPolicyRuleRequestStatus
    )}`,
    request.executionRunStepRetryAttemptRetentionPolicyRuleRequestCreated
      ? 'execution run step retry attempt retention policy rule request created yes'
      : 'execution run step retry attempt retention policy rule request created no',
    `execution run step retry attempt retention policy rule request fingerprint ${request.executionRunStepRetryAttemptRetentionPolicyRuleRequestFingerprint}`,
    request.executionRunStepRetryAttemptRetentionPolicyRuleRequestInputs.length
      ? `execution run step retry attempt retention policy rule request inputs ${request.executionRunStepRetryAttemptRetentionPolicyRuleRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt retention policy rule request inputs none',
    `execution run step retry attempt retention lease request ${request.executionRunStepRetryAttemptRetentionLeaseRequestVersion}`,
    `execution run step retry attempt retention lease request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptRetentionLeaseRequestStatus
    )}`,
    request.executionRunStepRetryAttemptRetentionLeaseRequestCreated
      ? 'execution run step retry attempt retention lease request created yes'
      : 'execution run step retry attempt retention lease request created no',
    `execution run step retry attempt retention lease request fingerprint ${request.executionRunStepRetryAttemptRetentionLeaseRequestFingerprint}`,
    request.executionRunStepRetryAttemptRetentionLeaseRequestInputs.length
      ? `execution run step retry attempt retention lease request inputs ${request.executionRunStepRetryAttemptRetentionLeaseRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt retention lease request inputs none',
    `execution run step retry attempt archive request ${request.executionRunStepRetryAttemptArchiveRequestVersion}`,
    `execution run step retry attempt archive request status ${formatFeatureKind(
      request.executionRunStepRetryAttemptArchiveRequestStatus
    )}`,
    request.executionRunStepRetryAttemptArchiveRequestCreated
      ? 'execution run step retry attempt archive request created yes'
      : 'execution run step retry attempt archive request created no',
    `execution run step retry attempt archive request fingerprint ${request.executionRunStepRetryAttemptArchiveRequestFingerprint}`,
    request.executionRunStepRetryAttemptArchiveRequestInputs.length
      ? `execution run step retry attempt archive request inputs ${request.executionRunStepRetryAttemptArchiveRequestInputs.join(
          ', '
        )}`
      : 'execution run step retry attempt archive request inputs none',
    `execution failure event request ${request.executionFailureEventRequestVersion}`,
    `execution failure event request status ${formatFeatureKind(
      request.executionFailureEventRequestStatus
    )}`,
    request.executionFailureEventRequestCreated
      ? 'execution failure event request created yes'
      : 'execution failure event request created no',
    `execution failure event request fingerprint ${request.executionFailureEventRequestFingerprint}`,
    request.executionFailureEventRequestInputs.length
      ? `execution failure event request inputs ${request.executionFailureEventRequestInputs.join(
          ', '
        )}`
      : 'execution failure event request inputs none',
    `execution provider response request ${request.executionProviderResponseRequestVersion}`,
    `execution provider response request status ${formatFeatureKind(
      request.executionProviderResponseRequestStatus
    )}`,
    request.executionProviderResponseRequestCreated
      ? 'execution provider response request created yes'
      : 'execution provider response request created no',
    `execution provider response request fingerprint ${request.executionProviderResponseRequestFingerprint}`,
    request.executionProviderResponseRequestInputs.length
      ? `execution provider response request inputs ${request.executionProviderResponseRequestInputs.join(
          ', '
        )}`
      : 'execution provider response request inputs none',
    `execution result request ${request.executionResultRequestVersion}`,
    `execution result request status ${formatFeatureKind(
      request.executionResultRequestStatus
    )}`,
    request.executionResultRequestCreated
      ? 'execution result request created yes'
      : 'execution result request created no',
    `execution result request fingerprint ${request.executionResultRequestFingerprint}`,
    request.executionResultRequestInputs.length
      ? `execution result request inputs ${request.executionResultRequestInputs.join(
          ', '
        )}`
      : 'execution result request inputs none',
    `execution retry policy request ${request.executionRetryPolicyRequestVersion}`,
    `execution retry policy request status ${formatFeatureKind(
      request.executionRetryPolicyRequestStatus
    )}`,
    request.executionRetryPolicyRequestCreated
      ? 'execution retry policy request created yes'
      : 'execution retry policy request created no',
    `execution retry policy request fingerprint ${request.executionRetryPolicyRequestFingerprint}`,
    request.executionRetryPolicyRequestInputs.length
      ? `execution retry policy request inputs ${request.executionRetryPolicyRequestInputs.join(
          ', '
        )}`
      : 'execution retry policy request inputs none',
    `execution rollback executor request ${request.executionRollbackExecutorRequestVersion}`,
    `execution rollback executor request status ${formatFeatureKind(
      request.executionRollbackExecutorRequestStatus
    )}`,
    request.executionRollbackExecutorRequestCreated
      ? 'execution rollback executor request created yes'
      : 'execution rollback executor request created no',
    `execution rollback executor request fingerprint ${request.executionRollbackExecutorRequestFingerprint}`,
    request.executionRollbackExecutorRequestInputs.length
      ? `execution rollback executor request inputs ${request.executionRollbackExecutorRequestInputs.join(
          ', '
        )}`
      : 'execution rollback executor request inputs none',
    `execution rollback operation request ${request.executionRollbackOperationRequestVersion}`,
    `execution rollback operation request status ${formatFeatureKind(
      request.executionRollbackOperationRequestStatus
    )}`,
    request.executionRollbackOperationRequestCreated
      ? 'execution rollback operation request created yes'
      : 'execution rollback operation request created no',
    `execution rollback operation request fingerprint ${request.executionRollbackOperationRequestFingerprint}`,
    request.executionRollbackOperationRequestInputs.length
      ? `execution rollback operation request inputs ${request.executionRollbackOperationRequestInputs.join(
          ', '
        )}`
      : 'execution rollback operation request inputs none',
    `execution rollback outcome request ${request.executionRollbackOutcomeRequestVersion}`,
    `execution rollback outcome request status ${formatFeatureKind(
      request.executionRollbackOutcomeRequestStatus
    )}`,
    request.executionRollbackOutcomeRequestCreated
      ? 'execution rollback outcome request created yes'
      : 'execution rollback outcome request created no',
    `execution rollback outcome request fingerprint ${request.executionRollbackOutcomeRequestFingerprint}`,
    request.executionRollbackOutcomeRequestInputs.length
      ? `execution rollback outcome request inputs ${request.executionRollbackOutcomeRequestInputs.join(
          ', '
        )}`
      : 'execution rollback outcome request inputs none',
    `execution rollback trigger request ${request.executionRollbackTriggerRequestVersion}`,
    `execution rollback trigger request status ${formatFeatureKind(
      request.executionRollbackTriggerRequestStatus
    )}`,
    request.executionRollbackTriggerRequestCreated
      ? 'execution rollback trigger request created yes'
      : 'execution rollback trigger request created no',
    `execution rollback trigger request fingerprint ${request.executionRollbackTriggerRequestFingerprint}`,
    request.executionRollbackTriggerRequestInputs.length
      ? `execution rollback trigger request inputs ${request.executionRollbackTriggerRequestInputs.join(
          ', '
        )}`
      : 'execution rollback trigger request inputs none',
    `execution trace request ${request.executionTraceRequestVersion}`,
    `execution trace request status ${formatFeatureKind(
      request.executionTraceRequestStatus
    )}`,
    request.executionTraceRequestCreated
      ? 'execution trace request created yes'
      : 'execution trace request created no',
    `execution trace request fingerprint ${request.executionTraceRequestFingerprint}`,
    request.executionTraceRequestInputs.length
      ? `execution trace request inputs ${request.executionTraceRequestInputs.join(
          ', '
        )}`
      : 'execution trace request inputs none',
    `execution state request ${request.executionStateRequestVersion}`,
    `execution state request status ${formatFeatureKind(
      request.executionStateRequestStatus
    )}`,
    request.executionStateRequestCreated
      ? 'execution state request created yes'
      : 'execution state request created no',
    `execution state request fingerprint ${request.executionStateRequestFingerprint}`,
    request.executionStateRequestInputs.length
      ? `execution state request inputs ${request.executionStateRequestInputs.join(
          ', '
        )}`
      : 'execution state request inputs none',
    `rollback plan request ${request.rollbackPlanRequestVersion}`,
    `rollback plan request status ${formatFeatureKind(
      request.rollbackPlanRequestStatus
    )}`,
    request.rollbackPlanRequestCreated
      ? 'rollback plan request created yes'
      : 'rollback plan request created no',
    `rollback plan request fingerprint ${request.rollbackPlanRequestFingerprint}`,
    request.rollbackPlanRequestInputs.length
      ? `rollback plan request inputs ${request.rollbackPlanRequestInputs.join(
          ', '
        )}`
      : 'rollback plan request inputs none',
    `repair job request ${request.repairJobRequestVersion}`,
    `repair job request status ${formatFeatureKind(
      request.repairJobRequestStatus
    )}`,
    request.repairJobRequestCreated
      ? 'repair job request created yes'
      : 'repair job request created no',
    `repair job request fingerprint ${request.repairJobRequestFingerprint}`,
    request.repairJobRequestInputs.length
      ? `repair job request inputs ${request.repairJobRequestInputs.join(', ')}`
      : 'repair job request inputs none',
    `idempotency lock ${request.idempotencyLockVersion}`,
    `idempotency lock status ${formatFeatureKind(
      request.idempotencyLockStatus
    )}`,
    `idempotency lock scope ${formatFeatureKind(request.idempotencyLockScope)}`,
    request.idempotencyLockAcquired
      ? 'idempotency lock acquired yes'
      : 'idempotency lock acquired no',
    `idempotency lock fingerprint ${request.idempotencyLockFingerprint}`,
    request.idempotencyLockInputs.length
      ? `idempotency lock inputs ${request.idempotencyLockInputs.join(', ')}`
      : 'idempotency lock inputs none',
    `fingerprint ${request.requestFingerprint}`,
    request.requestInputs.length
      ? `inputs ${request.requestInputs.join(', ')}`
      : 'inputs none',
    request.matchedFields.length
      ? `matched fields ${request.matchedFields.join(', ')}`
      : 'matched fields none',
    request.mismatchedFields.length
      ? `mismatched fields ${request.mismatchedFields.join(', ')}`
      : 'mismatched fields none',
    `preflight status ${formatFeatureKind(request.preflight.status)}`,
    `preflight execution gate status ${formatFeatureKind(
      request.preflight.executionGateStatus
    )}`,
    `preflight execution gate fingerprint ${request.preflight.executionGateFingerprint}`,
    `preflight approval record fingerprint ${request.preflight.approvalRecordFingerprint}`,
    `preflight approval request fingerprint ${request.preflight.approvalRequestFingerprint}`,
    `preflight audit event fingerprint ${request.preflight.auditEventFingerprint}`,
    `preflight candidate evidence set fingerprint ${request.preflight.candidateEvidenceSetFingerprint}`,
    `preflight prepared route order evidence set fingerprint ${request.preflight.preparedRouteOrderEvidenceSetFingerprint}`,
    `preflight expected prepared route order evidence set fingerprint ${request.preflight.expectedPreparedRouteOrderEvidenceSetFingerprint}`,
    `preflight execution state fingerprint ${request.preflight.executionStateFingerprint}`,
    `preflight idempotency fingerprint ${request.preflight.idempotencyFingerprint}`,
    `preflight policy binding fingerprint ${request.preflight.policyBindingFingerprint}`,
    `preflight repair job fingerprint ${request.preflight.repairJobFingerprint}`,
    `preflight review binding fingerprint ${request.preflight.reviewBindingFingerprint}`,
    `preflight rollback plan fingerprint ${request.preflight.rollbackPlanFingerprint}`,
    request.preflight.workspaceId
      ? `preflight workspace ${request.preflight.workspaceId}`
      : 'preflight workspace none',
  ]);
}

function formatPromptRegistryPublishGateRepairActionPreviewOperation(
  operation: PromptRegistryPublishGateVerdict['repairActionPreview']['operations'][number]
) {
  return compactList([
    formatFeatureKind(operation.previewStatus),
    `action kind ${formatFeatureKind(operation.actionKind)}`,
    `review ${formatFeatureKind(operation.reviewMode)}`,
    `safety ${formatFeatureKind(operation.safety)}`,
    formatFeatureKind(operation.category),
    operation.code,
    operation.target,
    operation.instanceKey ? `instance ${operation.instanceKey}` : null,
    `candidate evidence ${operation.candidateEvidenceCount}`,
    `candidate evidence fingerprint ${operation.candidateEvidenceFingerprint}`,
    operation.candidateEvidenceFingerprints.length
      ? `candidate evidence fingerprints ${operation.candidateEvidenceFingerprints.join(', ')}`
      : 'candidate evidence fingerprints none',
    operation.candidateEvidenceKeys.length
      ? `candidate evidence keys ${operation.candidateEvidenceKeys.join(', ')}`
      : 'candidate evidence keys none',
    operation.preparedRouteOrderFingerprints.length
      ? `prepared route order fingerprints ${operation.preparedRouteOrderFingerprints.join(', ')}`
      : 'prepared route order fingerprints none',
    `fingerprint ${operation.diagnosticsFingerprint}`,
    `operation fingerprint ${operation.operationFingerprint}`,
    `target locator fingerprint ${operation.targetLocatorFingerprint}`,
    operation.requiredCapabilities.length
      ? `required capabilities ${operation.requiredCapabilities.join(', ')}`
      : 'required capabilities none',
    `input schema ${formatRepairRecommendationInputSchema(
      operation.inputSchema
    )}`,
    operation.targetLocator
      ? `locator ${formatPromptRegistryPublishGateRepairTargetLocator(
          operation.targetLocator
        )}`
      : null,
  ]);
}

function formatRepairRecommendationInputSchema(schema: unknown) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return 'unknown';
  }
  const required = (schema as { required?: unknown }).required;
  return Array.isArray(required) && required.length
    ? `required ${required.join(', ')}`
    : 'no required fields';
}

function formatPromptRegistryPublishGateRepairTargetLocator(
  locator: PromptRegistryPublishGateRepairTargetLocatorLike
) {
  const providerProfileLabel = formatAIModelProviderProfileLabel({
    providerConfiguredModelCount: null,
    providerConfiguredModelIds: null,
    providerProfileConfigPath: locator.providerProfileConfigPath,
    providerProfileId: locator.providerProfileId,
    providerProfileSource: locator.providerProfileSource,
  });

  return compactList([
    locator.kind,
    locator.path,
    `registry ${locator.registryId}`,
    `fingerprint ${locator.registryFingerprint}`,
    `updated ${locator.registryUpdatedAt}`,
    locator.featureKind
      ? `feature ${formatFeatureKind(locator.featureKind)}`
      : null,
    locator.outputType
      ? `output ${formatFeatureKind(locator.outputType)}`
      : null,
    locator.candidateKind != null && locator.candidateIndex != null
      ? `candidate ${formatFeatureKind(locator.candidateKind)}#${locator.candidateIndex}`
      : null,
    locator.requestedModelId ? `requested ${locator.requestedModelId}` : null,
    locator.requestedModelConfigKey
      ? `config key ${locator.requestedModelConfigKey}`
      : null,
    locator.requestedModelConfigPath
      ? `config path ${locator.requestedModelConfigPath}`
      : null,
    locator.providerId ? `provider ${locator.providerId}` : null,
    providerProfileLabel ? `profile ${providerProfileLabel}` : null,
    locator.actionId ? `action ${locator.actionId}` : null,
    locator.stepId ? `step ${locator.stepId}` : null,
    locator.routeIndex != null ? `route #${locator.routeIndex + 1}` : null,
    locator.fallbackOrderIndex != null
      ? `fallback #${locator.fallbackOrderIndex + 1}`
      : null,
    locator.status ? `status ${formatFeatureKind(locator.status)}` : null,
  ]);
}

function formatPromptRegistryPublishGateModelRoute(
  route: PromptRegistryPublishGateModelRoute
) {
  return compactList([
    route.available ? 'Available' : 'Unavailable',
    `candidate ${formatFeatureKind(route.candidateKind)}#${route.candidateIndex}`,
    route.candidateConfigPath ? `config ${route.candidateConfigPath}` : null,
    route.checked ? 'checked yes' : 'checked no',
    route.configured ? 'configured yes' : 'configured no',
    route.diagnosticsErrorStage
      ? `diagnostics stage ${formatFeatureKind(route.diagnosticsErrorStage)}`
      : null,
    route.diagnosticsErrorCode
      ? `diagnostics code ${formatFeatureKind(route.diagnosticsErrorCode)}`
      : null,
    route.diagnosticsErrorMessage
      ? `diagnostics message ${route.diagnosticsErrorMessage}`
      : null,
    `feature ${formatFeatureKind(route.featureKind)}`,
    `output ${formatFeatureKind(route.outputType)}`,
    route.requestedModelId ? `requested ${route.requestedModelId}` : null,
    route.requestedModelSource
      ? `source ${formatAIModelTaskModelSourceLabel(route.requestedModelSource)}`
      : null,
    route.providerId ? `provider ${route.providerId}` : null,
    route.providerName ? `provider name ${route.providerName}` : null,
    route.providerSource
      ? `provider source ${formatFeatureKind(route.providerSource)}`
      : null,
    route.providerType
      ? `provider type ${formatProviderMetadata(route.providerType, PROVIDER_TYPE_LABELS)}`
      : null,
    route.providerPrivacy
      ? `provider privacy ${formatProviderMetadata(route.providerPrivacy, PROVIDER_PRIVACY_LABELS)}`
      : null,
    route.providerHealth
      ? `provider health ${formatProviderMetadata(route.providerHealth, PROVIDER_HEALTH_LABELS)}`
      : null,
    route.providerHealthCheckedAt
      ? `provider checked ${route.providerHealthCheckedAt}`
      : null,
    route.providerHealthLastError
      ? `provider error ${route.providerHealthLastError}`
      : null,
    route.providerPriority != null
      ? `provider priority ${route.providerPriority}`
      : null,
    route.providerProfileId ? `profile ${route.providerProfileId}` : null,
    route.providerProfileSource
      ? `profile source ${formatFeatureKind(route.providerProfileSource)}`
      : null,
    route.providerProfileConfigPath
      ? `profile config ${route.providerProfileConfigPath}`
      : null,
    route.providerConfiguredModelIds?.length
      ? `profile models ${route.providerConfiguredModelIds.join(', ')}`
      : null,
    route.providerConfiguredModelCount != null
      ? `profile model count ${route.providerConfiguredModelCount}`
      : null,
    route.modelId ? `model ${route.modelId}` : null,
    route.fallbackProviderIds.length
      ? `fallback ${route.fallbackProviderIds.join(' -> ')}`
      : null,
    route.protocol ? `protocol ${route.protocol}` : null,
    route.requestLayer ? `layer ${route.requestLayer}` : null,
    route.modelBackendKind ? `backend ${route.modelBackendKind}` : null,
    route.canonicalModelKey ? `canonical ${route.canonicalModelKey}` : null,
    route.behaviorFlags?.length
      ? `flags ${route.behaviorFlags.join(', ')}`
      : null,
    route.routeModelDefinitionSource
      ? `definition source ${formatFeatureKind(route.routeModelDefinitionSource)}`
      : null,
    route.routeModelDefinitionId
      ? `definition ${route.routeModelDefinitionId}`
      : null,
    route.routeRawModelId ? `raw ${route.routeRawModelId}` : null,
    route.routeModelDefinitionAliases?.length
      ? `aliases ${route.routeModelDefinitionAliases.join(', ')}`
      : null,
    route.routeModelAliasMatched ? 'alias matched' : null,
    `candidates ${route.candidateCount}`,
    `matched ${route.matchedCandidateCount}`,
    route.policyEnabled ? 'policy enabled' : 'policy disabled',
    route.policyFeatureKind
      ? `policy feature ${formatFeatureKind(route.policyFeatureKind)}`
      : null,
    route.policyWorkspaceId ? `workspace ${route.policyWorkspaceId}` : null,
    route.policyAllowedProviderIds?.length
      ? `allowed providers ${route.policyAllowedProviderIds.join(', ')}`
      : null,
    route.policyBlockedProviderIds?.length
      ? `blocked providers ${route.policyBlockedProviderIds.join(', ')}`
      : null,
    route.policyAllowedPrivacy?.length
      ? `allowed privacy ${route.policyAllowedPrivacy
          .map(value => formatProviderMetadata(value, PROVIDER_PRIVACY_LABELS))
          .join(', ')}`
      : null,
    route.policyPreferredPrivacy?.length
      ? `preferred privacy ${route.policyPreferredPrivacy
          .map(value => formatProviderMetadata(value, PROVIDER_PRIVACY_LABELS))
          .join(', ')}`
      : null,
    route.reasons.length
      ? `reasons ${route.reasons.map(formatFeatureKind).join(', ')}`
      : 'reasons none',
  ]);
}

function buildPromptCatalogDiagnosticsText(prompt: PromptCatalogItem) {
  return [
    `Prompt ${prompt.name}`,
    `Action ${prompt.action || 'None'}`,
    `Category ${formatFeatureKind(prompt.category)}`,
    `Source ${formatFeatureKind(prompt.source)}`,
    `Revision ${prompt.revision}`,
    `Fingerprint ${prompt.fingerprint}`,
    `Model strategy fingerprint ${prompt.modelStrategyFingerprint}`,
    `Template fingerprint ${prompt.templateFingerprint}`,
    `Version evidence ${buildPromptCatalogVersionEvidence(prompt)}`,
    `Override ${prompt.overrideApplied ? 'yes' : 'no'}`,
    `Default policy ${
      prompt.defaultPolicy ? formatFeatureKind(prompt.defaultPolicy) : 'None'
    }`,
    `Default model ${prompt.model}`,
    `Default model source ${formatFeatureKind(prompt.modelSource)}`,
    prompt.modelConfigPath
      ? `Default model config ${prompt.modelConfigPath}`
      : null,
    `Optional models ${prompt.optionalModelCount}${
      prompt.optionalModels.length
        ? ` / ${prompt.optionalModels.join(' -> ')}`
        : ''
    }`,
    `Optional models source ${formatFeatureKind(prompt.optionalModelsSource)}`,
    prompt.optionalModelsConfigPath
      ? `Optional models config ${prompt.optionalModelsConfigPath}`
      : null,
    `Pro models ${prompt.proModelCount}`,
    `Pro models source ${formatFeatureKind(prompt.proModelsSource)}`,
    prompt.proModelsConfigPath
      ? `Pro models config ${prompt.proModelsConfigPath}`
      : null,
    prompt.registryId != null ? `Registry id ${prompt.registryId}` : null,
    prompt.registryMessageCount != null
      ? `Registry messages ${prompt.registryMessageCount}`
      : null,
    prompt.registryModified != null
      ? `Registry modified ${prompt.registryModified ? 'yes' : 'no'}`
      : null,
    prompt.registryUpdatedAt
      ? `Registry updated ${prompt.registryUpdatedAt}`
      : null,
    prompt.registryFingerprint
      ? `Registry fingerprint ${prompt.registryFingerprint}`
      : null,
    prompt.registryValidationStatus
      ? `Registry status ${formatFeatureKind(prompt.registryValidationStatus)}`
      : null,
    prompt.registryValidationReason
      ? `Registry reason ${formatFeatureKind(prompt.registryValidationReason)}`
      : null,
    prompt.registryValidationDetail
      ? `Registry detail ${prompt.registryValidationDetail}`
      : null,
    prompt.registryValidationPublishStatus
      ? `Registry publish ${formatFeatureKind(prompt.registryValidationPublishStatus)}`
      : null,
    prompt.registryValidationBlockingCount != null
      ? `Registry blocking ${prompt.registryValidationBlockingCount}`
      : null,
    prompt.registryValidationIssueCount != null
      ? `Registry issues ${prompt.registryValidationIssueCount}`
      : null,
    prompt.registryValidationErrorCount != null
      ? `Registry errors ${prompt.registryValidationErrorCount}`
      : null,
    ...(prompt.registryValidationIssues ?? []).map(
      issue => `Registry issue ${formatPromptRegistryValidationIssue(issue)}`
    ),
    ...(prompt.registryValidationRemediations ?? []).map(
      remediation =>
        `Registry remediation ${formatPromptRegistryValidationRemediation(remediation)}`
    ),
    `Params ${prompt.paramCount}${
      prompt.paramKeys.length ? ` / ${prompt.paramKeys.join(', ')}` : ''
    }`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function PromptCatalogSourceSummary({
  configPath,
  source,
}: {
  configPath?: string | null;
  source: string;
}) {
  return (
    <div className="mt-1 space-y-0.5 break-words text-xs text-muted-foreground">
      <div>Source {formatFeatureKind(source)}</div>
      {configPath ? <div>Config {configPath}</div> : null}
    </div>
  );
}

function ActionRunTraceRoutes({
  routes,
}: {
  routes: ActionRunPreparedRouteTrace['steps'][number]['routes'];
}) {
  if (!routes.length) {
    return <span className="text-muted-foreground">No routes</span>;
  }

  return (
    <div className="space-y-1">
      {routes.map(route => (
        <div
          key={`${route.routeIndex}:${route.providerId}:${route.modelId}`}
          className="min-w-0"
        >
          <div className="break-words font-medium">
            {route.providerId}/{route.modelId}
          </div>
          <div className="break-words text-xs text-muted-foreground">
            {compactList([
              `Route #${route.routeIndex + 1}`,
              route.fallbackOrderIndex != null
                ? `Fallback #${route.fallbackOrderIndex + 1}`
                : null,
              route.protocol ? `Protocol ${route.protocol}` : null,
              route.requestLayer ? `Layer ${route.requestLayer}` : null,
            ]) || 'No protocol metadata'}
          </div>
          <div className="break-words text-xs text-muted-foreground">
            {compactList([
              route.providerName ? `Provider ${route.providerName}` : null,
              route.providerType
                ? `Type ${formatProviderMetadata(route.providerType, PROVIDER_TYPE_LABELS)}`
                : null,
              route.providerSource
                ? `Source ${formatProviderMetadata(
                    route.providerSource,
                    PROVIDER_SOURCE_LABELS
                  )}`
                : null,
              route.providerPrivacy
                ? `Privacy ${formatProviderMetadata(
                    route.providerPrivacy,
                    PROVIDER_PRIVACY_LABELS
                  )}`
                : null,
              route.providerHealth
                ? `Health ${formatProviderMetadata(
                    route.providerHealth,
                    PROVIDER_HEALTH_LABELS
                  )}`
                : null,
              route.providerPriority != null
                ? `Priority ${route.providerPriority}`
                : null,
            ]) || 'No provider metadata'}
          </div>
          {route.providerProfileId ||
          route.providerProfileConfigPath ||
          route.providerConfiguredModelIds?.length ? (
            <div className="break-words text-xs text-muted-foreground">
              {compactList([
                route.providerProfileId
                  ? `Profile ${route.providerProfileId}`
                  : null,
                route.providerProfileSource
                  ? `Profile source ${formatProviderMetadata(
                      route.providerProfileSource,
                      PROVIDER_SOURCE_LABELS
                    )}`
                  : null,
                route.providerProfileConfigPath
                  ? `Config ${route.providerProfileConfigPath}`
                  : null,
                route.providerConfiguredModelIds?.length
                  ? `Profile models ${route.providerConfiguredModelIds.join(', ')}`
                  : null,
                route.providerConfiguredModelCount != null
                  ? `Profile model count ${route.providerConfiguredModelCount}`
                  : null,
              ])}
            </div>
          ) : null}
          {route.routeModelDefinitionId ||
          route.routeRawModelId ||
          route.modelBackendKind ||
          route.canonicalModelKey ||
          route.behaviorFlags?.length ||
          route.routeModelDefinitionAliases?.length ? (
            <div className="break-words text-xs text-muted-foreground">
              Definition{' '}
              {formatAIModelDefinitionLabel({
                routeBackendKind: route.modelBackendKind,
                routeBehaviorFlags: route.behaviorFlags,
                routeCanonicalModelKey: route.canonicalModelKey,
                routeModelAliasMatched: route.routeModelAliasMatched,
                routeModelDefinitionAliases: route.routeModelDefinitionAliases,
                routeModelDefinitionId: route.routeModelDefinitionId,
                routeModelDefinitionSource: route.routeModelDefinitionSource,
                routeProtocol: route.protocol,
                routeRawModelId: route.routeRawModelId,
                routeRequestLayer: route.requestLayer,
              })}
            </div>
          ) : null}
          {route.requestedDimensions != null ||
          route.modelEmbeddingDimensions != null ||
          route.dimensionMismatch != null ? (
            <div className="break-words text-xs text-muted-foreground">
              Dimensions{' '}
              {formatDimensionEvidenceLabel(route, {
                includeNegativeMismatch: true,
              })}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function formatPreparedRouteTraceRoute(route: {
  behaviorFlags?: string[] | null;
  canonicalModelKey?: string | null;
  dimensionMismatch?: boolean | null;
  fallbackOrderIndex?: number | null;
  modelId: string;
  modelBackendKind?: string | null;
  modelEmbeddingDimensions?: number | null;
  protocol?: string | null;
  providerConfiguredModelCount?: number | null;
  providerConfiguredModelIds?: string[] | null;
  providerHealth?: string | null;
  providerHealthCheckedAt?: string | null;
  providerHealthLastError?: string | null;
  providerId: string;
  providerName?: string | null;
  providerPrivacy?: string | null;
  providerPriority?: number | null;
  providerProfileConfigPath?: string | null;
  providerProfileId?: string | null;
  providerProfileSource?: string | null;
  providerSource?: string | null;
  providerType?: string | null;
  requestLayer?: string | null;
  requestedDimensions?: number | null;
  routeIndex: number;
  routeModelAliasMatched?: boolean | null;
  routeModelDefinitionAliases?: string[] | null;
  routeModelDefinitionId?: string | null;
  routeModelDefinitionSource?: string | null;
  routeRawModelId?: string | null;
}) {
  const providerProfileLabel = formatAIModelProviderProfileLabel({
    providerConfiguredModelCount: route.providerConfiguredModelCount,
    providerConfiguredModelIds: route.providerConfiguredModelIds,
    providerProfileConfigPath: route.providerProfileConfigPath,
    providerProfileId: route.providerProfileId,
    providerProfileSource: route.providerProfileSource,
  });

  return compactList([
    `${route.providerId}/${route.modelId}`,
    `route #${route.routeIndex + 1}`,
    route.fallbackOrderIndex != null
      ? `fallback #${route.fallbackOrderIndex + 1}`
      : null,
    route.protocol ? `protocol ${route.protocol}` : null,
    route.requestLayer ? `layer ${route.requestLayer}` : null,
    route.modelBackendKind ? `backend ${route.modelBackendKind}` : null,
    route.canonicalModelKey ? `canonical ${route.canonicalModelKey}` : null,
    route.behaviorFlags?.length
      ? `behavior ${route.behaviorFlags.join(', ')}`
      : null,
    route.requestedDimensions != null ||
    route.modelEmbeddingDimensions != null ||
    route.dimensionMismatch != null
      ? `dimensions ${formatDimensionEvidenceLabel(route, {
          includeNegativeMismatch: true,
        })}`
      : null,
    route.providerName ? `provider name ${route.providerName}` : null,
    route.providerType
      ? `provider type ${formatProviderMetadata(route.providerType, PROVIDER_TYPE_LABELS)}`
      : null,
    route.providerSource
      ? `provider source ${formatProviderMetadata(route.providerSource, PROVIDER_SOURCE_LABELS)}`
      : null,
    providerProfileLabel ? `profile ${providerProfileLabel}` : null,
    route.providerPrivacy
      ? `provider privacy ${formatProviderMetadata(route.providerPrivacy, PROVIDER_PRIVACY_LABELS)}`
      : null,
    route.providerHealth
      ? `provider health ${formatProviderMetadata(route.providerHealth, PROVIDER_HEALTH_LABELS)}`
      : null,
    route.providerHealthCheckedAt
      ? `provider checked ${route.providerHealthCheckedAt}`
      : null,
    route.providerHealthLastError
      ? `provider error ${route.providerHealthLastError}`
      : null,
    route.providerPriority != null
      ? `provider priority ${route.providerPriority}`
      : null,
    formatAIModelDefinitionLabel({
      routeBackendKind: route.modelBackendKind,
      routeBehaviorFlags: route.behaviorFlags,
      routeCanonicalModelKey: route.canonicalModelKey,
      routeModelAliasMatched: route.routeModelAliasMatched,
      routeModelDefinitionAliases: route.routeModelDefinitionAliases,
      routeModelDefinitionId: route.routeModelDefinitionId,
      routeModelDefinitionSource: route.routeModelDefinitionSource,
      routeProtocol: route.protocol,
      routeRawModelId: route.routeRawModelId,
      routeRequestLayer: route.requestLayer,
    }),
  ]);
}

function formatActionRunTraceRoute(
  route: ActionRunPreparedRouteTrace['steps'][number]['routes'][number]
) {
  return formatPreparedRouteTraceRoute(route);
}

function buildActionRunTraceDiagnosticsText(
  runId: string,
  trace: ActionRunPreparedRouteTrace
) {
  return [
    `Action run ${runId}`,
    `Trace ${trace.type}`,
    `Status ${formatFeatureKind(trace.status)}`,
    `Steps ${trace.steps.length}`,
    ...trace.steps.flatMap(step => [
      `Step ${step.stepId}`,
      `Kind ${formatFeatureKind(step.kind)}`,
      `Routes ${step.actualRouteCount}/${step.routeCount}`,
      step.routeCountMismatch
        ? `Route count mismatch expected ${step.routeCount} actual ${step.actualRouteCount}`
        : null,
      step.requestedModelId ? `Requested ${step.requestedModelId}` : null,
      step.requestedModelSource
        ? `Source ${formatFeatureKind(step.requestedModelSource)}`
        : null,
      step.fallbackProviderIds.length
        ? `Fallback ${step.fallbackProviderIds.join(' -> ')}`
        : 'Fallback none',
      ...step.routes.map(route => `Route ${formatActionRunTraceRoute(route)}`),
    ]),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function ActionRunTraceResult({
  runId,
  trace,
}: {
  runId: string;
  trace: ActionRunPreparedRouteTrace | null | undefined;
}) {
  if (!trace) {
    return (
      <EmptyState>
        No prepared route trace returned for action run {runId}.
      </EmptyState>
    );
  }

  if (!trace.steps.length) {
    return <EmptyState>No prepared route steps returned.</EmptyState>;
  }

  const diagnosticsText = buildActionRunTraceDiagnosticsText(runId, trace);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/70 bg-muted/30 p-3">
        <div className="text-sm font-medium">Trace diagnostics text</div>
        <pre
          className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground"
          data-testid={`action-run-trace-diagnostics-${runId}`}
        >
          {diagnosticsText}
        </pre>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Step</TableHead>
            <TableHead className="w-[120px]">Kind</TableHead>
            <TableHead>Routes</TableHead>
            <TableHead>Fallback</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trace.steps.map(step => (
            <TableRow key={step.stepId}>
              <TableCell className="break-words">
                <div className="font-medium">{step.stepId}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {step.routeCount} prepared route
                  {step.routeCount === 1 ? '' : 's'}
                </div>
                <div
                  className={cn(
                    'mt-1 text-xs',
                    step.routeCountMismatch
                      ? 'text-amber-700'
                      : 'text-muted-foreground'
                  )}
                >
                  {step.routeCountMismatch
                    ? `Mismatch expected ${step.routeCount} actual ${step.actualRouteCount}`
                    : `Actual ${step.actualRouteCount}`}
                </div>
                {step.requestedModelId ? (
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    Requested {step.requestedModelId}
                  </div>
                ) : null}
                {step.requestedModelSource ? (
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    Source {formatFeatureKind(step.requestedModelSource)}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>{formatFeatureKind(step.kind)}</TableCell>
              <TableCell className="break-words">
                <ActionRunTraceRoutes routes={step.routes} />
              </TableCell>
              <TableCell className="break-words">
                {step.fallbackProviderIds.length
                  ? step.fallbackProviderIds.join(' -> ')
                  : 'None'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ActionRunTraceQueryResult({
  runId,
  workspaceId,
}: {
  runId: string;
  workspaceId: string;
}) {
  const { data, isValidating } = useQuery({
    query: getCopilotActionRunPreparedRouteTraceQuery,
    variables: {
      runId,
      workspaceId,
    },
  });
  const trace = data.currentUser?.copilot?.actionRunPreparedRouteTrace ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className="font-normal">
          Workspace {workspaceId}
        </Badge>
        <Badge variant="outline" className="font-normal">
          Run {runId}
        </Badge>
        {isValidating ? (
          <Badge variant="outline" className="font-normal">
            Refreshing
          </Badge>
        ) : null}
      </div>
      <ActionRunTraceResult runId={runId} trace={trace} />
    </div>
  );
}

function formatActionRunTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return timestamp.toLocaleString();
}

function formatActionRunPreparedRouteSummary(run: ActionRunDiagnosticsItem) {
  if (!run.hasPreparedRouteTrace) {
    return 'No prepared route trace';
  }

  const stepLabel =
    run.preparedRouteStepCount === 1
      ? '1 step'
      : `${run.preparedRouteStepCount} steps`;
  const routeLabel =
    run.preparedRouteCount === 1
      ? '1 route'
      : `${run.preparedRouteCount} routes`;

  return `${stepLabel} / ${routeLabel}`;
}

function formatActionRunPreparedRouteActualSummary(
  run: ActionRunDiagnosticsItem
) {
  if (!run.hasPreparedRouteTrace) {
    return null;
  }

  return run.preparedRouteActualCount === run.preparedRouteCount
    ? `Actual routes ${run.preparedRouteActualCount}`
    : `Actual routes ${run.preparedRouteActualCount} / declared ${run.preparedRouteCount}`;
}

function formatActionRunPreparedRouteProviders(run: ActionRunDiagnosticsItem) {
  if (!run.preparedRouteProviderIds.length) {
    return 'No prepared providers';
  }

  return `Providers ${run.preparedRouteProviderIds.join(' -> ')}`;
}

function formatActionRunPreparedRouteSteps(run: ActionRunDiagnosticsItem) {
  if (!run.preparedRouteStepIds.length) {
    return 'No prepared steps';
  }

  return `Steps ${run.preparedRouteStepIds.join(' -> ')}`;
}

function formatActionRunPreparedRouteModels(run: ActionRunDiagnosticsItem) {
  if (!run.preparedRouteModelIds.length) {
    return 'No prepared models';
  }

  return `Models ${run.preparedRouteModelIds.join(' -> ')}`;
}

function formatActionRunPreparedRouteRequestedModels(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteRequestedModelIds.length) {
    return 'No requested models';
  }

  return `Requested ${run.preparedRouteRequestedModelIds.join(' -> ')}`;
}

function formatActionRunPreparedRouteRequestedModelSources(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteRequestedModelSources.length) {
    return 'No requested model sources';
  }

  return `Requested sources ${run.preparedRouteRequestedModelSources
    .map(formatFeatureKind)
    .join(' -> ')}`;
}

function formatActionRunPreparedRouteStepRequestedModelSources(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepRequestedModelSources.length) {
    return 'No step requested model sources';
  }

  return `Step requested sources ${run.preparedRouteStepRequestedModelSources
    .map(value => {
      const [stepId, source] = value.split(' -> ');
      return source ? `${stepId} -> ${formatFeatureKind(source)}` : value;
    })
    .join(' | ')}`;
}

function formatActionRunPreparedRouteTargets(run: ActionRunDiagnosticsItem) {
  if (!run.preparedRouteTargets.length) {
    return 'No prepared targets';
  }

  return `Targets ${run.preparedRouteTargets.join(' -> ')}`;
}

function formatActionRunPreparedRouteOrder(run: ActionRunDiagnosticsItem) {
  if (!run.preparedRouteOrder.length) {
    return 'No route order';
  }

  return `Route order ${run.preparedRouteOrder.join(' | ')}`;
}

function formatActionRunPreparedRouteFallbackOrder(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteFallbackOrder.length) {
    return 'No fallback order';
  }

  return `Fallback order ${run.preparedRouteFallbackOrder.join(' | ')}`;
}

function formatActionRunPreparedRouteStepTargets(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepTargets.length) {
    return 'No prepared step targets';
  }

  return `Step targets ${run.preparedRouteStepTargets.join(' | ')}`;
}

function formatActionRunPreparedRouteRequestedTargets(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteRequestedTargets.length) {
    return 'No requested target pairs';
  }

  return `Requested targets ${run.preparedRouteRequestedTargets.join(' | ')}`;
}

function formatActionRunPreparedRouteStepRequestedTargets(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepRequestedTargets.length) {
    return 'No step requested target pairs';
  }

  return `Step requested targets ${run.preparedRouteStepRequestedTargets.join(
    ' | '
  )}`;
}

function formatActionRunPreparedRouteStepOrder(run: ActionRunDiagnosticsItem) {
  if (!run.preparedRouteStepOrder.length) {
    return 'No step route order';
  }

  return `Step route order ${run.preparedRouteStepOrder.join(' | ')}`;
}

function formatActionRunPreparedRouteStepRouteCounts(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepRouteCounts.length) {
    return 'No step route counts';
  }

  return `Step route counts ${run.preparedRouteStepRouteCounts.join(' | ')}`;
}

function formatActionRunPreparedRouteStepRouteCountMismatches(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepRouteCountMismatches.length) {
    return null;
  }

  return `Route count mismatch ${run.preparedRouteStepRouteCountMismatches.join(
    ' | '
  )}`;
}

function formatActionRunPreparedRouteStepFallbackOrder(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepFallbackOrder.length) {
    return 'No step fallback order';
  }

  return `Step fallback order ${run.preparedRouteStepFallbackOrder.join(
    ' | '
  )}`;
}

function formatActionRunPreparedRouteKinds(run: ActionRunDiagnosticsItem) {
  if (!run.preparedRouteKinds.length) {
    return 'No prepared kinds';
  }

  return `Kinds ${run.preparedRouteKinds.join(' -> ')}`;
}

function formatActionRunPreparedRouteProtocols(run: ActionRunDiagnosticsItem) {
  if (!run.preparedRouteProtocols.length) {
    return 'No route protocols';
  }

  return `Protocols ${run.preparedRouteProtocols.join(' -> ')}`;
}

function formatActionRunPreparedRouteModelBackendKinds(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteModelBackendKinds.length) {
    return 'No route backends';
  }

  return `Backends ${run.preparedRouteModelBackendKinds.join(' -> ')}`;
}

function formatActionRunPreparedRouteCanonicalModelKeys(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteCanonicalModelKeys.length) {
    return 'No canonical model keys';
  }

  return `Canonical models ${run.preparedRouteCanonicalModelKeys.join(' -> ')}`;
}

function formatActionRunPreparedRouteBehaviorFlags(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteBehaviorFlags.length) {
    return 'No behavior flags';
  }

  return `Behavior flags ${run.preparedRouteBehaviorFlags.join(' -> ')}`;
}

function formatActionRunPreparedRouteDimensionEvidence(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteDimensionEvidence.length) {
    return 'No dimension evidence';
  }

  return `Dimensions ${run.preparedRouteDimensionEvidence.join(' | ')}`;
}

function formatActionRunPreparedRouteStepProtocols(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepProtocols.length) {
    return 'No step protocol pairs';
  }

  return `Step protocols ${run.preparedRouteStepProtocols.join(' | ')}`;
}

function formatActionRunPreparedRouteStepModelBackendKinds(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepModelBackendKinds.length) {
    return 'No step backend pairs';
  }

  return `Step backends ${run.preparedRouteStepModelBackendKinds.join(' | ')}`;
}

function formatActionRunPreparedRouteStepCanonicalModelKeys(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepCanonicalModelKeys.length) {
    return 'No step canonical model pairs';
  }

  return `Step canonical models ${run.preparedRouteStepCanonicalModelKeys.join(
    ' | '
  )}`;
}

function formatActionRunPreparedRouteStepBehaviorFlags(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepBehaviorFlags.length) {
    return 'No step behavior flag pairs';
  }

  return `Step behavior flags ${run.preparedRouteStepBehaviorFlags.join(
    ' | '
  )}`;
}

function formatActionRunPreparedRouteStepDimensionEvidence(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepDimensionEvidence.length) {
    return 'No step dimension evidence';
  }

  return `Step dimensions ${run.preparedRouteStepDimensionEvidence.join(
    ' | '
  )}`;
}

function formatActionRunPreparedRouteRequestLayers(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteRequestLayers.length) {
    return 'No request layers';
  }

  return `Layers ${run.preparedRouteRequestLayers.join(' -> ')}`;
}

function formatActionRunPreparedRouteStepRequestLayers(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepRequestLayers.length) {
    return 'No step layer pairs';
  }

  return `Step layers ${run.preparedRouteStepRequestLayers.join(' | ')}`;
}

function formatActionRunPreparedRouteFallbacks(run: ActionRunDiagnosticsItem) {
  if (!run.preparedRouteFallbackProviderIds.length) {
    return null;
  }

  return `Fallback ${run.preparedRouteFallbackProviderIds.join(' -> ')}`;
}

function formatActionRunPreparedRouteStepFallbacks(
  run: ActionRunDiagnosticsItem
) {
  if (!run.preparedRouteStepFallbackProviderIds.length) {
    return null;
  }

  return `Step fallback ${run.preparedRouteStepFallbackProviderIds.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeSteps(run: ActionRunDiagnosticsItem) {
  if (!run.agentRuntimeStepIds.length) {
    return 'Agent runtime steps none';
  }

  return `Agent runtime steps ${run.agentRuntimeStepIds.join(' -> ')}`;
}

function formatActionRunAgentRuntimeStepTypes(run: ActionRunDiagnosticsItem) {
  if (!run.agentRuntimeStepTypes.length) {
    return 'Agent runtime step types none';
  }

  return `Agent runtime step types ${run.agentRuntimeStepTypes.join(' | ')}`;
}

function formatActionRunAgentRuntimeStepStatuses(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeStepStatuses.length) {
    return 'Agent runtime step statuses none';
  }

  return `Agent runtime step statuses ${run.agentRuntimeStepStatuses.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeStepKinds(run: ActionRunDiagnosticsItem) {
  if (!run.agentRuntimeStepKinds.length) {
    return 'Agent runtime step kinds none';
  }

  return `Agent runtime step kinds ${run.agentRuntimeStepKinds.join(' | ')}`;
}

function formatActionRunAgentRuntimeDiagnosticsFingerprint(
  run: ActionRunDiagnosticsItem
) {
  return `Agent runtime diagnostics fingerprint ${run.agentRuntimeDiagnosticsFingerprint}`;
}

function formatActionRunAgentRuntimeDiagnosticsManifest(
  run: ActionRunDiagnosticsItem
) {
  const manifest = run.agentRuntimeDiagnosticsManifest;

  return compactList([
    `Agent runtime diagnostics manifest ${manifest.version}`,
    `action ${manifest.actionId}@${manifest.actionVersion}`,
    `run status ${formatFeatureKind(manifest.runStatus)}`,
    `fingerprint ${manifest.fingerprint}`,
    `projection ${manifest.projectionContractFingerprint}`,
    `timeline ${manifest.timelineRouteEvidenceSetFingerprint}`,
    `source ${manifest.projectionSource}`,
    `schema ${manifest.schemaReadiness}`,
    manifest.hasPreparedRouteTrace ? 'prepared trace yes' : 'prepared trace no',
    `routes ${manifest.preparedRouteActualCount}/${manifest.preparedRouteCount}`,
    `steps ${manifest.preparedRouteStepCount}`,
    `timeline items ${manifest.timelineItemCount}`,
    `projection gaps ${manifest.projectionGapCount}`,
    `timeline gaps ${manifest.timelineGapCount}`,
    `schema gaps ${manifest.schemaReadinessGapCount}`,
    manifest.timelineEventTypes.length
      ? `timeline events ${manifest.timelineEventTypes.join(' -> ')}`
      : 'timeline events none',
    manifest.nativeTraceEventTypes.length
      ? `native events ${manifest.nativeTraceEventTypes.join(' -> ')}`
      : 'native events none',
  ]);
}

function formatActionRunAgentRuntimeProjectionContractFingerprint(
  run: ActionRunDiagnosticsItem
) {
  return `Agent runtime projection contract fingerprint ${run.agentRuntimeProjectionContractFingerprint}`;
}

function formatActionRunAgentRuntimeTimelineEntries(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeTimelineEntries.length) {
    return 'Agent runtime timeline entries none';
  }

  return `Agent runtime timeline entries ${run.agentRuntimeTimelineEntries.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeTimelineItems(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeTimelineItems.length) {
    return 'Agent runtime timeline items none';
  }

  return `Agent runtime timeline items ${run.agentRuntimeTimelineItems
    .map(item => formatActionRunAgentRuntimeTimelineItem(item))
    .join(' | ')}`;
}

function formatActionRunAgentRuntimeTimelineRouteEvidenceSetFingerprint(
  run: ActionRunDiagnosticsItem
) {
  return `Agent runtime timeline route evidence set fingerprint ${run.agentRuntimeTimelineRouteEvidenceSetFingerprint}`;
}

function formatActionRunAgentRuntimeTimelineItem(
  item: ActionRunDiagnosticsItem['agentRuntimeTimelineItems'][number]
) {
  return compactList([
    `#${item.sequence}`,
    `key ${item.eventKey}`,
    `Timeline ${formatFeatureKind(item.eventType)}`,
    `status ${formatFeatureKind(item.status)}`,
    item.stepId ? `step ${item.stepId}` : 'run',
    item.stepType ? `type ${formatFeatureKind(item.stepType)}` : null,
    item.kind ? `kind ${formatFeatureKind(item.kind)}` : null,
    `routes ${item.actualRouteCount}/${item.routeCount}`,
    item.routeCountMismatch ? 'route count mismatch' : null,
    item.routeTargets.length
      ? `targets ${item.routeTargets.join(' -> ')}`
      : null,
    item.fallbackProviderIds.length
      ? `fallback ${item.fallbackProviderIds.join(' -> ')}`
      : null,
    item.routeModelBackendKinds.length
      ? `backends ${item.routeModelBackendKinds.join(' -> ')}`
      : null,
    item.routeCanonicalModelKeys.length
      ? `canonical ${item.routeCanonicalModelKeys.join(' -> ')}`
      : null,
    item.routeBehaviorFlags.length
      ? `behavior ${item.routeBehaviorFlags.join(' -> ')}`
      : null,
    item.routeDimensionEvidence.length
      ? `dimensions ${item.routeDimensionEvidence.join(' | ')}`
      : null,
    `route fingerprint ${item.routeEvidenceFingerprint}`,
  ]);
}

function formatActionRunAgentRuntimeTimelineEventTypes(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeTimelineEventTypes.length) {
    return 'Agent runtime timeline event types none';
  }

  return `Agent runtime timeline event types ${run.agentRuntimeTimelineEventTypes.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeTargetTimelineEventTypes(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeTargetTimelineEventTypes.length) {
    return 'Agent runtime target timeline event types none';
  }

  return `Agent runtime target timeline event types ${run.agentRuntimeTargetTimelineEventTypes.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeProjectedTimelineEventTypes(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeProjectedTimelineEventTypes.length) {
    return 'Agent runtime projected timeline event types none';
  }

  return `Agent runtime projected timeline event types ${run.agentRuntimeProjectedTimelineEventTypes.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeUnsupportedTimelineEventTypes(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeUnsupportedTimelineEventTypes.length) {
    return 'Agent runtime unsupported timeline event types none';
  }

  return `Agent runtime unsupported timeline event types ${run.agentRuntimeUnsupportedTimelineEventTypes.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeTimelineGaps(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeTimelineGaps.length) {
    return 'Agent runtime timeline gaps none';
  }

  return `Agent runtime timeline gaps ${run.agentRuntimeTimelineGaps.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeTargetSchemaComponents(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeTargetSchemaComponents.length) {
    return 'Agent runtime target schema components none';
  }

  return `Agent runtime target schema components ${run.agentRuntimeTargetSchemaComponents.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeProjectedSchemaComponents(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeProjectedSchemaComponents.length) {
    return 'Agent runtime projected schema components none';
  }

  return `Agent runtime projected schema components ${run.agentRuntimeProjectedSchemaComponents.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeSchemaReadinessGaps(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeSchemaReadinessGaps.length) {
    return 'Agent runtime schema readiness gaps none';
  }

  return `Agent runtime schema readiness gaps ${run.agentRuntimeSchemaReadinessGaps.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeTargetRunStatuses(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeTargetRunStatuses.length) {
    return 'Agent runtime target run statuses none';
  }

  return `Agent runtime target run statuses ${run.agentRuntimeTargetRunStatuses.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeProjectedRunStatuses(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeProjectedRunStatuses.length) {
    return 'Agent runtime projected run statuses none';
  }

  return `Agent runtime projected run statuses ${run.agentRuntimeProjectedRunStatuses.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeUnsupportedRunStatuses(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeUnsupportedRunStatuses.length) {
    return 'Agent runtime unsupported run statuses none';
  }

  return `Agent runtime unsupported run statuses ${run.agentRuntimeUnsupportedRunStatuses.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeRunStatusGaps(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeRunStatusGaps.length) {
    return 'Agent runtime run status gaps none';
  }

  return `Agent runtime run status gaps ${run.agentRuntimeRunStatusGaps.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeTargetStepStatuses(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeTargetStepStatuses.length) {
    return 'Agent runtime target step statuses none';
  }

  return `Agent runtime target step statuses ${run.agentRuntimeTargetStepStatuses.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeProjectedStepStatuses(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeProjectedStepStatuses.length) {
    return 'Agent runtime projected step statuses none';
  }

  return `Agent runtime projected step statuses ${run.agentRuntimeProjectedStepStatuses.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeUnsupportedStepStatuses(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeUnsupportedStepStatuses.length) {
    return 'Agent runtime unsupported step statuses none';
  }

  return `Agent runtime unsupported step statuses ${run.agentRuntimeUnsupportedStepStatuses.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeStepStatusGaps(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeStepStatusGaps.length) {
    return 'Agent runtime step status gaps none';
  }

  return `Agent runtime step status gaps ${run.agentRuntimeStepStatusGaps.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeTargetStepTypes(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeTargetStepTypes.length) {
    return 'Agent runtime target step types none';
  }

  return `Agent runtime target step types ${run.agentRuntimeTargetStepTypes.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeProjectedStepTypes(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeProjectedStepTypes.length) {
    return 'Agent runtime projected step types none';
  }

  return `Agent runtime projected step types ${run.agentRuntimeProjectedStepTypes.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeProjectionGaps(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeProjectionGaps.length) {
    return 'Agent runtime projection gaps none';
  }

  return `Agent runtime projection gaps ${run.agentRuntimeProjectionGaps.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeUnsupportedStepTypes(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeUnsupportedStepTypes.length) {
    return 'Agent runtime unsupported step types none';
  }

  return `Agent runtime unsupported step types ${run.agentRuntimeUnsupportedStepTypes.join(
    ' | '
  )}`;
}

function formatActionRunAgentRuntimeNativeTraceEvents(
  run: ActionRunDiagnosticsItem
) {
  if (!run.agentRuntimeNativeTraceEventTypes.length) {
    return 'Agent runtime native trace events none';
  }

  return `Agent runtime native trace events ${run.agentRuntimeNativeTraceEventTypes.join(
    ' | '
  )}`;
}

function buildActionRunDiagnosticsText(run: ActionRunDiagnosticsItem) {
  const actualRouteCountLabel = formatActionRunPreparedRouteActualSummary(run);
  const routeCountMismatchLabel =
    formatActionRunPreparedRouteStepRouteCountMismatches(run);
  const fallbackLabel = formatActionRunPreparedRouteFallbacks(run);
  const stepFallbackLabel = formatActionRunPreparedRouteStepFallbacks(run);
  const lines = [
    `Action run ${run.id}`,
    `Action ${run.actionId}`,
    `Version ${run.actionVersion}`,
    `Status ${formatFeatureKind(run.status)}`,
    `Attempt ${run.attempt}`,
    run.retryOf ? `Retry of ${run.retryOf}` : null,
    run.docId ? `Doc ${run.docId}` : null,
    run.sessionId ? `Session ${run.sessionId}` : null,
    run.errorCode ? `Error ${run.errorCode}` : null,
    `Created ${run.createdAt}`,
    `Updated ${run.updatedAt}`,
    formatActionRunAgentRuntimeDiagnosticsFingerprint(run),
    formatActionRunAgentRuntimeDiagnosticsManifest(run),
    `Agent runtime projection ${run.agentRuntimeProjectionSource}`,
    formatActionRunAgentRuntimeProjectionContractFingerprint(run),
    `Agent runtime run ${run.agentRuntimeRunId}`,
    `Agent runtime status ${formatFeatureKind(run.agentRuntimeRunStatus)}`,
    `Agent runtime step count ${run.agentRuntimeStepCount}`,
    formatActionRunAgentRuntimeSteps(run),
    formatActionRunAgentRuntimeStepTypes(run),
    formatActionRunAgentRuntimeStepStatuses(run),
    formatActionRunAgentRuntimeStepKinds(run),
    formatActionRunAgentRuntimeTimelineEntries(run),
    formatActionRunAgentRuntimeTimelineItems(run),
    formatActionRunAgentRuntimeTimelineRouteEvidenceSetFingerprint(run),
    formatActionRunAgentRuntimeTimelineEventTypes(run),
    formatActionRunAgentRuntimeTargetTimelineEventTypes(run),
    formatActionRunAgentRuntimeProjectedTimelineEventTypes(run),
    formatActionRunAgentRuntimeUnsupportedTimelineEventTypes(run),
    formatActionRunAgentRuntimeTimelineGaps(run),
    `Agent runtime schema readiness ${formatFeatureKind(
      run.agentRuntimeSchemaReadiness
    )}`,
    formatActionRunAgentRuntimeTargetSchemaComponents(run),
    formatActionRunAgentRuntimeProjectedSchemaComponents(run),
    formatActionRunAgentRuntimeSchemaReadinessGaps(run),
    formatActionRunAgentRuntimeTargetRunStatuses(run),
    formatActionRunAgentRuntimeProjectedRunStatuses(run),
    formatActionRunAgentRuntimeUnsupportedRunStatuses(run),
    formatActionRunAgentRuntimeRunStatusGaps(run),
    formatActionRunAgentRuntimeTargetStepStatuses(run),
    formatActionRunAgentRuntimeProjectedStepStatuses(run),
    formatActionRunAgentRuntimeUnsupportedStepStatuses(run),
    formatActionRunAgentRuntimeStepStatusGaps(run),
    formatActionRunAgentRuntimeTargetStepTypes(run),
    formatActionRunAgentRuntimeProjectedStepTypes(run),
    formatActionRunAgentRuntimeProjectionGaps(run),
    formatActionRunAgentRuntimeUnsupportedStepTypes(run),
    formatActionRunAgentRuntimeNativeTraceEvents(run),
    `Prepared trace ${run.hasPreparedRouteTrace ? 'yes' : 'no'}`,
    formatActionRunPreparedRouteSummary(run),
  ];

  if (run.hasPreparedRouteTrace) {
    lines.push(
      actualRouteCountLabel,
      formatActionRunPreparedRouteSteps(run),
      formatActionRunPreparedRouteProviders(run),
      formatActionRunPreparedRouteModels(run),
      formatActionRunPreparedRouteRequestedModels(run),
      formatActionRunPreparedRouteRequestedModelSources(run),
      formatActionRunPreparedRouteStepRequestedModelSources(run),
      formatActionRunPreparedRouteTargets(run),
      formatActionRunPreparedRouteOrder(run),
      formatActionRunPreparedRouteFallbackOrder(run),
      formatActionRunPreparedRouteStepTargets(run),
      formatActionRunPreparedRouteRequestedTargets(run),
      formatActionRunPreparedRouteStepRequestedTargets(run),
      formatActionRunPreparedRouteStepOrder(run),
      formatActionRunPreparedRouteStepRouteCounts(run),
      routeCountMismatchLabel,
      formatActionRunPreparedRouteStepFallbackOrder(run),
      formatActionRunPreparedRouteKinds(run),
      formatActionRunPreparedRouteProtocols(run),
      formatActionRunPreparedRouteModelBackendKinds(run),
      formatActionRunPreparedRouteCanonicalModelKeys(run),
      formatActionRunPreparedRouteBehaviorFlags(run),
      formatActionRunPreparedRouteDimensionEvidence(run),
      formatActionRunPreparedRouteStepProtocols(run),
      formatActionRunPreparedRouteStepModelBackendKinds(run),
      formatActionRunPreparedRouteStepCanonicalModelKeys(run),
      formatActionRunPreparedRouteStepBehaviorFlags(run),
      formatActionRunPreparedRouteStepDimensionEvidence(run),
      formatActionRunPreparedRouteRequestLayers(run),
      formatActionRunPreparedRouteStepRequestLayers(run),
      fallbackLabel,
      stepFallbackLabel
    );
  }

  return lines.filter((line): line is string => Boolean(line)).join('\n');
}

function buildActionRunDiagnosticsManifestJson(run: ActionRunDiagnosticsItem) {
  return JSON.stringify(run.agentRuntimeDiagnosticsManifest, null, 2);
}

function buildActionRunDiagnosticsManifestFilename(runId: string) {
  const safeRunId =
    runId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';

  return `action-run-diagnostics-manifest-${safeRunId}.json`;
}

function buildActionRunDiagnosticsManifestMetadataFilename(runId: string) {
  const safeRunId =
    runId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';

  return `action-run-diagnostics-manifest-metadata-${safeRunId}.json`;
}

function buildActionRunDiagnosticsManifestExportMetadata(
  run: ActionRunDiagnosticsItem
) {
  const metadata = run.agentRuntimeDiagnosticsManifestExportMetadata;

  return [
    `Export artifact ${metadata.artifact}`,
    `Filename ${metadata.filename}`,
    `MIME ${metadata.mime}`,
    `Metadata filename ${metadata.metadataFilename}`,
    `Metadata ${metadata.version}`,
    `Manifest ${metadata.manifestVersion}`,
    `Fingerprint ${metadata.manifestFingerprint}`,
    `Action ${metadata.actionId}@${metadata.actionVersion}`,
    `Run ${metadata.runId}`,
    `Run status ${metadata.runStatus}`,
    `Projection source ${metadata.projectionSource}`,
    `Schema readiness ${metadata.schemaReadiness}`,
    `Boundary ${metadata.boundary}`,
  ].join('\n');
}

function buildActionRunDiagnosticsManifestExportMetadataJson(
  run: ActionRunDiagnosticsItem
) {
  return JSON.stringify(
    run.agentRuntimeDiagnosticsManifestExportMetadata,
    null,
    2
  );
}

function downloadActionRunDiagnosticsManifestJson(
  runId: string,
  manifestFilename: string,
  manifestJson: string
) {
  const blob = new Blob([manifestJson], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download =
    manifestFilename || buildActionRunDiagnosticsManifestFilename(runId);
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadActionRunDiagnosticsManifestMetadataJson(
  runId: string,
  metadataFilename: string,
  metadataJson: string
) {
  const blob = new Blob([metadataJson], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download =
    metadataFilename ||
    buildActionRunDiagnosticsManifestMetadataFilename(runId);
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ActionRunDiagnosticsPanel({
  diagnosticsText,
  exportMetadataJson,
  exportMetadataFilename,
  exportMetadataText,
  manifestFilename,
  manifestJson,
  runId,
}: {
  diagnosticsText: string;
  exportMetadataJson: string;
  exportMetadataFilename: string;
  exportMetadataText: string;
  manifestFilename: string;
  manifestJson: string;
  runId: string;
}) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border/70 bg-muted/30 p-2">
      <div>
        <div className="text-xs font-medium">Diagnostics text</div>
        <pre
          className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground"
          data-testid={`action-run-diagnostics-${runId}`}
        >
          {diagnosticsText}
        </pre>
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-medium">Diagnostics manifest JSON</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard?.writeText(manifestJson).catch(() => {});
            }}
          >
            Copy JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              downloadActionRunDiagnosticsManifestJson(
                runId,
                manifestFilename,
                manifestJson
              );
            }}
          >
            Download JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard
                ?.writeText(exportMetadataText)
                .catch(() => {});
            }}
          >
            Copy metadata
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard
                ?.writeText(exportMetadataJson)
                .catch(() => {});
            }}
          >
            Copy metadata JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              downloadActionRunDiagnosticsManifestMetadataJson(
                runId,
                exportMetadataFilename,
                exportMetadataJson
              );
            }}
          >
            Download metadata JSON
          </Button>
        </div>
        <pre
          className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground"
          data-testid={`action-run-diagnostics-manifest-export-metadata-${runId}`}
        >
          {exportMetadataText}
        </pre>
        <pre
          className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground"
          data-testid={`action-run-diagnostics-manifest-export-metadata-json-${runId}`}
        >
          {exportMetadataJson}
        </pre>
        <pre
          className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground"
          data-testid={`action-run-diagnostics-manifest-json-${runId}`}
        >
          {manifestJson}
        </pre>
      </div>
    </div>
  );
}

function ActionRunRecentList({
  actionRuns,
  isValidating,
  onSelect,
}: {
  actionRuns: ActionRunDiagnosticsItem[];
  isValidating: boolean;
  onSelect: (runId: string) => void;
}) {
  if (!actionRuns.length) {
    return (
      <EmptyState>
        No recent action runs returned for this workspace.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium">Recent action runs</div>
        <Badge variant="outline" className="font-normal">
          {actionRuns.length} run{actionRuns.length === 1 ? '' : 's'}
        </Badge>
        {isValidating ? (
          <Badge variant="outline" className="font-normal">
            Refreshing
          </Badge>
        ) : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Action</TableHead>
            <TableHead className="w-[120px]">Status</TableHead>
            <TableHead className="w-[144px]">Trace</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-[100px]">Inspect</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {actionRuns.map(run => {
            const diagnosticsText = buildActionRunDiagnosticsText(run);
            const exportMetadataJson =
              buildActionRunDiagnosticsManifestExportMetadataJson(run);
            const exportMetadataFilename =
              run.agentRuntimeDiagnosticsManifestExportMetadata
                .metadataFilename;
            const manifestFilename =
              run.agentRuntimeDiagnosticsManifestExportMetadata.filename;
            const exportMetadataText =
              buildActionRunDiagnosticsManifestExportMetadata(run);
            const manifestJson = buildActionRunDiagnosticsManifestJson(run);
            const fallbackLabel = formatActionRunPreparedRouteFallbacks(run);
            const stepFallbackLabel =
              formatActionRunPreparedRouteStepFallbacks(run);
            const actualRouteCountLabel =
              formatActionRunPreparedRouteActualSummary(run);
            const routeCountMismatchLabel =
              formatActionRunPreparedRouteStepRouteCountMismatches(run);

            return (
              <TableRow key={run.id}>
                <TableCell className="break-words">
                  <div className="font-medium">{run.actionId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {compactList([
                      run.actionVersion,
                      `attempt ${run.attempt}`,
                      run.errorCode,
                    ])}
                  </div>
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    {run.id}
                  </div>
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    Agent runtime {formatFeatureKind(run.agentRuntimeRunStatus)}{' '}
                    / {run.agentRuntimeStepCount} step
                    {run.agentRuntimeStepCount === 1 ? '' : 's'}
                  </div>
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    {formatActionRunAgentRuntimeDiagnosticsFingerprint(run)}
                  </div>
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    {formatActionRunAgentRuntimeDiagnosticsManifest(run)}
                  </div>
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    {formatActionRunAgentRuntimeProjectionContractFingerprint(
                      run
                    )}
                  </div>
                  {run.agentRuntimeProjectionGaps.length ? (
                    <div className="mt-1 break-words text-xs text-amber-700">
                      {run.agentRuntimeProjectionGaps.length} projection gap
                      {run.agentRuntimeProjectionGaps.length === 1 ? '' : 's'}
                    </div>
                  ) : null}
                  {run.agentRuntimeTimelineGaps.length ? (
                    <div className="mt-1 break-words text-xs text-amber-700">
                      {run.agentRuntimeTimelineGaps.length} timeline gap
                      {run.agentRuntimeTimelineGaps.length === 1 ? '' : 's'}
                    </div>
                  ) : null}
                  {run.agentRuntimeTimelineItems.length ? (
                    <div
                      className="mt-2 space-y-1 border-l border-border pl-2"
                      data-testid={`action-run-timeline-${run.id}`}
                    >
                      {run.agentRuntimeTimelineItems.map(item => (
                        <div
                          key={item.id}
                          className="break-words text-xs text-muted-foreground"
                        >
                          {formatActionRunAgentRuntimeTimelineItem(item)}
                        </div>
                      ))}
                      <div className="break-words text-xs text-muted-foreground">
                        {formatActionRunAgentRuntimeTimelineRouteEvidenceSetFingerprint(
                          run
                        )}
                      </div>
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{formatFeatureKind(run.status)}</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        'font-normal',
                        run.hasPreparedRouteTrace
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                          : 'border-border bg-muted text-muted-foreground'
                      )}
                    >
                      {run.hasPreparedRouteTrace ? 'Prepared' : 'None'}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      {formatActionRunPreparedRouteSummary(run)}
                    </div>
                    {run.hasPreparedRouteTrace ? (
                      <>
                        {actualRouteCountLabel ? (
                          <div className="break-words text-xs text-muted-foreground">
                            {actualRouteCountLabel}
                          </div>
                        ) : null}
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteSteps(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteProviders(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteModels(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteRequestedModels(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteRequestedModelSources(
                            run
                          )}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepRequestedModelSources(
                            run
                          )}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteTargets(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteOrder(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteFallbackOrder(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepTargets(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteRequestedTargets(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepRequestedTargets(
                            run
                          )}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepOrder(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepRouteCounts(run)}
                        </div>
                        {routeCountMismatchLabel ? (
                          <div className="break-words text-xs text-amber-700">
                            {routeCountMismatchLabel}
                          </div>
                        ) : null}
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepFallbackOrder(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteKinds(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteProtocols(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteModelBackendKinds(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteCanonicalModelKeys(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteBehaviorFlags(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteDimensionEvidence(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepProtocols(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepModelBackendKinds(
                            run
                          )}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepCanonicalModelKeys(
                            run
                          )}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepBehaviorFlags(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepDimensionEvidence(
                            run
                          )}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteRequestLayers(run)}
                        </div>
                        <div className="break-words text-xs text-muted-foreground">
                          {formatActionRunPreparedRouteStepRequestLayers(run)}
                        </div>
                        {fallbackLabel ? (
                          <div className="break-words text-xs text-muted-foreground">
                            {fallbackLabel}
                          </div>
                        ) : null}
                        {stepFallbackLabel ? (
                          <div className="break-words text-xs text-muted-foreground">
                            {stepFallbackLabel}
                          </div>
                        ) : null}
                        <ActionRunDiagnosticsPanel
                          diagnosticsText={diagnosticsText}
                          exportMetadataJson={exportMetadataJson}
                          exportMetadataFilename={exportMetadataFilename}
                          exportMetadataText={exportMetadataText}
                          manifestFilename={manifestFilename}
                          manifestJson={manifestJson}
                          runId={run.id}
                        />
                      </>
                    ) : (
                      <ActionRunDiagnosticsPanel
                        diagnosticsText={diagnosticsText}
                        exportMetadataJson={exportMetadataJson}
                        exportMetadataFilename={exportMetadataFilename}
                        exportMetadataText={exportMetadataText}
                        manifestFilename={manifestFilename}
                        manifestJson={manifestJson}
                        runId={run.id}
                      />
                    )}
                  </div>
                </TableCell>
                <TableCell className="break-words text-xs text-muted-foreground">
                  {formatActionRunTimestamp(run.updatedAt)}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onSelect(run.id);
                    }}
                  >
                    Inspect
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ActionRunRecentListQuery({
  onSelect,
  workspaceId,
}: {
  onSelect: (runId: string) => void;
  workspaceId: string;
}) {
  const { data, isValidating } = useQuery({
    query: getCopilotActionRunsQuery,
    variables: {
      limit: 8,
      workspaceId,
    },
  });
  const actionRuns = data.currentUser?.copilot?.actionRuns ?? EMPTY_ACTION_RUNS;

  return (
    <ActionRunRecentList
      actionRuns={actionRuns}
      isValidating={isValidating}
      onSelect={onSelect}
    />
  );
}

function ActionRunTraceCard({
  actionRunId,
  actionRunIdInput,
  onActionRunIdInputChange,
  onActionRunSelect,
  onSubmit,
  workspaceId,
}: {
  actionRunId: string;
  actionRunIdInput: string;
  onActionRunIdInputChange: (value: string) => void;
  onActionRunSelect: (runId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  workspaceId: string | undefined;
}) {
  const nextActionRunId = actionRunIdInput.trim();

  return (
    <Card className="border-border/60 bg-card shadow-1">
      <CardHeader>
        <CardTitle className="text-base">Action run route trace</CardTitle>
        <CardDescription>
          Sanitized prepared route diagnostics for persisted action runs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={onSubmit}>
          <label className="min-w-0 flex-1">
            <span className="text-xs text-muted-foreground">Action run ID</span>
            <Input
              className="mt-1"
              placeholder="Paste an action run id"
              value={actionRunIdInput}
              onChange={event => {
                onActionRunIdInputChange(event.target.value);
              }}
            />
          </label>
          <div className="flex items-end">
            <Button
              type="submit"
              variant="outline"
              className="h-9"
              disabled={!workspaceId || !nextActionRunId}
            >
              Inspect run
            </Button>
          </div>
        </form>

        {!workspaceId ? (
          <EmptyState>
            Select a workspace scope before inspecting an action run.
          </EmptyState>
        ) : (
          <ActionRunRecentListQuery
            onSelect={onActionRunSelect}
            workspaceId={workspaceId}
          />
        )}

        {workspaceId && !actionRunId ? (
          <EmptyState>
            Enter an action run ID or select a recent run to inspect prepared
            route diagnostics.
          </EmptyState>
        ) : null}

        {workspaceId && actionRunId ? (
          <ActionRunTraceQueryResult
            runId={actionRunId}
            workspaceId={workspaceId}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function AiPageSkeleton() {
  return (
    <div className="flex h-dvh flex-1 flex-col bg-background">
      <Header title="AI" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-5">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}

function AiPageContent() {
  const [promptName, setPromptName] = useState(ADMIN_AI_DEFAULT_PROMPT_NAME);
  const [promptNameInput, setPromptNameInput] = useState(
    ADMIN_AI_DEFAULT_PROMPT_NAME
  );
  const [promptCatalogSearch, setPromptCatalogSearch] = useState('');
  const [promptCatalogCategory, setPromptCatalogCategory] = useState(
    PROMPT_CATALOG_ALL_CATEGORIES
  );
  const [workspaceId, setWorkspaceId] = useState<string | undefined>();
  const [workspaceIdInput, setWorkspaceIdInput] = useState('');
  const [actionRunId, setActionRunId] = useState('');
  const [actionRunIdInput, setActionRunIdInput] = useState('');
  const nextPromptName = promptNameInput.trim() || ADMIN_AI_DEFAULT_PROMPT_NAME;
  const nextWorkspaceId = workspaceIdInput.trim() || undefined;
  const nextActionRunId = actionRunIdInput.trim();
  const promptCatalogData = usePromptCatalogData(workspaceId);
  const workspaceScopeData = useWorkspaceScopeData();
  const promptCatalog =
    promptCatalogData.currentUser?.copilot?.prompts ?? EMPTY_PROMPT_CATALOG;
  const workspaceScopes =
    workspaceScopeData.workspaces ?? EMPTY_WORKSPACE_SCOPES;
  const promptCatalogCategories = useMemo(
    () =>
      [...new Set(promptCatalog.map(prompt => prompt.category))]
        .filter(Boolean)
        .sort((a, b) =>
          formatFeatureKind(a).localeCompare(formatFeatureKind(b))
        ),
    [promptCatalog]
  );
  const filteredPromptCatalog = useMemo(() => {
    const search = promptCatalogSearch.trim().toLocaleLowerCase();

    return promptCatalog.filter(prompt => {
      const matchesCategory =
        promptCatalogCategory === PROMPT_CATALOG_ALL_CATEGORIES ||
        prompt.category === promptCatalogCategory;

      return matchesCategory && matchesPromptCatalogSearch(prompt, search);
    });
  }, [promptCatalog, promptCatalogCategory, promptCatalogSearch]);
  const activePromptMetadata = promptCatalog.find(
    prompt => prompt.name === promptName
  );
  const selectedCatalogPromptName = filteredPromptCatalog.some(
    prompt => prompt.name === promptNameInput
  )
    ? promptNameInput
    : undefined;
  const selectedWorkspaceScope = nextWorkspaceId
    ? workspaceScopes.some(workspace => workspace.id === nextWorkspaceId)
      ? nextWorkspaceId
      : WORKSPACE_SCOPE_MANUAL
    : WORKSPACE_SCOPE_GLOBAL;
  const activeWorkspaceScope = workspaceId
    ? workspaceScopes.find(workspace => workspace.id === workspaceId)
    : undefined;
  const { data, isValidating, mutate } = useQuery({
    query: getPromptModelsQuery,
    variables: {
      promptName,
      workspaceId,
    },
  });
  const modelsPayload = data.currentUser?.copilot?.models;
  const models = useMemo(
    () => (modelsPayload ? buildAIModels(modelsPayload) : []),
    [modelsPayload]
  );
  const activeDefaultModel = useMemo(
    () =>
      models.find(model => model.id === modelsPayload?.defaultModel) ??
      models.find(model => model.isDefault) ??
      null,
    [models, modelsPayload?.defaultModel]
  );
  const activeDefaultSourceChain = activeDefaultModel
    ? formatAIModelSourcesLabel(activeDefaultModel)
    : null;
  const activeDefaultPromptSourceChain = activeDefaultModel
    ? formatAIModelPromptSourcesLabel(activeDefaultModel)
    : null;
  const diagnostics = useMemo(
    () =>
      getAIModelTaskRoutesDiagnostics({
        embeddingRoute: modelsPayload?.embeddingRoute,
        rerankRoute: modelsPayload?.rerankRoute,
      }),
    [modelsPayload?.embeddingRoute, modelsPayload?.rerankRoute]
  );
  const promptDefaultDiagnostics = useMemo(
    () => getAIModelPromptDefaultDiagnostics(modelsPayload),
    [modelsPayload]
  );
  const recommendedActionKinds = useMemo(
    () =>
      Array.from(
        new Set([
          ...promptDefaultDiagnostics.actionKinds,
          ...diagnostics.actionKinds,
        ])
      ),
    [diagnostics.actionKinds, promptDefaultDiagnostics.actionKinds]
  );
  const [embeddingDiagnostics, rerankDiagnostics] = diagnostics.routes;

  const onPromptSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPromptName(nextPromptName);
    setWorkspaceId(nextWorkspaceId);
  };
  const onActionRunSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionRunId(nextActionRunId);
  };
  const onActionRunSelect = (runId: string) => {
    setActionRunIdInput(runId);
    setActionRunId(runId);
  };

  return (
    <div className="flex h-dvh flex-1 flex-col bg-background">
      <Header
        title="AI"
        endFix={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              mutate().catch(err => {
                console.error(err);
              });
            }}
          >
            <RefreshCwIcon
              className={cn('h-4 w-4', isValidating && 'animate-spin')}
            />
            Refresh
          </Button>
        }
      />
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="border-border/60 bg-card shadow-1 lg:col-span-2">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">
                      Model route diagnostics
                    </CardTitle>
                    <CardDescription>
                      Read-only task route checks for self-hosted AI providers
                    </CardDescription>
                  </div>
                  <StatusBadge status={diagnostics.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <form className="space-y-3" onSubmit={onPromptSubmit}>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="min-w-0">
                      <span className="text-xs text-muted-foreground">
                        Prompt catalog
                      </span>
                      <Select
                        value={selectedCatalogPromptName ?? ''}
                        onValueChange={value => {
                          setPromptNameInput(value);
                        }}
                      >
                        <SelectTrigger
                          aria-label="Prompt catalog"
                          className="mt-1"
                        >
                          <SelectValue placeholder="Select prompt" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredPromptCatalog.map(prompt => (
                            <SelectItem key={prompt.name} value={prompt.name}>
                              {prompt.name}
                            </SelectItem>
                          ))}
                          {!filteredPromptCatalog.length ? (
                            <div className="px-2 py-2 text-sm text-muted-foreground">
                              No prompts match the current filters.
                            </div>
                          ) : null}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="min-w-0">
                      <span className="text-xs text-muted-foreground">
                        Prompt search
                      </span>
                      <Input
                        className="mt-1"
                        placeholder="Search prompts, actions, or models"
                        value={promptCatalogSearch}
                        onChange={event => {
                          setPromptCatalogSearch(event.target.value);
                        }}
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="text-xs text-muted-foreground">
                        Prompt category
                      </span>
                      <Select
                        value={promptCatalogCategory}
                        onValueChange={value => {
                          setPromptCatalogCategory(value);
                        }}
                      >
                        <SelectTrigger
                          aria-label="Prompt category"
                          className="mt-1"
                        >
                          <SelectValue placeholder="All categories" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={PROMPT_CATALOG_ALL_CATEGORIES}>
                            All categories
                          </SelectItem>
                          {promptCatalogCategories.map(category => (
                            <SelectItem key={category} value={category}>
                              {formatFeatureKind(category)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="min-w-0">
                      <span className="text-xs text-muted-foreground">
                        Prompt name
                      </span>
                      <Input
                        className="mt-1"
                        value={promptNameInput}
                        onChange={event => {
                          setPromptNameInput(event.target.value);
                        }}
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="text-xs text-muted-foreground">
                        Workspace ID
                      </span>
                      <Input
                        className="mt-1"
                        placeholder="Global route diagnostics"
                        value={workspaceIdInput}
                        onChange={event => {
                          setWorkspaceIdInput(event.target.value);
                        }}
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="text-xs text-muted-foreground">
                        Workspace selector
                      </span>
                      <Select
                        value={selectedWorkspaceScope}
                        onValueChange={value => {
                          if (value === WORKSPACE_SCOPE_GLOBAL) {
                            setWorkspaceIdInput('');
                            return;
                          }
                          if (value === WORKSPACE_SCOPE_MANUAL) {
                            return;
                          }
                          setWorkspaceIdInput(value);
                        }}
                      >
                        <SelectTrigger
                          aria-label="Workspace selector"
                          className="mt-1"
                        >
                          <SelectValue placeholder="Global route diagnostics" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={WORKSPACE_SCOPE_GLOBAL}>
                            Global route diagnostics
                          </SelectItem>
                          {workspaceScopes.map(workspace => (
                            <SelectItem key={workspace.id} value={workspace.id}>
                              {formatWorkspaceScopeLabel(workspace)}
                            </SelectItem>
                          ))}
                          <SelectItem value={WORKSPACE_SCOPE_MANUAL}>
                            Manual workspace ID
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Catalog results: {filteredPromptCatalog.length} /{' '}
                      {promptCatalog.length}
                    </span>
                    <span>Workspace options: {workspaceScopes.length}</span>
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    className="h-9"
                    disabled={
                      nextPromptName === promptName &&
                      nextWorkspaceId === workspaceId
                    }
                  >
                    Test route
                  </Button>
                </form>

                <PromptCatalogSummary
                  prompt={activePromptMetadata}
                  workspaceId={workspaceId}
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Active prompt
                    </div>
                    <div className="mt-1 break-words font-medium">
                      {promptName}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Workspace scope
                    </div>
                    <div className="mt-1 break-words font-medium">
                      {workspaceId || 'Global'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Workspace metadata
                    </div>
                    <div className="mt-1 break-words font-medium">
                      {workspaceId
                        ? activeWorkspaceScope
                          ? compactList([
                              activeWorkspaceScope.role,
                              activeWorkspaceScope.enableAi
                                ? 'AI enabled'
                                : 'AI disabled',
                              activeWorkspaceScope.enableDocEmbedding
                                ? 'Embedding enabled'
                                : 'Embedding disabled',
                            ])
                          : 'Manual ID, metadata unavailable'
                        : 'Global policy'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Candidate models
                    </div>
                    <div className="mt-1 font-medium">{models.length}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Prompt default
                    </div>
                    <div className="mt-1 break-words font-medium">
                      {modelsPayload?.promptDefaultModel ?? 'Unknown'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Active default
                    </div>
                    <div className="mt-1 break-words font-medium">
                      {modelsPayload?.defaultModel ?? 'Unknown'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Default source
                    </div>
                    <div className="mt-1 break-words font-medium">
                      {modelsPayload
                        ? formatFeatureKind(modelsPayload.defaultModelSource)
                        : 'Unknown'}
                    </div>
                    {modelsPayload?.defaultModelFallbackReason ? (
                      <div className="mt-1 break-words text-xs text-muted-foreground">
                        {formatFeatureKind(
                          modelsPayload.defaultModelFallbackReason
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Active source chain
                    </div>
                    <div className="mt-1 break-words font-medium">
                      {activeDefaultSourceChain || 'Unknown'}
                    </div>
                    {activeDefaultPromptSourceChain ? (
                      <div className="mt-1 break-words text-xs text-muted-foreground">
                        {activeDefaultPromptSourceChain}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Recommended checks
                    </div>
                    <div className="mt-1">
                      <RecommendedChecks actions={recommendedActionKinds} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card shadow-1">
              <CardHeader>
                <CardTitle className="text-base">Overall health</CardTitle>
                <CardDescription>
                  Embedding and rerank route readiness
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  {diagnostics.status === 'ready' ? (
                    <CheckCircle2Icon className="h-4 w-4 text-emerald-700" />
                  ) : (
                    <AlertCircleIcon className="h-4 w-4 text-amber-700" />
                  )}
                  <span className="font-medium">
                    {STATUS_LABELS[diagnostics.status]}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  Highest severity: {diagnostics.highestSeverity}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <RouteSummaryCard
              label="Workspace indexing"
              rawRoute={modelsPayload?.embeddingRoute}
              route={embeddingDiagnostics}
            />
            <RouteSummaryCard
              label="Rerank"
              rawRoute={modelsPayload?.rerankRoute}
              route={rerankDiagnostics}
            />
          </div>

          <ActionRunTraceCard
            actionRunId={actionRunId}
            actionRunIdInput={actionRunIdInput}
            onActionRunIdInputChange={setActionRunIdInput}
            onActionRunSelect={onActionRunSelect}
            onSubmit={onActionRunSubmit}
            workspaceId={workspaceId}
          />

          <ModelTable models={models} promptName={promptName} />
        </div>
      </ScrollArea>
    </div>
  );
}

export function AiPage() {
  return (
    <Suspense fallback={<AiPageSkeleton />}>
      <AiPageContent />
    </Suspense>
  );
}

export { AiPage as Component };
