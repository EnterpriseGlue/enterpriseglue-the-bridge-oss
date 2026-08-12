# Release-note and versioning process

EnterpriseGlue records release impact while a change is developed. Release
Please remains the authority for application versions, release pull requests,
tags, and GitHub releases; structured release-note fragments provide the
detail that cannot be reconstructed reliably from commit titles.

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
3. Run:

   ```bash
   pnpm run release-notes:preflight -- --base-ref origin/main
   ```

   This single command tests the tooling, validates the release baseline and
   path coverage, recommends the next version, and always writes
   `.artifacts/release-notes-preview.md`, including when validation fails.

4. Review the generated preview as user, administrator, operator, developer,
   and security communication—not only as an implementation summary.
5. Keep the PR title, `release:*` label, package versions, and fragment
   classification consistent. Breaking fragments require both a conventional
   `!` title and the `release:breaking` label.

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
4. synchronizes that document to a managed release pull-request comment while
   preserving Release Please's machine-readable pull-request body; and
5. publishes the same document as the GitHub release body after the release
   pull request is merged.

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
- package consumers and EnterpriseGlue EE are updated to the package versions
  listed in the release notes.
