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

## Step 3: Merge the release PR

```bash
gh pr merge {RELEASE_PR_NUMBER} --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --merge
```

Note: Release PRs use merge commit (not squash) to preserve the Release Please metadata.

## Step 4: Monitor Docker image build

The merge creates a GitHub Release, which triggers the Docker Images workflow:
// turbo
```bash
gh run list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --workflow="Docker Images" --limit 1
```

Watch it:
```bash
gh run watch --repo EnterpriseGlue/enterpriseglue-the-bridge-oss $(gh run list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --workflow="Docker Images" --limit 1 --json databaseId -q '.[0].databaseId')
```

## Step 5: Post-release

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
- If the release PR has failing checks, show them and ask the user to fix first
- The Docker Images workflow is triggered by the GitHub Release event, not the merge
