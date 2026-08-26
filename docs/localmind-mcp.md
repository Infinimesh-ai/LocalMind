# LocalMind MCP Integration

LocalMind exposes a workspace-bound AI delegation surface to external MCP
clients. The caller sends a complete natural-language task; the built-in
LocalMind AI plans it, uses LocalMind's Agent Runtime for supported work, and
returns or calls back with the result. A task-bound upload tool supplies local
attachments to that AI, a read-only tool reconciles persisted task state after
asynchronous returns or callbacks, and a control tool cancels unfinished work.

A Simplified Chinese guide is available at
[LocalMind MCP Chinese Guide](./localmind-mcp.zh-CN.md). The exact tool schema
and callback contract are in
[LocalMind MCP Tool Reference](./localmind-mcp-tools.md).

## Connection Contract

| Setting        | Value                                                    |
| -------------- | -------------------------------------------------------- |
| Transport      | Stateless Streamable HTTP with JSON responses            |
| Endpoint       | `<LOCALMIND_BASE_URL>/api/workspaces/<WORKSPACE_ID>/mcp` |
| Method         | `POST`                                                   |
| Authentication | `Authorization: Bearer <MCP_TOKEN>`                      |
| Server         | `localmind-ai` version `3.3.0`                           |
| Tools          | Attachment upload, delegation, query, and cancel control |

The token and endpoint are bound to one workspace. A token issued for one
workspace cannot be used on another workspace endpoint.

## Create A Credential

1. Open **Workspace settings > Integrations > MCP Server**.
2. Create a credential and select the public AI tools it may call:
   `upload_localmind_attachment`, `delegate_to_localmind`,
   `get_localmind_task`, and `control_localmind_task`.
3. Grant all four for a caller that uploads files, delegates, reconciles, and
   cancels tasks.
4. Optionally add the caller's result notification URL for terminal task
   notifications.
5. Store the one-time MCP token and, when notifications are configured, the
   callback signing secret in the caller's secret storage.

Public callbacks must use HTTPS. A deployment may explicitly allowlist an
exact private or HTTP origin for a trusted local caller such as SparkClaw.
Redirects are not followed.

## Client Configuration

```json
{
  "mcpServers": {
    "localmind": {
      "type": "streamable-http",
      "url": "<LOCALMIND_BASE_URL>/api/workspaces/<WORKSPACE_ID>/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_TOKEN>"
      }
    }
  }
}
```

When the caller runs in a container, use a LocalMind host or service name that
is reachable from that container. Do not put either secret in a query string,
prompt, chat message, checked-in configuration, or diagnostic bundle.

## Tool Routing

Follow this decision rule exactly:

1. When a new task includes local files, call
   `upload_localmind_attachment` once per file and retain each returned
   `attachmentId`.
2. For every new user request, call `delegate_to_localmind` with the complete
   task. This includes questions, document reads/searches/creates/updates,
   attachment processing, summaries, web research, and multi-step work. Pass
   uploaded ids in `attachmentIds`.
3. Call `get_localmind_task` only with a `taskId` returned by
   `delegate_to_localmind`, to check status or obtain the final result. It does
   not start or retry work.
4. Call `control_localmind_task` only when the user explicitly asks to cancel
   an unfinished task. Its only action is `cancel`.

Do not look for public tools such as `doc_create` or `doc_read`. They are
internal AI Chat tools selected by LocalMind after delegation. `taskId` values
are task identifiers, while `documentIds` contains existing document ids, not
document titles.

## Authority Model

The MCP credential's selected public tool permissions are copied onto a task
when it is created. That snapshot is the task's fixed maximum authority. Rotating
the credential preserves the family, permissions, and callback configuration;
revoking the family or disabling the user prevents queued work from executing.
Credentials from the legacy resource-capability model are revoked
during migration and must be recreated.

Attachment upload requires live `Workspace.Copilot` and
`Workspace.Blobs.Write`. LocalMind separately checks the delegated user's real
ACL at planning and execution time. Losing `Workspace.Copilot`,
`Workspace.Blobs.Read`, `Workspace.CreateDoc`, `Doc.Read`, or `Doc.Update`
takes effect immediately for the operation that needs it.
Missing real ACL is returned as a permission or resource failure; LocalMind
never sends a request asking the caller to elevate the user.

Task queries require the frozen `get_localmind_task` permission, use the same
credential family that created the task, and recheck family activity plus live
`Workspace.Copilot`, referenced-document `Doc.Read`, and task-attachment
`Workspace.Blobs.Read` access. Rotation retains query access. A different
credential family receives `task_not_found`, and lost ACL does not reveal
historical task output.

Task cancellation also requires the creating credential family, family
activity, the task's frozen `control_localmind_task` permission, and live
`Workspace.Copilot`. It deliberately does not require `Doc.Update`: losing the
ability to write a target document must not prevent the caller from stopping
unfinished work.

## Supported Tasks

The current built-in AI can:

- return a read-only answer from the request and explicitly supplied readable
  document snapshots;
- use the optimized Agent Runtime path to replace the Markdown body of exactly
  one supplied document;
- read up to eight task-bound uploaded attachments and use them when answering,
  composing, or creating a LocalMind document;
- run LocalMind's normal AI Chat server-side tool set for broader work:
  document read/create/update/title update, keyword and semantic search, web
  search/crawl, document composition, section editing, code artifact
  generation, conversation summarization, workspace folder organization, and
  attachment reading from the delegated task context. Folder
  organization supports list/create/rename/move/delete and adding or moving a
  readable document; recursive deletion never deletes document content.

The tool-agent path has a 120-second bound, records at most 20 tool executions,
polls cancellation and authority while running, and returns sanitized result
and document-artifact evidence. Delegated document creation is idempotent for
the same task and title. Folder mutations enforce workspace organization/write
ACLs, require document read access for placements, and persist sanitized
side-effect evidence only for non-replay writes.

Each uploaded file is limited to 10 MiB; one task accepts at most eight files
and 20 MiB combined. Upload records are immutable and bound to the workspace,
delegated actor, and credential family. Planning and worker execution reread
the Blob and verify its stored size and SHA-256 evidence. Parseable documents
contribute bounded extracted text; supported provider-native media is supplied
as bounded bytes. The original upload remains a task resource. A generated
workspace result is returned as a `localmind_document` artifact created or
updated through LocalMind's normal document tools.

Whiteboard, document database/table, asset, comment, collaboration, history,
and external-system operations currently return `unsupported_task`. They must
not be reported as completed until a real LocalMind executor exists.

## Execution And Result Notifications

A document update or tool-agent task returns `queued` and immediately queues
the same AgentRun used by LocalMind's own runtime. It does not create an
approval step, send an approval request, or wait for a caller decision. The
task's fixed MCP capability snapshot and the delegated user's live ACL are the
authorization boundary.

The worker repeats credential-family activity, frozen capability, live ACL,
attachment Blob/evidence, and cancellation checks during execution; the
optimized document-replacement path also checks the planned document version
immediately before the write. If
a result notification URL is configured, LocalMind sends exactly terminal
event types: `task_completed`, `task_failed`, or `task_cancelled`.
Notifications are signed with the callback secret:

```text
X-LocalMind-Timestamp: <unix milliseconds>
X-LocalMind-Signature: sha256=<HMAC-SHA256(secret, timestamp + "." + rawBody)>
```

The signature covers `<timestamp>.<exact raw JSON body>`. Callback delivery
uses a durable outbox with leases and bounded retries. A callback URL is never
required for execution; without one, use `get_localmind_task` to observe the
terminal result.

## Query A Task

`delegate_to_localmind` returns a stable `taskId`; `requestId` remains a
compatibility alias. Call `get_localmind_task` with that id to read the
sanitized plan, step state, final result, and artifact references. New MCP
tasks return `approval=null`. The query never invokes AI or advances the task.

For bounded long polling, pass the previous `stateVersion` as
`knownStateVersion` and set `waitMs` up to `30000`. When a result notification
URL is configured, task queries provide recovery and reconciliation if a
callback is delayed, duplicated, or lost. Without a notification URL, the same
query is the normal completion channel.

## Cancel A Task

Call `control_localmind_task` with `action=cancel`, the stable `taskId`, and an
idempotency key. Queued work becomes `cancelled` immediately. Running work
first returns `cancellation_requested` and appears as
`cancelling` until the Agent Runtime worker cooperatively records terminal
`cancelled` state; poll with `get_localmind_task` during that interval.

The control tool accepts only `cancel`; there is no approval or rejection
operation. Final cancellation emits a signed `task_cancelled` notification when
a result notification URL is configured.

## Protocol Self-Test

```shell
export LOCALMIND_MCP_URL='https://localmind.example/api/workspaces/<WORKSPACE_ID>/mcp'
read -r -s LOCALMIND_MCP_TOKEN

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"localmind-check","version":"1.0.0"}}}' \
  "${LOCALMIND_MCP_URL}"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  "${LOCALMIND_MCP_URL}"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"upload_localmind_attachment","arguments":{"fileName":"notes.txt","mimeType":"text/plain","base64":"Tm90ZXMgdG8gc3VtbWFyaXplLg==","idempotencyKey":"upload-001"}}}' \
  "${LOCALMIND_MCP_URL}"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"delegate_to_localmind","arguments":{"request":"Summarize the attachment and create a LocalMind document.","documentIds":[],"attachmentIds":["<ATTACHMENT_ID>"],"idempotencyKey":"summary-001"}}}' \
  "${LOCALMIND_MCP_URL}"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_localmind_task","arguments":{"taskId":"<TASK_ID>","waitMs":0}}}' \
  "${LOCALMIND_MCP_URL}"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"control_localmind_task","arguments":{"taskId":"<TASK_ID>","action":"cancel","idempotencyKey":"cancel-001"}}}' \
  "${LOCALMIND_MCP_URL}"
```

Successful initialization returns `serverInfo.name=localmind-ai`; `tools/list`
returns `upload_localmind_attachment`, `delegate_to_localmind`,
`get_localmind_task`, and `control_localmind_task`.

## Troubleshooting

- MCP `401`: token missing, malformed, expired, revoked, disabled, or bound to
  another workspace.
- `credential_scope_denied`: the task's fixed credential snapshot lacks a
  required capability.
- `permission_denied` or `resource_not_accessible`: the delegated user lacks
  current LocalMind ACL; no elevation request will be sent.
- `attachment_evidence_mismatch`: the stored attachment no longer matches its
  immutable upload evidence and execution stops closed.
- Missing callback: execution continues; poll `get_localmind_task` for the
  terminal result.
- Missing terminal notification: query the task, then check the receiver's HMAC
  validation and replay protection plus LocalMind's bounded delivery retries.
- MCP `405`: the stateless MCP endpoint accepts `POST`, not `GET` or `DELETE`.
