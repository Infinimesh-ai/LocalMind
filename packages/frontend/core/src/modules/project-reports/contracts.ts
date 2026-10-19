import type {
  ReportAudience,
  ReportDocument,
  ReportProjection,
  ReportResponsibility,
  ReportTemplate,
} from '@localmind/office/report';

export type ReportSelection =
  | { kind: 'all' }
  | { kind: 'resources'; resourceIds: string[] }
  | { kind: 'folders'; folderIds: string[] };
export type ReportLease = { tabId: string; leaseId: string; kind: 'user' };
export type ReportRecord = {
  id: string;
  projectId: string;
  title: string;
  version: number;
  lifecycle: 'active' | 'archived' | 'trashed';
  createdByActorId: string;
  creatorLabel: string;
  responsibility: ReportResponsibility;
  periodStart: string;
  periodEnd: string;
  timeZone: string;
  draftRevisionId: string | null;
  latestFinalRevisionId: string | null;
  updatedAt: string;
  templateRevisionId: string;
  selection: ReportSelection;
};
export type ReportRevision = {
  id: string;
  reportId: string;
  sequence: number;
  kind: 'draft' | 'preview' | 'final';
  createdAt: string;
  actorId: string;
  reason: string;
};
export type ReportTemplateRecord = {
  id: string;
  name: string;
  version: number;
  builtinKey: string | null;
  status: string;
  current: { id: string; content: ReportTemplate };
};
export type ReportComment = {
  id: string;
  version: number;
  actorId: string;
  authorLabel?: string;
  body: string;
  parentId?: string | null;
  resolved: boolean;
  nodeId?: string | null;
  chapterId?: string | null;
  revisionId: string;
  createdAt: string;
  stale?: boolean;
};
export type ReportReview = {
  id: string;
  version: number;
  reviewerId: string;
  revisionId: string;
  status: string;
  note?: string | null;
  stale?: boolean;
};
export type ReportRun = {
  id: string;
  status: string;
  step?: string;
  completed?: number;
  total?: number;
  error?: string;
};
export type ReportCandidate = {
  id: string;
  runId: string;
  baseRevisionId: string;
  document: ReportDocument;
  conflicts: string[];
  status: string;
};
export type ReportExport = {
  id: string;
  format: 'pdf' | 'pptx' | 'offline';
  status: string;
  revisionId: string;
  downloadUrl?: string;
  warnings?: string[];
  resourceId?: string | null;
};
export type ReportShare = {
  accountIds?: string[];
  audience?: ReportAudience;
  id: string;
  revisionId: string;
  status: string;
  url?: string;
  expiresAt?: string | null;
  mode: 'accounts' | 'link';
  allowDownload: boolean;
  version: number;
};
export type ReportScheduleConfig = {
  title: string;
  templateRevisionId: string;
  selection: ReportSelection;
  timeZone: string;
  frequency: 'weekly' | 'monthly';
  day: number;
  time: string;
  period: 'previous_week' | 'previous_month';
  autoFinalize: boolean;
  delivery: {
    enabled: boolean;
    channel: 'notification' | 'email';
    recipients: string[];
    includeAttachment: boolean;
    expiresDays: number;
    audience: ReportAudience;
  };
};
export type ReportScheduleOccurrence = {
  id: string;
  status: string;
  scheduledAt: string;
  failureCode?: string;
  reportId?: string;
  deliveries?: {
    id: string;
    version: number;
    recipientKey: string;
    channel: string;
    status: string;
    resultNote?: string;
  }[];
};
export type ReportScheduleRevision = {
  id: string;
  version: number;
  actorId: string;
  delegatedActorId: string;
  createdAt: string;
  status: string;
  config: ReportScheduleConfig;
};
export type ReportSchedule = {
  id: string;
  version: number;
  status: string;
  delegatedActorId: string;
  config: ReportScheduleConfig;
  lastRun?: string;
  occurrences?: ReportScheduleOccurrence[];
  revisions?: ReportScheduleRevision[];
  nextCursors?: { occurrences?: string | null; revisions?: string | null };
};
export type ReportState = {
  currentActorId?: string;
  nextCursors?: Partial<
    Record<
      | 'comments'
      | 'reviews'
      | 'exports'
      | 'shares'
      | 'revisions'
      | 'templates'
      | 'schedules'
      | 'occurrences'
      | 'scheduleRevisions',
      string | null
    >
  >;
  sourceChanges?: { count: number; removed: number; checkedAt: string };
  reports?: { items: ReportRecord[]; nextCursor: string | null };
  report?: ReportRecord;
  document?: ReportDocument;
  revision?: ReportRevision;
  projection?: ReportProjection;
  assetUrls?: Record<string, string>;
  revisions?: ReportRevision[];
  templates?: ReportTemplateRecord[];
  comments?: ReportComment[];
  reviews?: ReportReview[];
  schedules?: ReportSchedule[];
  scheduleId?: string;
  occurrences?: ReportScheduleOccurrence[];
  scheduleRevisions?: ReportScheduleRevision[];
  exports?: ReportExport[];
  shares?: ReportShare[];
  runs?: ReportRun[];
  candidates?: ReportCandidate[];
  members?: { id: string; name: string }[];
  resources?: { id: string; title: string; kind: string }[];
  resourcesLimited?: boolean;
  lease?: {
    owned: boolean;
    leaseId?: string;
    expiresAt: string;
    holderName?: string;
  } | null;
  capabilities?: {
    canEdit: boolean;
    canShare: boolean;
    canSchedule: boolean;
    allowAnonymous: boolean;
    emailConfigured: boolean;
  };
};
export type ReportQuery = {
  projectId: string;
  scheduleId?: string;
  reportId?: string;
  revisionId?: string;
  view?:
    | 'list'
    | 'list_results'
    | 'list_options'
    | 'detail'
    | 'templates'
    | 'schedules'
    | 'history'
    | 'presentation'
    | 'comments'
    | 'reviews'
    | 'exports'
    | 'shares'
    | 'schedule_occurrences'
    | 'schedule_revisions';
  cursor?: string;
  limit?: number;
  search?: string;
  lifecycle?: string;
};
export type ReportCommand =
  | {
      operation: 'create';
      title: string;
      period: ReportDocument['period'];
      templateRevisionId: string;
      selection: ReportSelection;
      responsibility?: ReportResponsibility;
      audience?: ReportDocument['audience'];
      language?: ReportDocument['language'];
      durationMinutes?: number;
      instructions?: string;
      generate: boolean;
      previousReportId?: string;
      previousRevisionId?: string;
      duplicateRevisionId?: string;
    }
  | {
      operation: 'save';
      document: ReportDocument;
      reason?: string;
      kind?: 'draft' | 'preview';
    }
  | { operation: 'finalize'; document: ReportDocument }
  | { operation: 'restore'; revisionId: string }
  | { operation: 'lifecycle'; lifecycle: ReportRecord['lifecycle'] }
  | { operation: 'permanentlyDelete' }
  | { operation: 'lease.acquire'; tabId: string }
  | {
      operation: 'lease.renew' | 'lease.release';
      tabId: string;
      leaseId: string;
    }
  | {
      operation: 'template.save';
      templateId?: string;
      expectedVersion?: number;
      content: ReportTemplate;
      status?: 'active' | 'archived';
    }
  | {
      operation: 'comment.add';
      revisionId: string;
      body: string;
      chapterId?: string;
      nodeId?: string;
      parentId?: string;
    }
  | {
      operation: 'comment.resolve';
      commentId: string;
      expectedCommentVersion: number;
      resolved: boolean;
    }
  | { operation: 'review.request'; revisionId: string; reviewerIds: string[] }
  | {
      operation: 'review.respond';
      reviewId: string;
      expectedReviewVersion: number;
      status: 'approved' | 'changes_requested';
      note: string;
    }
  | {
      operation: 'generate';
      mode: 'create' | 'refresh' | 'rewrite';
      selection?: ReportSelection;
      revisionId: string;
      instructions: string;
      chapterIds?: string[];
      nodeIds?: string[];
    }
  | { operation: 'generation.cancel' | 'generation.retry'; runId: string }
  | {
      operation: 'candidate.apply';
      candidateId: string;
      choices: Record<string, 'current' | 'candidate'>;
    }
  | {
      operation: 'export';
      revisionId: string;
      format: ReportExport['format'];
      audience: ReportAudience;
    }
  | {
      operation: 'export.save';
      exportId: string;
      parentId?: string;
      resourceId?: string;
      expectedResourceVersion?: number;
      expectedParentRevisionId?: string;
      resourceEditLease?: { tabId: string; leaseId: string };
    }
  | {
      operation: 'share.create';
      revisionId: string;
      audience: ReportAudience;
      mode: 'accounts' | 'link';
      accountIds: string[];
      accountEmails?: string[];
      password?: string;
      expiresAt?: string;
      allowDownload: boolean;
      shareId?: string;
      expectedShareVersion?: number;
    }
  | { operation: 'share.revoke'; shareId: string; expectedShareVersion: number }
  | {
      operation: 'schedule.save';
      scheduleId?: string;
      expectedScheduleVersion?: number;
      config: ReportScheduleConfig;
      rebind?: boolean;
    }
  | {
      operation: 'schedule.pause';
      scheduleId: string;
      expectedScheduleVersion: number;
      paused: boolean;
    }
  | {
      operation: 'schedule.remove';
      scheduleId: string;
      expectedScheduleVersion: number;
    }
  | {
      operation: 'schedule.delivery.resolve';
      deliveryId: string;
      expectedDeliveryVersion: number;
      result: 'sent' | 'not_sent';
      note: string;
    }
  | {
      operation: 'schedule.run';
      scheduleId: string;
      expectedScheduleVersion: number;
      periodStart?: string;
      periodEnd?: string;
    };
export type ReportCommandInput = {
  projectId: string;
  reportId?: string;
  requestKey: string;
  expectedVersion?: number;
  editLease?: ReportLease;
  command: ReportCommand;
};
export type ReportCommandResult = ReportState & {
  reportId?: string;
  revisionId?: string;
  runId?: string;
  exportId?: string;
  shareId?: string;
  conflicts?: string[];
};
export interface ProjectReportApi {
  updateExportResource?: (
    input: ReportCommandInput,
    resourceId: string
  ) => Promise<ReportCommandResult>;
  subscribe?: (projectId: string, callback: () => void) => () => void;
  query(input: ReportQuery, signal?: AbortSignal): Promise<ReportState>;
  command(input: ReportCommandInput): Promise<ReportCommandResult>;
  download(url: string, filename: string): Promise<void>;
}
