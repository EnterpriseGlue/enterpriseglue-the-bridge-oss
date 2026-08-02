---
name: enterpriseglue-release
description: Use when the user says /release, release OSS, release EE, merge a Release Please PR, monitor Docker Images, verify published GHCR or Docker Hub images, or recover from partial release publish.
---

# EnterpriseGlue /release

1. Resolve OSS versus EE and the exact Release Please PR. Ask only when it
   cannot be inferred safely.
2. Verify the latest stable tag, `.github/.release-please-manifest.json`, and
   `CHANGELOG.md` agree. Run `pnpm run guard:release-baseline` when available.
3. Require the Release Please PR to contain `docs/releases/vX.Y.Z.md`; confirm
   its PR body matches the generated document and covers users, operators,
   upgrade, compatibility, API/configuration, migrations, packages, security,
   limitations, rollback, and evidence.
4. Confirm every relevant merged change since the previous stable tag has a
   fragment or a permitted documented exemption. Confirm the proposed semantic
   version matches `release-notes:assert-version` for the previous stable tag.
5. Require green release policy, CI, portability, security, package, and image
   gates. Treat intentionally deferred external evidence as a recorded release
   decision, not as silently passing evidence.
6. Merge Release Please PRs with a merge commit. Do not squash them. Never
   create a release by manually tagging around the manifest workflow.
7. Monitor GitHub release creation and Docker Images. Verify immutable version
   tags, `latest`, source revision, digests, smoke tests, and vulnerability
   results.
8. Verify the published GitHub release body matches
   `docs/releases/vX.Y.Z.md`. Never delete, recreate, or repoint a published
   `v*` tag; repair mistakes with a reviewed forward release.
