---
description: Push and merge an explicitly authorized code capability without publication
---

# /ship

Use the maintained `enterpriseglue-ship` skill at
`plugins/enterpriseglue-dev-workflows/skills/enterpriseglue-ship/SKILL.md`.

This command ships one coherent code capability through local gates and
protected PR checks. Preserve per-change release fragments, package-version
discipline and documentation-boundary validation.

Release Please PRs belong to `/release`. Do not merge them, enable their
auto-merge, create tags or dispatch publication from `/ship`. Report the code
merge and unreleased state; deployment remains separately authorized.
