---
name: enterpriseglue-status
description: Use when the user says /status, status dashboard, show EnterpriseGlue project status, list OSS/EE branches and PRs, check Release Please PRs, CI runs, Dependabot PRs, or OSS package sync state.
---

# EnterpriseGlue /status

1. Keep this workflow read-only. Resolve OSS/EE repositories, active worktrees,
   branches, PRs, Release Please PRs, CI runs, Dependabot, and package sync.
   Read `.windsurf/workflows/status.md` when present.
2. When release-note tooling exists, report latest stable tag, Release Please
   manifest, changelog baseline, changed fragments, expected next version, PR
   release classification, and reusable preflight result/preview.
3. Separate required, advisory, skipped, pending, failed, and externally
   deferred checks. Include the head SHA so stale runs are visible.
4. Summarize in a compact table with concrete next actions. Do not edit files,
   labels, branches, PR state, workflow runs, or merge settings.
