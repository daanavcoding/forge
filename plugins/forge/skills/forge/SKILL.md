---
name: forge
description: Run one cost-bounded coding workflow with a concise plan, local verification, one final review, and an LLM-authored run summary linked from the normal final answer.
---

# Forge

Work in this conversation only: never start another host session, model judge,
or nested Forge run. Never read or expose `.env` or `appsettings.json`.

## Language

- Unless the user requests otherwise, write code, identifiers, comments,
  documentation, and repository files in English, following the language's
  idioms and repository conventions for typing, errors, formatting, tests,
  dependencies, documentation, and security. Chat language is independent.
- Write `summary.md` in the language required by global agent instructions, or
  otherwise the user's language.

## Workflow

1. Inspect only enough repository context to send a normal message headed `Forge plan`
   containing the outcome, scope, numbered tasks, verification,
   acceptance criteria, risks, and exclusions. Then stop for explicit approval in a later user turn.
   The original task request is never plan approval; only
   a clear later confirmation counts. If the plan changes, revise it and ask
   again. Do not edit, verify, review, commit, or otherwise execute before it.

2. Do not discover or load private specialist skills during planning. After
   approval and before source edits, complete this mandatory execution gate:

   - Treat the hook-delivered Forge blocks as prompt context, not environment
     variables. Reuse `FORGE_PROJECT_CONTEXT` without rereading its source file.
     If no Forge context was delivered, derive `<plugin-root>` from this file and
     run `node "<plugin-root>/scripts/hook.mjs" --manual-approved --cwd "<repository>"`,
     then use `hookSpecificOutput.additionalContext`. Stop if recovery fails on
     a hook-capable host; on a deliberately skill-only host, continue with normal
     repository conventions and disclose that hook-only context is unavailable.
   - Select the necessary private specialists from `FORGE_SKILL_DISCOVERY` using
     the task, project context, Graphify evidence, and focused inspection. Do not
     open skill bodies while selecting. Then read and apply only the selected
     bodies once from `PRIVATE_SKILL_ROOT`, before editing, and mention the
     selected specialists in the handoff when useful.

3. Make the smallest planned source change. Keep discovery bounded, never
   repeat an unchanged command, and run no pre-change test except to diagnose
   or reproduce a regression.

4. Run focused project verification and fix only evidence-backed failures.
   Once green, perform one final review headed `## Review`; if it finds a real
   defect, fix it and verify once without a review loop. Never claim completion
   without green verification.

5. If a commit was requested, use the public `forge-commit` skill, which owns
   context refresh, narrow staging, final verification, and the commit.

## Handoff

At terminal exit produce two distinct outputs: an LLM-authored handoff file
and a normal user-facing answer. The handoff is not the chat response.

- If `run_state.summary` exists, use the normal file-writing tool to write exactly
  one concise summary directly to that exact path, then verify it exists. Do
  not invent a path; the runtime owns the run directory.
- A completed file starts with `# Forge summary`, `status: completed`, and
  `resume: false`, followed by non-empty `## Changes`, `## Verification`,
  `## Review`, `## Limitations`, and `## Verdict` sections.
- A failed file starts with `# Forge summary`, `status: failed`, and
  `resume: true`, followed by `## Completed work`, `## Failure` with
  `failed_command:` and `error:`, and `## Next resume step` with `next_step:`.
- Do not add `## Telemetry`: the host owns that section. On Codex `SessionEnd`,
  a detached local worker may replace only it using observed transcript data.
  It never waits on a model or network; missing or malformed traces leave the
  handoff valid. Manually recovered runs join the transcript by exact random
  `run_id` when no host session identifier exists.
- On resume, continue from the injected failed summary and replace it only
  after resumed verification succeeds.

After verifying the file, answer the user normally with your own conclusions:
outcome, changes, verification, review, limitations, and verdict.
Do not paste the `# Forge summary` document or use it as the only chat response. End with:

`Summary: [open the Forge run summary](.forge/runs/<run_id>/summary.md)`

If persistence fails, keep the normal answer, report the failure briefly, and
do not paste the summary. If no `run_state` exists, omit the link and say no
repository summary path was available. Forge activation and telemetry remain
fail-open: missing Graphify evidence, optional run metadata, or host transcript
must not block the session.
