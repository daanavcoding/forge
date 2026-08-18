# Forge 1.0.0

Forge 1.0.0 packages the v5 portable coding workflow with the vendor-neutral
[Agent Plugins 1.0.0 specification](https://agent-plugins.org/). Forge plans
first, then keeps one task in one agent session through implementation,
verification, review, and summary. Forge does not launch a second coding agent,
a model judge, or a nested host session.

The installable package is [`plugins/forge/`](plugins/forge/):

```text
plugins/forge/
|-- plugin.json                    # Agent Plugins 1.0 manifest
|-- skills/forge/                  # Workflow source
|-- skills/forge-commit/           # Context refresh and verified commits
|-- worker-skills/<specialist>/    # Private task-specialist catalogue
|-- .codex-plugin/plugin.json      # ChatGPT/Codex metadata
|-- .claude-plugin/plugin.json     # Claude Code metadata
|-- hooks/hooks.json               # Codex activation hook
|-- claude/hooks.json              # Claude Code activation hook
`-- scripts/                       # Hook and read-only run-state helpers
```

Only `forge` and `forge-commit` live under the host-discovered
`skills/` directory. `forge-commit` is the public commit skill: it
refreshes the applicable host context, reviews `README.md`, updates stale
public documentation, stages only the requested changes, verifies, and commits.
Its description makes it discoverable from ordinary
natural-language commit requests. The activation hook supplies one
host-specific project-context block and a metadata-only private skill list;
Forge selects only the task-relevant private specialist names during plan
execution, then reads and applies only those selected `SKILL.md` bodies.
Client-specific manifests and hooks activate the single Forge workflow. Hosts
without a compatible prompt hook still get the full workflow in chat.
The activation hook supplies `run_state`, creates `.forge/runs/<run_id>/run.json`,
and includes the summary path and any failed summary for `resume`. The main
Forge skill authors and writes the handoff in `summary.md`; Codex's `SessionEnd`
hook then launches a detached, fail-open worker that creates its `## Telemetry`
section from observed token counts, latency, and host-reported credits when
available.

## Install

Requires Node.js 20 or newer when using hooks or the install helper. The skill
itself has no third-party runtime dependency and the package has no MCP server.

### ChatGPT and Codex

Use the host manager from the repository root. It registers the local
marketplace and installs `forge@forge`. The Codex manifest explicitly declares
`hooks/hooks.json`, so installation materializes both Forge hooks. Codex owns
the review/trust decision for non-managed command hooks; the setup command
fails unless the installed definitions are enabled and trusted:

```powershell
npm run plugin:setup -- codex
npm run plugin:doctor -- --client codex --json
```

After Codex materializes the cache, the setup command removes the Claude-only
`.claude-plugin/`, `claude/`, and `scripts/claude-hook.mjs` artifacts from that
Codex installation. The portable source package retains them for native Claude
Code installation.

Organizations that require a centrally managed hook source can additionally
stage a versioned bundle and generate a `requirements.toml` policy:

```powershell
npm run plugin:setup -- codex `
  --managed-dir C:\ProgramData\Forge\codex `
  --requirements C:\ProgramData\Forge\codex\requirements.toml `
  --managed-only --force
```

The administrator deploys that generated policy through Codex's managed
configuration. `--managed-only` makes the managed bundle the sole hook source;
it is not required for the normal plugin installation.

`plugin:doctor` reads Codex's hook API and reports each Forge hook's `enabled`
and trust state. A healthy installation reports `automatic: true`, including
both `UserPromptSubmit` and `SessionEnd`. The `FORGE_*` values are
prompt-context blocks, not process environment variables; missing blocks mean
the hook did not run, not that the private catalogue does not exist.

Use `@forge` or select its skill in Chat/Work. In Codex, use `$forge <task>`,
`/forge <task>`, or select the Forge skill.
When you ask in natural language to commit completed work, Codex can discover
the public Forge Commit skill; it is also selectable as `forge-commit`.
The prompt hook observes every turn but returns an empty result for ordinary
prompts. This lets a later `yes`/`si` approval resume the immediately preceding
`Forge plan` in the same session, including when Codex discovered Forge from
natural language after the original prompt hook had already run.
If an already-open task was created before the current hook was loaded, the
Forge skill invokes the same bundled runtime locally at execution time and
receives the complete context, catalogue, and run state. It never continues as
a reduced workflow.

### Claude Code

The repository is a native Claude Code marketplace and the package includes a
Claude manifest plus a fail-open `UserPromptSubmit` hook. For a local checkout:

```text
/plugin marketplace add .
/plugin install forge@forge
```

The host manager performs that native installation and enables the plugin
without a separate hook-trust menu:

```powershell
npm run plugin:setup -- claude --scope user
npm run plugin:doctor -- --client claude --json
```

For an administrator-managed Claude installation, write the generated policy
to the managed settings location and deploy it with the operating system or
MDM policy:

```powershell
npm run plugin:setup -- claude `
  --managed-settings "C:\Program Files\ClaudeCode\managed-settings.json" `
  --managed-only --force
```

Writing that Windows path requires administrator rights. The managed policy
force-enables `forge@forge` and can restrict hook execution to managed hooks.

For one development session, run `claude --plugin-dir ./plugins/forge`. Invoke
`/forge:forge <task>` or `$forge <task>`. A
natural-language request to commit can discover the public `forge-commit` skill.
A skill-only installation remains available for clients without native plugin
support:

```sh
npm run plugin:install-client -- claude --scope user
```

### OpenCode

OpenCode consumes the same canonical Agent Skill from its native skill path:

```sh
npm run plugin:setup -- opencode --scope user
```

The helper installs `forge` and `forge-commit`. Ask OpenCode to load the
workflow or request a commit in natural language. Project scope writes
`.opencode/skills/forge` and `.opencode/skills/forge-commit`.

### Cursor

Cursor loads `plugins/forge/plugin.json` directly as an Agent Plugin. For local
development, copy the complete package into Cursor's local plugin directory:

```sh
npm run plugin:setup -- cursor --scope user
```

Select the relevant public Forge skill in Cursor or ask the agent in natural
language to use Forge for the task or to commit it.

### Antigravity

Antigravity loads the complete plugin from its native user plugin directory:

```sh
npm run plugin:setup -- antigravity --scope user
```

Project scope installs it at `.agents/plugins/forge`. Select or request the
relevant public Forge skill in the agent, including a natural-language request
to commit completed work.

`plugin:setup` is the idempotent high-level entry point for all supported
clients. The lower-level `plugin:install-client` command remains available for
strict copy operations: existing targets are never replaced unless `--force` is
supplied, and `--dry-run` reports the exact source and destination without
writing.

## Runtime contract

- The first response presents a complete, concise plan and stops. Forge requires
  explicit approval in a later user turn; the original task request never
  counts as plan approval.
- Source edits are minimal and followed by the repository's focused checks.
- Specialist skills are selected by the Forge model during plan
  execution, based on the contents of the host-specific application context
  and focused repository evidence. The hook supplies metadata only; after
  selection, Forge reads only the selected private bodies. They are not
  registered as standalone host skills.
- A green run gets one final review. If that review causes a fix, Forge verifies
  again and allows one last review, never an open-ended review loop.
- A requested commit is delegated to the public `forge-commit` skill. It
  refreshes the applicable `AGENTS.md` or `CLAUDE.md`, writing authored or
  rewritten prose in English only by default unless the user requests another
  language, reviews `README.md` and updates stale public documentation using
  the same language rule, then verifies, stages narrowly, and creates a brief,
  descriptive English commit after green verification.
- Each explicit activation persists `.forge/runs/<run_id>/run.json` immediately.
  When the host supplies `run_state`, the main Forge skill writes one
  model-authored `.forge/runs/<run_id>/summary.md`; only a failed summary can
  be resumed. At Codex `SessionEnd`, a detached local worker makes a best-effort
  telemetry pass over the host transcript and creates the `## Telemetry`
  section. If manual recovery could not receive host-only session identifiers,
  `SessionEnd` joins the transcript by the exact random `run_id` linked in the
  final response. Missing or malformed trace data leaves the handoff intact without
  that section. The final chat remains the normal user-facing answer and ends
  with a link to that file instead of pasting the summary. The skill owns the
  completed/failed layout; missing host data stays explicitly unavailable.
- `.env` and `appsettings.json` are never inspected or injected.

The Codex and Claude hooks make no model or network calls. They deterministically
bootstrap one host-specific project-context block: generic agents and Codex use
`AGENTS.md`, while Claude uses only `CLAUDE.md`. Forge reuses that delivered
block during plan execution and does not reopen or deliver the file again.
Forge activations attempt a bounded local Graphify query. Missing, failed,
invalid, empty, or timed-out Graphify results fall back to native repository
discovery without blocking Forge.

See [`docs/forge-v5-current-contract.md`](docs/forge-v5-current-contract.md) for
the complete current contract and
[`docs/forge-agent-plugin.md`](docs/forge-agent-plugin.md) for packaging details.

## Verify

```sh
npm run check
npm run plugin:check
npm test
claude plugin validate .
claude plugin validate ./plugins/forge
```

`npm run plugin:check` validates the portable, Codex, and Claude manifests,
their aligned versions, native install layouts, packaged skills, compact context,
Graphify readiness/fallbacks, concurrent activation, portable resume,
telemetry normalization and cost labelling, and the public `forge-commit` skill.
`npm test`
also runs the dry benchmark harness without consuming model quota. The Claude
commands are optional and require Claude Code to be installed.

Live benchmarking is explicit because it consumes subscription quota:

```sh
node bench/v5.mjs --scenario small --runs 1 --arm both --judge --confirm-subscription-usage
npm run bench:live
```

Generated fixtures, traces, judge output, and ad-hoc benchmark results stay out
of new commits. The canonical benchmark summary and historical evidence remain
under `bench/results/`.

## Repository status

This repository is ready for public review, but it does not currently declare
an open-source license. Public visibility alone does not grant reuse rights;
the owner should add the intended license before inviting redistribution or
contributions.
