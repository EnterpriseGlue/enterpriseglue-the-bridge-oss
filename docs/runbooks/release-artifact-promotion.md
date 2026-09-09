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
   verifies with read-only permissions that the merge delta contains only
   generated release files and that the host-chart version change is the exact
   deterministic result expected from the protected base.
3. The staging workflow builds the multi-architecture backend, frontend,
   plugin-installer, and Plugin Manager images. It packages the five
   plugin/API packages and four Helm charts. Before any registry-write job runs,
   the read-only trust-boundary job proves that the candidate is the exact
   merge commit based on the protected revision and that its delta contains
   only the four generated release files. Application image jobs then check out
   that immutable candidate without persisted Git credentials, verify the
   checkout SHA, and bind the actual build context to the same OCI revision.
   The candidate also contains the exact shared, backend-host, and
   frontend-host tarballs in addition to the five plugin/API packages. Plugin,
   host-package, and chart staging remains on the protected checkout; the host chart's
   two validated release fields are derived there deterministically.
4. PostgreSQL, MySQL, SQL Server, Oracle, and Spanner execute as independent
   TypeORM qualification shards. The aggregate requires all five observations,
   matching canonical schema fingerprints, and passing service behavior.
   Exposed-backend, authentication, vulnerability, package, chart, and
   plugin-toolchain checks run against the staged payload as well. The exact
   PostgreSQL candidate images also run the Mission Control mock-engine browser
   journey, including process overview, detail, BPMN, variables, execution
   markers, API responses, and strict console diagnostics.
5. A pinned supported Operaton image qualifies engine version and health,
   process overview, completed process detail, BPMN rendering, final variables,
   and strict browser console/page/network diagnostics against the candidate
   source.
6. The workflow publishes a signed
   `enterpriseglue-release-candidate/v1` receipt at
   `ghcr.io/enterpriseglue/enterpriseglue-oss-release-candidate:sha-<commit>`
   and records the `Release candidate staged` commit status.
7. Branch protection permits the Release Please merge only after that status
   succeeds. Release Please then creates the tag and GitHub release at the same
   commit.
8. `Docker Images` verifies the signed receipt and adds the immutable release
   tags to the already-qualified image digests. It does not rebuild them. The
   workflow verifies that both public release tags still resolve to the signed
   candidate digests, then advances GHCR `latest` and the Docker Hub release
   and `latest` tags without repeating candidate qualification.
9. The protected host-chart and plugin-toolchain workflows copy the signed
   candidate chart manifests into their production repositories, sign the
   production subjects, and verify the exact archives. The plugin-toolchain
   workflow also publishes the distribution lock at
   `ghcr.io/enterpriseglue/releases/enterpriseglue-oss-distribution:<release-tag>`,
   verifies its bytes, and signs its immutable digest for Cloud release-manifest
   consumption.
10. The workflow attaches the signed lock blob, receipts, deployment kit,
    static frontend, and offline archive to the existing GitHub release.
11. `Publish Plugin/API Packages` and `Publish Host Packages` automatically
    consume their exact signed candidate tarballs on the release event. Host
    publication waits until every plugin/API dependency version is visible in
    the registry. The host publisher verifies canonical registry payload
    identity, publishes only missing versions in dependency order, and
    attests them.

The candidate repository and `candidate-vX.Y.Z-<commit>` image tags are
staging identities. Consumers must use released semantic tags or digest
references from a published distribution lock.

Candidate Helm charts use
`ghcr.io/enterpriseglue/release-candidates/charts/<full-source-revision>/<chart>:<chart-version>`.
The full revision is the verified merge-group source, not the protected checkout
or an abbreviated SHA. Different candidates can propose the same unpublished
semantic chart version without sharing a mutable staging tag. Existing candidate
payloads must compare canonically before reuse; a mismatch fails before signing.
An unchanged already-public semantic version is compared and copied by its exact
public digest into the candidate namespace, preserving digest identity despite
archive timestamp differences. A changed public payload requires a new version.
After successful comparison the signed bundle retains the exact fetched chart
archive bytes, so retries cannot drift from the referenced OCI chart layer.
Registry authentication, transport, malformed metadata, comparison, or transfer
errors do not authorize a push or a successful candidate reference.

Protected host and plugin chart promotion require the known chart name under
the signed receipt's exact `sourceRevision` namespace and compare the referenced
OCI archive to the candidate archive before copying or reusing public tags. A
different source, chart name, registry, or old unscoped staging reference is
rejected. Public chart repositories, semantic versions, and candidate-to-public
digest equality are unchanged.

Backend and frontend candidate images are each split into amd64 and arm64 jobs.
The four jobs use separate registry-backed BuildKit caches and publish temporary
architecture digests. Only after every job succeeds does the reusable workflow
assemble, sign, attest, and verify the multi-architecture manifests. Arm64
application images run on `ubuntu-24.04-arm` and amd64 application images on
`ubuntu-24.04`; both native platforms remain mandatory. Treat unavailable
native runner capacity as a release blocker rather than silently reintroducing
an emulated critical path.

The nightly `Release Canary` invokes this same reusable image path in dedicated
scratch repositories and runs the non-publishing release-readiness drill. It
must be green before enabling a material release-control change. It is evidence
for workflow permissions and control flow, not permission to skip the exact
candidate checks above.

The canary also maintains only `recovery-baseline` and `recovery-active` tags
in the dedicated canary repositories. It creates a deliberate partial alias
update, requires the mismatch to be visible, restores the baseline digest
pair, and verifies unavailable candidate/registry inputs fail closed. It never
writes an application release tag or production `latest` alias.

## Required repository rule

Configure `Release candidate staged` as a required status for `main`, including
merge-queue commits. Ordinary pull requests receive a successful no-op status;
Release Please pull requests receive a preliminary success on the pull-request
head and must stage the exact merge-group commit before it can leave the queue.

Configure the merge queue's merge method as **merge**, not squash or rebase.
The qualified merge-group commit must become the exact `main` commit so the
signed receipt, OCI revision labels, Git tag, and GitHub release all identify
one immutable source revision. The repository's auto-merge workflows request
the same method. Changing the commit after qualification invalidates the
candidate and is not supported.

Do not replace this status with a release-event job. A release event occurs
after the tag exists and cannot prevent a partially published version.

## Recovery

First identify the exact release tag and its 40-character source commit. Do not
move or recreate the tag.

- If candidate staging failed before merge, rerun that exact failed workflow
  run or let the merge queue recreate the candidate. Do not manually dispatch
  an unmerged merge-group SHA. Candidate image, chart, and bundle tags are
  immutable: an existing payload is compared and reused.
  Retry only after classifying the actual failure: a transient signing failure
  does not make an earlier chart comparison mismatch safe. A conflicting
  candidate requires a reviewed source fix and newly qualified queue candidate;
  never overwrite the existing candidate or public semantic tag.
- Manual `Release Candidate Stage` recovery accepts only the current protected
  `main` commit and its matching `release_tag`. This supports a release commit
  that has already reached `main` without allowing a privileged workflow to
  execute code from an arbitrary revision.
- If `Docker Images` failed after the release was created, dispatch it with the
  same `source_ref` and `release_tag`. It re-verifies the signed candidate and
  promotes the same digests. A product or browser failure in the signed
  candidate requires a forward patch release; do not move the published tag.
- If the host-chart or plugin-toolchain workflow failed, dispatch the failed
  workflow with the same `source_ref` and `release_tag`. Existing production
  versions and the distribution-lock OCI subject must match the release
  payload or the workflow fails closed.
- If public plugin packages still need publication, dispatch
  `Publish Plugin/API Packages` with the same `source_ref`, `release_tag`, and
  `dry_run=false`. The workflow publishes the retained candidate tarballs in
  dependency order. If host packages still need publication, dispatch
  `Publish Host Packages` from protected `main` with the same `source_ref`,
  `release_tag`, and `dry_run=false`; it consumes the host tarballs from that
  same signed candidate.

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

Strict source-scoped chart consumers do not accept an older signed candidate's
unscoped chart references. Historical candidate recovery must use the matching
historical protected release workflow/source; do not relabel an old receipt or
copy its chart into a new candidate namespace as a workaround. The explicit
pre-candidate legacy recovery path remains separate and does not require helper
scripts that were absent from those historical checkouts.

An explicit `security_rebuild=true` Docker Images dispatch remains available
for a non-release, commit-tagged rebuild. It cannot be combined with semantic
candidate promotion and does not advance public release aliases. Explicit
builds retain the PostgreSQL browser, exposed-backend, Oracle, and vulnerability
gates because they do not carry a signed, pre-qualified candidate receipt.

For classifier policy, selected CI lanes, browser diagnostics, and weekly
queue/runtime/cancellation metrics, see
[CI and release routing](../development/ci-and-release-routing.md).
