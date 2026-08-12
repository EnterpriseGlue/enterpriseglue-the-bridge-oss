---
name: enterpriseglue-ship
description: Use when the user says /ship, ship this branch, create a PR, push the current EnterpriseGlue worktree, enable auto-merge, or finish and merge an EnterpriseGlue change.
---

# EnterpriseGlue /ship

1. Verify the active repository root, worktree, branch, remote, and dirty state.
   Stop before shipping from a different worktree than the one active for the
   task.
2. Fetch the base branch and inspect the complete diff. Preserve unrelated user
   changes.
3. Review compatibility across public APIs, OpenAPI, configuration, database
   migrations, published packages, UI behavior, authentication, authorization,
   and rollback.
4. In OSS repositories with `scripts/release-notes.mjs`, require a changed
   schema-v1 JSON fragment at `.release-notes/<kebab-case-id>.json` for every
   release-impacting change. The fragment must follow `.release-notes/schema.json`
   and include the actual audiences, compatibility, upgrade, configuration,
   API, database/rollback, security, documentation, limitations, validation,
   and published-package version impacts. Do not create legacy Markdown
   fragments or directly edit generated release previews. Run:

   ```bash
   pnpm run release-notes:validate
   pnpm run release-notes:preflight -- --base-ref origin/main
   ```

   Read `.artifacts/release-notes-preview.md` produced by the preflight. Do not
   ship placeholder, unsupported, contradictory, implementation-only, or
   unverified claims. Use `release-note:none` only where the repository permits
   a low-risk exemption and the PR body contains the required explanation.
5. Confirm every changed fragment matches the conventional PR title,
   `release:*` label, package version bumps, migration/rollback behavior, and
   actual test evidence. Breaking fragments require `!` and
   `release:breaking`.
6. Run the repository's appropriate verification level, commit coherent
   changes, and push only the active branch. Create or update the PR without
   rewriting unrelated metadata.
7. Keep a requested draft PR draft. Never enable auto-merge or merge unless the
   user explicitly authorizes it.
8. For a Release Please PR, require `docs/releases/vX.Y.Z.md`, require its body
   to match that document, and use a merge commit—not squash. Do not delete or
   recreate published tags.
9. Do not remove worktrees or branches without satisfying cleanup conditions
   and any required user confirmation.
