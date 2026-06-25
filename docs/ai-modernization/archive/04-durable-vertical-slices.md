# Durable Vertical Slices

Archived from the former docs/ai-capability-modernization-plan.md.
Use docs/ai-modernization/README.md as the active planning entrypoint.
The archived body below may still mention former entrypoint paths; those
references are historical only.

---
## 555. P1 landing record: DB-backed Support Bundle Request and Minimal Manifest Persistence

This round stops the nested read-only support-bundle source-evidence placeholder chain and implements the first durable Support Bundle Persistence slice. The backend now has DB-backed support bundle request and audit event tables, persists workspace, actor, status, source evidence summary, source evidence fingerprint, manifest fingerprint, minimal manifest JSON, retention status, expiration, and create/read audit events, and exposes create/list/read GraphQL operations behind workspace permission checks.

- `packages/backend/server/schema.prisma` and `packages/backend/server/migrations/20260620000000_ai_support_bundle_requests/migration.sql` add `ai_support_bundle_requests` and `ai_support_bundle_audit_events`.
- `packages/backend/server/src/models/copilot-support-bundle.ts`, `packages/backend/server/src/models/index.ts`, `packages/backend/server/src/plugins/copilot/resolver.ts`, and `packages/backend/server/src/schema.gql` add the DB-backed model, deterministic fingerprints, minimal manifest generation, audit writes, GraphQL mutation/query fields, and authorization checks.
- `packages/common/graphql/src/graphql/copilot-support-bundle-*.gql`, `packages/common/graphql/src/graphql/index.ts`, and `packages/common/graphql/src/schema.ts` add generated common GraphQL operations and types.
- `packages/frontend/admin/src/modules/ai/index.tsx` and `packages/frontend/admin/src/modules/ai/index.spec.tsx` add Admin visibility and create/list test coverage.
- `packages/backend/server/src/__tests__/copilot/support-bundle.e2e.ts` covers persisted create/read/list behavior, manifest fingerprint persistence, audit event writes, and unauthorized workspace access rejection.

Validation used the fixed `localmind-affine:test` image with source copied into `/workspace`: GraphQL codegen succeeded, `prisma migrate deploy` applied `20260620000000_ai_support_bundle_requests`, backend `support-bundle.e2e.ts` passed 2 tests, Admin `index.spec.tsx` passed 22 tests, oxlint passed with 0 warnings/errors after import sort fixes, and Prettier check passed. No Docker image was rebuilt and no milestone-specific tag was created.

Remaining risk: support bundle archive bytes, object storage, download authorization, signed URL issuance, and retention cleanup worker are still not implemented. Repair execution remains read-only/blocked, Agent Runtime state is not durable, and Prompt/Model/Provider/Task registries are still not DB-backed by this slice.

## 556. P1 landing record: DB-backed Repair Execution Request and Audit Persistence

This round implements the first durable Repair Execution slice instead of adding
another read-only support-bundle placeholder. `ai_repair_execution_requests` and
`ai_repair_execution_audit_events` now persist workspace, actor, prompt target,
requested action, status, approval state, permission status, idempotency key,
evidence fingerprints, runtime result, completion/failure fields, and audit
events. The repair execution mutation still returns the legacy diagnostic
projection, but workspace-scoped calls now create or reuse a DB-backed request
after the existing permission/preflight checks. Approval-required requests stop
at `waiting_approval`; non-approval requests complete as a safe no-op with
`sideEffectsApplied: false`.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: GraphQL codegen succeeded, `prisma migrate deploy` applied
`20260620010000_ai_repair_execution_requests`, backend
`repair-execution.e2e.ts` passed 2 tests, backend `support-bundle.e2e.ts`
passed 2 tests, and Admin `index.spec.tsx` passed 22 tests. No Docker image was
rebuilt and no milestone-specific tag was created.

Remaining risk: approval decision mutations, real mutating repair executors,
worker lease/retry/failure handling, and rollback behavior remain future work.
Agent Runtime state and DB-backed registries are still not implemented by this
slice.

## 557. P2 landing record: DB-backed Agent Runtime Run, Step, and Timeline Persistence

This round implements the first durable Agent Runtime slice. The backend now has
`ai_agent_runs`, `ai_agent_steps`, and `ai_agent_timeline_events`, and the prompt
registry repair execution workflow creates or reuses an AgentRun linked to the
persisted repair execution request. The run stores workspace, actor, workflow,
source linkage, status, target/evidence/timeline fingerprints, timestamps, and
failure fields; the step stores status/type/output summary; timeline events store
sanitized payloads and event fingerprints. Admin displays the run, step, and
timeline status through the repair execution result.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: GraphQL codegen succeeded, `prisma migrate deploy` applied
`20260620020000_ai_agent_runtime_state`, backend `repair-execution.e2e.ts`
passed 2 tests with DB assertions for run/step/timeline rows, and Admin
`index.spec.tsx` passed 22 tests. No Docker image was rebuilt and no
milestone-specific tag was created.

Remaining risk: only repair execution is connected to Agent Runtime. Separate
AgentRun read/list APIs, broader action/prompt workflows, worker lease,
cancellation, resume/recovery, and tool/Codex/MCP step executors remain future
work. DB-backed registries are still not implemented by this slice.

## 558. P2 landing record: DB-backed Prompt Registry Revision Read Path

This round implements the first DB-backed registry slice. Prompt Registry now has
`ai_prompt_registry_revisions` records with prompt name, scope, workspace, actor,
revision, status, fingerprint, fallback source chain, and timestamps. Prompt
catalog resolution reads the latest active DB revision, prefers workspace scope
over global scope, preserves legacy registry/config fallback behavior, and
exposes DB/legacy/config source-chain evidence through GraphQL and Admin.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: GraphQL codegen succeeded, `prisma migrate deploy` applied
`20260620030000_ai_prompt_registry_revisions`, backend
`prompt-registry-revision.e2e.ts` passed 2 tests, support bundle and repair
execution e2e suites each passed 2 tests, Admin `index.spec.tsx` passed 23
tests, oxlint passed, Prettier check passed, and host `git diff --check`
passed. No Docker image was rebuilt and no milestone-specific tag was created.

Remaining risk: Prompt Registry write/edit/publish APIs, review/audit history,
bulk migration UI, prompt body diff/eval, and DB-backed Provider, Model, and
Task Route Policy registries remain future work.

## 559. P1 landing record: Repair Execution Approval Decision Persistence

This round implements the Repair Execution approval decision slice. Persisted
`waiting_approval` repair execution requests can now be approved or rejected
through GraphQL after workspace permission checks. Approval writes decision and
terminal audit events, stores an approved safe no-op runtime result, synchronizes
the linked AgentRun/AgentStep/timeline to `completed`, and keeps
`sideEffectsApplied: false`. Rejection writes rejected/cancelled audit events,
stores a rejected non-mutating runtime result, and synchronizes Agent Runtime to
`cancelled`/`skipped`. Admin exposes approve/reject controls and renders the
decision result.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: GraphQL codegen succeeded, `prisma migrate deploy` had no pending
migrations after the approval-decision constraint migration was applied, backend
`repair-execution.e2e.ts` passed 5 tests, and Admin `index.spec.tsx` passed 23
tests. No Docker image was rebuilt and no milestone-specific tag was created.

Remaining risk: approval still does not run a mutating executor. Real low-risk
repair side effects, worker lease/retry/failure handling, rollback behavior,
support bundle archive/download/retention execution, broader Agent Runtime
workflows, and DB-backed Model/Provider/Task registries remain future work.

## 560. P1 landing record: Support Bundle Download Authorization and Minimal Manifest Artifact

This round implements the Support Bundle download authorization slice. Support
bundle downloads now have persisted authorization records with workspace, actor,
bundle id, artifact metadata, manifest fingerprint, authorization fingerprint,
token fingerprint, expiration, status, and downloaded time. GraphQL issues a
short-lived manifest download URL after workspace permission checks. The HTTP
endpoint validates and consumes the token, returns the minimal manifest JSON as
an attachment, and records `download_authorized`/`downloaded` audit events.
Admin can request the manifest artifact and display the latest authorization.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: GraphQL codegen succeeded, `prisma migrate deploy` applied
`20260621010000_ai_support_bundle_download_authorizations`, backend
`support-bundle.e2e.ts` passed 2 tests covering authorization/download/audit,
backend `repair-execution.e2e.ts` passed 5 regression tests, and Admin
`index.spec.tsx` passed 23 tests. No Docker image was rebuilt and no
milestone-specific tag was created.

Remaining risk: support bundles still do not create full archive bytes or
object-storage-backed artifacts, object-storage signed URL issuance is not
implemented, and retention cleanup execution remains future work.

## 561. P1 landing record: Repair Execution Prompt Registry Revision Executor

This round implements the first real mutating Repair Execution executor.
Persisted prompt registry repair execution requests now store an
`executor_payload`; approval consumes that persisted payload after workspace
permission and `waiting_approval` checks, publishes a workspace-scoped
`ai_prompt_registry_revisions` row, writes `running`,
`side_effect_applied`, and terminal audit events, and exposes side-effect kind,
record id, fingerprint, and summary through GraphQL, Agent Runtime, and Admin.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: `prisma migrate deploy` applied
`20260621020000_ai_repair_execution_executor_payload`, GraphQL codegen
succeeded, backend `repair-execution.e2e.ts` passed 5 tests, backend
`prompt-registry-revision.e2e.ts` passed 2 tests, Admin `index.spec.tsx` passed
23 tests, oxlint passed, and Prettier check passed. No Docker image was rebuilt
and no milestone-specific tag was created.

Remaining risk: this executor only publishes DB-backed Prompt Registry
workspace revisions. Worker leasing, retry/failure handling, rollback behavior,
additional repair executors, support bundle archive/storage cleanup, broader
Agent Runtime workflows, and DB-backed Provider/Model/Task registries remain
future work.

## 562. P1 landing record: Support Bundle Retention Cleanup Execution

This round implements DB-backed Support Bundle retention cleanup. A new
workspace-scoped GraphQL/Admin operation expires due active support bundles,
updates request and manifest retention state, recalculates the manifest
fingerprint, marks outstanding authorized manifest downloads as `expired`, and
writes `retention_expired` audit events after workspace permission checks.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: `prisma migrate deploy` applied
`20260621030000_ai_support_bundle_retention_cleanup`, GraphQL codegen
succeeded, backend `support-bundle.e2e.ts` passed 3 tests, Admin
`index.spec.tsx` passed 23 tests, oxlint passed, and Prettier check passed. No
Docker image was rebuilt and no milestone-specific tag was created.

Remaining risk: support bundles still do not create full archive bytes or
object-storage-backed artifacts, object-storage signed URL issuance is not
implemented, and retention cleanup is manual/Admin-triggered rather than
scheduled worker execution.

## 563. P1 landing record: Support Bundle Minimal Archive Artifact Persistence

This round implements the next Support Bundle Persistence slice. Support bundle
creation now writes a minimal `localmind-support-bundle-archive/v1` JSON artifact
to the configured blob storage provider, persists archive storage key, byte size,
fingerprint, MIME type, and filename on `ai_support_bundle_requests`, includes
archive metadata in the manifest, and writes an `archive_created` audit event.
Download authorization now supports `archive_json` with a persisted artifact
fingerprint, and the API artifact endpoint validates and consumes the token
before returning manifest or archive bytes. Admin shows archive metadata and
requests the archive artifact by default.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: GraphQL codegen succeeded, `prisma migrate deploy` applied
`20260621040000_ai_support_bundle_archive_artifacts`, backend
`support-bundle.e2e.ts` passed 3 tests, Admin `index.spec.tsx` passed 23 tests,
oxlint passed, and Prettier check passed. No Docker image was rebuilt and no
milestone-specific tag was created.

Remaining risk: the archive is still a minimal JSON artifact rather than a full
packaged support bundle, clients still download through the API proxy rather
than object-storage signed URLs, and retention cleanup remains manual/Admin
triggered rather than scheduled worker execution.

## 564. P1 landing record: Support Bundle Scheduled Retention Cleanup Worker

This round wires Support Bundle retention cleanup into the existing Copilot cron
and BullMQ worker path. Daily cron now enqueues
`copilot.supportBundle.cleanupRetention` with a fixed job id, and the job handler
expires due bundles across workspaces in bounded batches. The worker reuses the
same persisted support bundle request, download authorization, and audit rows as
the Admin cleanup path; `retention_expired` audit metadata records
`cleanupScope=scheduled_worker` and
`cleanupActorId=system_retention_worker` while preserving the original bundle
actor on the audit row.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: backend `support-bundle.e2e.ts` passed 4 tests including scheduled
worker cleanup, and targeted backend `copilot.spec.ts` cron coverage passed. No
Docker image was rebuilt and no milestone-specific tag was created.

Remaining risk: support bundle archive contents are still minimal JSON rather
than a full packaged support bundle, and clients still download through the API
proxy rather than object-storage signed URLs.

## 565. P1 landing record: Support Bundle Packaged Archive Contents

This round expands Support Bundle archive bytes from a minimal outer JSON
summary into a packaged `localmind-support-bundle-archive/v1` JSON artifact.
The stored archive now contains a deterministic file index and embedded
`manifest.json`, `source-evidence-summary.json`,
`prompt-catalog-summary.json`, `actor-action-runs.json`, and
`task-route-summary.json` sections. Each embedded JSON file records path, media
type, byte size, and fingerprint; the archive records a deterministic index
fingerprint. Existing DB request metadata, blob storage persistence, API
artifact authorization, token consumption, and audit behavior are reused for the
packaged bytes.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: GraphQL build succeeded, backend `support-bundle.e2e.ts` passed 4
tests, oxlint passed, and Prettier check passed. No Docker image was rebuilt and
no milestone-specific tag was created.

Remaining risk: clients still download through the API proxy rather than direct
object-storage signed URLs. Broader repair executors, Agent Runtime workflows,
and DB-backed Provider/Model/Task registries remain future work.

## 566. P1 landing record: Support Bundle Object-storage Signed URL Delivery

This round implements direct object-storage signed URL delivery for persisted
support bundle archive artifacts. Download authorization rows now persist
delivery method, direct URL, and direct URL expiration metadata; archive
authorization returns `object_storage_signed_url` when the configured storage
provider returns a signed `get` redirect with matching object metadata, and
falls back to `api_proxy` otherwise. GraphQL/common/Admin expose the delivery
method and direct URL expiration, while the API artifact endpoint rejects
direct-delivery authorizations to avoid consuming the wrong delivery path.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: backend `support-bundle.e2e.ts` passed 5 tests, Admin
`index.spec.tsx` passed 23 tests, GraphQL build succeeded, oxlint passed, and
Prettier check passed. No Docker image was rebuilt and no milestone-specific
tag was created.

Remaining risk: direct object-storage downloads currently record authorization
audit metadata but not a post-download `downloaded` event, because the client
leaves the API path. Manifest artifacts still use the API proxy unless a later
slice explicitly adds direct manifest delivery.

## 567. P1 landing record: Repair Execution Queued Worker Lease And Retry

This round moves approved repair execution side effects out of the GraphQL
resolver and into a queued worker path. Repair execution requests now persist
queued time, worker lease id/expiration, attempt count, max attempts, and last
attempt time. Approval transitions waiting requests to `queued`, writes
approval/queued audit events, and enqueues `copilot.repairExecution.run`. The
worker leases approved queued requests, synchronizes Agent Runtime running
state, applies the existing Prompt Registry revision publisher, records
side-effect/completion audit events, and persists retryable or terminal worker
failures.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: `prisma migrate deploy` applied
`20260621060000_ai_repair_execution_worker_lease`, backend
`repair-execution.e2e.ts` passed 6 tests, Admin `index.spec.tsx` passed 23
tests, GraphQL build succeeded, oxlint passed, and Prettier check passed. No
Docker image was rebuilt and no milestone-specific tag was created.

Remaining risk: only the Prompt Registry revision publisher executor exists;
explicit cancellation/resume controls and rollback behavior are still not
implemented.

## 568. P2 landing record: Agent Runtime Independent Read/List Observability

This round implements the next Agent Runtime slice. Persisted AgentRun state is
now independently queryable through workspace-scoped GraphQL `agentRuns(limit)`
and `agentRun(id)` fields with steps and timeline events, instead of only being
visible through repair execution mutation responses. Admin now has a standalone
Agent Runtime status card that lists recent persisted runs, step states,
timeline summaries, fingerprints, source linkage, and failure metadata.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: backend `repair-execution.e2e.ts` passed 7 tests, Admin
`index.spec.tsx` passed 24 tests, GraphQL build succeeded, oxlint passed, and
Prettier check passed. No Docker image was rebuilt and no milestone-specific
tag was created.

Remaining risk: Agent Runtime is still only connected to prompt registry repair
execution. Additional workflows, cancellation/resume/recovery controls, and
Codex/MCP/tool execution step adapters remain future work.

## 569. P2 landing record: DB-backed Task Route Policy Revisions

This round adds DB-backed Task Route Policy revision records for embedding,
workspace indexing, and rerank model selection. `TaskPolicy` now resolves the
latest active workspace revision before global revision and config fallback, and
workspace embedding/rerank runtime calls use that DB-aware resolution path.
GraphQL/common/Admin expose revision metadata, source-chain fingerprint, and
DB/config fallback evidence.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: `prisma migrate deploy` applied
`20260621070000_ai_task_route_policy_revisions`, backend
`task-route-policy-revision.e2e.ts` passed 2 tests, Admin `index.spec.tsx`
passed 24 tests, GraphQL build succeeded, oxlint passed, Prettier check passed,
and `git diff --check` passed. No Docker image was rebuilt and no
milestone-specific tag was created.

Remaining risk: Task Route Policy still has no Admin write/edit/publish API or
bulk migration from config defaults. DB-backed Provider and Model registries
remain future work.

## 570. P2/P1 landing record: Task Route Policy Repair Executor

This round adds a second constrained repair execution side effect. Approved
`repair_task_model_route` requests can now carry a
`task_route_policy_revision_publish` executor payload into the queued repair
worker, which writes a workspace-scoped `ai_task_route_policy_revisions` row
with actor, feature kind, model id, config key/path, fingerprint, fallback
source chain, and repair execution metadata. Runtime result and audit metadata
record side-effect kind `task_route_policy_revision`; the existing TaskPolicy
runtime path can resolve the published workspace revision before config
fallback.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: backend `repair-execution-task-route-policy.e2e.ts`,
`repair-execution.e2e.ts`, and `task-route-policy-revision.e2e.ts` passed;
oxlint, Prettier check, and `git diff --check` passed. No Docker image was
rebuilt and no milestone-specific tag was created.

Remaining risk: Task Route Policy still lacks a full Admin editor workflow,
bulk migration UI, cancellation/resume controls, and rollback behavior.

## 571. P1 landing record: Repair Execution Manual Control

This round adds persisted manual controls for repair execution. GraphQL/common
now expose `controlCopilotRepairExecution` for `cancel` and `retry` after
workspace permission checks. Cancel transitions waiting/queued/failed requests
to terminal `cancelled`, clears stale lease/failure state, writes control audit
metadata, and synchronizes Agent Runtime. Retry requeues failed executable
requests, clears failure/completion fields, extends worker attempts when
exhausted, writes `manual_retry_requested` plus `queued` audit events, and uses
a fresh worker job id so the existing queued worker applies the same constrained
executor path. Admin exposes cancel/retry controls for eligible persisted
requests.

Validation used the fixed `localmind-affine:test` image with source copied into
`/workspace`: `prisma migrate deploy` applied
`20260621080000_ai_repair_execution_manual_control`, backend
`repair-execution.e2e.ts` passed 10 tests,
`repair-execution-task-route-policy.e2e.ts` passed 1 test, Admin
`index.spec.tsx` passed 25 tests, oxlint passed, and Prettier check passed. No
Docker image was rebuilt and no milestone-specific tag was created.

Remaining risk: running requests are not interrupted; manual resume/recovery
beyond failed-request retry is still future work. Rollback remains unimplemented
and no rollback fields were added.

## 572. P2/P1 landing record: Provider Registry Repair Executor

This round adds the constrained Provider Registry repair execution side effect.
Approved provider registry repair payloads can now carry a
`provider_registry_revision_publish` executor payload into the queued repair
worker, which writes a workspace-scoped `ai_provider_registry_revisions` row
with actor, provider id/type, revision, fingerprint, sanitized provider profile
metadata, fallback source chain, and repair execution metadata. Persisted
provider profile metadata stores `config: {}` and continues to reuse the
existing configured provider runtime/credentials, so this does not introduce
provider secret writes or arbitrary provider runtime creation.

Runtime result and audit metadata record side-effect kind
`provider_registry_revision`; the existing provider registry overlay can
resolve the published workspace provider metadata before global/config
fallback. Focused backend coverage was added for approval queueing, worker
publication, DB metadata sanitization, and model diagnostics resolution from
the published provider profile.

Validation in the local desktop environment used source-level checks:
`git diff --check` and static scans for merge markers, focused-test-only calls,
debug output, and known unsafe patterns passed for the touched repair/provider
files. Docker was unavailable because the Docker Desktop Linux engine pipe was
not reachable, and the bundled Yarn invocation could not run focused tests
without the repo's node_modules state file.

Remaining risk: Provider Registry still lacks a full editable Admin workflow,
credential management, automatic health probe worker/history, and bulk
migration.
Rollback remains unimplemented, and running repair execution interruption still
requires a real interruptible executor/lease protocol.

## 573. P2 landing record: DB-backed Provider Health State Overlay

This round separates provider health from static provider profile metadata by
adding persisted workspace-scoped `ai_provider_health_states`. The new model
stores provider id/type, workspace, actor, health status, checked timestamp,
last error, source, fingerprint, metadata, and timestamps. GraphQL can record a
health state for an existing configured provider after `Workspace.Copilot`
permission checks and configured-provider validation.

Effective provider registry construction now overlays DB-backed provider health
state after Provider Registry profile revisions and before Model Registry
definition revisions. Existing route selection already treats `health.status ===
'down'` as not routeable, so a persisted `down` state now affects runtime model
availability and diagnostics without writing provider secrets or changing
provider runtime construction.

Focused backend coverage was added to verify DB persistence, route exclusion
when persisted health is `down`, route restoration when health returns to
`healthy`, and workspace authorization. Local validation was limited by the same
desktop environment constraints: source-level `git diff --check` and static
scans passed for the touched files, but Docker was unavailable and Yarn could
not run focused tests without the repo node_modules state file.

Remaining risk: this is a durable health state overlay, not an automatic network
probe worker. Provider Registry still lacks a full editable Admin workflow,
credential management, probe scheduling/history, and bulk migration.

## 574. P2 landing record: Constrained Model Registry Publish API

This round adds a direct Model Registry write path alongside the repair-driven
executor. GraphQL now exposes `publishCopilotModelRegistryRevision` for
workspace-scoped `ai_model_registry_revisions` after `Workspace.Copilot`
permission checks and configured-provider validation. The model writer reuses
the existing configured provider runtime, sanitizes persisted model definitions
to routeable metadata/capabilities, forces the stored definition id to the
requested model id, drops arbitrary config fields, and returns an existing
revision only when the sanitized fingerprint matches.

The existing provider registry overlay can immediately resolve the published
workspace model definition before provider-profile/native fallback. Focused
backend coverage was added for direct publication, DB metadata sanitization,
idempotent reuse, unknown-provider rejection, workspace authorization, and
route diagnostics from the published DB-backed model revision.

Validation in the local desktop environment used source-level checks. Docker
and Yarn focused tests remained unavailable for the same local reasons captured
in the previous landing records unless the daemon/node_modules state is
restored.

Remaining risk: Model Registry still lacks a full editable Admin workflow,
model diff/review UI, and bulk migration from provider profile/native registry
defaults. Task Route Policy direct write/edit/publish APIs and Prompt Registry
full edit/publish review flows remain future work.

## 575. P2 landing record: Constrained Task Route Policy Publish API

This round adds a direct Task Route Policy write path alongside the
repair-driven executor. GraphQL now exposes
`publishCopilotTaskRoutePolicyRevision` for workspace-scoped
`ai_task_route_policy_revisions` after `Workspace.Copilot` permission checks.
The model writer accepts only supported task route feature kinds
(`embedding`, `workspace_indexing`, and `rerank`), records model id,
config key/path, fallback source-chain evidence, revision, fingerprint, and
direct-publish metadata, and returns an existing revision only when the
sanitized fingerprint matches.

The existing TaskPolicy runtime path can immediately resolve the published
workspace revision before config/provider-default fallback. Focused backend
coverage was added for direct publication, DB row persistence, idempotent
reuse, route diagnostics from the published revision, and workspace
authorization.

Validation in the local desktop environment used source-level checks. Docker
and Yarn focused tests remained unavailable unless the local node_modules state
is restored.

Remaining risk: Task Route Policy still lacks a full editable Admin workflow
and bulk migration from config defaults. Prompt Registry full edit/publish
review flows, Model Registry editor UX, and Provider Registry credential
management remain future work.

## 576. P2 landing record: Constrained Prompt Registry Publish API

This round adds a direct Prompt Registry write path alongside the existing
repair-driven executor. GraphQL now exposes
`publishCopilotPromptRegistryRevision` for workspace-scoped
`ai_prompt_registry_revisions` after `Workspace.Copilot` permission checks,
legacy registry publish-gate validation, stale-version checks, and
route-readiness review. The model writer records registry/version evidence,
validation status, route-review fingerprints, fallback source-chain evidence,
revision, fingerprint, direct-publish review metadata, and idempotent matching
revision reuse.

The path intentionally does not copy prompt body content or bypass the existing
legacy prompt registry tables. It publishes a reviewed DB revision that the
catalog read path resolves before legacy/config fallback, while prompt-body
editing remains a separate future workflow.

Focused backend coverage was added for direct publication, metadata
persistence, idempotent reuse, catalog resolution from the published revision,
workspace authorization, and stale/blocked publish-gate rejection with no row
written. Local validation passed `git diff --check` and static scans for the
touched files. Focused e2e execution was attempted with the bundled Yarn
command but remained blocked because the repo node_modules state file is
missing in this desktop environment.

Remaining risk: Prompt Registry still lacks prompt-body edit APIs, full
diff/eval and review UI, bulk migration from legacy/config defaults, and full
audit/history views around the constrained direct publish path.

## 577. P1 landing record: Support Bundle Direct Download Acknowledgement

This round closes the remaining support-bundle direct signed-URL lifecycle gap
with code rather than diagnostics. GraphQL now exposes
`acknowledgeCopilotSupportBundleDirectDownload` behind `Workspace.Copilot`
permission checks. The model accepts only active same-workspace
`object_storage_signed_url` authorizations, rejects API-proxy or already-final
rows, checks direct URL and authorization expiration, revalidates the support
bundle as ready/active with matching manifest/archive fingerprints, then
persists the authorization as `downloaded` with `downloaded_at`.

The acknowledgement writes a durable `downloaded` audit event with delivery
method, artifact evidence, direct URL expiration, `authorizationActorId`, and
`clientAcknowledged=true`. It intentionally records client acknowledgement
telemetry only; it does not claim server proof that object storage transferred
bytes.

Focused backend coverage was extended in `support-bundle.e2e.ts` for direct
acknowledgement persistence, DB downloaded state, audit metadata, replay
rejection, and API-proxy rejection. Local validation passed `git diff --check`
and static scans for the touched files. Focused e2e execution was attempted
with the bundled Yarn command but remained blocked because the repo
node_modules state file is missing in this desktop environment.

Remaining risk: support bundles still lack server-verified object-storage
transfer callbacks/provider event ingestion, optional direct manifest delivery,
and automatic retry/escalation for failed archive object cleanup audit events.

## 578. P1 landing record: Support Bundle Archive Object Retention Cleanup

This round closes another support-bundle persistence gap by tying the stored
archive object lifecycle to DB retention expiry. After a support bundle row
successfully transitions to expired, retention cleanup now attempts to delete
the stored `archiveStorageKey` from the configured blob storage provider. The
existing `retention_expired` audit event records `archiveObjectCleanupStatus`,
the archive storage key, and delete error code/message if the provider rejects
the cleanup.

The implementation intentionally does not roll back DB retention expiry when
object deletion fails. Expiry remains durable, while failed storage cleanup is
captured as auditable operational metadata that can be retried or escalated by a
later worker.

Focused backend coverage was extended in `support-bundle.e2e.ts` to verify
successful archive object deletion during retention cleanup and failure metadata
when the storage provider rejects deletion. Local validation passed
`git diff --check` and static scans for the touched files. Focused e2e
execution was attempted with the bundled Yarn command but remained blocked
because the repo node_modules state file is missing in this desktop
environment.

Remaining risk: support bundles still lack autonomous retry/escalation for
failed archive object cleanup, provider-side transfer event ingestion, and
optional direct manifest delivery.

## 579. P1 landing record: Repair Execution Stale Running Lease Recovery

This round closes a repair execution recovery gap without pretending to support
live interruption or rollback. `controlCopilotRepairExecution` now accepts
`recover_stale` after the same workspace permission checks as cancel/retry. The
model only accepts `running` requests whose persisted `worker_lease_expires_at`
has passed, clears stale lease metadata, writes a `stale_recovered` audit event,
and requeues the request when worker attempts remain. If attempts are exhausted,
the same recovery path marks the request failed with
`stale_worker_lease`.

The resolver synchronizes the linked Agent Runtime state after recovery and
enqueues a fresh worker job only when recovery returns the request to `queued`.
This is explicit lease recovery after expiration; it does not interrupt an
active worker, add rollback state, or resume with operator-supplied payloads.

Focused backend coverage was added in `repair-execution.e2e.ts` for active-lease
rejection, expired running lease recovery, durable queued state, audit metadata,
and Agent Runtime sync. A migration adds `stale_recovered` to the repair
execution audit-event check constraint. Local validation passed
`git diff --check` and static scans for the touched files. Focused e2e
execution was attempted with the bundled Yarn command but remained blocked
because the repo node_modules state file is missing in this desktop
environment.

Remaining risk: live running interruption still requires an interruptible
executor/lease protocol, operator-provided resume remains future work, and
rollback should still wait for real rollback behavior.

## 580. P2 landing record: Agent Runtime Generic Step Persistence API

This round moves Agent Runtime one step beyond repair-execution-only creation
without claiming that Codex/MCP/tool adapters execute yet. The
`CopilotAgentRuntimeModel` now exposes an internal `createRun` API that persists
generic AgentRun rows with one or more typed steps: `model`, `tool`, `approval`,
`handoff`, `codex`, or `mcp`. It computes deterministic target/evidence/timeline
fingerprints, writes run/step/timeline rows, maps initial run status to default
step status, and reuses existing rows by workspace/source type/source id for
idempotent adapter ingestion.

Focused backend coverage was added in `repair-execution.e2e.ts` for generic
tool, Codex, and MCP step persistence, timeline event types, GraphQL list/detail
visibility, idempotent source reuse, and empty-step rejection. This is a
persistence API only: it does not execute tools, start Codex, call MCP servers,
or schedule arbitrary planner workflows.

Local validation passed `git diff --check` and static scans for the touched
files. Focused e2e execution was attempted with the bundled Yarn command but
remained blocked because the repo node_modules state file is missing in this
desktop environment.

Remaining risk: real planner/scheduler integration, standalone Agent Runtime
cancellation/resume, and Codex/MCP/tool execution adapters still need code.

## 581. P2 landing record: Standalone Agent Runtime Control API

This round closes the next Agent Runtime state-management gap without adding a
fake planner or executor. `CopilotAgentRuntimeModel` now exposes a
permission-checked standalone control path through GraphQL/Admin for persisted
generic AgentRun rows. `cancel` transitions non-terminal standalone runs to
`cancelled`, marks active steps as `skipped`, appends a `run_cancellation`
timeline event, and recalculates the timeline fingerprint. `resume` accepts
standalone `failed` or `cancelled` runs, returns the run to `queued`, clears
terminal failure/completion metadata, restores unfinished steps to `pending`,
and appends a manual resume timeline event.

Repair-execution-linked AgentRun rows are explicitly rejected by this new
control API and must still flow through `controlCopilotRepairExecution`, keeping
repair execution as the source of truth for approval, leases, retries, and
audit. Admin now shows standalone Agent Runtime cancel/resume controls while
rendering repair-execution runs with a pointer back to repair execution
controls.

Touched code includes `packages/backend/server/src/models/copilot-agent-runtime.ts`,
`packages/backend/server/src/plugins/copilot/resolver.ts`, generated GraphQL
schema/query files, `packages/frontend/admin/src/modules/ai/index.tsx`, and
focused backend/frontend tests.

Validation attempted: `git diff --check` and static scans for conflict markers
and debug output passed. Docker validation could not run because the Docker
Desktop Linux engine pipe was unavailable. Focused Yarn checks were attempted
with the repo Yarn release through the bundled Node runtime, but Yarn reported
that the node_modules state file is missing. No Docker image was rebuilt and no
milestone-specific tag was created.

Remaining risk: resumed standalone AgentRun rows are durable queued state only;
there is still no generic planner/worker scheduler or Codex/MCP/tool execution
adapter to consume them. Live interruption of arbitrary running adapters still
requires executor-level cancellation protocols.

## 582. P1 landing record: Support Bundle Archive Cleanup Retry

This round closes the support-bundle archive cleanup dead end with executable
retry behavior instead of another read-only diagnostic projection. Manual
`cleanupCopilotSupportBundleRetention` and the scheduled
`copilot.supportBundle.cleanupRetention` worker now use the existing support
bundle request and audit tables to find expired bundles whose latest
`retention_expired` audit metadata still records
`archiveObjectCleanupStatus=failed`. After due active bundle expiration consumes
part of the bounded batch, the remaining capacity retries failed archive object
deletions through the configured blob storage provider.

Each retry appends a new durable `retention_expired` audit event with
`archiveObjectCleanupRetry=true`, the new cleanup status, storage key, previous
cleanup fingerprint, and previous error metadata. The GraphQL/Admin cleanup
result now reports `archiveObjectCleanupRetryCount`,
`archiveObjectCleanupRecoveredCount`, and
`archiveObjectCleanupFailedCount`. The scheduled worker treats recovered retry
work as progress for batch continuation while avoiding a tight repeat loop when
storage continues to reject deletion.

Focused backend coverage was extended in `support-bundle.e2e.ts` for manual
retry after a failed retention cleanup, recovered audit metadata, retry counts,
and scheduled retry behavior. Admin coverage now verifies the cleanup summary
renders retry/recovered/failed counts. Local validation passed `git diff --check`
and static scans for conflict markers/debug output. Docker validation could not
run because the Docker Desktop Linux engine pipe was unavailable. Focused Yarn
checks remain blocked because the repo node_modules state file is missing in
this desktop environment.

Remaining risk: support bundles still lack provider-side transfer event
ingestion/server-verified object-storage transfer callbacks, optional direct
manifest delivery, and higher-level escalation/alerting for persistently failed
archive cleanup after retry attempts.

## 583. P1 landing record: Standalone Agent Runtime Worker Lease

This round closes the immediate Agent Runtime queued-run dead end with
DB-backed scheduler and worker plumbing instead of another read-only diagnostic
field. `ai_agent_runs` now carries durable `queued_at`, worker lease, attempt,
max-attempt, and last-attempt metadata. Generic AgentRun creation initializes
queued metadata, repair-execution projection mirrors repair execution lease
state, and standalone cancel/resume clears stale leases while resume extends the
max-attempt window needed for another worker pass.

The new `copilot.agentRuntime.run` worker leases only standalone AgentRun rows
through an atomic DB update and explicitly excludes
`repair_execution_request` runs, keeping repair execution as the source of
truth for approval, audit, retries, and side effects. Because no real generic
workflow adapters are registered yet, the worker does not pretend success: it
marks unsupported standalone runs failed with
`unsupported_agent_runtime_adapter`, fails active steps, and appends durable
lease/failure timeline events. A minute cron enqueues untargeted worker scans,
and `controlCopilotAgentRuntimeRun(... resume ...)` enqueues a targeted worker
job after permission checks.

GraphQL/Admin now expose AgentRun queued/lease/attempt metadata. Focused backend
coverage verifies standalone worker lease/failure persistence, repair-execution
worker isolation, and resume job enqueueing. Admin fixtures and generated
GraphQL artifacts were updated so the worker metadata is visible in the
standalone Agent Runtime run list.

Local validation passed `git diff --check` and static scans for conflict
markers/debug output. Focused Yarn checks remain blocked because this desktop
environment is missing the repo node_modules state file, and Docker validation
remains blocked because the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: Agent Runtime still lacks the real planner and
tool/Codex/MCP/handoff adapters. The new worker creates a durable terminal
failure path for queued standalone runs until those adapters exist.

## 584. P2 landing record: Provider Health Snapshot Persistence Worker

This round continues the DB-backed registries track by giving provider health a
system writer path, not just a manual GraphQL override. A new
`copilot.providerHealth.persistConfiguredSnapshots` worker scans configured
provider profiles that already carry health metadata and persists them into
global `ai_provider_health_states` rows with `source=probe_result`,
provider id/type, status, checked timestamp, last error, deterministic
fingerprint, and provider-profile source metadata.

Daily Copilot cron now enqueues this snapshot persistence job. The existing
provider registry overlay already reads global health rows before model
registry revisions, so persisted configured health now affects runtime route
availability and diagnostics through the same DB-backed path as manual
workspace health overrides. The worker updates one global row per provider and
does not create duplicate history rows.

This intentionally does not perform live network probes or touch provider
credentials. It persists the configured health snapshot that already exists in
the provider profile, leaving external probe execution/history for a later
credential-aware worker.

Focused backend coverage was added in
`provider-registry-revision.e2e.ts` for direct worker execution, global
`probe_result` row persistence, metadata, route overlay behavior, and idempotent
reruns. Local validation passed `git diff --check` and static scans for conflict
markers/debug output. Focused Yarn checks remain blocked because this desktop
environment is missing the repo node_modules state file, and Docker validation
remains blocked because the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: provider health still lacks live external probe execution,
probe history rows, alerting, and credential-aware scheduling.

## 585. P1 landing record: Repair Side-effect Idempotency And Registry Revision Uniqueness

This round closes a repair execution crash/retry gap in code. The queued repair
worker can now recover when a registry side effect was durably written before
the execution request reached `completed`: Prompt Registry, Task Route Policy,
Model Registry, and Provider Registry repair publishers compute the expected
revision fingerprint before accepting an existing revision, reuse matching
same-scope revisions, and reject same-scope revisions whose fingerprint differs.
That prevents a stale/current worker race or post-crash retry from silently
completing against an unexpected side effect.

Direct publish paths use the same conflict-safe insert and fingerprint recheck.
Prompt Registry and Task Route Policy reuse their existing partial unique
revision keys, and migration `20260621140000_ai_registry_revision_unique_keys`
adds matching global/workspace partial unique indexes for Model Registry and
Provider Registry revisions. All four families now have database-backed
same-scope revision uniqueness, with `ON CONFLICT DO NOTHING` followed by a
loaded-row fingerprint check for deterministic idempotent reuse.

Focused backend coverage in `repair-execution.e2e.ts` now simulates the crash
window by prewriting a matching Prompt Registry repair revision before worker
completion and verifies the next worker pass completes with one revision row.
It also prewrites a conflicting same-scope revision and verifies the worker
records failure instead of completing the execution. Local validation passed
`git diff --check`. Focused Yarn checks remain blocked because this desktop
environment is missing the repo node_modules state file, and Docker validation
remains blocked because the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: this is idempotency for the four DB registry revision
publishers only. Broader repair executors, live running interruption, generic
rollback behavior, and non-registry side-effect contracts still need separate
implementation before they should be enabled.

## 586. P1 landing record: Scheduled Repair Execution Stale Lease Recovery

This round closes another repair execution worker reliability gap by moving
expired running lease recovery from manual-only control into a scheduled system
job. The minute Copilot cron now enqueues
`copilot.repairExecution.recoverExpiredLeases`, which scans bounded batches of
`running` repair execution requests whose `worker_lease_expires_at` is in the
past. Each expired lease is recovered through the same persisted stale-recovery
state transition used by manual control, but the audit metadata records
`recoverySource=system` and the runtime result executor is
`repair_execution_stale_recovery_worker`.

Recovered requests with attempts remaining are returned to `queued`, synced
back into Agent Runtime queued/pending state, and get a fresh
`copilot.repairExecution.run` job. Requests with exhausted attempts become
terminal `failed` with `stale_worker_lease`. The job only works on expired
leases; it does not interrupt active workers or introduce rollback semantics.

Focused backend coverage in `repair-execution.e2e.ts` now verifies scheduled
recovery of an expired running lease, Agent Runtime synchronization, fresh
worker job enqueueing, and system recovery audit metadata. Local validation
passed `git diff --check` and static scans for conflict markers/debug output.
Focused Yarn checks remain blocked because this desktop environment is missing
the repo node_modules state file, and Docker validation remains blocked because
the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: scheduled stale recovery is still lease-expiration recovery,
not live cancellation or rollback. True interruptible executors and rollback
contracts remain future work.

## 587. P1 landing record: Support Bundle Persistent Cleanup Escalation

This round closes the support-bundle scheduled retry loop for persistently
failing archive object cleanup. Failed archive delete retries now carry a
durable failure count derived from prior `retention_expired` audit events.
When the scheduled retention worker records another failed retry after the
threshold is reached, it appends escalation metadata directly to the cleanup
audit event:
`archiveObjectCleanupEscalated=true`,
`archiveObjectCleanupEscalationReason=scheduled_retry_limit_exceeded`,
`archiveObjectCleanupFailureCount`, and
`archiveObjectCleanupEscalatedAt`.

Scheduled cleanup scans now skip expired bundles whose latest cleanup audit
event is already escalated, so a broken storage backend does not create an
unbounded scheduled retry stream. Manual workspace cleanup remains eligible for
escalated bundles, preserving an operator recovery path after storage is fixed.

Focused backend coverage in `support-bundle.e2e.ts` now verifies escalation
metadata after repeated scheduled failures, verifies later scheduled cleanup
does not append another retry event for the escalated bundle, and verifies
manual workspace cleanup can still retry and recover the archive deletion.
Local validation passed `git diff --check` for tracked changes and static scans
for conflict markers/debug output. Focused Yarn checks remain blocked because
this desktop environment is missing the repo node_modules state file, and
Docker validation remains blocked because the Docker Desktop Linux engine pipe
is unavailable.

Remaining risk: escalation is durable audit metadata and scheduled suppression,
not an external alerting/notification pipeline. Provider-side transfer
callbacks and server-verified direct object-storage transfer events remain
future support bundle work.

## 588. P1 landing record: Scheduled Agent Runtime Stale Lease Recovery

This round closes the standalone Agent Runtime worker crash gap that remained
after adding DB-backed queued/lease metadata. The standalone worker lease path
now only leases `queued` standalone runs; expired `running` leases are handled
by an explicit recovery path instead of being silently reacquired as normal
work.

`CopilotAgentRuntimeModel` now lists expired standalone worker leases and
recovers each one into either `queued` or terminal `failed` state. Runs with
attempts remaining clear the stale lease, get a fresh `queuedAt`, mark active
steps back to `pending`, and append an Agent Runtime timeline event with
`agent-runtime-stale-lease-recovery/v1` payload metadata. Runs with exhausted
attempts clear the stale lease, fail with `stale_worker_lease`, mark active
steps failed, and persist the same recovery evidence in step output summaries.
Repair-execution-linked AgentRun rows remain excluded from this path.

The minute Copilot cron now schedules
`copilot.agentRuntime.recoverExpiredLeases` before the generic
`copilot.agentRuntime.run` scan. The recovery job requeues recovered standalone
runs through targeted `copilot.agentRuntime.run` jobs and only repeats when it
successfully recovers a full bounded batch, avoiding a tight loop on rows that
cannot be recovered.

Focused backend coverage in `repair-execution.e2e.ts` now verifies scheduled
standalone Agent Runtime stale lease requeue, targeted worker job enqueueing,
timeline payloads, step recovery summaries, and terminal stale-lease failure
when attempts are exhausted. `copilot.spec.ts` now asserts the minute cron
enqueues Agent Runtime stale recovery ahead of the generic worker scan. Local
validation passed `git diff --check` and static scans for conflict
markers/debug output. Focused Yarn checks remain blocked because this desktop
environment is missing the repo node_modules state file, and Docker validation
remains blocked because the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: stale recovery is still lease-expiration recovery, not live
interrupt or adapter-level cancellation. Standalone Agent Runtime execution
still needs real planner/tool/Codex/MCP/handoff adapters before queued runs can
complete useful work.

## 589. P1 landing record: Provider Health Snapshot Stale Cleanup

This round closes a DB-backed registry overlay drift gap in provider health
snapshot persistence. The configured health snapshot worker previously upserted
global `probe_result` rows but did not clear rows it had written when a provider
later stopped exposing configured health metadata. A stale global `down` or
`degraded` row could therefore keep influencing route availability after the
configured snapshot source disappeared.

`CopilotProviderHealthStateModel` now clears stale configured snapshot global
rows in place. The worker passes the active provider ids that still expose
configured health metadata; rows previously written with
`publishSource=configured_provider_health_snapshot_worker` but no longer in
that active set are updated to `status=unknown`, `lastError=null`, a fresh
fingerprint, and cleanup metadata carrying the previous status/error/fingerprint
and `configured_provider_health_snapshot_missing`. If configured health returns
later, the existing upsert path reuses the same global row.

Focused backend coverage in `provider-registry-revision.e2e.ts` now verifies a
stale configured snapshot row is cleared to `unknown` while the current active
configured provider health snapshot remains effective for route diagnostics.
Local validation passed `git diff --check` and static scans for conflict
markers/debug output. Focused Yarn checks remain blocked because this desktop
environment is missing the repo node_modules state file, and Docker validation
remains blocked because the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: this is cleanup for configured health snapshot overlays only.
It still does not run live external probes, persist probe history, notify on
health transitions, or manage provider credentials.

## 590. P1 landing record: Scheduled Repair Execution Queued Re-enqueue

This round closes the repair execution “durable queued row but missing queue
job” gap. Approval, manual retry, and stale-lease recovery already persist
`queued` repair execution requests and normally add a targeted
`copilot.repairExecution.run` job, but if that queue entry is lost before a
worker leases it, the DB row could remain queued without a consumer until an
operator retried manually.

`CopilotRepairExecutionModel` now lists bounded batches of executable queued
requests whose approval state is `approved` or `not_required` and whose worker
attempt window still has capacity. The minute Copilot cron now schedules
`copilot.repairExecution.enqueueQueued`; the handler adds deterministic
targeted `copilot.repairExecution.run` jobs for those durable queued requests
without mutating request state. The existing worker lease path remains the only
code path that transitions queued requests to running.

Focused backend coverage in `repair-execution.e2e.ts` now verifies the
scheduled enqueue job restores a missing worker job for an approved queued
request and leaves the request queued/unleased. `copilot.spec.ts` now asserts
the minute cron schedules this recovery job. Local validation passed
`git diff --check` and static scans for conflict markers/debug output. Focused
Yarn checks remain blocked because this desktop environment is missing the repo
node_modules state file, and Docker validation remains blocked because the
Docker Desktop Linux engine pipe is unavailable.

Remaining risk: this recovers missing queued worker jobs; it does not provide
live running cancellation, rollback, or executor-specific resume payloads.

## 591. P1 landing record: Support Bundle Download Authorization TTL Cleanup

This round closes a support-bundle persistence gap in short-lived download
authorization state. Manifest/archive download authorizations already carry a
15-minute TTL, but durable rows only changed from `authorized` to `expired`
when a client attempted to consume a stale token or when bundle retention
cleanup expired the whole support bundle. Unused stale authorizations could
therefore remain persisted as `authorized` longer than their actual TTL.

`CopilotSupportBundleModel` now exposes
`expireDueDownloadAuthorizations()`, which updates bounded batches of
`authorized` authorization rows whose `expires_at` has passed. The operation is
independent of support bundle retention: the bundle can remain `ready/active`
while stale authorization rows are expired, and fresh authorizations can still
be issued until the bundle itself expires. Daily Copilot cron now schedules
`copilot.supportBundle.cleanupDownloadAuthorizations` with a deterministic job
id, and the handler repeats only when it expires a full bounded batch.

Focused backend coverage in `support-bundle.e2e.ts` now verifies scheduled
authorization cleanup expires only stale authorization rows while leaving the
support bundle ready/active and preserving a still-valid authorization.
`copilot.spec.ts` now asserts the daily cron schedules the cleanup job. Local
validation passed `git diff --check` and static scans for conflict
markers/debug output. Focused Yarn checks remain blocked because this desktop
environment is missing the repo node_modules state file, and Docker validation
remains blocked because the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: this expires stale authorization rows; it does not add
server-verified object-storage transfer callbacks, direct manifest delivery, or
external notification/alerting around support bundle access.

## 592. P1 landing record: Support Bundle Download Authorization Expiration Audit

This round tightens the support-bundle download authorization TTL cleanup by
making scheduled expiration auditable, not just a status update. The cleanup
path now returns the expired authorization evidence and writes a durable
`download_authorized` audit event for each scheduled expiration with
`authorizationExpired=true`, authorization id/fingerprint, artifact kind and
fingerprint, cleanup actor/scope, cleanup fingerprint, previous status, and the
TTL timestamp that caused expiration.

The audit event keeps the existing support bundle audit stream as the
authoritative lifecycle record: creation/download authorization/download
consumption/retention cleanup and now scheduled TTL expiration all leave
durable bundle-scoped evidence. The scheduled worker still only expires
authorization rows; it does not expire the support bundle itself and does not
claim a download transfer occurred.

Focused backend coverage in `support-bundle.e2e.ts` now verifies scheduled TTL
cleanup writes exactly one expiration audit event for the stale authorization,
including cleanup metadata and authorization fingerprint evidence, while
leaving the support bundle ready/active. Local validation passed
`git diff --check` and static scans for conflict markers/debug output. Focused
Yarn checks remain blocked because this desktop environment is missing the repo
node_modules state file, and Docker validation remains blocked because the
Docker Desktop Linux engine pipe is unavailable.

Remaining risk: this records server-side authorization expiration, not
server-verified object-storage transfer completion or external alerting.

## 593. P1 landing record: Support Bundle On-demand Authorization Expiration Audit

This round closes the audit consistency gap between scheduled download
authorization TTL cleanup and on-demand expiration guards. API proxy artifact
consumption and direct object-storage acknowledgement already marked a stale
authorization row as `expired` when they encountered an elapsed TTL before the
scheduled cleanup job ran, but those on-demand state transitions did not leave
bundle-scoped audit evidence.

`markDownloadAuthorizationExpired()` now accepts the full authorization record
and an expiration source. When the API proxy consume path or direct-download
acknowledgement guard expires an authorization, it writes the same durable
`download_authorized` expiration audit shape used by scheduled cleanup:
authorization id/fingerprint, artifact evidence, delivery method, previous
status, `authorizationExpired=true`, cleanup fingerprint, and source-specific
cleanup scope (`api_proxy_consume` or `direct_download_acknowledge`). Scheduled
cleanup still writes its own audit evidence and does not double-record through
this helper.

Focused backend coverage in `support-bundle.e2e.ts` now verifies stale API
proxy token consumption returns 404 and records expiration audit metadata, and
stale direct-download acknowledgement rejects while recording direct-delivery
expiration audit metadata. Local validation passed `git diff --check` and
static scans for conflict markers/debug output. Focused Yarn checks remain
blocked because this desktop environment is missing the repo node_modules state
file, and Docker validation remains blocked because the Docker Desktop Linux
engine pipe is unavailable.

Remaining risk: authorization expiration is now auditable across scheduled and
on-demand paths, but direct object-storage transfer completion is still
client-acknowledged rather than server-verified.

## 594. P1 landing record: Support Bundle Retention Authorization Expiration Audit

This round closes the final inconsistency in support-bundle download
authorization expiration audit coverage. Retention cleanup already expired
outstanding authorization rows and recorded the aggregate
`expiredAuthorizationCount` in the bundle-level `retention_expired` event, but
it did not leave per-authorization evidence showing which authorization was
closed by retention.

Retention cleanup now returns authorization id/fingerprint, artifact evidence,
delivery method, actor, workspace, bundle, and TTL data from the authorization
update and writes the same `download_authorized` expiration audit shape used by
scheduled and on-demand TTL cleanup. The audit metadata uses
`authorizationExpired=true`, `cleanupScope=retention_cleanup`, the retention
cleanup fingerprint, previous status, and artifact evidence. The existing
`retention_expired` event remains the aggregate bundle-level summary.

Focused backend coverage in `support-bundle.e2e.ts` now verifies retention
cleanup emits both the original download authorization audit event and a
per-authorization expiration audit event before the `retention_expired` summary.
Local validation passed `git diff --check` and static scans for conflict
markers/debug output. Focused Yarn checks remain blocked because this desktop
environment is missing the repo node_modules state file, and Docker validation
remains blocked because the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: retention cleanup now has per-authorization audit evidence, but
server-verified object-storage transfer callbacks and external access alerting
remain future work.

## 595. P1 landing record: Scheduled Agent Runtime Queued Re-enqueue

This round closes the standalone Agent Runtime parity gap with repair execution
queued recovery. Standalone AgentRun rows can be durable `queued` state after
creation, manual resume, or stale-lease recovery, and targeted
`copilot.agentRuntime.run` jobs are normally added at those transitions. If a
targeted queue entry is removed before a worker leases the run, the row should
not depend solely on the untargeted generic scan.

`CopilotAgentRuntimeModel` now lists bounded batches of queued standalone runs
whose worker attempt window still has capacity. The minute Copilot cron now
schedules `copilot.agentRuntime.enqueueQueued`; the handler restores targeted
`copilot.agentRuntime.run` jobs with deterministic job ids derived from run id
and attempt window. It does not mutate AgentRun state; the existing DB lease
path remains the only transition from queued to running.

Focused backend coverage in `repair-execution.e2e.ts` now verifies the
scheduled enqueue job restores a targeted worker job for a durable queued
standalone AgentRun and leaves the run queued, unleased, and at the same worker
attempt. `copilot.spec.ts` now asserts the minute cron schedules this recovery
job before the generic Agent Runtime scan. Local validation passed
`git diff --check` and static scans for conflict markers/debug output. Focused
Yarn checks remain blocked because this desktop environment is missing the repo
node_modules state file, and Docker validation remains blocked because the
Docker Desktop Linux engine pipe is unavailable.

Remaining risk: queued re-enqueue improves durability of standalone worker
scheduling, but standalone execution still lacks real planner/tool/Codex/MCP
adapters and therefore still fails with `unsupported_agent_runtime_adapter`
when the current worker consumes a run.

## 596. P1 landing record: Provider Health Probe Freshness Cleanup

This round closes the remaining provider-health overlay freshness gap in the
DB-backed registries track. Provider health state was durable and scheduled
configured snapshots could clear rows whose source disappeared, but a stale
automatic `probe_result` row could still keep a provider marked `down` or
`degraded` long after the check timestamp was no longer trustworthy.

`CopilotProviderHealthStateModel` now defines a bounded freshness window for
automatic probe results. Effective provider registry construction filters out
stale `source=probe_result` rows at overlay read time, so an old automatic
`down` probe stops hiding provider routes even before the daily worker runs.
Workspace `manual_override` rows are deliberately excluded from this freshness
policy and remain operator-controlled.

The provider health worker now also normalizes stale automatic probe rows in
place by writing `status=unknown`, clearing `lastError`, refreshing the
fingerprint, and storing cleanup metadata with the previous status, checked
timestamp, fingerprint, last error, publish source, and
`provider_health_probe_result_stale`. This gives the DB a durable record of the
freshness transition instead of relying only on query-time suppression.

Focused backend coverage in `provider-registry-revision.e2e.ts` now verifies a
stale workspace probe result is ignored by overlay resolution and no longer
removes the DB-backed provider route, and verifies the scheduled provider
health worker clears stale automatic probes while leaving stale manual
overrides untouched. Local validation passed `git diff --check` and static
scans for conflict markers/debug output. Focused Yarn checks remain blocked
because this desktop environment is missing the repo node_modules state file,
and Docker validation remains blocked because the Docker Desktop Linux engine
pipe is unavailable.

Remaining risk: provider health still does not run live external probes, keep
probe history, notify on transitions, manage provider credentials, or attach
provider-health transitions to runtime dispatch spans.

## 597. P1 landing record: Agent Runtime Record-only Worker Adapter

This round moves standalone Agent Runtime execution past the “all workflows
fail after lease” boundary without pretending that tool/Codex/MCP adapters are
ready. The standalone worker still leases queued AgentRun rows through the
DB-backed worker lease path, but it now recognizes the explicit
`agent_runtime_record_only` workflow and completes it through a non-side-effecting
adapter.

`CopilotAgentRuntimeModel` now has a success finalizer for leased record-only
runs. It verifies the run is standalone, leased by the current worker, and using
the `agent_runtime_record_only` workflow; then it marks the run `completed`,
marks active steps `completed`, clears worker lease fields, refreshes the
timeline fingerprint, and appends step/run timeline events with
`agent-runtime-record-only-execution/v1` payloads. Step output summaries record
`executor=agent_runtime_record_only_adapter` and `sideEffectsApplied=false`.

`CopilotAgentRuntimeWorker` dispatches only that explicit workflow to the
record-only finalizer. All other standalone workflows still use the existing
`unsupported_agent_runtime_adapter` failure path, preserving a clear boundary
until real model/tool/Codex/MCP/handoff adapters exist.

Focused backend coverage in `repair-execution.e2e.ts` now verifies a queued
record-only AgentRun is leased, completed, has all steps completed, clears its
worker lease, records one worker attempt, and persists non-side-effecting
adapter evidence in step output and timeline events. Local validation passed
`git diff --check` and static scans for conflict markers/debug output. Focused
Yarn checks remain blocked because this desktop environment is missing the repo
node_modules state file, and Docker validation remains blocked because the
Docker Desktop Linux engine pipe is unavailable.

Remaining risk: this is a deterministic record-only adapter for runtime
plumbing and observability. It does not execute model prompts, tools, Codex,
MCP calls, handoffs, cancellation interrupts, rollback, usage accounting, or
provider dispatch spans.

## 598. P1 landing record: Repair Execution Stale Lease Recovery Boundary

This round tightens the repair execution worker lease state machine. Repair
execution already had manual and scheduled stale-lease recovery, but the normal
worker lease acquisition still accepted expired `running` rows. That meant an
expired running request could be picked up as ordinary worker execution without
passing through the `stale_recovered` audit transition.

`CopilotRepairExecutionModel.acquireWorkerLease()` now leases only durable
`queued` requests. Expired `running` requests are left untouched by direct
`copilot.repairExecution.run` jobs and must be recovered through manual
`recover_stale` or the scheduled `copilot.repairExecution.recoverExpiredLeases`
job. This aligns repair execution with the standalone Agent Runtime worker
boundary and keeps recovery evidence centralized in the explicit stale-recovery
path.

Focused backend coverage in `repair-execution.e2e.ts` now verifies that a
direct repair worker invocation against an expired running lease returns done
without changing the row, incrementing attempts, clearing the original worker
lease, or adding completion/failure audit events. The scheduled stale recovery
test continues to cover the valid requeue path. Local validation passed
`git diff --check` and static scans for conflict markers/debug output. Focused
Yarn checks remain blocked because this desktop environment is missing the repo
node_modules state file, and Docker validation remains blocked because the
Docker Desktop Linux engine pipe is unavailable.

Remaining risk: stale recovery is still lease-expiration recovery, not live
interrupt, rollback, or executor-specific resume. Broader repair executors will
still need their own idempotent side-effect contracts before they can be
enabled.

## 599. P1 landing record: Support Bundle Direct Acknowledgement Archive Guard

This round tightens support-bundle direct download completion telemetry. Direct
object-storage acknowledgement is intentionally client-reported archive
download telemetry, not proof of transfer and not a generic completion endpoint
for every support-bundle artifact. The existing path rejected API-proxy
authorizations, but it did not explicitly bind acknowledgement to
`archive_json` artifacts.

`CopilotSupportBundleModel.acknowledgeDirectDownload()` now requires
`artifactKind=archive_json` before it validates direct URL freshness or marks
an authorization downloaded. It also requires the persisted bundle to still
carry an archive fingerprint matching the authorization fingerprint. This keeps
future direct manifest delivery or malformed direct-delivery rows from being
acknowledged through archive semantics.

Focused backend coverage in `support-bundle.e2e.ts` now verifies that even if a
manifest authorization row carries direct-delivery URL metadata, direct
acknowledgement rejects it and leaves the authorization `authorized` with no
`downloadedAt` timestamp. The existing archive direct acknowledgement coverage
continues to verify the valid archive path. Local validation passed
`git diff --check` and static scans for conflict markers/debug output. Focused
Yarn checks remain blocked because this desktop environment is missing the repo
node_modules state file, and Docker validation remains blocked because the
Docker Desktop Linux engine pipe is unavailable.

Remaining risk: direct object-storage completion is still client
acknowledgement, not server-verified object-store transfer callbacks. Manifest
direct delivery remains future work and should get its own artifact semantics
instead of reusing archive acknowledgement behavior.

## 600. P1 landing record: Support Bundle Manifest Artifact Storage

This round moves support bundle manifest delivery beyond DB-only JSON without
dropping the row-level manifest index that existing GraphQL/Admin reads depend
on. New support bundle rows now persist `manifestStorageKey`,
`manifestByteSize`, `manifestMime`, and `manifestFilename`, and creation writes
the generated manifest JSON to `support-bundles/:bundleId/manifest.json` in the
configured blob store before returning the ready bundle.

`CopilotSupportBundleModel.authorizeDownload()` now treats `manifest_json` and
`archive_json` uniformly for signed URL delivery. When the storage provider can
return a signed `get` redirect and object metadata matching the persisted byte
size, manifest authorizations persist `deliveryMethod=object_storage_signed_url`
and expose the direct URL through the existing GraphQL authorization shape. If
signed delivery is unavailable, manifest downloads still use the API proxy.

API-proxy manifest consumption now reads the stored manifest object when a
storage key exists and validates its JSON fingerprint against the persisted
manifest fingerprint before marking the authorization downloaded. Missing,
corrupt, or mismatched stored manifest bytes fail closed with no authorization
state transition. Legacy rows without a manifest storage key continue to use
the DB `manifest_json` fallback.

Retention cleanup now rewrites the stored manifest object after the DB row
transitions to expired, so healthy blob storage mirrors the updated DB
retention state. A manifest rewrite failure no longer blocks durable DB
expiration; the `retention_expired` audit event records
`manifestObjectRewriteStatus=failed` and the storage error metadata. Direct
download acknowledgement remains archive-only: direct manifest authorizations
are allowed for delivery but rejected by the acknowledgement endpoint without
being consumed.

Focused backend coverage in `support-bundle.e2e.ts` now verifies persisted
manifest storage metadata, fail-closed API-proxy behavior for tampered stored
manifest bytes, manifest and archive signed URL authorization, archive-only
direct acknowledgement semantics for manifest direct-delivery rows, successful
manifest rewrite audit metadata during retention cleanup, and manifest rewrite
failure audit metadata without rolling back DB expiration. Local validation
passed `git diff --check` and static scans for conflict markers/debug output.
Focused Yarn checks remain blocked because this desktop environment is missing
the repo node_modules state file, and Docker validation remains blocked because
the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: manifest object rewrite failures are observable but not yet
retryable through a dedicated manifest-object cleanup/rewrite retry path. Direct
manifest delivery still relies on object-store signed URL semantics and does
not provide server-verified transfer callbacks.

## 601. P1 landing record: Support Bundle Manifest Rewrite Retry

This round closes the new dead end from manifest blob persistence. Retention
cleanup already kept DB expiration durable when the manifest object rewrite
failed, but that left the stored manifest object stale until an operator
manually repaired storage outside LocalMind.

`CopilotSupportBundleModel.cleanupDueBundles()` now reuses manual and scheduled
retention cleanup as the retry entry for expired bundles whose latest manifest
object rewrite audit status is still `failed`. After due active bundles and
archive cleanup retries consume the current batch limit, cleanup retries writing
the current DB `manifest_json` bytes to `manifestStorageKey`. It records a new
`retention_expired` audit event with `manifestObjectRewriteRetry=true`,
failure-count evidence, previous cleanup fingerprint/error metadata, manifest
fingerprint, byte size, storage key, and the new rewrite status.

The cleanup retry selectors now track latest archive cleanup status and latest
manifest rewrite status independently, so a manifest retry event cannot hide an
archive delete failure and an archive retry event cannot hide a manifest rewrite
failure. GraphQL/common/Admin cleanup results now expose
`manifestObjectRewriteRetryCount`,
`manifestObjectRewriteRecoveredCount`, and
`manifestObjectRewriteFailedCount` beside the existing archive cleanup retry
counters.

Focused backend coverage in `support-bundle.e2e.ts` now verifies that a
manifest rewrite failure during retention cleanup does not roll back DB
expiration, then a later cleanup run with healthy storage retries the manifest
write, reports one recovered manifest rewrite, and records retry audit metadata
linked to the prior failure. Admin test fixtures include the new manifest retry
counters. Local validation passed `git diff --check` and static scans for
conflict markers/debug output. Focused Yarn checks remain blocked because this
desktop environment is missing the repo node_modules state file, and Docker
validation remains blocked because the Docker Desktop Linux engine pipe is
unavailable.

Remaining risk: manifest rewrite retries are bounded cleanup work and do not
include escalation/alerting thresholds yet. Direct manifest delivery still
relies on object-store signed URL semantics and does not provide
server-verified transfer callbacks.

## 602. P1 landing record: Support Bundle Manifest Rewrite Escalation

This round gives scheduled manifest object rewrite retries the same operational
stop condition as archive object cleanup retries. Before this slice, a broken
blob backend could make the scheduled retention worker retry the same manifest
rewrite forever, even though manual recovery was the right operator-controlled
path after repeated failures.

`CopilotSupportBundleModel` now counts prior failed manifest object rewrite
audit events. When a scheduled cleanup retry fails after the threshold is
reached, the new `retention_expired` audit event records
`manifestObjectRewriteEscalated=true`,
`manifestObjectRewriteEscalationReason=scheduled_retry_limit_exceeded`,
`manifestObjectRewriteFailureCount`, and
`manifestObjectRewriteEscalatedAt`. Scheduled retry scans skip bundles whose
latest manifest rewrite audit event is escalated.

Manual workspace cleanup remains eligible for escalated manifest rewrite
failures. After storage is fixed, manual cleanup retries the stored manifest
write, reports one recovered manifest rewrite through the existing cleanup
counters, and writes recovery audit metadata without carrying the escalated
flag forward. Archive cleanup retry selection and manifest rewrite retry
selection remain independent, so escalation in one family does not hide
recoverable work in the other.

Focused backend coverage in `support-bundle.e2e.ts` now verifies persistent
scheduled manifest rewrite failures escalate, a later scheduled cleanup skips
the escalated bundle without appending more audit rows, and manual workspace
cleanup recovers it after the storage provider starts accepting manifest writes.
Local validation passed `git diff --check` and static scans for conflict
markers/debug output. Focused Yarn checks remain blocked because this desktop
environment is missing the repo node_modules state file, and Docker validation
remains blocked because the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: escalation is durable audit evidence and a scheduled-loop stop
condition, not external alert delivery. Direct manifest delivery still relies
on object-store signed URL semantics and does not provide server-verified
transfer callbacks.

## 603. P2 landing record: Agent Runtime Worker Step Lease State

This round closes a standalone Agent Runtime state fidelity gap. Before this
slice, the DB-backed worker lease moved a standalone AgentRun from `queued` to
`running`, but active AgentStep rows could remain `pending` until the adapter
later completed or failed them. That made persisted timelines skip the
per-step running phase even though a worker had already claimed execution.

`CopilotAgentRuntimeModel.acquireStandaloneWorkerLease()` now updates active
standalone steps to `running` as part of the lease path, appends per-step
timeline events with `agent-runtime-worker-step-lease/v1` payloads, and merges
worker lease evidence into each active step output summary. The existing
unsupported-adapter failure path and record-only completion adapter now operate
after an explicit per-step running transition, making the durable runtime state
more faithful without claiming real tool/Codex/MCP/model execution.

Focused backend coverage in `repair-execution.e2e.ts` now expects leased
standalone runs to record `tool_step`/`codex_step` or `model_step`/`tool_step`
running timeline events before later failure/completion, and verifies step
output summaries carry `agent_runtime_worker` lease evidence. Local validation
passed `git diff --check` and static scans for conflict markers/debug output.
Focused Yarn checks remain blocked because this desktop environment is missing
the repo node_modules state file, and Docker validation remains blocked because
the Docker Desktop Linux engine pipe is unavailable.

Remaining risk: this is worker lease state fidelity, not a real planner or
tool/Codex/MCP/model execution adapter. Non-record-only standalone workflows
still fail through `unsupported_agent_runtime_adapter` after lease.

## 604. P1 landing record: Support Bundle Manifest Direct Acknowledgement

This round closes the completion telemetry gap created when manifest artifacts
became eligible for direct object-storage signed URL delivery. Manifest
authorizations could receive `deliveryMethod=object_storage_signed_url`, but
the direct acknowledgement endpoint still rejected every manifest artifact,
leaving successful direct manifest downloads to age out through expiration
cleanup instead of being recorded as downloaded.

`CopilotSupportBundleModel.acknowledgeDirectDownload()` now accepts active
`manifest_json` authorizations issued through `object_storage_signed_url`. It
keeps the existing direct URL expiration guard and bundle ready/active/unexpired
checks, then validates that the authorization manifest fingerprint still matches
the bundle and that the artifact fingerprint is the same manifest fingerprint.
Archive acknowledgements keep their archive fingerprint validation.

Successful direct manifest acknowledgement now marks the authorization
`downloaded`, sets `downloaded_at`, and writes the same client-acknowledged
`downloaded` audit event shape with `artifactKind=manifest_json`,
`deliveryMethod=object_storage_signed_url`, direct URL expiration evidence, and
manifest/artifact fingerprints. API-proxy authorizations remain rejected by the
direct acknowledgement path, and the semantics remain client telemetry rather
than server proof that the object store transferred bytes.

Focused backend coverage in `support-bundle.e2e.ts` now verifies manifest and
archive signed URL authorization, archive acknowledgement, manifest
acknowledgement into downloaded state, DB persistence of `downloaded_at`, and
manifest-specific downloaded audit metadata. Local validation passed
`git diff --check` and static scans for conflict markers/debug output. Focused
Yarn checks remain blocked because this desktop environment is missing the repo
node_modules state file, and Docker validation remains blocked because the
Docker Desktop Linux engine pipe is unavailable.

Remaining risk: direct object-storage completion now has an internal
server-verified transfer-event ingestion path, but no external object-storage
webhook/controller/job is wired to call it yet.

## 605. P1 landing record: Support Bundle Scheduled Manifest Retry Progress

This round closes the scheduled-worker visibility gap left after manifest
rewrite retries and escalation landed. The model/API already reported manifest
rewrite retry counts, but the scheduled retention job still logged and decided
repeat progress using only archive cleanup retry counters.

`CopilotCronJobs.cleanupSupportBundleRetention()` now includes
`manifestObjectRewriteRetryCount`, `manifestObjectRewriteRecoveredCount`, and
`manifestObjectRewriteFailedCount` in the retention cleanup log line. Recovered
manifest object rewrites now count toward bounded-batch progress, and the job
only returns `Repeat` when both archive cleanup retries and manifest rewrite
retries left no failed work in that pass.

Focused backend coverage in `support-bundle.e2e.ts` now verifies a scheduled
manifest rewrite retry that recovers one object returns `JOB_SIGNAL.Repeat` at
batch limit, records `scheduled_worker` retry metadata, and then returns
`Done` on the following no-op pass. This keeps manifest retry batches draining
the same way archive cleanup retry batches already did.

Remaining risk: direct object-storage completion is still client
acknowledgement, not server-verified object-store transfer callbacks or provider
event ingestion.

## 606. P2 landing record: Agent Runtime Workflow Adapter Registry

This round removes the standalone Agent Runtime worker's hardcoded
record-only branch and replaces it with a small workflow adapter registry.
Before this slice, the worker had DB-backed lease/recovery plumbing, but no
registration seam for real workflow executors.

`CopilotAgentRuntimeWorkflowRegistry` now owns workflow adapter registration,
duplicate workflow rejection, supported-workflow introspection, and the first
registered adapter: `agent_runtime_record_only`. The worker leases standalone
runs exactly as before, then dispatches through the registered adapter when one
exists. Workflows without an adapter still fail durably with
`unsupported_agent_runtime_adapter`, preserving the current fail-closed
behavior while making future tool/Codex/MCP/model adapters explicit additions
instead of more worker conditionals.

Focused backend coverage in `repair-execution.e2e.ts` now verifies the
record-only adapter is registered, duplicate adapter registration is rejected,
record-only standalone execution still completes through the worker, and
unsupported workflows continue to fail after a durable worker lease.

Remaining risk: the registry is an execution seam and one record-only adapter,
not a generic planner or tool/Codex/MCP/model executor. Arbitrary workflows
still fail through `unsupported_agent_runtime_adapter` until real adapters are
implemented.
