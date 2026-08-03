# AI Modernization Four-Step Plan - Handoff

## Status

Completed on 2026-07-06.

The original four-step plan is implemented:

1. `agent_runtime_model_completion` executes persisted model steps through the
   existing DB-routed Copilot `PromptRuntime`/provider stack with timeout,
   cooperative cancellation, redacted bounded output evidence, timeline
   events, step output, and `ai_agent_runtime_execution_results` ledger rows.
2. `agent_runtime_doc_update` is the first approval-gated office-task adapter:
   a GraphQL request creates a waiting-approval AgentRun, approval queues the
   worker, the worker updates a workspace document via `DocWriter`, and
   side-effect evidence is recorded in step output, timeline, and execution
   result ledger rows.
3. Provider Health probe attempts keep the local no-network provider contract
   probe as default and can optionally run a real provider runtime text probe
   when `LOCALMIND_PROVIDER_HEALTH_NETWORK_PROBE=1` or
   `COPILOT_PROVIDER_HEALTH_NETWORK_PROBE=1`.
4. Prompt Registry body edits are available through preview/publish GraphQL
   mutations with bounded line diff, fingerprint gating, prompt body mutation,
   and a DB-backed editable-body prompt registry revision.

## Important Implementation Notes

- Approval/reject control for standalone Agent Runtime runs uses
  `agent-runtime-approval-control/v1` and `approvalControl` step evidence so it
  does not collide with the older cancel/resume `manualControl` DB contract.
- Side-effectful Agent Runtime worker completions require a side-effect
  summary when `sideEffectsApplied=true`.
- New migration
  `20260622670000_ai_agent_runtime_side_effectful_worker_completion` extends
  the worker completion and execution-result DB contracts so
  `workspace_write`/`external_tool` completions can persist side-effect
  summaries while no-side-effect completions still omit them.
- The prebuilt `localmind-affine:test` image restores a baked DB schema and
  `initTestingDB` only truncates tables. For local validation before rebuilding
  the image, apply the new migration SQL to the test Postgres once before
  running the doc-update smoke.

## Focused Validation

Passed:

- `yarn eslint` on changed backend implementation and focused e2e files.
- `repair-execution.e2e.ts -m '*standalone*office*task*updates*'`
- `repair-execution.e2e.ts -m '*model*completion*adapter*'`
- `provider-registry-revision.e2e.ts -m '*optional*network*provider*probes*'`
- `provider-registry-revision.e2e.ts -m '*automatic*workspace*probe*attempt*results*'`
- `prompt-registry-revision.e2e.ts -m '*prompt*body*edit*'`

For the doc-update smoke with the current prebuilt image, first apply:

```bash
docker run --rm --network localmind-test-net \
  -e PGPASSWORD=affine \
  -v $(pwd)/packages/backend/server/migrations/20260622670000_ai_agent_runtime_side_effectful_worker_completion/migration.sql:/migration.sql:ro \
  postgres:16 psql -h localmind-test-pg -U affine -d affine -f /migration.sql
```

Then run the focused smoke with the usual `localmind-affine:test` container and
`packages/backend/server/src` bind mount. A rebuilt test image will include the
new migration and should not need the manual psql step.

## Follow-Ups

- Planner, parallel tool scheduling, rollback execution, Codex/MCP/handoff
  adapters, and broad arbitrary workflow execution remain non-goals for this
  completed slice.
- Support bundle signing adapters and operational alerting remain deployment
  follow-ups.
- Provider credential management/testing UX and richer Prompt Registry
  diff/eval/Admin review views remain registry product follow-ups.
