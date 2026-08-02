---
name: enterpriseglue-oss-to-ee
description: Use when the user says /oss-to-ee, run an OSS to EE pipeline, implement in OSS then consume in EE, publish OSS packages then bump EE, or coordinate cross-repo EnterpriseGlue changes.
---

# EnterpriseGlue /oss-to-ee

Resolve OSS and EE from their remotes and keep separate absolute worktree paths
for the complete workflow.

Codex adaptation:
- Treat `/oss-to-ee` as the explicit workflow trigger.
- This is an orchestration workflow. Load and use `/new-change`, `/ship`, `/release`, and `/sync-ee` workflow files at the points where this workflow hands off.
- Never assume OSS packages published successfully. Verify package versions before bumping EE.
- Keep OSS and EE worktrees distinct and state clearly which repo/worktree is active.
- If GitHub Packages auth fails, explain the `read:packages` requirement.
