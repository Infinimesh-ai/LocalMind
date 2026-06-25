# Next Goals

This backlog is ordered to push the project from diagnostics toward real
runtime behavior.

## P1: Support Bundle Persistence

Status: archive/manifest object retention cleanup, retry, escalation,
download authorization cleanup, signed URL delivery, transfer verification,
transfer forwarding retry/dead-letter persistence, transfer forwarding read
visibility, transfer forwarding replay, and audit metadata contracts
implemented after the durable request/manifest, download authorization, manual
retention cleanup, archive artifact, scheduled retention cleanup, and packaged
archive contents slices.

Implemented outcome:

- a DB-backed artifact/request model or equivalent persistence layer;
- persisted metadata for workspace, actor, status, source evidence summary,
  source evidence fingerprint, manifest fingerprint, creation time, expiration,
  and retention state;
- GraphQL/API access with authorization checks;
- a minimal manifest payload stored in the DB;
- a persisted download authorization record with short-lived token fingerprint;
- an HTTP manifest artifact endpoint that validates and consumes authorization;
- create/read/download audit events;
- retention cleanup execution that expires due active bundles, updates manifest
  retention metadata/fingerprint, expires outstanding authorizations, and writes
  cleanup audit events;
- minimal archive JSON bytes written to the configured blob storage provider;
- persisted archive storage key, byte size, fingerprint, MIME type, and
  filename on the request row;
- manifest archive metadata that binds the stored artifact to the support bundle
  request;
- `archive_json` download authorization with persisted artifact fingerprint;
- an HTTP artifact endpoint that validates and consumes authorization before
  returning manifest or archive bytes;
- `archive_created` audit events;
- daily cron enqueueing for `copilot.supportBundle.cleanupRetention`;
- a Copilot queue worker handler that expires due bundles in bounded batches,
  revokes outstanding authorizations, writes `scheduled_worker` cleanup audit
  metadata, and repeats while more due bundles remain;
- `retention_expired` audit metadata is DB-constrained for cleanup identity,
  fingerprint, scope, expired authorization count, retention status, and known
  archive/manifest cleanup status vocabulary used by retry and escalation
  scans;
- `download_authorized` audit metadata is DB-constrained for current
  authorization/expiration audit versions, authorization identity, artifact
  evidence, delivery method, expiry, and cleanup fingerprint evidence;
- `created` and `archive_created` audit metadata is model-validated and
  DB-constrained for manifest/archive artifact identity, positive byte sizes,
  storage keys, fingerprints, MIME values, filenames, and active retention
  evidence;
- failed support bundle creation best-effort deletes just-written manifest and
  archive storage objects when DB persistence or creation audit history fails
  after object writes, preventing orphan bundle artifacts from failed creates;
- Admin visibility for status and metadata;
- Admin archive download control and latest authorization visibility;
- Admin cleanup control and latest cleanup summary;
- packaged archive JSON with a deterministic file index and embedded
  `manifest.json`, `source-evidence-summary.json`,
  `prompt-catalog-summary.json`, `actor-action-runs.json`, and
  `task-route-summary.json` sections;
- per-file byte size/fingerprint metadata plus an archive index fingerprint;
- signed URL delivery metadata persisted on download authorization rows;
- archive download authorization returns an object-storage signed URL when the
  configured storage provider supports signed `get` redirects and the returned
  metadata matches the persisted archive byte size;
- GraphQL/Admin can distinguish `api_proxy` from
  `object_storage_signed_url` delivery and surface direct URL expiration;
- GraphQL can acknowledge direct object-storage archive download completion
  telemetry, marking the persisted authorization as `downloaded` and writing a
  `clientAcknowledged` audit event after revalidating workspace permission,
  delivery method, expiration, and bundle/archive fingerprint evidence, with a
  terminal compare-and-swap guard over the read authorization and bundle
  snapshots;
- the internal transfer endpoint ingests canonical and S3/R2-compatible
  object-storage completion events after storage evidence validation, and
  S3/R2 wrappers must include upstream verifier, policy, and signature
  fingerprint evidence before downloaded audit rows can persist provider
  signature summaries;
- verified direct-transfer notifications now persist into
  `ai_support_bundle_transfer_events` with authorization snapshot, storage
  evidence, notification auth evidence, provider event id/source, and
  deterministic transfer event fingerprints;
- direct transfer event insert conflicts re-read the existing row and validate
  provider event id/source, transfer timestamp, auth-evidence fingerprint, and
  storage evidence before treating a duplicate event fingerprint as
  idempotent;
- direct transfer-event terminal writes require the same read authorization and
  parent bundle snapshots before marking an authorization downloaded, preventing
  stale callbacks from appending transfer or downloaded audit evidence;
- transfer event authorization snapshots use update-restricted composite
  foreign keys, so parent authorization snapshot edits cannot cascade changed
  evidence into historical transfer rows;
- matching transfer-event replays remain downloaded-audit-idempotent while
  appending their own durable transfer event rows after storage validation;
- GraphQL/Admin support bundle read paths expose `transferEventCount` and
  recent transfer event evidence for operator inspection of provider
  notifications and replay history;
- parsed transfer notifications are persisted into
  `ai_support_bundle_transfer_forwarding_events` before ingestion, with
  immutable canonical payload evidence, upstream signature-evidence
  fingerprints when present, worker leases, attempt counters, retry scheduling,
  dead-letter terminal failures, and forwarded transfer-event fingerprint
  linkage;
- `copilot.supportBundle.processTransferForwardingEvents` replays queued or
  retryable forwarding rows through the same internal verifier used by the
  transfer endpoint, while deterministic malformed storage/auth evidence is
  dead-lettered;
- transfer forwarding processing re-locks rows and confirms the same current
  non-expired worker lease before storage verification, forwarded terminal
  writes, or retry/dead-letter writes, preventing stale workers from marking a
  direct download or overwriting forwarding state after lease handoff;
- transfer forwarding processing also confirms the same attempt counter before
  storage verification or terminal forwarding writes, preventing stale
  in-memory workers from appending transfer events or retry/dead-letter
  evidence after attempt metadata changes under the same lease id;
- transfer forwarding forwarded and retry/dead-letter terminal writes also
  compare the full locked forwarding row snapshot, including immutable payload
  evidence, lease timestamps, terminal/failure fields, and update time, so
  same-lease row drift cannot be overwritten by stale workers;
- transfer forwarding processing wraps transfer ingestion, authorization
  download mutation, downloaded audit history, and the final forwarded row
  update in one transaction, so a forwarded terminal snapshot failure rolls
  back transfer/download evidence instead of leaving a downloaded
  authorization behind a still-processing forwarding row;
- transfer forwarding enqueue conflicts re-read the existing row by
  authorization/fingerprint and validate provider event id/source, forwarding
  payload fingerprint, and provider-signature evidence fingerprint before
  treating the row as idempotent;
- S3/R2 object-created wrapper payloads cannot self-report upstream provider
  signature verification evidence; verified evidence must arrive through the
  server-owned forwarding header after the existing internal transfer token
  guard succeeds, and the header is schema-validated before durable forwarding
  persistence;
- configured production object-storage webhook ingress now verifies raw
  S3/R2-compatible notifications with an HMAC-SHA256 secret, rejects
  self-reported provider signature evidence in the webhook body, derives
  server-owned `verified_by_upstream` evidence from configuration, and appends
  the canonical payload into durable transfer forwarding before ingestion;
- expired direct signed-URL acknowledgement and transfer-event paths now commit
  the authorization expiry transition plus audit history before returning the
  expected client/provider error;
- direct signed-URL expiration writes now compare the current authorization row
  with the previously read identity, artifact, delivery, token, expiry,
  downloaded, and timestamp evidence before appending expiration audit history;
- API-proxy download consumption compares the previously read authorization
  and parent bundle snapshots after artifact readback but before marking the
  authorization downloaded, so stale bundle drift cannot append downloaded
  audit rows from outdated evidence;
- retention cleanup expiration writes now compare the originally read support
  bundle request identity, manifest, archive, source-evidence, retention,
  failure, and timestamp snapshot before rewriting the expired manifest,
  revoking authorizations, or appending cleanup audit evidence;
- forwarding rows are DB-constrained for payload authorization/event/source
  coherence, queued/processing/retry/forwarded/dead-letter state shape, and
  delete/content immutability while live authorizations still exist;
- GraphQL/Admin support bundle read paths expose
  `transferForwardingEventCount` and recent transfer forwarding rows for
  operator inspection of retry, forwarded, dead-letter, payload fingerprint,
  provider-signature, and worker lease evidence without direct SQL access;
- GraphQL/Admin can replay dead-lettered transfer forwarding rows by appending
  a fresh queued forwarding row with replay/source metadata in the immutable
  payload, preserving the original terminal failure evidence instead of
  mutating it; replay insertion compares the full source forwarding row
  dead-letter snapshot before inserting so stale operator replay cannot enqueue
  work from drifted source evidence;
- GraphQL/Admin support bundle list reads accept a bounded workspace filter
  for support bundle status, retention status, transfer-forwarding status, and
  durable bundle/authorization/forwarding locator evidence while preserving
  the default recent-list behavior;
- GraphQL/Admin support bundle read paths also expose recent lifecycle
  `auditEvents`, with detail reads rehydrating after the newly persisted `read`
  audit row so the count and history stay aligned;
- audit event and download authorization rows preserve the parent support
  bundle workspace snapshot at the DB boundary, so direct SQL cannot move child
  evidence into another real workspace while keeping the same bundle id;
- support bundle manifest JSON preserves the request row bundle/workspace/actor
  identity and source-evidence-set fingerprint at the DB boundary, so direct
  SQL cannot make embedded manifest identity drift from durable request columns;
- download authorization rows validate their
  `(bundle_id, workspace_id, manifest_fingerprint)` snapshot against the parent
  support bundle at authorization write time, while preserving later retention
  manifest rewrites as historical authorization snapshots;
- archive download authorization rows validate their
  `(bundle_id, workspace_id, artifact_fingerprint)` snapshot against the parent
  support bundle archive fingerprint at authorization write time;
- retention cleanup deletes stored archive objects after DB expiry and records
  deleted/failed cleanup metadata on the `retention_expired` audit event;
- retention cleanup retries failed archive object deletion for expired bundles,
  records retry/recovered/failed counts, escalates persistent scheduled
  failures, skips escalated rows on scheduled scans, and keeps manual cleanup
  able to recover after storage is fixed; retry audit insertion compares the
  expired bundle snapshot and latest failed cleanup audit source evidence before
  appending recovered/failed/escalated retry history;
- manifest JSON is stored as blob-backed bytes during support bundle creation,
  manifest downloads can use signed URL delivery, and retention cleanup rewrites
  stored manifest bytes after DB expiry;
- failed manifest object rewrites are retried through retention cleanup,
  counted in GraphQL/Admin cleanup results, escalated after repeated scheduled
  failure, and still manually recoverable through the same source cleanup audit
  snapshot fence;
- stale short-lived download authorizations are expired by an independent
  scheduled cleanup job with durable expiration audit metadata;
- `retention_expired` retry/escalation audit metadata is model-validated and
  DB-constrained for previous cleanup fingerprints, retry failure counts,
  storage keys, bounded error evidence, and scheduled escalation coherence;
- focused backend tests and Admin tests for the changed UI.

Remaining follow-up:

- deploy provider-specific signature adapters, environment-specific webhook
  rollout, and alerting around dead-lettered forwarding rows outside the
  generic HMAC ingress and internal ingestion contract;
- add broader cross-workspace/provider search workflows for transfer
  forwarding history;

See `tracks/support-bundle.md`.

## P1: Repair Execution

Status: queued worker lease/retry slice, Task Route Policy, Model Registry, and
Provider Registry revision executors, and manual cancel/retry controls
implemented after the durable request, approval decision, first Prompt Registry
mutating executor, and stale running lease recovery slices.

Implemented outcome:

- persisted execution request and audit event model;
- workspace permission/preflight checks before any side-effect path;
- idempotency key reuse per workspace;
- idempotency insert-conflict reuse that re-reads the existing request and
  validates create-time prompt/action/permission, fingerprint, runtime-result,
  and executor-payload evidence before recording `reused` audit history
  instead of surfacing unique-key races;
- deterministic status behavior for the first slice:
  `waiting_approval` for approval-required requests and safe no-op
  `completed` for non-approval requests;
- runtime result/failure fields stored on the request row;
- Admin visibility for durable status, approval, idempotency, audit count, and
  side-effect status;
- approval decision mutation for `approve` and `reject` on persisted
  `waiting_approval` requests;
- approval transitions approved requests to `queued` and enqueues
  `copilot.repairExecution.run`; rejection remains terminal `cancelled`;
- approval/rejection writes compare the full waiting request snapshot before
  mutating state or appending decision audit history, so same-state request
  evidence drift cannot be approved from a stale read;
- approval/rejection audit events plus queued/cancelled events;
- persisted worker lease id, lease expiration, attempt count, max attempts,
  queued time, and last attempt time;
- worker-side Prompt Registry revision execution with `running`,
  `side_effect_applied`, `completed`, retryable `failed`, and
  `retry_scheduled` audit events;
- Agent Runtime run/step/timeline synchronization after approval decisions and
  worker running/completed/failed outcomes;
- Admin approve/reject controls and decision result visibility;
- persisted executor payload on the repair execution request;
- approved prompt registry repair executions publish a DB-backed
  workspace-scoped Prompt Registry revision through a constrained executor;
- approved `repair_task_model_route` executions publish a DB-backed
  workspace-scoped Task Route Policy revision through a constrained queued
  executor;
- approved `repair_default_model_route` executions publish a DB-backed
  workspace-scoped Model Registry revision through a constrained queued
  executor;
- approved provider registry repair executions publish a DB-backed
  workspace-scoped Provider Registry metadata revision through a constrained
  queued executor that sanitizes provider profile metadata and reuses existing
  configured provider credentials;
- runtime result, audit events, Agent Runtime timeline, and Admin output expose
  queued worker metadata plus the applied side-effect kind, record id, and
  fingerprint;
- applied repair side-effect runtime results are DB-constrained to retain
  side-effect kind, record id, fingerprint, and object summary evidence;
- applied repair side-effect runtime results are DB-constrained to retain the
  explicit forward-only rollback contract emitted by constrained registry
  publishers;
- applied repair side-effect runtime results are DB-constrained to match the
  persisted executor payload publisher kind;
- completed constrained repair side effects persist a dedicated
  `ai_repair_execution_side_effects` ledger row with request/workspace/actor
  snapshot coherence, executor payload fingerprint, worker lease evidence, and
  the same forward-only rollback contract, and parent request snapshot edits
  cannot cascade changed actor/workspace evidence into historical side-effect
  ledger rows;
- repair execution GraphQL/common/Admin read paths expose `sideEffectCount`
  plus recent side-effect ledger rows on durable execution records;
- repair execution GraphQL/common/Admin read paths expose recent lifecycle
  `auditEvents` on durable execution records;
- repair execution GraphQL/common/Admin list reads accept bounded workspace
  filters for status, approval state, prompt name, requested action, and
  durable request/audit/side-effect locator evidence while preserving the
  default recent-list behavior;
- Admin exposes a repair execution status selector plus locator input and
  renders request fingerprints, worker state, runtime result, Agent Runtime
  linkage, audit history, and side-effect ledger evidence from the persisted
  list surface;
- repair execution audit rows preserve the parent request workspace snapshot at
  the DB boundary, so lifecycle evidence cannot drift into another real
  workspace while keeping the same execution request id;
- current worker/control repair audit metadata is DB-constrained for stable
  lease, failure, retry, manual cancel/retry, and stale-recovery evidence;
- repair-execution-linked Agent Runtime step summaries and timeline payloads
  are DB-constrained for current repair-run/repair-step versions, request and
  repair-job fingerprints, granted permission status, side-effect identity,
  and forward-only rollback contract evidence;
- manual control can cancel waiting/queued/failed persisted requests with audit
  and Agent Runtime synchronization;
- manual control can request cooperative cancellation for a running request by
  writing `cancel_requested` audit evidence tied to the current worker
  lease/attempt after comparing the full originally read running request
  snapshot, and the leased worker cancels before side effects when it observes
  the request;
- the repair execution worker re-locks the request row and confirms the same
  current non-expired worker lease immediately before constrained registry
  side effects, so stale workers whose leases were recovered exit without
  publishing revisions, writing side-effect ledger rows, or failing/retrying
  the recovered request;
- repair execution worker failure persistence now also checks the same worker
  attempt snapshot as the leased worker read, so stale failure handling cannot
  write failure or retry audit evidence onto a newer attempt under the same
  lease id;
- repair execution worker terminal completion/failure updates now compare the
  originally read running request snapshot, including runtime result, executor
  payload, queue/lease/attempt, failure, completion, creation, and update-time
  evidence, before terminal audit or side-effect ledger writes;
- repair execution side-effect ledger writes also fence the completed parent
  request snapshot written by the worker path, so request drift between
  completion update and side-effect history insertion fails closed before
  stale ledger evidence persists;
- repair execution side-effect preflight, completion, and cooperative
  cancellation also check the same worker attempt snapshot as the leased worker
  read, so stale same-lease attempt drift cannot consume cancellation or write
  side-effect ledger/completed audit evidence onto a newer attempt;
- repair execution worker-owned cooperative cancellation terminal writes also
  compare the full originally read running request snapshot before clearing the
  lease or appending cancelled audit evidence, so same-lease request drift
  fails closed before stale worker consumption persists;
- manual control can cancel waiting/queued/failed persisted requests only
  after comparing the originally read request identity, approval, runtime,
  executor-payload, failure, queue/lease/attempt, completion, creation, and
  update-time evidence, so stale cancellable-row evidence rolls back without
  misleading cancellation audit rows;
- manual control can retry failed persisted requests by clearing failure state,
  extending attempts when exhausted, writing control audit events, requeueing a
  fresh worker job, and preserving the existing constrained executor path;
- manual control can resume failed persisted requests with an operator-provided
  corrected executor payload when no side-effect ledger exists, replacing the
  persisted payload only through an audited failed-to-queued transition with
  previous/corrected payload fingerprints, Agent Runtime synchronization, and a
  fresh worker job;
- manual retry and corrected-payload resume now compare the originally read
  failed request snapshot against approval state, runtime result, executor
  payload, failure evidence, queue/lease/attempt metadata, completion
  timestamp, and update timestamp before requeueing, so stale failed-row
  evidence rolls back without misleading manual-control or queued audit rows;
- stale-lease recovery compares the originally read expired running request
  snapshot against identity, runtime result, executor payload, failure
  evidence, queue/lease/attempt metadata, completion timestamp, creation time,
  and update timestamp before recovering, so stale running-row evidence rolls
  back without misleading recovered queued/failed audit rows;
- repair-execution-linked Agent Runtime synchronization now compares the linked
  run and repair step snapshots read at the start of sync before updating
  lifecycle state, output summaries, timeline fingerprints, or timeline events,
  so stale runtime mirror evidence rolls back instead of overwriting newer run
  or step state;
- DB triggers still reject ordinary repair request evidence/payload drift and
  reject payload changes after side-effect ledger rows exist, while allowing
  the audited payload-correction resume transition;
- manual control can recover expired running worker leases by clearing stale
  lease metadata, writing `stale_recovered` audit metadata, requeueing when
  attempts remain, failing when attempts are exhausted, and synchronizing Agent
  Runtime state;
- Admin exposes cancel/retry and corrected-payload resume controls for eligible
  persisted requests.

Remaining follow-up:

- add additional repair executors beyond the Prompt Registry, Task Route
  Policy, Model Registry, and Provider Registry revision publishers;
- add true live running interruption only with a real interruptible
  executor/lease protocol; current running cancellation is cooperative and
  checked before side effects;
- broaden operator-provided resume beyond constrained payload correction once
  non-registry executors define executor-specific payload/result contracts;
- add rollback only when actual rollback behavior is implemented.

See `tracks/repair-execution.md`.

## P2: Agent Runtime State

Status: first durable slice plus independent read/list observability and
generic run creation implemented. Repair execution approval and worker
execution now sync queued, running, completed, failed, and cancelled
run/step/timeline state including applied side-effect summaries, and internal
adapter code can persist generic tool/Codex/MCP step records.

Introduce real run/step/job state for office tasks.

Implemented outcome:

- persisted run, step, and timeline event model;
- statuses for queued/running/waiting approval/completed/failed/cancelled at
  run level and pending/running/waiting approval/completed/failed/skipped at
  step level;
- sanitized timeline event payloads;
- prompt registry repair execution connected to the runtime state;
- approval decisions update linked run, step, and timeline records to queued or
  cancelled states;
- the repair execution worker updates linked run, step, and timeline records to
  running, completed, or failed states;
- approved Prompt Registry revision execution records side-effect metadata in
  the linked step output and timeline payload;
- internal Agent Runtime model API can persist generic runs with tool, Codex,
  MCP, handoff, model, or approval steps and idempotently reuse rows by
  workspace/source identity, including source unique-key races after concurrent
  callers both miss the pre-read;
- Agent Runtime source/workflow coherence is model- and DB-enforced, keeping
  repair-execution-linked rows out of standalone worker/control routing unless
  they use the dedicated repair execution workflow/source pair;
- standalone worker adapter-resolution failure evidence is model- and
  DB-constrained for version, status, workflow, and requested step-type
  metadata, registered adapter capability snapshots, selected adapter
  snapshots, unsupported contract step evidence, selected-adapter registration,
  unsupported-step consistency, and side-effect modes before failed step
  summaries or timeline payloads can persist it;
- standalone worker lease summaries and run/step timeline lease payloads are
  DB-constrained for the current worker lease versions, executor, positive
  attempt count, lease id, workflow/source context, run-level lease expiry, and
  known step-type context where required;
- standalone record-only completion summaries and run/step timeline payloads
  are DB-constrained for the current record-only version, executor, bounded
  summary, lease evidence, `sideEffectsApplied=false`, and the expected run or
  step context;
- standalone generic worker completion summaries and run/step timeline payloads
  are DB-constrained for the current worker-completion version,
  `agent_runtime_worker` executor, adapter workflow, side-effect mode,
  `sideEffectsApplied=false`, bounded summary, lease evidence, expected run or
  step context, and `adapterResolution.status=completed`;
- standalone worker failure summaries and run/step timeline payloads are
  DB-constrained for the current worker-failure version, bounded failure
  diagnostics, lease evidence, and the expected run or step context, while
  nested adapter-resolution metadata remains covered by its dedicated contract
  and rejects completed adapter-resolution evidence in failure payloads;
- standalone terminal worker outcomes persist
  `ai_agent_runtime_execution_results` ledger rows with run/workspace/actor
  snapshot coherence, workflow/source identity, adapter workflow, executor,
  result status, side-effect mode, side-effect-applied flag, summary, failure
  diagnostics when present, result fingerprint, worker attempt, and worker
  lease id, including generic local-completion success and terminal stale-lease
  failures while requeue recoveries remain non-terminal and do not write ledger
  rows; the ledger now also
  enforces workflow/source snapshot coherence with the parent run, and parent
  run snapshot edits cannot cascade changed actor/source evidence into terminal
  execution-result rows;
- Agent Runtime step and timeline rows preserve the parent run workspace/actor
  snapshot at the DB boundary, and non-null timeline step links preserve the
  referenced step's run snapshot, so direct SQL cannot move child evidence away
  from the run or retarget step-level timeline evidence to another run's step;
- GraphQL AgentRun list/detail responses, repair execution mutation responses
  with linked AgentRun records, common GraphQL operations, and Admin expose
  `executionResultCount` plus recent execution result rows;
- GraphQL/common/Admin expose registered standalone workflow adapter
  capabilities via `agentRuntimeWorkflowAdapters`, with workflow id,
  capability version, supported step types, side-effect mode, and summary from
  the same allow-listed registry snapshots used in worker failure diagnostics;
- standalone manual-control summaries and cancel/resume timeline payloads are
  DB-constrained for the current manual-control version, actor, action, bounded
  reason, previous status, workflow/source context, control timestamp, and
  action/status coherence, including cooperative `cancel_requested` evidence
  for leased running runs before adapter execution;
- standalone stale-lease recovery summaries and run timeline payloads are
  DB-constrained for the current stale-recovery version, executor, reason,
  retry/next-status coherence, attempt counters, previous lease evidence, and
  workflow/source context;
- repair-execution-linked run and step payloads are DB-constrained for current
  repair runtime versions, workflow/source/request context, repair-job
  fingerprint, granted permission status, side-effect identity, and
  forward-only rollback contract evidence;
- GraphQL independently lists recent workspace-scoped AgentRun records and reads
  AgentRun detail by id with steps, timeline events, and recent execution
  result history;
- GraphQL/Admin AgentRun list reads accept bounded workspace filters for run
  status, workflow, source type/id, and durable run locator evidence while
  preserving the default recent-list behavior;
- Admin visibility for recent persisted AgentRun, AgentStep, and timeline state
  through a standalone Agent Runtime status card, including execution result
  ledger evidence and registered workflow adapter capabilities, in addition to
  the repair execution surface.
- standalone manual cancel on a leased running AgentRun now records a durable
  `cancel_requested` timeline event tied to the worker lease/attempt, leaves
  the run leased, and lets the worker cancel before adapter execution.
- standalone running `cancel_requested` writes compare the full originally read
  running run snapshot before updating the timeline fingerprint or appending
  cancellation-request history, so same-lease row drift cannot persist stale
  operator evidence.
- standalone Agent Runtime workers re-lock the run row and confirm the same
  current non-expired worker lease before resolving or executing workflow
  adapters, so stale workers whose leases were recovered exit without invoking
  adapters or writing terminal worker failure/result evidence.
- standalone Agent Runtime worker-owned adapter execution, generic completion,
  record-only completion, failure, and cooperative cancellation paths confirm
  the same worker attempt snapshot as the leased worker read before terminal
  writes, so stale same-lease attempt drift cannot persist execution-result
  ledger, step-output, or timeline evidence for a newer attempt.
- standalone Agent Runtime worker-owned failure, record-only completion, and
  generic completion terminal run updates also compare the full originally
  read running run snapshot, including workflow/source identity,
  target/evidence, timeline fingerprint, failure, queue/lease/attempt,
  completion, creation, and update-time evidence, before writing
  execution-result ledger, step, or timeline history.
- standalone Agent Runtime worker-owned failure, record-only completion, and
  generic completion terminal step updates also compare each active step's
  originally read identity, status, output summary, evidence, order, and
  timestamp snapshot before writing terminal step summaries or timeline
  evidence.
- standalone Agent Runtime lease acquisition compares the hydrated run and
  active-step snapshots before appending worker lease timeline evidence or
  step `workerLease` summaries, so stale hydration rolls the whole lease
  transaction back.
- standalone Agent Runtime stale-lease recovery compares the hydrated expired
  run and active-step snapshots before clearing leases, updating step
  summaries, writing terminal stale-lease ledger rows, or appending run/step
  recovery timeline events.
- standalone Agent Runtime manual cancel/resume compare the full originally
  read run snapshot, including workflow/source identity, target/evidence,
  timeline fingerprint, failure, queue/lease/attempt, completion, creation,
  and update-time evidence, before writing control timeline or step evidence.
- standalone Agent Runtime manual cancel/resume child step updates compare each
  originally read step's identity, status, output summary, evidence, order, and
  timestamp snapshot before writing manual-control summaries.
- standalone Agent Runtime workers consume matching cooperative cancellation
  requests after an adapter returns without terminal state and before
  incomplete-adapter failure persistence, so adapters can yield to post-start
  cancellation without being marked as worker failures.
- standalone workflow adapters receive a lease-scoped
  `checkCancellationRequested()` callback plus the leased worker attempt, so
  long-running adapters can poll and consume durable running cancellation
  requests through the same model-owned status/lease/attempt fence used by
  worker terminal paths.
- standalone manual cancel/resume now fences run and child step updates against
  the originally read run and step snapshots, so a run-level control operation
  rolls back instead of writing stale step summaries or timeline events when
  another worker/control path has already advanced run or step evidence.
- generic Agent Runtime run creation validates rows reused after
  source-unique insert conflicts against the computed create-time
  workflow/source/target/evidence and step evidence, while preserving existing
  pre-read idempotent reuse.
- Agent Runtime execution-result insert conflicts on `(run_id, worker_attempt)`
  re-read the existing ledger row and validate run/source/result/payload/
  lease/completion evidence before treating duplicate terminal writes as
  idempotent.
- Agent Runtime execution-result ledger inserts also fence the terminal parent
  run snapshot written by the worker path, so parent run drift between
  terminal update and result-history insertion fails closed before stale
  ledger evidence persists.

Remaining follow-up:

- connect additional action/prompt workflows;
- add true preemptive live interrupt semantics for running production adapters
  while they are still executing external work;
- wire real Codex/MCP/tool/model execution adapters that drive the persisted
  generic step records.

See `tracks/agent-runtime.md`.

## P2: DB-backed Registry Progress

Status: Prompt Registry durable read/direct publish/repair-driven write path,
Policy DB-backed read/runtime resolution plus direct/repair-driven write path,
Model Registry DB-backed read/direct publish/repair-driven write path, and
Provider Registry DB-backed read/direct publish/repair-driven write paths
implemented, with publish/reuse event history now persisted and exposed on
revision responses.

Move one config-only registry area into DB-backed records.

Implemented outcome:

- `ai_prompt_registry_revisions` stores Prompt Registry revision records with
  revision, scope, workspace, actor, status, fingerprint, fallback source chain,
  and timestamps;
- compatibility with current config defaults;
- resolver behavior that explains `db_revision`, `legacy_registry`, and
  `config_fallback` sources;
- workspace-scoped revisions take precedence over global revisions for the
  selected workspace;
- approved repair execution can create a workspace-scoped Prompt Registry
  revision with source-chain evidence and repair execution metadata;
- prompt-registry repair execution now writes valid legacy fallback provenance
  into the repair revision source chain using publish-gate `publishStatus`, so
  blocked repair flows preserve source-chain evidence instead of being filtered
  during DB-backed revision normalization;
- a constrained GraphQL publish mutation can create workspace-scoped Prompt
  Registry revisions after publish-gate validation, stale-version checks, route
  readiness review, and `Workspace.Copilot` permission checks, with review
  metadata and idempotent matching revision reuse;
- `ai_task_route_policy_revisions` stores Task Route Policy records for
  embedding, workspace indexing, and rerank routes with revision, scope,
  workspace, actor, status, model id, fingerprint, fallback source chain, and
  timestamps;
- TaskPolicy resolves workspace active revisions before global revisions and
  existing config/provider-default fallbacks;
- workspace embedding/rerank runtime calls use DB-aware TaskPolicy resolution
  with workspace scope;
- approved task-route repair execution can create a workspace-scoped Task Route
  Policy revision with source-chain evidence and repair execution metadata;
- a constrained GraphQL publish mutation can create workspace-scoped Task Route
  Policy revisions for embedding, workspace indexing, or rerank routes, with
  idempotent matching revision reuse and config/provider-default fallback
  source-chain evidence;
- `ai_model_registry_revisions` stores DB-backed Model Registry records with
  provider id, model id, scope, workspace, actor, status, revision, fingerprint,
  model definition, fallback source chain, and metadata;
- provider registry construction overlays active DB model revisions before
  provider-profile/native fallback, preferring workspace revisions over global
  revisions;
- approved default-model route repair execution can create a workspace-scoped
  Model Registry revision that aliases the missing default model to a verified
  provider model candidate;
- a constrained GraphQL publish mutation can create workspace-scoped Model
  Registry definition revisions for existing configured providers, with
  sanitized model-definition persistence, idempotent matching revision reuse,
  and no provider runtime/secret creation;
- `ai_provider_registry_revisions` stores DB-backed Provider Registry records
  with provider id/type, scope, workspace, actor, status, revision,
  fingerprint, provider profile metadata, fallback source chain, and metadata;
- provider registry construction overlays active DB provider profile revisions
  onto existing configured provider runtimes before DB-backed model definition
  revisions, preferring workspace revisions over global revisions;
- existing model/route diagnostics surface DB-backed provider profile source
  and config path evidence without introducing provider credential writes;
- a constrained GraphQL publish mutation can create workspace-scoped Provider
  Registry metadata revisions for existing configured providers, with
  sanitized persistence (`config: {}`), idempotent matching revision reuse, and
  no provider secret/runtime creation;
- approved provider registry repair execution can create a workspace-scoped
  Provider Registry metadata revision with repair execution metadata while
  preserving the same configured-provider credential boundary;
- `ai_provider_health_states` stores workspace-scoped DB-backed Provider Health
  State records for existing configured providers, and effective provider
  registry construction overlays those records into route health before model
  definition revisions are applied;
- Provider Health metadata is DB-constrained to keep the expected metadata
  version and source-specific publish-source vocabulary used by manual
  overrides, probe snapshots, and cleanup workers;
- Provider Health cleanup metadata is DB-constrained to retain configured
  snapshot provider-profile evidence, stale configured-snapshot cleanup
  provenance, and stale probe-result cleanup freshness evidence before rows
  can influence route overlays or worker cleanup summaries;
- Provider Health event history persists append-only manual override,
  workspace probe-result, configured snapshot, configured snapshot cleanup, and
  stale probe cleanup events with DB-constrained event/source/publish-source
  coherence, non-orphan state-id integrity, and state identity/workspace
  snapshot coherence;
- Provider Health workspace and global configured-snapshot writers use atomic
  `INSERT ... ON CONFLICT DO UPDATE RETURNING` upserts, so unique-key races
  after missed pre-reads apply the current health state and append matching
  event history instead of returning stale overlay evidence;
- `ai_provider_health_probe_attempts` persists automatic no-network workspace
  probe attempts for active workspace Provider Registry revisions, including
  revision id/fingerprint binding, sanitized profile snapshot evidence,
  worker lease/attempt status, terminal result metadata, and the resulting
  Provider Health state fingerprint. The worker enqueues due revision targets,
  leases attempts, probes local provider profile/runtime contract readiness,
  and publishes through existing workspace `probe_result` state/event history;
- Provider Registry direct publish and repair-execution publish paths enqueue
  the same durable no-network Provider Health probe attempt immediately, so a
  newly published workspace provider revision no longer waits for the daily
  enqueue scan before durable probe evidence exists. Direct publish responses
  expose the queued probe attempt id/status/fingerprints for operator review;
- Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
  direct publish and repair-execution publish paths validate revision row
  conflicts against expected row id, family identity, workspace/actor scope,
  revision/status/fingerprint, fallback source chain, publish metadata, and
  family-specific persisted content evidence before publish history,
  route/model/profile overlays, or Provider Health probe enqueue can reuse the
  row;
- Provider Health probe enqueue validates a reused request-fingerprint row
  against the computed revision/profile/request evidence before returning it,
  so idempotent conflict handling cannot mask a drifted provider-profile
  snapshot or fingerprint;
- Provider Health probe enqueue also fences the active parent Provider
  Registry revision row by revision identity, workspace/actor scope,
  fingerprint, raw provider profile, raw fallback source-chain, metadata, and
  timestamps before inserting queued probe evidence, so stale registry target
  readbacks fail closed before probe work is persisted;
- Provider Health event inserts validate deterministic event-id conflicts
  against the current state/event evidence, including provider identity,
  workspace/actor snapshot, timestamps, source/type, state/event fingerprints,
  last-error text, and metadata fingerprint, before treating the append-only
  event write as idempotent;
- Provider Health probe completion/failure locks the attempt row and confirms
  the same non-expired worker lease before publishing health state or
  retry/dead-letter evidence, preventing stale workers from overwriting route
  health after another worker has re-acquired the attempt;
- Provider Health probe completion/failure also confirms the same attempt
  counter before publishing health state or retry/dead-letter evidence,
  preventing stale in-memory workers from writing terminal probe evidence after
  attempt metadata changes under the same lease id;
- Provider Health probe completion/failure terminal writes also compare the
  full locked attempt row snapshot, including profile evidence, request/result
  fields, lease timestamps, health-state linkage, and update time, preventing
  same-lease row drift from being overwritten by stale workers;
- Provider Health probe attempts can be read through a bounded workspace
  filter for status, provider id, provider registry revision id, revision/
  profile/request/result fingerprints, and a constrained locator query over
  those same durable identity fields. GraphQL/common/Admin expose the filter
  while preserving the default recent-list behavior;
- Provider Health mutation responses expose `eventCount` plus recent event
  rows for manual health transitions, closing the SQL-only visibility gap for
  the existing write response;
- GraphQL/common/Admin expose Task Route Policy revision metadata and
  Model Registry revision metadata plus DB/config fallback source-chain
  evidence;
- Admin read-only visibility for registry source, revision, status, and source
  chain;
- database constraints now reject malformed fallback source-chain provenance
  entries across Prompt Registry, Task Route Policy, Model Registry, and
  Provider Registry revision tables before row overlays or diagnostics can
  observe unknown provenance vocabulary;
- database constraints now reject malformed fallback source-chain optional
  metadata fields across those same revision tables, keeping direct/manual rows
  aligned with model-layer source-chain sanitization;
- database constraints now reject current-version registry revision metadata
  that pairs direct-publish versions with repair worker sources, or
  repair-executor versions with non-repair publish sources;
- database constraints now reject current-version repair-executor registry
  metadata that drops repair request, approval, operation, target locator, or
  candidate evidence fields;
- `ai_registry_revision_publish_events` stores append-only publish/reuse
  history for Prompt Registry, Task Route Policy, Model Registry, and Provider
  Registry direct and repair-driven writers, with DB constraints on event
  metadata, family-specific FKs, workspace-scoped snapshot coherence that also
  rejects parent revision snapshot edits, workspace actor evidence so nullable
  actor columns cannot bypass workspace snapshot checks, and
  global revision identity snapshot coherence even when workspace/actor columns
  are null, plus actor-present global event snapshot coherence when actor
  evidence is captured;
- model-owned registry publish/reuse event inserts now require the full parent
  revision snapshot read by the publisher, including family-specific content,
  fallback source-chain, metadata, and `updated_at`, so stale direct or
  repair-driven revision snapshots fail before adding publish history;
- registry publish-event insert conflicts re-read the existing event by
  fingerprint and validate family, revision, provider/model identity,
  workspace/actor, revision status/fingerprint, event type/source, and metadata
  fingerprint before treating the event as idempotent;
- registry `revision_published` events now use the same application timestamp
  as the parent revision row creation, so deferred publish-history proof and
  operator-visible event ordering are not dependent on database default
  transaction timestamps;
- Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
  revision inserts now use `RETURNING id` to detect unique-key race losers and
  record insert-conflict reuse as `revision_reused` instead of a duplicate
  `revision_published` outcome;
- existing registry revision GraphQL response types and direct publish model
  returns expose `publishEventCount` and recent publish/reuse event evidence
  for Prompt Registry, Task Route Policy, Model Registry, and Provider
  Registry revisions;
- prompt catalog DB-backed revision reads expose
  `registryRevisionPublishEventCount` and recent
  `registryRevisionPublishEvents`, with Admin rendering publish/reuse event
  evidence beside normal prompt catalog revision diagnostics;
- model/task-route diagnostics expose bounded Model Registry and Task Route
  Policy publish/reuse event history through `getPromptModels` and Admin,
  without adding publish events to source fingerprint inputs;
- focused backend tests and Admin tests for the changed UI.

Remaining follow-up:

- add Prompt Registry prompt-body edit APIs, diff/eval, full audit/history
  views, and bulk migration workflow around the constrained direct publish
  path;
- add bulk migration from existing registry/config defaults where needed;
- add prompt body diff/eval before editable Admin changes;
- add full editable Task Route Policy workflows and bulk migration from config
  defaults where needed;
- add full editable Model Registry workflows, model diff/review UI, and bulk
  migration from provider profile/native registry defaults where needed;
- add full Provider Registry editor workflows, credential management,
  external network/credential health probes, probe-attempt alerting/advanced
  search workflows, and bulk migration where needed.

See `tracks/registries.md`.

## Do Not Prioritize

Do not prioritize:

- another nested read-only support-bundle field;
- another placeholder fingerprint input list;
- another source-evidence archive/storage/backend marker;
- text-only Admin diagnostics with no durable behavior.

Those are allowed only when explicitly requested as a narrow diagnostic task.
