# Track: Support Bundle Persistence

## Intent

Replace read-only support bundle placeholder metadata with a real persisted
support bundle artifact flow.

## Current Problem

Admin and resolver outputs still expose many historical support-bundle
source-evidence fields as runtime read-only projections.

The first durable slice now creates DB records and create/read audit events.
Later support bundle slices now also create:

- a packaged archive JSON storage object;
- authorized archive bytes through the API artifact endpoint;
- scheduled cleanup worker execution.
- object-storage signed URL delivery metadata for archive downloads when the
  configured storage provider supports signed `get` redirects.
- client acknowledgement telemetry that marks direct object-storage download
  authorizations as downloaded without claiming server-verified byte transfer.
- server-side direct download transfer event ingestion that marks
  direct-delivery authorizations as downloaded only after validating persisted
  storage key, byte size, and artifact fingerprint evidence.
- an authenticated internal HTTP endpoint that lets server-side object-storage
  event consumers feed direct download transfer evidence into that verifier
  without exposing download URLs or tokens.
- durable transfer notification auth evidence showing the internal
  method/path-bound access token policy and optional upstream provider
  signature verification summary after storage verification succeeds.
- accountable upstream provider signature evidence for S3/R2-compatible
  object-created wrappers, requiring verifier, policy, and signature
  fingerprint before forwarded evidence can be persisted.
- replay validation for already-downloaded direct transfer events, so
  idempotent replays must still match persisted artifact evidence and
  mismatched replay payloads fail before duplicate audit rows are written.
- DB-backed delivery-shape constraints for download authorizations, so API
  proxy rows cannot carry direct object-storage URL fields and signed-URL rows
  must carry both direct URL and expiry evidence.
- retention-time archive object cleanup with audit metadata for deleted or
  failed storage cleanup attempts.
- retryable archive object cleanup for expired bundles whose latest cleanup
  audit event still shows a failed storage deletion.
- persisted manifest JSON storage metadata and signed URL delivery for stored
  manifest artifacts when the blob provider supports signed `get` redirects.

The download authorization slice now creates a short-lived DB-backed
authorization and downloadable minimal manifest or packaged archive artifact.
Manifest and archive download authorizations now prefer object-storage signed
URL delivery when the storage provider can issue a signed redirect for the
persisted object; otherwise they fall back to the API proxy.

The retention cleanup slice now performs DB-backed expiration for due bundles,
expires outstanding manifest download authorizations, and writes cleanup audit
events. It is exposed as a workspace-scoped GraphQL/Admin operation and is also
available through scheduled worker execution.

The archive artifact slice now writes a packaged archive JSON payload to the
configured blob storage provider and persists archive storage metadata on the
support bundle request. It supports authorized `archive_json` downloads through
the API artifact endpoint and through direct object-storage signed URLs when
available.

The direct download acknowledgement slices now let an authenticated workspace
client report that a direct object-storage archive or manifest authorization was
consumed. The server persists the existing authorization row as `downloaded`,
records `downloadedAt`, and writes a `downloaded` audit event with
`clientAcknowledged=true`.

The transfer event ingestion slices add an internal server-side path for object
storage completion events. The model verifier only accepts direct-delivery
authorizations, rejects stale or impossible transfer timestamps, revalidates
the bundle state, checks event-provided storage key / byte size / artifact
fingerprint evidence when present, reads the persisted JSON object, and
verifies the stored artifact fingerprint before writing `downloaded` with
`serverVerified=true`. The controller exposes that path as an `@Internal()`
POST to `/api/copilot/support-bundles/download-transfer-events`, guarded by the
existing method/path-bound `x-access-token` convention, and returns only a
sanitized authorization state snapshot. The endpoint also bounds persisted
event strings and requires event artifact fingerprints to match the current
16-hex-character support-bundle fingerprint shape before model verification.
It can also translate S3/R2-compatible object-created notifications into the
same canonical verifier payload, extracting object key, byte size, event source,
request/sequencer id, and transfer time before the storage verifier marks the
authorization downloaded. Downloaded audit metadata now also persists bounded
`notificationAuthEvidence` and a deterministic
`notificationAuthEvidenceFingerprint`; canonical and S3/R2-compatible payloads
record the internal `x-access-token` policy, and S3/R2-compatible payloads can
carry bounded upstream signature-verification evidence from a trusted
notification worker. Provider-origin S3/R2 wrappers must include that upstream
evidence with a verifier identity, verification policy, and signature
fingerprint before the controller/model path can persist the transfer audit
row.
Already-downloaded transfer event replays are idempotent only after supplied
storage key, byte size, and artifact fingerprint evidence is checked against
the persisted authorization and bundle artifact metadata. When the retained
artifact is still active, replay validation also reuses the storage verifier;
valid replays return the downloaded authorization snapshot without writing a
second `downloaded` audit event.

The archive cleanup slice now attempts to delete the stored archive object after
a support bundle row is successfully expired. Retention still completes when
storage deletion fails, and the `retention_expired` audit event records the
cleanup status and error metadata.

The archive cleanup retry slice now reuses the retention cleanup operation and
scheduled worker to find expired bundles whose latest cleanup audit event still
has `archiveObjectCleanupStatus=failed`. It retries deletion, writes a new
`retention_expired` audit event with `archiveObjectCleanupRetry=true`, and
returns retry/recovered/failed counts to GraphQL/Admin callers.

The archive cleanup escalation slice now gives the scheduled worker a durable
stop condition for persistent storage delete failures. After repeated scheduled
failures, the latest `retention_expired` audit event records escalation
metadata and future scheduled cleanup scans skip that bundle until a manual
workspace cleanup retries it.

The download authorization cleanup slice now expires short-lived support bundle
download authorizations independently from bundle retention cleanup, so unused
15-minute authorizations do not remain durably `authorized` until someone
tries to consume them or the whole bundle expires.

The manifest artifact storage slice now writes the generated manifest JSON to
blob storage during support bundle creation, while keeping `manifest_json` on
the request row as compatibility/index data. API-proxy manifest delivery
validates stored JSON against the persisted manifest fingerprint, and retention
cleanup rewrites the stored manifest when the DB manifest retention state
changes. Rewrite failures are audit-visible and do not roll back DB expiration.

The manifest rewrite retry slice now reuses the same retention cleanup entry
points to retry expired bundles whose latest manifest object rewrite audit
status is still failed. It records retry/recovered/failed counts through
GraphQL/Admin and writes retry audit metadata with prior error evidence.

The manifest rewrite escalation slice now gives scheduled cleanup a durable
stop condition for persistent manifest object rewrite failures. Repeated
scheduled failures are marked escalated in audit metadata and skipped by later
scheduled scans, while manual workspace cleanup can still retry after storage
is fixed.

The audit metadata boundary slice now normalizes storage-provider error codes
and messages before they enter retention audit rows, and size-checks every
support-bundle audit metadata JSON payload before fingerprinting or insertion.
This keeps manifest rewrite and archive cleanup failures auditable without
persisting unbounded provider exception strings.

The retention audit metadata constraint slice now adds DB enforcement for
`retention_expired` audit rows. Those rows must retain cleanup actor,
fingerprint, scope, timestamp, expired authorization count, expired retention
status, and known archive cleanup / manifest rewrite status vocabulary before
scheduled retry or escalation scans can consume them.

The retention retry audit metadata contract slice now tightens the executable
retry and escalation metadata emitted by archive cleanup and manifest rewrite
retries. Model writes validate the current retry/escalation metadata before
persisting audit rows, and the database rejects direct `retention_expired`
rows that drop previous cleanup fingerprints, retry failure counts, storage
keys, bounded error evidence, or scheduled escalation reason/timestamp
coherence.

## First Vertical Slice

Status: implemented.

The smallest durable support bundle path now:

1. Create a persisted support bundle request/artifact model.
2. Store workspace ID, actor ID, status, source evidence summary, manifest
   fingerprint, creation time, and retention status.
3. Generate a minimal JSON manifest payload.
4. Expose create/read operations through GraphQL or an internal API.
5. Add authorization checks.
6. Add Admin visibility for created bundle metadata.

The first slice stores the minimal manifest in the DB. The migration path to
object storage is to keep the existing request row as the request/audit index,
add storage key, byte size, archive fingerprint, and signed download metadata,
then move large manifest/archive bytes out of `manifestJson`.

## Download Authorization Slice

Status: implemented.

The second support bundle slice adds an authorized downloadable minimal
manifest artifact without introducing object storage yet.

Implemented behavior:

1. Persist a download authorization row for a support bundle.
2. Store workspace, actor, bundle id, status, artifact kind, filename, mime
   type, manifest fingerprint, authorization fingerprint, token fingerprint,
   expiration, and downloaded time.
3. Require workspace permission before issuing a download authorization.
4. Return a short-lived manifest download URL from GraphQL.
5. Validate and consume the token through an HTTP endpoint.
6. Return the minimal manifest JSON as a downloadable attachment.
7. Record `download_authorized` and `downloaded` audit events.
8. Surface manifest download controls and authorization state in Admin.

## Retention Cleanup Slice

Status: implemented.

The third support bundle slice adds executable retention cleanup without
introducing object storage yet.

Implemented behavior:

1. Require workspace permission before cleanup.
2. Find due active bundles whose `expiresAt` has elapsed.
3. Set support bundle status and retention status to `expired`.
4. Update the persisted minimal manifest retention status and recalculate the
   manifest fingerprint.
5. Mark outstanding authorized download authorizations as `expired`.
6. Record per-authorization expiration audit metadata for authorizations closed
   by retention cleanup.
7. Record a `retention_expired` audit event with cleanup and manifest
   fingerprints.
8. Return cleanup counts and expired bundle records through GraphQL.
9. Surface a cleanup control and latest cleanup summary in Admin.

## Archive Artifact Slice

Status: implemented.

The fourth support bundle slice adds minimal archive bytes while keeping the
request row as the durable index.

Implemented behavior:

1. Write a minimal `localmind-support-bundle-archive/v1` JSON payload to the
   configured blob storage provider during support bundle creation.
2. Persist archive storage key, byte size, fingerprint, MIME type, and filename
   on `ai_support_bundle_requests`.
3. Include archive metadata in the stored manifest.
4. Record an `archive_created` audit event.
5. If DB persistence or creation audit history fails after manifest/archive
   bytes have been written, best-effort cleanup deletes those just-written
   storage objects before rethrowing so create failures do not leave orphan
   support-bundle artifacts.
6. Allow download authorization for `archive_json` with a persisted artifact
   fingerprint.
7. Serve the authorized archive artifact through
   `/api/copilot/support-bundles/:authorizationId/artifact`.
8. Validate the stored archive fingerprint before consuming authorization and
   returning bytes.
9. Surface archive metadata and download controls in Admin.

## Scheduled Retention Cleanup Slice

Status: implemented.

The fifth support bundle slice wires retention cleanup into the existing Copilot
cron and queue worker path.

Implemented behavior:

1. Daily Copilot cron enqueues `copilot.supportBundle.cleanupRetention` with a
   fixed job id.
2. The job handler calls system-scoped support bundle cleanup across workspaces.
3. Cleanup uses the existing DB-backed request, authorization, and audit rows.
4. Due bundles are expired in bounded batches.
5. Outstanding authorized downloads are marked `expired` and get the same
   per-authorization expiration audit evidence as manual retention cleanup.
6. `retention_expired` audit events include `cleanupScope=scheduled_worker` and
   `cleanupActorId=system_retention_worker`.
7. The handler returns `Repeat` when it expires a full batch and `Done` when no
   further immediate batch is required.

## Packaged Archive Contents Slice

Status: implemented.

The sixth support bundle slice expands the archive bytes from a minimal outer
summary into packaged support bundle contents.

Implemented behavior:

1. Support bundle creation now packages a deterministic
   `localmind-support-bundle-archive/v1` JSON artifact.
2. The archive includes a file index plus embedded `manifest.json`,
   `source-evidence-summary.json`, `prompt-catalog-summary.json`,
   `actor-action-runs.json`, and `task-route-summary.json` content.
3. Each embedded JSON file records path, media type, byte size, and
   fingerprint.
4. The archive records a deterministic archive index fingerprint derived from
   the file entries.
5. Prompt catalog content is captured from the workspace-scoped catalog read
   path.
6. Action run content is scoped to the support bundle workspace and actor.
7. Task route content stores sanitized route policy/model/provider/fingerprint
   summaries instead of the full diagnostics object.
8. Existing archive storage metadata, download authorization, API artifact
   serving, and audit behavior remain unchanged and now cover the packaged
   archive bytes.

## Object-storage Signed URL Slice

Status: implemented.

The seventh support bundle slice adds direct delivery for stored archive
artifacts while preserving the API proxy fallback.

Implemented behavior:

1. Add download authorization fields for delivery method, direct download URL,
   and direct download expiration metadata.
2. Attempt direct signed URL delivery only for `archive_json` artifacts with a
   persisted storage key, fingerprint, and byte size.
3. Ask the configured storage provider for a signed `get` redirect and require
   returned object metadata whose content length matches the persisted archive
   byte size.
4. Persist `object_storage_signed_url` when a direct URL is available, or
   `api_proxy` when the provider cannot issue one.
5. Keep GraphQL `downloadUrl` backward compatible by returning the direct URL
   when present and the API artifact endpoint otherwise.
6. Reject API proxy token consumption for direct-delivery authorizations so the
   same authorization is not consumed through the wrong delivery path.
7. Record `download_authorized` audit metadata with delivery method, direct URL
   presence, artifact fingerprint, and expiration evidence.
8. Surface delivery method and direct URL expiration in Admin.

## Direct Download Acknowledgement Slice

Status: implemented.

The eighth support bundle slice adds durable completion telemetry for direct
object-storage downloads that leave the API proxy path.

Implemented behavior:

1. Add `acknowledgeCopilotSupportBundleDirectDownload` behind the existing
   workspace Copilot permission check.
2. Accept only active `object_storage_signed_url` authorizations in the same
   workspace.
3. Reject API-proxy authorizations, stale/expired authorizations, missing
   direct URLs, and already-final rows.
4. Revalidate that the support bundle is still ready, active, unexpired, and
   still matches the manifest fingerprint stored on the authorization. Archive
   acknowledgements additionally require the archive fingerprint to match;
   manifest acknowledgements require the artifact fingerprint to match the
   manifest fingerprint.
5. Persist the authorization transition to `downloaded` only through a
   conditional update that matches the originally read authorization evidence
   and parent bundle state, then set `downloaded_at`.
6. Write a `downloaded` audit event with delivery method, artifact evidence,
   direct URL expiration, `authorizationActorId`, and
   `clientAcknowledged=true`.
7. Return the same authorization response shape as download authorization, with
   `downloadUrl` pointing at the stored direct object-storage URL.
8. Keep the semantics explicit: this is client acknowledgement telemetry, not
   server proof that the object store transferred bytes.
9. API-proxy downloads are still rejected by the direct acknowledgement path,
   so direct acknowledgement remains explicit client telemetry for
   object-storage signed URL delivery only.

## Archive Object Retention Cleanup Slice

Status: implemented.

The ninth support bundle slice closes the persisted archive object lifecycle
when retention expiry runs.

Implemented behavior:

1. After a support bundle row transitions to expired, attempt to delete its
   `archiveStorageKey` from the configured blob storage provider.
2. Record `archiveObjectCleanupStatus=deleted` and `archiveStorageKey` in the
   existing `retention_expired` audit event when deletion succeeds.
3. Record `archiveObjectCleanupStatus=failed`, error code, and error message if
   the storage provider rejects deletion.
4. Keep DB retention expiry durable even when object deletion fails, so failed
   storage cleanup is observable and retryable operationally rather than
   rolling back the bundle state.
5. Preserve missing-key semantics with `archiveObjectCleanupStatus=missing` for
   legacy/minimal rows that do not have an archive storage object.

## Archive Object Cleanup Retry Slice

Status: implemented.

The tenth support bundle slice closes the failed-cleanup dead end without
adding another diagnostic-only projection.

Implemented behavior:

1. Reuse manual and scheduled retention cleanup as the executable retry entry.
2. After due active bundles consume the current batch limit, find expired
   bundles whose latest `retention_expired` audit metadata records
   `archiveObjectCleanupStatus=failed`.
3. Retry deletion of the persisted `archiveStorageKey` through the configured
   storage provider.
4. Append a new `retention_expired` audit event with
   `archiveObjectCleanupRetry=true`, the new cleanup status, previous cleanup
   fingerprint/error metadata, and the storage key.
5. Retry audit insertion is fenced by an `INSERT ... SELECT` over the expired
   bundle snapshot and latest failed cleanup audit source, including source
   audit id/fingerprint/metadata/timestamp and failure count, so stale retry
   workers cannot append recovered/failed retry evidence after a newer cleanup
   attempt has become the source of truth.
6. Return `archiveObjectCleanupRetryCount`,
   `archiveObjectCleanupRecoveredCount`, and
   `archiveObjectCleanupFailedCount` through GraphQL/Admin cleanup results.
7. Treat retry work as scheduled worker progress when it recovers objects, while
   avoiding a tight repeat loop for persistently failing storage providers.

## Archive Object Cleanup Escalation Slice

Status: implemented.

The eleventh support bundle slice closes the persistent scheduled retry loop
without introducing a separate alerting table or GraphQL shape.

Implemented behavior:

1. Count prior failed archive object cleanup audit events for retry candidates.
2. When the scheduled retention worker records another failed retry after the
   threshold is reached, append durable `retention_expired` metadata with
   `archiveObjectCleanupEscalated=true`,
   `archiveObjectCleanupEscalationReason=scheduled_retry_limit_exceeded`,
   `archiveObjectCleanupFailureCount`, and
   `archiveObjectCleanupEscalatedAt`.
3. Exclude bundles whose latest cleanup audit event is already escalated from
   scheduled retry scans, preventing permanent scheduled loops on a broken
   storage backend.
4. Keep manual workspace cleanup eligible for escalated bundles so an operator
   can retry and recover after fixing storage.
5. Manifest object rewrite retries use the same source cleanup audit snapshot
   fence before appending retry/escalation audit evidence.

## Download Authorization Cleanup Slice

Status: implemented.

The twelfth support bundle slice closes the short-lived authorization lifecycle
gap without changing retention semantics.

Implemented behavior:

1. `expireDueDownloadAuthorizations()` updates bounded batches of
   `authorized` download authorization rows whose `expiresAt` has passed.
2. The update is independent of bundle retention state; ready/active support
   bundles remain downloadable through newly issued authorizations.
3. Daily Copilot cron enqueues
   `copilot.supportBundle.cleanupDownloadAuthorizations` with a deterministic
   job id.
4. The job returns `Repeat` only when it expires a full bounded batch.
5. Each scheduled expiration writes durable audit metadata on the support
   bundle with `authorizationExpired=true`, cleanup scope/fingerprint, previous
   status, and authorization artifact evidence.
6. Existing consume/direct-acknowledge paths still mark a single authorization
   expired if they encounter it after TTL but before the scheduled cleanup has
   run, and they now write the same expiration audit evidence with a source
   identifying the API proxy consume or direct-download acknowledgement guard.

## Manifest Artifact Storage Slice

Status: implemented.

The thirteenth support bundle slice moves manifest delivery onto persisted
blob-backed bytes without removing the DB manifest index.

Implemented behavior:

1. Add manifest storage key, byte size, MIME type, and filename columns to
   `ai_support_bundle_requests`.
2. During support bundle creation, write
   `support-bundles/:bundleId/manifest.json` to the configured blob storage
   provider and persist the storage metadata beside `manifest_json`.
3. Keep `manifest_json` on the request row for compatibility, GraphQL
   inspection, fingerprint indexing, and retention-state updates.
4. Authorize `manifest_json` downloads through object-storage signed URLs when
   the provider returns a signed `get` redirect and object metadata matching
   the persisted manifest byte size.
5. Preserve API-proxy fallback for storage providers that do not return signed
   redirects.
6. API-proxy manifest consumption reads the stored JSON object when a storage
   key exists and rejects missing, corrupt, or fingerprint-mismatched bytes
   without consuming the authorization.
7. Retention cleanup rewrites the stored manifest object after the DB row is
   expired so the blob retention status tracks the DB manifest when storage is
   healthy.
8. Manifest object rewrite failures do not roll back DB retention expiry; the
   `retention_expired` audit event records
   `manifestObjectRewriteStatus=failed` plus error metadata.
9. Direct manifest URLs can be acknowledged through the same direct completion
   telemetry path, with manifest fingerprint validation before the
   authorization is marked downloaded.

## Manifest Direct Acknowledgement Slice

Status: implemented.

The sixteenth support bundle slice closes the direct manifest delivery
completion gap without claiming server-side transfer proof.

Implemented behavior:

1. `acknowledgeCopilotSupportBundleDirectDownload` now accepts active
   `manifest_json` authorizations that were issued with
   `object_storage_signed_url` delivery.
2. The acknowledgement reuses the existing direct URL expiration guard and
   support bundle ready/active/unexpired checks.
3. Manifest acknowledgement validates that the authorization manifest
   fingerprint still matches the bundle and that the artifact fingerprint is the
   same manifest fingerprint.
4. Successful acknowledgement marks the authorization `downloaded`, sets
   `downloaded_at`, and writes a `downloaded` audit event with
   `clientAcknowledged=true`, artifact kind `manifest_json`, delivery method,
   direct URL expiration, and manifest/artifact fingerprints.
5. Archive acknowledgement keeps its archive fingerprint validation, and
   API-proxy authorizations remain rejected by the direct acknowledgement path.

## Manifest Object Rewrite Retry Slice

Status: implemented.

The fourteenth support bundle slice closes the manifest rewrite failure dead
end introduced by storing manifest bytes outside the DB row.

Implemented behavior:

1. Reuse manual and scheduled retention cleanup as the retry entry point for
   expired bundles whose latest manifest object rewrite audit metadata records
   `manifestObjectRewriteStatus=failed`.
2. After due active bundles and archive object retries consume the current
   batch limit, retry writing the current DB `manifest_json` bytes to the
   persisted `manifestStorageKey`.
3. Append a new `retention_expired` audit event with
   `manifestObjectRewriteRetry=true`, the retry status, failure count, previous
   cleanup fingerprint, previous error metadata, manifest fingerprint, byte
   size, and storage key.
4. Return `manifestObjectRewriteRetryCount`,
   `manifestObjectRewriteRecoveredCount`, and
   `manifestObjectRewriteFailedCount` through GraphQL/Admin cleanup results.
5. Keep archive object cleanup retry selection independent from manifest
   rewrite retry selection so one retry event family does not hide the other.

## Manifest Object Rewrite Escalation Slice

Status: implemented.

The fifteenth support bundle slice closes the persistent scheduled manifest
rewrite retry loop without adding a separate alerting table.

Implemented behavior:

1. Count prior failed manifest object rewrite audit events for retry
   candidates.
2. When the scheduled retention worker records another failed rewrite after the
   threshold is reached, append durable `retention_expired` metadata with
   `manifestObjectRewriteEscalated=true`,
   `manifestObjectRewriteEscalationReason=scheduled_retry_limit_exceeded`,
   `manifestObjectRewriteFailureCount`, and
   `manifestObjectRewriteEscalatedAt`.
3. Exclude bundles whose latest manifest rewrite audit event is already
   escalated from scheduled retry scans, preventing permanent scheduled loops
   on a broken storage backend.
4. Keep manual workspace cleanup eligible for escalated manifest rewrite
   failures so an operator can retry and recover after fixing storage.

## Transfer Notification Signature Evidence Boundary Slice

Status: implemented.

The support bundle object-storage transfer ingestion boundary now separates
internal endpoint authentication from upstream provider signature evidence.

Implemented behavior:

1. Canonical transfer events sent to the internal endpoint no longer accept
   `providerSignatureEvidence`; the internal access token only proves the
   forwarding caller was authorized.
2. S3/R2-compatible object-created wrapper events may include provider
   signature evidence only when the forwarding worker marks it
   `verified_by_upstream`.
3. Self-reported `verified` provider signature evidence is rejected before
   transfer events can mark an authorization downloaded or persist audit
   metadata.
4. Existing storage-key, byte-size, fingerprint, retention, and authorization
   checks still run before any transfer audit row is written.

## Direct Transfer Replay Validation Slice

Status: implemented.

The support bundle direct-transfer ingestion path now keeps replay idempotency
from becoming evidence bypass. Already-downloaded authorizations still return a
successful sanitized state for matching replays, but they no longer skip storage
metadata validation.

Implemented behavior:

1. Replayed direct-transfer events for downloaded authorizations must still be
   direct-delivery authorizations.
2. Replayed artifact fingerprints are checked against the persisted
   authorization before returning a downloaded snapshot.
3. When persisted bundle artifact metadata is still available, replayed storage
   key, byte size, and artifact fingerprint evidence is compared against the
   expected manifest/archive object metadata.
4. When the retained bundle is still active, replay validation also reuses the
   existing object-storage verifier before accepting the replay.
5. Valid replays remain audit-idempotent; mismatched replays fail before any
   additional `downloaded` audit row can be written.

## Direct Transfer Event Persistence Slice

Status: implemented.

Verified support bundle direct-transfer notifications now persist as their own
durable event stream instead of existing only inside the first `downloaded`
audit row.

Implemented behavior:

1. A new `ai_support_bundle_transfer_events` table records authorization,
   bundle, workspace, actor, artifact kind, manifest/artifact fingerprints,
   delivery method, provider event id/source, transfer time, storage
   key/byte-size/content-type, notification auth evidence, notification auth
   evidence fingerprint, and deterministic transfer event fingerprint.
2. Initial object-storage transfer events write the transfer event row in the
   same transaction that marks the authorization downloaded and writes the
   existing downloaded audit event.
3. Already-downloaded matching replays stay audit-idempotent but can append
   additional durable transfer event rows after the same storage evidence
   validation passes.
4. Transfer event insert conflicts re-read the existing row and validate the
   provider event id/source, transfer timestamp, auth-evidence fingerprint, and
   storage evidence before treating a duplicate event fingerprint as
   idempotent.
5. Transfer event rows use a composite authorization snapshot foreign key, so
   direct SQL cannot attach a transfer event to an authorization while drifting
   artifact, manifest, actor, workspace, authorization fingerprint, or delivery
   method evidence.
6. DB constraints reject malformed fingerprints, missing notification auth
   evidence, AWS/S3 provider-origin rows without upstream verified provider
   signature evidence, invalid artifact/delivery vocabulary, and inconsistent
   manifest artifact fingerprints.

## Direct Transfer Authorization Snapshot Update Restrict Slice

Status: implemented.

Support bundle transfer events now preserve their persisted download
authorization snapshot when parent authorization rows are directly edited.

Implemented behavior:

1. The `ai_support_bundle_transfer_events_authorization_fkey` composite foreign
   key still binds transfer event authorization id, bundle, workspace, actor,
   artifact kind, manifest/artifact fingerprints, authorization fingerprint,
   and delivery method to the persisted download authorization row.
2. The foreign key now uses `ON UPDATE RESTRICT` instead of `ON UPDATE CASCADE`,
   so direct SQL cannot update parent authorization snapshot columns and
   silently cascade the new values into historical transfer-event evidence.
3. The migration is `NOT VALID`, preserving upgrade tolerance while enforcing
   the stricter update behavior for new writes and future parent snapshot
   edits.
4. Focused coverage verifies that updating a parent authorization fingerprint
   after transfer events exist fails on
   `ai_support_bundle_transfer_events_authorization_fkey`.

## Direct Transfer Storage Snapshot Slice

Status: implemented.

Support bundle transfer events now validate the persisted artifact storage
snapshot when the transfer event is written or directly rewritten.

Implemented behavior:

1. `ai_support_bundle_transfer_events` uses
   `ai_support_bundle_transfer_events_storage_snapshot_check` before insert or
   updates of bundle/workspace, artifact kind/fingerprint, or storage evidence.
2. `manifest_json` transfer rows must keep storage key, byte size, content
   type, and artifact fingerprint matched to the parent support bundle's
   manifest artifact metadata.
3. `archive_json` transfer rows must keep the same storage evidence matched to
   the parent support bundle archive artifact metadata.
4. The guard is a point-in-time trigger rather than a normal FK so retention
   cleanup and later manifest rewrites do not invalidate historical transfer
   evidence.
5. Focused coverage verifies direct transfer-event storage key/byte-size drift
   and mismatched storage-evidence inserts are rejected at the database
   boundary.

## Direct Transfer Event Content Update Restrict Slice

Status: implemented.

Support bundle transfer events now preserve their own event evidence as
append-only DB history after persistence.

Implemented behavior:

1. `ai_support_bundle_transfer_events` uses
   `ai_support_bundle_transfer_events_content_update_restrict_check` after
   direct updates to reject changes to authorization linkage, bundle/workspace/
   actor evidence, artifact and authorization fingerprints, delivery method,
   provider event id/source, transfer time, notification auth evidence,
   notification-auth fingerprint, storage evidence, event fingerprint, or
   creation time.
2. The trigger allows true no-op updates so harmless ORM or operational rewrites
   that set identical values remain compatible.
3. The trigger runs after the existing auth-evidence, authorization snapshot,
   and storage snapshot checks, so malformed rows still report their older
   specific constraints while coherent transfer-evidence rewrites are blocked by
   the append-only event boundary.
4. Focused coverage verifies no-op transfer-event updates pass while coherent
   event-source/notification-auth rewrites and event-fingerprint rewrites reject
   before support bundle reads, Admin, or transfer diagnostics can observe
   mutable object-storage history.

## Direct Transfer Event Read Exposure Slice

Status: implemented.

Persisted transfer event history is now visible through the existing support
bundle read APIs and Admin surface instead of requiring direct SQL inspection.

Implemented behavior:

1. GraphQL `CopilotSupportBundleType` exposes `transferEventCount` and the
   latest transfer event records with authorization id, artifact kind,
   manifest/artifact/authorization fingerprints, delivery method,
   event id/source, transfer time, storage evidence, notification auth
   fingerprint, event fingerprint, and creation time.
2. Support bundle `get` and `list` model queries hydrate the latest five
   transfer events per bundle in newest-first order and default older rows or
   narrower query paths to zero events.
3. Common GraphQL operations and generated types return transfer event history
   for create/get/list callers, keeping Admin state and backend schema aligned.
4. Admin support bundle rows display transfer-event count plus recent provider
   event/source, authorization, storage, byte-size, content-type, and
   notification-auth fingerprint evidence.
5. Focused backend coverage verifies GraphQL returns verified direct-transfer
   and replay event history after the DB rows are written, and Admin coverage
   verifies the count plus transfer evidence are rendered.

## Audit Event History Read Exposure Slice

Status: implemented.

Persisted support bundle lifecycle audit rows are now visible through the
existing support bundle read APIs and Admin surface instead of being reduced
to a count.

Implemented behavior:

1. GraphQL `CopilotSupportBundleType` exposes recent `auditEvents` alongside
   the existing `auditEventCount`.
2. Recent audit events include bundle/workspace/actor ids, event type, event
   fingerprint, bounded metadata, and creation time.
3. Support bundle `get` and `list` model queries hydrate the latest five audit
   events per bundle in newest-first order and default narrower internal query
   paths to an empty history.
4. The detail `supportBundle(id)` resolver rehydrates after writing the `read`
   audit row so the returned history and count describe the same durable state.
5. Common GraphQL operations and generated types return audit history for
   create/get/list and retention-cleanup bundle responses.
6. Admin support bundle rows display recent lifecycle audit event type,
   fingerprint, actor, and creation evidence.

## Download Authorization Delivery Shape Constraint Slice

Status: implemented.

Support bundle download authorization rows now enforce the delivery-method
shape that the model already assumes.

Implemented behavior:

1. API-proxy authorization rows must have `direct_download_url IS NULL` and
   `direct_download_expires_at IS NULL`.
2. Object-storage signed-URL authorization rows must have both
   `direct_download_url` and `direct_download_expires_at`.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new contradictory inserts and updates.
4. Focused coverage verifies signed-URL rows cannot lose direct evidence and
   rows with direct evidence cannot be relabeled as API-proxy rows.

## Download Authorization Downloaded Timestamp Constraint Slice

Status: implemented.

Support bundle download authorization rows now enforce the relationship between
terminal downloaded state and durable download telemetry.

Implemented behavior:

1. `downloaded` authorization rows must have `downloaded_at` populated.
2. Non-downloaded authorization rows must keep `downloaded_at` null.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new contradictory inserts and updates.
4. Focused coverage verifies authorized rows cannot gain `downloaded_at`
   without moving to `downloaded`, and rows cannot move to `downloaded` without
   durable download time evidence.

## Bundle JSON Shape Constraint Slice

Status: implemented.

Support bundle request and audit rows now enforce the JSON object shape that
the model already writes and the read path hydrates defensively.

Implemented behavior:

1. Bundle request rows require `source_evidence_summary` to be a JSON object.
2. Bundle request rows require `manifest_json` to be a JSON object.
3. Audit event rows require `metadata` to be a JSON object.
4. The constraints are `NOT VALID`, preserving upgrade tolerance for
   historical rows while rejecting new malformed inserts and updates.
5. Focused coverage verifies direct malformed JSON shape updates are rejected
   before new rows can rely on hydration repair.

## Audit Event Fingerprint String Shape Constraint Slice

Status: implemented.

Support bundle audit rows now enforce non-blank bounded audit event
fingerprints.

Implemented behavior:

1. `ai_support_bundle_audit_events.event_fingerprint` must remain non-blank
   and within the current common fingerprint boundary.
2. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
3. This deliberately does not require hex-only fingerprints; audit consumers
   only need non-empty bounded correlation evidence at the database boundary.
4. Focused coverage verifies direct updates cannot blank audit event
   fingerprints before audit read, cleanup retry, or transfer diagnostics paths
   observe malformed audit rows.

## Artifact Metadata Constraint Slice

Status: implemented.

Support bundle request rows now enforce coherent persisted artifact metadata
for blob-backed manifest and archive delivery.

Implemented behavior:

1. Manifest artifact metadata is either entirely absent for legacy DB-only
   fallback rows, or fully present with storage key, positive byte size, MIME
   type, and filename.
2. Archive artifact metadata is either entirely absent, or fully present with
   storage key, positive byte size, archive fingerprint, MIME type, and
   filename.
3. Retention cleanup preserves coherent legacy manifest rows by leaving the
   manifest storage metadata group absent when no manifest storage key exists.
4. The constraints are `NOT VALID`, preserving upgrade tolerance for
   historical rows while rejecting new partial artifact metadata updates.
5. Focused coverage verifies direct partial manifest and archive metadata
   updates fail at the database boundary.

## Artifact String Shape Constraint Slice

Status: implemented.

Support bundle request and download authorization rows now enforce non-blank
bounded artifact delivery strings when those values are present.

Implemented behavior:

1. Manifest and archive request metadata must keep present storage keys, MIME
   values, and filenames non-blank and within the current model-layer bounds.
2. Download authorization rows must keep `artifact_filename` and
   `artifact_mime` non-blank and bounded.
3. Direct signed-URL authorization rows must keep any present
   `direct_download_url` non-blank, while the existing delivery-shape
   constraint still controls when the URL may be null.
4. The constraints are `NOT VALID`, preserving upgrade tolerance for
   historical rows while rejecting new malformed artifact string evidence.
5. Focused coverage verifies direct blank artifact string updates fail before
   artifact delivery, retention cleanup, direct acknowledgement, or transfer
   verification can observe malformed rows.

## Status Retention Coherence Constraint Slice

Status: implemented.

Support bundle request rows now enforce the lifecycle pairing between request
status and retention status.

Implemented behavior:

1. Non-expired request statuses (`pending`, `ready`, and `failed`) must keep
   `retention_status='active'`.
2. Expired request rows must keep `retention_status` in `expired` or `deleted`.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   contradictory rows while rejecting new malformed lifecycle pairs.
4. Focused coverage verifies direct updates cannot persist `ready/expired` or
   `expired/active` state drift.

## Download Artifact Fingerprint Constraint Slice

Status: implemented.

Support bundle download authorization rows now enforce manifest artifact
fingerprint evidence for manifest downloads.

Implemented behavior:

1. `manifest_json` authorization rows must keep `artifact_fingerprint` equal
   to `manifest_fingerprint`.
2. Archive authorizations keep their separate archive artifact fingerprint
   semantics.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new manifest authorization evidence drift.
4. Focused coverage verifies direct updates cannot make a manifest
   authorization point at a non-manifest artifact fingerprint.

## Download Authorization Archive Snapshot Write Guard

Status: implemented.

Archive download authorization rows now validate the archived artifact snapshot
captured by an authorization at write time.

Implemented behavior:

1. `ai_support_bundle_download_authorizations` uses
   `ai_support_bundle_download_authorizations_archive_snapshot_check` before
   insert or update of `bundle_id`, `artifact_kind`, or `artifact_fingerprint`.
2. The trigger applies only to `archive_json` authorizations and requires the
   authorization's `(bundle_id, workspace_id, artifact_fingerprint)` to match
   the current parent support bundle archive fingerprint.
3. `manifest_json` authorizations continue to use the manifest artifact
   fingerprint equality constraint and are ignored by this archive-only guard.
4. The guard is intentionally a point-in-time trigger, preserving historical
   authorization semantics while rejecting new or updated archive authorization
   rows that point at the wrong bundle archive fingerprint.
5. Focused coverage verifies both direct SQL archive artifact fingerprint drift
   and mismatched archive authorization inserts are rejected at the database
   boundary.

## Download Authorization Fingerprint Shape Constraint Slice

Status: implemented.

Support bundle download authorization rows now enforce deterministic
fingerprint shape for authorization and token evidence.

Implemented behavior:

1. `manifest_fingerprint`, `artifact_fingerprint`, and
   `authorization_fingerprint` must remain lowercase 16-character hex
   fingerprints.
2. `token_fingerprint` must remain a lowercase 64-character SHA-256 hex
   fingerprint.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
4. Focused coverage verifies direct token and authorization fingerprint drift
   fails at the database boundary.

## Direct Download Expiry Coherence Constraint Slice

Status: implemented.

Support bundle direct object-storage delivery rows now enforce that signed URL
expiry cannot outlive the persisted download authorization.

Implemented behavior:

1. API-proxy authorization rows keep `direct_download_expires_at` null through
   the existing delivery-shape constraint.
2. Direct object-storage authorization rows may carry a direct URL expiry only
   when that expiry is less than or equal to the authorization `expires_at`.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
4. Focused coverage verifies direct updates cannot extend direct signed URL
   expiry beyond the persisted authorization TTL.

## Timestamp Coherence Constraint Slice

Status: implemented.

Support bundle request and download authorization rows now enforce common
lifecycle timestamp ordering without changing retention or authorization TTL
semantics.

Implemented behavior:

1. Support bundle request rows must keep `updated_at >= created_at`.
2. Download authorization rows must keep `updated_at >= created_at`.
3. Present `downloaded_at` must not predate the authorization `created_at`.
4. The constraints are `NOT VALID`, preserving upgrade tolerance for
   historical rows while rejecting new malformed inserts and updates.
5. Focused coverage verifies direct writes cannot move bundle or authorization
   update evidence before creation, or make downloaded telemetry predate the
   authorization, before retention cleanup, direct acknowledgement, transfer
   replay, or diagnostics consume impossible lifecycle history.

## Request Failure Field Pair Constraint Slice

Status: implemented.

Support bundle request rows now enforce failure diagnostic pairing without
requiring current cleanup failures to populate request-level failure fields.

Implemented behavior:

1. `failure_code` and `failure_message` must be absent together or present
   together, preventing orphan failure codes or orphan operator-facing
   messages.
2. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
3. Focused coverage verifies direct updates cannot write either failure field
   alone on a durable support bundle request row.

## Request Failure String Shape Constraint Slice

Status: implemented.

Support bundle request rows now enforce usable string shape for present
request-level failure diagnostics.

Implemented behavior:

1. Failure diagnostics may remain absent together, preserving audit-scoped
   cleanup failure evidence and existing request lifecycle semantics.
2. When present, `failure_code` must be non-blank and no longer than the
   current 128-character model boundary.
3. When present, `failure_message` must be non-blank and no longer than the
   current 512-character model boundary.
4. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
5. Focused coverage verifies direct updates cannot blank a paired failure code
   or message after request-level failure diagnostics are present.

## Request Fingerprint String Shape Constraint Slice

Status: implemented.

Support bundle request rows now enforce non-blank bounded fingerprint evidence
for the request-level source evidence, manifest, and optional archive artifact
fields.

Implemented behavior:

1. `source_evidence_set_fingerprint` and `manifest_fingerprint` must remain
   non-blank and within the current model-layer bound.
2. `archive_fingerprint` may remain null for legacy/non-archive rows, but if
   present it must be non-blank and bounded.
3. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new malformed inserts and updates.
4. This deliberately does not duplicate the stricter download authorization
   token/fingerprint hex constraint; request-level historical evidence only
   needs the common non-blank bounded string boundary here.
5. Focused coverage verifies direct updates cannot blank source-evidence or
   manifest fingerprints before bundle read, authorization, retention, or
   artifact delivery paths observe malformed request evidence.

## Creation Audit Metadata Constraint Slice

Status: implemented.

Support bundle creation audit rows now enforce the manifest/archive artifact
evidence written by the current creation path.

Implemented behavior:

1. `created` audit metadata must retain manifest fingerprint, positive manifest
   byte size, manifest filename/MIME/storage key, source-evidence fingerprint,
   and `retentionStatus=active`.
2. `archive_created` audit metadata must retain positive archive byte size,
   archive filename/MIME/storage key, archive fingerprint, and manifest
   fingerprint.
3. The model validates those contracts before persisting new creation audit
   rows, matching the existing model-side validation for download audit
   metadata.
4. The DB constraint is `NOT VALID`, preserving upgrade tolerance for
   historical rows while rejecting new malformed inserts and updates.
5. Focused coverage verifies direct audit metadata updates cannot drop manifest
   storage evidence, zero manifest/archive byte sizes, or drop archive
   fingerprints before artifact delivery, retention, or diagnostics consume
   creation audit rows.

## Data Model Sketch

Fields to consider:

- `id`;
- `workspaceId`;
- `actorId`;
- `status`;
- `manifestFingerprint`;
- `manifestJson` or `storageKey`;
- `archiveStorageKey`;
- `archiveByteSize`;
- `archiveFingerprint`;
- `archiveMime`;
- `archiveFilename`;
- `manifestStorageKey`;
- `manifestByteSize`;
- `manifestMime`;
- `manifestFilename`;
- `sourceEvidenceSetFingerprint`;
- `createdAt`;
- `updatedAt`;
- `expiresAt`;
- `retentionStatus`;
- `failureCode`;
- `failureMessage`.

## API Shape

Start with safe operations:

- create support bundle request;
- get support bundle request;
- list recent support bundle requests for workspace/admin scope.
- authorize minimal manifest artifact download;
- authorize minimal archive artifact download;
- download minimal manifest or archive artifact through a short-lived token.
- acknowledge direct object-storage archive download completion telemetry.
- ingest server-side object-storage transfer events for direct-delivery
  authorizations through the internal
  `/api/copilot/support-bundles/download-transfer-events` endpoint after
  storage evidence validation and bounded payload parsing.
- translate S3/R2-compatible object-created notifications into the canonical
  transfer event verifier payload.
- persist bounded transfer notification auth evidence and a deterministic
  notification auth evidence fingerprint after storage verification succeeds.
- persist verified direct-transfer notification rows with provider event,
  authorization snapshot, storage evidence, notification auth evidence, and a
  deterministic transfer event fingerprint.
- reject self-reported provider signature evidence on canonical transfer
  events and only persist upstream provider signature evidence from S3/R2
  wrapper events when the forwarding worker marks it `verified_by_upstream`
  with bounded verifier, policy, and signature fingerprint evidence.
- validate already-downloaded direct transfer event replays against persisted
  authorization and artifact evidence without writing duplicate audit rows.
- read support bundle transfer event counts and latest event evidence through
  GraphQL/Admin for operator review.
- enforce direct-transfer event authorization-snapshot, storage evidence,
  notification auth evidence, provider signature evidence, and fingerprint
  shape at the database layer.
- enforce download authorization delivery shape at the database layer.
- cleanup expired support bundle retention state for a workspace.
- run scheduled support bundle retention cleanup through the Copilot job queue.
- delete stored archive objects during retention cleanup and record cleanup
  status in audit metadata.
- retry failed archive object cleanup from manual and scheduled retention
  cleanup runs.
- escalate persistently failed scheduled archive object cleanup retries while
  preserving manual recovery.
- expire stale short-lived download authorizations through scheduled cleanup.
- serve stored manifest artifacts through API-proxy validation or direct signed
  URLs when available.
- retry failed manifest object rewrites from manual and scheduled retention
  cleanup runs.
- escalate persistently failed scheduled manifest object rewrites while
  preserving manual recovery.
- count recovered manifest object rewrites as scheduled retention worker
  progress and include manifest retry/recovered/failed counters in the worker
  log line.
- hydrate persisted manifest JSON and source-evidence summary JSON through a
  bounded readback guard, using scalar row metadata as the fallback manifest
  when legacy or manually edited JSONB is malformed.
- guard API-proxy download authorization and consumption with conditional DB
  writes over the read authorization plus parent bundle snapshots, so expired
  or drifted bundle/authorization state cannot produce fresh authorization or
  downloaded audit evidence from stale snapshots.
- guard retention cleanup expiration writes with the originally read support
  bundle request snapshot, so stale cleanup workers cannot overwrite a newer
  manifest/archive/source-evidence row or revoke authorizations from outdated
  evidence.

## Tests

Backend:

- creates a persisted bundle request;
- persists deterministic manifest metadata;
- enforces authorization;
- records create/read/download authorization/download audit events;
- records retention cleanup audit events;
- rejects unauthorized download authorization;
- rejects unauthorized cleanup;
- serves manifest and archive artifacts through the authorized HTTP endpoint.
- rejects malformed support-bundle request manifest/source-evidence JSON shape
  and audit metadata shape at the database boundary.
- rejects malformed support-bundle creation/archive-created audit metadata at
  the database boundary.
- rejects partial manifest/archive artifact metadata and non-positive archive
  byte-size drift at the database boundary.
- rejects contradictory support-bundle request status and retention status
  pairs at the database boundary.
- rejects orphan support-bundle request failure codes or messages at the
  database boundary.
- rejects malformed support-bundle download authorization fingerprint/token
  evidence at the database boundary.
- expires authorized downloads for bundles whose retention window elapsed.
- enqueues the scheduled retention cleanup job from daily cron.
- runs the scheduled cleanup worker across due bundles and records
  `scheduled_worker` audit metadata.
- verifies packaged archive file index entries, embedded contents, per-file
  fingerprints, and archive index fingerprint.
- authorizes archive downloads through object-storage signed URLs when the
  provider supports them.
- acknowledges direct object-storage authorizations into downloaded state and
  `clientAcknowledged` audit telemetry.
- acknowledges direct object-storage manifest authorizations into downloaded
  state with manifest fingerprint evidence.
- rejects mismatched object-storage transfer events and accepts verified
  transfer events through the authenticated internal endpoint into downloaded
  state with `serverVerified` audit metadata and no returned download URL.
- verifies matching transfer-event replays remain idempotent while mismatched
  replays fail without writing duplicate downloaded audit rows.
- verifies matching transfer-event replays append durable transfer event rows
  without duplicating downloaded audit rows.
- verifies support-bundle transfer event rows retain authorization snapshot,
  notification auth evidence, storage evidence, and transfer fingerprint data.
- verifies GraphQL/Admin expose persisted direct-transfer event count and
  latest event storage/auth evidence for support bundle operator review.
- rejects malformed support-bundle transfer event rows at the database boundary
  when notification auth evidence is incomplete or the authorization snapshot
  drifts from the persisted download authorization.
- verifies download authorization delivery-method shape is database-enforced
  for API-proxy and object-storage signed-URL rows.
- verifies request and download authorization artifact string shape is
  database-enforced for stored artifact metadata and direct-delivery URLs.
- verifies download authorization downloaded-state timestamp shape is
  database-enforced before rows can claim or lose download telemetry.
- verifies API-proxy download consumption rejects both stale authorization and
  stale parent bundle snapshots after artifact readback but before marking the
  authorization downloaded.
- verifies manifest download authorization rows cannot carry artifact
  fingerprints that drift from the manifest fingerprint.
- rejects overlong or malformed object-storage transfer event metadata before it
  can be persisted into support bundle audit rows.
- accepts S3/R2-style object-created notifications through the same internal
  endpoint, translates them to canonical transfer evidence, and only records
  downloaded audit metadata after existing storage verification succeeds.
- rejects S3/R2 wrapper notifications that are not explicit object-created
  events before they can mark an authorization downloaded.
- rejects malformed or overlong provider signature evidence at the internal
  transfer endpoint before audit persistence.
- rejects self-reported canonical provider signature evidence and S3/R2 wrapper
  evidence that has not been verified by an upstream notification worker.
- rejects S3/R2 wrapper evidence that omits verifier, policy, or signature
  fingerprint before controller/model persistence.
- records bounded transfer notification auth evidence and a deterministic
  fingerprint for canonical and S3/R2-style transfer events.
- requires persisted provider-transfer audit rows to retain internal
  notification auth evidence, server verification, bounded storage evidence,
  and upstream-verified provider signature verifier/policy/fingerprint
  evidence for provider-origin transfer audit rows.
- deletes archive storage objects during retention cleanup and records failure
  metadata without rolling back DB expiration.
- retries failed archive object cleanup for already-expired bundles and records
  recovered/failing retry audit metadata.
- escalates persistent scheduled archive cleanup failures, skips them on later
  scheduled scans, and allows manual workspace cleanup to recover them.
- expires stale download authorizations without expiring the support bundle and
  schedules the cleanup job from daily cron.
- records audit metadata for scheduled download authorization expiration.
- persists manifest storage metadata, validates stored manifest bytes for
  API-proxy downloads, authorizes manifest signed URLs, and acknowledges direct
  manifest authorizations with client-reported completion telemetry.
- records manifest object rewrite success/failure metadata during retention
  cleanup without rolling back DB expiration.
- retries failed manifest object rewrites for already-expired bundles and
  records recovered/failing retry audit metadata.
- escalates persistent scheduled manifest rewrite failures, skips them on later
  scheduled scans, and allows manual workspace cleanup to recover them.
- verifies recovered scheduled manifest rewrite retries return the same repeat
  signal as recovered archive cleanup retries, so bounded batches keep draining.
- verifies manifest rewrite and archive cleanup storage errors are bounded in
  audit metadata, and support-bundle audit metadata is size-checked at the
  shared persistence boundary.
- verifies malformed persisted manifest/source-evidence JSONB hydrates to safe
  fallback objects for model get/list and API-proxy fallback manifest downloads.
- verifies stale bundle state blocks download authorization insertion, stale
  API-proxy authorization state blocks downloaded audit writes, and stale
  retention cleanup request snapshots skip expiration before manifest,
  authorization, or audit side effects are written.

Frontend/Admin if UI changes:

- shows support bundle request status;
- shows manifest fingerprint and creation metadata;
- triggers retention cleanup and shows cleanup counts;
- handles loading/error states.

Current focused coverage includes creation, persistence, read/list behavior,
workspace authorization rejection, authorized manifest and archive downloads,
token consumption, retention cleanup execution, authorization invalidation,
cleanup audit metadata, scheduled worker cleanup, idempotent cleanup reruns, and
Admin create/list/download/cleanup rendering. It also covers direct archive
signed URL authorization, DB persistence, audit metadata, and API proxy
rejection for direct-delivery authorizations, plus client acknowledgement of
direct downloads into downloaded state. Retention coverage now verifies archive
object deletion and delete-failure audit metadata. Manifest artifact coverage
now verifies stored manifest metadata, fail-closed API-proxy validation for
tampered manifest bytes, direct signed URL authorization, artifact-specific
direct acknowledgement for archive and manifest rows, retention-time manifest
rewrite audit metadata, and manifest object rewrite retry recovery through the
cleanup entry point. It also verifies server-side direct transfer event
ingestion rejects byte-size mismatches, revalidates persisted storage evidence,
and writes provider-transfer audit metadata only after artifact fingerprint
verification. It also verifies bounded notification auth evidence and
provider signature summaries are persisted only on verified transfer audit
events. It also verifies persistent scheduled manifest rewrite failures
escalate, stop later scheduled retry loops, and remain recoverable through
manual workspace cleanup. Scheduled-worker coverage now also verifies manifest
rewrite recovery counts as batch progress for repeat scheduling.
Audit-boundary coverage now also verifies storage-provider exception messages
are truncated before they are persisted in manifest rewrite or archive cleanup
audit metadata. Hydration coverage now verifies legacy or manually malformed
manifest/source-evidence JSONB rows are bounded or replaced before model
callers and fallback manifest artifact serving consume them. JSON-shape
coverage now verifies new malformed manifest/source-evidence/audit metadata
rows are rejected at the database boundary before they can rely on hydration
repair.
Retention audit metadata coverage now verifies direct writes cannot persist
unknown archive cleanup status values or omit cleanup fingerprints from
`retention_expired` audit rows before retry/escalation workers consume them.
Retention retry audit metadata coverage now verifies direct writes cannot
weaken archive cleanup retry, manifest rewrite retry, or scheduled escalation
evidence before retry scans, escalation skipping, Admin cleanup summaries, or
operator audit review consume those rows.
Download authorization audit metadata coverage now verifies current
`download_authorized` creation rows carry the explicit authorization audit
version, and expiration cleanup rows carry the explicit expiration audit
version plus cleanup fingerprint evidence before audit/cleanup consumers see
them.
Creation audit metadata coverage now verifies `created` and `archive_created`
audit rows cannot lose manifest storage evidence, positive byte sizes, or
archive fingerprint evidence before artifact delivery, retention, or
diagnostics consume lifecycle audit rows.
Artifact metadata coverage now verifies partial manifest/archive metadata rows
are rejected before artifact delivery, manifest rewrite retry, or retention
cleanup can reason over incomplete storage evidence.
Artifact string-shape coverage now verifies present manifest/archive storage
keys, MIME values, filenames, authorization artifact names, authorization MIME
values, and direct URLs cannot be blanked before artifact delivery or transfer
verification can consume them.
Status/retention coherence coverage now verifies contradictory request
lifecycle pairs are rejected before authorization and cleanup state machines
can observe drift.
Failure-field row-shape coverage now verifies support bundle request rows
cannot retain an orphan `failure_code` or orphan `failure_message`.
Failure-string row-shape coverage now verifies present support bundle request
failure diagnostics cannot be blanked before read, retry, cleanup, or
operator-facing diagnostics observe malformed request rows.
Request fingerprint row-shape coverage now verifies support bundle request rows
cannot blank source-evidence or manifest fingerprint evidence before read,
authorization, retention, or artifact delivery paths observe malformed request
rows.
Audit fingerprint row-shape coverage now verifies support bundle audit rows
cannot blank event fingerprint evidence before audit read, cleanup retry, or
transfer diagnostics paths observe malformed audit rows.
Download authorization fingerprint coverage now verifies manifest
authorization rows cannot drift from the persisted manifest fingerprint before
API-proxy or direct-delivery consumers validate the artifact.
Stale-state coverage now verifies API-proxy download authorization creation
fails before inserting authorization rows or `download_authorized` audit rows
when retention changes the bundle after the initial read, and API-proxy token
consumption returns null before writing `downloaded` audit rows when the
authorization state changes before the final update.
Transfer notification coverage now also verifies canonical internal transfer
events cannot self-report provider signature evidence, and S3/R2 wrapper events
must carry `verified_by_upstream` provider signature evidence with verifier,
policy, and signature fingerprint before it can be persisted into downloaded
audit metadata. Direct-transfer replay coverage now also verifies matching
already-downloaded transfer events remain idempotent, while mismatched replay
byte-size evidence fails before a second downloaded audit row is written.
Delivery-shape coverage now verifies contradictory download authorization rows
are rejected when direct object-storage evidence and delivery method drift
apart.
Direct-expiry coverage now verifies direct object-storage signed URL expiry
cannot outlive the persisted download authorization TTL.
Timestamp-coherence coverage now verifies support bundle request and download
authorization update timestamps cannot predate creation, and downloaded
authorization telemetry cannot predate authorization creation.
Transfer audit metadata coverage now verifies persisted provider-transfer
download audit rows cannot be manually degraded by removing notification auth
evidence or downgrading provider signature evidence from
`verified_by_upstream`. Provider signature evidence coverage now also verifies
S3/R2 provider-transfer audit rows cannot lose verifier, policy, signature
fingerprint, or the evidence object required by provider-origin rows.
Object-created ingress coverage now verifies S3 record notifications must use
an `ObjectCreated:*` event name and EventBridge-style notifications must use
`detail-type='Object Created'` before the transfer verifier can mark a direct
authorization downloaded.
Transfer-event persistence coverage now verifies verified direct-transfer
notifications append DB-backed event rows with authorization snapshot,
notification auth evidence, storage evidence, and deterministic event
fingerprints, while matching replays remain audit-idempotent and direct SQL
drift is rejected by the transfer-event constraints.
Transfer-event read exposure coverage now verifies support bundle GraphQL
get/list responses and Admin rows expose the persisted transfer event count and
recent storage/auth/provider notification evidence.

## Child Workspace Snapshot Coherence Constraint Slice

Status: implemented.

Support bundle child evidence rows now preserve the parent bundle workspace
snapshot at the database boundary.

Implemented behavior:

1. `ai_support_bundle_requests` exposes a composite snapshot key on
   `(id, workspace_id)` for child evidence rows.
2. `ai_support_bundle_audit_events` must keep `(bundle_id, workspace_id)`
   matched to the parent bundle snapshot, so direct writes cannot move an audit
   row into another real workspace while keeping the same bundle id.
3. `ai_support_bundle_download_authorizations` must keep
   `(bundle_id, workspace_id)` matched to the parent bundle snapshot before
   authorization, cleanup, download, or transfer-event readers consume it.
4. The child foreign keys are `NOT VALID`, preserving upgrade tolerance for
   historical rows while rejecting new child workspace drift.
5. Focused coverage verifies direct SQL workspace drift is rejected for both
   audit event rows and download authorization rows.

## Manifest Identity Coherence Constraint Slice

Status: implemented.

Support bundle manifest JSON now preserves the request row identity at the
database boundary before GraphQL, download, or storage rewrite readers consume
it.

Implemented behavior:

1. `ai_support_bundle_requests.manifest_json` must remain a JSON object whose
   `bundleId`, `workspaceId`, `actorId`, and `sourceEvidenceSetFingerprint`
   match the request row columns.
2. Direct SQL can no longer make the embedded manifest identity drift away from
   the durable request row while leaving row-level FKs and workspace snapshot
   constraints intact.
3. The constraint intentionally does not bind `manifest_fingerprint` to
   `manifest_json`, because retention cleanup legitimately rewrites the
   manifest snapshot and fingerprint together.
4. The constraint is `NOT VALID`, preserving upgrade tolerance for historical
   rows while rejecting new manifest identity drift.
5. Focused coverage verifies direct SQL manifest workspace identity drift is
   rejected at the database boundary.

## Download Authorization Manifest Snapshot Write Guard

Status: implemented.

Support bundle download authorization rows now validate the manifest snapshot
captured by an authorization at write time without blocking legitimate later
retention manifest rewrites on the parent support bundle request.

Implemented behavior:

1. `ai_support_bundle_download_authorizations` uses
   `ai_support_bundle_download_authorizations_manifest_snapshot_check` before
   insert or update of `bundle_id` or `manifest_fingerprint`.
2. The trigger requires the authorization's
   `(bundle_id, workspace_id, manifest_fingerprint)` to match the current
   parent `ai_support_bundle_requests` row at authorization write time.
3. The trigger intentionally does not fire on `workspace_id` updates, so
   workspace drift continues to fail on the existing
   `ai_support_bundle_auth_bundle_workspace_snapshot_fkey` snapshot FK.
4. The guard is intentionally a point-in-time trigger rather than a normal FK,
   because retention cleanup can legitimately rewrite the parent bundle
   manifest snapshot and fingerprint after historical authorizations exist.
5. Focused coverage verifies direct SQL manifest snapshot drift and mismatched
   authorization inserts are rejected at the database boundary.

## Audit Event Content Update Restrict Slice

Status: implemented.

Support bundle lifecycle audit rows are now append-only evidence at the
database boundary after persistence.

Implemented behavior:

1. `ai_support_bundle_audit_events` uses
   `ai_support_bundle_audit_events_content_update_restrict_check` after direct
   updates to reject changes to persisted audit identity, actor, event type,
   event fingerprint, metadata, or creation time.
2. The trigger allows true no-op updates so ORM retry paths and operational
   maintenance that rewrite an identical row remain harmless.
3. The trigger runs after the existing row-shape, metadata-contract, and
   workspace-snapshot checks, so malformed writes still report the older
   specific constraint names while coherent evidence rewrites are blocked by
   the new append-only audit constraint.
4. Focused coverage verifies no-op audit updates pass while coherent metadata
   rewrites, event-fingerprint rewrites, and actor retargets reject at the DB
   boundary before support bundle read, Admin, cleanup, or transfer diagnostics
   consumers observe mutable audit history.

## Request Evidence Update Restrict Slice

Status: implemented.

Support bundle request rows now separate legitimate lifecycle mutation from
creation/artifact evidence that should remain stable after write.

Implemented behavior:

1. `ai_support_bundle_requests` rejects direct updates that rewrite request
   identity, workspace/actor linkage, source evidence summary/fingerprint,
   manifest storage identity, archive storage/fingerprint identity, or
   creation time after the bundle row exists.
2. The trigger permits true no-op updates and lifecycle-only changes such as
   status, retention status, failure fields, expiry, and `updated_at`.
3. Retention cleanup remains allowed to rewrite only the manifest retention
   snapshot, manifest fingerprint, and manifest byte size while moving an
   active bundle to expired, preserving the existing manifest-retention
   lifecycle without allowing arbitrary manifest rewrites.
4. Malformed historical manifest/source-evidence hydration coverage now seeds a
   direct legacy row instead of mutating a freshly created bundle, preserving
   upgrade tolerance while future persisted bundle evidence is guarded.
5. Focused coverage verifies no-op request updates pass, while source evidence
   drift, archive fingerprint drift, and creation-time drift reject on the new
   request evidence restriction.

## Request Lifecycle Update Restrict Slice

Status: implemented.

Support bundle request rows now keep their retention window and terminal
lifecycle evidence stable after creation, while preserving the existing
retention cleanup transition.

Implemented behavior:

1. `ai_support_bundle_requests` rejects direct updates that rewrite lifecycle
   fields after insert, including status, retention status, manifest retention
   snapshot/fingerprint/byte size, `expires_at`, or request failure fields.
2. The trigger permits true no-op lifecycle updates for harmless ORM writes.
3. The trigger permits the implemented retention cleanup transition only when
   the persisted `expires_at` has elapsed, the transition moves active rows to
   expired, failure fields remain unchanged, and the manifest rewrite only
   changes `retention.status` plus the existing retention expiry snapshot.
4. Focused coverage verifies request `expires_at` drift, direct ready-to-failed
   status drift, and premature ready-to-expired lifecycle rewrites reject at the
   DB boundary, while cleanup tests now seed expired bundles through the model
   creation path instead of mutating request expiry after persistence.

## Download Authorization Evidence Update Restrict Slice

Status: implemented.

Support bundle download authorization rows now separate legitimate consumption
or expiration state from the issued download evidence.

Implemented behavior:

1. `ai_support_bundle_download_authorizations` rejects direct updates that
   rewrite authorization identity, bundle/workspace/actor linkage, artifact
   kind/name/MIME evidence, manifest/artifact fingerprints, authorization
   fingerprint, token fingerprint, delivery method, direct URL evidence,
   expiration time, or creation time after issuance.
2. The trigger permits true no-op updates and lifecycle-only changes to
   `status`, `downloaded_at`, and `updated_at`, preserving API-proxy download,
   direct-download acknowledgement, provider transfer notification, and
   scheduled expiration flows.
3. The trigger runs after existing manifest/archive snapshot, delivery-shape,
   direct-expiry, downloaded-at/status, timestamp, and string/fingerprint
   checks, so malformed writes still report their specific older constraints
   while coherent evidence rewrites hit the new boundary.
4. Focused coverage verifies no-op authorization updates pass, while token
   fingerprint drift, expiration drift, and creation-time drift reject on the
   new authorization evidence restriction.

## Download Authorization Lifecycle Update Restrict Slice

Status: implemented.

Support bundle download authorization rows now constrain lifecycle transitions
after issuance instead of merely separating mutable lifecycle columns from
immutable authorization evidence.

Implemented behavior:

1. `ai_support_bundle_download_authorizations` rejects direct lifecycle
   rewrites except true no-op updates, `authorized` to `downloaded`, and
   `authorized` to `expired`.
2. Download completion is allowed only when `downloaded_at` is populated inside
   the authorization window and, for object-storage signed URLs, before the
   direct URL expiry.
3. Expiration is allowed only after the authorization TTL elapsed, after the
   direct URL TTL elapsed, or after the parent support bundle has expired or
   crossed its retention window.
4. Terminal authorization rows cannot be replayed back to `authorized`, moved
   between terminal states, marked revoked through direct SQL, or given
   backdated/late download timestamps.
5. Focused coverage verifies premature expiry, revoked drift, late download
   drift, and downloaded replay reject on the new lifecycle restriction, while
   API-proxy consumption, direct-download acknowledgement, transfer-event
   ingestion, scheduled authorization cleanup, and retention cleanup keep their
   implemented transition shapes.

## Direct Delivery Terminal Write Snapshot Guard Slice

Status: implemented.

Direct signed-URL terminal paths now fail closed when a previously read
authorization or parent bundle snapshot changes before the downloaded or
expired update.

Implemented behavior:

1. Direct-download acknowledgement updates the authorization row only when the
   current row still matches the read authorization identity, artifact,
   delivery, token, expiry, creation, update, and downloaded timestamp
   evidence.
2. Direct transfer-event ingestion uses the same authorization snapshot fence
   before marking the row downloaded and appending transfer/audit evidence.
3. Both paths also join the parent support bundle during the terminal update
   and require the same ready/active bundle status, manifest/archive
   fingerprint evidence, expiration, actor/workspace, and update timestamp
   snapshot that was verified before storage or acknowledgement processing.
4. If either snapshot changed, the transaction rolls back without writing a
   downloaded audit row or transfer event.
5. Expired direct-download acknowledgement and transfer-event branches also
   expire an authorization only when the current authorization row still
   matches the previously read identity, artifact, delivery, token, expiry,
   creation, downloaded, and update timestamp evidence. Stale snapshots fail
   before writing `authorizationExpired=true` audit history.
6. Focused coverage verifies stale authorization and stale bundle snapshots
   reject before terminal side effects, verifies stale authorization snapshots
   also reject before expiration audit side effects, while the normal
   object-storage signed URL acknowledgement, transfer, and expiry-audit flows
   still complete.

## Request Audit History Required Slice

Status: implemented.

Support bundle request rows now require append-only lifecycle audit history at
the DB boundary instead of relying only on model-owned write order.

Implemented behavior:

1. `ai_support_bundle_requests` has a deferred constraint trigger requiring
   inserted request rows to have matching `created` audit history by commit
   time.
2. Modern packaged archive request inserts also require matching
   `archive_created` audit history with the same bundle/workspace/actor,
   manifest fingerprint, archive fingerprint, and stored archive metadata.
3. Real request lifecycle transitions to `expired` require a matching
   `retention_expired` audit row by commit time, including the resulting
   manifest fingerprint, previous manifest fingerprint, retention status, and
   cleanup identity evidence.
4. True no-op lifecycle updates continue to pass, preserving harmless ORM
   writes and existing hydration/read paths.
5. Focused coverage verifies bare direct request inserts reject, valid
   insert-plus-audit writes commit, bare direct expiration updates reject, valid
   update-plus-retention-audit writes commit, no-op updates pass, and the
   malformed legacy hydration fixture still remains readable after seeding
   compatible audit history.

## Download Authorization Audit History Required Slice

Status: implemented.

Support bundle download authorization rows now require append-only audit
history for issuance, download completion, and expiration state changes.

Implemented behavior:

1. `ai_support_bundle_download_authorizations` has a deferred constraint
   trigger requiring inserted `authorized` rows to have matching
   `download_authorized` audit metadata by commit time.
2. Transitions to `downloaded` require matching `downloaded` audit history
   with authorization id/fingerprint, artifact evidence, manifest/artifact
   fingerprints, and optional direct-delivery actor/method evidence.
3. Transitions to `expired` require matching expiration audit history, encoded
   in the existing `download_authorized` audit event with
   `authorizationExpired=true`, previous/next status metadata, cleanup
   fingerprint/scope evidence, authorization fingerprint, and artifact
   fingerprint.
4. True no-op status/download timestamp updates still pass, preserving harmless
   ORM writes.
5. Focused coverage verifies bare direct authorization inserts reject,
   fixture/model inserts write matching audit rows, bare downloaded and expired
   updates reject, valid update-plus-audit writes commit, and no-op terminal
   updates pass.

## Audit Event Delete Restrict Slice

Status: implemented.

Support bundle audit rows now preserve append-only request and authorization
history against direct deletes.

Implemented behavior:

1. `ai_support_bundle_audit_events` has a deferred
   `ai_support_bundle_audit_events_delete_restrict_check` trigger.
2. Deleting an audit row is rejected while the parent
   `ai_support_bundle_requests` row still exists, so direct SQL cannot erase
   created, archive-created, download authorization, download completion,
   retention expiration, or provider-transfer audit history from a live bundle.
3. Parent bundle deletion can still cascade audit rows, preserving normal
   ownership cleanup for tests and workspace lifecycle operations.
4. Focused support bundle coverage verifies direct deletion of required
   request and downloaded audit rows rejects. Disposable Postgres smoke verifies
   direct audit deletion rejection and parent-bundle cascade compatibility.

## Transfer Event Delete Restrict Slice

Status: implemented.

Support bundle transfer-event rows now preserve append-only object-storage
delivery history against direct deletes.

Implemented behavior:

1. `ai_support_bundle_transfer_events` has a deferred
   `ai_support_bundle_transfer_events_delete_restrict_check` trigger.
2. Deleting a transfer-event row is rejected while the parent
   `ai_support_bundle_download_authorizations` row still exists, so direct SQL
   cannot erase provider/internal transfer evidence from a live authorization.
3. Parent authorization or bundle deletion can still cascade transfer-event
   rows, preserving normal ownership cleanup.
4. Focused support bundle coverage verifies direct transfer-event deletion
   rejects. Disposable Postgres smoke verifies direct deletion rejection and
   parent-authorization cascade compatibility.

## Transfer Forwarding Retry/Dead-letter Persistence Slice

Status: implemented.

Production object-storage notification forwarding now has a durable
retry/dead-letter ledger before the internal ingestion contract instead of
depending on a best-effort webhook caller.

Implemented behavior:

1. `ai_support_bundle_transfer_forwarding_events` records each parsed transfer
   notification before processing, including authorization id, provider event
   id/source, canonical forwarding payload, payload fingerprint, upstream
   provider-signature evidence fingerprint when present, attempts, lease
   evidence, next retry time, terminal forwarded/dead-letter timestamps,
   bounded failure code/message, and the forwarded transfer-event fingerprint.
2. The internal transfer endpoint now enqueues the canonical event first, then
   synchronously leases and processes the row. Successful processing returns
   the existing authorization response; failed processing leaves durable
   `retry_scheduled` or `dead_lettered` evidence and keeps the old
   BadRequest/NotFound response semantics for callers.
3. `copilot.supportBundle.processTransferForwardingEvents` is scheduled from
   the Copilot cron path and leases queued/retryable rows in bounded batches,
   reusing the existing transfer-ingestion verifier and appending the normal
   `ai_support_bundle_transfer_events` row on success.
4. Retryable storage/processing failures clear the lease, increment attempts,
   store bounded failure evidence, and schedule exponential retry until
   `maxAttempts`; deterministic malformed or mismatched event evidence is
   dead-lettered immediately.
5. Forwarding processing re-locks the row and verifies the same current
   non-expired worker lease before storage verification, forwarded terminal
   writes, or retry/dead-letter writes. Stale workers whose leases were
   re-acquired return the current row without marking the authorization
   downloaded or mutating forwarding state.
6. DB constraints bind forwarding payload authorization/event/source evidence
   to row columns, require coherent queued/processing/retry/forwarded/
   dead-letter state payloads, preserve immutable forwarding evidence after
   insertion, and reject direct deletion while the parent authorization still
   exists while preserving normal ownership cleanup cascades.
7. Focused support bundle coverage verifies a missing-storage transfer
   notification persists as retryable forwarding evidence, the worker later
   replays it after storage recovers, malformed storage evidence
   dead-letters, stale workers cannot verify storage or mark downloaded after
   a later lease re-acquires the row, and direct SQL cannot forge terminal
   state, mutate payload evidence, or delete live forwarding history.
   Disposable Postgres replay verifies all migrations, and targeted SQL smoke
   verifies the forwarding state machine plus direct SQL rejections.

## Transfer Forwarding Attempt Counter Fence Slice

Status: implemented.

Transfer forwarding workers now also compare the attempt counter they leased
before storage verification or terminal forwarding writes.

Implemented behavior:

1. Forwarding processing treats a lease as current only when status, worker
   lease id, non-expired lease time, and attempt count still match the worker
   snapshot.
2. Forwarded terminal writes and retry/dead-letter writes both include
   `attempt_count` in their conditional updates.
3. If the attempt counter changes under the same lease id, stale in-memory
   workers return the current processing row without verifying storage,
   marking the download authorization downloaded, appending transfer events, or
   writing failure/retry evidence.
4. Focused support bundle coverage simulates same-lease attempt drift and
   verifies the stale worker does not mutate authorization, transfer-event, or
   forwarding failure state while the current attempt can still complete.

## Transfer Forwarding Terminal Snapshot Fence Slice

Status: implemented.

Transfer forwarding terminal writes now compare the full locked forwarding row
snapshot instead of only the lease id and attempt counter.

Implemented behavior:

1. Forwarded terminal writes require the originally locked row's authorization
   id, provider event id/source, forwarding event fingerprint, forwarding
   payload JSON, payload fingerprint, provider-signature evidence fingerprint,
   forwarded transfer fingerprint, attempt/max-attempt counters, retry/lease
   timestamps, terminal timestamps, failure fields, creation time, and update
   time to still match before writing `forwarded`.
2. Retry/dead-letter terminal writes use the same full-row predicate before
   clearing the lease and writing retry/dead-letter failure evidence.
3. If any row evidence changes under the same live lease and attempt counter,
   terminal writes fail closed with the existing lease-changed error instead
   of overwriting the newer row state.
4. Forwarding processing now wraps transfer-event ingestion, authorization
   download mutation, downloaded audit history, and the final `forwarded` row
   update in one transaction; if the final full-snapshot terminal write fails,
   the transfer ingestion rolls back instead of leaving a downloaded
   authorization or transfer-event row behind a still-processing forwarding row.
5. Focused support bundle coverage mutates `updated_at` under the same
   lease/attempt snapshot and verifies both forwarded and failed terminal
   writes leave the row processing without terminal fingerprints, timestamps,
   or failure evidence, and verifies the process-level forwarded CAS failure
   does not leak downloaded authorization, transfer-event, or downloaded audit
   evidence.

## Transfer Forwarding Enqueue Conflict Evidence Fence Slice

Status: implemented.

Support bundle transfer forwarding enqueue now fails closed when an existing
`authorization_id/forwarding_event_fingerprint` row does not match the
computed forwarding evidence.

Implemented behavior:

1. Enqueue uses `DO NOTHING RETURNING id` and re-reads the existing row by the
   forwarding unique key when a conflict is reported.
2. The conflict row must match authorization id, provider event id/source,
   forwarding event fingerprint, forwarding payload fingerprint, and provider
   signature evidence fingerprint before it is reused.
3. A mismatched row now raises a deterministic evidence-mismatch error instead
   of returning a queued/terminal row for different forwarding evidence.
4. Focused support bundle coverage inserts a drifted conflict row and verifies
   enqueue rejects it while leaving the original row unchanged.

## Transfer Forwarding Read Exposure Slice

Status: implemented.

Persisted transfer forwarding retry/dead-letter history is now visible through
the existing support bundle read APIs and Admin surface instead of requiring
direct SQL inspection.

Implemented behavior:

1. GraphQL `CopilotSupportBundleType` exposes
   `transferForwardingEventCount` and recent transfer forwarding rows.
2. Recent forwarding rows include authorization id, status, provider event
   id/source, forwarding event and payload fingerprints, payload JSON,
   provider-signature evidence fingerprint, forwarded transfer-event
   fingerprint, attempt/max-attempt counts, retry/dead-letter/forwarded
   timestamps, worker lease evidence, bounded failure code/message, and update
   time.
3. Support bundle `get` and `list` model reads hydrate the latest five
   forwarding rows per bundle in newest-first order by joining through download
   authorizations, and default narrower internal paths to zero forwarding
   events.
4. Common GraphQL operations, embedded query constants, and generated types
   return forwarding history for create/get/list callers, keeping Admin state
   and backend schema aligned.
5. Admin support bundle rows display transfer-forwarding count plus recent
   retry, forwarded, dead-letter, payload fingerprint, provider-signature,
   failure, and worker lease evidence.
6. Focused backend coverage verifies GraphQL list/detail reads return both a
   forwarded retry row and a dead-lettered row after durable forwarding
   processing, and Admin coverage verifies the count plus forwarding evidence
   are rendered.

## Transfer Forwarding Dead-letter Replay Slice

Status: implemented.

Dead-lettered transfer forwarding rows now have an operator replay workflow
that preserves terminal evidence instead of rewriting failed rows.

Implemented behavior:

1. `CopilotSupportBundleModel.replayDeadLetteredDirectDownloadTransferForwardingEvent`
   loads the forwarding row through its download authorization, verifies the
   workspace, and only accepts `dead_lettered` rows.
2. Replay rebuilds the transfer event from the original immutable forwarding
   payload, recomputes signature evidence, and inserts a fresh `queued`
   forwarding row with a new payload fingerprint and event fingerprint.
3. The replay payload includes
   `copilot-support-bundle-transfer-forwarding-replay/v1` metadata with the
   operator actor, replay id/time, source forwarding row id, source payload and
   event fingerprints, source attempt counts, dead-letter timestamp, and
   failure code/message.
4. The original dead-letter row remains unchanged, preserving terminal failure
   diagnostics while the worker can process the new queued row through the
   existing forwarding lease/verifier path.
5. Replay insertion is fenced by an `INSERT ... SELECT` over the source
   forwarding row's full dead-letter snapshot, including payload, fingerprints,
   attempt/lease fields, terminal/failure fields, and timestamps, so a stale
   operator replay cannot append a new queued row after the source row changes.
6. GraphQL/common/Admin expose the replay mutation. Admin shows `Replay` only
   for dead-lettered forwarding rows and renders the newly queued replay row
   plus source-row linkage after mutation.
7. Focused backend coverage verifies GraphQL replay creates a second queued
   row without mutating the dead-lettered row, and read APIs return the
   forwarded, dead-lettered, and replay rows. Additional stale-source coverage
   mutates the source row after read and verifies replay fails closed without
   inserting a queued row. Admin coverage verifies the mutation variables and
   queued replay evidence.

## Transfer Forwarding Filtered Visibility Slice

Status: implemented.

Support bundle list reads now provide a bounded workspace-scoped filter for
durable transfer forwarding evidence.

Implemented behavior:

1. `CopilotSupportBundleModel.list` accepts a constrained filter for bundle
   status, retention status, transfer-forwarding status, and a bounded locator
   query over bundle id/fingerprints plus forwarding authorization id,
   event id/source, forwarding event/payload/provider-signature/forwarded
   transfer fingerprints, and failure code.
2. GraphQL `Copilot.supportBundles(filter, limit)` exposes the filter after
   the normal workspace permission check while preserving the default
   unfiltered recent-list behavior.
3. Common GraphQL and Admin pass the filter through. Admin adds a forwarding
   status selector plus locator input so operators can find forwarded,
   queued, retry-scheduled, processing, and dead-lettered forwarding rows
   through the support bundle diagnostics surface.
4. Focused support bundle coverage verifies list filtering by dead-letter
   forwarding status, forwarding event fingerprint locator, and no-match
   locator/status combinations.

## Download Authorization Delete Restrict Slice

Status: implemented.

Support bundle download authorization rows now preserve durable authorization
history against direct deletes while their parent bundle remains live.

Implemented behavior:

1. `ai_support_bundle_download_authorizations` has a deferred
   `ai_support_bundle_download_authorizations_delete_restrict_check` trigger.
2. Deleting an authorization row is rejected while the parent
   `ai_support_bundle_requests` row still exists, so direct SQL cannot erase
   issued/downloaded/expired authorization state from a live bundle after
   audit and transfer rows have been protected.
3. Parent bundle deletion used to cascade authorization rows, preserving
   normal ownership cleanup. The later Support Bundle Request Delete Restrict
   slice supersedes that behavior for direct bundle-row deletes while keeping
   workspace ownership cleanup compatible.
4. Focused support bundle coverage verifies direct authorization deletion
   rejects and workspace deletion still cascades authorization cleanup through
   the owning support bundle.

## Support Bundle Request Delete Restrict Slice

Status: implemented.

Support bundle request rows now preserve persisted bundle, audit,
authorization, and transfer history against direct deletes while their owning
workspace remains live.

Implemented behavior:

1. `ai_support_bundle_requests` has a `BEFORE DELETE`
   `ai_support_bundle_requests_delete_restrict_check` trigger.
2. Deleting a bundle request row is rejected while the owning workspace still
   exists, so direct SQL cannot erase the persisted support bundle root and
   cascade away audit, download authorization, and transfer history.
3. Workspace deletion can still cascade workspace-scoped support bundle
   requests and their child history, preserving ownership cleanup.
4. Focused support bundle coverage verifies direct request deletion rejects
   and workspace deletion still cascades support bundle request and
   authorization cleanup.

## Verified Transfer Forwarding Evidence Boundary Slice

Status: implemented.

Support bundle direct-transfer forwarding no longer lets S3/R2 wrapper
payloads self-report upstream provider signature verification evidence.

Implemented behavior:

1. Canonical direct-transfer events still use the existing internal
   `x-access-token` boundary.
2. S3 object-created wrappers now reject `providerSignatureEvidence` when it
   appears in the JSON body.
3. Provider signature evidence can only enter the durable forwarding payload
   from the server-owned
   `x-support-bundle-provider-signature-evidence` forwarding header, parsed
   after the internal token guard has accepted the request.
4. The header evidence is validated with the same strict provider/status/
   verifier/signature/policy schema before it is folded into
   `notificationAuthEvidence`, forwarding payload fingerprints, transfer
   events, and downloaded audit metadata.
5. Focused support bundle coverage verifies body-injected evidence is
   rejected, malformed header evidence rejects, and valid S3/EventBridge plus
   retry/dead-letter forwarding flows persist the provider-signature evidence
   fingerprint from the verified forwarding header.

## Production Object-storage Webhook Ingress Slice

Status: implemented.

The generic production webhook boundary now feeds provider notifications into
the durable forwarding queue without trusting client-reported signature
evidence.

Implemented behavior:

1. `copilot.supportBundles.objectStorageWebhooks` configures public webhook
   ids, providers, shared secrets, verifier identity, verification policy, and
   HMAC-SHA256 signature handling.
2. `POST /api/copilot/support-bundles/object-storage-webhooks/:webhookId`
   verifies the raw request body against `x-localmind-webhook-signature` before
   parsing and forwarding any notification payload.
3. S3/R2-compatible object-created notifications are translated into the
   canonical direct-transfer payload and appended to
   `ai_support_bundle_transfer_forwarding_events` for the existing
   retry/dead-letter worker.
4. Webhook bodies that self-report `providerSignatureEvidence` are rejected;
   upstream evidence is derived from server-owned webhook configuration as
   `verified_by_upstream` metadata.
5. Expired direct signed-URL acknowledgement and transfer-event paths now
   commit the authorization `expired` transition plus matching
   `download_authorized(authorizationExpired=true)` audit history before
   returning the expected client/provider error.
6. Focused support bundle coverage verifies invalid signatures, self-reported
   signature rejection, verified forwarding persistence, provider-signature
   evidence fingerprints, and the signed-URL expiry audit path.

## Remaining Risk

- persisted support bundle rows now have bounded manifest/source-evidence
  hydration, bounded audit metadata, stale API-proxy authorization/download
  guards, direct signed-URL acknowledgement and transfer-event terminal
  compare-and-swap guards over authorization and parent bundle snapshots,
  DB-enforced manifest/source-evidence/audit JSON shape, DB-enforced audit
  event fingerprint string shape, DB-enforced manifest/archive artifact
  metadata coherence, DB-enforced artifact string shape, DB-enforced request
  status/retention coherence, DB-enforced download delivery and downloaded
  timestamp shape, DB-enforced direct signed URL expiry coherence,
  DB-enforced request/authorization timestamp coherence,
  DB-enforced manifest download artifact fingerprint
  coherence, DB-enforced request failure field pairing and present failure
  string shape, DB-enforced request fingerprint string shape,
  DB-enforced creation/archive audit metadata shape, replay evidence
  validation, DB-enforced download authorization audit metadata shape,
  DB-enforced provider-transfer audit metadata shape,
  DB-enforced provider signature evidence shape for provider-origin transfer
  rows, durable direct-transfer event persistence with DB-enforced
  authorization snapshot/storage/auth-evidence shape, storage snapshot write
  checks, append-only transfer event content evidence, DB-backed transfer
  forwarding retry/dead-letter rows with immutable payload evidence,
  state-machine constraints, bounded failure evidence, worker leases,
  transfer-event fingerprint linkage, GraphQL/Admin read exposure for recent
  retention retry audit insertion fenced by latest failed cleanup source
  evidence, forwarding retry/dead-letter history, operator replay for dead-lettered
  forwarding rows through fresh queued rows with source evidence and source-row
  snapshot CAS,
  transfer-event delete restriction
  while parent authorizations still exist, forwarding-event delete restriction
  while parent authorizations still exist, download authorization
  delete restriction while parent bundles still exist, GraphQL/Admin read
  exposure for recent transfer-event history, DB-enforced child workspace
  snapshot coherence for audit events and download authorizations,
  DB-enforced manifest identity coherence, DB-enforced download authorization
  manifest snapshot write checks, DB-enforced archive authorization artifact
  snapshot write checks, DB-enforced append-only audit event content evidence,
  DB-enforced lifecycle-aware request and download authorization evidence
  update restrictions, DB-enforced support bundle request lifecycle immutability
  for retention windows and terminal status/failure fields, DB-enforced
  download authorization lifecycle transitions for downloaded/expired terminal
  states, DB-enforced request creation/archive/retention audit-history
  requirements, DB-enforced download authorization issue/download/expiration
  audit-history requirements, DB-enforced audit event delete restriction while
  parent bundles still exist, and an
  internal transfer evidence boundary that rejects self-reported provider
  signatures from JSON payload bodies, accepts upstream provider signature
  evidence only from server-owned verified forwarding headers, rejects
  incomplete upstream provider evidence, rejects non-object-created S3/R2
  wrapper events, provides a generic HMAC-verified production webhook ingress
  that derives server-owned `verified_by_upstream` evidence before durable
  forwarding, preserves signed-URL expiry audit history even when the caller
  receives an expired-error response, and bounded workspace list filters for
  locating transfer forwarding rows by status or durable locator evidence.
  Deployment-specific provider signature adapters, environment rollout,
  dead-letter alerting, and broader cross-workspace forwarding-history search
  remain separate operational slices.

## Non-goals For First Slice

- cross-workspace bundle federation.
