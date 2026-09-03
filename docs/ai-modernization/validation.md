# Validation

AI modernization work must follow
`/docs/localmind-docker-development-constraints.md`.

## Image Roles

Use fixed image roles:

- `localmind-affine:test` for focused tests;
- `localmind-affine:local` for runtime or milestone validation;
- `localmind-affine:dev-base` only when Docker-level dependencies change.

Do not create milestone-specific image tags.

## Source-only Changes

Prefer focused validation inside `localmind-affine:test` with current source
copied or bind-mounted into the container.

Useful commands:

```sh
yarn r packages/backend/server/src/__tests__/copilot/resolver-model-source-chain.smoke.ts
yarn vitest run packages/frontend/admin/src/modules/ai/index.spec.tsx
yarn lint:ox <changed-files>
yarn prettier --ignore-unknown --check <changed-files>
```

For backend server TypeScript smoke files, use `yarn r <file>`. Plain `ava` can
miss smoke files that are outside AVA's configured glob, and root `tsx` is not a
script in this repo.

## Documentation-only Changes

Documentation-only edits do not require a Docker image rebuild or runtime
container validation.

For docs-only changes, prefer the smallest useful local check:

```sh
yarn prettier --ignore-unknown --check <changed-doc-files>
```

If the formatter dependencies are unavailable, report that validation was not
run and explain that the change was documentation-only.

## Runtime Milestones

Use `localmind-affine:local` when the goal changes:

- packaging;
- startup behavior;
- native build behavior;
- Dockerfile or dependency behavior;
- service runtime behavior that cannot be validated through focused tests.

Report whether the image was rebuilt and which fixed tag was used.

## Latest Validation Record

The 2026-08-02 Context Memory v6 and GitHub issues #2-#8 stabilization pass was
validated with:

- 95 focused backend tests for context planning, memory scope, session,
  resolver, permission, tool-loop, repair-control, support-bundle, realtime,
  and registry source-chain behavior, plus the large resolver source-chain and
  memory-scope smoke files;
- 51 frontend tests covering AI Context polling/drafts, document-update alerts,
  and Help search/navigation, followed by manual light/dark browser inspection;
- the v6 evaluation smoke with extraction precision/recall/F1 of `1`, sensitive
  write rate `0`, Recall@5/MRR/nDCG@5 of `1`, scope leakage `0`, and Rule
  conflict accuracy `1`;
- native-renderer v6, v5, and v4 natural-language baselines with short, early,
  recent, cross-session, and rolling-summary checkpoint recall all equal to
  `1`;
- root TypeScript project references, isolated checking of 31 Copilot test
  files, Prisma Client/GraphQL/i18n generation, Prettier, oxlint, and
  `git diff --check`;
- a fresh disposable PostgreSQL database applying all 296 migrations, plus a
  separate v1-to-project transition fixture proving legacy user-scope cleanup
  before the new constraints are installed.

The missing/stale fixed development images were rebuilt as
`localmind-affine:dev-base` and `localmind-affine:test`; no milestone-specific
tag was created. The Linux ARM64 native addon was compiled in an ephemeral
builder with two Cargo jobs, release LTO disabled, and 16 codegen units after
the default fat-LTO build exceeded the 8 GB Docker memory allowance. Docker
filled during the test-image build, so only 8.145 GB of unused BuildKit cache
was removed; no volume or persisted service data was deleted. After cleanup,
Docker reported 29.41 GB of images, 8.142 GB of containers, 102.4 MB of local
volumes, and 0 B of BuildKit cache.

The 2026-07-31 Context Memory hardening slice was validated with:

- isolated TypeScript checking of 26 Copilot test files;
- focused planner/scope/session/DB coverage checked by the isolated test
  typecheck;
- GraphQL schema and client generation, Prisma Client generation, Prettier,
  oxlint, and `git diff --check`;
- host and ephemeral Docker scope smoke covering v5 user-role context, v4
  replay, permission filtering, ambiguous project resolution, and trace
  redaction;
- native-renderer v5 and v4 baselines with full short, early, recent, and
  cross-session marker recall plus automatic summary creation;
- the `ai_context_plan_traces` migration applied to a disposable PostgreSQL
  instance.

The fixed `localmind-affine:local` image was reused without rebuilding it.
Current source was mounted read-only and the required Linux ARM64 native/SWC
addons were extracted from that image. No existing Docker volume or persisted
service data was changed.

The 2026-07-29 compatibility repair was validated with:

- 56 Copilot resolver/session/runtime tests;
- 33 tool-loop, session, workspace embedding, and permission-filtering tests;
- 152 repair execution, Agent Runtime, Provider Registry, and Provider Health
  tests;
- 37 support bundle lifecycle and transfer-forwarding tests;
- the resolver source-chain smoke plus 29 Admin AI and 39 frontend model
  service tests on the host and again in an ephemeral container based on
  `localmind-affine:dev-base`;
- root TypeScript project references plus isolated typechecking of 26 Copilot
  test files;
- GraphQL generation, Prettier, oxlint, and `git diff --check`;
- live runtime requests returning HTTP 200 from the configured Infinimesh text,
  Sparkclaw embedding, and Sparkclaw reranker routes; the embedding route
  returned a 1024-dimensional vector.
- the ephemeral container source manifest was synchronized to the current
  tracked and untracked source set without macOS `._*` metadata or deleted-file
  leftovers; Prisma Client was regenerated from the current schema before the
  forced backend project-reference and Copilot test typechecks.

No image was rebuilt. The fixed `localmind-affine:test` image was absent, and
the existing `localmind-affine:dev-base` image lacked its ARM64 native addon
and Rust toolchain. Container source validation therefore reused the Linux
ARM64 addon from the running fixed `localmind-affine:local` image in an
ephemeral container. No Docker volume or persisted service data was changed.

The 2026-09-02 4096-dimensional embedding contract was validated with:

- Prisma schema validation and client generation after changing all five
  pgvector columns to `vector(4096)`;
- all 315 migrations applied from zero to disposable PostgreSQL 16 databases
  with pgvector 0.8.5, once on the host and once in an ephemeral
  `localmind-affine:test` container;
- a synthetic upgrade from populated 1024-dimensional derived caches and a
  durable Memory row: all chunk rows, Memory ids, text, and scope were retained
  with pending null embeddings, and all five columns became `vector(4096)`;
- index catalog checks for five binary-quantized `bit(4096)` HNSW indexes and
  an `EXPLAIN` plan using `ai_context_embeddings_idx` for candidate retrieval;
- 14 context/workspace model tests, focused 4096-dimensional backfill job and
  minute-scheduling tests, and 7 embedding-client tests, including Linux
  test-container coverage;
- the resolver source-chain smoke, focused Admin AI diagnostics test, Copilot
  test typecheck, oxlint, Prettier, Prisma validation, and `git diff --check`.

No image was rebuilt. Validation used disposable databases and an ephemeral
container without mounting or modifying existing LocalMind persistent volumes.

The 2026-09-02 MCP tool-lifecycle hardening was validated with:

- 39 focused tests covering keyword-search fallback, task tool-snapshot
  intersection, sessionless task-attachment reads, document Trash/restore/
  permanent deletion, and recursive folder lifecycle behavior;
- all 28 tests in `copilot-mcp-delegation.e2e.ts`, including required and
  conditional document evidence, current-tool intersection failure,
  SparkClaw routing, cancellation, and live credential, ACL, and
  document-version rechecks;
- Copilot test typechecking, focused oxlint and Prettier checks, and
  `git diff --check`.

No image was rebuilt. The existing `localmind-affine:test` image was reused in
the disposable `localmind_affine_test_tool_lifecycle` container with isolated
PostgreSQL and Redis services. No existing LocalMind volume or persisted
service data was changed.

## Definition Of Done

Every future goal summary should state:

- source files changed;
- Docker validation command and result;
- whether any image was rebuilt;
- remaining risk;
- which active track document was followed.
