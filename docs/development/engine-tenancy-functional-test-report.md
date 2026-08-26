# Engine Tenancy Functional Test Report

Summary: Local automated and live-stack evidence for centralized and
decentralized engine tenancy and fine-grained access control, with remaining
release-qualification gates stated explicitly.

Audience: Developers, security reviewers, operators, and release managers.

## Result

Status: **Implementation and maintained local qualification are complete. The
generated exact-commit release-evidence index is the authority for whether the
current candidate is `pending_approval`, qualified, stale, dirty, or failed.**

The guarded Docker-hosted PostgreSQL/Chromium enforcement journey passes. The
fine-grained access browser matrix also passes twelve tests in each of Chromium,
Firefox, and WebKit: 36 browser executions covering login, Effective Access,
direct/group/runtime custom-role scope, expiry, revocation, direct URL,
stale/multi-tab state, refresh, and browser-history restoration.

The engine-tenancy database matrix passes PostgreSQL 18.6, MySQL 8.4.11, SQL
Server 16.0.4265.3, Oracle 21.0.0.0.0, and Spanner emulator 1.5.30. All 35
adapter/stage cells and 30/30 adapter/upgrade-baseline observations pass.
Clean install and all six upgrade paths converge on one logical-schema
fingerprint:
`557af8218b01e8cc151441bba47182b5ec00b442643e25894195da30f915c969`.

The real-service provisioning suite now passes Journeys 1–14, including all
three required channels of Journeys 7–14: fourteen of fourteen journeys and
thirty of thirty required channel executions. It covers the manual UI, a least-privilege
external API client, and authoritative configuration bundles against the same
local HTTP service, PostgreSQL database, authorization evaluator, and
Camunda-compatible Docker endpoint. The provisioning artifact is complete only
when the same 14 journeys and 30 channel executions are retained from one clean
commit.

The version-2 machine-readable manifest provides 100% traceability for its 79
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
| Databases | PostgreSQL, MySQL, SQL Server, Oracle, and Spanner disposable qualification targets; PostgreSQL for the live HTTP/browser stack |
| Frontend | Local TLS endpoint |
| Backend | Local readiness and metrics endpoints |
| Browser | Chromium for topology enforcement; Chromium, Firefox, and WebKit for the 36-execution fine-grained access matrix |
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
the complete constraint-derived authorization state space, and the targeted
mutation guard. The state-space generator classifies 105,840 compressed cells,
executes 52,560 applicable behavior cells plus 326 canonical structural cells,
retains 12 invalidity witnesses, and proves 53,295,840 behavior-preserving
action/observation expansions with zero gaps. The latest local mutation
execution killed all nine mutants, including all five mandatory tenancy fault
classes.

The authoritative list is
`test/authz/engine-tenancy-functional-coverage.json`. The commands and exact
meaning of 100% functional coverage are documented in
[Test Engine Tenancy and Fine-Grained Access Control](./testing-engine-tenancy-and-access-control.md).

### Release-candidate verification

| Lane | Passing test executions |
| --- | ---: |
| Foundation | 45 |
| Provisioning | 118 |
| Mappings and configuration ownership | 250 |
| Authorization and custom roles | 326 |
| Runtime enforcement | 354 |
| Classification and transitions | 152 |
| Operational metrics | 45 |
| Documentation and traceability | 43 |
| **Focused-lane total** | **1,333** |
| PostgreSQL custom-role/model/machine-principal tests | **7** |
| Live browser enforcement | **1** |
| Fine-grained access browser matrix | **36** |
| Real-service provisioning channel executions | **30** |
| Database lifecycle stage cells | **35** |
| Database upgrade-baseline observations | **30** |
| Equivalent logical-schema fingerprints | **1** |

The shared package build and backend/frontend type checks also passed. The
targeted provisioning, mapping, tenant-role policy, classification/transition,
request authorization, runtime filtering, and metrics modules each reported
100% statements, branches, functions, and lines.

### Mirrored Camunda 7/Operaton backstop verification

`pnpm run test:engine-backstop` is the focused local release lane for the
implemented `mirrored_engine_backstop` mode. It covers portable persistence,
encrypted write-only native-group mappings, exact projection classification,
hash-bound preview/apply/rollback/drift receipts, the runtime-mode success
gate, API authorization and redaction, config-bundle secret-reference
preflight/diff/apply/export, and the guarded Mission Control workflow. The UI
test proves the customer-sidecar controls remain available without exposing a
downstream credential, and that the manual native group ID is cleared after
write and never displayed in a receipt. `pnpm run test:operaton-sidecar-backstop-container` adds a disposable real-Operaton
contract: preview, apply, tracked-ID drift, and ownership-only rollback pass
through a bounded local customer-sidecar proxy while asserting no downstream
engine credential is sent to that proxy. The same fixture proves a sidecar
native-write rejection, malformed success response, and timeout fail closed
without a direct-engine fallback. `pnpm run test:operaton-native-auth-container`
adds real direct Operaton member/non-member enforcement for exact process and
decision grants. `pnpm run test:operaton-backstop-browser` restarts the local
backend after direct apply before drift detection, while
`pnpm run test:operaton-config-backstop-browser` proves a headless JSON bundle
can provision a dedicated Operaton engine, opaque backstop mapping, runtime
resource grants, and the corresponding native read grants end to end.

This local lane does not replace direct-identity-provider certification: that
release gate needs representative direct Camunda 7 and Operaton environments where a real
user has meaningful native group membership, plus retained Effective Access
and direct-engine allow/deny evidence.

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

- external omission of tenancy is rejected before engine state is read or written;
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

The dedicated provisioning companion journeys additionally prove manual UI
create/update/remove, least-privilege external API idempotency and
decommissioning, and configuration preview/apply/export/reapply/removal.
The shared companion journeys prove two-tenant UI mapping and deletion,
external mapping preview/apply and decommissioning, and config-owned
export/reapply/authoritative removal.
Journey 7 repeats runtime-resource resolution through all three channels:
dedicated resources inherit their engine tenant, unresolved shared resources
remain quarantined, and two explicit runtime-tenant mappings make the shared
inventory ready without widening generic runtime engine discovery.
Journey 8 repeats the principal/role matrix on each channel-provisioned shared
engine: direct users, groups, API clients, and service accounts are persisted
through canonical assignments; both predefined and custom engine roles are
covered; and the live Effective Access evaluator proves direct and
group-derived sources.
Journey 9 proves the exact source, tenant, mapping ID/version, and expiry
lineage for an allowed mapped runtime resource, then proves an expired
replacement assignment yields a denial with no active sources.

## Defects Found and Fixed

`TEN-API-013`: PostgreSQL returns persisted `bigint` timestamps as strings.
The runtime-resource response schema now accepts the persisted representation
and emits the numeric public contract. A route test proves the normalization.

`TEN-API-014`: manual engine deletion previously left runtime inventory,
tenant mappings, materializations, and runtime-scoped assignments behind.
Deletion now removes the complete dependent tenancy graph transactionally, and
the route test asserts every affected repository call, engine-last ordering,
and rollback on an injected mid-delete failure. Physical deletion is rejected
for every engine with a backstop mapping, run, or task so ownership evidence
cannot be erased. Portal, external, and configuration decommission paths are
rejected before mutation while a backstop task or durable owned/pending-native
journal remains; once retired, decommission preserves run/task evidence and
deactivates mappings.

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

Scoped role-assignment routes had the same omitted-context mismatch for
default-tenant runtime resources. They now use the canonical OSS default
tenant for project, engine, tenant, and runtime scopes when middleware has no
tenant, while platform assignments remain tenant-neutral. The live Journey 9
test proves the route can create and evaluate a default-tenant runtime
assignment.

Runtime-assignment guidance also incorrectly warned that a direct engine role
already granted the same runtime permission on a shared engine. Shared
topology intentionally disables that inheritance. The warning service now
checks topology and emits no broad-grant warning for shared engines; a
dedicated resource-aware engine retains the warning.

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

The five-adapter qualification exposed and fixed portability defects that
contract-only checks could not:

- a completely empty database could replay historical migrations after
  synchronizing the current schema;
- MySQL 8.4 rejected an obsolete authentication flag and large-text defaults;
- SQL Server required bounded Unicode string types and filtered unique indexes
  for nullable keys;
- Oracle required portable numeric types, quoted identifiers, removal of a
  duplicate index, and non-empty storage sentinels for logical empty strings;
- Spanner required native types, explicit migration-history IDs,
  null-filtered nullable uniqueness, and staged nullable/backfill/not-null
  migration operations; and
- runtime-resource resolution and role-assignment indexes had drifted from
  the canonical logical schema.

Adapter and migration tests now retain these constraints, and the live matrix
proves the resulting service behavior rather than only inspecting source.

The clean-commit browser rerun also exposed a real reconciliation race:
automatic metadata discovery and an operator-triggered reconciliation could
both observe a new runtime identity before either insert completed. The unique
constraint correctly selected one row, but the losing request returned a
transient `500`. Inventory observation now refetches and updates the committed
winner while preserving richer receipt lineage. Focused tests cover both this
convergence path and propagation of unrelated database failures.

The completion audit also found that documentation approvals were not durable:
regenerating the automated artifact reset every review to `pending`, while the
release index accepted approval flags without proving reviewer identity,
approval commit, time, or retained findings. A guarded approval recorder now
requires clean same-commit automated evidence and an existing sanitized
Markdown review record. The generator preserves only valid same-commit
approvals, and the release gate rejects missing, stale, incomplete, or
unsubstantiated approvals.

The same audit rerun exposed an order-sensitive authorization-test harness:
deployment and data-source one-shot mocks could survive into a neighboring
test, producing contradictory allow/deny results without a production-code
change. The affected suites now reset every shared authorization dependency,
and the retained state-space runner executes the 146 request-authorization
tests in deterministic shuffled order. This makes mock isolation part of the
release evidence instead of relying on source-file order.

A later aggregate source-coverage rerun exposed the equivalent risk in the
engine administration HTTP suite: the large route file could inherit a
one-shot engine service mock when combined with schema files, causing an
incorrect authorization result or a closed test socket. The route setup now
restores the decommission and Engine Set materialization mocks as well as the
other dependencies. Provisioning, mapping, transition, compatibility, and
source-coverage workflows execute all 67 route cases in their own one-worker
process with deterministic shuffled order (`seed 1729`).

The final clean-commit rerun also showed that the real PostgreSQL randomized
authorization model could complete just beyond Vitest's generic five-second
unit-test timeout on a loaded host. That exact integration case now has a
bounded 15-second timeout; the scenario count, assertions, database work, and
cleanup are unchanged. Repeated local executions retain all 24 generated
states rather than reducing the functional denominator to avoid timing load.

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

It writes `browser-matrix.json` only after all 36 executions pass (twelve
tests in each browser, including variable metadata redaction, value
disclosure, and permitted edit round-trips).

Run the disposable five-database qualification from a clean commit with:

```bash
pnpm run test:engine-tenancy:database-matrix
```

It writes `database-matrix.json` only as release-qualified when all five
targets, all 35 stage cells, all 25 baseline observations, and one equivalent
logical schema pass. See
[Qualify Engine Tenancy on Every Supported Database](./engine-tenancy-database-qualification.md)
for prerequisites, focused diagnosis, cleanup, and rollback conditions.

Generate the fail-closed evidence summary with:

```bash
pnpm run test:engine-tenancy:evidence-index
```

The generated JSON and Markdown index accepts only passing artifacts from the
same clean commit. The final
`pnpm run test:engine-tenancy:release-evidence` command exits non-zero while
any required gate is missing, stale, dirty, or failed.

The index distinguishes a clean automated documentation baseline awaiting
independent sign-off as `pending_approval`; it does not call that artifact
stale or dirty. This more precise handoff status remains release-blocking.

Pull requests run the same `test:engine-tenancy:enforcement` journey against
disposable PostgreSQL/browser services. CI retains the result directory for
14 days for every browser lane.

## Acceptance and Compatibility Follow-up

For each candidate, regenerate the local PostgreSQL/Chromium topology slice,
three-browser fine-grained session/accessibility slice, five-adapter database
slice, and exact-commit release-evidence index. Engineering, security, and
independent-operator reviews are retained against that same candidate, with
each reviewer recorded as `human` or `delegated-agent`. Historical artifacts
from another commit are traceability only and never approve a new candidate.

The external provisioning compatibility window is closed. Omitted tenancy is
rejected with HTTP 400 before persistence, and no warning, counter, or default
branch remains. The first-party UI and JSON/API examples always submit an
explicit dedicated or shared declaration.

None of these open gates permits null tenant state to authorize an existing
engine or an unresolved shared resource. The machine-readable functional
coverage manifest and retained release evidence index are the authoritative
executable completion contract.

`TEN-DOCS-006`: this report, its links, and its documentation-index entry are
validated by the documentation contract lane.
