# Provision Engines Externally

Summary: Register dedicated or shared engine connections using the external
engine API.

Audience: Platform operators and external inventory/CMDB integrators.

Status: Dedicated/shared registration and atomic shared tenant mapping are
implemented. Shared runtime resources remain unavailable until reconciliation
resolves each resource to exactly one tenant.

## Before You Start

Use an API-client token with engine registration scope and permission for the
selected external engine system.

```bash
export ENTERPRISEGLUE_URL="https://enterpriseglue.example.com"
export ENTERPRISEGLUE_TOKEN="<api-client-token>"
```

External engine URLs must use HTTP or HTTPS and cannot target localhost,
private, link-local, reserved, metadata, or Docker-internal hosts.

## Register a Dedicated Engine

Send explicit tenancy so the integration does not depend on temporary omission
compatibility:

```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/external/engines" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Payments production",
    "baseUrl": "https://engine.example.com/engine-rest",
    "externalId": "cmdb/payments-prod",
    "type": "operaton",
    "connectionMode": "direct",
    "runtimeAccessScope": "engine_wide",
    "tenancy": {
      "mode": "dedicated",
      "tenantRef": { "type": "request_context" }
    }
  }'
```

A successful OSS engine includes:

```json
{
  "created": true,
  "engine": {
    "tenancyMode": "dedicated",
    "tenantId": "tenant-default",
    "tenantMappingStrategy": null,
    "tenantResolutionStatus": "ready"
  },
  "diagnostics": {
    "tenancyWarnings": []
  }
}
```

In an enterprise multi-tenant deployment, `tenantId` is resolved by the
authenticated context or enterprise tenant resolver.

## Register a Shared Connection

Shared mode must be explicit and resource-aware:

```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/external/engines" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Central process platform",
    "baseUrl": "https://central-engine.example.com/engine-rest",
    "externalId": "cmdb/central-prod",
    "type": "operaton",
    "connectionMode": "direct",
    "runtimeAccessScope": "resource_aware",
    "tenancy": {
      "mode": "shared",
      "mappingStrategy": "engine_tenant_id",
      "unmappedPolicy": "deny"
    }
  }'
```

The connection is created with null `tenantId` and
`tenantResolutionStatus = incomplete`. This is a safe quarantine state.

## Map Shared Runtime Tenants

Preview the mapping batch first:

```bash
curl --fail-with-body \
  -X PUT "$ENTERPRISEGLUE_URL/engines-api/external/engines/cmdb%2Fcentral-prod/tenant-mappings" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "externalSystemId": "cmdb",
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

Review the per-row result and aggregate resource counts, then repeat with
`"dryRun": false` and the same current `expectedMappingVersion`. If another
operator or integration changed mappings, the API returns
`ENGINE_TENANT_MAPPING_VERSION_CONFLICT`; refresh and rebuild the batch instead
of removing the version guard.

The selected strategy determines the source key:

| Strategy | Mapping key observed at runtime |
| --- | --- |
| `engine_tenant_id` | Native engine tenant id |
| `deployment_target` | EnterpriseGlue project/deployment target id |
| `explicit` | Explicit runtime tenant id supplied by the adapter or receipt |

Deactivate a mapping by sending the same `externalTenantId`, `strategy`, and
`sourceRef` with `"active": false`. Deactivation immediately reconciles known
resources and quarantines resources that no longer have exactly one mapping.

Before allowing tenant users to rely on a shared engine, reconcile inventory and
verify diagnostics show zero unmapped and zero conflicting resources. The
remaining release gate also requires tenant assignment, Effective Access, and
runtime-path evidence from the implementation plan; mapping readiness alone
does not prove the complete authorization rollout.

## Update and Retry

The endpoint is an upsert keyed by `externalId`. Retrying the same equivalent
request is safe. Keep sending explicit `tenancy` on every upsert.

An ordinary upsert cannot change dedicated/shared topology, move a dedicated
engine to another tenant, or change a shared mapping strategy. Those operations
return HTTP 409 with `ENGINE_TENANCY_TRANSITION_REQUIRED`. Do not work around
the error by deleting and recreating production inventory.

If tenancy is omitted, the API treats the request as dedicated and returns:

```json
{
  "diagnostics": {
    "tenancyWarnings": ["ENGINE_TENANCY_DEFAULTED_TO_DEDICATED"]
  }
}
```

Update the integration to send explicit tenancy when this warning appears.

## Troubleshooting

| Code | Action |
| --- | --- |
| `ENGINE_SHARED_REQUIRES_RESOURCE_AWARE` | Set `runtimeAccessScope` to `resource_aware` or use dedicated topology |
| `ENGINE_TENANT_REFERENCE_FORBIDDEN` | Use request/default tenancy or ask an administrator to authorize/configure the reference |
| `ENGINE_TENANCY_TRANSITION_REQUIRED` | Preserve topology and use the controlled transition workflow when available |
| `ENGINE_TENANT_MAPPING_VERSION_CONFLICT` | Read the current mapping version, rebuild the batch, and retry |
| `ENGINE_TENANCY_CONFLICT` | Correct the strategy, duplicate identity, or source-ownership conflict |

See [Engine Tenancy and Provisioning API](../reference/engine-tenancy-and-provisioning-api.md)
for the developer contract.
