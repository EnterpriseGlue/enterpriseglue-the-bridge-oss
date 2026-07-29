# Engine Tenancy and Provisioning API

Summary: Developer contract for dedicated/shared engine provisioning and tenant
reference resolution.

Audience: Backend developers, enterprise-plugin implementers, API integrators,
and security reviewers.

Status: Manual and external create/update tenancy contracts, tenant mapping
administration, diagnostics, and runtime reconciliation are implemented.
Classification, topology transition APIs, and configuration-owned mapping
reconciliation are implemented.

Engine tenancy and inventory are independent from SSO/access authority. See
[Access Governance and Headless Configuration API](./access-governance-and-headless-api.md)
for Platform Settings, read-only UI behavior, and headless bundle ownership.

## Request Contract

Manual create, manual update, and external registration requests accept the
same optional `tenancy` object.

Dedicated in the authenticated request tenant:

<!-- enterpriseglue-config-schema: EngineTenancyConfigurationSchema -->
```json
{
  "mode": "dedicated",
  "tenantRef": { "type": "request_context" }
}
```

Dedicated in the installation default tenant:

<!-- enterpriseglue-config-schema: EngineTenancyConfigurationSchema -->
```json
{
  "mode": "dedicated",
  "tenantRef": { "type": "default" }
}
```

Dedicated using a deployment-specific stable reference:

<!-- enterpriseglue-config-schema: EngineTenancyConfigurationSchema -->
```json
{
  "mode": "dedicated",
  "tenantRef": { "type": "key", "key": "tenant.team-a" }
}
```

Shared:

<!-- enterpriseglue-config-schema: UpdateEngineRequestSchema -->
```json
{
  "runtimeAccessScope": "resource_aware",
  "tenancy": {
    "mode": "shared",
    "mappingStrategy": "engine_tenant_id",
    "unmappedPolicy": "deny"
  }
}
```

`unmappedPolicy` can only be `deny`. Shared creation stores an incomplete,
quarantined engine until mapping administration and runtime reconciliation are
completed. HTTP 201 does not mean a shared engine is authorization-ready.

## Engine Inventory Contract

`GET /engines-api/engines` is authorization filtered. With no query parameter,
it is safe for runtime selectors: an unresolved shared engine is absent until
the caller can see at least one resolved runtime resource.

The Engines administration page uses:

```text
GET /engines-api/engines?includeManageableShared=true
```

This explicit mode may additionally return an unresolved shared engine only
when the caller has `engine:edit` for that exact engine. It does not change
runtime-resource visibility, tenant mapping resolution, or downstream engine
transport authorization. The only accepted values are the strings `true` and
`false`; unknown query fields and other values return HTTP 400.

## Manual API Lifecycle

Create requests require engine-inventory creation permission and use the
authenticated tenant context:

<!-- enterpriseglue-curl-contract: POST /engines-api/engines CreateEngineRequestSchema -->
```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/engines" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Team A engine",
    "baseUrl": "https://team-a.example.test/engine-rest",
    "type": "operaton",
    "connectionMode": "direct",
    "runtimeAccessScope": "engine_wide",
    "tenancy": {
      "mode": "dedicated",
      "tenantRef": { "type": "request_context" }
    }
  }'
```

Ordinary updates may change connection metadata or rotate an opaque secret
reference, but cannot change topology, dedicated tenant, or mapping strategy:

<!-- enterpriseglue-curl-contract: PUT /engines-api/engines/{id} UpdateEngineRequestSchema -->
```bash
curl --fail-with-body \
  -X PUT "$ENTERPRISEGLUE_URL/engines-api/engines/$ENGINE_ID" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "authType": "basic",
    "username": "enterpriseglue",
    "passwordEnc": "ref:env://TEAM_A_ENGINE_PASSWORD_V2"
  }'
```

## Customer-sidecar Registration API

Set `connectionMode` to `customer_sidecar` when `baseUrl` is a
customer-owned gateway rather than the underlying engine. The configured
authentication values apply only to the EnterpriseGlue-to-sidecar request.
Never provide the sidecar-to-engine peer token or engine credential to this
API. `authType: "none"` is accepted only for a policy-approved private
sidecar; a direct engine must have EnterpriseGlue-managed endpoint
authentication.

<!-- enterpriseglue-curl-contract: POST /engines-api/engines CreateEngineRequestSchema -->
```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/engines" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Payments customer sidecar",
    "baseUrl": "https://payments-sidecar.example.test/engine-rest",
    "type": "operaton",
    "connectionMode": "customer_sidecar",
    "authType": "basic",
    "username": "enterpriseglue-sidecar",
    "passwordEnc": "ref:env://PAYMENTS_SIDECAR_UPSTREAM_PASSWORD",
    "runtimeAccessScope": "resource_aware",
    "tenancy": {
      "mode": "dedicated",
      "tenantRef": { "type": "request_context" }
    }
  }'
```

The customer sidecar's bounded mirrored-backstop adapter has a separate v1
contract. It permits only tracked native-authorization create/read/delete
operations, owns its downstream authentication, and fails closed with no
direct-engine fallback. See the
[Customer Sidecar Backstop Adapter API](./customer-sidecar-backstop-adapter-api.md).

Deletion requires engine-inventory deletion permission. Export the topology,
mappings, assignments, and diagnostics first; an externally owned engine must
use its decommission workflow instead.

<!-- enterpriseglue-curl-contract: DELETE /engines-api/engines/{id} none -->
```bash
curl --fail-with-body \
  -X DELETE "$ENTERPRISEGLUE_URL/engines-api/engines/$ENGINE_ID" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN"
```

## Tenant Mapping API

For an engine created with `tenancy.mode = shared`, administrators can list and
atomically apply mappings:

```text
GET /engines-api/engines/{id}/tenant-mappings
PUT /engines-api/engines/{id}/tenant-mappings
GET /engines-api/engines/{id}/tenancy/diagnostics
```

Example apply request:

<!-- enterpriseglue-config-schema: ExternalEngineTenantMappingsUpsertRequestSchema -->
```json
{
  "expectedMappingVersion": 0,
  "dryRun": false,
  "atomic": true,
  "mappings": [
    {
      "externalTenantId": "payments",
      "tenantRef": { "type": "key", "key": "tenant.payments" },
      "strategy": "engine_tenant_id",
      "sourceRef": "central-prod/payments",
      "active": true
    }
  ]
}
```

The equivalent version-guarded call is:

<!-- enterpriseglue-curl-contract: PUT /engines-api/engines/{id}/tenant-mappings ExternalEngineTenantMappingsUpsertRequestSchema -->
```bash
curl --fail-with-body \
  -X PUT "$ENTERPRISEGLUE_URL/engines-api/engines/$ENGINE_ID/tenant-mappings" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "expectedMappingVersion": 0,
    "dryRun": true,
    "atomic": true,
    "mappings": [
      {
        "externalTenantId": "payments",
        "tenantRef": { "type": "key", "key": "tenant.payments" },
        "strategy": "engine_tenant_id",
        "sourceRef": "central-prod/payments",
        "active": true
      }
    ]
  }'
```

Every row must use the engine's declared mapping strategy. The service resolves
and authorizes all tenant references before opening the write transaction. The
batch is rejected if mapping identities or source references are duplicated,
owned by another source, or the expected version is stale. Deactivate a mapping
by sending its stable identity and source reference with `active: false`.

Use `dryRun: true` with the current version before applying operator-generated
changes. A changed atomic batch increments `mappingVersion` once, immediately
reconciles existing runtime inventory, and reports mapped, unmapped, and
conflicting counts. A no-op preserves the current version.

External inventory systems use:

```text
PUT /engines-api/external/engines/{externalId}/tenant-mappings
```

The body uses the same mapping batch and may include `externalSystemId`. It
requires the engine-registration API-client scope, authorization for the
external engine system, and authorization for every tenant reference. Mapping
ownership is recorded as `external` / `external_managed`.

An engine is runtime-ready only when diagnostics report no unmapped or
conflicting active resources. An empty shared engine with at least one active
mapping can report ready; readiness must be checked again after inventory
reconciliation.

## Decommission and Stable-Identity Contract

External owners retire an engine with:

```text
POST /engines-api/external/engines/decommission
```

An authoritative bundle retires a configuration-owned engine by omitting it.
Manual owners use `DELETE /engines-api/engines/{id}`. All three paths remove
direct engine and runtime-resource assignments, leave no active mapping or
runtime-inventory row, remove set materializations, retire engine-bound Runtime
Resource Sets and deployment targets, and deny existing sessions immediately.
External/config paths retain inactive history; manual deletion removes the
owned rows.

A later external upsert of the same `externalId` or bundle apply of the same
engine key is a create, not an update of the retired row. The response has a
new stable engine ID. Authorization and runtime calls using the old ID remain
denied. Explicit platform-administrator reactivation is a separate recovery
operation and does not restore assignments, mappings, or inventory.

## Configuration Bundle Mapping Contract

Configuration bundles declare shared-engine mappings in
`./engine-tenant-mappings.json`, separately from engine connection topology:

<!-- enterpriseglue-config-schema: ConfigEngineTenantMappingsFileSchema -->
```json
{
  "engineTenantMappings": [
    {
      "key": "engine-tenant-mapping.central-payments",
      "engineRef": { "engineKey": "engine.central" },
      "externalTenantId": "payments",
      "tenantRef": { "type": "key", "key": "tenant.payments" },
      "strategy": "engine_tenant_id",
      "active": true,
      "ownershipMode": "config_locked"
    }
  ]
}
```

Declare both `./engines.json` and `./engine-tenant-mappings.json` in the bundle
imports. Preview verifies that the engine is shared and that both files use the
same strategy. Diff resolves the tenant reference with the authenticated
principal and enterprise resolver, reports mapping changes under
`objectType = engine_tenant_mapping`, and reports a conflict if another source
owns the desired identity.

Apply uses the normal preview hash, idempotency, and acknowledgement contract.
Mapping writes and known-resource re-resolution occur inside the config
transaction. A changed engine is then placed on the bounded runtime
reconciliation queue. An authoritative omission requires:

```text
config.authoritative_archive:engine_tenant_mapping:{mappingKey}
```

and disables only mapping rows owned by that bundle. It does not remove manual,
API, external, system, or other-bundle rows. Additive bundles never retire
omitted mappings.

Use `config_locked` when only the bundle may change the row. `config_warn`
permits a reviewed manual override while retaining config ownership; the next
diff exposes the drift and the next apply restores the declared state.

Export preserves the stable mapping key, engine key, and original authorized
tenant key. Rows created before tenant-reference metadata existed use a safe
legacy fallback. Never infer mappings from shared topology alone.

The mounted configuration bootstrap passes the installed enterprise tenant
resolver with principal type `system` and principal ID
`system:config-bootstrap`. A tenant key that cannot be resolved and authorized
there fails bootstrap through the normal fail-closed configuration status.

## Mission Control Runtime Boundary

### Variable-value disclosure boundary

Mission Control variable routes require `engine:variables:metadata:view` to
return variable identity and type. `engine:variables:value:view` is checked by
the backend after the route's exact runtime-resource authorization has resolved
the engine/process scope. If that second check is denied, the response contains
only safe metadata with `value: null` and `valueRedacted: true`; raw values,
`valueInfo`, and adapter-specific value payloads are removed before JSON
serialization.

`engine:variables:edit` is valid only with both metadata and value permissions,
and the mutation route performs the same value-access check at runtime. The
historic `variableValue` query filter requires an engine-wide value permission;
this avoids using a metadata result count as a value-discovery oracle. PII
redaction is applied even when value access succeeds.

All Mission Control collection, definition, referenced-detail, batch,
deployment, and migration routes use the canonical runtime-resource guard.
For a shared engine, a broad engine grant does not enable the engine-wide fast
path. The guard returns only active resources with:

- `tenantResolutionStatus = resolved`;
- the authenticated EnterpriseGlue tenant;
- the requested process/decision resource kind; and
- permission for the exact runtime resource.

Collection handlers receive `authorizedRuntimeResourceKeys` plus sanitized
`authorizedRuntimeResourceScopes` and push both key and engine runtime tenant to
the upstream API. They still apply a bounded local filter to the response.

Exact key operations require one runtime tenant scope. Process starts and
decision evaluations with a non-empty runtime tenant use the upstream
`tenant-id/{tenantId}` path. Empty runtime tenant uses the upstream no-tenant
partition. Missing or multiple scopes return 403.

An unresolved shared resource returns 403 before the downstream route handler.
When no authorized resource is visible, no engine transport is attempted.
Historical IDs may require one bounded metadata resolution after that preflight;
the resolved key and runtime tenant must match authorized inventory before any
read or mutation continues.

## Compatibility

Internal manual create compatibility may resolve omitted dedicated tenancy from
the request context or the OSS default. External registration requires an
explicit declaration: an omitted value is rejected with HTTP 400 before it can
read or overwrite any engine. Manual update omission still preserves existing
topology.

## Classification and Transition API

Platform engine administrators can inventory migration state without changing
it:

```text
GET /engines-api/engines/tenancy/classification-report
```

The report returns only sanitized engine topology and recommendations. An
unowned `engine_wide` engine can be proposed for the configured default tenant.
An unowned `resource_aware` engine requires human review; it is not inferred as
shared.

Owned engines require `engine:edit` for preview/apply. A null-owned dedicated
engine is not tenant-visible and cannot receive an ordinary engine assignment.
Only when it is quarantined as `migration_required` may
`platform:engine-registration:manage` authorize these two migration operations.
That exception does not authorize any engine collection, detail, invitation,
assignment, or runtime route.

Preview a manual transition:

```http
POST /engines-api/engines/{id}/tenancy/preview
Content-Type: application/json

{
  "tenancy": {
    "mode": "shared",
    "mappingStrategy": "engine_tenant_id",
    "unmappedPolicy": "deny"
  }
}
```

The response reports aggregate affected objects and visibility changes, for
example:

<!-- enterpriseglue-config-schema: EngineTenancyTransitionPreviewResponseSchema -->
```json
{
  "engineId": "engine-1",
  "kind": "dedicated_to_shared",
  "current": {
    "mode": "dedicated",
    "tenantId": "tenant-a",
    "mappingStrategy": null,
    "mappingVersion": 0,
    "resolutionStatus": "ready",
    "runtimeAccessScope": "engine_wide"
  },
  "proposed": {
    "mode": "shared",
    "tenantId": null,
    "mappingStrategy": "engine_tenant_id",
    "mappingVersion": 1,
    "resolutionStatus": "incomplete",
    "runtimeAccessScope": "resource_aware"
  },
  "effects": {
    "roleAssignments": 2,
    "tenantMappings": 0,
    "runtimeResources": 12,
    "engineSetMemberships": 1,
    "deploymentTargets": 2,
    "deploymentReceipts": 8,
    "visibility": {
      "becomeVisible": 0,
      "becomeHidden": 12,
      "becomeUnmapped": 12,
      "becomeConflicting": 0
    }
  },
  "requiredAcknowledgements": [
    "acknowledge_topology_change",
    "acknowledge_resource_quarantine",
    "acknowledge_access_change"
  ],
  "previewHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "previewExpiresAt": 1900000000000
}
```

Apply the reviewed transition before expiration:

```http
POST /engines-api/engines/{id}/tenancy/apply
Content-Type: application/json

{
  "tenancy": {
    "mode": "shared",
    "mappingStrategy": "engine_tenant_id",
    "unmappedPolicy": "deny"
  },
  "previewHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "previewExpiresAt": 1900000000000,
  "acknowledgements": [
    "acknowledge_topology_change",
    "acknowledge_resource_quarantine",
    "acknowledge_access_change"
  ]
}
```

Apply recomputes the fingerprint inside its transaction. Any engine,
assignment, mapping, inventory, Engine Set, deployment-target, or receipt
change invalidates the preview. Successful apply invalidates materializations
and schedules runtime reconciliation.

After classification, preview/apply requires engine edit access. External-owned
topology and configuration-locked topology must be changed through their owning
source; manual routes reject them.

## Enterprise Resolver Extension

An enterprise backend plugin may implement:

```ts
getEngineTenantReferenceResolver(ctx) {
  return {
    async resolve({ reference, requestTenantId, principalType, principalId }) {
      // Resolve the stable reference and authorize this principal.
      return {
        tenantId: 'tenant-internal-id',
        tenantKey: 'tenant.team-a',
        authorized: true
      }
    }
  }
}
```

Return `authorized: false` for a known tenant the principal cannot use, and
`null` when no resolution can be made. Never return credentials, directory
claims, or tenant inventory. The host installs this resolver before base routes
are registered.

## Operational Metrics API

`GET /metrics` includes the existing configuration-bootstrap metrics and these
Prometheus engine-tenancy series:

```text
enterpriseglue_engine_tenancy_metrics_collection_success
enterpriseglue_engine_tenancy_engines{mode,resolution_status}
enterpriseglue_engine_tenancy_runtime_resources{resolution_status}
enterpriseglue_engine_tenancy_default_fallback_total{principal_type,declaration}
```

The route is unauthenticated for infrastructure scraping, so it exposes only
bounded aggregate labels. It never exposes an engine, tenant, mapping,
resource, URL, or principal identifier. The fallback total is process-local
and resets on backend restart. Persistence collection failure produces
`enterpriseglue_engine_tenancy_metrics_collection_success 0` while keeping the
scrape valid and the process-local counters available.

## Stable Errors

| HTTP | Code | Meaning | Retry |
| --- | --- | --- | --- |
| 400 | `ENGINE_SHARED_REQUIRES_RESOURCE_AWARE` | Shared topology was paired with engine-wide authorization | Correct request |
| 403 | `ENGINE_TENANT_REFERENCE_FORBIDDEN` | Reference was denied or cannot be proven locally | Obtain access or configure resolver |
| 409 | `ENGINE_TENANCY_TRANSITION_REQUIRED` | Ordinary update would change topology, tenant, or mapping strategy | Use transition workflow when available |
| 409 | `ENGINE_TENANCY_PREVIEW_STALE` | Engine or affected state changed after preview | Create and review a new preview |
| 409 | `ENGINE_TENANCY_PREVIEW_EXPIRED` | Five-minute preview window elapsed | Create and review a new preview |
| 400 | `ENGINE_TENANCY_ACKNOWLEDGEMENT_REQUIRED` | One or more preview acknowledgements were omitted | Submit every ID returned by the new preview |
| 409 | `ENGINE_TENANT_MAPPING_VERSION_CONFLICT` | Mapping version changed after the caller read it | Refresh diagnostics/mappings and retry |
| 409 | `ENGINE_TENANCY_CONFLICT` | Mapping identity, source ownership, strategy, or resolution is inconsistent | Correct the batch or ownership conflict |

The canonical error body is:

<!-- enterpriseglue-config-schema: EngineTenancyErrorResponseSchema -->
```json
{
  "error": "Changing engine tenancy topology requires the dedicated transition workflow",
  "code": "ENGINE_TENANCY_TRANSITION_REQUIRED",
  "field": "tenancy"
}
```

Errors are sanitized and do not reveal whether another tenant exists.

## Persistence Invariants

- Dedicated: one non-null `tenantId`, null mapping strategy, status `ready`.
- Shared: null engine `tenantId`, non-null mapping strategy, and only resolved
  runtime rows are tenant-visible.
- Ordinary updates never mutate topology.
- External registration requires explicit tenancy and rejects omission before
  persistence.
- Mapping writes are atomic and version guarded.
- Configuration mapping ownership is source-scoped; authoritative apply cannot
  retire another source's rows.
- Runtime resolution records the mapping id and version; missing or conflicting
  matches have no tenant and remain quarantined.
- Runtime access scope and topology remain separate, although shared requires
  resource-aware scope.

## Verification

Run `pnpm run test:engine-tenancy:provisioning` for provisioning and
`pnpm run test:engine-tenancy:mappings` for mapping, runtime, configuration,
authorization-registry, schema, and OpenAPI contracts. Run
`pnpm run test:engine-tenancy:transitions` for the complete transition matrix,
classification, concurrency, route, schema, OpenAPI, audit, and 100% critical
policy coverage. Run `pnpm run test:engine-tenancy:operations` for operational
metrics, privacy, failure behavior, and exact source coverage. Every lane
validates the machine-readable functional coverage manifest.

See [Engine Tenancy Data Model](./engine-tenancy-data-model.md) for persistence
and [Provision Engines Externally](../how-to/provision-engines-externally.md)
for operator examples.
