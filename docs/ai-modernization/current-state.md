# Current State

## Completed

The project has implemented many P1 read-only diagnostics and compatibility
bridges:

- provider, model, prompt, task route, and policy diagnostics;
- prompt registry publish-gate evidence;
- action run prepared-route trace summaries;
- repair preview, preflight, and execution request contract snapshots;
- support bundle lifecycle and source guard metadata;
- support bundle source-evidence candidate reference entries;
- nested placeholder statuses and fingerprints for support bundle source
  evidence.

The latest confirmed slice is main-plan section 554:

- the source-evidence field
  `candidateEvidenceReferenceSchemaArtifactRecordStorageObjectArchiveManifestEntryPersistenceRecordStorageObjectArchiveManifestEntryPersistenceRecordStorageObjectArchiveManifestEntryPersistenceRecordStorageObjectArchiveInclusionFingerprint`
  is exposed through backend resolver, GraphQL schema/query/types, Admin
  diagnostics text, and focused tests.

The first durable support bundle slice is now implemented:

- `ai_support_bundle_requests` and `ai_support_bundle_audit_events` persist
  workspace, actor, status, source evidence summary, source evidence
  fingerprint, manifest fingerprint, manifest JSON, retention status,
  expiration, and create/read audit events;
- GraphQL can create, list, and read DB-backed support bundle requests with
  workspace permission checks;
- Admin can create and inspect recent support bundle requests for a selected
  workspace, including manifest/source fingerprints, retention state, and audit
  counts;
- focused backend and Admin tests cover creation, persistence, read/list access,
  and authorization rejection.

The support bundle download authorization slice is now implemented:

- `ai_support_bundle_download_authorizations` persists workspace, actor,
  bundle id, status, artifact kind, filename, mime type, manifest fingerprint,
  authorization fingerprint, token fingerprint, expiration, and downloaded time;
- support bundle download authorization rows are lifecycle-mutable but issued
  artifact/token/delivery/expiry evidence is DB-guarded against direct rewrites;
- GraphQL can authorize a short-lived manifest artifact download after
  workspace permission checks;
- `/api/copilot/support-bundles/:authorizationId/manifest` validates the
  short-lived token against the persisted token fingerprint, consumes the
  authorization, records a `downloaded` audit event, and returns the minimal
  manifest JSON as an attachment;
- download authorization and download consumption write
  `download_authorized`/`downloaded` audit events;
- Admin can request a manifest download for a persisted bundle and observe the
  latest authorization state.

The support bundle retention cleanup slice is now implemented:

- GraphQL can run a workspace-scoped retention cleanup after the same workspace
  permission check used by create/read/download operations;
- cleanup expires due active support bundles by setting request status and
  retention status to `expired`, updating the stored manifest retention status,
  recalculating the manifest fingerprint, and writing a `retention_expired`
  audit event;
- outstanding authorized manifest downloads for expired bundles are marked
  `expired`, and the HTTP manifest endpoint no longer serves them;
- `retention_expired` audit metadata is DB-constrained to retain cleanup
  identity, fingerprint, scope, expired authorization count, expired retention
  status, and known archive/manifest cleanup status vocabulary before retry or
  escalation scans consume it;
- `download_authorized` audit metadata is DB-constrained to retain the current
  authorization/expiration audit versions, authorization identity, artifact
  evidence, delivery method, expiry, and cleanup fingerprint evidence before
  audit or cleanup consumers observe it;
- Admin can trigger cleanup for the selected workspace and observe the cleaned
  bundle/authorization counts and cleanup fingerprint;
- focused backend and Admin tests cover cleanup execution, authorization
  invalidation, audit metadata, idempotent no-op reruns, and authorization
  rejection.

The support bundle archive artifact slice is now implemented:

- support bundle creation writes a minimal `localmind-support-bundle-archive/v1`
  JSON payload to the configured blob storage provider;
- `ai_support_bundle_requests` persists archive storage key, byte size,
  fingerprint, MIME type, and filename alongside the DB-backed request and
  manifest;
- the stored manifest includes archive metadata that binds the downloadable
  artifact to the request row;
- download authorization supports both `manifest_json` and `archive_json`, with
  a persisted artifact fingerprint;
- `/api/copilot/support-bundles/:authorizationId/artifact` validates and
  consumes the short-lived authorization before returning the selected manifest
  or archive bytes;
- audit events include `archive_created`, `download_authorized`, and
  `downloaded`;
- creation and archive-created audit metadata is model-validated and
  DB-constrained to retain manifest/archive artifact identity, positive byte
  sizes, storage keys, fingerprints, MIME values, filenames, and active
  retention evidence before lifecycle consumers observe it;
- support bundle creation now best-effort deletes just-written manifest/archive
  storage objects if DB persistence or creation audit history fails after the
  object writes, so failed creates do not leave orphan support-bundle artifacts;
- Admin displays archive metadata and requests the archive artifact by default;
- focused backend and Admin tests cover archive persistence, artifact
  authorization, one-time download consumption, audit metadata, and UI
  visibility.

The support bundle scheduled retention cleanup slice is now implemented:

- the daily Copilot cron path enqueues
  `copilot.supportBundle.cleanupRetention` with a fixed job id;
- the BullMQ job handler runs system-scoped retention cleanup across due support
  bundles, reusing the same persisted request/authorization/audit state as the
  Admin cleanup path;
- cleanup runs in bounded batches and returns `Repeat` while a full batch is
  expired, allowing the queue worker to continue until no due bundles remain;
- `retention_expired` audit metadata records `cleanupScope=scheduled_worker`
  and `cleanupActorId=system_retention_worker`, while preserving the bundle
  actor foreign-key relationship on the audit row;
- focused backend tests cover queued worker cleanup, cross-workspace expiration,
  authorization revocation, repeat/done signals, and audit metadata.

The support bundle packaged archive contents slice is now implemented:

- support bundle creation writes a packaged
  `localmind-support-bundle-archive/v1` JSON artifact instead of only a minimal
  outer summary;
- support bundle request rows are lifecycle-mutable but creation/source/archive
  evidence is DB-guarded against direct rewrites after persistence;
- the archive contains a deterministic file index and embedded JSON files for
  `manifest.json`, `source-evidence-summary.json`,
  `prompt-catalog-summary.json`, `actor-action-runs.json`, and
  `task-route-summary.json`;
- every archive file has a persisted path, media type, byte size, and
  fingerprint, and the archive has a deterministic index fingerprint;
- the prompt catalog snapshot is workspace-scoped, action runs are scoped to
  the bundle actor/workspace, and task route snapshots include sanitized route
  policy/model/provider/fingerprint evidence;
- the existing archive storage metadata, download authorization, token
  consumption, and API artifact endpoint now serve and validate the packaged
  archive bytes;
- focused backend tests cover the archive file index, embedded section
  contents, per-file fingerprints, archive index fingerprint, download
  authorization, and one-time consumption.

The support bundle object-storage signed URL slice is now implemented:

- `ai_support_bundle_download_authorizations` persists delivery method,
  direct object-storage URL, and direct URL expiration metadata;
- archive download authorization attempts object-storage signed URL delivery
  when the configured storage provider returns a signed redirect URL and object
  metadata matching the persisted archive byte size;
- GraphQL returns `deliveryMethod`, `directDownloadUrl`, and
  `directDownloadExpiresAt`; `downloadUrl` remains backward compatible and
  points at the direct URL when one was issued, otherwise at the API proxy;
- API-proxied artifact consumption rejects direct-delivery authorizations so a
  direct signed URL is not double-consumed through the proxy endpoint;
- Admin shows whether the latest artifact authorization is API-proxied or
  object-storage signed URL delivery;
- focused backend tests cover signed URL issuance, DB persistence, audit
  metadata, and API proxy rejection for direct-delivery authorizations.

The support bundle direct download acknowledgement slice is now implemented:

- GraphQL exposes `acknowledgeCopilotSupportBundleDirectDownload` behind the
  existing workspace Copilot permission check;
- the model accepts only active `object_storage_signed_url` authorizations in
  the same workspace and rejects API-proxy, expired, missing-direct-URL, or
  already-final rows;
- acknowledgement revalidates the ready/active support bundle plus
  manifest/archive fingerprint evidence before mutating state;
- acknowledgement uses a conditional terminal update over the originally read
  authorization evidence and parent bundle snapshot, so stale readbacks roll
  back before downloaded audit evidence is written;
- `ai_support_bundle_download_authorizations` transitions to `downloaded` and
  sets `downloaded_at`;
- `ai_support_bundle_audit_events` records a `downloaded` event with delivery
  method, artifact evidence, direct URL expiration, `authorizationActorId`, and
  `clientAcknowledged=true`;
- focused backend coverage checks direct acknowledgement persistence, audit
  metadata, replay rejection, and API-proxy rejection.

The support bundle archive object cleanup slice is now implemented:

- retention cleanup attempts to delete the stored archive object after a bundle
  row successfully transitions to expired;
- `retention_expired` audit metadata records `archiveObjectCleanupStatus`,
  archive storage key, and delete error code/message when cleanup fails;
- DB retention expiry still completes when object deletion fails, leaving a
  durable audit trail for operational retry/follow-up instead of rolling back
  the bundle state;
- focused backend coverage checks successful object deletion and failure audit
  metadata.

The support bundle retention retry and manifest storage slices are now
implemented:

- manual and scheduled retention cleanup retry failed archive object deletion
  for expired bundles, write retry/recovered/failed audit metadata, and
  escalate persistent scheduled failures with a durable skip marker;
- manifest JSON is persisted to blob storage during bundle creation, manifest
  downloads can use signed URL delivery, and retention cleanup rewrites the
  stored manifest after DB expiry;
- failed manifest object rewrites are retried through the same cleanup entry
  points and persistent scheduled failures are escalated while remaining
  manually recoverable;
- short-lived download authorizations expire through an independent scheduled
  cleanup job;
- retention retry/escalation audit metadata is model-validated and
  DB-constrained to retain previous cleanup fingerprints, retry failure counts,
  storage keys, bounded error evidence, and scheduled escalation coherence
  before cleanup scans or Admin summaries consume it;
- retention retry audit insertion now compares the expired bundle snapshot and
  latest failed cleanup audit source id/fingerprint/metadata/timestamp before
  appending retry/recovered/escalated evidence, so stale cleanup workers cannot
  record audit history after newer cleanup evidence appears.

The support bundle provider-transfer evidence slice is now implemented:

- the internal transfer endpoint accepts canonical events only with internal
  `x-access-token` auth evidence and rejects canonical self-reported provider
  signature evidence;
- S3/R2-compatible object-created wrappers must carry upstream
  `verified_by_upstream` provider signature evidence with verifier, policy,
  and signature fingerprint before the controller/model path can mark a
  direct-delivery authorization downloaded;
- `ai_support_bundle_audit_events` rejects provider-origin downloaded audit
  rows that lose the upstream verifier/policy/fingerprint evidence;
- verified direct-transfer notifications now persist into
  `ai_support_bundle_transfer_events` with authorization snapshot, provider
  event id/source, storage evidence, notification auth evidence, and
  deterministic transfer event fingerprints;
- direct transfer-event terminal writes also compare the read authorization and
  parent bundle snapshots before marking the authorization downloaded, so stale
  provider callbacks cannot append transfer events or downloaded audit rows
  from outdated evidence;
- API-proxy download consumption now compares the read authorization and
  parent bundle snapshots after artifact readback but before marking the
  authorization downloaded, so stale bundle drift cannot append downloaded
  audit rows from outdated evidence;
- production transfer forwarding now persists parsed notifications into
  `ai_support_bundle_transfer_forwarding_events` before ingestion, with
  canonical payload fingerprints, upstream signature-evidence fingerprints
  when present, worker lease/attempt evidence, retry scheduling,
  dead-lettered terminal failures, and forwarded transfer-event fingerprint
  linkage;
- production object-storage webhook ingress now accepts configured S3/R2-style
  notifications through a public HMAC-SHA256 boundary, rejects body-injected
  provider signature evidence, derives server-owned `verified_by_upstream`
  evidence, and appends the verified payload into the same durable transfer
  forwarding queue before worker ingestion;
- expired direct signed-URL acknowledgements and transfer notifications now
  persist the authorization `expired` transition plus matching
  `download_authorized(authorizationExpired=true)` audit history before
  returning the client/provider error, so failed delivery callbacks no longer
  lose expiry evidence to transaction rollback;
- direct signed-URL expiration writes now use the same authorization snapshot
  compare-and-swap discipline as downloaded terminal writes, so stale
  acknowledgement or transfer-event reads fail before writing
  `authorizationExpired=true` audit history;
- retention cleanup expiration writes now compare the originally read support
  bundle request identity, manifest, archive, source-evidence, retention,
  failure, and timestamp snapshot before rewriting the expired manifest,
  revoking authorizations, or appending cleanup audit evidence;
- the `copilot.supportBundle.processTransferForwardingEvents` worker replays
  queued/retryable forwarding rows through the same storage/auth verifier used
  by the internal endpoint, while deterministic malformed transfer evidence is
  dead-lettered instead of retried forever;
- transfer forwarding processing now re-locks the row and verifies the same
  current non-expired worker lease before storage verification, forwarded
  terminal writes, or retry/dead-letter writes, so stale workers cannot mark a
  direct download or mutate forwarding state after another worker re-acquires
  the lease;
- transfer forwarding processing now also requires the same attempt counter
  snapshot before storage verification or terminal forwarding writes, so stale
  in-memory workers cannot append transfer events, mark authorizations
  downloaded, or write retry/dead-letter evidence after attempt metadata
  changes under the same lease id;
- transfer forwarding forwarded and retry/dead-letter terminal writes now
  compare the full locked forwarding row snapshot, including immutable
  forwarding payload/fingerprints, lease timestamps, terminal/failure fields,
  and update time, so same-lease row drift fails before terminal mutation;
- transfer forwarding processing now wraps transfer ingestion, authorization
  download mutation, downloaded audit history, and the final forwarded row
  update in one transaction, so a forwarded terminal snapshot failure rolls
  back transfer/download evidence instead of leaving a downloaded
  authorization behind a still-processing forwarding row;
- transfer forwarding enqueue conflicts now re-read the existing row by
  authorization/fingerprint and validate provider event id/source, forwarding
  payload fingerprint, and provider-signature evidence fingerprint before
  treating the row as idempotent;
- forwarding rows are DB-constrained for payload identity/source coherence,
  queued/processing/retry/forwarded/dead-letter state shape, immutable
  forwarding evidence after insertion, and delete restriction while the parent
  authorization still exists;
- transfer event authorization snapshots use update-restricted composite
  foreign keys, so direct SQL cannot mutate parent authorization snapshot
  columns and silently cascade changed evidence into historical transfer rows;
- transfer event storage evidence is checked at write time against the parent
  bundle manifest/archive artifact metadata, so direct SQL cannot persist
  transfer rows with fabricated storage key, byte size, content type, or
  artifact fingerprint evidence;
- direct transfer event insert conflicts re-read the existing row and validate
  provider event id/source, transfer timestamp, auth-evidence fingerprint, and
  storage evidence before treating a duplicate event fingerprint as
  idempotent;
- transfer event rows reject direct content-evidence rewrites after persistence,
  so authorization linkage, provider event/source, notification auth evidence,
  storage evidence, event fingerprint, and creation-time history remain
  append-only while true no-op updates stay compatible;
- matching transfer-event replays remain downloaded-audit-idempotent but append
  their own durable transfer event rows after storage validation;
- support bundle GraphQL create/get/list responses now expose
  `transferEventCount` plus recent transfer event storage/auth/provider
  notification evidence, and Admin renders that evidence in the support bundle
  list;
- support bundle GraphQL create/get/list responses now also expose
  `transferForwardingEventCount` plus recent transfer forwarding retry,
  forwarded, dead-letter, payload fingerprint, provider-signature, and worker
  lease evidence, and Admin renders that queue history in the support bundle
  list;
- dead-lettered support bundle transfer forwarding rows can now be replayed
  through GraphQL/Admin by appending a fresh queued forwarding event whose
  immutable payload records replay metadata and source dead-letter evidence,
  while the original terminal row keeps its failure code, payload fingerprint,
  attempt count, and dead-letter timestamp unchanged; replay insertion now
  compares the full source dead-letter row snapshot before inserting, so stale
  operator replay cannot create queued work after the source row changes;
- support bundle GraphQL create/get/list and retention-cleanup responses expose
  recent lifecycle `auditEvents`, and the detail read response includes the
  newly persisted `read` audit row after rehydration;
- focused backend coverage checks malformed wrapper evidence, direct SQL
  tampering of persisted provider-transfer audit metadata, and direct SQL
  drift against the transfer-event authorization snapshot, child workspace
  snapshot drift for audit/download authorization rows, manifest identity
  drift inside the persisted manifest JSON, download authorization manifest
  snapshot drift at write time, archive authorization artifact snapshot drift
  at write time, transfer event storage snapshot drift at write time,
  transfer-event content/fingerprint rewrites after persistence, support bundle
  audit event content-evidence rewrites after persistence, retention retry
  source cleanup evidence drift, transfer-forwarding replay source-row snapshot
  drift, plus GraphQL/Admin transfer-event, transfer-forwarding,
  transfer-forwarding replay, and audit-event history visibility.
- support bundle request rows now reject direct lifecycle rewrites after
  creation: `expires_at` drift, ready-to-failed status/failure drift, and
  premature ready-to-expired rewrites fail at the DB boundary, while the
  implemented retention cleanup transition is still allowed only after the
  persisted retention window has elapsed and only for the manifest retention
  snapshot/fingerprint/byte-size changes it owns.
- support bundle request inserts and real retention lifecycle transitions now
  require matching append-only audit history by commit time: `created` audit
  rows bind manifest/source/retention evidence, packaged archive rows also
  require `archive_created` evidence, and expired rows require
  `retention_expired` metadata with the resulting and previous manifest
  fingerprints plus cleanup identity evidence.
- support bundle download authorization rows now reject direct lifecycle
  rewrites after issuance: premature expiry, revoked drift, late downloaded
  timestamps, and terminal replay fail at the DB boundary, while API-proxy
  consumption, direct-download acknowledgement, provider transfer-event
  ingestion, scheduled authorization cleanup, and parent retention cleanup keep
  their implemented transition shapes.
- support bundle download authorization inserts and real status transitions
  now require matching append-only audit history by commit time: issuance binds
  `download_authorized` authorization/artifact/delivery evidence, downloaded
  terminal state binds `downloaded` evidence, and expired terminal state binds
  the existing `download_authorized(authorizationExpired=true)` cleanup
  metadata.
- support bundle download authorization rows reject direct deletion while the
  parent bundle still exists, preserving issued/downloaded/expired
  authorization history after audit and transfer child histories are protected.
- support bundle request rows reject direct deletion while the owning workspace
  still exists, preserving the persisted bundle root plus audit,
  authorization, and transfer history; workspace deletion remains the
  ownership cleanup path.

The first durable repair execution slice is now implemented:

- `ai_repair_execution_requests` and
  `ai_repair_execution_audit_events` persist workspace, actor, prompt target,
  requested action, status, approval state, permission status, idempotency key,
  evidence fingerprints, runtime result, completion/failure fields, and audit
  events;
- the repair execution mutation still preserves the legacy request projection,
  but now creates or reuses a DB-backed execution request for workspace-scoped
  calls after the existing workspace permission/preflight checks;
- create/reuse handles idempotency unique-key races by re-reading the existing
  request, validating the create-time prompt/action/permission, fingerprint,
  runtime-result, and executor-payload evidence, then appending `reused` audit
  history, so matching concurrent callers do not surface raw unique constraint
  failures after both miss the pre-read while drifted conflicts fail closed
  before misleading audit evidence is written;
- approval-required requests persist as `waiting_approval`, while non-approval
  requests can complete through the first safe no-op runtime path with
  `sideEffectsApplied: false`;
- Admin can see the durable execution record id, status, approval state,
  idempotency key, audit count, and side-effect status;
- focused backend and Admin tests cover persistence, idempotency reuse, audit
  events, authorization rejection, and Admin visibility.

The repair execution approval decision slice is now implemented:

- GraphQL can approve or reject a persisted repair execution request that is
  still `waiting_approval`, after the same workspace permission checks;
- approval writes `approval_approved`, `running`,
  `side_effect_applied`, and terminal `completed` audit events when the
  approved request carries the Prompt Registry revision executor payload;
- approval stores a `prompt_registry_revision_publish_worker` runtime result
  with `sideEffectsApplied: true`, the side-effect fingerprint, side-effect
  kind, side-effect record id, and a sanitized summary for the published
  workspace revision;
- rejection writes `approval_rejected` and terminal `cancelled` audit events,
  stores a rejected runtime result, and does not apply side effects;
- duplicate or stale approval decisions are rejected unless the request is still
  `waiting_approval` with `approvalState=waiting`;
- approval decisions now compare the full waiting request snapshot before
  writing approval/rejection state or audit history, so same-state drift in
  request evidence, payload, lease/attempt fields, failure fields, or
  timestamps fails closed;
- approved/rejected approval-state changes now require the matching
  `approval_approved` or `approval_rejected` audit event by commit time, so a
  direct SQL lifecycle update cannot rely only on queued/cancelled audit
  history while omitting the actual decision event;
- Agent Runtime run, step, and timeline state is synchronized after approval or
  rejection, and Admin can trigger and observe the decision result.

The first repair execution mutating executor slice is now implemented:

- `ai_repair_execution_requests.executor_payload` stores the approved executor
  payload captured from the permission/preflight-checked repair request;
- approving a prompt registry repair execution publishes a workspace-scoped
  `ai_prompt_registry_revisions` record with revision, actor, fingerprint,
  source-chain evidence, and repair execution metadata;
- the side effect is gated by the existing workspace permission check,
  `waiting_approval`/`approvalState=waiting` state check, and idempotency key;
- Admin can observe that the approved execution applied a Prompt Registry
  revision side effect rather than a safe no-op.

The repair execution worker lease and retry slice is now implemented:

- `ai_repair_execution_requests` persists queued time, worker lease id, lease
  expiration, attempt count, max attempts, and last attempt time;
- approving a waiting repair execution no longer runs side effects inside the
  GraphQL resolver; it transitions the request to `queued`, writes
  `approval_approved` and `queued` audit events, and enqueues
  `copilot.repairExecution.run`;
- the repair execution worker acquires a persisted lease, transitions the
  request to `running`, applies the Prompt Registry revision publisher, and
  writes `side_effect_applied` plus terminal `completed` audit events;
- applied repair side-effect runtime results are DB-constrained to retain
  side-effect kind, record id, fingerprint, and object summary evidence before
  Agent Runtime/Admin/support-bundle consumers read them;
- applied repair side-effect runtime results are also DB-constrained to retain
  the explicit forward-only rollback contract already emitted by constrained
  registry publishers;
- applied repair side-effect runtime results are DB-constrained to match the
  persisted executor payload publisher kind, so a prompt-registry executor
  payload cannot claim a model-registry side effect;
- completed constrained repair side effects now persist
  `ai_repair_execution_side_effects` ledger rows with request/workspace/actor
  snapshot coherence, executor payload fingerprint, worker lease evidence, and
  the same forward-only rollback contract, and parent request snapshot edits
  cannot cascade changed actor/workspace evidence into historical side-effect
  ledger rows;
- repair side-effect ledger rows are now also checked against the completed
  parent request result at write time, and parent result/executor-payload
  updates are blocked once a ledger row exists, so side-effect kind, record id,
  fingerprint, summary, worker attempt, completed timestamp, failure/lease
  absence, actor evidence, and executor-payload provenance cannot drift between
  the terminal request row and durable side-effect history;
- repair side-effect ledger inserts now also fence the terminal parent request
  snapshot with an `INSERT ... SELECT` over request identity, approval,
  permission, durable fingerprints, runtime result, executor payload,
  queue/lease/attempt, completion, and timestamp evidence, so request drift
  between completion update and ledger insertion rolls the transaction back
  before stale side-effect evidence persists;
- completed applied repair execution request rows now require matching
  `ai_repair_execution_side_effects` history by commit time, so direct SQL
  cannot claim `sideEffectsApplied=true` on a terminal request without the
  durable side-effect ledger snapshot;
- repair side-effect ledger rows reject direct content-evidence rewrites after
  persistence, so request linkage, side-effect identity, summary,
  executor-payload fingerprint, worker lease evidence, applied time, and
  creation-time history remain append-only while true no-op updates stay
  compatible;
- repair side-effect ledger rows also reject direct deletion while the completed
  parent request still requires that ledger snapshot, closing the child-removal
  gap left by parent-side required-history checks while preserving parent
  deletion cascades;
- repair request rows now reject direct rewrites of original request evidence,
  idempotency/permission evidence, executor payload, source/repair
  fingerprints, workspace/actor linkage, and creation time after insert, while
  preserving queue, approval, lease, failure, result, and timestamp lifecycle
  updates. Deterministic unsupported or invalid executor-payload failures fail
  closed on manual retry unless a future audited payload-correction workflow is
  added;
- repair execution GraphQL/common/Admin read paths now expose
  `sideEffectCount` plus recent side-effect ledger rows on the durable
  execution record, so completed side-effect history is visible without direct
  SQL access;
- repair execution GraphQL/common/Admin read paths now expose recent
  lifecycle `auditEvents`, so requested/approval/queued/running/completed or
  retry/control transitions can be inspected without direct SQL access;
- repair execution audit rows preserve the parent request workspace snapshot at
  the DB boundary, so direct SQL cannot move lifecycle evidence into another
  real workspace while keeping the same execution request id;
- repair execution audit rows now reject direct content-evidence rewrites after
  persistence, so execution request id, actor, event type, fingerprint,
  metadata, and creation-time evidence remain append-only lifecycle history;
- repair execution request inserts and lifecycle transitions now require
  matching audit history by commit time, so direct SQL cannot create orphan
  request state or move queued/running/terminal lifecycle evidence without an
  append-only audit event for the same request/workspace/actor and resulting
  status; approval-state transitions into approved/rejected now also require
  the corresponding approval decision audit event;
- current worker/control repair audit metadata is DB-constrained for stable
  lease, failure, retry, manual cancel/retry, and stale-recovery evidence, so
  direct/manual audit rows cannot drop the fields used by diagnostics,
  recovery, or operator review;
- worker failures store failure code/message and attempt metadata. Retryable
  failures return the request to `queued` with `retry_scheduled`, while
  exhausted attempts end as terminal `failed`;
- Agent Runtime run/step/timeline state now records queued, running, completed,
  and failed repair execution states;
- repair-execution-linked Agent Runtime step summaries and timeline payloads
  now use dedicated repair-run/repair-step versions and are DB-constrained to
  retain request/repair-job fingerprints, granted permission status,
  side-effect identity, and the full forward-only rollback contract before
  Admin, run detail, or audit review consumes them;
- repair execution request rows reject direct deletion while the owning
  workspace still exists, preserving the request root plus audit and
  side-effect history; workspace deletion remains the ownership cleanup path;
- GraphQL/common/Admin expose queued/attempt/lease metadata, and focused
  backend tests cover approval queueing, worker completion, retryable failure,
  terminal failure, and authorization.

The Task Route Policy repair executor slice is now implemented:

- approved `repair_task_model_route` requests can carry a persisted
  `task_route_policy_revision_publish` executor payload into the queued repair
  execution worker;
- the worker validates the payload and creates a workspace-scoped
  `ai_task_route_policy_revisions` row with actor, feature kind, model id,
  config key/path, revision, fingerprint, fallback source chain, and repair
  execution metadata;
- runtime result and audit metadata record side-effect kind
  `task_route_policy_revision`, side-effect record id, fingerprint, and
  sanitized summary;
- TaskPolicy immediately resolves the published workspace revision before
  config fallback, so the approved repair changes route model selection through
  the DB-backed runtime path;
- focused backend tests cover approval queueing, worker publication, persisted
  route-policy revision metadata, audit events, and diagnostics resolution from
  the published DB revision.

The Model Registry repair executor slice is now implemented:

- approved `repair_default_model_route` requests can carry a persisted
  `model_registry_revision_publish` executor payload into the queued repair
  execution worker;
- the worker validates the payload and creates a workspace-scoped
  `ai_model_registry_revisions` row with actor, provider id, model id,
  model definition alias, revision, fingerprint, fallback source chain, and
  repair execution metadata;
- runtime result and audit metadata record side-effect kind
  `model_registry_revision`, side-effect record id, fingerprint, and sanitized
  summary;
- the provider registry overlay immediately resolves the published workspace
  revision before provider-profile/native fallback, so the approved repair can
  make a previously missing default prompt model routable through the DB-backed
  model registry path;
- focused backend tests cover approval queueing, worker publication, persisted
  model-registry revision metadata, and publish-gate route resolution from the
  published DB revision.

The repair execution manual control slice is now implemented:

- GraphQL can manually `cancel`, `retry`, or `recover_stale` a persisted repair
  execution request after the same workspace permission checks used by request
  and approval flows;
- cancel transitions `waiting_approval`, `queued`, or `failed` requests to
  terminal `cancelled`, clears worker lease/failure fields, writes a control
  audit event, and synchronizes the linked Agent Runtime run/step/timeline to
  cancelled/skipped state;
- cancel on a `running` request records a durable `cancel_requested` audit
  event tied to the current worker lease id and attempt, keeps the request
  running until the leased worker observes it, and compares the full originally
  read running request snapshot before writing the audit event; the worker then
  cooperatively cancels before side effects and synchronizes Agent Runtime to
  cancelled/skipped state;
- retry transitions failed requests with executable approval state back to
  `queued`, clears failure/completion fields, extends worker max attempts when
  the failure exhausted attempts, writes `manual_retry_requested` plus `queued`
  audit events, and enqueues a fresh worker job id;
- retried requests still execute through the queued worker lease path and the
  existing constrained executors, so approval/preflight-gated side effects are
  preserved;
- stale recovery accepts only `running` requests whose persisted worker lease
  has expired, clears stale lease metadata, writes `stale_recovered` audit
  metadata, requeues when attempts remain, fails when attempts are exhausted,
  and synchronizes Agent Runtime state;
- Admin shows cancel/retry controls for eligible persisted requests and
  displays the resulting durable record and Agent Runtime timeline state;
- focused backend tests cover cooperative running cancellation before side
  effects, while existing backend and Admin tests cover manual cancellation,
  manual retry, stale running lease recovery, audit persistence, Agent Runtime
  synchronization, real worker re-execution, and authorization rejection.

The first durable Agent Runtime slice is now implemented:

- `ai_agent_runs`, `ai_agent_steps`, and `ai_agent_timeline_events` persist a
  generic run/step/timeline model with workspace, actor, workflow, source
  linkage, statuses, evidence fingerprints, sanitized timeline payloads, and
  timestamps;
- the prompt registry repair execution workflow now creates or reuses an
  AgentRun linked to the persisted repair execution request;
- approval-gated repair requests create a `waiting_approval` run with an
  approval step and timeline events, while safe no-op completions can map to a
  completed runtime run;
- repair execution approval and worker execution synchronize the linked run,
  step, and timeline records to queued, running, completed, failed, or
  cancelled state;
- the Agent Runtime model can now create generic persisted runs with tool,
  Codex, MCP, handoff, model, or approval steps through an internal model API,
  reusing existing runs by workspace/source identity for idempotent adapter
  ingestion, including source unique-key races after concurrent callers both
  miss the pre-read;
- source/workflow coherence is enforced at the generic model boundary and
  database boundary, keeping repair-execution-linked rows out of standalone
  worker/control routing unless they use the dedicated repair execution
  workflow/source pair;
- standalone worker adapter-resolution failure evidence is model-validated and
  DB-constrained before failed step summaries or failure timeline payloads can
  persist malformed resolution version/status/workflow evidence, registered
  adapter capability snapshots, selected adapter snapshots, unsupported
  contract step evidence, selected-adapter registration drift, unsupported-step
  consistency drift, or side-effect modes;
- standalone worker lease summaries and run/step timeline lease payloads are
  DB-constrained to retain the current worker lease versions, executor,
  positive attempt count, lease id, workflow/source context, run-level lease
  expiry, and known step-type context where required;
- standalone record-only completion summaries and run/step timeline payloads
  are DB-constrained to retain the current record-only version, executor,
  bounded summary, lease evidence, `sideEffectsApplied=false`, and the
  expected run or step context;
- standalone generic worker completion summaries and run/step timeline payloads
  are DB-constrained to retain the current worker-completion version,
  `agent_runtime_worker` executor, adapter workflow, side-effect mode,
  `sideEffectsApplied=false`, bounded summary, lease evidence, expected run or
  step context, and `adapterResolution.status=completed`;
- standalone worker failure summaries and run/step timeline payloads are
  DB-constrained to retain the current worker-failure version, bounded failure
  diagnostics, lease evidence, and the expected run or step context, while
  nested adapter-resolution metadata remains covered by its dedicated contract
  and rejects completed adapter-resolution evidence in failure payloads;
- standalone terminal worker outcomes now persist
  `ai_agent_runtime_execution_results` ledger rows with run/workspace/actor
  snapshot coherence, workflow/source identity, adapter workflow, executor,
  result status, side-effect mode, side-effect-applied flag, summary, failure
  diagnostics when present, result fingerprint, worker attempt, and worker
  lease id, including generic local-completion success and terminal stale-lease
  failures while requeue recoveries remain non-terminal and do not write
  ledger rows; the ledger now also
  enforces workflow/source snapshot coherence with the parent run, and parent
  run snapshot edits cannot cascade changed actor/source evidence into terminal
  execution-result rows; direct writes now also require result status, worker
  attempt, completed timestamp, failure diagnostics, and payload `completedAt`
  to match the terminal parent run snapshot for the current attempt, while
  allowing manual resume to preserve prior-attempt result history before a new
  worker attempt is leased; terminal parent run rows now reject direct
  same-terminal result/failure/completion/timeline rewrites, and terminal
  result rows now also reject direct content-evidence updates to
  adapter/executor, side-effect, summary, payload, result fingerprint, and
  worker lease fields after write;
- Agent Runtime timeline event rows now reject direct content-evidence updates
  after write, so payload, summary, status, ordinal, fingerprint, identity,
  actor, and step-link evidence cannot be rewritten after timeline consumers
  have durable history. Timeline rows now also reject direct deletion while the
  parent run exists, preserving older run/step lifecycle evidence as well as
  the current state evidence;
- Agent Runtime step and timeline rows preserve the parent run workspace/actor
  snapshot at the DB boundary, and non-null timeline step links preserve the
  referenced step's run snapshot, so direct SQL cannot move child evidence away
  from the run or retarget step-level timeline evidence to another run's step;
- Agent Runtime run rows now reject direct rewrites of run/source/workflow
  identity, title, target/evidence fingerprints, start time, and creation time
  after insert, while preserving status, queue/lease/failure/result,
  timeline-fingerprint, and update-time lifecycle changes. Agent Runtime step
  rows similarly reject direct rewrites of run/workspace/actor linkage, step
  key/title/order, evidence fingerprint, start time, and creation time while
  allowing lifecycle status, repair-sync step type, output summary, completion
  time, and update-time changes;
- Agent Runtime run inserts and lifecycle transitions now require matching
  run-level timeline history by commit time, so direct SQL cannot insert orphan
  run state or move queued/running/terminal lifecycle evidence without an
  append-only timeline event carrying the same run/workspace/actor/status and
  workflow/source payload;
- Agent Runtime step inserts and lifecycle transitions now require matching
  step-level timeline history by commit time, so direct SQL cannot insert
  orphan step state or move pending/running/terminal lifecycle evidence without
  an append-only timeline event carrying the same run/step/workspace/actor
  status and step key/type evidence;
- Agent Runtime step rows now reject direct deletion while the parent run still
  exists, preserving live run step history and preventing step-linked timeline
  evidence from being degraded to run-only history by direct child removal;
- AgentRun GraphQL list/detail responses, repair execution mutation responses
  with linked AgentRun records, common GraphQL operations, and Admin now expose
  `executionResultCount` plus recent `executionResults` so terminal standalone
  worker outcomes are visible without direct SQL access;
- GraphQL/common/Admin now expose registered standalone Agent Runtime workflow
  adapter capabilities via `agentRuntimeWorkflowAdapters`, including workflow
  id, capability version, supported step types, side-effect mode, and summary
  from the same allow-listed registry snapshot used in durable worker failure
  diagnostics;
- standalone manual-control summaries and cancel/resume timeline payloads are
  DB-constrained to retain the current manual-control version, actor, action,
  bounded reason, previous status, workflow/source context, control timestamp,
  and action/status coherence, including cooperative `cancel_requested`
  evidence for leased running runs before adapter execution;
- standalone stale-lease recovery summaries and run timeline payloads are
  DB-constrained to retain the current stale-recovery version, executor,
  reason, retry/next-status coherence, attempt counters, previous lease
  evidence, and workflow/source context;
- standalone worker-owned adapter execution, generic completion, record-only
  completion, failure, and cooperative cancellation paths require the same
  leased worker attempt as the current run row before terminal writes, so
  same-lease attempt drift cannot persist stale execution-result ledger rows,
  step output summaries, or terminal timeline evidence;
- repair-execution-linked run and step payloads are DB-constrained to retain
  the current repair runtime versions, workflow/source/request context,
  repair-job fingerprint, granted permission status, side-effect identity, and
  forward-only rollback contract evidence;
- repair-execution-linked Agent Runtime synchronization now compare-and-swaps
  the originally read linked run and repair step snapshots before updating run
  lifecycle state, step output summaries, timeline fingerprints, or timeline
  events, so stale repair sync cannot overwrite a newer runtime mirror;
- GraphQL can independently list recent workspace-scoped AgentRun records and
  read AgentRun detail by id with steps and timeline events, outside the repair
  execution mutation response;
- Admin can view recent persisted AgentRun, AgentStep, timeline state, and
  registered workflow adapter capabilities in a standalone Agent Runtime status
  card, while still showing the linked run in repair execution results;
- Agent Runtime terminal execution-result rows are full-row append-only at the
  DB boundary, so direct SQL cannot rewrite result identity, run/source
  snapshots, status/failure evidence, payload, fingerprints, worker attempt,
  completion time, or creation time after ledger persistence;
- Agent Runtime execution-result insert conflicts on `(run_id, worker_attempt)`
  now re-read the existing ledger row and validate run/source/result/payload/
  lease/completion evidence before treating duplicate terminal writes as
  idempotent;
- Agent Runtime execution-result ledger inserts now also fence the terminal
  parent run snapshot with an `INSERT ... SELECT` over run identity,
  workflow/source, target/evidence, timeline, failure/completion,
  queue/lease/attempt, and timestamp evidence, so parent run drift between a
  terminal update and result-history insert rolls the transaction back before
  stale ledger evidence persists;
- Agent Runtime run rows reject direct deletion while the owning workspace
  still exists, preserving the run root plus step, timeline, and terminal
  execution-result history; workspace deletion remains the ownership cleanup
  path;
- generic Agent Runtime run creation validates rows reused after
  source-unique insert conflicts against the computed create-time
  workflow/source/target/evidence and step evidence, while preserving the
  existing pre-read idempotent reuse behavior;
- focused backend and Admin tests cover run/step/timeline persistence,
  idempotency reuse, generic tool/Codex/MCP step persistence, independent
  read/list authorization, workspace isolation, Admin observability,
  generic local-completion execution, terminal stale-lease execution result
  persistence, cooperative running cancellation before adapter execution,
  same-lease worker-attempt drift rejection, and execution result ledger read
  exposure.

The first DB-backed registry slice is now implemented:

- `ai_prompt_registry_revisions` persists Prompt Registry revision records with
  prompt name, scope, workspace, actor, revision, status, fingerprint, fallback
  source chain, and timestamps;
- prompt catalog resolution reads the latest active DB revision, preferring a
  workspace-scoped revision over a global revision, while preserving legacy
  registry and config fallback behavior;
- GraphQL and generated common operations expose registry record source,
  revision metadata, and DB/legacy/config source-chain evidence;
- Admin can distinguish `db_revision`, `legacy_registry`, and
  `config_fallback` sources and search by revision/source-chain metadata;
- approved prompt registry repair executions can now create workspace-scoped
  DB-backed revision records that the catalog read path can resolve before
  global/config fallback;
- GraphQL can directly publish workspace-scoped Prompt Registry revisions after
  `Workspace.Copilot` permission checks, legacy registry publish-gate
  validation, stale-version checks, and route-readiness review;
- direct Prompt Registry publish records review metadata, registry/version
  evidence, route-review fingerprints, source-chain evidence, and idempotent
  matching revision reuse without copying prompt body content or bypassing the
  legacy registry prompt tables;
- focused backend and Admin tests cover workspace precedence, fallback behavior,
  deterministic source-chain evidence, and unauthorized workspace rejection.

The Task Route Policy registry slice is now implemented:

- `ai_task_route_policy_revisions` persists feature kind, scope, workspace,
  actor, revision, status, model id, config key/path, fingerprint, fallback
  source chain, metadata, and timestamps;
- task policy resolution reads the latest active workspace revision before
  global revisions and existing config/provider-default fallbacks for
  embedding, workspace indexing, and rerank routes;
- workspace embedding and rerank execution paths call the DB-aware resolver
  with workspace scope, so DB-backed route policy records affect runtime model
  selection rather than only GraphQL diagnostics;
- GraphQL/common/Admin expose Task Route Policy revision metadata, source-chain
  fingerprints, and DB/config fallback source-chain evidence;
- approved task-route repair executions can now create workspace-scoped
  DB-backed Task Route Policy revision records that the TaskPolicy runtime path
  resolves before config fallback;
- GraphQL can directly publish workspace-scoped Task Route Policy revisions for
  embedding, workspace indexing, or rerank model selection after
  `Workspace.Copilot` permission checks, with idempotent matching revision
  reuse and config/provider-default fallback source-chain evidence;
- focused backend and Admin tests cover workspace precedence, config fallback,
  source-chain evidence, direct publication, and unauthorized workspace
  rejection.

The Model Registry slice is now implemented for read plus constrained
direct/repair-driven write:

- `ai_model_registry_revisions` persists provider id, model id, scope,
  workspace, actor, revision, status, fingerprint, model definition, fallback
  source chain, metadata, and timestamps;
- provider registry construction overlays the latest active DB model
  definitions before native/provider fallback, preferring workspace revisions
  over global revisions;
- GraphQL/common/Admin model diagnostics expose DB revision metadata,
  model-definition source, and source-chain evidence for model candidates;
- approved default-model route repair executions can now create
  workspace-scoped DB-backed Model Registry revision records that the publish
  gate and model routing diagnostics resolve before config/native fallback;
- GraphQL can directly publish a workspace-scoped Model Registry definition
  revision for an existing configured provider after `Workspace.Copilot`
  permission checks, while reusing the existing provider runtime and avoiding
  provider secret/runtime creation;
- the direct publish path sanitizes model definitions to routeable model
  metadata/capabilities, forces the persisted definition id to the requested
  model id, drops arbitrary config fields, and reuses matching revisions
  idempotently only when the sanitized fingerprint matches;
- focused backend tests cover workspace precedence, global fallback,
  repair-driven publication, direct publication, metadata sanitization, and
  route resolution from the published revision.

The Provider Registry read overlay slice is now implemented:

- `ai_provider_registry_revisions` persists provider id, provider type, scope,
  workspace, actor, revision, status, fingerprint, provider profile metadata,
  fallback source chain, metadata, and timestamps;
- quota-backed provider registry construction overlays the latest active DB
  provider profile revision before applying DB-backed model definition
  revisions, preferring workspace revisions over global revisions;
- DB-backed provider profile revisions are intentionally constrained to
  existing provider runtimes and reuse the configured provider credentials,
  so this slice does not introduce arbitrary provider secret management;
- existing model and route diagnostics can surface `providerProfileSource` and
  `providerProfileConfigPath` as `db_revision` /
  `ai_provider_registry_revisions[...]`;
- focused backend coverage verifies workspace precedence, global fallback,
  route/model metadata from the DB-backed provider profile, and unauthorized
  workspace rejection.

The constrained Provider Registry publish API slice is now implemented:

- GraphQL can publish a workspace-scoped Provider Registry profile metadata
  revision for an existing configured provider after `Workspace.Copilot`
  permission checks;
- the publish path validates that the target provider id exists in the current
  configured registry and reuses that provider runtime/type instead of creating
  arbitrary provider runtimes;
- the model write path sanitizes provider profile metadata before persistence,
  stores `config: {}`, drops unexpected model-definition fields, and treats
  DB revisions as metadata overlays rather than credential/secret records;
- repeated publishes for the same workspace/provider/revision are idempotent
  only when the sanitized fingerprint matches, preventing silent overwrite of
  a different revision payload;
- focused backend coverage verifies mutation publication, DB sanitization,
  idempotent reuse, unknown-provider rejection, workspace authorization, and
  model routing from the published DB-backed provider profile.
- Provider Health state rows now require matching durable event history for
  route-affecting overlay inserts and updates at commit time, so direct SQL
  cannot create or rewrite status, source, checked timestamp, last-error,
  fingerprint, metadata, or actor/provider snapshot evidence without an
  append-only health event.

The Provider Registry repair executor slice is now implemented:

- approved provider registry repair executions can carry a persisted
  `provider_registry_revision_publish` executor payload into the queued repair
  execution worker;
- the worker validates the payload and creates a workspace-scoped
  `ai_provider_registry_revisions` row with actor, provider id/type, revision,
  sanitized provider profile metadata, fallback source chain, and repair
  execution metadata;
- persisted provider profile metadata still stores `config: {}` and reuses the
  existing configured provider runtime/credentials, so the executor does not
  introduce arbitrary provider secret writes;
- runtime result and audit metadata record side-effect kind
  `provider_registry_revision`, side-effect record id, fingerprint, and
  sanitized summary;
- the provider registry overlay immediately resolves the published workspace
  provider profile before global/config fallback;
- focused backend coverage verifies approval queueing, worker publication,
  persisted metadata sanitization, and model diagnostics resolution from the
  published DB-backed provider profile.

The DB-backed registry row-constraint slice is now implemented:

- Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
  revision tables reject malformed row scope/status, scope/workspace pairs,
  JSON shapes, identity strings, revision strings, fingerprints, timestamp
  ordering, and fallback source-chain provenance vocabulary at the database
  boundary;
- the latest provenance constraint keeps `fallback_source_chain` entries
  aligned with the current model-layer sanitizer by rejecting unknown
  `source`, `scope`, or `status` values before registry overlays, diagnostics,
  or Admin read paths can observe direct/manual malformed rows;
- the latest optional metadata constraint rejects malformed source-chain
  metadata fields such as non-string fingerprints/model/provider ids, invalid
  Prompt Registry `registryId`, invalid Task Route Policy feature/config keys,
  and invalid Provider Registry provider types before direct/manual rows can
  bypass model-layer sanitization;
- current-version registry revision metadata must pair direct-publish versions
  with `publishSource=graphql_mutation` and repair-executor versions with
  `publishSource=repair_execution_worker`, while older object-shaped metadata
  versions remain compatible;
- current-version repair-executor registry metadata must retain repair request,
  approval, operation, target locator, and candidate evidence fields before
  direct/manual rows can weaken repair provenance consumed by diagnostics or
  audit review;
- direct and repair-driven publish paths for Prompt Registry, Task Route
  Policy, Model Registry, and Provider Registry now append
  `ai_registry_revision_publish_events` rows for both `revision_published` and
  idempotent `revision_reused` outcomes, with DB constraints tying event
  metadata and revision snapshots back to the parent revision rows, rejecting
  parent workspace revision snapshot edits, requiring workspace publish events
  to keep actor evidence so nullable actor columns cannot bypass workspace
  snapshot checks, and including global publish events whose nullable
  workspace/actor columns would otherwise bypass workspace-scoped composite
  snapshot checks, plus actor-present global events whose actor evidence now
  stays bound to the parent revision actor snapshot, and append-only event-row
  restrictions that reject coherent post-write event evidence rewrites while
  still permitting true no-op updates; publish/reuse event rows now also reject
  direct deletion while their parent registry revision exists, and registry
  revision rows reject direct deletion while their owning workspace still
  exists, with global revision deletion always rejected because it has no
  workspace ownership cascade path;
- model-owned registry publish/reuse event inserts now CAS against the full
  parent revision snapshot from the publisher's hydrated row, including
  family-specific content evidence, fallback source-chain, metadata, and
  `updated_at`, so stale Prompt Registry, Task Route Policy, Model Registry,
  or Provider Registry reuse/publication reads fail before appending new
  publish history;
- registry publish-event insert conflicts now re-read the existing event by
  fingerprint and validate family, revision, provider/model identity,
  workspace/actor, revision status/fingerprint, event type/source, and metadata
  fingerprint before treating the event as idempotent;
- registry `revision_published` event rows now carry the same
  application-owned timestamp as the parent revision creation, keeping
  publish-history-required checks and newest-first diagnostics independent of
  database default transaction-time ordering;
- Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
  revision inserts now use `RETURNING id` to classify unique-key race losers as
  `revision_reused` instead of misreporting a second `revision_published`
  event;
- registry revisions now reject direct content-evidence updates immediately
  after insert, so Prompt metadata/source chains, Task Route Policy route
  content, Model Registry definitions, Provider Registry profiles, and shared
  source-chain/metadata evidence cannot drift before or after publish/reuse
  event history exists;
- active workspace registry revisions with current direct-publish metadata, and
  real repair-worker revisions using the model-owned
  `repair-${executionRequestId}` contract, now require matching durable
  `revision_published` history by commit time; idempotent `revision_reused`
  events also require an existing publish anchor, and deleting that anchor is
  rejected while parent/reuse evidence remains; deleting either
  `revision_published` or `revision_reused` event rows is rejected while the
  parent revision still exists;
- existing registry revision GraphQL response types and direct publish model
  returns now expose `publishEventCount` plus recent publish/reuse events so
  operators can inspect current revision history without direct SQL access;
- prompt catalog DB-backed revision reads now expose
  `registryRevisionPublishEventCount` and recent
  `registryRevisionPublishEvents`, and Admin renders publish/reuse history on
  the normal prompt catalog diagnostics panel;
- model/task-route diagnostics now expose bounded Model Registry and Task Route
  Policy publish/reuse event history through `getPromptModels` and Admin,
  while keeping publish-event history out of source fingerprint inputs;
- focused backend coverage verifies direct writes fail for the new provenance
  and optional metadata constraints across all four DB-backed registry
  families, plus current-version source/version drift, repair metadata evidence
  drift, publish-event content/fingerprint drift, and missing/reuse-only
  publish-history drift.

The Provider Health State persistence slice is now implemented:

- `ai_provider_health_states` persists workspace-scoped provider health state
  for existing configured providers, including actor, status, checked time,
  last error, source, fingerprint, and metadata;
- GraphQL can record a provider health state after the same `Workspace.Copilot`
  permission check and configured-provider validation used by Provider Registry
  direct publish;
- effective provider registry construction overlays DB-backed health state
  after provider profile revisions and before model definition revisions, so
  existing route selection and diagnostics consume durable health state instead
  of only static config metadata;
- Provider Health metadata now preserves reserved writer fields at the model
  boundary and is DB-constrained to retain the expected metadata version plus
  source-specific publish-source vocabulary;
- Provider Health cleanup metadata is also DB-constrained for configured
  snapshot profile evidence, stale configured-snapshot cleanup provenance, and
  stale probe-result cleanup freshness evidence;
- Provider Health writes now append durable event-history rows for manual
  overrides, workspace probe results, configured snapshots, configured snapshot
  cleanup, and stale probe cleanup, with DB constraints on event/source/
  publish-source coherence, metadata shape, non-orphan state-id integrity,
  state identity/workspace snapshot coherence, and write-time state
  fingerprint plus actor snapshot coherence for newly written event rows;
- Provider Health event rows reject direct content-evidence rewrites after
  persistence, so state linkage, provider/scope/workspace/actor evidence,
  status, timestamps, source/event type, fingerprints, metadata, and
  creation-time history remain append-only while true no-op updates stay
  compatible;
- Provider Health workspace and global configured-snapshot writers now use
  atomic `INSERT ... ON CONFLICT DO UPDATE RETURNING` upserts, so an insert
  race after a missed pre-read overwrites the row with the current
  route-affecting health evidence and appends matching event history instead
  of returning stale state;
- `ai_provider_health_probe_attempts` now persists automatic workspace
  Provider Health probe attempts for active workspace Provider Registry
  revisions. Attempts bind revision id/fingerprint, sanitized provider-profile
  snapshot evidence, request fingerprint, worker lease/attempt state, terminal
  result metadata, and the resulting Provider Health state fingerprint;
- Provider Registry direct and repair-driven publish paths now enqueue the
  same durable no-network Provider Health probe attempt immediately when a
  workspace provider revision is published or idempotently reused, and the
  publish mutation response exposes the queued attempt evidence;
- Prompt Registry, Task Route Policy, Model Registry, and Provider Registry
  direct and repair-driven publish paths now validate revision row conflicts
  against expected row id, family identity, workspace/actor scope,
  revision/status/fingerprint, fallback source chain, publish metadata, and
  family-specific persisted content evidence before recording publish history,
  route/model/profile overlays, or Provider Health probes;
- Provider Health probe enqueue now validates rows reused through
  request-fingerprint conflicts against the computed revision/profile/request
  evidence, so a drifted conflicting row cannot be silently returned as the
  durable attempt;
- Provider Health probe enqueue now writes through a parent Provider Registry
  revision `INSERT ... SELECT` fence that compares revision identity,
  workspace/actor scope, fingerprint, raw provider profile, raw fallback
  source-chain, metadata, creation time, and update time before any queued
  attempt evidence is inserted, so stale provider revision snapshots fail
  closed instead of producing probe work from outdated registry evidence;
- Provider Health event insertion now validates deterministic event-id
  conflicts against the current state/event evidence, including provider
  identity, workspace/actor snapshot, timestamps, source/type, state/event
  fingerprints, last-error text, and metadata fingerprint, before treating the
  event write as idempotent;
- `copilot.providerHealth.enqueueWorkspaceProbeAttempts` and
  `copilot.providerHealth.processProbeAttempts` provide the first durable
  automatic probe worker path. The current probe is explicitly no-network: it
  checks that the DB revision still resolves to a configured provider runtime
  and text-capable model contract, then publishes healthy/degraded/down through
  existing workspace `probe_result` state/event history;
- Provider Health probe completion/failure now locks and revalidates the
  current non-expired worker lease before writing route-affecting health state
  or retry/dead-letter evidence, so stale workers whose leases were re-acquired
  cannot publish outdated probe results;
- Provider Health probe completion/failure now also requires the same attempt
  counter snapshot before terminal or retry writes, so stale in-memory workers
  cannot publish health state or failure evidence after attempt metadata drifts
  under the same lease id;
- Provider Health probe completion/failure terminal updates now compare the
  full locked attempt row snapshot, including provider-profile evidence,
  request/result/failure fields, lease timestamps, health-state linkage, and
  update time, so same-lease row drift fails before route-affecting mutation;
- repair execution workers now re-lock the request row and confirm the same
  current non-expired worker lease immediately before applying constrained
  registry side effects, so stale workers whose leases were recovered cannot
  publish registry revisions or write side-effect evidence;
- repair execution worker failure persistence now also requires the same
  worker attempt snapshot as the leased worker read, so stale failure/retry
  handling cannot write terminal or retry audit evidence onto a newer attempt
  under the same lease id;
- repair execution worker terminal completion/failure updates now compare the
  originally read running request snapshot, including runtime result, executor
  payload, queue/lease/attempt, failure, completion, creation, and update-time
  evidence, before writing terminal audit or side-effect ledger rows;
- repair execution side-effect ledger writes now independently compare the
  completed parent request snapshot written by the worker path before inserting
  side-effect history, so request drift after the completion update but before
  ledger insertion fails closed and rolls back the terminal transaction;
- repair execution side-effect preflight, completion, and cooperative
  cancellation now require the same worker attempt snapshot as the leased
  worker read, so stale same-lease attempt drift cannot consume cancellation
  or write side-effect ledger/completed audit evidence onto a newer attempt;
- repair execution worker-owned cooperative cancellation terminal writes now
  also compare the full originally read running request snapshot before
  clearing the lease or appending cancelled audit evidence, so same-lease
  request drift fails closed before stale worker consumption persists;
- repair execution running `cancel_requested` audit writes now compare the full
  originally read running request snapshot before appending cooperative
  cancellation history, so same-lease request drift fails closed before stale
  operator evidence is persisted;
- repair execution waiting/queued/failed manual cancellation now compares the
  originally read request identity, approval, runtime, executor-payload,
  failure, queue/lease/attempt, completion, creation, and update-time evidence
  before terminalizing, so stale cancellable-row evidence cannot produce
  misleading cancellation audit history;
- repair execution manual retry and corrected-payload resume now compare the
  originally read failed request snapshot against persisted approval, runtime,
  executor-payload, failure, queue/lease/attempt, completion, and update-time
  evidence before requeueing, so stale failed-row evidence cannot produce
  misleading manual-control or queued audit history;
- repair execution stale-lease recovery now compares the originally read
  expired running request snapshot against persisted identity, runtime,
  executor-payload, failure, queue/lease/attempt, completion, creation, and
  update-time evidence before recovering, so stale running-row evidence cannot
  write recovered queued/failed audit history;
- repair-execution-linked Agent Runtime sync now also compares the linked run
  and repair step snapshots it read before writing mirror state, so stale
  runtime synchronization cannot append timeline evidence or output summaries
  derived from an outdated repair execution projection;
- standalone Agent Runtime workers now re-lock the run row and confirm the
  same current non-expired worker lease before workflow adapter resolution or
  execution, so stale workers whose leases were recovered cannot invoke
  registered adapters or write unsupported-adapter failure evidence;
- standalone Agent Runtime worker-owned adapter execution, generic completion,
  record-only completion, failure, and cooperative cancellation paths now also
  require the same worker attempt snapshot as the leased worker read, so stale
  same-lease attempt drift cannot write terminal execution results, step
  summaries, or timeline evidence onto a newer attempt;
- standalone Agent Runtime worker-owned failure, record-only completion, and
  generic completion terminal run updates now compare the full originally read
  running run snapshot, including workflow/source identity, target/evidence,
  timeline fingerprint, failure, queue/lease/attempt, completion, creation,
  and update-time evidence, before writing execution-result ledger, step, or
  timeline history;
- standalone Agent Runtime execution-result ledger writes now independently
  compare the terminal parent run snapshot written by the worker path before
  inserting result history, so terminal run drift after the run update but
  before ledger insertion fails closed and rolls back the terminal transaction;
- standalone Agent Runtime worker-owned failure, record-only completion, and
  generic completion terminal step updates now compare each active step's
  originally read identity, status, output summary, evidence, order, and
  timestamp snapshot before writing terminal step summaries or timeline
  evidence;
- standalone Agent Runtime lease acquisition now also compares the hydrated
  run and active-step snapshots before writing lease timeline fingerprints,
  step `workerLease` summaries, or lease timeline rows, so stale hydration
  rolls the entire lease transaction back;
- standalone Agent Runtime stale-lease recovery now compares the hydrated
  expired run and active-step snapshots before clearing leases, updating step
  summaries, writing execution-result ledger rows, or appending run/step stale
  recovery timeline events;
- standalone Agent Runtime manual cancel/resume now compare the full
  originally read run snapshot, including workflow/source identity,
  target/evidence, timeline fingerprint, failure, queue/lease/attempt,
  completion, creation, and update-time evidence, before writing control
  timeline or step evidence;
- standalone Agent Runtime running `cancel_requested` writes now also compare
  the full originally read running run snapshot before mutating the timeline
  fingerprint or appending cooperative cancellation history, so same-lease
  run drift fails closed before stale operator evidence is persisted;
- standalone Agent Runtime manual cancel/resume child step updates now compare
  each originally read step's identity, status, output summary, evidence,
  order, and timestamp snapshot before writing manual-control summaries;
- standalone Agent Runtime workers now also consume matching cooperative
  cancellation requests after an adapter returns without terminal state and
  before incomplete-adapter failure persistence, so post-start adapter yield
  cancellations become terminal `cancelled` evidence instead of false worker
  failures;
- Provider Health mutation responses now expose `eventCount` and recent
  event-history rows so manual health transitions can be inspected without
  direct SQL access;
- Provider Health probe attempts now have a workspace-scoped GraphQL/Admin
  read path for recent `ai_provider_health_probe_attempts` rows, including
  revision/profile/request/result/state fingerprints, sanitized profile
  snapshot evidence, actor, attempt counters, terminal timestamps, failure
  diagnostics, and worker lease evidence;
- Provider Health dead-lettered probe attempts can now be retried through
  GraphQL/Admin by creating a fresh queued attempt for the same active
  Provider Registry revision/fingerprint, while the original terminal
  dead-letter evidence remains immutable;
- focused backend coverage verifies DB persistence, workspace authorization,
  route exclusion when health is `down`, and restoration when health returns to
  `healthy`.

The latest DB-history hardening slices are now implemented:

- repair execution side-effect ledger rows reject direct deletion while the
  completed parent request still requires them, repair audit events reject
  direct deletion while the parent request still exists, and repair request
  rows reject direct deletion while the owning workspace still exists;
- Agent Runtime run/step timeline rows reject direct deletion while the parent
  run still exists, and terminal execution-result ledger rows reject direct
  deletion while the parent run still exists; Agent Runtime step rows reject
  direct deletion while the parent run still exists, and Agent Runtime run rows
  reject direct deletion while the owning workspace still exists;
- DB-backed registry publish/reuse event rows reject direct deletion while the
  parent revision still exists, and Prompt, Task Route Policy, Model, and
  Provider Registry revision rows reject direct deletion while their owning
  workspace still exists;
- support bundle audit events reject direct deletion while the parent bundle
  still exists, download authorization rows reject direct deletion while the
  parent bundle still exists, support bundle request rows reject direct
  deletion while the owning workspace still exists, and support bundle
  transfer events reject direct deletion while the parent download
  authorization still exists;
- Provider Health event rows reject direct deletion while the parent health
  state still exists, and Provider Health state rows reject direct deletion
  while their owning workspace exists; global Provider Health state deletion is
  rejected outright because there is no workspace cascade owner;
- all of these delete restrictions preserve ownership cleanup where applicable,
  with Agent Runtime roots, repair execution roots, support bundle roots,
  workspace-scoped registry revisions, and Provider Health state cleanup
  preserved through workspace deletion, and disposable Postgres smoke verifies
  direct-delete rejection plus cascade compatibility.

## Not Completed

The completed diagnostics do not yet provide the intended durable architecture.

Still missing:

- mutating repair executors beyond the constrained Prompt Registry, Task Route
  Policy, Model Registry, and Provider Registry workspace revision publishers;
- rollback behavior written by a real runtime;
- rollback contract execution is still not implemented; the current runtime
  only enforces the forward-only recovery contract and executor-payload /
  side-effect-kind mapping on applied constrained registry side effects, the
  durable side-effect ledger and its parent result snapshot, the current
  worker/control repair audit metadata contracts, and the current non-expired
  repair worker lease before applying constrained registry side effects;
- broader Agent Runtime planner/tool/Codex/MCP execution adapters beyond
  persisted generic step records and the repair execution workflow;
- provider-specific object-storage signature adapters, alerting, and rollout
  wiring beyond the generic HMAC webhook ingress before every deployment can
  forward `verified_by_upstream` evidence into the durable forwarding queue;
- automatic retry/escalation for failed archive object cleanup audit events is
  durable, and retention audit metadata is DB-constrained for cleanup
  identity/status evidence, but external operational alerting/escalation
  rollout remains separate deployment work;
- true preemptive live running task interruption while a production executor is
  still doing external work, plus broader non-registry operator-provided
  manual resume controls beyond the current corrected-payload workflow;
- full Provider Registry editor workflows, bulk migration, credential
  management, external network/credential health probes, and probe-attempt
  search/alert workflows beyond the current no-network local Provider Health
  probe ledger/read/retry surface;
- Prompt Registry prompt-body edit APIs, bulk migration UI, diff/eval, and
  full audit/history views beyond the current read/direct publish/repair-driven
  revision paths;
- full Model Registry editor workflows, model diff/review UX, and bulk
  migration UI beyond the current constrained direct/repair-driven publish
  paths.
- full Task Route Policy editor workflows and bulk migration UI beyond the
  current constrained direct/repair-driven publish paths.

## Risk In Current Plan

The old main plan is useful as an audit log but too large for reliable execution.
Future tasks can accidentally continue the read-only placeholder chain instead
of building the actual runtime and persistence layer.

The active direction is now in this directory.
