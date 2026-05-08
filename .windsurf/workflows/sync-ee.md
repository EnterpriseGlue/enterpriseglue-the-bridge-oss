---
description: Trigger and monitor the OSS-to-EE sync workflow
---

# /sync-ee — Sync OSS Changes to EE

Triggers the oss-sync workflow in the EE repo and monitors its progress.

## Step 1: Check what needs syncing

Show recent OSS commits that haven't been synced:
// turbo
```bash
gh api repos/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/main...EnterpriseGlue:enterpriseglue-the-bridge-ee:main --jq '.ahead_by' 2>/dev/null || echo "unable to compare"
```

// turbo
```bash
git -C /Users/haryselman/Development/enterpriseglue/enterpriseglue-the-bridge-oss log --oneline -5 main
```

## Step 2: Trigger the sync

```bash
gh workflow run oss-sync.yml --repo EnterpriseGlue/enterpriseglue-the-bridge-ee
```

Tell the user:
> OSS→EE sync triggered. This will:
> 1. Fetch latest OSS main
> 2. Attempt to merge into EE main
> 3. If clean → auto-merge PR created and merged
> 4. If conflicts → PR created for manual resolution

## Step 3: Monitor

Wait ~15s then check:
```bash
gh run list --repo EnterpriseGlue/enterpriseglue-the-bridge-ee --workflow=oss-sync.yml --limit 1
```

If a sync PR was created:
// turbo
```bash
gh pr list --repo EnterpriseGlue/enterpriseglue-the-bridge-ee --head "sync/oss-main" --limit 1
```

## Step 4: Handle conflicts (if any)

If the sync PR has conflicts, tell the user:
> The sync has merge conflicts. You need to resolve them manually:
> ```bash
> cd /Users/haryselman/Development/enterpriseglue/enterpriseglue-the-bridge-ee
> git fetch origin
> git checkout sync/oss-main
> git merge origin/main
> # resolve conflicts
> git push
> ```

If clean merge, tell the user:
> Sync complete! EE is up to date with OSS.

## Notes for Cascade

- The sync also runs automatically daily at 02:00 UTC
- Sync PRs are prefixed with `sync/oss-` — EE CI skips these PRs automatically
- If the user just needs to check sync status (not trigger), show Step 3 only
