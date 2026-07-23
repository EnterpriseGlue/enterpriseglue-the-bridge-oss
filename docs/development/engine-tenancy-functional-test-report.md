# Engine Tenancy Functional Test Report

Summary: Local automated and live-stack evidence for centralized and
decentralized engine tenancy and fine-grained access control, with remaining
release-qualification gates stated explicitly.

Audience: Developers, security reviewers, operators, and release managers.

## Result

Status: **Implemented and passing for the completed local qualification
slices on 24 July 2026; full release qualification remains incomplete.**

The guarded Docker-hosted PostgreSQL/Chromium enforcement journey passes. The
fine-grained access browser matrix also passes nine tests in each of Chromium,
Firefox, and WebKit: 27 browser executions covering login, Effective Access,
direct/group/runtime custom-role scope, expiry, revocation, direct URL,
stale/multi-tab state, refresh, and browser-history restoration.

The version-2 machine-readable manifest provides 100% traceability for its 78
registered engine-tenancy requirements: every requirement has an exact
automated test, expected outcome, Markdown reference, executable CI lane,
explicit coverage dimensions, and retained evidence location. It also
inventories 16 public operations, 11 stable errors, four valid transition
classes, one invalid transition class, five required security fault classes,
five declared database targets, and three declared browser targets, with zero
waivers.

This is functional-requirement traceability, not a claim that every unrelated
monorepo line is executed or that every declared target has passed. The
manifest evidence is explicitly `traceability-only`; database and browser
targets become verified only through separate passing artifacts for the same
commit. Security-critical pure modules are separately held to 100% statements,
branches, functions, and lines.

The live enforcement journey is `TEN-MIGRATION-008` and `TEN-RUNTIME-007`.
It uses disposable local identities and engines to prove migration,
decentralized defaults, centralized fail-closed mapping, reconciliation,
readiness metrics, and cleanup through the real browser and HTTP stack.

## Environment

| Item | Evidence |
| --- | --- |
| Deployment | Local Docker stack |
| Database | PostgreSQL, schema migrations through `0097` |
| Frontend | Local TLS endpoint |
| Backend | Local readiness and metrics endpoints |
| Browser | Chromium for topology enforcement; Chromium, Firefox, and WebKit for the 27-execution fine-grained access matrix |
| Identity | Disposable canonical local platform administrator |
| Engine transport | Local Camunda-compatible test endpoint |
| Customer or deployed IdP data | None |

The TLS certificate and test credentials are disposable local state. They are
not committed or retained in the evidence bundle.

## Automated Coverage

The focused lanes cover:

- canonical schemas, portable migrations, adapter registration, OpenAPI, and
  response serialization;
- dedicated and shared provisioning through manual, external, and
  configuration channels;
- mapping create/update/disable, ownership, versioning, reconciliation, and
  fail-closed runtime inventory;
- every predefined role and canonical permission in the focused classifier
  contracts, plus database-backed custom-role compositions for users,
  group-derived users, API clients, and service accounts;
- tenant, project, engine, Engine Set, every registered runtime-resource type,
  and Runtime Resource Set boundaries;
- Mission Control collections, details, referenced details, starts,
  evaluations, deployments, batches, migrations, jobs, tasks, incidents, and
  history;
- classification, every supported topology transition, preview expiry/stale
  protection, acknowledgements, optimistic concurrency, rollback behavior,
  audits, and materialization invalidation;
- bounded identifier-free operational metrics and persistence-failure
  behavior; and
- user, operator, API, data-model, migration, compatibility, release, and
  developer documentation contracts.

The pull-request authorization gate also executes the database-backed custom
role and randomized direct/group matrix, API-client/service-account parity,
the canonical authorization state-space foundation, and the targeted mutation
guard. The foundation is deliberately marked non-release-eligible until its
remaining generated execution obligations are closed. The latest local
mutation execution killed all nine mutants, including all five mandatory
tenancy fault classes.

The authoritative list is
`test/authz/engine-tenancy-functional-coverage.json`. The commands and exact
meaning of 100% functional coverage are documented in
[Test Engine Tenancy and Fine-Grained Access Control](./testing-engine-tenancy-and-access-control.md).

### Release-candidate verification

| Lane | Passing test executions |
| --- | ---: |
| Foundation | 45 |
| Provisioning | 117 |
| Mappings and configuration ownership | 248 |
| Authorization and custom roles | 327 |
| Runtime enforcement | 348 |
| Classification and transitions | 151 |
| Operational metrics | 46 |
| Documentation and traceability | 52 |
| **Focused-lane total** | **1,334** |
| PostgreSQL custom-role/model/machine-principal tests | **7** |
| Live browser enforcement | **1** |
| Fine-grained access browser matrix | **27** |

The shared package build and backend/frontend type checks also passed. The
targeted provisioning, mapping, tenant-role policy, classification/transition,
request authorization, runtime filtering, and metrics modules each reported
100% statements, branches, functions, and lines.

Non-failing output was limited to Node explaining that `FORCE_COLOR` overrides
`NO_COLOR` in the Playwright worker and mocked authorization tests recording
their deliberate static-catalog fallback. Neither warning changes behavior or
coverage.

## Live Installation Evidence

The representative installation begins with explicit, ready engines and
tenant-resolved active runtime inventory. Global browser setup then creates
one disposable legacy-shaped engine with dedicated topology, null ownership,
and `migration_required`. This guarantees that every evidence run executes
the migration path rather than passing vacuously; it does not depend on an
environment-specific retained row count.

The guarded apply:

1. observed the disposable engine as `ready_for_apply`;
2. denied treating null ownership as default-tenant engine access;
3. used `platform:engine-registration:manage` only on its quarantined
   preview/apply routes;
4. submitted the exact preview hash, expiry, and every server-returned
   acknowledgement; and
5. classified exactly that owned fixture without changing another proposal or
   creating an engine-scoped assignment.

The browser journey then proved:

- omitted tenancy creates a dedicated `tenant-default` engine in ready state;
- shared plus `engine_wide` is rejected;
- a shared resource-aware engine starts incomplete;
- reconciliation without a mapping reports unmapped inventory and exposes
  zero resources;
- a versioned default-tenant mapping plus reconciliation changes the engine to
  ready and makes mapped resources visible;
- the in-test classification report has zero review or conflict rows and shows
  the owned migration fixture as classified;
- tenancy metric collection succeeds;
- active runtime resources report zero unmapped, conflicting, stale, or
  unknown rows; and
- global teardown removes the disposable users, engines, mappings,
  assignments, and tenancy inventory.

## Defects Found and Fixed

`TEN-API-013`: PostgreSQL returns persisted `bigint` timestamps as strings.
The runtime-resource response schema now accepts the persisted representation
and emits the numeric public contract. A route test proves the normalization.

`TEN-API-014`: manual engine deletion previously left runtime inventory,
tenant mappings, materializations, and runtime-scoped assignments behind.
Deletion now removes the complete dependent tenancy graph transactionally, and
the route test asserts every affected repository call.

`TEN-AUTHZ-008`: generic null-tenant visibility could make an unowned dedicated
engine look platform-wide or default-tenant. Engine lookup, collection,
invitation, assignment, Effective Access, and runtime guards now distinguish
shared topology from missing dedicated ownership. The only exception is
platform-authorized preview/apply while the engine is explicitly
`migration_required`. The request middleware reports 100% statement, branch,
function, and line coverage for this boundary.

`TEN-AUTHZ-009` through `TEN-AUTHZ-012`: the same boundary now governs user
engine discovery, platform and tenant Engine Set selectors, project access
responses, pending access, and project-engine target creation. Explicitly
owned dedicated engines remain available in their tenant and in authorized
platform-wide administration; shared engines remain connection candidates.
Null-owned dedicated rows are absent, and stale legacy access rows cannot
restore them.

The public authorization routes initially evaluated an omitted tenant as
`null`, even while local runtime and engine lookup correctly resolved the
canonical default tenant. This denied valid Effective Access and omitted
tenant-owned group engines. Evaluation now uses the effective default tenant
while the browser snapshot remains bound to the raw session tenant contract.
Route tests and the live browser journeys cover both sides.

The initial active-session test covered only a single Chromium page. It now
proves a new authorization version and no stale grant in two simultaneous
tabs, after refresh, through direct navigation, and after back/forward history
restoration in Chromium, Firefox, and WebKit.

Two release-evidence defects were also corrected. The local migration journey
now applies only its single owned fixture instead of every proposal in a
reused database, and database test fixtures persist a valid dedicated/ready
state. Playwright now clears only `test/results/playwright`, so it cannot erase
manifest, mutation, browser, or release-index artifacts produced by another
lane.

## Reproduce and Retain Evidence

With the local Docker deployment healthy:

```bash
ENGINE_TENANCY_APPLY_READY=true pnpm run test:engine-tenancy:local-evidence
```

The runner refuses non-local browser and API URLs, verifies the local CA and
backend readiness, loads the local Docker database settings without printing
secrets, uses one worker, and applies only its owned migration fixture.
Playwright retains:

- a transient `engine-tenancy-local-evidence.json` under
  `test/results/playwright`, containing aggregate totals, disposable test IDs,
  sanitized diagnostics, and assertion results;
- `engine-tenancy-dashboard.png`, a browser screenshot of the disposable
  test session; and
- stable `requirement-evidence.json` and `local-enforcement.json` under
  `test/results/engine-tenancy-release`.

Run the retained three-browser matrix with:

```bash
pnpm run test:authz:local-smoke:cross-browser
```

It writes `browser-matrix.json` only after all 27 executions pass.

Generate the fail-closed evidence summary with:

```bash
pnpm run test:engine-tenancy:evidence-index
```

The generated JSON and Markdown index accepts only passing artifacts from the
same clean commit. The final
`pnpm run test:engine-tenancy:release-evidence` command exits non-zero while
any required gate is missing, stale, dirty, or failed.

Pull requests run the same `test:engine-tenancy:enforcement` journey against
disposable PostgreSQL/browser services. CI retains the result directory for
14 days for every browser lane.

## Acceptance and Remaining Release Gates

The implementation and automated evidence close the local
PostgreSQL/Chromium topology-enforcement slice and the three-browser
fine-grained session-state slice. They do not yet close full cross-platform
release qualification. The remaining gates are:

- generate and execute the complete constraint-derived authorization
  state-space, including every supported behavior cell and every named
  invalidity witness, with zero unknown, missing, skipped, quarantined, or
  unexpected cells;
- retain clean-install, every supported upgrade-baseline, interrupted-retry,
  schema-equivalence, service, rollback, and cleanup results for PostgreSQL,
  MySQL, SQL Server, Oracle, and Spanner;
- complete error-announcement, contrast, 200% zoom/reflow, and reduced-motion
  evidence for all new browser workflows;
- execute all supported UI, external API, and configuration provisioning
  journeys against persistent local services and record stable errors for
  unsupported combinations;
- populate every required slot in the implemented release evidence index with
  passing same-clean-commit artifacts;
- obtain engineering, security, and independent-operator sign-off on the
  [documentation review checklist](./engine-tenancy-documentation-review-checklist.md);
  and
- retain omitted-tenancy compatibility until its published external API
  deprecation window formally closes.

None of these open gates permits null tenant state to authorize an existing
engine or an unresolved shared resource. Phase 9 of the
[implementation plan](../architecture/12-engine-tenancy-and-external-provisioning-plan.md)
is the authoritative executable completion checklist.

`TEN-DOCS-006`: this report, its links, and its documentation-index entry are
validated by the documentation contract lane.
