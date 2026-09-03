---
name: forge-commit
description: Create a verified commit and push scoped repository changes while keeping applicable project context and public documentation current; open a pull request only when the user explicitly requests one.
---

# Forge Commit

Use only when the user asks to commit, push, save, or record completed changes.
Run it after focused verification passes. Preserve unrelated work; never amend,
force-push, merge, or alter unrelated commits unless explicitly asked.

By default, authored or rewritten prose in `README*.md` and applicable project
instructions is English only. Follow an explicit language request and preserve
code, commands, identifiers, quoted user text, untouched text, and localized
README variants.

## Before Git changes

1. Inspect `git status --short`, the working-tree diff, and the staged diff.
   Identify the exact files or hunks for this task. If the scope cannot be
   separated safely, stop and report the boundary. Stage only that scope; never
   use blanket staging such as `git add .`.

2. Resolve the remote and default branch. Commit to the default branch only
   when the user explicitly requires it. Reuse the current non-default branch
   only when it clearly belongs to this task; otherwise propose a unique,
   short, descriptive GitHub-style topic branch, such as
   `fix-summary-finalization`:

   - Use `<type>/<short-description>`, choosing `feat`, `fix`, `chore`, `docs`,
     `refactor`, `test`, `ci`, `build`, `perf`, `style`, or `revert` according
     to the change.
   - Keep the description lowercase and hyphen-separated; for example,
     `feat/add-export` or `chore/update-dependencies`.
   - Use only simple branch characters (letters, numbers, `-`, `_`, `.`, `/`).
   - Do not add a `forge/` prefix or a generic `task` wrapper.

   Check the exact name locally and remotely before proposing it:

   ```text
   git show-ref --verify refs/heads/<branch>
   git ls-remote --heads <remote> refs/heads/<branch>
   ```

   Never overwrite or force-update an existing branch.

3. Tell the user the exact action and stop for explicit approval: create or
   reuse `<branch>`, commit the scoped changes, and push it to `<remote>`.
   Mention opening a pull request into `<base>` only when the user requested a
   pull request. The original commit request is not this approval. After it,
   create or switch the branch, stage, commit, push, and optionally open the
   requested pull request.

## Context and public documentation

- Use only the one project-instructions file that the repository or active
  Agent Plugins host has declared applicable. Update the nearest file owning the
  changed area, create it only when needed, and never create competing files.
  If `FORGE_PROJECT_CONTEXT` was supplied, reuse it without reopening its
  source. Do not choose a file from a named coding-agent provider. Never read
  or copy secrets from `.env` or `appsettings.json`.
- Keep project context as the smallest durable, evidence-based guidance needed
  for future work: preserve valid instructions, correct stale claims,
  consolidate duplicates, and cover only relevant purpose/boundaries,
  architecture, conventions, security/operations, checks, generated areas, or
  limitations. Do not add skill names, README content, history, or transient
  test output.
- Inspect the root `README.md` before staging every time. If it is absent, record
  that and do not invent it unless requested. If the task changes user-facing
  behavior or documentation, update only stale lines while preserving unrelated
  edits; otherwise leave it unchanged. Keep it user-facing, not agent guidance.

## Verify and finish

Review context and README changes plus the complete intended staged diff. Run
`git diff --check` and the focused project check; stop if verification fails or
the staged diff contains unrelated changes.

Create a brief, descriptive English imperative commit subject. Push the
confirmed branch with upstream tracking and verify its remote ref. If the user
explicitly requested a pull request, find an existing one for the branch first;
if none exists, create it with the available hosting CLI/API and return its
actual URL. If no pull request was requested, do not look for or create one. If
creation is unavailable, report the blocker and provide the hosting service's
clearly labeled creation link. Never merge unless explicitly asked.

Report the branch, commit hash, pull request if one was requested/created,
context or README changes, and the verification command that passed.
