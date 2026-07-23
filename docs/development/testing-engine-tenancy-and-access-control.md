# Test Engine Tenancy and Fine-Grained Access Control

Summary: Reproduce the engine-tenancy contract, provisioning, mapping, and
authorization evidence locally and in CI.

Audience: Developers, reviewers, security engineers, and release operators.

## What “100% Functional Coverage” Means

For engine tenancy, 100% means that every implemented requirement ID in
`test/authz/engine-tenancy-functional-coverage.json` points to:

- a present automated test and exact test name;
- a Markdown page that cites the requirement;
- a CI lane; and
- explicit topology, runtime-access, principal, tenant-relationship, resource,
  provisioning-channel, and outcome dimensions, including an explicit
  `not-applicable` where a dimension does not apply;
- a retained evidence-artifact location; and
- an explicit allow, deny, quarantine, conflict, or compatibility outcome.

Security-critical pure modules are additionally held to 100% statements,
branches, functions, and lines. This is not a claim that every unrelated line
in the monorepo has 100% source coverage.

The version-2 manifest also inventories every public tenancy operation, stable
error code, supported topology transition, supported database/browser target,
and required security mutation fault class. The validator compares that
inventory to OpenAPI, the canonical error enum, the transition policy, and the
normative requirement registry in the architecture plan. A percentage alone
cannot satisfy the gate.

The authorization denominator is constraint-generated, not a blind Cartesian
product and not a manually selected sample. The generator must classify every
canonical permission, action, role, principal, secured resource type, scope,
topology, runtime mode, tenant relationship, assignment/resource state, and
permission source. Supported combinations become executable behavior cells.
Unsupported combinations become named invalidity classes with an executed
rejection witness. Nothing may be silently pruned.

## Required Release-Candidate Evidence

`TEN-AUTHZ-013` runs targeted source mutations and must kill tenant-filter
removal, ownership-check inversion, null-tenant acceptance, mapping-version
check removal, and upstream-call-after-denial. The runner writes a sanitized
machine-readable mutation report under `test/results`.

`TEN-AUTHZ-014` keeps the database-backed direct-user and group-derived-user
custom-role/randomized matrices aligned with resolved engine-tenancy
inventory. `TEN-AUTHZ-015` provides equivalent database-backed project-scope,
expiry, credential-rotation, and revocation evidence for API clients and
service accounts.

`TEN-UI-005` proves that an already authenticated browser session observes
assignment and group-membership revocation immediately in the active tab, a
stale second tab, a direct URL, a refreshed session, and a page restored
through browser history. The guarded local matrix runs nine tests in each of
Chromium, Firefox, and WebKit and writes `browser-matrix.json` only after all
27 executions pass. The separate database-free accessibility runner executes
error announcements, contrast, 200% zoom/reflow, and reduced motion in all
three browsers and retains 12 passing executions in
`browser-accessibility.json`.

`TEN-DOCS-007` writes the validated manifest as sanitized, retained evidence.
It records the commit, clean/dirty state, schema version, Node and pnpm
versions, declared database/browser target lists, requirement and contract
counts, waiver count, and exact test/documentation traceability. It marks
itself as `traceability-only`: a declared target is not recorded as verified
until a separate database or browser result artifact passes for the same
commit. It never reads application credentials or copies runtime secrets into
the artifact.

The release-evidence index combines the individual artifacts without treating
declared targets as executed tests. It accepts an artifact only when its
assertions pass, it names the current commit, and it was produced from a clean
worktree. Generate the current gap report with:

```bash
pnpm run test:engine-tenancy:evidence-index
```

The command writes both
`test/results/engine-tenancy-release/index.json` and a readable
`test/results/engine-tenancy-release/README.md`. The final release gate is:

```bash
pnpm run test:engine-tenancy:release-evidence
```

### Provisioning journey evidence

The canonical denominator for the 14 real-service journeys is
`test/authz/engine-tenancy-provisioning-journeys.json`. Validate the registry
and assemble the current fail-closed result with:

```bash
pnpm run test:engine-tenancy:provisioning-evidence
```

Journey observations belong in
`test/results/engine-tenancy-provisioning-observations/`. An observation counts
only when it names the exact commit, is qualified from a clean source state,
passes every assertion declared by the registry, and proves the real local
HTTP service, persistent database, and authorization evaluator. The
`manual-ui` channel must additionally prove the user interface. Missing,
duplicate, stale, partial, mocked-service, or database-free observations keep
`provisioning-journeys.json` incomplete.

Journeys 1–6 are channel-specific companion lifecycles. Journeys 7–14 are
cross-cutting and must execute through manual UI, external API, and
configuration-bundle provisioning. This distinction is encoded in the
registry, rather than inferred by the evidence writer.

Run the currently implemented real localhost journeys with:

```bash
pnpm run test:engine-tenancy:provisioning-journeys:local
```

The runner refuses non-local URLs and dirty tracked source, seeds only the
disposable local PostgreSQL database, executes Chromium against the Docker
frontend/backend, and then assembles the registry artifact. Journey 1 proves
create, inspect, update, reconciliation, persisted state, and removal through
the manual UI and authenticated HTTP service. Journey 2 proves the matching
external API lifecycle described below. Journey 3 proves the dedicated
configuration-bundle round trip. Journeys 4–6 prove the matching shared-engine
lifecycle through the manual UI, external API, and configuration bundle.
Journey 7 proves runtime-resource tenant resolution through all three required
channels. Journey 8 proves direct-user, group-derived-user, API-client, and
service-account assignments with both predefined and custom engine roles
against each channel-provisioned shared engine. The implemented denominator is
extended by Journey 9's Effective Access source, tenant-lineage, real expiry,
and exact mapping-version checks. Journey 10 then exercises filtered and denied
process-definition, process-instance, preview-count, mutation, batch, job, task,
incident, history, and deployment-history paths. Its request ledger proves an
inventoried but unauthorized sibling definition is denied before the matching
Camunda detail request is sent. Journey 11 preserves an already-authenticated
browser page and a separate
cookie-authenticated HTTP request context. It proves both receive immediate
`403` responses after role-assignment revocation, regain only the exact
restored grant, lose access again when the source-owned runtime-tenant mapping
is deactivated through the current provisioning channel, and regain access
only after that mapping is restored and inventory is reconciled. The
implemented denominator is therefore eleven of fourteen journeys and
twenty-one of thirty required channel executions. Journeys 12–14 stay
explicitly missing until their matching real-service tests
are implemented and qualified on the same clean commit.

The Journey 10 fixture exposes a localhost-only mock control endpoint. The
runner resets its request ledger immediately before the denied detail request
and reads the ledger afterward. Health and control requests are excluded from
the ledger. This is transport evidence for the exact denied resource path, not
an assertion that unrelated, concurrent dashboard polling never occurs.

Journey 2 creates a reveal-once disposable API client, first proves the
machine principal is denied without its registrar role, then executes create,
same-payload retry, update, persisted inspection, and decommission using an
isolated bearer-token request context with no administrator cookies. The
local teardown removes its revoked API-client row and decommissioned
`e2e-*` engine inventory after the assertions complete.

Journey 3 uses the authenticated configuration-bundle API against the same
local backend and PostgreSQL database. It previews and diffs one authoritative
dedicated-engine bundle, applies the exact canonical hash, exports the
server-owned representation, previews and reapplies that export as a no-op,
then previews and applies an acknowledged authoritative removal. The test
requires the engine ID to remain stable across export/reapply and verifies that
the removed engine disappears from the subsequent export. Teardown removes
the disposable config-owned engine, apply runs, reconciliation tasks, and
config-bundle audits. This human-administrator journey proves the
configuration channel contract; it does not substitute for the separate
least-privilege CI machine-client journey.

Journeys 4–6 reuse the same two-tenant runtime inventory as Journey 7 but add
their channel-specific lifecycle requirements. Journey 4 applies two mappings
and deletes the shared engine through the UI. Journey 5 previews and applies
the mappings through the least-privilege external client and decommissions the
engine through that same machine API. Journey 6 exports the config-owned
shared engine and both mappings, previews and reapplies the exported bundle as
a no-op with stable IDs, authoritatively archives the engines and mappings,
and proves they disappear from the next export.

Journey 7 begins by proving the shared-engine administration boundary that
makes mapping possible without widening runtime access. The generic
`getAccessibleEngines` client and the default
`GET /engines-api/engines` response remain fail-closed for Mission Control
selectors. Only the Engines administration page calls
`getManageableEngines`, which sends `includeManageableShared=true`; the backend
then requires `engine:edit` on each otherwise unresolved shared engine. The
middleware unit lane covers editor allow, non-editor deny, active-tenant and
no-tenant contexts at literal 100% branch coverage. The route/schema/OpenAPI
lane rejects unrecognized query values, and the Engines page test proves the
management-only client call.

The Journey 7 manual channel creates dedicated and shared engines in the UI,
reconciles the same two-tenant mock inventory, proves dedicated inheritance,
proves that unmapped shared resources remain quarantined, applies two reviewed
mappings in the engine editor, and then proves both runtime tenant segments
resolve to the selected EnterpriseGlue tenant. The external channel uses a
reveal-once least-privilege API client and a public-shaped Docker DNS alias; the
alias resolves only inside the local Compose network, so the external URL
validation contract is exercised without weakening its private-host denylist.

The configuration channel previews, diffs, applies, and idempotently reapplies
an authoritative bundle containing the same dedicated and shared engines. It
resolves an opaque E2E-only secret reference from the backend environment,
proves the unmapped shared quarantine, applies two source-owned mapping rows,
reconciles to `ready`, and authoritatively archives both engines and both
mappings. A canonical, tenant-scoped custom-role assignment is inserted
directly into the disposable PostgreSQL database only as test-fixture setup,
because the journey's subject is configuration provisioning rather than role
assignment. All engine reads, authorization decisions, reconciliation,
mapping, and cleanup still pass through the real HTTP services and canonical
authorization evaluator; the fixture row and disposable role are removed in
teardown.

Journey 8 creates a disposable custom engine role and reveal-once API-client
and service-account credentials for each channel. It assigns the custom role
to a direct user and API client, assigns the predefined Engine Operator role
to a group and service account, verifies all four canonical assignment rows,
and exercises Effective Access for the direct and group-derived users. The
machine credentials remain separate from browser-session authentication; their
HTTP deployment, rotation, expiry, and revocation behavior is covered by the
machine-principal lane and will be repeated in the relevant later journeys.
All Journey 8 assignments, credentials, and roles are removed or archived
before the channel removes its engine.

Journey 9 adds a time-bounded assignment for one mapped shared runtime
resource and evaluates it by its engine/resource/runtime-tenant selector. The
response must identify the exact assignment and custom role, the canonical
default tenant, the mapping ID and version, and `shared` topology. The test
then replaces that assignment with an already-expired assignment and proves
the same selector is denied with no active authorization sources. This also
proves that a shared engine-wide assignment is not treated as runtime-resource
inheritance.

The journey runner succeeds when every currently implemented journey passes,
but keeps the assembled artifact visibly incomplete while any of the 14
journeys or 30 required channel executions is missing. The separate
`test:engine-tenancy:release-evidence` gate fails until traceability, local
enforcement, mutation, three-browser functional, browser-accessibility,
authorization-matrix, five-database, 14-journey/30-channel, source-coverage,
documentation-review, and compatibility-window artifacts all pass for the
same clean commit.

The detailed artifacts are fail-closed as well:

- `browser-accessibility.json` must cover error announcements, contrast,
  200% zoom/reflow, and reduced motion across Chromium, Firefox, and WebKit;
- every database entry in `database-matrix.json` must name its database
  version and schema fingerprint and pass clean install, every upgrade
  baseline, interrupted retry, schema equivalence, service behavior, rollback,
  and cleanup;
- every one of the 14 `provisioning-journeys.json` entries must execute at
  least one supported channel, all 30 required channel executions must pass,
  and every other channel must be accounted for by its declared exclusion;
- `documentation-review.json` must include zero unresolved high-risk findings
  and complete executable-example and Markdown-link results in addition to the
  three approvals; and
- `compatibility-window.json` must prove warning behavior is tested and either
  remains retained with no removal proposed, or was removed only after the
  window closed and replacement documentation shipped.

Generate the retained-warning compatibility artifact with:

```bash
pnpm run test:engine-tenancy:compatibility-evidence
```

This is an executable contract for engine-provisioning omission behavior, not
a claim about deployed SSO providers or customer adoption. It reruns the
provisioning, HTTP response, and OpenAPI warning tests under the local-safe
environment. The artifact passes while the warning is retained and
`removalProposed` is false; removing the fallback requires the separately
documented breaking-release and observation-window evidence.

The full release-qualification backlog, execution order, rollback conditions,
and exit conditions are in phase 9 of
the [centralized/decentralized engine-tenancy implementation plan](../architecture/12-engine-tenancy-and-external-provisioning-plan.md).
Local PostgreSQL and three-browser access evidence must not be used to close
the remaining five-database, clean/upgrade, complete authorization-state-space,
provisioning-journey, accessibility, or independent documentation-review
gates.

## Prerequisites

- the repository-supported Node.js and pnpm versions;
- dependencies installed from the workspace lockfile;
- no production identity-provider or customer credentials;
- PostgreSQL only for integration/browser lanes that explicitly start the local
  service; the focused contract lanes use isolated mocks.

Do not reuse production tenant IDs, URLs, tokens, or secrets in fixtures.

## Focused Lanes

Run the layers in this order:

```bash
pnpm run test:engine-tenancy:foundation
pnpm run test:engine-tenancy:provisioning
pnpm run test:engine-tenancy:mappings
pnpm run test:engine-tenancy:authorization
pnpm run test:engine-tenancy:runtime
pnpm run test:engine-tenancy:transitions
pnpm run test:engine-tenancy:operations
pnpm run test:engine-tenancy:documentation
```

Run the browser enforcement lane against disposable services in CI:

```bash
pnpm run test:engine-tenancy:enforcement
```

For the complete guarded local-Docker journey, use
`test:engine-tenancy:local-evidence` as described below.

The authorization lane:

1. validates the functional-coverage manifest;
2. enforces 100% source coverage on
   `packages/shared/src/authz/tenant-role-policy.ts`;
3. executes tenant-role inheritance, runtime visibility, topology-aware engine
   discovery, Engine Set/project-target boundaries, Starbase project access,
   route, schema, config apply/diff/export, and Effective Access tests; and
4. executes the Access Control tenant-scope UI tests.

The pull-request authorization gate additionally runs the database-backed
direct-user, group-derived-user, API-client, and service-account matrices plus
the targeted mutation guard. Their sanitized result files are retained with
the browser evidence even when a later step fails.

The transition lane:

1. validates the functional-coverage manifest;
2. holds the pure classification and topology-transition policy modules to
   100% statements, branches, functions, and lines;
3. tests every valid transition and equivalent/invalid proposals;
4. tests expiry, stale hashes, missing acknowledgements, optimistic
   concurrency, transaction-side invalidation, source ownership, and audits;
5. proves topology-aware Engine Set rematerialization for platform, owning
   tenant, and all-tenant shared-engine cases; and
6. exercises diagnostics, exact preview acknowledgements, apply, and mapping
   preview/apply in the engine administration UI; and
7. checks routes, action inventory, canonical schemas, and OpenAPI together.

The runtime lane:

1. holds `requireAction.ts` and the Mission Control runtime-resource filter to
   100% statements, branches, functions, and lines;
2. proves broad grants still use resolved same-tenant filtering on shared
   engines;
3. covers collection, exact detail, referenced detail, batch, deployment, and
   migration allow/deny paths;
4. proves missing shared mapping access makes zero engine transport calls;
5. tests tenant-specific process start/decision evaluation and no-tenant
   behavior; and
6. executes the Mission Control route and authorization inventory suites.

The mapping lane holds `EngineTenantMappingService.ts` to 100% statements,
branches, functions, and lines. Its configuration-bundle matrix includes:

- schema defaults, duplicate identities, engine references, and strategy
  mismatch;
- tenant-key resolution and denial;
- create, update, no-op, disable, and authoritative omission;
- manual or foreign ownership conflict and `config_warn` drift;
- transaction-local mapping version and runtime-resource re-resolution;
- bounded follow-up reconciliation scheduling;
- ZIP import, startup tenant-resolver propagation, and OpenAPI file-envelope
  parity; and
- export/preview/diff round-trip with the original stable tenant key.

The operations lane:

1. validates the functional-coverage manifest;
2. holds the process-local fallback counter and aggregate Prometheus exporter
   to 100% statements, branches, functions, and lines;
3. covers every bounded topology, resolution-status, principal-type, and
   declaration label, including unknown and zero-value series;
4. proves only an actual request-context fall-through increments the default
   tenant counter; and
5. proves database collection failure keeps `/metrics` available, reports a
   failure gauge, preserves process-local counters, and never emits engine or
   tenant identifiers.

The documentation lane:

1. validates every tagged JSON example with the production Zod schema;
2. validates every published tenancy curl method/path against OpenAPI and its
   request body with the runtime schema;
3. rejects untagged curl/JSON examples, literal bearer tokens, and credential
   values that are not opaque secret references;
4. checks feature-document links, anchors, and documentation-index entries;
5. verifies the external decommission schema is identical across runtime,
   OpenAPI, and the integration guide; and
6. validates the functional-coverage manifest after documentation changes.

Run package type checks after any contract change:

```bash
pnpm --filter shared run build
pnpm --filter webmodeler-backend run typecheck
pnpm --filter webmodeler-frontend run typecheck
```

After the focused lanes are green, produce a same-clean-commit aggregate for
the security-critical modules:

```bash
pnpm run test:engine-tenancy:source-coverage
```

The runner refuses a dirty worktree, clears inherited database/secret
configuration in favor of `scripts/local-safe-test.env`, executes every
literal per-file 100% coverage lane, verifies the commit did not change, and writes
`test/results/engine-tenancy-release/source-coverage.json`. It covers
provisioning, mapping, tenant-role policy, request/runtime filtering,
classification/transition policy, operational metrics, API-client and
service-account services, the policy service, and API-client middleware. It
does not claim 100% source coverage for unrelated monorepo files.

## Required Authorization State-Space

`TEN-AUTHZ-016` is the fail-closed foundation for this gate. Run it with:

```bash
pnpm run test:authz:state-space-foundation
```

It compares `test/authz/authorization-state-space-contract.json` with the
production principal, resource, permission, role, action-operation, and
action-risk registries; verifies that every named invalidity rule and current
execution family points to a real test; and asserts that the foundation remains
explicitly non-release-eligible. Adding a canonical value without updating the
contract fails this lane. The foundation does not produce or substitute for
the final `authorization-matrix.json`.

Generate the current executable state-space report with:

```bash
pnpm run test:authz:state-space-evidence
```

The runner builds the shared registries, executes the canonical/invalidity
contracts, generated action/route contracts, permission and role contracts,
and the guarded PostgreSQL principal/scope/model matrix. It refuses a dirty
worktree and writes `test/results/engine-tenancy-release/authorization-matrix.json`.
Until all behavioral generation and equivalence obligations below are
implemented, the artifact deliberately reports `status: "incomplete"`,
`releaseCommitQualified: false`, and an exact non-zero `missingCells` count.
Do not hand-edit those fields or treat registry-only coverage as functional
release evidence.

Implement the remaining generated coverage in this order:

1. read dimensions only from production registries and store their hashes and
   counts;
2. classify each tuple with a versioned applicability rule—`supported` or a
   stable invalidity ID and reason;
3. derive the expected decision from a declarative model that does not call the
   production evaluator;
4. execute every supported cell and at least one witness for every invalidity
   class at the correct unit, PostgreSQL integration, HTTP, or browser layer;
5. expand any equivalence-compressed cell back to its represented canonical
   tuples and prove that the rule is behavior-preserving; and
6. retain `authorization-matrix.json` from the exact clean commit.

The artifact is complete only when:

```text
classified canonical values / canonical values = 100%
executed applicable cells / applicable cells = 100%
executed invalidity witnesses / invalidity classes = 100%
covered action, permission, role, resource and dimension values / canonical values = 100%
missing = skipped = quarantined = unknown = unexpected = 0
```

Custom roles do not require executing the raw powerset of independent
permissions. They do require every tenant-safe permission individually at every
supported scope, every prohibited permission rejection, every predefined role,
every cross-policy interaction, and a generator proof of independent union
behavior. Direct/group inheritance, users/machine principals, scope narrowing,
tenant isolation, future/expiry/revocation, edits, role deletion, and stale
sessions remain mandatory.

The focused matrix proves:

| Boundary | Positive case | Negative case |
| --- | --- | --- |
| Permission classification | every project permission and explicit runtime-safe engine subset | every platform and unsafe engine permission |
| Project inheritance | same-tenant project | sibling-tenant project |
| Dedicated engine | same-tenant dedicated engine | sibling tenant or unsafe permission |
| Shared runtime | resolved exact resource plus tenant scope | broad shared-engine/Engine Set, unresolved, stale, null, or sibling tenant |
| Assignment API | authenticated tenant replaces request value | caller-supplied sibling tenant cannot be persisted |
| Configuration | tenant role/assignment preview, diff, apply, export | unsafe tenant-role permission |
| Config mapping | stable tenant key, shared strategy, source-owned create/update/export | dedicated engine, strategy mismatch, foreign owner, unauthorized tenant, stale authoritative removal |
| Effective Access | sanitized mapping lineage | raw claims, credentials, or foreign inventory |
| UI | Current tenant for every supported principal | no raw tenant-ID field |
| Engine topology UI | canonical dedicated/shared create, diagnostics, exact preview acknowledgements, mapping dry run/apply | raw tenant entry, unacknowledged apply, source-owned mutation, or shared engine-wide access |
| Mission Control collection | resolved keys plus exact runtime-tenant scopes | broad shared grant, unresolved row, wrong runtime tenant, or unbounded response |
| Mission Control detail/mutation | exact resolved inventory and authorized live lineage | no mapping, ambiguous key tenant, uninventoried detail, batch, deployment, or migration |
| Classification | explicit dedicated/shared and safe engine-wide default proposal | ambiguous resource-aware and invalid topology |
| Topology transition | all four supported transitions | unchanged proposal, stale/expired hash, missing acknowledgement, source-owner bypass |
| Transition apply | atomic state change, quarantine/resolution, materialization invalidation, reconciliation | optimistic concurrency failure rolls back before dependent writes |
| Engine Set rematerialization | platform/owning-tenant dedicated sets and all tenant shared sets, each persisted in set scope | caller tenant cannot partially rewrite a platform set or grant shared runtime access |
| Operations | bounded engine/resource resolution gauges and actual default-fallback counters | no engine/tenant identifiers; persistence failure reports collection failure without breaking the scrape |

Any new canonical permission must make the classifier test fail until it is
explicitly reviewed as tenant-safe or prohibited.

## Local HTTP and Browser Evidence

When a running local stack is required, use isolated local tenants and engines.
The authorization PR workflow starts PostgreSQL, the backend, frontend, and a
Camunda-compatible mock before running Chromium. Scheduled jobs repeat the
smoke in Firefox and WebKit. For one retained local artifact covering all
three targets, run:

```bash
pnpm run test:authz:local-smoke:cross-browser
```

`TEN-UI-006` runs the separate database-free accessibility matrix against the
same local frontend with:

```bash
pnpm run test:authz:accessibility:cross-browser
```

It executes four Access Control workflows in Chromium, Firefox, and WebKit:
assertive error announcements, WCAG AA contrast on primary controls, 200%
zoom/reflow without page-level horizontal scrolling, and a complete permission
workflow under `prefers-reduced-motion: reduce`. The runner sets
`E2E_SEED_USER=false`, so global setup and teardown cannot open a database
connection. It writes `browser-accessibility.json` only after all 12 executions
pass.

The executable local enforcement journey requires:

- a healthy Docker deployment at the default local frontend/backend URLs, or
  explicit local `PLAYWRIGHT_BASE_URL` and `ENGINE_TENANCY_API_URL` values;
- `.local/docker/env/docker.env` and the generated local CA;
- Playwright Chromium; and
- no `requires_review` or `conflict` classification rows.

Observe without applying existing `ready_for_apply` rows:

```bash
pnpm run test:engine-tenancy:local-evidence
```

Apply the evidence lane's single owned default-tenant proposal through preview
and the exact required acknowledgements:

```bash
ENGINE_TENANCY_APPLY_READY=true pnpm run test:engine-tenancy:local-evidence
```

The evidence fixture creates one disposable, unowned dedicated engine in
`migration_required`. Apply mode uses the platform engine-registration
permission to preview and classify that quarantined row without creating an
engine-scoped assignment. The owned-engine allowlist is asserted to contain
exactly that row: other existing proposals are reported but never changed.
The permission is not accepted for any other engine state and does not grant
engine or runtime visibility. The runner never applies a review or conflict
row. Both modes create and remove disposable dedicated/shared engines and
prove the shared unmapped-to-mapped lifecycle.

`TEN-MIGRATION-008` requires zero review/conflict rows and proves that exactly
the owned migration fixture changes to classified state. `TEN-RUNTIME-007`
requires zero active unmapped resources, mapped visibility after
reconciliation, and healthy aggregate metrics. Playwright keeps transient
screenshots/traces under `test/results/playwright`; the runner writes stable,
sanitized `requirement-evidence.json` and `local-enforcement.json` under
`test/results/engine-tenancy-release`. CI uploads `test/results` for 14 days.

`TEN-AUTHZ-008` proves that a null-owned dedicated engine is not a default-tenant
fallback in direct, collection, invitation, assignment, or runtime evaluation.
The request-authorization module is held to 100% statements, branches,
functions, and lines, including tenant-present and platform-scoped branches.
`TEN-AUTHZ-009`, `TEN-AUTHZ-010`, `TEN-AUTHZ-011`, and `TEN-AUTHZ-012` extend
that proof to engine lists, Engine Set selectors, project
accessed/pending/available lists, legacy project access, and project-engine
target creation. The positive side of the same matrix proves same-tenant
dedicated, authorized platform-wide dedicated, and shared connection discovery
remain available.

For a manual review:

1. create one dedicated engine in tenant A;
2. create one shared engine and map one runtime resource to tenant A and another
   to tenant B;
3. assign Tenant Viewer and a custom tenant role to separate principals;
4. verify same-tenant project/dedicated/shared-resource decisions;
5. verify sibling and unresolved resources deny;
6. inspect Effective Access mapping lineage; and
7. remove the assignment or mapping and verify access disappears immediately.

For a configuration-owned mapping, also run this lifecycle:

1. preview an additive bundle and confirm one
   `engine_tenant_mapping:create`;
2. apply and confirm one mapping-version increment plus a queued runtime
   reconciliation task;
3. export and verify the mapping, engine, and tenant keys are unchanged;
4. attempt a manual edit against `config_locked` and confirm denial;
5. repeat with `config_warn`, confirm diff reports update drift, and reapply;
6. omit the row from an authoritative bundle, review and submit the returned
   archive acknowledgement; and
7. confirm only that bundle's row is inactive while a seeded external row on
   the same engine remains active.

Capture only sanitized response bodies, mapping versions, test IDs, and browser
traces. Never retain tokens, credentials, raw SSO claims, or private endpoints.

## Failure Diagnosis

- A new permission fails the tenant policy test: classify it deliberately; do
  not widen the tenant set by prefix.
- A shared resource is absent: inspect resolution status and mapping version.
  `unmapped`, `conflict`, and `stale` are expected to remain invisible.
- A dedicated engine is absent: verify its persisted tenant and authenticated
  request tenant agree.
- Config preview rejects a tenant role: use only catalog entries marked
  `tenantSafe`.
- Effective Access lacks mapping lineage: verify the runtime row is resolved and
  the referenced engine still exists.
- A browser control is disabled: verify the actor has platform Access Control
  management permission; tenant roles do not delegate RBAC administration.

## Cleanup and Evidence

Use unique test tenant, engine, mapping, group, role, and assignment keys. Remove
them after both successful and failed local runs. CI retains failure diagnostics
for 14 days and publishes authorization decision coverage separately.

Playwright may clear only `test/results/playwright`. It must never clear
`test/results/engine-tenancy-release` or
`test/results/engine-tenancy-mutation`, because those directories combine
evidence produced by independent lanes.

The authoritative traceability source is
`test/authz/engine-tenancy-functional-coverage.json`; an undocumented or
unlinked test does not close a functional requirement.

The latest complete evidence summary is
[Engine Tenancy Functional Test Report](./engine-tenancy-functional-test-report.md).
