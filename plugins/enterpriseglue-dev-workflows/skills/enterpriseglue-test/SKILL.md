---
name: enterpriseglue-test
description: Use when the user says /test, test this EnterpriseGlue branch, run local tests, run quick/verify/integration/e2e checks, or choose an appropriate EnterpriseGlue verification level.
---

# EnterpriseGlue /test

## Local-first verification cadence

During development, use targeted tests and affected checks for one coherent
capability. Cover its relevant UI, API, service, persistence and operational
workflow together. Run the full relevant local gate once at the frozen,
ready-PR or candidate milestone, using supported runtimes and CI commands.
Inspect aggregate scripts and avoid repeating checks they already cover.

Reuse passing evidence while source, dependencies, configuration and environment
remain applicable. A new turn, skill invocation or handoff does not require
another full run. Later edits require affected checks and the full gate when
impact warrants; never present an earlier revision's results as final evidence.

For persistence development, include the deployment's primary database lane
(PostgreSQL for current Cloud SaaS staging). Run required cross-database,
browser, image, security and aggregate acceptance at the frozen milestone;
PostgreSQL-only feedback does not establish portability. Run a particular lane
earlier when its platform or harness is directly affected. Record checks that
cannot run locally and complete them in required protected CI or authorized
staging; never weaken assertions or push known failures to save a local run.

1. Read `../../references/repository-lifecycle.json` before selecting the test
   target. Exclude retired repositories unless the user explicitly requests a
   read-only historical assessment; do not repair or modernize them.
2. Resolve the repository root and active worktree. Read
   `.windsurf/workflows/test.md` from that repository when present.
3. Select the smallest sufficient level unless the user explicitly requests a
   complete gate. Use these domain routes before generic test commands:
   - release contribution: `pnpm run release-notes:preflight`;
   - SSO, authorization, engine modes, tenants, or grants:
     `enterpriseglue-access-governance-verify`;
   - screenshots, accessibility, or browser presentation:
     `enterpriseglue-ui-evidence`;
   - backend HTTP routes (including public/bootstrap, auth-only and tenant
     variants), OpenAPI, public schemas, JSON configuration, TypeORM, or
     documentation parity:
     `enterpriseglue-contract-parity`;
   - persistence development: affected adapter checks and the primary database;
   - final migration portability: `pnpm run test:engine-tenancy:database-matrix`
     once the persistence contract is frozen for the ready PR or candidate.
4. Check PostgreSQL, Docker, browsers, ports, worktree-local environment, and
   stack identity before lanes that require them. Preserve existing services
   and evidence; do not reuse another worktree's Compose identity as test
   evidence.
5. Run commands with the active worktree as explicit working directory. Record
   exact commands, versions, counts, failures, skipped lanes, and artifacts.
6. In an owning plugin repository, include its OSS plugin API and supported
   host-version compatibility guards. Do not treat an advisory or emulator
   lane as production evidence.
7. For OSS routing or release-control changes, run `pnpm run test:ci-contracts`
   and `pnpm run test:ci-change-detection`. Verify selected lanes cannot be
   skipped by the stable aggregate. For Mission Control browser evidence, fail
   on unexpected console warnings/errors, page errors, failed requests, HTTP
   4xx/5xx responses, and visible error boundaries. For package release
   changes, pack the built five plugin/API and three host packages and verify
   dependency references plus exported entry points from the tarballs.
8. Treat the five-database candidate aggregate and pinned real-Operaton browser
   journey as distinct evidence. Static adapter tests do not replace physical
   database qualification, and a mock engine does not replace the required
   supported Operaton backstop. The scheduled moving-Operaton lane is an early
   compatibility warning and does not replace the pinned release gate.
