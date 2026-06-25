# Integrity, Workers, And Visibility Hardening

Archived from the former docs/ai-capability-modernization-plan.md.
Use docs/ai-modernization/README.md as the active planning entrypoint.
The archived body below may still mention former entrypoint paths; those
references are historical only.

---
## 607. P1 landing record: Repair Execution Terminal Failure Classification

This round closes retry churn for deterministic repair execution failures. The
queued worker previously treated unsupported executor payloads like transient
worker failures, so a request with an executor contract the code could never
run would be requeued until attempts were exhausted.

`CopilotRepairExecutionWorker` now classifies failure codes before persisting
worker failure state. Unsupported executor payloads, invalid executor payloads,
and same-scope side-effect revision fingerprint conflicts pass
`retryable=false` into `failWorkerExecution()`, so they become terminal failed
records on the first worker attempt. Generic runtime/write failures still use
the existing retry budget, `retry_scheduled` audit event, and queued retry path.
Side-effect revision conflicts now persist the explicit
`side_effect_revision_conflict` failure code instead of the generic worker
failure code.

Focused backend coverage in `repair-execution.e2e.ts` now verifies unsupported
executor payloads fail without a retry-scheduled audit event, a transient
registry write failure still retries and later completes after the stubbed
failure is removed, and conflicting durable side-effect revisions fail with the
new terminal conflict code.

Remaining risk: this improves retry semantics for the existing four DB-backed
registry revision executors; broader executors still need their own explicit
idempotent side-effect and rollback contracts before they are enabled.

## 608. P2 landing record: DB-backed Registry Source-chain Provenance Hardening

This round closes a registry durability hygiene gap. DB-backed registry
records persisted structured fallback source-chain evidence, but the
normalizers only required `source`, `scope`, and `status` to be strings. That
made model-layer writes and repair executor payloads capable of retaining
unknown provenance labels in durable diagnostics.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision models now validate fallback source-chain `source` and `scope` values
against each registry family's known provenance vocabulary before persistence
and again when hydrating DB rows. Unknown source labels or non-`global` /
non-`workspace` scopes are dropped from normalized source chains. The hardening
applies to direct model publish calls, repair executor payloads, and DB-backed
read paths.

Focused backend coverage now directly exercises each registry family by
publishing a workspace revision through the model layer with mixed valid and
invalid source-chain entries, then asserting only the valid provenance entry is
returned and stored in the database.

Remaining risk: this hardens provenance metadata for the current DB-backed
revision families; full registry editor workflows, bulk migration UI, prompt
body editing, model diff review, credential management, and external health
probe history remain separate product surfaces.

## 609. P1 landing record: Support Bundle Transfer Event Ingestion

This round closes the support-bundle gap where direct object-storage downloads
could only be marked complete by client acknowledgement telemetry. Client
acknowledgement still exists and remains explicitly non-proof, but the model
now also has an internal server-side ingestion path for object-storage transfer
events.

`CopilotSupportBundleModel.ingestDirectDownloadTransferEvent()` only accepts
direct-delivery authorizations, treats already-downloaded events as idempotent,
rejects non-active rows, impossible timestamps, stale transfers, storage-key
mismatches, byte-size mismatches, and fingerprint mismatches, then revalidates
the persisted bundle state. Before persisting `downloaded`, it checks the
stored object metadata and reads the JSON artifact through the existing
fingerprint validator. Successful events write `downloaded_at` using the
transfer timestamp and append a `downloaded` audit event with
`providerTransferEvent=true`, `serverVerified=true`, storage evidence, and
artifact fingerprint evidence.

Focused backend coverage in `support-bundle.e2e.ts` now verifies a mismatched
provider event leaves the authorization authorized, while a verified archive
transfer event marks the direct-delivery authorization downloaded and records
server-verified audit metadata.

Remaining risk: the ingestion path is code-side and test-covered, but the
product still needs an external object-storage webhook/controller/job to feed
real provider events into it in production.

## 610. P2 landing record: Agent Runtime Adapter Capability Contracts

This round tightens the Agent Runtime workflow adapter seam added in the
previous slice. A registered adapter no longer means only "this workflow name
has an executor"; it must also declare the step types it can process and the
side-effect mode it applies.

`CopilotAgentRuntimeWorkflowRegistry` now stores adapter capability metadata:
contract version, supported step types, side-effect mode, and summary. The
record-only adapter declares all current persisted step types with
`sideEffectMode=none`. The standalone worker checks a leased run against the
registered adapter's capabilities before invoking the executor. If the run
contains unsupported step types, it fails durably with
`unsupported_agent_runtime_adapter_contract`, records the failure through the
existing worker failure path, and never calls the adapter.

Focused backend coverage in `repair-execution.e2e.ts` now asserts the
record-only adapter metadata, duplicate registration behavior under the new
contract, successful record-only dispatch, and a synthetic narrow adapter that
rejects a Codex step before executor invocation.

Remaining risk: capability contracts prevent registered-adapter drift, but
they are still metadata and fail-closed guards. Real planner, model, tool,
Codex, MCP, handoff, and approval adapters still need implementation.

## 611. P1 landing record: Repair Execution Manual Retry Payload Guard

This round closes a repair execution control gap left after deterministic
worker failures became terminal. A terminal unsupported or invalid executor
payload should be operator-recoverable, but requeuing the exact same payload
only recreates the same terminal failure and audit churn.

Worker failure persistence now records an executor-payload fingerprint in both
the runtime failure summary and the `failed` audit metadata. Manual retry
computes the current executor-payload fingerprint before clearing the failure.
If the previous terminal failure was `unsupported_executor_payload` or
`invalid_executor_payload` and the fingerprint is unchanged, retry is rejected
with a deterministic error. Once the executor payload is corrected, the
existing manual retry path still requeues the request, extends attempts when
needed, writes `manual_retry_requested` and `queued` audit events, synchronizes
Agent Runtime, and lets the worker apply the constrained side effect.

Focused backend coverage in `repair-execution.e2e.ts` now verifies that an
unsupported executor payload fails without automatic retry, an immediate manual
retry is rejected while the same payload is still stored, and retry succeeds
after the payload is restored to the original valid executor payload.

Remaining risk: this guards deterministic executor-payload failures, not every
possible side-effect conflict. Side-effect revision conflicts may still be
manually retried after external registry state changes, and rollback remains
unimplemented.

## 612. P2 landing record: DB-backed Registry Source-chain Status Hardening

This round tightens the DB-backed registry provenance hardening from source and
scope labels to the status label as well. The previous normalizers dropped
unknown source/scope values but still accepted any string status, leaving
durable source-chain diagnostics open to unbounded labels from direct model
writes or repair executor payloads.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision models now validate fallback source-chain status values against each
family's current vocabulary before persistence and during DB row hydration.
Prompt source chains keep known readiness/review statuses such as `ready`,
`available`, `prepared_for_approval`, `route_ready`, `reviewed`, and `blocked`.
Task Route Policy keeps active/available/disabled route-policy statuses. Model
Registry keeps active/available/disabled plus the existing
`provider_available` fallback marker. Provider Registry keeps
active/available/disabled.

Focused backend coverage extends the existing source-chain hardening tests in
all four registry families with an invalid status entry, asserting the invalid
entry is dropped from both the returned revision and persisted DB JSON.

Remaining risk: this constrains current provenance metadata vocabulary; full
registry editor workflows, migration tooling, prompt body diff/eval, model
review UI, credential management, and external probe history remain separate
surfaces.

## 613. P1 landing record: Support Bundle Transfer Event Endpoint

This round closes the gap left after support-bundle transfer verification
landed only as a model method. The server now has an authenticated ingestion
surface that object-storage event consumers can call without making support
bundle download completion a broad public mutation.

`CopilotController` exposes
`POST /api/copilot/support-bundles/download-transfer-events` behind the
existing `@Internal()` guard and method/path-bound `x-access-token` convention.
The endpoint validates a narrow JSON payload, parses an optional transfer
timestamp, delegates all storage-key, byte-size, fingerprint, freshness, and
bundle-state checks to
`CopilotSupportBundleModel.ingestDirectDownloadTransferEvent()`, and maps
known verification failures to 400 while missing authorization rows return 404.
Its response is a sanitized authorization snapshot and deliberately omits
download tokens, `downloadUrl`, and `directDownloadUrl`.

Focused backend coverage in `support-bundle.e2e.ts` now exercises the actual
internal HTTP route: an unauthenticated transfer POST is forbidden, malformed
payloads are rejected, byte-size mismatches leave the authorization
`authorized`, verified provider events mark the row `downloaded`, replayed
events remain idempotent, and the `downloaded` audit metadata records
`providerTransferEvent=true` and `serverVerified=true`.

Remaining risk: this wires the server ingestion surface, but provider-specific
webhook adapters or object-storage notification jobs still need to translate
real S3/GCS/R2/Azure events into this canonical endpoint payload.

## 614. P2 landing record: DB-backed Registry Source-chain Field Sanitization

This round tightens the previous DB-backed registry provenance hardening from
top-level source-chain labels to optional metadata fields on otherwise trusted
entries. A source-chain entry with a valid source, scope, and status no longer
gets to persist arbitrary object, number, array, date, or unknown enum-shaped
values under diagnostic fields.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision models now sanitize optional source-chain fields during the same
normalization used by direct publish inputs, repair executor payloads, and DB
row hydration. Shared string-like fields such as actor id, fingerprint,
revision, updated-at, and workspace id are copied only when they are bounded
non-empty strings. Prompt `registryId` must be a safe non-negative integer.
Task Route Policy `featureKind` and `configKey` must match the supported task
route vocabularies. Provider Registry `providerType` must match the configured
provider type enum.

Focused backend coverage extends the existing source-chain hardening tests in
all four registry families. Each test now includes malformed optional metadata
on a valid provenance entry and asserts the returned revision and persisted DB
JSON keep only the valid optional fields.

Remaining risk: this improves durable provenance hygiene, but does not replace
full registry editor workflows, migration tooling, prompt body diff/eval,
model review UI, provider credential management, or external health probe
history.

## 615. P2 landing record: Repair Execution Forward-only Rollback Contract

This round closes a repair execution observability gap without pretending
rollback exists. The constrained repair executors can publish DB-backed
registry revisions, and operators can recover by publishing follow-up
revisions, but there is still no rollback executor or inverse side effect.
That fact is now persisted as a machine-readable side-effect contract instead
of only living in prose.

`CopilotRepairExecutionWorker` now stamps every completed constrained registry
side-effect summary with
`rollbackContract.version=repair-execution-side-effect-rollback-contract/v1`,
`supported=false`, `mode=forward_only_followup_revision`, and
`recoveryPath=publish_follow_up_registry_revision`. The summary is included in
the side-effect fingerprint and is persisted through the existing runtime
result and `side_effect_applied` audit metadata. This applies uniformly to
Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision publish executors.

Focused backend coverage in `repair-execution.e2e.ts` now asserts the
forward-only rollback contract on persisted runtime results for both the normal
prompt registry side-effect completion path and a manual-retry completion path.

Remaining risk: this makes the no-rollback contract explicit and durable; it
does not implement rollback, live running interruption, operator-provided
resume payloads, or inverse side-effect executors.

## 616. P2 landing record: Agent Runtime Adapter Registration And Rollback Projection

This round closes two Agent Runtime observability and contract gaps left after
the first workflow adapter registry landed. Workflow adapter registration now
fails before storage when capability metadata is malformed, and
repair-execution-linked Agent Runtime records now carry the same forward-only
rollback contract that the repair execution runtime result persists.

`CopilotAgentRuntimeWorkflowRegistry.register()` validates the declared
capability contract version, side-effect mode, supported step-type vocabulary,
non-empty supported step list, and non-empty capability summary. Invalid
adapters are rejected immediately, so a bad in-process registration cannot
silently appear as a valid durable worker path and later fail only after a run
is leased.

`CopilotAgentRuntimeModel` now projects repair execution side-effect metadata
through a shared helper into both linked step output summaries and model-step
timeline payloads. It still avoids copying the entire side-effect summary, but
it includes `sideEffectFingerprint`, `sideEffectKind`, `sideEffectRecordId`, and
`sideEffectRollbackContract` when present. That makes the forward-only recovery
contract visible from Agent Runtime run detail, not only from the repair
execution row.

Focused backend coverage in `repair-execution.e2e.ts` now asserts malformed
adapter registrations are rejected for unsupported capability versions,
unsupported side-effect modes, unsupported step types, and blank summaries. It
also verifies normal prompt registry completion and manual-retry completion
project the forward-only rollback contract into Agent Runtime step output and
the completed model-step timeline payload.

Remaining risk: Agent Runtime now has stricter adapter registration and richer
repair-linked projection, but planner, tool, Codex, MCP, handoff, approval, and
model executors are still not implemented. Unsupported workflows still fail
closed until concrete adapters with matching contracts are registered.

## 617. P2 landing record: Agent Runtime Worker Adapter Resolution Evidence

This round tightens standalone Agent Runtime worker failures from string-only
diagnostics to structured durable evidence. Unsupported workflows and
unsupported adapter contracts now persist the adapter-resolution context that
led the worker to fail closed.

`CopilotAgentRuntimeWorker` now builds an
`agent-runtime-worker-adapter-resolution/v1` payload before calling the failure
persistence path. For missing workflow adapters, the payload records
`status=unsupported_workflow`, the requested workflow, requested step types, and
sanitized registered adapter capability snapshots. For registered adapters with
an insufficient contract, it records `status=unsupported_contract`, requested
step types, unsupported step types, the selected adapter capability, and the
same registered-adapter snapshot.

`CopilotAgentRuntimeModel.failStandaloneWorkerExecution()` now persists that
payload into step error timeline events, the terminal run-status timeline
event, and each failed step's `workerFailure.adapterResolution` output summary.
The existing status machine, failure codes, and retry behavior are unchanged;
the improvement is durable machine-readable triage evidence for UI and operator
follow-up.

Focused backend coverage in `repair-execution.e2e.ts` now asserts both
unsupported-workflow and unsupported-contract worker failures include the
expected adapter-resolution payload, including requested step types,
unsupported step types when relevant, and registered adapter capability
snapshots.

Remaining risk: this improves failure explainability but still does not execute
tool, Codex, MCP, handoff, approval, model, or planner-driven workflows.

## 618. P2 landing record: Agent Runtime Adapter Registration Shape Guards

This round tightens the in-process Agent Runtime workflow adapter registration
contract beyond enum/value checks. A malformed adapter object can now fail with
deterministic registration errors before the registry trims strings, iterates a
step list, or stores partially trusted metadata.

`CopilotAgentRuntimeWorkflowRegistry.register()` now explicitly requires a
string workflow, an object-shaped capability payload, a string summary, and an
array-shaped supported step-type list before applying the existing capability
version, side-effect mode, known step vocabulary, duplicate workflow, and blank
summary checks. These guards turn accidental bad adapter construction into
clear contract failures rather than incidental JavaScript `TypeError`s or
partially normalized registration state.

Focused backend coverage in `repair-execution.e2e.ts` now includes malformed
runtime adapter inputs for non-string workflow, non-array supported step list,
and non-string summary, alongside the existing bad capability version,
unsupported side-effect mode, unsupported step type, blank summary, and
duplicate workflow assertions.

Remaining risk: registration is stricter, but the only real registered adapter
is still `agent_runtime_record_only`. Tool, Codex, MCP, handoff, approval,
model, and planner-driven executors remain separate implementation work.

## 619. P2 landing record: Support Bundle Transfer Event Payload Hardening

This round tightens the internal support-bundle transfer event endpoint before
provider-specific webhook adapters are added. Server-verified transfer events
already revalidated storage metadata and artifact bytes in the model, but the
controller accepted unbounded string metadata that could be copied into durable
audit rows after successful verification.

`CopilotController` now bounds the canonical transfer event payload fields
before calling `CopilotSupportBundleModel.ingestDirectDownloadTransferEvent()`.
`authorizationId`, `eventId`, `eventSource`, and `storageKey` are non-empty
strings capped at 512 characters, `artifactByteSize` remains a non-negative
integer, and `artifactFingerprint` must match the current 16-character
hex support-bundle fingerprint shape. Invalid payloads fail as 400 at the
internal endpoint and never reach model verification or audit persistence.

Focused backend coverage in `support-bundle.e2e.ts` now exercises overlong
transfer event metadata and malformed artifact fingerprints through the actual
authenticated internal HTTP route, alongside the existing unauthenticated,
malformed, mismatched, verified, and replayed transfer event cases.

Remaining risk: the canonical endpoint is stricter, but production still needs
provider-specific S3/GCS/R2/Azure webhook adapters or notification jobs to
translate real object-storage events into this payload.

## 620. P2 landing record: DB-backed Registry Source-chain Entry Cap

This round tightens DB-backed registry provenance persistence from field-level
sanitization to list-size control. Valid source-chain entries were already
filtered by source, scope, status, and optional metadata shape, but a direct
model write or repair executor payload could still provide an arbitrarily long
list of otherwise valid provenance entries.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision models now cap normalized fallback source chains at the first 16 valid
entries. The cap is applied in the same normalization path used by direct
publish inputs, repair executor payloads, and DB row hydration, so oversized
durable JSON is bounded consistently across all four registry families.

Focused backend coverage extends the existing source-chain hardening tests for
all four registry families with 20 additional valid provenance entries. Each
test now asserts the returned revision and persisted DB JSON retain only the
first 16 valid entries after invalid source/scope/status and malformed optional
metadata entries are removed.

Remaining risk: provenance lists are now bounded, but registry editor
workflows, migration tooling, prompt body diff/eval, model review UI, provider
credential management, and external health probe history remain separate work.

## 621. P1 landing record: Support Bundle S3/R2 Transfer Event Translator

This round closes part of the support-bundle provider-event gap by adding a
provider-shaped translator in front of the existing canonical transfer event
verifier. The internal transfer endpoint no longer requires every object-store
consumer to handcraft the canonical payload when the source event is already an
S3/R2-compatible object-created notification.

`CopilotController` now accepts a second authenticated internal payload shape:
`provider=s3_object_created`, `authorizationId`, optional
`artifactFingerprint`, and an S3 notification `event`. The translator supports
single-record S3 event notifications and EventBridge-style S3 object-created
events. It extracts and bounds the object key, object byte size, event source,
request/sequencer id, and transfer time, decodes the object key, then feeds the
result back through the existing canonical parser and
`CopilotSupportBundleModel.ingestDirectDownloadTransferEvent()`.

The model verifier remains the source of truth. The translator does not mark
anything downloaded by itself; storage key, byte size, authorization state,
bundle state, persisted object metadata, and artifact fingerprint are still
revalidated before the authorization transitions to `downloaded` and before
`serverVerified=true` audit metadata is written.

Focused backend coverage in `support-bundle.e2e.ts` now exercises malformed S3
notifications and a valid S3-style object-created notification through the
actual internal HTTP endpoint, asserting the translated event records the
expected provider transfer id/source and storage evidence only after successful
server-side verification.

Remaining risk: S3/R2-compatible event translation is wired, but production
deployments still need concrete queue/webhook plumbing for each storage backend
and signatures/policy checks appropriate to their notification infrastructure.

## 622. P2 landing record: Agent Runtime Adapter Execution Failure Persistence

This round closes a standalone Agent Runtime state-machine risk after adapter
registration and capability checks were added. A registered workflow adapter can
still throw after the worker has acquired a durable lease; that path now fails
closed immediately instead of leaving the run `running` until stale-lease
recovery notices it later.

`CopilotAgentRuntimeWorker` now catches registered adapter execution exceptions
and delegates to the same terminal failure persistence path used by unsupported
workflow and unsupported-contract failures. The run is marked `failed`, the
worker lease is cleared, active steps are marked `failed`, and the timeline and
step output persist `agent_runtime_adapter_execution_failed` plus structured
`adapterResolution.status=execution_failed` metadata with the selected adapter
capabilities and registered-adapter snapshot.

`CopilotAgentRuntimeModel.failStandaloneWorkerExecution()` now normalizes
worker failure messages before persistence. Blank adapter exception messages
use a deterministic fallback, and overlong messages are capped before being
stored in the run row, failed step output summary, and timeline payloads.

Focused backend coverage in `repair-execution.e2e.ts` registers synthetic
throwing adapters, runs the actual standalone worker, and verifies terminal run
and step failure, lease clearing, `execution_failed` adapter-resolution
metadata, registered-adapter evidence, timeline failure payloads, and blank or
overlong failure-message normalization.

Remaining risk: adapter execution failure is now durable and bounded, but this
does not implement real tool, Codex, MCP, handoff, approval, model, or planner
executors. Registered production adapters still need concrete executor
implementations and their own side-effect contracts.

## 623. P2 landing record: DB-backed Registry Repair Payload String Bounds

This round tightens the DB-backed registry write side from source-chain
provenance hardening to repair-worker payload metadata. The constrained repair
executors already wrote Prompt Registry, Task Route Policy, Model Registry, and
Provider Registry revisions through DB-backed models, but several ordinary
string fields and list-shaped metadata fields were accepted as long as they
were non-empty.

All four registry revision models now trim and bound repair executor payload
strings before they are used in revision fingerprints, persisted row columns,
provider/model profile JSON, or repair metadata. Required string fields over
512 characters fail before a registry row is written. List-shaped metadata is
trimmed, deduplicated, and drops blank or overlong entries.

Model Registry repair payloads now reuse the same sanitized model-definition
path as direct publish rather than carrying nested definition objects through a
looser normalizer. Provider Registry repair payloads already flow through the
provider-profile sanitizer; its nested model-definition and model-list string
normalization now share the same payload string bounds.

Focused backend coverage in the four registry revision e2e suites now verifies
that overlong required repair payload fields are rejected without writing rows,
and that Prompt Registry operation metadata, Task Route Policy route evidence,
Model Registry model definitions, and Provider Registry profile metadata are
trimmed, deduplicated, and bounded before DB persistence.

Remaining risk: this covers the repair-worker executor payload boundary and
the shared model/provider definition sanitizers. Full editable registry
workflows, migration tooling, prompt body diff/eval, model review UI,
provider credential management, and a broader direct-publish form/input policy
remain separate work.

## 624. P2 landing record: Agent Runtime Adapter Incomplete Execution Guard

This round closes another standalone Agent Runtime worker state-machine gap.
Registered adapters can now be present, satisfy capability checks, and return
without throwing, but still leave the leased run `running`. That used to rely
on stale-lease recovery to notice the incomplete execution later.

`CopilotAgentRuntimeWorker` now verifies the adapter postcondition after
`execute()` returns. It re-reads the run, and if the run is still `running`
under the same worker lease, it fails the run immediately through the existing
terminal failure persistence path with
`agent_runtime_adapter_incomplete_execution`.

The persisted failure clears the worker lease, marks active steps failed, and
stores structured
`adapterResolution.status=incomplete_execution` metadata with requested step
types, selected adapter capabilities, and the registered-adapter snapshot.
Adapters that complete, fail, cancel, or otherwise release the lease are not
changed by this guard.

The exception path uses the same lease postcondition. If an adapter throws
after it has already moved the run to a terminal state and released the lease,
the worker preserves that existing terminal state instead of attempting to
write a second failure against a cleared lease.

Focused backend coverage in `repair-execution.e2e.ts` registers a synthetic
no-op adapter, runs the actual standalone worker, and verifies immediate
terminal failure, lease clearing, failed active steps, and durable
`incomplete_execution` adapter-resolution evidence. A companion synthetic
adapter verifies that a post-terminal throw does not overwrite an already
failed and lease-cleared run.

Remaining risk: adapter postconditions are now enforced for silent no-op
adapters, but production tool, Codex, MCP, handoff, approval, model, and
planner executors still need concrete implementations and executor-specific
side-effect contracts.

## 625. P2 landing record: Repair Execution Worker Failure Message Bounds

This round tightens repair execution worker failure persistence. The worker
already truncated thrown error messages before classifying failures, but the
DB persistence boundary still accepted blank messages and depended on callers
to provide bounded text.

`CopilotRepairExecutionModel.failWorkerExecution()` now normalizes failure
messages before writing `ai_repair_execution_requests`, constructing the
runtime result, or writing the `failed` audit event. Blank messages use the
deterministic fallback `Repair execution worker failed`, and overlong messages
are capped at the existing 2000-character worker failure-message boundary.

Focused backend coverage in `repair-execution.e2e.ts` now leases approved
repair execution requests, calls the actual failure persistence path with
blank and overlong messages, and verifies the normalized value is used in the
request row, runtime result message, and failed audit metadata without leaving
the worker lease attached.

Remaining risk: this bounds failure diagnostics for the existing queued repair
worker path. It does not add live interruption, operator-provided resume
payloads, rollback executors, or side-effect contracts for future non-registry
repair executors.

## 626. P2 landing record: DB-backed Registry Direct Publish String Bounds

This round extends the registry payload hardening from repair-worker executor
payloads to constrained direct publish model inputs. Direct publish rows were
already permission checked and constrained to existing runtime/provider
boundaries, but several durable string fields depended on caller-provided
shape rather than a shared model-layer normalization boundary.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision models now trim and bound direct publish strings before they are used
for fingerprints, row columns, metadata JSON, provider profiles, or model
definitions. Revision ids and idempotency keys use the same bounded string
policy as repair payloads. List-shaped metadata is trimmed and deduplicated by
the same helpers used by repair executor payloads. Overlong required fields
fail before DB writes.

Focused backend coverage in the four registry revision e2e suites now verifies
model-layer normalization for direct publish inputs and GraphQL/direct publish
rejection paths that leave no revision rows behind for overlong durable fields.

Remaining risk: direct publish input strings are now bounded at the registry
model boundary, but full registry editor workflows, prompt body diff/eval,
bulk migration tooling, model/provider review UI, and provider credential
management remain separate work.

## 627. P1 landing record: Support Bundle Transfer Notification Auth Evidence

This round tightens the support-bundle provider-event path from translated
storage evidence to durable trust-boundary evidence. The internal transfer
endpoint was already protected by method/path-bound `x-access-token` auth and
the model already revalidated stored artifact metadata before marking a direct
authorization downloaded, but the downloaded audit row did not preserve how the
notification itself was accepted.

`CopilotController` now attaches bounded transfer notification auth evidence to
canonical and S3/R2-compatible transfer event payloads. The canonical evidence
records the internal `x-access-token` policy, status, and method. S3/R2-shaped
events can also include bounded upstream provider signature evidence from a
trusted notification worker, including provider, verification status, verifier,
key id, algorithm, signature fingerprint, and policy. Invalid or overlong
provider signature evidence fails as 400 before model verification or audit
persistence.

`CopilotSupportBundleModel.ingestDirectDownloadTransferEvent()` now normalizes
that evidence defensively at the persistence boundary, writes it into the
`downloaded` audit metadata only after storage key, byte size, persisted object
metadata, and artifact fingerprint verification succeed, and adds a
deterministic `notificationAuthEvidenceFingerprint` for audit comparison.

Focused backend coverage in `support-bundle.e2e.ts` now verifies malformed
signature evidence is rejected through the actual internal HTTP endpoint,
canonical transfer events persist internal-token notification auth evidence,
and S3/R2-compatible notifications persist the upstream signature summary plus
the deterministic notification auth fingerprint.

Remaining risk: notification auth evidence is now durable and bounded, but real
provider webhook/queue consumers still need deployment-specific cryptographic
signature verification and policy enforcement before forwarding events to this
internal endpoint.

## 628. P2 landing record: Agent Runtime Generic Persistence Input Bounds

This round tightens Agent Runtime standalone persistence boundaries. Generic
run creation, manual control, record-only completion, and worker failure
metadata were already persisted in durable run, step, and timeline tables, but
the model still trusted TypeScript-only shapes for workflow/source ids, step
types/statuses, JSON payloads, and operator-provided text.

`CopilotAgentRuntimeModel.createRun()` now trims and bounds workflow,
source type, source id, title, step key, and step title before computing
fingerprints or writing rows. It validates runtime run status, step status,
step type, step order, and maximum step count at runtime, rejects oversized
target/evidence/output-summary JSON, and writes the step output summary version
marker after caller-provided metadata so callers cannot spoof it. Idempotent
source reuse uses the normalized source tuple.

Standalone manual control now normalizes and bounds cancel/resume reasons
before writing timeline payloads or step output summaries. Record-only
completion trims blank custom summaries to the deterministic default and caps
overlong summaries. Worker failure persistence now bounds failure codes and
adapter-resolution JSON before storing failed run rows, step summaries, and
timeline payloads.

Focused backend coverage in `repair-execution.e2e.ts` now verifies normalized
generic run metadata, idempotent reuse after normalization, rejection of
overlong workflow ids, unknown step types, and oversized target payloads
without writing rows, trimmed manual control reasons, overlong reason
rejection before resume mutation, and bounded record-only custom summaries.

Remaining risk: Agent Runtime durable metadata is now bounded at generic model
write boundaries, but real tool, Codex, MCP, handoff, approval, model, and
planner adapters still need concrete executor implementations plus
executor-specific payload schemas and side-effect contracts.

## 629. P2 landing record: Repair Execution Model Persistence Input Bounds

This round tightens the Repair Execution model write boundary. The queued
repair path already persisted request rows, audit events, worker leases, manual
control, failure state, and constrained registry side effects, but several
durable strings still depended on resolver or worker callers to submit
already-normalized values.

`CopilotRepairExecutionModel.createOrReuse()` now trims and bounds workspace
id, actor id, prompt name, requested action, permission status, idempotency key,
and the persisted fingerprint fields before idempotency lookup, fingerprint
reuse audit, and row insertion. Invalid blank or overlong request fields fail
before a request row or audit event is written.

Worker failure persistence now trims and bounds `failure_code` before writing
the request row, runtime result summary, or failed audit metadata, in addition
to the existing failure-message normalization. Approval and manual control
reasons are normalized and bounded before they are copied into runtime results
or audit metadata. `createAuditEvent()` now also JSON-serializes and size-checks
metadata before it is fingerprinted and persisted, so future audit writes share
the same durable payload cap.

Focused backend coverage in `repair-execution.e2e.ts` now verifies model-layer
normalization and idempotent reuse for repair request identity fields, rejection
of overlong prompt names and blank request fingerprints without writing rows,
failure-code normalization across request/runtime/audit state, overlong
failure-code rejection without changing a leased running request, trimmed manual
cancel reasons, and overlong manual retry reason rejection before requeue.

Remaining risk: repair execution model metadata is now bounded at the common
persistence boundary, but live running interruption, operator-provided resume
payloads, rollback executors, and non-registry executor-specific payload schemas
and side-effect idempotency contracts remain separate implementation work.

## 630. P2 landing record: DB-backed Registry Persistence Boundary Hardening

This round tightens the final write boundary for DB-backed registry revision
metadata. The four registry families already had source-chain provenance
filtering, direct publish string bounds, repair executor payload bounds, and
idempotent conflict handling, but persisted metadata JSON was still assembled
ad hoc in each model and some repair-wrapper identity fields were trusted
after leaving Repair Execution.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision models now serialize and size-check metadata before DB insertion.
Repair publish wrapper fields such as workspace id, actor id, execution request
id, request fingerprint, evidence-set fingerprints, repair job fingerprint, and
approval fingerprint are trimmed and bounded at each registry model boundary
before revision ids, fingerprints, row ids, row columns, or metadata are built.
Execution request ids are also bounded with the `repair-` revision prefix
included, so accepted wrapper ids cannot produce oversized persisted revision
strings.

Provider Registry direct publish now computes persisted
`idempotencyKeyFingerprint` from normalized workspace id, provider id, and
idempotency key values. That aligns the metadata fingerprint with the same
identity tuple used for revision generation and row lookup instead of retaining
whitespace-padded caller input in audit metadata.

Focused backend coverage in the four registry revision e2e suites now verifies
wrapper-field rejection before rows are written, normalized wrapper fields in
persisted revision/metadata values, provider direct-publish idempotency
fingerprints from normalized identity inputs, and the existing payload
normalization behavior under the new metadata-size guard.

Remaining risk: registry metadata and wrapper inputs are now bounded at the
model persistence boundary, but full editable registry workflows, prompt body
diff/eval, model/provider review UI, provider credential management, bulk
migration tooling, and non-registry repair executor contracts remain separate
implementation work.

## 631. P2 landing record: Agent Runtime Adapter Registration Boundary Hardening

This round tightens the Agent Runtime workflow adapter registration boundary.
The standalone worker already failed unsupported workflows and unsupported
adapter contracts with structured adapter-resolution metadata, and model
persistence already capped adapter-resolution JSON. The remaining risk was that
in-process adapter registrations could still retain long workflow names,
overlong summaries, missing executors, too many registered adapters, or mutable
capability objects that later changed the evidence copied into worker failure
metadata.

`CopilotAgentRuntimeWorkflowRegistry.register()` now trims and bounds workflow
names and capability summaries, rejects non-object adapter values, requires an
executable adapter function, caps total registered adapters, and stores frozen
capability snapshots. `adapterCapabilities()` now returns cloned capability
metadata, so callers cannot mutate the registry's stored snapshot through the
exposed diagnostics surface.

Focused backend coverage in `repair-execution.e2e.ts` now verifies overlong
workflow and summary rejection, missing executor rejection, registry capacity
limits, immutable registered capability snapshots after original-adapter
mutation, and immutable snapshots after callers mutate returned capability
metadata. Existing worker failure coverage continues to verify those sanitized
capabilities are copied into unsupported-workflow, unsupported-contract,
execution-failed, and incomplete-execution adapter-resolution payloads.

Remaining risk: Agent Runtime adapter registration metadata is now bounded and
immutable before it reaches durable worker failure evidence, but production
tool, Codex, MCP, handoff, approval, model, and planner adapters still need
concrete executor implementations, executor-specific payload schemas, and
side-effect idempotency contracts.

## 632. P2 landing record: Support Bundle Audit Metadata Boundary Hardening

This round tightens the support-bundle audit persistence boundary. Support
bundle creation, download authorization, transfer ingestion, retention cleanup,
manifest rewrite retries, archive cleanup retries, and escalation already write
durable audit rows, but storage-provider exception strings from manifest
rewrite and archive deletion failures could be copied into audit metadata
without a common storage-error bound.

`CopilotSupportBundleModel` now normalizes storage error codes and messages
before retention audit metadata is assembled. Error codes are trimmed and
bounded, and storage error messages are trimmed and capped before they can
persist as `manifestObjectRewriteErrorMessage` or
`archiveObjectCleanupErrorMessage`. The shared `createAuditEvent()` boundary
now JSON-serializes and size-checks audit metadata before computing the audit
fingerprint or inserting the row, so future support-bundle audit writers share
the same fail-closed metadata cap.

Focused backend coverage in `support-bundle.e2e.ts` now makes manifest rewrite
and archive delete failures throw overlong storage errors, then verifies the
persisted audit metadata contains the bounded message while DB expiration still
commits as before.

Remaining risk: support-bundle audit metadata is now bounded at the common
persistence boundary, but deployment-specific object-storage notification
workers still need real provider signature verification before forwarding
events to the internal transfer endpoint.

## 633. P2 landing record: Repair Execution Executor Payload Persistence Guard

This round tightens the Repair Execution executor-payload write boundary. The
queued worker and DB-backed registry executors already validate the known
registry payloads before side effects, and the model already bounds common
request strings plus audit metadata. However, the request row still accepted
caller-supplied `executorPayload` JSON directly at creation time, relying on
upstream TypeScript shapes and later worker validation.

`CopilotRepairExecutionModel.createOrReuse()` now normalizes the executor
payload before the idempotent request row is written. Payloads must be JSON
objects, optional `version` and `kind` fields are trimmed and bounded with the
same repair-execution string policy, and the full serialized payload is capped
before being copied into `ai_repair_execution_requests.executor_payload`.
Accepted payloads are persisted after a JSON round trip, so undefined fields
cannot survive into durable payload state or future payload fingerprints.

Focused backend coverage in `repair-execution.e2e.ts` now verifies persisted
payload normalization, non-object payload rejection, overlong payload-kind
rejection, and oversized payload rejection without leaving request rows behind.

Remaining risk: Repair Execution now bounds the generic executor-payload
persistence envelope, but non-registry executors still need executor-specific
schemas, idempotent side-effect contracts, live interruption semantics, and
rollback/resume behavior before they are enabled.

## 634. P2 landing record: Repair Execution and Agent Runtime JSON Hydration Guards

This round tightens the DB readback boundary for persisted runtime JSON. Recent
slices bounded writes for repair execution requests, executor payloads, audit
metadata, Agent Runtime generic runs, and adapter metadata, but legacy rows or
manual DB edits could still return malformed JSONB directly into model callers,
worker list paths, and Agent Runtime timeline/detail projections.

`CopilotRepairExecutionModel` now hydrates request rows through guarded runtime
result and executor-payload normalizers before returning `get`,
`getByIdempotencyKey`, queued worker listings, or expired lease listings.
Malformed executor payloads are replaced with `{}` so worker validation fails
closed through the existing unsupported-payload path. Runtime results are
trimmed and bounded field by field, optional side-effect metadata is dropped if
it is malformed or oversized, and fully invalid persisted values are replaced
with a deterministic safe fallback.

`CopilotAgentRuntimeModel` now hydrates step `output_summary` and timeline
`payload` JSON through the same bounded object envelope used for write inputs.
Worker, stale recovery, failure, completion, cancel, and resume updates now
append output-summary metadata only after coercing non-object historical
summaries back to `{}`, preventing malformed persisted JSON from being carried
forward during runtime transitions.

Focused backend coverage in `repair-execution.e2e.ts` now mutates persisted
JSONB rows to malformed legacy values and verifies repair execution `get`,
idempotency lookup, queued listing, Agent Runtime detail readback, and worker
lease append behavior all return bounded safe objects instead of leaking raw
bad shapes.

Remaining risk: runtime JSON hydration is now guarded for the current repair
execution and Agent Runtime persistence surfaces, but production tool, Codex,
MCP, handoff, approval, model, and planner adapters still need concrete
implementations with executor-specific schemas and side-effect idempotency
contracts before arbitrary workflows can safely execute.

## 635. P2 landing record: Support Bundle Manifest Hydration Guards

This round tightens the support-bundle DB readback boundary. Support bundle
creation, artifact persistence, retention cleanup, direct-transfer ingestion,
manifest rewrite retries, archive cleanup retries, and audit metadata now have
bounded write paths, but legacy rows or manual DB edits could still return
malformed `manifest_json` or `source_evidence_summary` JSONB directly into
model callers, retention cleanup, and fallback manifest artifact serving.

`CopilotSupportBundleModel` now hydrates support bundle rows through bounded
source-evidence and manifest normalizers before returning `get`, `list`,
retention due rows, archive-cleanup retry candidates, or manifest-rewrite retry
candidates. Malformed source evidence is replaced with a deterministic
`db_hydration_guard` summary. Malformed manifests are rebuilt from scalar row
metadata including bundle/workspace/actor ids, timestamps, retention status,
fingerprints, and persisted artifact metadata, so fallback manifest downloads
and cleanup code see a coherent manifest object instead of raw bad JSON.

Focused backend coverage in `support-bundle.e2e.ts` now mutates persisted
support-bundle JSONB to malformed legacy values, clears the manifest storage
key to force DB-manifest artifact serving, and verifies model `get`, model
`list`, and authorized API-proxy manifest download all return safe fallback
objects.

Remaining risk: support-bundle manifest/source-evidence hydration is now
guarded for current persistence and artifact-serving paths, but
deployment-specific object-storage notification workers still need real
provider signature verification before forwarding events to the internal
transfer endpoint.

## 636. P2 landing record: Provider Registry Profile Hydration Guard

This round tightens the DB-backed registry readback boundary for provider
profiles. Earlier registry slices bounded source chains, repair payloads,
direct publish inputs, wrapper metadata, and metadata JSON before writes, and
the provider registry already cleared credentials on write. The remaining
readback risk was that a legacy or manually edited `provider_profile` JSONB row
could still preserve arbitrary profile fields or malformed `modelDefinitions`
when resolved back into model/router diagnostics.

`CopilotProviderRegistryRevisionModel` now bounds hydrated provider-profile
JSON before returning revisions. Oversized or non-serializable profile objects
fall back to a minimal safe DB revision profile. Valid-sized profile objects are
rebuilt from trusted row identity, clear `config`, normalize provider type and
source, trim/dedupe model ids, preserve only bounded display/priority/enabled
privacy fields, and sanitize persisted `modelDefinitions` with invalid legacy
entries dropped instead of leaked.

Focused backend coverage in `provider-registry-revision.e2e.ts` now mutates a
persisted provider profile to include an untrusted provider id/type/source,
secret-like config, duplicate models, and one malformed model definition, then
verifies workspace resolution returns the trusted row provider identity,
empty config, normalized models, and only the valid sanitized model definition.

Remaining risk: provider registry profile hydration is now bounded for current
DB-backed read paths, but full editable provider workflows, provider credential
management, automatic health probe execution against real providers, and
non-registry executor-specific side-effect contracts remain separate work.

## 637. P2 landing record: Agent Runtime Adapter Executor Result Guard

This round tightens the Agent Runtime adapter execution contract. The standalone
worker already rejects unsupported workflows, unsupported step contracts,
registered adapter exceptions, and awaited adapters that return without moving
the leased run to a terminal state. A remaining pre-production adapter risk was
that an adapter implementation could return a synchronous non-promise value and
be treated as an ambiguous incomplete execution instead of a distinct contract
violation.

`CopilotAgentRuntimeWorker` now checks the value returned by registered
workflow adapter executors before awaiting it. Non-promise executor results fail
the still-leased run through durable worker-failure persistence with
`agent_runtime_adapter_invalid_executor_result` and structured
`adapterResolution.status=invalid_executor_result` metadata. If the adapter
already released or terminalized the run before returning the invalid value,
the guard preserves that existing state.

Focused backend coverage in `repair-execution.e2e.ts` now registers a
synthetic synchronous adapter, runs the real standalone worker, and verifies
the run fails closed, clears the worker lease, marks the active step failed,
and persists the invalid-executor-result adapter-resolution evidence.

Remaining risk: registered adapter executor-result shape now fails closed for
non-promise implementations, but production tool, Codex, MCP, handoff,
approval, model, and planner adapters still need concrete implementations with
explicit completion, side-effect, interruption, and rollback contracts.

## 638. P2 landing record: Model Registry Definition Hydration Guard

This round tightens the DB-backed registry readback boundary for model
definitions. Earlier Model Registry slices bounded direct publish inputs,
repair payloads, source chains, wrapper metadata, and metadata JSON before
writes, but a legacy or manually edited `model_definition` JSONB row could
still preserve arbitrary fields when resolved back into model/router
diagnostics.

`CopilotModelRegistryRevisionModel` now bounds hydrated `model_definition` JSON
before returning revisions. Valid-sized model definitions are passed through
the same sanitizer used by publish and repair paths, so trusted row model id
wins, strings are trimmed, unknown capabilities are dropped, and arbitrary
unknown fields are not returned. Malformed, non-object, or oversized legacy
definitions fall back to a disabled definition with the trusted row model id
instead of leaking raw persisted JSON.

Focused backend coverage in `model-registry-revision.e2e.ts` now mutates a
persisted model definition to include an untrusted model id, duplicate aliases,
one invalid capability, and an unknown secret-like field, then verifies
workspace resolution returns the trusted row model id, sanitized aliases,
trimmed metadata, only the valid capability, and no unknown secret field.

Remaining risk: Model Registry definition hydration is now bounded for current
DB-backed read paths, but full editable model workflows, model diff/review UI,
bulk migration tooling, and non-registry executor-specific side-effect
contracts remain separate work.

## 639. P2 landing record: Repair Execution Manual Control Stale Update Guards

This round tightens the Repair Execution manual control transition boundary.
Manual cancel and retry already validated the request status before updating,
but the update statements did not assert that the row still matched the
expected status at write time. A concurrent worker or operator transition could
therefore make the conditional update affect zero rows while the method still
re-read the request and wrote misleading control audit events.

`CopilotRepairExecutionModel` now uses `UPDATE ... RETURNING id` for manual
cancel and retry transitions. If the row no longer matches the expected
waiting/queued/failed or failed status, the method fails before writing
`cancelled`, `manual_retry_requested`, or follow-up `queued` audit rows. Existing
precondition checks and normal successful control behavior remain unchanged.

Focused backend coverage in `repair-execution.e2e.ts` now simulates stale
cancel and retry snapshots by changing the persisted request status after the
initial read and verifies both paths fail closed without writing misleading
manual control audit events.

Remaining risk: manual control transitions now guard stale cancel/retry writes,
and stale running lease recovery already uses `RETURNING`, but live running
interruption, operator-provided resume payloads, rollback executors, and
non-registry executor-specific side-effect contracts remain separate work.

## 640. P2 landing record: Repair Execution Approval and Worker Terminal Stale Update Guards

This round tightens the remaining Repair Execution terminal transition race
boundary. Approval decisions, worker completion, and worker failure already
validated the request state before updating, but each path still relied on the
initial read to remain current. A concurrent worker or operator transition
could make the update affect zero rows while the method continued into
approval, queue, completion, side-effect, failure, or retry audit writes.

`CopilotRepairExecutionModel.decideApproval`, `completeWorkerExecution`, and
`failWorkerExecution` now use conditional `UPDATE ... RETURNING id` statements
that assert the row is still in the expected status and, for worker terminal
paths, still leased by the same worker. If the conditional update no-ops, the
method fails before writing follow-up audit rows. Normal successful behavior is
unchanged, including approval queueing, worker side-effect audit ordering,
worker completion, and retry scheduling.

Focused backend coverage in `repair-execution.e2e.ts` now simulates stale
approval, worker completion, and worker failure snapshots by changing the
persisted request status after the initial read. Each path verifies the method
fails closed and does not write misleading approval, queued, side-effect,
completed, failed, or retry audit rows.

Remaining risk: approval and worker terminal writes now guard stale updates,
manual control stale writes are guarded, and stale running lease recovery uses
conditional updates, but live running interruption, operator-provided resume
payloads, rollback executors, and non-registry executor-specific side-effect
contracts remain separate work.

## 641. P2 landing record: Agent Runtime Standalone Stale Update Guards

This round tightens the standalone Agent Runtime transition boundary. Manual
cancel/resume, worker failure, and record-only completion already validated the
run state before updating, but each path still trusted the initial read when
building timeline events and step output summaries. A concurrent worker or
operator transition could therefore make the run update no-op while the method
continued into manual-control, record-only, worker-failure, terminal timeline,
or resume job side effects.

`CopilotAgentRuntimeModel.cancelStandaloneRun`, `resumeStandaloneRun`,
`failStandaloneWorkerExecution`, and
`completeStandaloneRecordOnlyExecution` now use conditional
`UPDATE ... RETURNING id` statements. Manual control asserts the row is still
standalone, still in the initially validated status, and still has the same
lease identity. Worker failure and record-only completion assert the row is
still standalone, still `running`, and still held by the same worker lease. If
the conditional update no-ops, the method fails before writing step summaries
or timeline events; failed resume also returns before the GraphQL resolver can
enqueue a worker job.

Focused backend coverage in `repair-execution.e2e.ts` now simulates stale
standalone cancel, resume, worker failure, and record-only completion snapshots
by changing the persisted run status after the initial read. Each path verifies
the method fails closed and does not write misleading manual-control,
record-only, worker-failure, terminal timeline, or resume-job evidence.

Remaining risk: standalone Agent Runtime state transitions now guard stale
manual and worker terminal writes, but this is still lease/state-machine
integrity. Production tool, Codex, MCP, handoff, approval, model, and planner
adapters still need concrete executor schemas, side-effect idempotency,
interrupt, resume, and rollback contracts.

## 642. P2 landing record: Support Bundle Download Stale State Guards

This round tightens the support-bundle API-proxy download state boundary.
Support bundle creation, retention cleanup, transfer-event ingestion, direct
download acknowledgement, audit metadata, and manifest hydration already had
bounded persistence paths. A remaining race was that `authorizeDownload` and
`consumeDownload` still trusted the initial bundle or authorization read when
writing follow-up rows. Retention cleanup or authorization expiration could
therefore change state between validation and write while stale code still
inserted a fresh authorization or wrote misleading `downloaded` audit evidence.

`CopilotSupportBundleModel.authorizeDownload` now inserts authorization rows
through `INSERT ... SELECT ... WHERE` against the current bundle row, requiring
the bundle to still be `ready`, retention-active, unexpired, and on the same
manifest fingerprint. If that conditional insert returns no row, the method
fails before writing `download_authorized` audit metadata.
`consumeDownload` now marks API-proxy authorizations downloaded through a
conditional `UPDATE ... RETURNING id` that requires the authorization to still
be `authorized`, API-proxy delivered, and unexpired. If the update no-ops, it
returns `null` before writing `downloaded` audit metadata.

Focused backend coverage in `support-bundle.e2e.ts` now simulates a stale
bundle read before authorization insertion and a stale authorization state
before API-proxy consumption finalization. The tests verify no authorization
row, `download_authorized` audit row, downloaded status, downloaded timestamp,
or `downloaded` audit row is written from those stale snapshots.

Remaining risk: Support Bundle API-proxy authorization/download paths now fail
closed on stale DB state, and direct-delivery acknowledgement/transfer paths
already use conditional authorization updates. Deployment-specific
object-storage notification workers still need real provider signature
verification before forwarding events to the internal transfer endpoint.

## 643. P2 landing record: Registry Revision Row Constraint Hardening

This round tightens the DB-backed registry row-shape boundary for Model
Registry and Provider Registry revisions. Prompt Registry and Task Route Policy
revision tables already had database CHECK constraints for `scope_type` and
`status`, but the newer model/provider revision tables used unconstrained
varchar columns while their hydration code trusted the returned strings as
typed revision values.

`ai_model_registry_revisions` and `ai_provider_registry_revisions` now add
`scope_type IN ('global', 'workspace')` and
`status IN ('active', 'archived', 'disabled')` CHECK constraints. The migration
uses `NOT VALID` so existing deployments with historical malformed rows can
apply the schema change without a blocking table validation, while PostgreSQL
still rejects new or updated malformed rows. Model and Provider Registry
hydration also normalizes legacy bad scalar values instead of returning raw DB
strings as typed values: unknown scopes fall back from row shape, and unknown
statuses hydrate as `disabled`.

Focused backend coverage in `model-registry-revision.e2e.ts` and
`provider-registry-revision.e2e.ts` now attempts to insert invalid
`scope_type` and `status` rows and verifies the database rejects them without
leaving durable registry rows behind.

Remaining risk: row-level revision scalar integrity is now aligned across all
four DB-backed registry families, but full editable registry workflows, bulk
migration tooling, prompt-body diff/eval, provider credential management, and
production executor-specific side-effect contracts remain separate work.

## 644. P2 landing record: Support Bundle Transfer Evidence Boundary

This round tightens the support-bundle direct-delivery transfer ingestion
boundary. The internal transfer endpoint already required an internal access
token and revalidated persisted storage evidence before marking an object
storage authorization downloaded, but canonical transfer payloads could still
include caller-supplied `providerSignatureEvidence`. That blurred the line
between “internal caller authenticated” and “provider notification signature
verified.”

The transfer parser now rejects `providerSignatureEvidence` on canonical
internal transfer events. S3/R2-compatible object-created wrapper events may
still include provider signature evidence, but only with
`status=verified_by_upstream`, which represents evidence produced by a
deployment-specific notification verifier before forwarding to LocalMind. A
payload that self-reports `status=verified` is rejected before the model can
mark the authorization downloaded or persist transfer audit metadata.

Focused backend coverage in `support-bundle.e2e.ts` now verifies canonical
transfer events cannot self-report provider signature evidence, S3 wrapper
events with non-upstream-verified signature evidence are rejected, overlong
upstream evidence remains rejected, and valid `verified_by_upstream` S3
evidence is still persisted only after the existing storage verification path
succeeds.

Remaining risk: the internal endpoint no longer persists self-reported
provider signature evidence, but deployment-specific object-storage
notification workers still need real provider signature verification before
forwarding `verified_by_upstream` evidence.

## 645. P2 landing record: Agent Runtime Adapter Registry Allow-listing

This round tightens the Agent Runtime workflow adapter registration boundary.
Adapter metadata was already bounded, frozen, and validated for capability
version, side-effect mode, step-type vocabulary, summaries, executor presence,
and registry capacity. The stored adapter object, however, still used object
spread from the caller-provided adapter. That made it possible for future
adapters to attach arbitrary extra fields that would remain reachable through
the registry object and could accidentally flow into diagnostics or operator
tooling.

`CopilotAgentRuntimeWorkflowRegistry.register` now stores a new allow-listed
adapter object containing only the normalized `workflow`, frozen normalized
`capabilities`, and the `execute` function. Extra fields on the submitted
adapter object and extra fields on the submitted capability object are dropped
at registration.

Focused backend coverage in `repair-execution.e2e.ts` now registers an adapter
with untrusted extra adapter and capability fields, then verifies `get()` only
returns the allow-listed shape and `adapterCapabilities()` does not expose the
untrusted values.

Remaining risk: adapter registry metadata is now validated, immutable, and
allow-listed before it can flow into adapter-resolution diagnostics, but real
production tool, Codex, MCP, handoff, approval, model, and planner adapters
still need executor-specific payload/result schemas, side-effect idempotency,
interruption, and rollback contracts.

## 646. P2 landing record: Repair Execution Side-effect Result Boundary

This round tightens the Repair Execution worker completion boundary. The queued
worker already only produces four constrained registry revision side-effect
kinds, but `completeWorkerExecution` accepted the provided side-effect result
object directly. A future direct caller or malformed executor bridge could
therefore persist an unknown side-effect kind or oversized summary into
`runtime_result` and audit metadata.

`CopilotRepairExecutionModel.completeWorkerExecution` now normalizes approved
side-effect results before building runtime output or audit rows. It accepts
only the current registry revision side-effect kinds, bounds fingerprint and
record id strings, requires an object summary, and runs that summary through
the existing audit metadata JSON size guard. Invalid side-effect results fail
before the request update, `side_effect_applied` audit event, or `completed`
audit event is written.

Focused backend coverage in `repair-execution.e2e.ts` now directly exercises
worker completion with an unsupported side-effect kind and an oversized
side-effect summary, verifying both fail closed while leaving the leased
request running and without writing side-effect or completed audit rows.

Remaining risk: worker completion now allow-lists the current registry
side-effect result surface, but future non-registry executors still need
explicit payload/result schemas, idempotency contracts, interruption semantics,
and rollback contracts before they are accepted.

## 647. P2 landing record: Registry Revision Scope Workspace Invariants

This round tightens the DB-backed registry row-shape boundary beyond scalar
vocabulary. Registry revision unique indexes and read paths already distinguish
global and workspace scope, but the database did not enforce the paired
invariant that global rows must have no `workspace_id` and workspace rows must
have one. A malformed row could therefore sit outside the intended partial
unique-index semantics and make same-scope idempotency harder to reason about.

A new migration adds `scope_type`/`workspace_id` CHECK constraints across
`ai_prompt_registry_revisions`, `ai_task_route_policy_revisions`,
`ai_model_registry_revisions`, and `ai_provider_registry_revisions`. The
constraints are `NOT VALID` to avoid blocking upgrades on historical malformed
rows while still rejecting new or updated malformed rows.

Focused backend coverage now verifies all four registry families reject
`global` revisions with workspace ids and `workspace` revisions without
workspace ids. Model and Provider Registry tests extend the existing row
constraint coverage; Prompt Registry and Task Route Policy add focused DB
boundary tests.

Remaining risk: registry revision row-shape invariants are now database-backed
for scope/status/workspace identity, but editable registry workflows, bulk
migration tooling, prompt-body diff/eval, provider credential management, and
production executor-specific side-effect contracts remain separate work.

## 648. P2 landing record: Support Bundle Direct Transfer Replay Validation

This round tightens the support-bundle direct transfer replay boundary. The
internal transfer endpoint already validated active object-storage transfer
events before marking direct-delivery authorizations downloaded, but an
already-downloaded authorization returned success before replay metadata was
checked. That left replay idempotency broader than the persisted evidence
contract.

`CopilotSupportBundleModel.ingestDirectDownloadTransferEvent()` now routes
downloaded authorizations through replay validation instead of returning early.
The replay path still preserves idempotency for matching direct-transfer
events, but requires the authorization to be direct-delivery, rejects
contradictory artifact fingerprints, compares supplied storage key and byte
size evidence against persisted bundle artifact metadata when available, and
reuses the existing storage verifier while the retained bundle artifact remains
active. Valid replays return the existing downloaded authorization without
writing another audit row.

Focused backend coverage in `support-bundle.e2e.ts` now verifies a matching
already-downloaded transfer replay succeeds, a mismatched byte-size replay
fails with `Support bundle transfer event byte size mismatch`, and the
authorization still has exactly one `downloaded` audit row.

Remaining risk: direct-transfer replay evidence is now fail-closed against
persisted artifact metadata and audit-idempotent, but deployment-specific
object-storage notification workers still need real provider signature
verification and operational retry/dead-letter handling before forwarding
events to the internal endpoint.

## 649. P2 landing record: Repair Execution Permission Status Constraint

This round closes a repair execution row-shape gap in the persisted
authorization evidence. Repair execution requests already stored
`permission_status` from the preflight path, but the first durable table
constraint only bounded request status and approval state. A malformed
permission status could therefore be inserted by a direct model call or manual
DB write and later appear in audit/runtime projections as if it were a valid
authorization state.

`CopilotRepairExecutionModel.createOrReuse()` now normalizes permission status
through an explicit supported-vocabulary guard and rejects unsupported values
before inserting request rows. A new migration adds
`ai_repair_execution_requests_permission_status_check` with the currently
supported `granted` state as a `NOT VALID` constraint, so new writes are
blocked without forcing historical-row cleanup during upgrade.

Focused backend coverage in `repair-execution.e2e.ts` now verifies
`permissionStatus='denied'` fails with
`Repair execution permission status is unsupported: denied` and no request row
is written for that idempotency key.

Remaining risk: repair execution durable authorization state is now bounded for
the current preflight vocabulary, but future multi-state permission workflows
must extend this constraint and model guard deliberately when they add real
denied/pending execution behavior.

## 650. P2 landing record: Support Bundle Download Delivery Shape Constraint

This round tightens support-bundle download authorization row shape. The model
already treats API-proxy authorizations and object-storage signed-URL
authorizations as distinct delivery contracts, but the database only constrained
the delivery-method vocabulary. A contradictory row could therefore carry direct
object-storage URL evidence while labeled `api_proxy`, or lose direct URL
evidence while labeled `object_storage_signed_url`.

A new migration adds
`ai_support_bundle_download_authorizations_delivery_shape_check` as a `NOT
VALID` constraint. API-proxy rows must keep both direct download fields null;
object-storage signed-URL rows must keep both direct URL and expiry populated.
This preserves upgrade tolerance for historical rows while rejecting new
contradictory inserts and updates.

Focused backend coverage in `support-bundle.e2e.ts` now verifies a signed-URL
authorization cannot have `direct_download_url` nulled, and a row with direct
object-storage evidence cannot be relabeled as `api_proxy`.

Remaining risk: download authorization row shape is now database-backed for
delivery evidence, but production object-storage notification workers still
need provider signature verification, retry/dead-letter handling, and
environment-specific webhook wiring before the internal transfer endpoint is
fully operational.

## 651. P2 landing record: Agent Runtime Timeline Status Constraint

This round tightens Agent Runtime timeline row shape. AgentRun and AgentStep
status columns already had explicit vocabularies, but
`ai_agent_timeline_events.status` remained free text even though timeline rows
are used as durable run diagnostics. A malformed status could therefore appear
in timeline projections without matching any supported run or step lifecycle
state.

`CopilotAgentRuntimeModel.insertTimelineEvent()` now normalizes timeline status
against the union of supported run and step statuses before persistence. A new
migration adds `ai_agent_timeline_events_status_check` as a `NOT VALID` CHECK
constraint covering `queued`, `running`, `waiting_approval`, `completed`,
`failed`, `cancelled`, `pending`, and `skipped`.

Focused backend coverage in `repair-execution.e2e.ts` now verifies a direct
insert with `status='ghost_status'` fails on the DB constraint before it can
enter Agent Runtime diagnostics.

Remaining risk: Agent Runtime timeline status vocabulary is now code- and
DB-constrained for the current lifecycle model, but future production adapters
that add new lifecycle states must extend the model types, insertion guard, and
constraint deliberately with corresponding behavior.

## 652. P2 landing record: Worker Attempt Counter Constraints

This round tightens the worker lease eligibility row shape shared by Repair
Execution and standalone Agent Runtime. Both systems use
`worker_attempt < worker_max_attempts` to decide whether queued work can be
leased or stale running work can be recovered. The model paths write sane
values, but the database previously allowed negative attempts, zero max
attempts, or attempts greater than max attempts, which could make direct/manual
rows ambiguous for retry and lease recovery.

A new migration adds `ai_repair_execution_requests_worker_attempts_check` and
`ai_agent_runs_worker_attempts_check` as `NOT VALID` constraints. Both require
`worker_attempt >= 0`, `worker_max_attempts > 0`, and
`worker_attempt <= worker_max_attempts`, preserving upgrade tolerance for
historical rows while rejecting new malformed inserts and updates.

Focused backend coverage in `repair-execution.e2e.ts` now verifies malformed
direct updates are rejected for both repair execution requests and AgentRuntime
run rows before they can affect worker lease eligibility.

Remaining risk: worker attempt counters are now database-backed for the current
lease/recovery model, but live interruption, richer resume payloads, production
adapter-specific retry semantics, and rollback contracts remain separate
executor work.

## 653. P2 landing record: DB-backed Registry Revision JSON Shape Constraints

This round tightens the JSON row-shape boundary shared by the four DB-backed
registry revision families. The model paths already normalize
`fallback_source_chain` to arrays and `metadata` to objects before persistence,
and read paths defensively hydrate historical malformed rows. The database,
however, still allowed direct/manual rows with object-shaped source chains or
array-shaped metadata, forcing runtime hydration repair to mask malformed
durable evidence.

A new migration adds
`ai_prompt_registry_revisions_json_shape_check`,
`ai_task_route_policy_revisions_json_shape_check`,
`ai_model_registry_revisions_json_shape_check`, and
`ai_provider_registry_revisions_json_shape_check` as `NOT VALID` constraints.
Each constraint requires `fallback_source_chain` to be a JSON array and
`metadata` to be a JSON object, preserving upgrade tolerance for legacy rows
while rejecting new malformed inserts and updates.

Focused backend coverage in the four registry revision e2e suites now verifies
that malformed direct inserts fail on the family-specific JSON shape constraint
before those rows can enter effective registry read paths or rely on hydration
repair.

Remaining risk: registry revision row-shape constraints now cover scalar
vocabulary, scope/workspace consistency, and source-chain/metadata JSON shape
for the current durable tables, but full Admin editor workflows, bulk migration
from config/provider defaults, provider credential workflows, and richer
review/diff surfaces remain separate registry product work.

## 654. P2 landing record: Support Bundle Downloaded Timestamp Constraint

This round tightens support-bundle download authorization state fidelity. The
model transitions only set `downloaded_at` when an authorization becomes
`downloaded`, and authorized/expired/revoked rows are treated as not having
download telemetry. The database still allowed direct/manual rows where an
authorized row carried `downloaded_at`, or a `downloaded` row lacked the durable
timestamp, which could confuse audit projections and retry/expiration behavior.

A new migration adds
`ai_support_bundle_download_authorizations_downloaded_at_status_check` as a
`NOT VALID` constraint. Downloaded rows must have `downloaded_at` populated,
and non-downloaded rows must keep it null, preserving upgrade tolerance for
historical rows while rejecting new contradictory inserts and updates.

Focused backend coverage in `support-bundle.e2e.ts` now verifies both malformed
direct updates fail at the database boundary: an authorized signed-URL row
cannot gain `downloaded_at`, and a row cannot claim `downloaded` status without
download time evidence.

Remaining risk: support-bundle download authorization rows now enforce delivery
shape and downloaded telemetry shape, but deployment-specific object-storage
notification workers still need real provider signature verification,
retry/dead-letter handling, and environment-specific webhook wiring before the
internal transfer endpoint is fully operational.

## 655. P2 landing record: Agent Runtime Completed Timestamp Constraints

This round tightens Agent Runtime lifecycle timestamp fidelity. Run and step
status vocabularies were already constrained, but direct/manual rows could still
claim terminal statuses without `completed_at`, or carry completion timestamps
while remaining queued/running/waiting. That weakens timeline diagnostics,
manual resume/recovery interpretation, and future planner/executor projections.

`CopilotAgentRuntimeModel.createRun()` now derives each step row's
`completed_at` from the normalized step status instead of applying the run
timestamp to every step. A new migration adds
`ai_agent_runs_completed_at_status_check` and
`ai_agent_steps_completed_at_status_check` as `NOT VALID` constraints. Terminal
run statuses (`completed`, `failed`, `cancelled`) and terminal step statuses
(`completed`, `failed`, `skipped`) must have `completed_at`; non-terminal
statuses must keep it null.

Focused backend coverage in `repair-execution.e2e.ts` now verifies generic run
creation preserves a queued run with an explicitly completed step, and direct
DB updates are rejected for terminal rows without timestamps and active rows
with timestamps across both `ai_agent_runs` and `ai_agent_steps`.

Remaining risk: Agent Runtime row-shape invariants now cover status vocabulary,
timeline status vocabulary, worker attempt counters, and terminal completion
timestamps for current durable runs/steps, but real tool/Codex/MCP/model
adapters still need executor-specific payload schemas, interruption semantics,
idempotent side-effect contracts, and rollback behavior.

## 656. P2 landing record: Repair Execution Completed Timestamp Constraint

This round tightens Repair Execution request lifecycle timestamp fidelity. The
model writes `completed_at` only when requests become terminal
(`completed`, `failed`, or `cancelled`) and clears it when failed work is
manually retried or stale work is requeued. The database still allowed
direct/manual rows where a terminal status had no completion timestamp, or a
queued/waiting/running request carried completion telemetry.

A new migration adds
`ai_repair_execution_requests_completed_at_status_check` as a `NOT VALID`
constraint. Terminal request statuses must have `completed_at`, and
non-terminal statuses must keep it null, preserving upgrade tolerance for
historical rows while rejecting new contradictory inserts and updates.

Focused backend coverage in `repair-execution.e2e.ts` now verifies both
malformed direct updates fail at the database boundary on a persisted
waiting-approval request: it cannot claim `completed` status without
`completed_at`, and it cannot retain non-terminal status while carrying
completion time evidence.

Remaining risk: Repair Execution request rows now constrain permission status,
worker attempt counters, terminal completion timestamps, stale transition
guards, and current registry side-effect result shapes, but non-registry
executors still need executor-specific payload schemas, idempotent side-effect
contracts, interruption semantics, and rollback behavior before they are
enabled.

## 657. P2 landing record: Support Bundle JSON Shape Constraints

This round tightens support-bundle request and audit JSON row shape. The model
writes request `source_evidence_summary`, request `manifest_json`, and audit
`metadata` as JSON objects, and read paths defensively hydrate historical
malformed request JSON. The database still allowed new direct/manual rows with
array or scalar shapes, forcing hydration repair to mask malformed durable
bundle evidence.

A new migration adds `ai_support_bundle_requests_json_shape_check` and
`ai_support_bundle_audit_events_metadata_shape_check` as `NOT VALID`
constraints. Request rows must keep `source_evidence_summary` and
`manifest_json` object-shaped, and audit rows must keep `metadata`
object-shaped, preserving upgrade tolerance for historical rows while rejecting
new malformed inserts and updates.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct
malformed updates fail for request source-evidence JSON, request manifest JSON,
and audit metadata JSON before those rows can rely on hydration repair.

Remaining risk: support-bundle durable rows now constrain request/audit JSON
shape, bounded hydration, delivery shape, downloaded telemetry shape, replay
evidence, and transfer-event evidence boundaries, but deployment-specific
object-storage notification workers still need real provider signature
verification, retry/dead-letter handling, and environment-specific webhook
wiring before the internal transfer endpoint is fully operational.

## 658. P2 landing record: Worker Lease Pair Constraints

This round tightens worker lease evidence shared by Repair Execution and
standalone Agent Runtime. The model paths write `worker_lease_id` and
`worker_lease_expires_at` together when a worker leases work, and clear both
when work completes, fails, is cancelled, is retried, or stale recovery runs.
The database still allowed orphan lease ids or orphan expiry timestamps, which
could confuse worker ownership checks, stale lease selection, and operator
diagnostics.

A new migration adds `ai_repair_execution_requests_worker_lease_pair_check` and
`ai_agent_runs_worker_lease_pair_check` as `NOT VALID` constraints. Both require
worker lease id and lease expiry to be either both null or both populated,
preserving upgrade tolerance for historical rows while rejecting new malformed
inserts and updates.

Focused backend coverage in `repair-execution.e2e.ts` now verifies malformed
direct updates fail at the database boundary for both systems: Repair Execution
cannot persist an orphan worker lease id, and Agent Runtime cannot persist an
orphan worker lease expiry timestamp.

Remaining risk: worker lease row shape is now database-backed for the current
lease/recovery model, alongside attempt counters and completion timestamps, but
live interruption, richer resume payloads, executor-specific retry semantics,
and rollback contracts remain separate executor work.

## 659. P2 landing record: DB-backed Registry Payload JSON Shape Constraints

This round tightens the remaining Model Registry and Provider Registry JSON
payload boundary. The model read paths already sanitize historical malformed
`model_definition` and `provider_profile` rows before route/model consumers see
them, but the database still allowed new direct/manual rows where those primary
payload columns were arrays or scalars. That left a durable-state gap where
hydration repair, rather than persistence, carried the invariant.

A new migration adds
`ai_model_registry_revisions_payload_json_shape_check` and
`ai_provider_registry_revisions_payload_json_shape_check` as `NOT VALID`
constraints. Model Registry revisions must keep `model_definition`
object-shaped, and Provider Registry revisions must keep `provider_profile`
object-shaped, preserving upgrade tolerance for historical rows while rejecting
new malformed inserts and updates.

Focused backend coverage in the Model Registry and Provider Registry revision
e2e suites now verifies direct malformed inserts fail at the database boundary
before consumers can rely on sanitizer fallback for newly persisted payloads.

Remaining risk: DB-backed registry rows now constrain scalar status/scope
vocabulary, scope/workspace consistency, source-chain and metadata JSON shape,
and Model/Provider payload JSON shape. Full Admin editor workflows, bulk
migration from config/provider defaults, provider credential workflows, richer
review/diff surfaces, and executor-specific rollback contracts remain separate
registry product/runtime work.

## 660. P2 landing record: Repair Execution and Agent Runtime JSON Shape Constraints

This round tightens the remaining durable JSON object-shape boundary for Repair
Execution and standalone Agent Runtime. The model paths already write
object-shaped request/runtime/audit payloads and hydrate historical malformed
rows defensively, but direct/manual writes could still persist arrays or
scalars into `runtime_result`, `executor_payload`, repair audit `metadata`,
Agent Runtime step `output_summary`, or timeline `payload`. That left new rows
able to depend on readback repair instead of persistence enforcing the shape.

A new migration adds `ai_repair_execution_requests_json_shape_check`,
`ai_repair_execution_audit_events_metadata_shape_check`,
`ai_agent_steps_output_summary_shape_check`, and
`ai_agent_timeline_events_payload_shape_check` as `NOT VALID` constraints.
Repair request runtime/executor payloads, repair audit metadata, Agent Runtime
step output summaries, and Agent Runtime timeline payloads must now stay
object-shaped while historical malformed rows remain upgrade-tolerant.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
malformed updates fail at the database boundary for all five columns. The
legacy hydration tests were adjusted to keep object-shaped but semantically
malformed rows, preserving readback-normalization coverage without inserting
fresh rows that the database should reject.

Remaining risk: Repair Execution and Agent Runtime durable rows now constrain
common status vocabularies, worker attempt counters, worker lease pair
evidence, completion timestamp drift, and JSON object shape for current common
payload columns. Real production tool/Codex/MCP/model executors still need
executor-specific payload schemas, side-effect idempotency contracts,
interruption semantics, rollback contracts, and redaction policies before
arbitrary workflows are enabled.

## 661. P2 landing record: Provider Health State Row Constraints

This round tightens the DB-backed Provider Health overlay table. Provider
health rows influence provider routing availability, and model/worker paths
write constrained status/source/scope values with object-shaped metadata. The
database still allowed direct/manual rows with unknown health statuses,
unknown sources, contradictory global/workspace identity, or non-object
metadata, which could confuse provider route overlays and cleanup workers.

A new migration adds `ai_provider_health_states_status_check`,
`ai_provider_health_states_source_check`,
`ai_provider_health_states_scope_type_check`,
`ai_provider_health_states_scope_workspace_check`, and
`ai_provider_health_states_metadata_shape_check` as `NOT VALID` constraints.
New or updated rows must keep status in `unknown|healthy|degraded|down`,
source in `manual_override|probe_result`, coherent scope/workspace pairing,
and object-shaped metadata while preserving upgrade tolerance for historical
rows.

Focused backend coverage in the Provider Registry revision e2e suite now
verifies malformed direct updates fail at the database boundary against a real
workspace provider-health row before those overlays can affect route
diagnostics.

Remaining risk: provider-health overlays now constrain routing-facing scalar
state and metadata shape, but production external health probes still need
provider-specific probe executors, retry/dead-letter behavior, signature or
source attestation where applicable, and operator review/override workflows.

## 662. P2 landing record: Support Bundle Artifact Metadata Constraints

This round tightens support-bundle artifact persistence. Bundle creation writes
manifest and archive storage metadata as coherent groups, and download,
retention cleanup, manifest rewrite retry, and transfer validation all reason
over those groups. The database still allowed partial artifact rows, such as a
missing manifest storage key with retained byte-size metadata or an archive
with a zero byte size, which could make artifact delivery and cleanup
diagnostics depend on ad hoc null checks.

A new migration adds
`ai_support_bundle_requests_manifest_artifact_metadata_check` and
`ai_support_bundle_requests_archive_artifact_metadata_check` as `NOT VALID`
constraints. Manifest artifact metadata must be either fully absent for
legacy DB-only fallback rows or fully present with storage key, positive byte
size, MIME type, and filename. Archive artifact metadata must be either fully
absent or fully present with storage key, positive byte size, fingerprint, MIME
type, and filename.

`CopilotSupportBundleModel.cleanupDueBundles()` now preserves coherent legacy
manifest rows by leaving `manifest_byte_size` null when no
`manifest_storage_key` exists. The legacy manifest hydration test was adjusted
to clear all manifest storage metadata together, and focused DB-boundary
coverage now verifies partial manifest metadata and non-positive archive byte
size updates are rejected.

Remaining risk: support-bundle artifact rows now constrain JSON shape,
download delivery shape, downloaded timestamp shape, and persisted artifact
metadata coherence, but deployment-specific object-storage notification
workers still need real provider signature verification, retry/dead-letter
handling, and environment-specific webhook wiring before direct transfer
evidence is production-complete.

## 663. P2 landing record: Support Bundle Status Retention Coherence Constraint

This round tightens support-bundle request lifecycle coherence. Request
`status` and `retention_status` were individually enum-constrained, and the
model writes `ready/active` for downloadable bundles and `expired/expired`
when retention cleanup runs. The database still allowed direct/manual drift
such as `ready/expired` or `expired/active`, which could confuse download
authorization, retention cleanup scans, and Admin lifecycle diagnostics.

A new migration adds
`ai_support_bundle_requests_status_retention_check` as a `NOT VALID`
constraint. Non-expired request statuses (`pending`, `ready`, and `failed`)
must keep `retention_status='active'`; expired request rows must keep
`retention_status` in `expired|deleted`. This preserves upgrade tolerance for
historical contradictory rows while rejecting new malformed lifecycle pairs.

Focused backend coverage in `support-bundle.e2e.ts` now verifies both
contradictory direct updates fail at the database boundary against a real ready
bundle before authorization or cleanup paths can observe lifecycle drift.

Remaining risk: support-bundle request rows now constrain JSON shape, artifact
metadata coherence, status/retention coherence, download delivery shape,
downloaded timestamp shape, stale transition guards, and replay evidence. Real
deployment object-storage notification workers still need provider signature
verification, retry/dead-letter handling, and environment-specific webhook
wiring.

## 664. P2 landing record: Support Bundle Manifest Download Artifact Fingerprint Constraint

This round tightens download authorization artifact evidence. Manifest
download authorizations use the bundle manifest itself as the downloadable
artifact, and API-proxy, direct acknowledgement, and transfer-event validation
already expect `artifact_fingerprint` to match `manifest_fingerprint` for
`manifest_json` rows. The database still allowed direct/manual rows where a
manifest authorization pointed at a different artifact fingerprint.

A new migration adds
`ai_support_bundle_download_authorizations_manifest_artifact_fingerprint_check`
as a `NOT VALID` constraint. `manifest_json` authorization rows must keep
`artifact_fingerprint = manifest_fingerprint`, while archive authorizations
retain their separate archive fingerprint semantics.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct
manifest authorization fingerprint drift is rejected at the database boundary
before API-proxy or direct-delivery consumers can reason over contradictory
artifact evidence.

Remaining risk: support-bundle download authorization rows now constrain
delivery shape, downloaded timestamp shape, and manifest artifact fingerprint
coherence, while broader object-storage notification signature verification,
retry/dead-letter handling, and environment-specific webhook wiring remain
separate deployment work.

## 665. P2 landing record: Repair Execution Approval Status Coherence Constraint

This round tightens the relationship between Repair Execution request status
and approval state. The model already creates approval-required requests as
`waiting_approval/waiting`, creates non-approval requests as
`queued/not_required`, transitions approved requests to `queued/approved`, and
keeps scheduler and worker selection limited to executable approval states.
The database still allowed direct/manual drift such as
`waiting_approval/approved` or `queued/waiting`, which could mislead approval
controls, queued-worker scans, and execution diagnostics.

A new migration adds `ai_repair_execution_requests_approval_status_check` as a
`NOT VALID` constraint. `waiting_approval` rows must keep
`approval_state=waiting`, executable statuses (`queued`, `running`,
`completed`, and `failed`) must keep `approval_state` in
`approved|not_required`, and `cancelled` rows intentionally preserve existing
manual-cancel behavior by allowing the previous approval state or the
approval-rejection state.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
approval-state drift is rejected for both waiting-approval rows and executable
queued rows before scheduler or worker paths can observe contradictory
execution eligibility.

Remaining risk: Repair Execution request rows now constrain permission status,
approval/status coherence, worker attempts, worker lease pair evidence,
completion timestamp drift, JSON object shape, and common string bounds. Future
non-registry executors still need executor-specific payload schemas,
side-effect idempotency contracts, live running interruption semantics,
rollback contracts, and redaction policies before arbitrary workflows are
enabled.

## 666. P2 landing record: Execution Queued Timestamp Status Constraints

This round tightens scheduler-facing queue timestamp evidence shared by Repair
Execution and standalone Agent Runtime. Both systems order queued work by
`queued_at`, and model transitions already set queue timestamps when a request
or run enters `queued`. The database still allowed direct/manual rows such as
`queued` with `queued_at=NULL`, which would make worker scans and scheduled
enqueue recovery depend on fallback ordering, or `waiting_approval` with
queue evidence, which could make approval-gated work look scheduler-ready in
diagnostics.

A new migration adds `ai_repair_execution_requests_queued_at_status_check` and
`ai_agent_runs_queued_at_status_check` as `NOT VALID` constraints. `queued`
rows must carry `queued_at`, `waiting_approval` rows must keep `queued_at`
null, and running/terminal rows remain allowed to retain historical queue
timestamps for observability and retry diagnostics.

Focused backend coverage in `repair-execution.e2e.ts` now verifies Repair
Execution waiting-approval rows cannot gain queue evidence, Repair Execution
queued rows cannot lose queue evidence, Agent Runtime queued rows cannot lose
queue evidence, and Agent Runtime rows cannot switch to `waiting_approval`
while retaining queue evidence.

Remaining risk: Repair Execution and standalone Agent Runtime scheduler-facing
rows now constrain worker attempts, worker lease pair evidence, terminal
completion timestamps, JSON object shape, and queued timestamp shape. Production
tool, Codex, MCP, handoff, approval, model, and planner adapters still need
executor-specific payload/result schemas, redaction, retry/dead-letter,
interruption semantics, and rollback contracts before arbitrary workflows are
enabled.

## 667. P2 landing record: Support Bundle Authorization Fingerprint Shape Constraint

This round tightens support-bundle download authorization identity evidence.
The model writes deterministic 16-character lowercase hex fingerprints for
manifest, artifact, and authorization evidence, and a 64-character SHA-256
token fingerprint for bearer-token lookup. The database still allowed
direct/manual rows with malformed fingerprint strings, which could undermine
download lookup, artifact evidence comparison, and audit correlation.

A new migration adds
`ai_support_bundle_download_authorizations_fingerprint_shape_check` as a
`NOT VALID` constraint. Download authorization rows must keep
`manifest_fingerprint`, `artifact_fingerprint`, and
`authorization_fingerprint` as lowercase 16-character hex strings, and must
keep `token_fingerprint` as a lowercase 64-character hex string.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct token
fingerprint and authorization fingerprint drift are rejected at the database
boundary before artifact delivery or audit consumers can observe malformed
identity evidence.

Remaining risk: support-bundle download authorization rows now constrain
delivery shape, downloaded timestamp shape, manifest artifact fingerprint
coherence, and fingerprint/token shape. Deployment-specific object-storage
notification workers still need provider signature verification,
retry/dead-letter handling, and environment-specific webhook wiring before
direct transfer evidence is production-complete.

## 668. P2 landing record: DB-backed Registry Revision String Shape Constraints

This round tightens the remaining scalar revision boundary shared by Prompt
Registry, Task Route Policy, Model Registry, and Provider Registry revisions.
The writer models already sanitize optional caller-provided revision strings
to non-empty values using only `a-z`, `A-Z`, `0-9`, `.`, `_`, `:`, and `-`,
cap them at 512 characters, and otherwise generate deterministic direct-publish
or `repair-<executionRequestId>` revisions. The database still allowed
direct/manual rows with blank, space-containing, or otherwise malformed
revision strings, which could confuse unique-key semantics, idempotency
reasoning, and revision display surfaces.

A new migration adds `ai_prompt_registry_revisions_revision_shape_check`,
`ai_task_route_policy_revisions_revision_shape_check`,
`ai_model_registry_revisions_revision_shape_check`, and
`ai_provider_registry_revisions_revision_shape_check` as `NOT VALID`
constraints. New or updated revision rows must keep `revision` non-empty,
within 512 characters, and within the current model-supported character set,
while preserving upgrade tolerance for historical rows.

Focused backend coverage extends the existing DB-boundary row constraint tests
for all four registry families. Each suite now verifies a direct insert with a
malformed revision string is rejected by its family-specific revision-shape
constraint before the row can enter registry read paths.

Remaining risk: DB-backed registry rows now constrain scalar status/scope,
scope/workspace consistency, revision string shape, source-chain and metadata
JSON shape, and Model/Provider payload JSON shape. Full Admin editor
workflows, bulk migration from config/provider defaults, provider credential
workflows, richer review/diff surfaces, and executor-specific rollback
contracts remain separate registry product/runtime work.

## 669. P2 landing record: Execution Failure Field Pair Constraints

This round tightens failure diagnostic evidence shared by Repair Execution and
standalone Agent Runtime. Runtime writers already normalize failure code and
message together when workers fail, clear both fields when a row returns to
queued/running/successful control paths, and copy the pair from Repair
Execution into linked AgentRun rows. The database still allowed direct/manual
rows with only a code or only a message, which could mislead diagnostics,
support-bundle evidence, and stale recovery triage.

A new migration adds `ai_repair_execution_requests_failure_pair_check` and
`ai_agent_runs_failure_pair_check` as `NOT VALID` constraints. New or updated
execution rows must keep `failure_code` and `failure_message` absent together
or present together, while preserving upgrade tolerance for historical rows.
This deliberately does not require every `failed` row to have failure fields,
because generic Agent Runtime creation can still persist a terminal status
without executor-originated failure diagnostics.

Focused backend coverage in `repair-execution.e2e.ts` now verifies real failed
repair execution rows reject orphan code/message drift, and Agent Runtime rows
reject direct orphan failure fields at the database boundary before worker
recovery or diagnostic consumers can observe them.

Remaining risk: Repair Execution and standalone Agent Runtime rows now
constrain worker attempts, worker lease pair evidence, terminal completion
timestamps, JSON object shape, queued timestamp shape, and failure field
pairing. Production tool, Codex, MCP, handoff, approval, model, and planner
adapters still need executor-specific payload/result schemas, redaction,
retry/dead-letter, interruption semantics, and rollback contracts before
arbitrary workflows are enabled.

## 670. P2 landing record: Support Bundle Request Failure Field Pair Constraint

This round tightens request-level support-bundle failure diagnostics. The table
already exposes nullable `failure_code` and `failure_message` for durable
request failures, while current retention and object-storage cleanup failures
mostly persist detailed error evidence in audit metadata. The database still
allowed direct/manual rows with only a code or only a message, which could
mislead Admin, support bundle read paths, or future request-level failure
writers.

A new migration adds `ai_support_bundle_requests_failure_pair_check` as a
`NOT VALID` constraint. New or updated support bundle request rows must keep
`failure_code` and `failure_message` absent together or present together, while
preserving upgrade tolerance for historical rows. This deliberately does not
require every `failed` request row to carry request-level failure fields,
because existing cleanup and storage failure evidence remains audit-scoped.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct writes
cannot persist an orphan support-bundle failure code or orphan failure message
before read/list/Admin consumers can observe contradictory diagnostics.

Remaining risk: persisted support-bundle rows now constrain
manifest/source-evidence/audit JSON shape, manifest/archive artifact metadata,
request status/retention coherence, download delivery and downloaded timestamp
shape, manifest artifact fingerprint coherence, authorization fingerprint
shape, and request failure field pairing. Deployment-specific object-storage
notification workers still need provider signature verification,
retry/dead-letter handling, and environment-specific webhook wiring before
direct transfer evidence is production-complete.

## 671. P2 landing record: DB-backed Registry Identity String Shape Constraints

This round tightens scalar registry identity fields without changing the
existing fingerprint semantics. The writer models already trim and bound
required registry identity strings before persistence: Prompt Registry prompt
names, Model Registry provider/model ids, Provider Registry provider ids, and
non-null Task Route Policy model ids. The database still allowed direct/manual
rows with blank identity strings, which could confuse registry lookup keys,
fallback ordering, source-chain diagnostics, and idempotency reasoning.

A new migration adds `ai_prompt_registry_revisions_prompt_name_shape_check`,
`ai_task_route_policy_revisions_model_id_shape_check`,
`ai_model_registry_revisions_identity_shape_check`, and
`ai_provider_registry_revisions_provider_id_shape_check` as `NOT VALID`
constraints. New or updated rows must keep required identity strings non-blank
and within the current model-layer bounds, while Task Route Policy keeps
`model_id=NULL` valid for legacy/fallback rows. This deliberately does not
require registry fingerprints to be hex-shaped because existing config, seed,
and direct-publish evidence uses readable deterministic identifiers.

Focused backend coverage extends the existing DB-boundary row constraint tests
for all four registry families. Each suite now verifies a direct insert with a
blank required identity string is rejected by its family-specific identity
constraint before the row can enter registry read paths.

Remaining risk: DB-backed registry rows now constrain scalar status/scope,
scope/workspace consistency, revision string shape, required identity string
shape, source-chain and metadata JSON shape, and Model/Provider payload JSON
shape. Full Admin editor workflows, bulk migration from config/provider
defaults, provider credential workflows, richer review/diff surfaces, and
executor-specific rollback contracts remain separate registry product/runtime
work.

## 672. P2 landing record: Agent Runtime Run Identity String Shape Constraint

This round tightens Agent Runtime run identity evidence. `createRun()` already
trims and bounds `workflow`, `sourceType`, and `sourceId`, and the
`workspace_id/source_type/source_id` unique key uses those source fields for
idempotent run reuse. The database still allowed direct/manual rows where one
of those identity strings was blank, which could confuse list/detail views,
worker recovery, and source-link idempotency.

A new migration adds `ai_agent_runs_identity_shape_check` as a `NOT VALID`
constraint. New or updated AgentRun rows must keep `workflow`, `source_type`,
and `source_id` as non-blank strings within the current 512-character model
boundary, while preserving upgrade tolerance for historical rows.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot blank AgentRun workflow or source id fields before diagnostics,
worker recovery, or idempotent source lookups can observe malformed source
identity evidence.

Remaining risk: standalone Agent Runtime rows now constrain status/timeline
vocabulary, worker attempts, worker lease pair evidence, terminal completion
timestamps, queued timestamp shape, failure field pairing, run identity string
shape, and JSON object shape for current common payload columns. Production
tool, Codex, MCP, handoff, approval, model, and planner adapters still need
executor-specific payload/result schemas, redaction, retry/dead-letter,
interruption semantics, and rollback contracts before arbitrary workflows are
enabled.

## 673. P2 landing record: Agent Runtime Step Identity String Shape Constraint

This round tightens Agent Runtime step identity evidence. `createRun()` already
trims and bounds every `stepKey`, and the `run_id/step_key` unique key uses that
field for run-local step idempotency. The database still allowed direct/manual
rows where the step key was blank, which could confuse step/timeline joins,
manual controls, worker recovery, and run-local step lookup.

A new migration adds `ai_agent_steps_step_key_shape_check` as a `NOT VALID`
constraint. New or updated AgentStep rows must keep `step_key` as a non-blank
string within the current 512-character model boundary, while preserving
upgrade tolerance for historical rows.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot blank an AgentStep key before timeline, control, worker
recovery, or idempotent step lookups can observe malformed step identity
evidence.

Remaining risk: standalone Agent Runtime rows now constrain status/timeline
vocabulary, worker attempts, worker lease pair evidence, terminal completion
timestamps, queued timestamp shape, failure field pairing, run identity string
shape, step identity string shape, and JSON object shape for current common
payload columns. Production tool, Codex, MCP, handoff, approval, model, and
planner adapters still need executor-specific payload/result schemas,
redaction, retry/dead-letter, interruption semantics, and rollback contracts
before arbitrary workflows are enabled.

## 674. P2 landing record: Agent Runtime Ordering Shape Constraints

This round tightens Agent Runtime ordering evidence. The model already bounds
created step `order` values to `0..10000`, generates timeline `ordinal` values
from zero upward, and reads steps/timeline rows sorted by those fields. The
database still allowed direct/manual rows with negative step order or negative
timeline ordinal values, which could make detail views, timeline fingerprints,
and worker recovery reason over malformed ordering evidence.

A new migration adds `ai_agent_steps_order_shape_check` and
`ai_agent_timeline_events_ordinal_shape_check` as `NOT VALID` constraints. New
or updated AgentStep rows must keep `order` in the current model-supported
range, and new or updated AgentTimeline rows must keep `ordinal` non-negative,
while preserving upgrade tolerance for historical rows.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot write negative step order or timeline ordinal values before
list/detail sorting, timeline fingerprints, worker recovery, or control paths
can observe malformed ordering evidence.

Remaining risk: standalone Agent Runtime rows now constrain status/timeline
vocabulary, worker attempts, worker lease pair evidence, terminal completion
timestamps, queued timestamp shape, failure field pairing, run identity string
shape, step identity string shape, step/timeline ordering shape, and JSON
object shape for current common payload columns. Production tool, Codex, MCP,
handoff, approval, model, and planner adapters still need executor-specific
payload/result schemas, redaction, retry/dead-letter, interruption semantics,
and rollback contracts before arbitrary workflows are enabled.

## 675. P2 landing record: Repair Execution Request Identity String Shape Constraint

This round tightens Repair Execution request identity evidence. The model
already trims and bounds prompt names, requested actions, idempotency keys, and
durable request fingerprint fields before persistence. The database still
allowed direct/manual rows with blank identity or fingerprint strings, which
could confuse idempotency reuse, execution diagnostics, queued worker scans,
and audit correlation.

A new migration adds `ai_repair_execution_requests_identity_shape_check` as a
`NOT VALID` constraint. New or updated request rows must keep
`prompt_name`, `requested_action`, `idempotency_key`, and durable fingerprint
columns non-blank and within the current model-layer bounds, while preserving
upgrade tolerance for historical rows. This deliberately does not require
fingerprints to be hex-shaped because existing deterministic repair evidence
can use readable fingerprint identifiers in some paths.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot blank request identity or request fingerprint fields before
idempotency, diagnostics, queued-worker, or audit consumers can observe
malformed request evidence.

Remaining risk: Repair Execution request rows now constrain permission status,
approval/status coherence, worker attempts, worker lease pair evidence,
completion and queue timestamps, JSON object shape, failure field pairing, and
common request identity string shape. Future non-registry executors still need
executor-specific payload schemas, side-effect idempotency contracts, live
running interruption semantics, rollback contracts, and redaction policies
before arbitrary workflows are enabled.

## 676. P2 landing record: Support Bundle Request Fingerprint String Shape Constraint

This round tightens Support Bundle request fingerprint evidence. Bundle
creation writes deterministic source-evidence, manifest, and archive
fingerprint strings, and read, authorization, retention, and artifact delivery
paths assume those values are present when their corresponding artifact state is
present. The database still allowed direct/manual rows with blank
source-evidence or manifest fingerprints, or a present-but-blank archive
fingerprint, which could confuse bundle diagnostics and artifact validation.

A new migration adds `ai_support_bundle_requests_fingerprint_shape_check` as a
`NOT VALID` constraint. New or updated bundle rows must keep
`source_evidence_set_fingerprint` and `manifest_fingerprint` non-blank and
bounded, and must keep optional `archive_fingerprint` either null or non-blank
and bounded. This preserves upgrade tolerance for historical rows and
deliberately does not duplicate the stricter download authorization
token/fingerprint hex constraint on request-level historical evidence.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct updates
cannot blank source-evidence or manifest fingerprint fields before bundle read,
download authorization, retention cleanup, or artifact delivery paths can
observe malformed request evidence.

Remaining risk: persisted support-bundle rows now constrain
manifest/source-evidence/audit JSON shape, manifest/archive artifact metadata,
request status/retention coherence, download delivery and downloaded timestamp
shape, manifest artifact fingerprint coherence, authorization fingerprint
shape, request failure field pairing, and request fingerprint string shape.
Deployment-specific object-storage notification workers still need real
provider signature verification, retry/dead-letter handling, and
environment-specific webhook wiring before direct transfer evidence is
production-complete.

## 677. P2 landing record: DB-backed Registry Revision Fingerprint String Shape Constraints

This round tightens DB-backed registry revision fingerprint evidence without
changing existing readable fingerprint semantics. Prompt Registry, Task Route
Policy, Model Registry, and Provider Registry writer paths already generate or
sanitize non-blank bounded revision fingerprints, and idempotent publish paths
compare persisted fingerprints before reusing an existing row. The database
still allowed direct/manual rows with blank fingerprints, which could confuse
registry lookup diagnostics, idempotent side-effect reuse, and conflict
detection.

A new migration adds family-specific `fingerprint_shape_check` constraints for
all four registry revision tables as `NOT VALID`. New or updated rows must keep
`fingerprint` non-blank and within the current 512-character model-layer
boundary, while preserving upgrade tolerance for historical rows. This
deliberately does not require hex-only fingerprints because existing config,
seed, and direct-publish evidence uses readable deterministic identifiers as
well as hash-like values.

Focused backend coverage extends the existing DB-boundary row constraint tests
for all four registry families. Each suite now verifies a direct insert with a
blank fingerprint is rejected by its family-specific fingerprint-shape
constraint before the row can enter registry read or idempotent publish paths.

Remaining risk: DB-backed registry rows now constrain scalar status/scope,
scope/workspace consistency, revision string shape, required identity string
shape, revision fingerprint string shape, source-chain and metadata JSON shape,
and Model/Provider payload JSON shape. Full Admin editor workflows, bulk
migration from config/provider defaults, provider credential workflows, richer
review/diff surfaces, and executor-specific rollback contracts remain separate
registry product/runtime work.

## 678. P2 landing record: Agent Runtime Fingerprint String Shape Constraints

This round tightens Agent Runtime persisted fingerprint evidence. Run
target/evidence/timeline fingerprints, step evidence fingerprints, and timeline
event fingerprints are all generated by the Agent Runtime model and are used by
detail views, timeline integrity checks, diagnostics, and worker recovery. The
database still allowed direct/manual rows where those fingerprint strings were
blank, which could make persisted runtime evidence look present while carrying
no usable integrity identity.

A new migration adds `ai_agent_runs_fingerprint_shape_check`,
`ai_agent_steps_fingerprint_shape_check`, and
`ai_agent_timeline_events_fingerprint_shape_check` as `NOT VALID` constraints.
New or updated runtime rows must keep those fingerprint columns non-blank and
within the current model-layer bound, while preserving upgrade tolerance for
historical rows. This does not require a hex-only format so future runtime
fingerprint implementations can change representation without another row
shape migration.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot blank run, step, or timeline fingerprint evidence before
timeline integrity, diagnostics, detail reads, or worker recovery can observe
malformed runtime rows.

Remaining risk: standalone Agent Runtime rows now constrain status/timeline
vocabulary, worker attempts, worker lease pair evidence, terminal completion
timestamps, queued timestamp shape, failure field pairing, run identity string
shape, step identity string shape, step/timeline ordering shape, persisted
fingerprint string shape, and JSON object shape for current common payload
columns. Production tool, Codex, MCP, handoff, approval, model, and planner
adapters still need executor-specific payload/result schemas, redaction,
retry/dead-letter, interruption semantics, and rollback contracts before
arbitrary workflows are enabled.

## 679. P2 landing record: Audit Event Fingerprint String Shape Constraints

This round tightens persisted audit event correlation evidence shared by
Support Bundle and Repair Execution. Both models compute an `event_fingerprint`
for every audit event from the event type, actor/workspace/request identity, and
bounded metadata, and read/diagnostic paths use audit rows as durable evidence
for lifecycle transitions, cleanup retries, transfer acknowledgements, and
worker execution. The database still allowed direct/manual audit rows with a
blank `event_fingerprint`, which could make audit evidence look present while
carrying no usable correlation identity.

A new migration adds
`ai_support_bundle_audit_events_fingerprint_shape_check` and
`ai_repair_execution_audit_events_fingerprint_shape_check` as `NOT VALID`
constraints. New or updated audit rows must keep `event_fingerprint` non-blank
and within the current common fingerprint boundary, while preserving upgrade
tolerance for historical rows. This deliberately does not require hex-only
fingerprints; audit consumers only need non-empty bounded correlation evidence
at the database boundary.

Focused backend coverage now verifies direct updates cannot blank support
bundle or repair execution audit event fingerprints before audit read,
diagnostics, idempotency, worker recovery, cleanup retry, transfer diagnostics,
or Admin consumers can observe malformed audit rows.

Remaining risk: persisted support-bundle and repair-execution audit rows now
constrain metadata JSON object shape and audit event fingerprint string shape.
Future non-registry executors, provider-specific transfer workers, and
deployment-specific notification/probe integrations still need their own
payload schemas, redaction, retry/dead-letter, signature verification, and
operator review flows before arbitrary workflows are enabled.

## 680. P2 landing record: Provider Health Identity/Fingerprint String Shape Constraints

This round tightens DB-backed Provider Health overlay identity evidence.
Provider health rows can change effective provider route availability, and the
model writes non-empty provider ids, optional provider types, and deterministic
fingerprints before those rows are overlaid onto configured provider profiles.
The database still allowed direct/manual rows with blank provider ids, blank
present provider types, or blank fingerprints, which could make routing-facing
overlay rows look present while carrying no usable provider or correlation
identity.

A new migration adds
`ai_provider_health_states_identity_shape_check` and
`ai_provider_health_states_fingerprint_shape_check` as `NOT VALID`
constraints. New or updated rows must keep `provider_id` non-blank and
bounded, optional `provider_type` either null or non-blank and bounded, and
`fingerprint` non-blank and bounded. This deliberately does not freeze
provider types to the current enum or require hex-only fingerprints, preserving
future provider extensibility and the existing readable-fingerprint policy.

Focused backend coverage in the Provider Registry revision e2e suite now
verifies direct updates cannot blank provider health provider ids, present
provider types, or fingerprints before overlay routing, freshness cleanup, or
diagnostic consumers can observe malformed health state rows.

Remaining risk: Provider Health rows now constrain routing-facing scalar
state, scope/workspace coherence, metadata JSON shape, and common
identity/fingerprint evidence. Production external health probes still need
provider-specific probe executors, retry/dead-letter behavior, signature or
source attestation where applicable, operator review/override workflows, and
probe history before health automation is product-complete.

## 681. P2 landing record: Support Bundle Artifact String Shape Constraints

This round tightens persisted Support Bundle artifact delivery evidence.
Request rows already enforce that manifest/archive artifact metadata groups are
complete or absent, and download authorization rows already enforce delivery
method coherence. The database still allowed present storage keys, MIME values,
filenames, authorization artifact names, authorization MIME values, or direct
download URLs to be blank strings, which could make artifact delivery,
retention cleanup, direct acknowledgement, and transfer verification consume
malformed but non-null evidence.

A new migration adds
`ai_support_bundle_requests_artifact_string_shape_check` and
`ai_support_bundle_download_authorizations_artifact_string_shape_check` as
`NOT VALID` constraints. Present request artifact storage keys, MIME values,
and filenames must be non-blank and bounded by the existing model-layer string
limits. Download authorization artifact filename/MIME values must be non-blank
and bounded, and any present direct download URL must be non-blank while the
existing delivery-shape constraint continues to decide when it may be null.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct
updates cannot blank stored manifest/archive artifact strings, authorization
artifact strings, or direct signed URLs before artifact delivery, retention
cleanup, direct acknowledgement, or transfer verification can observe malformed
rows.

Remaining risk: persisted support-bundle rows now constrain
manifest/source-evidence/audit JSON shape, manifest/archive artifact metadata
coherence, artifact string shape, request status/retention coherence, download
delivery and downloaded timestamp shape, manifest artifact fingerprint
coherence, authorization fingerprint shape, request failure field pairing,
request/audit fingerprint string shape, and transfer replay evidence.
Deployment-specific object-storage notification workers still need real
provider signature verification, retry/dead-letter handling, and
environment-specific webhook wiring before direct transfer evidence is
production-complete.

## 682. P2 landing record: Agent Runtime Display String Shape Constraints

This round tightens persisted Agent Runtime display and timeline evidence.
Generic run creation already normalizes optional run and step titles, and every
timeline event written by the runtime carries a short summary that is included
in timeline fingerprints and displayed in run detail/Admin diagnostics. The
database still allowed direct/manual rows with blank titles or blank timeline
summaries, which could make detail views and timeline fingerprints reason over
malformed display evidence.

A new migration adds `ai_agent_runs_title_shape_check`,
`ai_agent_steps_title_shape_check`, and
`ai_agent_timeline_events_summary_shape_check` as `NOT VALID` constraints.
Optional run/step titles may remain null, but present title values must be
non-blank and bounded. Timeline event summaries must be non-blank and bounded,
preserving upgrade tolerance for historical malformed rows while rejecting new
blank display evidence.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot blank AgentRun titles, AgentStep titles, or AgentTimeline
summaries before run detail, Admin diagnostics, timeline fingerprints, or
worker recovery paths can observe malformed runtime rows.

Remaining risk: standalone Agent Runtime rows now constrain status/timeline
vocabulary, worker attempts, worker lease pair evidence, terminal completion
timestamps, queued timestamp shape, failure field pairing, run/step identity,
step/timeline ordering, persisted fingerprints, display strings, and common
JSON object payload shape. Production tool, Codex, MCP, handoff, approval,
model, and planner adapters still need executor-specific payload/result
schemas, redaction, retry/dead-letter, interruption semantics, rollback
contracts, and domain-specific user-facing summary contracts before arbitrary
workflows are enabled.

## 683. P2 landing record: Execution Failure String Shape Constraints

This round tightens failure diagnostic evidence shared by Repair Execution and
standalone Agent Runtime. Previous constraints already required
`failure_code` and `failure_message` to be present or absent together, and the
model writers normalize worker failure codes/messages before persistence. The
database still allowed direct/manual rows where both fields were present but
blank, which could bypass worker normalization and pollute diagnostics,
manual retry decisions, and worker recovery evidence.

A new migration adds
`ai_repair_execution_requests_failure_string_shape_check` and
`ai_agent_runs_failure_string_shape_check` as `NOT VALID` constraints. Failure
diagnostics may still be absent together; when present, code and message must
be non-blank and bounded by their existing model-layer limits. This deliberately
does not require every `failed` row to carry failure diagnostics, preserving
the generic Agent Runtime semantics that allow failed rows without
request-level failure fields.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot blank Repair Execution or Agent Runtime failure codes after
worker failure persistence has written normalized diagnostic evidence.

Remaining risk: Repair Execution and Agent Runtime rows now constrain failure
field pairing and present failure diagnostic string shape, but future
non-registry repair executors and production Agent Runtime adapters still need
executor-specific payload/result schemas, redaction, retry/dead-letter
contracts, interruption semantics, rollback contracts, and idempotent
side-effect contracts before arbitrary workflows are enabled.

## 684. P2 landing record: Task Route Policy Config String Shape Constraint

This round tightens DB-backed Task Route Policy config provenance evidence.
Task route revision writers normalize optional `configKey` and `configPath`
values before persistence, and repair/direct publish fingerprints include
those values when config fallback evidence participates. The database still
allowed direct/manual rows with present but blank config keys or paths, which
could make route diagnostics and source-chain displays report malformed
config provenance.

A new migration adds
`ai_task_route_policy_revisions_config_string_shape_check` as a `NOT VALID`
constraint. New or updated Task Route Policy rows may still omit config
metadata, but present `config_key` and `config_path` values must be non-blank
and bounded by the existing 512-character model-layer limit. This deliberately
does not freeze config keys to the current supported publish enum; the
model/API path continues to enforce current task route keys while the
database boundary only protects durable string shape.

Focused backend coverage in `task-route-policy-revision.e2e.ts` now verifies
direct inserts cannot blank persisted Task Route Policy config keys or config
paths before task route diagnostics, runtime resolution, or source-chain
consumers can observe malformed config provenance.

Remaining risk: DB-backed registry revisions now constrain common scope/status,
scope/workspace coherence, JSON shape, revision strings, identity strings,
fingerprint strings, and Task Route Policy config metadata shape. Registry
editors, bulk migration, credential workflows, audit/history review surfaces,
and production provider health probe automation still need implementation
before DB-backed registries are product-complete.

## 685. P2 landing record: Provider Registry Provider Type String Shape Constraint

This round tightens DB-backed Provider Registry type provenance evidence.
Provider Registry direct-publish and repair executor paths already validate
supported provider types before persistence, and hydrated provider profiles use
the row-level provider type as trusted fallback when the JSON profile is
malformed. The database still allowed direct/manual revision rows with a
present but blank `provider_type`, which could make registry diagnostics and
provider profile hydration consume malformed provider provenance.

A new migration adds
`ai_provider_registry_revisions_provider_type_shape_check` as a `NOT VALID`
constraint. New or updated Provider Registry rows may still omit
`provider_type` for legacy compatibility, but present provider types must be
non-blank and bounded by the existing 512-character model-layer limit. This
deliberately does not freeze provider types to the current enum; model/API and
repair executor paths continue to enforce supported provider types while the
database boundary only protects durable string shape.

Focused backend coverage in `provider-registry-revision.e2e.ts` now verifies
direct inserts cannot blank persisted Provider Registry provider types before
registry read paths, diagnostics, or provider-profile hydration can observe
malformed provider provenance.

Remaining risk: DB-backed registries now constrain Provider Registry provider
type string shape in addition to common registry row shape, identity, JSON, and
fingerprint invariants. Full Provider Registry editor flows, credential
management, bulk migration from configured providers, automatic probe history,
and operator review/audit surfaces remain outside this durable constraint
slice.

## 686. P2 landing record: Support Bundle Failure String Shape Constraint

This round tightens request-level Support Bundle failure diagnostic evidence.
Support bundle rows already required `failure_code` and `failure_message` to
be present or absent together, and writer paths bound storage failure codes and
messages before persistence. The database still allowed direct/manual rows
where both failure fields were present but blank, which could make cleanup,
retry, read/list, or operator-facing diagnostics consume malformed failure
evidence.

A new migration adds
`ai_support_bundle_requests_failure_string_shape_check` as a `NOT VALID`
constraint. Failure diagnostics may still be absent together; when present,
`failure_code` must be non-blank and no longer than 128 characters, and
`failure_message` must be non-blank and no longer than 512 characters. This
deliberately does not require every `failed` support bundle row to carry
request-level failure fields, preserving the existing audit-scoped cleanup and
storage failure evidence model.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct
updates cannot blank paired Support Bundle failure codes or messages after
request-level failure diagnostics are present.

Remaining risk: persisted support-bundle rows now constrain request failure
field pairing and present failure diagnostic string shape, but
deployment-specific object-storage notification workers still need real
provider signature verification, retry/dead-letter behavior, and
environment-specific webhook wiring before direct transfer evidence is
production-complete.

## 687. P2 landing record: Worker Lease ID String Shape Constraints

This round tightens worker lease identity evidence shared by Repair Execution
and standalone Agent Runtime. Previous constraints already required
`worker_lease_id` and `worker_lease_expires_at` to appear or disappear
together, and worker paths compare the persisted lease id before completing,
failing, cancelling, resuming, or recovering leased work. The database still
allowed direct/manual rows with a present but blank lease id plus a real
expiry, which could poison stale recovery and compare-and-release ownership
checks.

A new migration adds
`ai_repair_execution_requests_worker_lease_id_shape_check` and
`ai_agent_runs_worker_lease_id_shape_check` as `NOT VALID` constraints.
Unleased rows may still keep the lease id null, but present lease ids must be
non-blank and bounded by the existing 512-character durable string boundary.
This does not add new lease timing semantics; it only protects the persisted
ownership token shape once a row claims worker ownership.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot write blank present lease ids for either Repair Execution
requests or standalone Agent Runtime runs before stale recovery, scheduler
eligibility, or worker compare-and-release paths can observe malformed lease
identity.

Remaining risk: Repair Execution and Agent Runtime now constrain worker lease
pairing and present lease id string shape, but live running interruption,
operator-provided resume payloads, production adapter cancellation, and
rollback workflows remain unimplemented.

## 688. P2 landing record: Provider Health Last-error String Shape Constraint

This round tightens DB-backed Provider Health diagnostic evidence. Provider
health overlays can affect effective provider routing, and `lastError` is
surfaced through model diagnostics and provider health overlays when a probe or
manual override records operator-facing context. The writer paths already
trimmed blank values away, but the database still allowed direct/manual rows
with present blank `last_error` values, which could make diagnostics look
present while carrying no usable evidence.

A new migration adds
`ai_provider_health_states_last_error_shape_check` as a `NOT VALID`
constraint. New or updated Provider Health rows may still omit `last_error`,
but present diagnostic strings must be non-blank and bounded to the current
512-character model-layer limit. The Provider Health model now applies the
same bound before persistence. This deliberately does not require `down` or
`degraded` rows to carry an error string; it only protects the shape of present
diagnostics.

Focused backend coverage in `provider-registry-revision.e2e.ts` now verifies
direct updates cannot blank Provider Health `last_error` diagnostics before
overlay routing, freshness cleanup, or Admin/model diagnostics can observe
malformed diagnostic evidence.

Remaining risk: Provider Health rows now constrain status/source/scope,
scope/workspace coherence, metadata JSON, provider identity, provider type,
fingerprint, and present last-error diagnostic shape. Production external
health probes still need provider-specific probe executors,
retry/dead-letter behavior, source attestation, operator review/override
flows, and probe history before health automation is product-complete.

## 689. P2 landing record: Support Bundle Direct Download Expiry Constraint

This round tightens Support Bundle direct object-storage delivery coherence.
Download authorization rows already enforce that API-proxy rows carry no direct
URL evidence and object-storage signed URL rows carry both direct URL and
direct expiry evidence. The model creates direct signed URLs with the same TTL
as the persisted download authorization, and acknowledgement/transfer paths
use the earlier of authorization expiry and direct URL expiry. The database
still allowed direct/manual rows where the signed URL expiry outlived the
authorization, which could make persisted delivery evidence claim a longer
object-storage access window than the authorization permits.

A new migration adds
`ai_support_bundle_download_authorizations_direct_expiry_check` as a
`NOT VALID` constraint. Direct URL expiry may remain null for API-proxy rows,
but when present it must be less than or equal to the authorization
`expires_at`. This deliberately does not change delivery method semantics or
provider-specific signed URL generation; it only preserves the existing
authorization TTL boundary in the database.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct
updates cannot extend direct signed URL expiry beyond the persisted download
authorization TTL before direct acknowledgement, transfer verification, or
retention cleanup paths can observe malformed delivery evidence.

Remaining risk: persisted support-bundle download rows now constrain delivery
method shape, downloaded timestamp shape, artifact/fingerprint strings, and
direct signed URL expiry coherence, but deployment-specific object-storage
notification workers still need real provider signature verification,
retry/dead-letter handling, and environment-specific webhook wiring before
direct transfer evidence is production-complete.

## 690. P2 landing record: Support Bundle Transfer Audit Metadata Constraint

This round tightens persisted Support Bundle provider-transfer audit evidence.
The internal transfer endpoint and model verifier already validate object
storage transfer payloads before writing downloaded audit rows, but direct DB
updates could still degrade a downloaded audit row that claimed
`providerTransferEvent=true` by removing notification auth evidence or
downgrading provider signature evidence after the fact.

A new migration adds
`ai_support_bundle_audit_events_transfer_metadata_shape_check` as a
`NOT VALID` constraint. Provider-transfer downloaded audit rows must retain
`clientAcknowledged=false`, `serverVerified=true`, internal access-token
notification auth evidence, bounded storage/transfer evidence, and a bounded
notification auth evidence fingerprint. When provider signature evidence is
present, its status must remain `verified_by_upstream`. The model transfer
ingestion path now also requires normalized notification auth evidence before
creating provider-transfer audit metadata, so lower-level callers get the same
fail-closed boundary before the database constraint.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct
updates cannot remove notification auth evidence from a provider-transfer
download audit row and cannot downgrade S3/R2 provider signature evidence from
`verified_by_upstream` to `verified`.

Remaining risk: persisted provider-transfer audit rows now have DB-enforced
auth/storage evidence shape, but deployment-specific object-storage
notification workers still need real provider signature verification,
retry/dead-letter handling, and environment-specific webhook wiring before
direct transfer evidence is production-complete.

## 691. P2 landing record: Worker Lease Status Constraints

This round tightens worker lease ownership evidence shared by Repair Execution
and standalone Agent Runtime. Worker acquisition paths only set lease evidence
while moving queued rows to `running`, and every completion, failure, retry,
manual control, or stale-recovery transition clears those fields when the row
leaves `running`. The database still allowed direct/manual rows where a queued,
terminal, or waiting row retained a paired lease id and expiry, which could
confuse scheduler eligibility, stale recovery scans, and compare-and-release
diagnostics.

A new migration adds
`ai_repair_execution_requests_worker_lease_status_check` and
`ai_agent_runs_worker_lease_status_check` as `NOT VALID` constraints.
Non-running rows must keep both worker lease fields null, while `running` rows
may carry worker lease evidence under the existing pair and lease-id
string-shape constraints. This binds ownership evidence to the status state
machine without blocking generic externally controlled Agent Runtime runs that
are `running` without a worker lease.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot attach paired lease evidence to queued Repair Execution requests
or queued standalone Agent Runtime runs before worker scheduling, stale
recovery, or compare-and-release paths can observe contradictory ownership
state.

Remaining risk: Repair Execution and Agent Runtime now constrain worker lease
pairing, lease id string shape, and lease/status coherence, but live running
interruption, production adapter cancellation, operator-provided resume payloads,
rollback workflows, and non-registry executor idempotency contracts remain
unimplemented.

## 692. P2 landing record: Registry Revision Timestamp Coherence Constraints

This round tightens DB-backed registry revision timestamp evidence. Prompt
Registry, Task Route Policy, Model Registry, and Provider Registry publisher
paths write `created_at` and `updated_at` together, and read overlays sort and
display revisions using those timestamps. The database still allowed
direct/manual rows where `updated_at` preceded `created_at`, which could make
revision ordering and Admin/source-chain diagnostics consume impossible row
history.

A new migration adds timestamp coherence constraints to all four registry
revision tables as `NOT VALID`:
`ai_prompt_registry_revisions_timestamp_coherence_check`,
`ai_task_route_policy_revisions_timestamp_coherence_check`,
`ai_model_registry_revisions_timestamp_coherence_check`, and
`ai_provider_registry_revisions_timestamp_coherence_check`. The constraints
only require `updated_at >= created_at`; they deliberately do not add archive,
disable, editor-review, or publish lifecycle semantics.

Focused backend coverage across the four registry revision e2e suites now
verifies direct inserts cannot persist impossible timestamp ordering before
revision read overlays, route diagnostics, or Admin displays observe malformed
revision history.

Remaining risk: DB-backed registries now constrain common row shape, scope,
JSON shape, identity strings, fingerprints, optional provenance strings, and
timestamp ordering, but full registry editor flows, bulk migration,
credential/secret workflows, review/history surfaces, and production Provider
Health probe automation remain outside this durable constraint slice.

## 693. P2 landing record: Support Bundle Object-created Transfer Ingress Guard

This round tightens the Support Bundle object-storage notification ingress
before deployment-specific webhook workers exist. The internal transfer wrapper
was named `s3_object_created`, but the S3/R2 translator accepted any S3-shaped
record or EventBridge-shaped notification as long as object key and byte size
matched persisted artifact evidence. That meant a forwarded delete/restore or
other non-create notification could reach the storage verifier and mark a
direct authorization downloaded.

The controller now requires S3 record notifications to carry an
`ObjectCreated:*` `eventName`, and EventBridge-style S3 notifications to carry
`detail-type='Object Created'`, before translating them into the canonical
transfer verifier payload. Non-create wrapper notifications are rejected with
the existing bad-request transfer payload boundary before any authorization row
or audit metadata changes.

Focused backend coverage in `support-bundle.e2e.ts` now verifies S3
`ObjectRemoved:Delete` record notifications and EventBridge `Object Deleted`
notifications are rejected, while valid S3 record and EventBridge
`Object Created` notifications still complete through the existing storage
verification and audit persistence path.

Remaining risk: this closes provider-event-type ingress drift, but
deployment-specific object-storage notification workers still need real
provider signature verification, retry/dead-letter behavior, and
environment-specific webhook wiring before direct transfer evidence is
production-complete.

## 694. P2 landing record: Provider Health Timestamp Coherence Constraint

This round tightens DB-backed Provider Health freshness evidence. Provider
health rows feed route overlays and stale cleanup using `checked_at`, while the
model writer and cleanup paths persist `updated_at` from the same latest
observation timestamp. The database still allowed direct/manual rows where
`updated_at` preceded `checked_at`, which could make freshness diagnostics and
cleanup ordering consume impossible health state history.

A new migration adds
`ai_provider_health_states_timestamp_coherence_check` as a `NOT VALID`
constraint. New or updated Provider Health rows must keep
`updated_at >= checked_at`. This deliberately does not require degraded/down
rows to carry diagnostics and does not add provider-specific probe semantics;
it only preserves coherent observation/update timestamp evidence.

Focused backend coverage in `provider-registry-revision.e2e.ts` now verifies
direct updates cannot persist impossible Provider Health timestamp ordering
before route overlays, freshness guards, or stale cleanup paths can observe
malformed health evidence.

Remaining risk: Provider Health rows now constrain status/source/scope,
scope/workspace coherence, metadata JSON, provider identity, provider type,
fingerprint, present last-error diagnostic shape, and timestamp coherence.
Production external health probes still need provider-specific probe
executors, retry/dead-letter behavior, source attestation, operator
review/override flows, and probe history before health automation is
product-complete.

## 695. P2 landing record: Agent Runtime Timestamp Coherence Constraints

This round tightens Agent Runtime lifecycle timestamp evidence without adding
new planner or adapter semantics. AgentRun and AgentStep writers create rows
with `created_at` and `updated_at` aligned, update `updated_at` on transitions,
and only set terminal `completed_at` after a run or step has started. The
database still allowed direct/manual writes where `updated_at` preceded
`created_at`, or where terminal completion appeared earlier than the recorded
start, which could make run detail, stale-lease recovery, and timeline
diagnostics consume impossible lifecycle history.

A new migration adds `ai_agent_runs_timestamp_coherence_check` and
`ai_agent_steps_timestamp_coherence_check` as `NOT VALID` constraints. Both
tables must keep `updated_at >= created_at`, and run/step rows with both
`started_at` and `completed_at` present must keep
`completed_at >= started_at`. The checks deliberately avoid adapter-specific
phase contracts, planner semantics, rollback state, or requirements that every
failed generic row carry diagnostics.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
AgentRun and AgentStep updates cannot persist impossible timestamp ordering
before Agent Runtime list/detail, worker recovery, or timeline diagnostics can
observe malformed lifecycle evidence.

Remaining risk: Agent Runtime rows now constrain status vocabulary,
completed/queued timestamp shape, run/step timestamp coherence, worker attempt
counters, worker lease evidence, failure fields, identity strings,
fingerprints, display strings, and JSON object payloads. Production planner and
tool/Codex/MCP/handoff/approval/model adapters still need executor-specific
payload/result schemas, side-effect idempotency, cancellation/interruption,
redaction, and rollback contracts before arbitrary workflows can execute.

## 696. P2 landing record: Repair Execution Timestamp Coherence Constraint

This round tightens Repair Execution request lifecycle timestamp evidence.
Repair execution request writers create rows with `created_at` and `updated_at`
aligned, move `updated_at` on approval, worker, manual-control, and recovery
transitions, and set `last_attempt_at` only from worker lease acquisition after
the request already exists. The database still allowed direct/manual rows where
update or worker-attempt timestamps preceded request creation, which could make
queued listing, stale-lease recovery, and diagnostics consume impossible row
history.

A new migration adds
`ai_repair_execution_requests_timestamp_coherence_check` as a `NOT VALID`
constraint. Request rows must keep `updated_at >= created_at`, and present
`last_attempt_at` must also be at or after `created_at`. The constraint
deliberately avoids executor-specific phase timing, queued/completed timestamp
semantics, rollback fields, or live interruption contracts.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct
updates cannot move request update or worker-attempt timestamps before request
creation before scheduler, stale recovery, or execution diagnostics can observe
malformed lifecycle evidence.

Remaining risk: Repair Execution rows now constrain status/approval/queue
coherence, completion timestamp shape, request timestamp ordering, worker
attempt and lease evidence, failure fields, JSON object payloads, and common
identity/fingerprint strings. Non-registry repair executors, live
interruption/resume payloads, production side-effect idempotency contracts, and
rollback workflows still need implementation before repair execution is
general-purpose.

## 697. P2 landing record: Support Bundle Timestamp Coherence Constraints

This round tightens Support Bundle lifecycle timestamp evidence without
changing retention TTL or direct-download expiry semantics. Bundle requests and
download authorizations are created with aligned `created_at`/`updated_at`,
cleanup and download transitions move `updated_at` forward, and downloaded
authorization telemetry is written only after the authorization exists. The
database still allowed direct/manual rows where update timestamps preceded
creation, or where downloaded telemetry predated authorization creation, which
could make retention cleanup, direct acknowledgement, transfer replay, and
operator diagnostics consume impossible lifecycle history.

A new migration adds `ai_support_bundle_requests_timestamp_coherence_check`
and `ai_support_bundle_download_authorizations_timestamp_coherence_check` as
`NOT VALID` constraints. Request rows must keep `updated_at >= created_at`.
Download authorization rows must keep `updated_at >= created_at`, and present
`downloaded_at` must be at or after `created_at`. The checks deliberately do
not constrain `expires_at` or `direct_download_expires_at` relative to
creation, preserving existing cleanup and signed-URL TTL behavior.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct
updates cannot move bundle or authorization update timestamps before creation,
or make downloaded authorization telemetry predate authorization creation,
before cleanup, transfer, or diagnostics paths observe malformed lifecycle
evidence.

Remaining risk: Support Bundle rows now constrain status/retention,
download-delivery and downloaded timestamp shape, direct signed URL expiry,
request/authorization timestamp ordering, artifact metadata, request failure
fields, fingerprints, JSON object payloads, and provider-transfer audit
metadata. Deployment-specific object-storage notification workers still need
real provider signature verification, retry/dead-letter behavior, and webhook
wiring before direct-transfer evidence is production-complete.

## 698. P2 landing record: DB-backed Registry Source-chain Provenance Constraints

This round tightens DB-backed registry fallback source-chain evidence at the
database boundary. The registry writer models already normalize source-chain
entries by dropping unknown `source`, `scope`, or `status` values before
persistence, but direct/manual rows could still insert shape-valid JSON arrays
with unknown provenance vocabulary. Those rows could then reach registry
overlays, diagnostics, Admin displays, or future audit/history views with
untrusted provenance labels.

A new migration adds a shared immutable
`ai_registry_source_chain_provenance_valid()` helper plus
`ai_prompt_registry_revisions_source_chain_provenance_check`,
`ai_task_route_policy_revisions_source_chain_provenance_check`,
`ai_model_registry_revisions_source_chain_provenance_check`, and
`ai_provider_registry_revisions_source_chain_provenance_check` as `NOT VALID`
constraints. The helper keeps `fallback_source_chain` array-shaped and requires
each entry to carry string `source`, `scope`, and `status` values from the
current registry-family vocabulary. The checks deliberately do not constrain
optional metadata fields, revision fingerprints, editor workflows, or future
registry product semantics beyond the current provenance contract.

Focused backend coverage across the Prompt Registry, Task Route Policy, Model
Registry, and Provider Registry revision e2e suites now verifies direct writes
cannot persist unknown fallback source-chain provenance before row overlays,
idempotency diagnostics, or Admin read paths can observe malformed provenance
evidence.

Remaining risk: DB-backed registry rows now constrain common row shape,
scope/workspace coherence, JSON payload shape, identity/revision/fingerprint
strings, timestamp ordering, and source-chain provenance vocabulary. Full
Prompt Registry prompt-body editing, Task Route Policy editing, Model Registry
review/diff workflows, Provider Registry credential management, automatic
health probe history, and bulk migration remain separate product/runtime work.

## 699. P2 landing record: DB-backed Registry Source-chain Metadata Constraints

This round tightens optional fallback source-chain metadata at the database
boundary. Registry writer models already sanitize optional provenance metadata,
dropping malformed actor/workspace/revision/fingerprint/config/model/provider
fields before persistence. Direct/manual rows could still insert
provenance-valid arrays whose optional fields had invalid types or enum values,
leaving registry overlays and diagnostics to depend on read-time cleanup.

A new migration adds shared immutable helpers for optional source-chain text,
enum, and non-negative integer fields plus
`ai_prompt_registry_revisions_source_chain_metadata_check`,
`ai_task_route_policy_revisions_source_chain_metadata_check`,
`ai_model_registry_revisions_source_chain_metadata_check`, and
`ai_provider_registry_revisions_source_chain_metadata_check` as `NOT VALID`
constraints. Prompt Registry rows now reject malformed optional string
metadata and non-numeric `registryId` values. Task Route Policy rows reject
malformed optional string metadata plus unsupported `configKey` and
`featureKind` values. Model Registry rows reject malformed optional provider
and model provenance strings. Provider Registry rows reject malformed optional
provider provenance strings and unsupported `providerType` values. The checks
stay limited to the current source-chain metadata contract and do not add
editor workflow, credential, migration, or rollback semantics.

Focused backend coverage across the Prompt Registry, Task Route Policy, Model
Registry, and Provider Registry revision e2e suites now verifies direct writes
cannot persist malformed optional source-chain metadata before registry
overlays, idempotency diagnostics, or Admin read paths can observe it.

Remaining risk: DB-backed registry rows now constrain common row shape,
scope/workspace coherence, JSON payload shape, identity/revision/fingerprint
strings, timestamp ordering, source-chain provenance vocabulary, and optional
source-chain metadata shape. Full Prompt Registry prompt-body editing, Task
Route Policy editing, Model Registry review/diff workflows, Provider Registry
credential management, automatic health probe history, and bulk migration
remain separate product/runtime work.

## 700. P2 landing record: Support Bundle Provider Signature Evidence Constraint

This round tightens Support Bundle provider-transfer evidence beyond a status
flag. The internal transfer endpoint already separated canonical
`x-access-token` authentication from upstream provider signature evidence, but
S3/R2 wrapper events and persisted downloaded audit rows could still carry
`verified_by_upstream` without an accountable verifier, policy, or signature
fingerprint.

The S3/R2 wrapper parser now requires provider signature evidence with
`status=verified_by_upstream`, `verifier`, `policy`, and
`signatureFingerprint` before it translates object-created notifications into
the canonical transfer verifier. The model normalization applies the same
required evidence shape for lower-level callers, and provider-origin event
sources such as `aws:s3` and `aws.s3` fail closed when provider signature
evidence is missing.

A new migration adds
`ai_support_bundle_provider_sig_evidence_valid()` plus
`ai_support_bundle_audit_events_provider_sig_evidence_check` as a `NOT VALID`
constraint. Provider-origin downloaded audit rows must either be non-provider
events or retain valid upstream provider evidence with bounded provider,
verifier, optional key id/algorithm, signature fingerprint, and policy fields.

Focused backend coverage in `support-bundle.e2e.ts` now verifies S3/R2 wrapper
requests missing signature fingerprints are rejected before persistence, valid
object-created events still persist verifier/policy/fingerprint evidence, and
direct SQL updates cannot remove the provider evidence object, blank the
verifier, or remove the signature fingerprint from provider-transfer audit
metadata.

Remaining risk: Support Bundle direct-transfer evidence now has controller,
model, and DB-backed verifier/policy/fingerprint shape enforcement for
provider-origin events. Deployment-specific object-storage notification
workers still need real cloud-provider signature verification, webhook
wiring, retry/dead-letter behavior, and operational rollout before
direct-transfer evidence is production-complete.

## 701. P2 landing record: Agent Runtime Source Workflow Coherence Constraint

This round tightens Agent Runtime source-link routing evidence. The standalone
Agent Runtime worker and manual control paths intentionally exclude
`source_type=repair_execution_request`, because repair execution remains the
source of truth for approval, leases, retries, and audit. The database already
bounded `workflow`, `source_type`, and `source_id` strings, but direct/manual
rows could still pair the repair-execution source type with an arbitrary
standalone workflow, or pair the repair execution workflow with a standalone
source type.

The generic `createRun` model path now rejects mismatched repair execution
source/workflow pairs before inserting an AgentRun. The dedicated
repair-execution sync path still creates rows through the known
`prompt_registry_repair_execution` / `repair_execution_request` pair.

A new migration adds
`ai_agent_runs_source_workflow_coherence_check` as a `NOT VALID` constraint.
New or updated AgentRun rows must use
`source_type=repair_execution_request` only with
`workflow=prompt_registry_repair_execution`, and that workflow cannot be used
by standalone source rows.

Focused backend coverage in `repair-execution.e2e.ts` now verifies generic run
creation rejects repair-source drift, and direct SQL updates cannot convert a
standalone row into a repair-execution source row or assign the repair
execution workflow to a standalone row before list/detail, manual control, or
standalone worker routing can observe malformed source-link evidence.

Remaining risk: Agent Runtime source/workflow routing evidence is now
model- and DB-constrained for the current repair-execution-linked and
standalone paths. Real planner/tool/Codex/MCP/model adapters still need
executor-specific schemas, redaction, side-effect idempotency, interruption,
and rollback contracts before arbitrary workflows can execute safely.

## 702. P2 landing record: Repair Execution Runtime Side-effect Result Constraint

This round tightens Repair Execution applied side-effect evidence at the
database boundary. The constrained registry publishers already write runtime
results with `sideEffectsApplied=true`, side-effect kind, record id,
fingerprint, and summary metadata. Direct/manual rows could still claim an
applied side effect while omitting those identity fields or replacing the
summary with a scalar, leaving Agent Runtime, Admin, support bundle, and audit
consumers to distinguish real applied work from malformed completion evidence.

A new migration adds
`ai_repair_runtime_applied_side_effect_valid()` plus
`ai_repair_execution_requests_runtime_side_effect_check` as a `NOT VALID`
constraint. Runtime results that do not claim `sideEffectsApplied=true` remain
valid for safe no-op, approval, worker-running, failure, manual-control, and
hydration-guard states. Runtime results that do claim an applied side effect
must carry non-blank bounded `sideEffectKind`, `sideEffectRecordId`,
`sideEffectFingerprint`, and object-shaped `sideEffectSummary`.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct SQL
updates cannot claim an applied side effect without persisted side-effect
identity or without an object summary before downstream runtime, Admin,
support bundle, or audit paths can observe misleading completion rows.

Remaining risk: Repair Execution applied side-effect evidence now has a common
DB-backed identity/summary shape for current constrained registry publishers.
Rollback behavior, live interruption/resume payloads, non-registry executors,
and executor-specific idempotency contracts remain separate runtime work.

## 703. P2 landing record: Repair Execution Side-effect Rollback Contract Constraint

This round tightens the Repair Execution rollback evidence boundary without
implementing rollback execution. The constrained registry publishers already
stamp side-effect summaries with a forward-only rollback contract, and Agent
Runtime projects that contract when present, but model-level worker completion
and direct `runtime_result` writes could still claim `sideEffectsApplied=true`
while dropping the contract or changing it into rollback-supported evidence.

`CopilotRepairExecutionModel` now validates approved worker side-effect
results before building runtime output or audit rows. Current registry
side-effect kinds must keep a `sideEffectSummary.rollbackContract` object with
`version=repair-execution-side-effect-rollback-contract/v1`,
`supported=false`, `mode=forward_only_followup_revision`, a non-blank reason,
and `recoveryPath=publish_follow_up_registry_revision`.

A new migration adds
`ai_repair_runtime_side_effect_rollback_contract_valid()` plus
`ai_repair_execution_requests_side_effect_rollback_check` as a
`NOT VALID` constraint. Non-applied runtime results remain valid, and malformed
base side-effect rows continue to fail the earlier side-effect identity/summary
constraint. Applied runtime results with valid side-effect identity must also
retain the forward-only rollback contract.

Focused backend coverage in `repair-execution.e2e.ts` now verifies worker
completion rejects side-effect summaries without rollback contracts, direct SQL
updates cannot drop the rollback contract, and direct SQL updates cannot drift
the contract to `supported=true` before Agent Runtime, Admin, support bundle,
or audit consumers observe misleading applied side-effect evidence.

Remaining risk: Repair Execution now has model and DB enforcement that applied
constrained registry side effects carry explicit forward-only recovery
semantics. Actual rollback execution, live interruption/resume payloads,
non-registry executors, and executor-specific idempotency contracts remain
separate runtime work.

## 704. P2 landing record: Provider Health Metadata Contract Constraint

This round tightens DB-backed Provider Health provenance metadata. Provider
health rows already persisted source, status, timestamps, freshness cleanup
evidence, and route overlays, but `metadata` was only constrained to be a JSON
object. Direct/manual rows, or model callers passing extra metadata, could
therefore drop `version` or drift `publishSource`, weakening diagnostics and
the cleanup workers that distinguish manual overrides, workspace probe
results, configured snapshots, and cleanup rewrites.

`CopilotProviderHealthStateModel` now merges caller metadata first and then
sets reserved `version`, `providerProfileSource`, and `publishSource` fields,
so untrusted extras cannot override the writer contract.

A new migration adds
`ai_provider_health_metadata_contract_valid()` plus
`ai_provider_health_states_metadata_contract_check` as a `NOT VALID`
constraint. Provider Health metadata must carry
`version=provider-health-state-metadata/v1`; `manual_override` rows must carry
`publishSource=graphql_mutation`; and `probe_result` rows must carry one of
the current probe or cleanup writer sources:
`workspace_provider_health_probe_result`,
`configured_provider_health_snapshot_worker`,
`configured_provider_health_snapshot_cleanup_worker`, or
`provider_health_probe_result_stale_cleanup_worker`.

Focused backend coverage in `provider-registry-revision.e2e.ts` now verifies
direct SQL updates cannot remove the metadata version or pair manual overrides
with probe publish sources, and verifies model-level writes preserve reserved
metadata fields even when caller extras try to override them.

Remaining risk: Provider Health rows now have model and DB enforcement for the
current manual/probe/cleanup metadata vocabulary used by route overlays and
stale cleanup. External live health probes, probe history, retry/dead-letter
handling, credential management, and full Provider Registry editor workflows
remain separate product/runtime work.

## 705. P2 landing record: Agent Runtime Adapter Resolution Contract Constraint

This round tightens Agent Runtime worker failure diagnostics. Standalone worker
failures already persisted structured `adapterResolution` metadata for missing
adapters, unsupported adapter contracts, adapter exceptions, invalid executor
results, and incomplete adapter execution. The database only required failed
step summaries and timeline payloads to be JSON objects, so direct/manual rows
could preserve object-shaped but semantically malformed adapter-resolution
evidence.

`CopilotAgentRuntimeModel.failStandaloneWorkerExecution()` now validates
supplied adapter-resolution metadata before writing failed run rows, step output
summaries, or timeline payloads. The current contract requires
`version=agent-runtime-worker-adapter-resolution/v1`, a known status, a
non-blank workflow, and a non-empty requested step-type list using the current
Agent Runtime step-type vocabulary.

A new migration adds `ai_agent_runtime_adapter_resolution_valid()` plus
`ai_agent_steps_worker_failure_adapter_resolution_check` and
`ai_agent_timeline_events_adapter_resolution_check` as `NOT VALID`
constraints. The constraints only apply when a failed step summary or timeline
payload includes an `adapterResolution` object, preserving existing unrelated
JSON payloads while rejecting malformed adapter-resolution evidence.

Focused backend coverage in `repair-execution.e2e.ts` now verifies the model
rejects invalid requested step types before failure persistence, direct step
summary writes cannot use unknown adapter-resolution statuses, and direct
timeline payload writes cannot use empty requested step-type lists.

Remaining risk: Agent Runtime adapter-resolution evidence now has model and DB
contract enforcement for the current standalone worker failure vocabulary.
Real tool, Codex, MCP, handoff, approval, model, and planner adapters still
need executor-specific payload/result schemas, redaction, retry/dead-letter
semantics, interruption/resume behavior, and side-effect/rollback contracts.

## 706. P2 landing record: Support Bundle Retention Audit Metadata Constraint

This round tightens Support Bundle retention cleanup evidence. Retention
cleanup, retry, and escalation workers use `retention_expired` audit metadata
to decide whether archive object cleanup or manifest object rewrite should be
retried, recovered, or skipped after escalation. The database already required
audit metadata to be an object, but direct/manual rows could still retain
unknown cleanup statuses or omit the cleanup fingerprint that retry scans use
as prior evidence.

A new migration adds `ai_support_bundle_retention_cleanup_metadata_valid()`
plus `ai_support_bundle_audit_events_retention_metadata_check` as a `NOT VALID`
constraint. `retention_expired` audit rows must retain cleanup actor,
fingerprint, scope, cleaned timestamp, expired authorization count, expired
retention status, and the current archive cleanup / manifest rewrite status
vocabulary. Retry rows that claim archive or manifest retry evidence must also
carry the corresponding failure count field.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct audit
event writes cannot use an unknown archive cleanup status and cannot omit the
cleanup fingerprint from `retention_expired` metadata before scheduled retry or
escalation scans consume the row.

Remaining risk: Support Bundle retention audit rows now have DB-backed cleanup
identity/status shape for the current retry/escalation state machine.
Deployment-specific object-storage notification workers, real cloud-provider
signature verification rollout, retry/dead-letter operations, and external
storage operational monitoring remain separate production work.

## 707. P2 landing record: Support Bundle Download Authorization Audit Metadata Constraint

This round tightens Support Bundle download authorization audit evidence.
`download_authorized` audit rows are consumed as lifecycle evidence for
authorization creation and later expiration cleanup, but the database only
required object-shaped metadata. Direct/manual rows could therefore omit the
authorization audit contract version, drift artifact/delivery evidence, or
claim `authorizationExpired=true` without the cleanup fingerprint that cleanup
and audit consumers rely on.

`CopilotSupportBundleModel` now writes explicit metadata versions for both
authorization creation and authorization expiration audit rows, and validates
the metadata contract before persisting `download_authorized` audit events.
Creation rows use
`copilot-support-bundle-download-authorized-audit/v1`; expiration cleanup rows
use `copilot-support-bundle-download-authorization-expired-audit/v1`.

A new migration adds
`ai_support_bundle_download_authorized_metadata_valid()` plus
`ai_support_bundle_audit_events_download_metadata_check` as a `NOT VALID`
constraint. Creation rows must retain authorization identity, artifact
filename/MIME/fingerprint, delivery method, direct URL expiry shape, manifest
fingerprint, and authorization expiry. Expiration rows must retain
authorization identity, artifact evidence, cleanup actor/scope/fingerprint,
cleaned timestamp, previous `authorized` status, final `expired` status, and
optional known delivery method.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct audit
metadata updates cannot drop the creation audit version and direct expiration
audit inserts cannot omit cleanup fingerprints before lifecycle consumers
observe the row.

Remaining risk: Support Bundle authorization audit rows now have DB-backed
creation/expiration metadata shape for the current model writers. Production
object-storage webhook forwarding, provider signature verification rollout,
retry/dead-letter operations, and external operational monitoring remain
separate deployment work.

## 708. P2 landing record: Registry Revision Metadata Contract Constraint

This round tightens DB-backed registry revision provenance metadata. Prompt
Registry, Task Route Policy, Model Registry, and Provider Registry direct and
repair-driven writers already emit stable metadata versions, but only Provider
Registry repair metadata carried an explicit `publishSource`. The database only
required `metadata` to be a JSON object, so direct/manual rows could claim a
current direct-publish version with repair-worker provenance or vice versa.

Prompt Registry, Task Route Policy, and Model Registry repair publishers now
persist `publishSource=repair_execution_worker`, matching the existing
Provider Registry repair writer. Direct publishers continue to write
`publishSource=graphql_mutation`.

A new migration adds `ai_registry_revision_metadata_contract_valid()` plus
per-table metadata contract constraints for all four registry revision tables.
The constraint is scoped to the current direct-publish and repair-executor
metadata versions, preserving compatibility for older object-shaped
test/legacy metadata while rejecting new or updated current-version rows whose
`version` and `publishSource` disagree.

Focused backend coverage in the Prompt Registry, Task Route Policy, Model
Registry, and Provider Registry e2e suites now verifies model-written direct
publish rows retain `publishSource=graphql_mutation` and direct SQL updates
cannot drift those rows to repair-worker provenance.

Remaining risk: current registry revision metadata versions now have
DB-backed publish-source provenance. Full Prompt/Task/Model/Provider registry
editors, prompt body diff/eval, bulk migration workflows, credential
management, automatic provider probe execution/history, and richer audit
history remain separate product/runtime work.

## 709. P2 landing record: Repair Execution Side-effect Executor Payload Coherence Constraint

This round tightens Repair Execution side-effect provenance beyond the applied
side-effect identity and rollback-contract constraints. Runtime results already
had to retain side-effect kind, record id, fingerprint, object summary
evidence, and the forward-only rollback contract, but a direct/manual row could
still pair a persisted Prompt Registry executor payload with a claimed Model
Registry side effect.

`CopilotRepairExecutionModel.completeWorkerExecution()` now validates approved
side-effect results against the persisted executor payload kind before building
runtime output or audit rows. The current constrained publisher mapping is:
`prompt_registry_revision_publish -> prompt_registry_revision`,
`task_route_policy_revision_publish -> task_route_policy_revision`,
`model_registry_revision_publish -> model_registry_revision`, and
`provider_registry_revision_publish -> provider_registry_revision`.

A new migration adds
`ai_repair_side_effect_matches_executor_payload()` plus
`ai_repair_execution_side_effect_executor_payload_check` as a `NOT VALID`
constraint. The constraint only applies to rows that already look like applied
runtime side-effect results, preserving non-applied runtime states while
rejecting applied side-effect rows whose persisted executor payload kind and
runtime side-effect kind disagree.

Focused backend coverage in `repair-execution.e2e.ts` now verifies model-level
worker completion rejects mismatched side-effect kinds before persistence, and
direct SQL updates cannot persist an applied side-effect runtime result whose
executor payload maps to another registry publisher.

Remaining risk: constrained registry side effects now have model and DB
coherence between executor payload kind, runtime side-effect kind, and
forward-only recovery semantics. Non-registry executors, executor-specific
payload schemas, live interruption/resume behavior, and real rollback
execution remain separate runtime work.

## 710. P2 landing record: Agent Runtime Worker Lease Payload Contract Constraint

This round tightens Agent Runtime standalone worker lease evidence beyond row
ownership fields. Worker acquisition already writes a compact
`workerLease` summary into active step output and writes run/step timeline
payloads for the same lease, but the database only required those JSON values
to be objects. Direct/manual rows could therefore keep object-shaped lease
evidence while dropping the lease expiry, changing the executor, using a zero
attempt count, or claiming an unsupported step type.

A new migration adds `ai_agent_runtime_worker_lease_payload_valid()` plus
`ai_agent_steps_worker_lease_payload_check` and
`ai_agent_timeline_events_worker_lease_payload_check` as `NOT VALID`
constraints. Step summaries with `workerLease` must retain
`version=agent-runtime-worker-step-lease/v1`, `executor=agent_runtime_worker`,
a positive bounded attempt count, and a non-blank lease id. Timeline payloads
with the run lease version must also retain lease expiry plus workflow/source
context; timeline payloads with the step lease version must retain step key and
the current Agent Runtime step-type vocabulary.

Focused backend coverage in `repair-execution.e2e.ts` now verifies
worker-generated lease summaries and timeline payloads retain the current
contract fields, and direct SQL writes cannot persist zero-attempt lease
summaries, missing run lease expiry, or unsupported step-type lease payloads.
The migration was also smoke-tested against a disposable Postgres instance with
valid compact step summaries, valid run timeline leases, valid step timeline
leases, and the targeted invalid cases.

Remaining risk: standalone worker lease payloads now have DB-backed shape for
the current worker acquisition evidence consumed by diagnostics and recovery.
Real production tool, Codex, MCP, handoff, approval, model, and planner
adapters still need executor-specific payload/result schemas, redaction,
retry/dead-letter behavior, interruption semantics, and side-effect/rollback
contracts.

## 711. P2 landing record: Agent Runtime Record-only Payload Contract Constraint

This round tightens the first concrete standalone Agent Runtime adapter result.
The record-only adapter intentionally completes persisted runs without external
tool, Codex, MCP, model, or side effects, and writes
`agent-runtime-record-only-execution/v1` evidence into active step summaries
plus run/step timeline payloads. Before this constraint, direct/manual rows
could keep object-shaped record-only evidence while blanking the summary,
claiming side effects were applied, dropping run context, or using an
unsupported step type.

A new migration adds `ai_agent_runtime_record_only_payload_valid()` plus
`ai_agent_steps_record_only_payload_check` and
`ai_agent_timeline_record_only_payload_check` as `NOT VALID` constraints. The
step summary contract requires the current version, the
`agent_runtime_record_only_adapter` executor, a bounded non-blank summary,
positive worker attempt, non-blank lease id, and `sideEffectsApplied=false`.
Run timeline payloads additionally require `workerMaxAttempts`,
workflow/source context, and `sideEffectsApplied=false`; step timeline payloads
require step key and the current Agent Runtime step-type vocabulary.

Focused backend coverage in `repair-execution.e2e.ts` now verifies the real
record-only worker path emits the constrained step summary, step timeline, and
run timeline payloads. Direct SQL coverage rejects blank record-only summaries,
run timeline side-effect drift, and unsupported step-type payloads before
diagnostics or follow-up runtime consumers can observe them. The migration was
smoke-tested against a disposable Postgres instance with valid step summary,
run timeline, and step timeline payloads plus the targeted invalid cases.

Remaining risk: the record-only adapter result now has DB-backed shape for the
current no-side-effect completion contract. Production tool, Codex, MCP,
handoff, approval, model, and planner adapters still need executor-specific
payload/result schemas, redaction, retry/dead-letter behavior, interruption
semantics, and side-effect/rollback contracts.

## 712. P2 landing record: Agent Runtime Worker Failure Payload Contract Constraint

This round tightens standalone Agent Runtime worker failure evidence. The
worker already writes `agent-runtime-worker-failure/v1` into failed step
summaries plus run/step timeline payloads, and the prior adapter-resolution
constraint validated only the optional nested `adapterResolution` object.
Direct/manual rows could still keep the current worker-failure version while
dropping the failure message, zeroing the attempt, omitting run workflow/source
context, or claiming an unsupported step type.

A new migration adds `ai_agent_runtime_worker_failure_payload_valid()` plus
`ai_agent_steps_worker_failure_payload_check` and
`ai_agent_timeline_worker_failure_payload_check` as `NOT VALID` constraints.
Step summaries with `workerFailure` must retain the current version, bounded
failure code/message, positive worker attempt, non-blank lease id, and any
present adapter-resolution metadata remains covered by the existing dedicated
adapter-resolution constraint. Run timeline failure payloads additionally
require `workerMaxAttempts` plus workflow/source context; step timeline failure
payloads require step key and the current Agent Runtime step-type vocabulary.

Focused backend coverage in `repair-execution.e2e.ts` now verifies the real
unsupported-adapter failure path emits constrained step summary, step timeline,
and run timeline payloads. Direct SQL coverage rejects missing failure-message
step summaries, missing run workflow context, and unsupported step-type failure
payloads. The migration was smoke-tested against a disposable Postgres instance
with valid step summary, run timeline, and step timeline failure payloads plus
the targeted invalid cases.

Remaining risk: standalone worker failure payloads now have DB-backed shape for
the current failure diagnostics consumed by Admin, recovery, and future
operator triage. Production tool, Codex, MCP, handoff, approval, model, and
planner adapters still need executor-specific failure/result schemas,
redaction, retry/dead-letter behavior, interruption semantics, and
side-effect/rollback contracts.

## 713. P2 landing record: Agent Runtime Manual-control Payload Contract Constraint

This round tightens standalone Agent Runtime manual-control evidence. The
cancel/resume model path already writes `agent-runtime-manual-control/v1`
payloads into step summaries and timeline events, but only object-shaped JSON
was required. Direct/manual rows could therefore claim an unsupported action,
drop the previous run status, omit workflow/source context, or pair a resume
timeline row with a cancel action.

A new migration adds `ai_agent_runtime_manual_control_payload_valid()` plus
`ai_agent_steps_manual_control_payload_check` and
`ai_agent_timeline_manual_control_payload_check` as `NOT VALID` constraints.
Step summaries with `manualControl` must retain the current version, a
supported `cancel` or `resume` action, actor id, and a null or bounded reason.
Timeline payloads with the manual-control version must also retain previous
status, workflow/source context, control timestamp, and action/status
coherence: `run_cancellation/cancelled` rows must be `cancel`, while
`run_status/queued` rows must be `resume`.

Focused backend coverage in `repair-execution.e2e.ts` now verifies the real
standalone cancel and resume paths emit constrained step summary and timeline
payloads. Direct SQL coverage rejects unsupported manual actions, missing
previous status, and action/status mismatches. The migration was smoke-tested
against a disposable Postgres instance with valid cancel/resume summaries and
timeline payloads plus the targeted invalid cases.

Remaining risk: standalone manual-control payloads now have DB-backed shape for
the current cancel/resume state machine. Live interruption semantics for
running production adapters, executor-specific cancellation hooks, and
cross-worker coordination remain separate runtime work.

## 714. P2 landing record: Agent Runtime Stale-lease Payload Contract Constraint

This round tightens standalone Agent Runtime stale worker lease recovery
evidence. The scheduled recovery path already writes
`agent-runtime-stale-lease-recovery/v1` into active step summaries and run
timeline events when an expired standalone worker lease is requeued or failed,
but the database only required object-shaped JSON. Direct/manual rows could
therefore claim a retry while setting `nextStatus=failed`, drop the previous
lease expiry, omit workflow/source context, or mismatch the timeline row status
with the payload status.

A new migration adds `ai_agent_runtime_stale_lease_payload_valid()` plus
`ai_agent_steps_stale_lease_payload_check` and
`ai_agent_timeline_stale_lease_payload_check` as `NOT VALID` constraints. Step
summaries with `staleLeaseRecovery` must retain the current version, stale
recovery executor, bounded reason, retry/next-status coherence, positive
attempt counters, and previous lease id/expiry evidence. Timeline payloads with
the stale-recovery version must also retain `previousStatus=running`,
workflow/source context, and match the persisted timeline status to
`nextStatus`.

Focused backend coverage in `repair-execution.e2e.ts` now verifies the real
scheduled stale-lease recovery path emits constrained retry and terminal
failure payloads. Direct SQL coverage rejects retry/status drift, missing
workflow context, and timeline status mismatches. The migration was
smoke-tested against a disposable Postgres instance with valid retry and
terminal-failure step/timeline payloads plus the targeted invalid cases.

Remaining risk: standalone stale-lease recovery payloads now have DB-backed
shape for the current scheduler recovery state machine. Production adapter
dead-letter policy, per-executor retry semantics, and cross-worker live
interruption behavior remain separate runtime work.

## 715. P2 landing record: Repair Execution Audit Metadata Contract Constraint

This round tightens Repair Execution audit metadata beyond object-shaped JSON
and bounded fingerprints. The queued worker and manual/scheduled control paths
already emit stable metadata for `running`, worker `failed`,
`retry_scheduled`, manual `cancelled`, `manual_retry_requested`, and
`stale_recovered` events, but direct/manual rows could still keep the same
event type while dropping lease evidence, executor-payload fingerprints,
retry/next-status coherence, or control attempt metadata.

A new migration adds small JSONB validation helpers plus
`ai_repair_execution_audit_metadata_valid()` and
`ai_repair_execution_audit_metadata_contract_check` as a `NOT VALID`
constraint on `ai_repair_execution_audit_events`. The constraint requires
running audit rows to retain the repair worker executor marker, positive
attempt, lease id, and lease expiry; worker failure rows to retain failure
diagnostics, retry status, attempt counters, failing executor-payload
fingerprint, and lease id; retry-scheduled rows to retain `nextStatus=queued`;
manual cancel/retry rows to retain control action, previous state, bounded
reason where present, attempt evidence, and executor-payload fingerprints; and
stale-recovery rows to retain recovery source, previous running lease evidence,
retry/next-status coherence, and attempt counters. The same `failed` event
type also allows the existing exhausted stale-recovery failure shape, while
approval-rejection `cancelled` rows remain compatible with their existing
approval-gate metadata shape.

Focused backend coverage in `repair-execution.e2e.ts` now creates valid audit
rows for the constrained event families and verifies direct SQL drift is
rejected when lease expiry, executor-payload fingerprint, retry status,
next-status, previous-status, or manual retry attempt evidence is malformed.

Remaining risk: Repair Execution worker/control audit metadata now has a
DB-backed contract for the current state machine. Future non-registry
executors, operator-provided resume payloads, live running interruption, and
real rollback execution still need their own explicit payload/result/audit
schemas before they are enabled.

## 716. P2 landing record: Support Bundle Creation Audit Metadata Constraint

This round tightens Support Bundle lifecycle audit evidence for the initial
artifact persistence path. Request rows already had scalar manifest/archive
artifact metadata constraints, and download/retention audit rows already had
dedicated metadata contracts, but `created` and `archive_created` audit events
could still keep object-shaped metadata while dropping the manifest storage key,
zeroing byte sizes, or omitting archive fingerprints.

`CopilotSupportBundleModel.createAuditEvent()` now validates `created` metadata
for manifest fingerprint, positive manifest byte size, manifest filename/MIME,
manifest storage key, source-evidence fingerprint, and
`retentionStatus=active`. It also validates `archive_created` metadata for
positive archive byte size, archive filename/MIME/storage key, archive
fingerprint, and manifest fingerprint before persisting new audit rows.

A new migration adds `ai_support_bundle_creation_audit_metadata_valid()` plus
`ai_support_bundle_audit_events_creation_metadata_check` as a `NOT VALID`
constraint. The constraint is scoped only to `created` and `archive_created`
events, preserving `read`, `downloaded`, transfer, download authorization, and
retention audit metadata compatibility while rejecting malformed lifecycle
artifact evidence for the current creation path.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct SQL
updates cannot remove manifest storage evidence, set manifest/archive byte
sizes to zero, or remove archive fingerprints from creation audit rows before
artifact delivery, retention cleanup, or diagnostics consume them.

Remaining risk: Support Bundle creation/archive lifecycle audit metadata now
has model and DB-backed shape for the current artifact persistence path.
Deployment-specific object-storage webhook forwarding, real provider signature
verification rollout, and external retry/dead-letter operations remain
separate production work.

## 717. P2 landing record: Registry Repair Metadata Evidence Constraint

This round tightens DB-backed registry repair revision provenance beyond the
existing source/version contract. Prompt Registry, Task Route Policy, Model
Registry, and Provider Registry repair publishers already write stable
repair-executor metadata with execution request, request/approval fingerprints,
operation fingerprints, preview/catalog fingerprints, target locator evidence,
and candidate evidence fingerprints, but the database only required current
repair metadata versions to pair with `publishSource=repair_execution_worker`.
Direct/manual rows could therefore keep the correct repair source while
dropping the actual repair evidence consumed by diagnostics and audit review.

A new migration adds repair metadata JSONB helpers plus per-table constraints:
`ai_prompt_registry_revisions_repair_metadata_evidence_check`,
`ai_task_route_policy_revisions_repair_metadata_evidence_check`,
`ai_model_registry_revisions_repair_metadata_evidence_check`, and
`ai_provider_registry_revisions_repair_metadata_evidence_check`. The
constraints are scoped to current `*-repair-executor/v1` metadata versions.
Common repair metadata must retain execution request id, request fingerprint,
candidate evidence set fingerprint, task-route evidence set fingerprint,
repair job fingerprint, approval record fingerprint, operation set
fingerprint, preview fingerprint, and catalog fingerprint.

Prompt Registry repair metadata additionally requires expected registry
fingerprint/id/update evidence plus non-empty operation fingerprint and
operation kind arrays. Task Route Policy, Model Registry, and Provider
Registry repair metadata require operation fingerprint, target locator
fingerprint, and any present candidate/task-route evidence fingerprint arrays
to be non-empty bounded string arrays.

Focused backend coverage in the Prompt Registry, Task Route Policy, Model
Registry, and Provider Registry e2e suites now inserts valid current repair
metadata rows and verifies direct SQL drift is rejected when repair job,
approval, operation, target locator, operation list, task-route source, or
candidate evidence fields are removed or emptied.

Remaining risk: current repair-driven registry revision metadata now has
DB-backed evidence shape. Full registry editors, prompt body diff/eval,
bulk migration workflows, credential management, automatic health probe
history, and richer audit history remain separate product/runtime work.

## 718. P2 landing record: Agent Runtime Repair Execution Payload Contract Constraint

This round tightens the Agent Runtime payloads that are linked to persisted
Repair Execution requests. The repair execution state machine already
synchronized queued, running, completed, failed, and cancelled states into
Agent Runtime run/step/timeline rows, but those rows still reused loosely shaped
JSON payloads. Direct/manual writes could therefore keep a completed
repair-linked timeline row while dropping the repair-job fingerprint,
permission status, side-effect rollback contract, or rollback reason consumed
by run detail, Admin diagnostics, and audit review.

`CopilotAgentRuntimeModel` now writes dedicated repair payload versions:
`agent-runtime-repair-execution-run/v1` for repair run timeline payloads and
`agent-runtime-repair-execution-step/v1` for repair step summaries and step
timeline payloads. Run payloads retain workflow/source/request context plus the
request and repair-job fingerprints. Step payloads retain repair execution
request id, approval state, granted permission status, runtime executor,
side-effect mode, and, when a side effect was applied, side-effect identity
plus the projected forward-only rollback contract including its reason.

A new migration adds `ai_agent_runtime_repair_run_payload_valid()` and
`ai_agent_runtime_repair_step_payload_valid()` plus
`ai_agent_steps_repair_execution_payload_check` and
`ai_agent_timeline_repair_execution_payload_check` as `NOT VALID`
constraints. The checks are scoped to the new repair payload versions, so
legacy rows without those versions remain compatible, while malformed current
repair payloads are rejected. The version trigger uses trimmed version values
so whitespace-padded current versions cannot bypass the contract.

Focused backend coverage in `repair-execution.e2e.ts` now verifies the real
approval/worker flow emits the repair payload versions, permission status,
repair-job fingerprint, side-effect identity, and rollback contract into
Agent Runtime step output and timeline payloads. Direct SQL coverage rejects
missing permission status, whitespace-version required-field drift, missing
repair-job fingerprint, missing rollback contract, and missing rollback reason.
The migration was smoke-tested against a disposable Postgres instance with
valid repair run/step payloads, legacy `{}` payloads, and the targeted invalid
cases.

Remaining risk: repair-execution-linked Agent Runtime diagnostics now have a
DB-backed payload contract for the current registry-repair state machine.
Broader planner execution, production tool/Codex/MCP/model adapters, live
interrupt semantics, executor-specific result schemas, and real rollback
execution remain separate runtime work.

## 719. P1 landing record: Support Bundle Retention Retry Audit Metadata Contract

This round tightens Support Bundle retention audit evidence for the cleanup
retry and escalation paths. Archive object deletion and manifest object rewrite
already have executable retry and scheduled escalation behavior, but the older
retention audit constraint only checked the base cleanup identity and broad
status vocabulary. Direct/manual rows could therefore claim a retry or
scheduled escalation while dropping the previous cleanup fingerprint, storage
key, retry failure count, bounded error evidence, or escalation status
coherence used by cleanup scans and Admin summaries.

`CopilotSupportBundleModel.createAuditEvent()` now validates
`retention_expired` metadata before insertion. The model checks base cleanup
identity, manifest fingerprints, retention status, archive cleanup status,
manifest rewrite status, retry failure counts, previous cleanup fingerprints,
storage keys, bounded error fields, and scheduled escalation
reason/timestamp/status coherence. The manual `cleanupRetention()` result also
now returns the manifest rewrite retry/recovered/failed counts already exposed
by GraphQL/Admin types.

A new migration adds JSONB helpers plus
`ai_support_bundle_retention_retry_metadata_valid()` and
`ai_support_bundle_audit_events_retention_retry_metadata_check` as a
`NOT VALID` constraint. It is scoped to `retention_expired` rows that carry the
archive cleanup or manifest rewrite metadata families, preserving older
retention rows without those fields while rejecting malformed current
retry/escalation evidence.

Focused backend coverage in `support-bundle.e2e.ts` now verifies direct SQL
inserts cannot persist archive cleanup retry metadata without the previous
cleanup fingerprint, manifest rewrite retry metadata without the previous
rewrite fingerprint, archive cleanup escalation with a recovered status, or
manifest rewrite escalation without the retry marker. The migration was
smoke-tested against a disposable Postgres instance with valid base retention,
archive retry, manifest escalation, and legacy retention rows plus the targeted
invalid cases.

Remaining risk: Support Bundle retention retry/escalation evidence now has a
model and DB-backed contract. Deployment-specific object-storage webhook
forwarding, provider signature verification rollout, and external
retry/dead-letter policy for the forwarding worker remain production
integration work.

## 720. P2 landing record: Provider Health Cleanup Metadata Contract Constraint

This round tightens DB-backed Provider Health metadata for configured
snapshots and stale cleanup rows. The previous metadata constraint guaranteed
the current metadata version and publish-source vocabulary, but direct/manual
rows could still claim to be configured snapshot or cleanup evidence while
dropping the provider-profile identity, previous fingerprint, previous source,
or freshness boundary consumed by route overlays, cleanup summaries, and Admin
diagnostics.

`CopilotProviderHealthStateModel` now normalizes metadata before persistence,
preserves reserved `version` and `publishSource` fields after caller extras are
merged, bounds metadata size, and validates source-specific contracts.
Configured snapshot rows retain provider profile identity, snapshot-source
evidence, and bounded optional config-path evidence. Configured snapshot
cleanup rows retain cleanup reason, previous status, previous checked time,
previous fingerprint, previous publish-source, and previous last-error
evidence. Stale probe-result cleanup rows retain the cleanup reason, previous
status/source/publish-source, previous checked time, previous fingerprint,
previous last-error evidence, and a positive `probeResultMaxAgeMs` freshness
boundary.

A new migration adds Provider Health metadata JSONB helpers plus
`ai_provider_health_cleanup_metadata_valid()` and
`ai_provider_health_states_cleanup_metadata_contract_check` as a `NOT VALID`
constraint. It is scoped to current
`provider-health-state-metadata/v1` rows, with trimmed-version checks so
whitespace-padded current-version metadata cannot bypass the cleanup contract.

Focused backend coverage in `provider-registry-revision.e2e.ts` now verifies
direct SQL drift is rejected when configured snapshot rows omit provider
profile evidence, configured snapshot cleanup rows omit previous fingerprints,
stale probe cleanup rows drift to manual-override source evidence, stale probe
cleanup rows omit `probeResultMaxAgeMs`, or whitespace-padded current-version
metadata omits required stale-cleanup evidence. The migration was smoke-tested
against a disposable Postgres instance with valid manual override, configured
snapshot, configured cleanup, and stale probe cleanup rows plus the targeted
invalid cases.

Remaining risk: Provider Health configured snapshots and cleanup rows now have
model and DB-backed metadata evidence. Production external provider probe
executors, probe history UI, full editable Provider Registry workflows,
credential management, and bulk migration remain separate registry/runtime
work.

## 721. P2 landing record: Agent Runtime Adapter Resolution Capability Contract

This round tightens standalone Agent Runtime adapter-resolution evidence. The
previous adapter-resolution contract enforced the current version, known
status, workflow identity, and requested step types, but direct/manual rows
could still claim a registered-adapter failure while dropping the registered
adapter capability snapshot, selected adapter snapshot, unsupported step-type
evidence, or side-effect mode vocabulary that explains why the worker failed a
run.

`CopilotAgentRuntimeModel` now validates adapter-resolution payloads for the
same capability evidence emitted by the standalone worker. Every current
adapter-resolution payload must retain a non-empty bounded
`registeredAdapters` list. Registered-adapter statuses
`unsupported_contract`, `execution_failed`, `invalid_executor_result`, and
`incomplete_execution` must retain a selected `adapter` snapshot whose
workflow matches the failed run workflow. Unsupported-contract failures must
retain non-empty `unsupportedStepTypes`, and every adapter snapshot must retain
known step types plus a known side-effect mode. The validator also rejects
duplicate step-type and adapter snapshots, selected adapters that are not
present in the registered snapshot list, unsupported-workflow payloads that
claim a selected adapter, and unsupported-contract payloads whose unsupported
step types were not requested or were actually supported by the selected
adapter.

A new migration replaces `ai_agent_runtime_adapter_resolution_valid()` with a
stricter validator backed by helper functions for step-type lists, adapter
snapshots, and registered adapter lists. The existing step-summary and
timeline adapter-resolution CHECK constraints immediately use the stricter
function for new and updated rows while remaining scoped to current
`agent-runtime-worker-adapter-resolution/v1` payloads.

Focused backend coverage in `repair-execution.e2e.ts` now verifies direct SQL
drift is rejected when adapter-resolution metadata omits registered adapters,
omits unsupported step types for an unsupported-contract failure, carries an
unknown side-effect mode in a registered adapter snapshot, selects an adapter
missing from the registered snapshot list, or marks an adapter-supported step
as unsupported. Syntax and diff hygiene checks passed for the Agent Runtime
model, e2e suite, and additive migration.

Remaining risk: standalone Agent Runtime adapter-resolution evidence now has a
model and DB-backed capability contract. Production tool/Codex/MCP/model
adapters still need executor-specific payload/result schemas, redaction,
side-effect idempotency, live interruption, and concrete implementations.

## 722. P2 landing record: Provider Health Event History Persistence

This round closes another DB-backed registry gap in Provider Health. The
latest overlay row already drove route selection and cleanup, and recent
slices constrained the overlay metadata, but each write still overwrote the
previous row. Auditors could inspect the current cleanup metadata, yet manual
override, configured snapshot, workspace probe-result, and cleanup history was
not durable as an append-only stream.

The Provider Health model now appends `ai_provider_health_events` rows whenever
the existing writers update the overlay table. Manual workspace writes create
`manual_override_recorded` events. Workspace probe-result writes create
`workspace_probe_result_recorded` events. Configured profile snapshots create
`configured_snapshot_recorded` events. Configured snapshot cleanup and stale
probe cleanup create `configured_snapshot_cleared` and
`stale_probe_result_cleared` events carrying the same previous-state metadata
already enforced on the overlay row. Event ids are deterministic from the
event fingerprint, so repeated identical snapshot persistence is idempotent.

A new migration creates `ai_provider_health_events` with provider identity,
scope/workspace/actor, status, checked time, source, event type, latest state
fingerprint, event fingerprint, and metadata. The table is DB-constrained for
status/source/scope/event vocabulary, workspace/scope coherence, metadata
shape, Provider Health metadata contract, event-type/source/publish-source
coherence, identity string shape, last-error shape, and fingerprint shape.

Focused backend coverage in `provider-registry-revision.e2e.ts` now verifies
event rows are written for manual override, configured snapshot, configured
snapshot cleanup, workspace probe result, and stale probe cleanup paths. It
also verifies direct SQL cannot persist event rows whose event type contradicts
source or publish-source metadata. The migration was smoke-tested against a
disposable Postgres instance with valid manual/snapshot/probe/cleanup events
and targeted invalid event/source drift.

Remaining risk: Provider Health now has durable overlay and event-history
persistence for the current writers. Live external provider probe execution,
probe result ingestion from real provider calls, probe history UI, credential
management, and full Provider Registry editor workflows remain separate
registry/runtime work.

## 723. P1 landing record: Support Bundle Direct Transfer Event Persistence

This round closes a support-bundle persistence gap in direct object-storage
delivery. The previous direct-transfer path verified storage evidence and wrote
one `downloaded` audit row, but provider notifications and validated replay
events did not have their own durable history. Operators could see that an
authorization had been marked downloaded, but not inspect multiple verified
provider notification attempts without relying on the first audit metadata row.

`CopilotSupportBundleModel.ingestDirectDownloadTransferEvent()` now builds a
versioned, deterministic transfer event fingerprint after the existing
authorization, retention, artifact fingerprint, object-storage metadata, and
notification auth evidence checks pass. Initial transfer notifications insert
an `ai_support_bundle_transfer_events` row in the same transaction that marks
the authorization downloaded and writes the existing `downloaded` audit event.
Already-downloaded matching replays remain audit-idempotent, but now append
their own durable transfer event rows after replay storage validation succeeds.

A new migration creates `ai_support_bundle_transfer_events` and adds a
composite authorization snapshot key on
`ai_support_bundle_download_authorizations`. Transfer event rows retain
authorization, bundle, workspace, actor, artifact kind, manifest/artifact
fingerprints, authorization fingerprint, delivery method, event id/source,
transfer time, storage key, storage byte size/content type, notification auth
evidence, notification auth evidence fingerprint, and transfer event
fingerprint. DB constraints reject malformed fingerprints, missing internal
notification auth evidence, AWS/S3 provider-origin rows without upstream
verified provider signature evidence, inconsistent manifest artifact
fingerprints, invalid delivery/artifact vocabulary, and transfer rows whose
authorization snapshot drifts from the persisted download authorization.

Focused backend coverage in `support-bundle.e2e.ts` now verifies verified
object-storage transfer notifications persist transfer event rows, matching
replays add transfer event history without duplicating downloaded audit rows,
downloaded audit metadata carries the transfer event fingerprint, direct SQL
cannot remove notification auth evidence, and direct SQL cannot attach a
transfer event to an authorization while changing the authorization
fingerprint. The migration was smoke-tested against a disposable Postgres
instance with valid transfer rows, idempotent replay inserts, rejected
AWS/S3-origin rows missing provider signature evidence, and rejected composite
authorization-snapshot drift.

Remaining risk: Support Bundle direct-transfer notifications now have durable
DB-backed event history and authorization-snapshot constraints. Production
object-storage webhook subscription, provider-specific signature verification,
forwarding retry/dead-letter policy, and Admin transfer-event history
inspection remain separate integration/UI work.

## 724. P1 landing record: Repair Execution Side-effect Ledger Persistence

This round closes another repair execution persistence gap for constrained
registry side effects. The previous worker path wrote the completed request
runtime result and side-effect audit metadata, and recent constraints enforced
side-effect identity, executor-payload coherence, and forward-only rollback
evidence on that runtime result. There was still no dedicated side-effect
ledger row that could survive audit filtering, support cross-request review by
workspace/fingerprint, or prevent direct/manual rows from drifting away from
the request workspace and actor snapshot.

`CopilotRepairExecutionModel.completeWorkerExecution()` now inserts an
`ai_repair_execution_side_effects` row only after the request has been
successfully transitioned to `completed`, and before the existing
`side_effect_applied` and `completed` audit events are written. The ledger row
retains the execution request id, workspace id, actor id, side-effect kind,
record id, side-effect fingerprint, sanitized side-effect summary, executor
payload fingerprint, worker attempt, worker lease id, and applied time. Stale
worker completions and malformed side-effect results still fail before any
ledger row is created.

A new migration adds a composite request snapshot key on
`ai_repair_execution_requests` and creates
`ai_repair_execution_side_effects`. The ledger table is DB-constrained for
known constrained-registry side-effect kinds, bounded string fields,
fingerprint shapes, object summaries, positive worker attempts, timestamp
coherence, and the same forward-only rollback contract. A composite foreign
key to `(execution_request_id, workspace_id, actor_id)` prevents direct/manual
ledger rows from changing the workspace or actor while still pointing at the
same completed request.

Focused backend coverage in `repair-execution.e2e.ts` now verifies successful
worker completion creates exactly one side-effect ledger row with executor
payload fingerprint and worker lease evidence, stale completions and malformed
side-effect results create no ledger rows, direct SQL cannot remove the
rollback contract, and direct SQL cannot drift the ledger actor away from the
request snapshot. The migration was smoke-tested against a disposable Postgres
instance with valid ledger rows plus rejected rollback removal, actor drift,
bad side-effect kind, and duplicate execution-request cases.

Remaining risk: Repair Execution now has runtime-result evidence, audit
metadata, Agent Runtime diagnostics, and a dedicated DB-backed side-effect
ledger for the current constrained registry publishers. This is not rollback
execution; it records the forward-only follow-up revision recovery contract.
Non-registry executors, live interruption/resume semantics, and actual
rollback behavior remain separate runtime work.

## 725. P2 landing record: Agent Runtime Worker Execution Result Ledger

This round closes an Agent Runtime persistence gap for standalone worker
adapter outcomes. The previous worker path persisted terminal state through
the run row, step summaries, and timeline events, and recent constraints
tightened record-only completion, worker-failure, and adapter-resolution
payloads. There was still no dedicated result ledger for terminal adapter
outcomes that could be queried by workflow, adapter, result status, worker
attempt, or fingerprint without depending on timeline JSON.

`CopilotAgentRuntimeModel` now writes
`ai_agent_runtime_execution_results` after a leased standalone run is
successfully transitioned to terminal state. Record-only completions insert a
`completed` result row after the run update succeeds and before completion
timeline events are appended. Worker failure paths insert a `failed` result
row after the failure update succeeds and before failed step/timeline events
are appended. Stale completion/failure paths and malformed adapter-resolution
input still fail before any result ledger row is created.

A new migration adds a composite run snapshot key on `ai_agent_runs` and
creates `ai_agent_runtime_execution_results`. Result rows retain run,
workspace, actor, workflow/source identity, adapter workflow, executor, result
status, side-effect mode, side-effect-applied flag, summary, failure
diagnostics when present, versioned result payload, result fingerprint, worker
attempt, worker lease id, and completion time. The table is DB-constrained for
standalone source rows, result/executor/side-effect vocabulary, bounded string
fields, fingerprint shape, positive worker attempts, payload/column coherence,
record-only success semantics, worker-failure diagnostics, and a composite
foreign key to `(run_id, workspace_id, actor_id)` so direct/manual ledger rows
cannot drift away from the run snapshot.

Focused backend coverage in `repair-execution.e2e.ts` now verifies
unsupported-adapter failures, registered adapter exceptions, and record-only
completions persist one terminal execution result row. Stale record-only
completion and stale worker failure paths write no ledger rows. Direct SQL
coverage rejects side-effect drift on record-only execution results and actor
drift away from the run snapshot. The migration was smoke-tested against a
disposable Postgres instance with valid completed and failed result rows plus
rejected side-effect drift, actor drift, failed-result side-effect drift, and
repair-source rows.

Remaining risk: standalone Agent Runtime terminal adapter outcomes now have a
dedicated DB-backed result ledger in addition to run/step/timeline evidence.
At this landing point the only successful concrete adapter remained
record-only; later landing record 802 adds a generic local-completion adapter.
Production tool, Codex, MCP, model, handoff, and planner adapters still need
executor-specific payload/result schemas, redaction, side-effect idempotency,
live interruption semantics, and implementations.

## 726. P2 landing record: Registry Revision Publish Event History Persistence

This round closes another DB-backed registry persistence gap. The four
registry revision families already had durable rows, uniqueness/idempotency,
repair metadata contracts, and direct/repair-driven write paths, but publish
history still lived only in the latest revision row and caller-side audit
context. Operators could tell that a revision existed, yet could not inspect
which direct publish or repair worker attempts created or reused it without
inferring from revision metadata.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
publishers now append `ai_registry_revision_publish_events` rows whenever they
create a new revision or reuse an existing same-fingerprint revision. Direct
GraphQL publish paths write `publish_source=graphql_mutation`; constrained
repair execution publishers write `publish_source=repair_execution_worker`.
Each event records registry family, revision id, workspace/actor, scope,
registry key, revision, revision fingerprint/status, event type
(`revision_published` or `revision_reused`), publish source, event
fingerprint, and versioned metadata. Event fingerprints include a nonce so
repeat reuse attempts are history rows rather than silently deduplicated.

A new migration creates the unified event table and adds parent revision
snapshot keys for all four registry families. Event rows carry one
family-specific revision FK plus provider/model identity columns where needed.
Database constraints enforce family/scope/status/event/source vocabulary,
metadata key presence, metadata/column coherence, event fingerprint shape,
family-specific FK coherence, and parent revision snapshot coherence for
scope, workspace, actor, registry identity, revision, fingerprint, and status.
Direct/manual SQL can no longer keep metadata internally coherent while
drifting the event fingerprint or registry identity away from the parent
revision row.

Focused backend coverage in `provider-registry-revision.e2e.ts` now publishes
and reuses one revision from each registry family, verifies two event rows per
revision, checks prompt event metadata, rejects missing metadata evidence,
rejects family/FK drift, and rejects revision fingerprint snapshot drift. The
migration was smoke-tested against a disposable Postgres instance with valid
events for all four families plus rejected missing publish source, family/FK
drift, scope/workspace drift, invalid event type, invalid publish source, and
parent revision snapshot drift.

Remaining risk: DB-backed registry revisions now have durable publish/reuse
event history for the current direct and constrained repair writers. This is
not a full registry editor, review timeline UI, bulk migration workflow,
provider credential management, or automatic health probe execution.

## 727. P1 landing record: Support Bundle Transfer Event History Read Exposure

This round closes the operator visibility gap left after durable support
bundle transfer event persistence. The previous slice wrote
`ai_support_bundle_transfer_events` rows for verified direct object-storage
notifications and matching replays, but support bundle GraphQL/Admin read
paths still surfaced only audit counts. Operators could verify rows through
SQL, but could not inspect recent provider notification or replay evidence
from the existing support bundle surface.

`CopilotSupportBundleModel.get()` and `.list()` now hydrate
`transferEventCount` plus the latest five transfer event records per support
bundle in newest-first order. `CopilotSupportBundleType` exposes those records
with authorization id, artifact kind, manifest/artifact/authorization
fingerprints, delivery method, event id/source, transferred time, storage
key/byte-size/content-type, notification auth evidence fingerprint, event
fingerprint, and creation time. Common GraphQL source queries, checked-in
operation strings, and generated response types were updated for create/get/
list callers.

Admin support bundle rows now show transfer-event count and recent transfer
event evidence alongside manifest/archive metadata: provider event source/id,
authorization id, artifact and manifest fingerprints, notification-auth
fingerprint, storage key/content-type/byte-size, and transfer time. New Admin
coverage verifies the displayed count and evidence, while backend support
bundle e2e coverage now verifies GraphQL returns the persisted direct-transfer
and replay event history after storage validation writes the DB rows.

Remaining risk: Support Bundle transfer events now have DB persistence,
authorization snapshot constraints, and GraphQL/Admin read exposure for recent
history. Production object-storage webhook subscription, provider-specific
signature verification in the forwarding worker, and forwarding
retry/dead-letter policy remain deployment/runtime work outside this read
exposure slice.

## 728. P2 landing record: Registry Revision Publish Event History Read Exposure

This round closes the visibility gap left after durable registry publish event
persistence. The previous slice wrote `ai_registry_revision_publish_events`
rows for direct and constrained repair publishers, but the event history was
still effectively SQL-only. Existing direct publish mutation responses returned
the revision row, while operators could not inspect whether the same response
represented a first publish or a later same-fingerprint reuse without querying
the database directly.

`CopilotRegistryRevisionPublishEventType` now exposes publish/reuse event
records through the GraphQL schema, and the Prompt Registry, Task Route Policy,
Model Registry, and Provider Registry revision response types include
`publishEventCount` plus recent `publishEvents`. Each event exposes registry
family, revision id, provider/model identity where applicable, workspace/actor,
scope, registry key, revision, revision fingerprint/status, event type,
publish source, event fingerprint, metadata, and creation time.

The shared registry publish-event model now hydrates bounded latest-first
event history for a revision. All four direct and repair-driven registry
publisher model methods return the created or reused revision with the event
history attached. Focused backend coverage now selects the event fields from
all four direct publish mutations, verifies first publish responses carry one
`revision_published` event, verifies repeated matching publishes return
newest-first `revision_reused` plus `revision_published` events, and verifies
direct model-level publish/reuse returns expose the same event history across
all four registry families.

Remaining risk: registry publish/reuse history now has DB persistence,
snapshot constraints, and read exposure on existing revision responses. This
is still not a full registry editor, full audit timeline UI, bulk migration
workflow, prompt body diff/eval, provider credential management, or automatic
provider probe execution.

## 729. P2 landing record: Agent Runtime Execution Result Ledger Read Exposure

This round closes the visibility gap left after durable Agent Runtime worker
execution result persistence. The previous slice wrote
`ai_agent_runtime_execution_results` rows for standalone terminal adapter
outcomes, but that ledger was still effectively SQL-only. Operators could see
run, step, and timeline state from existing AgentRun surfaces, yet could not
inspect the terminal adapter result rows that carry worker attempt, lease,
adapter, executor, result fingerprint, failure, and side-effect evidence.

`CopilotAgentRuntimeModel.get()` and `.list()` now hydrate
`executionResultCount` plus the latest five execution result rows per run in
newest-first order. `CopilotAgentRunType` exposes those rows through
`CopilotAgentRuntimeExecutionResultType`, including run/workspace/actor
snapshot evidence, workflow/source identity, adapter workflow, executor,
result status, side-effect mode, side-effect-applied flag, summary, failure
diagnostics when present, result payload/fingerprint, worker attempt, worker
lease id, completion time, and row creation time.

Common GraphQL operation strings and generated response types now select
execution result history for AgentRun detail/list, standalone Agent Runtime
control responses, repair execution approval/control responses, and prompt
registry repair execution request responses with linked AgentRun records.
Admin now renders execution result counts and recent result history in the
standalone Agent Runtime table, and includes linked AgentRun execution result
evidence in the repair execution request summary.

Focused backend coverage now verifies unsupported-adapter failure and
record-only completion runs expose execution result counts and recent result
history through model reads, GraphQL AgentRun detail, GraphQL AgentRun list,
and repair execution linked AgentRun selections. Admin coverage verifies a
completed standalone run displays the terminal result fingerprint, status,
attempt, lease, and side-effect summary.

Remaining risk: standalone Agent Runtime terminal adapter outcomes now have
DB persistence, row constraints, and GraphQL/Admin read exposure. The only
successful concrete adapter remains record-only. Production tool, Codex, MCP,
model, handoff, and planner adapters still need executor-specific
payload/result schemas, redaction, side-effect idempotency, live interruption
semantics, and implementations.

## 730. P1 landing record: Repair Execution Side-effect Ledger Read Exposure

This round closes the visibility gap left after durable repair side-effect
ledger persistence. The previous slice wrote
`ai_repair_execution_side_effects` rows for completed constrained registry
publishers, but the ledger was still SQL-only. Existing repair execution
GraphQL/Admin surfaces showed the runtime result and audit counts, while
operators could not inspect the durable side-effect ledger row that carries
request/workspace/actor snapshot evidence, executor payload fingerprint,
worker attempt, worker lease, applied time, side-effect fingerprint, and the
forward-only recovery summary.

`CopilotRepairExecutionModel.get()` and `.getByIdempotencyKey()` now hydrate
`sideEffectCount` plus the latest five side-effect ledger rows for the repair
execution record in newest-first order. `CopilotRepairExecutionRecordType`
exposes those rows through `CopilotRepairExecutionSideEffectType`, including
execution request id, workspace/actor snapshot, side-effect kind, record id,
fingerprint, summary, executor payload fingerprint, worker attempt, worker
lease id, applied time, and row creation time.

Common GraphQL operation strings and generated response types now select
side-effect ledger history for prompt registry repair execution request
responses, approval decision responses, and repair execution control
responses. Admin now renders the side-effect ledger count and recent
side-effect history in repair execution summaries, including kind, record id,
worker attempt, and fingerprint.

Focused backend coverage now verifies a worker-completed Prompt Registry
repair execution exposes the side-effect ledger through the model read path
and the idempotent GraphQL request readback. Admin coverage verifies a
completed repair execution displays the side-effect ledger count and recent
history from GraphQL.

Remaining risk: constrained repair side effects now have DB persistence,
snapshot constraints, runtime-result/audit/Agent Runtime evidence, and
GraphQL/Admin read exposure. This is still not rollback execution; it records
the forward-only follow-up revision recovery contract. Non-registry
executors, live interruption/resume semantics, and actual rollback behavior
remain separate runtime work.

## 731. P2 landing record: Provider Health Event History Read Exposure

This round closes the visibility gap left after durable Provider Health event
history persistence. The previous slice wrote `ai_provider_health_events` rows
for manual overrides, workspace probe results, configured snapshots,
configured snapshot cleanup, and stale probe cleanup, but the event history
was still effectively SQL-only from the existing manual health mutation.

`CopilotProviderHealthEventType` now exposes Provider Health event rows
through the GraphQL schema, and `CopilotProviderHealthStateType` includes
`eventCount` plus recent `events`. Each event exposes state id, provider
id/type, scope, workspace/actor, status, checked timestamp, last error,
source, event type, event fingerprint, state fingerprint, metadata, and
creation time.

Provider Health model write paths now return a bounded latest-first event
history after manual workspace overrides and configured/probe snapshot writes.
Base state hydration defaults to `eventCount: 0` and `events: []`, so
lightweight state readers remain compatible with the non-null GraphQL fields.
Focused backend coverage now verifies the manual Provider Health mutation
returns the first `manual_override_recorded` event and later returns
newest-first health transition history after the provider recovers.

Remaining risk: Provider Health event rows now have DB persistence,
constraints, and read exposure on the existing write response. This is still
not a full Provider Health timeline UI, external provider probe execution,
provider credential workflow, bulk migration, or deployment-specific health
probe scheduler beyond the current persistence and cleanup workers.

## 732. P2 landing record: Support Bundle Audit Event History Read Exposure

This round closes the visibility gap left after durable support bundle
lifecycle audit persistence. Support bundle requests already wrote
`ai_support_bundle_audit_events` rows for creation, archive creation, reads,
download authorization, downloaded events, and retention expiration, but the
bundle API reduced that lifecycle stream to `auditEventCount`.

`CopilotSupportBundleAuditEventType` now exposes recent audit rows through
`CopilotSupportBundleType.auditEvents`. Each event exposes bundle/workspace/
actor ids, event type, event fingerprint, bounded metadata, and creation time.
The support bundle model hydrates the latest five audit events for `get` and
`list` in newest-first order while defaulting narrower internal scheduler
paths to an empty history.

The detail `supportBundle(id)` resolver now rehydrates the bundle after it
writes the `read` audit event, so the returned `auditEventCount` and
`auditEvents` describe the same durable state. Common GraphQL create/get/list
and retention-cleanup bundle selections now request audit history, generated
types include the new field, and Admin renders recent audit type, fingerprint,
actor, and creation evidence beside the existing transfer-event history.

Focused backend coverage verifies create/list responses expose the persisted
`created` and `archive_created` audit rows, and detail reads return the newly
persisted `read` event. Admin coverage verifies recent audit events render in
the support bundle diagnostic block.

Remaining risk: support bundle lifecycle audit rows now have DB persistence,
constraints, and GraphQL/Admin read exposure. This is still not a dedicated
audit timeline UI, external SIEM/export integration, provider-specific webhook
forwarder retry/dead-letter policy, or long-range audit search beyond the
bounded recent history attached to bundle responses.

## 733. P2 landing record: Repair Execution Audit Event History Read Exposure

This round closes the visibility gap left after durable repair execution audit
persistence. Repair execution requests already wrote
`ai_repair_execution_audit_events` rows for requested, approval, queued,
running, side-effect, completion, failure, retry, cancel, stale recovery, and
reuse transitions, but the durable execution record exposed only
`auditEventCount` and the request-level audit event fingerprint.

`CopilotRepairExecutionAuditEventType` now exposes recent repair audit rows
through `CopilotRepairExecutionRecordType.auditEvents`. Each event exposes the
execution request id, workspace/actor ids, event type, event fingerprint,
bounded metadata, and creation time. The repair execution model hydrates the
latest five audit events for `get` and `getByIdempotencyKey` in newest-first
order, while scheduler/list paths retain an empty history by default.

Common GraphQL repair request, approval decision, and manual control
selections now request audit history wherever they return a durable execution
record. Admin repair execution summaries render recent audit event type plus
fingerprint alongside the existing side-effect ledger history.

Focused backend coverage verifies waiting approval records expose
`requested`/`waiting_approval`, approval responses expose approval and queued
events, completed model reads expose the latest worker lifecycle events, and
idempotent request readback exposes the latest `reused` event. Admin coverage
verifies the repair execution summary includes recent audit history.

Remaining risk: repair execution lifecycle audit rows now have DB persistence,
constraints, and bounded GraphQL/Admin read exposure. This is still not a full
cross-request audit timeline UI, rollback execution, non-registry executor
coverage, live interruption/resume semantics, or long-range audit search.

## 734. P2 landing record: Agent Runtime Adapter Capability Read Exposure

This round closes the operator visibility gap around standalone Agent Runtime
workflow adapter registration. Worker failures already persisted registered
adapter capability snapshots in durable failure metadata, but the current
registered capability set was only visible through injected backend registry
access or by waiting for a failed run.

`CopilotAgentRuntimeWorkflowAdapterType` now exposes the registered workflow
id and nested capability metadata through `copilot.agentRuntimeWorkflowAdapters`.
The nested capability type includes the adapter capability version, supported
step types, side-effect mode, and summary, using the same allow-listed registry
snapshot shape used for worker adapter-resolution diagnostics.

Common GraphQL AgentRun list/detail operations now select the capability list,
generated types include it on the `copilot` response, and Admin renders the
registered adapters beside the persisted AgentRun table. Focused backend
coverage verifies GraphQL detail/list responses expose the record-only adapter
snapshot, and Admin coverage verifies workflow, supported step types, and
side-effect mode render in the Agent Runtime card.

Remaining risk: adapter registration is now observable through GraphQL/Admin.
At this landing point the only successful concrete standalone adapter remained
record-only; later landing record 802 adds generic local-completion execution.
Production tool/Codex/MCP/model/planner adapters still need executor-specific
payload/result schemas, side-effect idempotency contracts, redaction policy,
live interruption semantics, and concrete implementations.

## 735. P2 landing record: Prompt Catalog Publish Event Read Exposure

This round closes the remaining read-path gap for Prompt Registry
publish/reuse events. Registry revision publish events were already durable
and exposed on direct publish mutation responses, but the normal prompt catalog
diagnostics/Admin path still showed only DB revision identity and source-chain
metadata.

Prompt catalog DB-backed revision hydration now uses the shared registry
publish-event history reader. `CopilotPromptCatalogItemType` and
`CopilotPromptCatalogVersionEvidenceType` expose
`registryRevisionPublishEventCount` plus recent
`registryRevisionPublishEvents` for DB-backed Prompt Registry revisions.
Catalog fingerprints remain stable because publish/reuse history is
observability metadata rather than prompt/model selection identity.

Common prompt catalog GraphQL operations now select the bounded recent event
history, generated types include it, and Admin renders revision publish/reuse
event type, publish source, fingerprint, actor, and creation time in the
prompt catalog diagnostics panel. Admin coverage verifies the DB-backed prompt
catalog fixture renders both `revision_reused` and `revision_published`
events.

Remaining risk: prompt catalog diagnostics now expose bounded recent publish
event history, but this is still not a full cross-family registry event
timeline, editable prompt-body workflow, prompt diff/eval UI, bulk migration,
or long-range registry audit search.

## 736. P2 landing record: Model And Task Route Diagnostics Publish Event Read Exposure

This round closes the remaining diagnostics read-path gap for DB-backed Model
Registry and Task Route Policy publish/reuse events. Registry revision publish
events were already durable and visible on direct publish mutation responses,
and Prompt Registry events were visible through prompt catalog diagnostics, but
normal model candidate and task-route diagnostics still showed only revision
identity plus source-chain metadata.

Latest active Model Registry, Provider Registry, and Task Route Policy revision
hydration now attaches bounded publish-event history before provider registry
construction, model route diagnostics, and task policy resolution build their
read models. `getPromptModels` exposes model registry publish-event
counts/events on model candidates, task-route route/prepare candidates, and
candidate traces, and exposes Task Route Policy publish-event counts/events on
task-route diagnostics.

Admin model candidate diagnostics now render recent model revision publish/reuse
event type, publish source, fingerprint, actor, and creation time. Task-route
diagnostics render Task Route Policy publish/reuse history and candidate model
registry publish/reuse history beside existing revision/source-chain evidence.
Publish-event history remains diagnostic evidence only and is intentionally
excluded from source fingerprint inputs, so audit history growth does not churn
route/model fingerprints.

Focused Admin coverage verifies prompt model diagnostics render model registry
publish events, and rerank task-route diagnostics render both Task Route Policy
publish events and candidate model registry publish events.

Remaining risk: model/task-route diagnostics now expose bounded recent publish
event history, but this is still not a full cross-family registry event
timeline, full Model/Task Route editor, model diff/review UI, bulk migration,
or long-range registry audit search.

## 737. P2 landing record: Agent Runtime Terminal Stale Lease Execution Result Ledger

This round closes a durability gap in standalone Agent Runtime stale-lease
recovery. Scheduled stale-lease recovery already moved expired standalone runs
back to `queued` when attempts remained, or to terminal `failed` when attempts
were exhausted, and it already wrote constrained stale-recovery step/timeline
payloads. The terminal failure path still lacked a durable execution-result
ledger row, unlike explicit worker failures and record-only completions.

`recoverExpiredStandaloneWorkerLease()` now writes one
`ai_agent_runtime_execution_results` row when stale recovery terminally fails a
run with `stale_worker_lease`. The ledger row uses executor
`agent_runtime_stale_recovery_worker`, side-effect mode `none`,
`sideEffectsApplied=false`, the expired worker lease id, the run workflow as
adapter workflow, and the existing
`agent-runtime-worker-execution-result/v1` result payload shape. Requeue
recovery intentionally still writes no execution-result row because the run has
not reached a terminal execution outcome.

A follow-up migration extends the execution-result executor and status/payload
checks so failed ledger rows can come from either the normal runtime worker or
the stale-recovery worker, while completed rows remain limited to the
record-only adapter and all failed rows still require failure code/message and
`sideEffectsApplied=false`.

Focused backend coverage now verifies scheduled stale-lease requeue recovery
keeps `executionResultCount=0`, and terminal stale-lease failure exposes one
execution result through model hydration plus the raw ledger row with the
stale-recovery executor, failed status, lease evidence, failure code, and
bounded result payload.

Remaining risk: terminal stale-lease failures now have the same DB-backed
execution-result evidence as explicit worker failures, but this is still not
production tool/Codex/MCP/model adapter execution, live interruption, rollback,
or executor-specific result schemas for future side-effecting adapters.

## 738. P2 landing record: Agent Runtime Execution Result Run Snapshot Coherence

This round tightens the durable Agent Runtime execution-result ledger after
terminal stale-lease failures were added to the same table. The ledger already
carried run/workspace/actor snapshot evidence through a composite foreign key,
and its payload shape required workflow/source fields to match the row. Direct
SQL could still mutate the ledger row and payload together so the row stayed
self-consistent while drifting away from the parent `ai_agent_runs` workflow or
source identity.

`ai_agent_runs` now has a wider execution-result source snapshot unique key on
`id`, `workspace_id`, `actor_id`, `workflow`, `source_type`, and `source_id`.
`ai_agent_runtime_execution_results` now has a matching composite foreign key,
so ledger rows cannot retain a valid run id while changing their workflow or
source snapshot away from the parent run. The existing narrower FK remains in
place for the original run/workspace/actor snapshot relationship.

Prisma schema relations now name both snapshot relationships explicitly:
`agent_run_execution_result_snapshot` for the existing run/workspace/actor
foreign key and `agent_run_execution_result_source_snapshot` for the new
workflow/source snapshot foreign key.

Focused backend coverage extends the record-only execution-result ledger test:
after proving actor drift is rejected by the existing FK, it now verifies that
changing the ledger workflow and payload together is rejected by
`ai_agent_runtime_execution_results_run_source_snapshot_fkey`.

Remaining risk: execution-result ledger rows now preserve parent-run workflow
and source identity at the DB boundary, but this remains ledger integrity for
current standalone outcomes. Future production tool/Codex/MCP/model adapters
still need executor-specific result schemas, redaction, side-effect
idempotency, live interruption semantics, and concrete implementations.

## 739. P2 landing record: Support Bundle Child Workspace Snapshot Coherence

This round tightens support bundle child evidence integrity after transfer
event persistence and read exposure landed. Transfer events already preserve
their download authorization snapshot, but support bundle audit rows and
download authorization rows still used only a single-column `bundle_id` foreign
key to the parent request. Direct SQL could move those child rows to another
real workspace while keeping the same bundle id and satisfying the standalone
workspace FK.

`ai_support_bundle_requests` now has a composite workspace snapshot key on
`id` and `workspace_id`. `ai_support_bundle_audit_events` and
`ai_support_bundle_download_authorizations` now each have a matching
`(bundle_id, workspace_id)` foreign key, with `ON UPDATE RESTRICT`, so child
evidence cannot drift away from the parent bundle workspace or be silently
cascaded if the parent snapshot were edited. The child FKs are `NOT VALID` to
preserve upgrade tolerance for historical rows while rejecting new drift.

Prisma schema relations now name both the existing bundle relation and the new
workspace snapshot relation for audit events and download authorizations.

Focused backend coverage extends the support bundle create/read test: after
persisting a lifecycle audit row and a download authorization, it creates a
second real workspace and verifies direct updates to the child `workspace_id`
are rejected by the new snapshot FKs.

Remaining risk: support bundle child rows now preserve parent workspace
identity at the DB boundary. This intentionally does not bind child actor ids
to the bundle creator, because reads, cleanup, and download authorizations may
be performed by other authorized workspace actors. Archive artifact snapshot
coherence and deployment-specific object-storage notification verification
remain separate follow-up work.

## 740. P2 landing record: Repair Execution Audit Workspace Snapshot Coherence

This round applies the same child-workspace coherence pattern to Repair
Execution lifecycle audit evidence. The audit table already persisted
workspace, actor, event type, fingerprint, metadata, and creation time, and it
already had a single-column `execution_request_id` FK plus a standalone
workspace FK. Direct SQL could still move an audit row to another real
workspace while keeping the same execution request id.

`ai_repair_execution_requests` now has a composite audit snapshot key on `id`
and `workspace_id`. `ai_repair_execution_audit_events` now has a matching
`(execution_request_id, workspace_id)` foreign key, with
`ON UPDATE RESTRICT`, so lifecycle audit evidence cannot drift away from the
parent request workspace or be silently cascaded if the parent snapshot were
edited. The child FK is `NOT VALID` to preserve upgrade tolerance for
historical rows while rejecting new drift.

Prisma schema relations now name both the existing execution request relation
and the new request/workspace snapshot relation for repair execution audit
events.

Focused backend coverage extends the repair execution persistence test: after
creating a waiting approval request and its lifecycle audit rows, it creates a
second real workspace and verifies direct updates to the audit row
`workspace_id` are rejected by
`ai_repair_execution_audit_events_request_workspace_fkey`.

Remaining risk: repair execution audit rows now preserve parent request
workspace identity at the DB boundary. This intentionally does not bind audit
actor ids to the request creator, because approval, worker, manual control,
and stale-recovery events can be emitted by different authorized actors or
system workers. Non-registry executor payload schemas, live interruption, and
rollback behavior remain separate follow-up work.

## 741. P2 landing record: Agent Runtime Child Run Snapshot Coherence

This round tightens Agent Runtime child evidence after execution-result ledger
rows gained parent run workflow/source snapshot coherence. Step rows and
timeline rows already carried run id, workspace id, and actor id, but they only
had a single-column `run_id` FK plus standalone workspace/actor FKs. Direct SQL
could move a step or timeline row to another actor or workspace while keeping
the same run id.

`ai_agent_steps` and `ai_agent_timeline_events` now each have a composite
`(run_id, workspace_id, actor_id)` foreign key to the existing
`ai_agent_runs_execution_result_snapshot_key`. Both constraints use
`ON UPDATE RESTRICT`, so child evidence cannot drift away from the parent run
snapshot or be silently cascaded if a parent run snapshot were edited. The
child FKs are `NOT VALID` to preserve upgrade tolerance for historical rows
while rejecting new drift.

Prisma schema relations now name the existing run relation and the new
run-snapshot relation for both Agent Runtime steps and timeline events.

Focused backend coverage extends the standalone record-only worker test: after
the run completes and execution-result snapshot checks pass, it updates step
and timeline actor ids to a real different user and verifies both writes are
rejected by the new run snapshot FKs.

Remaining risk: Agent Runtime step and timeline rows now preserve parent run
workspace/actor identity at the DB boundary. Timeline event `step_id` still
uses the existing optional single-column FK because run-level events
intentionally have no step and step deletion currently nulls that field.
Production tool/Codex/MCP/model adapters, live interruption semantics, and
executor-specific result schemas remain separate follow-up work.

## 742. P2 landing record: Provider Health Event State Integrity

This round tightens DB-backed registry event history without breaking the
historical semantics of Provider Health events. Provider Health events already
recorded provider identity, scope, workspace, actor, status, source, event
type, state fingerprint, event fingerprint, and metadata. The event table
still allowed new rows with a missing or orphan `state_id`, which made event
history possible to write without a joinable Provider Health state row.

`ai_provider_health_events` now has a `state_id` presence check and a foreign
key to `ai_provider_health_states(id)`. Both are `NOT VALID`, preserving
upgrade tolerance for historical rows while rejecting new event rows that omit
or orphan their parent state. The FK uses `ON UPDATE RESTRICT`, so state ids
cannot be silently rewritten underneath event history.

Prisma schema now exposes the Provider Health state-to-events relation and the
event-to-state relation. The relation remains optional in Prisma because the DB
uses a `NOT VALID` presence check rather than a column-level `NOT NULL`, which
keeps historical-row tolerance explicit.

Focused backend coverage extends Provider Registry revision e2e coverage:
after verifying normal Provider Health event rows and event/source drift
rejection, it now verifies direct inserts with `state_id=NULL` fail on
`ai_provider_health_events_state_id_present_check` and direct inserts with a
missing state fail on `ai_provider_health_events_state_id_fkey`.

Remaining risk: Provider Health event history now rejects new orphan events.
This intentionally does not bind event status or `state_fingerprint` to the
current state row, because Provider Health events are historical snapshots and
the state row is updated in place. External probe execution, credential
handling, bulk migration, and long-range Provider Health timeline UI remain
separate follow-up work.

## 743. P2 landing record: Provider Health Event State Snapshot Coherence

This round tightens DB-backed registry event history beyond parent existence.
Provider Health event rows already had a required state-id check and FK, but a
direct write could still reference a real state row while changing the event's
provider, scope, or workspace identity.

`ai_provider_health_states` now exposes composite snapshot keys on
`(id, provider_id, scope_type)` and
`(id, provider_id, scope_type, workspace_id)`. `ai_provider_health_events`
uses `NOT VALID` composite foreign keys to those snapshots with
`ON UPDATE RESTRICT`, so new event rows cannot drift away from the referenced
state identity or workspace snapshot while historical rows remain upgrade
tolerant.

Prisma schema now names the Provider Health event state snapshot relations
separately from the simple state-id relation. The event relations remain
optional because historical rows are tolerated through `NOT VALID` constraints
and nullable workspace ids are needed for global health rows.

Focused backend coverage extends Provider Registry revision e2e coverage:
after proving missing and orphan state ids are rejected, it now verifies direct
inserts that present a workspace state as a global event fail on
`ai_provider_health_events_state_identity_fkey`, and inserts that move a
workspace event to another real workspace fail on
`ai_provider_health_events_state_workspace_fkey`.

Remaining risk: Provider Health event history now preserves provider/scope/
workspace identity for new state-linked events. This intentionally does not
bind event status, actor, provider type, or `state_fingerprint` to the current
state row because Provider Health state rows are updated in place and events
are historical snapshots. External probe execution, credential handling, bulk
migration, and long-range Provider Health timeline UI remain separate follow-up
work.

## 744. P2 landing record: Agent Runtime Timeline Step Snapshot Coherence

This round closes the remaining DB-level step-link drift called out after the
Agent Runtime child run snapshot slice. Timeline rows already preserved their
parent run workspace/actor snapshot, but a non-null `step_id` still used only a
single-column FK to `ai_agent_steps(id)`. Direct SQL could therefore point a
timeline event at a real step from another run while leaving the timeline row's
own run id, workspace id, and actor id unchanged.

`ai_agent_steps` now exposes a composite snapshot key on
`(id, run_id, workspace_id, actor_id)`. `ai_agent_timeline_events` uses a new
`NOT VALID` composite FK on `(step_id, run_id, workspace_id, actor_id)` with
`ON UPDATE RESTRICT`, so non-null step links cannot drift away from the
timeline row's run snapshot. The FK uses column-specific
`ON DELETE SET NULL ("step_id")`, preserving the existing behavior where
run-level timeline events have no step and deleted steps only clear the
optional step link.

Focused backend coverage extends the standalone record-only worker test: after
the run completes and run snapshot checks pass, it creates another real run
with a real step in the same workspace/actor scope and verifies that retargeting
a timeline event's `step_id` to that other run's step fails on
`ai_agent_timeline_events_step_snapshot_fkey`.

Remaining risk: Agent Runtime timeline rows now preserve both parent run
workspace/actor identity and non-null step-link run ownership at the DB
boundary. Run-level events intentionally continue to carry `step_id=NULL`.
Production tool/Codex/MCP/model adapters, live interruption semantics, and
executor-specific result schemas remain separate follow-up work.

## 745. P2 landing record: Support Bundle Manifest Identity Coherence

This round tightens Support Bundle Persistence around the manifest JSON snapshot
that GraphQL, artifact downloads, and manifest rewrite recovery expose. Support
bundle request rows already had row-level workspace/actor FKs and child
workspace snapshot FKs, but a direct write could still mutate
`manifest_json.bundleId`, `manifest_json.workspaceId`, `manifest_json.actorId`,
or `manifest_json.sourceEvidenceSetFingerprint` away from the durable request
columns while leaving the row itself joinable.

`ai_support_bundle_requests` now has a `NOT VALID`
`ai_support_bundle_requests_manifest_identity_check` constraint. It requires
`manifest_json` to remain an object and binds the embedded bundle id, workspace
id, actor id, and source evidence set fingerprint to the request row columns.
The constraint intentionally does not bind `manifest_fingerprint` to
`manifest_json`, because retention cleanup legitimately rewrites the manifest
snapshot and persisted fingerprint together.

Focused backend coverage extends support bundle e2e DB-boundary checks: after
verifying malformed manifest/source-evidence JSON is rejected, it now verifies
direct SQL that changes `manifest_json.workspaceId` fails on
`ai_support_bundle_requests_manifest_identity_check`.

Remaining risk: Support bundle request manifest identity now stays coherent at
the DB boundary. Deployment-specific object-storage notification workers still
need real provider signature verification before forwarding upstream evidence,
and broader packaged support-bundle contents remain separate follow-up work.

## 746. P2 landing record: Registry Publish Event Global Snapshot Coherence

This round tightens DB-backed registry publish event history for global rows.
The publish-event table already had family-specific parent FKs and composite
snapshot FKs including workspace and actor. For global events those columns are
null, and PostgreSQL's default composite FK `MATCH SIMPLE` semantics can skip
the whole snapshot check when any FK column is null.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision tables now expose publish-event identity keys that omit nullable
workspace and actor columns. `ai_registry_revision_publish_events` adds
family-specific `NOT VALID` composite foreign keys from revision id, scope,
registry identity, revision, revision fingerprint, and revision status back to
those parent identity snapshots, with `ON UPDATE RESTRICT` so direct SQL cannot
mutate parent identity out from under persisted event rows.

The existing workspace/actor snapshot FKs continue to protect workspace-scoped
events. The new identity FKs close the global-row gap while also strengthening
the non-null identity portion of workspace events. Focused Provider Registry
revision e2e coverage now inserts a global Prompt Registry publish event
directly and verifies revision fingerprint drift fails on
`ai_registry_publish_events_prompt_global_snapshot_fkey`.

Remaining risk: registry publish/reuse event rows now preserve parent revision
identity for both workspace and global scopes at the DB boundary. Full registry
editor timelines, prompt-body editing, bulk migration, Provider Registry
credential management, and broader registry UX remain separate follow-up work.

## 747. P1 landing record: Support Bundle Transfer Authorization Snapshot Update Restrict

This round tightens Support Bundle provider-transfer history after the durable
transfer-event slice. Transfer event rows already carried a composite download
authorization snapshot FK, but the original FK used `ON UPDATE CASCADE`. A
direct parent-row edit to authorization snapshot columns could therefore cascade
new values into historical transfer-event evidence instead of failing closed.

`ai_support_bundle_transfer_events_authorization_fkey` is recreated with the
same composite column set and `ON DELETE CASCADE`, but now uses
`ON UPDATE RESTRICT` and `NOT VALID`. The relationship still binds
authorization id, bundle, workspace, actor, artifact kind, manifest/artifact
fingerprints, authorization fingerprint, and delivery method to the persisted
download authorization row, while preventing direct SQL from silently rewriting
existing transfer-event snapshots through a parent authorization update.

Focused support bundle e2e coverage now extends the transfer-event persistence
DB-boundary test: after verified transfer events exist, updating the parent
authorization fingerprint is rejected on
`ai_support_bundle_transfer_events_authorization_fkey`.

Remaining risk: transfer-event authorization snapshots now fail closed on both
child drift and parent snapshot edits. Production object-storage webhook
forwarding, provider-specific signature verification, retry/dead-letter
handling, and broader packaged support-bundle contents remain separate
follow-up work.

## 748. P2 landing record: Agent Runtime Execution Result Snapshot Update Restrict

This round tightens Agent Runtime terminal execution-result history. The
execution-result ledger already had run/workspace/actor and workflow/source
snapshot FKs back to `ai_agent_runs`, but both used `ON UPDATE CASCADE`. A
direct parent run update could therefore cascade changed actor or source
evidence into terminal result rows instead of preserving the original ledger
snapshot or failing closed.

`ai_agent_runtime_execution_results_run_id_fkey` and
`ai_agent_runtime_execution_results_run_source_snapshot_fkey` are recreated
with the same column sets, `ON DELETE CASCADE`, `ON UPDATE RESTRICT`, and
`NOT VALID`. The first FK keeps execution results matched to the parent
run/workspace/actor snapshot. The second keeps workflow/source identity matched
to the parent run snapshot. Parent run snapshot edits now fail instead of
silently rewriting terminal execution-result evidence.

Focused Agent Runtime coverage extends the record-only worker e2e path: it
inserts an isolated run/result pair without step/timeline children and verifies
direct SQL updates to the parent run actor and source id fail on the two
execution-result snapshot FKs.

Remaining risk: terminal Agent Runtime execution results now fail closed on
child drift and parent run snapshot edits. Real production tool/Codex/MCP/model
adapters, live interruption semantics, and executor-specific result schemas
remain separate follow-up work.

## 749. P2 landing record: Repair Execution Side-Effect Snapshot Update Restrict

This round tightens the durable repair side-effect ledger. Side-effect rows
already carried a composite request/workspace/actor snapshot FK, but it still
used `ON UPDATE CASCADE`. A direct parent repair request update could therefore
cascade changed actor/workspace evidence into historical side-effect rows.

`ai_repair_execution_side_effects_execution_request_id_fkey` is recreated with
the same composite column set, `ON DELETE CASCADE`, `ON UPDATE RESTRICT`, and
`NOT VALID`. Completed constrained registry side effects now fail closed on
both child drift and parent request snapshot edits.

Focused repair execution e2e coverage extends the queued worker completion
path: after the worker writes a side-effect ledger row, updating the parent
repair request actor is rejected on
`ai_repair_execution_side_effects_execution_request_id_fkey`.

Remaining risk: the side-effect ledger now preserves request/workspace/actor
evidence at the DB boundary. Non-registry executors still need explicit
executor-specific side-effect schemas and idempotency contracts before they are
enabled.

## 750. P2 landing record: Registry Publish Event Workspace Snapshot Update Restrict

This round tightens DB-backed registry publish/reuse event history for
workspace-scoped rows. The previous global snapshot slice closed nullable
workspace/actor gaps, but the original workspace snapshot FKs still used
`ON UPDATE CASCADE`. A direct parent revision update could silently rewrite
historical publish event snapshot columns.

The Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
workspace snapshot FKs on `ai_registry_revision_publish_events` are recreated
with the same family-specific composite columns, `ON DELETE CASCADE`,
`ON UPDATE RESTRICT`, and `NOT VALID`. Publish/reuse event rows now fail closed
on child snapshot drift, global identity drift, and parent workspace revision
snapshot edits.

Focused Provider Registry revision e2e coverage extends the cross-family
publish-event history test: after publish events exist for all four registry
families, direct parent revision actor updates are rejected on each
family-specific snapshot FK.

Remaining risk: registry publish/reuse event rows now preserve parent revision
identity for workspace and global scopes at the DB boundary. Full registry
editor timelines, prompt-body editing, bulk migration, Provider Registry
credential management, and broader registry UX remain separate follow-up work.

## 751. P2 landing record: Registry Publish Event Workspace Actor Snapshot

This round closes a remaining nullable-column bypass in workspace-scoped
registry publish/reuse events. The workspace snapshot FKs bind actor id along
with revision id, scope, workspace, registry identity, revision, fingerprint,
and status, but PostgreSQL composite FK `MATCH SIMPLE` semantics skip the FK
when any referencing column is null. A direct SQL write could therefore null a
workspace event's `actor_id` and remove `metadata.actorId`, leaving the event
metadata internally consistent while bypassing the workspace/actor snapshot FK.

`ai_registry_revision_publish_events_workspace_actor_check` now requires
`actor_id` for `scope_type='workspace'` rows while preserving nullable actor
ids for global rows. The existing global snapshot FKs continue to cover global
identity, and the workspace snapshot FKs now cannot be bypassed by nulling the
actor evidence on workspace rows.

Focused Provider Registry revision e2e coverage extends the cross-family
publish-event history test by attempting to null a workspace Prompt Registry
publish event actor and remove the matching metadata field. The write is
rejected on `ai_registry_revision_publish_events_workspace_actor_check`.

Remaining risk: registry publish/reuse event rows now preserve parent revision
identity for workspace and global scopes without nullable actor bypasses at the
DB boundary. Full registry editor timelines, prompt-body editing, bulk
migration, Provider Registry credential management, and broader registry UX
remain separate follow-up work.

## 752. P2 landing record: Support Bundle Download Authorization Manifest Snapshot

This round tightens Support Bundle download authorization history at the write
boundary. Authorization rows already preserved the parent bundle workspace
snapshot, and bundle request rows preserve their embedded manifest identity, but
a direct write could still create or mutate a download authorization with a
manifest fingerprint that did not match the parent support bundle snapshot at
the time the authorization was written.

`ai_support_bundle_download_authorizations` now has a
`ai_support_bundle_download_authorizations_manifest_snapshot_check` trigger. On
authorization insert or update of `bundle_id` or `manifest_fingerprint`, it
requires `(bundle_id, workspace_id, manifest_fingerprint)` to match the current
parent `ai_support_bundle_requests` row. The guard intentionally stays as a
point-in-time trigger rather than a normal composite FK, because retention
cleanup can legitimately rewrite the parent bundle manifest snapshot and
fingerprint after historical authorizations exist. Workspace drift continues to
fail through the existing `ai_support_bundle_auth_bundle_workspace_snapshot_fkey`
rather than being reclassified by the trigger.

Focused support bundle e2e coverage extends the DB-boundary checks by verifying
that direct authorization manifest-fingerprint drift and invalid authorization
inserts are rejected on the new trigger, while workspace drift still fails on
the workspace snapshot FK.

Remaining risk: download authorization rows now capture a DB-validated support
bundle manifest snapshot at write time without blocking later retention
manifest rewrites. Production object-storage webhook forwarding,
provider-specific signature verification, retry/dead-letter handling, and
broader packaged support-bundle contents remain separate follow-up work.

## 753. P2 landing record: Registry Publish Event Actor Snapshot Coherence

This round tightens DB-backed registry publish/reuse event history for rows
that capture actor evidence. The previous workspace actor check closed the
workspace-row nullable actor bypass, and the global snapshot FKs closed global
revision identity drift. However, a global event could still carry an
`actor_id` and matching `metadata.actorId` that was not bound to the parent
revision actor because the workspace-scoped snapshot FK is skipped when
`workspace_id` is null.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision tables now expose actor snapshot keys that omit nullable workspace
columns while retaining actor identity. `ai_registry_revision_publish_events`
adds family-specific `NOT VALID` composite FKs from revision id, scope, actor,
registry identity, revision, fingerprint, and status back to those parent
snapshots with `ON UPDATE RESTRICT`. Rows with `actor_id=NULL` remain
upgrade-compatible and continue to rely on the existing global identity FKs;
workspace rows still require actor evidence through the workspace actor check.

Focused Provider Registry revision e2e coverage extends the publish-event
history test by inserting a global Prompt Registry publish event with actor
evidence, then verifying both child event actor drift and parent revision actor
drift fail on `ai_registry_publish_events_prompt_actor_snapshot_fkey`.

Remaining risk: registry publish/reuse event rows now preserve parent revision
identity for workspace and global scopes, including present actor evidence,
without forcing legacy/global actorless rows to change. Full registry editor
timelines, prompt-body editing, bulk migration, Provider Registry credential
management, and broader registry UX remain separate follow-up work.

## 754. P2 landing record: Support Bundle Download Authorization Archive Snapshot

This round tightens Support Bundle download authorization history for archive
artifacts. Manifest authorizations already require `artifact_fingerprint` to
match `manifest_fingerprint`, and download/acknowledgement paths revalidate the
archive fingerprint before serving or accepting completion telemetry. Direct SQL
could still insert or mutate an `archive_json` authorization whose
`artifact_fingerprint` did not match the parent support bundle archive
fingerprint at authorization write time.

`ai_support_bundle_download_authorizations` now has a
`ai_support_bundle_download_authorizations_archive_snapshot_check` trigger. The
trigger runs before insert or update of `bundle_id`, `artifact_kind`, or
`artifact_fingerprint`, applies only to `archive_json` rows, and requires
`(bundle_id, workspace_id, artifact_fingerprint)` to match the current parent
`ai_support_bundle_requests.archive_fingerprint`. `manifest_json`
authorizations continue to rely on the existing manifest/artifact equality
constraint and are intentionally ignored by this archive-only guard.

Focused support bundle e2e coverage extends DB-boundary checks by creating a
valid archive authorization, verifying direct artifact-fingerprint drift fails
on the archive snapshot trigger, and verifying mismatched archive authorization
inserts are rejected with the same constraint.

Remaining risk: archive authorization rows now capture a DB-validated support
bundle archive artifact snapshot at write time. Production object-storage
webhook forwarding, provider-specific signature verification,
retry/dead-letter handling, and broader packaged support-bundle contents remain
separate follow-up work.

## 755. P2 landing record: Provider Health Event Write Snapshot Coherence

This round tightens DB-backed Provider Health event history at the write
boundary. Event rows already had non-orphan state-id integrity plus provider,
scope, and workspace snapshot FKs, but the FKs intentionally did not bind
`state_fingerprint` or actor evidence because Provider Health state rows are
updated in place and events are historical snapshots. A direct SQL write could
therefore create a new event with a fabricated state fingerprint or mismatched
actor while still passing the existing identity FKs.

`ai_provider_health_events` now has an
`ai_provider_health_events_write_snapshot_check` trigger. On insert or direct
updates of `state_id` or `state_fingerprint`, when the referenced state row
exists, the event must carry the current parent state fingerprint. If the event
also carries `actor_id`, that actor must match the current state actor at write
time, and actorless events must correspond to actorless state snapshots. Direct
event actor rewrites are checked too, while database FK-driven actor cleanup can
still clear user references without invalidating historical event rows. The
guard deliberately remains a point-in-time trigger instead of a normal FK so
later Provider Health state updates do not rewrite or invalidate historical
event rows. Actorless global configured-snapshot worker events remain valid.

Focused Provider Registry revision e2e coverage extends the Provider Health
DB-boundary checks by verifying direct event state-fingerprint drift and
write-time actor drift are rejected on the new trigger, while configured
snapshot worker events still persist with null actor evidence.

Remaining risk: Provider Health event rows now validate their state
fingerprint and present actor evidence at write time without changing mutable
state-row history semantics. Live external provider probes, provider
credential workflows, full health timelines, and broader Provider Registry UX
remain separate follow-up work.

## 756. P2 landing record: Support Bundle Transfer Storage Snapshot

This round tightens direct object-storage transfer event history. Transfer
event rows already preserved the download authorization snapshot and rejected
malformed notification auth evidence, but the DB layer only checked basic
storage evidence shape. A direct SQL write could create or mutate a transfer
event with a storage key, byte size, content type, or artifact fingerprint that
did not match the support bundle artifact metadata previously verified by the
application storage path.

`ai_support_bundle_transfer_events` now has
`ai_support_bundle_transfer_events_storage_snapshot_check`. On insert or direct
updates of bundle/workspace, artifact kind/fingerprint, or storage evidence,
the trigger requires `manifest_json` rows to match the parent bundle manifest
storage key, byte size, MIME type, and fingerprint, and requires
`archive_json` rows to match the parent bundle archive storage key, byte size,
MIME type, and fingerprint. The guard is a point-in-time trigger rather than a
normal FK so later retention cleanup and manifest rewrites do not invalidate
historical transfer evidence.

Focused support bundle e2e coverage extends the direct-transfer DB-boundary
checks by verifying transfer event storage-key drift, byte-size drift, and
mismatched storage-evidence inserts are rejected on the new trigger.

Remaining risk: direct-transfer event storage evidence now matches the bundle
artifact snapshot at write time. Deployment-specific object-storage
notification workers still need real provider signature verification before
forwarding `verified_by_upstream` evidence, and broader packaged
support-bundle contents remain separate follow-up work.

## 757. P2 landing record: Agent Runtime Execution Result Terminal Snapshot

This round tightens Agent Runtime terminal execution-result evidence beyond
the existing parent run identity/source snapshot FKs. The ledger already kept
result rows tied to run/workspace/actor and workflow/source snapshots, but a
direct SQL write could still insert or mutate a result for a non-terminal run,
use the wrong worker attempt, drift the completed timestamp, or leave the JSON
payload `completedAt` out of sync with the indexed column. A parent run with an
existing result could also have terminal status fields edited away from the
ledger evidence.

`ai_agent_runtime_execution_results` now has
`ai_agent_runtime_execution_results_terminal_snapshot_check` plus a dedicated
payload timestamp guard. Result inserts and direct updates of run/status,
failure diagnostics, worker attempt, completed timestamp, or payload
`completedAt` must match the current terminal parent run snapshot for
standalone completed/failed outcomes. `ai_agent_runs` now also has
`ai_agent_runs_execution_result_terminal_snapshot_check`, so direct parent run
updates cannot drift terminal status, failure diagnostics, or completed time
for the attempt that already has a result row. The trigger deliberately allows
manual resume from a failed/cancelled run to `queued` while preserving the
prior-attempt result history; same-attempt direct running bypasses remain
rejected until the worker lease increments the attempt.

Focused Agent Runtime e2e coverage extends the record-only DB-boundary checks
with result completed-time drift, payload completed-time drift, and parent
terminal-field drift assertions. A new resume regression test verifies failed
worker result history remains visible across manual resume, then proves direct
same-attempt running bypass is rejected while a normal new worker lease moves
the run to attempt 2.

Remaining risk: terminal execution-result history now preserves status,
attempt, timestamp, failure, payload, actor, and workflow/source evidence at
the DB boundary. Real production tool/Codex/MCP/model adapters still need
executor-specific result schemas, interruption semantics, side-effect
contracts, and concrete implementations.

## 758. P2 landing record: Repair Execution Side-Effect Result Snapshot

This round tightens the durable Repair Execution side-effect ledger beyond
request/workspace/actor snapshot FKs and rollback-contract shape checks. The
ledger already retained side-effect identity, summary, executor payload
fingerprint, worker attempt, worker lease, and applied time, but direct SQL
could still mutate that ledger away from the terminal request `runtime_result`
or mutate the parent request after the ledger row existed.

`ai_repair_execution_side_effects` now has
`ai_repair_execution_side_effects_result_snapshot_check`. On insert or direct
updates of request/workspace, side-effect identity, summary, executor payload
fingerprint, worker attempt, or applied time, the row must match a completed
parent repair request with `runtime_result.sideEffectsApplied=true`, matching
side-effect kind/record/fingerprint/summary, matching actor evidence, matching
worker attempt, matching completed timestamp, null failure diagnostics, and no
active worker lease. The ledger `executor_payload_fingerprint` is immutable
after write. `ai_repair_execution_requests` now also has
`ai_repair_execution_requests_side_effect_result_snapshot_check`, so parent
result/status/failure/lease/attempt/completed-time edits cannot drift away from
an existing side-effect row, and
`ai_repair_execution_requests_side_effect_executor_payload_snapshot_check`
freezes the parent `executor_payload` once durable side-effect evidence exists.

Focused repair execution e2e coverage extends the prompt-registry side-effect
DB-boundary checks by verifying side-effect fingerprint drift, applied-time
drift, ledger executor-payload fingerprint drift, parent runtime-result drift,
parent completed-time drift, parent executor-payload drift, and parent actor
drift rejection. Disposable Postgres smoke coverage applies the full migration
chain, writes a legal completed side-effect row, verifies legal no-op updates,
and proves side-effect summary, worker-attempt, and executor-payload drifts
reject on the expected DB constraints.

Remaining risk: Repair Execution side-effect history now preserves terminal
request result, timestamp, attempt, actor, failure/lease absence, and
executor-payload provenance at the DB boundary. Rollback execution, live
interruption/manual resume semantics, and executor-specific side-effect
idempotency contracts for future non-registry executors remain separate
follow-up work.

## 759. P2 landing record: DB-backed Registry Revision Content Update Restrict

This round tightens DB-backed registry revisions after publish-event history
exists. Publish events already preserve revision id, scope, registry identity,
actor/workspace evidence, revision, status, and fingerprint snapshots, but a
direct SQL update could still mutate the parent revision's content-bearing JSON
or source-chain metadata while leaving the fingerprint and historical
publish/reuse events unchanged.

Prompt Registry revisions now reject direct updates to `fallback_source_chain`
or `metadata` after a publish event exists. Task Route Policy revisions reject
direct updates to route content (`model_id`, `config_key`, `config_path`) plus
source-chain/metadata fields after event history exists. Model Registry
revisions reject direct updates to `model_definition`, `fallback_source_chain`,
or `metadata` once published, and Provider Registry revisions reject direct
updates to `provider_type`, `provider_profile`, `fallback_source_chain`, or
`metadata` once published. The triggers are intentionally scoped to rows with
`ai_registry_revision_publish_events`, preserving upgrade compatibility for
legacy no-event rows and keeping hydration sanitizer regression coverage
possible without weakening published history.

Focused Provider Registry e2e coverage extends the cross-family publish-event
DB-boundary checks by verifying published Prompt Registry metadata drift, Task
Route Policy model drift, Model Registry definition drift, and Provider
Registry profile drift are rejected on the new content update restrictions.
The Model and Provider hydration safety regressions now seed legacy no-event
rows directly, so they continue to prove malformed historical payloads hydrate
safely without requiring published content mutation. Disposable Postgres smoke
coverage applies the full migration chain, proves a no-event Prompt Registry
row can still be updated, then inserts a publish event and verifies metadata
and source-chain drift reject on the new constraint.

Remaining risk: DB-backed registry publish history now preserves published
content evidence as well as identity/status/fingerprint snapshots at the DB
boundary. Full editable registry UIs, bulk migration tooling, diff/review
workflows, credential management, and registry-specific rollback or archival
semantics remain separate follow-up work.

## 760. P2 landing record: Agent Runtime Execution Result Content Update Restrict

This round tightens Agent Runtime terminal execution-result history after the
terminal snapshot work. Result rows already had run/workspace/actor and
workflow/source snapshot FKs, terminal parent-run status/attempt/time/failure
coherence, and payload `completedAt` coherence, but a direct SQL update could
still keep those indexed fields aligned while rewriting the result row's own
content evidence, such as summary, payload, result fingerprint, adapter,
executor, side-effect evidence, or worker lease id.

`ai_agent_runtime_execution_results` now has
`ai_agent_runtime_execution_results_content_update_restrict_check`. After a
terminal result row exists, direct updates to `adapter_workflow`, `executor`,
`side_effect_mode`, `side_effects_applied`, `summary`, `result_payload`,
`result_fingerprint`, or `worker_lease_id` are rejected. The trigger is scoped
to content evidence, leaving the existing status/payload, run snapshot,
terminal parent-run snapshot, and payload timestamp checks to keep reporting
their more specific constraint names for status, failure, attempt, timestamp,
actor, and workflow/source drift.

Focused Agent Runtime e2e coverage extends the record-only execution-result
DB-boundary checks by verifying coherent summary/payload drift and
result-fingerprint drift reject on the new content update restriction.
Terminal stale-lease result coverage now also verifies worker-lease evidence
cannot be rewritten after the failed result row is persisted.

Remaining risk: Agent Runtime terminal execution-result history now preserves
parent terminal state and result content evidence at the DB boundary. Real
tool/Codex/MCP/model adapters still need executor-specific result schemas,
redaction policies, side-effect/idempotency contracts, interruption semantics,
and concrete implementations.

## 761. P2 landing record: Support Bundle Audit Event Content Update Restrict

This round tightens support bundle lifecycle audit history after the durable
audit/read exposure and transfer-event snapshot work. Audit rows already
persisted bundle/workspace/actor, event type, metadata, fingerprint, and
creation time with row-shape and event-specific metadata constraints, but a
direct SQL update could still keep metadata structurally valid while rewriting
the historical evidence that support bundle reads, Admin, cleanup retry, and
transfer diagnostics consume.

`ai_support_bundle_audit_events` now has
`ai_support_bundle_audit_events_content_update_restrict_check`. After an audit
row exists, direct updates that change `id`, `bundle_id`, `workspace_id`,
`actor_id`, `event_type`, `event_fingerprint`, `metadata`, or `created_at` are
rejected. The trigger permits true no-op updates and runs after the existing
row-shape, metadata-contract, and workspace-snapshot checks, so malformed
writes still report the older specific constraints while coherent audit
evidence rewrites hit the new append-only audit boundary.

Focused support bundle e2e coverage extends the persisted create/read
DB-boundary flow by verifying a no-op audit update still passes, coherent
`created` metadata drift rejects on the new content update restriction,
event-fingerprint drift rejects on the new restriction, and same-bundle actor
retargeting rejects before lifecycle audit consumers can observe rewritten
history.

Remaining risk: support bundle lifecycle audit rows now preserve audit content
evidence as append-only DB history. Deployment-specific object-storage
notification workers still need real provider signature verification before
forwarding `verified_by_upstream` evidence to the internal transfer endpoint.

## 762. P2 landing record: Agent Runtime Timeline Event Content Update Restrict

This round tightens Agent Runtime timeline history after the run/step snapshot
and execution-result content work. Timeline events already preserved
run/workspace/actor and step snapshot coherence, status vocabulary, ordinal
shape, payload object shape, event fingerprint shape, summary shape, and
workflow-specific payload contracts, but a direct SQL update could still keep
those values structurally valid while rewriting timeline content evidence after
readers and workers had durable history.

`ai_agent_timeline_events` now has
`ai_agent_timeline_events_content_update_restrict_check`. After a timeline row
exists, direct updates that change `id`, `run_id`, `step_id`, `workspace_id`,
`actor_id`, `event_type`, `status`, `ordinal`, `summary`, `payload`,
`event_fingerprint`, or `created_at` are rejected. The trigger permits true
no-op updates and runs after existing row-shape, payload-contract,
run-snapshot, and step-snapshot checks, so malformed writes still report their
older specific constraints while coherent timeline rewrites hit the new
append-only boundary.

Focused Agent Runtime e2e coverage extends the DB-boundary row-shape checks by
verifying no-op timeline updates still pass, coherent summary/payload rewrites
reject on the new content update restriction, and event-fingerprint rewrites
reject on the same restriction. Legacy malformed timeline hydration coverage
now seeds a direct historical row instead of mutating an existing persisted
timeline event, preserving upgrade-tolerance coverage without weakening future
timeline immutability.

Remaining risk: Agent Runtime timeline history now preserves event content
evidence as append-only DB history. Real tool/Codex/MCP/model adapters still
need executor-specific timeline schemas, redaction policies,
side-effect/idempotency contracts, interruption semantics, and concrete
implementations.

## 763. P2 landing record: Repair Execution Audit Event Content Update Restrict

This round tightens repair execution lifecycle audit history after audit read
exposure, request workspace snapshot coherence, and worker/control metadata
contracts. Audit rows already persisted execution request/workspace/actor,
event type, event fingerprint, metadata, and creation time with row-shape,
metadata-contract, fingerprint, and workspace-snapshot checks, but a direct SQL
update could still keep those values structurally valid while rewriting
historical lifecycle evidence after Admin, Agent Runtime, support bundle,
worker, or recovery consumers had durable history.

`ai_repair_execution_audit_events` now has
`ai_repair_execution_audit_events_content_update_restrict_check`. After an
audit row exists, direct updates that change `id`, `execution_request_id`,
`workspace_id`, `actor_id`, `event_type`, `event_fingerprint`, `metadata`, or
`created_at` are rejected. The trigger permits true no-op updates and runs
after existing row-shape, metadata-contract, fingerprint, and request
workspace-snapshot checks, so malformed writes still report the older specific
constraints while coherent lifecycle-audit rewrites hit the new append-only
boundary.

Focused repair execution e2e coverage extends the durable request
DB-boundary flow by verifying a no-op audit update still passes, coherent
`requested` metadata drift rejects on the new content update restriction,
event-fingerprint drift rejects on the new restriction, and same-request actor
retargeting rejects before lifecycle audit consumers can observe rewritten
history.

Remaining risk: repair execution lifecycle audit rows now preserve audit
content evidence as append-only DB history. Rollback execution, live
interruption/manual resume semantics, and executor-specific side-effect
idempotency contracts for future non-registry executors remain separate
follow-up work.

## 764. P2 landing record: Registry Publish Event Content Update Restrict

This round tightens DB-backed registry publish/reuse history after event
history persistence, global/actor snapshot coherence, and published revision
content restrictions. Publish-event rows already enforced family/scope/status
vocabulary, metadata/column coherence, event fingerprint shape, family-specific
revision FKs, parent snapshot FKs, and read exposure, but a direct SQL update
could still keep the row structurally valid while rewriting publish-source,
metadata, event fingerprint, or other event evidence after diagnostics and
registry readers had durable history.

`ai_registry_revision_publish_events` now has
`ai_registry_revision_publish_events_content_update_restrict_check`. After a
publish event exists, direct updates that change event identity, registry family
linkage, revision snapshot columns, workspace/actor evidence, event/source
fields, `event_fingerprint`, `metadata`, or `created_at` are rejected. The
trigger permits true no-op updates and runs after existing row-shape, metadata,
family, workspace actor, and snapshot checks, so malformed writes still report
the older specific constraints while coherent publish-event rewrites hit the
new append-only boundary.

Focused registry revision e2e coverage extends the publish/reuse history flow
by verifying a no-op publish-event update still passes, coherent
publish-source/metadata drift rejects on the new restriction, event-fingerprint
drift rejects on the same restriction, and existing malformed metadata, family,
workspace actor, and parent snapshot drift checks remain active.

Remaining risk: DB-backed registry publish-event rows now preserve event
content evidence as append-only DB history. Registry editor timeline UI, bulk
history migration workflows, and additional operator-facing diff views remain
separate follow-up work.

## 765. P2 landing record: Support Bundle Transfer Event Content Update Restrict

This round tightens direct object-storage transfer history after transfer-event
persistence, authorization snapshot update restrict, storage snapshot checks,
read exposure, and audit append-only work. Transfer-event rows already enforced
artifact/delivery vocabulary, fingerprint shape, notification auth evidence,
authorization snapshot FKs, and storage evidence checks, but a direct SQL update
could still keep the row structurally valid while rewriting provider event
source, notification auth evidence, event fingerprint, or other transfer
evidence after support bundle reads and Admin had durable history.

`ai_support_bundle_transfer_events` now has
`ai_support_bundle_transfer_events_content_update_restrict_check`. After a
transfer event exists, direct updates that change authorization linkage,
bundle/workspace/actor evidence, artifact or authorization fingerprints,
delivery method, event id/source, transfer time, notification auth evidence,
notification-auth fingerprint, storage evidence, `event_fingerprint`, or
`created_at` are rejected. The trigger permits true no-op updates and runs after
existing auth-evidence, authorization-snapshot, and storage-snapshot checks, so
malformed writes still report the older specific constraints while coherent
transfer-event rewrites hit the new append-only boundary.

Focused support bundle e2e coverage extends the direct-transfer event history
flow by verifying a no-op transfer-event update still passes, coherent
event-source/notification-auth evidence drift rejects on the new restriction,
event-fingerprint drift rejects on the same restriction, and existing malformed
auth-evidence and storage-snapshot drift checks remain active.

Remaining risk: support bundle transfer-event rows now preserve object-storage
transfer evidence as append-only DB history. Deployment-specific provider
webhook adapters still need real signature verification before forwarding
`verified_by_upstream` evidence to the internal transfer endpoint.

## 766. P2 landing record: Repair Execution Side-effect Content Update Restrict

This round tightens the durable Repair Execution side-effect ledger after
side-effect persistence, request snapshot update restrict, terminal result
snapshot checks, read exposure, and lifecycle audit append-only work. Side-effect
rows already enforced side-effect kind, string/fingerprint shape, rollback
contract shape, parent request snapshot coherence, and terminal runtime-result
coherence, but a direct SQL update could still keep the row structurally valid
while rewriting worker lease evidence, creation time, or other ledger evidence
after repair reads, Admin, Agent Runtime, and support bundle consumers had
durable history.

`ai_repair_execution_side_effects` now has
`ai_repair_execution_side_effects_content_update_restrict_check`. After a
side-effect ledger row exists, direct updates that change ledger identity,
request/workspace/actor linkage, side-effect identity, side-effect fingerprint,
summary, executor payload fingerprint, worker attempt, worker lease id,
`applied_at`, or `created_at` are rejected. The trigger permits true no-op
updates and runs after existing row-shape, rollback-contract, result-snapshot,
and executor-payload fingerprint checks, so malformed writes still report the
older specific constraints while coherent ledger rewrites hit the new
append-only boundary.

Focused repair execution e2e coverage extends the worker-completion
side-effect ledger flow by verifying a no-op side-effect update still passes,
worker lease evidence drift rejects on the new restriction, creation-time drift
rejects on the same restriction, and existing rollback-contract,
result-snapshot, executor-payload, and request-snapshot drift checks remain
active.

Remaining risk: constrained repair side-effect ledger rows now preserve
side-effect content evidence as append-only DB history. Rollback execution,
live interruption/manual resume semantics, and executor-specific side-effect
idempotency contracts for future non-registry executors remain separate
follow-up work.

## 767. P2 landing record: Provider Health Event Content Update Restrict

This round tightens DB-backed Provider Health event history after event
persistence, state-id integrity, state snapshot coherence, write-time snapshot
checks, and read exposure. Provider Health event rows already enforced status,
source, scope, event/source/publish-source coherence, metadata shape, state FK
integrity, state identity/workspace snapshots, and state fingerprint/actor
write snapshots, but a direct SQL update could still keep the row structurally
valid while rewriting metadata, event fingerprint, timestamps, or other event
evidence after provider routing, mutation responses, and Admin diagnostics had
durable transition history.

`ai_provider_health_events` now has
`ai_provider_health_events_content_update_restrict_check`. After an event row
exists, direct updates that change event identity, state linkage, provider/
scope/workspace/actor evidence, status, checked time, last error, source, event
type, `fingerprint`, `state_fingerprint`, `metadata`, or `created_at` are
rejected. The trigger permits true no-op updates and runs after existing
row-shape, metadata-contract, state-id, state-snapshot, and write-snapshot
checks, so malformed writes still report the older specific constraints while
coherent event rewrites hit the new append-only boundary.

Focused Provider Health e2e coverage extends the existing event-history
DB-boundary flow by verifying a no-op event update still passes, coherent
metadata drift rejects on the new restriction, event-fingerprint drift rejects
on the same restriction, and existing state/snapshot drift checks remain active.

Remaining risk: Provider Health event rows now preserve transition evidence as
append-only DB history. External network probe execution, provider credential
workflows, and fuller operator timeline UI remain separate follow-up work.

## 768. P2 landing record: Agent Runtime Execution Result Full Content Update Restrict

This round closes the remaining Agent Runtime execution-result ledger mutation
gap after the first content-restrict slice. The earlier trigger protected the
main result content fields, while parent-run snapshot FKs and terminal
payload/status checks protected their own mismatch cases. A direct SQL update
could still target unlisted result columns such as result id, run/source
snapshot identity, status/failure evidence, worker attempt, completion time, or
creation time and rely on narrower semantic checks rather than a uniform
append-only ledger boundary.

`ai_agent_runtime_execution_results_content_update_restrict_check` now compares
the full persisted row. After a terminal result row exists, any direct update
that changes result identity, run/workspace/actor snapshot, workflow/source
snapshot, adapter/executor evidence, result status, side-effect evidence,
summary, failure evidence, payload, fingerprint, worker attempt, worker lease,
completion time, or `created_at` rejects on the content update restriction. The
replacement trigger uses the `zz_` ordering pattern so existing status/payload,
run-source snapshot, terminal parent-run snapshot, and payload `completedAt`
checks still report their more specific constraints first.

Focused Agent Runtime e2e coverage now verifies a true no-op result update
passes, while result id drift and creation-time drift reject on the same
content update restriction as summary/payload, result-fingerprint, and
worker-lease drift.

Remaining risk: Agent Runtime terminal execution-result ledger rows now follow
the same full-row append-only pattern as timeline events, repair side-effect
rows, support transfer events, registry publish events, and Provider Health
events. Real tool/Codex/MCP/model adapters still need executor-specific result
schemas, redaction policies, side-effect/idempotency contracts, interruption
semantics, and concrete implementations.

## 769. P2 landing record: Support Bundle Request Evidence Update Restrict

This round tightens the mutable support bundle request row after audit
append-only work and transfer-event persistence. Request rows are intentionally
mutable for lifecycle fields such as retention expiry, failure evidence,
download cleanup eligibility, and timestamps, but direct SQL could still rewrite
creation-time source evidence, archive identity, manifest storage identity, or
request creation time after bundle reads, Admin, cleanup, downloads, and transfer
diagnostics had consumed the row.

`ai_support_bundle_requests` now has
`ai_support_bundle_requests_evidence_update_restrict_check`. The trigger rejects
direct updates that change request identity, workspace/actor linkage, source
evidence summary/fingerprint, manifest storage identity, archive storage
identity/fingerprint, or `created_at`. It still permits true no-op updates,
status/retention/failure/expiry lifecycle changes, and the existing retention
cleanup manifest rewrite path. That path is constrained to active-to-expired
transitions where only manifest retention fields, manifest fingerprint, and
manifest byte size change.

Focused support bundle e2e coverage now verifies no-op request updates pass,
while source evidence rewrites, archive-fingerprint drift, and creation-time
drift reject on the new restriction. The malformed manifest/source-evidence
hydration regression now seeds a direct legacy row instead of mutating a newly
created bundle, preserving historical upgrade tolerance without weakening future
request evidence immutability.

Remaining risk: support bundle request source/archive evidence is now stable
after persistence while lifecycle expiry and manifest-retention rewrites remain
available. Deployment-specific object-storage notification workers still need
real provider signature verification before forwarding `verified_by_upstream`
transfer evidence, and broader operator-facing bundle diff/recovery UI remains
separate follow-up work.

## 770. P2 landing record: Support Bundle Download Authorization Evidence Update Restrict

This round tightens support bundle download authorization rows after manifest
snapshot, archive snapshot, direct-delivery, downloaded-at/status, transfer
event, and request-evidence guard work. Authorization rows are intentionally
mutable for consumption and expiration lifecycle state, but direct SQL could
still rewrite issued artifact evidence, token fingerprint, direct URL evidence,
expiry, or creation time after the authorization had been returned to clients
and later consumed by API-proxy downloads, direct-download acknowledgements,
provider transfer events, cleanup, or Admin diagnostics.

`ai_support_bundle_download_authorizations` now has
`ai_support_bundle_download_authorizations_evidence_update_restrict_check`. The
trigger rejects direct updates that change authorization identity,
bundle/workspace/actor linkage, artifact kind/name/MIME evidence,
manifest/artifact fingerprints, authorization fingerprint, token fingerprint,
delivery method, direct-download URL evidence, expiration time, or `created_at`.
It still permits true no-op updates and lifecycle-only changes to `status`,
`downloaded_at`, and `updated_at`, preserving API-proxy consumption,
object-storage signed URL acknowledgement, provider transfer notifications, and
scheduled/manual expiration behavior.

Focused support bundle e2e coverage now verifies no-op authorization updates
pass, while token-fingerprint drift, expiration drift, and creation-time drift
reject on the new restriction. Existing manifest/archive snapshot, delivery
shape, direct-expiry, downloaded-at/status, timestamp, and string/fingerprint
checks continue to own their specific malformed-write cases.

Remaining risk: issued support bundle authorization evidence is now stable
after persistence while consumption/expiration lifecycle state remains mutable.
Deployment-specific object-storage notification workers still need real provider
signature verification before forwarding `verified_by_upstream` transfer
evidence, and broader operator-facing authorization revocation/recovery UI
remains separate follow-up work.

## 771. P2 landing record: Repair Execution Request Evidence Update Restrict

This round tightens mutable repair execution request rows after audit-event
append-only work, queued worker leasing, terminal side-effect ledger snapshots,
and side-effect content immutability. Request rows intentionally change as they
move through approval, queued, running, failed, completed, cancelled, retry, and
stale-recovery lifecycle states, but direct SQL could still rewrite the original
request identity, source/repair fingerprints, executor payload, or creation time
after Agent Runtime, Admin, audit rows, side-effect ledgers, and registry
publishers had consumed that evidence.

`ai_repair_execution_requests` now has
`ai_repair_execution_requests_evidence_update_restrict_check`. The trigger
rejects direct updates that change request id, workspace/actor linkage, prompt
target, requested action, permission status, idempotency key/fingerprint,
request fingerprint, candidate/task-route evidence fingerprints, target locator,
repair job, approval record, audit event fingerprint, executor payload, or
`created_at`. It still permits true no-op updates and lifecycle/result changes
to status, approval state, runtime result, failure fields, queued time, worker
lease, attempt counters, completion time, and `updated_at`, preserving approval,
worker, manual control, retry, and stale-recovery transitions. Existing shape,
timestamp, worker lease, side-effect result, rollback-contract, and
executor-payload/side-effect-kind constraints still own their malformed-write
cases before the new append-only evidence boundary runs.

Focused repair execution e2e coverage now verifies no-op request updates pass,
while valid-looking request-fingerprint drift, executor-payload drift, and
creation-time drift reject on the new evidence restriction. Unsupported
executor payload worker coverage now seeds the unsupported payload as original
request evidence rather than mutating a normal request after persistence, and
manual retry coverage uses a real transient terminal failure path. Deterministic
unsupported or invalid executor-payload failures now fail closed on manual retry
unless a future audited payload-correction workflow is added.

Remaining risk: repair request evidence and executor payloads are now stable
after insert while lifecycle execution state remains mutable. Future
non-registry executors still need executor-specific payload schemas,
side-effect idempotency contracts, redaction policies, and any real audited
payload-correction or operator-resume workflow before those controls are
enabled.

## 772. P2 landing record: Agent Runtime Run/Step Evidence Update Restrict

This round tightens mutable Agent Runtime run and step rows after timeline event
append-only history, execution-result ledger immutability, child run snapshots,
and step-level timeline snapshots. Run and step rows intentionally mutate as
workers lease, complete, fail, cancel, resume, recover stale leases, and
synchronize repair execution state, but direct SQL could still rewrite
creation-time workflow/source identity, target/evidence fingerprints, step
identity, or creation timestamps after Admin, support bundle, timeline, and
execution-result consumers had durable evidence.

`ai_agent_runs` now has `ai_agent_runs_evidence_update_restrict_check`. The
trigger rejects direct updates that change run id, workspace/actor linkage,
workflow/source identity, title, target fingerprint, evidence fingerprint,
`started_at`, or `created_at`. It still permits lifecycle changes to status,
timeline fingerprint, completion time, failure fields, queued time, worker
lease, attempt counters, last attempt, and update time.

`ai_agent_steps` now has `ai_agent_steps_evidence_update_restrict_check`. The
trigger rejects direct updates that change step id, run/workspace/actor linkage,
step key, title, order, evidence fingerprint, `started_at`, or `created_at`.
It still permits lifecycle changes to status, repair-sync step type,
`output_summary`, completion time, and update time. Existing shape, timestamp,
snapshot, worker payload, repair payload, and manual-control constraints still
own their malformed-write cases before these new `zz_` evidence restrictions.

Focused Agent Runtime e2e coverage now verifies no-op run and step updates
pass, while valid-looking run target/evidence fingerprint drift,
run creation-time drift, step evidence-fingerprint drift, step creation-time
drift, and step actor drift reject on the new restrictions. Existing invalid
identity, fingerprint, title, order, timestamp, JSON, and payload-contract tests
continue to assert their older specific constraints.

Remaining risk: Agent Runtime mutable state rows now preserve creation-time
run/step evidence while lifecycle state remains mutable. Future production
tool/Codex/MCP/model adapters still need executor-specific input/result schemas,
redaction policies, side-effect/idempotency contracts, and interruption/resume
semantics before arbitrary workflows are enabled.

## 773. P2 landing record: Registry Revision Insert-Time Content Immutability

This round removes the remaining no-event mutation gap in DB-backed registry
revision rows. The prior content restriction only rejected updates after a
publish/reuse event existed, which protected published history but still let a
direct SQL write mutate otherwise valid Prompt Registry metadata/source chains,
Task Route Policy route content, Model Registry definitions, or Provider
Registry profiles on unpublished diagnostic rows after insertion.

The registry revision content trigger functions now reject content-evidence
drift immediately after insert. Prompt Registry revisions cannot directly
rewrite `fallback_source_chain` or `metadata`; Task Route Policy revisions
cannot rewrite `model_id`, `config_key`, `config_path`,
`fallback_source_chain`, or `metadata`; Model Registry revisions cannot rewrite
`model_definition`, `fallback_source_chain`, or `metadata`; Provider Registry
revisions cannot rewrite `provider_type`, `provider_profile`,
`fallback_source_chain`, or `metadata`. True no-op updates still pass so
harmless ORM or migration writes that set a content column to its existing
value remain compatible.

Focused registry e2e coverage now seeds valid unpublished rows with
object-shaped unrecognized test-version metadata across all four registry
families, verifies no-op content updates pass, and verifies valid-looking
unpublished Prompt metadata drift, Task model drift, Model definition drift, and
Provider profile drift reject on the content update restriction. Existing
published-row drift coverage remains in the same cross-family publish-history
test.

Remaining risk: registry revision content rows now follow the append-only
pattern before and after publication. Separate operator workflows are still
needed for any future audited registry content correction flow, rather than
allowing direct in-place DB mutation.

## 774. P2 landing record: Terminal Parent Result Update Restrict

This round closes a parent-row mutation gap left after request/run evidence
immutability and terminal child ledger work. Repair execution requests and Agent
Runtime runs are intentionally mutable while they move through queued, running,
retry, resume, cancel, stale-recovery, failed, completed, and cancelled states,
but direct SQL could still rewrite terminal parent result fields in place or
switch one terminal outcome to another without going through the model-owned
control path.

`ai_repair_execution_requests` now has
`ai_repair_execution_requests_terminal_result_update_restrict_check`. Once a
request is `completed`, `failed`, or `cancelled`, direct updates that change the
terminal status, runtime result, failure evidence, queue/lease fields,
attempt counters, last-attempt timestamp, or completion timestamp are rejected.
The trigger still permits true no-op updates, failed-to-queued manual retry, and
failed-to-cancelled manual cancel when the row shape matches the existing
manual-control runtime contract.

`ai_agent_runs` now has
`ai_agent_runs_terminal_result_update_restrict_check`. Once a run is
`completed`, `failed`, or `cancelled`, direct updates that rewrite terminal
status, timeline fingerprint, completion/failure evidence, queue/lease fields,
attempt counters, or last-attempt timestamp are rejected. The trigger still
permits true no-op updates, failed or standalone-cancelled manual resume to
queued, and repair-execution failed-to-cancelled sync for the existing control
path.

Focused repair execution e2e coverage now verifies failed request no-op updates
pass, same-terminal failure-message drift rejects, failed-to-completed drift
rejects, and the normal manual retry path still requeues the request and synced
Agent Runtime run. Focused Agent Runtime coverage verifies failed run no-op
updates pass, same-terminal failure-message drift rejects, failed-to-completed
drift rejects, and existing resume/history behavior remains valid. Stale-race
fixtures were adjusted to use model-owned transition shapes instead of arbitrary
terminal result rewrites.

Remaining risk: terminal parent rows now fail closed on direct result drift
while preserving implemented retry/resume/cancel transitions. Future live
interruption, audited payload correction, operator-provided resume payloads,
rollback execution, and production tool/Codex/MCP/model adapters still need
their own explicit contracts before those workflows are enabled.

## 775. P2 landing record: Support Bundle Request Lifecycle Update Restrict

This round tightens support bundle request rows after request evidence
immutability, manifest/archive snapshot checks, audit append-only work, and
download authorization evidence restrictions. Request rows intentionally move
from ready/active to expired during retention cleanup, but direct SQL could
still extend or backdate `expires_at`, mark a ready bundle failed, or perform a
valid-looking premature ready-to-expired rewrite before the retention window
elapsed.

`ai_support_bundle_requests` now has
`ai_support_bundle_requests_lifecycle_update_restrict_check`. The trigger
rejects direct updates to lifecycle/result fields after insert, including
status, retention status, manifest retention snapshot/fingerprint/byte size,
`expires_at`, and failure code/message. It permits true no-op updates and the
implemented retention cleanup shape only when the persisted `expires_at` has
elapsed, the row moves from active to expired, failure fields do not change,
and the manifest rewrite is limited to retention status/expiry evidence.

The support bundle model now has an internal creation-time `expiresAt` override
used by focused retention fixtures, so tests can seed legitimately expired
bundles without mutating request expiry after persistence. Focused e2e coverage
now verifies request `expires_at` drift, ready-to-failed drift, and premature
ready-to-expired drift reject on the new lifecycle restriction, while retention
cleanup still expires due bundles and revokes outstanding authorizations.

Remaining risk: support bundle request retention windows and terminal lifecycle
fields are now DB-guarded while preserving implemented cleanup. Deployment
specific object-storage notification workers still need real provider
signature verification before forwarding `verified_by_upstream` evidence, and
broader operator-facing authorization revocation/recovery UI remains separate
follow-up work.

## 776. P2 landing record: Support Bundle Download Authorization Lifecycle Update Restrict

This round closes the download authorization lifecycle drift left after
authorization evidence immutability. Authorization rows intentionally move from
`authorized` to `downloaded` when an API-proxy, direct signed URL
acknowledgement, or verified provider transfer succeeds, and to `expired` when
the authorization TTL, direct URL TTL, or parent support bundle retention window
has elapsed. Direct SQL could still mark an active authorization expired early,
move it to revoked without an operator-owned revocation flow, backdate/late-date
download completion, or replay a terminal row back to active.

`ai_support_bundle_download_authorizations` now has
`ai_support_bundle_download_authorizations_lifecycle_update_restrict_check`.
The trigger allows true no-op lifecycle writes, `authorized` to `downloaded`
only with an in-window `downloaded_at`, and `authorized` to `expired` only
after the authorization TTL, direct URL TTL, or parent bundle expiry/retention
condition is true. Terminal rows cannot be replayed or moved across terminal
states through direct SQL.

Focused support bundle coverage now seeds expired authorization fixtures at
creation time with real token fingerprints instead of mutating `expires_at`
after issuance. It verifies premature expiry, revoked drift, late download
drift, and downloaded replay reject on the new lifecycle restriction, while the
normal API-proxy consume race, direct-download acknowledgement, transfer-event
ingestion, scheduled authorization cleanup, and retention cleanup flows remain
valid.

Remaining risk: support bundle request and authorization lifecycle rows now
fail closed on direct status/result drift while preserving implemented cleanup
and transfer paths. Deployment-specific object-storage notification workers
still need real provider signature verification before forwarding
`verified_by_upstream` evidence, and broader operator-facing revocation or
recovery UI remains separate follow-up work.

## 777. P2 landing record: Provider Health State Event History Required

This round tightens DB-backed Provider Health overlays. State rows intentionally
remain mutable because they are the current routing overlay for manual health
overrides, configured health snapshots, and stale probe cleanup. Event rows were
already append-only, but direct SQL could still insert or rewrite a state row's
route-affecting status, source, checked timestamp, last-error, fingerprint, or
metadata without appending the matching event history that operators and route
diagnostics rely on.

`ai_provider_health_states` now has
`ai_provider_health_states_event_history_required_check`, implemented as a
deferred constraint trigger. True no-op updates pass. Any inserted state row or
real state transition must have a matching `ai_provider_health_events` row by
commit time, with the same state id, provider/workspace/actor snapshot, status,
checked timestamp, last-error, source, state fingerprint, and metadata. The
trigger is deferred so the existing model-owned state-write-then-event-write
transactions keep their current order.

Focused Provider Registry coverage now verifies no-op state updates pass and
valid-looking direct health inserts or drift reject on the new event-history
requirement. Focused SQL smoke also verifies that a state write plus matching
event commits, while mismatched event evidence fails on the existing event
snapshot guard.

Remaining risk: Provider Health route overlays now require append-only event
evidence for in-place state transitions. Full external health probe workers,
operator-facing health history views, Provider Registry credential management,
and broader registry editor workflows remain separate follow-up work.

## 778. P2 landing record: Agent Runtime Run State Timeline Required

This round tightens Agent Runtime mutable run state. Run rows intentionally
move through queued, running, completed, failed, cancelled, manual resume, and
stale-recovery states, and prior slices already made timeline rows append-only
and terminal result ledgers snapshot-bound. Direct SQL could still insert an
otherwise valid run row without any timeline history, or move run lifecycle
fields while leaving operators and diagnostics with no matching run-level
timeline event.

`ai_agent_runs` now has
`ai_agent_runs_state_timeline_required_check`, implemented as a deferred
constraint trigger. True no-op lifecycle updates pass. Any inserted run or
route-affecting lifecycle transition must have a matching run-level
`ai_agent_timeline_events` row by commit time, with the same run id,
workspace/actor snapshot, status, workflow/source payload, and update
timestamp. The trigger is deferred so existing model-owned paths can keep their
current write order: update the run first, then append timeline events in the
same transaction.

Focused Agent Runtime coverage now verifies orphan run inserts fail, bare
state transitions fail, and a valid direct transition plus matching timeline
event can commit in one transaction. An existing terminal-result fixture was
updated to seed its run with a matching timeline event instead of relying on an
orphan run row. Focused SQL smoke covered bare insert rejection, bare update
rejection, valid insert-plus-event, valid update-plus-event, and no-op update
compatibility.

Remaining risk: run lifecycle state now requires append-only timeline evidence
at the DB boundary. Step status transitions are not yet forced to append
dedicated step-level timeline events because standalone cancel/resume currently
record run-level control evidence plus step summaries; tightening that boundary
needs model-owned step events for every step transition first. Production
tool/Codex/MCP/model adapters, executor-specific result schemas, redaction,
side-effect/idempotency contracts, interruption/resume, and rollback execution
remain separate follow-up work.

## 779. P2 landing record: Repair Execution Request Audit History Required

This round tightens durable repair execution lifecycle state. Request rows are
intentionally mutable while approval, worker leasing, retry, manual cancel,
manual retry, stale recovery, completion, and failure move them through the
state machine. Audit rows were already append-only and workspace-snapshot
bound, but direct SQL could still insert a request row or move request
lifecycle/result fields without appending the matching audit history that
operators, Admin, Agent Runtime sync, and support-bundle diagnostics rely on.

`ai_repair_execution_requests` now has
`ai_repair_execution_requests_audit_history_required_check`, implemented as a
deferred constraint trigger. True no-op lifecycle updates pass. New request
rows must have a `requested` audit event plus an audit event for the resulting
status by commit time. Real lifecycle transitions must have a matching audit
event for the resulting status, with the same request/workspace/actor snapshot
and metadata that, when present, agrees with approval state, side-effect flag,
failure diagnostics, worker attempt/max-attempt counters, and worker lease
evidence. Retryable worker failures can satisfy queued-state history through
the existing `retry_scheduled(nextStatus=queued)` audit event. The trigger is
deferred so the model can keep writing the request row first and audit rows
later in the same transaction.

Focused repair execution coverage now verifies orphan request inserts reject,
bare lifecycle updates reject, valid request-plus-audit writes commit, and
valid update-plus-audit writes commit. Focused SQL smoke covered the same DB
boundary cases with explicit `SET CONSTRAINTS ... IMMEDIATE` checks.

Remaining risk: repair request lifecycle rows now require append-only audit
history at the DB boundary. This preserves implemented approval, worker, retry,
manual control, and stale recovery paths, but it does not add live running
interruption, audited payload-correction or operator-provided resume payloads,
rollback execution, or executor-specific payload/result/idempotency contracts
for future non-registry repair executors.

## 780. P2 landing record: Support Bundle Request Audit History Required

This round tightens durable support bundle request lifecycle state. Request
rows already had immutable creation/source/archive evidence and constrained
retention cleanup transitions, and audit rows were append-only. Direct SQL
could still insert an otherwise valid support bundle request, or move a due
request to expired, without appending the lifecycle audit history that support
bundle reads, Admin, retention diagnostics, and transfer/download evidence rely
on.

`ai_support_bundle_requests` now has
`ai_support_bundle_requests_audit_history_required_check`, implemented as a
deferred constraint trigger. True no-op lifecycle updates pass. New request
rows must have matching `created` audit history by commit time; modern
packaged archive request rows also require `archive_created` audit history
with matching manifest/archive evidence. Real transitions to expired require a
matching `retention_expired` audit row with the resulting manifest
fingerprint, previous manifest fingerprint, retention status, and cleanup
identity evidence. The trigger is deferred so the model can keep writing the
request row first and audit rows later in the same transaction.

Focused support bundle coverage now verifies bare direct request inserts
reject, valid request-plus-created/archive audit writes commit, bare
expiration updates reject, valid expiration-plus-retention-audit writes commit,
and no-op lifecycle updates still pass. The malformed legacy hydration fixture
now seeds compatible audit history in the same transaction so old inline
manifest rows remain readable without reopening orphan request writes.
Focused SQL smoke covered the same DB-boundary cases with explicit
`SET CONSTRAINTS ... IMMEDIATE` checks.

Remaining risk: support bundle request creation/archive/retention lifecycle
state now requires append-only audit evidence at the DB boundary. Production
object-storage webhook wiring, retry/dead-letter handling, and real provider
signature verification in the deployment forwarding worker remain separate
follow-up work.

## 781. P2 landing record: Support Bundle Download Authorization Audit History Required

This round tightens durable support bundle download authorization state.
Authorization rows already had immutable issued evidence, constrained lifecycle
transitions, transfer-event snapshot guards, and bounded audit metadata. Direct
SQL could still insert an otherwise valid authorization row, or move it to
downloaded/expired, without appending the audit history that Admin, support
bundle reads, transfer diagnostics, and cleanup accounting rely on.

`ai_support_bundle_download_authorizations` now has
`ai_support_bundle_download_authorizations_audit_history_required_check`,
implemented as a deferred constraint trigger. True no-op status/downloaded-at
updates pass. New `authorized` rows must have matching `download_authorized`
audit metadata by commit time. Transitions to `downloaded` must have matching
`downloaded` audit metadata with authorization id/fingerprint, artifact
evidence, manifest/artifact fingerprints, and optional direct-delivery
actor/method evidence. Transitions to `expired` must have matching expiration
history encoded in the existing
`download_authorized(authorizationExpired=true)` metadata, including
previous/next status, cleanup fingerprint/scope, authorization fingerprint, and
artifact fingerprint.

Focused support bundle coverage now verifies bare direct authorization inserts
reject, valid insert-plus-audit writes commit, bare downloaded/expired updates
reject, valid update-plus-audit writes commit, and terminal no-op updates
still pass. Existing authorization fixture helpers now seed matching issuance
audit rows in the same transaction so DB-boundary tests do not rely on orphan
authorization rows. Focused SQL smoke covered the same DB-boundary cases with
explicit `SET CONSTRAINTS ... IMMEDIATE` checks.

Remaining risk: support bundle request and download authorization lifecycle
state now both require append-only audit evidence at the DB boundary. The
remaining support-bundle risk is deployment-oriented: production
object-storage webhook wiring, retry/dead-letter handling, and real provider
signature verification in the forwarding worker.

## 782. P2 landing record: Repair Execution Side-effect Ledger Required

This round closes the reverse side-effect persistence gap in Repair Execution.
The existing ledger snapshot guard required any `ai_repair_execution_side_effects`
row to match a completed parent request, and blocked parent result drift after a
ledger row existed. A direct SQL write could still move a request to
`completed` with `runtime_result.sideEffectsApplied=true` and matching audit
history while omitting the side-effect ledger row entirely.

`ai_repair_execution_requests` now has
`ai_repair_execution_requests_side_effect_ledger_required_check`, implemented
as a deferred constraint trigger. True no-op lifecycle updates pass. Any
inserted or updated request that is `completed` with
`runtime_result.sideEffectsApplied=true` must have a matching
`ai_repair_execution_side_effects` row by commit time, with the same request,
workspace, actor, side-effect kind, record id, fingerprint, summary, worker
attempt, completed/applied timestamp, cleared failure fields, and cleared
worker lease fields. The trigger is deferred so the worker can keep updating
the request first, then inserting the side-effect ledger and audit rows in the
same transaction.

Focused repair execution coverage now verifies that a completed applied
request with matching audit history but no side-effect ledger rejects at the DB
boundary, while the same terminal update plus a matching side-effect ledger and
audit history commits. Focused SQL smoke covered missing-ledger rejection, a
valid terminal request plus ledger commit, and no-op update compatibility on a
disposable migrated Postgres database.

Remaining risk: constrained registry repair side effects now have bidirectional
DB evidence between terminal request state and side-effect ledger history.
Future non-registry repair executors still need executor-specific payload,
result, idempotency, and side-effect ledger contracts before they are enabled.

## 783. P2 landing record: Agent Runtime Step State Timeline Required

This round closes the step-level half of Agent Runtime lifecycle history. Run
rows already required matching run-level timeline events by commit time, but
direct SQL could still insert otherwise valid step rows or move step
status/completion evidence without appending the step timeline history that
Admin, run detail, worker recovery, and audit review use to reconstruct
execution.

Standalone manual cancel/resume and stale-lease recovery now append step-level
timeline events for the step status transitions they already wrote to
`ai_agent_steps`. The manual-control and stale-recovery timeline payload
validators were broadened to accept those step-level events while preserving
the existing run-level payload contracts.

`ai_agent_steps` now has
`ai_agent_steps_state_timeline_required_check`, implemented as a deferred
constraint trigger. True no-op lifecycle updates pass. Inserted steps and real
status/start/completion timestamp transitions must have a matching
`ai_agent_timeline_events` row by commit time, with the same run id, step id,
workspace/actor snapshot, status, update timestamp, and step key/type payload
when present. The trigger is deferred so model-owned paths can keep writing the
step row before appending timeline rows in the same transaction.

Focused Agent Runtime coverage now verifies orphan step inserts reject, bare
step lifecycle updates reject, valid update-plus-step-timeline transactions
commit, and no-op step lifecycle updates remain compatible. Focused SQL smoke
covered the same DB-boundary cases on a disposable migrated Postgres database.

Remaining risk: Agent Runtime run and step lifecycle state now both require
timeline history at the DB boundary. Production tool, Codex, MCP, model,
handoff, approval, and planner executors still need executor-specific payload
schemas, redaction, side-effect/idempotency contracts, and interruption/resume
semantics before arbitrary workflows are enabled.

## 784. P2 landing record: Registry Revision Publish History Required

This round closes the reverse DB-backed registry publish-history gap. Registry
publish events already preserved parent snapshots and event evidence, but
direct SQL could still create an active workspace revision with current
direct-publish metadata while omitting `revision_published` history, or create
`revision_reused` evidence without an original publish anchor.

Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
revision tables now have deferred `*_publish_history_required_check` triggers.
Current active workspace direct-publish rows, plus real repair-worker rows using
the model-owned `repair-${executionRequestId}` revision/id contract, must have
matching `ai_registry_revision_publish_events(event_type=revision_published)`
history by commit time. Legacy/config/test rows whose metadata does not claim a
current publish source remain compatible.

`ai_registry_revision_publish_events` now also rejects `revision_reused` rows
unless a matching `revision_published` event exists by commit time, and rejects
deleting a publish anchor while the parent revision or reuse evidence would be
left behind. Parent revision deletion can still cascade event rows.

Focused registry coverage now verifies bare publish-source revisions reject,
revision-plus-published-event transactions commit, reuse-only events reject, and
published-anchor deletes reject. Disposable Postgres smoke replayed all
migrations and covered the same DB-boundary cases with immediate deferred
constraint checks.

Remaining risk: DB-backed registry direct/repair publish rows now require
bidirectional durable publish history. Full registry editors, prompt body
diff/eval, rollback UI, bulk migration, and provider credential workflows remain
separate product slices.

## 785. P2 landing record: Repair Execution Side-effect Ledger Delete Restrict

This round closes the child-removal gap left after the side-effect ledger became
required from the parent request side. A completed request with
`runtime_result.sideEffectsApplied=true` already had to write a matching
`ai_repair_execution_side_effects` row by commit time, and parent/child updates
were snapshot-bound. Direct SQL could still delete the ledger row after
completion, leaving the terminal request claiming an applied side effect with no
durable side-effect history until the parent row changed again.

`ai_repair_execution_side_effects` now has a deferred
`ai_repair_execution_side_effects_delete_restrict_check` trigger. Deleting a
ledger row is rejected while the parent request still exists, is `completed`,
has `sideEffectsApplied=true`, and still matches the ledger row's side-effect
kind, record id, fingerprint, summary, worker attempt, applied timestamp,
cleared failure fields, and cleared worker lease fields. Parent request deletion
can still cascade the side-effect row.

Focused repair execution coverage now verifies direct ledger deletion rejects on
a completed applied request. Disposable Postgres smoke replayed all migrations
and verified direct ledger deletion rejection plus parent-delete cascade
compatibility.

Remaining risk: constrained registry repair side-effect rows now have
bidirectional required evidence and cannot be removed independently from a
completed parent. Future non-registry executors still need executor-specific
payload, result, idempotency, and side-effect contracts before they are enabled.

## 786. P2 landing record: Agent Runtime Timeline Delete Restrict

This round closes the child-removal gap left after Agent Runtime run and step
state began requiring matching timeline history. Direct SQL could still delete
the timeline row after the parent run or step state was committed, leaving the
current lifecycle state without the history row used by run detail, Admin,
worker recovery, and audit review.

`ai_agent_timeline_events` now has a deferred
`ai_agent_timeline_events_delete_restrict_check` trigger. Run-level timeline
deletes reject when the row still matches the parent run's current status,
workflow/source, update timestamp, and optional failure or worker-lease
metadata. Step-level timeline deletes reject when the row still matches the
parent step's current status, update timestamp, and optional step key/type
payload. Parent run deletion can still cascade timeline rows.

Focused Agent Runtime coverage verifies direct deletes reject for both
run-level and step-level required timeline rows. Disposable Postgres smoke
replayed all migrations and verified direct delete rejection plus parent-run
cascade compatibility.

Remaining risk: Agent Runtime state-required timeline history now cannot be
removed independently from the parent run, but real production tool, Codex,
MCP, model, handoff, approval, and planner adapters still need
executor-specific payload/result schemas, redaction, side-effect/idempotency
contracts, and interruption/resume semantics.

## 787. P2 landing record: Audit Event Delete Restrict

This round closes the direct audit-row deletion gap for repair execution and
support bundle history. Parent rows already required matching lifecycle audit
history by commit time, and audit rows rejected content rewrites after write,
but direct SQL could still delete persisted audit rows while the parent request
or bundle stayed live.

`ai_repair_execution_audit_events` now has a deferred
`ai_repair_execution_audit_events_delete_restrict_check` trigger.
`ai_support_bundle_audit_events` now has a deferred
`ai_support_bundle_audit_events_delete_restrict_check` trigger. In both cases,
audit row deletion is rejected while the parent row still exists. Parent
request or bundle deletion can still cascade audit rows, preserving normal
ownership cleanup.

Focused repair execution coverage verifies direct deletion of a completed
request audit row rejects. Focused support bundle coverage verifies direct
deletion of request and downloaded audit rows rejects. Disposable Postgres
smoke verified direct audit deletion rejection and parent cascade
compatibility.

Remaining risk: repair execution and support bundle lifecycle audit history is
now append-only for live parents at the DB boundary. Future repair executors
and deployment-specific object-storage workers still need executor/provider
specific payload schemas, signature verification rollout, retry/dead-letter
operations, and full audit review workflows.

## 788. P2 landing record: Agent Runtime Execution Result Delete Restrict

This round closes the direct terminal-result deletion gap in Agent Runtime.
Execution result rows already preserve parent-run snapshots, terminal status
alignment, payload coherence, and full content immutability, but direct SQL
could still remove the terminal adapter outcome row while leaving the completed
or failed parent run intact.

`ai_agent_runtime_execution_results` now has a deferred
`ai_agent_runtime_execution_results_delete_restrict_check` trigger. Deleting a
terminal execution-result row is rejected while the parent `ai_agent_runs` row
still exists. Parent run deletion can still cascade execution-result rows.

Focused Agent Runtime coverage verifies direct deletion of the record-only
terminal result row rejects. Disposable Postgres smoke replayed all migrations
and verified direct result deletion rejection plus parent-run cascade
compatibility.

Remaining risk: Agent Runtime terminal result history is now append-only for
live parent runs. At this landing point the only successful concrete standalone
adapter remained record-only; later landing record 802 adds generic
local-completion execution. Production adapters still need concrete execution, result
schemas, side-effect/idempotency contracts, redaction, interruption, and
rollback/resume semantics.

## 789. P2 landing record: Transfer And Provider Event Delete Restrict

This round closes two remaining event-history child-removal gaps. Support
bundle transfer events and Provider Health events already persisted durable
history, preserved parent snapshots, exposed recent rows through existing
read paths, and rejected content rewrites after write. Direct SQL could still
delete those rows while the parent authorization or health state remained live.

`ai_support_bundle_transfer_events` now has a deferred
`ai_support_bundle_transfer_events_delete_restrict_check` trigger. Deleting a
transfer-event row is rejected while the parent download authorization still
exists; parent authorization or bundle deletion can still cascade transfer
events.

`ai_provider_health_events` now has a deferred
`ai_provider_health_events_delete_restrict_check` trigger. Deleting a health
event row is rejected while the parent health state still exists; parent state
deletion can still cascade event rows.

Focused support bundle coverage verifies direct transfer-event deletion
rejects. Focused Provider Health coverage verifies direct health-event
deletion rejects. Disposable Postgres smoke replayed all migrations and
verified direct deletion rejection plus parent cascade compatibility for both
tables.

Remaining risk: support bundle transfer history and Provider Health event
history are now append-only for live parents at the DB boundary. Production
object-storage webhook workers still need deployment-specific retry/
dead-letter rollout and real provider signature verification; Provider Health
still needs external probe execution, credential workflows, and long-range
timeline UI.

## 790. P2 landing record: Registry Publish Event Delete Restrict

This round closes the last child-removal gap in DB-backed registry publish
history. The publish-history-required slice already rejected removing a
`revision_published` anchor when that would strand parent or reuse evidence,
but direct SQL could still delete a standalone `revision_reused` row while the
parent Prompt Registry, Task Route Policy, Model Registry, or Provider Registry
revision remained live.

`ai_registry_revision_publish_events` now has a deferred
`ai_registry_revision_publish_events_delete_restrict_check` trigger. Deleting
either `revision_published` or `revision_reused` event rows is rejected while
the referenced parent revision exists. Parent revision deletion still cascades
publish/reuse event rows through the existing family-specific foreign keys.

Focused registry coverage verifies direct publish-event deletion rejects,
direct reuse-event deletion rejects, and parent revision deletion still
cascades publish-event cleanup.

Remaining risk: DB-backed registry publish/reuse event history is now
append-only for live parent revisions. Full registry editors, prompt body
diff/eval, rollback UI, bulk migration, and provider credential workflows
remain separate product slices.

## 791. P2 landing record: Repair Approval Decision Audit Required

This round closes a repair execution approval-history gap. Request lifecycle
history already required queued/running/terminal audit events by commit time,
but direct SQL could still move a waiting approval request to
`approval_state=approved` or `approval_state=rejected` while only appending the
queued/cancelled lifecycle audit row and omitting the actual approval decision
event.

`ai_repair_execution_requests` now has a deferred
`ai_repair_execution_requests_approval_audit_required_check` trigger. New or
changed rows with `approval_state=approved` require a matching
`approval_approved` audit event; rows with `approval_state=rejected` require a
matching `approval_rejected` audit event. Later worker lifecycle updates do not
re-require a fresh approval event when the approval state is unchanged.

Focused repair execution coverage verifies direct approval-state advancement
with only queued audit history rejects, and the same state change plus
approval and queued audit rows commits. The stale approval race test now
simulates a legal competing approval transaction and still verifies the stale
model path does not write duplicate decision audit rows.

Remaining risk: repair approval decisions now require durable decision audit
history at the DB boundary. Future non-registry executors still need their own
payload schemas, side-effect idempotency contracts, interrupt/resume semantics,
and rollback workflow before broader execution is enabled.

## 792. P2 landing record: Support Bundle Authorization Delete Restrict

This round closes a support-bundle authorization child-removal gap. Download
authorization rows already required matching audit history, rejected evidence
and lifecycle rewrites, and had protected audit/transfer child history, but
direct SQL could still delete the authorization row itself while the parent
support bundle remained live.

`ai_support_bundle_download_authorizations` now has a deferred
`ai_support_bundle_download_authorizations_delete_restrict_check` trigger.
Deleting an authorization row is rejected while the parent
`ai_support_bundle_requests` row still exists. Parent bundle deletion still
cascades authorization rows through the existing foreign key.

Focused support bundle coverage verifies direct authorization deletion rejects,
and verifies parent bundle deletion still cascades authorization cleanup.

Remaining risk: support bundle authorization history is now append-only for
live bundles at the DB boundary. Production object-storage webhook forwarding,
provider-specific signature verification rollout, and retry/dead-letter
operations remain deployment follow-up work.

## 793. P2 landing record: Agent Runtime Step Delete Restrict

This round closes an Agent Runtime step child-removal gap. Run and step
lifecycle states already required matching timeline history, timeline rows
were protected against direct deletion while required by current state, and
step rows rejected direct evidence rewrites. Direct SQL could still delete a
step row while the parent run remained live, causing step-linked timeline
evidence to lose its step reference through `ON DELETE SET NULL`.

`ai_agent_steps` now has a deferred
`ai_agent_steps_delete_restrict_check` trigger. Deleting a step row is rejected
while the parent `ai_agent_runs` row still exists. Parent run deletion still
cascades step rows through the existing foreign key.

Focused Agent Runtime coverage verifies direct step deletion rejects and parent
run deletion still cascades step cleanup.

Remaining risk: Agent Runtime run/step/timeline state is now protected against
direct child removal for live runs. Production tool, Codex, MCP, model,
handoff, approval, and planner adapters still need concrete execution,
executor-specific schemas, redaction, side-effect/idempotency contracts, and
interrupt/resume behavior.

## 794. P2 landing record: Provider Health State Delete Restrict

This round closes a Provider Health parent-row deletion gap. Provider Health
event history already rejected direct event deletion while the parent health
state existed, but direct SQL could still delete the `ai_provider_health_states`
row itself and cascade away all manual override, probe result, configured
snapshot, cleanup, and stale-probe cleanup history for that route-affecting
overlay.

`ai_provider_health_states` now has a `BEFORE DELETE`
`ai_provider_health_states_delete_restrict_check` trigger. Deleting a state row
is rejected when durable `ai_provider_health_events` rows still exist. The
event table also has an immediate delete guard in addition to the existing
deferred guard, so a transaction cannot delete events first and then delete
the state before deferred checks run. Workspace deletion can still cascade
workspace-scoped Provider Health states and events, preserving ownership
cleanup.

Focused Provider Health coverage verifies direct state deletion rejects,
event-then-state bypass attempts reject, and workspace deletion still cascades
Provider Health state and event cleanup.

Remaining risk: Provider Health state and event history is now protected
against direct deletion for live overlays. External probe execution, credential
workflows, long-range timeline UI, and production rollout of automatic health
workers remain separate product/deployment slices.

## 795. P2 landing record: Support Bundle Request Delete Restrict

This round closes a support-bundle root-row deletion gap. Support bundle audit
events, download authorization rows, and transfer events already rejected
direct deletion while their parent rows remained live, but direct SQL could
still delete the `ai_support_bundle_requests` row itself and cascade away the
persisted support bundle, audit history, issued/downloaded/expired
authorizations, and transfer evidence.

`ai_support_bundle_requests` now has a `BEFORE DELETE`
`ai_support_bundle_requests_delete_restrict_check` trigger. Deleting a bundle
request row is rejected while the owning workspace still exists, so normal
workspace ownership cleanup can still cascade workspace-scoped support bundle
history, but direct bundle-row deletion can no longer erase durable support
bundle evidence.

Focused support bundle coverage verifies direct bundle request deletion
rejects and workspace deletion still cascades request and authorization
cleanup.

Remaining risk: support bundle root, audit, authorization, and transfer
history are now protected against direct deletion for live workspaces.
Production object-storage webhook forwarding, provider-specific signature
verification rollout, retry/dead-letter operations, and full operational
retention policy rollout remain deployment follow-up work.

## 796. P2 landing record: Repair Execution Request Delete Restrict

This round closes a repair execution root-row deletion gap. Repair execution
audit rows and applied side-effect ledger rows already rejected direct deletion
while their parent request remained live, but direct SQL could still delete the
`ai_repair_execution_requests` row itself and cascade away the durable request,
approval, worker, audit, and side-effect history.

`ai_repair_execution_requests` now has a `BEFORE DELETE`
`ai_repair_execution_requests_delete_restrict_check` trigger. Deleting a
request row is rejected while the owning workspace still exists, so workspace
ownership cleanup can still cascade workspace-scoped repair execution history,
but direct request-row deletion can no longer erase durable execution evidence.

Focused repair execution coverage verifies direct request deletion rejects and
workspace deletion still cascades request and audit cleanup.

Remaining risk: repair execution root, audit, and side-effect history are now
protected against direct deletion for live workspaces. Future non-registry
executors still need executor-specific payload schemas, idempotency contracts,
rollback/resume behavior, and broader operator controls before being enabled.

## 797. P2 landing record: Agent Runtime Run Delete Restrict

This round closes an Agent Runtime root-row deletion gap. Timeline rows,
step rows, and terminal execution-result rows already rejected direct deletion
while their parent run remained live, but direct SQL could still delete the
`ai_agent_runs` row itself and cascade away the run, step, timeline, and
terminal adapter-result history.

`ai_agent_runs` now has a `BEFORE DELETE`
`ai_agent_runs_delete_restrict_check` trigger. Deleting a run row is rejected
while the owning workspace still exists, so workspace ownership cleanup can
still cascade workspace-scoped Agent Runtime history, but direct run-row
deletion can no longer erase durable execution evidence.

Focused Agent Runtime coverage verifies direct run deletion rejects and
workspace deletion still cascades run and step cleanup.

Remaining risk: Agent Runtime run, step, timeline, and terminal result history
are now protected against direct deletion for live workspaces. Production
tool, Codex, MCP, model, handoff, approval, and planner adapters still need
concrete execution, executor-specific schemas, redaction,
side-effect/idempotency contracts, and interrupt/resume behavior.

## 798. P2 landing record: Registry Revision Delete Restrict

This round closes a DB-backed registry root-row deletion gap. Registry
publish/reuse events already rejected direct deletion while their parent
Prompt Registry, Task Route Policy, Model Registry, or Provider Registry
revision remained live, but direct SQL could still delete the parent revision
row itself and cascade away the durable publish/reuse history.

`ai_prompt_registry_revisions`, `ai_task_route_policy_revisions`,
`ai_model_registry_revisions`, and `ai_provider_registry_revisions` now each
have a `BEFORE DELETE` `*_delete_restrict_check` trigger. Deleting a
workspace-scoped registry revision row is rejected while the owning workspace
still exists. Deleting a global revision row is always rejected because it has
no workspace ownership cascade path. Workspace deletion can still cascade
workspace-scoped registry revisions and publish/reuse events.

Focused registry coverage verifies direct prompt revision deletion rejects and
workspace deletion still cascades prompt revision plus publish-event cleanup.
Disposable Postgres smoke covers direct-delete rejection and workspace-cascade
compatibility across Prompt Registry, Task Route Policy, Model Registry, and
Provider Registry revisions.

Remaining risk: DB-backed registry revision and publish/reuse history are now
protected against direct deletion for live workspaces. Full registry editors,
prompt body diff/eval, rollback UI, bulk migration, and provider credential
workflows remain separate product slices.

## 799. P2 landing record: Agent Runtime Timeline Full Delete Restrict

This round closes an Agent Runtime timeline history deletion gap. The prior
timeline delete guard protected the row that still matched current run or step
state, but older timeline events could be deleted after the run advanced to a
later state.

`ai_agent_runtime_timeline_delete_restrict()` now rejects deletion of any
`ai_agent_timeline_events` row while the parent `ai_agent_runs` row still
exists. Workspace deletion remains the ownership cleanup path and still
cascades run, step, and timeline rows.

Focused Agent Runtime coverage verifies old run-level, old step-level, and
current run-level timeline deletes all reject. Disposable Postgres smoke
replayed all migrations and verified the same direct-delete rejects plus
workspace cascade compatibility.

Remaining risk: Agent Runtime timeline history is now protected against direct
deletion for live runs. Production tool, Codex, MCP, model, handoff, approval,
and planner adapters still need concrete execution, executor-specific schemas,
redaction, side-effect/idempotency contracts, and interrupt/resume behavior.

## 800. P2 landing record: Repair Side-effect Full Delete Restrict

This round tightens repair execution side-effect ledger deletion semantics.
The earlier delete guard rejected removal only when the parent request still
matched the exact completed side-effect result projection. That protected the
current constrained worker outcome, but it left the invariant weaker than the
audit and root-row delete guards.

`ai_repair_execution_side_effect_delete_restrict()` now rejects deletion of any
`ai_repair_execution_side_effects` row while the parent
`ai_repair_execution_requests` row still exists with the same workspace and
actor snapshot. Workspace deletion remains the ownership cleanup path.

Disposable Postgres replay verified all migrations, and targeted smoke
continues to verify side-effect ledger delete rejection plus workspace cascade
compatibility.

Remaining risk: repair execution request, audit, and side-effect ledger history
are now protected against direct deletion for live requests. Future
non-registry executors still need executor-specific payload schemas,
idempotency contracts, rollback/resume behavior, and broader operator controls
before they are enabled.

## 801. P2 landing record: Provider Health State Full Delete Restrict

This round tightens Provider Health state root deletion. The earlier guard
blocked state deletion when event history existed and added an immediate event
delete guard to close event-then-state bypasses, but the root state row itself
was not protected as an ownership root if historical or migrated rows lacked
events.

`ai_provider_health_state_delete_restrict()` now rejects deletion of
workspace-scoped `ai_provider_health_states` rows while the owning workspace
still exists. Global Provider Health state deletion is rejected outright
because global rows have no workspace cascade owner. Workspace deletion still
cascades workspace-scoped states and events.

Disposable Postgres replay verified all migrations, and targeted smoke verifies
state delete rejection plus workspace cascade compatibility.

Remaining risk: Provider Health state and event history are now protected
against direct deletion for live workspaces. Full automatic probe workers,
credential workflows, editable provider operations, and operational rollout
remain separate product slices.

## 802. P2 landing record: Agent Runtime Generic Worker Completion Contract

This round reduces the Agent Runtime risk that successful standalone execution
was still limited to the record-only special case. The standalone worker
already had DB-backed leases, failure handling, stale-lease recovery, adapter
capability snapshots, and terminal result history, but a future real adapter
still had to invent its own completion write path or leave the run to fail as
incomplete.

`CopilotAgentRuntimeModel.completeStandaloneWorkerExecution()` now provides a
generic leased completion primitive for registered standalone workflow
adapters. It conditionally completes the leased run, marks active steps
completed, writes worker completion step/timeline evidence, and persists a
completed `agent_runtime_worker` execution-result row carrying
`adapterResolution.status=completed`. `agent_runtime_local_completion` is now
registered as the first non-record-only no-side-effect adapter using this
generic path.

Migration `20260622610000_ai_agent_runtime_worker_completion_contract` extends
the adapter-resolution contract with `completed`, adds worker-completion
payload checks for step summaries and timeline events, allows completed
`agent_runtime_worker` result rows only when the row/payload retain the
completed adapter snapshot, and keeps failure result, step, and timeline
payloads from accepting completed adapter-resolution evidence.

Focused Agent Runtime coverage now verifies the worker completes
`agent_runtime_local_completion` runs through the registry, persists completed
worker result history, exposes the result and adapter capability through
GraphQL, and rejects missing completion adapter evidence or completed
adapter-resolution snapshots in failure payloads. Disposable Postgres replay
verified all migrations, and targeted SQL smoke verified valid completed worker
result insertion plus the new malformed-payload rejections.

Remaining risk: Agent Runtime now has a reusable no-side-effect completion
contract beyond record-only, but production tool, Codex, MCP, model, handoff,
approval, and planner adapters still need concrete execution implementations,
executor-specific payload/result schemas, redaction, side-effect/idempotency
contracts, and interrupt/resume behavior.

## 803. P2 landing record: Support Bundle Transfer Forwarding Retry/Dead-letter Ledger

This round reduces the support-bundle production forwarding risk that verified
object-storage notifications could still be lost or retried only outside the
durable model. The internal ingestion endpoint already validated storage,
authorization, replay, and upstream signature-evidence boundaries, but there
was no DB-backed queue for a deployment forwarding adapter to hand off parsed
events before processing.

`ai_support_bundle_transfer_forwarding_events` now persists parsed transfer
notifications before ingestion with authorization id, provider event
id/source, canonical payload, payload fingerprint, upstream
signature-evidence fingerprint when present, worker lease/attempt evidence,
next retry time, terminal forwarded/dead-letter timestamps, bounded failure
code/message, and the forwarded transfer-event fingerprint. The internal
transfer endpoint enqueues first and then synchronously processes the row,
while `copilot.supportBundle.processTransferForwardingEvents` replays queued
or retryable rows through the same storage/auth verifier used by direct
ingestion.

Migration `20260622620000_ai_support_bundle_transfer_forwarding_events` adds
payload identity/source checks, queued/processing/retry/forwarded/
dead-letter state-shape constraints, immutable forwarding evidence after
insertion, and a deferred delete guard while the parent authorization still
exists. Deterministic malformed transfer evidence dead-letters immediately;
retryable storage/processing failures retain bounded error evidence and
schedule retry until max attempts.

Focused support-bundle coverage now exercises missing-storage retry,
worker replay after storage recovery, dead-lettered malformed storage
evidence, and direct SQL rejection for forged terminal state, payload
mutation, and live history deletion. Disposable Postgres replay verified all
migrations, and targeted SQL smoke verified the forwarding state machine plus
content, payload identity, and invalid-state rejections.

Remaining risk: support bundle transfer forwarding now has durable retry and
dead-letter state inside the LocalMind database. Deployment-specific
object-storage webhook adapters still need real provider signature
verification and environment-specific wiring before they forward
`verified_by_upstream` evidence into this queue, and operators still need
alerting/search workflows around dead-lettered rows.

## 804. P2 landing record: Provider Health Automatic Local Probe Ledger

This round reduces the DB-backed registry risk that Provider Health overlays
had persisted manual/configured/probe-result state and event history, but no
automatic worker path that could durably schedule and replay probe attempts for
workspace Provider Registry revisions.

`ai_provider_health_probe_attempts` now persists automatic workspace probe
attempts for active workspace Provider Registry revisions. Rows bind provider
id/type, workspace/actor, provider registry revision id/fingerprint, sanitized
provider-profile snapshot evidence, request fingerprint, worker lease/attempt
state, terminal result metadata, and the resulting Provider Health state
fingerprint. The worker enqueues revision targets, leases due attempts, runs a
no-network local provider profile/runtime contract probe, and publishes
healthy/degraded/down through the existing workspace `probe_result` health
state and event-history path.

Migration `20260622630000_ai_provider_health_probe_attempts` adds the attempt
ledger, queued/processing/retry/completed/dead-letter state-shape constraints,
revision and health-state snapshot triggers, terminal evidence immutability,
and result metadata identity checks. Cron now schedules daily enqueue/process
and minute-level process replay.

Focused Provider Registry coverage verifies idempotent enqueue, worker
completion, Provider Health state/event publication, terminal evidence
immutability, revision snapshot drift rejection, and malformed state-shape
rejection. Disposable Postgres replay verified all migrations, and targeted SQL
smoke verified the attempt state machine plus mutation, snapshot, and invalid
completed-state rejections.

Remaining risk: Provider Health now has a durable automatic no-network probe
ledger and worker history for DB-backed workspace Provider Registry revisions.
Real external network probes, provider credential verification, editable
credential workflows, and operational alert/search surfaces remain separate
product/deployment slices.

## 805. P2 landing record: Repair Execution Cooperative Running Cancel Request

This round reduces the repair execution risk that a running manual cancel had
no durable signal for the leased worker to observe before applying approved
side effects. Manual cancel already handled waiting, queued, and failed
requests, and stale recovery handled expired leases, but active leases had no
audited cancellation request.

`controlCopilotRepairExecution(action=cancel)` now records
`cancel_requested` audit evidence for `running` requests, tied to the current
worker lease id and worker attempt, while leaving the request in `running`.
The repair execution worker checks for a matching request after acquiring and
syncing the running lease and before applying any side effect. When present it
transitions the request to terminal `cancelled`, clears the lease, writes
cooperative `cancelled` audit metadata with `sideEffectsApplied=false`, and
synchronizes the linked Agent Runtime run/step/timeline to cancelled/skipped
state. Stale cancellation requests from earlier lease attempts are not
consumed by later leases.

Migration `20260622640000_ai_repair_execution_cooperative_cancel_request`
extends the repair execution audit event allowlist with `cancel_requested` and
updates the audit metadata contract for both cancellation-request evidence and
cooperative running cancellation terminal evidence.

Focused repair execution coverage verifies running cancellation request
persistence, worker-side cooperative cancellation before side effects, Agent
Runtime synchronization, no side-effect ledger/revision write, stale request
non-consumption by a later lease, and malformed `cancel_requested` metadata
rejection. Disposable Postgres replay verified all migrations, and targeted SQL
smoke verified the cooperative transition plus metadata and stale-request
guards.

Remaining risk: running cancellation is cooperative and checked before side
effects. It is not true live interruption after side-effect application has
started. Future production executors still need explicit interrupt/resume
semantics, payload-correction workflows, rollback behavior, and
executor-specific idempotency contracts before broader mutable actions are
enabled.

## 806. P2 landing record: Agent Runtime Cooperative Running Cancel Request

This round reduces the Agent Runtime risk that standalone manual cancel could
flip a leased `running` run directly to terminal `cancelled` while the worker's
adapter was still executing. That cleared the lease in durable state, but it
did not provide a cooperative request boundary before adapter work began.

Standalone `controlCopilotAgentRuntimeRun(action=cancel)` now records a
non-terminal `run_cancellation` timeline event with
`action=cancel_requested`, the current worker lease id, worker attempt, and
bounded manual reason when the run is currently leased/running. The run remains
`running` and keeps its lease. The standalone Agent Runtime worker checks for a
matching cancellation request after acquiring the lease and before resolving or
executing the workflow adapter; when present, it uses the existing terminal
cancel path while the lease is still current, marks active steps skipped, and
does not write a worker execution-result ledger row.

Migration `20260622650000_ai_agent_runtime_cooperative_cancel_request` extends
the manual-control timeline payload contract to accept
`cancel_requested` only for running run-level cancellation events carrying a
positive worker attempt and current lease evidence, while preserving existing
cancel/resume payload checks.

Focused Agent Runtime coverage verifies a leased running cancel request leaves
the run leased, the worker consumes the request before adapter execution,
active steps are skipped through terminal manual cancel evidence, no terminal
worker execution result is written, and malformed cancellation request payloads
are rejected at the DB boundary. Disposable Postgres replay verified all
migrations, and targeted SQL smoke verified the valid cooperative transition
plus malformed payload rejection.

Remaining risk: standalone Agent Runtime cancellation is now cooperative before
adapter execution, not a true interrupt once a production tool/Codex/MCP/model
adapter has started external work. Production adapters still need their own
interrupt/resume contracts, side-effect idempotency, result schemas, and
redaction policies.

## 807. P2 landing record: Provider Registry Publish-time Probe Attempt

This round reduces the DB-backed registry risk that a newly published
workspace Provider Registry revision could wait until the daily enqueue scan
before any durable Provider Health probe work existed. The automatic local
probe ledger already persisted attempts and replayed them, but direct publish
and repair-driven publish paths did not create an immediate queued attempt.

Provider Registry publish now enqueues a workspace
`ai_provider_health_probe_attempts` row in the same model path used by both
direct GraphQL publish and repair execution side effects. The immediate
attempt reuses the existing no-network probe request fingerprint, sanitized
provider-profile snapshot, revision id/fingerprint binding, and idempotent
request bucket. Reusing an identical Provider Registry revision records the
publish reuse event and returns the same queued probe attempt instead of
duplicating probe work.

`CopilotProviderRegistryRevisionType` now exposes
`providerHealthProbeAttempt`, giving direct publish callers the durable
attempt id, status, revision/profile fingerprints, request fingerprint, and
result/state linkage fields without direct SQL access. Repair execution
provider-registry side effects use the same model method, so approved repairs
also leave queued Provider Health probe evidence before the probe worker runs.

Focused Provider Registry coverage verifies direct publish returns a queued
probe attempt, idempotent publish reuse keeps a single attempt, and the
published workspace revision still drives model routing. Focused repair
execution Provider Registry coverage verifies the constrained queued executor
also leaves an immediate queued probe attempt tied to the published repair
revision fingerprint.

Remaining risk: Provider Registry revisions now get immediate durable
no-network probe scheduling at publish time. External network probes,
credential verification, credential/editor workflows, and full probe-attempt
history/search UI remain separate product/deployment slices.

## 808. P2 landing record: Provider Health Probe Lease Completion Fence

This round reduces the Provider Health probe worker race where an expired
`processing` attempt could be re-leased by a later worker, while the earlier
worker still held an in-memory attempt object and could complete or fail it
after the durable lease had moved on.

`completeProviderHealthProbeAttempt` now locks the attempt row and verifies
the same non-expired worker lease before publishing workspace `probe_result`
health state/event history or terminal attempt evidence. `failProviderHealthProbeAttempt`
uses the same lock and lease fence before scheduling retry or dead-letter
evidence. If a stale worker calls either path after another worker has
re-acquired the attempt, the model returns the current attempt row without
mutating Provider Health overlays, retry state, or failure evidence.

Focused Provider Registry coverage now forces an expired probe lease to be
re-acquired, then verifies the stale worker cannot publish `down` health or
failure evidence, while the current worker can still complete the attempt
normally.

Remaining risk: Provider Health no-network probe completion now respects
current durable lease ownership before route-affecting writes. External probe
execution, credential verification, alerting/search workflows, and full
operator probe-attempt history remain separate slices.

## 809. P2 landing record: Support Bundle Transfer Forwarding Lease Fence

This round reduces the support bundle persistence risk that a stale transfer
forwarding worker could continue after its `processing` lease expired and was
re-acquired by another worker. The forwarding ledger already persisted
queued/retry/forwarded/dead-letter state, but forwarded and failed writes only
checked `status=processing`, and stale workers could reach storage
verification with an old in-memory row.

Transfer forwarding processing now re-locks the forwarding row and confirms
the same current non-expired worker lease before storage verification,
forwarded terminal writes, or retry/dead-letter writes. If another worker has
re-acquired the row, the stale worker returns the current row without marking
the authorization downloaded, writing a transfer event, or overwriting
forwarding failure state.

Focused support bundle coverage now forces a forwarding lease to expire and
be re-acquired, then verifies the stale worker cannot verify storage, mark the
authorization downloaded, or write transfer events. The current worker can
still process and forward the same row normally.

Remaining risk: transfer forwarding now respects durable lease ownership
before direct-download side effects. Production object-storage webhook
adapters still need deployment-specific signature verification, queue
monitoring, alerting/search for dead-lettered rows, and operational retry
workflows outside the internal ingestion contract.

## 810. P2 landing record: Repair Execution Side-effect Lease Fence

This round reduces the repair execution race where a worker could acquire a
request lease, pass cooperative cancellation, then have its lease expire and be
recovered while the old worker still held an in-memory request object. Before
this fence, the stale worker could still enter constrained registry side-effect
publishing before `completeWorkerExecution` rejected the stale terminal write.

The repair execution model now exposes a current-lease check that locks the
request row and verifies `running` state, the same worker lease id, and a
non-expired lease. The worker calls that check immediately before
`applySideEffect` and uses the freshly locked record for side-effect inputs. If
stale recovery has cleared or moved the lease, the old worker exits without
calling registry publishers, writing side-effect ledger/audit evidence, or
failing/retrying the recovered request.

Focused repair execution coverage now forces the worker lease to expire and
be recovered between the cancellation check and side-effect publish, then
verifies the stale worker never calls the Prompt Registry publisher, never
writes a registry revision, never writes a side-effect ledger row, and leaves
the recovered queued request without completed/failed/side-effect audit rows.

Remaining risk: the worker now respects durable lease ownership before
constrained registry side effects. This is still not true live interruption
after a side effect has started, and future non-registry executors still need
executor-specific idempotency, interrupt/resume, payload-correction, and
rollback contracts before broader mutable actions are enabled.

## 811. P2 landing record: Agent Runtime Adapter Lease Fence

This round reduces the Agent Runtime race where a standalone worker could
acquire a run lease, pass cooperative cancellation, then have its lease expire
and be recovered while the old worker still held an in-memory run object. That
old worker could still resolve and invoke a registered adapter before later
completion/failure guards noticed that durable lease ownership had changed.

The Agent Runtime model now exposes a current-lease check that locks the run
row and verifies standalone `running` state, the same worker lease id, and a
non-expired lease. The standalone worker calls that check before workflow
adapter resolution and execution, and uses the freshly loaded run for
capability checks and adapter input. If stale recovery has cleared or moved
the lease, the worker exits without invoking adapters or writing terminal
worker failure/result evidence.

Focused Agent Runtime coverage now forces a worker lease to expire and be
recovered between the cancellation-request check and adapter execution, then
verifies the stale worker never calls the registered adapter, never writes a
terminal worker execution result, and leaves the recovered queued/pending
state with no completed-worker timeline evidence.

Remaining risk: standalone Agent Runtime now respects durable lease ownership
before adapter execution. This remains a pre-adapter fence, not true live
interruption after a production tool/Codex/MCP/model adapter has started
external work. Production adapters still need executor-specific schemas,
side-effect idempotency, interrupt/resume contracts, and redaction policies.

## 812. P2 landing record: Support Bundle Transfer Forwarding Visibility

This round reduces the support bundle persistence risk that the durable
transfer forwarding ledger was operationally inspectable only through direct
SQL. Forwarding rows already persisted retry/dead-letter state and had a stale
lease fence, but normal support bundle reads showed only completed transfer
events.

`CopilotSupportBundleType` now exposes `transferForwardingEventCount` and the
latest transfer forwarding rows. The support bundle model hydrates recent
forwarding history for both `get` and `list` by joining forwarding rows through
download authorizations, returning status, provider event id/source,
forwarding event and payload fingerprints, payload JSON, provider-signature
evidence fingerprint, forwarded transfer-event fingerprint, retry/dead-letter/
forwarded timestamps, attempt counters, worker lease evidence, and bounded
failure diagnostics.

Common GraphQL create/get/list operations and embedded query constants now ask
for the forwarding history, and Admin renders the count plus recent retry,
forwarded, dead-letter, payload, signature, failure, and lease evidence beside
the existing support bundle transfer and audit history. Focused backend
coverage verifies GraphQL list/detail reads return both a forwarded retry row
and a dead-lettered forwarding row, and Admin coverage verifies the forwarding
history is visible in the support bundle list.

Remaining risk: operators can now inspect forwarding queue history without
direct SQL, but production object-storage webhook adapters still need
deployment-specific signature verification, environment-specific wiring,
dead-letter alerting/search workflows, and operational replay UX outside the
internal ingestion contract.

## 813. P2 landing record: Provider Health Probe Attempt Visibility

This round reduces the DB-backed registry risk that durable Provider Health
probe attempts were still mostly inspectable only through direct SQL. The
attempt ledger already persisted automatic no-network probe scheduling,
publish-time immediate attempts, worker leases, terminal result metadata, and
stale-lease completion fences, but normal operator reads only saw the single
attempt returned by Provider Registry publish.

`CopilotProviderHealthStateModel` now exposes a bounded workspace-scoped list
method for recent `ai_provider_health_probe_attempts` rows using the same
hydrated projection as single-attempt reads. `Copilot.providerHealthProbeAttempts`
wraps that list behind the normal workspace `Workspace.Copilot` permission
check and returns revision id/fingerprint binding, provider profile source and
snapshot evidence, profile/request/result/state fingerprints, actor, attempt
counters, terminal timestamps, failure diagnostics, and worker lease evidence.

Common GraphQL adds a dedicated workspace query for probe attempt history, and
Admin renders recent provider health probes beside model route diagnostics.
Focused backend coverage verifies the GraphQL read path exposes the completed
worker-produced attempt with the same persisted profile snapshot, result
metadata, Provider Health state linkage, and lease-cleared terminal evidence.
Admin coverage verifies the rendered diagnostics include provider, revision,
profile, request, result, and state evidence after a workspace scope is
selected.

Remaining risk: operators can now inspect recent Provider Health probe
attempts without direct SQL. External network/credential health probes,
Provider Registry credential/editor workflows, probe-attempt search and
dead-letter alerting/replay remain separate product/deployment slices.

## 814. P2 landing record: Provider Health Probe Dead-letter Retry

This round reduces the DB-backed registry risk that a Provider Health probe
attempt could become dead-lettered with durable evidence and operator
visibility, but recovering it still required direct SQL or waiting for a new
revision/time bucket. The terminal row was intentionally immutable, so the
recovery path must not rewrite the dead-lettered attempt.

`CopilotProviderHealthStateModel.retryDeadLetteredProviderHealthProbeAttempt`
now verifies the requested attempt belongs to the workspace, is
`dead_lettered`, and still points at the same active Provider Registry revision
id/fingerprint. It then enqueues a fresh attempt in a short manual retry
bucket, preserving the original terminal dead-letter evidence while creating a
new queued request fingerprint for worker replay.

GraphQL/common/Admin expose the retry operation from the recent provider
health probe list. Admin shows a retry control only for dead-lettered attempts
and renders the fresh queued attempt evidence after the mutation. Focused
backend coverage verifies retrying creates a second queued row while the old
dead-letter row keeps its failure code, request fingerprint, attempt count,
and terminal timestamp.

Remaining risk: operators can now replay no-network dead-lettered Provider
Health probe attempts without direct SQL. External network/credential probes,
Provider Registry credential/editor workflows, and broader probe-attempt
search/alert workflows remain separate product/deployment slices.

## 815. P2 landing record: Support Bundle Transfer Forwarding Dead-letter Replay

This round reduces the support bundle persistence risk that durable transfer
forwarding rows could become visible and dead-lettered, but recovery still
required direct SQL or a duplicate external provider notification. The
terminal forwarding row is intentionally immutable, so replay must append a
new row instead of rewriting the old failure evidence.

`CopilotSupportBundleModel.replayDeadLetteredDirectDownloadTransferForwardingEvent`
now verifies the requested forwarding row belongs to the workspace and is
`dead_lettered`, rebuilds the transfer event from the immutable forwarding
payload, and inserts a fresh `queued` forwarding row. The new row has its own
payload and event fingerprints, while its payload carries
`copilot-support-bundle-transfer-forwarding-replay/v1` metadata pointing back
to the source forwarding row id, source payload/event fingerprints, source
attempt counts, dead-letter timestamp, and failure diagnostics.

GraphQL/common/Admin expose the replay operation from the support bundle
forwarding history. Admin shows `Replay` only for dead-lettered forwarding
rows, renders the queued replay evidence after mutation, and links it back to
the source row in the formatted diagnostics. Focused backend coverage verifies
replay creates a second queued row without mutating the original dead-letter
row, and GraphQL read paths return forwarded, dead-lettered, and replay rows.
Admin coverage verifies the mutation variables and queued replay evidence.

Remaining risk: operators can now replay support bundle transfer forwarding
dead letters without direct SQL while preserving terminal evidence. Production
object-storage webhook adapters still need provider-specific signature
verification and environment wiring, and broader forwarding-history
search/filter plus alerting workflows remain separate deployment/product
slices.

## 816. P2 landing record: Agent Runtime Post-adapter Cooperative Cancellation

This round closes the Agent Runtime gap where a standalone cancellation request
created after adapter execution started could be missed if the adapter returned
without writing a terminal state. That race previously fell through to the
incomplete-adapter failure guard and could persist a false worker failure.

`CopilotAgentRuntimeWorker` now checks for a matching cancellation request
after an adapter returns and before `agent_runtime_adapter_incomplete_execution`
is recorded. `CopilotAgentRuntimeModel.cancelLeasedStandaloneRunIfCancellationRequested`
now consumes a scoped request by using the terminal cancel path under the same
worker lease/attempt instead of re-appending another `cancel_requested` event.

Focused backend coverage now exercises both the pre-adapter worker-consumption
path and a post-adapter-yield cancellation. The post-adapter case verifies the
run becomes `cancelled`, the step is `skipped`, no execution-result ledger row
or worker-failure summary is written, and the terminal cancellation evidence
retains the operator reason from the original request.

Remaining risk: this is cooperative cancellation after an adapter yields
control back to the worker. True preemptive interruption while a production
Codex/MCP/tool/model executor is still performing external work still needs an
executor-specific interrupt protocol and side-effect contract.

## 817. P2 landing record: Repair Execution Worker Failure Attempt Fence

This round reduces a repair execution stale-worker race in the failure path.
Worker completion and cooperative cancellation already compare the leased
worker state before terminal writes, but `failWorkerExecution` only checked the
lease id and running status. A stale in-memory failure handler could therefore
write failure or retry audit evidence after the request attempt changed under
the same lease id.

`CopilotRepairExecutionModel.failWorkerExecution` now requires
`worker_attempt` to match the worker attempt read before failure handling. If
the attempt changed, the update fails closed before request status, runtime
result, failure fields, retry scheduling, or audit rows are written.

Focused backend coverage now simulates a coherent direct attempt drift with
matching running audit evidence, feeds the stale in-memory record back to
`failWorkerExecution`, and verifies the stale failure is rejected while the
request remains running with no failed or retry-scheduled audit rows.

Remaining risk: this closes the stale-attempt failure-write gap for the
current constrained repair worker. Broader executors still need their own
side-effect idempotency and interrupt/rollback contracts before they are
enabled.

## 818. P2 landing record: Provider Health Probe Attempt Counter Fence

This round closes the Provider Health probe race where completion/failure
paths revalidated the current lease id but did not compare the attempt counter
that the worker originally leased. A stale in-memory worker could therefore
write route-affecting health state, retry, failure, or dead-letter evidence if
attempt metadata changed under the same lease id.

`CopilotProviderHealthStateModel` now treats a probe attempt lease as current
only when status, lease id, non-expired lease time, and attempt count all match
the worker snapshot. Completion and failure conditional updates also include
`attempt_count`, so stale attempt snapshots fail closed before terminal or
retry evidence is written.

Focused backend coverage now simulates same-lease attempt counter drift,
verifies stale completion does not publish a Provider Health state, verifies
stale failure does not write failure or retry evidence, and confirms the
current attempt snapshot can still complete normally.

Remaining risk: this hardens the no-network Provider Health probe worker
around stale attempt snapshots. External network/credential probes still need
executor-specific timeout, cancellation, and side-effect contracts before they
are enabled.

## 819. P2 landing record: Support Bundle Transfer Forwarding Attempt Fence

This round closes the same stale-attempt class in support bundle transfer
forwarding. Forwarding workers already re-locked rows and checked the current
lease before storage verification, but the lease check did not include the
attempt counter. If attempt metadata changed under the same lease id, a stale
in-memory worker could still verify storage, append transfer events, mark the
download authorization downloaded, or write retry/dead-letter evidence.

`CopilotSupportBundleModel` now treats a transfer forwarding lease as current
only when status, worker lease id, non-expired lease time, and attempt count
all match the worker snapshot. Forwarded terminal writes and failed
retry/dead-letter writes also include `attempt_count` in their conditional
updates.

Focused backend coverage now simulates same-lease attempt drift for a
transfer forwarding row. The stale worker returns the current processing row
without mutating authorization state, transfer-event history, forwarding
terminal state, or failure diagnostics, while the current attempt can still
complete and mark the authorization downloaded.

Remaining risk: this hardens the durable forwarding queue around stale attempt
snapshots. Production object-storage webhook adapters, provider-specific
signature verification wiring, and broader forwarding alert/search workflows
remain deployment/product slices.

## 820. P2 landing record: Agent Runtime Worker Attempt Fence

This round closes the same stale-attempt class in standalone Agent Runtime.
The worker already re-locked the run and checked the current non-expired lease
before adapter resolution/execution, but worker-owned completion, record-only
completion, failure, and cancellation paths could still rely on the current
DB row after a same-lease attempt drift instead of the attempt originally
leased by the worker.

`CopilotAgentRuntimeModel` now requires an explicit `workerAttempt` for
worker-owned standalone current-lease checks, failure, generic completion,
record-only completion, and cooperative cancellation. Terminal run updates
include `worker_attempt` in their conditional writes, and the standalone
worker plus built-in adapters pass the leased attempt through instead of
allowing stale adapter paths to infer a newer attempt.

Focused Agent Runtime coverage now simulates coherent same-lease attempt drift
during adapter execution by appending matching run timeline evidence and
moving the run to attempt 2. The stale attempt 1 completion is rejected, the
worker's exception/failure fallback does not write terminal evidence, and the
run remains running with no execution-result ledger row, worker-completion
summary, worker-failure summary, or terminal completion/failure timeline.

Remaining risk: standalone Agent Runtime now fences stale workers by lease and
attempt before durable terminal writes. Real Codex/MCP/tool/model executors
still need executor-specific schemas, side-effect idempotency, timeout,
interrupt, and rollback contracts before arbitrary workflows can be enabled.

## 821. P2 landing record: Repair Execution Side-effect Attempt Fence

This round extends the repair execution stale-attempt fence from worker failure
handling to the side-effect and cooperative-cancel paths. The worker already
re-locked a request before applying constrained registry side effects, but the
current-lease check and cancellation completion path only compared the lease
id. A stale in-memory worker could therefore consume an old cancellation
request or proceed toward completion if attempt metadata changed under the
same lease id.

`CopilotRepairExecutionModel` now requires an explicit `workerAttempt` for
`currentLeasedExecutionBeforeSideEffect`,
`cancelLeasedExecutionIfCancellationRequested`, `completeWorkerExecution`, and
`failWorkerExecution`. The worker passes the attempt from the lease it acquired,
and completion/cancel conditional writes include `worker_attempt` before they
clear the lease or write terminal request state.

Focused repair execution coverage now simulates coherent same-lease attempt
drift by appending matching running audit evidence and moving the request from
attempt 1 to attempt 2. The stale attempt 1 worker does not consume the
cancel request, does not pass the side-effect current-lease check, and cannot
write a side-effect ledger row, side-effect audit row, completed audit row, or
terminal completion evidence.

Remaining risk: constrained registry repair side effects now fence stale
workers by lease and attempt before durable side-effect/cancel/completion
writes. True live interruption after a side effect starts, audited payload
correction, executor-specific side-effect idempotency, and rollback execution
remain future slices.

## 822. P2 landing record: Support Bundle Verified Forwarding Evidence Boundary

This round closes the support bundle transfer-forwarding trust-boundary gap
where an S3/R2 wrapper payload could carry
`providerSignatureEvidence.status=verified_by_upstream` in the JSON body. The
durable queue and DB constraints preserved that evidence once written, but the
controller boundary still let callers self-report upstream verification shape
as long as the internal transfer token was valid.

`CopilotController` now treats provider signature evidence as a server-owned
forwarding-header assertion. S3 object-created wrapper bodies reject
`providerSignatureEvidence`; verified evidence must arrive through
`x-support-bundle-provider-signature-evidence` after the existing internal
`x-access-token` guard has accepted the request, and the header is parsed with
the same strict provider/status/verifier/signature/policy schema before it is
folded into `notificationAuthEvidence`, forwarding fingerprints, transfer
events, and downloaded audit metadata.

Focused support bundle coverage now verifies body-injected provider signature
evidence is rejected, malformed forwarding-header evidence rejects, and valid
S3/EventBridge plus retry/dead-letter forwarding flows persist provider
signature evidence fingerprints from the verified forwarding header instead of
from JSON payload bodies.

Remaining risk: this closes the in-app durable forwarding ingestion boundary
against self-reported upstream verification evidence. Deployment-specific AWS
S3, Cloudflare R2, and S3-compatible webhook adapters still need real provider
signature verification and environment wiring before emitting the verified
forwarding header in production.

## 823. P2 landing record: Agent Runtime Adapter Cooperative Cancellation Contract

This round tightens the standalone Agent Runtime adapter boundary for future
production executors. The worker already checked for durable cancellation
before adapter execution and again after adapter return, but adapters had no
standard lease-scoped cancellation API while performing long-running external
work. A production Codex/MCP/tool/model adapter would otherwise need to
reimplement cancellation lookup and attempt fencing itself.

`CopilotAgentRuntimeWorkflowAdapterInput` now includes `workerAttempt` and
`checkCancellationRequested()`. The worker builds that checker from the
leased run snapshot and routes it through the existing model-owned
`cancelLeasedStandaloneRunIfCancellationRequested` path, preserving the same
status, worker lease id, and worker attempt checks used before adapter
execution and terminal writes.

Focused Agent Runtime coverage registers an adapter that requests cancellation
during execution and then calls the checker. The cancellation is consumed
inside the adapter, the run becomes `cancelled`, the step is skipped, and the
worker's post-adapter guard does not write incomplete-execution, worker
failure, or execution-result evidence after the lease is released.

Remaining risk: this gives production adapters a durable cooperative
cancellation contract, but it is still not true preemptive interruption once
external work is already in flight. Real Codex/MCP/tool/model adapters still
need executor-specific timeout, side-effect idempotency, result schemas, and
redaction contracts before arbitrary workflows are enabled.

## 824. P2 landing record: Provider Health Probe Attempt Filtered Visibility

This round reduces the DB-backed registry risk that Provider Health probe
attempts were durable and retryable, but operators could only inspect the most
recent unfiltered rows. A dead-letter, queued retry, or publish-triggered
probe could still require direct SQL once it fell outside the small recent
window.

`CopilotProviderHealthStateModel.listProviderHealthProbeAttempts` now accepts
a constrained workspace-scoped filter for status, provider id, Provider
Registry revision id, revision/profile/request/result fingerprints, and a
bounded locator query over those same identity fields. GraphQL exposes the
filter through `Copilot.providerHealthProbeAttempts(filter, limit)` while
preserving the existing default recent-list behavior.

Common GraphQL and Admin pass the filter through. Admin now has a provider
health probe status selector plus a locator input for provider/revision/
fingerprint evidence, so completed, queued, retry-scheduled, processing, and
dead-lettered attempts can be located from the normal diagnostics surface.
Focused backend coverage verifies status, revision id, and request-fingerprint
locator filters. Admin coverage verifies the filter variables sent to GraphQL.

Remaining risk: this closes the SQL-only lookup gap for bounded Provider
Health probe attempt identity filters. It is not a full alerting system,
cross-workspace operational search, external network/credential probe flow, or
Provider Registry editor/credential management workflow.

## 825. P2 landing record: Support Bundle Forwarding Filtered Visibility

This round reduces the support bundle persistence risk that transfer
forwarding rows were durable, replayable, and visible only inside each recent
bundle's embedded history. Operators could still need direct SQL to locate a
dead-lettered or forwarded row by event/fingerprint evidence once the relevant
bundle was no longer obvious.

`CopilotSupportBundleModel.list` now accepts a constrained workspace-scoped
filter for support bundle status, retention status, transfer-forwarding
status, and a bounded locator query over bundle ids/fingerprints,
authorization ids/fingerprints, forwarding ids, event ids/sources,
forwarding event/payload/provider-signature/forwarded-transfer fingerprints,
and forwarding failure codes. GraphQL exposes this through
`Copilot.supportBundles(filter, limit)` while preserving the existing default
recent-list behavior.

Common GraphQL and Admin pass the filter through. Admin now has a support
bundle forwarding status selector plus a locator input, so queued,
processing, retry-scheduled, forwarded, and dead-lettered forwarding evidence
can be found from the normal support bundle diagnostics card. Focused backend
coverage verifies dead-letter status filtering, forwarding fingerprint locator
filtering, and no-match combinations; Admin coverage verifies the filter
variables sent to GraphQL.

Remaining risk: this closes the SQL-only lookup gap for bounded
workspace-scoped forwarding filters. It is not cross-workspace/provider
operational search, alerting, production webhook wiring, or real provider
signature verification rollout.

## 826. P2 landing record: Agent Runtime Run Filtered Visibility

This round reduces the Agent Runtime risk that AgentRun rows, steps, timeline
events, and execution results were durable but only discoverable through a
small unfiltered recent list or exact detail id. A queued, failed, cancelled,
or repair-linked run could still require direct SQL once it fell outside the
current Admin window.

`CopilotAgentRuntimeModel.list` now accepts a constrained workspace-scoped
filter for run status, workflow, source type/id, and a bounded locator query
over run id, workflow, source type/id, target/evidence/timeline fingerprints,
failure code, and worker lease id. GraphQL exposes this through
`Copilot.agentRuns(filter, limit)` while preserving the existing default
recent-list behavior.

Common GraphQL and Admin pass the filter through. Admin now has an Agent
Runtime run status selector plus a locator input, so queued, running,
waiting-approval, completed, failed, and cancelled runs can be located from
the Agent Runtime diagnostics card. Focused Agent Runtime coverage verifies
status filtering, source identity filtering, evidence-fingerprint locator
filtering, and no-match combinations; Admin coverage verifies the filter
variables sent to GraphQL.

Remaining risk: this closes the SQL-only lookup gap for bounded
workspace-scoped AgentRun filters. It is not a planner, production
Codex/MCP/tool/model adapter implementation, cross-workspace operational
search, alerting, or preemptive external-work interruption.

## 827. P1 landing record: Repair Execution Filtered Visibility

This round reduces the repair execution risk that durable request rows,
lifecycle audit history, side-effect ledger rows, and linked Agent Runtime
runs were discoverable only through the initiating mutation response, exact
worker/control flows, or direct SQL. A failed, queued, cancelled, completed, or
side-effect-bearing repair could fall outside the recent prompt-repair UI and
still require database inspection.

`CopilotRepairExecutionModel.list` now accepts a constrained workspace-scoped
filter for execution status, approval state, prompt name, requested action,
and a bounded locator query over request id, prompt/action, idempotency,
request/candidate/task-route/target/repair-job/approval/audit fingerprints,
failure code, worker lease id, audit event identity/fingerprint, and
side-effect ledger identity/fingerprint/evidence. GraphQL exposes this through
`Copilot.repairExecutions(filter, limit)` while preserving the existing default
recent-list behavior and hydrating the same audit and side-effect history as
detail reads.

Common GraphQL and Admin pass the filter through. Admin now has a repair
execution status selector plus locator input, and renders request fingerprints,
worker state, runtime result, linked Agent Runtime run status, audit history,
and side-effect ledger evidence from the persisted list surface. Focused
backend coverage verifies default list hydration, status filtering,
request-fingerprint, audit-fingerprint, side-effect-fingerprint locators, and
no-match behavior; Admin coverage verifies the filter variables sent to
GraphQL.

Remaining risk: this closes the SQL-only lookup gap for bounded
workspace-scoped repair execution filters. It is not a new executor,
operator-provided resume payload workflow, rollback implementation,
cross-workspace operational search, alerting system, or true preemptive live
interruption once side-effect application has started.
