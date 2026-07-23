# Engine Tenancy Data Model

Summary: Canonical persistence and contract model for dedicated and shared
EnterpriseGlue engines.

Audience: Developers, architects, database administrators, and API integrators.

Status: The topology, mapping, runtime-resolution persistence foundation and
canonical standalone schemas are implemented. Public shared-engine provisioning,
mapping administration, resolution enforcement, and UI controls remain disabled
until their implementation and functional coverage gates pass.

## Boundaries

Engine topology answers who owns runtime resources:

- `dedicated`: one engine belongs to exactly one EnterpriseGlue tenant;
- `shared`: one infrastructure connection serves resources belonging to more
  than one tenant.

Runtime access scope answers how authorization is evaluated:

- `engine_wide`: one engine-level grant covers its runtime;
- `resource_aware`: runtime definitions and instances require lineage-aware
  authorization.

These fields are independent. Shared engines require `resource_aware`, but
`resource_aware` alone never converts an engine into shared infrastructure.

## Engine Record

The `engines` table owns topology and reconciliation state.

| Property | Column | Invariant |
| --- | --- | --- |
| `tenancyMode` | `tenancy_mode` | `dedicated` or `shared`; new compatibility records default to `dedicated` |
| `tenantId` | `tenant_id` | Required before a dedicated engine is ready; null for shared infrastructure |
| `tenantMappingStrategy` | `tenant_mapping_strategy` | Null for dedicated; required for shared |
| `tenantMappingVersion` | `tenant_mapping_version` | Non-negative and incremented on active mapping changes |
| `tenantResolutionStatus` | `tenant_resolution_status` | `ready`, `incomplete`, `conflict`, or `migration_required` |
| `lastTenantReconciledAt` | `last_tenant_reconciled_at` | Nullable diagnostic timestamp |

`TEN-MODEL-001`: engine topology is persisted separately from
`runtime_access_scope`. A null `tenant_id` never means the default tenant.

## Shared-Engine Tenant Mapping

`engine_tenant_mappings` records the mapping decision and its ownership:

| Property | Purpose |
| --- | --- |
| `engineId` | Shared engine receiving the native identity |
| `externalTenantId` | Native engine tenant identifier; empty string is the canonical no-value representation |
| `enterpriseTenantId` | Resolved EnterpriseGlue tenant |
| `strategy` | `engine_tenant_id`, `deployment_target`, or `explicit` |
| `source` / `sourceRef` | Stable provenance for manual, API, external, config, or system ownership |
| `ownershipMode` | `manual`, `config_warn`, `config_locked`, or `external_managed` |
| `sourceHash` / `lastAppliedAt` | Idempotency and drift evidence |
| `isActive` | Current lifecycle state |

`TEN-MODEL-002`: `(engine, strategy, external tenant)` is unique.
`(engine, source, source reference)` is also unique. A reconciliation updates or
deactivates the stable row; it does not create a competing active mapping.

Tenant existence and caller access cannot be represented as a portable foreign
key because tenant ownership is resolved by the deployment’s tenant provider.
The mapping service must validate both before it writes.

## Runtime-Resource Resolution

`runtime_resources` keeps only sanitized authorization metadata:

| Property | Purpose |
| --- | --- |
| `tenantId` | Resolved EnterpriseGlue tenant; null while unresolved |
| `tenantResolutionStatus` | `resolved`, `unmapped`, `conflict`, or `stale` |
| `tenantMappingId` | Mapping that produced the resolution |
| `tenantMappingVersion` | Mapping version used for the decision |
| `tenantResolutionDetailsJson` | Sanitized diagnostic codes; never credentials or raw claims |

`TEN-MODEL-003`: a dedicated-engine observation with an explicit persisted
tenant is resolved directly. A missing tenant stays unmapped. Shared-engine
resources will be exposed only after a mapping service marks them `resolved`
against the engine’s current mapping version.

## Database Portability

`TEN-MODEL-004`: `EngineTenantMapping` is registered in the PostgreSQL, MySQL,
SQL Server, Oracle, and Spanner adapters. Migration
`1700000000096-add-engine-tenancy-foundation` uses portable TypeORM table,
column, index, and unique-constraint operations.

The migration classifies existing rows conservatively:

| Existing row | Topology | Resolution status |
| --- | --- | --- |
| Engine with `tenant_id` | `dedicated` | `ready` |
| Engine without `tenant_id` | `dedicated` | `migration_required` |
| Runtime resource with `tenant_id` | unchanged | `resolved` |
| Runtime resource without `tenant_id` | unchanged | `unmapped` |

It does not infer shared topology from `resource_aware`, and it does not attach
null rows to the default tenant.

## Canonical Contracts

`TEN-API-001`: the shared engine schema module defines the topology, mapping
strategy, tenant-reference, configuration, mapping, diagnostics, and external
mapping-batch contracts. The contracts are also registered in OpenAPI.

Tenant references are explicit:

```json
{ "type": "request_context" }
```

```json
{ "type": "default" }
```

```json
{ "type": "key", "key": "tenant.team-a" }
```

```json
{ "type": "id", "id": "tenant-default" }
```

Parsing an `id` reference is not authorization. The provisioning service must
prove that the caller can use the referenced tenant.

`TEN-API-002`: external mapping batches are atomic, have a maximum of 500 rows,
support optimistic mapping versions and dry runs, and return sanitized per-row
results plus aggregate diagnostics.

## Current Provisioning Behavior

`TEN-RUNTIME-001`: manual and external engine creation continue to create
dedicated engines. They now persist explicit topology and readiness metadata.
Shared mode is not accepted by the public create/update routes in this
foundation phase.

The next implementation slice will connect the canonical `tenancy` request to
tenant-reference authorization and persisted dedicated/shared behavior. Until
then, operators must not interpret `resource_aware` as centralized/shared
tenancy.

## Functional Coverage

`TEN-DOCS-001`: implemented requirements are recorded in
`test/authz/engine-tenancy-functional-coverage.json`. The foundation CI lane
fails when an entry has a duplicate or invalid identifier, missing test file or
test name, missing Markdown page, or a documentation page that does not cite
the requirement identifier.

## Related Documentation

- [Engine Tenancy and External Provisioning Plan](../architecture/12-engine-tenancy-and-external-provisioning-plan.md)
- [Database Architecture](./database-architecture.md)
- [Configure Authorization, Identity, and Engines](../how-to/configure-authorization-and-engines.md)
- [Database Migrations Guide](../../backend/docs/DATABASE-MIGRATIONS.md)
