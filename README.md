# Forge

**Deterministic automation for AI coding agents.**

Forge turns a coding request into a controlled workflow with an explicit plan,
approval, implementation, verification, review, and a persistent handoff. It
runs inside the current agent session—no second coding agent, model judge, MCP
server, or hidden network service.

```text
Your task
    ↓
Hook loads project context + Graphify evidence
    ↓
Plan → Your approval
    ↓
Context + skill catalogue → discover relevant skills
    ↓
Code → Tests → Review → Handoff
    ↓
forge-commit → refresh context and docs → verified commit
    ↺
Next run uses that context
```

## Why use it?

AI agents can write code quickly, but speed is not the same as control. Forge
makes the agent show its plan before editing, stay inside the approved scope,
run the repository checks, review the result once, and leave a resumable
summary.

That workflow adds a small amount of context. On short tasks it may use a few
more tokens; in return, you get a better-controlled result with fewer skipped
steps. On larger repositories, focused discovery can avoid enough exploration
to reduce total token use—the original benchmark below measured both outcomes.

Use Forge for changes where you care about:

- knowing what will change before it changes;
- keeping the implementation focused and minimal;
- proving the result with the project's own checks;
- reviewing the final diff instead of stopping at “tests pass”;
- resuming or auditing the work later.

## Use Forge in 30 seconds

Ask Forge to perform a concrete repository task:

```text
$forge Add request validation to the users endpoint and test it
```

Forge replies with a concise plan and stops. Approve it in your next message:

```text
yes
```

Forge then implements only that plan, verifies the result, performs one final
review, and links the run summary. To commit completed work, ask naturally or
invoke `forge-commit`.

## Install

Forge is downloaded directly from GitHub. You do **not** need to clone this
repository or run `npm install`. Node.js 20 or newer is required by its local
hooks.

### Codex

```powershell
codex plugin marketplace add daanavcoding/forge --ref main
codex plugin add forge@forge
```

Open `/hooks`, trust and enable Forge's `UserPromptSubmit` and `SessionEnd`
hooks, then restart Codex and start a new task. Invoke it with `$forge <task>`,
`/forge <task>`, or the Forge skill picker.

### Claude Code

```powershell
claude plugin marketplace add daanavcoding/forge
claude plugin install forge@forge --scope user
```

If Claude Code was already open, run `/reload-plugins`. Invoke Forge with
`/forge:forge <task>` or `$forge <task>`. Claude Code enables the bundled hook
without Codex's separate trust step.

## What happens under the hood?

| Part | Purpose |
| --- | --- |
| **Forge skill** | Enforces plan → approval → implementation → verification → review. |
| **Project context** | Supplies `AGENTS.md` in Codex or `CLAUDE.md` in Claude Code. |
| **Private skills** | Are discovered from the task, project context, Graphify evidence, and skill catalogue. |
| **Graphify** | Finds likely entry points and relationships before broad file exploration. |
| **Ponytail style** | Pushes specialists toward reuse, native features, and the smallest correct change. |
| **Hooks** | Activate project context and run state locally, deterministically, and fail-open. |
| **Run summary** | Records the outcome under `.forge/runs/` for audit or resume. |

### Skills

The host exposes only two public workflows:

- `forge` runs the complete coding workflow.
- `forge-commit` correctly refreshes the applicable `AGENTS.md` or `CLAUDE.md`,
  keeps public documentation current, stages only intended files, verifies,
  and creates a focused commit.

After plan approval, Forge combines the task, the host-specific project context,
Graphify evidence, and its metadata catalogue to select only the relevant
private specialists—for example `node` and `javascript` for an ESM CLI, or
`python`, `fastapi`, and `rag` for a retrieval API. The selected skills are
applied alongside `AGENTS.md` or `CLAUDE.md`; they do not replace or duplicate
that project context. Loading a skill does not start another agent.

This completes the context loop: `forge-commit` formats and updates the correct
context file when work is committed, and the next Forge run uses that current
context to discover the right specialists for the next task.

### Graphify

[Graphify](https://github.com/Graphify-Labs/graphify) is optional and automatic.
When its local executable is available, Forge performs a bounded code-graph
query and uses the result as discovery evidence. If Graphify is unavailable,
invalid, or times out, Forge continues with the host's normal repository tools.
Generated `graphify-out/` data stays local and is never committed.

### Ponytail

Forge does not require a separate
[Ponytail](https://github.com/DietrichGebert/ponytail) installation or prompt.
Its private specialist `SKILL.md` files already carry that character: understand
the real path, reuse existing code, prefer standard-library or native features,
avoid speculative abstractions, and make the smallest correct change.

## Original benchmark, briefly

The completed benchmark from **2026-08-10** compared Forge with an unstructured
agent on the same small, medium, and large Node.js tasks. Each arm used
`gpt-5.6-luna` at max effort; a separate `gpt-5.6-terra` judge evaluated the
diffs blind. Results below cover 30 accepted executions: 5 paired runs per
scenario.

| Result | Forge | Agent alone |
| --- | ---: | ---: |
| Completed and repository-verified | 15/15 | 15/15 |
| Blind quality wins | 3 | 3 |
| Blind ties | 9 shared | 9 shared |
| Controlled phase order | 15/15 | Not enforced |
| Mean weighted token units per task | 92.2k | 99.6k |

Token cost varied by task size:

| Scenario | Forge vs. agent alone |
| --- | ---: |
| Small | +2.9% weighted units |
| Medium | +16.3% weighted units |
| Large | **−23.7% weighted units** |
| Overall mean | **−7.5% weighted units** |

This is a small engineering benchmark, not a universal quality claim. It shows
the intended trade-off: Forge consistently enforced the controlled workflow,
usually cost a little extra on smaller tasks, and saved tokens on the larger
fixture. The blind judge found equal wins and mostly ties. The reproducible
harness and source fixtures live in [`bench/`](bench/); generated runs, traces,
and judge outputs remain private and ignored by Git.

## Supported package

The canonical package is [`plugins/forge/`](plugins/forge/) and follows the
[Agent Plugins 1.0.0 specification](https://agent-plugins.org/). Codex and
Claude Code receive native metadata and automatic hooks. OpenCode, Cursor, and
Antigravity can use the same public skills through the local setup helper.

Contributors and managed deployments can find setup details in
[`docs/forge-agent-plugin.md`](docs/forge-agent-plugin.md). The complete runtime
rules are documented in [`docs/current-contract.md`](docs/current-contract.md).

## Verify a checkout

```sh
npm run check
npm run plugin:check
npm test
claude plugin validate .
claude plugin validate ./plugins/forge
```

`npm test` uses the dry benchmark harness and consumes no model quota. Live
benchmarking requires explicit subscription-usage confirmation.

Forge is distributed under the [`LICENSE`](LICENSE) included in this
repository.
