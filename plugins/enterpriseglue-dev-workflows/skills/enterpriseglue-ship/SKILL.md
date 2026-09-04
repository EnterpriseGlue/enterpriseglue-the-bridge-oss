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
4. Treat OSS as the sole EnterpriseGlue product host. Ship shared host,
   runtime, SDK, installer, manager, deployment, and reference-plugin changes
   from OSS; ship proprietary product behavior from its owning plugin
   repository against public OSS contracts. Do not create EE synchronization
   or release follow-ups.
5. Inspect every changed Markdown and evidence file. Keep internal product
   material and customer-documentation drafts outside every Git worktree, and
   ensure repository technical docs do not depend on private links. When the
   repository provides it, run:

   ```bash
   pnpm run guard:documentation-boundary -- --base-ref origin/main
   ```

   Treat a documentation-boundary violation as a shipping blocker.
6. In OSS repositories with `scripts/release-notes.mjs`, require a changed
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
7. Confirm every changed fragment matches the conventional PR title,
   `release:*` label, package version bumps, migration/rollback behavior, and
   actual test evidence. Breaking fragments require `!` and
   `release:breaking`.
8. Run the repository's appropriate verification level, commit coherent
   changes, and push only the active branch. Create or update the PR without
   rewriting unrelated metadata.
9. For CI or release-control changes, require the deterministic classifier
   fixtures, workflow contracts, and self-validating `ci-complete` aggregate.
   Confirm metadata-only changes avoid unrelated expensive lanes and selected
   jobs cannot pass by being skipped. Do not replace exact candidate evidence
   with an advisory or mocked lane.
10. Determine whether the PR is first-party by comparing its head repository
   owner with the base repository owner. For a first-party PR that is not
   explicitly requested or marked as draft, enable auto-merge by default after
   the required checks and release metadata are in place. Do not enable
   auto-merge for fork/external PRs or explicitly draft PRs unless the user
   explicitly requests it. Enabling auto-merge does not authorize bypassing
   branch protection, dismissing reviews, or merging a draft.
11. For a Release Please PR, require `docs/releases/vX.Y.Z.md` and require the
   managed `<!-- enterpriseglue-detailed-release-notes -->` issue comment to
   match that document. Preserve Release Please's machine-readable PR body and
   use a merge commit—not squash. Do not delete or recreate published tags.
12. Do not remove worktrees or branches without satisfying cleanup conditions
   and any required user confirmation.
