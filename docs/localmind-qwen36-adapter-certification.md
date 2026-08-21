# Qwen3.6 35B-A3B adapter certification

This document describes the release process for the model-specific
`qwen36-35b-a3b` LocalMind adapter. The adapter is bound to version `7` and is
closed by default in production. Evaluation mode exposes only the capabilities
that are currently testable; it does not release them to users.

## Runtime contract

The adapter enforces four boundaries:

1. The planner selects the provider and model once. The persisted route lock is
   reused by answer repair, document rendering, tool execution, and nested
   model calls. Model fallback is disabled for delegated planning.
2. The capability profile limits Qwen3.6 to certified tool categories.
   Unsupported capabilities fail before the model can substitute an unrelated
   write tool.
3. A deterministic completion contract maps each supported request to required
   tool and effect evidence, including repeated or explicitly quantified
   actions. Repeated evidence with the same tool arguments counts only once. A
   task cannot complete from a textual claim alone.
4. The tool governor deduplicates successful calls, bounds repeated failures,
   and records real writes separately from idempotent or cached replays.

Production tools remain unavailable until a capability has a flawless,
same-version certification record in
`packages/backend/server/src/plugins/copilot/model-adapters/qwen36/certification.ts`.

## Certification coverage

Run the suite with `LOCALMIND_CAP_MODE=certification`. The default certification
configuration executes at least 20 independent cases for each release
capability:

| Capability             | Required coverage                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `answer`               | 20 varied deterministic answer cases                                                                                                                                                               |
| `document.read`        | 20 actual `doc_read` tool cases without injected snapshots                                                                                                                                         |
| `document.create`      | 20 creates, each followed by an independent read                                                                                                                                                   |
| `document.update`      | 20 or more updates, each followed by an independent read                                                                                                                                           |
| `document.update_meta` | 20 title updates, each followed by an independent read                                                                                                                                             |
| `document.search`      | 20 positive and 20 negative searches by default                                                                                                                                                    |
| `workspace.folder`     | At least 20 each for list, create, rename, move, delete, add-document, and move-document; mutation checks must match the exact requested name, parent, folder ID, and document ID where applicable |

Document mutation grades are amended only after the follow-up state read. A
completed task with failed state verification is counted as a false success.

## Running the suite

The runner changes the selected workspace's BYOK route and the mounted LocalMind
configuration, restarts the server container, creates test documents and
folders, and issues a temporary MCP credential. Its `finally` block restores
the route and configuration and revokes the credential. Use an isolated test
workspace and do not interrupt the process unless necessary.

```bash
LOCALMIND_CAP_MODE=certification \
LOCALMIND_CAP_WORKSPACE_ID=<workspace-uuid> \
LOCALMIND_CAP_USER_ID=<user-uuid> \
LOCALMIND_CAP_QWEN_ROUTE_ID=<route-uuid> \
LOCALMIND_CAP_MANAGED_ROUTE_IDS=<route-uuid>,<other-route-uuid> \
LOCALMIND_CAP_QWEN_PROFILE=qwen-lan \
LOCALMIND_CAP_QWEN_MODEL=qwen3.6-35b-a3b \
node tools/localmind-qwen36-capability-matrix.mjs \
  /tmp/localmind-qwen36-certification.json
```

Deployment-specific settings are configurable:

| Environment variable                   | Default                                               |
| -------------------------------------- | ----------------------------------------------------- |
| `LOCALMIND_CAP_SERVER_ORIGIN`          | `http://localhost:3011`                               |
| `LOCALMIND_CAP_MCP_ENDPOINT`           | Derived from origin and workspace ID                  |
| `LOCALMIND_CAP_CONFIG_PATH`            | `.docker/selfhost/data/localmind/config/config.json`  |
| `LOCALMIND_CAP_SERVER_CONTAINER`       | `localmind_affine_server`                             |
| `LOCALMIND_CAP_POSTGRES_CONTAINER`     | `localmind_affine_postgres`                           |
| `LOCALMIND_CAP_POSTGRES_USER`          | `affine`                                              |
| `LOCALMIND_CAP_POSTGRES_DATABASE`      | `affine`                                              |
| `LOCALMIND_CAP_MINIMUM_RUNS`           | `20`                                                  |
| `LOCALMIND_CAP_DOC_ROUNDS`             | Certification minimum                                 |
| `LOCALMIND_CAP_FOLDER_ROUNDS`          | Certification minimum                                 |
| `LOCALMIND_CAP_NEGATIVE_SEARCH_ROUNDS` | Certification minimum                                 |
| `LOCALMIND_CAP_SUITES`                 | `answer,document,search,folder` in certification mode |

The runner writes `copilot.localModelAdapters.evaluationMode=true` only to its
temporary configuration and restores the original file afterward.

## Release decision

The output contains `certificationCandidate`. A capability passes only when:

- every required operation has at least 20 independent cases;
- all cases pass strict grading and state verification;
- false successes are zero;
- duplicate real side effects are zero;
- all action usage records name the locked Qwen model;
- the adapter version is `7`;
- route, configuration, credential cleanup, and usage collection succeed.

Repeated calls and idempotent replays are reported as telemetry but are not
misclassified as duplicate side effects. The candidate includes a SHA-256
fingerprint and never edits the production gate automatically.

Review the raw cases, usage evidence, cleanup status, and candidate fingerprint
before copying a passing capability's `releaseGate` into the adapter profile and
changing its status from `testing` to `enabled`. Capabilities that do not pass
remain unavailable in production.

## Local checks

The report builder has a standalone test suite:

```bash
node --test tools/localmind-qwen36-certification.test.mjs
```

The full MCP delegation E2E additionally requires the repository PostgreSQL and
Redis test services. It verifies model and adapter snapshot integrity before any
model request is dispatched.
