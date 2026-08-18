# Forge v4 implementation record

This document records the implementation and evidence for `docs/forge-v4-plan.md`.
It distinguishes local probes from paid provider measurements. The latter require
an explicit `--confirm-subscription-usage` flag and a live Codex or Claude host.

> Historical implementation record. The paths and hook policy below describe a
> superseded v4 experiment; the current integration surface is the Agent Plugin
> under `plugins/forge/`.

## Phase 0: measurement first

- `plugins/forge/core/context.mjs` builds a bounded, byte-stable context block, inlining
  complete bodies for selected small text files and recording both repeated bytes and
  SHA-256 hashes.
- Provider traces count completed model turns independently from token totals.
- `bench/telemetry.mjs` persists cache, model-step, Graphify, hook-policy, skill,
  meta-prompt and judge coverage. Unknown values remain `known:false`, never zero.
- `bench/run.mjs` defaults stochastic scenarios to five runs and enables judging
  by default. It reports insufficient samples and invalid measurements as gates.
- `bench/results/forge-v4-phase0-local.json` is a real local measurement: three
  separate `UserPromptSubmit` child processes used one session id and changing
  turn ids. The context was 4,665 bytes; the result file records the identical
  SHA-256 on all three runs.
  This proves cross-process hook determinism, not cache reuse inside a live
  provider session; that provider-session part remains explicitly unmeasured.

## Phase 1: remove the v3 machinery

- Headroom, separate model preparation, plan validation, the eleven-gate QA
  harness and planner/worker/reviewer/QA agent roles were removed from the active
  implementation.
- The only surviving optional subagent is the compact Graphify explorer.
- `bench/cases/C.json` has a deterministic script arm. It performs the mechanical
  replacement directly, records exactly zero model steps and is excluded from
  provider cost comparisons.

## Phase 2: native one-session protocol

- `plugins/forge/skills/forge/SKILL.md` is the single host rulebook: flat edit,
  verification and correction orders with the no-false-completion guard. The hook
  injects facts only; `plugins/forge/core/protocol.mjs` keeps cost/recovery logic and
  locates that rulebook for the CLI.
- `plugins/forge/hooks/launch.mjs` injects the same stable context block on every
  repeated prompt and records recovery/benchmark events without starting a nested
  orchestration process.
- Recovery state is persisted through the small `record-recovery` and
  `read-recovery` CLI commands.

## Phase 3: Graphify and search policy

- Graphify discovery uses `extract --code-only --no-cluster` followed by a bounded
  `query`; paths are normalized and constrained to the repository index.
- `PreToolUse` is registered for Codex and Claude. When Graphify is indexed, exact
  `Grep`/`Glob` or search-shaped shell calls are denied with the exact replacement
  command. When Graphify is unavailable, the policy fails open and records the
  reason. `FORGE_NATIVE_SEARCH_ESCAPE=1` is an explicit escape hatch and is also
  measured.
- The Codex hook contract is included in the plugin manifest. The current Codex
  manual was checked for `PreToolUse` denial support and hook trust requirements.

## Codex hook evidence

The local host used for the contract check reported `codex-cli 0.146.0` on
2026-08-03. `codex plugin list` reported `forge@forge-local` installed and
enabled at version `4.0.0`; `codex features list` reported `hooks` as stable and
enabled. The current Codex manual was fetched by the OpenAI docs helper and was
already current in its local cache.

The manual documents the exact facts needed here: `PreToolUse` matches the
canonical tool name, receives `tool_input.command`, and accepts
`hookSpecificOutput.permissionDecision: "deny"` with a reason. It also documents
plugin-bundled hooks and the separate review/trust requirement. Sources:

- [Codex hooks reference](https://learn.chatgpt.com/docs/hooks.md)
- [Bundled plugin lifecycle hooks](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)

This is contract and installation evidence, not an end-to-end host smoke test.
No model turn was started to prove that the installed Codex process actually
invokes Forge's hook and enforces the denial. The benchmark must record that
unknown until such a run is authorized and completed. The reproducible local
record is `bench/results/forge-v4-codex-hooks-local.json`.

## Phase 4: benchmark matrix

The active matrix is A-J. It includes the original behavioral cases, a generated
2,053-file/6.1 MB repository for the Graphify/native-search comparison (`I`),
and a generated 647-file/2.2 MB long-task repository (`J`). J compares one host
session (`solo`) with four fresh sessions carrying bounded handoffs (`slices`).
`bench/execute.mjs` strips direct API credentials, validates the host's
subscription mode, uses fresh worktrees, records the selected host model without
owning a production model policy, and charges judge usage separately.

The fixtures and matrix are locally verified, but no paid A-J result set exists
yet. The only result artifact currently committed for v4 is the local phase-0
probe above; provider quality/cost conclusions must wait for the authorized run.

## Phase 5: long-task decision

No production long-task orchestrator was added. The benchmark-only `slices` arm
launches the four explicit J phases as separate host sessions with bounded
handoffs. The plan still makes shipping that mode conditional on a measured cost
win in phase 4; the gate can now answer the question rather than comparing J to a
short one-line bug.

All active code paths contain a nearby `ponytail:` simplification note where a
deliberate shortcut or boundary is important.

## Verification

The local verification suite covers exact invocation parsing, sensitive-file
exclusion, context determinism and bounds, Graphify fallback/edges, hook denial
and fail-open behavior, recovery limits, benchmark telemetry, judge defaults,
sample-size gates, and the zero-turn deterministic script arm.
