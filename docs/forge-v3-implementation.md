# Forge v3 implementation

Forge v3 replaces the v2 patch/runtime engine with host-native orchestration.

## Delivered plan phases

| Phase | Delivered |
|---|---|
| 0 | Exact hook definitions and `additionalContext`-only behavior; normal prompts pass through. Codex's current manifest schema does not register hooks, so its public skill carries the same invariant directly. |
| 1 | Legacy benchmark figures remain in the reconstruction plan and the raw Codex baseline is retained under `bench/baselines/`. |
| 2 | Data-driven A–H matrix, clean/config equivalence validation, weighted cost, medians/ranges and independent token audit. |
| 3 | Adaptive meta-prompt decision, compact plan validation, deterministic/agent gate, evidence-based completion and non-blocking reviewer policy. |
| 4 | Claude command plus native planner, worker and reviewer definitions fixed to Sonnet 5 medium. |
| 5 | Single Codex skill using native sessions, `exec resume` only as unavailable-native fallback policy, fixed Luna max and explicit fast-tier failure. |
| 6 | Private multi-skill discovery by file type, Graphify proposal/fallback and strict lossless Headroom gate. |
| 7 | Hash-based write preconditions, non-overlap validation, conflict/cancellation/resume protocol and no false completion. |
| 8 | Benchmark definitions, subscription-only executors and audit utilities for both hosts. `solo` and `forge` pin the same production model/effort; optional judge usage is isolated from arm metrics. Direct API credentials and extra Codex credits are rejected. Provider runs are intentionally not fabricated or purchased by the test suite. |
| 9 | v2 engine, DSL, runners and public mode skills removed; manifests, documentation and tests target v3. |

## Model invariant

Codex uses `gpt-5.6-luna` with reasoning `max` for every model-bearing phase.
Claude Code uses `claude-sonnet-5` with effort `medium` for every model-bearing
phase. The invariant explicitly includes specification, planning, implementation,
review, correction, continuation and resumption. No public override exists.

## Deliberate boundary

Forge cannot prove benchmark superiority without executing paid stochastic provider
runs. The harness therefore requires explicit subscription confirmation, starts every
arm from the same clean commit in an isolated worktree, reports only observed telemetry
and rejects dirty or non-equivalent records. This avoids turning an unrun benchmark
into a success claim.
