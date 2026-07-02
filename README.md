# LocalMind

LocalMind is an AFFiNE-based workspace branch focused on making AI work
auditable, durable, and operational inside a local-first office environment.

The project keeps the upstream AFFiNE foundation for docs, canvas, sync, desktop
apps, and self-hosting, then adds a LocalMind-specific AI operations layer. The
active direction is to move beyond chat and read-only diagnostics toward office
task execution with persisted state, approval gates, worker queues, operator
visibility, and container-grounded validation.

## Project Direction

LocalMind work is centered on:

- durable AI runtime state for runs, steps, timeline events, worker leases,
  execution results, and cancellation requests;
- DB-backed Prompt Registry, Model Registry, Provider Registry, Task Route
  Policy, Provider Health state, and probe attempt records;
- approval-gated repair execution with preview, preflight, queued workers,
  audit history, side effect ledgers, manual controls, and constrained registry
  mutation;
- persisted support bundle requests, archive artifacts, retention cleanup,
  download authorization, object-storage delivery, transfer forwarding, replay,
  and audit metadata;
- Admin-facing diagnostics and operator controls for durable AI state;
- fixed Docker image roles for validation instead of accumulating
  milestone-specific build tags.

New LocalMind AI work should normally produce at least one of these outcomes:

- persisted state;
- executable or queued behavior;
- authorization and audit history;
- an Admin or user-facing operation surface;
- focused container validation.

Avoid adding more placeholder-only diagnostic fields unless a task explicitly
asks for that exact field.

## Current Focus

The most active implementation track is AI modernization:

- support bundle persistence, archive packaging, retention cleanup, signed URL
  delivery, transfer event ingestion, forwarding, replay, and operator
  visibility;
- DB-backed AI provider/model/prompt registries and route policy behavior;
- repair execution contracts, policy enforcement, queued execution, and audit
  surfaces;
- durable agent runtime state for future office task execution.

Start with these documents before working on LocalMind AI features:

- [LocalMind documentation index](./docs/README.md)
- [AI modernization entrypoint](./docs/ai-modernization/README.md)
- [Branch differences](./docs/ai-modernization/branch-differences.md)
- [Current state](./docs/ai-modernization/current-state.md)
- [Next goals](./docs/ai-modernization/next-goals.md)
- [Docker development constraints](./docs/localmind-docker-development-constraints.md)

## Standard Environment

LocalMind standardizes local development and validation on Linux and Linux
containers. Write local commands, documentation examples, and automation
snippets for POSIX shell unless a task explicitly targets an upstream
platform-specific desktop package or signing flow.

Baseline tooling:

- Node.js `>=22.12.0 <23.0.0`
- Yarn `4.13.0` through Corepack
- Rust toolchain from `rust-toolchain.toml`
- Docker and Docker Compose for validation

Windows-specific release steps may remain in inherited CI when needed to build
or sign Windows desktop artifacts, but they are not the default LocalMind
development or test path.

## Development Loop

Install dependencies when needed:

```shell
corepack enable
yarn install
```

Use the smallest Docker-based validation that proves the change. Full image
rebuilds are not the default loop for ordinary TypeScript, frontend, backend,
GraphQL, prompt, registry, or test edits.

Inspect the current Docker state before heavy validation:

```shell
docker system df
docker image ls localmind-affine
docker ps -a --filter "name=localmind"
```

Use the fixed image roles documented in
[Docker development constraints](./docs/localmind-docker-development-constraints.md):

```text
localmind-affine:dev-base
localmind-affine:test
localmind-affine:local
```

Do not create milestone-specific image tags for normal development.

## Repository Map

- `docs/ai-modernization/` - LocalMind AI planning, current state, next goals,
  and active track documents.
- `docs/localmind-docker-development-constraints.md` - Docker validation rules
  and resource limits.
- `packages/backend/server/` - backend services, GraphQL/API, queues, storage,
  and copilot-related persistence.
- `packages/frontend/admin/` - Admin UI surfaces for operator-facing AI state.
- `packages/frontend/core/` - main AFFiNE/LocalMind frontend shell and user
  experience.
- `blocksuite/` - upstream BlockSuite editor foundation.
- `.github/workflows/` - inherited and LocalMind-adjusted CI/release workflows.

The rest of the repository largely follows upstream AFFiNE structure. Prefer
existing package patterns, GraphQL generation, Admin module conventions, and
backend module boundaries when adding LocalMind behavior.

## Upstream Relationship

LocalMind is not a rebranded upstream checkout, but it is built on AFFiNE and
should remain compatible with upstream architecture where practical.

Useful upstream references:

- [AFFiNE](https://github.com/toeverything/AFFiNE)
- [AFFiNE documentation](https://docs.affine.pro/)
- [BlockSuite](https://github.com/toeverything/BlockSuite)

Upstream documentation remains in this repository for build, contribution,
server, mobile, and desktop reference. Treat upstream product marketing,
community, template, and release material as inherited context, not the
LocalMind project brief.

## Contributing

For LocalMind work, read the LocalMind documentation index and the relevant AI
track document first. Keep changes scoped, preserve upstream conventions, and
report the Docker validation method used for behavior changes.

Planning documents in `docs/ai-modernization/` are local branch documentation.
Editing them does not publish anything to GitHub; commit, push, and pull
request steps are separate explicit actions.

## License

LocalMind inherits the AFFiNE licensing files in this repository. See
[LICENSE](./LICENSE) and [LICENSE-MIT](./LICENSE-MIT).
