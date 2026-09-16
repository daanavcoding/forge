# Forge current contract

This document defines the current public workflow contract.

- Forge uses one explicit workflow: it presents a concise plan, stops for
  explicit approval in a later user turn, then implements, verifies, reviews,
  and summarizes the task in one host session. The original task request is
  never treated as plan approval.
- The package exposes `skills/forge` and `skills/forge-commit`. The complete
  specialist catalogue lives under
  `plugins/forge/worker-skills/`, outside the host-discovered skills path.
- `forge-commit` is a separate public skill discoverable from natural-language
  commit requests. It owns branch selection and confirmation, declared project
  context refresh, narrow staging, final verification, commit, push, and pull
  request creation; the main Forge skill only delegates to it. It does not
  select project instructions from a coding-agent provider. Direct commits to
  the default branch require an explicit user instruction.
- On explicit activation the hook reads and injects one host-specific project
  context block: `AGENTS.md` for generic agents/Codex or `CLAUDE.md` for
  Claude. Forge reuses that block without rereading or delivering it again.
  During plan execution, the Forge model uses that application
  context to select relevant private specialist names from the metadata-only
  catalogue, together with the task, Graphify evidence, and focused repository
  inspection. Forge then reads and applies only the selected private
  `SKILL.md` bodies as active task instructions; bodies are not opened during
  discovery. Explicit user requirements override only directly conflicting
  specialist guidance, while the remaining guidance still applies. The full
  catalogue is never registered as host skills.
- `FORGE_PLUGIN_CONTEXT`, `FORGE_PROJECT_CONTEXT`, `FORGE_SKILL_DISCOVERY`, and
  `FORGE_FACTS` are model prompt-context blocks, not process environment
  variables. The hook also exposes the bundled catalogue's availability,
  count, and SHA-256 in the discovery block and facts. Missing blocks indicate
  that the current plugin hook was not loaded or trusted; they do not prove
  that the private catalogue is absent.
- Summary telemetry distinguishes public workflow skills observed through host
  activation, attachments, or explicit skill-file reads,
  private specialist `SKILL.md` files observed in tool calls, and the evidence
  for each name. It does not claim that a loaded skill was followed or invent
  usage counts. Unknown skill data remains `unavailable`.
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
- Every Forge activation ensures that the repository `.gitignore` contains
  `.forge/` and `graphify-out/`, adding only missing rules and preserving the
  existing file. The result is reported as `forge_ignore` in `FORGE_FACTS`;
  failures remain fail-open and do not block the host.
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
- The main Forge skill writes the model-authored terminal handoff and then runs
  the deterministic finalizer. It immediately creates `## Telemetry` from the
  available host transcript. The finalizer prefers the transcript path persisted
  by the active host adapter. For legacy Codex runs without that path, ordinary
  Codex tool commands expose the current session/thread identifier, which the
  finalizer resolves to the exact host-owned rollout file without scanning
  transcript contents. Claude and generic agents are not sent through the Codex
  resolver. It falls back to honest run-state facts only when that exact
  transcript is unavailable. Codex and Claude `Stop` hooks launch a detached,
  local, fail-open worker that replaces that section when the turn ends;
  `SessionEnd` refreshes it again when the main thread actually closes.
  The summary exposes only decision-useful telemetry: provider/model/effort,
  token categories, API-equivalent cost with pricing provenance, elapsed time,
  host rate-limit windows and credit balance, observed public/private skills,
  and the telemetry source. Host-reported credits used are included only when
  available. The final chat remains a normal user-facing answer followed by a
  summary link.
- API-equivalent costs use the bundled, generated Models.dev snapshot. Runtime
  hooks and finalizers never access the network. Lookup resolves an observed
  provider first, then an explicit `provider/model` namespace, then the
  official provider default for first-party agents such as Codex → OpenAI and
  Claude Code → Anthropic. Ambiguous agents do not guess a provider. The
  summary records the selected route and, where known, the official provider
  rate-card reference. A scheduled GitHub workflow validates and merges
  pricing-only changes without changing a plugin version; anomalous changes
  stop for manual review.
