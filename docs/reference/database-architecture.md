# Database Architecture Overview

Summary: How EnterpriseGlue models data, schemas, and database adapters.

Audience: Developers and architects.

## Database Model

- **ORM**: TypeORM (entities and repositories).
- **Schemas**: A primary schema (`main`) and an enterprise schema (`enterprise`).
- **Entities**: Core product data lives in the main schema.

## Supported Databases

Configured via `DATABASE_TYPE`:

- `postgres` (default)
- `oracle`
- `mssql`
- `spanner`
- `mysql`

All five adapters remain supported for the backward-compatible `single`
tenancy mode. Native `pooled` mode is PostgreSQL-only because it requires
forced row-level security and a non-superuser, non-`BYPASSRLS` application
role. Engine topology portability across five databases does not imply that
pooled SaaS tenant isolation is portable to those databases.

## Schema Rules

- `POSTGRES_SCHEMA` must be **non-public**.
- `ENTERPRISE_SCHEMA` must be **non-public** and distinct from `POSTGRES_SCHEMA`.
- Every canonical entity must be registered in all five database adapters.
- Cross-database invariants are enforced through entities, shared schemas,
  services, portable migrations, and adapter tests rather than relying only on
  database-specific check constraints.
- Indexed and unique string fields use bounded portable lengths. Document
  payloads use adapter-appropriate large-text storage.
- Nullable unique SQL Server and Spanner indexes use filtered/null-filtered
  semantics, so multiple absent optional values do not collide.
- Oracle stores the logical empty runtime-tenant and external-tenant keys with
  non-empty internal sentinels because Oracle treats an empty string as null.
  Entity transformers keep this storage detail out of the service and API
  contracts.
- Spanner uses explicit migration-history identifiers, native boolean and
  `INT64` types, and staged nullable/backfill/not-null changes for required
  columns.

## Native SaaS Tenancy Persistence

TypeORM remains authoritative for the portable tenancy entities:

- `tenants` stores the immutable tenant id, canonical slug, lifecycle status,
  placement key, and placement epoch;
- `tenant_domains` stores verified browser-routing hostname aliases;
- `tenant_discovery_domains` stores DNS-verified work-email discovery hints;
- `tenant_discovery_challenges` stores one hashed, expiring, single-use
  membership-discovery challenge per user;
- `tenant_login_policies` stores each tenant's local-password and provider
  selection policy; and
- tenant-owned records, refresh tokens, and invitations carry explicit tenant
  bindings after the ordered backfill.

The shared entities are registered with every database adapter so `single`
mode remains schema-compatible. Migration
`1700000000124-add-native-saas-tenancy` creates the foundation,
`1700000000125-backfill-native-tenant-ownership` assigns legacy owned rows to
the canonical default tenant, and
`1700000000126-add-postgres-tenant-rls` installs the PostgreSQL pooled
backstop. The ownership backfill is intentionally irreversible; preserve a
pre-upgrade backup for a complete rollback.

In PostgreSQL pooled mode, the application establishes query-local tenant
context and forced RLS protects the explicit tenant-owned table allowlist.
Directory metadata needed before authentication—verified discovery domains
and transient discovery challenges—does not use the ordinary tenant-content
RLS predicate; access is confined to the native services and tenant-scoped
administration routes. See
[Native SaaS Tenancy](../architecture/11-native-saas-tenancy.md) for the full
authority, migration, and qualification contract.

## Engine Tenancy Persistence

Engine tenancy is explicit and is separate from runtime access scope:

- `engines.tenancy_mode` is `dedicated` or `shared`;
- `engines.tenant_id` is the owning tenant for a dedicated engine and is null
  for shared infrastructure;
- `engines.tenant_mapping_strategy` identifies how a shared engine resolves
  native tenant identities;
- `engines.tenant_mapping_version` invalidates stale resolutions;
- `engines.tenant_resolution_status` records readiness, incomplete migration,
  or conflict state;
- `engines.last_tenant_reconciled_at` records diagnostic evidence.

`engine_tenant_mappings` records explicit, source-owned mappings from a shared
engine identity to an EnterpriseGlue tenant. Portable unique constraints enforce
one mapping identity and one stable source identity per engine. Mappings are
updated in place and deactivated rather than duplicated.

`runtime_resources` records the resolved EnterpriseGlue tenant, resolution
status, mapping id/version, and sanitized details. A future shared-engine read
is allowed to expose only resources with `tenant_resolution_status = resolved`.

Migration `1700000000096-add-engine-tenancy-foundation` adds these fields and
classifies existing persisted tenant values without interpreting a null tenant
as the default tenant:

- existing engines with a tenant become `dedicated` and `ready`;
- engines without a tenant become `dedicated` and `migration_required`;
- runtime resources with a tenant become `resolved`;
- resources without a tenant become `unmapped`.

Shared-engine provisioning is exposed only through the canonical UI/API/config
contracts. The resolution service, Mission Control guards, transition workflow,
mapping reconciliation, and focused test lanes enforce these persisted
invariants; the migration alone never makes a shared resource visible.

See [Engine Tenancy Data Model](./engine-tenancy-data-model.md) for the canonical
entities, invariants, lifecycle, and current rollout status.

## Migrations

- Migrations run automatically on backend startup.
- TypeORM migrations are generated from entity changes.
- Canonical migration implementations live under
  `packages/shared/src/db/migrations`; persistence-path files re-export them.
- Migration tests must cover a clean install, idempotent retry, upgrade
  classification, and equivalent canonical metadata for every adapter.
- An empty database synchronizes the current canonical schema and records the
  migration baseline. Existing databases continue through ordered migrations.
  This prevents a new installation from replaying historical migrations
  against a schema that already contains their final state.
- Release qualification runs seven engine-tenancy lifecycle stages on all five
  supported adapters and all six supported upgrade baselines, including a
  populated v0.16.2-equivalent native SaaS tenancy upgrade.

## Adapter Layer

Database-specific adapters live under
`packages/shared/src/infrastructure/persistence/adapters`.

## Related Docs

- [Shared Database README](../../packages/shared/src/db/README.md)
- [Database Migrations Guide](../../backend/docs/DATABASE-MIGRATIONS.md)
- [Native SaaS Tenancy](../architecture/11-native-saas-tenancy.md)
- [Engine Tenancy Data Model](./engine-tenancy-data-model.md)
- [Five-Database Engine Tenancy Qualification](../development/engine-tenancy-database-qualification.md)
