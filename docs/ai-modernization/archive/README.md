# AI Capability Modernization Archive

This archive replaces the former root-level `docs/ai-capability-modernization-plan.md` file.

The old document became too large to use as an execution entrypoint. It has been split by topic so historical records remain searchable without pushing new work back into the old read-only diagnostic pattern.

## Read Current Planning First

Use these current documents before reading the archive:

- [AI modernization entrypoint](../README.md)
- [Document map](../document-map.md)
- [Branch differences](../branch-differences.md)
- [Current state](../current-state.md)
- [Next goals](../next-goals.md)

## Archive Volumes

1. [Overview and roadmap](./00-overview-roadmap.md)
   Original sections 1-15: background, architecture goals, provider/model/prompt/agent plans, roadmap, validation, and initial priorities.
2. [Model routing and prompt diagnostics](./01-model-routing-prompt-diagnostics.md)
   Original sections 16-224: P0/P1 compatibility, provider/model routing, prompt catalog, task route diagnostics, Admin diagnostics, and publish-gate evidence.
3. [Repair recommendation and execution contracts](./02-repair-recommendation-execution-contracts.md)
   Original sections 225-343: repair recommendation contracts, preview/preflight/request snapshots, target locators, and candidate evidence bindings.
4. [Agent runtime and support bundle projections](./03-agent-runtime-support-bundle-projections.md)
   Original sections 344-554: Agent Runtime diagnostic projections plus the historical support-bundle source-evidence placeholder chain.
5. [Durable vertical slices](./04-durable-vertical-slices.md)
   Original sections 555-606: first durable support bundle, repair execution, Agent Runtime, DB registry, provider health, and worker slices.
6. [Integrity, workers, and visibility hardening](./05-integrity-workers-visibility-hardening.md)
   Original sections 607-827: payload boundaries, DB constraints, append-only history, worker lease fences, delete restrictions, retry/replay controls, and filtered visibility.

## Archive Rule

These files are historical records. New AI modernization tasks should update the active track documents under `docs/ai-modernization/tracks/` and only add archive landing notes when traceability is explicitly useful.

Some archived sections still mention former paths such as
`docs/ai-capability-modernization-plan.md` or
`docs/localmind-ai-goal-continuation.md` because the body text is preserved for
auditability. Treat those references as historical, not as active entrypoints.
