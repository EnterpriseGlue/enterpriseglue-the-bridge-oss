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
4. Confirm a local break-glass platform administrator can sign in.
5. Run the current engine-tenancy foundation, provisioning, mapping,
   authorization, runtime, transition, operations, and documentation lanes.

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
adapter; do not copy vendor-specific SQL between adapters.

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

## Compatibility Window

Omitted tenancy continues to create a dedicated engine during the compatibility
window and emits `ENGINE_TENANCY_DEFAULTED_TO_DEDICATED`. Treat a non-zero or
rising fallback metric as unfinished client migration. The fallback applies
only during provisioning; it cannot authorize a null engine or shared resource.

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

## Related Documentation

- [Database Migrations](../../backend/docs/DATABASE-MIGRATIONS.md)
- [Engine Tenancy Data Model](../reference/engine-tenancy-data-model.md)
- [Diagnose Engine Tenant Resolution](./diagnose-engine-tenant-resolution.md)
- [Test Engine Tenancy and Fine-Grained Access Control](../development/testing-engine-tenancy-and-access-control.md)

