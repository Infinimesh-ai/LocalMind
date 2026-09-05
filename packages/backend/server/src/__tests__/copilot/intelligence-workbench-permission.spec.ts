import ava from 'ava';

import { DocRole } from '../../models';
import {
  cappedProjectGrantLevel,
  evaluateIntelligenceWorkbenchOperation,
  evaluateIntelligenceWorkbenchOperationRequest,
  redactProjectDocumentForViewer,
} from '../../plugins/copilot/intelligence-workbench-permission';

ava('caps direct grants at the adder effective document level', t => {
  t.is(
    cappedProjectGrantLevel({
      effectiveDocRole: DocRole.Reader,
      requestedLevel: 'write',
    }),
    'read'
  );
  t.is(
    cappedProjectGrantLevel({
      effectiveDocRole: DocRole.Manager,
      requestedLevel: 'write',
    }),
    'write'
  );
  t.is(
    cappedProjectGrantLevel({
      effectiveDocRole: DocRole.None,
      requestedLevel: 'read',
    }),
    null
  );
});

ava('requires the grant, project policy, and tool approval intersection', t => {
  t.deepEqual(
    evaluateIntelligenceWorkbenchOperation({
      grantLevel: 'write',
      projectPolicy: 'read_only',
      operation: 'write',
      toolApprovalSatisfied: true,
    }),
    { allowed: false, reason: 'project_policy_denied' }
  );
  t.deepEqual(
    evaluateIntelligenceWorkbenchOperation({
      grantLevel: 'write',
      projectPolicy: 'read_write',
      operation: 'write',
      toolApprovalSatisfied: false,
    }),
    { allowed: false, reason: 'approval_required' }
  );
  t.deepEqual(
    evaluateIntelligenceWorkbenchOperation({
      grantLevel: 'write',
      projectPolicy: 'read_write',
      operation: 'write',
      toolApprovalSatisfied: true,
    }),
    { allowed: true }
  );
});

ava('distinguishes approval-request preflight from approved execution', t => {
  t.deepEqual(
    evaluateIntelligenceWorkbenchOperationRequest({
      grantLevel: 'write',
      projectPolicy: 'read_write',
      operation: 'write',
      approvalGate: 'request_only',
    }),
    { allowed: true, approvalRequired: true }
  );
  t.deepEqual(
    evaluateIntelligenceWorkbenchOperationRequest({
      grantLevel: 'write',
      projectPolicy: 'read_write',
      operation: 'write',
      approvalGate: 'none',
    }),
    { allowed: false, reason: 'approval_required' }
  );
  t.deepEqual(
    evaluateIntelligenceWorkbenchOperation({
      grantLevel: 'write',
      projectPolicy: 'read_write',
      operation: 'write',
      toolApprovalSatisfied: false,
    }),
    { allowed: false, reason: 'approval_required' }
  );
});

ava('redacts pending document identity for every non-initiator viewer', t => {
  const pending = {
    addedByUserId: 'initiator',
    docId: 'secret-doc',
    placeholderInitiatorUserId: 'initiator',
    status: 'pending',
    suppliedTitle: 'Secret title',
    title: 'Secret title',
    workspaceId: 'source-workspace',
    requestedLevel: 'read',
  };

  t.deepEqual(redactProjectDocumentForViewer(pending, 'initiator'), pending);
  t.deepEqual(redactProjectDocumentForViewer(pending, 'member'), {
    ...pending,
    docId: null,
    suppliedTitle: null,
    title: null,
  });

  t.deepEqual(
    redactProjectDocumentForViewer(
      {
        ...pending,
        status: 'revoked',
      },
      'initiator'
    ),
    {
      ...pending,
      status: 'revoked',
      docId: null,
      suppliedTitle: null,
      title: null,
    }
  );
});
