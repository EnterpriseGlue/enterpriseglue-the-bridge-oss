---
description: Check Release Please PR status, merge it, and monitor the Docker image build
---

# /release — Manage Release

Guide through checking, merging, and monitoring a release.

## Step 1: Find the release PR

// turbo
```bash
gh pr list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --label "autorelease: pending" --json number,title,url --limit 5
```

If no release PR exists:
> No pending release PR. Release Please creates one automatically when conventional
> commits land on main. Merge a feature PR first, then check again.

Stop here if no release PR.

## Step 2: Show release contents

```bash
gh pr view {RELEASE_PR_NUMBER} --repo EnterpriseGlue/enterpriseglue-the-bridge-oss
```

Show the user the changelog preview (PR body).

Ask: "Ready to release, or wait for more features?"

If wait, stop here.

## Step 3: Require release-candidate readiness

Inspect all checks on the exact candidate SHA. Require `ci-complete`,
`Release candidate readiness`, release policy, CodeQL, package, image, and
security gates to finish successfully. Inspect the complete workflow list as
well as the required-check summary; a failed, cancelled, timed-out,
action-required, or still-running workflow is a release blocker.

Download the `release-readiness-{sha}` artifact and verify that
`release-readiness.json` names the candidate SHA and records
`publicationPerformed: false`.

Do not merge when readiness is skipped on a Release Please PR.

## Step 4: Merge the release PR

```bash
gh pr merge {RELEASE_PR_NUMBER} --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --merge
```

Note: Release PRs use merge commit (not squash) to preserve the Release Please metadata.

## Step 5: Monitor protected publication

The merge creates a GitHub Release, which triggers the Docker Images workflow:
// turbo
```bash
gh run list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --workflow="Docker Images" --limit 1
```

Watch it:
```bash
gh run watch --repo EnterpriseGlue/enterpriseglue-the-bridge-oss $(gh run list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --workflow="Docker Images" --limit 1 --json databaseId -q '.[0].databaseId')
```

Then verify protected package publication and the downstream signed plugin
toolchain. Each workflow must use the release commit and complete without a
partial publication. A skipped toolchain run is acceptable only when its
upstream Docker workflow did not represent this release; otherwise investigate
it as incomplete publication.

## Step 6: Post-release

Tell the user:
> Release complete! Docker images are being published.
> - GHCR: `ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend:{version}`
> - Docker Hub: published if DOCKERHUB secrets are configured
>
> Next steps:
> - Use `/sync-ee` to sync this release to EE
> - Use `/release` in the EE workspace to release EE

## Notes for Cascade

- Release PRs use `--merge` not `--squash` (Release Please requires this)
- Never rely only on the green aggregate summary. Inspect every workflow for
  the exact release-candidate SHA and stop on failure, cancellation, timeout,
  action-required, pending, or an unexpectedly skipped readiness job.
- If the release PR has failing checks, show their actual error and stop.
- The Docker Images workflow is triggered by the GitHub Release event, not the merge
