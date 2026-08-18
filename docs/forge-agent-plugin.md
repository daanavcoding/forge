# Forge Agent Plugin

The canonical package is `plugins/forge/`. It exposes two public Forge
workflow skills and keeps the task-specialist catalogue private:

- `skills/forge/SKILL.md` is the Forge workflow contract.
- `skills/forge-commit/SKILL.md` refreshes the applicable project context and
  creates a verified, narrowly staged commit.
- `worker-skills/` contains the 20 private task-specialist skills (`python`,
  `fastapi`, `langgraph`, `rag`, `react`, and the rest).

Only `skills/forge` and `skills/forge-commit` are under
the host's native skill discovery path. The hook reads one host-specific
project-context file and
delivers it once: `AGENTS.md` for generic agents/Codex, or `CLAUDE.md` for
Claude. Forge reuses that block during plan execution, uses the application
description plus task/repository evidence to select the relevant private
specialist names from the metadata-only catalogue without opening their bodies.
After selection, Forge reads and applies only the selected `SKILL.md` bodies.
The specialist catalogue is never registered as standalone host skills and the
context file is not re-read or delivered a second time.

The package implements compatible client layers without duplicating the workflow:

1. `plugin.json` and the public `skills/` tree implement the vendor-neutral
   Agent Plugins 1.0.0 package. Skills-capable clients discover only the two
   immediate children `forge` and `forge-commit`; the private
   catalogue lives outside that path.
2. `.codex-plugin/plugin.json` and `hooks/hooks.json` add the ChatGPT/Codex
   distribution and lifecycle extension.
3. `.claude-plugin/plugin.json`, `claude/hooks.json`, and the repository-level
   `.claude-plugin/marketplace.json` provide native Claude Code installation.
4. OpenCode loads the two public skills from its native skill directory;
   Cursor loads the Agent Plugin or a public Agent Skill; Antigravity loads the
   package from its native plugin directory.

The Codex and Claude hooks recognize `$forge`, `/forge`, and
`/forge:forge` invocations and the Forge picker attachment. The Codex prompt
hook also observes ordinary turns but returns no context unless it sees an
explicit activation or a `yes`/`si` approval immediately following a
`Forge plan` in the same host transcript. That continuation path covers Forge
skills discovered by Codex from natural language after prompt-hook dispatch.
For tasks whose host snapshot predates the installed hook, the public Forge
skill can invoke `scripts/hook.mjs --manual-approved` locally after approval.
That recovery returns the same complete `additionalContext` contract and
creates normal run state; it makes no model or network call.
`forge-commit` is intentionally a normal public skill rather than a hook mode:
Codex and other skills-capable agents can discover it from natural-language
requests to commit completed work. Ordinary prompts do not start Forge or
inject context. The prompt hook makes no model or network calls. On
activation it injects
bounded local Graphify evidence, the applicable project-context file once,
private-skill discovery instructions, and compact ephemeral run facts.
After explicit approval in a later user turn, the model selects private
specialist names from the metadata list during plan execution, then reads and
applies only those selected skill bodies. The original task request is not
approval and the hook does not select them.

Every activation persists `.forge/runs/<run_id>/run.json` and supplies the
summary path in `run_state`. At terminal exit the main Forge skill writes one
completed or failed model-authored handoff directly to that path when a host
hook supplies run state. The skill does not write `## Telemetry`. `resume` reads
the injected failed summary and continues that run. A Codex `SessionEnd` hook
then launches a detached local worker that makes one best-effort pass over the
transcript and creates the `## Telemetry` section from observed values. The
final chat is the normal user-facing answer followed by a link to the
persisted file, not the summary pasted as the only output.
Forge never launches a nested host or a model judge.

The host-generated telemetry section may include compact execution telemetry
when the host exposes it: platform/model/effort, token breakdown, cost
estimate, duration/latency, turn and call counts, per-tool usage, activation,
and timestamps. Forge labels subscription cost as API-equivalent and leaves
the actual billed amount unavailable; it never manufactures missing usage. The
fail-open SessionEnd worker writes observed token counts, latency, and
host-reported credits after the model turn. If the transcript is absent or
malformed, the handoff remains valid without a telemetry section. The
compatibility finalizer offers the same optional host-side enrichment when
given a trace explicitly.

For benchmark evidence only, `bench/v5.mjs` copies that skill-owned summary
after the host trace closes and replaces only the copied `## Telemetry` section
with the observed trace usage. It labels benchmark weighted units and
API-equivalent USD separately from the unavailable subscription credits.

## Remote installation

End users install directly from the GitHub marketplace; they do not clone the
repository or run npm:

```powershell
codex plugin marketplace add daanavcoding/forge --ref main
codex plugin add forge@forge

claude plugin marketplace add daanavcoding/forge
claude plugin install forge@forge --scope user
```

Both clients fetch the Git repository into their own marketplace/plugin cache
and resolve the relative `plugins/forge` source declared by the corresponding
marketplace. Codex still requires host-owned hook review and trust. Claude Code
can activate an install in the current session with `/reload-plugins` when it
does not activate immediately.

## Local development and managed Codex installation

Use the repository host manager to register the local marketplace and install
`forge@forge`. Codex auto-discovers the canonical `hooks/hooks.json` directory
and materializes both hooks during installation. The same portable directory is
safe when Claude Code discovers it: its commands exit silently on a
Claude-only host, while `claude/hooks.json` owns Claude context injection. Codex
requires review/trust for non-managed command hooks; the setup command verifies
and fails unless both definitions are enabled and trusted:

```powershell
npm run plugin:setup -- codex
npm run plugin:doctor -- --client codex --json
```

The setup command prunes Claude-only files from the materialized Codex cache:
`.claude-plugin/`, `claude/`, and `scripts/claude-hook.mjs`. Those files remain
in the portable source package and are installed only by the Claude workflow.

For an administrator- or MDM-managed deployment, the same manager can also
stage the versioned bundle and generate managed policy:

```powershell
npm run plugin:setup -- codex `
  --managed-dir C:\ProgramData\Forge\codex `
  --requirements C:\ProgramData\Forge\codex\requirements.toml `
  --managed-only --force
```

The resulting `requirements.toml` points Codex at the stable Forge dispatcher;
deploy it through Codex's managed configuration. Use `--managed-only` only
when the organization owns all hook sources. Managed policy is optional and is
not part of the normal plugin installation.

`plugin:doctor` reads the Codex hook API and verifies that both Forge hooks are
present, enabled, and trusted; the healthy result is `automatic: true`. Forge's
`FORGE_*` markers are delivered in prompt context; they are not process
environment variables. If a run lacks them, the correct diagnosis is
`hook_context_unavailable`, not an absent private catalogue.

Use `@forge` in Chat/Work. In Codex, use `$forge <task>` or `/forge <task>`.
`forge-commit` is
the separate public commit skill and is discoverable from a natural-language
commit request; it does not need a Forge activation hook. Surfaces without
plugin hooks still run the complete portable skill and record hook-only facts
as unavailable.

## Other coding agents

```powershell
npm run plugin:setup -- claude --scope user
npm run plugin:setup -- opencode --scope user
npm run plugin:setup -- cursor --scope user
npm run plugin:setup -- antigravity --scope user
npm run plugin:doctor -- --json
```

The host manager uses Claude Code's native marketplace/plugin commands and
idempotently installs the public skills for OpenCode, Cursor, and Antigravity.
Claude's full native plugin can also be loaded for one session with
`claude --plugin-dir ./plugins/forge`. Add `--scope project` for
repository-local installation, `--dry-run` to inspect the destinations, or
`--force` to replace only the exact existing Forge targets. The lower-level
`plugin:install-client` command remains available for strict copy-only flows.

## Validation

```powershell
npm run check
npm run plugin:check
npm test
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" plugins/forge
```

The Node checks are repository-owned and portable. The final command is the
optional Codex ingestion validator available in a Codex development install.
