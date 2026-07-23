# Centralized and Decentralized Engine Tenancy Implementation Plan

Last updated: 2026-07-23

## Purpose

This document defines the target model and implementation plan for supporting both:

- decentralized/dedicated engines that belong to one EnterpriseGlue tenant; and
- centralized/shared engines whose runtime resources can belong to different EnterpriseGlue tenants.

It also defines the required persistence, shared-schema, API, configuration-bundle, external-provisioning, authorization, UI, migration, and test changes.

This is a focused child plan of
[JSON-Driven Authorization and Engine Registration](11-json-driven-authz-and-engine-registration.md).
It refines that document's distributed-versus-central engine model without changing
the selected authorization authority, connection-mode, or secret-management designs.

The central design decision is to keep these two concepts separate:

1. **Engine tenancy topology**: `dedicated` or `shared`.
2. **Runtime authorization scope**: `engine_wide` or `resource_aware`.

`runtimeAccessScope` must not be used as an indirect signal for tenancy topology. A dedicated engine can use either runtime access scope. A shared engine must use `resource_aware`.

## Desired Outcome

```text
dedicated engine
  -> exactly one resolved EnterpriseGlue tenant
  -> runtime inventory inherits that tenant
  -> default tenant may be used during provisioning

shared engine
  -> shared connection and engine administration
  -> each runtime resource resolves to exactly one EnterpriseGlue tenant
  -> default-tenant fallback is forbidden
  -> unresolved or conflicting resources are quarantined and denied
```

The authorization hierarchy becomes:

```text
platform
  -> tenant
      -> project
      -> dedicated engine
          -> runtime resource
      -> shared-engine runtime resource mapped to this tenant
```

## Current-State Gap

The current implementation already provides:

- `Engine.tenantId`, which is nullable;
- `runtimeAccessScope` with `engine_wide` and `resource_aware`;
- manual engine creation through `POST /engines-api/engines`;
- external idempotent engine registration through `POST /engines-api/external/engines`;
- configuration-bundle engine provisioning;
- runtime-resource inventory and resource-aware authorization;
- engine and runtime-resource role assignments;
- API-client permissions for external engine registration;
- strict shared request and response schemas plus OpenAPI contracts.

The missing boundary is:

- no explicit `dedicated` versus `shared` engine field;
- no canonical tenant-resolution policy attached to an engine;
- no persisted mapping from engine-native tenant identifiers to EnterpriseGlue tenants;
- no quarantine state for unresolved shared-engine runtime resources;
- manual and external registration currently derive `tenantId` from request context or store `null`;
- configuration bundles cannot declare topology or tenant mappings;
- external provisioning cannot declare or reconcile topology safely;
- tenant is a registered authorization resource type but is not yet a first-class role-assignment scope.

## Core Rules

### Rule 1: every authorization decision resolves one tenant

Tenant may be omitted by a caller, but a tenant-scoped decision must finish with exactly one canonical EnterpriseGlue tenant.

The evaluator must collect all available signals:

- explicit request tenant;
- authenticated session tenant;
- API-client tenant;
- target resource tenant;
- project/deployment target tenant;
- runtime-resource inventory tenant;
- dedicated engine owning tenant.

All present signals must agree. A conflict denies the request and must not be resolved using precedence.

### Rule 2: default fallback is topology-aware

Default-tenant fallback is allowed only when:

- the engine is `dedicated`;
- no conflicting tenant signal exists; and
- the operation is engine provisioning, dedicated inventory ingestion, or an authenticated default-tenant operation.

Default fallback is forbidden when:

- the engine is `shared`;
- a runtime resource is being resolved on a shared engine;
- more than one candidate tenant is present;
- the caller attempts to access a resource mapped to another tenant; or
- the engine topology is unclassified during migration.

`NULL` must not mean “default tenant.” For a dedicated engine, the resolved tenant ID is persisted.

### Rule 3: shared engines fail closed

A shared-engine runtime resource is usable only when its tenant resolution status is `resolved`.

Resources with status `unmapped`, `conflict`, or `stale`:

- are excluded from visible runtime inventory;
- cannot satisfy role assignments;
- cannot be returned by Mission Control;
- cannot be targeted by runtime mutations or deployments;
- appear only in authorized administration diagnostics.

### Rule 4: connection administration is separate from runtime access

For a shared engine:

- connection URL, credentials, sidecar settings, lifecycle, and capability management remain platform/shared-engine administration;
- tenant roles do not expose engine secrets or connection configuration;
- tenant roles can authorize only mapped runtime resources and tenant-safe engine actions;
- the engine can appear in a user’s runtime selector when at least one mapped resource is visible.

### Rule 5: tenant membership and tenant roles have different purposes

- Tenant membership establishes the admission boundary.
- Tenant-scoped role assignments grant actions inside that boundary.
- Platform administrators retain explicit platform permissions rather than receiving an undocumented tenant bypass.

## Target Domain Model

### Engine fields

Add the following canonical fields to `engines`:

| Field | Type | Required behavior |
| --- | --- | --- |
| `tenancy_mode` | `dedicated \| shared` | Non-null after migration |
| `tenant_id` | nullable text | Required for `dedicated`; null for shared infrastructure |
| `tenant_mapping_strategy` | nullable text | Required for `shared`; null for `dedicated` |
| `tenant_mapping_version` | integer | Incremented whenever active mappings change |
| `tenant_resolution_status` | text | `ready`, `incomplete`, `conflict`, or `migration_required` |
| `last_tenant_reconciled_at` | nullable bigint | Diagnostics and drift evidence |

Recommended mapping strategies for the first implementation:

- `engine_tenant_id`: map an engine-native tenant identifier to an EnterpriseGlue tenant;
- `deployment_target`: derive tenant from a canonical project deployment target/receipt;
- `explicit`: externally provisioned or manually maintained exact mappings.

Label-driven arbitrary expressions should be deferred until the exact strategies are stable and covered.

### Tenant mapping table

Add `engine_tenant_mappings`:

| Field | Purpose |
| --- | --- |
| `id` | Stable mapping ID |
| `engine_id` | Shared engine |
| `external_tenant_id` | Engine-native tenant identifier, when applicable |
| `enterprise_tenant_id` | Canonical EnterpriseGlue tenant |
| `strategy` | Mapping strategy |
| `source` / `source_ref` | Manual, API, external, config, or system provenance |
| `ownership_mode` | Manual, config-warn, config-locked, external-managed |
| `source_hash` / `last_applied_at` | Drift and idempotency |
| `is_active` | Lifecycle state |
| `created_at` / `updated_at` | Auditability |

Required uniqueness:

- one active mapping per engine and external tenant identifier;
- one stable source identity per engine/source/source reference;
- no mapping to an archived or inaccessible EnterpriseGlue tenant.

### Runtime-resource resolution fields

Extend runtime-resource inventory with:

| Field | Purpose |
| --- | --- |
| `tenant_id` | Resolved EnterpriseGlue tenant; nullable only while quarantined |
| `tenant_resolution_status` | `resolved`, `unmapped`, `conflict`, or `stale` |
| `tenant_mapping_id` | Mapping that produced the result |
| `tenant_mapping_version` | Mapping version used by reconciliation |
| `tenant_resolution_details_json` | Sanitized diagnostic codes, never secrets or raw identity data |

Authorization queries must require `tenant_resolution_status = 'resolved'` for shared-engine resources.

### Tenant role scope

Promote `tenant` to a first-class assignable role scope:

- tenant assignments require a concrete tenant ID;
- tenant roles may contain only permissions classified as tenant-safe;
- tenant assignments can satisfy project, engine, and runtime-resource decisions only when the target resolves to the same tenant;
- tenant roles never grant platform-global actions or shared-engine secret/configuration access;
- direct-user, group, API-client, and service-account behavior remains consistent with the existing principal model.

Define initial immutable role templates only after the permission classification is explicit, for example:

- tenant administrator;
- tenant engine operator;
- tenant auditor/viewer.

Do not treat basic tenant membership as an implicit administrator role.

## Shared Schema Plan

### Canonical schemas

Add canonical schemas under `packages/shared/src/schemas/mission-control/engine.ts`:

- `EngineTenancyModeSchema`;
- `EngineTenantMappingStrategySchema`;
- `EngineTenantReferenceSchema`;
- `EngineTenantMappingSchema`;
- `EngineTenancyConfigurationSchema`;
- `EngineTenancyDiagnosticsSchema`;
- `ExternalEngineTenantMappingsUpsertRequestSchema`;
- `ExternalEngineTenantMappingsUpsertResponseSchema`.

Recommended request shape:

```json
{
  "tenancy": {
    "mode": "dedicated",
    "tenantRef": "default"
  }
}
```

```json
{
  "tenancy": {
    "mode": "shared",
    "mappingStrategy": "engine_tenant_id",
    "unmappedPolicy": "deny"
  }
}
```

`unmappedPolicy` should support only `deny` in the first version. Making the value explicit prevents clients from assuming that fallback behavior is configurable.

### Manual create/update contracts

Extend:

- `CreateEngineRequestSchema`;
- `UpdateEngineRequestSchema`;
- sanitized engine inventory/detail responses;
- engine insert/persistence schemas;
- OpenAPI schemas and examples.

Rules:

- manual create may omit `tenancy`; omission means `dedicated`;
- a dedicated tenant is resolved from the authenticated tenant context, then the configured default tenant;
- a non-platform caller cannot submit an arbitrary tenant ID;
- shared creation requires `resource_aware`;
- normal update cannot change topology when inventory, mappings, assignments, targets, or receipts exist;
- topology transitions use the preview/apply process described below.

### External registration contract

Extend `ExternalEngineRegistrationRequestSchema` with the same canonical `tenancy` object.

Compatibility behavior:

- existing clients that omit `tenancy` create or update a `dedicated` engine;
- the normalized response includes the resolved topology and tenant;
- omission produces a bounded deprecation warning in response diagnostics and audit data;
- a client must explicitly submit `shared`; `resource_aware` alone is not interpreted as shared;
- an external upsert cannot silently change an existing engine’s topology;
- a conflicting topology returns `409 ENGINE_TENANCY_TRANSITION_REQUIRED`;
- field ownership includes topology and mapping ownership so external updates cannot overwrite manual/config-owned tenancy fields.

External clients must reference tenants through stable tenant keys or authorized tenant references. Raw tenant IDs from an untrusted body must not bypass API-client tenant authorization.

### Configuration-bundle contracts

Extend `ConfigEngineSchema` with the same normalized tenancy object.

Dedicated example:

```yaml
key: engine.team-a
name: Team A Engine
type: operaton
baseUrl: https://team-a.example/engine-rest
tenancy:
  mode: dedicated
  tenantKey: tenant.default
runtimeAccessScope: engine_wide
```

Shared example:

```yaml
key: engine.central
name: Central Engine
type: operaton
baseUrl: https://central.example/engine-rest
tenancy:
  mode: shared
  mappingStrategy: engine_tenant_id
  unmappedPolicy: deny
runtimeAccessScope: resource_aware
```

Add a source-owned tenant-mapping object family or a bounded mapping array referencing stable tenant keys. Prefer a separate object family when mappings are expected to be numerous.

Preview/diff/apply must:

- resolve tenant references before writing;
- report topology and mapping changes separately from connection changes;
- require explicit acknowledgement for topology changes, mapping removals, and newly quarantined resources;
- reject a stale preview hash;
- apply engine and mapping changes transactionally;
- refresh resource/Engine Set materializations;
- invalidate authorization snapshots;
- schedule tenant and runtime inventory reconciliation;
- preserve manual/API/external mappings unless the source is authoritative for them.

### Frontend types

Frontend engine clients and forms must import the shared schemas. Do not create a second handwritten tenancy model.

Update:

- engine create/edit payloads;
- engine inventory/detail response types;
- configuration-bundle preview/diff/apply types;
- external-registration diagnostics;
- runtime-resource inventory diagnostics;
- Effective Access source presentation.

## API Plan

### Existing endpoints to extend

| Endpoint | Required change |
| --- | --- |
| `POST /engines-api/engines` | Accept topology; resolve and persist dedicated tenant; validate shared requirements |
| `PUT /engines-api/engines/{id}` | Allow safe tenancy-policy edits but block unsafe topology changes |
| `POST /engines-api/external/engines` | Accept idempotent topology declaration and mapping diagnostics |
| Engine list/detail APIs | Return sanitized tenancy mode, owning tenant, mapping strategy/status, and counts |
| Config bundle preview/diff/apply/export | Include normalized topology and source-owned mappings |
| Effective Access APIs | Resolve and explain tenant-level inheritance and shared-resource mapping lineage |

### New administration endpoints

Add:

```text
POST /engines-api/engines/{id}/tenancy/preview
POST /engines-api/engines/{id}/tenancy/apply
GET  /engines-api/engines/{id}/tenancy/diagnostics
GET  /engines-api/engines/{id}/tenant-mappings
PUT  /engines-api/engines/{id}/tenant-mappings
```

The preview response should include:

- current and proposed topology;
- affected assignments, mappings, runtime resources, Engine Sets, deployment targets, and receipts;
- resources that become visible, hidden, unmapped, or conflicting;
- required acknowledgement IDs;
- a preview hash and expiration.

Apply must require the matching preview hash and acknowledgements.

### External mapping endpoint

For external systems with many mappings, add an idempotent endpoint rather than requiring every mapping on every engine upsert:

```text
PUT /engines-api/external/engines/{externalId}/tenant-mappings
```

Requirements:

- bounded request size and mapping count;
- stable tenant references;
- source-scoped idempotency;
- optional expected mapping version for optimistic concurrency;
- dry-run/preview support;
- authorization on the external engine system and every referenced tenant;
- sanitized per-row result codes;
- no partial success unless the API explicitly defines an atomic batch;
- audit rows for create, update, deactivate, conflict, and rejected cross-tenant attempts.

### API errors

Add stable error codes:

- `ENGINE_TENANCY_UNRESOLVED`;
- `ENGINE_TENANCY_CONFLICT`;
- `ENGINE_TENANCY_TRANSITION_REQUIRED`;
- `ENGINE_SHARED_REQUIRES_RESOURCE_AWARE`;
- `ENGINE_TENANT_MAPPING_NOT_FOUND`;
- `ENGINE_TENANT_MAPPING_VERSION_CONFLICT`;
- `ENGINE_TENANT_REFERENCE_FORBIDDEN`;
- `RUNTIME_RESOURCE_TENANT_UNRESOLVED`.

Responses must not reveal credentials, private endpoints, raw external claims, or another tenant’s identifiers.

## Provisioning Behavior

### Manual dedicated engine

1. Administrator selects **Decentralized / dedicated**.
2. EnterpriseGlue resolves the active tenant or configured default tenant.
3. The resolved tenant ID is persisted on the engine.
4. Runtime inventory inherits that tenant.
5. Tenant and engine assignments can authorize access.
6. The response returns `tenancy.mode = dedicated` and the sanitized tenant reference.

### Manual shared engine

1. Platform/shared-engine administrator selects **Centralized / shared**.
2. UI forces runtime access to `resource_aware`.
3. Administrator selects a mapping strategy.
4. Connection test verifies transport only; it does not prove tenant isolation.
5. Mapping preview and initial reconciliation run.
6. Engine remains `incomplete` until mapping rules are valid.
7. Only resolved resources become visible.

### Externally provisioned dedicated engine

1. API client submits `tenancy.mode = dedicated` or relies temporarily on the compatibility default.
2. Server resolves tenant from API-client/external-system authorization context.
3. A body-supplied tenant reference must match that authorized context.
4. Upsert remains idempotent by external system and external ID.
5. Response returns the resolved mode/tenant and any compatibility warning.

### Externally provisioned shared engine

1. API client explicitly submits `tenancy.mode = shared`.
2. Request must specify `resource_aware` and a supported mapping strategy.
3. Server creates the shared engine in `incomplete` state unless mappings already validate.
4. Client provisions mappings through the bounded mapping API or config bundle.
5. Reconciliation classifies resources as resolved, unmapped, or conflicting.
6. Only resolved resources participate in authorization.

## Authorization and Runtime Resolution

Create one tenant-resolution service used by:

- engine provisioning;
- external registration;
- config apply;
- runtime inventory reconciliation;
- deployment receipt ingestion;
- project deployment targets;
- role-assignment validation;
- Effective Access evaluation;
- Mission Control request guards.

Suggested result:

```ts
type TenantResolution =
  | { status: 'resolved'; tenantId: string; sources: TenantResolutionSource[] }
  | { status: 'unresolved'; reason: string; sources: TenantResolutionSource[] }
  | { status: 'conflict'; reason: string; sources: TenantResolutionSource[] };
```

The service must compare signals rather than accepting the first non-null value.

For dedicated engines:

- engine tenant is authoritative;
- resource and request tenant must match it;
- default tenant is used only before the engine tenant has been persisted.

For shared engines:

- engine tenant is not a runtime authorization signal;
- resource mapping, deployment lineage, and explicit tenant context must agree;
- no default fallback is allowed;
- missing lineage or mapping denies before an engine request is sent.

## Database and Migration Plan

### Migration sequence

1. Add nullable topology and diagnostics columns.
2. Add `engine_tenant_mappings` and adapter/entity registration.
3. Add runtime-resource resolution fields and indexes.
4. Backfill topology and tenant resolution without changing authorization behavior.
5. Run an operator-visible classification report.
6. Resolve or quarantine ambiguous engines/resources.
7. Enable topology-aware evaluator behavior.
8. Make `tenancy_mode` non-null and enforce service-level invariants.
9. Remove temporary compatibility reads only after evidence is complete.

### Existing-engine classification

Safe initial rules:

- engine with a concrete tenant: classify as `dedicated`;
- engine-wide engine without a tenant: propose `dedicated` plus configured default tenant;
- resource-aware engine without a tenant: do not infer shared solely from `runtimeAccessScope`; mark `migration_required` for preview;
- externally/config-managed engine: use explicit source configuration when available;
- ambiguous inventory: quarantine rather than attach to the default tenant.

### Cross-database support

Update:

- PostgreSQL, MySQL, SQL Server, Oracle, and Spanner entity/adapter registries;
- canonical schema invariants;
- migration bootstrap and idempotency tests;
- index naming and identifier-length handling;
- cleanup fixtures and test-data sweepers.

Avoid relying only on database-specific check constraints. Enforce invariants in shared schemas, services, migration verification, and database tests.

## UI Plan

Engine create/edit should expose:

- **Engine topology**: Decentralized (dedicated) or Centralized (shared);
- **Owning tenant** for dedicated engines;
- **Runtime access**: engine-wide or resource-aware;
- **Tenant mapping strategy** for shared engines;
- fixed **deny unmapped resources** behavior;
- tenant resolution and mapping status;
- preview of affected resources before topology changes.

UX requirements:

- default dedicated mode for normal decentralized onboarding;
- show the resolved default tenant rather than hiding it;
- explain that shared mode does not grant tenant users engine configuration access;
- prevent shared + engine-wide combinations;
- show mapped/unmapped/conflicting resource counts;
- require confirmation for transitions and mapping removal;
- provide accessible status and table labels;
- display mapping/source lineage in Effective Access.

## Security Requirements

- Never use `tenant_id IS NULL` as default-tenant access.
- Never trust a tenant ID supplied by an external client without authorization resolution.
- Never map shared resources by display name alone.
- Never expose another tenant’s mapping or resource identifiers in errors.
- Deny before calling the engine when tenant resolution fails.
- Revalidate mapping version on every reconciliation/apply operation.
- Invalidate cached permission snapshots when topology or mappings change.
- Audit topology changes, mapping changes, fallback use, conflicts, quarantine, and denied cross-tenant attempts.
- Keep connection credentials and sidecar downstream authentication outside tenant-level permissions.

## Implementation Phases

### Phase 0: contract decisions

- [ ] Confirm `dedicated` and `shared` as canonical API values.
- [ ] Confirm the first supported shared mapping strategies.
- [ ] Define tenant-safe permission classification and initial tenant roles.
- [ ] Define stable tenant references for config and external APIs.
- [ ] Decide external mapping batch limits and atomicity.
- [ ] Add architecture decision records for default fallback and shared-engine fail-closed behavior.

### Phase 1: persistence and migration

- [ ] Add engine topology/diagnostic fields.
- [ ] Add tenant mapping entity/table.
- [ ] Add runtime-resource tenant-resolution fields.
- [ ] Register entities in every database adapter.
- [ ] Add portable migrations and schema invariants.
- [ ] Implement classification preview and migration evidence report.

### Phase 2: shared contracts

- [ ] Add canonical tenancy and mapping schemas.
- [ ] Extend create/update/external registration requests.
- [ ] Extend sanitized responses and OpenAPI.
- [ ] Extend configuration-bundle schemas.
- [ ] Add stable API error schemas.
- [ ] Add schema compatibility tests for omitted dedicated mode.

### Phase 3: resolution and authorization

- [ ] Implement the shared tenant-resolution service.
- [ ] Add tenant role scope and tenant-safe permission validation.
- [ ] Add tenant assignment inheritance to project/engine/runtime decisions.
- [ ] Require resolved tenant inventory for shared resources.
- [ ] Add mapping-version invalidation and snapshot refresh.
- [ ] Extend Effective Access sources and audit explanations.

### Phase 4: provisioning APIs

- [ ] Update manual create/update services and routes.
- [ ] Update external engine upsert and field ownership.
- [ ] Add topology preview/apply APIs.
- [ ] Add mapping list/upsert APIs.
- [ ] Update config preview/diff/apply/export.
- [ ] Add lifecycle and reconciliation scheduling.

### Phase 5: runtime integration

- [ ] Apply tenant resolution during runtime inventory ingestion.
- [ ] Apply it to deployment targets and receipts.
- [ ] Quarantine unresolved resources.
- [ ] Update Mission Control collection/detail/mutation guards.
- [ ] Update Engine Set and Runtime Resource Set materialization.
- [ ] Prove engine transport is never called after tenant denial.

### Phase 6: UI and operations

- [ ] Add engine topology controls and diagnostics.
- [ ] Add tenant mapping management.
- [ ] Add migration preview and acknowledgements.
- [ ] Update config examples, CLI help, runbooks, and troubleshooting.
- [ ] Add metrics for unresolved/conflicting resources and fallback use.

### Phase 7: enforcement and cleanup

- [ ] Run observe-only classification in representative local environments.
- [ ] Resolve every ambiguous engine/resource.
- [ ] Enable shared-engine fail-closed enforcement.
- [ ] Make topology non-null.
- [ ] Remove temporary omission warnings after the external API deprecation window.
- [ ] Retire any compatibility path that interprets null tenant as default.

## Test Plan

### Schema and API contracts

- dedicated create with explicit tenant context;
- dedicated create with default tenant fallback;
- external omitted-topology compatibility;
- shared create requiring resource-aware access;
- strict rejection of unknown fields and unsupported strategies;
- external tenant-reference authorization;
- topology transition conflict;
- mapping optimistic-concurrency conflict;
- OpenAPI request/response parity.

### Authorization matrix

Cover user, group, API client, and service account across:

- platform assignment;
- tenant assignment;
- project assignment;
- dedicated engine assignment;
- shared runtime-resource assignment;
- Engine Set assignment;
- Runtime Resource Set assignment;
- expired and revoked assignments;
- same-tenant sibling denial;
- cross-tenant denial;
- ambiguous and missing tenant context.

### Dedicated engine

- resource inventory inherits the persisted engine tenant;
- explicit conflicting tenant denies;
- default fallback occurs only before tenant persistence;
- engine-wide and resource-aware modes both stay within the tenant;
- active-session revocation removes tenant access immediately.

### Shared engine

- two users on one engine receive disjoint tenant/resource subsets;
- default tenant is never used;
- unmapped/conflicting resources remain invisible;
- every list, count, detail, mutation, batch, migration, job, task, incident, and history path fails closed;
- mapping removal invalidates access immediately;
- external-engine outage cannot bypass authorization or expose stale resources.

### Migration and configuration

- existing dedicated classification;
- ambiguous resource-aware classification requires review;
- migration is idempotent across supported databases;
- config preview/diff/apply/export round trip;
- source ownership and drift behavior;
- rollback restores topology/mappings and invalidates snapshots;
- audit records contain no secrets or cross-tenant data.

### Browser coverage

- dedicated creation defaults visibly to the default tenant;
- shared creation forces resource-aware access;
- mapping diagnostics are accessible by keyboard and screen reader;
- Effective Access shows tenant and mapping lineage;
- cross-tenant access is denied after browser-session reuse;
- Chromium PR gate plus scheduled Firefox/WebKit coverage.

## Release Gates

The implementation is complete only when:

- every engine has an explicit topology;
- every dedicated engine has a persisted tenant;
- every visible shared runtime resource has exactly one resolved tenant;
- no authorization evaluator treats null tenant as default;
- external provisioning, manual provisioning, and config bundles use the same shared schemas;
- OpenAPI matches runtime validation;
- topology transitions are previewed, acknowledged, audited, and atomic;
- all supported database adapters pass migration/schema tests;
- tenant-role and shared-engine authorization matrices are green;
- browser and active-session revocation tests are green;
- failure artifacts and tenant-resolution diagnostics are retained in CI.

## Rollback Conditions

Pause enforcement or roll back the current phase if:

- a shared resource becomes visible without a resolved tenant;
- a dedicated engine can resolve to more than one tenant;
- external upsert changes topology without transition acknowledgement;
- config apply produces different topology than its preview;
- a tenant role grants platform or shared-engine secret access;
- runtime denial still calls the upstream engine;
- migration classifies an ambiguous engine as default-tenant dedicated without evidence;
- any supported database cannot reproduce the canonical schema.

Rollback must preserve the new metadata and audit evidence. It must not restore tenantless default interpretation or delete mappings needed to explain prior decisions.
