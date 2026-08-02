---
name: enterpriseglue-deps
description: Use when the user says /deps, audit dependencies, update EnterpriseGlue dependencies, fix dependency vulnerabilities, build an outdated package version map, or plan safe dependency upgrades.
---

# EnterpriseGlue /deps

Read `.windsurf/workflows/deps.md` from the resolved repository root when present.

Codex adaptation:
- Treat `/deps` as the explicit workflow trigger.
- Do not update dependencies on `main`; require an isolated worktree branch.
- Always produce the version map before changing dependency versions.
- Major upgrades require explicit user approval per package or approved grouped peer-unblock set.
- Stop on dependency resolution or test failures and present fix, revert, or abort options.
