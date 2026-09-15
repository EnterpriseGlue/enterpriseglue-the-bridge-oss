---
name: enterpriseglue-status
description: Use when the user says /status, status dashboard, show EnterpriseGlue OSS host, plugin-platform, or Cloud delivery status, list branches and PRs, check Release Please PRs, CI runs, Dependabot PRs, package publication, or staging deployment state.
---

# EnterpriseGlue /status

1. Read `../../references/repository-lifecycle.json` before selecting repository
   scope. Exclude retired repositories. Only an explicitly requested historical
   audit may use `historical-read`; never include retired repositories in the
   normal dashboard.
2. Keep this workflow read-only. Resolve the OSS host, relevant owning plugin
   repositories, EnterpriseGlue Cloud, active worktrees, branches, PRs, release
   PRs, CI runs, Dependabot, package publication, staging delivery, and
   compatibility status. Read
   `.windsurf/workflows/status.md` when present.
3. When release-note tooling exists, report latest stable tag, Release Please
   manifest, changelog baseline, changed fragments, expected next version, PR
   release classification, and reusable preflight result/preview.
4. Separate required, advisory, skipped, pending, failed, and externally
   deferred checks. Include the head SHA so stale runs are visible.
5. For Cloud delivery, report the published OSS version/tag/SHA, selected
   Cloud/OSS composition, installed staging candidate, staging default/Stable
   route, non-default lifecycle/fallback state, and production promotion as
   separate rows. Inspect protected workflow dispositions and the mutation lock;
   never infer staging deployment from publication, merge, image build, or CI.
6. Summarize in a compact table with concrete next actions. Do not edit files,
   labels, branches, PR state, workflow runs, or merge settings.
