# Forge v5 current contract

This note supersedes the original fixed-prefix v5 design described in
`forge-v5-plan.md`.

- Forge uses one explicit workflow: it presents a concise plan, stops for
  explicit approval in a later user turn, then implements, verifies, reviews,
  and summarizes the task in one host session. The original task request is
  never treated as plan approval.
- The package exposes `skills/forge` and `skills/forge-commit`. The complete
  specialist catalogue lives under
  `plugins/forge/worker-skills/`, outside the host-discovered skills path.
- `forge-commit` is a separate public skill discoverable from natural-language
  commit requests. It owns host-specific context refresh, narrow staging, final
  verification, and commit creation; the main Forge skill only delegates to it.
- On explicit activation the hook reads and injects one host-specific project
  context block: `AGENTS.md` for generic agents/Codex or `CLAUDE.md` for
  Claude. Forge reuses that block without rereading or delivering it again.
  During plan execution, the Forge model uses that application
  context to select relevant private specialist names from the metadata-only
  catalogue, together with the task, Graphify evidence, and focused repository
  inspection. Forge then reads and applies only the selected private
  `SKILL.md` bodies; bodies are not
  opened during discovery. The full catalogue is never registered as host
  skills.
- `FORGE_PLUGIN_CONTEXT`, `FORGE_PROJECT_CONTEXT`, `FORGE_SKILL_DISCOVERY`, and
  `FORGE_FACTS` are model prompt-context blocks, not process environment
  variables. The hook also exposes the bundled catalogue's availability,
  count, and SHA-256 in the discovery block and facts. Missing blocks indicate
  that the current plugin hook was not loaded or trusted; they do not prove
  that the private catalogue is absent.
- `internal_skills`, `loaded_skills`, and `skill_usage` are observed-session
  telemetry/selection fields reported by the Forge summary, not a public host
  skill list. Hook telemetry reports only public activation skills and the
  selected host-context file.
- The hook has no fixed byte or file-count cutoff. It keeps relevant files and
  manifests explicit and represents unrelated areas as hierarchical directory
  counts. This controls initial context by relevance and structure.
- Forge activations attempt Graphify before model exploration. An
  existing index is updated; a missing index is extracted with
  `--code-only --no-cluster`. The task query is capped at approximately 2,000
  tokens and is injected as `GRAPHIFY_EVIDENCE` with structured
  `GRAPHIFY_STATUS`. Empty results are a successful query with no evidence.
  Unavailable, failed, invalid, or timed-out Graphify falls back to native
  Codex discovery without blocking Forge.
- The first plan is complete but concise: scope, non-scope, assumptions,
  affected areas, verification, acceptance criteria, and risks belong in it.
  The plan is an execution gate: Forge performs no edit, verification, review,
  or commit until the user explicitly approves it in a later turn.
- Corrections have no fixed count. They must be evidence-driven and must not
  repeat an unchanged failed approach.
- A green run gets one review. If the first review changes the result, focused
  verification may be followed by one final second review. No third review is
  allowed.
- Native subagents are optional and only justified for genuinely independent,
  bounded work where their context and cost are worthwhile. Forge itself does
  not launch nested host sessions.
- Graphify subprocesses use `shell:false`, bounded output, and a timeout. Forge
  has no `PreToolUse` denial hook; activation persists `run.json` and the
  terminal summary is the run record used by `resume`.
- The main Forge skill writes the model-authored terminal handoff and does not
  write `## Telemetry`. A Codex `SessionEnd` hook launches a detached, local,
  fail-open worker that reads the host transcript and creates the telemetry
  section from observed model, token, cost, latency, turn, call, activation,
  and timestamp data, including host-reported credits when available. Missing
  or malformed traces leave the handoff valid without that section. The final
  chat is the normal user-facing answer followed by a link to the persisted
  file.
