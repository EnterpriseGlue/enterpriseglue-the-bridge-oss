---
name: enterpriseglue-release
description: Use when the user says /release, release the EnterpriseGlue OSS host or an owning plugin repository, merge a Release Please PR, monitor images, verify registries, or recover from partial release publication.
---

# EnterpriseGlue /release

1. Resolve the OSS host versus an owning plugin repository and the exact
   release PR. The standalone EE repository is not a release target. Ask only
   when the intended current repository cannot be inferred safely.
2. Verify the latest stable tag, `.github/.release-please-manifest.json`, and
   `CHANGELOG.md` agree. Run `pnpm run guard:release-baseline` when available.
3. Require the Release Please PR to contain `docs/releases/vX.Y.Z.md`; confirm
   its PR body matches the generated document and covers users, operators,
   upgrade, compatibility, API/configuration, migrations, packages, security,
   limitations, rollback, and evidence.
4. Confirm every relevant merged change since the previous stable tag has a
   fragment or a permitted documented exemption. Confirm the proposed semantic
   version matches `release-notes:assert-version` for the previous stable tag.
5. Require `Release candidate readiness` and the self-validating `ci-complete`
   aggregate on the exact candidate SHA. Download the readiness receipt and
   verify its source revision, comparison tag, package and chart plans,
   production image scan, toolchain rehearsal, and
   `publicationPerformed: false` result.
6. Inspect every workflow for the candidate SHA, not only branch protection's
   required contexts. Failure, cancellation, timeout, action-required, pending,
   or an unexpectedly skipped readiness job blocks release. Treat intentionally
   deferred external evidence as a recorded release decision, not as silently
   passing evidence.
7. Merge Release Please PRs with a merge commit. Do not squash them. Never
   create a release by manually tagging around the manifest workflow.
8. Monitor GitHub release creation, Docker Images, protected package
   publication, and the downstream signed plugin toolchain. Verify immutable
   version tags, `latest`, source revision, digests, smoke tests, vulnerability
   results, registry visibility, signatures, and release receipts.
   Do not dispatch or require an EE package synchronization.
9. Verify the published GitHub release body matches
   `docs/releases/vX.Y.Z.md`. Never delete, recreate, or repoint a published
   `v*` tag; repair mistakes with a reviewed forward release.
