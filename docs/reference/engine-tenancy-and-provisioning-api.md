# Engine Tenancy and Provisioning API

Summary: Developer contract for dedicated/shared engine provisioning and tenant
reference resolution.

Audience: Backend developers, enterprise-plugin implementers, API integrators,
and security reviewers.

Status: Manual and external create/update tenancy contracts are implemented.
Mapping administration and topology transition APIs remain planned and are not
described as available here.

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
- Shared: null engine `tenantId`, non-null mapping strategy, status
  `incomplete` until reconciliation.
- Ordinary updates never mutate topology.
- External omission is warned and audited.
- Runtime access scope and topology remain separate, although shared requires
  resource-aware scope.

## Verification

Run `pnpm run test:engine-tenancy:provisioning`. It validates the functional
coverage manifest, enforces 100% statement/branch/function/line coverage on the
provisioning policy module, and runs route, schema, and OpenAPI contract suites.

See [Engine Tenancy Data Model](./engine-tenancy-data-model.md) for persistence
and [Provision Engines Externally](../how-to/provision-engines-externally.md)
for operator examples.
