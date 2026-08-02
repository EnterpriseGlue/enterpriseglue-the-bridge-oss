---
name: enterpriseglue-sync-ee
description: Use when the user says /sync-ee, sync EE, bump OSS packages in EE, check @enterpriseglue package versions, update EE to latest OSS packages, or inspect Dependabot OSS package bump PRs.
---

# EnterpriseGlue /sync-ee

Read `.windsurf/workflows/sync-ee.md` from the resolved repository root when present. Detect OSS and EE from their remotes; never assume a developer-specific checkout path.

Codex adaptation:
- Treat `/sync-ee` as the explicit workflow trigger.
- Check current versions and pending Dependabot PRs before making changes.
- Use an isolated EE worktree for any package bump.
- Refresh every required lockfile after a bump.
- Verify `guard:ee-plugin-api:current`, typecheck, and unit tests before handing off to `/ship`.
