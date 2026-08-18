# Forge

Forge is a portable coding-workflow plugin for AI coding agents. It turns a
request into a controlled sequence: plan, explicit approval, implementation,
local verification, one final review, and a persistent summary. Everything
runs in the current agent session; Forge does not start a second coding agent,
a model judge, or a nested host session.

Use Forge when you want an agent to make repository changes without skipping
the plan, tests, final review, or handoff. It supports Codex and Claude Code
natively and also packages the vendor-neutral
[Agent Plugins 1.0.0 specification](https://agent-plugins.org/).

## How Forge works

1. Invoke Forge with a coding task.
2. Forge presents a concise plan and waits for explicit approval.
3. Its deterministic hook loads the correct project context and a small
   metadata catalogue. Hooks make no model or network calls and fail open.
4. Forge makes the approved changes, runs the repository checks, and performs
   one final review.
5. It writes a resumable summary under `.forge/runs/` and reports the result in
   the same conversation.

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

## Skills: public workflows and private specialists

Forge uses skills as focused instruction sets for the agent. Loading a skill
does not start another agent or model session: the same agent reads the
relevant instructions and applies them to the current task.

The package exposes two public skills that the host can discover:

- `forge` controls the complete coding workflow: plan, explicit approval,
  implementation, verification, final review, and summary.
- `forge-commit` handles an explicitly requested commit. It refreshes the
  correct project context, checks public documentation, stages only the
  intended files, verifies the staged result, and creates the commit.

Forge also includes 20 private specialist skills under `worker-skills/`. They
cover languages, frameworks, databases, agent systems, and related domains.
They are deliberately outside the public `skills/` directory, so Codex or
Claude Code does not present them as 20 independent plugin commands.

Specialist selection happens after the user approves the plan:

1. The hook provides a metadata-only catalogue containing each specialist's
   name and short description. It does not inject all specialist instructions.
2. Forge combines the approved task, project context, Graphify evidence, and a
   focused repository inspection to select every clearly relevant specialist.
3. Only then does Forge read the selected `SKILL.md` files, once, and apply
   their guidance in the same agent session.
4. Unselected specialist bodies are not loaded, keeping context and token use
   bounded.

For example:

| Task | Likely private specialists |
| --- | --- |
| Fix a Node.js ESM CLI | `node`, `javascript` |
| Change a strict React application | `typescript`, `react` |
| Improve a FastAPI RAG pipeline | `python`, `fastapi`, `rag` |
| Design an agent backed by PostgreSQL | `agent-design`, `postgres` |

These are examples, not a fixed routing table. Forge chooses from the actual
task and repository evidence. Users normally invoke only `forge`; they do not
need to select private specialists manually.

## Graphify: bounded repository discovery

[Graphify](https://github.com/Graphify-Labs/graphify) is an optional local
code-graph tool. When its `graphify` executable is available, every explicit
Forge activation uses it automatically before the agent explores the
repository:

1. Forge checks the local Graphify executable.
2. It creates `graphify-out/graph.json` on the first run or updates the existing
   graph on later runs. Extraction is code-only and clustering is disabled.
3. It queries the graph using the user's task, with a bounded evidence budget.
4. The hook injects the resulting nodes and relationships as
   `GRAPHIFY_EVIDENCE`; the agent uses that evidence to identify likely entry
   points and dependencies before opening files.

This is discovery evidence, not an instruction to edit every returned file and
not a replacement for reading the relevant code. Forge still verifies the
actual call paths and repository checks before declaring the task complete.

Graphify execution is local, deterministic, and fail-open. The query uses a
2,000-unit Graphify budget; Forge injects at most 2,048 bytes of its evidence.
The complete version check, index preparation, and query share a 60-second
deadline by default, and subprocess output is capped at 256 KiB. If the
executable is missing, the graph is invalid, the command fails, or the deadline
expires, Forge records the status and continues with the host's native search
and file tools. Graphify never makes Forge unable to run.

`graphify-out/` contains generated local index data. Forge adds it to Git's
local exclude file, and this repository also ignores it; it must not be
committed. Advanced installations can point Forge to another compatible
executable with `FORGE_GRAPHIFY_EXECUTABLE` or adjust the deadline with
`FORGE_GRAPHIFY_TIMEOUT_MS` (maximum 300000 ms). Neither setting is required
for normal use.

## Ponytail philosophy inside Forge

Forge does not load [Ponytail](https://github.com/DietrichGebert/ponytail) as a
separate runtime skill. Instead, its private specialist `SKILL.md` files are
authored with a Ponytail character: understand the real code path first, reuse
what already exists, prefer standard-library and native features, avoid
speculative abstractions, and make the smallest correct change.

This behaviour is applied automatically when Forge selects a specialist. For
example, the Node specialist prefers built-in APIs and rejects unnecessary
dependencies, while the agent-design specialist questions whether an agent or
delegation is needed before adding one. The guidance lives directly in those
specialist instructions, so users do not install Ponytail separately, select
it, or mention it in the prompt.

Ponytail influences implementation style; Forge still owns the workflow:
explicit planning and approval, focused repository inspection, verification,
one final review, and the run summary. Minimalism never overrides requested
requirements, security, input validation, accessibility, data-loss protection,
or the checks needed to prove the change works.

## External references

- [Graphify repository and CLI documentation](https://github.com/Graphify-Labs/graphify)
- [Ponytail project and design philosophy](https://github.com/DietrichGebert/ponytail)

## Install

Normal installation does **not** require cloning or manually downloading this
repository. Codex and Claude Code fetch Forge from GitHub into their own plugin
cache. Node.js 20 or newer is required to run the bundled hooks; Forge has no
third-party runtime dependency and no MCP server.

### Codex

Run these commands in a terminal:

```powershell
codex plugin marketplace add daanavcoding/forge --ref main
codex plugin add forge@forge
```

The first command registers the GitHub repository as the `forge` marketplace;
the second installs the complete plugin, including its public skills, private
specialists, scripts, and hooks. No repository checkout or `npm install` is
needed.

Codex owns the trust decision for command hooks. After installation, open
`/hooks`, review and trust Forge's `UserPromptSubmit` and `SessionEnd` hooks,
then restart Codex and begin a new task. Both hooks should appear enabled,
trusted, and automatic.

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

Run these commands in a terminal:

```powershell
claude plugin marketplace add daanavcoding/forge
claude plugin install forge@forge --scope user
```

Claude Code downloads the Git marketplace and installs the complete plugin into
its own cache. No repository checkout or `npm install` is needed. If Claude
Code is already open and reports that activation is pending, run:

```text
/reload-plugins
```

The same installation can be started inside an interactive Claude Code
session:

```text
/plugin marketplace add daanavcoding/forge
/plugin install forge@forge
```

Claude Code enables the plugin and its hook without Codex's separate hook-trust
menu. Invoke `/forge:forge <task>` or `$forge <task>`. A natural-language
request to commit can discover the public `forge-commit` skill.

### Local development and managed deployments

Only contributors developing Forge or administrators generating managed policy
need a local checkout. From that checkout, these commands install and diagnose
the working copy:

```powershell
npm run plugin:setup -- codex
npm run plugin:doctor -- --client codex --json
npm run plugin:setup -- claude --scope user
npm run plugin:doctor -- --client claude --json
```

Use `--force` only when deliberately replacing an installation from another
checkout. The local setup path also removes Claude-only artifacts from the
materialized Codex cache while retaining them in the portable source package.

Organizations that require a centrally managed Codex hook source can stage a
versioned bundle and generate a `requirements.toml` policy:

```powershell
npm run plugin:setup -- codex `
  --managed-dir C:\ProgramData\Forge\codex `
  --requirements C:\ProgramData\Forge\codex\requirements.toml `
  --managed-only --force
```

The administrator deploys that generated policy through Codex's managed
configuration. `--managed-only` makes the managed bundle the sole hook source.
`plugin:doctor` reads Codex's hook API and reports each Forge hook's `enabled`
and trust state. The `FORGE_*` values are prompt-context blocks, not process
environment variables.

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

For one development session, run `claude --plugin-dir ./plugins/forge`.
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

See [`docs/current-contract.md`](docs/current-contract.md) for
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

Generated fixtures, traces, judge output, and benchmark results stay out of
commits. The repository contains only the reproducible benchmark harness and
its source fixtures.

## Repository status

This repository is ready for public review, but it does not currently declare
an open-source license. Public visibility alone does not grant reuse rights;
the owner should add the intended license before inviting redistribution or
contributions.
