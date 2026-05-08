---
description: Compare OSS and EE repos to see what's EE-only vs shared
---

# /compare — Compare OSS vs EE

See what files are EE-only, what's shared, and whether they're in sync.

## Step 1: Sync status

// turbo
```bash
gh pr list --repo EnterpriseGlue/enterpriseglue-the-bridge-ee --head "sync/oss-main" --limit 1
```

If a sync PR is open, tell the user: "There's a pending OSS→EE sync. Resolve it
first with `/sync-ee`."

## Step 2: EE-only files

Show files that exist in EE but not in OSS:
// turbo
```bash
diff <(cd /Users/haryselman/Development/enterpriseglue/enterpriseglue-the-bridge-oss && find backend frontend -type f -name '*.ts' -o -name '*.tsx' | sort) <(cd /Users/haryselman/Development/enterpriseglue/enterpriseglue-the-bridge-ee && find backend frontend -type f -name '*.ts' -o -name '*.tsx' | sort) | grep '^>' | head -30
```

## Step 3: Diverged shared files

Show files that exist in both but differ:
// turbo
```bash
diff -rq /Users/haryselman/Development/enterpriseglue/enterpriseglue-the-bridge-oss/backend/src /Users/haryselman/Development/enterpriseglue/enterpriseglue-the-bridge-ee/backend/src 2>/dev/null | grep "^Files" | head -20
```

## Step 4: Summarize

Present:
- **EE-only files**: N files (list top directories/modules)
- **Diverged files**: N files (these may indicate sync issues)
- **Sync status**: up-to-date / pending

Advise:
- If diverged files exist → check if they should be synced or if EE intentionally overrides them
- If the user wants to make a change → advise which repo based on whether the file is shared or EE-only

## Notes for Cascade

- This is read-only — never modify anything
- EE legitimately overrides some OSS files (e.g. EE-specific modules, SSO providers)
- Diverged files in `backend/src/shared/` or `frontend/src/` are likely sync issues
- Diverged files in EE-specific directories are expected
