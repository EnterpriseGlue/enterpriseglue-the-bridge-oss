# Release-note and versioning process

EnterpriseGlue records release impact while a change is developed. Release
Please remains the authority for application versions, release pull requests,
tags, and GitHub releases; structured release-note fragments provide the
detail that cannot be reconstructed reliably from commit titles.

## Implementation, shipping and publication authority

`/new-change` implements and verifies locally. It does not push or create a PR.
`/ship` explicitly authorizes shipping a code capability into protected main;
its per-change docs, fragments, package checks and protected CI remain required.
`/release` separately authorizes publication of one complete batch of merged
PRs. A general fix request, successful CI, a label or a code merge is not
publication approval.

Multiple reviewable code PRs can belong to one release. Release Please keeps one
pending release PR up to date as they merge; automatic runs use
`skip-github-release` and cannot create tags or GitHub releases. Release PRs are
excluded from both PR autopilot and label-driven auto-merge, even if the legacy
release-autopilot setting is enabled. Set `RELEASE_AUTOPILOT_ENABLED=false` in
existing installations. Hotfix preparation follows the same boundary; its
legacy auto-merge input is retained for compatibility and ignored.

There are two different manifests with different owners:

- change authors create `.release-notes/<change-id>.json` fragments;
- Release Please owns `.github/.release-please-manifest.json`, which records
  the current released application version.

Do not create or manually advance the Release Please version manifest in a
feature pull request.

## Change author workflow

1. Add one JSON file under `.release-notes/` for every release-impacting pull
   request. Use a stable lowercase kebab-case name, not a pull-request number.
2. Complete every field from `.release-notes/schema.json`. Empty arrays are
   allowed only when the topic is genuinely not applicable.
3. If the change touches a published package, choose the semantic impact only
   for the directly changed package and let the version planner update the
   complete package set, release-note rows, and bound chart versions together:

   ```bash
   node ./scripts/package-version-plan.mjs apply \
     --base-ref origin/main \
     --fragment .release-notes/<change-id>.json \
     --bump @enterpriseglue/<package>=patch
   ```

   Repeat `--bump` for multiple directly changed packages. Use `minor` or
   `major` where the public package contract requires it. The planner assigns
   patch changes to packed workspace consumers; do not chase or hand-edit those
   transitive versions. Review the resulting plan, then run the working-tree-
   aware guard before the first commit:

   ```bash
   bash ./scripts/check-published-package-version-discipline.sh origin/main
   ```

   Run the same guard once more against the committed revision before pushing.
   This prevents a locally green release-note preview from deferring a missing
   manifest bump to hosted CI.
4. Run:

   ```bash
   pnpm run release-notes:preflight -- --base-ref origin/main
   ```

   This single command tests the tooling, validates the release baseline and
   path coverage, recommends the next version, and always writes
   `.artifacts/release-notes-preview.md`, including when validation fails.

5. Review the generated preview as user, administrator, operator, developer,
   and security communication—not only as an implementation summary.
6. Keep the PR title, `release:*` label, package versions, and fragment
   classification consistent. Breaking fragments require both a conventional
   `!` title and the `release:breaking` label.

## Package version authority

`scripts/package-version-authority.json` is the single maintained inventory of
published OSS packages. It defines each package manifest and source root, the
atomic publication sets and dependency-safe publication order, packed workspace
dependency propagation, and package-to-chart version bindings. Release-note
validation and both package publishers read this inventory; they must not keep
parallel package lists.

Use the read-only plan command at any point while developing:

```bash
node ./scripts/package-version-plan.mjs plan --base-ref origin/main
```

The plan compares the working tree with the merge base, shows direct and
transitive package changes before CI, and reports the exact expected versions
and reasons. `check` is the fail-closed form used by
`guard:published-package-versions` and CI. It rejects missing or unexplained
bumps, stale release-note rows, dependency-order mistakes, and mismatched bound
chart versions.

The application version, host chart version, and developer-workflow plugin
version remain independent artifacts. Application versions continue to be
owned by Release Please. A change to one independent artifact never implies an
EE synchronization or release step; the OSS repository is the only application
host authority.

Dependency updates use serialized trains: combine compatible patch and minor
updates for one ecosystem and lockfile into one reviewed change, allow only one
such train to mutate that lockfile at a time, and isolate major upgrades by
dependency or tightly coupled family. A dependency train that changes a
published package runs through this same planner. Product-specific plugins keep
their own dependency and release train in their owning repositories.

For an internal-only change, `release-note:none` may be used with a PR-body
line in this exact form:

```text
Release-note exemption: <why no user, operator, API, database, or security behavior changes>
```

Authentication, authorization, public API/schema, and migration changes can
never use the exemption.

## Path-aware requirements

CI derives mandatory fragment sections from the changed files:

| Changed area | Required information |
|---|---|
| TypeORM migrations | Migration identifiers, upgrade notes, and rollback |
| OpenAPI, public schemas, or plugin API | Compatibility classification and API changes |
| Authentication, authorization, identity, or SSO | Security impact |
| Environment or configuration contracts | Configuration impact |
| Frontend behavior | User impact |
| Published OSS packages | Previous version, new version, and semantic impact |

## Pull-request preflight

Release-note validation is a fail-fast prerequisite, not a test that runs in
parallel with the product suites. Every expensive pull-request workflow calls
`.github/workflows/release-notes-preflight-reusable.yml`; its first test or
change-detection job declares `needs: release-notes-preflight`.

The preflight:

1. checks out the complete tag and branch history;
2. fetches the current PR title, body, and labels through the GitHub API rather
   than trusting a possibly stale webhook payload;
3. waits briefly for automatic release classification on a newly opened PR;
4. tests the release-note tooling and validates the release baseline;
5. enforces path coverage, exemption policy, breaking-title/label agreement,
   and package/version details; and
6. recommends the semantic version and builds the release-note preview.

For merge groups, combined path coverage is still validated. The current code
PR's title, labels and exemption are checked against its own API-verified file
list, with its exact head required to be an ancestor of the group. An earlier
breaking PR therefore cannot force a later fix PR to acquire a false breaking
title. Release Please PRs continue to validate the complete release against the
previous stable tag.

If any step fails, CI change detection, build matrices, browsers, containers,
database adapters, CodeQL, and dependency-notice verification do not start.
Separate GitHub Actions workflows cannot depend on a job in another workflow,
so each expensive workflow invokes the same reusable implementation. Contract
tests in `scripts/release-notes.test.mjs` protect those dependency edges.

The main PR CI uploads `.artifacts/release-notes-preview.md` as a thirty-day
artifact and includes the reusable preflight in the aggregate required check.

## Release Please workflow

After feature and fix pull requests merge, Release Please creates or updates a
release pull request. The workflow then:

1. validates that the manifest, latest stable tag, and changelog agree;
2. finds all fragments changed since the latest stable tag;
3. generates `docs/releases/vX.Y.Z.md` on the Release Please branch;
4. removes duplicate top-release changelog entries only when Git proves that
   one linked commit is already represented by its merge commit;
5. synchronizes that document to a managed release pull-request comment while
   preserving Release Please's machine-readable pull-request body; and
6. holds publication until an explicit approved `/release` dispatch, then
   publishes the same document as the GitHub release body.

The release operator reviews the combined document against the frozen source
and accepted candidate. Package rows consolidate the continuous version chain
from the previous published version to the final version. New migrations are
listed as new; fixes to historical migrations are explained separately.
Remove superseded pending-check claims and keep development retries in CI
artifacts. Technical API/configuration/upgrade docs accompany the code.
Customer guides target the documentation CMS; when it is unavailable, drafts
remain explicitly unpublished under the non-Git customer-docs staging root.

The publication gate regenerates `docs/releases/vX.Y.Z.md` from every fragment
changed since the previous stable tag and compares it byte-for-byte with the
checked-in document. Its complete contents must also match the managed release
PR comment. The concise `CHANGELOG.md` remains ancestry-deduplicated. Do not
hand-edit generated documents to pass these checks.

Publication approval reads every page of closed-PR history, retaining merge
state, branch names and labels while omitting unrelated historical PR bodies.
Other metadata reads preserve their complete JSON payload with a bounded
16 MiB subprocess buffer. Failed or malformed responses stop approval and name
the endpoint without logging response contents. A local repair cannot replace
the exact protected source or bypass its signed-candidate qualification.

## Publishing an approved batch

Publication-authorization changes have a focused pre-merge rehearsal in the
`Non-publishing release authorization canary` CI job. It runs the production
approval CLI against token-free disposable Git/API fixtures, checks automatic
event rejection, complete-batch/source/document guards, then executes the real
signed-candidate step with the approved fixture source. Its deliberately
unstaged candidate must be rejected as a missing manifest; authentication,
transport and tool failures are not passing evidence. The job has only read
permissions, cannot invoke a publisher, and is non-skippable in `ci-complete`
when release controls are selected. Its retained receipt identifies the exact
tested source and distinguishes fixture authority from production proof.

This focused rehearsal does not accept a signed production candidate or
replace release readiness, image, database, browser or security qualification.
The existing weekly scratch-image/recovery canary remains required for changes
to image publication or alias-recovery control flow. Authorization-only work
does not need a new GCP environment or application image rebuild for its
focused canary.

After all intended code PRs are merged and the Release Please candidate passes
its protected CI and signed staging gate, `/release` merges the release PR
with a merge commit and resolves that exact source SHA. Its merge alone does
not publish. The explicit publication dispatch is:

```bash
gh workflow run release-please.yml --ref main \
  -f publish_release=true \
  -f source_ref=<exact-release-merge-SHA> \
  -f release_tag=vX.Y.Z \
  -f release_pr=<merged-release-PR-number> \
  -f required_prs='[<code-PR-number>,<code-PR-number>]'
```

These inputs record the already approved batch. The gate rejects missing or
unmerged PRs, PRs outside that source's ancestry, source drift, inconsistent
version identities, another merged release awaiting publication, or mismatched
generated documentation. The approved list must match every unreleased code PR
in main's first-parent history; naming only a subset cannot publish additional
unapproved changes. The gate also verifies the live protected-main head. The
source must still be the exact protected-main
workflow commit; if main moves, stop and resolve the changed composition rather
than silently substituting a new SHA. Keep the brief release merge/publication
interval frozen.

The signed candidate is verified before Release Please can tag. Automatic
push/schedule runs only prepare PRs, and pause preparation while a release merge
is awaiting publication. The authorization artifact records the source, tag,
release PR, required code PRs, baseline and dispatcher; it is evidence of the
explicit workflow request, not a substitute for signed candidate acceptance.
Post-tag image and package workflows promote the same qualified bytes. Verify
the resulting tag's exact source and release-body/document equality, then
report image/package publication separately from any deployment.

The ancestry-aware changelog pass retains the merge commit entry, leaves
unrelated commits with identical text untouched, and never rewrites an older
published release section. This accommodates the merge-queue identity required
by signed release candidates without accepting duplicate release entries.

Release Please may mutate a release branch only when at least one non-schema
`.release-notes/*.json` fragment changed since the latest stable tag, or when
the current commit is the exact release-publication commit. Internal, CI-only,
documentation-exempt, and recovery commits without a fragment therefore do not
create patch versions merely because their merge history contains a
conventional `fix` commit.

Generated release documents include repository publication front matter. This
classifies them as technical release documentation for operators, developers,
and maintainers and allows the same document to pass the documentation boundary
in both pull-request and protected merge-group checks.

The generated Release Please version must equal the fragment-derived semantic
version. Before 1.0, breaking changes and features produce a minor release
under the repository's `bump-minor-pre-major` policy; fixes produce a patch.
After 1.0, breaking changes produce a major release.

`CHANGELOG.md` remains the concise conventional-commit history. The generated
versioned document is the detailed user, operator, upgrade, rollback, package,
security, limitation, and validation record.

Do not edit generated `docs/releases/vX.Y.Z.md` files directly. Update the
source fragments and rerun the generator. Release pull requests use merge
commits so the release commit, generated document, manifest, and changelog stay
together.

## Release-candidate readiness and staging

Release pipeline implementation changes run an additional read-only
qualification phase before they may merge. That contract-focused phase:

1. verifies that every job in the main CI workflow is covered by the required
   `ci-complete` aggregate;
2. checks published-package version discipline from the latest stable tag;
3. builds, tests, packs, and validates the five plugin/API packages and the
   shared, backend-host, and frontend-host package set;
4. compares existing immutable package and Helm chart versions with the
   candidate payload, or records that a new version would be published;
5. builds the backend, frontend, plugin-installer, and Plugin Manager
   production images, rejecting all vulnerability severities for application
   images and HIGH or CRITICAL for toolchain images, matching their respective
   exact-candidate gates; and
6. rehearses chart receipts, signatures, immutable repulls, the signed air-gap
   bundle, and a disconnected registry import.

The readiness job has only `contents: read` and `packages: read`. Release
Please heads and merge groups skip that source-level rehearsal because the
source change was already qualified before the release pull request was
generated. After the exact Release Please merge-group commit passes CI, the
privileged `Release Candidate Stage` workflow performs the one authoritative
heavy qualification of the immutable registry payload. It publishes only
candidate tags and a signed candidate receipt; it does not create a Git tag,
GitHub release, public package version, production chart version, Docker Hub
tag, or `latest` alias.

Exact candidate staging also runs both package-set publication dry runs against
its packed payload and the local disposable-registry toolchain rehearsal before
the signed candidate receipt can be published. This does not repeat the entire
source-level readiness build. A thirty-minute step timeout fails closed.
The ninety-day rehearsal artifact binds the merge-group source, protected
checkout source, proposed version, workflow run and attempt. It retains partial
logs on failure; only a fully completed sequence writes a passing rehearsal
receipt. Deterministic proof with the eight unchanged candidate tarball hashes
also travels in the signed candidate bundle; run IDs and registry-dependent
diagnostics stay in CI artifacts so retries preserve immutable bundle bytes.
`publicationPerformed: false` means no production publication. The local
rehearsal writes only disposable registries, while other candidate stages
still write their explicitly scoped candidate artifacts.

Candidate commit metadata and the four generated release files are read through
the GitHub API by a `contents: read` validation job; the candidate is never
checked out on a runner. Every job with package-write or signing authority
checks out only the protected base revision. The validator proves the release
merge changes no executable source and that its host-chart version update is
deterministic; the privileged chart job derives that update again from the
protected base. Candidate files and caches are never imported into privileged
execution.

Branch protection requires the `Release candidate staged` status. A release
must not be merged while either CI or staging is failed, cancelled, timed out,
still running, or awaiting action, even if an individual required status
context appears green.

The retained `.artifacts/release-readiness/release-readiness.json` identifies
the exact source revision and comparison tag and records that no publication
occurred. Registry plan and dry-run receipts remain CI artifacts rather than
repository documentation.

The signed `enterpriseglue-release-candidate/v1` receipt binds the merge-group
commit and proposed release version to exact application and toolchain image
digests, chart manifests, package tarball checksums, and chart archive
checksums. Post-tag workflows verify that receipt and promote the same bytes.
See [Release artifact staging and promotion](../runbooks/release-artifact-promotion.md)
for the operator sequence and recovery rules.

Immutable package comparison hashes paths, file modes, links, and file
contents. Because JSON object member order has no semantic meaning, the
packaged `package.json` is recursively key-sorted before hashing; arrays and
all values retain their exact order and content. Other packaged files remain
byte-sensitive.

## Baseline and hotfix safety

The latest stable `vX.Y.Z` tag must equal the version in
`.github/.release-please-manifest.json`, and `CHANGELOG.md` must contain that
tag. A pending Release Please branch may be exactly one future version only
when that version is already present in its changelog.

Hotfixes use the same fragments, validation, detailed-note generation, Release
Please pull request, and merge method. Never create, delete, move, or recreate
a published release tag to repair metadata. Correct it with a reviewed
forward release.

## Post-release evidence

After publication, verify:

- the GitHub release body matches `docs/releases/vX.Y.Z.md`;
- backend and frontend images exist under the immutable `vX.Y.Z` tag;
- image digests and source revision are recorded;
- release image smoke tests pass;
- the vulnerability scan evaluates the newly published digests; and
- protected package publication completes for the exact release commit;
- host package publication consumes the exact signed candidate tarballs rather
  than rebuilding from an arbitrary `main` push;
- the signed plugin-toolchain workflow completes for the exact release commit;
- supported plugin-consumer compatibility checks pass against the package
  versions listed in the release notes.

`latest` and Docker Hub aliases are advanced only after the immutable release
tags pass PostgreSQL, exposed-backend, Oracle, and vulnerability qualification.
Retry a failed publication against the same tag and source commit. Create a new
version only when the shipped payload itself must change.

The trusted preparation job generates both the concise latest `CHANGELOG.md`
section and the detailed versioned document from the complete fragment selection
since the stable tag. Earlier changelog sections remain unchanged. Commit
selection alone can omit an older branch merged after a release; fragment-based
generation keeps those unreleased changes in the combined documentation.
Evidence-only corrections retain identical historical package transitions at
the PR comparison base. Those records cannot authorize a fresh source change;
new source still requires a valid new bump and downstream consumer versions.

Publication recovery preserves the versioned notes and concise changelog from
the frozen release source. The signed publication identity binds both document
hashes and the complete code-PR batch to the immutable candidate. A reviewed
publication-only repair is tracked as a separate workflow revision and repair
PR list; its technical fragment accompanies that code change without rewriting
the already qualified release document. Newly selected release content requires
new generation and candidate qualification. See the
[artifact promotion runbook](../runbooks/release-artifact-promotion.md) for the
recovery protocol and observed publication states.
