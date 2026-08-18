# Benchmark results

- `forge-v4-phase0-local.json` is the quota-free v4 cross-process context probe.
- `forge-v4-codex-hooks-local.json` records the installed Codex CLI/plugin and
  validates the local `PreToolUse` response shape; its host invocation remains
  explicitly `not-run`.
- `A-claude.json` is an immutable v3 result kept for historical comparison; it
  is not a v4 measurement and has no v4 model-step or judge fields.
- Provider A-J v4 results are intentionally absent until an authorized
  subscription benchmark run is completed.
