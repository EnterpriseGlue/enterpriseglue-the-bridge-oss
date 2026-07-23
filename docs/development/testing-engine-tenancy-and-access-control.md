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
- an explicit allow, deny, quarantine, conflict, or compatibility outcome.

Security-critical pure modules are additionally held to 100% statements,
branches, functions, and lines. This is not a claim that every unrelated line
in the monorepo has 100% source coverage.

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
3. executes tenant-role inheritance, runtime visibility, route, schema, config
   apply/diff/export, and Effective Access tests; and
4. executes the Access Control tenant-scope UI tests.

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

## Required Authorization Matrix

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
Camunda-compatible mock before running Chromium. Scheduled jobs repeat the smoke
in Firefox and WebKit.

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

Apply all safe default-tenant proposals through preview and the exact required
acknowledgements:

```bash
ENGINE_TENANCY_APPLY_READY=true pnpm run test:engine-tenancy:local-evidence
```

The apply mode creates a temporary engine-scoped migration assignment for each
ready row and removes it even when the journey fails. It never applies a review
or conflict row. Both modes create and remove disposable dedicated/shared
engines and prove the shared unmapped-to-mapped lifecycle.

`TEN-MIGRATION-008` requires zero review/conflict rows and, in apply mode, zero
ready rows. `TEN-RUNTIME-007` requires zero visible unmapped resources, mapped
visibility after reconciliation, and healthy aggregate metrics. Successful
runs retain sanitized JSON and a screenshot under `test/results`; CI uploads
that directory for 14 days.

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

The authoritative traceability source is
`test/authz/engine-tenancy-functional-coverage.json`; an undocumented or
unlinked test does not close a functional requirement.

The latest complete evidence summary is
[Engine Tenancy Functional Test Report](./engine-tenancy-functional-test-report.md).
