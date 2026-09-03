---
name: enterpriseglue-status
description: Use when the user says /status, status dashboard, show EnterpriseGlue OSS host and plugin-platform status, list branches and PRs, check Release Please PRs, CI runs, Dependabot PRs, or public package publication.
---

# EnterpriseGlue /status

1. Keep this workflow read-only. Resolve the OSS host and relevant owning
   plugin repositories, active worktrees, branches, PRs, release PRs, CI runs,
   Dependabot, package publication, and compatibility status. Read
   `.windsurf/workflows/status.md` when present. Omit the retired EE repository
   unless the user explicitly requests a historical audit.
2. When release-note tooling exists, report latest stable tag, Release Please
   manifest, changelog baseline, changed fragments, expected next version, PR
   release classification, and reusable preflight result/preview.
3. Separate required, advisory, skipped, pending, failed, and externally
   deferred checks. Include the head SHA so stale runs are visible.
4. Summarize in a compact table with concrete next actions. Do not edit files,
   labels, branches, PR state, workflow runs, or merge settings.
