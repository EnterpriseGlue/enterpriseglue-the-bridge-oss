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
```

The authorization lane:

1. validates the functional-coverage manifest;
2. enforces 100% source coverage on
   `packages/shared/src/authz/tenant-role-policy.ts`;
3. executes tenant-role inheritance, runtime visibility, route, schema, config
   apply/diff/export, and Effective Access tests; and
4. executes the Access Control tenant-scope UI tests.

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
| Effective Access | sanitized mapping lineage | raw claims, credentials, or foreign inventory |
| UI | Current tenant for every supported principal | no raw tenant-ID field |

Any new canonical permission must make the classifier test fail until it is
explicitly reviewed as tenant-safe or prohibited.

## Local HTTP and Browser Evidence

When a running local stack is required, use isolated local tenants and engines.
The authorization PR workflow starts PostgreSQL, the backend, frontend, and a
Camunda-compatible mock before running Chromium. Scheduled jobs repeat the smoke
in Firefox and WebKit.

For a manual review:

1. create one dedicated engine in tenant A;
2. create one shared engine and map one runtime resource to tenant A and another
   to tenant B;
3. assign Tenant Viewer and a custom tenant role to separate principals;
4. verify same-tenant project/dedicated/shared-resource decisions;
5. verify sibling and unresolved resources deny;
6. inspect Effective Access mapping lineage; and
7. remove the assignment or mapping and verify access disappears immediately.

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
