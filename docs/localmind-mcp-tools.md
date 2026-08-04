# LocalMind MCP Tool Reference

This reference describes the MCP surface implemented by
`localmind-workspace` version `2.1.0`. Tool discovery is authoritative: clients
should call `tools/list` and `discover_localmind_capabilities` because a
credential sees only tools granted by its scopes.

All tools accept one JSON object. Fields marked `?` are optional. Defaults and
full JSON Schema constraints are returned by `tools/list`. Every successful
tool result is available under `structuredContent.result`; the Response column
below describes that value.

## Discovery

| Scope  | Tool                              | Main arguments | Response                                                       |
| ------ | --------------------------------- | -------------- | -------------------------------------------------------------- |
| Always | `discover_localmind_capabilities` | none           | Granted/supported scopes, visible tools, Resource availability |

## Documents

| Scope             | Tool                              | Main arguments                      | Response                                  |
| ----------------- | --------------------------------- | ----------------------------------- | ----------------------------------------- |
| `documents:read`  | `list_documents`                  | `limit?`, `offset?`                 | Ordered documents, total, limit, offset   |
| `documents:read`  | `read_document`                   | `docId`                             | `docId`, Markdown                         |
| `documents:read`  | `keyword_search`                  | `query`, `limit?`                   | Authorized block matches and highlights   |
| `documents:read`  | `semantic_search`                 | `query`, `limit?`                   | Authorized embedding chunks and distance  |
| `documents:read`  | `read_document_blocks`            | `docId`                             | Complete structured BlockSuite block tree |
| `documents:read`  | `read_whiteboard`                 | `docId`                             | Whiteboard surfaces and elements          |
| `documents:read`  | `read_databases`                  | `docId`                             | Database columns, views, rows, and cells  |
| `documents:write` | `create_document`                 | `title`, `content`                  | Success and new `docId`                   |
| `documents:write` | `update_document`                 | `docId`, `content`                  | Success and `docId`                       |
| `documents:write` | `update_document_meta`            | `docId`, `title`                    | Success and `docId`                       |
| `documents:write` | `apply_document_block_operations` | `docId`, `operations`               | Added/updated/moved/deleted blocks        |
| `documents:write` | `apply_whiteboard_operations`     | `docId`, `operations`               | Added/updated/deleted whiteboard elements |
| `documents:write` | `apply_database_operations`       | `docId`, `databaseId`, `operations` | Updated database state                    |

`documents:read` also enables document Resources. `resources/list` accepts an
optional cursor and returns up to 100 Resources plus `nextCursor`.

Whiteboard operations cover shapes, text, connectors, brushes, highlighters,
groups, and mind maps. Notes and frames are blocks managed through
`apply_document_block_operations`. Every mutation publishes a persisted Yjs
delta through the normal LocalMind document writer.

## Workspace Organization

| Scope             | Tool                                      | Main arguments        | Response                                |
| ----------------- | ----------------------------------------- | --------------------- | --------------------------------------- |
| `workspace:read`  | `read_workspace_organization`             | none                  | Authorized workspace organization state |
| `workspace:write` | `apply_workspace_organization_operations` | `operations`          | Applied root CRDT operations            |
| `workspace:write` | `apply_workspace_data_operations`         | `table`, `operations` | Applied native table CRDT operations    |

Root operations cover workspace name/avatar, trash/restore, tags, document tag
assignment, and collections. Supported data tables are `folders`,
`document_properties`, `workspace_properties`, `pinned_collections`,
`explorer_icons`, `favorites`, and `user_settings`.

## Assets

| Scope          | Tool                               | Main arguments                  | Response                                      |
| -------------- | ---------------------------------- | ------------------------------- | --------------------------------------------- |
| `assets:read`  | `list_workspace_blobs`             | none                            | Blob metadata                                 |
| `assets:read`  | `read_workspace_blob`              | `key`, `maxBytes?`              | Signed URL or bounded base64 data             |
| `assets:write` | `upload_workspace_blob`            | `key`, `mime?`, `base64`        | Stored key, MIME type, and size               |
| `assets:write` | `initialize_workspace_blob_upload` | `key`, `size`, `mime?`          | Existing direct/server/multipart upload state |
| `assets:write` | `get_workspace_blob_upload_part`   | `key`, `uploadId`, `partNumber` | Part URL and required headers                 |
| `assets:write` | `complete_workspace_blob_upload`   | `key`, `uploadId?`, `parts?`    | Completed blob key                            |
| `assets:write` | `abort_workspace_blob_upload`      | `key`, `uploadId`               | Abort result                                  |
| `assets:write` | `delete_workspace_blob`            | `key`, `permanently?`           | Delete result                                 |
| `assets:write` | `release_deleted_workspace_blobs`  | `confirm: true`                 | Permanently released deleted blobs            |

Inline reads and uploads are capped at 10 MiB. Larger uploads use the existing
quota-checked direct or multipart path returned by the initialization tool.

## Comments

| Scope            | Tool                        | Main arguments                                  | Response                     |
| ---------------- | --------------------------- | ----------------------------------------------- | ---------------------------- |
| `comments:read`  | `list_document_comments`    | `docId`, `afterSid?`, `limit?`                  | Comments, replies, and total |
| `comments:write` | `create_document_comment`   | `docId`, title/mode, `content`, `mentions?`     | Created comment              |
| `comments:write` | `update_document_comment`   | `id`, `content`                                 | Updated comment              |
| `comments:write` | `resolve_document_comment`  | `id`, `resolved`                                | Updated resolution state     |
| `comments:write` | `delete_document_comment`   | `id`                                            | Delete result                |
| `comments:write` | `create_comment_reply`      | `commentId`, title/mode, `content`, `mentions?` | Created reply                |
| `comments:write` | `update_comment_reply`      | `id`, `content`                                 | Updated reply                |
| `comments:write` | `delete_comment_reply`      | `id`                                            | Delete result                |
| `comments:write` | `upload_comment_attachment` | `docId`, `filename`, `mime?`, `base64`          | Attachment URL and metadata  |

Comment writes reuse LocalMind permissions, mentions, notifications, quota,
attachment storage, and realtime events. Inline attachments are capped at
10 MiB.

## Collaboration

| Scope                 | Tool                           | Main arguments                       | Response                                 |
| --------------------- | ------------------------------ | ------------------------------------ | ---------------------------------------- |
| `collaboration:read`  | `read_document_collaboration`  | `docId`, `offset?`, `limit?`         | Public state, permissions, granted users |
| `collaboration:read`  | `list_workspace_members`       | `offset?`, `limit?`, `query?`        | Visible member records                   |
| `collaboration:read`  | `read_workspace_invite_link`   | none                                 | Active link and expiration               |
| `collaboration:write` | `publish_document`             | `docId`, `mode?`                     | Published document state                 |
| `collaboration:write` | `unpublish_document`           | `docId`                              | Unpublished document state               |
| `collaboration:write` | `grant_document_roles`         | `docId`, `userIds`, `role`           | Grant result                             |
| `collaboration:write` | `update_document_user_role`    | `docId`, `targetUserId`, `role`      | Role update or ownership transfer        |
| `collaboration:write` | `revoke_document_user_role`    | `docId`, `targetUserId`              | Revoke result                            |
| `collaboration:write` | `update_document_default_role` | `docId`, `role`                      | Default role update                      |
| `collaboration:write` | `invite_workspace_members`     | `emails`                             | Per-address invite results               |
| `collaboration:write` | `create_workspace_invite_link` | `expiration?`                        | Link and expiration                      |
| `collaboration:write` | `revoke_workspace_invite_link` | none                                 | Revoke result                            |
| `collaboration:write` | `update_workspace_member_role` | `targetUserId`, `role`               | Role update or ownership transfer        |
| `collaboration:write` | `approve_workspace_member`     | `targetUserId`                       | Approval result                          |
| `collaboration:write` | `remove_workspace_member`      | `targetUserId`                       | Removal/decline result                   |
| `collaboration:write` | `update_workspace_settings`    | One or more supported setting fields | Updated workspace                        |
| `collaboration:write` | `delete_workspace`             | `confirmWorkspaceId`                 | Permanent deletion result                |

Publishing and invitations are marked as open-world writes and reuse sharing
abuse controls. Deletion requires the exact MCP-bound workspace id and retains
the normal `Workspace.Delete` authorization check.

## Document History

| Scope           | Tool                       | Main arguments               | Response                                |
| --------------- | -------------------------- | ---------------------------- | --------------------------------------- |
| `history:read`  | `list_document_history`    | `docId`, `before?`, `limit?` | Newest persisted history snapshots      |
| `history:read`  | `read_document_history`    | `docId`, `timestamp`         | Complete structured historical snapshot |
| `history:write` | `restore_document_history` | `docId`, `timestamp`         | Persisted CRDT restoration result       |

## AI Context

| Scope              | Tool                                 | Main arguments                                     | Response                                  |
| ------------------ | ------------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| `ai-context:read`  | `get_ai_context_settings`            | none                                               | Automatic Memory settings                 |
| `ai-context:read`  | `list_ai_context_planner_strategies` | none                                               | Immutable planner strategies/checkpoints  |
| `ai-context:read`  | `list_ai_context_projects`           | `includeArchived?`                                 | Authorized context projects               |
| `ai-context:read`  | `get_ai_context_session_scope`       | `sessionId`                                        | Readable documents and project candidates |
| `ai-context:read`  | `list_ai_context_memory_events`      | `limit?`                                           | Writer/undo events                        |
| `ai-context:read`  | `list_ai_context_rules`              | `includeDisabled?`                                 | User rules and revisions                  |
| `ai-context:read`  | `list_ai_context_policies`           | `includeDisabled?`                                 | Workspace policies and revisions          |
| `ai-context:read`  | `list_ai_context_memories`           | `docId?`, `includeDisabled?`                       | Authorized rules, memories and summaries  |
| `ai-context:write` | `create_ai_context_memory`           | `scope`, `kind`, `content`, `docId?`, `projectId?` | Created memory                            |
| `ai-context:write` | `update_ai_context_memory`           | `id`, `content?`, `status?`                        | Updated memory                            |
| `ai-context:write` | `delete_ai_context_memory`           | `id`                                               | Boolean                                   |
| `ai-context:write` | `undo_ai_context_memory_event`       | `eventId`                                          | Undo event                                |
| `ai-context:write` | `create_ai_context_rule`             | Scope, name, mode, priority, conditions?, content  | Created rule                              |
| `ai-context:write` | `update_ai_context_rule`             | `id` plus changed directive fields                 | Updated rule                              |
| `ai-context:write` | `rollback_ai_context_rule`           | `id`, `revision`                                   | Restored rule                             |
| `ai-context:write` | `delete_ai_context_rule`             | `id`                                               | Boolean                                   |
| `ai-context:write` | `create_ai_context_policy`           | Name, mode, priority, conditions?, content         | Created policy                            |
| `ai-context:write` | `update_ai_context_policy`           | `id` plus changed directive fields                 | Updated policy                            |
| `ai-context:write` | `rollback_ai_context_policy`         | `id`, `revision`                                   | Restored policy                           |
| `ai-context:write` | `delete_ai_context_policy`           | `id`                                               | Boolean                                   |
| `ai-context:write` | `create_ai_context_project`          | `name`, `description?`, `documentIds`              | Created project                           |
| `ai-context:write` | `update_ai_context_project`          | `id`, metadata/status/document changes             | Updated project                           |
| `ai-context:write` | `delete_ai_context_project`          | `id`                                               | Boolean                                   |
| `ai-context:write` | `update_ai_context_settings`         | `autoMemoryEnabled`                                | Updated settings                          |

Directive conditions may contain `keywords`, `docIds`, `projectIds`, and
`match` (`any` or `all`). DLP and document/project authorization are enforced
by the existing Context Memory resolver.

## AI Chat

| Scope           | Tool                      | Main arguments                                        | Response                                        |
| --------------- | ------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `ai-chat:read`  | `get_ai_chat_session`     | `sessionId`                                           | Visible session metadata                        |
| `ai-chat:read`  | `list_ai_chats`           | `limit?`, `offset?`, `docId?`, filters/orders         | Paginated sessions and optional messages/prompt |
| `ai-chat:write` | `create_ai_chat_session`  | `promptName`, `docId?`, `pinned?`, `reuseLatestChat?` | Full new session history                        |
| `ai-chat:write` | `update_ai_chat_session`  | `sessionId` plus document/project/pin/prompt changes  | Session id                                      |
| `ai-chat:write` | `fork_ai_chat_session`    | `docId`, `sessionId`, `latestMessageId?`              | Forked session id                               |
| `ai-chat:write` | `delete_ai_chat_sessions` | `sessionIds`, `docId?`                                | Deleted session ids                             |
| `ai-chat:write` | `send_ai_chat_message`    | `sessionId`, `content?`, `attachments?`, `params?`    | Message id                                      |

`attachments` contains existing LocalMind blob ids. Use the `assets:*` or
`comments:*` upload tools to create bounded inline or multipart attachments.

## AI Operations Reads

| Scope                | Tool                                   | Main arguments                                            | Response                                       |
| -------------------- | -------------------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| `ai-operations:read` | `list_ai_prompts`                      | none                                                      | Prompt catalog and registry provenance         |
| `ai-operations:read` | `list_ai_models`                       | `promptName`                                              | Effective model/route candidates               |
| `ai-operations:read` | `get_prompt_registry_publish_gate`     | `name`, `expectedVersion?`                                | Validation, route and publish evidence         |
| `ai-operations:read` | `preflight_prompt_registry_repair`     | `name`, `submission`, `expectedVersion?`                  | Repair preflight verdict                       |
| `ai-operations:read` | `preview_prompt_registry_body_edit`    | `name`, `messageIndex`, `nextContent`, `expectedVersion?` | Bounded diff and preview fingerprint           |
| `ai-operations:read` | `list_ai_action_runs`                  | `limit?`                                                  | Sanitized action runs                          |
| `ai-operations:read` | `get_ai_action_run_route_trace`        | `runId`                                                   | Sanitized prepared-route trace                 |
| `ai-operations:read` | `list_ai_support_bundles`              | `limit?`, `filter?`                                       | Bundle/artifact/retention/transfer records     |
| `ai-operations:read` | `get_ai_support_bundle`                | `id`                                                      | Bundle detail; records the existing read audit |
| `ai-operations:read` | `list_agent_runtime_runs`              | `limit?`, `filter?`                                       | Runs, steps, timeline and execution results    |
| `ai-operations:read` | `get_agent_runtime_run`                | `id`                                                      | One run with steps/timeline                    |
| `ai-operations:read` | `list_agent_runtime_workflow_adapters` | none                                                      | Registered adapter capabilities                |
| `ai-operations:read` | `list_ai_repair_executions`            | `limit?`, `filter?`                                       | Repair lifecycle, audit and side effects       |
| `ai-operations:read` | `list_provider_health_probe_attempts`  | `limit?`, `filter?`                                       | Probe attempts and result evidence             |

List filters accept the same bounded status, identity and locator fields as the
existing LocalMind GraphQL/Admin surfaces. `tools/list` provides their exact
JSON Schema.

## AI Operations Writes

| Scope                 | Tool                                     | Main arguments                                             | Response                            |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| `ai-operations:write` | `request_prompt_registry_repair`         | `name`, `submission`, expected gate fingerprints           | Persisted approval-gated request    |
| `ai-operations:write` | `decide_ai_repair_approval`              | `executionRequestId`, `decision`, `reason?`                | Updated repair execution            |
| `ai-operations:write` | `control_ai_repair_execution`            | `executionRequestId`, `action`, payload/reason?            | Updated repair execution            |
| `ai-operations:write` | `request_agent_runtime_document_update`  | `docId`, `content`, fingerprints/idempotency/title/reason? | Approval-gated Agent Run            |
| `ai-operations:write` | `control_agent_runtime_run`              | `runId`, `action`, `reason?`                               | Updated Agent Run                   |
| `ai-operations:write` | `create_ai_support_bundle`               | none                                                       | Persisted sanitized bundle          |
| `ai-operations:write` | `authorize_ai_support_bundle_download`   | `bundleId`, `artifactKind?`                                | Short-lived download authorization  |
| `ai-operations:write` | `acknowledge_ai_support_bundle_download` | `authorizationId`                                          | Final authorization state           |
| `ai-operations:write` | `cleanup_ai_support_bundle_retention`    | `limit?`                                                   | Cleanup counts and affected bundles |
| `ai-operations:write` | `replay_ai_support_bundle_transfer`      | `forwardingEventId`, `maxAttempts?`                        | Fresh queued forwarding event       |
| `ai-operations:write` | `publish_prompt_registry_body_edit`      | Edit plus preview fingerprint/idempotency/review           | Published body/revision evidence    |
| `ai-operations:write` | `publish_prompt_registry_revision`       | `name`, expected version/revision/idempotency/review?      | Prompt revision                     |
| `ai-operations:write` | `publish_provider_registry_revision`     | Provider id and sanitized metadata                         | Provider revision                   |
| `ai-operations:write` | `publish_model_registry_revision`        | Provider/model ids and model definition                    | Model revision                      |
| `ai-operations:write` | `publish_task_route_policy_revision`     | Feature kind, model id, revision/idempotency?              | Route policy revision               |
| `ai-operations:write` | `record_provider_health_state`           | `providerId`, `status`, `lastError?`                       | Provider health state/events        |
| `ai-operations:write` | `retry_provider_health_probe`            | `attemptId`                                                | Fresh queued probe attempt          |

These tools call the existing LocalMind resolver/model paths. Approval-gated
operations remain approval-gated; audit events, idempotency, worker leases,
snapshot fences, DLP and side-effect ledgers are not bypassed by MCP.

## Protocol Methods

| Method                     | Availability                         | Result                                                    |
| -------------------------- | ------------------------------------ | --------------------------------------------------------- |
| `initialize`               | Always                               | Protocol version, tools and optional Resources capability |
| `ping`                     | Always                               | Empty success object                                      |
| `tools/list`               | Always                               | Scope-filtered tools with schemas and annotations         |
| `tools/call`               | Always                               | Text plus structured tool result                          |
| `resources/list`           | `documents:read`                     | Resource page and optional `nextCursor`                   |
| `resources/templates/list` | Always; empty without document scope | Document URI template                                     |
| `resources/read`           | `documents:read`                     | Authorized Markdown contents                              |

The endpoint supports protocol versions `2024-10-07`, `2024-11-05`,
`2025-03-26`, `2025-06-18`, and `2025-11-25`. JSON-RPC batching is rejected
for post-2025-03 protocol versions. Notifications return HTTP 202 with no body
when there is no response message.
