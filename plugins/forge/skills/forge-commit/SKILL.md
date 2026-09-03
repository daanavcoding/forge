---
name: forge-commit
description: Create a verified branch, commit, push, and pull request while keeping repository context and public documentation current. Use when the user asks to commit, push, save, or record completed repository changes, or asks to update applicable project instructions before committing.
---

# Forge Commit

Create a commit only when the user requests one. Run this skill after the
implementation has green focused verification; never commit merely because
the work is locally plausible. Default to a feature branch and pull request,
not a direct commit to the repository's default branch.

By default, whenever this skill creates or edits a `README*.md` or an applicable
project-instructions file, every prose section it authors or rewrites in that
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

2. Choose the branch and obtain confirmation before mutating Git state.

   - Resolve the remote and its default branch. A generic request such as
     "commit and push" does not authorize committing directly to that branch;
     do so only when the user explicitly names or requires the default branch.
   - Reuse the current non-default branch only when it clearly belongs to this
     task. Otherwise propose a short repository-compliant name, using
     `forge/<task-slug>` when no stronger convention exists.
   - Before proposing it, check the exact branch name both locally and remotely
     (`git show-ref --verify refs/heads/<branch>` and `git ls-remote --heads
     <remote> refs/heads/<branch>`). Reuse an existing task branch only when it
     is clearly safe; otherwise choose a non-conflicting name. Never overwrite
     or force-update an existing branch.
   - Tell the user, in their language, the exact action: "I will create [or
     reuse] `<branch>`, commit the scoped changes, push it to `<remote>`, and
     open a pull request into `<base>`." Then stop. The original commit request
     is not this confirmation; wait for explicit approval in a later turn.
   - Only after that approval may you create or switch branch, stage, commit,
     push, and open the pull request. If the user explicitly requires a direct
     default-branch push, follow it and state that no pull request can represent
     a change already committed to its base.

3. Refresh the one applicable project-context file before staging.

   - Use only the project instructions that the repository or active Agent
     Plugins host has already declared applicable to the changed scope.
   - Do not select, create, or prefer an instructions file based on a named
     coding-agent provider. If no applicable context file is declared, leave
     project context unchanged and report that decision.
   - In a hierarchy, update the nearest file that owns the changed area. If
     the applicable file does not exist, create it at the appropriate project
     root. Never create or update multiple competing context files for one task.
   - If the hook supplied `FORGE_PROJECT_CONTEXT`, reuse that delivered block
     as the context read. Do not deliver, quote, or manually reopen its source
     file.
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
   - By default, write every authored or rewritten prose section in the
     applicable project-instructions file in English only. If the user
     explicitly requests another language, use that language consistently for
     the requested change. Do not add an unrequested language. When translating
     an existing section, preserve commands, paths, identifiers, and semantics
     exactly.

4. Check the canonical `README.md` before staging, every time.

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

5. Verify the final content and stage narrowly.

   - Review the context-file diff, the README decision and diff, and the full
     intended staged diff. Use `git diff --check` and the repository's focused
     project check after all required documentation edits are complete.
   - Do not stage a context or README change that is unrelated to this task.
     If a required documentation edit cannot be separated from unrelated user
     changes, stop and report it.
   - Do not proceed while verification is failing or while the staged diff
     contains unrelated changes.

6. Create the commit, push, and open the pull request.

   - Use a brief, descriptive English subject in the imperative mood.
   - Do not amend, force-push, or alter unrelated commits unless the user
     explicitly asks.
   - Push the confirmed feature branch with upstream tracking and verify the
     remote ref. Never merge the pull request unless the user explicitly asks.
   - Find an existing pull request for the branch first; otherwise create one
     with the available repository-hosting CLI or API, targeting the confirmed
     base.
     Return the actual pull-request URL. If creation is unavailable, report the
     blocker and provide the hosting service's "create pull request" link,
     clearly labeled as a creation link rather than an existing pull request.
   - Report the branch, commit hash, pull-request URL, files or context document
     created or updated, whether `README.md` was updated or left unchanged, and
     the verification command that passed.
