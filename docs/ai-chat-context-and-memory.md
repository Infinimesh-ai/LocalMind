# AI Chat Context and Memory

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
from a project document resolves its active projects and loads only the current
user's matching project memories. Archiving a project stops future injection
without deleting its users' memories.

Deleting a document removes its document-only memories and its project
membership records. Project memories remain attached to the project because
they may summarize other project documents. An administrator can still see and
archive an empty project, then delete it after its users have removed their
private project memories.

A document may belong to more than one active context project. In that case,
AI Chat loads the current user's memories from every matching project, and new
automatic memories are saved privately into every matching project.

The project creator is audit metadata, not the owner of the project. Removing
that user clears the audit reference while leaving the workspace project
intact. A project cannot be hard-deleted while any user memory references it;
archive it instead, or let each owner remove their own memories first.

Automatic memory can be enabled or disabled per user and workspace from the
same page. Disabling it stops new automatic memories from being captured; it
does not delete existing entries. Existing memories remain visible so the user
can disable or delete them explicitly.

The context planner stores rolling-summary checkpoints separately from durable
memories. Every planner strategy version is registered with an immutable
fingerprint and configuration snapshot. Conversation checkpoints retain the
strategy version that created them, allowing old and new strategies to be
replayed against the same evaluation cases.

The active planner validates a checkpoint against the exact summarized message
prefix before reusing it. It reserves bounded space for conversation summary,
rules, project summaries, and automatic memories instead of truncating the
combined context string. Injected entries are explicitly marked as
user-authored context so saved text cannot silently become a system or developer
instruction.

## Updated Documents

When AI Chat reads an attached or referenced document, that conversation uses a
snapshot of the document. Editing the source document does not replace the
snapshot in an existing conversation.

Start a new conversation after editing a document when the AI needs to use its
latest content. This keeps earlier answers reproducible and avoids silently
changing the evidence behind an active conversation.
