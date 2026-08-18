# AGENTS.md

## Project purpose

- Forge v5 is a Node.js 20+ portable Agent Plugin. The canonical package lives
  under `plugins/forge/`, while the repository root contains verification and
  benchmark entrypoints.
- The package supports the vendor-neutral plugin layout plus client-specific
  Codex and Claude Code metadata and hooks.

## Repository boundaries

- `plugins/forge/skills/` contains the public host-discovered workflows;
  private task-specialist material belongs under `plugins/forge/worker-skills/`
  and must not be exposed as standalone host skills.
- `plugins/forge/scripts/` contains deterministic hooks, host installation and
  doctor commands, run-state handling, and telemetry finalization. Hooks must
  remain fail-open and must not make model or network calls.
- `.forge/` and benchmark outputs are generated runtime data. Keep generated
  traces, summaries, judges, and ad-hoc results out of commits unless the task
  explicitly requests them.
- Never inspect or copy values from `.env` or `appsettings.json`.

## Verification

- Use `npm run check` for Node syntax checks.
- Use `npm run plugin:check` for manifest, layout, hook, skill, run-state, and
  telemetry self-checks.
- Use `npm test` for the full self-check and dry benchmark harness. Live
  benchmarking requires explicit subscription-usage confirmation.

## Change conventions

- Keep the public manifests, hook declarations, and client adapters aligned
  with the canonical package layout.
- Stage only files belonging to the requested change; preserve unrelated dirty
  work and do not use blanket staging.
