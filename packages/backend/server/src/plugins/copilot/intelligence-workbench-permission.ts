import { DocRole } from '../../models';

export type IntelligenceWorkbenchGrantLevel = 'read' | 'write';
export type IntelligenceWorkbenchAiPolicy = 'read_only' | 'read_write';
export type IntelligenceWorkbenchOperation = 'read' | 'write';

const GRANT_LEVEL_RANK: Record<IntelligenceWorkbenchGrantLevel, number> = {
  read: 1,
  write: 2,
};

function maximumGrantLevelForRole(role: DocRole | null) {
  if (role !== null && role >= DocRole.Editor) return 'write' as const;
  if (role !== null && role >= DocRole.External) return 'read' as const;
  return null;
}

export function cappedProjectGrantLevel(input: {
  effectiveDocRole: DocRole | null;
  requestedLevel: IntelligenceWorkbenchGrantLevel;
}) {
  const maximum = maximumGrantLevelForRole(input.effectiveDocRole);
  if (!maximum) return null;
  return GRANT_LEVEL_RANK[input.requestedLevel] <= GRANT_LEVEL_RANK[maximum]
    ? input.requestedLevel
    : maximum;
}

export type IntelligenceWorkbenchOperationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'grant_denied' | 'project_policy_denied' | 'approval_required';
    };

export type IntelligenceWorkbenchOperationRequestDecision =
  | { allowed: true; approvalRequired: boolean }
  | {
      allowed: false;
      reason: 'grant_denied' | 'project_policy_denied' | 'approval_required';
    };

function evaluateGrantAndPolicy(input: {
  grantLevel: IntelligenceWorkbenchGrantLevel | null;
  projectPolicy: IntelligenceWorkbenchAiPolicy;
  operation: IntelligenceWorkbenchOperation;
}): IntelligenceWorkbenchOperationDecision {
  const requiredRank = input.operation === 'write' ? 2 : 1;
  if (!input.grantLevel || GRANT_LEVEL_RANK[input.grantLevel] < requiredRank) {
    return { allowed: false, reason: 'grant_denied' };
  }
  if (input.operation === 'write' && input.projectPolicy !== 'read_write') {
    return { allowed: false, reason: 'project_policy_denied' };
  }
  return { allowed: true };
}

export function evaluateIntelligenceWorkbenchOperation(input: {
  grantLevel: IntelligenceWorkbenchGrantLevel | null;
  projectPolicy: IntelligenceWorkbenchAiPolicy;
  operation: IntelligenceWorkbenchOperation;
  toolApprovalSatisfied: boolean;
}): IntelligenceWorkbenchOperationDecision {
  const base = evaluateGrantAndPolicy(input);
  if (!base.allowed) return base;
  if (input.operation === 'write' && !input.toolApprovalSatisfied) {
    return { allowed: false, reason: 'approval_required' };
  }
  return { allowed: true };
}

export function evaluateIntelligenceWorkbenchOperationRequest(input: {
  grantLevel: IntelligenceWorkbenchGrantLevel | null;
  projectPolicy: IntelligenceWorkbenchAiPolicy;
  operation: IntelligenceWorkbenchOperation;
  approvalGate: 'none' | 'request_only';
}): IntelligenceWorkbenchOperationRequestDecision {
  const base = evaluateGrantAndPolicy(input);
  if (!base.allowed) return base;
  if (input.operation === 'write' && input.approvalGate !== 'request_only') {
    return { allowed: false, reason: 'approval_required' };
  }
  return {
    allowed: true,
    approvalRequired: input.operation === 'write',
  };
}

export function redactProjectDocumentForViewer<
  T extends {
    docId: string | null;
    placeholderInitiatorUserId: string | null;
    status: string;
    suppliedTitle?: string | null;
    title?: string | null;
  },
>(document: T, viewerUserId: string): T {
  if (
    document.status === 'granted' ||
    (document.status === 'pending' &&
      document.placeholderInitiatorUserId === viewerUserId)
  ) {
    return document;
  }
  return {
    ...document,
    docId: null,
    suppliedTitle: null,
    title: null,
  };
}
