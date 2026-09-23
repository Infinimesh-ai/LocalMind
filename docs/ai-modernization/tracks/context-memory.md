# Track: Context Memory

## Intent

Make Rule, Automatic Memory, rolling conversation summaries, and cross-session
recall scope-correct, permission-aware, trust-separated, and auditable before
adding more sophisticated extraction or retrieval.

## Shared Project Memory Remediation

The corrected 2026-09-21 [Workspace / Project context and session implementation plan](../workspace-project-context-session-remediation.zh-CN.md)
defines one shared Memory library per Project, available to current active members.
Conversation history, private attachments and rolling summaries remain private to
each owned session. Members manage their independent contributions; Owners manage
the shared library, with version checks and conflict handling for multi-author facts.
Project-level automatic capture is independent of Workspace settings and retains
source-sharing checks; a session may opt out of automatic contribution without
creating a personal Project Memory library.

This supersedes the earlier per-user Project Memory target. Legitimate multi-author
shared records are not contamination. Any data actually created under a private
contract must not become shared just by removing owner filters; migration status,
provenance and explicit publication of private records require separate checks.
The source implementation now includes Project-wide shared identity and recall,
contribution/conflict evidence, Owner/member management boundaries, Project and
session capture revisions, native Project context refresh, session authorization,
durable deletion tasks, and immutable checkpoint revisions. It also preserves
source authorization while preventing old private-contract rows from becoming
active shared memory automatically. Rolling checkpoint publication now uses a
persisted asynchronous task with stable deduplication identity, leases, takeover,
bounded retry, cancellation and strict CAS over the source prefix, session epoch,
current checkpoint, source ledger, Project context version, Project Memory revision
and live membership.
The task result is now a strict provider-neutral summary containing goals,
decisions, corrections, constraints, open work, source spans, receipts and
material coverage/omission evidence. Budgeting is conservative for CJK and tool
schemas, oversized messages are split without dropping the middle, and Project
documents support frozen-version range reads. Chat exposes persisted timeline
state, manual compaction, cancel/retry, token evidence and reconnect-safe
Project/session isolation.

Session deletion now records normalized Project Blob references and physically
deletes only session-exclusive objects after a final transaction recheck. Legal
hold immediately revokes session access but pauses destructive cleanup. Signed,
versioned private audit archives are read back and verified before hot deletion;
a signed recovery barrier replays session deletion, Memory isolation and source
grant revocation before application workers/read endpoints start after restore.
Content-free user/Admin status reports cleanup, hold, receipt and backup-retention
state.

This is not a production-deployment or full A01-A40 acceptance claim. Remaining
work includes production data classification, real database/object-store restore,
complete privacy scanning, authorized real-model summary evaluation, the browser
interaction matrix and runtime cutover evidence. The strict model path has mock
behavioral coverage but no real Project BYOK quality/cost/latency claim.

## Implemented Foundation

The 2026-09-16 [Workspace/Project AI 写入授权与工具作用域重构方案](../workspace-project-ai-write-authorization-remediation.zh-CN.md) supersedes the former actor-only destination policy for ordinary Workspace AI writes.
Owned Workspace conversations use live UI-equivalent ACL; sources remain bounded
provenance and never grant or deny Workspace write permission. Successful writes
record immutable `workspace-live-acl/v1` / `authorized_by_live_acl` evidence in
the same transaction as the domain mutation. Failed transactions cannot leave a
successful audit. Historical `shared-write-source/v1` rows retain their original
judgments and fingerprints, including former destination waivers.

Project source checks, original grant identity, attachment isolation and Project
Memory checks remain enforced. Source retrieval still requires current read
permission. Workspace tools cannot execute from Project conversations, and
Project publication requires the explicit native resource workflow. Historical
stage-two acceptance below describes the earlier policy, not an additional
Workspace write gate.

Current project selection rules are defined in
[Project AI Boundaries](project-ai-boundaries.md) and supersede the historical
v5 inference rules below. Project conversations use an explicitly selected,
active Project with current membership. Document-side conversations do not
inherit project grants or infer project memory from attached documents.
Generic semantic retrieval limits SQL candidates to personal ACL before
reranking; explicit project retrieval uses the server-resolved Project and
authorized source document IDs, then rechecks the scope before returning.
Conversation forks cannot transfer private or project history between users,
execution Workspaces, or Projects. Context GraphQL reads and mutations verify
live ownership, session deletion, Project membership/status and document-side
personal read permission before using cached attachment configuration.
Prompt preparation and personal semantic attachment search use the same owned
session lookup; attachment tools refresh that authorization and context on each
execution, including after attachments are removed.
Automatic project-memory capture also excludes private file/blob attachments,
invalid context configuration and any attached document outside current Project
grants, even if the actor can no longer read that document. Append-only session
source rows retain document references and private-attachment markers after
context clearing/removal and across forks. Legacy message history and source
overflow retain an unknown-source marker. The stage-two inventory above
supersedes the earlier partial message/tool provenance checkpoint; browser and
transport recovery evidence remains separately tracked from source enforcement.

LocalMind already persists private user-owned context records with user,
workspace, document, or project scope. Users can manage these records and the
Automatic Memory preference under **Workspace settings > AI context**.

The `context-planner/v5` slice adds the first production hardening layer:

- a single scope resolver combines the conversation's primary document with
  documents attached through AI Context;
- every candidate document is rechecked with `Doc.Read` before it can affect
  document or project memory visibility;
- active project membership is derived only from those readable documents;
- project context is enabled only when every readable document resolves to the
  same single active project;
- mixed, multi-project, and otherwise ambiguous document sets load no project
  memory;
- Automatic Memory writes to one unique project, one readable document, or the
  workspace only when no document is in scope;
- Automatic Memory capture is skipped when multiple readable documents do not
  resolve to one project, instead of copying into multiple projects or widening
  the record to workspace scope;
- the same resolved scope snapshot is used for recall and capture in a turn.

Planner v5 renders Rule, Automatic Memory, project summaries, and rolling
conversation summaries as a bounded synthetic `user` message immediately before
the latest user turn. This context is explicitly labeled untrusted and is no
longer coalesced into the primary system message. The immutable v1-v4 strategy
versions and fingerprints remain available for replay.

Every planned text turn now appends an `ai_context_plan_traces` record when the
session saves. A trace contains:

- strategy version and fingerprint;
- input, retained, omitted, candidate, and selected counts;
- selected memory ids, scope/kind, score, and rank;
- context character budget and usage;
- resolved document/project scope evidence;
- input and rendered-output fingerprints.

The trace intentionally excludes message, Rule, Memory, project summary, and
rolling summary text. AI Context strategy diagnostics expose aggregate trace
count and latest trace time without exposing per-turn private context.

The `context-planner/v6` slice builds the commercial-memory foundation on that
trust and scope boundary:

- the Memory Writer produces explicit `ADD`, `UPDATE`, `DELETE`, and `NOOP`
  decisions, with deterministic handling for direct remember/forget requests;
- memory rows carry fact keys, confidence, importance, validity and expiry,
  sensitivity, supersession, embedding, use count, and last-used evidence;
- each owner/scope retains at most 200 active Automatic Memory rows, evicting
  the least recently used rows when a write would exceed the quota;
- a disabled memory can be reactivated without violating the active-fact
  uniqueness contract or leaving conflicting active versions;
- authorized candidates are ranked with keyword and embedding similarity,
  temporal/confidence features, reranking, and MMR diversity;
- durable memory embeddings share the instance-wide 4096-dimensional
  embedding contract; the dimension migration retains memory text and scope
  while invalidating only incompatible legacy vectors, and the bounded
  embedding backfill restores eligible workspace-scoped memories;
- Rule is modeled independently with `always`, `relevant`, and `manual`
  application modes, priorities, conditions, immutable revisions, rollback,
  and hit records;
- workspace-enforced Policy is a separate layer from private user Rule and
  Automatic Memory;
- ambiguous document sets support an explicit project selection that is
  validated against the readable resolved scope;
- users can inspect, edit, disable, delete, undo, revise, and roll back the
  relevant context records from **Workspace settings > AI context**;
- the v6 evaluation smoke records extraction, DLP, retrieval, scope leakage,
  Rule interference, conflict priority, and latency metrics.

## Scope Contract

| Readable context                          | Project result | Recall/capture behavior                                                                           |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| No document                               | `none`         | User Rule plus workspace memory; new Automatic Memory may use workspace scope                     |
| One unassigned document                   | `none`         | User Rule, workspace memory, and that document's memory; new Automatic Memory uses document scope |
| One or more documents, all in one project | `single`       | User, workspace, document, and that one project scope; new Automatic Memory uses project scope    |
| Project and unassigned documents mixed    | `mixed`        | No project memory; multi-document Automatic Memory capture is skipped                             |
| Documents span multiple projects          | `ambiguous`    | No project memory; multi-document Automatic Memory capture is skipped                             |
| Document fails `Doc.Read`                 | excluded       | It cannot contribute document/project recall or capture scope                                     |

Without an explicit project selection, ambiguous cases still fail closed.
Selections are accepted only when the project is represented by the current
readable document set; an invalid or stale selection cannot widen visibility.

## Current Limits

The v6 foundation still has follow-up work before broad production rollout:

- implicit Automatic Memory extraction remains heuristic when no configured
  structured model extractor is available;
- DLP is intentionally fail-closed for known sensitive forms but is not a full
  enterprise classifier;
- local deterministic embeddings and reranking provide a stable fallback, but
  production Sparkclaw embedding/reranker quality and cost still require online
  evaluation;
- structured rolling summaries have source-level and mock-model coverage, but
  production-model quality, latency and cost have not been measured;
- traces support replay diagnostics but do not yet join answer-quality,
  user-feedback, and online experiment outcomes;
- scheduled expiry cleanup and large-corpus query performance still need
  production load validation beyond the write-time per-scope LRU quota.
- existing memories whose legacy vectors were invalidated continue to use
  lexical recall while the bounded 4096-dimensional backfill is pending or the
  configured embedding provider is unavailable.

## Next Vertical Slices

1. Replace heuristic implicit extraction with a configured structured model
   extractor while preserving the deterministic explicit-command path.
2. Add scheduled lifecycle cleanup and production-scale retrieval/load
   benchmarks around the existing per-owner/scope quota.
3. Connect Sparkclaw embedding/reranker providers behind the existing hybrid
   retrieval interfaces and add shadow evaluation before rollout.
4. Join planner traces with explicit user correction/undo and answer-quality
   outcomes without persisting sensitive prompt content.
5. Evaluate and tune model-generated structured rolling summaries with real
   Project BYOK while preserving provenance and conflict-safe refresh.
6. Add strategy shadowing, staged rollout, and online A/B controls after offline
   baselines are representative and benchmark-specific production rules are
   prohibited.

Do not introduce a knowledge graph before fact keys, temporal versioning, and
the evaluation suite show that multi-entity or multi-hop relations require it.

## Validation

Project tool reads and search results record cumulative source Workspace/document
pairs before content is returned to the model. Existing-document project writes
check that ledger both when requested and inside worker execution. Project
memory writer decisions with a source session recheck the ledger in the memory
transaction, including active owned project conversation membership. Private
attachments, unknown evidence and ungranted document sources reject the write.
The transaction also merges cumulative document sources into memory source
associations, so later grant revocation quarantines memories derived from sources
discovered after initial scope resolution. Empty or rejected scope never falls
back to a broader project-memory scope. Generated-document operations that
request addition to the current Project also recheck this ledger during location
confirmation and each execution revalidation. Independent snapshot copies use
their separate source copying/sharing authorization checks. This does not yet
establish complete provenance for all prompt inputs or all shared destinations;
document storage writes still lack an atomic authorization fence.

The inbound MCP surface no longer exposes direct AI Context tools. A future
LocalMind AI Context executor must use this track's DLP, scope authorization,
revision, rollback, and undo behavior instead of creating a parallel mutation
path.

The focused contract must cover:

- an attached project document resolving project memory outside a
  document-bound chat;
- revoked document permission excluding that document and its project;
- mixed and multi-project inputs loading no project memory;
- ambiguous multi-document inputs producing no Automatic Memory write unless a
  valid explicit project is selected;
- Planner v5 placing private context in `user`, not primary `system`;
- v4 replay preserving the previous system-context behavior and fingerprint;
- v6 fact-key conflict updates, expiry, supersession, reactivation, and undo;
- v6 Rule/Policy application modes, condition matching, priority, revisions,
  rollback, and hit traces;
- v6 authorized hybrid retrieval, MMR diversity, and scope leakage of zero;
- plan traces containing ids, scores, budgets, scope, and fingerprints without
  private context text;
- native-renderer baselines using natural durable cues for short retention,
  early/recent fact retention, rolling-summary creation, and cross-session
  recall under tight budgets.

Run the isolated Copilot typecheck, GraphQL generation, format/lint checks,
host scope/v6 smokes, Docker-focused Copilot tests, native v6/v5/v4 baselines,
and a disposable PostgreSQL migration check for changes to this track.
