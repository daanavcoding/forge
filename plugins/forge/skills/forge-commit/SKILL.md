---
name: forge-commit
description: Create a verified git commit while keeping host-specific project context and public documentation current. Use when the user asks to commit, save, or record completed repository changes, or asks to update AGENTS.md or CLAUDE.md before committing.
---

# Forge Commit

Create a commit only when the user requests one. Run this skill after the
implementation has green focused verification; never commit merely because
the work is locally plausible.

By default, whenever this skill creates or edits `AGENTS.md`, `CLAUDE.md`, or
the canonical `README.md`, every prose section it authors or rewrites in that
file must be in English only. If the user explicitly requests another language
for that file or change, follow that request. Do not add unrequested Spanish or
bilingual prose. Preserve code, commands, identifiers, quoted user text,
untouched existing text, and intentionally localized variants such as
`README.es.md`.

## Workflow

1. Establish the exact scope before changing or staging anything.

   - Inspect `git status --short`, the relevant working-tree diff, and the
     staged diff. Treat pre-existing staged, unstaged, and untracked changes as
     user-owned.
   - Identify the files and hunks belonging to the requested task. Stage only
     those files or hunks; never use blanket staging such as `git add .`.
   - If the requested scope cannot be separated safely, stop and report the
     boundary instead of staging or committing unrelated work.

2. Refresh the one applicable project-context file before staging.

   - Generic agents and Codex use only the nearest applicable `AGENTS.md`.
   - Claude Code uses only the nearest applicable `CLAUDE.md`.
   - In a hierarchy, update the nearest file that owns the changed area. If
     the applicable file does not exist, create it at the appropriate project
     root. Never create or update both files for one host task.
   - If the hook supplied `FORGE_PROJECT_CONTEXT`, reuse that delivered block
     as the context read. Do not deliver, quote, or manually reopen the file,
     and never read the other client's file.
   - Never read or copy secrets or values from `.env` or `appsettings.json`.

   Write project context as durable guidance for a future agent, not as a
   changelog or a dump of the current diff. Derive it from repository evidence,
   the completed diff, and existing guidance:

   - Preserve valid project-specific instructions and correct stale claims;
     consolidate duplicates instead of appending boilerplate.
   - Describe the project's purpose and boundaries, stack and entrypoints,
     architecture and data flow, conventions and invariants, security or
     operational boundaries, relevant verification commands, generated or
     excluded areas, and material limitations or decisions.
   - Use short headings and actionable bullets. Include only sections supported
     by evidence; do not create empty headings or speculative architecture,
     commands, dependencies, deployment behavior, or future plans.
   - Keep the file focused on the application. Do not list specialist skill
     names, reproduce the README, paste commit history, or include transient
     test output.
   - Update only the sections made stale or unclear by the completed work. If
     the file is already accurate and the diff changes no application facts,
     leave it unchanged. If it is missing, materially stale, or unclear, write
     the smallest accurate improvement needed.
   - By default, write every authored or rewritten prose section in `AGENTS.md`
     or `CLAUDE.md` in English only. If the user explicitly requests another
     language, use that language consistently for the requested change. Do not
     add an unrequested language. When translating an existing section,
     preserve commands, paths, identifiers, and semantics exactly.

3. Check the canonical `README.md` before staging, every time.

   - Inspect the repository's root `README.md`, its working-tree diff, and its
     staged diff when present. If no canonical `README.md` exists, record that
     fact and do not invent one unless the user requested it.
   - Decide whether the completed task changes user-facing behavior or
     documentation: purpose, installation, usage, public interfaces, commands,
     configuration, supported clients, file layout, requirements,
     compatibility, or verification instructions.
   - If the README is stale for any of those changes, update it before staging.
     If it is already modified, preserve unrelated user edits and change only
     the lines needed for this task. If the task is internal and the README is
     still accurate, leave it unchanged.
   - Keep the README user-facing; do not move internal agent guidance into it.
     By default, write every authored or rewritten prose section in the
     canonical `README.md` in English only. If the user explicitly requests
     another language, use it consistently for the requested change. Do not add
     an unrequested language, while preserving intentionally localized README
     variants.

4. Verify the final content and stage narrowly.

   - Review the context-file diff, the README decision and diff, and the full
     intended staged diff. Use `git diff --check` and the repository's focused
     project check after all required documentation edits are complete.
   - Do not stage a context or README change that is unrelated to this task.
     If a required documentation edit cannot be separated from unrelated user
     changes, stop and report it.
   - Do not proceed while verification is failing or while the staged diff
     contains unrelated changes.

5. Create and report the commit.

   - Use a brief, descriptive English subject in the imperative mood.
   - Do not amend, force-push, or alter unrelated commits unless the user
     explicitly asks.
   - Report the commit hash, files or context document created or updated,
     whether `README.md` was updated or left unchanged after review, and the
     verification command that passed.
