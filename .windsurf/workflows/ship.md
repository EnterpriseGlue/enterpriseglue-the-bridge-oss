---
description: Ship current branch — commit, push, create PR, wait for CI, merge, and clean up
---

# /ship — Ship Current Branch (OSS)

One-command flow to go from local changes to merged PR.

## Step 1: Pre-flight checks

// turbo
```bash
git branch --show-current
```

Verify we're NOT on `main`. If on `main`, tell the user to run `/new-change` first.

// turbo
```bash
git status --short
```

If no changes and no unpushed commits, tell the user there's nothing to ship.

Remind the user: "Tip: run `/test` first if you haven't already."

## Step 2: Stage and review

Show what will be committed:
// turbo
```bash
git diff --stat
```

If there are untracked files, show those too:
// turbo
```bash
git ls-files --others --exclude-standard
```

## Step 3: Commit

Infer the commit message from the branch name:
- `feat/add-user-export` → `feat(backend): add user export`
- `fix/docker-deadlock` → `fix(ci): resolve docker deadlock`
- `chore/update-deps` → `chore(infra): update dependencies`

If the user previously ran `/new-change`, reuse the commit message from that session.

Propose: "`{commit_msg}`" — ask user to confirm or edit.

```bash
git add -A
git commit -m "{final_commit_msg}"
```

If there are already commits on this branch (no new changes), skip this step.

## Step 4: Push and create PR

```bash
git push -u origin {branch}
gh pr create --fill
```

Show the PR URL.

Tell the user:
> PR created. GitHub automation is running:
> - PR Release Labeler adds the release label
> - PR AI Assistant may refine the title
> - CI is running: detect → tests → smoke → security → ci-complete

## Step 5: Wait for CI

```bash
gh pr checks {PR_NUMBER} --watch
```

If CI fails, show the failed checks and ask the user what to do:
- **View logs** — `gh run view {RUN_ID} --log-failed`
- **Fix and re-push** — make changes, `git add -A && git commit --amend --no-edit && git push --force-with-lease`
- **Abort** — leave PR open for later

## Step 6: Merge

```bash
gh pr merge {PR_NUMBER} --squash --delete-branch
```

If this reports that the PR is already queued to merge or auto-merge is already enabled,
do not treat it as a failure. Instead, wait until GitHub reports the PR as merged:

```bash
gh pr view {PR_NUMBER} --json state,mergedAt,mergeStateStatus,url
```

If the PR is still open but `mergeStateStatus` is clean/queued and auto-merge is active,
tell the user the PR is waiting on the protected-branch merge queue and keep polling until
`state` becomes `MERGED` before doing local cleanup.

// turbo
```bash
git fetch origin --prune
git checkout main && git pull origin main
```

Then delete the local feature branch:

```bash
git branch -d {branch}
```

If that delete fails after a confirmed merged PR, it is usually because the PR was squash
merged and the local branch tip is not a direct ancestor of `main`. In that case, force
delete the already-merged local branch:

```bash
git branch -D {branch}
```

## Step 7: Rebase other local branches (if any)

Check for other feature branches:
// turbo
```bash
git branch --list 'feat/*' --list 'fix/*' --list 'chore/*'
```

If other branches exist, ask the user if they want to rebase them now:
```bash
git checkout {next_branch}
git rebase origin/main
```

Then tell the user: "Ready to continue on `{next_branch}`, or run `/ship` again
when this one is done."

## Step 8: Post-merge info

Tell the user:
> Merged! Release Please will create/update a release PR on main.
> Use `/release` to check its status and merge when ready.
> Use `/sync-ee` to push this to the EE repo.

## Notes for Cascade

- Do NOT add labels or modify the PR title — GitHub automation handles this
- If `gh pr create --fill` fails (e.g. no commits ahead of main), tell the user
- The `--squash` merge ensures one clean commit per feature on main
- If the branch already has a PR open, skip PR creation and go to Step 5
- If `gh pr merge` reports the PR is already queued/auto-merge-enabled, wait for GitHub
  to finish the protected-branch merge before local cleanup
- After a squash merge, `git branch -d` may fail even though the PR is merged; once the PR
  is confirmed merged, it is safe to use `git branch -D {branch}` for local cleanup
