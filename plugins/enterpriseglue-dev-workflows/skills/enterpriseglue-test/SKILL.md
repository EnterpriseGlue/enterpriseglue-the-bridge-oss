---
name: enterpriseglue-test
description: Use when the user says /test, test this EnterpriseGlue branch, run local tests, run quick/verify/integration/e2e checks, or choose an appropriate EnterpriseGlue verification level.
---

# EnterpriseGlue /test

1. Resolve the repository root and active worktree. Read
   `.windsurf/workflows/test.md` from that repository when present.
2. Select the smallest sufficient level unless the user explicitly requests a
   complete gate. Use these domain routes before generic test commands:
   - release contribution: `pnpm run release-notes:preflight`;
   - SSO, authorization, engine modes, tenants, or grants:
     `enterpriseglue-access-governance-verify`;
   - screenshots, accessibility, or browser presentation:
     `enterpriseglue-ui-evidence`;
   - OpenAPI, JSON configuration, TypeORM, or documentation parity:
     `enterpriseglue-contract-parity`;
   - migration portability: `pnpm run test:engine-tenancy:database-matrix`.
3. Check PostgreSQL, Docker, browsers, and local stack readiness before the
   lanes that require them. Preserve existing services and evidence.
4. Run commands with the active worktree as explicit working directory. Record
   exact commands, versions, counts, failures, skipped lanes, and artifacts.
5. In EE, include the applicable plugin API guard. Do not treat an advisory or
   emulator lane as production evidence.
