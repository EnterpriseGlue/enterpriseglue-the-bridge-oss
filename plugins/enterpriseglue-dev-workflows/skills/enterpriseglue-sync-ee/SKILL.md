---
name: enterpriseglue-sync-ee
description: Use when the user invokes the legacy /sync-ee workflow or asks to bump OSS packages in EE; explain that standalone EE synchronization is retired and route compatibility work to the owning plugin repository.
---

# EnterpriseGlue /sync-ee (retired)

The standalone EE repository is not a package consumer or release target for
forward development. Do not create or modify EE worktrees, dependency bumps,
lockfiles, pull requests, dispatches, or releases.

1. Tell the user that `/sync-ee` is retained only as a safe legacy redirect.
2. Resolve the owning plugin repository that consumes the changed OSS package.
3. Verify the published OSS package version and public manifest before changing
   that plugin consumer.
4. Update and test the plugin repository through its normal dependency,
   compatibility, and shipping workflows.
5. If the user explicitly requests a historical EE audit, keep it read-only.
