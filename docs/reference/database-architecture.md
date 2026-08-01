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
  supported adapters and all four supported upgrade baselines.

## Adapter Layer

Database-specific adapters live under
`packages/shared/src/infrastructure/persistence/adapters`.

## Related Docs

- [Shared Database README](../../packages/shared/src/db/README.md)
- [Database Migrations Guide](../../backend/docs/DATABASE-MIGRATIONS.md)
- [Engine Tenancy Data Model](./engine-tenancy-data-model.md)
- [Five-Database Engine Tenancy Qualification](../development/engine-tenancy-database-qualification.md)
