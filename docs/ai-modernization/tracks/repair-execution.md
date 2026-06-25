# Track: Repair Execution

## Intent

Move repair from read-only request contracts to queued, auditable execution.

## Current Problem

Repair preview, preflight, and execution request outputs describe what would be
needed for execution. The first durable slice now persists request/audit state,
the approval decision slice can advance approval-gated requests, and the first
mutating executor can publish a workspace-scoped Prompt Registry revision
through the queued worker path. A second constrained executor can now publish a
workspace-scoped Task Route Policy revision from approved
`repair_task_model_route` evidence. Additional constrained executors can
publish workspace-scoped Model Registry and Provider Registry revisions from
approved repair payloads. Manual control can now cancel waiting/queued/failed
requests, request cooperative cancellation for currently running requests,
retry failed requests, resume failed requests with an operator-provided
corrected executor payload before any side-effect ledger exists, and recover
expired running worker leases.
Repair side effects now also have crash/retry idempotency: if a registry
revision was durably written before the execution row reached `completed`, the
next worker attempt reuses the matching revision and completes the request,
while an existing same-scope revision with a different fingerprint fails the
execution instead of treating the conflicting side effect as success. A
scheduled recovery job now also finds expired `running` worker leases and
requeues or fails them through the same persisted stale-recovery state machine.
Completed constrained registry side-effect summaries now also persist a
forward-only rollback contract that explicitly marks rollback unsupported and
points recovery at publishing a follow-up registry revision.
The dedicated side-effect ledger is now also bound bidirectionally to the
terminal request runtime result, completed timestamp, worker attempt, and
executor payload at the DB boundary, so direct/manual rows cannot drift away
from the completed repair execution result they claim to describe and completed
applied side-effect requests cannot skip ledger persistence.
Repair execution request persistence now also validates the permission-status
vocabulary in model code and through a DB CHECK constraint, so malformed
authorization state cannot become durable execution evidence.
Worker attempt counters are now DB-constrained, so malformed rows cannot make
lease eligibility ambiguous by storing negative attempts, zero max attempts, or
attempts greater than the configured maximum.
The worker now also re-locks and revalidates the current non-expired lease
immediately before applying constrained registry side effects, so a stale
worker whose expired lease was recovered cannot publish revisions or write
side-effect evidence from an old in-memory request.
Worker failure persistence now also compares the worker attempt it originally
read before writing failure/retry evidence, matching completion and cooperative
cancellation guards so stale in-memory failure handling cannot mutate a newer
attempt under the same lease id.
Worker-owned side-effect preflight, completion, and cooperative cancellation
now also carry the leased worker attempt explicitly, so same-lease attempt
drift cannot consume stale cancellation requests or write side-effect/completed
evidence for a newer attempt.
Worker-owned cooperative cancellation terminal writes now also compare the full
originally read running request snapshot before clearing the lease or appending
cancelled audit evidence, so stale same-lease request drift fails closed on both
the operator request and worker consumption sides.
Persisted repair execution requests are now also independently listable through
a bounded workspace filter for status, approval state, prompt name, requested
action, and durable request/audit/side-effect locator evidence, so operators
can find old queued, failed, completed, or side-effect-bearing executions
without direct SQL. Operator payload-correction resume is now an audited control
path instead of a direct SQL workaround: failed requests with no side-effect
ledger can replace `executor_payload`, write `manual_resume_requested` evidence
with old/new payload fingerprints, synchronize Agent Runtime back to queued
state, and re-enter the normal leased worker path.
Broader executor types, true live interruption, and rollback behavior are still
future work. Running cancellation is now limited to a durable cooperative
request that the current worker lease checks before applying side effects.

## First Vertical Slice

Status: implemented.

The first durable slice persists a repair execution request and only runs the
safe no-op path unless the request is blocked on approval.

Implemented behavior:

1. Persist repair execution request.
2. Store actor, workspace, target locator, candidate evidence set fingerprint,
   requested action, idempotency key, and status.
3. Require permission and approval policy checks.
4. Reuse existing request rows by workspace/idempotency key, including the
   insert-conflict path where two callers both miss the pre-read and one loses
   the unique-key race, but only after the losing request matches the existing
   request's create-time prompt/action/permission, fingerprint, runtime result,
   and executor-payload evidence.
5. Persist audit event.
6. Return status through GraphQL/API.
7. Surface durable record status/idempotency/audit metadata in Admin.

Approval-required requests persist as `waiting_approval` with an
`approval_gate` runtime result. Non-approval requests persist as `queued` and
are completed by the same repair execution worker path used after approvals.

## Approval Decision Slice

Status: implemented.

Approval-gated repair execution requests can now be approved or rejected through
a persisted GraphQL mutation.

Implemented behavior:

1. Require workspace permission before deciding a request.
2. Accept decisions only while the request is `waiting_approval` with
   `approvalState=waiting`.
3. Compare the full waiting request snapshot read by the model, including
   request identity, permission/idempotency evidence, source fingerprints,
   runtime result, executor payload, lease/attempt fields, timestamps, and
   failure fields, before writing approval or rejection state.
4. Store approved requests as `queued` with `approvalState=approved` and a
   queued worker runtime result.
5. Store rejected requests as `cancelled` with `approvalState=rejected` and a
   non-mutating gate result.
6. Persist decision audit events and queued/cancelled audit events.
7. Synchronize the linked AgentRun, AgentStep, and timeline events to queued or
   cancelled state.
8. Surface approve/reject controls and decision status in Admin.

The original approval decision slice only closed the approval gate. The current
Prompt Registry executor slice now applies one constrained DB side effect after
the approved request is leased by the worker while rejection remains
non-mutating.

## Prompt Registry Revision Executor Slice

Status: implemented.

Approved prompt registry repair execution requests now apply the first
constrained side effect through the queued worker runtime.

Implemented behavior:

1. Persist an `executor_payload` with the preflight-checked request.
2. Allow approve/reject decisions only after workspace permission checks and
   only while the persisted request is still waiting for approval.
3. On approval, transition the request to `queued` and enqueue
   `copilot.repairExecution.run`.
4. The worker acquires a persisted lease, increments attempt metadata, and
   transitions the request to `running` before applying any side effect.
5. The worker publishes a workspace-scoped `ai_prompt_registry_revisions` row
   with actor, revision, fingerprint, fallback source-chain evidence, and repair
   execution metadata.
6. Write `approval_approved`, `queued`, `running`, `side_effect_applied`, and
   `completed` audit events for the applied side effect.
7. Store a runtime result with `sideEffectsApplied: true`, side-effect kind,
   side-effect record id, side-effect fingerprint, and sanitized summary.
8. Synchronize AgentRun/AgentStep/timeline output through queued, running, and
   terminal completed states.
9. Surface queued/worker attempt metadata and side-effect state in Admin.

## Worker Lease And Retry Slice

Status: implemented.

Repair execution now has a real queued worker path with persisted lease and
attempt metadata.

Implemented behavior:

1. `ai_repair_execution_requests` stores `queued_at`, `worker_lease_id`,
   `worker_lease_expires_at`, `worker_attempt`, `worker_max_attempts`, and
   `last_attempt_at`.
2. Approval decisions no longer execute side effects synchronously in the
   GraphQL resolver; approved requests transition to `queued` and enqueue
   `copilot.repairExecution.run`.
3. The worker leases only approved or non-approval queued requests, writes a
   `running` audit event, and synchronizes Agent Runtime running state.
4. Prompt Registry revision publishing runs inside the worker and completes the
   request with `side_effect_applied` and `completed` audit events.
5. Worker failures persist `failure_code`, `failure_message`, attempt metadata,
   and `failed` audit events. Retryable failures return the request to `queued`
   with `retry_scheduled`; exhausted attempts end as terminal `failed`.
   Deterministic executor contract failures such as unsupported/invalid
   executor payloads and same-scope side-effect revision conflicts are
   terminal immediately instead of consuming automatic retry attempts.
6. Worker failure messages are normalized at the persistence boundary: blank
   messages use a deterministic fallback and overlong messages are bounded
   before writing the request row, runtime result, or audit metadata.
7. Worker failure codes are normalized and bounded before writing the request
   row, runtime result, or audit metadata.
8. Admin and GraphQL expose queued time, attempt count, lease id/expiration, and
   last attempt metadata.
9. Executor payloads are normalized at the repair execution model persistence
   boundary: payloads must be JSON objects, optional `version`/`kind` strings
   are bounded, and oversized payload JSON is rejected before request rows are
   written.
10. Worker failure writes require the persisted request to still carry the same
    worker lease id and worker attempt that the failing worker read, preventing
    stale failure/retry audit evidence when a newer attempt is already present.

## Side-effect Idempotency And Conflict Slice

Status: implemented.

Registry revision side effects now close the crash window between the durable
revision write and repair execution completion.

Implemented behavior:

1. Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
   repair publishers compute the expected revision fingerprint before accepting
   an existing repair revision.
2. Matching existing revisions are reused so a worker retry can complete after
   the side effect was already written.
3. Existing same-scope revisions with different fingerprints raise a terminal
   `side_effect_revision_conflict` execution failure, preserving audit/failure
   state instead of silently completing or retrying against an unexpected side
   effect.
4. Insert paths use conflict-safe writes backed by registry revision unique
   keys, so concurrent stale/current worker attempts cannot create duplicate
   same-scope revisions.
5. The direct publish paths use the same conflict-safe insert and fingerprint
   recheck behavior for matching workspace revisions.

## Task Route Policy Revision Executor Slice

Status: implemented.

Approved `repair_task_model_route` requests can now publish a workspace-scoped
Task Route Policy revision through the same queued worker runtime.

Implemented behavior:

1. The repair execution request stores a constrained
   `task_route_policy_revision_publish` executor payload captured from the
   permission/preflight-checked repair preview.
2. The queued worker validates that payload and writes an active
   `ai_task_route_policy_revisions` row with workspace, actor, feature kind,
   model id, config key/path, revision, fingerprint, fallback source chain, and
   repair execution metadata.
3. Runtime result and audit metadata record side-effect kind
   `task_route_policy_revision`, side-effect record id, fingerprint, and
   sanitized summary.
4. Existing TaskPolicy resolution can immediately read the published workspace
   revision before config fallback, so the side effect changes runtime model
   selection rather than only diagnostics.

This executor is still intentionally narrow: it writes DB-backed Prompt
Registry, Task Route Policy, Model Registry, or Provider Registry revision
records only. It does not mutate provider credentials, external services,
arbitrary config, or rollback state. Completed registry side effects record
`rollbackContract.supported=false` with
`mode=forward_only_followup_revision`, making the absence of rollback
machine-readable instead of implied by documentation.
Worker completion also validates approved side-effect results at the model
boundary: only the four supported registry revision side-effect kinds are
accepted, fingerprint/record id strings are bounded, and side-effect summaries
reuse the audit metadata JSON size guard before runtime results or audit rows
are written.

## Model Registry Revision Executor Slice

Status: implemented.

Approved `repair_default_model_route` requests can now publish a
workspace-scoped Model Registry revision through the queued worker runtime.

Implemented behavior:

1. The repair execution request stores a constrained
   `model_registry_revision_publish` executor payload captured from the
   permission/preflight-checked repair preview.
2. The queued worker validates that payload and writes an active
   `ai_model_registry_revisions` row with workspace, actor, provider id,
   model id, model definition alias, revision, fingerprint, fallback source
   chain, and repair execution metadata.
3. Runtime result and audit metadata record side-effect kind
   `model_registry_revision`, side-effect record id, fingerprint, and
   sanitized summary.
4. The provider registry overlay can immediately resolve the published
   workspace revision before provider-profile/native fallback.

## Provider Registry Revision Executor Slice

Status: implemented.

Approved provider registry repair payloads can now publish a workspace-scoped
Provider Registry profile metadata revision through the queued worker runtime.

Implemented behavior:

1. The repair execution request stores a constrained
   `provider_registry_revision_publish` executor payload.
2. The queued worker validates that payload and writes an active
   `ai_provider_registry_revisions` row with workspace, actor, provider id/type,
   revision, fingerprint, sanitized provider profile metadata, fallback source
   chain, and repair execution metadata.
3. Persisted provider profile metadata stores `config: {}` and reuses the
   existing configured provider runtime/credentials; it does not create or
   modify provider secrets.
4. Runtime result and audit metadata record side-effect kind
   `provider_registry_revision`, side-effect record id, fingerprint, and
   sanitized summary.
5. The provider registry overlay can immediately resolve the published
   workspace provider metadata before global/config fallback.

## Manual Control Slice

Status: implemented.

Persisted repair execution requests can now be manually controlled after the
same workspace permission check used by request and approval flows.

Implemented behavior:

1. GraphQL exposes `controlCopilotRepairExecution` with `cancel`, `retry`,
   `resume_with_payload`, and `recover_stale` actions.
2. `cancel` transitions `waiting_approval`, `queued`, or `failed` requests to
   terminal `cancelled`, clears leases/failure fields, writes a `cancelled`
   audit event with control metadata, and synchronizes Agent Runtime to
   cancelled/skipped timeline state.
3. `cancel` on a `running` request writes a durable `cancel_requested` audit
   event tied to the current worker lease id and attempt, leaves the request in
   `running`, and returns the existing Agent Runtime run without appending a
   duplicate running timeline event. The audit write first compares the full
   originally read running request snapshot, including runtime result,
   executor payload, failure, queue/lease/attempt, completion, creation, and
   update-time evidence.
4. The repair execution worker checks for a matching `cancel_requested` event
   after acquiring/syncing the running lease and before applying side effects.
   When present, it transitions the request to terminal `cancelled`, clears the
   lease, writes cooperative `cancelled` audit metadata with
   `sideEffectsApplied=false`, and synchronizes Agent Runtime to
   cancelled/skipped state.
5. Stale cancellation requests from an earlier lease attempt are not consumed
   by later worker leases because the request and worker check both match the
   lease id and worker attempt.
6. `retry` accepts terminal `failed` requests with executable approval state,
   clears failure/completion fields, requeues the request, extends
   `worker_max_attempts` when the previous failure exhausted attempts, writes
   `manual_retry_requested` and `queued` audit events, and enqueues a fresh
   repair execution worker job. Terminal executor-payload failures must have a
   changed executor payload fingerprint before manual retry is accepted, so an
   operator cannot requeue the same deterministic-bad payload unchanged.
7. `resume_with_payload` accepts terminal `failed` requests with executable
   approval state only when no side-effect ledger row exists. The operator
   supplies a corrected JSON executor payload; the model normalizes and bounds
   it, rejects unchanged payload fingerprints, writes
   `manual_resume_requested` audit metadata with previous/corrected payload
   fingerprints and previous failure evidence, replaces `executor_payload`,
   clears failure/completion fields, requeues the request, and enqueues a fresh
   worker job.
8. DB triggers keep ordinary request evidence immutable while allowing only the
   audited failed-to-queued payload-correction transition; completed
   side-effect-bearing requests still reject parent payload drift.
9. Retried or payload-resumed requests still run through the queued worker lease path and existing
   constrained executors, so side effects remain permission/preflight/approval
   gated.
10. `recover_stale` accepts only `running` requests whose persisted worker lease
    has expired. It clears the stale lease, writes `stale_recovered` audit
    metadata, requeues the request when attempts remain, or marks it failed when
    attempts are exhausted.
11. Stale recovery synchronizes Agent Runtime back to queued/pending state when
    requeued.
12. Admin surfaces cancel/retry and corrected-payload resume controls for
    eligible persisted requests and displays the resulting durable record plus
    Agent Runtime timeline state.
13. Manual control reasons are normalized and bounded before being copied into
    runtime results or audit metadata.

Running cancellation remains cooperative. It does not preempt code that has
already started applying a side effect, and it must not be described as a live
interrupt. Stale recovery is lease recovery after expiration, not live
interruption.

Before applying any constrained registry side effect, the worker re-locks the
request row and confirms the same current non-expired worker lease. If stale
recovery has already cleared or moved the lease, the old worker exits without
calling registry publishers, writing side-effect ledger/audit evidence, or
failing the recovered request.

## Scheduled Stale Lease Recovery Slice

Status: implemented.

Expired running repair execution leases can now be recovered without waiting
for an operator to click manual control.

Implemented behavior:

1. The minute Copilot cron enqueues
   `copilot.repairExecution.recoverExpiredLeases`.
2. The job lists bounded batches of `running` repair execution requests whose
   persisted `worker_lease_expires_at` has passed.
3. Each expired lease is recovered through the same persisted stale-recovery
   transition as manual control, but records
   `recoverySource=system` and runtime executor
   `repair_execution_stale_recovery_worker`.
4. Requeued requests are synchronized back to Agent Runtime queued/pending
   state and get a fresh `copilot.repairExecution.run` job.
5. Exhausted requests transition to terminal `failed` with
   `stale_worker_lease`.
6. The normal repair execution worker lease path only leases `queued` requests;
   expired `running` leases must pass through manual or scheduled stale
   recovery so the `stale_recovered` audit path is not bypassed.

This is not live interruption. Active leases are ignored until expiration.

## Scheduled Queued Enqueue Recovery Slice

Status: implemented.

Durable queued repair execution rows can now recover if the queue job was lost
or removed before a worker picked them up.

Implemented behavior:

1. The minute Copilot cron enqueues
   `copilot.repairExecution.enqueueQueued`.
2. The job lists bounded batches of `queued` repair execution requests with
   executable approval state and worker attempts remaining.
3. Each listed request gets a fresh targeted `copilot.repairExecution.run` job
   with a deterministic job id derived from request id and attempt window.
4. The job does not mutate repair execution state; the existing worker lease
   path remains responsible for transitioning queued requests to running.
5. The handler only repeats when it enqueues a full bounded batch.

## Permission Status Constraint Slice

Status: implemented.

Repair execution permission evidence is now bounded to the permission vocabulary
the preflight path actually persists.

Implemented behavior:

1. `createOrReuse` trims permission status and rejects unsupported values before
   inserting request rows.
2. `ai_repair_execution_requests.permission_status` now has a `NOT VALID`
   CHECK constraint for the currently supported `granted` state, preserving
   upgrade tolerance for historical rows while rejecting new malformed writes.
3. Focused coverage verifies unsupported permission status values fail before
   any execution request row is written.

## Worker Attempt Counter Constraint Slice

Status: implemented.

Repair execution worker lease counters now have a database-backed shape
invariant.

Implemented behavior:

1. `worker_attempt` must be non-negative.
2. `worker_max_attempts` must be positive.
3. `worker_attempt` cannot exceed `worker_max_attempts`.
4. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
5. Focused coverage verifies malformed direct updates are rejected at the DB
   boundary before they can affect worker lease eligibility.

## Worker Lease Pair Constraint Slice

Status: implemented.

Repair execution worker lease evidence now has a database-backed pair
invariant.

Implemented behavior:

1. `worker_lease_id` and `worker_lease_expires_at` must both be null or both be
   populated.
2. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
3. Focused coverage verifies orphan worker lease ids are rejected before they
   can affect worker ownership or stale lease recovery.

## Worker Lease ID String Shape Constraint Slice

Status: implemented.

Repair execution worker lease identity now has a database-backed string shape
invariant.

Implemented behavior:

1. `worker_lease_id` may remain null when no worker owns the request.
2. Present `worker_lease_id` values must be non-blank and no longer than the
   current 512-character durable string boundary.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
4. Focused coverage verifies blank present lease ids are rejected before they
   can affect stale lease recovery or compare-and-release worker transitions.

## Worker Lease Status Constraint Slice

Status: implemented.

Repair execution worker lease ownership now has a database-backed status
invariant.

Implemented behavior:

1. Non-running repair execution request rows must keep both worker lease fields
   null.
2. Running rows may carry worker lease evidence according to the existing
   lease pair and lease-id shape constraints.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
4. Focused coverage verifies queued requests cannot retain lease evidence
   before worker scheduling, stale recovery, or compare-and-release paths can
   observe contradictory ownership state.

## Completed Timestamp Constraint Slice

Status: implemented.

Repair execution request rows now enforce the relationship between terminal
request status and durable completion telemetry.

Implemented behavior:

1. Terminal request statuses (`completed`, `failed`, `cancelled`) must carry
   `completed_at`.
2. Non-terminal request statuses (`queued`, `waiting_approval`, `running`) must
   keep `completed_at` null.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
4. Focused coverage verifies direct rows cannot claim a terminal status without
   completion time evidence or attach completion time evidence to a
   non-terminal request.

## Approval Status Coherence Constraint Slice

Status: implemented.

Repair execution request rows now enforce the relationship between request
status and approval state without narrowing supported manual cancellation
paths.

Implemented behavior:

1. `waiting_approval` rows must keep `approval_state=waiting`.
2. Executable statuses (`queued`, `running`, `completed`, and `failed`) must
   keep `approval_state` in `approved|not_required`.
3. `cancelled` rows preserve existing manual-cancel behavior and may retain the
   previous approval state or carry `rejected` after an approval rejection.
4. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
5. Focused coverage verifies direct approval-state drift is rejected for both
   waiting-approval rows and executable queued rows before scheduler or worker
   paths can observe contradictory state.

## Queued Timestamp Constraint Slice

Status: implemented.

Repair execution request rows now enforce scheduler-facing queue timestamp
coherence.

Implemented behavior:

1. `queued` rows must carry `queued_at` so scheduled enqueue recovery and
   worker leasing have durable ordering evidence.
2. `waiting_approval` rows must keep `queued_at` null so approval-gated
   requests are not mistaken for queued work.
3. Running and terminal rows remain allowed to retain historical queue
   timestamps for observability and retry diagnostics.
4. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
5. Focused coverage verifies waiting-approval rows cannot gain queue evidence
   and executable queued rows cannot lose queue evidence at the DB boundary.

## Request Timestamp Coherence Constraint Slice

Status: implemented.

Repair execution request rows now enforce common lifecycle timestamp ordering
without adding executor-specific phase semantics.

Implemented behavior:

1. `updated_at` must not precede `created_at`.
2. Present `last_attempt_at` must not precede `created_at`.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
4. Focused coverage verifies direct writes cannot move update or worker-attempt
   evidence before request creation, before worker listing, stale recovery, or
   diagnostics can consume impossible row history.

## Failure Field Pair Constraint Slice

Status: implemented.

Repair execution request rows now enforce failure evidence pairing without
requiring every terminal `failed` row to carry a specific executor failure.

Implemented behavior:

1. `failure_code` and `failure_message` must be absent together or present
   together, preventing orphan failure codes or orphan operator-facing
   messages.
2. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
3. Focused coverage verifies direct updates cannot clear either side of a real
   failed repair execution row after worker failure persistence has normalized
   the code/message pair.

## Failure String Shape Constraint Slice

Status: implemented.

Repair execution request rows now enforce the same failure diagnostic string
shape that worker failure persistence already normalizes.

Implemented behavior:

1. Failure diagnostics may still be absent together for non-failure rows and
   for future generic states that do not carry request-level diagnostics.
2. When `failure_code` and `failure_message` are present, both must be
   non-blank and within the current model-layer bounds.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed failure diagnostics.
4. Focused coverage verifies direct updates cannot blank a failure code after
   worker failure persistence has written normalized failure evidence.

## Request Identity String Shape Constraint Slice

Status: implemented.

Repair execution request rows now enforce the common non-blank bounded string
shape that the model already applies to durable request identity and
fingerprint evidence.

Implemented behavior:

1. `prompt_name`, `requested_action`, `idempotency_key`, and durable
   fingerprint columns must remain non-blank and within the current model-layer
   bounds.
2. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
3. This deliberately does not require fingerprint strings to be hex-shaped,
   because existing repair evidence and tests use readable deterministic
   fingerprint identifiers in some paths.
4. Focused coverage verifies direct updates cannot blank request identity or
   request fingerprint fields before idempotency, diagnostics, or worker paths
   observe malformed request evidence.

## Audit Event Fingerprint String Shape Constraint Slice

Status: implemented.

Repair execution audit rows now enforce non-blank bounded audit event
fingerprints.

Implemented behavior:

1. `ai_repair_execution_audit_events.event_fingerprint` must remain non-blank
   and within the current common fingerprint boundary.
2. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
3. This deliberately does not require hex-only fingerprints; audit consumers
   only need non-empty bounded correlation evidence at the database boundary.
4. Focused coverage verifies direct updates cannot blank audit event
   fingerprints before diagnostics, idempotency, worker recovery, or Admin
   audit consumers observe malformed audit rows.

## Audit Metadata Contract Constraint Slice

Status: implemented.

Repair execution worker/control audit rows now enforce the stable metadata
contracts emitted by the queued worker and manual/scheduled recovery paths.

Implemented behavior:

1. `running` audit metadata must retain the repair worker executor marker,
   positive attempt, worker lease id, and lease expiration evidence.
2. Worker `failed` audit metadata must retain failure diagnostics, retry
   status, attempt counters, executor-payload fingerprint, and worker lease id.
3. Stale-recovery terminal `failed` audit metadata must retain recovery source,
   failure diagnostics, retry status, and attempt counters.
4. `retry_scheduled` metadata must retain `nextStatus=queued` plus positive
   attempt counters.
5. Manual `cancelled`, `manual_retry_requested`, and `stale_recovered`
   metadata must retain their control action, previous state/evidence,
   bounded reason where present, retry/next-status coherence, and attempt
   counters.
6. Approval-rejection `cancelled` metadata remains compatible with its existing
   approval-gate shape; the new constraint is scoped to stable manual-control
   and worker/recovery audit producers.
7. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
8. Focused coverage verifies direct audit metadata updates cannot drop lease
   expiry, executor-payload fingerprints, retry status coherence, next-status
   coherence, or manual-control attempt evidence.

## Runtime Side-effect Result Constraint Slice

Status: implemented.

Repair execution request rows now enforce the common applied side-effect result
shape that constrained registry publishers already write.

Implemented behavior:

1. `runtime_result` may continue to represent safe no-op, approval, worker
   running, failure, manual control, or hydration-guard states without
   side-effect fields when `sideEffectsApplied` is absent or false.
2. When `runtime_result.sideEffectsApplied=true`, the runtime result must carry
   non-blank bounded `sideEffectKind`, `sideEffectRecordId`,
   `sideEffectFingerprint`, and object-shaped `sideEffectSummary` evidence.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed applied side-effect evidence.
4. Focused coverage verifies direct updates cannot claim an applied side effect
   without persisted side-effect identity or an object summary before Agent
   Runtime, Admin, support bundle, or audit consumers observe the row.

## Runtime Side-effect Rollback Contract Constraint Slice

Status: implemented.

Applied repair side-effect rows now also enforce the forward-only rollback
contract that constrained registry publishers already write.

Implemented behavior:

1. Worker completion rejects approved side-effect results whose summary omits
   `rollbackContract` or changes the current forward-only contract marker.
2. `runtime_result.sideEffectsApplied=true` rows with otherwise valid
   side-effect identity must carry
   `sideEffectSummary.rollbackContract.version=repair-execution-side-effect-rollback-contract/v1`,
   `supported=false`, `mode=forward_only_followup_revision`, a non-blank
   reason, and `recoveryPath=publish_follow_up_registry_revision`.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed applied side-effect rollback evidence.
4. Focused coverage verifies direct updates cannot claim an applied side effect
   while dropping the rollback contract or changing it into a rollback-supported
   contract before Agent Runtime, Admin, support bundle, or audit consumers
   observe the row.

## Side-effect Ledger Persistence Slice

Status: implemented.

Applied constrained registry side effects now persist a dedicated ledger row in
addition to the request runtime result and audit event.

Implemented behavior:

1. Worker completion writes `ai_repair_execution_side_effects` only after the
   request row is successfully transitioned to `completed`, and before the
   `side_effect_applied`/`completed` audit events are written.
2. Each repair execution request can have one ledger row. The row keeps the
   execution request id, workspace id, actor id, side-effect kind, record id,
   side-effect fingerprint, sanitized summary, executor payload fingerprint,
   worker attempt, worker lease id, and applied time.
3. A composite snapshot foreign key to
   `(execution_request_id, workspace_id, actor_id)` prevents direct/manual
   ledger rows from drifting away from the workspace and actor of the completed
   repair request.
4. The ledger independently enforces the same bounded string, fingerprint,
   known side-effect kind, object summary, positive worker attempt, timestamp,
   and forward-only rollback contract evidence expected by the constrained
   registry publishers.
5. Focused coverage verifies successful worker completion creates one ledger
   row, stale or malformed completions create none, direct updates cannot drop
   rollback-contract evidence, and direct updates cannot drift the ledger actor
   away from the request snapshot.
6. GraphQL repair execution responses now expose `sideEffectCount` plus recent
   side-effect ledger rows on the durable execution record. Admin renders the
   count and latest side-effect kind, record id, worker attempt, and
   fingerprint so operators can inspect the applied side-effect ledger without
   direct SQL access.

## Side-effect Result Snapshot Coherence Slice

Status: implemented.

Applied repair side-effect ledger rows now preserve the terminal request result
snapshot they were written from.

Implemented behavior:

1. `ai_repair_execution_side_effects` inserts and direct updates of request,
   workspace, side-effect identity, summary, executor payload fingerprint,
   worker attempt, or applied time must match a parent repair execution request
   in `completed` state.
2. The parent request must still carry `runtime_result.sideEffectsApplied=true`
   with matching side-effect kind, record id, fingerprint, and summary; matching
   actor evidence; matching worker attempt; `completed_at=applied_at`; no
   failure diagnostics; and no active worker lease fields.
3. The ledger `executor_payload_fingerprint` is immutable after write, and the
   parent request `executor_payload` is immutable once a side-effect ledger row
   exists. The DB intentionally does not recompute the application stable JSON
   fingerprint, but it prevents either side of that evidence pair from being
   rewritten after the side effect becomes durable.
4. Parent repair execution request updates that would drift `runtime_result`,
   status, failure fields, worker lease fields, worker attempt, or completed
   timestamp away from the existing ledger row are rejected before Admin, Agent
   Runtime, support bundle, or audit consumers can read inconsistent evidence.
5. Focused coverage verifies side-effect fingerprint drift, applied-time drift,
   ledger executor-payload fingerprint drift, parent runtime-result drift,
   parent completed-time drift, parent executor-payload drift, and parent actor
   drift rejection. Disposable Postgres smoke coverage also verifies legal
   no-op updates still pass while side-effect summary, worker-attempt, and
   executor-payload drifts reject on the expected DB constraints.

## Side-effect Ledger Parent Request Snapshot CAS Slice

Status: implemented.

Repair execution side-effect ledger writes now require the terminal parent
request snapshot that was just written by the worker before a side-effect row
can be inserted.

Implemented behavior:

1. `createSideEffectLedgerEntry` now writes through
   `INSERT ... SELECT FROM ai_repair_execution_requests ... RETURNING id`
   instead of a blind insert.
2. The parent request predicate compares request/workspace/actor identity,
   prompt/action identity, approval and permission state, idempotency and
   durable evidence fingerprints, terminal runtime result, executor payload,
   failure fields, queue/lease/attempt evidence, completion time, creation
   time, and terminal update time.
3. Worker completion passes the completed request snapshot it wrote
   immediately before side-effect ledger insertion; the existing DB
   bidirectional snapshot constraints still guard direct SQL and parent-row
   rewrites after commit.
4. If the parent request row changes between terminal completion update and
   side-effect ledger insert, the ledger write fails closed and the surrounding
   transaction rolls back before stale side-effect evidence or misleading
   completed audit history persists.
5. Focused coverage drifts the completed request update timestamp before a
   direct ledger-helper insert and verifies no second side-effect row is
   written.

## Side-effect Ledger Required Slice

Status: implemented.

Completed applied repair execution requests now require the matching
side-effect ledger row by commit time.

Implemented behavior:

1. `ai_repair_execution_requests` rejects inserts or lifecycle/result updates
   that leave a `completed` request with
   `runtime_result.sideEffectsApplied=true` but no matching
   `ai_repair_execution_side_effects` row.
2. The deferred trigger requires the ledger row to match request/workspace/actor
   evidence, side-effect kind, record id, fingerprint, summary, worker attempt,
   applied/completed timestamp, cleared failure fields, and cleared worker
   lease fields.
3. The trigger permits true no-op lifecycle updates and is deferred so the
   existing worker transaction can update the request first, then insert the
   side-effect ledger and audit rows before commit.
4. Focused coverage verifies a completed applied request with matching audit
   history but no ledger rejects, while the same terminal update plus a
   matching ledger row and audit history commits. Disposable Postgres smoke
   covered missing-ledger rejection, valid terminal update plus ledger commit,
   and no-op update compatibility.

## Side-effect Ledger Delete Restrict Slice

Status: implemented.

Applied side-effect ledger rows can no longer be deleted while the parent
repair execution request still exists.

Implemented behavior:

1. `ai_repair_execution_side_effects` has a deferred delete trigger that checks
   whether the parent repair request still exists with the same workspace and
   actor snapshot.
2. Direct deletion of any side-effect ledger row fails at commit time while
   that parent request exists, preserving historical side-effect evidence even
   if future lifecycle or migration work changes the parent result projection.
3. Parent request deletion used to cascade side-effect rows, so workspace or
   test cleanup paths were not trapped by the child delete guard. The later
   Request Delete Restrict slice supersedes that behavior for direct request
   deletes while keeping workspace ownership cleanup compatible.
4. Focused repair execution coverage verifies direct ledger deletion rejects.
   Disposable Postgres smoke also verifies workspace cascade compatibility.

## Audit Event Delete Restrict Slice

Status: implemented.

Repair execution audit rows now preserve append-only request lifecycle history
against direct deletes.

Implemented behavior:

1. `ai_repair_execution_audit_events` has a deferred
   `ai_repair_execution_audit_events_delete_restrict_check` trigger.
2. Deleting an audit row is rejected while the parent
   `ai_repair_execution_requests` row still exists, so direct SQL cannot erase
   requested, approval, queued, running, side-effect, retry, completion,
   failure, cancellation, or reuse history from a live repair request.
3. Parent request deletion used to cascade audit rows, preserving normal
   ownership cleanup for tests and workspace lifecycle operations. The later
   Request Delete Restrict slice supersedes that behavior for direct request
   deletes while keeping workspace ownership cleanup compatible.
4. Focused repair execution coverage verifies direct deletion of the completed
   audit row rejects. Disposable Postgres smoke verifies direct audit deletion
   rejection and workspace cascade compatibility.

## Request Delete Restrict Slice

Status: implemented.

Repair execution request rows now preserve persisted execution, audit, and
side-effect history against direct deletes while their owning workspace remains
live.

Implemented behavior:

1. `ai_repair_execution_requests` has a `BEFORE DELETE`
   `ai_repair_execution_requests_delete_restrict_check` trigger.
2. Deleting a request row is rejected while the owning workspace still exists,
   so direct SQL cannot erase a repair execution root and cascade away audit
   or side-effect history.
3. Workspace deletion can still cascade workspace-scoped repair execution
   requests and their child history, preserving ownership cleanup.
4. Focused repair execution coverage verifies direct request deletion rejects
   and workspace deletion still cascades request plus audit cleanup.

## Side-effect Content Update Restrict Slice

Status: implemented.

Applied repair side-effect ledger rows now preserve their own evidence as
append-only DB history after persistence.

Implemented behavior:

1. `ai_repair_execution_side_effects` rejects direct updates that change ledger
   identity, request/workspace/actor linkage, side-effect kind, side-effect
   record id, side-effect fingerprint, summary, executor payload fingerprint,
   worker attempt, worker lease id, applied time, or creation time.
2. The trigger permits true no-op updates and runs after existing row-shape,
   rollback-contract, parent-result snapshot, and executor-payload fingerprint
   checks, so malformed writes still report the older specific constraint names
   while coherent ledger rewrites hit the append-only boundary.
3. Focused coverage verifies no-op side-effect updates pass while worker lease
   evidence rewrites and creation-time rewrites reject before repair execution
   reads, Admin, Agent Runtime, support bundle, audit, or recovery consumers can
   observe rewritten side-effect history.

## Audit Event History Read Exposure Slice

Status: implemented.

Persisted repair execution lifecycle audit rows are now visible on the durable
execution record instead of being reduced to a count and request fingerprint.

Implemented behavior:

1. GraphQL `CopilotRepairExecutionRecordType` exposes recent `auditEvents`
   alongside `auditEventCount`.
2. Recent audit events include execution request/workspace/actor ids, event
   type, event fingerprint, bounded metadata, and creation time.
3. Repair execution model `get` and `getByIdempotencyKey` hydrate the latest
   five audit events in newest-first order and leave scheduler/list paths with
   an empty history by default.
4. Common GraphQL request, approval, and control operation selections return
   recent audit history wherever they return a durable execution record.
5. Admin repair execution summaries render recent audit event type plus
   fingerprint so operators can inspect lifecycle transitions without direct
   SQL access.

## Audit Workspace Snapshot Coherence Constraint Slice

Status: implemented.

Repair execution lifecycle audit rows now preserve the parent execution request
workspace snapshot at the database boundary.

Implemented behavior:

1. `ai_repair_execution_requests` exposes a composite snapshot key on
   `(id, workspace_id)` for audit evidence rows.
2. `ai_repair_execution_audit_events` must keep
   `(execution_request_id, workspace_id)` matched to the parent request
   snapshot, so direct writes cannot move audit evidence into another real
   workspace while keeping the same execution request id.
3. The child foreign key is `NOT VALID`, preserving upgrade tolerance for
   historical rows while rejecting new audit workspace drift.
4. Focused coverage verifies direct SQL workspace drift is rejected for repair
   execution audit rows.

## Audit Event Content Update Restrict Slice

Status: implemented.

Repair execution lifecycle audit rows are now append-only evidence after
persistence.

Implemented behavior:

1. `ai_repair_execution_audit_events` rejects direct updates to persisted
   audit identity, execution request id, workspace/actor evidence, event type,
   event fingerprint, metadata, or creation time.
2. The trigger permits true no-op updates and runs after existing row-shape,
   metadata-contract, and request workspace-snapshot checks, so malformed
   writes still report their older specific constraint names while coherent
   audit evidence rewrites are blocked by the new append-only boundary.
3. Focused coverage verifies no-op audit updates pass while coherent metadata
   rewrites, event-fingerprint rewrites, and actor retargets reject before
   repair execution read, Admin, Agent Runtime, support bundle, worker, or
   recovery consumers observe rewritten lifecycle history.

## Agent Runtime Repair Payload Contract Constraint Slice

Status: implemented.

Repair-execution-linked Agent Runtime rows now enforce the payload shape that
the repair execution state machine writes into run/step diagnostics.

Implemented behavior:

1. Repair run timeline payloads use
   `agent-runtime-repair-execution-run/v1` and must retain workflow/source
   context, source id, request fingerprint, and repair-job fingerprint.
2. Repair step output summaries and step timeline payloads use
   `agent-runtime-repair-execution-step/v1` and must retain repair execution
   request id, approval state, `permissionStatus=granted`, runtime executor,
   and side-effect mode.
3. Applied side-effect step payloads must retain side-effect kind, record id,
   fingerprint, and the projected forward-only rollback contract including its
   reason and recovery path.
4. The constraints are `NOT VALID`, preserving upgrade tolerance for
   historical rows without the new versions while rejecting malformed current
   repair runtime payload writes.
5. Focused coverage verifies direct updates cannot drop permission status,
   repair-job fingerprint, rollback contract, or rollback reason, and cannot
   use a whitespace-padded current version to bypass the required repair-step
   fields.

## Filtered Visibility Slice

Status: implemented.

Persisted repair execution requests can now be found from the normal
workspace-scoped GraphQL/Admin diagnostics surface instead of requiring exact
mutation responses or direct SQL.

Implemented behavior:

1. `CopilotRepairExecutionModel.list` returns recent hydrated repair execution
   records with the same audit and side-effect ledger history as `get`.
2. List reads accept exact filters for status, approval state, prompt name, and
   requested action.
3. The bounded locator query matches request id, prompt/action, idempotency,
   request/candidate/task-route/target/repair-job/approval/audit fingerprints,
   failure code, worker lease id, audit event id/type/fingerprint, and
   side-effect id/kind/record id/fingerprint/executor-payload/worker lease
   evidence.
4. GraphQL/common/Admin expose `repairExecutions(filter, limit)` while
   preserving the default recent-list behavior.
5. Admin adds a repair execution status selector and locator input, and renders
   the request, worker state, fingerprints, runtime result, Agent Runtime link,
   audit history, and side-effect ledger evidence.
6. Focused backend coverage verifies default list hydration, status filtering,
   request/audit fingerprint locators, no-match behavior, and side-effect
   ledger locator filtering. Admin coverage verifies the GraphQL variables sent
   by the status and locator controls.

## State Model

Recommended initial statuses:

- `queued`;
- `waiting_approval`;
- `running`;
- `completed`;
- `failed`;
- `cancelled`.

Do not add rollback-specific statuses until rollback behavior exists.

## Tests

Backend:

- creates request with idempotency guard and records insert-conflict reuse
  without surfacing unique-key errors when the create evidence matches;
- blocks unauthorized actor;
- requires approval for mutation-capable action;
- records audit event;
- transitions status deterministically in the first slice;
- approves and rejects waiting requests with audit events and Agent Runtime
  synchronization;
- approval publishes a workspace-scoped Prompt Registry revision and records
  side-effect metadata;
- approval publishes a workspace-scoped Task Route Policy revision for
  `repair_task_model_route` and records side-effect metadata;
- approval publishes a workspace-scoped Model Registry revision for
  `repair_default_model_route` and records side-effect metadata;
- approval publishes a workspace-scoped Provider Registry revision from a
  constrained provider registry repair payload and records side-effect metadata;
- completed constrained side-effect summaries record a forward-only rollback
  contract so Admin/support bundle/audit consumers do not infer rollback
  capability;
- completed constrained side effects persist an
  `ai_repair_execution_side_effects` ledger row with request/workspace/actor
  snapshot coherence, executor payload fingerprint, worker lease evidence, and
  the same forward-only rollback contract, and parent request snapshot edits
  cannot cascade changed actor/workspace evidence into historical side-effect
  ledger rows;
- completed applied repair execution request rows require the matching
  side-effect ledger row by commit time, so request runtime results cannot claim
  `sideEffectsApplied=true` without durable side-effect history;
- reads the completed repair execution record back through the model and
  GraphQL request path with `sideEffectCount` and recent side-effect ledger
  history;
- reads persisted repair execution records through the independent
  `repairExecutions(filter, limit)` GraphQL/Admin surface, including bounded
  status and durable request/audit/side-effect locator filters;
- reads repair execution lifecycle audit rows back through model, GraphQL
  request, approval, and Admin paths with `auditEvents` recent history;
- worker completion rejects unknown side-effect kinds and oversized
  side-effect summaries before writing runtime results or audit rows;
- approval first queues execution and the worker applies the side effect;
- worker failure records retryable transient failures, terminal unsupported
  executor payload failures, and terminal side-effect revision conflicts;
- worker failure persistence normalizes blank and overlong messages across the
  request row, runtime result, and failed audit metadata;
- worker failure persistence normalizes failure codes across the request row,
  runtime result, and failed audit metadata;
- rejects orphan failure codes or messages at the database boundary after
  worker failure persistence writes the request row;
- worker retry completes when a matching durable Prompt Registry side-effect
  revision was already written before execution completion;
- worker fails instead of completing when a same-scope durable side-effect
  revision exists with a different fingerprint;
- manual cancel records terminal cancellation, clears stale failure state, and
  synchronizes Agent Runtime;
- running cancel records a durable `cancel_requested` audit event tied to the
  current worker lease/attempt, keeps the request running until the leased
  worker observes it, rejects same-lease request snapshot drift before writing
  the audit event, and then cooperatively cancels before side effects with
  Agent Runtime synchronization;
- manual retry records control audit events, requeues failed requests, extends
  attempts when needed, rejects unchanged terminal executor-payload failures,
  and lets the worker apply a real executor side effect after the payload is
  corrected;
- manual cancel now fences waiting/queued/failed-row updates on the originally
  read request identity, approval, runtime result, executor payload, failure,
  queue/lease/attempt, completion, creation, and update timestamp snapshot, so
  stale cancellable records cannot be terminalized with misleading control
  audit evidence;
- manual retry and corrected-payload resume now fence failed-row updates on
  the originally read approval, runtime result, executor payload, failure,
  queue/lease/attempt, completion, and update timestamp snapshot, so stale
  failed records cannot be requeued with misleading control audit evidence;
- manual cancel/retry transitions fail closed when the request state or
  guarded row evidence changes between read and update, and do not write
  misleading control audit rows;
- approval and worker terminal transitions fail closed when the request state
  changes between read and update, and do not write misleading approval,
  queued, completed, side-effect, failed, or retry audit rows;
- manual stale recovery rejects active leases, fences expired running recovery
  on the originally read request identity, runtime, executor payload,
  queue/lease/attempt, failure, completion, creation, and update timestamp
  snapshot, recovers expired running leases into queued state when attempts
  remain, and synchronizes Agent Runtime;
- scheduled stale lease recovery requeues expired running requests, syncs Agent
  Runtime, and enqueues a fresh repair worker job;
- verifies the normal repair execution worker does not directly reacquire an
  expired `running` lease, preserving stale recovery audit semantics;
- verifies a worker whose lease is recovered before side-effect execution does
  not call the registry publisher, write a side-effect ledger row, append
  side-effect/completed/failed audit rows, or mutate the recovered request;
- verifies same-lease worker-attempt drift before side-effect execution is
  treated as stale: the old attempt does not consume cancellation, does not
  pass the side-effect current-lease check, and cannot write side-effect or
  completed audit evidence;
- verifies stale running cancellation requests from a previous lease are not
  consumed by a later worker lease;
- scheduled queued enqueue recovery finds durable queued requests and restores
  missing repair worker jobs without mutating request state;
- rejects unsupported permission status values before writing execution
  request rows.
- rejects malformed worker attempt counters at the database boundary.
- rejects malformed worker/control audit metadata at the database boundary.
- rejects duplicate/stale decisions and unauthorized decisions.

Admin/UI if changed:

- displays request status;
- shows audit/idempotency metadata;
- does not expose secrets or raw provider payloads.

Current focused coverage includes backend persistence/idempotency/audit and
workspace authorization tests plus Admin rendering for the durable execution
record, approval decision controls, queued worker metadata, terminal decision
state, worker retry/failure handling with terminal executor-contract failures,
Prompt Registry revision side-effect state, Task Route Policy revision
side-effect state, Model Registry revision side-effect state, Provider
Registry revision side-effect state, durable side-effect retry/idempotency
recovery, conflicting side-effect terminal failure, manual cancellation, manual
retry including unchanged terminal executor-payload rejection, manual and
scheduled stale running lease recovery, and control authorization.
Idempotency coverage now also verifies a pre-read miss followed by an
insert-conflict reuses the existing request and appends only `reused` audit
history for the losing caller, and rejects a drifted insert-conflict row before
writing misleading `reused` audit evidence.
Admin coverage now also verifies completed repair execution rows display the
side-effect ledger count and recent history from GraphQL, including the
side-effect kind, record id, worker attempt, and fingerprint.
It also verifies the model boundary trims and bounds durable request identity
and fingerprint fields, permission status, worker failure codes, manual
control reasons, and audit metadata before persistence. Executor-payload
boundary coverage verifies
non-object payload rejection, overlong payload kind rejection, oversized
payload rejection before request rows are written, and JSON round-trip
normalization of persisted payloads. Worker-attempt and worker-lease
row-shape coverage verifies invalid attempt/max-attempt combinations,
orphan/blank lease evidence, and non-running lease ownership evidence are
rejected before they can affect lease eligibility.
Completed-timestamp row-shape coverage verifies terminal and non-terminal
status/timestamp drift is rejected before request rows can mislead execution
diagnostics. Approval-status coherence coverage verifies waiting-approval rows
cannot carry approved state and executable queued rows cannot regress to waiting
approval state before scheduler or worker paths observe contradictory execution
eligibility. Queued-timestamp row-shape coverage verifies waiting-approval rows
cannot gain queue evidence and executable queued rows cannot lose queue
evidence before scheduler or worker paths depend on queue ordering.
Request timestamp-coherence coverage verifies direct request rows cannot move
`updated_at` or worker `last_attempt_at` before request creation before worker
listing, stale recovery, or diagnostics consume impossible lifecycle evidence.
Failure-field row-shape coverage verifies failed request rows cannot retain an
orphan `failure_code` or orphan `failure_message` after worker persistence has
written normalized failure evidence.
Failure-string row-shape coverage verifies failed request rows cannot retain
blank failure diagnostic strings after worker persistence has written
normalized failure evidence.
Request identity row-shape coverage verifies direct writes cannot blank durable
request identity or fingerprint evidence before idempotency, diagnostics, or
worker paths observe malformed request rows.
Audit fingerprint row-shape coverage verifies direct writes cannot blank repair
execution audit event fingerprints before diagnostics, idempotency, worker
recovery, or Admin audit consumers observe malformed audit rows.
Audit metadata contract coverage verifies direct writes cannot drift current
worker/control audit events away from their stable lease, failure, retry,
manual cancel/retry, or stale-recovery metadata contracts.
Request/audit JSON-shape coverage now verifies non-object
`runtime_result`, `executor_payload`, and audit `metadata` writes are rejected
at the database boundary before new rows can rely on hydration repair.
Runtime side-effect result coverage now verifies direct `runtime_result` writes
cannot claim `sideEffectsApplied=true` without side-effect kind, record id,
fingerprint, and object summary evidence before Agent Runtime, Admin, support
bundle, or audit consumers observe misleading completion rows.
Runtime side-effect rollback-contract coverage now verifies direct
`runtime_result` writes cannot claim `sideEffectsApplied=true` while omitting
the forward-only rollback contract or changing it into a rollback-supported
contract before downstream consumers observe misleading completion rows.
Runtime side-effect executor-payload coverage now verifies model completion and
direct `runtime_result` writes cannot claim an applied side-effect kind that
does not match the persisted executor payload publisher kind.
Agent Runtime repair payload coverage now verifies direct step/timeline writes
cannot weaken the versioned repair execution payloads consumed by run detail,
Admin diagnostics, or audit review.
Hydration coverage verifies legacy or manually malformed object-shaped
`runtime_result` and `executor_payload` JSONB rows are bounded or normalized
before `get`, idempotency lookup, or queued worker listing callers receive
them.
Manual control race coverage verifies stale cancel/retry updates fail before
writing control audit rows when another transition changes request status after
the initial read. It also verifies queued manual-cancel snapshot evidence drift
and stale failed-row evidence snapshots make manual cancel, manual retry, and
corrected-payload resume fail closed without writing manual-control or queued
audit evidence.
Approval/worker race coverage verifies stale approval, worker completion, and
worker failure updates fail before writing misleading approval, queued,
side-effect, terminal, or retry audit rows when another transition changes the
request status after the initial read. Terminal worker completion/failure now
also compare the originally read running request snapshot, including runtime
result, executor payload, queue/lease/attempt, failure, completion, creation,
and update-time evidence, so same-lease non-status drift fails before terminal
audit or side-effect ledger writes.
Stale-recovery race coverage verifies expired running snapshot evidence drift
fails before writing `stale_recovered`, recovered `queued`, or recovered
`failed` audit rows.
Worker-attempt race coverage verifies same-lease attempt drift rejects stale
failure, side-effect preflight, cooperative cancellation, and completion before
writing failure/retry, cancellation, side-effect ledger, side-effect audit, or
completed audit evidence.
Side-effect result boundary coverage verifies direct worker completion rejects
unsupported side-effect kinds, oversized summaries, and summaries without the
forward-only rollback contract while leaving the leased request running and
without writing side-effect or completed audit rows.
Request evidence immutability coverage now verifies repair request rows allow
true no-op and lifecycle/runtime updates, but reject direct rewrites of request
identity, workspace/actor linkage, permission/idempotency evidence, all source
and repair fingerprints, persisted executor payload, and creation time after
insert. Unsupported or invalid executor-payload failures are now terminal for
unchanged manual retry and can resume only through the audited
corrected-payload workflow before any side-effect ledger exists.
Terminal result guard coverage now verifies completed/failed/cancelled repair
request rows reject direct same-terminal result, failure, completion, and
attempt evidence rewrites while preserving the model-owned failed-to-queued
manual retry and failed-to-cancelled manual cancel transitions.
Request audit-history coverage now verifies new request rows and lifecycle
state transitions require matching append-only audit events by commit time,
while true no-op lifecycle updates and valid request-plus-audit transactions
remain compatible with the model-owned write order.
Approval decision audit coverage now verifies direct SQL cannot advance a
waiting request to `approval_state=approved` or `approval_state=rejected`
without the corresponding `approval_approved` or `approval_rejected` audit
event, even when the queued/cancelled lifecycle audit row is present.
Audit delete restriction coverage now verifies persisted request audit rows
cannot be removed while the parent request still exists, preserving the
append-only request history required by lifecycle state.
Side-effect ledger required coverage now verifies completed applied request
state requires a matching ledger row by commit time, while the valid
request-plus-ledger-plus-audit transaction and no-op updates remain compatible
with the worker-owned write order. Ledger delete restriction coverage verifies
the required ledger row cannot be removed while the completed parent request
still depends on it.

## Remaining Risk

- only four narrow DB revision publisher executors exist: Prompt Registry,
  Task Route Policy, Model Registry, and Provider Registry;
- Task Route Policy repair currently selects one publishable route-policy
  target from the approved preview; broader editable model choice and bulk
  migration UI remain future work;
- no rollback behavior, and no rollback fields should be added until that
  behavior exists beyond the explicit forward-only contract on completed
  constrained side-effect summaries;
- manual cancel/retry/recover-stale exists for waiting/queued/failed requests,
  running requests can record a durable cooperative cancellation request that
  the current worker lease observes before side effects, the worker revalidates
  a current non-expired lease and matching attempt immediately before side
  effects, worker-owned terminal/cancel writes guard same-lease attempt drift,
  deterministic executor-payload failures fail closed on unchanged manual
  retry, waiting/queued/failed manual cancel, running cancellation requests,
  and corrected-payload resume are audited and snapshot-fenced, and expired
  running leases recover through the scheduled path. Terminal parent result
  evidence now rejects direct same-terminal drift, and request lifecycle
  changes now require matching audit history by commit time, but there is still
  no true live interruption after side-effect application has started, no
  broader non-registry resume payload workflow, and no rollback workflow.
- side-effect idempotency is limited to the four DB registry revision
  publishers; broader executors still need their own idempotent side-effect
  contracts before they are enabled.
- repair execution model writes now bound common durable strings, executor
  payload JSON, audit metadata, persisted JSON hydration, DB-enforced request
  and audit JSON object shape, audit event fingerprint string shape, worker
  and control audit metadata contracts, worker attempt counters, worker lease
  pair, lease-id string, and lease-status evidence, terminal
  completion timestamps, approval/status coherence, queued timestamp coherence,
  request timestamp coherence,
  failure field pairing, failure string shape, and request identity string
  shape, plus applied runtime side-effect result shape and forward-only
  rollback-contract shape, executor-payload/side-effect-kind coherence, and
  repair-execution-linked Agent Runtime payload shape, plus DB-enforced audit
  workspace snapshot coherence, side-effect ledger parent-snapshot update
  restriction, side-effect-ledger-required terminal request history,
  side-effect ledger delete restriction while parent requests still exist,
  request evidence/executor-payload immutability after insert,
  audit-history requirements for request inserts and lifecycle transitions,
  approval decision audit-history requirements for approved/rejected approval
  state changes, and audit event delete restriction while parent requests still
  exist,
  but future
  non-registry executors still need
  executor-specific payload schemas and side-effect idempotency contracts
  before being enabled.
- worker completion now allow-lists current registry side-effect result kinds
  and bounds their summaries, but future non-registry side effects still need
  explicit result schemas before they are accepted.

## Non-goals For First Slice

- arbitrary config mutation;
- automatic provider credential edits;
- rollback executor;
- cross-tenant repair actions.
