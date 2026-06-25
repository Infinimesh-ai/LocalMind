# LocalMind Branch Differences

This branch is based on AFFiNE, but its active direction is different from the
upstream product branch. LocalMind focuses on turning AI from a chat and
diagnostics layer into an auditable office task execution system.

## Product Direction

LocalMind keeps the upstream AFFiNE local-first workspace foundation, then adds
an AI operations layer with:

- durable AI runtime records for runs, steps, timeline events, worker leases,
  execution results, and cancellation requests;
- DB-backed Prompt Registry, Model Registry, Provider Registry, Task Route
  Policy, Provider Health state, and probe attempt records;
- approval-gated repair execution with queued workers, audit history, side
  effect ledgers, manual control, and constrained registry mutation;
- persisted support bundle requests, manifests, archive artifacts, download
  authorizations, retention cleanup, transfer forwarding, and replay history;
- Admin-facing diagnostics and operator controls for the above durable state;
- fixed Docker image roles for validation instead of milestone-specific build
  tags.

## What This Branch Is Not

This branch is not just a rebranded upstream checkout. The LocalMind work should
not be treated as a sequence of read-only diagnostic fields or UI labels.

Avoid using this branch to add more placeholder-only source-evidence metadata
unless a task explicitly asks for that exact diagnostic field. New AI work
should normally produce one of these outcomes:

- persisted state;
- executable queued behavior;
- authorization and audit history;
- an Admin or user-facing operation surface;
- focused container validation.

## Active AI Tracks

The active planning tracks are:

- [Support Bundle Persistence](./tracks/support-bundle.md)
- [Repair Execution](./tracks/repair-execution.md)
- [Agent Runtime State](./tracks/agent-runtime.md)
- [DB-backed Registries](./tracks/registries.md)

Each track document records implemented slices, remaining risk, and what should
not be expanded until real behavior exists.

## Compatibility With Upstream

The branch still follows upstream AFFiNE architecture where possible:

- package layout, GraphQL generation, Admin module structure, and backend module
  patterns should stay consistent with upstream;
- LocalMind additions should be scoped to AI modernization surfaces unless a
  broader platform change is required;
- upstream merges should be reviewed for dependency, schema, route, and runtime
  behavior changes before continuing AI work.

## Local-only Documentation Policy

These documents are maintained for the local LocalMind branch. Updating them
does not imply publishing to GitHub. Commit, push, or pull request steps remain
separate explicit actions.
