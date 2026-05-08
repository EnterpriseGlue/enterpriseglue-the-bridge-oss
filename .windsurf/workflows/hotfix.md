---
description: Fast-track an urgent patch — branch, fix, test, PR, merge in one flow
---

# /hotfix — Fast-Track Urgent Patch

Streamlined flow for critical fixes that need to land immediately.

## Step 1: Describe the fix

Ask the user to describe the issue in a few words.

Derive:
- **branch**: `fix/{slug}`
- **commit_msg**: `fix({scope}): {description}`

## Step 2: Create branch and apply fix

// turbo
```bash
git checkout main && git pull origin main
git checkout -b {branch}
```

Tell the user to make the fix. Help if asked.

## Step 3: Quick test

Run the minimal test suite automatically:
```bash
npm run typecheck && npm run test:unit
```

If tests fail, stop and help fix. Do NOT proceed to shipping with failing tests.

## Step 4: Ship immediately

```bash
git add -A
git commit -m "{commit_msg}"
git push -u origin {branch}
gh pr create --fill
```

Show PR URL.

## Step 5: Wait for CI and merge

```bash
gh pr checks {PR_NUMBER} --watch
```

Once CI passes:
```bash
gh pr merge {PR_NUMBER} --squash --delete-branch
```

// turbo
```bash
git checkout main && git pull origin main
```

## Step 6: Post-hotfix

Tell the user:
> Hotfix merged. Next steps:
> - `/release` to check if Release Please PR is ready to merge
> - `/sync-ee` to push the fix to EE immediately

## Notes for Cascade

- Hotfix skips the draft PR step entirely — goes straight to ready PR
- Always run quick tests before shipping — even for hotfixes
- If the fix is security-related, the commit type is still `fix` but the PR
  will get `release:security` label from the PR Release Labeler
