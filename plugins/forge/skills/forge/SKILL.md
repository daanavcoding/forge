---
name: forge
description: Run one cost-bounded coding workflow with a concise plan, local verification, one final review, and an LLM-authored run summary linked from the normal final answer.
---

# Forge

Run the task in this conversation. Never launch another host session, model
judge, or nested Forge run. Never read or expose `.env` or `appsettings.json`.

## Workflow

1. Inspect only enough repository context to make the plan concrete. Send one
   normal message headed `Forge plan` with the outcome, scope, numbered tasks,
   verification, acceptance, risks, and exclusions, then stop and ask for
   explicit approval in a later user turn. The original task request is never
   plan approval. Treat only a clear confirmation such as `approved`, `yes,
   execute`, or `adelante` as approval; if the user changes the plan, revise it
   and ask again. Do not edit, verify, review, commit, or otherwise execute the
   task before that explicit confirmation.

2. Do not discover or load private specialist skills while preparing or
   validating the plan. After approval, before any source edit, complete this
   mandatory execution gate:

   - Generic agents and Codex use only the applicable `AGENTS.md`; Claude Code
     uses only the applicable `CLAUDE.md`.
   - If `FORGE_PROJECT_CONTEXT` is present, consume that delivered block as
     the required context read. Reuse it exactly: do not deliver, quote, or open the context file again, and never read the other client's file.
   - Without the hook, read only the host-appropriate file. If it is missing,
     inspect the repository as needed and create it at the requested commit.
   - Do not edit source until this host-specific context gate is complete.

   Use the context contents, task, Graphify evidence, and focused repository
   inspection to select every clearly necessary private specialist by name
   from the metadata-only catalogue in `FORGE_SKILL_DISCOVERY`. The catalogue
   descriptions are sufficient for discovery. Do not open, read, or load any
   private `SKILL.md` body while selecting; do not enumerate or inspect private
   skill directories, expose the catalogue as host skills, or select unrelated
   entries. Select the base language plus relevant framework/domain skills.

   Treat hook delivery and catalogue delivery as separate facts. The
   `FORGE_PLUGIN_CONTEXT`, `FORGE_PROJECT_CONTEXT`, `FORGE_SKILL_DISCOVERY`,
   and `FORGE_FACTS` labels are blocks in the model prompt context, not process
   environment variables; do not use shell lookups such as
   `[Environment]::GetEnvironmentVariable(...)` to decide whether they were
   supplied. When an approved Forge execution has none of those blocks, recover
   the complete context locally before editing: derive `<plugin-root>` from the
   current Forge `SKILL.md` source path and run
   `node "<plugin-root>/scripts/hook.mjs" --manual-approved --cwd "<absolute-repository-path>"`.
   Consume `hookSpecificOutput.additionalContext` exactly as hook-delivered
   context, including its `FORGE_PROJECT_CONTEXT`, `FORGE_SKILL_DISCOVERY`,
   `FORGE_PLUGIN_CONTEXT`, `FORGE_FACTS`, private catalogue, and `run_state`.
   This is the full deterministic hook runtime, not a reduced workflow; it makes
   no model or network call. Do not reread the project context after recovery.

   Only if both native delivery and that bundled recovery fail, report
   `hook_context_unavailable` and stop before editing. Use the host manager's
   `doctor` output to distinguish a missing personal plugin from a missing managed bundle. For
   managed Codex deployments, repair or redeploy the managed bundle and its
   `requirements.toml` policy. For a personal plugin, verify that `forge@forge`
   is installed and enabled, review and trust its current hook,
   restart Codex, and start a new task. Never bypass hook trust or silently
   continue with a reduced workflow. Do not describe
   that state as “no private catalogue”. If the blocks exist but
   `PRIVATE_SKILL_CATALOG_AVAILABLE`, its count, or its hash is missing or
   inconsistent, report `catalog_delivery_incomplete`. On a deliberately
   skill-only host without lifecycle hooks, continue with repository
   conventions and state that hook-only context is unavailable.

   After the names are selected, read and apply only those selected private `SKILL.md`
   bodies from the supplied `PRIVATE_SKILL_ROOT`, exactly once before editing.
   Do not read unselected bodies or reread a selected body. Mention selected
   specialists in the normal handoff when useful; do not invent or write host
   measurements in the summary.

3. Make the smallest source changes that satisfy the plan. Keep discovery
   bounded, do not repeat an unchanged command, and do not run a pre-change
   test unless this is a diagnosis or regression reproduction.

4. Run the focused project verification. Fix only evidence-backed failures and
   rerun the focused check. After it is green, perform one final review headed
   `## Review`; if it finds a real defect, fix and verify once, without a review
   loop. Do not claim completion without green verification.

5. If a commit is requested, use the public `forge-commit` skill. It owns the
   host-specific context refresh, safe staging, final verification, and commit.

## Summary artifact and final response

At terminal exit, produce two distinct outputs: an LLM-authored handoff file
and a normal user-facing answer. The handoff is not the chat response.

- If `run_state.summary` exists, use the host's normal file-writing tool (for
  example, `apply_patch`) to write exactly one concise summary directly to that
  path, then verify that the file exists. Use the exact path supplied by
  `run_state`; do not invent another persistence path. The runtime prepares the
  run directory, while the model remains responsible only for the handoff text.
- On Codex `SessionEnd`, a detached local worker makes one best-effort pass over
  the host transcript and writes or replaces only the `## Telemetry` section with observed
  token counts, latency, and host-reported credits when they exist. This pass
  never waits on a model or network, and any missing, unreadable, or malformed
  trace leaves the model-authored summary intact.
  Runs created by manual context recovery are joined to the transcript by their
  exact random `run_id` when host-only session identifiers were unavailable.
- A completed summary starts with `# Forge summary`, `status: completed`, and
  `resume: false`, then non-empty `## Changes`, `## Verification`, `## Review`,
  `## Limitations`, and `## Verdict` sections.
- A failed summary starts with `# Forge summary`, `status: failed`, and
  `resume: true`, then `## Completed work`, `## Failure` containing
  `failed_command:` and `error:`, and `## Next resume step` containing
  `next_step:`.
- Do not add a `## Telemetry` section. The host owns that section because it
  receives the final transcript after the model turn and can observe token
  counts, latency, and credits that are not visible to the LLM. If the host
  cannot read a trace, the summary remains valid without that section.
- On resume, use the injected failed summary to continue unfinished work and
  replace it only after resumed verification completes.

After the file is written and verified, answer the user normally with your own
conclusions: outcome, changes, verification, review result, limitations, and
verdict. Do not paste the `# Forge summary` document into the chat and do not
make it the only assistant output. End the answer with one markdown link to the
exact persisted file, for example:

`Summary: [open the Forge run summary](.forge/runs/<run_id>/summary.md)`

If writing or verification fails, keep the normal answer, state the short
failure, and do not dump the full summary into the chat. If no `run_state`
exists, omit the link and say that no repository summary path was available.

Forge activation and telemetry finalization are fail-open: missing Graphify
evidence, optional run metadata, or an unavailable host transcript must never
block the host session.
