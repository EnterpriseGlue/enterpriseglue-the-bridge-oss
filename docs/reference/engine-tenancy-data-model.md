# Engine Tenancy Data Model

Summary: Canonical persistence and contract model for dedicated and shared
EnterpriseGlue engines.

Audience: Developers, architects, database administrators, and API integrators.

Status: Topology persistence, canonical schemas, tenant-reference resolution,
manual/external provisioning, atomic mapping administration, runtime mapping
enforcement, and configuration-bundle topology parity are implemented. Shared
resources remain fail closed until exactly one current mapping resolves them.
Tenant-role classification, same-tenant inheritance, configuration round-trip,
Access Control assignment scope, and Effective Access mapping lineage are also
implemented. Topology transitions, configuration-owned tenant mappings, and
engine-topology UI controls remain gated.

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
tenant is resolved directly. A missing tenant stays unmapped. A shared-engine
resource is resolved only when exactly one active mapping matches the configured
strategy. Otherwise it is persisted as `unmapped` or `conflict`, with no tenant.

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

## Provisioning and Resolution

`TEN-RESOLVE-001`: omitting `tenancy` remains backward-compatible. Creation and
external upsert interpret omission as dedicated request-context tenancy. The
request tenant is normalized and persisted. An OSS request without a tenant
context uses the canonical `tenant-default`; it never creates another ambiguous
null-owned engine.

`TEN-DEDICATED-001`: a successfully provisioned dedicated engine always has one
tenant and `tenantResolutionStatus = ready`.

`TEN-RESOLVE-002`: an explicit `id` or `key` is not trusted merely because it
parses. The local resolver can prove only the request tenant and canonical
default aliases. Enterprise deployments provide an
`EngineTenantReferenceResolver` through the enterprise backend plugin. It
receives the reference, request tenant, principal type, and principal id, and
must return both the normalized tenant and an authorization decision. A denied
or unprovable reference returns `ENGINE_TENANT_REFERENCE_FORBIDDEN` without
tenant inventory details.

`TEN-SHARED-001`: shared creation requires
`runtimeAccessScope = resource_aware`. It persists null engine `tenantId`, the
declared mapping strategy, mapping version zero, and
`tenantResolutionStatus = incomplete`. This is deliberate quarantine. A shared
engine is not ready merely because its connection works.

`TEN-SHARED-002`: external registration uses the same explicit shared contract
and returns an empty tenancy-warning list when `tenancy` is present.

`TEN-API-003`: ordinary manual updates and external upserts may repeat an
equivalent declaration, but cannot change dedicated/shared topology, the
dedicated tenant, or a shared mapping strategy. Such a request returns
`ENGINE_TENANCY_TRANSITION_REQUIRED` with HTTP 409.

`TEN-API-004`: an external request that omits `tenancy` receives the
machine-readable warning `ENGINE_TENANCY_DEFAULTED_TO_DEDICATED` in
`diagnostics.tenancyWarnings`. The same compatibility decision is attached to
external registration audit details.

`TEN-API-005`: create, update, and external registration share the canonical
`tenancy` schema and stable sanitized error schema in OpenAPI.

`TEN-RUNTIME-001`: dedicated resource observations persist explicit resolved
state and sanitized lineage.

## Mapping Administration and Runtime Enforcement

`TEN-API-006`: mapping writes are validated before mutation and are applied in
one database transaction. A batch may contain up to 500 rows, must use the
engine's mapping strategy, cannot contain duplicate mapping or source identities,
and may supply `expectedMappingVersion`. `dryRun: true` calculates the complete
result without writing. A changed batch increments the engine mapping version
once; a no-op batch preserves it.

Manual administration uses:

```text
GET /engines-api/engines/{id}/tenant-mappings
PUT /engines-api/engines/{id}/tenant-mappings
GET /engines-api/engines/{id}/tenancy/diagnostics
```

`TEN-API-007`: an authorized API client can apply the same atomic mapping
contract through
`PUT /engines-api/external/engines/{externalId}/tenant-mappings`. The route
verifies external-system ownership, resolves every tenant reference, records
external source ownership, and emits a sanitized audit summary.

`TEN-API-008`: list, apply, diagnostics, and external mapping operations use the
canonical mapping schemas in OpenAPI. Stable mapping conflicts return an engine
tenancy error without exposing tenant inventory or raw runtime claims.

`TEN-RUNTIME-002`: shared runtime inventory resolution uses the persisted engine
strategy and active mapping rows. A successful decision stores the resolved
tenant, mapping id, and current engine mapping version. Missing or multiple
matches are quarantined as `unmapped` or `conflict`. Reconciliation updates the
engine readiness summary and rematerializes tenant-specific runtime-resource
sets.

`TEN-AUTHZ-001`: Runtime Resource Set materialization requires both
`tenantResolutionStatus = resolved` and equality between the resource tenant and
the set tenant. An unresolved or cross-tenant resource is never materialized,
even if its labels or selectors match.

`TEN-CONFIG-001`: configuration bundles parse, preview, apply, diff, and export
the same explicit dedicated/shared topology contract. Shared config engines are
stored with null engine tenant, the declared mapping strategy, resource-aware
access, and fail-closed `incomplete` status. A normal config apply reports a
conflict instead of changing an existing engine's topology. Configuration-owned
mapping rows are a later phase and must not be inferred from topology alone.

## Tenant Role Boundary and Inheritance

A tenant role is a reusable set of tenant-safe project and runtime permissions.
The assignment is bound to the authenticated tenant; callers never submit a
trusted tenant ID. Platform Access Control administrators remain responsible for
creating and assigning tenant roles. Holding a tenant role does not grant access
to the role catalog or allow the holder to delegate their own access.

The immutable templates are:

| Role | Intended use |
| --- | --- |
| Tenant Administrator | Tenant-owned project administration plus tenant-safe engine/runtime operations |
| Tenant Engine Operator | Runtime deployment, process, instance, and variable operations |
| Tenant Viewer | Project, deployment, and instance read access |

`TEN-AUTHZ-002`: every canonical project permission is tenant-safe. Engine
permissions are tenant-safe only when they operate on deployments, processes,
instances, or variables. Platform permissions, engine lifecycle/configuration,
credentials and secrets, engine membership, project-to-engine access approval,
environment locks, delegation, and ownership transfer are excluded. The
classifier is a security-critical pure module held to 100% statements, branches,
functions, and lines.

`TEN-AUTHZ-003`: a tenant assignment can satisfy a project decision only when
the project resolves to the authenticated tenant. A sibling-tenant project and
every platform permission remain denied.

`TEN-AUTHZ-004`: the same assignment can satisfy an engine decision only for a
dedicated engine owned by that tenant. On a shared engine it can satisfy only an
exact runtime resource that is resolved to that tenant. A broad shared-engine or
Engine Set assignment is not treated as runtime access.

`TEN-AUTHZ-005`: runtime-resource lookup requires an active row with
`tenantResolutionStatus = resolved` and the authenticated tenant. Unmapped,
conflicting, stale, null-tenant, and sibling-tenant rows are denied before role
assignments are evaluated.

`TEN-API-009`: `POST /api/authz/role-assignments` replaces any tenant scope ID
in the request with the authenticated tenant for both the resource and canonical
scope fields. A request without an active tenant cannot create a tenant
assignment.

`TEN-CONFIG-002`: configuration bundles support `scope: tenant` roles and
`scope: { type: tenant }` assignments. Preview applies the same tenant-safe
classifier as interactive role creation. Apply resolves the scope to the bundle
tenant, and export emits no raw tenant ID, so the bundle remains portable.

`TEN-UI-001`: Access Control offers **Current tenant** for user, group,
API-client, and service-account assignments. It intentionally has no tenant-ID
text field. Machine principals can receive only the immutable Tenant Engine
Operator or Tenant Viewer templates.

`TEN-AUDIT-001`: Effective Access sources for runtime decisions include the
resolved tenant, `resolved` status, mapping ID, mapping version, sanitized
resolution code, and dedicated/shared topology. They never include raw claims,
credentials, or another tenant’s mapping inventory.

## Functional Coverage

`TEN-DOCS-001`: implemented requirements are recorded in
`test/authz/engine-tenancy-functional-coverage.json`. The foundation CI lane
fails when an entry has a duplicate or invalid identifier, missing test file or
test name, missing Markdown page, or a documentation page that does not cite
the requirement identifier.

The provisioning policy and mapping service modules are each held to 100%
statements, branches, functions, and lines. The mapping gate also exercises
inventory, route, authorization registry, configuration, schema, and OpenAPI
suites. This is 100% coverage of the implemented functional requirement IDs,
not a claim that every unrelated repository line has 100% code coverage.

## Related Documentation

- [Engine Tenancy and External Provisioning Plan](../architecture/12-engine-tenancy-and-external-provisioning-plan.md)
- [Engine Tenancy and Provisioning API](./engine-tenancy-and-provisioning-api.md)
- [Provision Engines Externally](../how-to/provision-engines-externally.md)
- [Database Architecture](./database-architecture.md)
- [Configure Authorization, Identity, and Engines](../how-to/configure-authorization-and-engines.md)
- [Database Migrations Guide](../../backend/docs/DATABASE-MIGRATIONS.md)
