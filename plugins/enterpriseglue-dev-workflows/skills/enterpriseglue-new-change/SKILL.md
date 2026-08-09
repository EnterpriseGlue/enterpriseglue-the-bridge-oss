---
name: enterpriseglue-new-change
description: Use when the user says /new-change, newchange, start a new change, create an EnterpriseGlue worktree, or begin a feature, fix, chore, minor change, or security change in the EnterpriseGlue OSS or EE repos.
---

# EnterpriseGlue /new-change

1. Resolve the repository with `git rev-parse --show-toplevel` and identify OSS
   versus EE from its remote. Never assume the main checkout is the active
   worktree.
2. Create or reuse an isolated worktree and preserve that absolute path for all
   later commands in the task. Do not overwrite local environment files.
3. Inspect repository instructions, branch state, and relevant documentation
   before editing.
4. For a release-impacting OSS change, create a stable kebab-case
   `.release-notes/<change-id>.json` fragment at the start of implementation.
   Follow `.release-notes/schema.json` and
   `docs/development/release-notes-process.md`. Update the fragment as scope,
   compatibility, migrations, packages, validation, and rollback evolve.
5. Use `release-note:none` only for genuinely internal work. Record
   `Release-note exemption: <reason>` in the PR body; never exempt
   authentication, authorization, migration, or public API/schema changes.
6. Keep the expected PR title, `release:*` classification, and package version
   impact consistent with the fragment. Breaking work uses `!` in the
   conventional title and `release:breaking`.
7. Implement and verify in proportion to risk. Hand off shipping to the
   `enterpriseglue-ship` skill rather than merging from this workflow.
