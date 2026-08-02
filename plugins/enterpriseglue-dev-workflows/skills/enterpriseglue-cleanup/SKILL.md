---
name: enterpriseglue-cleanup
description: Use when the user says /cleanup, clean this EnterpriseGlue worktree, remove the current chat branch, prune a merged local branch, or safely remove the current worktree after shipping.
---

# EnterpriseGlue /cleanup

Resolve the repository, current worktree, branch, PR state, merge state, remote
branch, dirty files, and unpushed commits before proposing cleanup.

Codex adaptation:
- Treat `/cleanup` as the explicit workflow trigger.
- Only target the current repo and current worktree/branch.
- Never iterate over unrelated worktrees for deletion.
- Ask explicit confirmation before removing a worktree or deleting a local branch, including the exact path and branch name.
- Never delete `main` or a branch that still exists on origin.
