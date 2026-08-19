# LocalMind Four-Model Delegate Benchmark

Date: 2026-08-18

## Scope

- Local LocalMind: `http://localhost:3011`
- Qwen server: `192.168.20.207`, one NVIDIA RTX 4090-class 48 GB GPU
- Qwen3.5 model: `Qwen3.5-35B-A3B-FP8`
- Qwen3.5 runtime: vLLM, non-thinking mode, one sequence, 262,144-token model limit, Qwen tool-call parser enabled
- Public LocalMind was not changed.
- Each valid model run enabled only its target server-BYOK route during the run.
- Route identity was verified from `ai_usage_events.model`, not from UI labels.

The common LocalMind suite covered structured answers, delegation and replay,
document creation/search/read/update/verification, task polling, cancellation,
and control replay. Additional Qwen3.5 probes isolated native model quality,
planner wire compatibility, and long-context retrieval from LocalMind behavior.

## Summary

| Model               | Verified route    | LocalMind Atlas | Delegate integration | Main result                                              |
| ------------------- | ----------------- | --------------: | -------------------: | -------------------------------------------------------- |
| GPT-5.6 Sol         | `gpt-5.6-sol`     |            9/10 |                  6/8 | Best overall reliability and grounding                   |
| DeepSeek V4 Pro     | `deepseek-v4-pro` |            9/10 |                  6/8 | Similar quality; faster document creation                |
| Qwen3.8 27B         | `qwen3.8-27b`     |            4/10 |                  2/8 | Slow and unstable planner output                         |
| Qwen3.5 35B-A3B FP8 | `qwen3.5-35b-a3b` |            8/10 |                  6/8 | Fastest successful local run after planner normalization |

Qwen3.5 initially scored 0/10 and 0/8 because its structured planner output
used the wrong narrative fields and its tool calls were returned as plain XML.
After adding a tolerant planner adapter, deterministic answer/document routing,
Markdown normalization, and the required vLLM tool parser, the unchanged suite
scored 8/10 and 6/8.

The integration score has four two-point checks: create, search/read, update,
and cancel. The repaired Qwen3.5 run created, updated, verified, and cancelled
work successfully. Its remaining loss was the shared embedding/search failure
also seen by GPT-5.6 Sol and DeepSeek V4 Pro.

## Latency

Common-suite times are end-to-end from the local MCP client. Qwen3.5 numbers
below are from the final repaired full run.

| Case                        |     GPT-5.6 Sol | DeepSeek V4 Pro |              Qwen3.8 27B |                 Qwen3.5 35B-A3B |
| --------------------------- | --------------: | --------------: | -----------------------: | ------------------------------: |
| Atlas answer                |          17.40s |          21.55s |                   76.26s |                           5.60s |
| Create, submit / total      |  2.84s / 16.93s |   3.09s / 8.15s | 11.92s / planning failed |                   1.04s / 4.05s |
| Search/read, submit / total | 11.38s / 79.55s |  3.49s / 49.65s |         10.41s / 124.52s | 1.58s / 5.59s, embedding failed |
| Update, submit / total      |   3.22s / 4.26s |   3.70s / 4.73s | 16.35s / planning failed |                   2.80s / 3.83s |
| Verify updated snapshot     |           2.94s |           1.89s | 7.22s, original remained |                           0.86s |
| Cancel, submit / terminal   |   3.75s / 4.86s |   3.77s / 4.87s |          12.92s / 14.02s |                   4.86s / 5.96s |
| Delegate idempotent replay  |          10.8ms |          10.3ms |                   10.5ms |                          10.2ms |

The Qwen3.5 vLLM process reported about 42 generated tokens/second after
warm-up. The first LocalMind call included additional Triton shape compilation;
direct warm calls took 0.66-1.71 seconds for short planner/answer requests.

## Qwen3.5 Planner Compatibility

The initial run exposed four repeatable incompatibilities: narrative text in
the wrong schema field, omitted empty fields plus undeclared fields, read-only
requests misclassified as `unsupported_task` or `tool_agent`, and complete
document replacements misclassified as general tool work.

The repaired planner now:

1. Keeps a strict provider-facing JSON Schema but tolerantly normalizes known
   fields at the server boundary.
2. Renders incomplete structured answers as plain text, preserves literal
   newlines, and normalizes requested Markdown tables/action items.
3. Forces read-only requests with provided snapshots onto the answer path.
4. Forces a literal full replacement of one authorized document onto the
   ACL-bound `document_update` path, regardless of the model-selected branch.
5. Caps planner output at 8,192 tokens and final renderers at 6,000 tokens.

The final run issued 12 verified requests through `qwen3.5-35b-a3b`; document
creation, exact replacement/verification, cancellation, and idempotent replay
all passed.

## Required vLLM Launch

Qwen tool calls are emitted as plain XML text unless automatic tool choice and
the Qwen parser are both enabled. The validated single-concurrency launch is:

```bash
vllm serve /home/infinimesh/models/Qwen3.5-35B-A3B-FP8 \
  --served-model-name qwen3.5-35b-a3b \
  --host 0.0.0.0 --port 8000 \
  --max-model-len 262144 --max-num-seqs 1 \
  --gpu-memory-utilization 0.95 --kv-cache-dtype auto \
  --language-model-only \
  --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --default-chat-template-kwargs '{"enable_thinking":false}'
```

`qwen3_coder` and `qwen3_xml` select the same installed Qwen3 XML parser in
this vLLM environment. On final verification, PID `12306` returned HTTP 200
from `/health` and used about 46,648 MiB of 49,140 MiB GPU memory.

## Native Document Quality

To separate raw model capability from planner integration, a deterministic
needle-retrieval probe placed one exact fact in the middle of repetitive
document text. All three context sizes returned the exact requested value.

| Actual input tokens | End-to-end latency | Exact retrieval |
| ------------------: | -----------------: | --------------: |
|              32,778 |              2.51s |             yes |
|             131,074 |             15.18s |             yes |
|             240,007 |             42.02s |             yes |

This demonstrates strong retrieval at the tested positions and lengths, but it
is not a substitute for multi-document synthesis or adversarial long-context
evaluation. LocalMind creation and exact replacement now pass; semantic search
remains blocked by the shared embedding upstream.

## Context Recommendation

The tested runtime exposed a 262,144-token model limit with
`--max-num-seqs 1`. vLLM allocated 535,730 GPU KV-cache tokens and reported a
2.04x theoretical concurrency at the full configured length. Total GPU memory
usage was about 45.6 GiB of 49.1 GiB.

- Keep `--max-model-len 262144` as the server capacity for single concurrency.
- Use 128K as the normal per-task document budget. It passed exactly in 15.18
  seconds and gives a much better latency margin than near-limit requests.
- Permit 240K-256K only for exceptional documents; the 240K probe passed but
  took 42.02 seconds before any substantial answer generation.
- Use 32K for interactive planning and ordinary documents when possible; the
  corresponding probe completed in 2.51 seconds.

The large configured limit does not force every request to compute 262K tokens;
it mainly reserves capacity. Application-level routing should choose the
smallest context that contains the required evidence.

## Usage Diagnostics

| Model run                   | Requests | Prompt tokens | Completion tokens | Total tokens |
| --------------------------- | -------: | ------------: | ----------------: | -----------: |
| GPT valid suite             |       17 |        31,781 |               854 |       32,635 |
| DeepSeek valid suite        |       15 |         5,226 |             2,131 |        7,357 |
| Qwen3.8 primary valid suite |       11 |         1,762 |             2,164 |        3,926 |
| Qwen3.5 repaired full suite |       12 |         3,851 |             1,173 |        5,024 |

Qwen3.5 now exercises the same functional paths as the successful hosted-model
runs. Its extra render/format repair calls trade a small token increase for
stable planner compatibility.

## Recommendation

Qwen3.5 is now viable as LocalMind's local single-concurrency planner: it
matches GPT-5.6 Sol and DeepSeek V4 Pro at 6/8 integration while completing the
successful cases materially faster. Keep GPT-5.6 Sol as the default for the
moment because its Atlas grounding is still stronger and Qwen3.5 relies on the
new repair adapter. Use Qwen3.5 for local/private workloads and collect repeated
run data before making it the global default. Fixing the shared embedding
upstream is the next dependency that would raise all three successful models
from 6/8 to 8/8.
