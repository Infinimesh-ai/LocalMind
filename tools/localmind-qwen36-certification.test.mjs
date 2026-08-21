import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQwen36CertificationCandidate,
  QWEN36_BENCHMARK_SCHEMA,
  QWEN36_CERTIFIABLE_CAPABILITIES,
  QWEN36_CERTIFICATION_ADAPTER_ID,
  QWEN36_CERTIFICATION_ADAPTER_VERSION,
  qwen36CaseTelemetry,
} from './localmind-qwen36-certification.mjs';

function certificationCase(capabilityId, operationId, index, overrides = {}) {
  return {
    name: `${capabilityId}-${operationId}-${index}`,
    certification: {
      capabilityId,
      operationId,
      independentCaseId: `${capabilityId}:${operationId}:${index}`,
    },
    task: {
      status: 'completed',
      result: { toolExecutions: [] },
    },
    grade: { functionalPass: true, strictPass: true },
    ...overrides,
  };
}

function flawlessReport() {
  const cases = [];
  for (const [capabilityId, operations] of Object.entries(
    QWEN36_CERTIFIABLE_CAPABILITIES
  )) {
    for (const operationId of operations) {
      for (let index = 1; index <= 20; index += 1) {
        cases.push(certificationCase(capabilityId, operationId, index));
      }
    }
  }
  return {
    benchmark: QWEN36_BENCHMARK_SCHEMA,
    mode: 'certification',
    runId: 'run-1',
    model: 'qwen3.6-35b-a3b',
    modelAdapter: {
      id: QWEN36_CERTIFICATION_ADAPTER_ID,
      version: QWEN36_CERTIFICATION_ADAPTER_VERSION,
    },
    cases,
    usage: [
      {
        featureKind: 'action',
        model: 'qwen3.6-35b-a3b',
        count: 400,
      },
    ],
  };
}

test('case telemetry separates repeated calls, replays, and side effects', () => {
  const entry = certificationCase('document.create', 'create', 1, {
    task: {
      status: 'completed',
      result: {
        toolExecutions: [
          {
            toolName: 'doc_create',
            argsFingerprint: 'same',
            sideEffectApplied: true,
            effectSatisfied: true,
            idempotentReplay: false,
            documentId: 'doc-1',
            relation: 'created',
          },
          {
            toolName: 'doc_create',
            argsFingerprint: 'same',
            sideEffectApplied: false,
            effectSatisfied: true,
            idempotentReplay: true,
            governorReplay: true,
            documentId: 'doc-1',
            relation: 'created',
          },
        ],
      },
    },
  });

  assert.deepEqual(qwen36CaseTelemetry(entry), {
    toolCalls: 2,
    duplicateCalls: 1,
    idempotentReplays: 1,
    governorReplays: 1,
    duplicateSideEffects: 0,
  });

  entry.task.result.toolExecutions[1].sideEffectApplied = true;
  assert.equal(qwen36CaseTelemetry(entry).duplicateSideEffects, 1);
});

test('flawless candidate passes but still requires manual publication', () => {
  const candidate = buildQwen36CertificationCandidate(flawlessReport());

  assert.equal(candidate.passed, true);
  assert.deepEqual(candidate.blockers, []);
  assert.equal(candidate.capabilities['workspace.folder'].passed, true);
  assert.deepEqual(candidate.publication, {
    automaticGateUpdate: false,
    manualReviewRequired: true,
  });
});

test('candidate blocks incomplete operations and cross-model fallback', () => {
  const report = flawlessReport();
  report.cases = report.cases.filter(
    entry =>
      !(
        entry.certification.capabilityId === 'workspace.folder' &&
        entry.certification.operationId === 'delete' &&
        entry.certification.independentCaseId.endsWith(':20')
      )
  );
  report.usage.push({
    featureKind: 'action',
    model: 'gpt-5.6-sol',
    count: 1,
  });

  const candidate = buildQwen36CertificationCandidate(report);

  assert.equal(candidate.passed, false);
  assert.equal(candidate.routeVerification.crossModelFallbacks, 1);
  assert.ok(
    candidate.capabilities['workspace.folder'].blockers.includes(
      'operation_delete_below_20'
    )
  );
  assert.ok(
    candidate.capabilities['workspace.folder'].blockers.includes(
      'cross_model_fallback_detected'
    )
  );
});

test('completed but incorrectly graded case is a false success', () => {
  const report = flawlessReport();
  const failed = report.cases.find(
    entry => entry.certification.capabilityId === 'document.read'
  );
  failed.grade = { functionalPass: false, strictPass: false };

  const candidate = buildQwen36CertificationCandidate(report);
  const capability = candidate.capabilities['document.read'];

  assert.equal(capability.releaseGate.successfulRuns, 19);
  assert.equal(capability.releaseGate.falseSuccesses, 1);
  assert.equal(capability.passed, false);
});

test('candidate rejects stale adapter and benchmark metadata', () => {
  const report = flawlessReport();
  report.benchmark = 'localmind-qwen36-capability-matrix-v1';
  report.modelAdapter.version = '1';

  const candidate = buildQwen36CertificationCandidate(report);

  assert.equal(candidate.passed, false);
  assert.ok(candidate.blockers.includes('benchmark_schema_mismatch'));
  assert.ok(candidate.blockers.includes('adapter_version_mismatch'));
});
