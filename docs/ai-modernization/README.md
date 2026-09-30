# LocalMind AI Modernization

This directory is the active planning entrypoint for LocalMind AI
modernization.

LocalMind is an AFFiNE-based branch with a separate AI modernization direction.
The branch differences are summarized in `branch-differences.md`, and the full
planning document map is in `document-map.md`.

The historical plan has been split into `/docs/ai-modernization/archive/`. The
archive is still useful for traceability, but it is no longer the default
execution entrypoint for future goal tasks.

## Read First

1. `branch-differences.md`
2. `document-map.md`
3. `current-state.md`
4. `next-goals.md`
5. `validation.md`
6. The relevant file under `tracks/`

Read `archive/README.md` only for historical context or for a specific
referenced section.

## Goal

Move LocalMind from an AI chat and diagnostics layer toward an office task
execution system with durable runtime state, auditable repair flows, persisted
support bundles, DB-backed registries, and scope-correct auditable context
memory.

## Working Rule

Do not continue the old pattern of adding deeper read-only diagnostic fields
under support-bundle source evidence unless the user explicitly requests that
exact field.

Future work should prefer vertical slices that create real behavior:

- persistence;
- executable or queued runtime state;
- authorization and audit;
- Admin or user-facing operation surfaces;
- focused container validation.

Native DOCX/XLSX/PPTX/PDF editing is tracked separately in
`docs/office-native/README.md`. Office AI tools must still use the durable Agent
Runtime, authorization, approval, audit, and cancellation semantics defined by
this modernization plan.

Project 与 Workspace 复用同一套 Office 文件界面、编辑状态和公共操作的修复方案见
[`project-workspace-office-surface-remediation.zh-CN.md`](project-workspace-office-surface-remediation.zh-CN.md)。

Workspace / Project AI 会话授权、项目级共享 Memory（个人会话与摘要不共享）、引用版本、删除与长期审计、
唯一上下文及滚动整理的现行专项契约见
[`workspace-project-context-session-remediation.zh-CN.md`](workspace-project-context-session-remediation.zh-CN.md)。
P0—P4 源码实现及隔离验证、P5 未完成的真实模型/浏览器/恢复/部署关卡见
[`workspace-project-context-session-remediation.execution.zh-CN.md`](workspace-project-context-session-remediation.execution.zh-CN.md)。

## Track Documents

The implemented [Project Native Resources](tracks/project-native-resources.md)
owns Project storage, file trees, independent copies, explicit Workspace
publishing, superseding older reference-only Project rules.
Its [goal instruction](project-native-resources.goal.md) defines the execution
scope. [Execution and acceptance evidence](project-native-resources.execution.md)
records P1-P6, A01-A22, migration exceptions, backups and runtime verification.
The confirmed [Project Workbench Redesign](tracks/project-workbench-redesign.md)
owns the Project user-experience layer: standalone shell and routes, main-area
file tree, retirement of the old reference model, realtime updates, exclusive
edit leases, dual approval entry points and error/copy rules. Its
[goal instruction](project-workbench-redesign.goal.md) defines the execution
scope. It supersedes the native-resource track's former legacy-reference
migration chapter and D11: the reference tables and migration bridge are
retired together. [Execution and acceptance evidence](project-workbench-redesign.execution.md)
tracks the current P1-P7 and A01-A22 results separately from historical acceptance.

The instance-wide [LocalMind logging system goal](./localmind-logging-system.goal.md)
defines the implementation prompt for PostgreSQL-backed runtime logs, business
audit correlation, automatic client ingestion, durable spool, Admin observability,
retention controls, and self-hosted external-telemetry blocking. Its design
contract is `docs/localmind-logging-system-design.zh-CN.md`, together with the
enterprise deployment model.

The [v9 relationship graph contract](project-relationship-graph-v9-implementation.zh-CN.md)
now includes the implemented finite graph revision: one current-user node across
projects, grouped collaborators, expandable delivery items, work-order selection,
and an authorized open-or-create conversation action. Owner-only live drafts and
revision-specific adoption remain intact. Verification and remaining limits are
recorded in `.codex-artifacts/project-finite-graph/REPORT.md`; this does not claim
production deployment or rerun the historical workbench Goal.

The [scheme-2 collaboration orbit](project-collaboration-orbit-scheme-2-development.zh-CN.md)
supersedes v9's relationship-view layout while retaining its authorization and
work-order semantics. Its [execution record](project-collaboration-orbit-scheme-2.execution.zh-CN.md)
tracks source integration, A01—A19 evidence, remaining browser checks and local
runtime synchronization separately from the historical v9 result. The supported
local sync completed on 2026-09-29; browser cases still marked partial in that
record remain open.

The [Project work-order AI delivery contract](project-work-order-ai-delivery-contract.zh-CN.md)
defines the unified work-order template, recipient conversation, AI-assisted
completion check, and recipient-confirmed return. It supersedes the v9 manual
delivery-form interaction; the implementation gap is recorded in that contract.

- `tracks/support-bundle.md`
- `tracks/repair-execution.md`
- `tracks/agent-runtime.md`
- `tracks/registries.md`
- `tracks/context-memory.md`
- `tracks/intelligence-workbench.md`
- `tracks/project-native-resources.md`
- `tracks/project-workbench-redesign.md`

## Local Documentation Policy

Planning and branch-positioning documents in this directory are local branch
documentation. Updating them does not publish anything to GitHub. Commit, push,
or pull request work must be requested separately.

## Historical Anchors

Use these archive sections as context only:

- section 3.8: Agent Runtime gap;
- section 8.2: Agent Runtime data model sketch;
- P3 office Agent Runtime goal;
- sections around 244+: repair preview/preflight/execution request contracts;
- sections around 450+: support bundle lifecycle/source evidence;
- sections 540-554: latest completed read-only source-evidence placeholders.
