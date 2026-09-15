---
name: enterpriseglue-hotfix
description: Use when the user says /hotfix, urgent EnterpriseGlue fix, fast-track a patch, create a fix worktree and PR quickly, or ship a critical OSS host or plugin patch.
---

# EnterpriseGlue /hotfix

1. Read `../../references/repository-lifecycle.json` and run the plugin-root
   lifecycle guard for the `write` operation. Never create a hotfix for a
   retired repository.
2. Use an isolated worktree based on the intended stable branch. Do not branch
   directly in the main checkout.
3. Add a structured `.release-notes/*.json` fragment even for urgent fixes.
   Use `type: security` when applicable and document user impact, upgrade,
   compatibility, rollback, and focused evidence. Hotfix urgency is not a
   release-note exemption.
4. Validate the release baseline before implementation and before invoking the
   hotfix workflow. Validate any forced version with
   `release-notes:assert-version`; never force a version below or equal to an
   existing tag.
5. Run focused reproduction/regression tests, package compatibility, migration
   checks when applicable, and the release-note validator/preview.
6. Ship the fix PR through normal required checks. Then invoke the repository
   Hotfix Release workflow, which must generate the same detailed versioned
   document as a normal release.
7. Release Please hotfix PRs use merge commits. Do not squash release PRs.
8. Verify the final GitHub release body, images, digests, smoke tests, and
   vulnerability scan. Never delete or recreate a release tag; fix forward.
