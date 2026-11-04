# LocalMind MCP Tool Reference

This reference describes `localmind-ai` version `3.5.0`. `tools/list` is the
authoritative JSON Schema source.

## Tools

### Tool selection rules

The LocalMind tools are scoped to requests directed to LocalMind and must not be
used as a global request router. A request is directed to LocalMind when the
user explicitly asks LocalMind to answer or act, or when the operation requires
LocalMind-managed documents, attachments, workspace resources, tasks,
connected data, or another LocalMind-specific capability. Merely mentioning,
discussing, configuring, or troubleshooting LocalMind does not trigger a call
unless the user asks LocalMind to execute work.

The tools must not intercept, reroute, delay, or otherwise affect ordinary
conversations or native workflows in Codex, Claude, or other host agents. For
requests directed to LocalMind, MCP clients should apply the most specific
matching intent first:

1. If the user only asks for the status, progress, or final result of an
   existing task and its `taskId` is known from `delegate_to_localmind`, call
   `get_localmind_task` directly. Do not delegate first or create/guess an id.
2. If the user explicitly asks to stop or cancel an unfinished existing task,
   call `control_localmind_task` directly with its known `taskId`. Do not
   delegate first.
3. Query a direct `operationId` through `workspace_operation_get`.
4. Use granted `workspace_*` direct tools for prepared content and explicit resource
   operations. Use `delegate_to_localmind` when interpretation, generation or a
   multi-step task is explicitly delegated to LocalMind AI.
5. Include delegated local files in `attachments`, or reuse prior same-family
   delegation files through `attachmentIds`.

Capability, permission, version, and unsupported-content failures must not be
bypassed by switching a direct request to delegation. Discover the actual subset
with `tools/list`. Direct `operationId` and AI `taskId` are separate identities.

### `delegate_to_localmind`

Starts one complete natural-language task with LocalMind's built-in AI. This is
the public entry for work explicitly delegated to LocalMind AI. Use it only for requests directed to LocalMind as defined above, never as
the host agent's global request router. Do not use it for existing-task status,
result, or cancellation requests; those route directly to
`get_localmind_task` or `control_localmind_task`. Follow-ups that request
additional work, revisions, continuations, and retries are submitted here.

Input:

| Field            | Type         | Required | Constraint                                      |
| ---------------- | ------------ | -------- | ----------------------------------------------- |
| `request`        | string       | yes      | Trimmed, 1 to 12,000 characters                 |
| `documentIds`    | string[]     | no       | At most 20 workspace document ids; default `[]` |
| `attachments`    | attachment[] | no       | At most 8 inline files; default `[]`            |
| `attachmentIds`  | string[]     | no       | Earlier delegated attachment ids; default `[]`  |
| `idempotencyKey` | string       | yes      | Trimmed, 1 to 256 characters                    |

Each inline attachment contains `fileName`, optional `mimeType`, and strict
base64 bytes. One decoded file may be at most 10 MiB, and all attachments used
by a task may be at most 20 MiB combined. The server stores inline bytes through
workspace Blob quota enforcement and persists immutable filename, MIME, size,
Blob key, and SHA-256 evidence before planning.

The same idempotency key in one workspace and credential family returns the
same persisted request and attachment ids only when the normalized request and
file evidence match. Reusing it for different input returns
`idempotency_conflict`.

Current planner results:

| Kind               | Behavior                                                        |
| ------------------ | --------------------------------------------------------------- |
| `answer`           | Persists a completed record-only AgentRun and returns text      |
| `document_update`  | Queues the optimized one-document replacement AgentRun          |
| `tool_agent`       | Queues LocalMind AI with the normal AI Chat server-side tools   |
| `unsupported_task` | Returns an honest unsupported result without claiming an effect |

`document_update` can target only one id supplied in `documentIds`. LocalMind
reads only documents allowed by the delegated user's current ACL and treats all
document content as untrusted data.

`tool_agent` can use the same server-side tool categories registered for AI
Chat: attachment read, code artifact generation, conversation summary,
document read/create/update/title update, keyword and semantic document search,
web search/crawl, document composition, section editing, and workspace folder
organization. Folder organization includes list/create/rename/move/delete and
adding or moving readable documents. Lists require `Workspace.Organize.Read`,
mutations require `Workspace.Sync`, and document placement also requires
`Doc.Read`. Recursive folder deletion removes folder records and placements,
not document content. Each underlying tool keeps its normal LocalMind
permission and deployment checks. For example, document creation requires
`Workspace.CreateDoc`, keyword search requires the indexer, and web tools
require their configured provider. Task attachments are materialized without
creating an AI Chat session. Parseable documents contribute at most 24,000
extracted characters across the task; provider-native media and unsupported
parser formats are supplied as bounded bytes. A task accepts at most eight
attachments and 20 MiB combined. Planning and worker execution both reread the
Blob and verify its size and SHA-256 evidence before use.

The tool loop is bounded to 20 attempted executions and a configurable 300-second total deadline. It polls
durable cancellation and credential/workspace authority while running, and
persists only sanitized summaries, argument fingerprints, referenced document
ids, created/updated document artifacts, and allowlisted workspace-folder
effects. A timeout is exposed as retryable `tool_agent_timeout` even if abort
causes the provider stream to close normally. For one supplied document, an
explicit body mutation carries a v3 completion contract and must record both a
successful `doc_update` and a matching updated artifact; otherwise the task
fails with retryable `required_side_effect_missing`. A document created by a
delegated task uses a stable id derived from the task and title, making a
same-task replay idempotent instead of creating duplicate documents.
Idempotent folder replays are not recorded as new side effects.

Successful MCP tool calls contain readable text and the same logical object in
`structuredContent.result`. A permission or unsupported result is a normal
structured task outcome. Invalid arguments set `isError: true`; unexpected
internal failures are redacted.

Every delegation result includes `taskId`. It is the durable delegation request
id and remains stable before planning, during execution, and after completion.
`requestId` remains as a backward-compatible alias. `attachmentIds` contains
the normalized immutable attachment ids and can be passed to a later delegation
in the same credential family without resending the bytes.

### `get_localmind_task`

Reads one persisted task after `delegate_to_localmind` has returned its
`taskId`, without invoking the LocalMind AI or changing task state. Use it when
the user asks for that task's status, progress, or final result. It must not be
used for follow-ups that request additional work, revisions, continuations, or
retries, and its `taskId` is not a document id. Never create or guess a task id.

Input:

| Field               | Type    | Required | Constraint                               |
| ------------------- | ------- | -------- | ---------------------------------------- |
| `taskId`            | string  | yes      | Trimmed, 1 to 512 characters             |
| `knownStateVersion` | string  | no       | Previously returned version, at most 128 |
| `waitMs`            | integer | no       | `0` to `30000`; default `0`              |

When `knownStateVersion` matches and `waitMs` is positive, LocalMind waits for
a state change or timeout. `changed=false` means the task was unchanged at the
end of that wait. Nonterminal responses include `pollAfterMs`.

The success projection uses `protocolVersion=localmind.task.v1` and returns:

- lifecycle `status`, `terminal`, `phase`, timestamps, and `stateVersion`;
- the immutable sanitized plan snapshot;
- current allowlisted step summaries, never raw AgentStep output;
- legacy approval state when reading an older persisted task; new tasks return
  `approval=null`;
- an allowlisted final result and LocalMind artifact references;
- a bounded public error for terminal failures.

Public lifecycle statuses are `planning`, `waiting_approval`, `queued`,
`running`, `cancelling`, `completed`, `failed`, `rejected`, and `cancelled`.
Specific causes such as `unsupported_task`, `permission_denied`,
`resource_version_conflict`, `tool_agent_timeout`, or
`required_side_effect_missing` appear under `error.code` rather than becoming
new lifecycle states. `availableControls` contains `cancel` only while the task
can accept a new cancellation request.

Only the credential family that created a task can query it. Rotation preserves
family access; another family receives `task_not_found`. LocalMind rechecks
credential-family activity, the task's frozen `get_localmind_task` permission,
`Workspace.Copilot`, `Doc.Read` for every referenced document, and
`Workspace.Blobs.Read` plus family/actor/workspace binding for every task
attachment. Lost ACL returns a direct query error and does not expose historical
results.

### `control_localmind_task`

Cancels one unfinished delegated task only when the user explicitly requests
cancellation. This tool cannot start, approve, reject, retry, resume, query,
create, or edit work.

Input:

| Field            | Type   | Required | Constraint                   |
| ---------------- | ------ | -------- | ---------------------------- |
| `taskId`         | string | yes      | Trimmed, 1 to 512 characters |
| `action`         | string | yes      | Must be `cancel`             |
| `idempotencyKey` | string | yes      | Trimmed, 1 to 256 characters |
| `reason`         | string | no       | Trimmed, 1 to 500 characters |

Queued AgentRuns are cancelled immediately. A leased running AgentRun records
a cooperative cancellation request and returns
`outcome=cancellation_requested`, `taskStatus=cancelling`, and a non-null
`pollAfterMs`; use `get_localmind_task` until the worker records terminal
`cancelled` state. Already terminal work returns `outcome=not_cancellable`.

Control requests are persisted. Replaying the same idempotency key with the
same normalized request returns the original result with
`idempotentReplay=true`; different request evidence returns
`idempotency_conflict`. Only the task's creating credential family can control
it. LocalMind rechecks family activity, the task's frozen
`control_localmind_task` permission, and live `Workspace.Copilot`. Cancellation does
not require `Doc.Update`, so a task can still be stopped after its target write
permission is lost.

Immediate and cooperative terminal cancellation queues a signed
`task_cancelled` notification when the credential family has a result
notification endpoint.

## Result Notifications

When the credential family has a result notification URL, LocalMind sends an
HTTP `POST` after an asynchronous task reaches a terminal state. The URL is
optional and never gates task execution.

Headers:

| Header                    | Value                                                |
| ------------------------- | ---------------------------------------------------- |
| `Content-Type`            | `application/json`                                   |
| `X-LocalMind-Event`       | `task_completed`, `task_failed`, or `task_cancelled` |
| `X-LocalMind-Delivery-Id` | Durable outbox delivery id                           |
| `X-LocalMind-Timestamp`   | Unix time in milliseconds                            |
| `X-LocalMind-Signature`   | `sha256=<hex HMAC>`                                  |

The signature input is `<timestamp>.<exact raw JSON body>`. The callback
receiver should validate the HMAC with the one-time callback secret and reject
stale timestamps and replayed delivery ids.

Each body uses `version=localmind-mcp-callback/v1` and includes `event`,
`requestId`, terminal `status`, and the allowlisted task `result`. Delivery is
backed by a durable outbox with worker leases and bounded retries. Without a
notification URL, callers use `get_localmind_task` to observe completion.

## Protocol Methods

| Method       | Result                                      |
| ------------ | ------------------------------------------- |
| `initialize` | Protocol version and tools capability       |
| `ping`       | Empty success object                        |
| `tools/list` | The four attachment/delegation/task schemas |
| `tools/call` | Text plus the structured tool result        |

MCP Resources are not advertised. Protocol versions `2024-10-07`,
`2024-11-05`, `2025-03-26`, `2025-06-18`, and `2025-11-25` are accepted.
JSON-RPC batching is rejected for post-2025-03 versions; notifications return
HTTP 202 when there is no response message.

## Direct resource tools

These ten tools use `contractVersion: "localmind-resource-mcp/v1"` and
`structuredContent.result`. They do not invoke models, require BYOK, or create
AI tasks. `LOCALMIND_MCP_RESOURCES_ENABLED` defaults to false; enable it after
applying the migration. Each tool also needs its own explicit capability.
`workspace_operation_get` stays available for authorized reconciliation when the
flag is off. Existing credentials and default capability sets remain unchanged.

| Tool                             | Input (all objects strict, camelCase)                                           | Successful result                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `workspace_doc_list`             | `folderId?`, `externalId?`, `cursor?`, `limit?`                                 | `items`, `nextCursor`; document metadata, visible locations, version, URL                             |
| `workspace_doc_keyword_search`   | `query`, `limit?`                                                               | `items` with bounded plain-text summaries, `retrievalMode`, `partial`, `coverage`, `reason`           |
| `workspace_doc_read`             | `documentId`                                                                    | Complete Markdown `content`, title, type, version, locations, URL, `contentWritable`, optional reason |
| `workspace_doc_create`           | `title`, `content`, `folderId?`, `externalId?`, `idempotencyKey`                | Document/folder IDs, document/directory versions, URL                                                 |
| `workspace_doc_update`           | `documentId`, `content`, `expectedVersion`, `idempotencyKey`                    | Document ID, visible locations, version, URL                                                          |
| `workspace_doc_update_meta`      | `documentId`, `title`, `expectedVersion`, `idempotencyKey`                      | Document ID, visible locations, version, URL                                                          |
| `workspace_folder_list`          | `parentId?`, `cursor?`, `limit?`                                                | `items` with folder IDs, titles and rights, `directoryVersion`, `nextCursor`                          |
| `workspace_folder_create`        | `title`, `parentId?`, `expectedDirectoryVersion`, `idempotencyKey`              | Folder/parent IDs, directory version                                                                  |
| `workspace_folder_move_document` | `documentId`, nullable `folderId`, `expectedDirectoryVersion`, `idempotencyKey` | Document/folder IDs, document/directory versions, URL                                                 |
| `workspace_operation_get`        | `operationId`                                                                   | Immutable historical receipt or a read-only processing observation                                    |

IDs and keys are 1–256 characters; titles are trimmed, 1–512; queries 1–128;
versions are opaque strings up to 2048 characters. `content` is exactly
`{ "format": "markdown", "text": "..." }` with a 1 MiB UTF-8 limit. Empty text
is valid. All nested objects reject unknown fields, including client-supplied
actor, workspace, source, or approval fields. The HTTP JSON limit is 32 MiB,
allowing escaping and the wrapper around a 1 MiB body.

Lists default to 50 and cap at 100; keyword search defaults to 10 and caps at 20.
Document lists inspect at most 200 candidates per page; continue even after an
empty page when `nextCursor` is non-null. Directory cursors bind their revision
and fail with `cursor_stale` after a change. Cursors are encrypted/authenticated
and bind the actor, workspace and filters; every page checks current ACL.
Folder IDs sort in ascending UTF-16 code-unit order. Documents sort by update
time descending, then ID in the same ascending order. Both cursor types carry
an authenticated sorting version; cursors from the previous ordering fail with
`cursor_stale`. Discard a stale cursor and restart from the first page. Pagination
does not provide a snapshot across requests.
These listing orders do not reorder folder entries. Users arrange daily logs by
date manually in the UI; MCP does not provide a date-reordering operation.
Omitted document `folderId` means all readable untrashed documents; null means
root, excluding placements hidden by directory permissions. Omitted creation
`folderId` or `parentId` means root. Moving removes every prior placement and
keeps exactly one target placement; null removes all placements. Any uneditable
source placement rejects the entire move.

Markdown body replacement is limited to structures verified by a lossless native
round trip: ordinary paragraphs, headings, lists, emphasis, links and code blocks
that pass the check. Code block support requires the updated native addon. Images,
HTML, tables, embedded blocks and unsupported structures fail closed. Reads may
return `contentWritable: false`; oversized complete reads return `content_too_large`
rather than truncating. Listing metadata and moving do not require a writable body.

All five writes require `idempotencyKey`. Their success receipts include
`operationId`, `toolName`, `workspaceId`, `status: "succeeded"`, `changed`,
`replayed`, and `writeOutcome: "committed"`. A no-op preserves the version.
Creation commits content, root registration, metadata, placement, external binding,
receipt and outbox atomically. Versions include committed pending Yjs updates;
compare-and-write and normal sync participate in the same content lock.
The authoritative read budget is 32 MiB of encoded state and 10,000 input records;
exceeding it fails closed. Root metadata is bounded to 10,000 documents.

`externalId` is unique within workspace/credential family, independent of the
idempotency key. Rotation preserves both namespaces. New keys cannot overwrite
an existing binding. Unreadable or trashed targets return `resource_not_found`;
permanent deletion preserves a tombstone. New credential families are independent.

Domain failures set `isError: true` and return `error.code` with
`writeOutcome: "none"`. Codes: `invalid_input`, `capability_denied`,
`resource_not_found`, `permission_denied`, `version_conflict`,
`directory_version_conflict`, `cursor_stale`, `idempotency_conflict`,
`external_id_conflict`, `folder_name_conflict`, `unsupported_document_kind`,
`unsupported_document_structure`, `content_too_large`, `quota_exceeded`,
`rate_limited`, `operation_not_found`, `temporarily_unavailable`.
Version conflicts may include `error.currentVersion`. Endpoint authentication,
throttling and malformed JSON-RPC retain the existing HTTP/protocol errors.

After disconnection or unknown commit outcome, reuse the original key and identical
arguments, or query the returned operation ID. `processing/needs_reconciliation`
means `writeOutcome: "unknown"` and includes `pollAfterMs`; it is not a failure
or permission to create a new identity. Queries never run, cancel, or retry work.
A process crash releases the transaction execution lock; the original request can
safely recover an uncommitted operation. Committed receipts are replayed before
checking the original expected version. Replay/query verifies the same actor,
workspace and family plus current read permissions for resources and historical
locations. Outbox delivery retries cannot rewrite a committed result.

Example create arguments (IDs are placeholders):

```json
{
  "title": "2026-09-16 工作日志",
  "content": { "format": "markdown", "text": "## 完成\n\n- 完成测试。\n" },
  "folderId": "folder_example",
  "externalId": "daily-log/member-02/2026-09-16",
  "idempotencyKey": "daily-log-member-02-20260916-create-001"
}
```

Read with `workspace_doc_read`, then submit the complete revised content and its
returned version to `workspace_doc_update` using a new logical request key.
The effective page/canvas mode comes from `docProperties.primaryMode`, with
non-null current properties taking precedence over legacy root properties.
Canvas documents report `contentWritable: false`; body replacement fails with
`unsupported_document_kind`. A mode change invalidates a previously read
document version and may instead return `version_conflict`. Title updates remain
available under their existing permissions and version checks.
These v1 tools never create Projects, import/publish Project resources, change ACL,
delete resources, or expose internal arbitrary-tool execution.

## Native document tools (v2)

These 18 tools use `contractVersion: "localmind-document-mcp/v2"` and the same
`structuredContent.result` envelope. They are additional, individually granted
capabilities under `LOCALMIND_MCP_RESOURCES_ENABLED`. Native v2 writes additionally
require `LOCALMIND_MCP_DOCUMENT_EDITING_ENABLED=true` (default false). Turning off
only this second flag retains authorized reads, previews and receipt queries;
v1 and delegated capabilities keep their existing switches. The server derives the
Workspace and actor from the credential. No tool accepts an alternate actor or
executes a model. The v1 tools above retain their compatibility contract.

| Tool                              | Purpose and required version inputs                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_doc_inspect`           | Native blocks or version-bound Office state/file chunks; `resource: {kind, id}`, optional `expectedVersion`, `offset`, `limit`                        |
| `workspace_doc_edit_preview`      | Validate the same request as apply, without publishing content, metadata, comments, history or notifications; returns `digest` and planned identities |
| `workspace_doc_apply`             | Apply a typed native batch with `expectedVersion`, `idempotencyKey`, optional `planDigest`                                                            |
| `workspace_doc_create_native`     | Create an independent BlockSuite, Office or WorkspaceFile resource at an explicit destination                                                         |
| `workspace_doc_import`            | Import an authorized Blob in its native resource format, or restore a signed `native-bundle` with its proof                                           |
| `workspace_doc_export`            | Read `native-content` or a version-bound `native-bundle` in bounded chunks                                                                            |
| `workspace_doc_duplicate`         | Copy within the credential Workspace, with explicit destination and comment policy; checks source copy and target creation rights                     |
| `workspace_doc_properties_update` | Title, icon, tags, mode and declared custom properties, with both content and metadata versions                                                       |
| `workspace_doc_history_list`      | List immutable resource revisions/history with bounded pagination                                                                                     |
| `workspace_doc_history_read`      | Read a selected historical version under current access permissions                                                                                   |
| `workspace_doc_history_restore`   | Create a new commit from history against the current version; never overwrite evidence                                                                |
| `workspace_doc_asset_read`        | Read an authorized Blob with resource context, version, byte offset and fingerprint                                                                   |
| `workspace_doc_asset_upload`      | Begin, part, status, commit or abort a bounded upload; scope includes resource, user and credential family                                            |
| `workspace_doc_comments_read`     | Read version-bound threads or replies, including attached/orphaned anchor state                                                                       |
| `workspace_doc_comments_apply`    | Create, edit, resolve, reopen or delete threads/replies, with content and comments versions                                                           |
| `workspace_doc_lifecycle`         | Explicit trash, restore or permanent deletion; first inspect `view: "lifecycle"` with the same action                                                 |
| `workspace_doc_access_read`       | Read document sharing/membership or the inherited-directory policy for native resources                                                               |
| `workspace_doc_access_update`     | Explicit BlockSuite document sharing, member, default-role or ownership changes; each operation checks its own management ACL                         |

`resource.kind` is `blocksuite`, `office` or `file`. Asset upload additionally
accepts `{kind: "workspace", id: "<endpoint Workspace ID>"}` with
`expectedVersion: "workspace-staging/v1"`, under Workspace create/blob permissions.
This allows the first file or Office import without creating a placeholder page.
Use `status` with the upload ID and a fresh idempotency key to recover the exact
received part numbers and byte count; upload identity remains bound to the actor
and credential family. Native Office/file resources
inherit their existing directory access contract; this API does not invent an
independent ACL for them. Use `workspace_operation_get` to reconcile an uncertain
write. A successful or failed terminal receipt is immutable. Reuse the original
key and identical request after a lost response or `needs_reconciliation`; do
not create a duplicate resource as recovery. Changed input requires a new key.

### Native command and preservation contract

BlockSuite commands address existing block/element/row/column IDs. New IDs use
`clientRef`; subsequent commands refer to them as `$<clientRef>`. Each command
has a unique `opId`; coordinates are evaluated sequentially after preceding
commands. Text offsets are UTF-16 offsets restricted to grapheme boundaries.
Read `adapterManifest` and per-block `capabilities.properties` from inspect:
editable fields, dedicated domain operations, source evidence and opaque fields
are distinguished. Diagnostics name unsupported schema versions or opaque fields
without discarding them. The browser registry test checks all 29 current block
models, seven surface kinds, and the LocalMind database extensions.

The native command families cover text splice/format, split/merge/type conversion,
block properties/creation/move/delete, table axes and rectangular cells, database
columns/rows/cells/views, typed references/assets, and canvas elements, strokes,
connectors, groups, frames and mindmaps. Database attachments and members use
`database.cell.files.set` and `database.cell.members.set`; creation evidence is
server-maintained. Mindmap styles and layout share the editor implementation;
shape bounds remain explicit native geometry, with no server-side font guessing.
AI-chat/session and transcription-job provenance is retained; transcript content
in its native child blocks remains editable. The current document model has no
independent cover field; one is not fabricated in the MCP metadata schema.

`markdown.rewrite` compiles a selected subtree into these same native commands.
Supply `parentId`, `selectedBlockIds`, `mode`, `markdown`, `marksPolicy`, and
`mappings: [{path, blockId, rowIds?, columnIds?}]`. Paths identify projected
Markdown nodes, not positions in the stored document. A mapped table requires
explicit row/column IDs; `null` creates an axis. `update_preserve` retains omitted
objects; `replace_selected` explicitly replaces the selected contiguous scope.
Unknown formatting and comment markers on surviving characters stay intact.
Code fences and inline code stay literal. Unsupported HTML/inline objects,
unrepresentable per-column alignment or ambiguous mapping fail before commit.
Use native commands for structures that Markdown cannot represent.

`workspace_doc_apply` can additionally include:

```json
{
  "metadata": {
    "expectedMetadataVersion": "<inspect.metadata.version>",
    "properties": { "title": "Updated title" }
  },
  "comments": {
    "expectedCommentsVersion": "<comments-read version>",
    "commands": [
      {
        "opId": "new-thread",
        "type": "comment.create",
        "clientRef": "thread",
        "content": {
          "version": "localmind-blocksuite-comment/v1",
          "paragraphs": [[{ "insert": "Review this change" }]]
        },
        "anchor": { "kind": "document" }
      }
    ]
  }
}
```

Omit unused companions; a supplied comments array must contain a valid command.
Each companion requires its own credential capability and live ACL. Body,
metadata, comments, directory changes associated with the operation, revision,
receipt and notification outbox commit in one database transaction. A comment
anchor may refer to a newly created `$clientRef`; returned comment identities use
`comment:<clientRef>`. Previews return stable planned IDs without writing.

Office apply accepts the product's strict `localmind-office-command-batch/v1`
with `source: "user"`, matching artifact and expected revision. It uses the native
DOCX/XLSX/PPTX/PDF engines and retains independent stored-state fields. Positional
identity ambiguity with opaque state fails with `preservation_failed`; it never
moves annotations or unknown fields onto a guessed object. PDF visual overlays
and signature appearances retain the native engine's declared limitations and
are not represented as secure content removal or digital signatures.

File apply supports byte-preserving text splices, JSON structural edits, CSV
cells/axes, or explicit whole-file replacement from an authorized Blob. Untouched
encoding, BOM, newlines and lexical formatting are retained by the file engine.
Office packages, native file revisions and BlockSuite pages remain separate
resource models throughout import, editing, duplication and history restore.

### Completeness, archives and resource limits

Pagination binds content, comments, access or archive versions as applicable.
Never treat `scopeCoverage: "paginated"` as the complete document. Native fields
not interpreted by the current adapter remain in the stored document and signed
bundle; they are not arbitrary patch paths. References are not expanded into
private target contents. A preview digest also binds referenced resource/member
versions; dependency drift returns `plan_stale` and requires another preview.

A native bundle retains native content, independently stored Office state,
metadata/definitions, assets, comments and comment attachments. It carries an
instance signature; unsigned arbitrary Yjs/metadata is not an import format.
Restore currently targets the same Workspace on the signing instance. Another
member must have current source copy/read permissions; provenance remains the
original author's. New resource and global comment IDs are returned as explicit
mappings; local block IDs retain document-local identity. ACLs are not copied.
Definition drift and missing author/asset identities are explicit failures.
Cross-format lossy conversion is not advertised as a native round trip.

Current bounded limits include 1,000 native commands (10,000 compiled commands),
200 inspect items per page, an 8 MiB inspect response, 32 MiB archive/asset reads,
512 KiB upload parts, eight pending uploads/32 MiB per actor and sixteen/64 MiB
per Workspace. Pending uploads expire after 24 hours. Physical object staging
uses an independent durable journal (256 unreferenced objects/256 MiB per
Workspace), with delayed, reference-aware cleanup and retry on storage failure.
The database commit does not claim to atomically commit external storage bytes.
Comment notifications use an outbox, bounded recipient continuation and durable
per-recipient delivery identity. Retrying delivery does not recreate notifications
or reset read state; recipient ACL is checked again at delivery time.

Implementation and observed acceptance results are recorded in
[the v2 execution record](./ai-modernization/mcp-document-full-editing.execution.zh-CN.md).
These source contracts do not indicate that a running deployment has been upgraded.
