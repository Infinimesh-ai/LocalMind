import { createHash } from 'node:crypto';

export const QWEN36_CERTIFICATION_SCHEMA =
  'localmind-qwen36-certification-candidate/v1';
export const QWEN36_BENCHMARK_SCHEMA = 'localmind-qwen36-capability-matrix-v2';
export const QWEN36_CERTIFICATION_ADAPTER_ID = 'qwen36-35b-a3b';
export const QWEN36_CERTIFICATION_ADAPTER_VERSION = '9';
export const QWEN36_CERTIFICATION_MINIMUM_RUNS = 20;

export const QWEN36_CERTIFIABLE_CAPABILITIES = {
  answer: ['answer'],
  'document.read': ['read'],
  'document.create': ['create'],
  'document.update': ['update'],
  'document.update_meta': ['update_meta'],
  'document.search': ['search'],
  'workspace.folder': [
    'list',
    'create',
    'rename',
    'move',
    'delete',
    'add_document',
    'remove_document',
    'move_document',
  ],
  attachment: ['read_text_plain'],
};

const QWEN36_ATTACHMENT_CERTIFICATION_EVIDENCE_VERSION =
  'qwen36-attachment-certification-evidence/v1';

function attachmentCertificationEvidenceValid(entry) {
  const evidence = entry?.certification?.evidence;
  return (
    evidence?.version === QWEN36_ATTACHMENT_CERTIFICATION_EVIDENCE_VERSION &&
    evidence?.materialization === 'extracted_text' &&
    evidence?.attachmentCount === 1 &&
    Array.isArray(evidence?.mimeTypes) &&
    evidence.mimeTypes.length === 1 &&
    evidence.mimeTypes[0] === 'text/plain'
  );
}

function executions(entry) {
  return Array.isArray(entry?.task?.result?.toolExecutions)
    ? entry.task.result.toolExecutions
    : [];
}

function effectIdentity(execution) {
  const operation = execution?.workspaceEffect?.operation;
  if (operation) {
    return [
      'workspace',
      operation,
      execution.workspaceEffect.folderId ?? '',
      execution.documentId ?? execution.documentIds?.[0] ?? '',
    ].join(':');
  }
  if (execution?.documentId && execution?.relation) {
    return ['document', execution.relation, execution.documentId].join(':');
  }
  return `${execution?.toolName ?? ''}:${execution?.argsFingerprint ?? ''}`;
}

export function qwen36CaseTelemetry(entry) {
  const values = executions(entry);
  const callsByFingerprint = new Map();
  const appliedEffects = new Map();
  let idempotentReplays = 0;
  let governorReplays = 0;

  for (const execution of values) {
    const callFingerprint = `${execution.toolName}:${execution.argsFingerprint}`;
    callsByFingerprint.set(
      callFingerprint,
      (callsByFingerprint.get(callFingerprint) ?? 0) + 1
    );
    if (execution.idempotentReplay === true) idempotentReplays += 1;
    if (execution.governorReplay === true) governorReplays += 1;
    if (execution.sideEffectApplied === true) {
      const identity = effectIdentity(execution);
      appliedEffects.set(identity, (appliedEffects.get(identity) ?? 0) + 1);
    }
  }

  return {
    toolCalls: values.length,
    duplicateCalls: [...callsByFingerprint.values()].reduce(
      (total, count) => total + Math.max(0, count - 1),
      0
    ),
    idempotentReplays,
    governorReplays,
    duplicateSideEffects: [...appliedEffects.values()].reduce(
      (total, count) => total + Math.max(0, count - 1),
      0
    ),
  };
}

function isQwenModel(model, expectedModel) {
  const actual = String(model ?? '')
    .trim()
    .toLowerCase();
  const expected = expectedModel.trim().toLowerCase();
  return actual === expected || actual.endsWith(`/${expected}`);
}

function actionRouteVerification(report, expectedModel) {
  const actionUsage = (report.usage ?? []).filter(
    item => item.featureKind === 'action'
  );
  const crossModelFallbacks = actionUsage
    .filter(item => !isQwenModel(item.model, expectedModel))
    .reduce((total, item) => total + Number(item.count ?? 0), 0);
  return {
    actionUsageEvents: actionUsage.reduce(
      (total, item) => total + Number(item.count ?? 0),
      0
    ),
    actionModels: [...new Set(actionUsage.map(item => item.model))],
    crossModelFallbacks,
    qwenOnly: actionUsage.length > 0 && crossModelFallbacks === 0,
  };
}

function certificationCase(entry) {
  return (
    entry?.certification &&
    typeof entry.certification.capabilityId === 'string' &&
    typeof entry.certification.operationId === 'string' &&
    typeof entry.certification.independentCaseId === 'string'
  );
}

function falseSuccess(entry) {
  return (
    entry?.grade?.falseSuccessOrWrongWrite === true ||
    (entry?.task?.status === 'completed' && entry?.grade?.strictPass !== true)
  );
}

function capabilityCandidate({
  capabilityId,
  entries,
  minimumRuns,
  routeVerification,
}) {
  const operations = QWEN36_CERTIFIABLE_CAPABILITIES[capabilityId];
  const independentIds = entries.map(
    entry => entry.certification.independentCaseId
  );
  const uniqueIndependentIds = new Set(independentIds);
  const telemetry = entries.map(qwen36CaseTelemetry);
  const successfulRuns = entries.filter(
    entry => entry.grade?.strictPass === true
  ).length;
  const falseSuccesses = entries.filter(falseSuccess).length;
  const duplicateSideEffects = telemetry.reduce(
    (total, item) => total + item.duplicateSideEffects,
    0
  );
  const operationCoverage = Object.fromEntries(
    operations.map(operationId => {
      const subset = entries.filter(
        entry => entry.certification.operationId === operationId
      );
      return [
        operationId,
        {
          totalRuns: subset.length,
          successfulRuns: subset.filter(
            entry => entry.grade?.strictPass === true
          ).length,
        },
      ];
    })
  );
  const releaseGate = {
    adapterVersion: QWEN36_CERTIFICATION_ADAPTER_VERSION,
    minimumRuns,
    totalRuns: entries.length,
    successfulRuns,
    falseSuccesses,
    duplicateSideEffects,
    crossModelFallbacks: routeVerification.crossModelFallbacks,
  };
  const blockers = [];
  if (entries.length < minimumRuns) {
    blockers.push(`total_runs_below_${minimumRuns}`);
  }
  if (uniqueIndependentIds.size !== entries.length) {
    blockers.push('duplicate_independent_case_ids');
  }
  if (successfulRuns !== entries.length)
    blockers.push('not_100_percent_success');
  if (falseSuccesses > 0) blockers.push('false_success_detected');
  if (duplicateSideEffects > 0) blockers.push('duplicate_side_effect_detected');
  if (routeVerification.crossModelFallbacks > 0) {
    blockers.push('cross_model_fallback_detected');
  }
  if (!routeVerification.actionUsageEvents) {
    blockers.push('missing_action_usage_evidence');
  }
  if (
    capabilityId === 'attachment' &&
    entries.some(entry => !attachmentCertificationEvidenceValid(entry))
  ) {
    blockers.push('attachment_certification_evidence_invalid');
  }
  for (const [operationId, coverage] of Object.entries(operationCoverage)) {
    if (coverage.totalRuns < minimumRuns) {
      blockers.push(`operation_${operationId}_below_${minimumRuns}`);
    } else if (coverage.successfulRuns !== coverage.totalRuns) {
      blockers.push(`operation_${operationId}_not_100_percent_success`);
    }
  }

  return {
    capabilityId,
    passed: blockers.length === 0,
    blockers,
    releaseGate,
    operationCoverage,
    ...(capabilityId === 'attachment'
      ? {
          attachmentCoverage: {
            mimeTypes: ['text/plain'],
            materialization: 'extracted_text',
            invalidEvidenceCases: entries
              .filter(entry => !attachmentCertificationEvidenceValid(entry))
              .map(entry => entry.certification.independentCaseId),
          },
        }
      : {}),
    telemetry: {
      toolCalls: telemetry.reduce((total, item) => total + item.toolCalls, 0),
      duplicateCalls: telemetry.reduce(
        (total, item) => total + item.duplicateCalls,
        0
      ),
      idempotentReplays: telemetry.reduce(
        (total, item) => total + item.idempotentReplays,
        0
      ),
      governorReplays: telemetry.reduce(
        (total, item) => total + item.governorReplays,
        0
      ),
    },
    failedCaseIds: entries
      .filter(entry => entry.grade?.strictPass !== true)
      .map(entry => entry.certification.independentCaseId),
  };
}

export function buildQwen36CertificationCandidate(
  report,
  {
    minimumRuns = QWEN36_CERTIFICATION_MINIMUM_RUNS,
    expectedModel = report.model,
  } = {}
) {
  const routeVerification = actionRouteVerification(report, expectedModel);
  const eligibleCases = report.cases.filter(
    entry =>
      certificationCase(entry) && !entry.skipped && !entry.infrastructureError
  );
  const capabilities = Object.fromEntries(
    Object.keys(QWEN36_CERTIFIABLE_CAPABILITIES).map(capabilityId => [
      capabilityId,
      capabilityCandidate({
        capabilityId,
        entries: eligibleCases.filter(
          entry => entry.certification.capabilityId === capabilityId
        ),
        minimumRuns,
        routeVerification,
      }),
    ])
  );
  const runBlockers = [];
  if (report.benchmark !== QWEN36_BENCHMARK_SCHEMA) {
    runBlockers.push('benchmark_schema_mismatch');
  }
  if (report.mode !== 'certification')
    runBlockers.push('not_certification_mode');
  if (report.modelAdapter?.id !== QWEN36_CERTIFICATION_ADAPTER_ID) {
    runBlockers.push('adapter_id_mismatch');
  }
  if (report.modelAdapter?.version !== QWEN36_CERTIFICATION_ADAPTER_VERSION) {
    runBlockers.push('adapter_version_mismatch');
  }
  if (!isQwenModel(report.model, expectedModel)) {
    runBlockers.push('report_model_mismatch');
  }
  if (report.fatalError) runBlockers.push('fatal_error');
  if (report.usageCollectionError) runBlockers.push('usage_collection_error');
  if (report.routeRestoreError) runBlockers.push('route_restore_error');
  if (report.configRestoreError) runBlockers.push('config_restore_error');
  if (report.credentialRevokeError) runBlockers.push('credential_revoke_error');
  if (report.cases.some(entry => entry.infrastructureError)) {
    runBlockers.push('infrastructure_error');
  }
  if (report.cases.some(entry => entry.skipped && certificationCase(entry))) {
    runBlockers.push('certification_case_skipped');
  }
  if (!routeVerification.qwenOnly) runBlockers.push('route_not_qwen_only');
  if (Object.values(capabilities).some(capability => !capability.passed)) {
    runBlockers.push('capability_gate_failed');
  }

  const candidate = {
    schemaVersion: QWEN36_CERTIFICATION_SCHEMA,
    adapter: {
      id: QWEN36_CERTIFICATION_ADAPTER_ID,
      version: QWEN36_CERTIFICATION_ADAPTER_VERSION,
      model: expectedModel,
    },
    benchmarkRunId: report.runId,
    generatedAt: new Date().toISOString(),
    minimumRuns,
    passed: runBlockers.length === 0,
    blockers: runBlockers,
    routeVerification,
    capabilities,
    publication: {
      automaticGateUpdate: false,
      manualReviewRequired: true,
    },
  };
  return {
    ...candidate,
    candidateFingerprint: createHash('sha256')
      .update(JSON.stringify(candidate))
      .digest('hex'),
  };
}
