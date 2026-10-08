---
description: Inventory and qualify scoped dependency updates in an isolated worktree
---

# /deps — Dependency management

Use the maintained `enterpriseglue-deps` skill in
`plugins/enterpriseglue-dev-workflows`; lifecycle, approval and package-version
rules apply to this legacy entrypoint too.

1. Resolve the active repository and isolated worktree; preserve user changes.
   Do not switch or update the primary checkout to start dependency work.
2. Use the repository's declared package manager and supported Node runtime.
   For this pnpm workspace, inspect `pnpm-lock.yaml`, manifests, workspace
   overrides and relevant scanner/advisory evidence before editing.
3. Produce installed/target/minimum-fixed versions and compatibility risks.
   Inspect application and frozen bootstrap/predecessor dependencies separately.
   Major changes require explicit per-package or named-group approval. Do not
   assume an update-all request authorizes every major upgrade.
4. Apply the scoped manifest/override changes, regenerate the lockfile with
   pnpm, and adapt callers. Do not use broad `@latest`, `npm audit fix --force`
   or destructive checkout/reset commands as a repair.
5. Run focused affected checks while developing; at the frozen milestone run
   the relevant local gate, published-package version discipline and exact
   image security checks. Include affected published consumers and release notes.
   A patched lockfile does not repair an unchanged pinned bootstrap image.
6. Stop on resolution or required-check failure, explain it and repair within
   scope or request direction. Do not offer to ship anyway. Revert only this
   task's edits with an explicit scoped patch when authorized.
7. Review the combined diff and use `enterpriseglue-ship` for one coherent ready
   PR. Publication and staging deployment require their own qualified evidence;
   never lower security thresholds or add suppressions just to pass.
