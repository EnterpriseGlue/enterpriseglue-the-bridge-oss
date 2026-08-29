---
doc_class: technical
audience: maintainer, operator, developer
publication: github
lifecycle: as-built
---

# Release artifact staging and promotion

EnterpriseGlue releases build the distributable payload before Release Please
creates the immutable Git tag. A failed registry, signature, smoke, or chart
operation is recovered against the same release identity; it is not a reason
to create another patch version.

## Release sequence

1. The Release Please pull request passes the normal read-only CI and release
   readiness jobs.
2. The merge queue creates the exact commit that will become the release
   commit. After `CI` succeeds for that merge group, `Release Candidate Stage`
   verifies that the merge delta contains only generated release files.
3. The staging workflow builds the multi-architecture backend, frontend,
   plugin-installer, and Plugin Manager images. It packages the four public
   plugin packages and four Helm charts.
4. PostgreSQL, exposed-backend, authentication, Oracle, vulnerability,
   package, chart, and plugin-toolchain checks run against the staged payload.
5. The workflow publishes a signed
   `enterpriseglue-release-candidate/v1` receipt at
   `ghcr.io/enterpriseglue/enterpriseglue-oss-release-candidate:sha-<commit>`
   and records the `Release candidate staged` commit status.
6. Branch protection permits the Release Please merge only after that status
   succeeds. Release Please then creates the tag and GitHub release at the same
   commit.
7. `Docker Images` verifies the signed receipt and adds the immutable release
   tags to the already-qualified image digests. It does not rebuild them.
8. The published image smokes and vulnerability scan run again through the
   public tags. Only after all four jobs pass are GHCR `latest` and the Docker
   Hub release and `latest` tags advanced.
9. The protected host-chart and plugin-toolchain workflows copy the signed
   candidate chart manifests into their production repositories, sign the
   production subjects, verify the exact archives, and attach receipts and
   distribution assets to the existing GitHub release.
10. Public plugin package publication consumes the exact candidate tarballs
    when `release_tag` is supplied.

The candidate repository and `candidate-vX.Y.Z-<commit>` image tags are
staging identities. Consumers must use released semantic tags or digest
references from a published distribution lock.

## Required repository rule

Configure `Release candidate staged` as a required status for `main`, including
merge-queue commits. Ordinary pull requests receive a successful no-op status;
Release Please pull requests receive a preliminary success on the pull-request
head and must stage the exact merge-group commit before it can leave the queue.

Do not replace this status with a release-event job. A release event occurs
after the tag exists and cannot prevent a partially published version.

## Recovery

First identify the exact release tag and its 40-character source commit. Do not
move or recreate the tag.

- If candidate staging failed before merge, rerun `Release Candidate Stage`
  with the same `source_ref` and `release_tag`. Candidate image, chart, and
  bundle tags are immutable: an existing payload is compared and reused.
- If `Docker Images` failed after the release was created, dispatch it with the
  same `source_ref` and `release_tag`. It re-verifies the signed candidate and
  promotes the same digests.
- If the host-chart or plugin-toolchain workflow failed, dispatch the failed
  workflow with the same `source_ref` and `release_tag`. Existing production
  versions must match the candidate digest or the workflow fails closed.
- If public plugin packages still need publication, dispatch
  `Publish plugin SDK packages` with the same `source_ref`, `release_tag`, and
  `dry_run=false`. The workflow publishes the retained candidate tarballs in
  dependency order.

Create a new patch release only when shipped content must change. Authentication
failures, registry timeouts, runner loss, signature retries, and incomplete
alias promotion are recovery events for the existing release.

## Backward compatibility

The application runtime, configuration, APIs, database schema, image names,
semantic tags, Helm repositories, and package names are unchanged. Protected
recovery workflows retain their legacy build-and-compare or immutable-tag
verification path for source commits created before this candidate workflow
existed. New release commits fail closed when their signed candidate receipt
is absent or does not match.

An explicit `security_rebuild=true` Docker Images dispatch remains available
for a non-release, commit-tagged rebuild. It cannot be combined with semantic
candidate promotion and does not advance public release aliases.
