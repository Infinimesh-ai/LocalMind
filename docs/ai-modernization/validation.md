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

## Definition Of Done

Every future goal summary should state:

- source files changed;
- Docker validation command and result;
- whether any image was rebuilt;
- remaining risk;
- which active track document was followed.
