import { NotFoundException } from '@nestjs/common';
import {
  Args,
  Field,
  Float,
  GraphQLISODateTime,
  ID,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Parent,
  registerEnumType,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { Transactional } from '@nestjs-cls/transactional';
import type {
  AiContextCheckpoint,
  AiContextCompactionTask,
} from '@prisma/client';
import { GraphQLJSON, SafeIntResolver } from 'graphql-scalars';

import { BadRequest, Throttle } from '../../base';
import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import type {
  CopilotContextDocumentRef,
  CopilotContextMemoryKind,
  CopilotContextMemoryScope,
  CopilotContextMemoryStatus,
  CopilotContextProjectRole,
  CopilotContextProjectStatus,
  CopilotContextRuleConditions,
  CopilotContextRuleMode,
  CopilotContextRuleStatus,
} from '../../models';
import { Models } from '../../models';
import {
  classifyContextMemoryDlp,
  ContextMemoryService,
} from './context-memory-service';
import { ContextRuleService } from './context-rule-service';
import { CopilotType } from './resolver';
import { ChatSessionService } from './session';

enum CopilotContextMemoryScopeInputValue {
  user = 'user',
  workspace = 'workspace',
  document = 'document',
  project = 'project',
}

enum CopilotContextMemoryManualKindInputValue {
  rule = 'rule',
  project_summary = 'project_summary',
}

enum CopilotContextMemoryMutableStatusInputValue {
  active = 'active',
  disabled = 'disabled',
}

registerEnumType(CopilotContextMemoryScopeInputValue, {
  name: 'CopilotContextMemoryScopeInput',
});
registerEnumType(CopilotContextMemoryManualKindInputValue, {
  name: 'CopilotContextMemoryManualKindInput',
});
registerEnumType(CopilotContextMemoryMutableStatusInputValue, {
  name: 'CopilotContextMemoryMutableStatusInput',
});

@ObjectType()
export class CopilotContextMemoryType {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  ownerUserId!: string | null;

  @Field(() => String, { nullable: true })
  workspaceId!: string | null;

  @Field(() => String, { nullable: true })
  docId!: string | null;

  @Field(() => String, { nullable: true })
  projectId!: string | null;

  @Field(() => String, { nullable: true })
  sourceSessionId!: string | null;

  @Field(() => String)
  scope!: string;

  @Field(() => String)
  kind!: string;

  @Field(() => String)
  visibility!: string;

  @Field(() => String)
  status!: string;

  @Field(() => String)
  content!: string;

  @Field(() => String, { nullable: true })
  factKey!: string | null;

  @Field(() => Float)
  confidence!: number;

  @Field(() => Float)
  importance!: number;

  @Field(() => String)
  sensitivity!: string;

  @Field(() => String)
  captureMode!: string;

  @Field(() => String)
  writerVersion!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  validFrom!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  validUntil!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  expiresAt!: Date | null;

  @Field(() => String, { nullable: true })
  supersedesId!: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  lastUsedAt!: Date | null;

  @Field(() => Int)
  useCount!: number;

  @Field(() => Int)
  revision!: number;

  @Field(() => String)
  sharingStatus!: string;

  @Field(() => String)
  contractVersion!: string;

  @Field(() => [String], { nullable: true })
  contributorUserIds?: string[];

  @Field(() => Int, { nullable: true })
  contributorCount?: number;

  @Field(() => Int, { nullable: true })
  pendingConflictCount?: number;

  @Field(() => Boolean, { nullable: true })
  canManage?: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@ObjectType()
export class CopilotContextMemoryEventType {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  sourceSessionId!: string | null;

  @Field(() => String, { nullable: true })
  sourceTurnId!: string | null;

  @Field(() => String)
  operation!: string;

  @Field(() => String, { nullable: true })
  memoryId!: string | null;

  @Field(() => String, { nullable: true })
  previousMemoryId!: string | null;

  @Field(() => String, { nullable: true })
  targetEventId!: string | null;

  @Field(() => String, { nullable: true })
  factKey!: string | null;

  @Field(() => Boolean)
  explicit!: boolean;

  @Field(() => String)
  reasonCode!: string;

  @Field(() => String)
  writerVersion!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  undoneAt!: Date | null;

  @Field(() => Boolean)
  canUndo!: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType()
export class CopilotContextRuleRevisionType {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  revision!: number;

  @Field(() => String)
  content!: string;

  @Field(() => String)
  fingerprint!: string;

  @Field(() => String, { nullable: true })
  createdByUserId!: string | null;

  @Field(() => String)
  source!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType()
export class CopilotContextRuleHitType {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  sessionId!: string;

  @Field(() => String, { nullable: true })
  sourceTurnId!: string | null;

  @Field(() => String)
  matchReason!: string;

  @Field(() => Float)
  score!: number;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType()
export class CopilotContextRuleType {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  ownerUserId!: string | null;

  @Field(() => String, { nullable: true })
  workspaceId!: string | null;

  @Field(() => String, { nullable: true })
  projectId!: string | null;

  @Field(() => String)
  scope!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  description!: string;

  @Field(() => String)
  applicationMode!: string;

  @Field(() => Int)
  priority!: number;

  @Field(() => GraphQLJSON)
  conditions!: CopilotContextRuleConditions;

  @Field(() => String)
  status!: string;

  @Field(() => Int)
  activeRevision!: number;

  @Field(() => [CopilotContextRuleRevisionType])
  revisions!: CopilotContextRuleRevisionType[];

  @Field(() => [CopilotContextRuleHitType])
  hits!: CopilotContextRuleHitType[];

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@ObjectType()
export class CopilotContextPolicyRevisionType {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  revision!: number;

  @Field(() => String)
  content!: string;

  @Field(() => String)
  fingerprint!: string;

  @Field(() => String, { nullable: true })
  createdByUserId!: string | null;

  @Field(() => String)
  source!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType()
export class CopilotContextPolicyType {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  workspaceId!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  description!: string;

  @Field(() => String)
  applicationMode!: string;

  @Field(() => Int)
  priority!: number;

  @Field(() => GraphQLJSON)
  conditions!: CopilotContextRuleConditions;

  @Field(() => String)
  status!: string;

  @Field(() => Int)
  activeRevision!: number;

  @Field(() => [CopilotContextPolicyRevisionType])
  revisions!: CopilotContextPolicyRevisionType[];

  @Field(() => [CopilotContextRuleHitType])
  hits!: CopilotContextRuleHitType[];

  @Field(() => Boolean)
  canManage!: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@ObjectType()
export class CopilotContextScopeProjectType {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

@ObjectType()
export class CopilotContextDocumentRefType {
  @Field(() => String)
  workspaceId!: string;

  @Field(() => String)
  docId!: string;
}

@ObjectType()
export class CopilotContextSessionScopeType {
  @Field(() => String)
  sessionId!: string;

  @Field(() => String, { nullable: true })
  primaryDocId!: string | null;

  @Field(() => [String])
  readableDocIds!: string[];

  @Field(() => [CopilotContextDocumentRefType])
  readableDocumentRefs!: CopilotContextDocumentRefType[];

  @Field(() => [String])
  candidateProjectIds!: string[];

  @Field(() => [String])
  projectIds!: string[];

  @Field(() => String, { nullable: true })
  selectedProjectId!: string | null;

  @Field(() => String)
  projectResolution!: string;

  @Field(() => [CopilotContextScopeProjectType])
  candidateProjects!: CopilotContextScopeProjectType[];
}

@ObjectType()
export class CopilotContextSettingsType {
  @Field(() => Boolean)
  autoMemoryEnabled!: boolean;

  @Field(() => Int)
  revision!: number;

  @Field(() => Int, { nullable: true })
  projectMemoryRevision?: number;

  @Field(() => String, { nullable: true })
  contractVersion?: string;
}

@ObjectType()
export class CopilotProjectSessionMemoryCaptureType {
  @Field(() => ID)
  sessionId!: string;

  @Field(() => ID)
  projectId!: string;

  @Field(() => Boolean)
  allowMemoryCapture!: boolean;

  @Field(() => Int)
  revision!: number;
}

@ObjectType()
export class CopilotProjectMemoryConflictType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  projectId!: string;

  @Field(() => ID)
  baseMemoryId!: string;

  @Field(() => String, { nullable: true })
  proposedByUserId!: string | null;

  @Field(() => String)
  factKey!: string;

  @Field(() => String)
  proposedContent!: string;

  @Field(() => String)
  status!: string;

  @Field(() => Int)
  expectedMemoryRevision!: number;

  @Field(() => String, { nullable: true })
  resolution!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  resolvedAt!: Date | null;
}

@ObjectType()
export class CopilotContextStrategyType {
  @Field(() => String)
  version!: string;

  @Field(() => String)
  fingerprint!: string;

  @Field(() => String)
  status!: string;

  @Field(() => Int)
  checkpointCount!: number;

  @Field(() => GraphQLISODateTime, { nullable: true })
  lastCheckpointAt!: Date | null;

  @Field(() => Int)
  traceCount!: number;

  @Field(() => GraphQLISODateTime, { nullable: true })
  lastTraceAt!: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType()
export class CopilotContextCompactionTaskType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  sessionId!: string;

  @Field(() => Int)
  contextEpoch!: number;

  @Field(() => String)
  status!: string;

  @Field(() => Int)
  summarizedMessageCount!: number;

  @Field(() => Int)
  attempt!: number;

  @Field(() => Int)
  maxAttempts!: number;

  @Field(() => Int, { nullable: true })
  inputBudget!: number | null;

  @Field(() => Int, { nullable: true })
  inputTokensEstimated!: number | null;

  @Field(() => Int, { nullable: true })
  outputTokensEstimated!: number | null;

  @Field(() => Int, { nullable: true })
  outputCharacters!: number | null;

  @Field(() => String, { nullable: true })
  failureCode!: string | null;

  @Field(() => String, { nullable: true })
  failureMessage!: string | null;

  @Field(() => ID, { nullable: true })
  checkpointId!: string | null;

  @Field(() => String, { nullable: true })
  summary!: string | null;

  @Field(() => GraphQLJSON, { nullable: true })
  summaryData!: Record<string, unknown> | null;

  @Field(() => GraphQLISODateTime)
  requestedAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  completedAt!: Date | null;
}

@ObjectType()
export class CopilotContextCompactionEventType {
  @Field(() => ID)
  id!: string;

  @Field(() => SafeIntResolver)
  sequence!: number;

  @Field(() => ID)
  taskId!: string;

  @Field(() => ID)
  sessionId!: string;

  @Field(() => Int)
  contextEpoch!: number;

  @Field(() => String)
  status!: string;

  @Field(() => Int)
  attempt!: number;

  @Field(() => GraphQLJSON)
  statistics!: Record<string, unknown>;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType()
export class CopilotSessionDeletionType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  sessionId!: string;

  @Field(() => String)
  status!: string;

  @Field(() => Int)
  contextEpoch!: number;

  @Field(() => Int)
  attempt!: number;

  @Field(() => Int)
  maxAttempts!: number;

  @Field(() => GraphQLJSON)
  progress!: Record<string, unknown>;

  @Field(() => GraphQLJSON)
  resultCounts!: Record<string, unknown>;

  @Field(() => String, { nullable: true })
  failureCode!: string | null;

  @Field(() => String, { nullable: true })
  failureMessage!: string | null;

  @Field(() => String, { nullable: true })
  holdReason!: string | null;

  @Field(() => String)
  backupStatus!: string;

  @Field(() => String, { nullable: true })
  receiptFingerprint!: string | null;

  @Field(() => GraphQLISODateTime)
  requestedAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  heldAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  releasedAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  completedAt!: Date | null;
}

@ObjectType()
export class CopilotContextProjectMemberType {
  @Field(() => String)
  userId!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  email!: string;

  @Field(() => String, { nullable: true })
  avatarUrl!: string | null;

  @Field(() => String)
  role!: CopilotContextProjectRole;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

@ObjectType()
export class CopilotContextProjectType {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  createdByUserId!: string | null;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  description!: string;

  @Field(() => String)
  status!: string;

  @Field(() => String)
  aiPolicy!: string;

  @Field(() => String)
  role!: CopilotContextProjectRole;

  @Field(() => [CopilotContextProjectMemberType])
  members!: CopilotContextProjectMemberType[];

  @Field(() => Boolean)
  canManage!: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@InputType()
export class CopilotContextRuleDocumentRefInput implements CopilotContextDocumentRef {
  @Field(() => String)
  workspaceId!: string;

  @Field(() => String)
  docId!: string;
}

@InputType()
export class CreateCopilotContextMemoryInput {
  @Field(() => String, { nullable: true })
  workspaceId?: string;

  @Field(() => String, { nullable: true })
  docId?: string;

  @Field(() => String, { nullable: true })
  projectId?: string;

  @Field(() => CopilotContextMemoryScopeInputValue)
  scope!: CopilotContextMemoryScope;

  @Field(() => CopilotContextMemoryManualKindInputValue)
  kind!: Exclude<CopilotContextMemoryKind, 'auto_memory'>;

  @Field(() => String)
  content!: string;

  @Field(() => [CopilotContextRuleDocumentRefInput], { nullable: true })
  sourceDocuments?: CopilotContextRuleDocumentRefInput[];
}

@InputType()
export class UpdateCopilotContextMemoryInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  content?: string;

  @Field(() => CopilotContextMemoryMutableStatusInputValue, { nullable: true })
  status?: CopilotContextMemoryStatus;

  @Field(() => Int, { nullable: true })
  expectedRevision?: number;
}

@InputType()
export class CopilotContextRuleConditionsInput {
  @Field(() => [String], { nullable: true })
  keywords?: string[];

  @Field(() => [String], { nullable: true })
  docIds?: string[];

  @Field(() => [CopilotContextRuleDocumentRefInput], { nullable: true })
  documentRefs?: CopilotContextRuleDocumentRefInput[];

  @Field(() => [String], { nullable: true })
  projectIds?: string[];

  @Field(() => String, { nullable: true })
  match?: 'any' | 'all';
}

@InputType()
export class CreateCopilotContextRuleInput {
  @Field(() => String, { nullable: true })
  workspaceId?: string;

  @Field(() => String, { nullable: true })
  projectId?: string;

  @Field(() => String)
  scope!: 'user' | 'workspace' | 'project';

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String)
  applicationMode!: CopilotContextRuleMode;

  @Field(() => Int)
  priority!: number;

  @Field(() => CopilotContextRuleConditionsInput, { nullable: true })
  conditions?: CopilotContextRuleConditionsInput;

  @Field(() => String)
  content!: string;
}

@InputType()
export class UpdateCopilotContextRuleInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  applicationMode?: CopilotContextRuleMode;

  @Field(() => Int, { nullable: true })
  priority?: number;

  @Field(() => CopilotContextRuleConditionsInput, { nullable: true })
  conditions?: CopilotContextRuleConditionsInput;

  @Field(() => String, { nullable: true })
  status?: CopilotContextRuleStatus;

  @Field(() => String, { nullable: true })
  content?: string;
}

@InputType()
export class CreateCopilotContextPolicyInput {
  @Field(() => String)
  workspaceId!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String)
  applicationMode!: Exclude<CopilotContextRuleMode, 'manual'>;

  @Field(() => Int)
  priority!: number;

  @Field(() => CopilotContextRuleConditionsInput, { nullable: true })
  conditions?: CopilotContextRuleConditionsInput;

  @Field(() => String)
  content!: string;
}

@InputType()
export class UpdateCopilotContextPolicyInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  workspaceId!: string;

  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  applicationMode?: Exclude<CopilotContextRuleMode, 'manual'>;

  @Field(() => Int, { nullable: true })
  priority?: number;

  @Field(() => CopilotContextRuleConditionsInput, { nullable: true })
  conditions?: CopilotContextRuleConditionsInput;

  @Field(() => String, { nullable: true })
  status?: CopilotContextRuleStatus;

  @Field(() => String, { nullable: true })
  content?: string;
}

@InputType()
export class UpdateCopilotContextSettingsInput {
  @Field(() => String)
  workspaceId!: string;

  @Field(() => Boolean)
  autoMemoryEnabled!: boolean;
}

@InputType()
export class UpdateCopilotProjectContextSettingsInput {
  @Field(() => String)
  projectId!: string;

  @Field(() => Boolean)
  autoMemoryEnabled!: boolean;

  @Field(() => Int)
  expectedRevision!: number;
}

@InputType()
export class UpdateCopilotProjectSessionMemoryCaptureInput {
  @Field(() => ID)
  sessionId!: string;

  @Field(() => Boolean)
  allowMemoryCapture!: boolean;

  @Field(() => Int)
  expectedRevision!: number;
}

@InputType()
export class ResolveCopilotProjectMemoryConflictInput {
  @Field(() => ID)
  projectId!: string;

  @Field(() => ID)
  conflictId!: string;

  @Field(() => String)
  resolution!: 'accept' | 'reject';
}

@InputType()
export class CreateCopilotContextProjectInput {
  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;
}

@InputType()
export class UpdateCopilotContextProjectInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  status?: CopilotContextProjectStatus;
}

type StoredMemory = NonNullable<
  Awaited<ReturnType<ContextMemoryService['get']>>
>;
type StoredProject = NonNullable<
  Awaited<ReturnType<ContextMemoryService['getProject']>>
>;
type StoredRule = NonNullable<
  Awaited<ReturnType<ContextRuleService['getRule']>>
>;
type StoredPolicy = NonNullable<
  Awaited<ReturnType<ContextRuleService['getPolicy']>>
>;

@Resolver(() => CopilotType)
@Throttle()
export class CopilotContextMemoryResolver {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly contextMemory: ContextMemoryService,
    private readonly ruleService: ContextRuleService,
    private readonly models: Models,
    private readonly sessions: ChatSessionService
  ) {}

  private presentContextCompactionTask(
    task:
      | (AiContextCompactionTask & {
          checkpoint?: Pick<
            AiContextCheckpoint,
            'summary' | 'summaryData'
          > | null;
        })
      | null
  ) {
    if (!task) return null;
    return {
      ...task,
      summary: task.checkpoint?.summary ?? task.resultSummary ?? null,
      summaryData:
        task.checkpoint?.summaryData ?? task.resultSummaryData ?? null,
    };
  }

  private presentSessionDeletion<T extends { status: string }>(deletion: T) {
    return {
      ...deletion,
      backupStatus:
        deletion.status === 'held' ? 'held' : 'pending_retention_expiry',
    };
  }

  private assertDlpSafe(content: string) {
    const dlp = classifyContextMemoryDlp(content);
    if (dlp.blocked) {
      throw new BadRequest(
        'AI context cannot store secrets, credentials, contact details, or customer identifiers'
      );
    }
  }

  private validateDirectiveShape(input: {
    name?: string;
    description?: string;
    applicationMode?: CopilotContextRuleMode;
    priority?: number;
    conditions?: CopilotContextRuleConditionsInput;
    status?: CopilotContextRuleStatus;
    content?: string;
  }) {
    const name = input.name?.replace(/\s+/g, ' ').trim();
    const description = input.description?.trim();
    const content = input.content?.replace(/\s+/g, ' ').trim();
    if (input.name !== undefined && (!name || name.length > 120)) {
      throw new BadRequest('Name must be between 1 and 120 characters');
    }
    if (description !== undefined && description.length > 2_000) {
      throw new BadRequest('Description cannot exceed 2000 characters');
    }
    if (input.content !== undefined && (!content || content.length > 8_000)) {
      throw new BadRequest('Content must be between 1 and 8000 characters');
    }
    if (
      input.applicationMode !== undefined &&
      !['always', 'relevant', 'manual'].includes(input.applicationMode)
    ) {
      throw new BadRequest('Invalid application mode');
    }
    if (
      input.status !== undefined &&
      !['active', 'disabled'].includes(input.status)
    ) {
      throw new BadRequest('Invalid directive status');
    }
    if (
      input.priority !== undefined &&
      (!Number.isInteger(input.priority) ||
        input.priority < -1_000 ||
        input.priority > 1_000)
    ) {
      throw new BadRequest(
        'Priority must be an integer between -1000 and 1000'
      );
    }
    for (const value of [name, description, content]) {
      if (value) this.assertDlpSafe(value);
    }

    const normalizeList = (values?: string[]) =>
      values === undefined
        ? undefined
        : [...new Set(values.map(value => value.trim()).filter(Boolean))];
    const conditions: CopilotContextRuleConditions = {
      keywords: normalizeList(input.conditions?.keywords),
      docIds: normalizeList(input.conditions?.docIds),
      documentRefs:
        input.conditions?.documentRefs === undefined
          ? undefined
          : [
              ...new Map(
                input.conditions.documentRefs.flatMap(document => {
                  const workspaceId = document.workspaceId.trim();
                  const docId = document.docId.trim();
                  return workspaceId && docId
                    ? [
                        [
                          `${workspaceId}\0${docId}`,
                          { workspaceId, docId },
                        ] as const,
                      ]
                    : [];
                })
              ).values(),
            ],
      projectIds: normalizeList(input.conditions?.projectIds),
      match: input.conditions?.match === 'all' ? 'all' : 'any',
    };
    for (const values of [
      conditions.keywords,
      conditions.docIds,
      conditions.documentRefs,
      conditions.projectIds,
    ]) {
      if (values && values.length > 100) {
        throw new BadRequest('A condition list cannot exceed 100 values');
      }
      if (
        values?.some(value =>
          typeof value === 'string'
            ? value.length > 200
            : value.workspaceId.length > 200 || value.docId.length > 200
        )
      ) {
        throw new BadRequest('A condition value cannot exceed 200 characters');
      }
    }
    for (const keyword of conditions.keywords ?? []) {
      this.assertDlpSafe(keyword);
    }
    return { name, description, content, conditions };
  }

  private async assertRuleOwner(userId: string, rule: StoredRule | null) {
    if (!rule) {
      throw new NotFoundException('Context rule not found');
    }
    if (rule.scope === 'project') {
      await this.requireFullyReadableProject(
        userId,
        rule.projectId,
        rule.ownerUserId === userId ? 'member' : 'owner'
      );
      return;
    }
    if (rule.ownerUserId !== userId) {
      throw new NotFoundException('Context rule not found');
    }
  }

  private async assertPolicyManager(
    userId: string,
    policy: StoredPolicy | null,
    workspaceId: string
  ) {
    if (!policy || policy.workspaceId !== workspaceId) {
      throw new NotFoundException('Context policy not found');
    }
    await this.assertWorkspaceProjectManager(userId, workspaceId);
  }

  private validateMemoryShape(input: CreateCopilotContextMemoryInput) {
    const content = input.content.trim();
    if (!content) throw new BadRequest('Memory content is required');
    if (content.length > 8_000) {
      throw new BadRequest(
        'Context memory content cannot exceed 8000 characters'
      );
    }
    this.assertDlpSafe(content);
    if (
      !['user', 'workspace', 'document', 'project'].includes(input.scope) ||
      !['rule', 'project_summary'].includes(input.kind)
    ) {
      throw new BadRequest('Invalid context memory type');
    }
    if (
      input.scope === 'user' &&
      (input.workspaceId || input.docId || input.projectId)
    ) {
      throw new BadRequest(
        'User-scoped memory cannot target a workspace, document, or project'
      );
    }
    if (
      input.scope === 'workspace' &&
      (!input.workspaceId || input.docId || input.projectId)
    ) {
      throw new BadRequest('Workspace-scoped memory requires only workspaceId');
    }
    if (
      input.scope === 'document' &&
      (!input.workspaceId || !input.docId || input.projectId)
    ) {
      throw new BadRequest(
        'Document-scoped memory requires workspaceId and docId'
      );
    }
    if (
      input.scope === 'project' &&
      (input.workspaceId || input.docId || !input.projectId)
    ) {
      throw new BadRequest('Project-scoped memory requires only projectId');
    }
    if (input.kind === 'project_summary' && input.scope !== 'project') {
      throw new BadRequest('Project summaries must use project scope');
    }
    if (input.scope !== 'project' && input.sourceDocuments !== undefined) {
      throw new BadRequest(
        'Source documents are supported only for project-scoped memory'
      );
    }
    return content;
  }

  private validateProjectShape(input: {
    name?: string;
    description?: string;
    status?: CopilotContextProjectStatus;
  }) {
    const name = input.name?.trim();
    const description = input.description?.trim();
    if (input.name !== undefined && (!name || name.length > 120)) {
      throw new BadRequest('Project name must be between 1 and 120 characters');
    }
    if (description !== undefined && description.length > 2_000) {
      throw new BadRequest('Project description cannot exceed 2000 characters');
    }
    if (
      input.status !== undefined &&
      !['active', 'archived'].includes(input.status)
    ) {
      throw new BadRequest('Invalid project status');
    }
    return { name, description };
  }

  private async fullyReadableProjects(
    userId: string,
    projects: StoredProject[]
  ) {
    return projects.filter(
      project =>
        project.status === 'active' && this.projectRole(userId, project)
    );
  }

  private async presentProjects(
    userId: string,
    projects: StoredProject[]
  ): Promise<CopilotContextProjectType[]> {
    const presented = await Promise.all(
      projects.map(async project => {
        const role = this.projectRole(userId, project);
        if (!role) return null;
        const users = await this.models.user.getWorkspaceUsers(
          project.members.map(member => member.userId)
        );
        const userById = new Map(users.map(user => [user.id, user]));
        return {
          ...project,
          role,
          canManage: role === 'owner',
          members: project.members.flatMap(member => {
            const user = userById.get(member.userId);
            return user
              ? [
                  {
                    userId: member.userId,
                    name: user.name,
                    email: user.email,
                    avatarUrl: user.avatarUrl,
                    role: member.role as CopilotContextProjectRole,
                    createdAt: member.createdAt,
                  },
                ]
              : [];
          }),
        };
      })
    );
    return presented.filter(
      (project): project is NonNullable<typeof project> => project !== null
    );
  }

  private async assertRead(
    userId: string,
    input: {
      workspaceId?: string | null;
      docId?: string | null;
      projectId?: string | null;
    }
  ) {
    if (input.projectId) {
      await this.requireFullyReadableProject(userId, input.projectId, 'member');
      return;
    }
    if (!input.workspaceId) return;
    if (input.docId) {
      await this.ac
        .user(userId)
        .doc({
          workspaceId: input.workspaceId,
          docId: input.docId,
        })
        .allowLocal()
        .assert('Doc.Read');
      return;
    }
    await this.ac
      .user(userId)
      .workspace(input.workspaceId)
      .allowLocal()
      .assert('Workspace.Copilot');
  }

  private projectRole(userId: string, project: StoredProject | null) {
    return project?.members.find(member => member.userId === userId)?.role as
      | CopilotContextProjectRole
      | undefined;
  }

  private requireProjectMembership(
    userId: string,
    project: StoredProject | null
  ) {
    const role = this.projectRole(userId, project);
    if (!project || !role) {
      throw new NotFoundException('Context project not found');
    }
    return { project, role };
  }

  private requireProjectOwner(userId: string, project: StoredProject | null) {
    const membership = this.requireProjectMembership(userId, project);
    const { role } = membership;
    if (role !== 'owner') {
      throw new NotFoundException('Context project not found');
    }
    return membership.project;
  }

  private async requireFullyReadableProject(
    userId: string,
    projectId: string | null | undefined,
    requiredRole: 'member' | 'owner'
  ) {
    if (!projectId) {
      throw new NotFoundException('Context project not found');
    }
    const storedProject = await this.contextMemory.getProject(projectId);
    const { project, role } = this.requireProjectMembership(
      userId,
      storedProject
    );
    if (
      project.status !== 'active' ||
      (requiredRole === 'owner' && role !== 'owner')
    ) {
      throw new NotFoundException('Context project not found');
    }
    return project;
  }

  private async assertDocumentsReadable(
    userId: string,
    workspaceId: string,
    documentIds: string[]
  ) {
    const documents = documentIds.map(docId => ({ docId }));
    const accessible = await this.ac
      .user(userId)
      .workspace(workspaceId)
      .allowLocal()
      .docs(documents, 'Doc.Read');
    if (accessible.length !== documents.length) {
      throw new NotFoundException(
        'One or more project documents are not accessible'
      );
    }
  }

  private async assertWorkspaceProjectManager(
    userId: string,
    workspaceId: string
  ) {
    await this.ac
      .user(userId)
      .workspace(workspaceId)
      .allowLocal()
      .assert('Workspace.Settings.Update');
  }

  private async assertDirectiveConditionsReadable(
    userId: string,
    workspaceId: string | null | undefined,
    conditions: CopilotContextRuleConditions,
    projectId?: string | null
  ) {
    for (const projectId of conditions.projectIds ?? []) {
      await this.requireFullyReadableProject(userId, projectId, 'member');
    }
    if (conditions.documentRefs?.length) {
      const refsByWorkspace = new Map<string, string[]>();
      for (const document of conditions.documentRefs) {
        const docIds = refsByWorkspace.get(document.workspaceId) ?? [];
        docIds.push(document.docId);
        refsByWorkspace.set(document.workspaceId, docIds);
      }
      await Promise.all(
        [...refsByWorkspace].map(([sourceWorkspaceId, docIds]) =>
          this.assertDocumentsReadable(userId, sourceWorkspaceId, docIds)
        )
      );
      if (projectId) {
        throw new BadRequest(
          'Project rules cannot reference Workspace documents'
        );
      }
    }
    if (!workspaceId) {
      if (conditions.docIds?.length) {
        throw new BadRequest(
          'Rules without a workspace cannot use document conditions'
        );
      }
      return;
    }
    if (conditions.docIds?.length) {
      await this.assertDocumentsReadable(
        userId,
        workspaceId,
        conditions.docIds
      );
    }
  }

  private async assertCanMutate(user: CurrentUserType, memory: StoredMemory) {
    if (memory.scope === 'project') {
      if (
        !memory.projectId ||
        !(await this.models.copilotContextMemory.canManageProjectMemory(
          user.id,
          memory.id
        ))
      ) {
        throw new NotFoundException('Context memory not found');
      }
      return;
    }
    if (memory.ownerUserId !== user.id) {
      throw new NotFoundException('Context memory not found');
    }
  }

  private requireWorkspace(copilot: CopilotType) {
    if (!copilot.workspaceId) {
      throw new BadRequest('Workspace context is required');
    }
    return copilot.workspaceId;
  }

  @ResolveField(() => CopilotContextSettingsType, {
    description: 'Get the current user context preferences for this workspace',
  })
  async contextSettings(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType
  ) {
    const workspaceId = this.requireWorkspace(copilot);
    await this.assertRead(user.id, { workspaceId });
    return await this.contextMemory.getSettings(user.id, workspaceId);
  }

  @ResolveField(() => CopilotContextSettingsType, {
    description: 'Get the shared context settings for a Project',
  })
  async projectContextSettings(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('projectId', { type: () => ID }) projectId: string
  ) {
    await this.requireFullyReadableProject(user.id, projectId, 'member');
    return await this.contextMemory.getProjectSettings(user.id, projectId);
  }

  @ResolveField(() => CopilotProjectSessionMemoryCaptureType, {
    nullable: true,
    description:
      'Get whether this private Project conversation may automatically contribute to the shared Project memory',
  })
  async projectSessionMemoryCapture(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('sessionId', { type: () => ID }) sessionId: string
  ) {
    const session = await this.contextMemory.getProjectSessionMemoryCapture(
      user.id,
      sessionId
    );
    if (!session || !session.selectedContextProjectId) return null;
    return {
      sessionId: session.id,
      projectId: session.selectedContextProjectId,
      allowMemoryCapture: session.allowMemoryCapture,
      revision: session.memoryCaptureRevision,
    };
  }

  @ResolveField(() => [CopilotContextStrategyType], {
    description:
      'List immutable context planner revisions and checkpoint activity',
  })
  async contextPlannerStrategies(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType
  ) {
    const workspaceId = this.requireWorkspace(copilot);
    await this.assertRead(user.id, { workspaceId });
    return await this.contextMemory.listPlannerStrategies(user.id, workspaceId);
  }

  @ResolveField(() => CopilotContextCompactionTaskType, {
    nullable: true,
    description:
      'Get the latest private context compaction task for an owned conversation',
  })
  async contextCompaction(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('sessionId', { type: () => ID }) sessionId: string
  ) {
    return this.presentContextCompactionTask(
      await this.models.copilotContextMemory.getLatestContextCompactionTask(
        sessionId,
        user.id
      )
    );
  }

  @ResolveField(() => [CopilotContextCompactionEventType], {
    description:
      'Replay private context compaction status events for an owned conversation',
  })
  async contextCompactionEvents(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('sessionId', { type: () => ID }) sessionId: string,
    @Args('afterSequence', { type: () => SafeIntResolver, nullable: true })
    afterSequence?: number
  ) {
    const events =
      await this.models.copilotContextMemory.listContextCompactionEvents({
        sessionId,
        actorUserId: user.id,
        afterSequence,
      });
    return events.map(event => {
      const sequence = Number(event.sequence);
      if (!Number.isSafeInteger(sequence)) {
        throw new Error('Context compaction event sequence is out of range');
      }
      return { ...event, sequence };
    });
  }

  @ResolveField(() => CopilotSessionDeletionType, {
    nullable: true,
    description:
      'Get content-free purge progress for a deleted conversation owned by the current user',
  })
  async sessionDeletion(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('sessionId', { type: () => ID }) sessionId: string
  ) {
    const deletion = await this.sessions.getSessionDeletion(user.id, sessionId);
    return deletion ? this.presentSessionDeletion(deletion) : null;
  }

  @ResolveField(() => [CopilotContextProjectType], {
    description: 'List global context projects the current user belongs to',
  })
  async contextProjects(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('includeArchived', { nullable: true, defaultValue: false })
    includeArchived?: boolean
  ) {
    const projects = await this.contextMemory.listProjects(
      user.id,
      includeArchived
    );
    return await this.presentProjects(user.id, projects);
  }

  @ResolveField(() => CopilotContextProjectType, {
    description: 'Get a global context project by membership',
  })
  async contextProject(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('id', { type: () => ID }) id: string
  ) {
    const { project } = this.requireProjectMembership(
      user.id,
      await this.contextMemory.getProject(id)
    );
    const [presented] = await this.presentProjects(user.id, [project]);
    if (!presented) throw new NotFoundException('Context project not found');
    return presented;
  }

  @ResolveField(() => CopilotContextSessionScopeType, {
    nullable: true,
    description:
      'Resolve the readable documents and candidate context projects for a chat session',
  })
  async contextSessionScope(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('sessionId', { type: () => ID }) sessionId: string
  ) {
    const workspaceId = this.requireWorkspace(copilot);
    await this.assertRead(user.id, { workspaceId });
    return await this.contextMemory.resolveSessionScope(
      user.id,
      workspaceId,
      sessionId
    );
  }

  @ResolveField(() => [CopilotContextMemoryEventType], {
    description: 'List Automatic Memory writer and undo events',
  })
  async contextMemoryEvents(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 50 })
    limit?: number
  ) {
    const workspaceId = this.requireWorkspace(copilot);
    await this.assertRead(user.id, { workspaceId });
    const events = await this.contextMemory.listWriterEvents(
      user.id,
      workspaceId,
      limit
    );
    const undoableIds = new Set<string>();
    const seenFacts = new Set<string>();
    for (const event of events) {
      if (
        event.undoneAt !== null ||
        !['ADD', 'UPDATE', 'DELETE'].includes(event.operation) ||
        !event.memory
      ) {
        continue;
      }
      const factIdentity = [
        event.memory.scope,
        event.memory.docId ?? '',
        event.memory.projectId ?? '',
        event.factKey ?? event.id,
      ].join(':');
      if (seenFacts.has(factIdentity)) continue;
      seenFacts.add(factIdentity);
      const expectedStatus =
        event.operation === 'DELETE' ? 'deleted' : 'active';
      if (event.memory.status === expectedStatus) undoableIds.add(event.id);
    }
    return events.map(event => ({
      ...event,
      canUndo: undoableIds.has(event.id),
    }));
  }

  @ResolveField(() => [CopilotContextMemoryEventType], {
    description: 'List the current user Automatic Memory events for a Project',
  })
  async projectContextMemoryEvents(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('projectId', { type: () => ID }) projectId: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 50 })
    limit?: number
  ) {
    await this.requireFullyReadableProject(user.id, projectId, 'member');
    const events = await this.contextMemory.listWriterEvents(
      user.id,
      null,
      limit,
      projectId
    );
    const undoableIds = new Set<string>();
    const seenFacts = new Set<string>();
    for (const event of events) {
      if (
        event.undoneAt !== null ||
        !['ADD', 'UPDATE', 'DELETE'].includes(event.operation) ||
        !event.memory
      ) {
        continue;
      }
      const factIdentity = `${event.memory.projectId}:${event.factKey ?? event.id}`;
      if (seenFacts.has(factIdentity)) continue;
      seenFacts.add(factIdentity);
      const expectedStatus =
        event.operation === 'DELETE' ? 'deleted' : 'active';
      if (event.memory.status === expectedStatus) undoableIds.add(event.id);
    }
    return events.map(event => ({
      ...event,
      canUndo: undoableIds.has(event.id),
    }));
  }

  @ResolveField(() => [CopilotProjectMemoryConflictType], {
    description:
      'List pending shared Project memory conflicts for the Project Owner',
  })
  async projectMemoryConflicts(
    @Parent() _copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('projectId', { type: () => ID }) projectId: string
  ) {
    const project = await this.requireFullyReadableProject(
      user.id,
      projectId,
      'member'
    );
    if (this.projectRole(user.id, project) !== 'owner') return [];
    return await this.contextMemory.listProjectMemoryConflicts(projectId);
  }

  @ResolveField(() => [CopilotContextRuleType], {
    description: 'List the current user rules and revision history',
  })
  async contextRules(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('includeDisabled', { nullable: true, defaultValue: false })
    includeDisabled?: boolean
  ) {
    const workspaceId = this.requireWorkspace(copilot);
    await this.assertRead(user.id, { workspaceId });
    const projects = await this.contextMemory.listProjects(user.id, true);
    const accessibleProjects = await this.fullyReadableProjects(
      user.id,
      projects
    );
    return await this.ruleService.listRules({
      userId: user.id,
      workspaceId,
      projectIds: accessibleProjects.map(project => project.id),
      includeDisabled,
    });
  }

  @ResolveField(() => [CopilotContextPolicyType], {
    description: 'List workspace-enforced AI context policies',
  })
  async contextPolicies(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('includeDisabled', { nullable: true, defaultValue: false })
    includeDisabled?: boolean
  ) {
    const workspaceId = this.requireWorkspace(copilot);
    await this.assertRead(user.id, { workspaceId });
    const [policies, canManage] = await Promise.all([
      this.ruleService.listPolicies(workspaceId, includeDisabled),
      this.ac
        .user(user.id)
        .workspace(workspaceId)
        .allowLocal()
        .can('Workspace.Settings.Update'),
    ]);
    return policies.map(policy => ({ ...policy, canManage }));
  }

  @ResolveField(() => [CopilotContextMemoryType], {
    description:
      'List authorized rules, automatic memories, and project summaries',
  })
  async contextMemories(
    @Parent() copilot: CopilotType,
    @CurrentUser() user: CurrentUserType,
    @Args('docId', { nullable: true }) docId?: string,
    @Args('includeDisabled', { nullable: true, defaultValue: false })
    includeDisabled?: boolean
  ) {
    const workspaceId = copilot.workspaceId;
    await this.assertRead(user.id, { workspaceId, docId });
    if (docId) {
      return await this.contextMemory.listVisible({
        userId: user.id,
        workspaceId,
        docId,
        includeDisabled,
      });
    }

    if (!workspaceId) {
      const projects = await this.contextMemory.listProjects(user.id, true);
      const accessibleProjects = await this.fullyReadableProjects(
        user.id,
        projects
      );
      const memories = await this.contextMemory.listManageable({
        userId: user.id,
        projectIds: accessibleProjects.map(project => project.id),
        includeDisabled,
      });
      return await Promise.all(
        memories.map(async memory => {
          const contributorUserIds = [
            ...new Set(
              memory.contributions.flatMap(contribution =>
                contribution.contributorUserId
                  ? [contribution.contributorUserId]
                  : []
              )
            ),
          ];
          return {
            ...memory,
            // A shared-memory row may retain a private source-session pointer
            // for provenance; it is never disclosed to another member.
            sourceSessionId:
              memory.ownerUserId === user.id ? memory.sourceSessionId : null,
            contributorUserIds,
            contributorCount: contributorUserIds.length,
            pendingConflictCount: memory.conflicts.length,
            canManage:
              memory.scope !== 'project' ||
              (await this.models.copilotContextMemory.canManageProjectMemory(
                user.id,
                memory.id
              )),
          };
        })
      );
    }
    const projects = await this.contextMemory.listProjects(user.id, true);
    const accessibleProjects = await this.fullyReadableProjects(
      user.id,
      projects
    );
    const memories = await this.contextMemory.listManageable({
      userId: user.id,
      workspaceId,
      projectIds: accessibleProjects.map(project => project.id),
      includeDisabled,
    });
    const documentMemories = memories.filter(
      (memory): memory is typeof memory & { docId: string } => !!memory.docId
    );
    const accessibleDocuments = new Set(
      (
        await this.ac
          .user(user.id)
          .workspace(workspaceId)
          .allowLocal()
          .docs(documentMemories, 'Doc.Read')
      ).map(memory => memory.id)
    );
    return memories.filter(
      memory => !memory.docId || accessibleDocuments.has(memory.id)
    );
  }

  @Mutation(() => CopilotContextMemoryType)
  async createCopilotContextMemory(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: CreateCopilotContextMemoryInput
  ) {
    const content = this.validateMemoryShape(input);
    if (input.projectId) {
      await this.requireFullyReadableProject(
        user.id,
        input.projectId,
        'member'
      );
    } else {
      await this.assertRead(user.id, input);
    }
    return await this.contextMemory.create(user.id, {
      workspaceId: input.workspaceId ?? null,
      docId: input.docId ?? null,
      projectId: input.projectId ?? null,
      scope: input.scope,
      kind: input.kind,
      content,
      sourceDocuments: input.sourceDocuments,
    });
  }

  @Mutation(() => CopilotContextRuleType)
  async createCopilotContextRule(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: CreateCopilotContextRuleInput
  ) {
    const normalized = this.validateDirectiveShape(input);
    if (!normalized.name || !normalized.content) {
      throw new BadRequest('Rule name and content are required');
    }
    if (!['user', 'workspace', 'project'].includes(input.scope)) {
      throw new BadRequest('Invalid rule scope');
    }
    if (
      input.scope === 'workspace' &&
      (!input.workspaceId || input.projectId)
    ) {
      throw new BadRequest('Workspace rules require only workspaceId');
    }
    if (input.scope === 'project' && (input.workspaceId || !input.projectId)) {
      throw new BadRequest('Project rules require only projectId');
    }
    if (input.scope === 'user' && (input.workspaceId || input.projectId)) {
      throw new BadRequest('User rules cannot target a workspace or project');
    }
    if (input.scope === 'project') {
      await this.requireFullyReadableProject(
        user.id,
        input.projectId,
        'member'
      );
    } else if (input.workspaceId) {
      await this.assertRead(user.id, {
        workspaceId: input.workspaceId,
      });
    }
    await this.assertDirectiveConditionsReadable(
      user.id,
      input.scope === 'workspace' ? input.workspaceId : null,
      normalized.conditions,
      input.scope === 'project' ? input.projectId : null
    );
    return await this.ruleService.createRule({
      ownerUserId: user.id,
      workspaceId: input.scope === 'workspace' ? input.workspaceId : null,
      projectId: input.scope === 'project' ? input.projectId : null,
      scope: input.scope,
      name: normalized.name,
      description: normalized.description,
      applicationMode: input.applicationMode,
      priority: input.priority,
      conditions: normalized.conditions,
      content: normalized.content,
    });
  }

  @Mutation(() => CopilotContextPolicyType)
  async createCopilotContextPolicy(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: CreateCopilotContextPolicyInput
  ) {
    const normalized = this.validateDirectiveShape(input);
    if (!normalized.name || !normalized.content) {
      throw new BadRequest('Policy name and content are required');
    }
    if (!['always', 'relevant'].includes(input.applicationMode)) {
      throw new BadRequest('Workspace policies cannot use manual mode');
    }
    await this.assertWorkspaceProjectManager(user.id, input.workspaceId);
    await this.assertDirectiveConditionsReadable(
      user.id,
      input.workspaceId,
      normalized.conditions
    );
    const policy = await this.ruleService.createPolicy({
      workspaceId: input.workspaceId,
      createdByUserId: user.id,
      name: normalized.name,
      description: normalized.description,
      applicationMode: input.applicationMode,
      priority: input.priority,
      conditions: normalized.conditions,
      content: normalized.content,
    });
    return { ...policy, canManage: true };
  }

  @Mutation(() => CopilotContextProjectType)
  @Transactional()
  async createCopilotContextProject(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: CreateCopilotContextProjectInput
  ) {
    const normalized = this.validateProjectShape(input);
    if (!normalized.name) {
      throw new BadRequest('Project name is required');
    }
    const project = await this.contextMemory.createProject({
      createdByUserId: user.id,
      name: normalized.name,
      description: normalized.description,
    });
    const stored = await this.contextMemory.getProject(project.id);
    if (!stored) throw new NotFoundException('Context project not found');
    const [presented] = await this.presentProjects(user.id, [stored]);
    if (!presented) throw new NotFoundException('Context project not found');
    return presented;
  }

  @Mutation(() => CopilotContextProjectType)
  @Transactional()
  async updateCopilotContextProject(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotContextProjectInput
  ) {
    const normalized = this.validateProjectShape(input);
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.status === undefined
    ) {
      throw new BadRequest('No context project fields to update');
    }
    this.requireProjectOwner(
      user.id,
      await this.contextMemory.getProject(input.id)
    );
    const updated = await this.contextMemory.updateProject(input.id, user.id, {
      ...normalized,
      status: input.status,
    });
    if (!updated) throw new NotFoundException('Context project not found');
    const [presented] = await this.presentProjects(user.id, [updated]);
    if (!presented) throw new NotFoundException('Context project not found');
    return presented;
  }

  @Mutation(() => CopilotContextRuleType)
  async updateCopilotContextRule(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotContextRuleInput
  ) {
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.applicationMode === undefined &&
      input.priority === undefined &&
      input.conditions === undefined &&
      input.status === undefined &&
      input.content === undefined
    ) {
      throw new BadRequest('No context rule fields to update');
    }
    const rule = await this.ruleService.getRule(input.id);
    await this.assertRuleOwner(user.id, rule);
    const normalized = this.validateDirectiveShape(input);
    await this.assertDirectiveConditionsReadable(
      user.id,
      rule?.workspaceId,
      normalized.conditions,
      rule?.scope === 'project' ? rule.projectId : null
    );
    const updated = await this.ruleService.updateRule(input.id, user.id, {
      name: normalized.name,
      description: normalized.description,
      applicationMode: input.applicationMode,
      priority: input.priority,
      conditions:
        input.conditions === undefined ? undefined : normalized.conditions,
      status: input.status,
      content: normalized.content,
    });
    if (!updated) throw new NotFoundException('Context rule not found');
    return updated;
  }

  @Mutation(() => CopilotContextRuleType)
  async rollbackCopilotContextRule(
    @CurrentUser() user: CurrentUserType,
    @Args('id', { type: () => ID }) id: string,
    @Args('revision', { type: () => Int }) revision: number
  ) {
    if (!Number.isInteger(revision) || revision < 1) {
      throw new BadRequest('Revision must be a positive integer');
    }
    const rule = await this.ruleService.getRule(id);
    await this.assertRuleOwner(user.id, rule);
    const updated = await this.ruleService.rollbackRule(id, user.id, revision);
    if (!updated)
      throw new NotFoundException('Context rule revision not found');
    return updated;
  }

  @Mutation(() => CopilotContextPolicyType)
  async updateCopilotContextPolicy(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotContextPolicyInput
  ) {
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.applicationMode === undefined &&
      input.priority === undefined &&
      input.conditions === undefined &&
      input.status === undefined &&
      input.content === undefined
    ) {
      throw new BadRequest('No context policy fields to update');
    }
    if (
      input.applicationMode !== undefined &&
      !['always', 'relevant'].includes(input.applicationMode)
    ) {
      throw new BadRequest('Workspace policies cannot use manual mode');
    }
    const policy = await this.ruleService.getPolicy(input.id);
    await this.assertPolicyManager(user.id, policy, input.workspaceId);
    const normalized = this.validateDirectiveShape(input);
    await this.assertDirectiveConditionsReadable(
      user.id,
      input.workspaceId,
      normalized.conditions
    );
    const updated = await this.ruleService.updatePolicy(
      input.id,
      input.workspaceId,
      user.id,
      {
        name: normalized.name,
        description: normalized.description,
        applicationMode: input.applicationMode,
        priority: input.priority,
        conditions:
          input.conditions === undefined ? undefined : normalized.conditions,
        status: input.status,
        content: normalized.content,
      }
    );
    if (!updated) throw new NotFoundException('Context policy not found');
    return { ...updated, canManage: true };
  }

  @Mutation(() => CopilotContextPolicyType)
  async rollbackCopilotContextPolicy(
    @CurrentUser() user: CurrentUserType,
    @Args('id', { type: () => ID }) id: string,
    @Args('workspaceId') workspaceId: string,
    @Args('revision', { type: () => Int }) revision: number
  ) {
    if (!Number.isInteger(revision) || revision < 1) {
      throw new BadRequest('Revision must be a positive integer');
    }
    const policy = await this.ruleService.getPolicy(id);
    await this.assertPolicyManager(user.id, policy, workspaceId);
    const updated = await this.ruleService.rollbackPolicy(
      id,
      workspaceId,
      user.id,
      revision
    );
    if (!updated) {
      throw new NotFoundException('Context policy revision not found');
    }
    return { ...updated, canManage: true };
  }

  @Mutation(() => CopilotContextMemoryType)
  async updateCopilotContextMemory(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotContextMemoryInput
  ) {
    if (input.content !== undefined && !input.content.trim()) {
      throw new BadRequest('Memory content is required');
    }
    if (input.content !== undefined && input.content.trim().length > 8_000) {
      throw new BadRequest(
        'Context memory content cannot exceed 8000 characters'
      );
    }
    if (input.content !== undefined) {
      this.assertDlpSafe(input.content);
    }
    if (
      input.status !== undefined &&
      !['active', 'disabled'].includes(input.status)
    ) {
      throw new BadRequest('Invalid context memory status');
    }
    if (input.content === undefined && input.status === undefined) {
      throw new BadRequest('No context memory fields to update');
    }
    const memory = await this.contextMemory.get(input.id);
    if (!memory) throw new NotFoundException('Context memory not found');
    await this.assertCanMutate(user, memory);
    if (!['active', 'disabled'].includes(memory.status)) {
      throw new BadRequest('Historical memory versions cannot be edited');
    }
    const updated = await this.contextMemory.update(
      input.id,
      {
        content: input.content?.trim(),
        status: input.status,
        expectedRevision: input.expectedRevision,
      },
      user.id
    );
    if (!updated) throw new NotFoundException('Context memory not found');
    return updated;
  }

  @Mutation(() => CopilotContextSettingsType)
  async updateCopilotContextSettings(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotContextSettingsInput
  ) {
    await this.assertRead(user.id, { workspaceId: input.workspaceId });
    return await this.contextMemory.updateSettings({
      userId: user.id,
      workspaceId: input.workspaceId,
      autoMemoryEnabled: input.autoMemoryEnabled,
    });
  }

  @Mutation(() => CopilotContextSettingsType)
  async updateCopilotProjectContextSettings(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotProjectContextSettingsInput
  ) {
    await this.requireFullyReadableProject(user.id, input.projectId, 'owner');
    return await this.contextMemory.updateProjectSettings({
      userId: user.id,
      projectId: input.projectId,
      autoMemoryEnabled: input.autoMemoryEnabled,
      expectedRevision: input.expectedRevision,
    });
  }

  @Mutation(() => CopilotProjectSessionMemoryCaptureType)
  async updateCopilotProjectSessionMemoryCapture(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: UpdateCopilotProjectSessionMemoryCaptureInput
  ) {
    const updated = await this.contextMemory.updateProjectSessionMemoryCapture({
      userId: user.id,
      sessionId: input.sessionId,
      allowMemoryCapture: input.allowMemoryCapture,
      expectedRevision: input.expectedRevision,
    });
    if (!updated?.selectedContextProjectId) {
      throw new NotFoundException('Project session not found');
    }
    return {
      sessionId: updated.id,
      projectId: updated.selectedContextProjectId,
      allowMemoryCapture: updated.allowMemoryCapture,
      revision: updated.memoryCaptureRevision,
    };
  }

  @Mutation(() => CopilotContextCompactionTaskType, { nullable: true })
  async requestCopilotContextCompaction(
    @CurrentUser() user: CurrentUserType,
    @Args('sessionId', { type: () => ID }) sessionId: string
  ) {
    return this.presentContextCompactionTask(
      await this.sessions.requestManualContextCompaction(user.id, sessionId)
    );
  }

  @Mutation(() => CopilotContextCompactionTaskType)
  async retryCopilotContextCompaction(
    @CurrentUser() user: CurrentUserType,
    @Args('taskId', { type: () => ID }) taskId: string
  ) {
    const task = await this.sessions.retryContextCompaction(user.id, taskId);
    if (!task) throw new NotFoundException('Context compaction task not found');
    return this.presentContextCompactionTask(task);
  }

  @Mutation(() => CopilotContextCompactionTaskType)
  async cancelCopilotContextCompaction(
    @CurrentUser() user: CurrentUserType,
    @Args('taskId', { type: () => ID }) taskId: string
  ) {
    const task = await this.sessions.cancelContextCompaction(user.id, taskId);
    if (!task) throw new NotFoundException('Context compaction task not found');
    return this.presentContextCompactionTask(task);
  }

  @Mutation(() => CopilotSessionDeletionType)
  async retryCopilotSessionDeletion(
    @CurrentUser() user: CurrentUserType,
    @Args('sessionId', { type: () => ID }) sessionId: string
  ) {
    const deletion = await this.sessions.retrySessionDeletion(
      user.id,
      sessionId
    );
    if (!deletion) throw new NotFoundException('Session deletion not found');
    return this.presentSessionDeletion(deletion);
  }

  @Mutation(() => CopilotProjectMemoryConflictType)
  async resolveCopilotProjectMemoryConflict(
    @CurrentUser() user: CurrentUserType,
    @Args('input') input: ResolveCopilotProjectMemoryConflictInput
  ) {
    if (!['accept', 'reject'].includes(input.resolution)) {
      throw new BadRequest('Invalid Project memory conflict resolution');
    }
    await this.requireFullyReadableProject(user.id, input.projectId, 'owner');
    const conflict = await this.contextMemory.resolveProjectMemoryConflict({
      ...input,
      actorUserId: user.id,
    });
    if (!conflict) {
      throw new NotFoundException('Project memory conflict not found');
    }
    return conflict;
  }

  @Mutation(() => Boolean)
  async deleteCopilotContextMemory(
    @CurrentUser() user: CurrentUserType,
    @Args('id', { type: () => ID }) id: string,
    @Args('expectedRevision', { type: () => Int, nullable: true })
    expectedRevision?: number
  ) {
    const memory = await this.contextMemory.get(id);
    if (!memory) throw new NotFoundException('Context memory not found');
    await this.assertCanMutate(user, memory);
    if (
      expectedRevision !== undefined &&
      memory.revision !== expectedRevision
    ) {
      throw new BadRequest('Context memory changed; reload first');
    }
    return await this.contextMemory.delete(id, user.id, expectedRevision);
  }

  @Mutation(() => CopilotContextMemoryEventType)
  async undoCopilotContextMemoryEvent(
    @CurrentUser() user: CurrentUserType,
    @Args('workspaceId') workspaceId: string,
    @Args('eventId', { type: () => ID }) eventId: string
  ) {
    await this.assertRead(user.id, { workspaceId });
    const event = await this.contextMemory.undoWriterEvent(
      user.id,
      workspaceId,
      eventId
    );
    if (!event) {
      throw new BadRequest(
        'This memory event cannot be undone because it is missing, already undone, or has a newer change'
      );
    }
    return { ...event, canUndo: false };
  }

  @Mutation(() => CopilotContextMemoryEventType)
  async undoCopilotProjectContextMemoryEvent(
    @CurrentUser() user: CurrentUserType,
    @Args('projectId') projectId: string,
    @Args('eventId', { type: () => ID }) eventId: string
  ) {
    await this.requireFullyReadableProject(user.id, projectId, 'member');
    const event = await this.contextMemory.undoWriterEvent(
      user.id,
      null,
      eventId,
      projectId
    );
    if (!event) {
      throw new BadRequest(
        'This memory event cannot be undone because it is missing, already undone, or has a newer change'
      );
    }
    return { ...event, canUndo: false };
  }

  @Mutation(() => Boolean)
  async deleteCopilotContextRule(
    @CurrentUser() user: CurrentUserType,
    @Args('id', { type: () => ID }) id: string
  ) {
    const rule = await this.ruleService.getRule(id);
    await this.assertRuleOwner(user.id, rule);
    return await this.ruleService.deleteRule(id, user.id);
  }

  @Mutation(() => Boolean)
  async deleteCopilotContextPolicy(
    @CurrentUser() user: CurrentUserType,
    @Args('id', { type: () => ID }) id: string,
    @Args('workspaceId') workspaceId: string
  ) {
    const policy = await this.ruleService.getPolicy(id);
    await this.assertPolicyManager(user.id, policy, workspaceId);
    return await this.ruleService.deletePolicy(id, workspaceId);
  }

  @Mutation(() => Boolean)
  @Transactional()
  async deleteCopilotContextProject(
    @CurrentUser() user: CurrentUserType,
    @Args('id', { type: () => ID }) id: string
  ) {
    const project = await this.contextMemory.getProject(id);
    this.requireProjectOwner(user.id, project);
    const deleted = await this.contextMemory.deleteProject(id, user.id);
    if (deleted === null) {
      throw new NotFoundException('Context project not found');
    }
    if (!deleted) {
      throw new BadRequest(
        'Projects with user memories must be archived instead of deleted'
      );
    }
    return true;
  }
}
