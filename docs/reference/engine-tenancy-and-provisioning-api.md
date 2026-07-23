# Engine Tenancy and Provisioning API

Summary: Developer contract for dedicated/shared engine provisioning and tenant
reference resolution.

Audience: Backend developers, enterprise-plugin implementers, API integrators,
and security reviewers.

Status: Manual and external create/update tenancy contracts, tenant mapping
administration, diagnostics, and runtime reconciliation are implemented.
Topology transition APIs and configuration-owned mapping rows remain planned.

## Request Contract

Manual create, manual update, and external registration requests accept the
same optional `tenancy` object.

Dedicated in the authenticated request tenant:

```json
{
  "mode": "dedicated",
  "tenantRef": { "type": "request_context" }
}
```

Dedicated in the installation default tenant:

```json
{
  "mode": "dedicated",
  "tenantRef": { "type": "default" }
}
```

Dedicated using a deployment-specific stable reference:

```json
{
  "mode": "dedicated",
  "tenantRef": { "type": "key", "key": "tenant.team-a" }
}
```

Shared:

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

## Tenant Mapping API

For an engine created with `tenancy.mode = shared`, administrators can list and
atomically apply mappings:

```text
GET /engines-api/engines/{id}/tenant-mappings
PUT /engines-api/engines/{id}/tenant-mappings
GET /engines-api/engines/{id}/tenancy/diagnostics
```

Example apply request:

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

## Compatibility

Omitted tenancy means dedicated request-context tenancy. In OSS, a missing
request tenant becomes `tenant-default`. External responses include
`ENGINE_TENANCY_DEFAULTED_TO_DEDICATED` in `diagnostics.tenancyWarnings`.
Manual update omission preserves existing topology; external upsert omission
reasserts the compatibility-dedicated contract and cannot overwrite a shared
engine.

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

## Stable Errors

| HTTP | Code | Meaning | Retry |
| --- | --- | --- | --- |
| 400 | `ENGINE_SHARED_REQUIRES_RESOURCE_AWARE` | Shared topology was paired with engine-wide authorization | Correct request |
| 403 | `ENGINE_TENANT_REFERENCE_FORBIDDEN` | Reference was denied or cannot be proven locally | Obtain access or configure resolver |
| 409 | `ENGINE_TENANCY_TRANSITION_REQUIRED` | Ordinary update would change topology, tenant, or mapping strategy | Use transition workflow when available |
| 409 | `ENGINE_TENANT_MAPPING_VERSION_CONFLICT` | Mapping version changed after the caller read it | Refresh diagnostics/mappings and retry |
| 409 | `ENGINE_TENANCY_CONFLICT` | Mapping identity, source ownership, strategy, or resolution is inconsistent | Correct the batch or ownership conflict |

The canonical error body is:

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
- External omission is warned and audited.
- Mapping writes are atomic and version guarded.
- Runtime resolution records the mapping id and version; missing or conflicting
  matches have no tenant and remain quarantined.
- Runtime access scope and topology remain separate, although shared requires
  resource-aware scope.

## Verification

Run `pnpm run test:engine-tenancy:provisioning` for provisioning and
`pnpm run test:engine-tenancy:mappings` for mapping, runtime, configuration,
authorization-registry, schema, and OpenAPI contracts. Both validate the
machine-readable functional coverage manifest.

See [Engine Tenancy Data Model](./engine-tenancy-data-model.md) for persistence
and [Provision Engines Externally](../how-to/provision-engines-externally.md)
for operator examples.
