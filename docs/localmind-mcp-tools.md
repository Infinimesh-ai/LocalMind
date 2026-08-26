# LocalMind MCP Tool Reference

This reference describes `localmind-ai` version `3.3.0`. `tools/list` is the
authoritative JSON Schema source.

## Tools

### Tool selection rules

MCP clients should route calls as follows:

1. When a new request includes local files, call
   `upload_localmind_attachment` once for each file.
2. Every new user request starts with `delegate_to_localmind`. This includes
   questions, summaries, document reads/searches/creates/updates/renames, web
   research, attachment processing, and multi-step workspace work. Pass the
   uploaded ids in `attachmentIds`.
3. `get_localmind_task` is only for a `taskId` already returned by
   `delegate_to_localmind`. It cannot start or retry work.
4. `control_localmind_task` is only for an explicit user request to cancel an
   unfinished delegated task. It supports no other action.

The caller must not search for low-level tools such as `doc_create` or
`doc_read`. Those tools are internal to LocalMind AI; the public caller submits
the complete task through `delegate_to_localmind`, and LocalMind chooses the
internal tools.

### `upload_localmind_attachment`

Uploads one immutable, task-bound file before delegation. The returned
`attachmentId` can be used only by the same workspace, delegated user, and MCP
credential family.

Input:

| Field            | Type   | Required | Constraint                                 |
| ---------------- | ------ | -------- | ------------------------------------------ |
| `fileName`       | string | yes      | Trimmed, 1 to 512 characters               |
| `mimeType`       | string | no       | 1 to 256 characters; octet-stream default  |
| `base64`         | string | yes      | Strict base64; decoded size at most 10 MiB |
| `idempotencyKey` | string | yes      | Trimmed, 1 to 256 characters               |

The tool requires the frozen `upload_localmind_attachment` capability plus
live `Workspace.Copilot` and `Workspace.Blobs.Write`. It stores the bytes
through workspace Blob quota enforcement and persists immutable filename, MIME,
size, Blob key, and SHA-256 evidence. Replaying the same key with identical
evidence returns the same `attachmentId` and `idempotentReplay=true`; different
evidence returns `idempotency_conflict`.

### `delegate_to_localmind`

Starts one complete natural-language task with LocalMind's built-in AI. This is
the only public MCP tool that starts new work.

Input:

| Field            | Type     | Required | Constraint                                      |
| ---------------- | -------- | -------- | ----------------------------------------------- |
| `request`        | string   | yes      | Trimmed, 1 to 12,000 characters                 |
| `documentIds`    | string[] | no       | At most 20 workspace document ids; default `[]` |
| `attachmentIds`  | string[] | no       | At most 8 uploaded attachment ids; default `[]` |
| `idempotencyKey` | string   | yes      | Trimmed, 1 to 256 characters                    |

The same idempotency key in one workspace and credential family returns the
same persisted request only when the normalized request evidence matches.
Reusing it for different input fails closed.

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

The tool loop is bounded to 20 recorded executions and 120 seconds. It polls
durable cancellation and credential/workspace authority while running, and
persists only sanitized summaries, argument fingerprints, referenced document
ids, created/updated document artifacts, and allowlisted workspace-folder
effects. A document created by a delegated task uses a stable id derived from
the task and title, making a same-task replay idempotent instead of creating
duplicate documents. Idempotent folder replays are not recorded as new side
effects.

Successful MCP tool calls contain readable text and the same logical object in
`structuredContent.result`. A permission or unsupported result is a normal
structured task outcome. Invalid arguments set `isError: true`; unexpected
internal failures are redacted.

Every delegation result includes `taskId`. It is the durable delegation request
id and remains stable before planning, during execution, and after completion.
`requestId` remains as a backward-compatible alias.

### `get_localmind_task`

Reads one persisted task after `delegate_to_localmind` has returned its
`taskId`, without invoking the LocalMind AI or changing task state. It must not
be used for a new user request, and its `taskId` is not a document id.

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
Specific causes such as `unsupported_task`, `permission_denied`, or
`resource_version_conflict` appear under `error.code` rather than becoming new
lifecycle states. `availableControls` contains `cancel` only while the task can
accept a new cancellation request.

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
