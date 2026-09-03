---
name: enterpriseglue-new-change
description: Use when the user says /new-change, newchange, start a new change, create an EnterpriseGlue worktree, or begin a feature, fix, chore, minor change, or security change in the EnterpriseGlue OSS host or an owning plugin repository.
---

# EnterpriseGlue /new-change

1. Resolve the repository with `git rev-parse --show-toplevel` and identify the
   OSS host versus an owning plugin repository from its remote. Never assume
   the main checkout is the active worktree.
2. Route shared host, runtime, SDK, installer, manager, deployment, and
   reference-plugin work to OSS, the sole product host. Route proprietary
   product behavior to its owning plugin repository against public OSS
   contracts. Do not create standalone EE changes.
3. Create or reuse an isolated worktree and preserve that absolute path for all
   later commands in the task. Do not overwrite local environment files.
4. Inspect repository instructions, branch state, and relevant documentation
   before editing.
5. Before creating documentation, classify its audience and publication
   boundary. Keep internal product and customer-documentation drafts outside
   every Git worktree; include only repository-appropriate technical material
   in the change. Split mixed documents instead of publishing private product
   context with a technical specification.
6. For a release-impacting OSS change, create a stable kebab-case
   `.release-notes/<change-id>.json` fragment at the start of implementation.
   Follow `.release-notes/schema.json` and
   `docs/development/release-notes-process.md`. Update the fragment as scope,
   compatibility, migrations, packages, validation, and rollback evolve.
7. Use `release-note:none` only for genuinely internal work. Record
   `Release-note exemption: <reason>` in the PR body; never exempt
   authentication, authorization, migration, or public API/schema changes.
8. Keep the expected PR title, `release:*` classification, and package version
   impact consistent with the fragment. Breaking work uses `!` in the
   conventional title and `release:breaking`.
9. Implement and verify in proportion to risk. Hand off shipping to the
   `enterpriseglue-ship` skill rather than merging from this workflow.
