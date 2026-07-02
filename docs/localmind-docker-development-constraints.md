# LocalMind Docker Development Constraints

This document defines the Docker workflow constraints for LocalMind / AFFiNE AI modernization work.

It exists to prevent expensive full-image rebuilds during normal development while still keeping all build, runtime, and test conclusions grounded in Docker/container execution.

## Standard Environment

LocalMind development and validation standardizes on Linux and Linux containers.
Write local commands, documentation examples, and automation snippets for POSIX
shell unless a task explicitly targets an upstream platform-specific desktop
package or signing flow.

Windows-specific release steps may remain in inherited CI when needed to build
or sign Windows desktop artifacts, but they are not the default LocalMind
development or test path.

## Core Rule

Docker is the required validation environment, but a full Docker image rebuild is not the default development loop.

Source changes should use the smallest Docker-based validation that proves the change. Full runtime image builds are reserved for dependency, packaging, Dockerfile, native build, or milestone validation work.

## Required Image Roles

Use fixed image roles and tags only:

```text
localmind-affine:dev-base
localmind-affine:test
localmind-affine:local
```

### `localmind-affine:dev-base`

Purpose:

- Shared development base image.
- Contains system toolchain and runtime dependencies needed to run AFFiNE development/test commands inside Docker.
- May include Node, Yarn/Corepack, Rust, build-essential, Python, and required native libraries.

Build policy:

- Rebuild only when Dockerfile tooling, base image versions, system dependencies, package-manager version, or lockfile-driven dependency strategy changes.
- Do not rebuild for ordinary TypeScript, frontend, backend, GraphQL, resolver, prompt, registry, or test source edits.

### `localmind-affine:test`

Purpose:

- Daily containerized test environment.
- Runs focused backend/frontend/unit/integration checks inside Docker.
- Should reuse `dev-base`.
- Should prefer bind-mounted source and Docker volumes/cache for dependency and build artifacts where practical.

Build policy:

- Do not build milestone-specific test images.
- Do not depend on full web/admin/mobile/server bundle unless the test specifically requires packaged artifacts.
- Prefer `docker compose run --no-build` or `docker exec` against an existing container when the image already exists.

### `localmind-affine:local`

Purpose:

- Runtime/selfhost image used for local deployment validation.
- Represents the image that should start AFFiNE services through Docker Compose.

Build policy:

- Build for milestone validation, runtime packaging changes, Dockerfile changes, dependency changes, native build changes, or final handoff validation.
- Do not build after every small source edit.

## Deprecated Pattern

Do not use milestone-specific tags like:

```text
localmind-affine:ai-p1-*
localmind-affine:ai-p1-*-test-runner
localmind-affine:*-build
```

If milestone information is needed, record it in:

- `/docs/ai-modernization/archive/README.md` or the relevant active track
  document
- commit messages
- build logs
- image labels
- final task summaries

Do not encode milestone progress by accumulating Docker image tags.

## Test Runner Constraint

Avoid a `test-runner` image that is directly based on a full verify/package stage.

This pattern is too expensive for development:

```dockerfile
FROM verify AS test-runner
```

It forces test validation to carry full source, dependency install, native build, and bundled AFFiNE artifacts. That is acceptable only for final verification, not for daily iteration.

Preferred pattern:

```dockerfile
FROM dev-base AS test
```

or:

```dockerfile
FROM deps AS test
```

Then run only the focused checks needed for the current change.

## Validation Order

For each change, use this order:

1. Inspect the current Docker state:

   ```shell
   docker system df
   docker image ls localmind-affine
   docker ps -a --filter "name=localmind"
   ```

2. Reuse existing containers or images when possible:

   ```shell
   docker compose run --no-build ...
   docker exec ...
   docker logs ...
   ```

3. Rebuild `localmind-affine:test` only if the required test image does not exist or its Docker-level dependencies changed.

4. Build `localmind-affine:local` only for runtime/milestone validation.

5. Report the exact Docker command, result, and remaining risk.

## Build Permission Rules

Allowed without additional justification:

- Running commands inside an existing container.
- Running `docker compose run --no-build`.
- Reading container logs.
- Inspecting Docker state.
- Restarting services when requested by the task.

Requires explicit justification in the task summary:

- Building `localmind-affine:test`.
- Building `localmind-affine:local`.
- Running a full bundle/build verification.
- Pruning Docker cache or images.

Not allowed unless explicitly requested by the user:

- Creating milestone-specific image tags.
- Keeping old test images after validation.
- Running full Docker builds as the default response to every source change.
- Deleting volumes or persisted service data.
- Rebuilding unrelated project images.

## Resource Limits

Before any Docker build, check:

```shell
docker system df
```

Stop and report instead of continuing if the planned build is likely to add more than 30GB of Docker image/cache data.

After heavy validation, clean unused build cache while preserving useful cache when possible:

```shell
docker builder prune --force --filter until=24h --keep-storage 20GB
```

If Docker still reports very large BuildKit cache and the user approves full cache cleanup:

```shell
docker builder prune --all --force
```

Do not prune volumes unless the user explicitly asks.

## Compose Requirements

Docker Compose files should use fixed tags or environment variables:

```yaml
image: ${LOCALMIND_AFFINE_IMAGE:-localmind-affine:local}
```

For test services:

```yaml
image: ${LOCALMIND_AFFINE_TEST_IMAGE:-localmind-affine:test}
```

Do not hard-code milestone image tags into Compose files.

## Goal Task Instruction

Any goal task working on AI modernization must follow this document in addition
to `/docs/ai-modernization/README.md`.

For continued AI modernization work, read `/docs/ai-modernization/README.md`,
`/docs/ai-modernization/document-map.md`, and the relevant track document
first. They are the active task handoff that prevents the historical archive
from pushing future goals into repetitive read-only diagnostics instead of the
intended runtime and persistence work.

If the planning document asks for Docker verification, interpret that as container-based validation using the smallest sufficient Docker action, not automatic full image rebuilds.

If there is a conflict between this document and a goal prompt that says to rebuild after every change, this document wins unless the user explicitly overrides it.

## Reporting Requirements

Each task summary must include:

- Source files changed.
- Docker validation method used.
- Whether an image was rebuilt.
- If rebuilt, which fixed tag was used.
- Current `docker system df` summary when heavy Docker work was performed.
- Remaining risk or reason a lighter validation was chosen.
