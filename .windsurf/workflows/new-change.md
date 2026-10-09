---
description: Implement and verify an isolated local change before authorized shipping
---

# /new-change

Use the maintained `enterpriseglue-new-change` skill at
`plugins/enterpriseglue-dev-workflows/skills/enterpriseglue-new-change/SKILL.md`.

Resolve the active OSS host or owning plugin repository through the lifecycle
policy. Preserve user work, implement in an isolated worktree, update technical
docs and release fragments, and run applicable local checks.

Stop with a reviewable local result. This command does not authorize a push,
PR creation, auto-merge, release or deployment. Wait for the human user to
invoke `/ship` or explicitly authorize the shipping action.
