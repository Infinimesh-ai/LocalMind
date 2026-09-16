# LocalMind LLM streaming patch

Sources: crates.io `llm_adapter` 0.2.11 and `llm_runtime` 0.2.7, upstream
<https://github.com/darkskygit/llm_adapter>, commit
`6b229c85553e9e72fd7a31b43833edcd4be4198a`. Each directory retains its upstream
AGPL-3.0-only LICENSE, Cargo metadata, README and `.cargo_vcs_info.json`.

Original registry archive checksums (also recorded in the pre-patch Cargo.lock):

- llm_adapter: `c44c287854e9dbe2a92e14b1a41590859a47570e328ec3fbc382645f5cc06e94`
- llm_runtime: `85273703c62321335888c3417462b4ace530d38479bcb4c920760808a953707f`

The root workspace pins and patches these exact versions. No registry-cache
modification or diagnostic proxy is required. Local changes:

- OpenAI streaming parsers in `src/stream/openai.rs` bind index/item aliases to
  real call IDs, validate identities and complete JSON objects, and buffer tool
  calls until successful terminal events. Missing identities, incompatible
  snapshots, upstream failures, truncated streams and resource limits fail closed.
- SSE input is bounded to 16 MiB per response, at most 128 calls and 1 MiB of
  arguments per call. Other choices cannot enter the choice-zero tool round.
- Responses nested usage is retained; usage is emitted once per runtime round.
- Structured output is schema-validated before successful dispatch when the
  production `schema` feature is enabled. Validation errors omit response text.
- Runtime rounds reject unfinished accumulators, invalid tool arguments and
  unsuccessful/missing terminals; repeated completed calls are deduplicated and
  identity conflicts are rejected.

Legacy Chat `function_call` frames without a real upstream call ID are rejected.
This intentionally avoids fabricated IDs entering persistent execution receipts.

Run:

```sh
cargo test -p llm_adapter -p llm_runtime --lib --no-default-features --features ureq-client,schema
```

These tests do not replace Linux N-API packaging, live provider probes, persistent
checkpoint recovery, configuration cutover or application-level completion tests.
