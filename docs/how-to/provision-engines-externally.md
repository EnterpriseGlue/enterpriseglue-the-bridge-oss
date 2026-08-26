# Provision Engines Externally

Summary: Register dedicated or shared engine connections using the external
engine API.

Audience: Platform operators and external inventory/CMDB integrators.

Status: Dedicated/shared registration and atomic shared tenant mapping are
implemented. Shared runtime resources remain unavailable until reconciliation
resolves each resource to exactly one tenant.

This API owns engine inventory only. It never changes SSO/access authority,
project creation, or platform governance settings and never grants a user or
group access to the engine. For those independent controls, see
[Access Governance and Headless Configuration API](../reference/access-governance-and-headless-api.md).

These contracts have the same persisted engine-tenancy behavior on
PostgreSQL, MySQL, SQL Server, Oracle, and Spanner. The supported adapter
matrix covers clean install, all six upgrade baselines, retry, schema
equivalence, the real mapping transaction, rollback, and cleanup. See the
[database qualification runbook](../development/engine-tenancy-database-qualification.md)
for its exact scope and evidence.

## Before You Start

Use an API-client token with engine registration scope and permission for the
selected external engine system.

```bash
export ENTERPRISEGLUE_URL="https://enterpriseglue.example.com"
export ENTERPRISEGLUE_TOKEN="<api-client-token>"
```

By default, external engine URLs must use HTTPS and cannot target localhost,
private, link-local, reserved, metadata, or Docker-internal hosts. A reviewed
private engine or customer sidecar can be enabled only with
`EG_ENGINE_ALLOW_PRIVATE_HOSTS=true` and an exact `EG_ENGINE_ALLOWED_HOSTS`
entry; see [Configuration reference](../reference/configuration.md#engine-endpoint-policy).
Temporary private HTTP additionally requires the explicit insecure-HTTP opt-in.

## Register a Dedicated Engine

Send explicit tenancy so the integration does not depend on temporary omission
compatibility:

<!-- enterpriseglue-curl-contract: POST /engines-api/external/engines ExternalEngineRegistrationRequestSchema -->
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

```text
{
  "created": true,
  "engine": {
    "tenancyMode": "dedicated",
    "tenantId": "tenant-default",
    "tenantMappingStrategy": null,
    "tenantResolutionStatus": "ready"
  }
}
```

In an enterprise multi-tenant deployment, `tenantId` is resolved by the
authenticated context or enterprise tenant resolver.

## Register a Shared Connection

Shared mode must be explicit and resource-aware:

<!-- enterpriseglue-curl-contract: POST /engines-api/external/engines ExternalEngineRegistrationRequestSchema -->
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

<!-- enterpriseglue-curl-contract: PUT /engines-api/external/engines/{externalId}/tenant-mappings ExternalEngineTenantMappingsUpsertRequestSchema -->
```bash
curl --fail-with-body \
  -X PUT "$ENTERPRISEGLUE_URL/engines-api/external/engines/cmdb%2Fcentral-prod/tenant-mappings" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_TOKEN" \
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

## Validate Access Before Handover

Do not hand a new engine to tenant users based only on a successful registration
response. Complete this checklist for the dedicated or shared engine:

1. Confirm the engine shows the intended `dedicated` or `shared` topology.
2. For a dedicated engine, confirm its owning tenant is persisted. For a shared
   engine, confirm every active runtime resource is resolved and the unmapped
   and conflicting counts are zero.
3. Assign the intended predefined or custom role and inspect Effective Access
   for its source, tenant, resource scope, and expiry.
4. Sign in as a representative tenant user and verify an allowed list and detail
   path, then verify a sibling-tenant direct URL is denied.
5. Revoke the assignment or deactivate a mapping while that session is open.
   Refresh and use browser back/forward navigation; access must disappear
   immediately.
6. Retain the sanitized diagnostics, audit event, and test result with the
   rollout record. Never retain tokens, credential values, private engine URLs,
   raw identity claims, or customer identifiers in test evidence.

Stop the rollout and restore the last known mapping/assignment configuration if
a resource has no single resolved tenant, Effective Access disagrees with the
intended role, a denied path reaches the engine, or revocation is not immediate.

## Update and Retry

The endpoint is an upsert keyed by `externalId`. Retrying the same equivalent
request is safe: the retry returns `created: false` with the same engine ID
instead of creating a second row. Keep sending explicit `tenancy` on every
upsert. A changed name, label, connection field, or credential reference also
updates that same stable engine ID when the field is owned by the external
source. Display name and environment are manual-owned by default. If the
inventory system must manage the display name, include
`"fieldOwnership": { "display": "external" }` from the first registration and
on later upserts. Otherwise, a different incoming name is retained as
`manual_override` drift instead of overwriting the operator's value.

An ordinary upsert cannot change dedicated/shared topology, move a dedicated
engine to another tenant, or change a shared mapping strategy. Those operations
return HTTP 409 with `ENGINE_TENANCY_TRANSITION_REQUIRED`. Do not work around
the error by deleting and recreating production inventory.

Every external create and idempotent upsert must include `tenancy`. A missing
declaration is rejected with HTTP 400 before EnterpriseGlue reads or writes the
engine. Existing engines are not reclassified by this request-contract change.

## Rotate Credentials and Reconcile

Rotate the value in the configured secret provider first, then repeat the
idempotent registration with the same `externalId`, explicit tenancy, and a
new opaque secret reference. This example never places credential material in
the request or documentation:

<!-- enterpriseglue-curl-contract: POST /engines-api/external/engines ExternalEngineRegistrationRequestSchema -->
```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/external/engines" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Payments production",
    "baseUrl": "https://engine.example.com/engine-rest",
    "externalId": "cmdb/payments-prod",
    "externalSystemId": "cmdb",
    "type": "operaton",
    "connectionMode": "direct",
    "authType": "basic",
    "username": "enterpriseglue",
    "passwordEnc": "ref:env://PAYMENTS_ENGINE_PASSWORD_V2",
    "runtimeAccessScope": "engine_wide",
    "tenancy": {
      "mode": "dedicated",
      "tenantRef": { "type": "request_context" }
    }
  }'
```

An authenticated platform operator can then reconcile capability and Engine
Set materialization state. This endpoint uses a normal administrator session
token, not the external API-client token:

<!-- enterpriseglue-curl-contract: POST /api/authz/external-engines/{id}/reconcile none -->
```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/api/authz/external-engines/$ENGINE_ID/reconcile" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN"
```

## Decommission

Decommission preserves the retired engine, mapping, inventory, and audit rows
as inactive evidence while removing every direct engine/runtime assignment,
active mapping, active inventory record, Engine Set materialization, Runtime
Resource Set materialization, and active deployment target.

If the engine has used `mirrored_engine_backstop`, first retry or roll back all
backstop work until there are no queued/running tasks, owned native grants, or
pending native side effects. The decommission request returns a conflict and
makes no lifecycle or assignment change while any such evidence remains.
After retirement is complete, decommission deactivates backstop mappings but
preserves the engine plus its run/task receipts for audit and recovery.

`TEN-API-012`: runtime validation and OpenAPI use the same strict external
decommission request schema.

<!-- enterpriseglue-curl-contract: POST /engines-api/external/engines/decommission ExternalEngineDecommissionRequestSchema -->
```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/external/engines/decommission" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "externalId": "cmdb/payments-prod",
    "externalSystemId": "cmdb",
    "reason": "Retired by the owning inventory system"
  }'
```

After decommission, verify the lifecycle status, zero active mappings and
inventory rows, empty materializations, denied connection tests, denied
already-authenticated sessions, zero retained native ownership/pending state,
and retained sanitized audit and backstop history. If the
owning system registers the same `externalId` again, EnterpriseGlue creates a
new active engine with a new stable engine ID; it does not update the retired
row. Update downstream references to the new ID.

Explicit administrator reactivation is a separate recovery action. It does not
restore removed assignments or reactivate retired mappings/inventory, and it
must be followed by deliberate remapping, reassignment, reconciliation, and
access verification. Do not reactivate a retired row when a replacement with
the same external identity is active.

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
