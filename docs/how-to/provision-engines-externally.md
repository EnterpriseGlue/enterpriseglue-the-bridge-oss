# Provision Engines Externally

Summary: Register dedicated or shared engine connections using the external
engine API.

Audience: Platform operators and external inventory/CMDB integrators.

Status: Dedicated and fail-closed shared registration are implemented. Shared
tenant mapping administration is not yet available, so shared engines remain
incomplete and must not be used for production runtime access.

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
`tenantResolutionStatus = incomplete`. This is a safe quarantine state. Do not
enable production access until mapping, reconciliation, and Effective Access
evidence described in the implementation plan are complete.

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

See [Engine Tenancy and Provisioning API](../reference/engine-tenancy-and-provisioning-api.md)
for the developer contract.
