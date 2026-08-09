# Upgrade to Explicit Engine Tenancy

Summary: Upgrade an existing installation to explicit dedicated/shared engine
topology while preserving access and rollback evidence.

Audience: Release operators, database administrators, platform
administrators, and security reviewers.

## Before the Upgrade

1. Back up the application database using the supported database procedure.
2. Export engine, Engine Set, Runtime Resource Set, project-target,
   configuration-bundle, and role-assignment state.
3. Record the current application version, schema/migration version, and
   configuration bundle hash.
4. Confirm a local break-glass platform administrator can sign in, then prove
   a membership removal invalidates both a concurrent recovery attempt and an
   already-open recovery access/refresh session. Restore the approved recovery
   membership only after capturing that evidence.
5. Run the current engine-tenancy foundation, provisioning, mapping,
   authorization, runtime, transition, operations, and documentation lanes.

### 0.11.0 irreversible identity boundary

The 0.11.0 migration series is not wholly reversible. Migrations
`1700000000089` through `1700000000095` remove the obsolete legacy SSO
provider/mapping tables and provider-specific user identity columns, and later
migrations such as `1700000000100` deliberately provide no downgrade path.
Migration `1700000000109` is also irreversible: it classifies historical
tenantless/default OSS projects, project targets, project role assignments,
and project permission grants as `tenant-default`, then requires tenant
ownership on projects and targets. It stops before writes when a target,
assignment, or grant contradicts its project's tenant. Restore the pre-upgrade
database and matching application images to cross this boundary backward.
They do not convert or preserve legacy SSO data. This release assumes no
customer production SSO data exists in those structures.

Before starting 0.11.0, verify that the removed structures contain no required
data and capture a full database backup plus the matching pre-upgrade backend
and frontend images. Stop the upgrade if that assumption is false. Do not run
TypeORM revert across this boundary; the only full downgrade is restoring the
captured database and matching application pair.

No deployed SSO provider is required for the tenancy upgrade. Use local users,
groups, API clients, and service accounts for the authorization evidence.

## Schema Upgrade Order

The portable migration creates topology and resolution columns first, creates
the mapping table and indexes, then classifies legacy rows conservatively:

- an engine with an owning tenant becomes dedicated and ready;
- an engine without an owning tenant remains dedicated but
  `migration_required`;
- a runtime resource with a tenant remains resolved; and
- a runtime resource without a tenant becomes unmapped.

The migration never infers shared topology from `resource_aware` and never
attaches a null row to the local default tenant. Apply normal repository
migrations for the configured PostgreSQL, MySQL, SQL Server, Oracle, or Spanner
adapter; do not copy vendor-specific SQL between adapters. The topology
migration itself is reversible where its `down()` implementation exists, but
that does not make the complete 0.11.0 identity/authorization migration
sequence reversible.

## Observe and Classify

Start the upgraded backend before enabling tenant rollout, then:

1. read the classification report;
2. preserve every `requires_review` or `conflict` row;
3. verify aggregate metrics and collection success;
4. classify each engine from authoritative operational ownership evidence; and
5. preview every required topology change without applying it.

Follow
[Migrate Existing Engines to Explicit Tenancy](./migrate-existing-engines-to-explicit-tenancy.md)
for the guarded apply and rollback workflow.

## Execute the Local Upgrade Rehearsal

Use the local Docker deployment as the representative environment. Required
inputs are the checked-out release candidate, its local Docker environment
file and generated CA, a healthy frontend/backend, Playwright Chromium, and a
database backup. Customer identity-provider credentials are neither required
nor permitted.

First run observe mode:

```bash
pnpm run test:engine-tenancy:local-evidence
```

Observe mode may leave `ready_for_apply` rows unchanged, but it fails on every
ambiguous/conflicting classification, unresolved final runtime resource,
fail-open shared response, unhealthy metric collection, or cleanup leak.

Run the guarded evidence fixture after an operator has reviewed the
installation:

```bash
ENGINE_TENANCY_APPLY_READY=true pnpm run test:engine-tenancy:local-evidence
```

`TEN-MIGRATION-008`: the evidence fixture creates one disposable null-owned
dedicated engine in `migration_required`. Apply mode uses
`platform:engine-registration:manage` only for that quarantined row, submits
the exact preview hash/expiry/acknowledgements, and creates no engine-scoped
assignment. It will not apply `requires_review` or `conflict`.

The evidence command changes only its single disposable engine. It reports
other `ready_for_apply` rows but deliberately does not migrate them. Classify
each real engine separately through its tenancy preview/apply API after
reviewing ownership and acknowledgements; never use a test runner as a bulk
migration tool.

Retain the Playwright JSON and screenshot from `test/results`, command output,
release commit, adapter/version, schema migrations, and the post-run aggregate
metrics. Success requires:

- the disposable engine changes from ready-for-apply to classified;
- zero review and conflict rows;
- every retained runtime resource is resolved;
- zero orphan engine mappings, inventory, materializations, or assignments;
- shared inventory is invisible before mapping and visible only after mapping
  plus reconciliation; and
- no disposable identity, engine, mapping, or assignment remains.

Restore the captured application/database pair if any resource crosses tenants,
denied inventory is visible, apply is not atomic, cleanup leaves authorization
state, or the final classification/metric checks fail. A failed row remains
fail closed while evidence is investigated.

## Validate Access

For one dedicated engine and one shared engine, where shared topology is
actually used:

- verify persisted topology and tenant/mapping invariants;
- reconcile inventory and require zero unexpected unresolved/conflicting rows;
- assign a predefined tenant role and a tenant-safe custom role;
- test user, group-derived user, API client, and service account decisions;
- verify same-tenant allow, sibling-tenant deny, and unresolved-resource deny;
- inspect Effective Access and sanitized audit lineage; and
- prove a denied shared request makes no engine transport call.

Repeat with an active session after removing the assignment or mapping to prove
immediate revocation.

## Explicit External Tenancy

The external registration API now requires explicit tenancy on every create and
idempotent upsert. A missing declaration is rejected with HTTP 400 before an
engine is read or written; it does not default to a dedicated engine and no
longer returns a compatibility warning. Use an explicit dedicated declaration
with a portable tenant reference, or an explicit shared declaration with
`resource_aware`, a mapping strategy, and `unmappedPolicy = deny`.

See
[Engine Tenancy Compatibility and Deprecation](../reference/engine-tenancy-compatibility-and-deprecation.md)
for removal gates and the external-integrator checklist.

## Rollback Conditions

Stop rollout and restore the prior application/database pair if:

- a shared resource is visible without exactly one resolved tenant;
- a dedicated engine resolves outside its persisted tenant;
- migration classification changes on an idempotent rerun;
- schema/index invariants differ across the configured adapter; or
- access cannot be revoked after assignment, mapping, or topology change.

Do not downgrade application binaries against a schema version they do not
support. Rollback the deployment and database together from the captured
backup, then retain sanitized classification, preview, migration, and test
evidence for diagnosis.

## Completion Evidence

Retain the commit/version, database adapter and version, migration list,
classification report, preview/apply receipts, mapping versions, configuration
hash, focused-lane results, browser trace identifiers, and rollback decision.
Never retain tokens, credential material, raw identity claims, private engine
URLs, or cross-tenant inventory.

The completed reference run is recorded in
[Engine Tenancy Functional Test Report](../development/engine-tenancy-functional-test-report.md).

## Related Documentation

- [Database Migrations](../../backend/docs/DATABASE-MIGRATIONS.md)
- [Engine Tenancy Data Model](../reference/engine-tenancy-data-model.md)
- [Diagnose Engine Tenant Resolution](./diagnose-engine-tenant-resolution.md)
- [Test Engine Tenancy and Fine-Grained Access Control](../development/testing-engine-tenancy-and-access-control.md)
