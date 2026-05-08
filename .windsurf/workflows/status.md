---
description: Dashboard view of all branches, PRs, and CI status across OSS and EE repos
---

# /status — Project Status Dashboard

Quick overview of where everything stands across both repositories.

## Step 1: Local branches

Show local feature branches in the current repo:
// turbo
```bash
git branch --list 'feat/*' --list 'fix/*' --list 'chore/*' -v
```

Show current branch:
// turbo
```bash
git branch --show-current
```

## Step 2: Open PRs (OSS)

// turbo
```bash
gh pr list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --state open --limit 10
```

## Step 3: Open PRs (EE)

// turbo
```bash
gh pr list --repo EnterpriseGlue/enterpriseglue-the-bridge-ee --state open --limit 10
```

## Step 4: Release Please PRs

Check for pending release PRs:
// turbo
```bash
gh pr list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --label "autorelease: pending" --limit 5
```
// turbo
```bash
gh pr list --repo EnterpriseGlue/enterpriseglue-the-bridge-ee --label "autorelease: pending" --limit 5
```

## Step 5: Recent CI runs

// turbo
```bash
gh run list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --workflow=ci.yml --limit 3
```
// turbo
```bash
gh run list --repo EnterpriseGlue/enterpriseglue-the-bridge-ee --workflow=ci.yml --limit 3
```

## Step 6: Summarize

Present a concise summary table to the user:

| Item | OSS | EE |
|------|-----|----|
| Current branch | ... | ... |
| Local feature branches | N | N |
| Open PRs | N | N |
| Pending releases | N | N |
| Last CI status | pass/fail | pass/fail |

Suggest next actions based on the state:
- If there are local branches with no PR → suggest `/ship`
- If there are open PRs with passing CI → suggest merging
- If there's a pending release PR → suggest `/release`
- If OSS merged but no EE sync → suggest `/sync-ee`

## Notes for Cascade

- All `gh` commands use `// turbo` — they're read-only and safe to auto-run
- If `gh` auth fails, tell the user to run `gh auth login`
- This workflow is informational only — it never modifies anything
