# Centralized and Decentralized Engine Tenancy Implementation Plan

Last updated: 2026-07-24

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

## Implementation Status

The production implementation in phases 1–6 is complete, including explicit
topology persistence, portable
tenant references, tenant roles, manual and external provisioning, guarded
topology transitions, and configuration-owned mapping reconciliation.
Configuration mappings use a separate `engine-tenant-mappings.json` family,
retain the authorized tenant reference for portable export, preserve other
sources, re-resolve known runtime inventory atomically, and schedule bounded
post-apply reconciliation.

Topology/mapping UI, Engine Set transition rematerialization, Mission Control
runtime guards, transport-denial proof, bounded operational metrics, published
guides, and executable documentation contracts are implemented.

Release qualification is not the same as implementation completion. The local
PostgreSQL topology journey, three-browser fine-grained access matrix,
five-adapter database qualification, and focused contract lanes are green, but
the full end-to-end goal remains open until the following evidence is retained:

| Qualification gate | Current evidence | Exit condition |
| --- | --- | --- |
| Requirement traceability | 79 registered requirements; 16 public operations; 11 stable errors; four valid and one invalid transition class; zero waivers | Manifest validator and every linked CI lane pass on the release commit |
| Security mutation | Nine targeted mutants killed, including every required tenancy fault class | Mutation report retained by CI with zero survivors |
| Human principals and custom roles | The constraint-derived matrix classifies all user/group, role/source, scope, lifecycle, tenant, topology, and resource-state cells; PostgreSQL direct/group/custom-role tests pass | Same-clean-commit matrix reports 100% execution and zero gap counters |
| Machine principals | The same matrix covers API clients and service accounts; PostgreSQL custom-role, expiry, rotation, and revocation tests pass | Same-clean-commit matrix and HTTP journeys pass for both machine-principal types |
| Local running installation | Guarded PostgreSQL/Chromium enforcement proves owned legacy classification, dedicated defaulting, shared fail-closed mapping, reconciliation, metrics, and cleanup | Repeatable clean-install and supported upgrade-baseline artifacts pass |
| Provisioning channels | All 14 journeys pass locally, including all three Journey 7–14 channels: 14/14 journeys and 30/30 required channel executions | `provisioning-journeys.json` reports 14/14 journeys and 30/30 channel executions from one clean commit |
| Browser targets | The guarded local runner passes 27 authorization executions plus 12 database-free accessibility executions across Chromium, Firefox, and WebKit, including error announcements, contrast, 200% reflow, and reduced motion | Both browser artifacts are retained from the same clean release commit |
| Database targets | The disposable local matrix passes all 35 stage cells and all ten upgrade-baseline observations on PostgreSQL 18.4, MySQL 8.4.10, SQL Server 16.0.4265.3, Oracle 21.0.0.0.0, and Spanner emulator 1.5.30, with one logical-schema fingerprint | `database-matrix.json` retains the complete result from the same unchanged clean release commit |
| Documentation | Developer, user, operator, API, migration, compatibility, test, review, and release-evidence Markdown is published and executable contracts pass | Independent engineering, security, and operator review is signed; all examples and links pass on the release commit |
| Compatibility | Null-owned authorization fallback is removed; omitted new-provisioning tenancy remains warned and defaulted | Published deprecation window closes before omission warnings are removed |

No unchecked qualification gate may be described as covered by a target list
alone. The manifest evidence records declared targets separately from executed
database and browser artifacts.

## Normative Requirement Registry

The machine-readable coverage manifest is authoritative for requirement
metadata. This registry makes the set of normative implementation requirements
visible in the plan itself. CI compares the IDs between the markers with the
manifest exactly: adding, deleting, or renaming a requirement on only one side
fails the coverage gate.

<!-- ENGINE_TENANCY_REQUIREMENTS_START -->

| Family | Normative requirement IDs |
| --- | --- |
| `TEN-API` | `TEN-API-001`, `TEN-API-002`, `TEN-API-003`, `TEN-API-004`, `TEN-API-005`, `TEN-API-006`, `TEN-API-007`, `TEN-API-008`, `TEN-API-009`, `TEN-API-010`, `TEN-API-011`, `TEN-API-012`, `TEN-API-013`, `TEN-API-014` |
| `TEN-AUDIT` | `TEN-AUDIT-001`, `TEN-AUDIT-002` |
| `TEN-AUTHZ` | `TEN-AUTHZ-001`, `TEN-AUTHZ-002`, `TEN-AUTHZ-003`, `TEN-AUTHZ-004`, `TEN-AUTHZ-005`, `TEN-AUTHZ-006`, `TEN-AUTHZ-007`, `TEN-AUTHZ-008`, `TEN-AUTHZ-009`, `TEN-AUTHZ-010`, `TEN-AUTHZ-011`, `TEN-AUTHZ-012`, `TEN-AUTHZ-013`, `TEN-AUTHZ-014`, `TEN-AUTHZ-015`, `TEN-AUTHZ-016` |
| `TEN-CONFIG` | `TEN-CONFIG-001`, `TEN-CONFIG-002`, `TEN-CONFIG-003`, `TEN-CONFIG-004`, `TEN-CONFIG-005`, `TEN-CONFIG-006`, `TEN-CONFIG-007`, `TEN-CONFIG-008`, `TEN-CONFIG-009` |
| `TEN-DEDICATED` | `TEN-DEDICATED-001` |
| `TEN-DOCS` | `TEN-DOCS-001`, `TEN-DOCS-002`, `TEN-DOCS-003`, `TEN-DOCS-004`, `TEN-DOCS-005`, `TEN-DOCS-006`, `TEN-DOCS-007` |
| `TEN-MIGRATION` | `TEN-MIGRATION-001`, `TEN-MIGRATION-002`, `TEN-MIGRATION-003`, `TEN-MIGRATION-004`, `TEN-MIGRATION-005`, `TEN-MIGRATION-006`, `TEN-MIGRATION-007`, `TEN-MIGRATION-008` |
| `TEN-MODEL` | `TEN-MODEL-001`, `TEN-MODEL-002`, `TEN-MODEL-003`, `TEN-MODEL-004` |
| `TEN-OPS` | `TEN-OPS-001` |
| `TEN-RESOLVE` | `TEN-RESOLVE-001`, `TEN-RESOLVE-002` |
| `TEN-RUNTIME` | `TEN-RUNTIME-001`, `TEN-RUNTIME-002`, `TEN-RUNTIME-003`, `TEN-RUNTIME-004`, `TEN-RUNTIME-005`, `TEN-RUNTIME-006`, `TEN-RUNTIME-007` |
| `TEN-SHARED` | `TEN-SHARED-001`, `TEN-SHARED-002` |
| `TEN-UI` | `TEN-UI-001`, `TEN-UI-002`, `TEN-UI-003`, `TEN-UI-004`, `TEN-UI-005`, `TEN-UI-006` |

<!-- ENGINE_TENANCY_REQUIREMENTS_END -->

## Current-State Gap

This section records the gap that motivated the plan. The phase checklist near
the end of this document is the authoritative current status.

The implementation already provided:

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
- an unresolved shared connection can appear in the Engines administration
  inventory only through the explicit `includeManageableShared=true` contract
  and an exact `engine:edit` decision; that administrative row never widens
  runtime selectors or runtime-resource authorization.

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

## Markdown Documentation Deliverables

Documentation is part of the implementation, not a follow-up task. Each implementation
slice must update its affected Markdown pages in the same pull request as the schema,
API, UI, or enforcement change. Documentation must not describe a capability as
available until its validation and enforcement paths have shipped.

Use this change matrix for every remaining work package:

| Changed contract | Developer/architecture Markdown | User/operator Markdown | Executable documentation evidence |
| --- | --- | --- | --- |
| Zod schema, OpenAPI operation, typed client, or stable error | API reference, data model, architecture plan, and testing guide | External-provisioning/configuration guide and troubleshooting guidance | Schema-tagged JSON/YAML, OpenAPI-bound `curl`, operation/error inventory, and link tests |
| Database entity, migration, invariant, or adapter behavior | Database architecture, migration notes, upgrade matrix, and test report | Upgrade and migration runbooks with preview, retry, rollback, and cleanup | Clean/upgrade schema fingerprints and every supported adapter result |
| Permission, role, scope, inheritance, or evaluator behavior | Authorization architecture, generated-matrix rules, and coverage manifest | Configuration guide, Effective Access procedure, and security guidance | Canonical-registry closure, valid cells, invalidity witnesses, audit, and no-transport assertions |
| Topology, mapping, reconciliation, or runtime filtering | Tenancy plan, API/data-model reference, and testing guide | Dedicated/shared configuration, diagnostics, migration, and external provisioning | UI/API/config journeys plus list, detail, mutation, batch, and active-session denial |
| UI workflow or operator-visible state | Browser test procedure and functional report | Step-by-step task guide, success state, failure recovery, and accessibility behavior | Three-browser journey, keyboard/name checks, announcement, contrast, zoom/reflow, and reduced motion |
| Metrics, logging, audit, compatibility, or deprecation | Operational contract, compatibility policy, release evidence, and test report | Deployment, monitoring, troubleshooting, upgrade, and release notes | Sanitization checks, compatibility-window evidence, alerts, rollback trigger, and reviewer record |

A work package is not complete until the Markdown describes the shipped behavior,
the user-visible success and failure paths, and the rollback procedure; every
machine-readable example passes its production schema; all links and anchors pass;
and the functional manifest names the exact documentation section and automated
evidence.

### Developer and architecture documentation

Update these existing pages:

- `docs/architecture/09-oss-authorization-access-control-model.md` with tenant
  scope, inheritance, isolation boundaries, and Effective Access behavior;
- `docs/architecture/11-json-driven-authz-and-engine-registration.md` with the
  canonical provisioning contract, topology ownership, and compatibility rules;
- this plan with decisions, status, implementation evidence, and deviations;
- `docs/reference/database-architecture.md` with the engine topology, mapping,
  resource-resolution, indexes, and supported-database invariants;
- `backend/docs/DATABASE-MIGRATIONS.md` with migration ordering, classification,
  verification, retry, and rollback procedures.

Create these Markdown references:

- `docs/reference/engine-tenancy-and-provisioning-api.md`, covering authentication,
  permissions, request/response fields, idempotency, optimistic concurrency,
  limits, errors, retries, lifecycle, reconciliation, transition preview/apply,
  and decommissioning;
- `docs/reference/engine-tenancy-data-model.md`, covering entities, relationships,
  invariants, ownership, mapping versions, quarantine, and audit events;
- `docs/development/testing-engine-tenancy-and-access-control.md`, covering local
  prerequisites, fixtures, commands, matrix generation, browser tests, database
  variants, coverage artifacts, failure diagnosis, and test-data cleanup;
- `docs/development/engine-tenancy-database-qualification.md`, covering the
  exact five-adapter denominator, disposable Docker setup, supported baselines,
  success criteria, evidence, failure diagnosis, cleanup, and release handoff.

The developer documentation must include:

- sequence examples for manual, external API, and configuration-bundle provisioning;
- dedicated and shared topology diagrams;
- valid and invalid state-transition tables;
- example JSON, YAML, and `curl` payloads generated from or validated against the
  canonical Zod schemas and OpenAPI document;
- permission and tenant-context requirements for every public operation;
- stable error codes and retry guidance;
- cache invalidation, reconciliation, and fail-closed behavior;
- upgrade, compatibility-window, and removal criteria.

### User, administrator, and operator documentation

Update these existing pages:

- `docs/how-to/configure-authorization-and-engines.md`;
- `docs/how-to/deploy-authorization-config.md`;
- `docs/how-to/troubleshooting.md`;
- `docs/reference/configuration.md`;
- `docs/reference/configuration-matrix.md`;
- `docs/reference/security-hardening.md`;
- `docs/index.md`.

Create these Markdown guides:

- `docs/how-to/configure-engine-tenancy.md`, showing when to choose decentralized
  dedicated mode or centralized shared mode, how the default tenant is resolved,
  how to review mappings, and how access is verified;
- `docs/how-to/provision-engines-externally.md`, with end-to-end API examples for
  create, update, transition, mapping, reconciliation, rotation, and removal;
- `docs/how-to/migrate-existing-engines-to-explicit-tenancy.md`, with inventory,
  classification preview, review, apply, validation, rollback, and evidence
  retention;
- `docs/how-to/diagnose-engine-tenant-resolution.md`, with unresolved, duplicate,
  conflicting, stale, and quarantined resource procedures.

The user-facing guides must make these points explicit:

- a decentralized engine normally belongs to one persisted tenant, which may be
  selected from the installation default only during initial provisioning;
- a centralized engine is shared infrastructure and requires explicit per-resource
  tenant mappings;
- the default tenant never grants access to an unmapped shared resource;
- engine topology and runtime access scope are separate choices;
- tenant membership does not grant connection-secret or platform administration
  access;
- topology and mapping changes can revoke active access immediately.

### Documentation validation

CI must:

- validate internal Markdown links and navigation entries;
- validate JSON and YAML snippets against the production schemas;
- execute safe `curl` examples against the local test stack or contract harness;
- compare documented request/response shapes and error codes with OpenAPI;
- verify that examples contain no real credentials, tenant identifiers, or secrets;
- fail if a functional-coverage requirement references a missing documentation page
  or if a public API operation lacks a documented example.

## Implementation Phases

Every phase exits with its production code, migrations, automated tests, functional
coverage-manifest entries, OpenAPI/schema changes, and affected Markdown
documentation updated together. A phase is not complete when only its implementation
checkboxes are closed.

### Phase 0: contract decisions

- [x] Confirm `dedicated` and `shared` as canonical API values.
- [x] Confirm the first supported shared mapping strategies.
- [x] Define tenant-safe permission classification and initial tenant roles.
- [x] Define stable tenant references for config and external APIs.
- [x] Decide external mapping batch limits and atomicity.
- [x] Add architecture decision records for default fallback and shared-engine fail-closed behavior.
- [x] Create the functional coverage manifest, assign every implemented normative requirement a
  stable ID, and add the zero-uncovered-requirements CI validator.

### Phase 1: persistence and migration

- [x] Add engine topology/diagnostic fields.
- [x] Add tenant mapping entity/table.
- [x] Add runtime-resource tenant-resolution fields.
- [x] Register entities in every database adapter.
- [x] Add portable migrations and schema invariants.
- [x] Implement classification preview and migration evidence report.

### Phase 2: shared contracts

- [x] Add canonical tenancy and mapping schemas.
- [x] Extend create/update/external registration requests.
- [x] Extend sanitized responses and OpenAPI.
- [x] Extend configuration-bundle schemas.
- [x] Add stable API error schemas.
- [x] Add schema compatibility tests for omitted dedicated mode.

### Phase 3: resolution and authorization

- [x] Implement the shared tenant-resolution service.
- [x] Add tenant role scope and tenant-safe permission validation.
- [x] Add tenant assignment inheritance to project/engine/runtime decisions.
- [x] Require resolved tenant inventory for shared resources.
- [x] Add mapping-version invalidation and snapshot refresh.
- [x] Extend Effective Access sources and audit explanations.

### Phase 4: provisioning APIs

- [x] Update manual create/update services and routes.
- [x] Update external engine upsert and field ownership.
- [x] Add topology preview/apply APIs.
- [x] Add mapping list/upsert APIs.
- [x] Update config preview/diff/apply/export for engine topology.
- [x] Add configuration-owned mapping rows and drift reconciliation.
- [x] Add lifecycle and reconciliation scheduling.

### Phase 5: runtime integration

- [x] Apply tenant resolution during runtime inventory ingestion.
- [x] Apply deployment-target strategy to runtime resources and receipts carrying project lineage.
- [x] Quarantine unresolved resources.
- [x] Update Mission Control collection/detail/mutation guards.
- [x] Update Runtime Resource Set materialization to require resolved same-tenant inventory.
- [x] Extend Engine Set materialization for topology transitions.
- [x] Prove engine transport is never called after tenant denial.

### Phase 6: UI and operations

- [x] Add engine topology controls and diagnostics.
- [x] Add tenant mapping management.
- [x] Add migration preview and acknowledgements.
- [x] Add metrics for unresolved/conflicting resources and fallback use.

### Phase 7: documentation and adoption

- [x] Publish all developer, API, data-model, user, administrator, migration, and
  troubleshooting Markdown deliverables listed above.
- [x] Add dedicated and shared examples for UI, API, and configuration provisioning.
- [x] Validate every machine-readable documentation example against the shipped
  schemas, OpenAPI document, and local contract harness.
- [x] Update CLI help, configuration examples, operator runbooks, upgrade notes,
  release notes, and the documentation index.
- [x] Publish the compatibility/deprecation timeline and external-integrator
  migration guide.
- [x] Complete independent documentation review with engineering, security, and
  operator roles. The retained evidence records the designated review mode
  (`human` or `delegated-agent`), exact commit, reviewer, timestamp, and
  sanitized findings.

### Phase 8: enforcement and cleanup

- [x] Run observe-only classification in representative local environments.
- [x] Resolve every ambiguous engine/resource.
- [x] Enable shared-engine fail-closed enforcement.
- [x] Make topology non-null.
- [ ] Remove temporary omission warnings after the external API deprecation window.
- [x] Retire any compatibility path that interprets null tenant as default.

The completed local technical gates are evidenced by `TEN-MIGRATION-008`,
`TEN-RUNTIME-007`, `TEN-AUTHZ-008` through `TEN-AUTHZ-012`, and the
[Engine Tenancy Functional Test Report](../development/engine-tenancy-functional-test-report.md).
Same-commit evidence assembly and independent review are complete for the
release-evidence snapshot at `b7514d76e7a885fe710350d9f3275fb857d552a2`. The
only remaining compatibility item is the intentionally retained external API
omission-warning window, tracked below.

### Phase 9: full release qualification

- [x] Publish a versioned functional-coverage manifest with exact test,
  documentation, CI, topology, runtime-mode, principal, tenant-relationship,
  resource, provisioning-channel, outcome, and evidence references.
- [x] Validate the manifest against the normative registry, OpenAPI operations,
  stable error enum, topology transition policy, CI commands, supported target
  declarations, and required mutation fault classes.
- [x] Retain sanitized traceability and mutation evidence without credentials,
  private endpoints, raw identity claims, or customer identifiers.
- [x] Retain a same-clean-commit source-coverage artifact after every
  security-critical module meets literal per-file 100% statements, branches,
  functions, and lines.
- [x] Execute database-backed custom-role matrices for direct users,
  group-derived users, API clients, and service accounts on PostgreSQL.
- [x] Publish and validate the machine-readable authorization state-space
  against every canonical principal type, resource type, permission scope,
  role scope, action operation, and action risk.
- [x] Execute Chromium local-stack provisioning, mapping, fail-closed runtime,
  migration, metrics, cleanup, and active-session revocation journeys.
- [x] Generate and execute the complete constraint-derived authorization
  state-space described below. Every supported behavior cell and every
  declared invalidity class must be accounted for, with zero unknown, missing,
  skipped, quarantined, or unexpected cells.
- [x] Execute the clean-install, every supported upgrade baseline, interrupted
  retry, schema-equivalence, service-behavior, rollback, and cleanup suites on
  PostgreSQL, MySQL, SQL Server, Oracle, and Spanner. The complete local run
  passes 35/35 stage cells and 10/10 upgrade-baseline observations and produces
  one equivalent logical-schema fingerprint.
- [x] Retain passing Chromium, Firefox, and WebKit results for the same clean
  commit for direct URL, stale-tab, multi-tab, refresh, history restoration,
  keyboard/accessibility names, and active-session revocation cases.
- [x] Complete the browser accessibility audit for error announcements,
  contrast, 200% zoom/reflow, and reduced motion in Chromium, Firefox, and
  WebKit with database-free retained evidence.
- [x] Execute all 14 provisioning-channel journeys below through the real local
  HTTP service and persistent database for every supported channel, recording
  documented stable errors for unsupported channel/action combinations. The
  executable denominator contains 30 required channel executions: journeys
  1–6 each use their matching channel and journeys 7–14 use all three.
  Journeys 1–14 are implemented and passing locally, including all three
  channels of Journeys 7–14: 14/14 journeys and 30/30 channel executions.
  Journey 14 proves decommission removes every direct engine/runtime
  assignment, retires mappings and inventory, denies already-authenticated
  browser and API sessions, and makes owner-channel recreation allocate a new
  stable engine ID.
- [x] Produce one fail-closed release evidence index that links the exact manifest,
  generated matrices, source coverage, mutation, database, functional browser,
  browser accessibility, documentation, compatibility-window, migration,
  retry, rollback, and cleanup artifacts; missing, dirty, or different-commit
  evidence remains visibly incomplete.
- [x] Complete independent Markdown documentation review by engineering,
  security, and operator roles using only the published procedures. All three
  approvals are retained against the release commit.
- [ ] Close the external API omission-warning compatibility window before
  removing that warning behavior.

### Completed end-to-end release sequence and compatibility handoff

The release sequence below was completed for the release-evidence snapshot at
`b7514d76e7a885fe710350d9f3275fb857d552a2`. Any future
compatibility-removal change must again update production code,
schemas/OpenAPI, the functional manifest, developer documentation, user
documentation, tests, and retained evidence together.

| Order | Work package | Required output and success criteria | Stop or rollback condition |
| --- | --- | --- | --- |
| 1 | Freeze a clean candidate | Run the manifest, deterministic shuffled engine-route lane, mutation, guarded local enforcement, and three-browser lanes. The engine route suite must run in its own isolated process with every shared mock reset; `requirement-evidence.json`, `mutation-report.json`, `local-enforcement.json`, and `browser-matrix.json` must name the same clean commit. | Any route result depends on source order, or any artifact is missing, dirty, stale, sanitized incorrectly, or refers to another commit. |
| 2 | Complete authorization generation | Completed locally. The canonical dimension/applicability registries generate 105,840 compressed cells, execute 52,560 applicable behavior cells plus 326 canonical structural cells, retain 12 invalidity witnesses, and prove 53,295,840 behavior-preserving action/observation expansions. `authorization-matrix.json` must retain zero unknown, missing, skipped, quarantined, or unexpected cells from one clean commit. |
| 3 | Qualify all database adapters | Completed locally. PostgreSQL, MySQL, SQL Server, Oracle, and Spanner pass clean install, both supported upgrade baselines, interruption/retry, schema equivalence, service behavior, rollback, and cleanup: 35/35 stage cells, 10/10 baseline observations, and one logical-schema fingerprint. The exact runbook and stop conditions are in [Qualify Engine Tenancy on Every Supported Database](../development/engine-tenancy-database-qualification.md). | Schema or behavior differs, retry is not idempotent, rollback loses explanatory metadata, cleanup leaves owned rows, or `database-matrix.json` is partial, dirty, stale, or from another commit. |
| 4 | Complete real-service provisioning journeys | Execute all 14 journeys through the local HTTP service and persistent database for manual UI, external API, and configuration channels where supported. Unsupported combinations must return their documented stable error. Write `provisioning-journeys.json` with 14/14 journeys, 30/30 required channel executions, and zero invalid or unexpected observations. Journeys 1–14 are implemented and passing locally. Journey 10 proves list/count/detail/mutation/batch/job/task/incident/history/deployment enforcement and records that a denied inventoried sibling makes no matching downstream engine call. Journey 11 keeps browser and HTTP sessions open while assignment revocation and mapping deactivation take effect immediately, then restores the exact mapping to prove cache invalidation. Journey 12 proves preview, acknowledgement, stale-preview conflict, apply, immediate shared-topology quarantine, and reverse transition for manual, hybrid-external/manual-tenancy-owner, and `config_warn` engines. Journey 13 rotates credentials twice through every owner, proves persisted values change without plaintext storage, preserves tenant ownership, and verifies public redaction; configuration diffing treats an opaque secret-reference change as an engine update. Journey 14 retires direct assignments, mappings, inventory, set materializations, runtime sets, and deployment targets, denies cached browser/API sessions immediately, preserves inactive history for external/config owners, and proves owner-channel recreation receives a new stable engine ID. Retain all observations on the same clean commit. | A channel silently changes topology/ownership, a retry duplicates state, a deny leaks data, or decommissioned access can reappear. |
| 5 | Finish browser accessibility | Add automated/manual evidence for error announcement, contrast, 200% zoom/reflow, and reduced motion. Re-run Chromium, Firefox, and WebKit after every browser-flow change. | A keyboard/screen-reader workflow cannot complete, content becomes unavailable at zoom, or stale authorization returns after any navigation/session path. |
| 6 | Complete documentation review | Engineering, security, and an independent operator execute the published Markdown only, retain sanitized Markdown findings under `test/results/engine-tenancy-review/`, and use the guarded recorder to approve the exact commit. Release policy designates each independent role as `human` or `delegated-agent`; that mode is retained with the reviewer identity. The generator preserves only complete same-commit approvals; the release index requires reviewer identity, mode, timestamp, existing evidence, and zero high-risk findings. | A guide needs undocumented knowledge, an example disagrees with runtime/OpenAPI, approval metadata/evidence is missing or stale, or any security finding remains unresolved. |
| 7 | Assemble and enforce release evidence | Run `pnpm run test:engine-tenancy:evidence-index` while iterating and `pnpm run test:engine-tenancy:release-evidence` for the final gate. The latter must report every required gate passing on the same clean commit. | The index is incomplete, a waiver is used as executed coverage, or the external omission-warning window has not closed when warning removal is proposed. |

The release index is intentionally useful before completion: it reports which
artifact is missing or stale. It becomes a release gate only with
`--require-complete`; declared targets, historical passes, and time-limited
waivers never count as executed coverage.

The index reports a clean same-commit documentation baseline awaiting
designated independent review as `pending_approval`. It does not misclassify
that state as stale, dirty, or a failed automated check, and it still keeps the
strict release gate closed until all three retained approvals pass.

## Complete Functional Coverage Standard

For this plan, **100% functional coverage** has a concrete, auditable meaning: every
normative requirement, supported operation, decision branch, state transition,
stable error, and documented user journey has at least one automated test that
proves its expected result. It does not mean claiming that every unrelated line in
the repository is executed.

The release index must calculate, retain, and require all of these ratios:

| Coverage set | Numerator | Denominator | Passing threshold |
| --- | --- | --- | ---: |
| Requirements | passing requirement IDs | normative registry IDs | 100% |
| Public contracts | passing operation and stable-error contracts | canonical OpenAPI operations and stable errors | 100% |
| State transitions | passing valid transitions and invalidity witnesses | canonical transitions and invalidity rules | 100% |
| Authorization | executed passing behavior cells and invalidity witnesses | all constraint-generated applicable cells and declared invalidity classes | 100% |
| Provisioning journeys | passing supported-channel journeys and documented unsupported results | canonical 14-journey/channel applicability registry | 100% |
| Database qualification | 35 passing adapter/stage cells, 10 passing adapter/baseline observations, one equivalent fingerprint | seven stages × five supported adapters, two baselines × five adapters, and one schema-equivalence set | 100% |
| Browser/accessibility | passing functional and accessibility observations | all declared workflows on Chromium, Firefox, and WebKit | 100% |
| Critical source modules | covered statements, branches, functions, and lines | instrumented elements in each declared critical module | 100% per file |
| Security mutation | killed required mutants | complete targeted mutation registry | 100% |
| Documentation | executable examples, valid links, and approved reviews | all documented examples/links plus engineering, security, and operator reviews | 100% |

Any new canonical registry entry expands its denominator immediately and therefore
fails the gate until it is classified and evidenced. A target declaration, sampled
pass, aggregate line percentage, equivalence claim without an expansion proof, or
waiver does not increase a numerator.

The HTTP contract denominator also requires order-independent execution. The
complete engine administration and external-provisioning route file runs alone
with a deterministic shuffle seed, one worker, and complete per-test dependency
reset. A route pass produced only in a larger shared module process is not
release evidence.

Create a machine-readable functional coverage manifest at
`test/authz/engine-tenancy-functional-coverage.json`. Every entry must contain:

- a stable requirement ID;
- the requirement and source section;
- topology and runtime-access dimensions;
- applicable principal, tenant, resource, and provisioning-channel dimensions;
- expected allow, deny, quarantine, conflict, or audit outcome;
- automated test file and test name;
- documentation page and example, when user-visible;
- CI job and retained evidence artifact.

Use stable requirement families:

- `TEN-MODEL-*` for persistence and invariants;
- `TEN-RESOLVE-*` for tenant resolution and fallback;
- `TEN-DEDICATED-*` and `TEN-SHARED-*` for topology behavior;
- `TEN-AUTHZ-*` for grants, inheritance, denial, and revocation;
- `TEN-API-*`, `TEN-CONFIG-*`, and `TEN-UI-*` for provisioning channels;
- `TEN-MIGRATION-*` for classification, transitions, and rollback;
- `TEN-RUNTIME-*` for inventory and upstream-call protection;
- `TEN-AUDIT-*` for event and explanation coverage;
- `TEN-DOCS-*` for documented journeys and executable examples.

The manifest validator must fail CI when:

- a normative plan requirement has no requirement ID;
- an ID has no executable test evidence;
- a public endpoint, stable error, or supported state transition is absent;
- a matrix dimension is silently skipped;
- a documented example does not map to a passing contract or end-to-end test;
- a test is skipped, quarantined, or removed without an explicit expiring waiver.

Required coverage thresholds are:

- 100% of functional requirement IDs linked to passing automated tests;
- 100% of public tenancy/provisioning API operations and stable errors;
- 100% of supported valid and invalid topology/mapping state transitions;
- 100% allow/deny/audit coverage for security-sensitive actions;
- 100% statements, branches, functions, and lines for new security-critical pure
  modules, including tenant resolution, transition planning, mapping reconciliation,
  and schema refinements;
- 100% killed mutants in the targeted security mutation set, including removed
  tenant filters, inverted ownership checks, accepted null tenant context, skipped
  mapping-version checks, and upstream calls after denial.

Any unavoidable platform or browser exclusion must be represented by a time-limited
waiver with an owner, reason, equivalent evidence, and expiry date. Waivers do not
count as covered functional requirements.

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

Add property-based and fuzz coverage for tenant references, resource keys, mapping
batches, unknown fields, malformed identifiers, duplicate mappings, invalid topology
combinations, and version boundaries. Generated examples must round-trip through
parse, serialize, OpenAPI validation, and parse again without semantic drift.

### Exhaustive authorization state-space

A blind Cartesian product is neither the coverage denominator nor an acceptable
shortcut. It would multiply mutually exclusive states, such as shared topology
with engine-wide runtime access, and repeat behaviorally identical permission
powersets billions of times. Instead, generate the finite authorization
state-space from the canonical registries and explicit applicability rules.
This is still exhaustive functional coverage: nothing may disappear from the
input registries or be excluded without a named, tested rule.

The generator must consume:

- principal: user, group-derived user, API client, and service account;
- assignment scope: platform, tenant, project, dedicated engine, shared runtime
  resource, Engine Set, and Runtime Resource Set;
- topology: dedicated and shared;
- runtime access: engine-wide and resource-aware where valid;
- permission source: predefined role, custom role, direct assignment, group
  assignment, and inherited assignment;
- assignment state: active, future, expired, revoked, deleted, and stale cached;
- tenant relationship: same tenant, sibling tenant, unrelated tenant, missing
  context, conflicting context, and deleted tenant;
- secured object type: tenant, project, engine, Engine Set, every registered runtime
  resource type, Runtime Resource Set, deployment target, deployment receipt,
  migration, job, task, incident, and history record;
- permission: every canonical permission individually, every predefined role, and
  every tenant-safe custom-role composition;
- resource state: mapped, unmapped, multiply mapped, stale mapping, quarantined,
  deleted, and re-created with a new stable identifier;
- action sensitivity: read, mutate, administer, credential/secret, and destructive.

The implementation must have four machine-readable inputs:

1. a **dimension registry** populated from the production permission, action,
   resource-type, principal-type, role, topology, transition, and stable-error
   registries;
2. an **applicability registry** that gives each invalid tuple a stable rule ID,
   reason, expected stable error or deny reason, and at least one executed witness;
3. an **independent expectation model** that derives allow, deny, filtering,
   Effective Access, audit, and no-upstream-call expectations without invoking the
   production evaluator; and
4. an **execution registry** that maps each generated cell or invalidity witness to
   an executable unit, database integration, HTTP, or browser test.

Every generated valid cell must assert the decision, filtered result set, Effective
Access explanation, audit event, and whether the upstream engine was called when
those observations apply. Invalid combinations must be rejected by a named rule;
they cannot be silently filtered out. Equivalence compression is allowed only for
mathematically redundant tuples and must retain the expansion count and rule that
proves why the tuples have identical behavior. Pairwise-only sampling is not
permitted across security boundaries.

Custom-role coverage must prove:

- every tenant-safe permission individually at every supported scope;
- every platform-only, credential, secret, and otherwise prohibited permission is
  rejected at tenant scope;
- every predefined role and every custom-role composition that crosses distinct
  policy classes or introduces a permission interaction;
- the union behavior of independent permissions, with a generator proof that
  adding an independent permission cannot remove a grant or widen its scope;
- direct and group inheritance, scope narrowing, same/sibling/unrelated tenant
  behavior, future/expiry/revocation, edit invalidation, role deletion, and
  stale-session invalidation; and
- parity for users, API clients, and service accounts wherever that principal type
  is supported.

The authorization evidence artifact must report:

- `coverageStandard: "constraint-derived-authorization-state-space"` and a
  non-empty `canonicalInputHash`;
- `canonicalValueCount` and equal `classifiedCanonicalValueCount`;
- `rawTupleCount`, `applicableCellCount`, equal
  `executedApplicableCellCount`, and `equivalenceExpandedCellCount`;
- `invalidityClassCount` and equal `executedInvalidityWitnessCount`;
- `missingCells`, `skippedCells`, `quarantinedCells`, `unknownCells`, and
  `unexpectedCells`, all equal to zero;
- coverage by every dimension value, action, permission, role, secured resource
  type, and invalidity rule;
- deterministic seed and shard information; and
- exact clean commit and sanitization status.

`authorization-matrix.json` passes only when every canonical value is classified,
every applicable cell and invalidity witness executes, and all missing, skipped,
quarantined, unknown, and unexpected counts are zero.

The repository provides `pnpm run test:authz:state-space-evidence` as the
fail-closed evidence runner. It executes the canonical contracts, independent
expectation model, production-facing unit tests, guarded PostgreSQL model,
three-browser stale-session matrix, and localhost decommission/recreation
journeys. It classifies 105,840 compressed cross-boundary cells, executes
52,560 applicable behavior cells plus 326 canonical action/permission/role
cells, records 12 invalidity witnesses, and proves 53,295,840
behavior-preserving action/observation expansions. The artifact qualifies only from an unchanged clean
commit with all five gap counters equal to zero.

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

### Provisioning-channel end-to-end journeys

Run each supported journey through the real local HTTP service, persistent database,
authorization evaluator, and UI where applicable:

The machine-readable denominator is
`test/authz/engine-tenancy-provisioning-journeys.json`. It records the required
30 channel executions and assertions for each journey. Assemble the current
fail-closed artifact with
`pnpm run test:engine-tenancy:provisioning-evidence`; no journey counts from a
unit test, mocked HTTP handler, sampled assertion, dirty worktree, stale
commit, or undocumented channel exclusion.

1. manually create, inspect, update, reconcile, and remove a dedicated engine;
2. externally upsert the same dedicated lifecycle with idempotent retries;
3. apply, export, reapply, and remove the same dedicated lifecycle by configuration;
4. manually create a shared engine, map two tenants, and resolve inventory;
5. externally provision the same shared engine and mapping lifecycle;
6. apply and round-trip the same shared lifecycle by configuration;
7. ingest resources and prove dedicated inheritance or shared explicit resolution;
8. assign predefined and custom roles to users, groups, clients, and service accounts;
9. verify Effective Access source, tenant lineage, expiry, and mapping version;
10. exercise list, count, detail, mutation, batch, job, task, incident, history, and
    deployment paths with filtered and denied results;
11. revoke assignments and remove mappings during an active browser/API session;
12. transition dedicated to shared and shared to dedicated with preview,
    acknowledgement, concurrency conflict, apply, cache invalidation, and rollback;
13. rotate engine credentials without changing tenant ownership;
14. decommission an engine and prove assignments, mappings, inventory, and cached
    access cannot resurrect it.

For every journey, repeat the contract assertions for manual UI, external API, and
configuration bundle wherever that channel is supported. Unsupported channel/action
combinations must return a documented stable error.

### Migration, transition, and configuration

- existing dedicated classification;
- ambiguous resource-aware classification requires review;
- migration is idempotent across supported databases;
- PostgreSQL, MySQL, SQL Server, Oracle, and Spanner produce equivalent canonical
  entities, constraints, indexes, and service behavior;
- clean install, upgrade from every supported schema baseline, interrupted migration
  retry, partially classified data, duplicate data, and downgrade/rollback;
- config preview/diff/apply/export round trip;
- source ownership and drift behavior;
- rollback restores topology/mappings and invalidates snapshots;
- audit records contain no secrets or cross-tenant data.

### Resilience, concurrency, and isolation

- concurrent engine upserts with the same and different idempotency keys;
- concurrent mapping edits using the same and stale versions;
- inventory arrival before, during, and after topology changes;
- database, cache, queue, and external-engine outages;
- retry and replay after timeouts without duplicate engines or audit gaps;
- stale authorization snapshots after role, assignment, topology, tenant, or mapping
  changes;
- fail-closed behavior when tenant lookup, mapping lookup, or audit persistence is
  unavailable according to the documented failure policy;
- no test depends on production credentials, deployed identity providers, or shared
  mutable test data;
- isolated fixtures use unique tenants and engines and are removed by a verified
  sweeper after success and failure.

### Browser coverage

- dedicated creation defaults visibly to the default tenant;
- shared creation forces resource-aware access;
- mapping diagnostics are accessible by keyboard and screen reader;
- Effective Access shows tenant and mapping lineage;
- cross-tenant access is denied after browser-session reuse;
- Chromium PR gate plus scheduled Firefox/WebKit coverage;
- keyboard-only, focus order, accessible names, error announcement, contrast, zoom,
  and reduced-motion checks for every new workflow;
- direct URL, stale tab, back/forward cache, multi-tab revocation, and session refresh
  tests;
- screenshots, traces, network logs, and tenant-safe failure artifacts retained for
  every failed matrix case.

### Documentation tests

- every documented JSON/YAML payload validates against the canonical schema;
- every documented `curl` request executes against the local contract stack;
- every documented success and error response matches OpenAPI;
- internal links, anchors, navigation, and referenced configuration keys exist;
- dedicated, shared, migration, rollback, and troubleshooting guides each map to a
  passing end-to-end journey;
- examples are scanned for secrets and non-placeholder customer identifiers.

### Coverage reporting

CI must publish a single evidence bundle containing:

- the validated functional coverage manifest and uncovered-ID count of zero;
- generated authorization and state-transition matrices with zero missing cells;
- unit/integration/end-to-end results by database, provisioning channel, and browser;
- source coverage for security-critical modules at 100% for statements, branches,
  functions, and lines;
- targeted mutation report with all defined security mutants killed;
- OpenAPI/schema/documentation parity results;
- browser traces and sanitized failure artifacts;
- migration classification, retry, and rollback evidence.

The evidence bundle must identify the commit, schema version, browser/database
versions, test seed, and any active waiver. A green aggregate percentage without
the underlying requirement and matrix evidence is insufficient.

## End-to-End Definition of Done

The implementation is end-to-end complete only when a clean local installation and
an upgraded installation can both:

1. provision dedicated and shared engines through UI, external API, and
   configuration bundles using the same canonical contracts;
2. persist explicit topology and tenant ownership or mappings on every supported
   database;
3. ingest inventory and resolve exactly one tenant before exposing a resource;
4. grant predefined and custom-role access to users, groups, API clients, and
   service accounts;
5. show accurate Effective Access and audit lineage;
6. filter or deny every runtime path and prove denied requests do not call the
   upstream engine;
7. revoke access immediately after assignment, role, topology, tenant, or mapping
   changes;
8. preview, apply, reconcile, and roll back topology/mapping changes safely;
9. complete all documented operator journeys using only the published Markdown
   guides;
10. produce the complete passing evidence bundle defined above.

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
- every canonical permission and secured object type appears in the generated
  authorization matrix with its valid allow, deny, inheritance, and revocation
  cases;
- browser and active-session revocation tests are green;
- failure artifacts and tenant-resolution diagnostics are retained in CI;
- the functional coverage manifest reports 100% requirement, endpoint, stable-error,
  and state-transition coverage with no skipped or quarantined tests;
- new security-critical pure modules report 100% statements, branches, functions,
  and lines;
- every targeted security mutant is killed;
- every named developer, user, administrator, API, migration, and troubleshooting
  Markdown deliverable is published, linked, and reviewed;
- all documented machine-readable examples pass schema, OpenAPI, and local execution
  checks;
- OpenAPI, Zod schemas, implementation, configuration reference, and Markdown API
  reference are proven equivalent;
- the End-to-End Definition of Done passes on clean-install and upgrade test paths;
- no implementation-phase checkbox remains open without an approved, expiring
  release waiver.

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
