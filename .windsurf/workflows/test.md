---
description: Select focused development checks and the relevant acceptance milestone
---

# /test — Local verification

Use the maintained `enterpriseglue-test` skill in
`plugins/enterpriseglue-dev-workflows`. Resolve the active worktree, lifecycle,
declared package manager and supported runtime before selecting commands.

- Inspect the working tree and branch diff against the fetched base, not a
  presumed local `main`. Preserve unrelated edits and reuse applicable evidence.
- During development run focused affected tests and typechecks. For runtime or
  persistence changes include the deployment's primary database integration
  lane. At the frozen milestone run the full relevant acceptance gate once.
- CI-only changes still need classifier fixtures, workflow contracts and the
  aggregate guard (`pnpm run test:ci-change-detection` and
  `pnpm run test:ci-contracts`). Documentation needs the publication guard;
  versioned skills need `pnpm run test:codex-plugin`. CI/docs is not an automatic
  testing exemption.
- Use scripts in the current package manifests, for example
  `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run test:integration` or
  `pnpm run test:e2e:smoke`. Verify prerequisites and isolated stack identity
  before Docker/database/browser tests. Do not alter unrelated local services.
- Keep physical database portability, real engine execution, image acceptance,
  browser behavior and live staging signup as distinct evidence. Unit mocks and
  screenshots cannot substitute for these checks.
- Record exact revision, command, runtime, counts, skips and unavailable lanes.
  Never ship a known required failure or assume that local success guarantees
  hosted CI, publication or deployment.
