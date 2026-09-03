---
name: enterpriseglue-oss-to-ee
description: Use when the user invokes the legacy /oss-to-ee workflow or asks for an OSS-to-EE package sync; explain that the standalone EE development path is retired and route the work to OSS plus the owning plugin repository.
---

# EnterpriseGlue /oss-to-ee (retired)

The standalone EE repository is not a forward-development or release target.
Do not create or modify EE worktrees, branches, package bumps, pull requests,
dispatches, or releases.

1. Tell the user that `/oss-to-ee` is retained only as a safe legacy redirect.
2. Route host, runtime, SDK, installer, manager, deployment, and public contract
   changes to the OSS repository.
3. Route proprietary product behavior to its owning plugin repository and
   validate it against supported public OSS plugin contracts and packages.
4. If the user explicitly requests a historical EE audit, keep it read-only
   and clearly separate it from the current OSS/plugin delivery path.
