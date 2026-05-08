---
description: Start a new feature, fix, or chore — creates a local branch with proper naming and commit conventions
---

# /new-change — Start a New Change (OSS)

Lightweight workflow: create a properly named branch, work locally, then use `/ship`
when done. No PR is created until you ship.

## Step 0: Pre-flight branch safety

Before asking for the change type, inspect the current checkout:

// turbo
```bash
git branch --show-current
git status --short
```

Rules:
- If the current branch is `main` and the working tree is clean, continue normally.
- If the current branch is `main` and the working tree has changes, treat this as a
  salvage flow: keep the existing work, create the new branch in place, and do not
  run `git pull` first.
- If the current branch is not `main` and there are local changes, stop and ask the
  user whether they want to keep working on that branch or create a different branch
  manually first.
- If the current branch is not `main` and it is clean, ask the user whether to branch
  from `main` or from the current branch.

## Step 1: What kind of change?

Ask the user using `ask_user_question`:
- **Feature** — New functionality
- **Bug fix** — Fixing broken behavior
- **Security fix** — CVE or security hardening
- **Chore / CI / Docs** — Internal, infra, documentation

Internal mapping (do NOT show to user):

| Choice        | Prefix   | Type    | Label              |
|---------------|----------|---------|--------------------|
| Feature       | `feat/`  | `feat`  | `release:feature`  |
| Bug fix       | `fix/`   | `fix`   | `release:fix`      |
| Security fix  | `fix/`   | `fix`   | `release:security` |
| Chore/CI/Docs | `chore/` | `chore` | `release:internal` |

## Step 2: Describe it

Ask the user to describe the change in a few words.

Derive:
- **scope**: infer from context (e.g. `backend`, `frontend`, `ci`, `infra`)
- **slug**: kebab-case (e.g. `docker-publish-deadlock`)
- **branch**: `{prefix}{slug}`
- **commit_msg**: `{type}({scope}): {description}`

Show the user: "Branch: `{branch}`, commit: `{commit_msg}`" — ask to confirm or edit.

## Step 3: Create the branch

If Step 0 determined the checkout is a clean `main`, run:

// turbo
```bash
git fetch origin --prune
git checkout main && git pull origin main
git checkout -b {branch}
```

If Step 0 determined the checkout is a dirty `main`, run this salvage path instead:

```bash
git checkout -b {branch}
```

Tell the user explicitly:
> Your work was already on local `main`, so I moved it onto `{branch}` first to keep
> it safe and avoid pushing from protected `main`.

If Step 0 found a non-`main` branch with local changes, do not continue automatically.
Ask the user to confirm whether to keep that branch or clean up first.

Tell the user: "Branch `{branch}` is ready. Make your changes. When done, say
`/ship` or 'ready to ship'."

**Stop here.** The user will work on their code.

## Notes for Cascade

- This workflow only creates the branch — it does NOT push or create a PR
- Use `/ship` to commit, push, create PR, and merge
- If work already exists on local `main`, salvage it by creating the new branch in
  place instead of pulling `main` first
- For EE-only changes, tell the user to switch to the EE workspace and use
  `/new-change` there instead
- The commit message becomes the PR title (via `gh pr create --fill`), which
  drives all GitHub automation (labeler, AI assistant, release policy)
