---
name: enterpriseglue-hotfix
description: Use when the user says /hotfix, urgent EnterpriseGlue fix, fast-track a patch, create a fix worktree and PR quickly, or ship a critical OSS host or plugin patch.
---

# EnterpriseGlue /hotfix

Urgency does not collapse authorization boundaries. Implement and verify
locally unless shipping is explicitly requested; publication still requires
the human user's `/release` or equivalent direct publication request.

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
6. Use `/ship` for an explicitly authorized fix PR through normal required
   checks. The Hotfix Release workflow only prepares the same detailed release
   document as a normal release; its legacy auto-merge input cannot publish.
7. Use `enterpriseglue-release` only when publication is explicitly authorized.
   Its approved batch may contain the hotfix and other agreed merged PRs.
8. Preserve immutable tags and qualified payloads; publication verification
   and recovery belong to the release workflow. Never delete or recreate a tag.
