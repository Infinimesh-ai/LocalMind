# LocalMind MCP Tool Reference

This reference describes `localmind-ai` version `3.2.0`. `tools/list` is the
authoritative JSON Schema source.

## Tools

### `delegate_to_localmind`

Delegates one complete natural-language task to LocalMind's built-in AI.

Input:

| Field            | Type     | Required | Constraint                                      |
| ---------------- | -------- | -------- | ----------------------------------------------- |
| `request`        | string   | yes      | Trimmed, 1 to 12,000 characters                 |
| `documentIds`    | string[] | no       | At most 20 workspace document ids; default `[]` |
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
web search/crawl, document composition, and section editing. Each underlying
tool keeps its normal LocalMind permission and deployment checks. For example,
document creation requires `Workspace.CreateDoc`, document reads and writes
require the corresponding live document ACL, keyword search requires the
indexer, and web tools require their configured provider. The delegation input
currently supplies document ids but no AI Chat attachment session, so an
attachment read without such context returns the tool's normal missing-context
error.

The tool loop is bounded to 20 recorded executions and 120 seconds. It polls
durable cancellation and credential/workspace authority while running, and
persists only sanitized summaries, argument fingerprints, referenced document
ids, and created/updated document artifacts. A document created by a delegated
task uses a stable id derived from the task and title, making a same-task replay
idempotent instead of creating duplicate documents.

Successful MCP tool calls contain readable text and the same logical object in
`structuredContent.result`. A permission or unsupported result is a normal
structured task outcome. Invalid arguments set `isError: true`; unexpected
internal failures are redacted.

Every delegation result includes `taskId`. It is the durable delegation request
id and remains stable before planning, during execution, and after completion.
`requestId` remains as a backward-compatible alias.

### `get_localmind_task`

Reads one persisted task without invoking the LocalMind AI or changing task
state.

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
`Workspace.Copilot`, and `Doc.Read` for every referenced document. Lost ACL
returns a direct query error and does not expose historical results.

### `control_localmind_task`

Cancels one unfinished delegated task. This tool has no approval or rejection
operation.

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

| Method       | Result                                    |
| ------------ | ----------------------------------------- |
| `initialize` | Protocol version and tools capability     |
| `ping`       | Empty success object                      |
| `tools/list` | The three AI delegation/task tool schemas |
| `tools/call` | Text plus the structured tool result      |

MCP Resources are not advertised. Protocol versions `2024-10-07`,
`2024-11-05`, `2025-03-26`, `2025-06-18`, and `2025-11-25` are accepted.
JSON-RPC batching is rejected for post-2025-03 versions; notifications return
HTTP 202 when there is no response message.
