# AI Chat Context and Memory

For end-user instructions, see the
[LocalMind 用户使用指南](./localmind-user-guide.zh-CN.md) and the concise
[LocalMind 使用提示](./localmind-usage-tips.zh-CN.md).

LocalMind uses two kinds of information when answering in AI Chat:

- conversation context, including recent messages and summaries of older turns;
- durable memory, including the current user's rules, automatically learned
  preferences, and personal workspace or project context.

Every durable memory belongs to one user. Rules, automatic memories, and
project summaries are never shared with other workspace members. A scope only
controls where the owner's memory can be used:

- user-scoped rules follow the user across workspaces;
- workspace-scoped memory is used only in that team workspace;
- project-scoped memory is used only while working in a document assigned to
  that context project;
- automatic memory from an unassigned document remains isolated to that
  document.

Users can review, edit, disable, or delete their memories in **Workspace
settings > AI context**. Team-wide administrator instructions are a separate
policy concern and must not be stored as user memory.

Memory ownership is independent from workspace membership. Losing access to a
workspace prevents that memory from being injected there, but the owner remains
authorized to disable or delete their own record. Deleting the user account
removes all of that user's memories.

Context projects group one or more workspace documents. Workspace
administrators manage project names, document membership, and archival.
Members see only projects containing documents they can read. Opening AI Chat
from a project document or attaching project documents through AI Context
resolves scope only after LocalMind rechecks read access. Project memory loads
only when every readable document in the conversation resolves to one active
project. Archiving a project stops future injection without deleting its users'
memories.

Deleting a document removes its document-only memories and its project
membership records. Project memories remain attached to the project because
they may summarize other project documents. An administrator can still see and
archive an empty project, then delete it after its users have removed their
private project memories.

A document may belong to more than one active context project, or a conversation
may attach documents from different projects. LocalMind treats that scope as
ambiguous: it loads no project memory and does not capture a new Automatic
Memory from the multi-document turn. A conversation containing project and
unassigned documents behaves the same way. Explicit project selection is not
available yet.

When no document is in scope, new Automatic Memory uses workspace scope. With
one readable unassigned document it uses document scope. With one or more
readable documents that all resolve to the same project it uses that project.
This avoids copying a private memory into several projects or silently widening
document context to the workspace.

The project creator is audit metadata, not the owner of the project. Removing
that user clears the audit reference while leaving the workspace project
intact. A project cannot be hard-deleted while any user memory references it;
archive it instead, or let each owner remove their own memories first.

Automatic memory can be enabled or disabled per user and workspace from the
same page. Disabling it stops new automatic memories from being captured; it
does not delete existing entries. Existing memories remain visible so the user
can disable or delete them explicitly.

The context planner stores rolling-summary checkpoints and per-turn plan traces
separately from durable memories. Every planner strategy version is registered
with an immutable fingerprint and configuration snapshot. Conversation
checkpoints retain the strategy version that created them, allowing old and new
strategies to be replayed against the same evaluation cases.

The active v5 planner validates a checkpoint against the exact summarized
message prefix before reusing it. It reserves bounded space for conversation
summary, rules, project summaries, and automatic memories instead of truncating
the combined context string. Injected entries are placed in a separate
untrusted `user` message immediately before the latest user turn, so saved text
is not merged into the primary system instruction. The archived v4 strategy
keeps its original behavior for replay.

Each saved text plan records the strategy, candidate and selected memory ids,
scores, ranks, counts, scope resolution, character budget, and input/output
fingerprints. Plan traces do not store message, Rule, Memory, project summary,
or rolling summary text.

## Updated Documents

> [!IMPORTANT]
> An existing conversation never refreshes its document snapshot
> automatically. LocalMind checks the saved versions of documents attached to
> the active conversation and shows a dismissible warning above the chat input
> when one changes. Click **New Chat** and add or reference the document again.
> Switching to another old conversation does not refresh that conversation's
> snapshot either.

When AI Chat reads an attached or referenced document, that conversation uses a
snapshot of the document. Editing the source document does not replace the
snapshot in an existing conversation.

After editing a document, wait for it to save and sync, click **New Chat**, and
add or reference the document again when the AI needs its latest content. This
keeps earlier answers reproducible and avoids silently changing the evidence
behind an active conversation. Dismissing the warning hides it for that
conversation and saved document version; saving a later version makes the
warning appear again.
