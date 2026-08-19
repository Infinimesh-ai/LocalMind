# LocalMind Three-Model Delegate Benchmark

Date: 2026-08-18

## Scope

- Local LocalMind: `http://localhost:3011`
- Workspace: `d2ae4ead-9686-4c24-ba35-1d7568dea1f7`
- Models: GPT-5.6 Sol, Qwen3.8 27B, DeepSeek V4 Pro
- Public LocalMind was not changed.
- Each valid model run enabled only its target server-BYOK route.
- Route identity was verified from `ai_usage_events.model`, not from UI labels.

The benchmark covered:

- strict structured answer generation;
- `delegate_to_localmind` and idempotent replay;
- answer, `tool_agent`, and `document_update` plans;
- document creation, search/read, update, and post-update verification;
- `get_localmind_task` immediate and long polling;
- `control_localmind_task` cancellation and idempotent replay.

## Summary

| Model           | Verified route    | Atlas quality | Delegate integration | Main result                               |
| --------------- | ----------------- | ------------: | -------------------: | ----------------------------------------- |
| GPT-5.6 Sol     | `gpt-5.6-sol`     |          9/10 |                  6/8 | Best overall reliability and grounding    |
| DeepSeek V4 Pro | `deepseek-v4-pro` |          9/10 |                  6/8 | Similar quality; faster document creation |
| Qwen3.8 27B     | `qwen3.8-27b`     |          4/10 |                  2/8 | Planner output is slow and unstable       |

The integration score has four two-point checks: create, search/read, update,
and cancel. Search/read failed for every model because the common embedding
upstream returned HTTP 502. Qwen's two points come from a successful targeted
cancellation run.

## Latency

Times are end-to-end from the local MCP client. `Submit` is the synchronous
`delegate_to_localmind` planning call. `Total` includes queued Agent Runtime
execution and polling to terminal state.

| Case                            |     GPT-5.6 Sol |              Qwen3.8 27B | DeepSeek V4 Pro |
| ------------------------------- | --------------: | -----------------------: | --------------: |
| Atlas answer                    |          17.40s |                   76.26s |          21.55s |
| Create document, submit / total |  2.84s / 16.93s | 11.92s / failed planning |   3.09s / 8.15s |
| Search/read, submit / total     | 11.38s / 79.55s |         10.41s / 124.52s |  3.49s / 49.65s |
| Update document, submit / total |   3.22s / 4.26s | 16.35s / failed planning |   3.70s / 4.73s |
| Verify updated snapshot         |           2.94s | 7.22s, original remained |           1.89s |
| Cancel, submit / terminal       |   3.75s / 4.86s |          12.92s / 14.02s |   3.77s / 4.87s |
| Delegate idempotent replay      |          10.8ms |                   10.5ms |          10.3ms |

Qwen's Atlas answer repeated at 84.63s in the targeted update run. Its high
latency correlates with 1,469 completion tokens for one planner response, most
of which were reasoning rather than final answer content.

## Quality

GPT and DeepSeek both respected the requested Markdown structure: one short
conclusion, exactly three table rows, and exactly three owner/deadline actions.
Both stayed grounded in the supplied facts. GPT was slightly more conservative
when ownership was unknown.

Qwen flattened the table and actions into one line, so Markdown was not usable.
It also promoted the 980/1000 TPS difference to a top-three release risk even
though the source explicitly said the pressure test passed, while omitting the
strong customer-import evidence. It introduced inferred deadlines instead of
using `待确认` consistently.

## Delegate Behavior

### GPT-5.6 Sol

- Correctly selected `answer`, `tool_agent`, and `document_update` plans.
- Created and updated the synthetic document successfully.
- Verified the exact updated marker.
- Cancellation reached `cancelled`; replay returned the same control ID with
  `idempotentReplay=true`.
- On search failure, it was relatively cautious and did not fabricate a marker.

### DeepSeek V4 Pro

- Correctly selected all three plan kinds.
- Created the document in about half GPT's total time.
- Updated and verified the exact marker successfully.
- Cancellation and replay both passed.
- During failed search it called more fallback tools, but incorrectly described
  the folder listing as authoritative for all readable documents and concluded
  that the known-created document did not exist.

### Qwen3.8 27B

- Produced one valid `answer` plan, but with badly flattened answer formatting.
- Document creation planning failed with `ai_planning_failed`.
- A separate search task reached `tool_agent` and used tools, but could not find
  the absent prerequisite document and was slowed by repeated 502 retries.
- A targeted `document_update` against a known document also failed planning.
- Cancellation was unstable across runs: one plan failed before it became
  cancellable; a targeted repeat selected `tool_agent` and cancelled correctly.
- The public control replay remained idempotent when cancellation succeeded.

## Infrastructure Findings

1. `doc_semantic_search` was not a model-specific failure. The local adapter
   was healthy, but `sparkclaw.infinimesh.cloud/embedding/v1/embeddings`
   returned HTTP 502. All three search comparisons are therefore inconclusive.
2. Documents created by `doc_create` were not present in
   `workspace_folder_list`, so a model must not treat that list as proof that a
   document does not exist.
3. One early cancellation race produced a Prisma `Transaction not found` error
   in Agent Runtime. The retry benchmark passed for GPT, DeepSeek, and the
   targeted Qwen cancellation, but this concurrency path should be hardened.

## Usage Diagnostics

| Model run                | Requests | Prompt tokens | Completion tokens | Total tokens |
| ------------------------ | -------: | ------------: | ----------------: | -----------: |
| GPT valid suite          |       17 |        31,781 |               854 |       32,635 |
| Qwen primary valid suite |       11 |         1,762 |             2,164 |        3,926 |
| DeepSeek valid suite     |       15 |         5,226 |             2,131 |        7,357 |

Token counts are diagnostic, not a direct cost comparison: tokenizers differ,
failed calls may be accounted differently, and GPT's search loop accumulated
large repeated prompts.

## Recommendation

Keep GPT-5.6 Sol as the default LocalMind model. DeepSeek V4 Pro is a credible
alternative for document-heavy delegate workflows and was faster on creation,
but its fallback search reasoning was more overconfident. Qwen3.8 27B should
not be used as the default delegate planner yet; it needs structured-planner
prompt/decoder tuning and a stable Responses tool-planning path.
