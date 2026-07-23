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

## Implementation Status

Phases 1–4 are complete, including explicit topology persistence, portable
tenant references, tenant roles, manual and external provisioning, guarded
topology transitions, and configuration-owned mapping reconciliation.
Configuration mappings use a separate `engine-tenant-mappings.json` family,
retain the authorized tenant reference for portable export, preserve other
sources, re-resolve known runtime inventory atomically, and schedule bounded
post-apply reconciliation.

The remaining implementation work is concentrated in topology/mapping UI and
metrics, and final documentation/example/browser adoption gates. Engine Set
transition rematerialization, Mission Control runtime guards, and
transport-denial proof are implemented.

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
  variants, coverage artifacts, failure diagnosis, and test-data cleanup.

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
- [ ] Add architecture decision records for default fallback and shared-engine fail-closed behavior.
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

- [ ] Add engine topology controls and diagnostics.
- [ ] Add tenant mapping management.
- [ ] Add migration preview and acknowledgements.
- [ ] Add metrics for unresolved/conflicting resources and fallback use.

### Phase 7: documentation and adoption

- [ ] Publish all developer, API, data-model, user, administrator, migration, and
  troubleshooting Markdown deliverables listed above.
- [ ] Add dedicated and shared examples for UI, API, and configuration provisioning.
- [ ] Validate every machine-readable documentation example against the shipped
  schemas, OpenAPI document, and local contract harness.
- [ ] Update CLI help, configuration examples, operator runbooks, upgrade notes,
  release notes, and the documentation index.
- [ ] Publish the compatibility/deprecation timeline and external-integrator
  migration guide.
- [ ] Complete documentation review with engineering, security, and an operator who
  did not implement the feature.

### Phase 8: enforcement and cleanup

- [ ] Run observe-only classification in representative local environments.
- [ ] Resolve every ambiguous engine/resource.
- [ ] Enable shared-engine fail-closed enforcement.
- [ ] Make topology non-null.
- [ ] Remove temporary omission warnings after the external API deprecation window.
- [ ] Retire any compatibility path that interprets null tenant as default.

## Complete Functional Coverage Standard

For this plan, **100% functional coverage** has a concrete, auditable meaning: every
normative requirement, supported operation, decision branch, state transition,
stable error, and documented user journey has at least one automated test that
proves its expected result. It does not mean claiming that every unrelated line in
the repository is executed.

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

### Exhaustive authorization matrix

Generate, rather than hand-maintain, the Cartesian matrix of:

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

Invalid combinations must be asserted as rejected rather than omitted. Each valid
cell must assert the decision, filtered result set, Effective Access explanation,
audit event, and whether the upstream engine was called. Pairwise reduction is not
permitted for security boundaries; every supported matrix cell must execute.

Custom-role tests must cover every tenant-safe permission individually, all allowed
combinations, rejection of platform-only and secret permissions, group inheritance,
scope narrowing, expiry, revocation, edit invalidation, and role deletion.

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
