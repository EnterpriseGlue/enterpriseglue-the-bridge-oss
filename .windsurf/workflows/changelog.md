---
description: Preview what the next release changelog will contain
---

# /changelog — Preview Next Release

See what will be in the next release without merging anything.

## Step 1: Check for pending release PR

// turbo
```bash
gh pr list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --label "autorelease: pending" --json number,title,body --limit 1
```

If a release PR exists, show its body (the changelog) and stop.

## Step 2: Show commits since last release

If no release PR yet, show what Release Please will pick up:

// turbo
```bash
git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~20)..HEAD --no-merges
```

## Step 3: Categorize

Parse the conventional commits and group them:

- **Features** (`feat:`): bump minor
- **Bug fixes** (`fix:`): bump patch
- **Breaking** (`!:`): bump major
- **Internal** (`chore:`, `ci:`, `docs:`): no bump

Show a preview:

```
## Next Release (estimated: {patch|minor|major})

### Features
- {scope}: {description} ({sha})

### Bug Fixes
- {scope}: {description} ({sha})

### Internal
- {scope}: {description} ({sha})
```

## Step 4: Advice

Tell the user:
- If the list looks complete → `/release` when Release Please PR appears
- If more features planned → keep shipping, check again later

## Notes for Cascade

- This is read-only — never modify anything
- Release Please determines the actual version bump, this is just a preview
- If `git describe --tags` fails, there are no tags yet — show last 20 commits
