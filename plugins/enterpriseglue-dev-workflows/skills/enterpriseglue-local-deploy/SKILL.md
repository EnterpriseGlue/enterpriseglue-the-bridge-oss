---
name: enterpriseglue-local-deploy
description: Use when the user says /local-deploy, deploy this EnterpriseGlue worktree locally, run localhost deploy, free local frontend/backend ports, or verify localhost app health from a worktree.
---

# EnterpriseGlue /local-deploy

Resolve the active worktree and inspect its `package.json`, local environment,
and `scripts/deploy-localhost.sh` before deploying. Use
`pnpm run deploy:localhost` when that contract is present.

Codex adaptation:
- Treat `/local-deploy` as the explicit workflow trigger.
- Only run from the active worktree unless the user explicitly chooses another path.
- Free only the ports described by the workflow or ports the user explicitly chooses.
- Ensure workspace dependencies and any required plugin registry auth before
  running deploy scripts.
- Require a worktree-local environment and non-conflicting ports/Compose
  identity. Do not borrow another worktree's ignored environment file when it
  would reuse that stack; use an explicitly isolated fixture or report the
  browser lane as unavailable.
- Verify frontend/backend health from localhost and report exact URLs and logs.
- Do not commit, push, merge, or clean branches from this workflow.
