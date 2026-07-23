# Engine Tenancy Functional Test Report

Summary: Complete automated and live-stack evidence for centralized and
decentralized engine tenancy and fine-grained access control.

Audience: Developers, security reviewers, operators, and release managers.

## Result

Status: **Passed locally on 23 July 2026** against the Docker-hosted PostgreSQL
installation and Chromium.

The machine-readable manifest provides 100% traceability for the implemented
engine-tenancy requirements: every requirement has an exact automated test,
expected outcome, Markdown reference, and CI lane. Security-critical pure
modules are separately held to 100% statements, branches, functions, and
lines. This is functional-requirement coverage, not a claim that every
unrelated monorepo line is executed.

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
| Browser | Playwright Chromium |
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
- every predefined role, every canonical permission, custom-role
  compositions, users, group-derived users, API clients, and service accounts;
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
| Authorization and custom roles | 260 |
| Runtime enforcement | 339 |
| Classification and transitions | 150 |
| Operational metrics | 46 |
| Documentation and traceability | 43 |
| **Focused-lane total** | **1,248** |
| Live browser enforcement | **1** |

The shared package build and backend/frontend type checks also passed. The
targeted provisioning, mapping, tenant-role policy, classification/transition,
request authorization, runtime filtering, and metrics modules each reported
100% statements, branches, functions, and lines.

Non-failing output was limited to Node explaining that `FORCE_COLOR` overrides
`NO_COLOR` in the Playwright worker and mocked authorization tests recording
their deliberate static-catalog fallback. Neither warning changes behavior or
coverage.

## Live Installation Evidence

The persistent representative installation began with 74 engines:

- 73 were explicit and ready;
- one legacy engine required safe default-tenant classification;
- no engine required manual topology review and none was in conflict; and
- existing active runtime inventory was tenant-resolved.

The guarded apply:

1. granted the disposable operator `engine:edit` only on the ready row;
2. previewed the exact proposed dedicated topology;
3. submitted every server-returned acknowledgement;
4. applied the version-guarded transition; and
5. removed the temporary assignment in a `finally` cleanup path.

The browser journey then proved:

- omitted tenancy creates a dedicated `tenant-default` engine in ready state;
- shared plus `engine_wide` is rejected;
- a shared resource-aware engine starts incomplete;
- reconciliation without a mapping reports unmapped inventory and exposes
  zero resources;
- a versioned default-tenant mapping plus reconciliation changes the engine to
  ready and makes mapped resources visible;
- the in-test classification report has all 83 engines classified (the 74
  persistent rows, seven global fixtures, and two journey engines), with zero
  ready-for-apply, review, or conflict rows;
- tenancy metric collection succeeds;
- all 72 retained runtime resources are resolved, with zero unmapped,
  conflicting, stale, or unknown resources; and
- global teardown returns the persistent installation to 74 of 74 classified
  engines, with no disposable users, engines, mappings, assignments, or
  orphaned tenancy inventory.

## Defects Found and Fixed

`TEN-API-013`: PostgreSQL returns persisted `bigint` timestamps as strings.
The runtime-resource response schema now accepts the persisted representation
and emits the numeric public contract. A route test proves the normalization.

`TEN-API-014`: manual engine deletion previously left runtime inventory,
tenant mappings, materializations, and runtime-scoped assignments behind.
Deletion now removes the complete dependent tenancy graph transactionally, and
the route test asserts every affected repository call.

The live database also contained historical orphan inventory created before
that lifecycle fix. The local evidence run removed those orphan rows and
verified all orphan counts are zero.

## Reproduce and Retain Evidence

With the local Docker deployment healthy:

```bash
ENGINE_TENANCY_APPLY_READY=true pnpm run test:engine-tenancy:local-evidence
```

The runner refuses non-local browser and API URLs, verifies the local CA and
backend readiness, loads the local Docker database settings without printing
secrets, and uses one worker. Playwright retains:

- `engine-tenancy-local-evidence.json`, containing only aggregate totals,
  disposable test IDs, sanitized diagnostics, and assertion results; and
- `engine-tenancy-dashboard.png`, a browser screenshot of the disposable
  test session.

Pull requests run the same `test:engine-tenancy:enforcement` journey against
disposable PostgreSQL/browser services. CI retains the result directory for
14 days for every browser lane.

## Acceptance and Remaining Release Gates

The implementation and automated evidence close the local enforcement work.
Two release-governance gates remain deliberately separate:

- engineering, security, and an independent operator must sign the
  [documentation review checklist](./engine-tenancy-documentation-review-checklist.md);
  and
- omitted tenancy remains accepted until the published external API
  compatibility window is formally closed.

Neither gate permits null tenant state to authorize an existing engine or an
unresolved shared resource.

`TEN-DOCS-006`: this report, its links, and its documentation-index entry are
validated by the documentation contract lane.
