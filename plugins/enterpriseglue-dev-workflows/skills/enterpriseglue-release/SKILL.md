---
name: enterpriseglue-release
description: Publish an explicitly authorized EnterpriseGlue release batch from multiple merged PRs, with generated documentation and exact candidate proof; also inspect or recover its publication status.
---

# EnterpriseGlue /release

Only a direct human `/release` or equivalent publication request authorizes
merging the release PR and dispatching publication. `/new-change`, `/ship`,
labels, CI success and autopilot settings do not grant that authority. Read-only
release questions do not authorize mutation. Existing approval covers its
unchanged agreed batch; ask again only if scope or exact source has materially
changed. Deployment has its own authorization.

1. Read `../../references/repository-lifecycle.json` and run the plugin-root
   lifecycle guard for the `release` operation. A retired result is a hard
   stop; historical-audit permission never authorizes a release.
2. Resolve the repository, previous stable tag and one pending Release Please
   PR. Resolve the requested batch to a non-empty list of merged code PRs; by
   default an unqualified `/release` includes every unreleased merged change
   since the previous stable tag. Show the included changes and final source.
   Every required PR must be merged and contained in that source. Additional
   material changes outside a specifically requested batch require a scope
   decision before publication. Do not create a release per code PR.
   Before merging, verify protected main already contains the explicit batch
   publication gate and dispatch inputs. An updated local plugin does not prove
   that workflow code is installed; the previous pipeline could publish as soon
   as the release PR merges. Stop if that boundary has not been shipped.
3. Verify the latest stable tag, `.github/.release-please-manifest.json`, and
   `CHANGELOG.md` agree. Run `pnpm run guard:release-baseline` when available.
4. Generate the complete release document from all changed fragments since the
   previous stable tag through `scripts/prepare-release-notes-pr.sh` in its
   supported trusted CI workflow. Keep `CHANGELOG.md` concise and ancestry-
   deduplicated; consolidate package changes from previous published versions
   to final versions. Update source fragments and rerun generation instead of
   hand-editing generated files. Require `docs/releases/vX.Y.Z.md`; find the
   managed issue comment beginning
   `<!-- enterpriseglue-detailed-release-notes -->` and confirm the content
   after that marker matches the generated document. Preserve Release Please's
   machine-readable PR body. Confirm the detailed document covers users,
   operators, upgrade, compatibility, API/configuration, migrations, packages,
   security, limitations, rollback, and evidence. Review claims against the
   final accepted candidate: distinguish new migrations from repaired
   historical migrations, remove superseded pending-verification claims, and
   keep development retries and bulk evidence in CI artifacts. Technical
   documentation must accompany the code. Customer guides target the CMS under
   documentation-governance; unavailable publishing leaves drafts explicitly
   unpublished outside Git, rather than silently satisfying the docs check.
5. Confirm every relevant merged change since the previous stable tag has a
   fragment or a permitted documented exemption. Confirm the proposed semantic
   version matches `release-notes:assert-version` for the previous stable tag.
6. Reuse applicable source-level `Release candidate readiness` evidence while
   source, dependencies, configuration and environment match. Release heads
   intentionally defer that rehearsal to authoritative exact-candidate staging.
   Require the self-validating `ci-complete` aggregate and `Release candidate
   staged` on the exact release merge-group SHA. Verify the signed candidate
   receipt binds that SHA and version to the package/chart payloads, image
   digests, security scanner/database evidence, toolchain rehearsal, all five
   database adapters and pinned Operaton browser proof. Missing supported
   database or browser acceptance blocks publication. Keep source qualification,
   candidate staging and production publication as distinct outcomes.
7. Inspect every workflow for the candidate SHA, not only branch protection's
   required contexts. Failure, cancellation, timeout, action-required, pending,
   or an unexpectedly skipped readiness job blocks release. Treat intentionally
   deferred external evidence as a recorded release decision, not as silently
   passing evidence.
8. For the authorized frozen batch, merge the Release Please PR with a merge
   commit through protected checks. Do not squash, bypass the queue or manually
   tag. Its merge does not publish: automatic Release Please runs only prepare
   PRs. Resolve the exact merged SHA and dispatch `release-please.yml` from main
   with `publish_release=true`, `source_ref=<exact merged SHA>`,
   `release_tag=vX.Y.Z`, `release_pr=<merged release PR number>`, and
   `required_prs=<JSON array of the approved code PR numbers>`. The publication
   gate checks the batch's ancestry, regenerated document, managed comment and
   signed candidate before creating the tag. Source drift stops publication;
   do not substitute a newer SHA or expand the batch without authorization.
9. Monitor GitHub release creation, Docker Images, `Publish Plugin/API
   Packages`, `Publish Host Packages`, and the downstream signed plugin
   toolchain. The two package workflows must consume the eight exact tarballs
   from the signed candidate; host publication must wait for the five
   plugin/API dependency versions and verify canonical registry payloads.
   Never substitute a package rebuilt from a `main` push. Verify immutable
   image tags, `latest`, source revision, digests, smoke tests, vulnerability
   results, registry visibility, signatures, and release receipts. Do not
   dispatch or require an EE package synchronization.
10. Before enabling a material release-workflow change, require a successful
   non-publishing canary using the production reusable control flow, scratch
   repositories, exact ORAS digest checks, partial-alias detection/restoration,
   and non-publisher verification. A canary must never advance semantic tags,
   production `latest`, Docker Hub, or packages. Review the rolling release-SLO
   issue before declaring recovery complete.
11. Verify the published GitHub release body matches
   `docs/releases/vX.Y.Z.md`. Never delete, recreate, or repoint a published
   `v*` tag; repair mistakes with a reviewed forward release.
